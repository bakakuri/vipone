# Deployment: Vercel + Supabase

Time needed: about an hour for a demo deployment. A live (real-money) deployment additionally needs the legal, KYC, screening and custody work listed in [SECURITY.md](SECURITY.md#before-handling-real-money).

## 0. What you need

- the repository on GitHub (or GitLab/Bitbucket)
- a **Supabase** project
- a **Vercel** project — **Pro plan** if you want Vercel Cron every 5 minutes (Hobby allows only daily cron jobs; use pg_cron instead, step 6)
- an email provider for transactional email (Resend or Postmark) and a domain you can add DNS records to
- for live mode only: Sumsub (KYC), a wallet-screening API, Alchemy (EVM webhooks) and RPC endpoints, CoinGecko API key, a custody setup

Pick the **same region** for both: e.g. Supabase `eu-central-1` (Frankfurt) with Vercel function region `fra1`; or `us-east-1` with `iad1`. Every API call talks to the database several times, so distance matters.

## 1. Supabase project

1. Create the project. Save the database password in your password manager.
2. **Project Settings → Database → Connection string**:
   - *Transaction pooler* (port **6543**) → `DATABASE_URL` for the app (serverless-friendly). Keep `DB_PREPARE=false`.
   - *Session pooler* (port **5432**) or the direct connection → `MIGRATION_DATABASE_URL` for migrations and `DATABASE_URL_DIRECT` (used only for the optional SSE fallback).
3. **Project Settings → API Keys**: copy the **publishable** key (`sb_publishable_…`) → `SUPABASE_PUBLISHABLE_KEY`, and the project URL → `SUPABASE_URL`. The secret key is not required by this app; never put it in front-end code. Prefer the new **asymmetric JWT signing keys** (JWKS) — then `SUPABASE_JWT_SECRET` is not needed.
4. **Data API**: keep only `public` in *Exposed schemas* — the app reaches the database directly, and the `app` schema does not need to be on the REST API. (RLS protects it either way.)

## 2. Database migrations

From your machine:

```bash
npm install
MIGRATION_DATABASE_URL='postgresql://postgres.<ref>:<password>@aws-0-<region>.pooler.supabase.com:5432/postgres' \
  npm run db:migrate
```

or with the Supabase CLI: `supabase link --project-ref <ref>` then `supabase db push` (same files in `supabase/migrations`).

Check: in the SQL editor, `select * from app.verify_ledger_integrity();` returns no rows, and `select key, value from app.system_settings;` lists the defaults.

## 3. Supabase Auth

**Authentication → Sign In / Providers → Email**
- Enable email provider, **Confirm email: on**, Secure email change: on, Secure password change: on
- Minimum password length: 12 (the server enforces the full policy anyway)

**Authentication → URL Configuration**
- Site URL: `https://your-domain.com` (same as `APP_URL`)
- Redirect URLs: `https://your-domain.com/verify-email`, `https://your-domain.com/reset-password`

**Authentication → Emails → SMTP Settings** — add your provider's SMTP (Resend: `smtp.resend.com`, port 465, user `resend`, password = API key). Supabase's built-in sender is for testing only and is heavily rate limited.

**Authentication → Emails → Templates** — the app verifies links on the server with `token_hash`, so change the links:

*Confirm signup*
```html
<h2>Confirm your email</h2>
<p><a href="{{ .SiteURL }}/verify-email?token_hash={{ .TokenHash }}&type=signup">Confirm my email</a></p>
<p>If you did not create an account, ignore this email.</p>
```

*Reset password*
```html
<h2>Reset your password</h2>
<p><a href="{{ .SiteURL }}/reset-password?token_hash={{ .TokenHash }}&type=recovery">Choose a new password</a></p>
<p>If you did not ask for this, ignore this email — your password stays the same.</p>
```

(For Russian and Arabic users you can add the text in all three languages to the same template; the app's own emails — address codes, deposits, withdrawals — are sent in each user's language.)

**Authentication → Multi-Factor**: TOTP enabled.

**Authentication → Rate Limits**: keep defaults or tighten; the app has its own limits too.

**Realtime → Settings**: turn **off** "Allow public access" so only private channels with authorisation work. The migration already added the policy that lets a user join only `user:<their id>`.

**Database → Backups**: enable Point-in-Time Recovery before handling real money.

## 4. Email for the app's own messages

Address confirmation codes, deposit/withdrawal emails and security alerts are sent by the app:

- Resend: verify your domain (SPF, DKIM), create an API key → `EMAIL_PROVIDER=resend`, `RESEND_API_KEY`, `EMAIL_FROM="Your Brand <no-reply@your-domain.com>"`
- or Postmark: `EMAIL_PROVIDER=postmark`, `POSTMARK_SERVER_TOKEN`

Add a DMARC record (`v=DMARC1; p=quarantine; rua=mailto:…`) for deliverability and anti-spoofing.

## 5. Vercel project

1. Before the first deploy, run `npm install` locally and commit `package-lock.json`, so Vercel installs exactly the versions you tested.
2. **Add New → Project →** import the repository. Framework preset: **Other**. Build command, output directory (`dist`), rewrites, headers and crons come from `vercel.json`.
3. **Settings → Functions → Function Region**: the region next to your Supabase database.
4. **Settings → Environment Variables** (Production; use separate values for Preview):

| Variable | Value |
| --- | --- |
| `NODE_ENV` | `production` |
| `APP_MODE` | `demo` (until everything for live is ready) |
| `APP_NAME` | your brand (max 40 characters) |
| `APP_URL` | `https://your-domain.com` |
| `DATABASE_URL` | transaction pooler URL (port 6543) |
| `DB_POOL_MAX` | `3`–`5` |
| `AUTH_PROVIDER` | `supabase` |
| `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY` | from step 1 |
| `IP_HASH_SECRET` | 32+ random characters (`openssl rand -hex 32`) |
| `CRON_SECRET` | 32+ random characters — Vercel sends it to the cron routes automatically |
| `EMAIL_PROVIDER`, `RESEND_API_KEY` / `POSTMARK_SERVER_TOKEN`, `EMAIL_FROM` | step 4 |
| `BLOCKCHAIN_WEBHOOK_SECRET` | 32+ random characters (generic signed webhooks) |
| `ALCHEMY_WEBHOOK_SIGNING_KEYS`, `ALCHEMY_NETWORK_MAP`, `CHAIN_RPC_URLS` | step 7 |
| `ERROR_WEBHOOK_URL` | optional Slack/Teams incoming webhook for error alerts |
| `DEMO_TOOLS_ENABLED` | `true` only for a demo deployment |

The full list with explanations is in `.env.example`. The server validates the combination at start-up and refuses unsafe ones (the error appears in the function log).

5. Deploy. Then add your domain under **Settings → Domains** and make sure `APP_URL` matches it exactly (cookies use the `__Host-` prefix and the CSRF check compares the `Origin`). If the site must also answer on other origins (e.g. `www`), list them in `ALLOWED_ORIGINS` — better: redirect `www` to the main domain in Vercel.

6. Check: `https://your-domain.com/api/v1/health` → `{"data":{"status":"ok","database":"ok",…}}`. Open the site, register, confirm the email.

## 6. Scheduled jobs

**Vercel Cron (Pro plan)** — already configured in `vercel.json`:

| Path | Schedule |
| --- | --- |
| `/api/v1/jobs/group/frequent` | every 5 minutes |
| `/api/v1/jobs/group/daily` | 03:00 UTC |

**Hobby plan or no Vercel Cron** — use Supabase pg_cron + pg_net: open `database/optional/pg_cron.sql`, put your URL in it, store `CRON_SECRET` in Supabase Vault as the file explains, run it in the SQL editor. Remove the `crons` block from `vercel.json` (or keep it as a daily backup).

Check **Admin → System**: job runs appear every 5 minutes.

## 7. Blockchain events

Deposits are credited only from signed events.

**EVM (Ethereum, ERC-20)** — Alchemy *Address Activity* webhook:
1. Create the webhook for each network, URL `https://your-domain.com/api/v1/webhooks/blockchain/alchemy`, add the addresses from your deposit pool (Alchemy API or dashboard; up to 100k addresses per webhook).
2. Copy the signing key → `ALCHEMY_WEBHOOK_SIGNING_KEYS` (comma-separated if several webhooks).
3. `ALCHEMY_NETWORK_MAP={"ETH_MAINNET":"ETHEREUM"}`.

**TRON, Bitcoin, others** — a custody provider or your own chain watcher posts to `https://your-domain.com/api/v1/webhooks/blockchain/generic`:

```
POST /api/v1/webhooks/blockchain/generic
X-Ledgerline-Signature: t=<unix seconds>,v1=<hex HMAC-SHA256(BLOCKCHAIN_WEBHOOK_SECRET, "<t>.<raw body>")>
X-Ledgerline-Provider: my-watcher
Content-Type: application/json

{ "events": [ {
  "id": "TRON:9f2c…:0:c1",          // unique per delivery
  "network": "TRON",
  "txHash": "9f2c…",
  "logIndex": 0,
  "toAddress": "T…",                 // your deposit address (or the source address for outgoing)
  "fromAddress": "T…",
  "asset": "USDT",                   // or "tokenContract": "TR7NHq…"
  "amount": "250.5",                 // decimal string, never a float
  "confirmations": 1,
  "blockNumber": 61234567,
  "reorged": false
} ] }
```

Signatures older than 5 minutes are rejected. The same events also complete withdrawals (outgoing transactions whose hash staff recorded).

**Confirmations** — the 5-minute job refreshes confirmation counts from the chain tip. Set RPC endpoints:

```
CHAIN_RPC_URLS={"ETHEREUM":"https://eth-mainnet.g.alchemy.com/v2/<key>","TRON":"https://api.trongrid.io","BITCOIN":"https://mempool.space/api"}
```

## 8. First administrator and deposit addresses

```bash
DATABASE_URL='<session pooler URL>' npm run admin:grant -- you@your-domain.com super_admin
```

Sign in, enable two-factor (Security page), open `/admin`. Grant a second super administrator (approvals need two people). Then **Admin → Deposits → Address pool → Import** the addresses you generated offline or with your custodian.

**Demo deployment:** `npm run db:seed:demo` creates the `[DEMO]` product and demo address pools. It needs the same environment variables as the deployment — the easiest way is `npx vercel env pull .env` and then running the command locally. It refuses to run with `APP_MODE=live`. With Supabase Auth it does not create users — register them through the site and grant roles with `admin:grant`.

## 9. Going live

1. Complete the checklist in [SECURITY.md](SECURITY.md#before-handling-real-money).
2. Set in Vercel: `APP_MODE=live`, `KYC_PROVIDER=sumsub` + `SUMSUB_*` (webhook URL `https://your-domain.com/api/v1/webhooks/kyc/sumsub`), `SCREENING_PROVIDER=http` + `SCREENING_API_URL` + `SCREENING_API_KEY`, `PRICE_PROVIDER=coingecko` + `COINGECKO_API_KEY`, `DEMO_TOOLS_ENABLED=false`, `LEGAL_APPROVAL_CONFIRMED=true`.
3. Replace the legal templates (`public/locales/*/legal.json`) with your lawyer's texts and set `support.contact_email` and `compliance.blocked_countries` in Admin → Settings.
4. Review limits, minimums and network fees (`supabase/migrations/…_reference_data.sql` defaults) with your finance team.
5. Redeploy. The function log shows any missing requirement.
6. Do a small real deposit and withdrawal end to end, then reconcile.

## Updating

1. `npm test` locally (or in CI).
2. New database changes go in a **new** migration file; run `npm run db:migrate` against production **before** deploying code that needs it. Migrations must be backwards-compatible with the running code (add columns first, remove later).
3. Push to the main branch → Vercel deploys. Preview deployments use the Preview environment variables — point them at a separate Supabase project (a branch or a staging project), never at production data.
4. Rolling back code: Vercel → Deployments → *Promote* a previous deployment. The database is not rolled back; write a corrective migration if needed.

## Changing pages or routes

Edit `server/config/site-routes.js`, then `npm run vercel:config` and commit the regenerated `vercel.json`. `npm run build` pre-renders public pages and writes `sitemap.xml` from the same list.
