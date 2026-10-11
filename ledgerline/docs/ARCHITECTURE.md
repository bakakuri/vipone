# Architecture

## Overview

```
Browser (HTML + CSS + ES modules)
   │  same-origin fetch, HttpOnly cookies, X-CSRF-Token
   ▼
Vercel CDN ── static files from dist/ (pages, css, js, locales, fonts)
   │  /api/*  (rewrite)
   ▼
Vercel Function  api/index.js  →  Express 5 app (server/app.js)
   │  postgres.js over the Supabase pooler (transaction mode)
   ▼
Supabase PostgreSQL ── schema app: tables, ledger functions, RLS, triggers
   │  realtime.send(...) on every state change
   ▼
Supabase Realtime ── private channel  user:<id>  /  admin:ops  ──►  Browser
```

The browser never talks to the database. It talks to our API with a session cookie. The API connects to Postgres as the schema owner and performs every money movement by calling a SQL function (`app.create_withdrawal`, `app.credit_deposit`, `app.post_investment_result` …) inside one database transaction. Those functions lock the rows they change, validate state transitions against `app.status_transitions`, write balanced ledger entries and emit a live event. Row Level Security is a second wall: if anything ever reached the database with a user's JWT (the Supabase Data API, Realtime, a leaked publishable key), that user could read only their own rows and write nothing financial.

## Server

`server/app.js` builds the Express app; the same app runs as the Vercel Function, the local dev server (`server/server.js`, which also serves `public/`) and in tests.

Request pipeline for `/api`:

1. `request-context` — request id (`X-Request-Id`), start time, hashed client IP
2. `security-headers` — CSP (`default-src 'self'`, no inline script or style), HSTS, `X-Frame-Options: DENY`, referrer and permissions policies
3. `no-store` caching, JSON body (200 kB limit, raw body kept for webhook signatures)
4. cookie parser, global rate limit (per IP, stored in Postgres in production)
5. CSRF — double-submit token for every state-changing request (webhooks and cron are exempt and authenticate by signature/secret)
6. `/api/v1` routes → per-route `authenticate()`, `requirePermission()`, `validate()` (zod), `rateLimit()`, `idempotency()`
7. not-found and error handler — every error becomes `{ error: { code, message, details, requestId } }`; unknown errors are logged and reported, never leaked

Feature modules live in `server/modules/<feature>/` with the same shape:

| File | Responsibility |
| --- | --- |
| `<feature>.routes.js` | URL → middleware chain → controller |
| `<feature>.controller.js` | reads `req`, calls the service, shapes the response |
| `<feature>.service.js` | business rules, calls SQL functions inside `withTransaction` |
| `<feature>.validators.js` | zod schemas for body, query, params |
| `<feature>.repository.js` (where used) | read queries, always scoped by `user_id` |

Integrations are behind small interfaces in `server/integrations/`: auth (Supabase or local), email (log, Resend, Postmark), blockchain (signed webhooks from Alchemy or a generic signed source, chain-tip polling), KYC (manual or Sumsub), wallet screening (none or HTTP provider), prices (static or CoinGecko), error monitoring (webhook).

Configuration is validated once at start-up (`server/config/env.js`). An unsafe combination stops the process — for example `APP_MODE=live` without KYC, screening, a real email provider, market prices or `LEGAL_APPROVAL_CONFIRMED=true`.

Money on the server is always a `decimal.js` value or a string. Numbers coming from Postgres `NUMERIC` stay strings end to end; the API never returns a JavaScript float for an amount.

## Database

The schema is the source of truth for money rules. See [DATABASE.md](DATABASE.md). Key properties:

- double-entry ledger, append-only, one asset per transaction, debits = credits enforced by a deferred constraint trigger
- balances derived from entries; `app.ledger_balances` is a cache updated in the same transaction and checked by `app.verify_ledger_integrity()`
- fund holds (7-day deposit hold) and withdrawal holds are explicit
- state machines for deposits, withdrawals, positions, results, rewards, approvals
- every staff action is in `app.audit_logs`; settings changes are versioned; fee rules are versioned and never edited

## Scheduled jobs

`GET /api/v1/jobs/group/frequent` (every 5 minutes) and `/jobs/group/daily` (03:00 UTC) — called by Vercel Cron with `Authorization: Bearer $CRON_SECRET`, or by pg_cron + pg_net (`database/optional/pg_cron.sql`). Every run is recorded in `app.job_runs` and shown in Admin → System.

| Group | Jobs |
| --- | --- |
| frequent | refresh deposit confirmations from the chain tip, release matured positions, release due referral rewards, expire unpaid deposit requests, expire unanswered approvals, send queued emails |
| daily | fetch market prices, clean up expired idempotency keys / rate-limit buckets / codes / quotes |

All jobs are idempotent and lock rows with `SKIP LOCKED`, so overlapping runs are safe.

## Live updates

Every state change calls `app.emit_event(topic, event, payload)`, which sends `pg_notify` and, on Supabase, `realtime.send` to a **private** broadcast channel: `user:<uuid>` for the owner and `admin:ops` for staff. RLS on `realtime.messages` allows a user to join only their own topic. The browser receives a short-lived access token from `GET /api/v1/live/token` and keeps it in memory.

Events carry only ids and statuses (`deposit.updated`, `withdrawal.updated`, `position.updated`, `referral.updated`, `balance.changed`, `notification.created`, staff events such as `approval.created`, `reconciliation.mismatch`). The page then re-fetches the real data from the API. If the connection drops, the indicator turns amber and the page refreshes when it reconnects — nothing is ever animated or "ticked up" without a server value.

Locally (or self-hosted) `LIVE_TRANSPORT=sse` streams the same events over Server-Sent Events from one `LISTEN` connection per server.

## Front end

No framework, no bundler. Every page is a static HTML shell in `public/pages/` plus one ES module in `public/js/pages/`.

```js
// public/js/pages/withdrawals.js
import { definePage } from '../core/page.js';

definePage({
  id: 'withdrawals',
  area: 'app',                 // public | auth | app | admin
  auth: 'user',                // public | guest | user | staff
  namespaces: ['withdrawal', 'wallets'],
  title: 'withdrawal:title',
  async render({ page, user, config }) { /* build DOM with h() */ },
});
```

`definePage` loads the session and public config, loads translations (the page's namespaces plus any namespace used in the HTML), mounts the right shell (public header and footer, auth layout, app sidebar + top bar + phone navigation, or admin), redirects if access is wrong, and renders. Errors become an error state with a retry button.

Conventions enforced by `tests/unit/project-structure.test.js`:

- DOM is built with `h(tag, attrs, ...children)` from `core/dom.js`. No `innerHTML`, no `eval`, no inline handlers or styles (the CSP forbids them anyway).
- `localStorage` only through `core/storage.js`, which allows only visual preferences: theme, language, collapsed sidebar, dismissed hints, last chosen asset/network. Tokens and financial data never touch browser storage.
- API calls only through `api/api-client.js`: cookies, CSRF header, one silent token refresh, idempotency keys, typed `ApiError` codes that the UI translates.
- Amounts are strings; browser-side previews use the vendored `decimal.js`. The server always recomputes, and the confirm step shows the server's quote.
- Text never lives in JS or HTML: `t('namespace:key')`, `data-i18n="…"`, `data-i18n-attr="placeholder:…"`. `npm run check:i18n` fails if any key is missing in any language.
- CSS uses logical properties (`margin-inline-start`, `inset-inline-end`), so Arabic needs no separate stylesheet. Theme colours are CSS variables in `css/themes/`.

Folder map:

| Folder | Contents |
| --- | --- |
| `core/` | page lifecycle, DOM builder, events, storage, navigation, focus trap, client error reporting |
| `api/` | client + one module per API area |
| `i18n/` | loader, plural rules, `Intl` formatting, locale detection, RTL |
| `components/` | layout, navigation, cards, charts (SVG), finance widgets, forms, modals, tables, feedback, onboarding, admin |
| `services/` | live connection (Realtime / SSE), live refresh, idempotency keys |
| `validation/` | rules shared with the server (password, amount, address patterns) |
| `calculations/` | display-only previews (scenario calculator); never the source of a balance |
| `formatting/` | amounts and currencies, numbers, dates, shortened addresses, status labels |
| `animations/` | the few motions used — e.g. a balance counting from its previous server value to the new one (respect `prefers-reduced-motion`) |

## Build and routing

`server/config/site-routes.js` is the single list of pages. From it:

- `npm run build` copies `public/` to `dist/`, pre-renders every public page in English, Russian and Arabic (`/ru/...`, `/ar/...`) with translated text, `<title>`, description, canonical and `hreflang` links, and writes `sitemap.xml` and `robots.txt` (cabinet and admin are disallowed).
- `npm run vercel:config` writes the rewrites in `vercel.json` (`/withdrawals` → `/pages/withdrawals.html`, `/api/*` → the function), the security headers for static files, and the cron schedule.
- The local dev server serves the same routes.

## Design

"Ledgerline" design system: IBM Plex Sans / Sans Arabic / Mono, ink-blue neutrals, a verdigris accent (`#1f6f63`) and brass for warnings. The signature element is the **ledger strip** — one bar split into available funds, 7-day deposit hold, withdrawal hold and invested funds — shown on the dashboard and the home page. There is one load animation (the strip drawing in); everything else moves only in response to the user, and `prefers-reduced-motion` turns motion off.
