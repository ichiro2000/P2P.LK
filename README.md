# P2P.LK — Binance P2P Analytics

Live market data, cross-country arbitrage scanner, merchant analytics,
time-series history and anomaly detection for the Binance P2P market.
Dark-first, data-dense, production-ready.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Tailwind CSS v4 · shadcn/ui (Base UI) · Recharts · Lucide
- SQLite (better-sqlite3) · Drizzle ORM · `tsx` for CLI scripts
- Data source: Binance P2P public endpoint (no auth required)

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

**Stubbed (v3+)**: Liquidity heatmaps, Alerts, Workspace, Reports.

## Development

```bash
npm install
npm run dev              # http://localhost:3000

# One-shot ingest (writes a snapshot for all tracked markets)
npm run ingest

# Continuous local ingest (replaces Vercel Cron in dev)
npm run ingest:loop      # every 120s, Ctrl-C to stop

# One specific market
npm run ingest -- USDT:LKR
```

The SQLite DB lives at `data/p2p.db` (gitignored) and is bootstrapped on
first connection — no manual migration step.

## Production ingest

`vercel.json` schedules `/api/cron/snapshot` every 5 minutes. Protect the
endpoint by setting `CRON_SECRET` — Vercel Cron jobs automatically send
`Authorization: Bearer $CRON_SECRET`.

For real Vercel deploys, swap the SQLite connection in `lib/db/client.ts`
for libSQL/Turso or a Postgres driver; the Drizzle schema and queries are
unchanged.

## Architecture

**Data**
- `lib/binance.ts` — Binance P2P fetcher with URL-cached ISR.
- `lib/ingest.ts` — Captures snapshots into SQLite (markets + merchants).
- `lib/db/{schema,client,queries}.ts` — Drizzle schema, singleton handle, query helpers.
- `lib/risk.ts` — Anomaly detection from the time-series.
- `lib/analytics.ts` — Spread, arbitrage, merchant trust scoring.
- `lib/stats.ts` — SMA, z-score, histogram.
- `lib/types.ts` — Normalized domain types.

**Routes**
- `app/api/p2p/market` — single-market proxy.
- `app/api/p2p/markets` — multi-market aggregate for arbitrage.
- `app/api/cron/snapshot` — ingest endpoint (cron).
- `app/api/history/market` — time-series for one market.
- `app/api/risk` — computed risk report.

**UI**
- `hooks/use-polling.ts` — Pauses when tab hidden, cancels in-flight fetches.
- `components/shell/` — Sidebar, topbar, mobile nav, coming-soon template.
- `components/market/`, `components/arbitrage/`, `components/merchant/`,
  `components/historical/`, `components/risk/` — feature-scoped components.

## Design language

- Near-black base (`oklch(0.14 0.005 260)`) with a cool undertone.
- Emerald primary · warm red for sells · amber for warnings.
- JetBrains Mono everywhere numbers live. Tabular figures throughout.
- Subtle reveals (IntersectionObserver), card lifts, live-pulse dots.
