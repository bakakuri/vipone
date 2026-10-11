-- Ledgerline — platform services: notifications, audit, approvals, idempotency,
-- rate limiting, support, outbound email, jobs, prices

create table app.notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references app.profiles(id),
  -- Rendered on the client from locales/*/notifications.json: types.<type>.title/body
  type text not null check (type in (
    'registration_completed', 'deposit_detected', 'deposit_confirmed', 'deposit_credited', 'deposit_rejected',
    'deposit_under_review', 'investment_opened', 'investment_matured', 'investment_awaiting_settlement',
    'investment_result_posted', 'withdrawal_created', 'withdrawal_approved', 'withdrawal_completed',
    'withdrawal_rejected', 'withdrawal_failed', 'withdrawal_cancelled', 'referral_reward_pending',
    'referral_reward_credited', 'security_alert', 'wallet_added', 'kyc_updated', 'announcement',
    'support_reply'
  )),
  params jsonb not null default '{}'::jsonb,
  link text check (link is null or link ~ '^/[a-z0-9/_\-?=&.%]*$'),
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index notifications_user_idx on app.notifications (user_id, created_at desc);
create index notifications_unread_idx on app.notifications (user_id) where read_at is null;

create or replace function app.notify(p_user uuid, p_type text, p_params jsonb default '{}'::jsonb, p_link text default null)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_id uuid;
begin
  insert into app.notifications (user_id, type, params, link)
  values (p_user, p_type, coalesce(p_params, '{}'::jsonb), p_link)
  returning id into v_id;
  perform app.emit_event('user:' || p_user, 'notification.created', jsonb_build_object('id', v_id, 'type', p_type));
  return v_id;
end;
$$;

create table app.announcements (
  id uuid primary key default gen_random_uuid(),
  title jsonb not null check (app.has_all_locales(title)),
  body jsonb not null check (app.has_all_locales(body)),
  published_by uuid not null references app.profiles(id),
  published_at timestamptz not null default now()
);

create table app.audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid references app.profiles(id),
  actor_roles text[] not null default '{}',
  action text not null check (action ~ '^[a-z_]+(\.[a-z_]+)+$'),
  entity_type text not null,
  entity_id text,
  before_state jsonb,
  after_state jsonb,
  reason text,
  request_id text,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index audit_logs_entity_idx on app.audit_logs (entity_type, entity_id, created_at desc);
create index audit_logs_actor_idx on app.audit_logs (actor_id, created_at desc);
create index audit_logs_created_idx on app.audit_logs (created_at desc);
create trigger audit_logs_immutable before update or delete on app.audit_logs
  for each row execute function app.forbid_mutation();

-- Four-eyes approvals: the requester can never approve their own request.
create table app.admin_approvals (
  id uuid primary key default gen_random_uuid(),
  action_type text not null check (action_type in (
    'settings.update', 'fee_rule.create', 'ledger.adjustment', 'role.grant', 'role.revoke', 'user.reinstate'
  )),
  payload jsonb not null,
  reason text not null check (char_length(reason) between 3 and 1000),
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'executed', 'failed', 'expired')),
  requested_by uuid not null references app.profiles(id),
  decided_by uuid references app.profiles(id),
  decided_at timestamptz,
  decision_note text,
  executed_at timestamptz,
  result jsonb,
  expires_at timestamptz not null default now() + interval '7 days',
  created_at timestamptz not null default now(),
  check (decided_by is null or decided_by <> requested_by)
);
create index admin_approvals_pending_idx on app.admin_approvals (created_at desc) where status = 'pending';

insert into app.status_transitions (entity, from_status, to_status) values
  ('admin_approval', '_new', 'pending'),
  ('admin_approval', 'pending', 'approved'),
  ('admin_approval', 'pending', 'rejected'),
  ('admin_approval', 'pending', 'expired'),
  ('admin_approval', 'approved', 'executed'),
  ('admin_approval', 'approved', 'failed');
create trigger admin_approvals_status before insert or update on app.admin_approvals
  for each row execute function app.enforce_status_transition('admin_approval');

-- HTTP idempotency (Idempotency-Key header) for every financial POST.
create table app.idempotency_keys (
  user_id uuid not null,
  scope text not null,
  key text not null check (char_length(key) between 16 and 128),
  request_hash text not null,
  status text not null default 'in_progress' check (status in ('in_progress', 'completed')),
  response_status int,
  response_body jsonb,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  primary key (user_id, scope, key)
);
create index idempotency_keys_created_idx on app.idempotency_keys (created_at);

-- Fixed-window rate limiter shared by all serverless instances.
create table app.rate_limit_buckets (
  bucket text primary key,
  window_start timestamptz not null,
  hits int not null
);

create or replace function app.rate_limit_hit(p_bucket text, p_window_seconds int, p_max int)
returns table (allowed boolean, remaining int, reset_at timestamptz)
language plpgsql
as $$
declare
  v_window_start timestamptz := to_timestamp(floor(extract(epoch from now()) / p_window_seconds) * p_window_seconds);
  v_hits int;
begin
  insert into app.rate_limit_buckets as b (bucket, window_start, hits)
  values (p_bucket, v_window_start, 1)
  on conflict (bucket) do update
    set hits = case when b.window_start = excluded.window_start then b.hits + 1 else 1 end,
        window_start = excluded.window_start
  returning hits into v_hits;
  return query select v_hits <= p_max, greatest(p_max - v_hits, 0), v_window_start + make_interval(secs => p_window_seconds);
end;
$$;

create table app.support_tickets (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique default app.new_reference('SUP'),
  user_id uuid not null references app.profiles(id),
  subject text not null check (char_length(subject) between 3 and 140),
  category text not null check (category in ('account', 'deposit', 'withdrawal', 'investment', 'referral', 'security', 'other')),
  status text not null default 'open' check (status in ('open', 'awaiting_user', 'resolved', 'closed')),
  assigned_to uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index support_tickets_user_idx on app.support_tickets (user_id, created_at desc);
create index support_tickets_open_idx on app.support_tickets (status, updated_at desc) where status in ('open', 'awaiting_user');
create trigger support_tickets_touch before update on app.support_tickets for each row execute function app.touch_updated_at();

create table app.support_messages (
  id uuid primary key default gen_random_uuid(),
  ticket_id uuid not null references app.support_tickets(id),
  author_id uuid not null references app.profiles(id),
  author_is_staff boolean not null,
  body text not null check (char_length(body) between 1 and 5000),
  created_at timestamptz not null default now()
);
create index support_messages_ticket_idx on app.support_messages (ticket_id, created_at);
create trigger support_messages_immutable before update or delete on app.support_messages
  for each row execute function app.forbid_mutation();

-- Transactional outbox: emails are written in the same DB transaction as the
-- event that triggers them and dispatched afterwards (with retries).
create table app.email_outbox (
  id uuid primary key default gen_random_uuid(),
  to_email text not null,
  template text not null check (template ~ '^[a-z_]+$'),
  locale text not null check (locale in ('en', 'ru', 'ar')),
  params jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued', 'sending', 'sent', 'failed')),
  attempts int not null default 0,
  last_error text,
  provider_message_id text,
  send_after timestamptz not null default now(),
  created_at timestamptz not null default now(),
  sent_at timestamptz
);
create index email_outbox_queue_idx on app.email_outbox (send_after) where status in ('queued', 'failed');

create table app.job_runs (
  id bigint generated always as identity primary key,
  job_name text not null,
  status text not null check (status in ('running', 'succeeded', 'failed')),
  result jsonb,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);
create index job_runs_name_idx on app.job_runs (job_name, started_at desc);

create table app.asset_prices (
  asset_code text not null references app.assets(code),
  quote_currency text not null default 'USD' check (quote_currency ~ '^[A-Z]{3}$'),
  price numeric(38, 18) not null check (price >= 0),
  source text not null,
  captured_at timestamptz not null default now(),
  primary key (asset_code, quote_currency, captured_at)
);

create or replace function app.latest_price(p_asset text, p_quote text default 'USD')
returns table (price numeric, captured_at timestamptz, source text)
language sql
stable
as $$
  select price, captured_at, source from app.asset_prices
  where asset_code = p_asset and quote_currency = p_quote
  order by captured_at desc limit 1;
$$;

-- Wallet screening denylist (internal). External screening providers are
-- called by the backend; this list always applies on top of them.
create table app.address_denylist (
  network_code text not null references app.networks(code),
  address text not null,
  reason text not null,
  added_by uuid references app.profiles(id),
  created_at timestamptz not null default now(),
  primary key (network_code, address)
);
