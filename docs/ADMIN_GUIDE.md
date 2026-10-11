# Admin guide

The admin area is at `/admin`. It is visible only to staff, and in production every staff member must sign in with two-factor authentication.

## Roles

| Role | Typical person | Can |
| --- | --- | --- |
| `support` | customer support | read users, deposits, withdrawals, investments, referrals; answer tickets; publish announcements |
| `compliance` | compliance / AML officer | + review KYC, restrict/freeze users, resolve risk flags, review deposits and referral rewards, review withdrawals, read the audit log, request settings changes, decide approvals |
| `finance` | treasury / operations | + approve and process withdrawals, manage the deposit address pool, return suspense funds, record and approve investment results, reconcile, treasury transfers and capital, request settings changes, decide approvals, demo tools |
| `super_admin` | owner | everything, including products, roles and fee rules |

The exact matrix is in `server/policies/permissions.js`.

### Making the first administrator

There is no built-in admin account. Register normally, confirm your email, then from a machine with the production `DATABASE_URL`:

```bash
npm run admin:grant -- you@your-domain.com super_admin
```

Sign in again, set up two-factor authentication on the Security page and open `/admin`. Grant further roles from **Users → user → Roles**; each grant needs a second super administrator's approval (so create two super administrators early).

## Four-eyes approvals

These actions create a request in **Approvals** instead of happening immediately; a *different* staff member with the right role must approve it:

| Action | Approver role |
| --- | --- |
| change a setting that relaxes a safeguard (e.g. re-enable withdrawals, lower 2FA requirement) or any setting marked "always" | super_admin |
| new fee rule (e.g. change the 3% withdrawal fee) | super_admin |
| ledger adjustment | finance or super_admin |
| grant / revoke a staff role | super_admin |
| reinstate a restricted or frozen user | compliance or super_admin |
| withdrawal at or above the dual-approval threshold | second finance approver |
| investment result | second finance approver |

Pending approvals expire after their time limit. Tightening a safeguard (pausing withdrawals, raising a limit's strictness) takes effect immediately.

## Daily routine

1. **Overview** — users, deposits and withdrawals in progress, referral rewards, ledger activity, open risk flags, pending approvals, a 14-day activity chart and, per asset, platform assets versus what is owed to users.
2. **Deposits** — handle *Under review* items (screening hit, below minimum, unsupported asset, frozen account): *Approve* (credit), *Hold* (keep reviewing) or *Reject* with a reason. Rejected or uncreditable funds sit in suspense; return them with **Return** and the on-chain transaction hash.
3. **Withdrawals** — see below.
4. **Support** — answer tickets; set *Awaiting user* / *Resolved*.
5. **System** — failed jobs, queued emails, database latency.

## Withdrawals

```
Pending ─► (Review) Under review ─► Approve ─► Process ─► Record broadcast (tx hash) ─► Complete
                                     │                                      └─► Fail (funds not sent)
                                     └─► Reject (reason) — funds return to the user
```

1. **Review** the request: user status and KYC, address age and history, recent deposits, risk flags, the quote (amount, 3% fee, network fee, net).
2. **Approve.** Above the threshold (default 10,000 USDT/USDC, 0.2 BTC, 3 ETH) a second, different finance member must also approve. You cannot approve a request you created.
3. **Process** marks it as being sent. Send **the net amount** from the custody wallet (outside the platform — the platform never holds private keys).
4. **Record broadcast** with the transaction hash.
5. **Complete** happens automatically when the signed blockchain event confirms the hash; otherwise a second staff member verifies it on the explorer and completes it, optionally entering the network fee actually paid.
6. If the transfer could not be sent, **Fail** it (you must confirm the funds were not sent); the gross amount returns to the user's available balance.

## Deposit address pool

**Deposits → Address pool** shows available/assigned addresses per network. Generate addresses **offline or with your custody provider** — never on the web server — and import them:

- one address per line for networks with per-user addresses (Bitcoin, Ethereum, TRON), up to 5,000 at a time; each is format- and checksum-validated;
- for memo networks, one shared address plus the number of memos to create.

Keep at least a few hundred free addresses per active network and check the counts on this page regularly: when a network's pool is empty, new users cannot get a deposit address on it until you import more.

## Investment products

**Investments → Products** (super_admin). A product needs, in English, Russian and Arabic: name, summary, revenue model description and risk disclosure; plus term in days, min/max per position, capacity, performance fee, early-exit rules, risk level, legal reference and legal status. It can be **activated only with legal status *approved***. Editing terms creates a new version; open positions keep their original terms. Pause a product to stop new positions without affecting existing ones.

## Recording realised results

Only realised performance is ever credited. For each product, asset and period:

1. **Investments → Results → New** (finance): period start and end (not in the future, not overlapping a previous result), the realised gross rate (e.g. `1.8` for +1.8%, `-0.6` for a loss), the evidence reference (statement/report id) and a note.
2. **Preview** shows every eligible position with its share of the period, gross result, performance fee and net — check the totals against your statements.
3. A **different** finance member approves.
4. **Post** writes the ledger entries, updates positions, creates referral rewards (2% of each referred user's net profit) and notifies users. Positions waiting in *awaiting settlement* are released right after.

A wrong result cannot be edited after posting; correct it with an approved adjustment and a note.

## Referrals

**Referrals** lists relationships, rewards and suspicious patterns (shared sign-up IP, many referrals with tiny deposits, rewards on deposits later reviewed). Put a reward *under review* or *cancel* it with a reason. Rewards are paid only while the platform's own equity (fee revenue + contributed capital) covers them; if a reward is waiting for coverage, add capital under Treasury.

## Treasury and reconciliation

- **Reconcile** (at least daily in live mode): enter the observed custody and strategy balances per asset from your wallets / venues, with evidence. A difference beyond the tolerance **pauses withdrawals of that asset** and alerts everyone in the admin area. Investigate, fix (adjustment with approval if the books were wrong), reconcile again, then request re-enabling withdrawals.
- **Transfer** between custody and strategy when you move funds to or from the strategy venue.
- **Capital** records your own money added to custody (e.g. a referral budget).
- **Integrity check** runs the ledger self-check; it must return no problems.

## Settings

**Settings** lists every setting with its current value, description and history. Key ones:

| Setting | Default |
| --- | --- |
| `deposits.enabled`, `withdrawals.enabled` | on |
| `withdrawals.paused_assets` | none (set automatically on mismatch) |
| `funds.deposit_hold_days` | 7 |
| `withdrawal.new_address_cooldown_hours` | 24 |
| `withdrawal.dual_approval_threshold` | 10,000 USDT/USDC · 0.2 BTC · 3 ETH |
| `withdrawal.daily_limit` | 50,000 USDT/USDC · 1 BTC · 15 ETH |
| `withdrawal.quote_ttl_seconds` | 300 |
| `withdrawal.require_mfa` | on |
| `referral.deposit_rate` / `profit_rate` / `hold_days` | 5% / 2% / 7 |
| `compliance.kyc_required_for` | deposit address, withdrawal, investment (live mode) |
| `compliance.blocked_countries` | KP, IR, SY, CU — set with legal counsel |
| `support.contact_email` | empty — set before launch |

Fees are versioned **fee rules**: create a new rule (needs approval); the old one is closed, and past withdrawals keep the fee they were charged. Network fee estimates and minimums per asset/network are reference data in `app.asset_networks`; change them with a new migration (reviewed like code) so every change is versioned.

### Emergency stop

Turning off `withdrawals.enabled` (or pausing an asset) is immediate and needs no approval. Re-enabling needs a second approver.

## Users

Search by email, reference or id. The user page shows balances, deposits, withdrawals, positions, referral data, KYC, risk flags, security events and the audit trail. Actions: approve/reject KYC (manual mode), restrict / freeze / close (with reason), reinstate (approval), grant roles (approval). Staff never see passwords, 2FA secrets or full IP addresses.

## Announcements

Publish a title and message in all three languages (e.g. a maintenance window). It is delivered as a notification to every active and restricted user and recorded in the audit log.

## Audit log

Every staff action — who, what, when, before/after, reason, request id — filterable by actor, action and target. Entries cannot be edited or deleted.

## Demo tools (demo deployments only)

With `DEMO_TOOLS_ENABLED=true` and `APP_MODE=demo`, finance and super_admin see **Demo tools** on the deposit and withdrawal pages: simulate an incoming deposit, advance confirmations, confirm a withdrawal on the "chain". They produce signed events that go through the real pipeline. They do not exist in live mode.
