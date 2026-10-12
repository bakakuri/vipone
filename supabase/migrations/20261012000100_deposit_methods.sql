-- Ledgerline — deposit methods managed by staff, and deposits reported by users
--
-- Besides the automatic flow (personal addresses + signed blockchain events),
-- an operator can publish deposit methods: an address (optionally with memo),
-- a QR image and instructions per asset/network. Users then report a payment
-- (amount, optional transaction hash). A reported deposit is only a claim:
-- nothing is credited until a staff member has checked the payment on the
-- blockchain and approves it with the confirmed amount and transaction hash.
-- One transaction hash can be credited once (unique index on deposits).

create table app.deposit_methods (
  id uuid primary key default gen_random_uuid(),
  asset_code text not null references app.assets(code),
  network_code text not null references app.networks(code),
  label text check (label is null or char_length(label) <= 80),
  address text not null check (char_length(address) between 10 and 200),
  memo text check (memo is null or char_length(memo) <= 100),
  qr_image text check (qr_image is null or (qr_image ~ '^data:image/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$' and char_length(qr_image) <= 700000)),
  instructions jsonb not null default '{}'::jsonb check (jsonb_typeof(instructions) = 'object'),
  min_amount numeric(38, 18) check (min_amount is null or min_amount > 0),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_by uuid references app.profiles(id),
  updated_by uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (asset_code, network_code)
);
create trigger deposit_methods_touch before update on app.deposit_methods for each row execute function app.touch_updated_at();

alter table app.deposit_methods enable row level security;
grant select on app.deposit_methods to authenticated;
create policy deposit_methods_read on app.deposit_methods for select to authenticated using (is_active);

alter table app.deposits
  add column source text not null default 'chain' check (source in ('chain', 'manual')),
  add column method_id uuid references app.deposit_methods(id),
  add column claimed_amount numeric(38, 18) check (claimed_amount is null or claimed_amount > 0),
  add column user_note text check (user_note is null or char_length(user_note) <= 500);
create index deposits_manual_review_idx on app.deposits (created_at desc) where source = 'manual' and status = 'under_review';

-- A user reports a payment made to a published method.
create or replace function app.submit_manual_deposit(p_user uuid, p_method uuid, p_amount numeric, p_tx_hash text, p_note text)
returns app.deposits
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_method app.deposit_methods;
  v_hash text := nullif(btrim(coalesce(p_tx_hash, '')), '');
  v_row app.deposits;
begin
  if not app.setting_bool('deposits.enabled', true) then
    perform app.raise_error('feature_unavailable', 'deposits');
  end if;
  select * into v_method from app.deposit_methods where id = p_method and is_active;
  if not found then
    perform app.raise_error('deposit_method_unavailable');
  end if;
  if p_amount is null or p_amount <= 0 then
    perform app.raise_error('amount_positive');
  end if;
  if v_method.min_amount is not null and p_amount < v_method.min_amount then
    perform app.raise_error('amount_below_minimum', v_method.min_amount::text);
  end if;
  -- Serialise per user and cap open reports, so the review queue cannot be flooded.
  perform 1 from app.profiles where id = p_user for update;
  if (select count(*) from app.deposits where user_id = p_user and source = 'manual' and status = 'under_review') >= 5 then
    perform app.raise_error('too_many_pending');
  end if;
  if v_hash is not null and exists (select 1 from app.deposits where network_code = v_method.network_code and tx_hash = v_hash) then
    perform app.raise_error('duplicate_transaction');
  end if;

  insert into app.deposits (user_id, asset_code, network_code, amount, claimed_amount, tx_hash, log_index,
                            confirmations, required_confirmations, status, status_reason, source, method_id, user_note)
  values (p_user, v_method.asset_code, v_method.network_code, p_amount, p_amount, v_hash,
          case when v_hash is null then null else 0 end,
          0, 1, 'under_review', 'manual_report', 'manual', v_method.id, nullif(btrim(coalesce(p_note, '')), ''))
  returning * into v_row;

  perform app.notify(p_user, 'deposit_under_review',
    jsonb_build_object('reference', v_row.reference, 'amount', p_amount::text, 'asset', v_row.asset_code), '/deposit');
  return v_row;
end;
$$;

-- Staff approve a reported deposit after checking the payment on chain. The
-- confirmed amount may differ from the reported one; a transaction hash is
-- required (and can be credited only once). Crediting itself is done by
-- app.credit_deposit, exactly like an automatic deposit (ledger + 7-day hold).
create or replace function app.approve_manual_deposit(p_deposit uuid, p_actor uuid, p_amount numeric, p_tx_hash text)
returns app.deposits
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_dep app.deposits;
  v_hash text;
begin
  select * into v_dep from app.deposits where id = p_deposit for update;
  if not found then
    perform app.raise_error('not_found', 'deposit');
  end if;
  if v_dep.source <> 'manual' or v_dep.status <> 'under_review' then
    perform app.raise_error('invalid_status_transition', 'only reported deposits under review can be approved');
  end if;
  if p_amount is not null and p_amount <= 0 then
    perform app.raise_error('amount_positive');
  end if;
  v_hash := coalesce(nullif(btrim(coalesce(p_tx_hash, '')), ''), v_dep.tx_hash);
  if v_hash is null then
    perform app.raise_error('tx_hash_required');
  end if;
  if exists (select 1 from app.deposits where network_code = v_dep.network_code and tx_hash = v_hash and id <> v_dep.id) then
    perform app.raise_error('duplicate_transaction');
  end if;

  update app.deposits
  set amount = coalesce(p_amount, amount), tx_hash = v_hash, log_index = coalesce(log_index, 0),
      confirmations = required_confirmations, status = 'confirmed', confirmed_at = now(),
      status_reason = null, risk_result = 'clear', reviewed_by = p_actor, reviewed_at = now()
  where id = v_dep.id
  returning * into v_dep;
  return v_dep;
end;
$$;

insert into app.system_settings (key, value, description, approval_policy) values
  ('withdrawal.address_email_confirmation', 'false', 'Send an email code to confirm each new withdrawal address. Off: new addresses are confirmed at once and only wait out the cooldown. Turn on once outgoing email works.', 'none'),
  ('deposits.page_notice', '{}', 'Text shown at the top of the deposit page, per language ({"en": "...", "ru": "...", "ar": "..."}).', 'none')
on conflict (key) do nothing;
