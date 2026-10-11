-- Ledgerline — Row Level Security, grants and Realtime authorisation
--
-- The backend connects as the schema owner and is not affected by RLS. These
-- policies protect against any direct access with a user's JWT (Supabase
-- Data API, Realtime, a leaked publishable key): a user can only ever READ
-- their own rows, never write financial data. Staff read access is checked
-- through app.has_role().

-- Enable RLS on every table in the schema.
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app' loop
    execute format('alter table app.%I enable row level security', t.tablename);
  end loop;
end;
$$;

revoke all on all tables in schema app from public;
revoke all on all sequences in schema app from public;
revoke execute on all functions in schema app from public;

grant usage on schema app to anon, authenticated, service_role;
grant all on all tables in schema app to service_role;
grant usage, select on all sequences in schema app to service_role;
grant execute on all functions in schema app to service_role;
grant execute on function app.has_role(uuid, text[]), app.is_staff(uuid), app.has_all_locales(jsonb) to anon, authenticated;

-- Public reference data ------------------------------------------------------
grant select on app.assets, app.networks, app.asset_networks, app.legal_documents, app.asset_prices,
  app.investment_products, app.investment_product_assets, app.investment_product_versions, app.announcements
  to anon, authenticated;

create policy assets_public_read on app.assets for select to anon, authenticated using (is_active);
create policy networks_public_read on app.networks for select to anon, authenticated using (is_active);
create policy asset_networks_public_read on app.asset_networks for select to anon, authenticated using (true);
create policy legal_documents_public_read on app.legal_documents for select to anon, authenticated using (true);
create policy asset_prices_public_read on app.asset_prices for select to anon, authenticated using (true);
create policy products_public_read on app.investment_products for select to anon, authenticated
  using (status in ('active', 'paused'));
create policy product_assets_public_read on app.investment_product_assets for select to anon, authenticated
  using (exists (select 1 from app.investment_products p where p.id = product_id and p.status in ('active', 'paused')));
create policy product_versions_public_read on app.investment_product_versions for select to anon, authenticated
  using (exists (select 1 from app.investment_products p where p.id = product_id and p.status in ('active', 'paused')));
create policy announcements_auth_read on app.announcements for select to authenticated using (true);

-- Own rows -------------------------------------------------------------------
grant select on
  app.profiles, app.legal_acceptances, app.kyc_verifications, app.security_events, app.referral_codes,
  app.referral_relationships, app.fund_holds, app.deposit_addresses, app.deposits, app.withdrawal_wallets,
  app.wallet_address_history, app.withdrawal_quotes, app.withdrawal_requests, app.investment_positions,
  app.investment_events, app.referral_rewards, app.notifications, app.support_tickets, app.support_messages,
  app.ledger_accounts, app.ledger_balances, app.ledger_entries, app.ledger_transactions
  to authenticated;

create policy profiles_own on app.profiles for select to authenticated using (id = auth.uid());
create policy legal_acceptances_own on app.legal_acceptances for select to authenticated using (user_id = auth.uid());
create policy kyc_own on app.kyc_verifications for select to authenticated using (user_id = auth.uid());
create policy security_events_own on app.security_events for select to authenticated using (user_id = auth.uid());
create policy referral_codes_own on app.referral_codes for select to authenticated using (user_id = auth.uid());
create policy referral_relationships_own on app.referral_relationships for select to authenticated
  using (referrer_user_id = auth.uid() or referred_user_id = auth.uid());
create policy fund_holds_own on app.fund_holds for select to authenticated using (user_id = auth.uid());
create policy deposit_addresses_own on app.deposit_addresses for select to authenticated using (user_id = auth.uid());
create policy deposits_own on app.deposits for select to authenticated using (user_id = auth.uid());
create policy withdrawal_wallets_own on app.withdrawal_wallets for select to authenticated using (user_id = auth.uid());
create policy wallet_history_own on app.wallet_address_history for select to authenticated using (user_id = auth.uid());
create policy withdrawal_quotes_own on app.withdrawal_quotes for select to authenticated using (user_id = auth.uid());
create policy withdrawal_requests_own on app.withdrawal_requests for select to authenticated using (user_id = auth.uid());
create policy positions_own on app.investment_positions for select to authenticated using (user_id = auth.uid());
create policy investment_events_own on app.investment_events for select to authenticated
  using (exists (select 1 from app.investment_positions p where p.id = position_id and p.user_id = auth.uid()));
create policy referral_rewards_own on app.referral_rewards for select to authenticated using (referrer_id = auth.uid());
create policy notifications_own on app.notifications for select to authenticated using (user_id = auth.uid());
create policy support_tickets_own on app.support_tickets for select to authenticated using (user_id = auth.uid());
create policy support_messages_own on app.support_messages for select to authenticated
  using (exists (select 1 from app.support_tickets t where t.id = ticket_id and t.user_id = auth.uid()));
create policy ledger_accounts_own on app.ledger_accounts for select to authenticated using (user_id = auth.uid());
create policy ledger_balances_own on app.ledger_balances for select to authenticated
  using (exists (select 1 from app.ledger_accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy ledger_entries_own on app.ledger_entries for select to authenticated
  using (exists (select 1 from app.ledger_accounts a where a.id = account_id and a.user_id = auth.uid()));
create policy ledger_transactions_own on app.ledger_transactions for select to authenticated
  using (exists (select 1 from app.ledger_entries e join app.ledger_accounts a on a.id = e.account_id
                 where e.transaction_id = ledger_transactions.id and a.user_id = auth.uid()));

-- Staff read access ------------------------------------------------------------
do $$
declare
  t record;
begin
  for t in select tablename from pg_tables where schemaname = 'app'
             and tablename not in ('rate_limit_buckets', 'idempotency_keys', 'verification_codes') loop
    execute format('grant select on app.%I to authenticated', t.tablename);
    execute format(
      'create policy %I on app.%I for select to authenticated using (app.is_staff(auth.uid()))',
      t.tablename || '_staff_read', t.tablename);
  end loop;
end;
$$;

-- Supabase Realtime: private broadcast channels ----------------------------------
-- A user may subscribe only to "user:<their id>"; staff may also join "admin:ops".
do $$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists ledgerline_realtime_read on realtime.messages';
    execute $policy$
      create policy ledgerline_realtime_read on realtime.messages
      for select to authenticated
      using (
        realtime.messages.extension = 'broadcast'
        and (
          realtime.topic() = 'user:' || auth.uid()::text
          or (realtime.topic() = 'admin:ops' and app.is_staff(auth.uid()))
        )
      )
    $policy$;
  end if;
end;
$$;

-- TRUNCATE bypasses row-level triggers: guard every append-only table too.
do $$
declare
  t text;
begin
  foreach t in array array[
    'ledger_transactions', 'ledger_entries', 'ledger_balances', 'ledger_accounts', 'audit_logs', 'security_events',
    'legal_acceptances', 'system_settings_history', 'investment_events', 'investment_product_versions',
    'blockchain_events', 'wallet_address_history', 'support_messages', 'reconciliation_runs', 'treasury_transfers',
    'capital_contributions', 'referral_relationships', 'fee_rules'
  ] loop
    execute format('create trigger %I before truncate on app.%I for each statement execute function app.forbid_mutation()',
                   t || '_no_truncate', t);
  end loop;
end;
$$;
