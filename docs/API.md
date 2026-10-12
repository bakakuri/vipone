# API

Base URL: `/api/v1`. JSON in, JSON out. All amounts are **strings** (`"95.5"`), all timestamps ISO 8601 UTC.

## Conventions

**Success**

```json
{ "data": { … }, "meta": { "serverTime": "2026-10-11T09:30:00.000Z" } }
```

Lists return `{ "items": [ … ], "nextCursor": "…" | null }` inside `data`. Pass `?limit=` (1–100, default 25) and `?cursor=` for the next page (keyset pagination — stable while new rows arrive).

**Errors**

```json
{ "error": { "code": "insufficient_withdrawable_balance", "message": "…", "details": { … }, "requestId": "…" } }
```

`code` is stable and translated by the browser (`public/locales/*/errors.json`). Common codes: `validation_failed` (422, `details.fields`), `unauthenticated` / `session_expired` (401), `forbidden`, `csrf_failed`, `mfa_required`, `kyc_required`, `account_restricted` (403), `not_found` (404), `insufficient_funds`, `insufficient_withdrawable_balance`, `invalid_status_transition`, `idempotency_conflict` (409), `idempotency_key_required` (428), `rate_limited` (429, `Retry-After`), `feature_unavailable` (503). The full list is in `server/core/errors.js`.

**Session.** Sign-in sets three cookies (prefixed `__Host-` on HTTPS): `ll_at` (access token, HttpOnly), `ll_rt` (refresh token, HttpOnly, rotated on use, reuse revokes the family), `ll_csrf` (readable). All are `Secure` and `SameSite=Strict`. JavaScript never sees a token.

**CSRF.** Every `POST`/`PATCH`/`PUT`/`DELETE` must send `X-CSRF-Token` equal to the `ll_csrf` cookie, and the `Origin` must be in `ALLOWED_ORIGINS`. Webhooks and jobs are exempt and authenticate by signature / secret.

**Idempotency.** Routes marked *Idempotency-Key* require an `Idempotency-Key` header (8–200 characters, a new UUID per user action). Retrying with the same key and body returns the original response; the same key with a different body fails with `idempotency_key_reuse`; a retry while the first request is running gets `request_in_progress`.

**Two-factor policy.** Routes marked *2FA policy* require a session signed in with two-factor authentication (`aal2`) while the setting `withdrawal.require_mfa` is on; otherwise they fail with `mfa_required` / `mfa_setup_required`.

**Staff permissions.** `staff: x` means the caller needs a role that grants permission `x` (`server/policies/permissions.js`). Some admin actions — settings, fee rules, role changes, ledger adjustments, large withdrawals — do not execute immediately: they create a four-eyes approval that a *different* staff member must approve under `/admin/approvals`.

**Rate limits.** Global: 600 requests/minute per IP. Tighter limits on sign-in, registration, password reset, codes, quotes and withdrawals (per IP and per user). Production stores counters in Postgres so they hold across function instances.

**Live updates.** `GET /live/config` tells the browser which transport to use. With Supabase, `GET /live/token` returns a short-lived token for the private Realtime channel `user:<id>` (staff also `admin:ops`). Without Supabase, `GET /live/stream` is a Server-Sent Events stream. Events contain only ids and statuses.

## Endpoints

### Health

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/health` | public |  |

### Public data

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/public/config` | public |  |
| GET | `/public/assets` | public |  |
| GET | `/public/products` | public |  |
| GET | `/public/products/:slug` | public |  |
| GET | `/public/legal` | public |  |
| GET | `/public/stats` | public |  |

### Authentication

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/auth/register` | public |  |
| POST | `/auth/login` | public |  |
| POST | `/auth/refresh` | public |  |
| POST | `/auth/logout` | signed in |  |
| GET | `/auth/session` | signed in |  |
| POST | `/auth/verify-email` | public |  |
| POST | `/auth/resend-confirmation` | public |  |
| POST | `/auth/password/forgot` | public |  |
| POST | `/auth/password/reset` | public |  |
| POST | `/auth/password/change` | signed in |  |
| POST | `/auth/mfa/enroll` | signed in |  |
| POST | `/auth/mfa/verify` | signed in |  |
| POST | `/auth/mfa/challenge` | signed in |  |
| POST | `/auth/mfa/disable` | signed in |  |

### Profile

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/profile` | signed in |  |
| PATCH | `/profile` | signed in |  |
| PATCH | `/profile/onboarding` | signed in |  |
| GET | `/profile/security-events` | signed in |  |
| POST | `/profile/kyc/start` | signed in |  |

### Dashboard

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/dashboard` | signed in |  |
| GET | `/dashboard/history` | signed in |  |

### Deposits

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/deposits` | signed in |  |
| GET | `/deposits/address` | signed in |  |
| POST | `/deposits/requests` | signed in | Idempotency-Key |
| GET | `/deposits/methods` | signed in | published methods and the page notice |
| POST | `/deposits/manual` | signed in | Idempotency-Key; reports a payment, credits nothing |
| GET | `/deposits/:id` | signed in |  |

### Withdrawal addresses

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/wallets` | signed in |  |
| GET | `/wallets/history` | signed in |  |
| POST | `/wallets` | signed in | 2FA policy |
| POST | `/wallets/:id/confirm` | signed in |  |
| POST | `/wallets/:id/resend-code` | signed in |  |
| POST | `/wallets/:id/default` | signed in |  |
| DELETE | `/wallets/:id` | signed in |  |

### Withdrawals

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/withdrawals` | signed in |  |
| POST | `/withdrawals/quote` | signed in |  |
| POST | `/withdrawals` | signed in | Idempotency-Key, 2FA policy |
| GET | `/withdrawals/:id` | signed in |  |
| POST | `/withdrawals/:id/cancel` | signed in |  |

### Investments

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/investments/products` | signed in |  |
| GET | `/investments/positions` | signed in |  |
| GET | `/investments/positions/:id` | signed in |  |
| POST | `/investments/positions` | signed in | Idempotency-Key |
| POST | `/investments/positions/:id/close` | signed in | Idempotency-Key |

### Earnings

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/earnings` | signed in |  |
| GET | `/earnings/summary` | signed in |  |

### Transactions

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/transactions` | signed in |  |
| GET | `/transactions/export.csv` | signed in |  |
| GET | `/transactions/:id` | signed in |  |

### Referrals

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/referrals` | signed in |  |
| GET | `/referrals/rewards` | signed in |  |

### Notifications

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/notifications` | signed in |  |
| GET | `/notifications/unread-count` | signed in |  |
| POST | `/notifications/read-all` | signed in |  |
| POST | `/notifications/:id/read` | signed in |  |

### Support

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/support/tickets` | signed in |  |
| POST | `/support/tickets` | signed in |  |
| GET | `/support/tickets/:id` | signed in |  |
| POST | `/support/tickets/:id/messages` | signed in |  |

### Live updates

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/live/config` | signed in |  |
| GET | `/live/token` | signed in |  |
| GET | `/live/stream` | signed in |  |

### Client error reports

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/client-errors` | public |  |

### Webhooks

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/webhooks/blockchain/generic` | signature |  |
| POST | `/webhooks/blockchain/alchemy` | signature |  |
| POST | `/webhooks/kyc/sumsub` | signature |  |

### Scheduled jobs

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/jobs/group/:group` | cron secret |  |
| GET | `/jobs/:name` | cron secret |  |

### Admin — dashboard

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/dashboard` | staff: `dashboard.read` |  |

### Admin — users

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/users` | staff: `users.read` |  |
| GET | `/admin/users/risk-flags` | staff: `users.read` |  |
| POST | `/admin/users/risk-flags/:id/resolve` | staff: `risk.manage` |  |
| GET | `/admin/users/:id` | staff: `users.read` |  |
| POST | `/admin/users/:id/status` | staff: `users.restrict` |  |
| POST | `/admin/users/:id/kyc` | staff: `kyc.review` |  |
| POST | `/admin/users/:id/roles` | staff: `users.roles.manage` |  |

### Admin — deposits

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/deposits` | staff: `deposits.read` |  |
| GET | `/admin/deposits/address-pool` | staff: `deposits.read` |  |
| POST | `/admin/deposits/address-pool/import` | staff: `addresses.manage` |  |
| GET | `/admin/deposits/methods` | staff: `deposits.read` |  |
| POST | `/admin/deposits/methods` | staff: `deposit_methods.manage` | body up to 1 MB (QR image) |
| PATCH | `/admin/deposits/methods/:id` | staff: `deposit_methods.manage` |  |
| DELETE | `/admin/deposits/methods/:id` | staff: `deposit_methods.manage` | hides a method that has reports |
| GET | `/admin/deposits/:id` | staff: `deposits.read` |  |
| POST | `/admin/deposits/:id/review` | staff: `deposits.review` |  |
| POST | `/admin/deposits/:id/approve-manual` | staff: `deposits.review` | amount, txHash, reason |
| POST | `/admin/deposits/:id/return` | staff: `deposits.return` |  |

### Admin — withdrawals

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/withdrawals` | staff: `withdrawals.read` |  |
| GET | `/admin/withdrawals/:id` | staff: `withdrawals.read` |  |
| POST | `/admin/withdrawals/:id/review` | staff: `withdrawals.review` |  |
| POST | `/admin/withdrawals/:id/approve` | staff: `withdrawals.approve` |  |
| POST | `/admin/withdrawals/:id/reject` | staff: `withdrawals.review` |  |
| POST | `/admin/withdrawals/:id/process` | staff: `withdrawals.process` |  |
| POST | `/admin/withdrawals/:id/broadcast` | staff: `withdrawals.process` |  |
| POST | `/admin/withdrawals/:id/complete` | staff: `withdrawals.process` |  |
| POST | `/admin/withdrawals/:id/fail` | staff: `withdrawals.process` |  |

### Admin — investments

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/investments/products` | staff: `investments.read` |  |
| POST | `/admin/investments/products` | staff: `investments.products.manage` |  |
| PATCH | `/admin/investments/products/:id` | staff: `investments.products.manage` |  |
| POST | `/admin/investments/products/:id/status` | staff: `investments.products.manage` |  |
| GET | `/admin/investments/results` | staff: `investments.read` |  |
| POST | `/admin/investments/results` | staff: `investments.results.create` |  |
| GET | `/admin/investments/results/:id/preview` | staff: `investments.read` |  |
| POST | `/admin/investments/results/:id/approve` | staff: `investments.results.approve` |  |
| POST | `/admin/investments/results/:id/reject` | staff: `investments.results.approve` |  |
| POST | `/admin/investments/results/:id/post` | staff: `investments.results.approve` |  |

### Admin — referrals

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/referrals/rewards` | staff: `referrals.read` |  |
| GET | `/admin/referrals/relationships` | staff: `referrals.read` |  |
| GET | `/admin/referrals/suspicious` | staff: `referrals.read` |  |
| POST | `/admin/referrals/rewards/:id/review` | staff: `referrals.review` |  |

### Admin — settings

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/settings` | staff: `settings.read` |  |
| GET | `/admin/settings/fee-rules` | staff: `settings.read` |  |
| POST | `/admin/settings/fee-rules` | staff: `settings.request` |  |
| POST | `/admin/settings/adjustments` | staff: `treasury.manage` |  |
| GET | `/admin/settings/:key/history` | staff: `settings.read` |  |
| POST | `/admin/settings/:key` | staff: `settings.request` |  |

### Admin — approvals

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/approvals` | staff: `approvals.read` |  |
| POST | `/admin/approvals/:id/approve` | staff: `approvals.decide` |  |
| POST | `/admin/approvals/:id/reject` | staff: `approvals.decide` |  |

### Admin — treasury

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/treasury` | staff: `treasury.manage` |  |
| GET | `/admin/treasury/reconciliations` | staff: `treasury.manage` |  |
| POST | `/admin/treasury/reconcile` | staff: `reconciliation.run` |  |
| POST | `/admin/treasury/transfer` | staff: `treasury.manage` | Idempotency-Key |
| POST | `/admin/treasury/capital` | staff: `treasury.manage` | Idempotency-Key |
| GET | `/admin/treasury/integrity` | staff: `treasury.manage` |  |

### Admin — audit

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/audit` | staff: `audit.read` |  |

### Admin — support

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/support` | staff: `support.manage` |  |
| GET | `/admin/support/:id` | staff: `support.manage` |  |
| POST | `/admin/support/:id/messages` | staff: `support.manage` |  |
| POST | `/admin/support/:id/status` | staff: `support.manage` |  |

### Admin — announcements

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/announcements` | staff: `announcements.manage` |  |
| POST | `/admin/announcements` | staff: `announcements.manage` |  |

### Admin — system

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| GET | `/admin/system/health` | staff: `dashboard.read` |  |

### Admin — demo

| Method | Path | Access | Notes |
| --- | --- | --- | --- |
| POST | `/admin/demo/simulate-deposit` | staff: `demo.tools` |  |
| POST | `/admin/demo/advance-confirmations` | staff: `demo.tools` |  |
| POST | `/admin/demo/confirm-withdrawal` | staff: `demo.tools` |  |
