-- Ledgerline — users, roles, compliance and security records

create table app.profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  email text not null check (char_length(email) between 3 and 254),
  display_name text check (display_name is null or char_length(display_name) between 1 and 80),
  locale text not null default 'en' check (locale in ('en', 'ru', 'ar')),
  theme text not null default 'system' check (theme in ('system', 'light', 'dark')),
  -- Self-declared at registration; verified through KYC. Never derived from IP.
  country_code text check (country_code ~ '^[A-Z]{2}$'),
  status text not null default 'active' check (status in ('active', 'restricted', 'frozen', 'closed')),
  status_reason text,
  kyc_status text not null default 'none' check (kyc_status in ('none', 'pending', 'approved', 'rejected')),
  mfa_enabled boolean not null default false,
  onboarding jsonb not null default '{"completed": false, "dismissed": false, "step": 0}'::jsonb,
  signup_ip_hash text,
  last_login_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index profiles_email_lower_uq on app.profiles (lower(email));
create index profiles_created_at_idx on app.profiles (created_at desc);
create index profiles_status_idx on app.profiles (status) where status <> 'active';
create trigger profiles_touch before update on app.profiles for each row execute function app.touch_updated_at();

-- Staff roles. Every profile is implicitly a regular user.
create table app.user_roles (
  user_id uuid not null references app.profiles(id),
  role text not null check (role in ('support', 'finance', 'compliance', 'super_admin')),
  granted_by uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  primary key (user_id, role)
);

create or replace function app.has_role(p_user uuid, p_roles text[])
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (select 1 from app.user_roles where user_id = p_user and role = any (p_roles));
$$;

create or replace function app.is_staff(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = app, pg_temp
as $$
  select exists (select 1 from app.user_roles where user_id = p_user);
$$;

create table app.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  document_id uuid not null references app.legal_documents(id),
  accepted_at timestamptz not null default now(),
  ip_hash text,
  user_agent text,
  unique (user_id, document_id)
);
create trigger legal_acceptances_immutable before update or delete on app.legal_acceptances
  for each row execute function app.forbid_mutation();

create table app.kyc_verifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  provider text not null,
  provider_reference text,
  level text not null default 'basic',
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'expired')),
  reason text,
  reviewed_by uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_reference)
);
create index kyc_verifications_user_idx on app.kyc_verifications (user_id, created_at desc);
create trigger kyc_verifications_touch before update on app.kyc_verifications for each row execute function app.touch_updated_at();

create table app.security_events (
  id bigint generated always as identity primary key,
  user_id uuid references app.profiles(id),
  event_type text not null check (event_type in (
    'login_success', 'login_failed', 'logout', 'password_changed', 'password_reset_requested',
    'mfa_enabled', 'mfa_disabled', 'mfa_failed', 'email_confirmed', 'new_device',
    'wallet_added', 'wallet_confirmed', 'wallet_removed', 'session_revoked'
  )),
  ip_hash text,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index security_events_user_idx on app.security_events (user_id, created_at desc);
create trigger security_events_immutable before update or delete on app.security_events
  for each row execute function app.forbid_mutation();

create table app.risk_flags (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  flag_type text not null check (flag_type in (
    'shared_signup_ip_with_referrer', 'shared_wallet_with_referrer', 'screening_hit',
    'deposit_below_minimum', 'unknown_deposit_address', 'chain_reorg_after_credit',
    'velocity', 'manual'
  )),
  severity text not null default 'medium' check (severity in ('low', 'medium', 'high')),
  details jsonb not null default '{}'::jsonb,
  status text not null default 'open' check (status in ('open', 'resolved', 'dismissed')),
  resolved_by uuid references app.profiles(id),
  resolved_at timestamptz,
  resolution_note text,
  created_at timestamptz not null default now(),
  check ((status = 'open') = (resolved_at is null))
);
create index risk_flags_open_idx on app.risk_flags (user_id) where status = 'open';

-- One-time numeric codes (wallet confirmation etc.). Only the hash is stored.
create table app.verification_codes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  purpose text not null check (purpose in ('wallet_confirmation')),
  reference_id uuid not null,
  code_hash text not null,
  attempts int not null default 0 check (attempts between 0 and 10),
  expires_at timestamptz not null,
  consumed_at timestamptz,
  created_at timestamptz not null default now()
);
create index verification_codes_lookup_idx on app.verification_codes (user_id, purpose, reference_id) where consumed_at is null;

-- Referral codes and relationships. A relationship is fixed at registration.
create table app.referral_codes (
  user_id uuid primary key references app.profiles(id),
  code text not null unique check (code ~ '^[A-Z0-9]{6,12}$'),
  created_at timestamptz not null default now()
);

create table app.referral_relationships (
  referred_user_id uuid primary key references app.profiles(id),
  referrer_user_id uuid not null references app.profiles(id),
  code text not null,
  created_at timestamptz not null default now(),
  check (referred_user_id <> referrer_user_id)
);
create index referral_relationships_referrer_idx on app.referral_relationships (referrer_user_id, created_at desc);
create trigger referral_relationships_immutable before update or delete on app.referral_relationships
  for each row execute function app.forbid_mutation();
