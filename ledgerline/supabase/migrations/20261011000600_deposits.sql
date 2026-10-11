-- Ledgerline — deposits
--
-- Addresses are never generated from private keys on the server. They come
-- from a pool imported by finance staff (generated offline or by a custody
-- provider). For memo networks a shared address is combined with a unique memo.
--
-- A deposit is credited only after (1) a signed blockchain event was received,
-- (2) the network's required confirmations were reached, (3) screening passed.
-- A transaction id typed by the user never credits anything.

create table app.deposit_address_pool (
  id uuid primary key default gen_random_uuid(),
  network_code text not null references app.networks(code),
  address text not null check (char_length(address) between 20 and 128),
  memo text check (memo is null or char_length(memo) between 1 and 64),
  status text not null default 'available' check (status in ('available', 'assigned', 'retired')),
  source text not null default 'import',
  imported_by uuid references app.profiles(id),
  created_at timestamptz not null default now()
);
create unique index deposit_address_pool_uq on app.deposit_address_pool (network_code, address, coalesce(memo, ''));
create index deposit_address_pool_available_idx on app.deposit_address_pool (network_code, created_at) where status = 'available';

create table app.deposit_addresses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  network_code text not null references app.networks(code),
  address text not null,
  memo text,
  pool_id uuid unique references app.deposit_address_pool(id),
  status text not null default 'active' check (status in ('active', 'retired')),
  created_at timestamptz not null default now(),
  retired_at timestamptz
);
create unique index deposit_addresses_active_uq on app.deposit_addresses (user_id, network_code) where status = 'active';
create unique index deposit_addresses_lookup_uq on app.deposit_addresses (network_code, address, coalesce(memo, ''));

-- Raw, signed provider notifications. One row per delivery; never edited
-- except to record that it was processed.
create table app.blockchain_events (
  id uuid primary key default gen_random_uuid(),
  provider text not null,
  provider_event_id text not null,
  network_code text not null references app.networks(code),
  direction text not null check (direction in ('incoming', 'outgoing')),
  tx_hash text not null check (char_length(tx_hash) between 16 and 128),
  log_index int not null default 0 check (log_index >= 0),
  address text not null,
  memo text,
  from_address text,
  asset_code text references app.assets(code),
  amount numeric(38, 18) not null check (amount > 0),
  confirmations int not null default 0 check (confirmations >= 0),
  block_number bigint,
  block_hash text,
  reorged boolean not null default false,
  payload jsonb not null,
  received_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_result text,
  unique (provider, provider_event_id)
);
create index blockchain_events_chain_idx on app.blockchain_events (network_code, tx_hash, log_index);
create index blockchain_events_unprocessed_idx on app.blockchain_events (received_at) where processed_at is null;

create or replace function app.blockchain_events_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform app.raise_error('immutable_record', 'blockchain events cannot be deleted');
  end if;
  if (to_jsonb(new) - 'processed_at' - 'processing_result') <> (to_jsonb(old) - 'processed_at' - 'processing_result') then
    perform app.raise_error('immutable_record', 'blockchain events are append-only');
  end if;
  return new;
end;
$$;
create trigger blockchain_events_guard_trg before update or delete on app.blockchain_events
  for each row execute function app.blockchain_events_guard();

create table app.deposits (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default app.new_reference('DEP'),
  user_id uuid not null references app.profiles(id),
  asset_code text not null references app.assets(code),
  network_code text not null references app.networks(code),
  deposit_address_id uuid references app.deposit_addresses(id),
  expected_amount numeric(38, 18) check (expected_amount is null or expected_amount > 0),
  amount numeric(38, 18) check (amount is null or amount > 0),
  tx_hash text,
  log_index int,
  from_address text,
  confirmations int not null default 0 check (confirmations >= 0),
  required_confirmations int not null check (required_confirmations > 0),
  status text not null check (status in (
    'created', 'awaiting_payment', 'detected', 'confirming', 'confirmed', 'credited', 'failed', 'rejected', 'under_review'
  )),
  status_reason text,
  risk_result text not null default 'unknown' check (risk_result in ('unknown', 'clear', 'flagged')),
  expires_at timestamptz,
  detected_at timestamptz,
  confirmed_at timestamptz,
  credited_at timestamptz,
  reviewed_by uuid references app.profiles(id),
  reviewed_at timestamptz,
  ledger_transaction_id uuid references app.ledger_transactions(id),
  suspense_transaction_id uuid references app.ledger_transactions(id),
  refund_tx_hash text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (status in ('created', 'awaiting_payment', 'failed') or tx_hash is not null or status = 'under_review'),
  check (tx_hash is null or (amount is not null and log_index is not null)),
  check (status <> 'credited' or (ledger_transaction_id is not null and confirmations >= required_confirmations))
);
create unique index deposits_chain_uq on app.deposits (network_code, tx_hash, log_index) where tx_hash is not null;
create index deposits_user_idx on app.deposits (user_id, created_at desc);
create index deposits_status_idx on app.deposits (status, created_at desc);
create index deposits_open_requests_idx on app.deposits (user_id, network_code, asset_code, created_at)
  where status = 'awaiting_payment';
create trigger deposits_touch before update on app.deposits for each row execute function app.touch_updated_at();

insert into app.status_transitions (entity, from_status, to_status) values
  ('deposit', '_new', 'created'),
  ('deposit', '_new', 'detected'),
  ('deposit', '_new', 'confirming'),
  ('deposit', '_new', 'confirmed'),
  ('deposit', '_new', 'under_review'),
  ('deposit', 'created', 'awaiting_payment'),
  ('deposit', 'created', 'failed'),
  ('deposit', 'awaiting_payment', 'detected'),
  ('deposit', 'awaiting_payment', 'confirming'),
  ('deposit', 'awaiting_payment', 'confirmed'),
  ('deposit', 'awaiting_payment', 'under_review'),
  ('deposit', 'awaiting_payment', 'failed'),
  ('deposit', 'detected', 'confirming'),
  ('deposit', 'detected', 'confirmed'),
  ('deposit', 'detected', 'under_review'),
  ('deposit', 'detected', 'failed'),
  ('deposit', 'confirming', 'confirmed'),
  ('deposit', 'confirming', 'under_review'),
  ('deposit', 'confirming', 'failed'),
  ('deposit', 'confirmed', 'credited'),
  ('deposit', 'confirmed', 'under_review'),
  ('deposit', 'under_review', 'confirming'),
  ('deposit', 'under_review', 'confirmed'),
  ('deposit', 'under_review', 'rejected'),
  ('deposit', 'under_review', 'failed');
create trigger deposits_status before insert or update on app.deposits
  for each row execute function app.enforce_status_transition('deposit');

create or replace function app.deposit_status_signal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status or new.confirmations is distinct from old.confirmations then
    perform app.emit_event('user:' || new.user_id, 'deposit.updated',
      jsonb_build_object('id', new.id, 'status', new.status, 'confirmations', new.confirmations));
    perform app.emit_event('admin:ops', 'deposit.updated', jsonb_build_object('id', new.id, 'status', new.status));
  end if;
  return null;
end;
$$;
create trigger deposits_signal after insert or update on app.deposits
  for each row execute function app.deposit_status_signal();

-- Address assignment ----------------------------------------------------------
create or replace function app.assign_deposit_address(p_user uuid, p_network text)
returns app.deposit_addresses
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_existing app.deposit_addresses;
  v_pool app.deposit_address_pool;
  v_row app.deposit_addresses;
begin
  -- Serialise per user so two tabs cannot claim two pool addresses.
  perform 1 from app.profiles where id = p_user for update;

  select * into v_existing from app.deposit_addresses
  where user_id = p_user and network_code = p_network and status = 'active';
  if found then
    return v_existing;
  end if;

  if not exists (select 1 from app.networks where code = p_network and is_active) then
    perform app.raise_error('network_not_available', p_network);
  end if;

  select * into v_pool from app.deposit_address_pool
  where network_code = p_network and status = 'available'
  order by created_at
  limit 1
  for update skip locked;
  if not found then
    perform app.emit_event('admin:ops', 'address_pool.empty', jsonb_build_object('network', p_network));
    perform app.raise_error('deposit_address_unavailable', p_network);
  end if;

  update app.deposit_address_pool set status = 'assigned' where id = v_pool.id;

  insert into app.deposit_addresses (user_id, network_code, address, memo, pool_id)
  values (p_user, p_network, v_pool.address, v_pool.memo, v_pool.id)
  returning * into v_row;
  return v_row;
end;
$$;

-- Deposit request (status Created -> Awaiting Payment) -------------------------
create or replace function app.create_deposit_request(
  p_user uuid, p_asset text, p_network text, p_expected_amount numeric, p_ttl_hours int
)
returns app.deposits
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_an app.asset_networks;
  v_net app.networks;
  v_addr app.deposit_addresses;
  v_dep app.deposits;
  v_open int;
begin
  if not app.setting_bool('deposits.enabled', true) then
    perform app.raise_error('deposits_paused');
  end if;
  select * into v_an from app.asset_networks where asset_code = p_asset and network_code = p_network;
  if not found or not v_an.deposit_enabled then
    perform app.raise_error('asset_network_not_supported', p_asset || '/' || p_network);
  end if;
  select * into v_net from app.networks where code = p_network;
  if p_expected_amount is not null and p_expected_amount < v_an.min_deposit then
    perform app.raise_error('amount_below_minimum', v_an.min_deposit::text);
  end if;

  select count(*) into v_open from app.deposits
  where user_id = p_user and status = 'awaiting_payment' and expires_at > now();
  if v_open >= 5 then
    perform app.raise_error('too_many_open_deposit_requests');
  end if;

  v_addr := app.assign_deposit_address(p_user, p_network);

  insert into app.deposits (user_id, asset_code, network_code, deposit_address_id, expected_amount,
                            required_confirmations, status, expires_at)
  values (p_user, p_asset, p_network, v_addr.id, p_expected_amount, v_net.required_confirmations,
          'created', now() + make_interval(hours => p_ttl_hours))
  returning * into v_dep;

  update app.deposits set status = 'awaiting_payment' where id = v_dep.id returning * into v_dep;
  return v_dep;
end;
$$;

-- Chain events -----------------------------------------------------------------
create or replace function app.record_chain_event(
  p_provider text, p_provider_event_id text, p_network text, p_direction text,
  p_tx_hash text, p_log_index int, p_address text, p_memo text, p_from_address text,
  p_asset text, p_amount numeric, p_confirmations int, p_block_number bigint,
  p_block_hash text, p_reorged boolean, p_payload jsonb
)
returns table (event_id uuid, is_new boolean)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into app.blockchain_events (
    provider, provider_event_id, network_code, direction, tx_hash, log_index, address, memo, from_address,
    asset_code, amount, confirmations, block_number, block_hash, reorged, payload
  ) values (
    p_provider, p_provider_event_id, p_network, p_direction, p_tx_hash, coalesce(p_log_index, 0), p_address,
    nullif(p_memo, ''), p_from_address, p_asset, p_amount, coalesce(p_confirmations, 0), p_block_number,
    p_block_hash, coalesce(p_reorged, false), coalesce(p_payload, '{}'::jsonb)
  )
  on conflict (provider, provider_event_id) do nothing
  returning id into v_id;

  if v_id is not null then
    return query select v_id, true;
  else
    return query select b.id, false from app.blockchain_events b
      where b.provider = p_provider and b.provider_event_id = p_provider_event_id;
  end if;
end;
$$;

create or replace function app.apply_incoming_event(p_event_id uuid)
returns table (deposit_id uuid, deposit_status text, outcome text)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  e app.blockchain_events;
  v_addr app.deposit_addresses;
  v_profile app.profiles;
  v_dep app.deposits;
  v_an app.asset_networks;
  v_req app.deposits;
  v_reason text;
  v_target text;
  v_conf int;
  v_outcome text;
begin
  select * into e from app.blockchain_events where id = p_event_id for update;
  if not found then
    perform app.raise_error('not_found', 'blockchain event');
  end if;
  if e.direction <> 'incoming' then
    perform app.raise_error('invalid_event_direction');
  end if;
  if e.processed_at is not null then
    select * into v_dep from app.deposits d
    where d.network_code = e.network_code and d.tx_hash = e.tx_hash and d.log_index = e.log_index;
    return query select v_dep.id, v_dep.status, 'already_processed'::text;
    return;
  end if;

  select * into v_addr from app.deposit_addresses a
  where a.network_code = e.network_code and a.address = e.address and coalesce(a.memo, '') = coalesce(e.memo, '');
  if not found then
    update app.blockchain_events set processed_at = now(), processing_result = 'unknown_address' where id = e.id;
    perform app.emit_event('admin:ops', 'deposit.unknown_address', jsonb_build_object('eventId', e.id, 'network', e.network_code));
    return query select null::uuid, null::text, 'unknown_address'::text;
    return;
  end if;

  select * into v_profile from app.profiles where id = v_addr.user_id for update;

  select * into v_dep from app.deposits d
  where d.network_code = e.network_code and d.tx_hash = e.tx_hash and d.log_index = e.log_index
  for update;

  if found then
    if e.reorged then
      if v_dep.status in ('detected', 'confirming', 'confirmed') then
        update app.deposits set status = 'failed', status_reason = 'chain_reorg' where id = v_dep.id returning * into v_dep;
        v_outcome := 'reorg_failed';
      elsif v_dep.status = 'credited' then
        insert into app.risk_flags (user_id, flag_type, severity, details)
        values (v_dep.user_id, 'chain_reorg_after_credit', 'high',
                jsonb_build_object('depositId', v_dep.id, 'txHash', v_dep.tx_hash, 'eventId', e.id));
        perform app.emit_event('admin:ops', 'deposit.reorg_after_credit', jsonb_build_object('id', v_dep.id));
        v_outcome := 'reorg_after_credit';
      else
        v_outcome := 'reorg_ignored';
      end if;
    else
      v_conf := greatest(v_dep.confirmations, e.confirmations);
      if v_dep.status in ('detected', 'confirming') and v_conf >= v_dep.required_confirmations then
        update app.deposits set confirmations = v_conf, status = 'confirmed', confirmed_at = now()
        where id = v_dep.id returning * into v_dep;
      elsif v_dep.status = 'detected' and v_conf > 0 then
        update app.deposits set confirmations = v_conf, status = 'confirming' where id = v_dep.id returning * into v_dep;
      elsif v_conf <> v_dep.confirmations then
        update app.deposits set confirmations = v_conf where id = v_dep.id returning * into v_dep;
      end if;
      v_outcome := 'updated';
    end if;
  else
    if e.reorged then
      update app.blockchain_events set processed_at = now(), processing_result = 'reorg_unknown_deposit' where id = e.id;
      return query select null::uuid, null::text, 'reorg_unknown_deposit'::text;
      return;
    end if;

    if e.asset_code is null then
      update app.blockchain_events set processed_at = now(), processing_result = 'unknown_asset' where id = e.id;
      perform app.emit_event('admin:ops', 'deposit.unknown_asset', jsonb_build_object('eventId', e.id, 'network', e.network_code));
      return query select null::uuid, null::text, 'unknown_asset'::text;
      return;
    end if;

    select * into v_an from app.asset_networks where asset_code = e.asset_code and network_code = e.network_code;
    if not found or not v_an.deposit_enabled then
      v_reason := 'asset_not_supported';
    elsif e.amount < v_an.min_deposit then
      v_reason := 'below_minimum';
    elsif v_profile.status in ('frozen', 'closed') then
      v_reason := 'account_frozen';
    elsif exists (select 1 from app.address_denylist where network_code = e.network_code and address = e.from_address) then
      v_reason := 'screening_hit';
    end if;

    if v_reason is not null then
      v_target := 'under_review';
    elsif e.confirmations >= (select required_confirmations from app.networks where code = e.network_code) then
      v_target := 'confirmed';
    elsif e.confirmations > 0 then
      v_target := 'confirming';
    else
      v_target := 'detected';
    end if;

    select * into v_req from app.deposits d
    where d.user_id = v_addr.user_id and d.network_code = e.network_code and d.asset_code = e.asset_code
      and d.status = 'awaiting_payment' and d.tx_hash is null and (d.expires_at is null or d.expires_at > now())
    order by d.created_at
    limit 1
    for update;

    if found then
      update app.deposits
      set tx_hash = e.tx_hash, log_index = e.log_index, amount = e.amount, from_address = e.from_address,
          confirmations = e.confirmations, status = v_target, status_reason = v_reason,
          detected_at = now(), confirmed_at = case when v_target = 'confirmed' then now() end
      where id = v_req.id
      returning * into v_dep;
    else
      insert into app.deposits (user_id, asset_code, network_code, deposit_address_id, amount, tx_hash, log_index,
                                from_address, confirmations, required_confirmations, status, status_reason,
                                detected_at, confirmed_at)
      values (v_addr.user_id, e.asset_code, e.network_code, v_addr.id, e.amount, e.tx_hash, e.log_index,
              e.from_address, e.confirmations,
              (select required_confirmations from app.networks where code = e.network_code),
              v_target, v_reason, now(), case when v_target = 'confirmed' then now() end)
      returning * into v_dep;
    end if;

    if v_reason = 'screening_hit' then
      insert into app.risk_flags (user_id, flag_type, severity, details)
      values (v_dep.user_id, 'screening_hit', 'high', jsonb_build_object('depositId', v_dep.id, 'from', e.from_address));
    end if;

    perform app.notify(v_dep.user_id,
      case when v_target = 'under_review' then 'deposit_under_review' else 'deposit_detected' end,
      jsonb_build_object('reference', v_dep.reference, 'amount', v_dep.amount::text, 'asset', v_dep.asset_code),
      '/deposit');
    v_outcome := 'created';
  end if;

  update app.blockchain_events set processed_at = now(), processing_result = v_outcome where id = e.id;
  return query select v_dep.id, v_dep.status, v_outcome;
end;
$$;

-- Crediting ----------------------------------------------------------------------
create or replace function app.credit_deposit(p_deposit_id uuid, p_actor uuid, p_source text)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_dep app.deposits;
  v_tx uuid;
  v_hold_days numeric := app.setting_numeric('funds.deposit_hold_days', 7);
begin
  select * into v_dep from app.deposits where id = p_deposit_id for update;
  if not found then
    perform app.raise_error('not_found', 'deposit');
  end if;
  if v_dep.status = 'credited' then
    return v_dep.ledger_transaction_id;
  end if;
  if v_dep.status <> 'confirmed' then
    perform app.raise_error('deposit_not_confirmed', v_dep.status);
  end if;
  if v_dep.confirmations < v_dep.required_confirmations then
    perform app.raise_error('insufficient_confirmations');
  end if;
  if v_dep.risk_result = 'flagged' then
    perform app.raise_error('deposit_flagged');
  end if;

  v_tx := app.post_ledger_transaction(
    'deposit', v_dep.asset_code, 'deposit:' || v_dep.id, p_source, 'deposit', v_dep.id,
    jsonb_build_array(
      app.entry(app.system_account(v_dep.asset_code, 'custody'), 'debit', v_dep.amount),
      app.entry(app.user_account(v_dep.user_id, v_dep.asset_code, 'available'), 'credit', v_dep.amount)
    ),
    'Deposit ' || v_dep.reference,
    jsonb_build_object('txHash', v_dep.tx_hash, 'network', v_dep.network_code),
    p_actor
  );

  if v_hold_days > 0 then
    insert into app.fund_holds (user_id, asset_code, amount, reason, reference_type, reference_id, unlock_at)
    values (v_dep.user_id, v_dep.asset_code, v_dep.amount, 'deposit_cooling', 'deposit', v_dep.id,
            now() + make_interval(secs => (v_hold_days * 86400)::int))
    on conflict (reason, reference_id) do nothing;
  end if;

  update app.deposits set status = 'credited', credited_at = now(), ledger_transaction_id = v_tx
  where id = v_dep.id;

  perform app.notify(v_dep.user_id, 'deposit_credited',
    jsonb_build_object('reference', v_dep.reference, 'amount', v_dep.amount::text, 'asset', v_dep.asset_code,
                       'holdDays', v_hold_days),
    '/deposit');
  return v_tx;
end;
$$;

-- Manual review (compliance) ------------------------------------------------------
create or replace function app.review_deposit(p_deposit_id uuid, p_decision text, p_actor uuid, p_reason text)
returns app.deposits
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_dep app.deposits;
  v_tx uuid;
begin
  select * into v_dep from app.deposits where id = p_deposit_id for update;
  if not found then
    perform app.raise_error('not_found', 'deposit');
  end if;

  if p_decision = 'hold' then
    if v_dep.status not in ('detected', 'confirming', 'confirmed') then
      perform app.raise_error('invalid_status_transition', v_dep.status || ' cannot be put on hold');
    end if;
    update app.deposits set status = 'under_review', status_reason = coalesce(p_reason, 'manual_hold'),
           reviewed_by = p_actor, reviewed_at = now()
    where id = v_dep.id returning * into v_dep;
    perform app.notify(v_dep.user_id, 'deposit_under_review',
      jsonb_build_object('reference', v_dep.reference, 'amount', v_dep.amount::text, 'asset', v_dep.asset_code), '/deposit');

  elsif p_decision = 'approve' then
    if v_dep.status <> 'under_review' or v_dep.tx_hash is null then
      perform app.raise_error('invalid_status_transition', 'only detected deposits under review can be approved');
    end if;
    update app.deposits
    set status = case when confirmations >= required_confirmations then 'confirmed' else 'confirming' end,
        confirmed_at = case when confirmations >= required_confirmations then now() end,
        status_reason = null, risk_result = 'clear', reviewed_by = p_actor, reviewed_at = now()
    where id = v_dep.id returning * into v_dep;

  elsif p_decision = 'reject' then
    if v_dep.status <> 'under_review' then
      perform app.raise_error('invalid_status_transition', v_dep.status || ' cannot be rejected');
    end if;
    if v_dep.amount is not null and v_dep.confirmations >= v_dep.required_confirmations then
      -- Funds physically arrived: record them as owed back to the sender.
      v_tx := app.post_ledger_transaction(
        'deposit_suspense', v_dep.asset_code, 'deposit-suspense:' || v_dep.id, 'admin', 'deposit', v_dep.id,
        jsonb_build_array(
          app.entry(app.system_account(v_dep.asset_code, 'custody'), 'debit', v_dep.amount),
          app.entry(app.system_account(v_dep.asset_code, 'suspense'), 'credit', v_dep.amount)
        ),
        'Rejected deposit held for return ' || v_dep.reference, '{}'::jsonb, p_actor);
    end if;
    update app.deposits set status = 'rejected', status_reason = p_reason, reviewed_by = p_actor,
           reviewed_at = now(), suspense_transaction_id = v_tx
    where id = v_dep.id returning * into v_dep;
    perform app.notify(v_dep.user_id, 'deposit_rejected',
      jsonb_build_object('reference', v_dep.reference, 'reason', p_reason), '/deposit');
  else
    perform app.raise_error('invalid_decision', p_decision);
  end if;
  return v_dep;
end;
$$;

-- Return of a rejected deposit to its sender (after the payout was broadcast).
create or replace function app.return_suspense_deposit(p_deposit_id uuid, p_tx_hash text, p_actor uuid)
returns app.deposits
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_dep app.deposits;
begin
  select * into v_dep from app.deposits where id = p_deposit_id for update;
  if v_dep.status <> 'rejected' or v_dep.suspense_transaction_id is null then
    perform app.raise_error('nothing_to_return');
  end if;
  if v_dep.refunded_at is not null then
    return v_dep;
  end if;
  perform app.post_ledger_transaction(
    'suspense_return', v_dep.asset_code, 'suspense-return:' || v_dep.id, 'admin', 'deposit', v_dep.id,
    jsonb_build_array(
      app.entry(app.system_account(v_dep.asset_code, 'suspense'), 'debit', v_dep.amount),
      app.entry(app.system_account(v_dep.asset_code, 'custody'), 'credit', v_dep.amount)
    ),
    'Returned rejected deposit ' || v_dep.reference, jsonb_build_object('txHash', p_tx_hash), p_actor);
  update app.deposits set refund_tx_hash = p_tx_hash, refunded_at = now() where id = v_dep.id returning * into v_dep;
  return v_dep;
end;
$$;

create or replace function app.expire_deposit_requests()
returns int
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_count int;
begin
  update app.deposits set status = 'failed', status_reason = 'expired'
  where status = 'awaiting_payment' and expires_at <= now();
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;
