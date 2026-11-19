# P2P.LK — Binance & Bybit P2P Analytics

Live market data, cross-country arbitrage scanner, merchant analytics,
time-series history and anomaly detection for the Binance P2P market.
Dark-first, data-dense, production-ready.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript · Tailwind v4 · shadcn/ui
- **Cloudflare Workers** via `@opennextjs/cloudflare`
- **Cloudflare D1** (SQLite) + Drizzle ORM · **Workers KV** for the live book
- **Cron Trigger** (every minute) for ingest · Browser Rendering for QR short-links
- Data: Binance + Bybit P2P public endpoints, one adapter per exchange (`lib/exchanges/`)

## Features

**Live (v1)**
- **Live Markets** (`/`) — Best bid/ask, spread, cumulative depth, live ads.
- **Arbitrage** (`/arbitrage`) — 10-fiat scanner with live fee + slippage sliders.
- **Merchants** (`/merchants`) — Trust-scored counterparty analytics and rails.

**Historical & Risk (v2)**
- **Historical** (`/historical`) — Price series with MA20/MA60, depth over time,
  price distribution, switchable ranges (1h / 6h / 24h / 7d / 30d).
- **Risk** (`/risk`) — Statistical anomaly detection: price spikes (z-score vs
  distribution), liquidity drops, merchant churn, low-completion counterparties
  at top-of-book.

**Liquidity (v3)**
- **Liquidity** (`/liquidity`) — Slippage simulator (live book walk for a target
  fiat amount), merchant concentration (HHI + top-N share) for both sides,
  total-depth trend with SMA20 and 7×24 depth heatmap by weekday × hour.

**Workspace & Alerts (v4)**
- **Workspace** (`/workspace`) — Watchlisted markets with live mini cards
  (polled 30s), favourite merchants, saved filters and a recent-routes list.
  Everything lives in localStorage — no auth, no backend.
- **Alerts** (`/alerts`) — Local rule engine: price above/below, spread
  above/below, depth below. The checker runs inside the app layout and fires
  a sonner toast plus persists an event when a rule matches, respecting a
  per-rule cooldown.
- Stars are surfaced in the topbar of every market page; the Merchants table
  has per-row stars. "Save filter" is baked into the filter bar.

**Compare, arbitrage and rates (v2 rebuild)**
- **Compare** (`/compare`) — Binance vs Bybit head to head, spread overlay,
  market share, and an order-book constructor (two books side by side).
- **Arbitrage** (`/arbitrage`) — cross-exchange and cross-method spreads and a
  profit-per-cycle calculator that can walk the live book.
- **Exchange rates** (`/rates`) — CBSL and bank TT rates collected every 3 hours
  from primary sources (see `lib/fx/SOURCES.md` for each source's terms),
  converter, P2P premium vs the official dollar, remittance route finder.

**Reports (v5)**
- **Reports** (`/reports`) — Three exportable views: daily recap (reads the
  ingested time-series), arbitrage summary (live cross-market scan) and
  merchant scorecard (live counterparty ranking). Every table has its own
  one-click CSV download; the full report can be downloaded as a single
  multi-block CSV or copied to the clipboard.

## Development (everything runs locally — no Cloudflare account needed)

```bash
npm install
cp .dev.vars.example .dev.vars        # set BETTER_AUTH_SECRET, ADMIN_EMAILS
npm run db:migrate:local              # create local D1 tables
npm run dev                           # http://localhost:3000
open "http://localhost:3000/api/dev/tick?all=1"   # pull one round of data
```

Worker-runtime check (same bundle Cloudflare will run):

```bash
npm run cf:preview                    # builds + wrangler dev on :8787
curl "http://localhost:8787/__scheduled?cron=*+*+*+*+*"   # fire the cron
```

## Testing

```bash
npm test            # Vitest unit tests (pure logic, ~450 tests, < 1 s)
npm run e2e         # Playwright: desktop + 360 px mobile, axe accessibility
                    # scans; needs `npm run dev` running on :3000
```

The security review and its fixes are in `SECURITY-REVIEW.md`.

## Accounts (Phase 5)

- **Better Auth on D1** (`lib/auth/*`): email + password, 6-digit email code
  (or link) to verify, Turnstile on sign-up / sign-in / password reset,
  rate limits, 30-day sessions.
- **Onboarding**: name, merchant name, WhatsApp (+94), email, optional
  Binance/Bybit profile → verify email → *pending review* → an admin approves
  or rejects at `/admin/members` (emails sent, every action in `audit_log`).
  Emails in `ADMIN_EMAILS` become admins once verified.
- **Members** (approved) get `/app` (dashboard), `/account` (profile,
  password, sessions), server-side alerts (checked every minute by the cron,
  in-app inbox + email, incl. "taker signal" off-market ads), reports and CSV,
  7d/30d history, and a merchant blocklist. Watchlists, favourites and saved
  filters sync across devices; a guest's local data is imported on first
  sign-in. Market pages stay public.
- **Local email**: with no Resend key, mail goes to `GET /api/dev/mail`.
- **Before deploying**, set as secrets: `BETTER_AUTH_SECRET`,
  `RESEND_API_KEY`, and set `BETTER_AUTH_URL`, `EMAIL_FROM`, `ADMIN_EMAILS`.

## Admin panel (Phase 6)

Everything under `/admin` needs a signed-in admin (role `admin`; the old
shared `ADMIN_TOKEN` is gone). Every action is written to `audit_log`.

- **Overview** (`/admin`) — users by status, sign-ups, ingest health per
  exchange and job (stale badges, failures, p50/p95), registry queues, D1 size.
- **Members** — approve / reject / suspend / make admin.
- **Registry** — members' suspicious-taker reports wait as *pending* until an
  admin publishes or rejects them; retract and restore published ones.
- **Removals** — public un-flag requests.
- **Audit log** — filterable, paginated, CSV export.
- **System** — ingest run log, FX source status, retention policy, feature
  flags (sign-ups open, alert emails, FX collector, site banner) stored in KV,
  and "collect FX now" / "run retention now".

## API protection

- Every API route goes through `lib/guard.ts`, which handles four things:
  - Per-IP rate limits using the Workers Rate Limiting bindings `RL_READ`, `RL_WRITE` and `RL_ADMIN`.
  - Body and query validation with zod.
  - JSON-only request bodies.
  - The admin gate (a signed-in account with the admin role), which has its own rate limit.
- Public removal requests need a Cloudflare Turnstile token. Local development uses Cloudflare's test keys, which always pass.
- Before deploying, set the real keys:
  - The secret: `wrangler secret put TURNSTILE_SECRET_KEY`.
  - The site key: `NEXT_PUBLIC_TURNSTILE_SITE_KEY`, set at build time.
  - Without a secret, production rejects these requests.
- Security headers are set in `next.config.ts`.

## Data retention

| Table | Granularity | Kept |
|---|---|---|
| market_snapshots | 1/min/exchange | 14 days |
| market_hourly | hourly OHLC | forever |
| merchants | latest per merchant | forever |
| merchant_snapshots | 5-min sweep | 3 days |
| merchant_hourly | hourly | 180 days |
| taker_snapshots | on change + daily | 180 days |

## Architecture

**Data**
- `lib/exchanges/{binance,bybit}.ts` — one adapter per exchange behind a
  shared `ExchangeAdapter` interface; failures raise `UpstreamError`.
- `lib/ingest/{run,jobs,takers}.ts` — cron jobs: 1-min book, 5-min merchant
  sweep, hourly rollups, 15-min taker poll, nightly retention. Every run is
  logged to `ingest_runs`.
- `lib/live.ts` — latest book in KV; `lib/market-data.ts#getBook` serves pages
  from KV and only calls the exchange for filtered views.
- `lib/db/{schema,client,queries}.ts` — D1 schema, Drizzle client, queries
  (raw rows for ≤24h ranges, hourly rollups beyond).
- `worker.ts` — Worker entry: OpenNext `fetch` + cron `scheduled`.
- `lib/risk.ts`, `lib/analytics.ts`, `lib/stats.ts`, `lib/types.ts`.

**Routes**
- `app/api/p2p/market`, `app/api/merchants`, `app/api/liquidity/slippage`,
  `app/api/history/market`, `app/api/risk` — all take `?exchange=binance|bybit`.
- `app/api/suspicious/*` — registry + QR check/lookup + removal requests.
- `app/api/dev/tick` — local-only manual cron tick (404 in production).

**UI**
- `hooks/use-polling.ts` — Pauses when tab hidden, cancels in-flight fetches.
- `components/shell/` — Sidebar, topbar, mobile nav, coming-soon template.
- `components/market/`, `components/arbitrage/`, `components/merchant/`,
  `components/historical/`, `components/risk/` — feature-scoped components.

## Design language

- shadcn "neutral" black and white, light / dark / system. The only colour is
  a subtle green (buy) / red (sell) tint and amber for warnings.
- Mobile first: bottom tab bar on phones, tables become cards below `md`.
- Charts are built from `components/charts/kit.tsx` (shared axes, tooltips,
  legend and one ease-out animation) on shadcn `chart` + Recharts.
- Monospace tabular figures wherever numbers live.
