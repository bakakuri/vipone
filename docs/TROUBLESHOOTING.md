# Troubleshooting

Start with two places: `GET /api/v1/health` and **Admin → System** (database latency, job runs, queued emails, live transport). Vercel → *Logs* shows the server's structured JSON lines; filter by the `requestId` that error messages show to users.

## The site does not start / every API call fails with 500

**`Invalid configuration: …` in the function log.** The server validates its environment at start-up and lists every problem. Typical ones:

| Message | Fix |
| --- | --- |
| `APP_URL is required in production` | set `APP_URL=https://your-domain.com` |
| `IP_HASH_SECRET (32+ characters)` / `CRON_SECRET (32+ characters)` | generate with `openssl rand -hex 32` |
| `AUTH_PROVIDER=local is for development and tests only` | set `AUTH_PROVIDER=supabase` + `SUPABASE_URL` + `SUPABASE_PUBLISHABLE_KEY` |
| `EMAIL_FROM must be your own verified sender address` | e.g. `Brand <no-reply@your-domain.com>` |
| `APP_MODE=live requires …` | live mode needs every safeguard — see DEPLOYMENT.md §9; use `APP_MODE=demo` until then |

After changing variables in Vercel, **redeploy** — running deployments keep the old values.

**`database: error` in health / timeouts.**
- Use the *transaction pooler* URL (port 6543) for `DATABASE_URL` and keep `DB_PREPARE=false`. Errors like `prepared statement "…" already exists` mean prepared statements are on behind the pooler.
- URL-encode special characters in the password (`@` → `%40`, `#` → `%23`).
- Put the Vercel function region next to the Supabase region.
- `relation "app.…" does not exist` → migrations were not run against this database.

## Migrations

- **`checksum mismatch` for an applied file** — someone edited a migration that already ran. Restore the original file and put the change in a new migration.
- **Timeouts on the pooler** — run migrations with the session pooler (port 5432) or the direct connection: `MIGRATION_DATABASE_URL=… npm run db:migrate`.
- **Local PostgreSQL complains about `auth.users` or `realtime`** — use `npm run db:migrate:local`, which applies the Supabase shim first.

## Registration and sign-in

**No confirmation email.**
- Supabase → Authentication → SMTP: configure custom SMTP (the built-in sender sends only a few emails per hour, to team members).
- Check the provider's logs (Resend/Postmark) and that the sending domain is verified (SPF/DKIM).

**"This link is invalid or has expired."**
- The email template must link to `/verify-email?token_hash={{ .TokenHash }}&type=signup` (and `/reset-password?token_hash={{ .TokenHash }}&type=recovery`), not `{{ .ConfirmationURL }}`.
- Links are single-use; a second click shows this message. The page offers to resend.
- The Site URL and Redirect URLs in Supabase must be your real domain.

**Signed in, but immediately signed out / `csrf_failed` / `origin_not_allowed`.**
- `APP_URL` must match the address in the browser exactly (scheme + host). Opening the site on `www.` or on the `*.vercel.app` address while `APP_URL` is the apex domain fails the origin check. Redirect other hosts to the main one, or list them in `ALLOWED_ORIGINS`.
- Cookies are `Secure`: plain `http://` works only on `localhost`.

**"Two-factor sign-in required" when withdrawing or adding an address.** The current session was opened before 2FA was enabled. Sign out and in again with the code.

**Admin area says "no access".** The account needs a staff role (`npm run admin:grant`) **and**, in production, two-factor authentication — sign in again with the code after enabling it.

## Live updates

**The dot stays amber.**
- `GET /api/v1/live/config` should return the transport `supabase` in production.
- Supabase → Realtime: the migration `…001100_rls.sql` adds the policy on `realtime.messages`; re-run migrations if Realtime was enabled later.
- The CSP for static pages lives in `vercel.json`. Generated without `SUPABASE_URL` it allows `https://*.supabase.co` and `wss://*.supabase.co`, which covers standard project URLs. With a custom Supabase domain, run `SUPABASE_URL=https://… npm run vercel:config` and commit `vercel.json`.
- A corporate proxy blocking WebSockets: the page still works; it just refreshes on navigation.

## Scheduled jobs

**Admin → System shows no job runs.**
- Vercel Hobby runs cron jobs at most daily — the 5-minute jobs need `database/optional/pg_cron.sql` (or Pro with `CRON_PLAN=pro npm run vercel:config`).
- Vercel says *"Hobby accounts are limited to daily cron jobs"* on deploy — your `vercel.json` still has the `*/5` schedule. Regenerate it with `npm run vercel:config` (without `CRON_PLAN`) and commit.
- `CRON_SECRET` must be set in Vercel; without it the job routes answer `403` in production.
- pg_cron: check `select * from cron.job_run_details order by start_time desc limit 20;` and `select * from net._http_response order by created desc limit 20;`.

**A job shows `failed`.** The error column says why (e.g. RPC endpoint unreachable for `refresh-confirmations`). Jobs are idempotent; the next run retries.

## Deposits

| Symptom | Cause |
| --- | --- |
| "No address available" | the address pool for that network is empty — import addresses (Admin → Deposits → Address pool) |
| Nothing appears after sending | no signed webhook reached the server: check the Alchemy webhook (addresses added? signing key in `ALCHEMY_WEBHOOK_SIGNING_KEYS`? `ALCHEMY_NETWORK_MAP` has the network?) or your generic sender's signature |
| Stuck at "Detected"/"Confirming" | `CHAIN_RPC_URLS` missing or unreachable for that network, or the frequent job is not running |
| "Under review" | below minimum, unsupported asset, screening hit or frozen account — compliance decides in Admin → Deposits |
| Webhook returns 401 `invalid_signature` | wrong secret, or the body was modified (sign the exact raw bytes), or the timestamp is older than 5 minutes |

## Withdrawals

| Symptom | Cause |
| --- | --- |
| "Not enough withdrawable balance" with money on the dashboard | part of it is on the 7-day deposit hold or invested — the dashboard strip shows which |
| Address "cooling down" | new addresses wait 24 hours after confirmation |
| "Withdrawals are paused" | `withdrawals.enabled` off, or the asset was paused by a reconciliation mismatch — see Admin → Treasury |
| "Quote expired" | the review screen was open longer than 5 minutes; review again |
| Cannot approve | requests above the threshold need a second, different approver; nobody approves their own request |
| Stuck in "Processing" | record the broadcast hash; completion needs the chain event or a second staff verification |

## Referral rewards stay "pending"

The 7-day hold has not ended, the release job is not running, or the platform's own equity in that asset does not cover the reward (`deferred_coverage`). Add capital (Admin → Treasury → Capital) or review the reward.

## Front end

- **A page shows raw keys like `deposit:title`** — a translation is missing. Run `npm run check:i18n`; it lists every missing key per language.
- **Console shows CSP violations** — inline `<script>`, `style=""` attributes or `on…=` handlers are blocked by design. Move code into a module and styles into a CSS file.
- **New page returns 404 on Vercel** — add it to `server/config/site-routes.js`, run `npm run vercel:config`, commit `vercel.json`.
- **Old CSS/JS after deploy** — CSS, JS and translations are cached for 5 minutes (pages are revalidated on every load); wait or hard-refresh.

## Tests

- `TEST_DATABASE_ADMIN_URL` must be a superuser connection to a disposable PostgreSQL 15+ server (each test file creates and drops its own database).
- Browser tests need Playwright's Chromium: `npx playwright install chromium`, or point `PLAYWRIGHT_CHROMIUM_PATH` at an existing Chromium binary.
- Run one file: `node --test tests/integration/withdrawals.test.js`.

## Ledger integrity

`select * from app.verify_ledger_integrity();` (or Admin → Treasury → Integrity) must return no rows. If it returns anything, pause withdrawals, keep the output, and do not edit tables by hand — corrections are approved adjustments. Every change to the ledger is traceable through `app.audit_logs` and `app.ledger_transactions.idempotency_key`.
