-- Local / CI only. Recreates the small part of a Supabase database that the
-- Ledgerline migrations depend on, so they can run on plain PostgreSQL 15+.
-- Every statement is guarded: running this against a real Supabase database
-- (or `supabase start`) changes nothing that already exists.
-- Never needed in production: Supabase already provides all of it.

do $$
begin
  if not exists (select 1 from pg_roles where rolname = 'anon') then
    create role anon nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'authenticated') then
    create role authenticated nologin noinherit;
  end if;
  if not exists (select 1 from pg_roles where rolname = 'service_role') then
    create role service_role nologin noinherit bypassrls;
  end if;
end;
$$;

create schema if not exists auth;

create table if not exists auth.users (
  id uuid primary key default gen_random_uuid(),
  email text,
  encrypted_password text,
  email_confirmed_at timestamptz,
  raw_app_meta_data jsonb default '{}'::jsonb,
  raw_user_meta_data jsonb default '{}'::jsonb,
  banned_until timestamptz,
  last_sign_in_at timestamptz,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

do $$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $f$
      create function auth.uid() returns uuid language sql stable as $body$
        select nullif(coalesce(current_setting('request.jwt.claim.sub', true),
                               (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')), '')::uuid
      $body$
    $f$;
  end if;
  if to_regprocedure('auth.jwt()') is null then
    execute $f$
      create function auth.jwt() returns jsonb language sql stable as $body$
        select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb
      $body$
    $f$;
  end if;
  if to_regprocedure('auth.role()') is null then
    execute $f$
      create function auth.role() returns text language sql stable as $body$
        select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role', 'anon')
      $body$
    $f$;
  end if;
end;
$$;

grant usage on schema auth to anon, authenticated, service_role;
grant execute on all functions in schema auth to anon, authenticated, service_role;

-- Minimal stand-in for Supabase Realtime broadcast authorisation.
create schema if not exists realtime;

create table if not exists realtime.messages (
  id bigint generated always as identity primary key,
  topic text not null,
  extension text not null default 'broadcast',
  event text,
  payload jsonb,
  private boolean default true,
  inserted_at timestamptz default now()
);
alter table realtime.messages enable row level security;
grant usage on schema realtime to anon, authenticated, service_role;
grant select on realtime.messages to authenticated;

do $$
begin
  if to_regprocedure('realtime.topic()') is null then
    execute $f$
      create function realtime.topic() returns text language sql stable as $body$
        select nullif(current_setting('realtime.topic', true), '')
      $body$
    $f$;
  end if;
  if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is null then
    execute $f$
      create function realtime.send(payload jsonb, event text, topic text, private boolean default true)
      returns void language sql as $body$
        insert into realtime.messages (topic, extension, event, payload, private)
        values (topic, 'broadcast', event, payload, private)
      $body$
    $f$;
  end if;
end;
$$;
grant execute on all functions in schema realtime to anon, authenticated, service_role;

-- Storage for the LOCAL auth provider (AUTH_PROVIDER=local, development and
-- tests only). Production uses Supabase Auth.
create schema if not exists local_auth;

create table if not exists local_auth.refresh_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  token_hash text not null unique,
  family_id uuid not null,
  session_id uuid not null,
  aal text not null default 'aal1',
  expires_at timestamptz not null,
  revoked_at timestamptz,
  replaced_by uuid,
  created_at timestamptz not null default now()
);

create table if not exists local_auth.email_tokens (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  purpose text not null check (purpose in ('signup', 'recovery')),
  token_hash text not null unique,
  expires_at timestamptz not null,
  used_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists local_auth.mfa_factors (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id),
  secret_ciphertext text not null,
  status text not null default 'unverified' check (status in ('unverified', 'verified')),
  last_used_step bigint,
  created_at timestamptz not null default now()
);
