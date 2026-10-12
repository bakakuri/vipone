# Security

## What we protect against

| Threat | Main controls |
| --- | --- |
| A user reading or changing someone else's data | every query scoped by the session's user id; ids in URLs are checked against ownership; RLS on every table as a second wall; tests in `tests/security/` |
| A user changing a balance from DevTools | balances exist only as ledger entries written by SQL functions; the browser sends intentions ("withdraw 100 using quote X"), never amounts to credit; the server recomputes everything |
| Double spending (double click, two tabs, replayed request) | `Idempotency-Key` on every money action; row locks on balances; the withdrawal moves funds to a hold in the same transaction; single-use quotes |
| Session theft through XSS | tokens only in `HttpOnly; Secure; SameSite=Strict` cookies; strict CSP (no inline script or style, `default-src 'self'`); DOM built without `innerHTML` |
| Cross-site request forgery | `SameSite=Strict` + double-submit CSRF token + `Origin` allow-list on every state-changing request |
| Credential stuffing, brute force | rate limits per IP and per account (stored in Postgres in production); generic sign-in errors; two-factor authentication |
| Account takeover → withdrawal | TOTP two-factor sign-in required for withdrawals and new addresses; email code + 24-hour cooldown on new addresses; new-device sign-in email; password change revokes other sessions |
| Insider abuse | role-based permissions; append-only audit log; four-eyes approval for large withdrawals, results, settings, fees, role changes, adjustments, reinstatements when `security.require_second_approver` is on (off for a single operator, who acts alone); optional 2FA for staff (`STAFF_MFA_REQUIRED=true` makes it mandatory) |
| Fake deposits | only signed blockchain webhooks (HMAC, constant-time compare, timestamp tolerance) create deposits; required confirmations; screening |
| Fake or inflated profits | results only from recorded, evidenced, second-approved realised performance; no client-side or scheduled "accrual" |
| Insolvency hidden by the books | reconciliation against observed wallet balances pauses withdrawals on mismatch; referral rewards only from platform equity; integrity check endpoint |
| Clickjacking, sniffing, downgrade | `X-Frame-Options: DENY` + `frame-ancestors 'none'`, `X-Content-Type-Options: nosniff`, HSTS (2 years, preload-ready) |
| Data leaks through errors | stable error codes only; stack traces, SQL and secrets never reach the browser; log redaction of tokens, passwords, cookies, keys |

## Authentication and sessions

- Supabase Auth (GoTrue) is called **only from the server** with the publishable key. The secret/service key is optional and server-only; it is never sent to the browser and never used in front-end code.
- Access tokens are verified locally against the project's JWKS (asymmetric keys) or the legacy JWT secret.
- Cookies: `ll_at` (short-lived access token — Supabase default 1 hour), `ll_rt` (refresh, 30 days, rotated on use), `ll_csrf` (readable, for the double-submit header). With HTTPS and no `COOKIE_DOMAIN` they get the `__Host-` prefix, which binds them to the exact host.
- Passwords: 12–128 characters, mixed case, digit, symbol, not the email name, not a common password; validated on the server (the browser only explains the rules). Hashing is done by Supabase Auth (bcrypt). The local development provider uses scrypt.
- Two-factor: TOTP (RFC 6238) through Supabase MFA. The sign-in becomes `aal2` after the code. Disabling 2FA needs a current code and sends an email.
- Email links use `token_hash` and are verified by the server; they expire and are single-use.
- Sign-in from a new device sends an email; security events (sign-in, password change, 2FA change, address change) are listed on the Security page.

## Authorisation

- Customers have no role; staff roles are `support`, `finance`, `compliance`, `super_admin`, mapped to fine-grained permissions in `server/policies/permissions.js`.
- Every admin route checks its own permission. Staff who turned 2FA on must use it (`aal2`); `STAFF_MFA_REQUIRED=true` makes it mandatory for all staff in production.
- The first super administrator is created from the command line (`npm run admin:grant`). There is **no default admin account and no hard-coded password** anywhere.
- Further role changes go through the admin panel (with a second approver while `security.require_second_approver` is on).

## Data protection

- Browser storage: `localStorage` holds only visual preferences (theme, language, sidebar state, dismissed hints, last chosen asset/network). Enforced by `core/storage.js` and a test that scans the code.
- IP addresses are stored only as HMAC hashes (`IP_HASH_SECRET`), enough to spot abuse without keeping the address.
- The platform never asks for, receives or stores seed phrases or private keys — not for deposit addresses (imported pool) and not for user addresses.
- Client error reports carry only the message, stack, page path (no query string) and browser; they are logged, not stored in the database.
- Supabase encrypts data at rest; connections use TLS.

## Secrets

All secrets come from environment variables (Vercel project settings / `.env` locally, which is git-ignored). `.env.example` contains names and placeholders only.

| Secret | Where it lives |
| --- | --- |
| `DATABASE_URL` | Vercel (server only) |
| `SUPABASE_SECRET_KEY` (if used), `SUPABASE_JWT_SECRET` (legacy) | Vercel (server only) |
| `SUPABASE_PUBLISHABLE_KEY` | server; safe to expose, but we keep it server-side too |
| `CRON_SECRET`, `IP_HASH_SECRET`, `BLOCKCHAIN_WEBHOOK_SECRET`, `ALCHEMY_WEBHOOK_SIGNING_KEYS`, provider API keys | Vercel (server only) |

Rotate a secret by adding the new value in Vercel and redeploying. Webhook signing keys accept a comma-separated list, so old and new can overlap during rotation.

## Headers (API and static files)

`Content-Security-Policy` (`default-src 'self'`; scripts, styles, fonts, images from self; `connect-src` self + the Supabase project for Realtime; `frame-ancestors 'none'`; `form-action 'self'`; `base-uri 'self'`; `object-src 'none'`), `Strict-Transport-Security`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `Permissions-Policy` (camera, microphone, geolocation, payment … disabled), `Cross-Origin-Opener-Policy: same-origin`, `Cross-Origin-Resource-Policy: same-origin`. API responses are `Cache-Control: no-store`. Static headers are written into `vercel.json` by `npm run vercel:config` from the same source.

## Logging and monitoring

- Structured JSON logs, one line per event, with request id; tokens, passwords, cookies, keys and codes are redacted.
- Unexpected errors are reported to `ERROR_WEBHOOK_URL` (Slack/Teams webhook or a monitoring relay), rate limited.
- Admin → System shows database latency, job runs, queued emails, open risk flags and the last reconciliation.
- Browser errors (`window.onerror`, unhandled rejections) are sent to `/api/v1/client-errors`.

## Before handling real money

The code enforces several of these (`APP_MODE=live` will not start without them), but most are organisational:

- [ ] Legal opinion and licences for every country you serve (e.g. MiCA CASP authorisation in the EU, VASP registration, securities/collective-investment rules for the investment products). Set `LEGAL_APPROVAL_CONFIRMED=true` only after this.
- [ ] Terms, privacy, cookie policy and risk disclosure reviewed by a lawyer (the included texts are templates).
- [ ] KYC provider (Sumsub) and wallet screening provider configured; AML policy, travel-rule process, sanctions list for blocked countries.
- [ ] Custody: addresses generated offline or by a qualified custodian; multi-signature or MPC for hot wallets; cold storage for the rest.
- [ ] Independent security review / penetration test of the deployed system.
- [ ] Supabase Point-in-Time Recovery on, restore tested; Vercel and Supabase accounts with 2FA and least-privilege team access.
- [ ] Incident response plan: who pauses withdrawals (Admin → Settings), who talks to users, how secrets are rotated.
- [ ] Staff trained on the four-eyes procedures; at least two people with each critical permission.

## Reporting a vulnerability

Publish a `security.txt` and a contact address before launch (e.g. `security@your-domain`). Do not run public bug bounties until the items above are complete.
