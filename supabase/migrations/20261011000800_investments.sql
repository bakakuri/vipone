-- Ledgerline — investment products, positions and realised results
--
-- Returns are never promised or simulated. A product earns (or loses) only
-- when finance staff record a realised result for a period, with evidence,
-- and a SECOND staff member approves it. The result is then allocated to the
-- positions that were open during the period. Products cannot be activated
-- without a defined revenue model, approved legal status and risk disclosure
-- in every language.

create table app.investment_products (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  name jsonb not null,
  summary jsonb not null,
  risk_disclosure jsonb not null,
  revenue_model text not null check (revenue_model in ('trading', 'staking', 'lending', 'market_making', 'other')),
  revenue_model_description jsonb not null,
  term_days int not null check (term_days between 1 and 3650),
  min_amount numeric(38, 18) not null check (min_amount > 0),
  max_amount numeric(38, 18) check (max_amount is null or max_amount > 0),
  capacity numeric(38, 18) check (capacity is null or capacity > 0),
  performance_fee_rate numeric(12, 8) not null default 0 check (performance_fee_rate >= 0 and performance_fee_rate <= 0.5),
  early_exit_allowed boolean not null default false,
  early_exit_fee_rate numeric(12, 8) not null default 0 check (early_exit_fee_rate >= 0 and early_exit_fee_rate <= 0.5),
  risk_level text not null check (risk_level in ('low', 'medium', 'high')),
  legal_status text not null default 'draft' check (legal_status in ('draft', 'under_review', 'approved', 'suspended')),
  legal_reference text,
  status text not null default 'draft' check (status in ('draft', 'active', 'paused', 'closed')),
  version int not null default 1,
  results_through timestamptz,
  created_by uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (max_amount is null or max_amount >= min_amount),
  check (jsonb_typeof(name) = 'object' and jsonb_typeof(summary) = 'object'
         and jsonb_typeof(risk_disclosure) = 'object' and jsonb_typeof(revenue_model_description) = 'object'),
  -- Activation guard: nothing goes live without its legal and financial basis.
  check (status <> 'active' or (
    legal_status = 'approved'
    and legal_reference is not null and char_length(legal_reference) >= 3
    and app.has_all_locales(name) and app.has_all_locales(summary)
    and app.has_all_locales(risk_disclosure) and app.has_all_locales(revenue_model_description)
  ))
);
create trigger investment_products_touch before update on app.investment_products for each row execute function app.touch_updated_at();

create table app.investment_product_assets (
  product_id uuid not null references app.investment_products(id),
  asset_code text not null references app.assets(code),
  primary key (product_id, asset_code)
);

-- Immutable snapshot of the terms each position was opened under.
create table app.investment_product_versions (
  product_id uuid not null references app.investment_products(id),
  version int not null,
  terms jsonb not null,
  created_by uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  primary key (product_id, version)
);
create trigger investment_product_versions_immutable before update or delete on app.investment_product_versions
  for each row execute function app.forbid_mutation();

create or replace function app.product_terms(p app.investment_products)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object(
    'name', p.name, 'summary', p.summary, 'riskDisclosure', p.risk_disclosure,
    'revenueModel', p.revenue_model, 'revenueModelDescription', p.revenue_model_description,
    'termDays', p.term_days, 'minAmount', p.min_amount::text, 'maxAmount', p.max_amount::text,
    'performanceFeeRate', p.performance_fee_rate::text, 'earlyExitAllowed', p.early_exit_allowed,
    'earlyExitFeeRate', p.early_exit_fee_rate::text, 'riskLevel', p.risk_level, 'legalReference', p.legal_reference
  );
$$;

create or replace function app.investment_product_versioning()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'UPDATE' and app.product_terms(new) is distinct from app.product_terms(old) then
    new.version := old.version + 1;
  end if;
  return new;
end;
$$;
create trigger investment_products_version_bump before update on app.investment_products
  for each row execute function app.investment_product_versioning();

create or replace function app.investment_product_snapshot()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.version <> old.version then
    insert into app.investment_product_versions (product_id, version, terms, created_by)
    values (new.id, new.version, app.product_terms(new), new.created_by)
    on conflict do nothing;
  end if;
  return null;
end;
$$;
create trigger investment_products_snapshot after insert or update on app.investment_products
  for each row execute function app.investment_product_snapshot();

create table app.investment_positions (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default app.new_reference('POS'),
  user_id uuid not null references app.profiles(id),
  product_id uuid not null references app.investment_products(id),
  product_version int not null,
  asset_code text not null references app.assets(code),
  principal numeric(38, 18) not null check (principal > 0),
  status text not null check (status in ('active', 'awaiting_settlement', 'matured', 'closed_early')),
  started_at timestamptz not null default now(),
  maturity_at timestamptz not null,
  closed_at timestamptz,
  released_amount numeric(38, 18),
  early_exit_fee numeric(38, 18),
  allocation_transaction_id uuid not null references app.ledger_transactions(id),
  release_transaction_id uuid references app.ledger_transactions(id),
  terms_accepted_at timestamptz not null,
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  foreign key (product_id, product_version) references app.investment_product_versions (product_id, version),
  check (maturity_at > started_at),
  check ((status in ('matured', 'closed_early')) = (closed_at is not null and release_transaction_id is not null))
);
create index investment_positions_user_idx on app.investment_positions (user_id, created_at desc);
create index investment_positions_due_idx on app.investment_positions (maturity_at) where status = 'active';
create index investment_positions_product_idx on app.investment_positions (product_id, asset_code, status);
create trigger investment_positions_touch before update on app.investment_positions for each row execute function app.touch_updated_at();

insert into app.status_transitions (entity, from_status, to_status) values
  ('position', '_new', 'active'),
  ('position', 'active', 'awaiting_settlement'),
  ('position', 'active', 'matured'),
  ('position', 'active', 'closed_early'),
  ('position', 'awaiting_settlement', 'matured');
create trigger investment_positions_status before insert or update on app.investment_positions
  for each row execute function app.enforce_status_transition('position');

create or replace function app.position_status_signal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform app.emit_event('user:' || new.user_id, 'position.updated', jsonb_build_object('id', new.id, 'status', new.status));
  end if;
  return null;
end;
$$;
create trigger investment_positions_signal after insert or update on app.investment_positions
  for each row execute function app.position_status_signal();

create table app.investment_results (
  id uuid primary key default gen_random_uuid(),
  product_id uuid not null references app.investment_products(id),
  asset_code text not null references app.assets(code),
  period_start timestamptz not null,
  period_end timestamptz not null,
  -- Realised return of the strategy over the period, before performance fee.
  gross_return_rate numeric(12, 8) not null check (gross_return_rate > -1 and gross_return_rate < 10),
  evidence_reference text not null check (char_length(evidence_reference) between 3 and 300),
  notes text,
  status text not null check (status in ('draft', 'approved', 'posted', 'rejected')),
  created_by uuid not null references app.profiles(id),
  approved_by uuid references app.profiles(id),
  approved_at timestamptz,
  posted_at timestamptz,
  rejected_by uuid references app.profiles(id),
  rejection_reason text,
  ledger_transaction_id uuid references app.ledger_transactions(id),
  positions_count int,
  total_gross numeric(38, 18),
  total_fee numeric(38, 18),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (period_end > period_start),
  check (period_end <= now() + interval '1 minute'),
  check (approved_by is null or approved_by <> created_by)
);
create index investment_results_product_idx on app.investment_results (product_id, asset_code, period_start);
create trigger investment_results_touch before update on app.investment_results for each row execute function app.touch_updated_at();

insert into app.status_transitions (entity, from_status, to_status) values
  ('investment_result', '_new', 'draft'),
  ('investment_result', 'draft', 'approved'),
  ('investment_result', 'draft', 'rejected'),
  ('investment_result', 'approved', 'posted'),
  ('investment_result', 'approved', 'rejected');
create trigger investment_results_status before insert or update on app.investment_results
  for each row execute function app.enforce_status_transition('investment_result');

create or replace function app.investment_results_no_overlap()
returns trigger
language plpgsql
as $$
begin
  if new.status in ('draft', 'approved', 'posted') and exists (
    select 1 from app.investment_results r
    where r.product_id = new.product_id and r.asset_code = new.asset_code and r.id <> new.id
      and r.status in ('draft', 'approved', 'posted')
      and tstzrange(r.period_start, r.period_end, '[)') && tstzrange(new.period_start, new.period_end, '[)')
  ) then
    perform app.raise_error('result_period_overlap');
  end if;
  return new;
end;
$$;
create trigger investment_results_overlap before insert or update on app.investment_results
  for each row execute function app.investment_results_no_overlap();

create table app.investment_events (
  id bigint generated always as identity primary key,
  position_id uuid not null references app.investment_positions(id),
  event_type text not null check (event_type in ('opened', 'result', 'awaiting_settlement', 'released', 'closed_early')),
  result_id uuid references app.investment_results(id),
  gross_amount numeric(38, 18),
  fee_amount numeric(38, 18),
  -- Signed: positive for a realised profit, negative for a realised loss.
  net_amount numeric(38, 18),
  ledger_transaction_id uuid references app.ledger_transactions(id),
  created_at timestamptz not null default now(),
  check (event_type <> 'result' or (result_id is not null and net_amount is not null))
);
create unique index investment_events_result_uq on app.investment_events (position_id, result_id) where event_type = 'result';
create index investment_events_position_idx on app.investment_events (position_id, created_at);
create trigger investment_events_immutable before update or delete on app.investment_events
  for each row execute function app.forbid_mutation();

-- Current value of a position = principal + all realised (posted) results.
create or replace function app.position_value(p_position uuid)
returns numeric
language sql
stable
as $$
  select p.principal + coalesce((select sum(e.net_amount) from app.investment_events e
                                 where e.position_id = p.id and e.event_type = 'result'), 0)
  from app.investment_positions p where p.id = p_position;
$$;

-- Opening a position ---------------------------------------------------------------
create or replace function app.open_position(
  p_user uuid, p_product uuid, p_asset text, p_amount numeric, p_idempotency_key text, p_terms_version int
)
returns app.investment_positions
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_existing app.investment_positions;
  v_product app.investment_products;
  v_profile app.profiles;
  v_used numeric;
  v_position_id uuid := gen_random_uuid();
  v_tx uuid;
  v_row app.investment_positions;
begin
  select * into v_existing from app.investment_positions where user_id = p_user and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_profile from app.profiles where id = p_user for update;
  if v_profile.status <> 'active' then
    perform app.raise_error('account_restricted', v_profile.status);
  end if;

  select * into v_product from app.investment_products where id = p_product for update;
  if not found or v_product.status <> 'active' then
    perform app.raise_error('product_not_available');
  end if;
  if v_product.version <> p_terms_version then
    perform app.raise_error('terms_changed', v_product.version::text);
  end if;
  if not exists (select 1 from app.investment_product_assets where product_id = p_product and asset_code = p_asset) then
    perform app.raise_error('asset_not_supported_by_product');
  end if;
  if p_amount < v_product.min_amount then
    perform app.raise_error('amount_below_minimum', v_product.min_amount::text);
  end if;
  if v_product.max_amount is not null and p_amount > v_product.max_amount then
    perform app.raise_error('amount_above_maximum', v_product.max_amount::text);
  end if;
  if v_product.capacity is not null then
    select coalesce(sum(principal), 0) into v_used from app.investment_positions
    where product_id = p_product and asset_code = p_asset and status in ('active', 'awaiting_settlement');
    if v_used + p_amount > v_product.capacity then
      perform app.raise_error('product_capacity_reached', greatest(v_product.capacity - v_used, 0)::text);
    end if;
  end if;

  v_tx := app.post_ledger_transaction(
    'investment_allocation', p_asset, 'investment-allocation:' || v_position_id, 'user', 'investment_position', v_position_id,
    jsonb_build_array(
      app.entry(app.user_account(p_user, p_asset, 'available'), 'debit', p_amount),
      app.entry(app.user_account(p_user, p_asset, 'invested'), 'credit', p_amount),
      app.entry(app.system_account(p_asset, 'strategy'), 'debit', p_amount),
      app.entry(app.system_account(p_asset, 'custody'), 'credit', p_amount)
    ),
    'Investment allocation', jsonb_build_object('productId', p_product), p_user);

  insert into app.investment_positions (
    id, user_id, product_id, product_version, asset_code, principal, status, started_at, maturity_at,
    allocation_transaction_id, terms_accepted_at, idempotency_key
  ) values (
    v_position_id, p_user, p_product, v_product.version, p_asset, p_amount, 'active', now(),
    now() + make_interval(days => v_product.term_days), v_tx, now(), p_idempotency_key
  ) returning * into v_row;

  insert into app.investment_events (position_id, event_type, net_amount, ledger_transaction_id)
  values (v_row.id, 'opened', 0, v_tx);

  perform app.notify(p_user, 'investment_opened',
    jsonb_build_object('reference', v_row.reference, 'amount', p_amount::text, 'asset', p_asset,
                       'maturityAt', v_row.maturity_at), '/investments');
  return v_row;
end;
$$;

-- Releasing a position (maturity or early exit) -------------------------------------
create or replace function app.release_position(p_position uuid, p_source text, p_actor uuid, p_early boolean default false)
returns app.investment_positions
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_pos app.investment_positions;
  v_product app.investment_products;
  v_value numeric;
  v_fee numeric := 0;
  v_decimals int;
  v_entries jsonb;
  v_tx uuid;
begin
  select * into v_pos from app.investment_positions where id = p_position for update;
  if not found then
    perform app.raise_error('not_found', 'position');
  end if;
  if v_pos.status in ('matured', 'closed_early') then
    return v_pos;
  end if;
  select * into v_product from app.investment_products where id = v_pos.product_id;
  select decimals into v_decimals from app.assets where code = v_pos.asset_code;

  v_value := app.position_value(v_pos.id);
  if p_early then
    if v_pos.status <> 'active' then
      perform app.raise_error('position_not_active');
    end if;
    if not ((select (terms ->> 'earlyExitAllowed')::boolean from app.investment_product_versions
             where product_id = v_pos.product_id and version = v_pos.product_version)) then
      perform app.raise_error('early_exit_not_allowed');
    end if;
    v_fee := trunc(v_value * (select (terms ->> 'earlyExitFeeRate')::numeric from app.investment_product_versions
                              where product_id = v_pos.product_id and version = v_pos.product_version), v_decimals);
  end if;

  v_entries := jsonb_build_array(
    app.entry(app.user_account(v_pos.user_id, v_pos.asset_code, 'invested'), 'debit', v_value),
    app.entry(app.user_account(v_pos.user_id, v_pos.asset_code, 'available'), 'credit', v_value - v_fee),
    app.entry(app.system_account(v_pos.asset_code, 'custody'), 'debit', v_value),
    app.entry(app.system_account(v_pos.asset_code, 'strategy'), 'credit', v_value)
  );
  if v_fee > 0 then
    v_entries := v_entries || jsonb_build_array(app.entry(app.system_account(v_pos.asset_code, 'fee_revenue'), 'credit', v_fee));
  end if;

  v_tx := app.post_ledger_transaction(
    case when p_early then 'investment_early_exit' else 'investment_release' end,
    v_pos.asset_code, 'investment-release:' || v_pos.id, p_source, 'investment_position', v_pos.id, v_entries,
    'Position ' || v_pos.reference || case when p_early then ' closed early' else ' released at maturity' end,
    jsonb_build_object('value', v_value::text, 'earlyExitFee', v_fee::text), p_actor);

  update app.investment_positions
  set status = case when p_early then 'closed_early' else 'matured' end,
      closed_at = now(), released_amount = v_value - v_fee, early_exit_fee = case when p_early then v_fee end,
      release_transaction_id = v_tx
  where id = v_pos.id
  returning * into v_pos;

  insert into app.investment_events (position_id, event_type, net_amount, fee_amount, ledger_transaction_id)
  values (v_pos.id, case when p_early then 'closed_early' else 'released' end, v_value - v_fee, v_fee, v_tx);

  perform app.notify(v_pos.user_id, 'investment_matured',
    jsonb_build_object('reference', v_pos.reference, 'amount', (v_value - v_fee)::text, 'asset', v_pos.asset_code,
                       'early', p_early), '/investments');
  return v_pos;
end;
$$;

-- Maturity job (safe to run from Vercel Cron or pg_cron). A position whose
-- final period has no posted result waits in awaiting_settlement: nothing
-- estimated is ever credited.
create or replace function app.process_due_positions(p_limit int default 200)
returns table (position_id uuid, new_status text)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_pos record;
  v_row app.investment_positions;
begin
  for v_pos in
    select p.id, p.maturity_at, pr.results_through, p.user_id, p.reference, p.asset_code
    from app.investment_positions p
    join app.investment_products pr on pr.id = p.product_id
    where p.status = 'active' and p.maturity_at <= now()
    order by p.maturity_at
    limit p_limit
    for update of p skip locked
  loop
    if v_pos.results_through is not null and v_pos.results_through >= v_pos.maturity_at then
      v_row := app.release_position(v_pos.id, 'job', null, false);
      position_id := v_pos.id; new_status := v_row.status;
    else
      update app.investment_positions set status = 'awaiting_settlement' where id = v_pos.id;
      insert into app.investment_events (position_id, event_type) values (v_pos.id, 'awaiting_settlement');
      perform app.notify(v_pos.user_id, 'investment_awaiting_settlement',
        jsonb_build_object('reference', v_pos.reference, 'asset', v_pos.asset_code), '/investments');
      position_id := v_pos.id; new_status := 'awaiting_settlement';
    end if;
    return next;
  end loop;
end;
$$;

-- Results ---------------------------------------------------------------------------
create or replace function app.approve_investment_result(p_result uuid, p_actor uuid)
returns app.investment_results
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.investment_results;
begin
  select * into v_row from app.investment_results where id = p_result for update;
  if not found then
    perform app.raise_error('not_found', 'result');
  end if;
  if v_row.created_by = p_actor then
    perform app.raise_error('second_approver_required');
  end if;
  update app.investment_results set status = 'approved', approved_by = p_actor, approved_at = now()
  where id = p_result returning * into v_row;
  return v_row;
end;
$$;

-- Positions that must receive an allocation for a result.
create or replace function app.result_eligible_positions(p_result uuid)
returns table (position_id uuid, user_id uuid, started_at timestamptz, maturity_at timestamptz, value_before numeric)
language sql
stable
as $$
  select p.id, p.user_id, p.started_at, p.maturity_at, app.position_value(p.id)
  from app.investment_results r
  join app.investment_positions p on p.product_id = r.product_id and p.asset_code = r.asset_code
  where r.id = p_result
    and p.status in ('active', 'awaiting_settlement')
    and p.started_at < r.period_end
    and p.maturity_at > r.period_start
  order by p.started_at, p.id;
$$;

-- p_allocations: [{"positionId": uuid, "gross": "1.23", "fee": "0.12", "net": "1.11"}]
-- (computed by server/modules/investments/calculate-position-result.js)
create or replace function app.post_investment_result(p_result uuid, p_actor uuid, p_allocations jsonb)
returns app.investment_results
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_res app.investment_results;
  v_eligible int;
  v_given int;
  v_alloc record;
  v_pos app.investment_positions;
  v_entries jsonb := '[]'::jsonb;
  v_total_gross numeric := 0;
  v_total_fee numeric := 0;
  v_total_net numeric := 0;
  v_tx uuid;
  v_released record;
begin
  select * into v_res from app.investment_results where id = p_result for update;
  if not found then
    perform app.raise_error('not_found', 'result');
  end if;
  if v_res.status = 'posted' then
    return v_res;
  end if;
  if v_res.status <> 'approved' then
    perform app.raise_error('result_not_approved');
  end if;

  select count(*) into v_eligible from app.result_eligible_positions(p_result);
  select count(distinct (a ->> 'positionId')) into v_given from jsonb_array_elements(p_allocations) a;
  if v_eligible <> v_given or v_given <> jsonb_array_length(p_allocations) then
    perform app.raise_error('allocation_incomplete', format('eligible %s, given %s', v_eligible, v_given));
  end if;

  for v_alloc in
    select (a ->> 'positionId')::uuid as position_id, (a ->> 'gross')::numeric as gross,
           (a ->> 'fee')::numeric as fee, (a ->> 'net')::numeric as net
    from jsonb_array_elements(p_allocations) a
  loop
    if not exists (select 1 from app.result_eligible_positions(p_result) ep where ep.position_id = v_alloc.position_id) then
      perform app.raise_error('allocation_invalid_position', v_alloc.position_id::text);
    end if;
    if v_alloc.fee < 0 or (v_alloc.gross >= 0 and v_alloc.net <> v_alloc.gross - v_alloc.fee)
       or (v_alloc.gross < 0 and (v_alloc.fee <> 0 or v_alloc.net <> v_alloc.gross))
       or sign(v_alloc.gross) * sign(v_res.gross_return_rate) < 0 then
      perform app.raise_error('allocation_inconsistent', v_alloc.position_id::text);
    end if;
    select * into v_pos from app.investment_positions where id = v_alloc.position_id for update;

    if v_alloc.net > 0 then
      v_entries := v_entries || jsonb_build_array(app.entry(app.user_account(v_pos.user_id, v_res.asset_code, 'invested'), 'credit', v_alloc.net));
    elsif v_alloc.net < 0 then
      if app.position_value(v_pos.id) + v_alloc.net < 0 then
        perform app.raise_error('allocation_exceeds_position_value', v_pos.id::text);
      end if;
      v_entries := v_entries || jsonb_build_array(app.entry(app.user_account(v_pos.user_id, v_res.asset_code, 'invested'), 'debit', -v_alloc.net));
    end if;
    v_total_gross := v_total_gross + v_alloc.gross;
    v_total_fee := v_total_fee + v_alloc.fee;
    v_total_net := v_total_net + v_alloc.net;
  end loop;

  if v_total_net > 0 then
    v_entries := v_entries || jsonb_build_array(app.entry(app.system_account(v_res.asset_code, 'strategy'), 'debit', v_total_gross));
    if v_total_fee > 0 then
      v_entries := v_entries || jsonb_build_array(app.entry(app.system_account(v_res.asset_code, 'fee_revenue'), 'credit', v_total_fee));
    end if;
  elsif v_total_net < 0 then
    v_entries := v_entries || jsonb_build_array(app.entry(app.system_account(v_res.asset_code, 'strategy'), 'credit', -v_total_net));
  end if;

  if jsonb_array_length(v_entries) >= 2 then
    v_tx := app.post_ledger_transaction(
      'investment_result', v_res.asset_code, 'investment-result:' || v_res.id, 'admin', 'investment_result', v_res.id,
      v_entries, 'Realised result ' || to_char(v_res.period_start, 'YYYY-MM-DD') || '..' || to_char(v_res.period_end, 'YYYY-MM-DD'),
      jsonb_build_object('rate', v_res.gross_return_rate::text, 'evidence', v_res.evidence_reference), p_actor);
  end if;

  insert into app.investment_events (position_id, event_type, result_id, gross_amount, fee_amount, net_amount, ledger_transaction_id)
  select (a ->> 'positionId')::uuid, 'result', p_result, (a ->> 'gross')::numeric, (a ->> 'fee')::numeric,
         (a ->> 'net')::numeric, v_tx
  from jsonb_array_elements(p_allocations) a;

  update app.investment_results
  set status = 'posted', posted_at = now(), ledger_transaction_id = v_tx, positions_count = v_given,
      total_gross = v_total_gross, total_fee = v_total_fee
  where id = p_result returning * into v_res;

  update app.investment_products set results_through = greatest(coalesce(results_through, v_res.period_end), v_res.period_end)
  where id = v_res.product_id;

  for v_alloc in
    select distinct p.user_id, p.reference, (a ->> 'net')::numeric as net, p.asset_code
    from jsonb_array_elements(p_allocations) a
    join app.investment_positions p on p.id = (a ->> 'positionId')::uuid
  loop
    perform app.notify(v_alloc.user_id, 'investment_result_posted',
      jsonb_build_object('reference', v_alloc.reference, 'amount', v_alloc.net::text, 'asset', v_alloc.asset_code),
      '/earnings');
  end loop;

  -- Positions that were only waiting for this result can now be released.
  for v_released in
    select p.id from app.investment_positions p
    join app.investment_products pr on pr.id = p.product_id
    where p.product_id = v_res.product_id and p.status = 'awaiting_settlement' and pr.results_through >= p.maturity_at
  loop
    perform app.release_position(v_released.id, 'job', p_actor, false);
  end loop;

  return v_res;
end;
$$;
