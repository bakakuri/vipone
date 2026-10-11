-- Ledgerline — double-entry ledger
--
-- Every movement of value is a ledger transaction made of debit and credit
-- entries in ONE asset whose totals are equal. Entries are append-only;
-- corrections are new (reversing) transactions. Balances are derived from the
-- entries; app.ledger_balances is a cache maintained in the same database
-- transaction and verified by app.verify_ledger_integrity().
--
-- Chart of accounts (per asset):
--   user    available        credit-normal  spendable user funds (liability)
--   user    withdrawal_hold  credit-normal  funds reserved by open withdrawal requests
--   user    invested         credit-normal  funds allocated to investment positions
--   system  custody          debit-normal   assets held in platform wallets
--   system  strategy         debit-normal   assets deployed to investment strategies
--   system  fee_revenue      credit-normal  platform fee income
--   system  network_fee_recovery credit     network fees charged to users
--   system  network_fee_expense  debit      network fees actually paid on chain
--   system  referral_expense debit-normal   referral rewards paid by the platform
--   system  suspense         credit-normal  third-party funds received but not credited (to return)
--   system  adjustments      credit-normal  approved manual corrections (may be negative)
--   system  platform_capital credit-normal  the operator's own funds added to custody (e.g. referral budget)

create table app.ledger_accounts (
  id uuid primary key default gen_random_uuid(),
  owner_type text not null check (owner_type in ('user', 'system')),
  user_id uuid references app.profiles(id),
  asset_code text not null references app.assets(code),
  account_type text not null,
  normal_balance text not null check (normal_balance in ('debit', 'credit')),
  allow_negative boolean not null default false,
  created_at timestamptz not null default now(),
  check ((owner_type = 'user') = (user_id is not null)),
  check (
    (owner_type = 'user' and account_type in ('available', 'withdrawal_hold', 'invested'))
    or (owner_type = 'system' and account_type in (
      'custody', 'strategy', 'fee_revenue', 'network_fee_recovery', 'network_fee_expense',
      'referral_expense', 'suspense', 'adjustments', 'platform_capital'))
  )
);
create unique index ledger_accounts_user_uq on app.ledger_accounts (user_id, asset_code, account_type) where owner_type = 'user';
create unique index ledger_accounts_system_uq on app.ledger_accounts (asset_code, account_type) where owner_type = 'system';
create trigger ledger_accounts_immutable before update or delete on app.ledger_accounts
  for each row execute function app.forbid_mutation();

create table app.ledger_transactions (
  id uuid primary key default gen_random_uuid(),
  tx_type text not null check (tx_type in (
    'deposit', 'deposit_suspense', 'suspense_return',
    'withdrawal_hold', 'withdrawal_release', 'withdrawal_settlement', 'network_fee',
    'investment_allocation', 'investment_result', 'investment_release', 'investment_early_exit',
    'referral_reward', 'adjustment', 'treasury_transfer', 'capital_contribution', 'reversal'
  )),
  asset_code text not null references app.assets(code),
  idempotency_key text not null unique check (char_length(idempotency_key) between 8 and 200),
  payload_hash text not null,
  source text not null check (source in ('user', 'admin', 'system', 'webhook', 'job')),
  reference_type text check (reference_type in (
    'deposit', 'withdrawal_request', 'investment_position', 'investment_result',
    'referral_reward', 'adjustment', 'treasury_transfer', 'capital_contribution'
  )),
  reference_id uuid,
  reverses_transaction_id uuid references app.ledger_transactions(id),
  status text not null default 'posted' check (status = 'posted'),
  description text,
  metadata jsonb not null default '{}'::jsonb,
  created_by uuid references app.profiles(id),
  posted_at timestamptz not null default now()
);
create index ledger_transactions_reference_idx on app.ledger_transactions (reference_type, reference_id);
create index ledger_transactions_posted_idx on app.ledger_transactions (posted_at desc);

create table app.ledger_entries (
  id bigint generated always as identity primary key,
  transaction_id uuid not null references app.ledger_transactions(id),
  account_id uuid not null references app.ledger_accounts(id),
  direction text not null check (direction in ('debit', 'credit')),
  amount numeric(38, 18) not null check (amount > 0),
  created_at timestamptz not null default now()
);
create index ledger_entries_account_idx on app.ledger_entries (account_id, id desc);
create index ledger_entries_transaction_idx on app.ledger_entries (transaction_id);

create table app.ledger_balances (
  account_id uuid primary key references app.ledger_accounts(id),
  balance numeric(38, 18) not null default 0,
  version bigint not null default 0,
  updated_at timestamptz not null default now()
);

create trigger ledger_transactions_immutable before update or delete on app.ledger_transactions
  for each row execute function app.forbid_mutation();
create trigger ledger_entries_immutable before update or delete on app.ledger_entries
  for each row execute function app.forbid_mutation();

-- The balance cache may only change inside app.post_ledger_transaction().
create or replace function app.ledger_balances_guard()
returns trigger
language plpgsql
as $$
begin
  if coalesce(current_setting('app.ledger_posting', true), '') <> 'on' then
    perform app.raise_error('immutable_record', 'ledger balances change only through app.post_ledger_transaction');
  end if;
  if tg_op = 'DELETE' then
    perform app.raise_error('immutable_record', 'ledger balances cannot be deleted');
  end if;
  return new;
end;
$$;
create trigger ledger_balances_guard_trg before update or delete on app.ledger_balances
  for each row execute function app.ledger_balances_guard();

-- Deferred integrity checks evaluated at COMMIT.
create or replace function app.check_transaction_balanced()
returns trigger
language plpgsql
as $$
declare
  v_tx_id uuid;
  v_debits numeric;
  v_credits numeric;
  v_count int;
  v_mismatched_assets int;
begin
  if tg_table_name = 'ledger_transactions' then
    v_tx_id := new.id;
  else
    v_tx_id := new.transaction_id;
  end if;

  select coalesce(sum(amount) filter (where direction = 'debit'), 0),
         coalesce(sum(amount) filter (where direction = 'credit'), 0),
         count(*)
    into v_debits, v_credits, v_count
  from app.ledger_entries where transaction_id = v_tx_id;

  if v_count < 2 then
    perform app.raise_error('ledger_unbalanced', format('transaction %s has %s entries', v_tx_id, v_count));
  end if;
  if v_debits <> v_credits then
    perform app.raise_error('ledger_unbalanced', format('transaction %s debits %s credits %s', v_tx_id, v_debits, v_credits));
  end if;

  select count(*) into v_mismatched_assets
  from app.ledger_entries e
  join app.ledger_accounts a on a.id = e.account_id
  join app.ledger_transactions t on t.id = e.transaction_id
  where e.transaction_id = v_tx_id and a.asset_code <> t.asset_code;
  if v_mismatched_assets > 0 then
    perform app.raise_error('ledger_asset_mismatch', format('transaction %s mixes assets', v_tx_id));
  end if;
  return null;
end;
$$;

create constraint trigger ledger_entries_balanced
  after insert on app.ledger_entries
  deferrable initially deferred
  for each row execute function app.check_transaction_balanced();

create constraint trigger ledger_transactions_have_entries
  after insert on app.ledger_transactions
  deferrable initially deferred
  for each row execute function app.check_transaction_balanced();

-- Account resolution ---------------------------------------------------------

create or replace function app.account_normal_balance(p_owner_type text, p_account_type text)
returns text
language sql
immutable
as $$
  select case
    when p_owner_type = 'user' then 'credit'
    when p_account_type in ('custody', 'strategy', 'network_fee_expense', 'referral_expense') then 'debit'
    else 'credit'
  end;
$$;

create or replace function app.user_account(p_user uuid, p_asset text, p_type text)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id from app.ledger_accounts
  where owner_type = 'user' and user_id = p_user and asset_code = p_asset and account_type = p_type;
  if found then
    return v_id;
  end if;

  insert into app.ledger_accounts (owner_type, user_id, asset_code, account_type, normal_balance, allow_negative)
  values ('user', p_user, p_asset, p_type, 'credit', false)
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from app.ledger_accounts
    where owner_type = 'user' and user_id = p_user and asset_code = p_asset and account_type = p_type;
  else
    insert into app.ledger_balances (account_id) values (v_id) on conflict do nothing;
  end if;
  return v_id;
end;
$$;

create or replace function app.system_account(p_asset text, p_type text)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_id uuid;
begin
  select id into v_id from app.ledger_accounts
  where owner_type = 'system' and asset_code = p_asset and account_type = p_type;
  if found then
    return v_id;
  end if;

  insert into app.ledger_accounts (owner_type, user_id, asset_code, account_type, normal_balance, allow_negative)
  values ('system', null, p_asset, p_type, app.account_normal_balance('system', p_type), p_type = 'adjustments')
  on conflict do nothing
  returning id into v_id;

  if v_id is null then
    select id into v_id from app.ledger_accounts
    where owner_type = 'system' and asset_code = p_asset and account_type = p_type;
  else
    insert into app.ledger_balances (account_id) values (v_id) on conflict do nothing;
  end if;
  return v_id;
end;
$$;

-- Posting ---------------------------------------------------------------------
--
-- p_entries: [{"account_id": "<uuid>", "direction": "debit"|"credit", "amount": "12.5"}, ...]
-- Idempotent: the same idempotency key with the same payload returns the
-- original transaction id; with a different payload it fails.
create or replace function app.post_ledger_transaction(
  p_tx_type text,
  p_asset text,
  p_idempotency_key text,
  p_source text,
  p_reference_type text,
  p_reference_id uuid,
  p_entries jsonb,
  p_description text default null,
  p_metadata jsonb default '{}'::jsonb,
  p_created_by uuid default null,
  p_reverses uuid default null
)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_tx_id uuid;
  v_hash text;
  v_existing record;
  v_decimals int;
  v_entry jsonb;
  v_amount numeric;
  v_account record;
  v_debits numeric := 0;
  v_credits numeric := 0;
  v_account_ids uuid[];
  v_negative record;
  v_user uuid;
begin
  if jsonb_typeof(p_entries) <> 'array' or jsonb_array_length(p_entries) < 2 then
    perform app.raise_error('ledger_invalid_entries', 'at least two entries are required');
  end if;

  v_hash := encode(sha256(convert_to(p_tx_type || '|' || p_asset || '|' || coalesce(p_reference_id::text, '') || '|' || p_entries::text, 'UTF8')), 'hex');

  select id, payload_hash into v_existing from app.ledger_transactions where idempotency_key = p_idempotency_key;
  if found then
    if v_existing.payload_hash <> v_hash then
      perform app.raise_error('idempotency_conflict', 'ledger idempotency key reused with a different payload');
    end if;
    return v_existing.id;
  end if;

  select decimals into v_decimals from app.assets where code = p_asset;
  if not found then
    perform app.raise_error('asset_not_found', p_asset);
  end if;

  -- Validate entries.
  for v_entry in select * from jsonb_array_elements(p_entries) loop
    if (v_entry ->> 'direction') not in ('debit', 'credit') then
      perform app.raise_error('ledger_invalid_entries', 'direction must be debit or credit');
    end if;
    begin
      v_amount := (v_entry ->> 'amount')::numeric;
    exception when others then
      perform app.raise_error('ledger_invalid_entries', 'amount is not a number');
    end;
    if v_amount is null or v_amount <= 0 then
      perform app.raise_error('ledger_invalid_entries', 'amounts must be positive');
    end if;
    if round(v_amount, v_decimals) <> v_amount then
      perform app.raise_error('amount_precision_exceeded', format('%s supports %s decimals', p_asset, v_decimals));
    end if;
    select * into v_account from app.ledger_accounts where id = (v_entry ->> 'account_id')::uuid;
    if not found then
      perform app.raise_error('ledger_invalid_entries', 'unknown account');
    end if;
    if v_account.asset_code <> p_asset then
      perform app.raise_error('ledger_asset_mismatch', 'entry account belongs to another asset');
    end if;
    if v_entry ->> 'direction' = 'debit' then
      v_debits := v_debits + v_amount;
    else
      v_credits := v_credits + v_amount;
    end if;
  end loop;

  if v_debits <> v_credits then
    perform app.raise_error('ledger_unbalanced', format('debits %s <> credits %s', v_debits, v_credits));
  end if;

  -- Lock every affected balance row in a deterministic order (deadlock-free).
  select array_agg(distinct (e ->> 'account_id')::uuid) into v_account_ids from jsonb_array_elements(p_entries) e;
  perform 1 from app.ledger_balances where account_id = any (v_account_ids) order by account_id for update;

  begin
    insert into app.ledger_transactions (
      tx_type, asset_code, idempotency_key, payload_hash, source, reference_type, reference_id,
      reverses_transaction_id, description, metadata, created_by
    ) values (
      p_tx_type, p_asset, p_idempotency_key, v_hash, p_source, p_reference_type, p_reference_id,
      p_reverses, p_description, coalesce(p_metadata, '{}'::jsonb), p_created_by
    )
    returning id into v_tx_id;
  exception when unique_violation then
    -- A concurrent request with the same key committed first.
    select id, payload_hash into v_existing from app.ledger_transactions where idempotency_key = p_idempotency_key;
    if v_existing.payload_hash <> v_hash then
      perform app.raise_error('idempotency_conflict', 'ledger idempotency key reused with a different payload');
    end if;
    return v_existing.id;
  end;

  insert into app.ledger_entries (transaction_id, account_id, direction, amount)
  select v_tx_id, (e ->> 'account_id')::uuid, e ->> 'direction', (e ->> 'amount')::numeric
  from jsonb_array_elements(p_entries) e;

  perform set_config('app.ledger_posting', 'on', true);
  update app.ledger_balances b
  set balance = b.balance + d.delta,
      version = b.version + 1,
      updated_at = now()
  from (
    select (e ->> 'account_id')::uuid as account_id,
           sum(case when (e ->> 'direction') = a.normal_balance then (e ->> 'amount')::numeric
                    else -(e ->> 'amount')::numeric end) as delta
    from jsonb_array_elements(p_entries) e
    join app.ledger_accounts a on a.id = (e ->> 'account_id')::uuid
    group by 1
  ) d
  where b.account_id = d.account_id;
  perform set_config('app.ledger_posting', 'off', true);

  select a.account_type, a.owner_type, b.balance into v_negative
  from app.ledger_balances b
  join app.ledger_accounts a on a.id = b.account_id
  where b.account_id = any (v_account_ids) and not a.allow_negative and b.balance < 0
  limit 1;
  if found then
    if v_negative.owner_type = 'user' then
      perform app.raise_error('insufficient_funds', v_negative.account_type);
    else
      perform app.raise_error('insufficient_system_funds', v_negative.account_type);
    end if;
  end if;

  for v_user in
    select distinct a.user_id from app.ledger_accounts a
    where a.id = any (v_account_ids) and a.owner_type = 'user'
  loop
    perform app.emit_event('user:' || v_user, 'balance.changed',
      jsonb_build_object('asset', p_asset, 'transactionId', v_tx_id, 'txType', p_tx_type));
  end loop;

  return v_tx_id;
end;
$$;

-- Convenience builder for a single entry.
create or replace function app.entry(p_account uuid, p_direction text, p_amount numeric)
returns jsonb
language sql
immutable
as $$
  select jsonb_build_object('account_id', p_account, 'direction', p_direction, 'amount', p_amount::text);
$$;

-- Balance of one account as stored in the cache.
create or replace function app.account_balance(p_account uuid)
returns numeric
language sql
stable
as $$
  select coalesce((select balance from app.ledger_balances where account_id = p_account), 0);
$$;

-- Withdrawal restrictions ------------------------------------------------------
--
-- The "7-day rule": newly credited deposits cannot be WITHDRAWN until their
-- hold expires (setting funds.deposit_hold_days). Held funds may still be
-- allocated to investments; the hold only limits external withdrawals.
create table app.fund_holds (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  asset_code text not null references app.assets(code),
  amount numeric(38, 18) not null check (amount > 0),
  reason text not null check (reason in ('deposit_cooling')),
  reference_type text not null check (reference_type in ('deposit')),
  reference_id uuid not null,
  unlock_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'released_early', 'cancelled')),
  status_reason text,
  changed_by uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (reason, reference_id)
);
create index fund_holds_active_idx on app.fund_holds (user_id, asset_code, unlock_at) where status = 'active';
create trigger fund_holds_touch before update on app.fund_holds for each row execute function app.touch_updated_at();

create or replace function app.active_hold_amount(p_user uuid, p_asset text)
returns numeric
language sql
stable
as $$
  select coalesce(sum(amount), 0) from app.fund_holds
  where user_id = p_user and asset_code = p_asset and status = 'active' and unlock_at > now();
$$;

-- Single source of truth for user balances (used by the API and by withdrawals).
create or replace function app.user_balances(p_user uuid)
returns table (
  asset_code text,
  available numeric,
  withdrawal_hold numeric,
  invested numeric,
  deposit_hold numeric,
  withdrawable numeric,
  total numeric
)
language sql
stable
as $$
  with assets as (
    select code from app.assets where is_active
    union
    select asset_code from app.ledger_accounts where user_id = p_user
  ),
  bal as (
    select a.code as asset_code,
      coalesce((select b.balance from app.ledger_accounts la join app.ledger_balances b on b.account_id = la.id
                where la.user_id = p_user and la.asset_code = a.code and la.account_type = 'available'), 0) as available,
      coalesce((select b.balance from app.ledger_accounts la join app.ledger_balances b on b.account_id = la.id
                where la.user_id = p_user and la.asset_code = a.code and la.account_type = 'withdrawal_hold'), 0) as withdrawal_hold,
      coalesce((select b.balance from app.ledger_accounts la join app.ledger_balances b on b.account_id = la.id
                where la.user_id = p_user and la.asset_code = a.code and la.account_type = 'invested'), 0) as invested,
      app.active_hold_amount(p_user, a.code) as hold_total
    from assets a
  )
  select asset_code,
         available,
         withdrawal_hold,
         invested,
         least(available, hold_total) as deposit_hold,
         greatest(available - hold_total, 0) as withdrawable,
         available + withdrawal_hold + invested as total
  from bal
  order by asset_code;
$$;

-- Integrity verification -------------------------------------------------------
create or replace function app.verify_ledger_integrity()
returns table (check_name text, subject text, expected numeric, actual numeric)
language sql
stable
as $$
  -- Cached balances must equal balances recomputed from entries.
  select 'balance_cache'::text, b.account_id::text, coalesce(r.recomputed, 0), b.balance
  from app.ledger_balances b
  join app.ledger_accounts a on a.id = b.account_id
  left join (
    select e.account_id,
           sum(case when e.direction = a2.normal_balance then e.amount else -e.amount end) as recomputed
    from app.ledger_entries e
    join app.ledger_accounts a2 on a2.id = e.account_id
    group by e.account_id
  ) r on r.account_id = b.account_id
  where coalesce(r.recomputed, 0) <> b.balance
  union all
  -- Every transaction must balance.
  select 'transaction_balance', t.id::text,
         sum(e.amount) filter (where e.direction = 'debit'),
         sum(e.amount) filter (where e.direction = 'credit')
  from app.ledger_transactions t
  join app.ledger_entries e on e.transaction_id = t.id
  group by t.id
  having sum(e.amount) filter (where e.direction = 'debit') is distinct from sum(e.amount) filter (where e.direction = 'credit')
  union all
  -- Per asset, total debits must equal total credits.
  select 'asset_trial_balance', t.asset_code,
         sum(e.amount) filter (where e.direction = 'debit'),
         sum(e.amount) filter (where e.direction = 'credit')
  from app.ledger_transactions t
  join app.ledger_entries e on e.transaction_id = t.id
  group by t.asset_code
  having sum(e.amount) filter (where e.direction = 'debit') is distinct from sum(e.amount) filter (where e.direction = 'credit');
$$;

-- Solvency snapshot per asset: platform assets vs. what is owed to users.
create or replace function app.asset_position(p_asset text)
returns table (
  asset_code text,
  custody numeric,
  strategy numeric,
  user_liabilities numeric,
  suspense numeric,
  platform_equity numeric,
  coverage_ratio numeric
)
language sql
stable
as $$
  with s as (
    select
      coalesce(sum(b.balance) filter (where a.owner_type = 'system' and a.account_type = 'custody'), 0) as custody,
      coalesce(sum(b.balance) filter (where a.owner_type = 'system' and a.account_type = 'strategy'), 0) as strategy,
      coalesce(sum(b.balance) filter (where a.owner_type = 'user'), 0) as user_liabilities,
      coalesce(sum(b.balance) filter (where a.owner_type = 'system' and a.account_type = 'suspense'), 0) as suspense
    from app.ledger_accounts a
    join app.ledger_balances b on b.account_id = a.id
    where a.asset_code = p_asset
  )
  select p_asset, custody, strategy, user_liabilities, suspense,
         custody + strategy - user_liabilities - suspense,
         case when user_liabilities + suspense = 0 then null
              else round((custody + strategy) / (user_liabilities + suspense), 6) end
  from s;
$$;
