-- Ledgerline — reconciliation, treasury transfers and approved adjustments

-- Finance staff record the balances observed in the real wallets / strategy
-- venues. The run compares them with the ledger. A mismatch beyond tolerance
-- pauses withdrawals of that asset automatically.
create table app.reconciliation_runs (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null references app.assets(code),
  observed_custody numeric(38, 18) not null check (observed_custody >= 0),
  observed_strategy numeric(38, 18) not null check (observed_strategy >= 0),
  ledger_custody numeric(38, 18) not null,
  ledger_strategy numeric(38, 18) not null,
  user_liabilities numeric(38, 18) not null,
  suspense numeric(38, 18) not null,
  custody_difference numeric(38, 18) not null,
  strategy_difference numeric(38, 18) not null,
  coverage_ratio numeric(20, 6),
  tolerance numeric(38, 18) not null,
  status text not null check (status in ('ok', 'mismatch')),
  evidence_reference text not null,
  notes text,
  created_by uuid references app.profiles(id),
  created_at timestamptz not null default now()
);
create index reconciliation_runs_asset_idx on app.reconciliation_runs (asset_code, created_at desc);
create trigger reconciliation_runs_immutable before update or delete on app.reconciliation_runs
  for each row execute function app.forbid_mutation();

create or replace function app.run_reconciliation(
  p_asset text, p_observed_custody numeric, p_observed_strategy numeric, p_evidence text, p_notes text, p_actor uuid
)
returns app.reconciliation_runs
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_pos record;
  v_tol numeric := coalesce(app.setting_asset_numeric('reconciliation.tolerance', p_asset), 0);
  v_status text;
  v_row app.reconciliation_runs;
  v_paused jsonb;
begin
  select * into v_pos from app.asset_position(p_asset);
  v_status := case
    when abs(p_observed_custody - v_pos.custody) > v_tol or abs(p_observed_strategy - v_pos.strategy) > v_tol then 'mismatch'
    when v_pos.coverage_ratio is not null and v_pos.coverage_ratio < 1 then 'mismatch'
    else 'ok' end;

  insert into app.reconciliation_runs (
    asset_code, observed_custody, observed_strategy, ledger_custody, ledger_strategy, user_liabilities, suspense,
    custody_difference, strategy_difference, coverage_ratio, tolerance, status, evidence_reference, notes, created_by
  ) values (
    p_asset, p_observed_custody, p_observed_strategy, v_pos.custody, v_pos.strategy, v_pos.user_liabilities, v_pos.suspense,
    p_observed_custody - v_pos.custody, p_observed_strategy - v_pos.strategy, v_pos.coverage_ratio, v_tol, v_status,
    p_evidence, p_notes, p_actor
  ) returning * into v_row;

  if v_status = 'mismatch' then
    v_paused := coalesce(app.setting('withdrawals.paused_assets'), '[]'::jsonb);
    if not v_paused ? p_asset then
      perform set_config('app.change_reason', 'reconciliation mismatch ' || v_row.id, true);
      update app.system_settings set value = v_paused || to_jsonb(p_asset), updated_by = p_actor, updated_at = now()
      where key = 'withdrawals.paused_assets';
      perform set_config('app.change_reason', '', true);
    end if;
    perform app.emit_event('admin:ops', 'reconciliation.mismatch', jsonb_build_object('asset', p_asset, 'runId', v_row.id));
  end if;
  return v_row;
end;
$$;

-- Physical movement between custody wallets and strategy venues.
create table app.treasury_transfers (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null references app.assets(code),
  from_account text not null check (from_account in ('custody', 'strategy')),
  to_account text not null check (to_account in ('custody', 'strategy')),
  amount numeric(38, 18) not null check (amount > 0),
  evidence_reference text not null,
  ledger_transaction_id uuid not null references app.ledger_transactions(id),
  created_by uuid not null references app.profiles(id),
  created_at timestamptz not null default now(),
  check (from_account <> to_account)
);
create trigger treasury_transfers_immutable before update or delete on app.treasury_transfers
  for each row execute function app.forbid_mutation();

create or replace function app.treasury_transfer(
  p_asset text, p_from text, p_to text, p_amount numeric, p_evidence text, p_actor uuid, p_idempotency_key text
)
returns app.treasury_transfers
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_tx uuid;
  v_row app.treasury_transfers;
begin
  v_tx := app.post_ledger_transaction(
    'treasury_transfer', p_asset, 'treasury:' || p_idempotency_key, 'admin', 'treasury_transfer', v_id,
    jsonb_build_array(
      app.entry(app.system_account(p_asset, p_to), 'debit', p_amount),
      app.entry(app.system_account(p_asset, p_from), 'credit', p_amount)
    ),
    'Treasury transfer ' || p_from || ' -> ' || p_to, jsonb_build_object('evidence', p_evidence), p_actor);
  insert into app.treasury_transfers (id, asset_code, from_account, to_account, amount, evidence_reference, ledger_transaction_id, created_by)
  values (v_id, p_asset, p_from, p_to, p_amount, p_evidence, v_tx, p_actor)
  on conflict do nothing
  returning * into v_row;
  if v_row.id is null then
    select * into v_row from app.treasury_transfers where ledger_transaction_id = v_tx;
  end if;
  return v_row;
end;
$$;

-- Manual balance correction. Executed ONLY from an approved admin_approvals
-- request (four-eyes), never directly from a request handler.
create or replace function app.post_adjustment(
  p_approval uuid, p_user uuid, p_asset text, p_direction text, p_amount numeric, p_reason text, p_actor uuid
)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_approval app.admin_approvals;
  v_user_account uuid;
  v_adj uuid;
begin
  select * into v_approval from app.admin_approvals where id = p_approval;
  if not found or v_approval.status <> 'approved' or v_approval.action_type <> 'ledger.adjustment' then
    perform app.raise_error('approval_required');
  end if;
  if p_direction not in ('credit_user', 'debit_user') then
    perform app.raise_error('invalid_direction');
  end if;
  v_user_account := app.user_account(p_user, p_asset, 'available');
  v_adj := app.system_account(p_asset, 'adjustments');
  return app.post_ledger_transaction(
    'adjustment', p_asset, 'adjustment:' || p_approval, 'admin', 'adjustment', p_approval,
    case when p_direction = 'credit_user' then
      jsonb_build_array(app.entry(v_adj, 'debit', p_amount), app.entry(v_user_account, 'credit', p_amount))
    else
      jsonb_build_array(app.entry(v_user_account, 'debit', p_amount), app.entry(v_adj, 'credit', p_amount))
    end,
    p_reason, jsonb_build_object('approvalId', p_approval), p_actor);
end;
$$;

-- The operator adds its own funds to custody (for example a referral budget).
-- Recorded with evidence so platform equity is always explainable.
create table app.capital_contributions (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null references app.assets(code),
  amount numeric(38, 18) not null check (amount > 0),
  evidence_reference text not null check (char_length(evidence_reference) >= 3),
  ledger_transaction_id uuid not null references app.ledger_transactions(id),
  created_by uuid not null references app.profiles(id),
  created_at timestamptz not null default now()
);
create trigger capital_contributions_immutable before update or delete on app.capital_contributions
  for each row execute function app.forbid_mutation();

create or replace function app.record_capital_contribution(
  p_asset text, p_amount numeric, p_evidence text, p_actor uuid, p_idempotency_key text
)
returns app.capital_contributions
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_id uuid := gen_random_uuid();
  v_tx uuid;
  v_row app.capital_contributions;
begin
  v_tx := app.post_ledger_transaction(
    'capital_contribution', p_asset, 'capital:' || p_idempotency_key, 'admin', 'capital_contribution', v_id,
    jsonb_build_array(
      app.entry(app.system_account(p_asset, 'custody'), 'debit', p_amount),
      app.entry(app.system_account(p_asset, 'platform_capital'), 'credit', p_amount)
    ),
    'Capital contribution', jsonb_build_object('evidence', p_evidence), p_actor);
  select * into v_row from app.capital_contributions where ledger_transaction_id = v_tx;
  if not found then
    insert into app.capital_contributions (id, asset_code, amount, evidence_reference, ledger_transaction_id, created_by)
    values (v_id, p_asset, p_amount, p_evidence, v_tx, p_actor)
    returning * into v_row;
  end if;
  return v_row;
end;
$$;
