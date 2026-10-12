# Database

PostgreSQL 15+ (Supabase). Everything lives in the schema `app`. Migrations are in `supabase/migrations/` and are applied in file-name order by `npm run db:migrate` (or `supabase db push`). The runner stores each file's checksum in `public.ledgerline_migrations`; editing an applied migration makes the next run fail — write a new migration instead.

| Migration | Contents |
| --- | --- |
| `…000100_foundation` | extensions, `app.raise_error`, `touch_updated_at`, `forbid_mutation`, state-transition table and trigger, `emit_event` (pg_notify + Realtime) |
| `…000200_reference` | assets, networks, asset-network pairs, system settings with history, versioned fee rules, legal documents |
| `…000300_identity` | profiles, staff roles, legal acceptances, KYC, security events, risk flags, verification codes, referral codes and relationships |
| `…000400_ledger` | chart of accounts, ledger transactions and entries, balance cache, fund holds, posting and integrity functions |
| `…000500_platform` | notifications, announcements, audit log, four-eyes approvals, idempotency keys, rate-limit buckets, support, email outbox, job runs, prices, address denylist |
| `…000600_deposits` | deposit address pool, assigned addresses, raw blockchain events, deposits and their state machine, crediting |
| `…000700_withdrawals` | withdrawal wallets and address history, fee quotes, withdrawal requests and their state machine |
| `…000800_investments` | products, product versions (immutable terms), positions, realised results, position events |
| `…000900_referrals` | referral rewards |
| `…001000_treasury` | reconciliation runs, treasury transfers, capital contributions, approved adjustments |
| `…001100_rls` | Row Level Security on every table, grants, Realtime channel authorisation |
| `…001200_reference_data` | default assets, networks, limits, fees, settings and legal document rows |
| `20261012000100_deposit_methods` | deposit methods published by staff (address, memo, QR image, instructions), payments reported by users and their approval, settings `withdrawal.address_email_confirmation` and `deposits.page_notice` |
| `20261012000200_georgian` | Georgian (`ka`) allowed as profile, email and legal-document language; Georgian legal document rows; `ka` added to `languages.enabled` |
| `20261012000300_manual_operations` | network `BSC` and USDT BEP-20; only USDT/BEP20 enabled for deposits and withdrawals; setting `deposits.automatic` (false); KYC list emptied and address cooldown set to 0 when still at their defaults; demo product closed and demo address pool retired; `submit_manual_deposit` with the sender's wallet; `pay_withdrawal_manually`; execute on the new functions revoked from `public`/`anon`/`authenticated` |

`database/local/supabase-shim.sql` recreates the few Supabase objects the migrations reference (`auth.users`, `auth.uid()`, roles `anon`/`authenticated`/`service_role`, `realtime.messages`, `realtime.send`) so the same migrations run on plain PostgreSQL for local development and tests. It also holds `local_auth` (password hashes, refresh tokens, TOTP factors) for `AUTH_PROVIDER=local`. It is never applied to a real Supabase project.

## Money

- Amounts: `numeric(38, 18)`. Rates: `numeric(12, 8)`. Never `float`/`real`/`double precision`.
- Each asset has `decimals` (on-chain precision) and `display_decimals`. Results are truncated to the asset's decimals; fees round half-up.
- Values cross the API as strings (`"95.5"`), never JSON numbers.

## The ledger

A ledger transaction (`app.ledger_transactions`) has one asset, a type, an `idempotency_key` (unique) with a payload hash, a source and an optional reference (deposit, withdrawal request, position …). Its entries (`app.ledger_entries`) are debits and credits of positive amounts. A deferred constraint trigger rejects any transaction whose debits and credits differ or that has no entries. Entries, transactions and accounts can never be updated or deleted (`app.forbid_mutation`); a correction is a new transaction that reverses the old one.

### Chart of accounts (one set per asset)

| Owner | Account | Normal side | Meaning |
| --- | --- | --- | --- |
| user | `available` | credit | the user's spendable funds — a liability of the platform |
| user | `withdrawal_hold` | credit | funds reserved by open withdrawal requests |
| user | `invested` | credit | funds allocated to investment positions |
| system | `custody` | debit | assets in platform wallets |
| system | `strategy` | debit | assets deployed to investment strategies |
| system | `fee_revenue` | credit | platform fees earned |
| system | `network_fee_recovery` | credit | network fees charged to users |
| system | `network_fee_expense` | debit | network fees actually paid |
| system | `referral_expense` | debit | referral rewards paid by the platform |
| system | `suspense` | credit | funds received but not credited (to be returned) |
| system | `adjustments` | credit | approved manual corrections |
| system | `platform_capital` | credit | the operator's own funds added to custody |

User balances (`app.user_balances(user)`):

```
deposit_hold = min(available, active 7-day holds)
withdrawable = max(available − active holds, 0)
total        = available + withdrawal_hold + invested
```

### Main posting patterns

| Event | Debit | Credit |
| --- | --- | --- |
| deposit credited | custody | user available |
| withdrawal requested (gross G) | user available G | user withdrawal_hold G |
| withdrawal cancelled / rejected / failed | user withdrawal_hold G | user available G |
| withdrawal completed (G = net N + platform fee F + network fee W) | user withdrawal_hold G | custody N, fee_revenue F, network_fee_recovery W |
| network fee actually paid on chain | network_fee_expense | custody |
| position opened (amount A) | user available A, strategy A | user invested A, custody A |
| realised profit (gross P = net + performance fee) | strategy P | user invested (net), fee_revenue (fee) |
| realised loss L | user invested L | strategy L |
| position released / closed early (value V, early-exit fee E) | user invested V, custody V | user available V − E, fee_revenue E, strategy V |
| referral reward paid | referral_expense | user available |
| unknown sender / screening hit | custody | suspense |
| suspense returned | suspense | custody |
| treasury transfer (e.g. custody → strategy) | destination | source |
| approved adjustment (credit to user) | adjustments | user available |
| capital contribution | custody | platform_capital |

The SQL functions are authoritative; the table above is a summary.

## State machines

Allowed transitions are rows in `app.status_transitions`; a trigger rejects anything else.

| Entity | Transitions |
| --- | --- |
| deposit | created → awaiting_payment → detected → confirming → confirmed → credited; any of these → under_review / failed; under_review → confirming / confirmed / rejected / failed |
| withdrawal | pending → under_review → approved → processing → completed / failed; pending/under_review/approved → rejected; pending → cancelled |
| position | active → awaiting_settlement → matured; active → matured / closed_early |
| investment result | draft → approved → posted; draft / approved → rejected |
| referral reward | pending → credited / under_review / cancelled; under_review → pending / cancelled |
| admin approval | pending → approved → executed / failed; pending → rejected / expired |

## Important functions

| Function | Purpose |
| --- | --- |
| `post_ledger_transaction(type, asset, key, entries, …)` | the only way to write ledger entries; idempotent on key + payload hash |
| `user_balances(user)`, `account_balance(account)` | balances |
| `verify_ledger_integrity()` | cached balances vs entries, transaction balance, holds vs available |
| `assign_deposit_address`, `create_deposit_request` | address from the pool (or shared address + memo) |
| `record_chain_event`, `apply_incoming_event`, `credit_deposit` | signed blockchain event → deposit status → credit after confirmations and screening |
| `review_deposit`, `return_suspense_deposit` | compliance decisions |
| `submit_manual_deposit`, `approve_manual_deposit` | payments reported against a staff-published method (`deposit_methods`); credited only by staff with a checked amount and a unique transaction hash |
| `pay_withdrawal_manually(request, actor, tx_hash)` | manual payout: approve (four-eyes above the threshold), process, record the hash and complete in one transaction |
| `add_withdrawal_wallet`, `confirm_withdrawal_wallet`, … | address book with email code (optional, setting) and cooldown |
| `create_withdrawal` | quote check, limits, holds, MFA flag, moves funds to `withdrawal_hold` |
| `review_/approve_/reject_/start_withdrawal_processing`, `record_withdrawal_broadcast`, `complete_/fail_withdrawal`, `apply_outgoing_event` | staff processing with four-eyes for large amounts |
| `open_position`, `release_position`, `process_due_positions` | investments |
| `approve_investment_result`, `result_eligible_positions`, `post_investment_result` | realised results (maker-checker) |
| `register_referral`, `create_referral_reward`, `release_due_referral_rewards`, `review_referral_reward` | referrals |
| `run_reconciliation`, `treasury_transfer`, `post_adjustment`, `record_capital_contribution` | treasury |
| `setting`, `setting_numeric`, `setting_bool`, `setting_asset_numeric`, `active_fee_rule` | configuration |
| `emit_event`, `notify` | live events and in-app notifications |

## Row Level Security

RLS is enabled on every table in `app`. The API connects as the schema owner, so RLS does not affect it; RLS protects against direct access with a user's JWT:

- reference data (active assets, networks, products, legal documents) — readable by everyone; active deposit methods — readable by signed-in users
- a user's own rows (profile, balances, deposits, withdrawals, wallets, positions, rewards, notifications, tickets) — readable by that user only
- no policy grants `insert`/`update`/`delete` on any financial table to `anon` or `authenticated`
- staff read access goes through `app.has_role()` / `app.is_staff()`
- `realtime.messages`: a user may join only the private topic `user:<their id>`; `admin:ops` requires a staff role

`tests/security/access-control.test.js` checks these rules against a real database.

## Audit and history

- `app.audit_logs` — every staff action with actor, action, target, before/after, reason, request id, hashed IP
- `app.system_settings_history` — every setting change with the approval that allowed it
- `app.fee_rules` — versioned; a rule is closed (`effective_to`) and a new one created, so the fee of any past withdrawal stays provable
- `app.investment_product_versions` — the exact terms each position was opened under
- `app.wallet_address_history`, `app.security_events`, `app.job_runs`, `app.blockchain_events` (raw signed payloads)

## Backups

Supabase takes daily backups (Point-in-Time Recovery on paid plans — turn it on before handling real funds). Test a restore before launch. The ledger is append-only, so a restored database can be re-verified with `select * from app.verify_ledger_integrity()` (no rows = consistent).
