-- Ledgerline — single operator
--
-- The operator runs the platform alone, so:
--   * a second staff member is no longer required (setting
--     security.require_second_approver, off). Requests that used to wait for
--     another person — setting changes, balance adjustments, role changes,
--     reinstating accounts, large withdrawals, investment results — are
--     carried out by the staff member who makes them, and every action is
--     still written to the audit log. Turning the setting on restores the
--     four-eyes rules everywhere;
--   * two-factor authentication and identity checks are optional: no setting
--     requires them any more (2FA stays available on the Security page).

insert into app.system_settings (key, value, description, approval_policy) values
  ('security.require_second_approver', 'false',
   'Four-eyes rule: sensitive actions (setting relaxations, balance adjustments, roles, large withdrawals, investment results) need a second staff member. Off: the staff member who acts carries them out; everything is still in the audit log.',
   'when_relaxing')
on conflict (key) do nothing;

select set_config('app.change_reason', 'Single operator: no two-factor or identity requirement', true);
update app.system_settings set value = 'false'::jsonb where key = 'withdrawal.require_mfa' and value <> 'false'::jsonb;
update app.system_settings set value = 'false'::jsonb where key = 'withdrawal.address_email_confirmation' and value <> 'false'::jsonb;
update app.system_settings set value = '[]'::jsonb where key = 'compliance.kyc_required_for' and value <> '[]'::jsonb;
update app.system_settings set value = '0'::jsonb where key = 'withdrawal.new_address_cooldown_hours' and value <> '0'::jsonb;

create or replace function app.second_approver_required()
returns boolean
language sql
stable
set search_path = app, pg_temp
as $$
  select app.setting_bool('security.require_second_approver', true);
$$;

-- The "different person" rules move from table constraints into the
-- functions above/below, where they follow the setting.
do $$
declare
  r record;
begin
  for r in
    select c.conrelid::regclass as tbl, c.conname
    from pg_constraint c
    where c.contype = 'c'
      and c.conrelid in ('app.admin_approvals'::regclass, 'app.withdrawal_requests'::regclass, 'app.investment_results'::regclass)
      and (pg_get_constraintdef(c.oid) ~ 'decided_by <> requested_by'
        or pg_get_constraintdef(c.oid) ~ 'second_approved_by <> approved_by'
        or pg_get_constraintdef(c.oid) ~ 'completion_verified_by <> processed_by'
        or pg_get_constraintdef(c.oid) ~ 'approved_by <> created_by')
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
  end loop;
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
  if v_req.user_id = p_actor and app.second_approver_required() then
    perform app.raise_error('cannot_approve_own_request');
  end if;

  if v_req.requires_dual_approval and app.second_approver_required() then
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
    -- One approval is enough (single operator); a first approval given while
    -- two were required is kept.
    update app.withdrawal_requests
    set approved_by = coalesce(approved_by, p_actor), approved_at = coalesce(approved_at, now()),
        status = 'approved', status_reason = null
    where id = p_request returning * into v_req;
  end if;

  perform app.notify(v_req.user_id, 'withdrawal_approved',
    jsonb_build_object('reference', v_req.reference, 'amount', v_req.amount::text, 'asset', v_req.asset_code),
    '/withdrawals');
  return v_req;
end;
$$;

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
  if p_source = 'manual_verification' and (p_actor is null or (p_actor = v_req.processed_by and app.second_approver_required())) then
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

create or replace function app.approve_investment_result(p_result uuid, p_actor uuid)
returns app.investment_results
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.investment_results;
begin
  select * into v_row from app.investment_results where id = p_result for update;
  if not found then
    perform app.raise_error('not_found', 'result');
  end if;
  if v_row.created_by = p_actor and app.second_approver_required() then
    perform app.raise_error('second_approver_required');
  end if;
  update app.investment_results set status = 'approved', approved_by = p_actor, approved_at = now()
  where id = p_result returning * into v_row;
  return v_row;
end;
$$;

revoke execute on function app.second_approver_required() from public, anon, authenticated;
grant execute on function app.second_approver_required() to service_role;
