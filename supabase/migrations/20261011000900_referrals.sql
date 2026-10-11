-- Ledgerline — referral rewards
--
-- Rewards are an expense of the PLATFORM (account referral_expense), never a
-- deduction from another user's principal or profit. They are created as
-- `pending`, wait out a hold period, and are paid only when the platform's own
-- equity in that asset (fee revenue + contributed capital) covers them, so
-- user balances stay fully backed (setting referral.require_full_coverage).
-- One reward per (source, referrer, referred user).

create table app.referral_rewards (
  id uuid primary key default gen_random_uuid(),
  referrer_id uuid not null references app.profiles(id),
  referred_id uuid not null references app.profiles(id),
  source_type text not null check (source_type in ('deposit', 'investment_result')),
  source_id uuid not null,
  asset_code text not null references app.assets(code),
  base_amount numeric(38, 18) not null check (base_amount > 0),
  rate numeric(12, 8) not null check (rate > 0 and rate < 1),
  amount numeric(38, 18) not null check (amount > 0),
  status text not null check (status in ('pending', 'under_review', 'credited', 'cancelled')),
  status_reason text,
  release_at timestamptz not null,
  ledger_transaction_id uuid references app.ledger_transactions(id),
  reviewed_by uuid references app.profiles(id),
  credited_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (source_type, source_id, referrer_id, referred_id),
  check (referrer_id <> referred_id),
  check ((status = 'credited') = (ledger_transaction_id is not null))
);
create index referral_rewards_referrer_idx on app.referral_rewards (referrer_id, created_at desc);
create index referral_rewards_due_idx on app.referral_rewards (release_at) where status = 'pending';
create trigger referral_rewards_touch before update on app.referral_rewards for each row execute function app.touch_updated_at();

insert into app.status_transitions (entity, from_status, to_status) values
  ('referral_reward', '_new', 'pending'),
  ('referral_reward', '_new', 'under_review'),
  ('referral_reward', 'pending', 'credited'),
  ('referral_reward', 'pending', 'under_review'),
  ('referral_reward', 'pending', 'cancelled'),
  ('referral_reward', 'under_review', 'pending'),
  ('referral_reward', 'under_review', 'cancelled');
create trigger referral_rewards_status before insert or update on app.referral_rewards
  for each row execute function app.enforce_status_transition('referral_reward');

create or replace function app.referral_reward_signal()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' or new.status is distinct from old.status then
    perform app.emit_event('user:' || new.referrer_id, 'referral.updated', jsonb_build_object('id', new.id, 'status', new.status));
  end if;
  return null;
end;
$$;
create trigger referral_rewards_signal after insert or update on app.referral_rewards
  for each row execute function app.referral_reward_signal();

-- Called once, at registration, with the code the new user entered.
create or replace function app.register_referral(p_referred uuid, p_code text)
returns uuid
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_referrer uuid;
  v_referrer_ip text;
  v_referred_ip text;
begin
  select user_id into v_referrer from app.referral_codes where code = upper(trim(p_code));
  if not found then
    perform app.raise_error('referral_code_invalid');
  end if;
  if v_referrer = p_referred then
    perform app.raise_error('referral_self');
  end if;
  insert into app.referral_relationships (referred_user_id, referrer_user_id, code)
  values (p_referred, v_referrer, upper(trim(p_code)));

  select signup_ip_hash into v_referrer_ip from app.profiles where id = v_referrer;
  select signup_ip_hash into v_referred_ip from app.profiles where id = p_referred;
  if v_referrer_ip is not null and v_referrer_ip = v_referred_ip then
    insert into app.risk_flags (user_id, flag_type, severity, details)
    values (p_referred, 'shared_signup_ip_with_referrer', 'medium', jsonb_build_object('referrerId', v_referrer));
  end if;
  return v_referrer;
end;
$$;

-- Amount is computed by server/modules/referrals/calculate-referral-reward.js.
create or replace function app.create_referral_reward(
  p_referred uuid, p_source_type text, p_source_id uuid, p_asset text, p_base numeric, p_rate numeric, p_amount numeric
)
returns app.referral_rewards
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_rel app.referral_relationships;
  v_row app.referral_rewards;
  v_hold numeric := app.setting_numeric('referral.hold_days', 7);
  v_flagged boolean;
begin
  select * into v_rel from app.referral_relationships where referred_user_id = p_referred;
  if not found or p_amount <= 0 then
    return null;
  end if;
  select exists (select 1 from app.risk_flags where status = 'open' and user_id in (v_rel.referrer_user_id, p_referred))
    into v_flagged;

  insert into app.referral_rewards (referrer_id, referred_id, source_type, source_id, asset_code, base_amount, rate,
                                    amount, status, status_reason, release_at)
  values (v_rel.referrer_user_id, p_referred, p_source_type, p_source_id, p_asset, p_base, p_rate, p_amount,
          case when v_flagged then 'under_review' else 'pending' end,
          case when v_flagged then 'open_risk_flag' end,
          now() + make_interval(secs => (v_hold * 86400)::int))
  on conflict (source_type, source_id, referrer_id, referred_id) do nothing
  returning * into v_row;

  if v_row.id is not null then
    perform app.notify(v_row.referrer_id, 'referral_reward_pending',
      jsonb_build_object('amount', v_row.amount::text, 'asset', v_row.asset_code, 'releaseAt', v_row.release_at), '/referrals');
  end if;
  return v_row;
end;
$$;

create or replace function app.release_due_referral_rewards(p_limit int default 200)
returns table (reward_id uuid, outcome text)
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_r app.referral_rewards;
  v_tx uuid;
  v_source_ok boolean;
  v_equity numeric;
  v_require_coverage boolean := app.setting_bool('referral.require_full_coverage', true);
begin
  if not app.setting_bool('referral.enabled', true) then
    return;
  end if;
  for v_r in
    select * from app.referral_rewards
    where status = 'pending' and release_at <= now()
    order by release_at
    limit p_limit
    for update skip locked
  loop
    if v_r.source_type = 'deposit' then
      select exists (select 1 from app.deposits where id = v_r.source_id and status = 'credited') into v_source_ok;
    else
      select exists (select 1 from app.investment_results where id = v_r.source_id and status = 'posted') into v_source_ok;
    end if;
    if not v_source_ok then
      update app.referral_rewards set status = 'cancelled', status_reason = 'source_not_settled' where id = v_r.id;
      reward_id := v_r.id; outcome := 'cancelled'; return next; continue;
    end if;

    if exists (select 1 from app.profiles where id in (v_r.referrer_id, v_r.referred_id) and status in ('frozen', 'closed'))
       or exists (select 1 from app.risk_flags where status = 'open' and user_id in (v_r.referrer_id, v_r.referred_id)) then
      update app.referral_rewards set status = 'under_review', status_reason = 'risk_check' where id = v_r.id;
      reward_id := v_r.id; outcome := 'under_review'; return next; continue;
    end if;

    if v_require_coverage then
      -- Pay only from the platform's own equity (fee revenue, capital), so a
      -- reward can never be funded with other users' balances.
      select platform_equity into v_equity from app.asset_position(v_r.asset_code);
      if v_equity < v_r.amount then
        perform app.emit_event('admin:ops', 'referral.coverage_blocked',
          jsonb_build_object('asset', v_r.asset_code, 'equity', v_equity::text, 'reward', v_r.amount::text));
        reward_id := v_r.id; outcome := 'deferred_coverage'; return next; continue;
      end if;
    end if;

    v_tx := app.post_ledger_transaction(
      'referral_reward', v_r.asset_code, 'referral-reward:' || v_r.id, 'job', 'referral_reward', v_r.id,
      jsonb_build_array(
        app.entry(app.system_account(v_r.asset_code, 'referral_expense'), 'debit', v_r.amount),
        app.entry(app.user_account(v_r.referrer_id, v_r.asset_code, 'available'), 'credit', v_r.amount)
      ),
      'Referral reward', jsonb_build_object('sourceType', v_r.source_type, 'sourceId', v_r.source_id), null);
    update app.referral_rewards set status = 'credited', ledger_transaction_id = v_tx, credited_at = now() where id = v_r.id;
    perform app.notify(v_r.referrer_id, 'referral_reward_credited',
      jsonb_build_object('amount', v_r.amount::text, 'asset', v_r.asset_code), '/referrals');
    reward_id := v_r.id; outcome := 'credited'; return next;
  end loop;
end;
$$;

create or replace function app.review_referral_reward(p_reward uuid, p_decision text, p_actor uuid, p_reason text)
returns app.referral_rewards
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.referral_rewards;
begin
  select * into v_row from app.referral_rewards where id = p_reward for update;
  if not found then
    perform app.raise_error('not_found', 'referral reward');
  end if;
  if p_decision = 'release' then
    if v_row.status <> 'under_review' then
      perform app.raise_error('invalid_status_transition');
    end if;
    update app.referral_rewards set status = 'pending', status_reason = p_reason, reviewed_by = p_actor
    where id = p_reward returning * into v_row;
  elsif p_decision = 'cancel' then
    update app.referral_rewards set status = 'cancelled', status_reason = p_reason, reviewed_by = p_actor
    where id = p_reward returning * into v_row;
  else
    perform app.raise_error('invalid_decision');
  end if;
  return v_row;
end;
$$;
