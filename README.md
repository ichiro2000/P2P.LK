# P2P.LK — Binance P2P Analytics

Live market data, cross-country arbitrage scanner and merchant analytics for
the Binance P2P market. Dark-first, data-dense, production-ready.

## Stack

- Next.js 16 (App Router) · React 19 · TypeScript
- Tailwind CSS v4 · shadcn/ui (Base UI) · Recharts · Lucide
- Data source: Binance P2P public endpoint (no auth required)

## Features (v1)

- **Live Markets** (`/`) — Best bid/ask, spread, cumulative depth, live ads.
- **Arbitrage** (`/arbitrage`) — 10-fiat scanner with live fee + slippage sliders.
- **Merchants** (`/merchants`) — Trust-scored counterparty analytics and rails.

Stubbed routes (v2): Historical, Liquidity, Risk, Alerts, Workspace, Reports.

## Development

```bash
npm install
npm run dev     # http://localhost:3000
```

## Architecture

- `lib/binance.ts` — Binance P2P fetcher with URL-cached ISR.
- `lib/analytics.ts` — Spread, arbitrage, merchant trust scoring.
- `lib/types.ts` — Normalized domain types.
- `app/api/p2p/market` — single-market proxy.
- `app/api/p2p/markets` — multi-market aggregate for arbitrage.
- `hooks/use-polling.ts` — Pauses when tab hidden, cancels in-flight fetches.

## Design language

- Near-black base (`oklch(0.14 0.005 260)`) with a cool undertone.
- Emerald primary · warm red for sells · amber for warnings.
- JetBrains Mono everywhere numbers live. Tabular figures throughout.
- Subtle reveals (IntersectionObserver), card lifts, live-pulse dots.
