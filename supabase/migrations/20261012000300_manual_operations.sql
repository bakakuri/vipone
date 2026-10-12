-- Ledgerline — manual operations, USDT on BEP20
--
-- The operator handles money by hand:
--   * deposits: users send USDT (BEP20) to an address published in
--     Admin → Deposits → Deposit methods and report the payment; staff credit
--     it after checking BscScan (no personal addresses, no automatic credit);
--   * withdrawals: users enter a BEP20 address and an amount; staff pay it out
--     and mark the request as paid with the transaction hash.
-- Identity verification is not required and new addresses need no waiting
-- period, because every withdrawal is reviewed and paid by a person.

-- BNB Smart Chain (BEP20) ------------------------------------------------------------
insert into app.networks (code, name, family, address_pattern, memo_required, memo_pattern, memo_label,
                          explorer_tx_url, explorer_address_url, required_confirmations, is_active)
values ('BSC', 'BEP20 (BNB Smart Chain)', 'evm', '^0x[0-9a-fA-F]{40}$', false, null, null,
        'https://bscscan.com/tx/{tx}', 'https://bscscan.com/address/{address}', 15, true)
on conflict (code) do nothing;

insert into app.asset_networks (asset_code, network_code, token_standard, token_contract, min_deposit, min_withdrawal, withdrawal_network_fee)
values ('USDT', 'BSC', 'BEP-20', '0x55d398326f99059fF775485246999027B3197955', 10, 10, 1)
on conflict (asset_code, network_code) do nothing;

-- Only USDT on BEP20 is offered for deposits and withdrawals.
update app.asset_networks
set deposit_enabled = (asset_code = 'USDT' and network_code = 'BSC'),
    withdrawal_enabled = (asset_code = 'USDT' and network_code = 'BSC');
update app.assets set is_active = (code = 'USDT');

-- Settings for manual operations (kept in the settings history) -----------------------
insert into app.system_settings (key, value, description, approval_policy) values
  ('deposits.automatic', 'false', 'Automatic deposits: personal addresses from the address pool, credited from signed blockchain events. Off: users report payments to the published deposit methods and staff credit them.', 'always')
on conflict (key) do nothing;
select set_config('app.change_reason', 'Manual operations: no identity verification, no address waiting period', true);
update app.system_settings set value = '[]'::jsonb
where key = 'compliance.kyc_required_for' and value = '["deposit_address", "withdrawal", "investment"]'::jsonb;
update app.system_settings set value = '0'::jsonb
where key = 'withdrawal.new_address_cooldown_hours' and value = '24'::jsonb;

-- Leaving demo mode: the demo product closes and imported pool addresses are
-- retired, so no address that is not the operator's can ever be shown.
update app.investment_products set status = 'closed' where slug = 'demo-market-neutral' and status <> 'closed';
update app.deposit_address_pool set status = 'retired' where status = 'available';

-- Deposit reports may name the sending wallet (helps staff find the payment).
create or replace function app.submit_manual_deposit(p_user uuid, p_method uuid, p_amount numeric, p_tx_hash text, p_note text, p_from_address text)
returns app.deposits
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_row app.deposits;
  v_from text := nullif(btrim(coalesce(p_from_address, '')), '');
begin
  v_row := app.submit_manual_deposit(p_user, p_method, p_amount, p_tx_hash, p_note);
  if v_from is not null then
    update app.deposits set from_address = left(v_from, 128) where id = v_row.id returning * into v_row;
  end if;
  return v_row;
end;
$$;

-- Staff pay a withdrawal by hand and record it in one step: approval (two
-- approvers above the threshold), processing and completion with the payout
-- transaction hash. Ledger postings are the same as for a confirmed withdrawal.
create or replace function app.pay_withdrawal_manually(p_request uuid, p_actor uuid, p_tx_hash text)
returns app.withdrawal_requests
language plpgsql
security definer
set search_path = app, pg_temp
as $$
declare
  v_req app.withdrawal_requests;
  v_hash text := nullif(btrim(coalesce(p_tx_hash, '')), '');
  v_entries jsonb;
  v_settlement uuid;
begin
  select * into v_req from app.withdrawal_requests where id = p_request for update;
  if not found then
    perform app.raise_error('not_found', 'withdrawal');
  end if;
  if v_req.status = 'completed' then
    return v_req;
  end if;
  if v_hash is null then
    perform app.raise_error('tx_hash_required');
  end if;

  if v_req.status in ('pending', 'under_review') then
    v_req := app.approve_withdrawal(p_request, p_actor);
    if v_req.status <> 'approved' then
      return v_req; -- first of two approvals recorded; a second staff member completes it
    end if;
  elsif v_req.status not in ('approved', 'processing') then
    perform app.raise_error('invalid_status_transition', v_req.status || ' cannot be paid');
  end if;
  if v_req.status = 'approved' then
    perform app.start_withdrawal_processing(p_request, p_actor);
  end if;
  perform app.record_withdrawal_broadcast(p_request, v_hash, p_actor);
  select * into v_req from app.withdrawal_requests where id = p_request;

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
    'withdrawal_settlement', v_req.asset_code, 'withdrawal-settlement:' || v_req.id, 'admin',
    'withdrawal_request', v_req.id, v_entries, 'Withdrawal ' || v_req.reference || ' paid',
    jsonb_build_object('txHash', v_req.tx_hash), p_actor);
  if v_req.network_fee > 0 then
    perform app.post_ledger_transaction(
      'network_fee', v_req.asset_code, 'withdrawal-network-fee:' || v_req.id, 'system', 'withdrawal_request', v_req.id,
      jsonb_build_array(
        app.entry(app.system_account(v_req.asset_code, 'network_fee_expense'), 'debit', v_req.network_fee),
        app.entry(app.system_account(v_req.asset_code, 'custody'), 'credit', v_req.network_fee)
      ),
      'Network fee for ' || v_req.reference, jsonb_build_object('txHash', v_req.tx_hash), p_actor);
  end if;

  update app.withdrawal_requests
  set status = 'completed', completed_at = now(), settlement_transaction_id = v_settlement,
      actual_network_fee = v_req.network_fee, completion_source = 'manual_verification'
  where id = p_request returning * into v_req;

  perform app.notify(v_req.user_id, 'withdrawal_completed',
    jsonb_build_object('reference', v_req.reference, 'amount', v_req.net_amount::text, 'asset', v_req.asset_code,
                       'txHash', v_req.tx_hash),
    '/withdrawals');
  return v_req;
end;
$$;

-- Functions created after the RLS migration would otherwise be executable by
-- PUBLIC. Only the backend (schema owner / service_role) may call them.
revoke execute on function app.submit_manual_deposit(uuid, uuid, numeric, text, text) from public, anon, authenticated;
revoke execute on function app.submit_manual_deposit(uuid, uuid, numeric, text, text, text) from public, anon, authenticated;
revoke execute on function app.approve_manual_deposit(uuid, uuid, numeric, text) from public, anon, authenticated;
revoke execute on function app.pay_withdrawal_manually(uuid, uuid, text) from public, anon, authenticated;
grant execute on function app.submit_manual_deposit(uuid, uuid, numeric, text, text), app.submit_manual_deposit(uuid, uuid, numeric, text, text, text),
  app.approve_manual_deposit(uuid, uuid, numeric, text), app.pay_withdrawal_manually(uuid, uuid, text) to service_role;
alter default privileges in schema app revoke execute on functions from public;
