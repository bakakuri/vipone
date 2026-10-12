# Ledgerline

A crypto investment platform built around one rule: **every number a person sees comes from a double-entry ledger, and nothing is credited until it has really happened** — a deposit after its blockchain confirmations, a profit after finance staff record a realised result and a second person approves it, a withdrawal after a confirmed on-chain transaction.

- Front end: plain HTML, CSS and JavaScript modules. No frameworks, no UI kits, no build-time bundler.
- Back end: Node.js 22 + Express 5, deployed as a single Vercel Function.
- Database: Supabase PostgreSQL (schema `app`), Row Level Security on every table, money in `NUMERIC(38,18)`.
- Sign-in: Supabase Auth, called only from the server; sessions live in `HttpOnly` cookies.
- Live updates: Supabase Realtime private channels (Server-Sent Events fallback for local development).
- Languages: English, Russian, Arabic (full right-to-left layout). Light and dark themes.

> **Demo mode is the default.** The platform starts with `APP_MODE=demo`: every page shows a demo banner and balances have no value. `APP_MODE=live` refuses to start until KYC, wallet screening, a real email provider, market prices, blockchain webhooks and `LEGAL_APPROVAL_CONFIRMED=true` are configured. Operating an investment service with other people's money needs licences in most countries (for example MiCA in the EU). See [docs/SECURITY.md](docs/SECURITY.md) and [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md).

## What is inside

| Area | Pages |
| --- | --- |
| Public | home, how it works, products, risk disclosure, FAQ, contact, sitemap, terms, privacy, cookies — pre-rendered in `/`, `/ru/…`, `/ar/…` with `hreflang` |
| Account | sign in (with two-factor), registration, email confirmation, password reset |
| Cabinet | dashboard, deposit, investments, earnings, withdrawals, wallets, transaction history (CSV export), referrals, notifications, profile, security, support, help centre |
| Admin | overview, users, user detail, deposits, withdrawals, investments and results, referrals, treasury and reconciliation, four-eyes approvals, settings and fees, support inbox, announcements, audit log, system health |

The full list with access rules is in [docs/SITEMAP.md](docs/SITEMAP.md) and on the `/sitemap` page.

## Quick start (local)

Requirements: Node.js 22.9+, PostgreSQL 15+ (or `supabase start`).

```bash
npm install                       # commit the generated package-lock.json
createdb ledgerline               # or any empty database
cp .env.example .env              # then edit: DATABASE_URL, LOCAL_JWT_SECRET (32+ random characters), …
npm run db:migrate:local          # plain PostgreSQL: adds a small Supabase shim, then the migrations
npm run db:seed:demo              # demo product, address pools, demo customer + staff (passwords printed once)
npm run dev                       # http://localhost:3000
```

With `AUTH_PROVIDER=local` (development only) emails are written to the server log (`EMAIL_PROVIDER=log`), so you can open the confirmation link from there.

## Deploy (Vercel + Supabase)

Short version — the full checklist is in [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md):

1. Create a Supabase project. Run `npm run db:migrate` with the session-pooler (port 5432) connection string, or `supabase db push`.
2. In Supabase Auth: turn on email confirmations, set the Site URL, add custom SMTP, change the "Confirm signup" and "Reset password" templates to link to `/verify-email?token_hash={{ .TokenHash }}&type=signup` and `/reset-password?token_hash={{ .TokenHash }}&type=recovery`.
3. Import the repository in Vercel. Add the environment variables from `.env.example` (production values). Vercel runs `npm run build` and serves `dist/`.
4. Register, then make yourself an administrator: `npm run admin:grant -- you@example.org super_admin` (run locally against the production database).

## Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | API + pages on one local server |
| `npm run build` | Pre-renders public pages in three languages, writes `dist/`, `sitemap.xml`, `robots.txt` |
| `npm run vercel:config` | Regenerates `vercel.json` from `server/config/site-routes.js` |
| `npm run db:migrate` / `db:migrate:local` | Applies `supabase/migrations` (checksummed, never edited after applying) |
| `npm run db:seed:demo` | Demo data — refuses to run with `APP_MODE=live` |
| `npm run admin:grant -- <email> <role>` | Grants `support`, `finance`, `compliance` or `super_admin` |
| `npm run check:i18n` | Every key used in code exists in all three languages |
| `npm test` | Unit, integration, security and browser tests (see below) |
| `node scripts/create-page.js <name>` | Scaffolds a new page (HTML shell, JS module, CSS); then add its route to `server/config/site-routes.js` |

## Tests

```bash
export TEST_DATABASE_ADMIN_URL=postgres://postgres@127.0.0.1:5432/postgres   # a throwaway server
npm test
```

Each test file gets its own fresh database built from the migrations. The groups:

- **unit** — money arithmetic (fees, results, early exit, referral rewards), password/OTP/JWT primitives, shared validators, project rules (no frameworks, no `innerHTML`, no tokens in `localStorage`, every page has its files and translations).
- **integration** — registration and sign-in, deposits through signed blockchain events, withdrawals and the fee quote, investments with realised results, referral rewards, the static site and security headers.
- **security** — users cannot see or change each other's data, staff permissions, CSRF, idempotency, rate limits, RLS.
- **end-to-end** — Chromium via Playwright: three languages and RTL, themes, phone layout, registration → email → dashboard with a live deposit update, a withdrawal with two-factor sign-in.

## Project layout

```
api/index.js                 Vercel Function entry (Express app)
server/                      API: config, middleware, modules/<feature>/{routes,controller,service,validators}
supabase/migrations/         Database schema, ledger functions, RLS (source of truth for money rules)
database/local/              Shim for running the migrations on plain PostgreSQL
database/optional/           pg_cron scheduling (alternative to Vercel Cron)
public/pages/                HTML shells (one per page)
public/js/                   core, api, i18n, components/<group>, pages/<page>.js, validation, calculations
public/css/                  base, themes, layout, components, pages, responsive
public/locales/{en,ru,ar}/   Translation files per feature
scripts/                     build, migrate, seed, i18n checks, page generator
tests/                       unit, integration, security, e2e
docs/                        everything below
```

## Documentation

- [ARCHITECTURE.md](docs/ARCHITECTURE.md) — how the pieces fit, request flow, front-end conventions
- [DATABASE.md](docs/DATABASE.md) — schema, chart of accounts, functions, RLS
- [API.md](docs/API.md) — every endpoint with its access rule
- [BUSINESS_LOGIC.md](docs/BUSINESS_LOGIC.md) — deposits, holds, withdrawals and fees, investments, referrals, reconciliation
- [SECURITY.md](docs/SECURITY.md) — threat model and the controls in place
- [USER_GUIDE.md](docs/USER_GUIDE.md) and [ADMIN_GUIDE.md](docs/ADMIN_GUIDE.md)
- [SITEMAP.md](docs/SITEMAP.md) — all pages
- [DEPLOYMENT.md](docs/DEPLOYMENT.md) — Vercel, Supabase, email, cron, going live
- [TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

## მოკლედ ქართულად

- ლოკალურად გაშვება: `npm install` → `.env.example` დააკოპირეთ `.env`-ად → `npm run db:migrate:local` → `npm run db:seed:demo` → `npm run dev`.
- Vercel + Supabase: მიგრაციები `npm run db:migrate`-ით (ან `supabase db push`), Supabase Auth-ში ელფოსტის შაბლონების ბმულები `/verify-email` და `/reset-password`, Vercel-ში გარემოს ცვლადები `.env.example`-დან, შემდეგ `npm run admin:grant -- თქვენი@ელფოსტა super_admin`.
- საიტი ნაგულისხმევად **დემო რეჟიმშია**. რეალური ფულით მუშაობამდე საჭიროა ლიცენზია/იურიდიული შემოწმება, KYC, საფულეების შემოწმება (screening) და ყველა შესაბამისი გასაღები — მანამდე `APP_MODE=live` სერვერი უბრალოდ არ ჩაირთვება.

## Licence and third-party code

Application code: all rights reserved by the project owner (add your own licence). Vendored: `decimal.js` (MIT, `public/vendor/decimal.LICENCE.md`), QR Code generator by Project Nayuki (MIT, header of `public/vendor/qrcodegen.js`). Fonts: IBM Plex Sans, Sans Arabic and Mono (SIL Open Font Licence 1.1), self-hosted in `public/assets/fonts`.
