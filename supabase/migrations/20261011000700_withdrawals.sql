-- Ledgerline — withdrawal wallets and withdrawal requests
--
-- Users register external addresses (never private keys). A new address must
-- be confirmed with an emailed code and then waits out a cooldown before it can
-- receive funds. Creating a request moves the gross amount from `available` to
-- `withdrawal_hold` atomically, so the same funds can never be requested twice.
-- A request becomes `completed` only with an on-chain transaction hash that is
-- confirmed by a chain event or verified by a second staff member.

create table app.withdrawal_wallets (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  label text not null check (char_length(label) between 1 and 60),
  asset_code text not null references app.assets(code),
  network_code text not null references app.networks(code),
  address text not null check (char_length(address) between 20 and 128),
  memo text check (memo is null or char_length(memo) between 1 and 64),
  status text not null default 'pending_confirmation' check (status in ('pending_confirmation', 'active', 'removed')),
  is_default boolean not null default false,
  confirmed_at timestamptz,
  usable_from timestamptz,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (asset_code, network_code) references app.asset_networks (asset_code, network_code),
  check (status <> 'active' or (confirmed_at is not null and usable_from is not null)),
  check (not is_default or status = 'active')
);
create unique index withdrawal_wallets_address_uq on app.withdrawal_wallets (user_id, network_code, address, coalesce(memo, ''))
  where status <> 'removed';
create unique index withdrawal_wallets_default_uq on app.withdrawal_wallets (user_id, asset_code, network_code)
  where is_default;
create index withdrawal_wallets_user_idx on app.withdrawal_wallets (user_id, created_at desc);
create trigger withdrawal_wallets_touch before update on app.withdrawal_wallets for each row execute function app.touch_updated_at();

create table app.wallet_address_history (
  id bigint generated always as identity primary key,
  wallet_id uuid not null references app.withdrawal_wallets(id),
  user_id uuid not null references app.profiles(id),
  event text not null check (event in ('added', 'confirmed', 'default_set', 'label_changed', 'removed')),
  details jsonb not null default '{}'::jsonb,
  ip_hash text,
  created_at timestamptz not null default now()
);
create index wallet_address_history_user_idx on app.wallet_address_history (user_id, created_at desc);
create trigger wallet_address_history_immutable before update or delete on app.wallet_address_history
  for each row execute function app.forbid_mutation();

create or replace function app.validate_address(p_network text, p_address text, p_memo text)
returns void
language plpgsql
stable
as $$
declare
  v_net app.networks;
begin
  select * into v_net from app.networks where code = p_network and is_active;
  if not found then
    perform app.raise_error('network_not_available', p_network);
  end if;
  if p_address !~ v_net.address_pattern then
    perform app.raise_error('invalid_address_format', p_network);
  end if;
  if v_net.memo_required and (p_memo is null or p_memo !~ v_net.memo_pattern) then
    perform app.raise_error('memo_required', p_network);
  end if;
  if not v_net.memo_required and p_memo is not null and v_net.memo_pattern is not null and p_memo !~ v_net.memo_pattern then
    perform app.raise_error('invalid_memo_format', p_network);
  end if;
end;
$$;

create or replace function app.add_withdrawal_wallet(
  p_user uuid, p_label text, p_asset text, p_network text, p_address text, p_memo text, p_ip_hash text
)
returns app.withdrawal_wallets
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.withdrawal_wallets;
begin
  perform app.validate_address(p_network, p_address, nullif(p_memo, ''));
  if not exists (select 1 from app.asset_networks where asset_code = p_asset and network_code = p_network and withdrawal_enabled) then
    perform app.raise_error('asset_network_not_supported', p_asset || '/' || p_network);
  end if;
  if (select count(*) from app.withdrawal_wallets where user_id = p_user and status <> 'removed') >= 20 then
    perform app.raise_error('too_many_wallets');
  end if;
  begin
    insert into app.withdrawal_wallets (user_id, label, asset_code, network_code, address, memo)
    values (p_user, p_label, p_asset, p_network, p_address, nullif(p_memo, ''))
    returning * into v_row;
  exception when unique_violation then
    perform app.raise_error('wallet_already_exists');
  end;
  insert into app.wallet_address_history (wallet_id, user_id, event, details, ip_hash)
  values (v_row.id, p_user, 'added', jsonb_build_object('network', p_network, 'address', p_address, 'memo', p_memo), p_ip_hash);
  return v_row;
end;
$$;

create or replace function app.confirm_withdrawal_wallet(p_user uuid, p_wallet uuid, p_ip_hash text)
returns app.withdrawal_wallets
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.withdrawal_wallets;
  v_cooldown numeric := app.setting_numeric('withdrawal.new_address_cooldown_hours', 24);
  v_has_default boolean;
begin
  select * into v_row from app.withdrawal_wallets where id = p_wallet and user_id = p_user for update;
  if not found then
    perform app.raise_error('not_found', 'wallet');
  end if;
  if v_row.status <> 'pending_confirmation' then
    perform app.raise_error('wallet_not_pending');
  end if;
  select exists (select 1 from app.withdrawal_wallets where user_id = p_user and asset_code = v_row.asset_code
                 and network_code = v_row.network_code and is_default) into v_has_default;
  update app.withdrawal_wallets
  set status = 'active', confirmed_at = now(),
      usable_from = now() + make_interval(secs => (v_cooldown * 3600)::int),
      is_default = not v_has_default
  where id = p_wallet
  returning * into v_row;
  insert into app.wallet_address_history (wallet_id, user_id, event, details, ip_hash)
  values (p_wallet, p_user, 'confirmed', jsonb_build_object('usableFrom', v_row.usable_from), p_ip_hash);
  return v_row;
end;
$$;

create or replace function app.set_default_withdrawal_wallet(p_user uuid, p_wallet uuid)
returns app.withdrawal_wallets
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.withdrawal_wallets;
begin
  select * into v_row from app.withdrawal_wallets where id = p_wallet and user_id = p_user and status = 'active' for update;
  if not found then
    perform app.raise_error('not_found', 'wallet');
  end if;
  update app.withdrawal_wallets set is_default = false
  where user_id = p_user and asset_code = v_row.asset_code and network_code = v_row.network_code and is_default and id <> p_wallet;
  update app.withdrawal_wallets set is_default = true where id = p_wallet returning * into v_row;
  insert into app.wallet_address_history (wallet_id, user_id, event) values (p_wallet, p_user, 'default_set');
  return v_row;
end;
$$;

create or replace function app.remove_withdrawal_wallet(p_user uuid, p_wallet uuid, p_ip_hash text)
returns app.withdrawal_wallets
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.withdrawal_wallets;
begin
  select * into v_row from app.withdrawal_wallets where id = p_wallet and user_id = p_user and status <> 'removed' for update;
  if not found then
    perform app.raise_error('not_found', 'wallet');
  end if;
  if exists (select 1 from app.withdrawal_requests where wallet_id = p_wallet
             and status in ('pending', 'under_review', 'approved', 'processing')) then
    perform app.raise_error('wallet_in_use');
  end if;
  update app.withdrawal_wallets set status = 'removed', removed_at = now(), is_default = false
  where id = p_wallet returning * into v_row;
  insert into app.wallet_address_history (wallet_id, user_id, event, ip_hash) values (p_wallet, p_user, 'removed', p_ip_hash);
  return v_row;
end;
$$;

-- Quotes: the backend computes fees once (server/modules/withdrawals/
-- calculate-withdrawal-fee.js) and stores them here. The user confirms the
-- quote; the request copies its numbers. Quotes expire quickly.
create table app.withdrawal_quotes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  wallet_id uuid not null references app.withdrawal_wallets(id),
  asset_code text not null references app.assets(code),
  network_code text not null references app.networks(code),
  amount numeric(38, 18) not null check (amount > 0),
  platform_fee numeric(38, 18) not null check (platform_fee >= 0),
  network_fee numeric(38, 18) not null check (network_fee >= 0),
  net_amount numeric(38, 18) not null check (net_amount > 0),
  fee_rule_id uuid references app.fee_rules(id),
  fee_rate numeric(12, 8) not null,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now(),
  check (amount = platform_fee + network_fee + net_amount)
);
create index withdrawal_quotes_user_idx on app.withdrawal_quotes (user_id, created_at desc);

create table app.withdrawal_requests (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default app.new_reference('WDR'),
  user_id uuid not null references app.profiles(id),
  wallet_id uuid not null references app.withdrawal_wallets(id),
  quote_id uuid not null unique references app.withdrawal_quotes(id),
  asset_code text not null references app.assets(code),
  network_code text not null references app.networks(code),
  address text not null,
  memo text,
  amount numeric(38, 18) not null check (amount > 0),
  platform_fee numeric(38, 18) not null check (platform_fee >= 0),
  network_fee numeric(38, 18) not null check (network_fee >= 0),
  net_amount numeric(38, 18) not null check (net_amount > 0),
  fee_rule_id uuid references app.fee_rules(id),
  status text not null check (status in (
    'pending', 'under_review', 'approved', 'processing', 'completed', 'rejected', 'failed', 'cancelled'
  )),
  status_reason text,
  requires_dual_approval boolean not null default false,
  reviewed_by uuid references app.profiles(id),
  approved_by uuid references app.profiles(id),
  approved_at timestamptz,
  second_approved_by uuid references app.profiles(id),
  second_approved_at timestamptz,
  processed_by uuid references app.profiles(id),
  tx_hash text,
  broadcast_at timestamptz,
  actual_network_fee numeric(38, 18) check (actual_network_fee is null or actual_network_fee >= 0),
  completion_source text check (completion_source in ('chain_event', 'manual_verification')),
  completion_verified_by uuid references app.profiles(id),
  completed_at timestamptz,
  hold_transaction_id uuid not null references app.ledger_transactions(id),
  settlement_transaction_id uuid references app.ledger_transactions(id),
  release_transaction_id uuid references app.ledger_transactions(id),
  idempotency_key text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, idempotency_key),
  check (amount = platform_fee + network_fee + net_amount),
  check (second_approved_by is null or second_approved_by <> approved_by),
  check (status <> 'completed' or (tx_hash is not null and settlement_transaction_id is not null and completion_source is not null)),
  check (status not in ('rejected', 'failed', 'cancelled') or release_transaction_id is not null),
  check (completion_verified_by is null or completion_verified_by <> processed_by)
);
create unique index withdrawal_requests_tx_uq on app.withdrawal_requests (network_code, tx_hash) where tx_hash is not null;
create index withdrawal_requests_user_idx on app.withdrawal_requests (user_id, created_at desc);
create index withdrawal_requests_status_idx on app.withdrawal_requests (status, created_at);
create trigger withdrawal_requests_touch before update on app.withdrawal_requests for each row execute function app.touch_updated_at();

insert into app.status_transitions (entity, from_status, to_status) values
  ('withdrawal', '_new', 'pending'),
  ('withdrawal', 'pending', 'under_review'),
  ('withdrawal', 'pending', 'approved'),
  ('withdrawal', 'pending', 'rejected'),
  ('withdrawal', 'pending', 'cancelled'),
  ('withdrawal', 'under_review', 'approved'),
  ('withdrawal', 'under_review', 'rejected'),
  ('withdrawal', 'approved', 'processing'),
  ('withdrawal', 'approved', 'rejected'),
  ('withdrawal', 'processing', 'completed'),
  ('withdrawal', 'processing', 'failed');
create trigger withdrawal_requests_status before insert or update on app.withdrawal_requests
  for each row execute function app.enforce_status_transition('withdrawal');

create or replace function app.withdrawal_status_signal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.tx_hash is distinct from old.tx_hash then
    perform app.emit_event('user:' || new.user_id, 'withdrawal.updated', jsonb_build_object('id', new.id, 'status', new.status));
    perform app.emit_event('admin:ops', 'withdrawal.updated', jsonb_build_object('id', new.id, 'status', new.status));
  end if;
  return null;
end;
$$;
create trigger withdrawal_requests_signal after insert or update on app.withdrawal_requests
  for each row execute function app.withdrawal_status_signal();

-- Creating a request -------------------------------------------------------------
create or replace function app.create_withdrawal(p_user uuid, p_quote uuid, p_idempotency_key text)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_existing app.withdrawal_requests;
  v_quote app.withdrawal_quotes;
  v_wallet app.withdrawal_wallets;
  v_profile app.profiles;
  v_available_account uuid;
  v_available numeric;
  v_withdrawable numeric;
  v_daily_limit numeric;
  v_used_24h numeric;
  v_threshold numeric;
  v_paused jsonb;
  v_request app.withdrawal_requests;
  v_request_id uuid := gen_random_uuid();
  v_tx uuid;
begin
  select * into v_existing from app.withdrawal_requests where user_id = p_user and idempotency_key = p_idempotency_key;
  if found then
    return v_existing;
  end if;

  select * into v_profile from app.profiles where id = p_user for update;
  if v_profile.status <> 'active' then
    perform app.raise_error('account_restricted', v_profile.status);
  end if;

  if not app.setting_bool('withdrawals.enabled', true) then
    perform app.raise_error('withdrawals_paused');
  end if;

  select * into v_quote from app.withdrawal_quotes where id = p_quote for update;
  if not found or v_quote.user_id <> p_user then
    perform app.raise_error('not_found', 'quote');
  end if;
  if v_quote.used_at is not null then
    perform app.raise_error('quote_already_used');
  end if;
  if v_quote.expires_at <= now() then
    perform app.raise_error('quote_expired');
  end if;

  v_paused := coalesce(app.setting('withdrawals.paused_assets'), '[]'::jsonb);
  if v_paused ? v_quote.asset_code then
    perform app.raise_error('withdrawals_paused', v_quote.asset_code);
  end if;
  if not exists (select 1 from app.asset_networks where asset_code = v_quote.asset_code
                 and network_code = v_quote.network_code and withdrawal_enabled) then
    perform app.raise_error('asset_network_not_supported');
  end if;

  select * into v_wallet from app.withdrawal_wallets where id = v_quote.wallet_id and user_id = p_user;
  if not found or v_wallet.status <> 'active' then
    perform app.raise_error('wallet_not_active');
  end if;
  if v_wallet.usable_from > now() then
    perform app.raise_error('wallet_cooldown', v_wallet.usable_from::text);
  end if;

  -- Lock the available balance first, then evaluate the withdrawable amount.
  v_available_account := app.user_account(p_user, v_quote.asset_code, 'available');
  select balance into v_available from app.ledger_balances where account_id = v_available_account for update;
  v_withdrawable := greatest(v_available - app.active_hold_amount(p_user, v_quote.asset_code), 0);
  if v_withdrawable < v_quote.amount then
    perform app.raise_error('insufficient_withdrawable_balance', v_withdrawable::text);
  end if;

  v_daily_limit := app.setting_asset_numeric('withdrawal.daily_limit', v_quote.asset_code);
  if v_daily_limit is not null then
    select coalesce(sum(amount), 0) into v_used_24h from app.withdrawal_requests
    where user_id = p_user and asset_code = v_quote.asset_code and created_at > now() - interval '24 hours'
      and status not in ('rejected', 'cancelled', 'failed');
    if v_used_24h + v_quote.amount > v_daily_limit then
      perform app.raise_error('daily_limit_exceeded', greatest(v_daily_limit - v_used_24h, 0)::text);
    end if;
  end if;

  v_threshold := app.setting_asset_numeric('withdrawal.dual_approval_threshold', v_quote.asset_code);

  v_tx := app.post_ledger_transaction(
    'withdrawal_hold', v_quote.asset_code, 'withdrawal-hold:' || p_user || ':' || p_idempotency_key, 'user',
    'withdrawal_request', v_request_id,
    jsonb_build_array(
      app.entry(v_available_account, 'debit', v_quote.amount),
      app.entry(app.user_account(p_user, v_quote.asset_code, 'withdrawal_hold'), 'credit', v_quote.amount)
    ),
    'Withdrawal requested', jsonb_build_object('quoteId', v_quote.id), p_user);

  insert into app.withdrawal_requests (
    id, user_id, wallet_id, quote_id, asset_code, network_code, address, memo, amount, platform_fee, network_fee,
    net_amount, fee_rule_id, status, requires_dual_approval, hold_transaction_id, idempotency_key
  ) values (
    v_request_id, p_user, v_wallet.id, v_quote.id, v_quote.asset_code, v_quote.network_code, v_wallet.address, v_wallet.memo,
    v_quote.amount, v_quote.platform_fee, v_quote.network_fee, v_quote.net_amount, v_quote.fee_rule_id, 'pending',
    v_threshold is not null and v_quote.amount >= v_threshold, v_tx, p_idempotency_key
  )
  returning * into v_request;

  update app.withdrawal_quotes set used_at = now() where id = v_quote.id;

  perform app.notify(p_user, 'withdrawal_created',
    jsonb_build_object('reference', v_request.reference, 'amount', v_request.amount::text, 'asset', v_request.asset_code),
    '/withdrawals');
  return v_request;
end;
$$;

-- Releasing a hold (reject / cancel / fail) ------------------------------------------
create or replace function app.release_withdrawal(p_request uuid, p_new_status text, p_actor uuid, p_reason text, p_source text)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
  v_tx uuid;
begin
  select * into v_req from app.withdrawal_requests where id = p_request for update;
  if not found then
    perform app.raise_error('not_found', 'withdrawal');
  end if;
  if p_new_status not in ('rejected', 'cancelled', 'failed') then
    perform app.raise_error('invalid_status_transition', p_new_status);
  end if;

  v_tx := app.post_ledger_transaction(
    'withdrawal_release', v_req.asset_code, 'withdrawal-release:' || v_req.id, p_source, 'withdrawal_request', v_req.id,
    jsonb_build_array(
      app.entry(app.user_account(v_req.user_id, v_req.asset_code, 'withdrawal_hold'), 'debit', v_req.amount),
      app.entry(app.user_account(v_req.user_id, v_req.asset_code, 'available'), 'credit', v_req.amount)
    ),
    'Withdrawal ' || v_req.reference || ' ' || p_new_status, jsonb_build_object('reason', p_reason), p_actor);

  update app.withdrawal_requests
  set status = p_new_status, status_reason = p_reason, release_transaction_id = v_tx,
      reviewed_by = case when p_source = 'admin' then p_actor else reviewed_by end
  where id = v_req.id
  returning * into v_req;

  perform app.notify(v_req.user_id, 'withdrawal_' || p_new_status,
    jsonb_build_object('reference', v_req.reference, 'amount', v_req.amount::text, 'asset', v_req.asset_code,
                       'reason', p_reason),
    '/withdrawals');
  return v_req;
end;
$$;

create or replace function app.cancel_withdrawal(p_request uuid, p_user uuid)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
begin
  select * into v_req from app.withdrawal_requests where id = p_request and user_id = p_user for update;
  if not found then
    perform app.raise_error('not_found', 'withdrawal');
  end if;
  if v_req.status <> 'pending' then
    perform app.raise_error('withdrawal_not_cancellable', v_req.status);
  end if;
  return app.release_withdrawal(p_request, 'cancelled', p_user, 'cancelled_by_user', 'user');
end;
$$;

create or replace function app.review_withdrawal(p_request uuid, p_actor uuid, p_reason text)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
begin
  update app.withdrawal_requests set status = 'under_review', status_reason = p_reason, reviewed_by = p_actor
  where id = p_request and status = 'pending'
  returning * into v_req;
  if not found then
    perform app.raise_error('invalid_status_transition', 'only pending requests can be moved to review');
  end if;
  return v_req;
end;
$$;

create or replace function app.approve_withdrawal(p_request uuid, p_actor uuid)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
begin
  select * into v_req from app.withdrawal_requests where id = p_request for update;
  if not found then
    perform app.raise_error('not_found', 'withdrawal');
  end if;
  if v_req.status not in ('pending', 'under_review') then
    perform app.raise_error('invalid_status_transition', v_req.status || ' cannot be approved');
  end if;
  if v_req.user_id = p_actor then
    perform app.raise_error('cannot_approve_own_request');
  end if;

  if v_req.requires_dual_approval then
    if v_req.approved_by is null then
      update app.withdrawal_requests
      set approved_by = p_actor, approved_at = now(), status = 'under_review',
          status_reason = 'awaiting_second_approval'
      where id = p_request returning * into v_req;
      return v_req;
    end if;
    if v_req.approved_by = p_actor then
      perform app.raise_error('second_approver_required');
    end if;
    update app.withdrawal_requests
    set second_approved_by = p_actor, second_approved_at = now(), status = 'approved', status_reason = null
    where id = p_request returning * into v_req;
  else
    update app.withdrawal_requests
    set approved_by = p_actor, approved_at = now(), status = 'approved', status_reason = null
    where id = p_request returning * into v_req;
  end if;

  perform app.notify(v_req.user_id, 'withdrawal_approved',
    jsonb_build_object('reference', v_req.reference, 'amount', v_req.amount::text, 'asset', v_req.asset_code),
    '/withdrawals');
  return v_req;
end;
$$;

create or replace function app.start_withdrawal_processing(p_request uuid, p_actor uuid)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
begin
  update app.withdrawal_requests set status = 'processing', processed_by = p_actor
  where id = p_request and status = 'approved'
  returning * into v_req;
  if not found then
    perform app.raise_error('invalid_status_transition', 'only approved requests can be processed');
  end if;
  return v_req;
end;
$$;

create or replace function app.record_withdrawal_broadcast(p_request uuid, p_tx_hash text, p_actor uuid)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
begin
  select * into v_req from app.withdrawal_requests where id = p_request for update;
  if not found or v_req.status <> 'processing' then
    perform app.raise_error('invalid_status_transition', 'transaction hashes are recorded on processing requests');
  end if;
  if v_req.tx_hash is not null and v_req.tx_hash <> p_tx_hash then
    perform app.raise_error('tx_hash_already_recorded');
  end if;
  begin
    update app.withdrawal_requests set tx_hash = p_tx_hash, broadcast_at = coalesce(broadcast_at, now()),
           processed_by = coalesce(processed_by, p_actor)
    where id = p_request returning * into v_req;
  exception when unique_violation then
    perform app.raise_error('tx_hash_in_use');
  end;
  return v_req;
end;
$$;

-- Settlement: only with a recorded transaction hash, confirmed either by a
-- chain event or by a staff member other than the one who broadcast it.
create or replace function app.complete_withdrawal(
  p_request uuid, p_actor uuid, p_actual_network_fee numeric, p_source text
)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
  v_entries jsonb;
  v_settlement uuid;
  v_actual numeric;
begin
  select * into v_req from app.withdrawal_requests where id = p_request for update;
  if not found then
    perform app.raise_error('not_found', 'withdrawal');
  end if;
  if v_req.status = 'completed' then
    return v_req;
  end if;
  if v_req.status <> 'processing' then
    perform app.raise_error('invalid_status_transition', v_req.status || ' cannot be completed');
  end if;
  if v_req.tx_hash is null then
    perform app.raise_error('tx_hash_required');
  end if;
  if p_source not in ('chain_event', 'manual_verification') then
    perform app.raise_error('invalid_completion_source');
  end if;
  if p_source = 'manual_verification' and (p_actor is null or p_actor = v_req.processed_by) then
    perform app.raise_error('independent_verifier_required');
  end if;

  v_entries := jsonb_build_array(
    app.entry(app.user_account(v_req.user_id, v_req.asset_code, 'withdrawal_hold'), 'debit', v_req.amount),
    app.entry(app.system_account(v_req.asset_code, 'custody'), 'credit', v_req.net_amount)
  );
  if v_req.platform_fee > 0 then
    v_entries := v_entries || jsonb_build_array(app.entry(app.system_account(v_req.asset_code, 'fee_revenue'), 'credit', v_req.platform_fee));
  end if;
  if v_req.network_fee > 0 then
    v_entries := v_entries || jsonb_build_array(app.entry(app.system_account(v_req.asset_code, 'network_fee_recovery'), 'credit', v_req.network_fee));
  end if;

  v_settlement := app.post_ledger_transaction(
    'withdrawal_settlement', v_req.asset_code, 'withdrawal-settlement:' || v_req.id, case when p_source = 'chain_event' then 'webhook' else 'admin' end,
    'withdrawal_request', v_req.id, v_entries, 'Withdrawal ' || v_req.reference || ' sent',
    jsonb_build_object('txHash', v_req.tx_hash), p_actor);

  v_actual := coalesce(p_actual_network_fee, v_req.network_fee);
  if v_actual > 0 then
    perform app.post_ledger_transaction(
      'network_fee', v_req.asset_code, 'withdrawal-network-fee:' || v_req.id, 'system', 'withdrawal_request', v_req.id,
      jsonb_build_array(
        app.entry(app.system_account(v_req.asset_code, 'network_fee_expense'), 'debit', v_actual),
        app.entry(app.system_account(v_req.asset_code, 'custody'), 'credit', v_actual)
      ),
      'Network fee for ' || v_req.reference, jsonb_build_object('txHash', v_req.tx_hash), p_actor);
  end if;

  update app.withdrawal_requests
  set status = 'completed', completed_at = now(), settlement_transaction_id = v_settlement,
      actual_network_fee = v_actual, completion_source = p_source,
      completion_verified_by = case when p_source = 'manual_verification' then p_actor end
  where id = p_request returning * into v_req;

  perform app.notify(v_req.user_id, 'withdrawal_completed',
    jsonb_build_object('reference', v_req.reference, 'amount', v_req.net_amount::text, 'asset', v_req.asset_code,
                       'txHash', v_req.tx_hash),
    '/withdrawals');
  return v_req;
end;
$$;

-- Failing a request returns the funds only when staff explicitly confirm that
-- nothing left the platform wallet.
create or replace function app.fail_withdrawal(p_request uuid, p_actor uuid, p_reason text, p_funds_not_sent boolean)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
begin
  select * into v_req from app.withdrawal_requests where id = p_request for update;
  if not found or v_req.status <> 'processing' then
    perform app.raise_error('invalid_status_transition', 'only processing requests can fail');
  end if;
  if not coalesce(p_funds_not_sent, false) then
    perform app.raise_error('confirm_funds_not_sent');
  end if;
  return app.release_withdrawal(p_request, 'failed', p_actor, p_reason, 'admin');
end;
$$;

create or replace function app.reject_withdrawal(p_request uuid, p_actor uuid, p_reason text)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
begin
  select * into v_req from app.withdrawal_requests where id = p_request for update;
  if not found then
    perform app.raise_error('not_found', 'withdrawal');
  end if;
  if v_req.status not in ('pending', 'under_review', 'approved') then
    perform app.raise_error('invalid_status_transition', v_req.status || ' cannot be rejected');
  end if;
  return app.release_withdrawal(p_request, 'rejected', p_actor, p_reason, 'admin');
end;
$$;

-- Outgoing chain events confirm a broadcast withdrawal.
create or replace function app.apply_outgoing_event(p_event_id uuid)
returns table (withdrawal_id uuid, withdrawal_status text, outcome text)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  e app.blockchain_events;
  v_req app.withdrawal_requests;
  v_required int;
  v_outcome text;
begin
  select * into e from app.blockchain_events where id = p_event_id for update;
  if e.direction <> 'outgoing' then
    perform app.raise_error('invalid_event_direction');
  end if;
  select * into v_req from app.withdrawal_requests where network_code = e.network_code and tx_hash = e.tx_hash for update;
  if not found then
    update app.blockchain_events set processed_at = now(), processing_result = 'unknown_withdrawal' where id = e.id;
    perform app.emit_event('admin:ops', 'withdrawal.unknown_outgoing', jsonb_build_object('eventId', e.id));
    return query select null::uuid, null::text, 'unknown_withdrawal'::text;
    return;
  end if;
  select required_confirmations into v_required from app.networks where code = e.network_code;
  if e.reorged then
    v_outcome := 'reorg';
    perform app.emit_event('admin:ops', 'withdrawal.reorg', jsonb_build_object('id', v_req.id));
  elsif v_req.status = 'processing' and e.confirmations >= v_required then
    if e.amount <> v_req.net_amount then
      v_outcome := 'amount_mismatch';
      perform app.emit_event('admin:ops', 'withdrawal.amount_mismatch', jsonb_build_object('id', v_req.id));
    else
      v_req := app.complete_withdrawal(v_req.id, null,
        nullif(e.payload ->> 'networkFee', '')::numeric, 'chain_event');
      v_outcome := 'completed';
    end if;
  else
    v_outcome := 'awaiting_confirmations';
  end if;
  update app.blockchain_events set processed_at = now(), processing_result = v_outcome where id = e.id;
  return query select v_req.id, v_req.status, v_outcome;
end;
$$;
