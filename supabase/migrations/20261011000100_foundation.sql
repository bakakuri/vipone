-- Ledgerline — foundation
-- All application tables live in the private `app` schema. It is NOT exposed
-- through the Supabase Data API: the Express backend is the only writer.
-- Row Level Security is still enabled on every table (see *_rls.sql) as a
-- second line of defence and to authorise Supabase Realtime channels.

create schema if not exists app;
comment on schema app is 'Ledgerline application data. Private: written only by the backend.';

-- Raise a domain error. The message is a stable machine code that the backend
-- maps to an HTTP error (server/core/db-error-map.js).
create or replace function app.raise_error(p_code text, p_detail text default null)
returns void
language plpgsql
as $$
begin
  raise exception using errcode = 'P0001', message = p_code, detail = coalesce(p_detail, '');
end;
$$;

create or replace function app.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- Attach to append-only tables (ledger, audit log, history tables).
create or replace function app.forbid_mutation()
returns trigger
language plpgsql
as $$
begin
  raise exception using
    errcode = 'P0001',
    message = 'immutable_record',
    detail = format('%s is append-only; %s is not allowed', tg_table_name, lower(tg_op));
end;
$$;

-- True when a jsonb object has a non-empty string for every supported locale.
create or replace function app.has_all_locales(p_value jsonb)
returns boolean
language sql
immutable
as $$
  select jsonb_typeof(p_value) = 'object'
     and coalesce(length(trim(p_value->>'en')), 0) > 0
     and coalesce(length(trim(p_value->>'ru')), 0) > 0
     and coalesce(length(trim(p_value->>'ar')), 0) > 0;
$$;

-- Random bytes without pgcrypto: derived from gen_random_uuid(), which is
-- built into PostgreSQL 13+ (no extension needed on Supabase or plain Postgres).
create or replace function app.gen_random_bytes_compat(p_len int)
returns bytea
language sql
volatile
as $$
  select substring(decode(replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', ''), 'hex') from 1 for p_len);
$$;

-- Human-readable references such as DEP-7Q2KX9MD (no ambiguous characters).
create or replace function app.new_reference(p_prefix text)
returns text
language plpgsql
volatile
as $$
declare
  v_alphabet constant text := '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
  v_bytes bytea := app.gen_random_bytes_compat(8);
  v_out text := '';
  i int;
begin
  for i in 0..7 loop
    v_out := v_out || substr(v_alphabet, (get_byte(v_bytes, i) % length(v_alphabet)) + 1, 1);
  end loop;
  return p_prefix || '-' || v_out;
end;
$$;

-- Generic status machine. Each stateful table declares its allowed transitions
-- here and attaches app.enforce_status_transition('<entity>') as a trigger.
create table app.status_transitions (
  entity text not null,
  from_status text not null,
  to_status text not null,
  primary key (entity, from_status, to_status)
);

create or replace function app.enforce_status_transition()
returns trigger
language plpgsql
as $$
declare
  v_entity text := tg_argv[0];
begin
  if tg_op = 'INSERT' then
    if not exists (select 1 from app.status_transitions where entity = v_entity and from_status = '_new' and to_status = new.status) then
      perform app.raise_error('invalid_initial_status', format('%s cannot start as %s', v_entity, new.status));
    end if;
    return new;
  end if;
  if new.status is distinct from old.status then
    if not exists (select 1 from app.status_transitions where entity = v_entity and from_status = old.status and to_status = new.status) then
      perform app.raise_error('invalid_status_transition', format('%s: %s -> %s', v_entity, old.status, new.status));
    end if;
  end if;
  return new;
end;
$$;

-- Live update signal. Payloads carry identifiers and statuses only (never
-- balances or personal data); clients re-fetch from the API on receipt.
--   * pg_notify('app_events')  -> consumed by the Express SSE fallback
--   * realtime.send(...)        -> Supabase Realtime private broadcast channels
-- A failure here must never roll back a financial operation, so errors are
-- downgraded to warnings.
create or replace function app.emit_event(p_topic text, p_event text, p_payload jsonb default '{}'::jsonb)
returns void
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_payload jsonb := coalesce(p_payload, '{}'::jsonb) || jsonb_build_object('at', to_char(clock_timestamp() at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
begin
  begin
    perform pg_notify('app_events', jsonb_build_object('topic', p_topic, 'event', p_event, 'payload', v_payload)::text);
    if to_regprocedure('realtime.send(jsonb,text,text,boolean)') is not null then
      execute 'select realtime.send($1, $2, $3, true)' using v_payload, p_event, p_topic;
    end if;
  exception when others then
    raise warning 'emit_event(%) failed: %', p_event, sqlerrm;
  end;
end;
$$;
