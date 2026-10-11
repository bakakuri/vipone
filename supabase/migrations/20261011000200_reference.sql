-- Ledgerline — reference data model: assets, networks, settings, fees, legal documents

create table app.assets (
  code text primary key check (code ~ '^[A-Z0-9]{2,10}$'),
  name text not null check (char_length(name) between 2 and 60),
  decimals smallint not null check (decimals between 0 and 18),
  display_decimals smallint not null default 8 check (display_decimals between 0 and 18),
  is_active boolean not null default true,
  sort_order int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger assets_touch before update on app.assets for each row execute function app.touch_updated_at();

create table app.networks (
  code text primary key check (code ~ '^[A-Z0-9_]{2,20}$'),
  name text not null,
  family text not null check (family in ('bitcoin', 'evm', 'tron', 'solana', 'ton', 'xrp', 'stellar', 'other')),
  address_pattern text not null,
  memo_required boolean not null default false,
  memo_pattern text,
  memo_label text,
  explorer_tx_url text check (explorer_tx_url is null or explorer_tx_url like '%{tx}%'),
  explorer_address_url text check (explorer_address_url is null or explorer_address_url like '%{address}%'),
  required_confirmations int not null check (required_confirmations between 1 and 1000),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (not memo_required or memo_pattern is not null)
);
create trigger networks_touch before update on app.networks for each row execute function app.touch_updated_at();

-- Which asset can move on which network, and the limits for it.
create table app.asset_networks (
  asset_code text not null references app.assets(code),
  network_code text not null references app.networks(code),
  token_standard text,
  token_contract text,
  deposit_enabled boolean not null default true,
  withdrawal_enabled boolean not null default true,
  min_deposit numeric(38, 18) not null default 0 check (min_deposit >= 0),
  min_withdrawal numeric(38, 18) not null check (min_withdrawal > 0),
  -- Estimated network fee charged to the user. The actual fee paid on chain is
  -- recorded separately; any difference is absorbed by the platform.
  withdrawal_network_fee numeric(38, 18) not null check (withdrawal_network_fee >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (asset_code, network_code)
);
create trigger asset_networks_touch before update on app.asset_networks for each row execute function app.touch_updated_at();

-- Runtime settings. approval_policy decides whether a change needs a second
-- administrator: 'always', 'when_relaxing' (e.g. re-enabling withdrawals needs
-- approval, pausing them is immediate) or 'none'.
create table app.system_settings (
  key text primary key check (key ~ '^[a-z0-9_]+(\.[a-z0-9_]+)+$'),
  value jsonb not null,
  description text not null,
  approval_policy text not null default 'always' check (approval_policy in ('always', 'when_relaxing', 'none')),
  updated_by uuid,
  updated_at timestamptz not null default now()
);

create table app.system_settings_history (
  id bigint generated always as identity primary key,
  key text not null,
  old_value jsonb,
  new_value jsonb not null,
  changed_by uuid,
  approval_id uuid,
  reason text,
  changed_at timestamptz not null default now()
);
create index system_settings_history_key_idx on app.system_settings_history (key, changed_at desc);
create trigger system_settings_history_immutable before update or delete on app.system_settings_history
  for each row execute function app.forbid_mutation();

create or replace function app.record_setting_history()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.value is distinct from old.value then
    insert into app.system_settings_history (key, old_value, new_value, changed_by, approval_id, reason)
    values (
      new.key,
      case when tg_op = 'UPDATE' then old.value end,
      new.value,
      new.updated_by,
      nullif(current_setting('app.approval_id', true), '')::uuid,
      nullif(current_setting('app.change_reason', true), '')
    );
  end if;
  return new;
end;
$$;
create trigger system_settings_history_trg after insert or update on app.system_settings
  for each row execute function app.record_setting_history();

create or replace function app.setting(p_key text)
returns jsonb
language sql
stable
as $$
  select value from app.system_settings where key = p_key;
$$;

create or replace function app.setting_numeric(p_key text, p_default numeric default null)
returns numeric
language sql
stable
as $$
  select coalesce((select (value #>> '{}')::numeric from app.system_settings where key = p_key), p_default);
$$;

create or replace function app.setting_bool(p_key text, p_default boolean default false)
returns boolean
language sql
stable
as $$
  select coalesce((select (value #>> '{}')::boolean from app.system_settings where key = p_key), p_default);
$$;

-- Per-asset numeric limit stored as {"USDT": "10000", ...}
create or replace function app.setting_asset_numeric(p_key text, p_asset text)
returns numeric
language sql
stable
as $$
  select nullif(value ->> p_asset, '')::numeric from app.system_settings where key = p_key;
$$;

-- Versioned fee rules. Rows are never edited except to close them
-- (effective_to), so the fee applied to any past withdrawal stays provable.
create table app.fee_rules (
  id uuid primary key default gen_random_uuid(),
  fee_type text not null check (fee_type in ('withdrawal_platform')),
  asset_code text references app.assets(code),
  network_code text references app.networks(code),
  rate numeric(12, 8) not null check (rate >= 0 and rate < 1),
  min_fee numeric(38, 18) not null default 0 check (min_fee >= 0),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  change_reason text not null check (char_length(change_reason) between 3 and 500),
  created_by uuid,
  created_at timestamptz not null default now(),
  check (effective_to is null or effective_to > effective_from),
  check (network_code is null or asset_code is not null)
);
create index fee_rules_lookup_idx on app.fee_rules (fee_type, asset_code, network_code, effective_from desc);

create or replace function app.fee_rules_guard()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform app.raise_error('immutable_record', 'fee rules cannot be deleted');
  end if;
  if old.effective_to is not null
     or new.effective_to is null
     or (to_jsonb(new) - 'effective_to') <> (to_jsonb(old) - 'effective_to') then
    perform app.raise_error('immutable_record', 'fee rules can only be closed once');
  end if;
  return new;
end;
$$;
create trigger fee_rules_guard_trg before update or delete on app.fee_rules
  for each row execute function app.fee_rules_guard();

-- Most specific active rule wins: asset+network, then asset, then global.
create or replace function app.active_fee_rule(p_fee_type text, p_asset text, p_network text, p_at timestamptz default now())
returns app.fee_rules
language sql
stable
as $$
  select r.*
  from app.fee_rules r
  where r.fee_type = p_fee_type
    and r.effective_from <= p_at
    and (r.effective_to is null or r.effective_to > p_at)
    and (r.asset_code is null or r.asset_code = p_asset)
    and (r.network_code is null or r.network_code = p_network)
  order by (r.network_code is not null) desc, (r.asset_code is not null) desc, r.effective_from desc
  limit 1;
$$;

create table app.legal_documents (
  id uuid primary key default gen_random_uuid(),
  doc_type text not null check (doc_type in ('terms', 'privacy', 'cookies', 'risk')),
  version text not null check (version ~ '^[0-9]+\.[0-9]+$'),
  locale text not null check (locale in ('en', 'ru', 'ar')),
  title text not null,
  path text not null,
  content_sha256 text,
  is_current boolean not null default false,
  -- The English text prevails if translations differ (stated in the documents).
  is_prevailing boolean not null default false,
  published_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (doc_type, version, locale)
);
create unique index legal_documents_current_uq on app.legal_documents (doc_type, locale) where is_current;
