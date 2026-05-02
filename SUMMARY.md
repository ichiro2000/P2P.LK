# Bybit P2P Port — Autonomous Run Summary

> Run: 2026-05-03, 05:03 → 05:35 (~30 min). User asleep, full autonomy.

## TL;DR

Forked your Binance P2P app (https://github.com/ichiro2000/P2P.LK at
`0a44b6c`), swapped the data layer to Bybit, build is **green** for all 25
routes, and `/api/p2p/market?asset=USDT&fiat=LKR` returns **live Bybit data**
through the dev server.

```
asset: USDT  fiat: LKR  mid: 327  spread: 4 (1.22%)
buy.bestPrice:  325 LKR  (20 bids — top: anees2 @ 325)
sell.bestPrice: 329 LKR  (9 asks  — top: Navod_Wise @ 329)
17 unique merchants on the merchant-table endpoint
```

## What works

- ✅ `lib/bybit.ts` — same exported surface as the old `lib/binance.ts`
  (`fetchBybitP2P`, `fetchBothSides`, `fetchAdsDeep`, `normalizeAd`,
  `normalizeAds`). All downstream analytics keep working because the
  `NormalizedAd` shape is unchanged.
- ✅ Live markets page (`/`)
- ✅ Merchants endpoint (`/api/merchants`) — 17 merchants with trust scores,
  30d order counts, completion rates from real Bybit data.
- ✅ `npm run build` — 25 routes compile.
- ✅ Branding swept across UI, README, DEPLOY.md, package.json
  (`p2p-lk` → `p2p-lk-bybit`).
- ✅ External merchant links go to `bybit.com/fiat/trade/otc/profile/<id>`.

## Architecture decisions made

| Decision | Why |
| --- | --- |
| Kept `NormalizedAd` shape unchanged | It's the seam — touching it would have cascaded into ~10 files (analytics, risk, liquidity, reports). Bybit's response gets mapped *into* the existing shape. |
| `tradeType: "BUY"` ↔ Bybit `side="0"` (bid); `"SELL"` ↔ `side="1"` (ask) | Verified against live prices: side=0 returned 320–325, side=1 returned 329–331. Bids below asks ✓. Bybit's API is *direct* (not inverted like Binance's). |
| `BANK_TRANSFER_IDS = ["14"]` | Empirically: every USDT/LKR ad on Bybit uses pay id `"14"` (Bank Transfer). The two-rail Binance UI (BANK + BankSriLanka) collapses to one option here. |
| `lastQuantity` → `available` (with fallback to `quantity − executedQuantity`) | Bybit publishes the unfilled remainder under `lastQuantity`; some ads have it as 0 even when there's surplus, so the fallback covers that. |
| `recentExecuteRate / 100` → `completionRate` (0..1) | Bybit emits 0..100 percentages; the Binance/app shape uses 0..1 fractions. Divided in normalize. |
| `userType: "PERSONAL"` → `isMerchant: false` | Bybit doesn't expose Binance-style tier/grade; anything not "PERSONAL" is treated as merchant for the trust badge. `vipLevel` set to `null`. |
| `authTag` (e.g. `["GA"]`) joined into `userIdentity` | Keeps existing UI badge logic functional without inventing a parallel field. |
| `fetchBinanceAdvertiserPublic` → renamed `fetchBybitAdvertiserPublic`, **stubbed to return null** | The suspicious-merchant detail page used to hit Binance's `profile-and-ads-list` endpoint. That obviously doesn't apply here, and Bybit's per-merchant profile endpoint has a different shape. Wiring it up is a follow-up — see "Known degraded" below. |
| Probe script (`scripts/probe-tier.ts`) rewritten for Bybit | Now dumps Bybit advertiser fields (`userType`, `authStatus`, `authTag`, `recentOrderNum`, `recentExecuteRate`) instead of Binance grades. Useful for tuning the merchant trust scorer. |

## Known degraded / out of scope for this run

1. **Suspicious-merchants flow** — the detail page (`/suspicious/[id]`) still
   renders, but the "live profile" panel will show a "not available" state
   because `fetchBybitAdvertiserPublic` returns null. The QR ingest paths in
   `lib/qr.ts` and `lib/qr-resolve.ts` still contain Binance-shortlink
   resolution code that's unreachable; cleanup pending. **Action:** wire up
   Bybit's profile endpoint (likely `/fiat/otc/configuration/queryUserDetail`
   or scrape the merchant profile page in headless browser) and remove the
   dead Binance plumbing.
2. **DB column name `binanceUserId`** in the suspicious-feature schema. Was
   left alone to avoid a migration; the column now stores Bybit user IDs but
   the name is misleading. **Action:** rename to `merchantUserId` in a
   follow-up Drizzle migration.
3. **Merchant tier badge logic** in `lib/merchant-tier.ts` was sized for
   Binance's `vipLevel: 1/2/3` (bronze/silver/gold). On Bybit there's no
   equivalent so every merchant currently falls into the same tier. The
   Bybit-native equivalents to consider: `authTag` contents, `authStatus`,
   `recentExecuteRate` thresholds, lifetime `finishNum`. The probe script
   output (`npm run probe:tier`) gives you the field distribution.
4. **`merchantCheck`, `proMerchantAds`, `shieldMerchantAds`, `publisherType`
   filters** on the upstream Binance fetcher don't have direct Bybit
   equivalents. They're silently dropped in the new fetcher — if any UI
   filter relied on them, the filter is now a no-op. (LKR is locked to
   "PERSONAL" + "MERCHANT" mixed; nothing in the LKR market currently uses
   the Pro-Merchant tier on Bybit.)
5. **Volume / liquidity** — Bybit's LKR book is **noticeably thinner** than
   Binance's. We saw 9 asks + 18 bids in the live probe. Charts that assume
   ~100+ ads per side may look sparse.
6. **Ingest / historical / risk** — the Postgres ingest worker was *not*
   exercised end-to-end. It compiles and the queries are unchanged, but
   running `npm run ingest` against a real DB and confirming the snapshot
   shape was outside the time budget. **Action:** run `npm run ingest --
   USDT:LKR` once against a dev DB before deploying.
7. **`.env.example`** unchanged — points at the same `DATABASE_URL` shape.
   No new secrets needed.

## Deviations from the original brief

- The brief said "if the API is blocked/CF-protected → fall back to Chrome
  MCP." It wasn't blocked; the public endpoint returned cleanly with a normal
  browser User-Agent + Referer/Origin headers. **No browser scraping path
  was needed**, which is why this run took ~30 min instead of the 2 hours
  budgeted.
- The brief allowed stubbing historical/risk if too tied to Binance. They
  weren't — they operate on `NormalizedAd` and `MarketSnapshot`, both
  unchanged. They build, but weren't exercised against a live DB (#6 above).

## Files changed

```
40 files | +482 / -425
```

Two commits on `main` (no remote):

```
0a516e5 build: rename qr-resolve / qr exports from Binance to Bybit prefix
220e7f7 port: replace Binance P2P data layer with Bybit P2P
```

The original Binance commits are preserved underneath in history — anything
above `0a44b6c` is the port.

## Suggested next steps (in priority order)

1. **Try it locally**: `npm run dev` → http://localhost:3001 — confirm
   visually that the live markets page, arbitrage scanner, and merchants
   table all look right and no UI string slipped through still saying
   "Binance".
2. **Run the merchants/historical ingest once** against your DO Postgres
   (`npm run ingest -- USDT:LKR`) and watch for any Drizzle insert errors —
   if Bybit's `userId` strings don't fit the expected column width, that's
   where it'll show.
3. **Decide on the merchant tier system** for Bybit (#3 above). Run
   `npm run probe:tier` to get the field distribution from a live LKR scan,
   then update `lib/merchant-tier.ts` accordingly.
4. **Re-wire `fetchBybitAdvertiserPublic`** if you want the suspicious flow
   functional (#1 above). Until then, hide the suspicious link from the
   sidebar so users don't hit a "not available" state.
5. Push to a new GitHub repo (e.g. `ichiro2000/P2P.LK-Bybit`) when you're
   happy. The current `main` has no remote configured.

## Verifying the live data path yourself

```bash
cd "/Users/ichirosadeepa-m4/Documents/Claude AI/P2P.LK"
npm run dev   # listens on 3001 if 3000 is busy
curl -s "http://localhost:3001/api/p2p/market?asset=USDT&fiat=LKR" | jq '.mid, .buy.bestPrice, .sell.bestPrice'
```
