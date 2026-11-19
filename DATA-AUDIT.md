# P2P.LK data audit

Read-only audit of the numbers, charts and labels. Evidence comes from a fresh `GET /api/dev/tick?all=1` round (sweep ts `1795113308`, 2026-11-19 18:35 UTC), from the local APIs, from local D1, and from one raw call to each exchange's public P2P endpoint.

Vocabulary used below:
- **asks** are `tradeType "SELL"` ads. This is where the user **buys** USDT, and the best ask is the lowest price.
- **bids** are `tradeType "BUY"` ads. This is where the user **sells** USDT, and the best bid is the highest price.

Severity scale: **wrong-number** > **misleading** > **unclear** > **improvement**.

---

## 1. Findings, ranked

### F1 · wrong-number · The slippage walk stops at the first ad whose minimum is too big
- **Where:** `lib/liquidity.ts:69-72`. The same walk is used by `/api/liquidity/slippage`, the slippage simulator, and `walkedCycle` in `lib/arbitrage.ts:164,173`.
- **Evidence:** `GET /api/liquidity/slippage?exchange=binance&side=SELL&amount=50000` returns `filledFiat: 0` and `effectivePrice: null`. The walk hits the best ask first: DGAK at 348.36 with a minimum of Rs 104,500, which is more than Rs 50,000, so it stops. The ladder (`fillAmount`, `lib/market-insights.ts:153`) skips that ad and fills Rs 50k at LAYA1ST, 348.80. The two tools on the site therefore disagree for the same amount. The arbitrage "walk the book" mode returns `null` for small amounts for the same reason.
- **Fix:**
  - Replace the `break` with `continue`.
  - Also skip an ad when `min(available*price, maxOrder) < minOrder`. Today such an ad is filled below its own minimum.
  - Best option: make `computeSlippage` a thin wrapper around `fillAmount`'s logic so there is only one walk.

### F2 · wrong-number · The merchant directory marks about 85 % of listing merchants as "inactive"
- **Where:**
  - `app/(app)/merchants/page.tsx:46-58` and `app/api/merchants/route.ts:15-28` build the "live" merchants from `getBook()`, which is only the top 20 per side.
  - `lib/analytics.ts:310-320` then sets `isActive` only for those merchants.
- **Evidence:**
  - `/api/merchants?exchange=binance` returns `liveCount: 33`. Another 172 merchants have `isActive: false` even though their `lastSeenTs` equals the latest sweep. `/api/risk` correctly reports `activeMerchants: 205`.
  - Bybit: 21 merchants live, 15 marked inactive but seen in the latest sweep.
- **Fix:**
  - `isActive = lastSeenTs >= latestSweepTs − 120`, which is the rule `lib/dashboard.ts:121` already uses.
  - Take `orders30d`, `completion`, `bestBuy` and `bestSell` from the `merchants` table, which comes from the full sweep, not from the top-20 book.

### F3 · wrong-number · Merchant "Premium" and "Competitiveness" mix bids and asks
- **Where:**
  - `lib/analytics.ts:196-251`.
  - The median passed in is the **ask** median: `merchants/page.tsx:57`, `api/merchants/route.ts:21`, `ingest/jobs.ts:103`, `reports.ts:230`.
  - `mergeMerchantDirectory` at `:349-356` averages the last bid and ask.
- **Evidence:** The ask median is 348.91. Every bidder therefore shows as a "discount" and every seller as a "premium":
  - Smart_Lanka (bid 346.13) shows −0.797 % and competitiveness 60.
  - The best bidder ISSL_USDT (bid 346.75, ask 348.88) gets the average of its bid and ask compared with the ask median.
  - On Bybit the outlier-inflated ask median (350.95, see F12) gives LedgerkingLK, the best bidder at 347.00, a premium of −1.03 % and competitiveness 30.
- **Fix:** Compute per side.
  - Asks: `askGap = (merchantBestAsk − marketBestAsk) / marketBestAsk`. It is ≥ 0, and lower is better.
  - Bids: `bidGap = (marketBestBid − merchantBestBid) / marketBestBid`.
  - Competitiveness: the merchant's rank (1 = best) on each side they quote, or `max(0, 100 − gap_bps)`.
  - Show both columns, "Ask vs best" and "Bid vs best". Drop the cross-side average.

### F4 · misleading · Depth, "listed volume", imbalance and share are dominated by far-off, unbacked bids
- **Where:**
  - Depth sums: `lib/analytics.ts:58-62`.
  - KPI "Depth, top 20 per side": `components/market/market-kpis.tsx:41`.
  - Book-balance imbalance: `components/market/liquidity-strip.tsx:13-19`.
  - Compare share "Listed volume": `lib/compare-server.ts:79-108`.
  - Activity "listed": `lib/activity.ts:80-89`.
  - Depth heatmap: `lib/db/queries.ts:267`.
  - `depthBelow` alert: `lib/alerts/evaluate.ts:103-106`.
- **Evidence:**
  - **Binance listed LKR = 6.70 billion.** Four bid-only merchants hold 5.58 billion of it (83 %), all well below mid (347.56):

    | Merchant | Bid | Distance from mid | Listed LKR |
    |---|---|---|---|
    | FASTORA | 307.02 | −11.7 % | 1.82 B |
    | 07_Exchange | 339.78 | | 1.35 B |
    | PENGUIN_Exchange | 336.68 | | 1.34 B |
    | SiaCrypt | 326.99 | | 1.06 B |

  - **Bybit top-20 bids = 447,556 USDT vs asks = 13,098 USDT.** The book-balance card says "+94 %, more buyers than sellers". Three bids sit at Bybit's per-ad cap `tokenMaxQuote = 100000`: BULK-BUYER ×2 and CEYLON_BANK.
  - **Within ±0.5 % of mid, Bybit has 207,300 USDT of bids and only 275 USDT of asks.** Bid ads are not escrowed, because the buyer pays LKR later, so bid "available" is a declared budget. Ask "available" is frozen USDT.
- **Fix:**
  - Define near-touch depth as `depthX(side) = Σ min(available, maxOrder/price)` over ads with `|price/mid − 1| ≤ X`, using X = 0.5 % and 1 %.
  - Store `bid_depth_1pct` and `ask_depth_1pct` in `market_snapshots`. The schema is being edited now, so add them there.
  - Use these for the KPI, the imbalance, the heatmap, the market share and the alerts.
  - Label the bid side "declared". Keep the raw top-20 totals only as a secondary line.

### F5 · wrong-number · Bybit merchant detection always says "not a merchant"
- **Where:** `lib/exchanges/bybit.ts:101-102`, `lib/merchant-tier.ts:28-32`, `lib/compare.ts:186-201` (`verifiedOnly`).
- **Evidence:**
  - Every raw Bybit item has `userType: "PERSONAL"`, including LedgerkingLK with `authTag ["VA1","GA","VA","VA2","VA3"]` and `authStatus 1`.
  - All 58 Bybit merchants come back with `isMerchant: false`.
  - The `userIdentity` string is `"VA1,GA,VA"`, which never matches `/MERCHANT/`, so `deriveMerchantTier` returns `null`.
  - Results: no Bybit tier badges, and "Verified only" in the compare book constructor empties the Bybit book.
- **Fix:**
  - `isMerchant = authTag.some(t => /^VA\d?$/.test(t)) || authTag.includes("BA")`.
  - Tier: `VA3`→gold, `VA2`→silver, `VA`/`VA1`→bronze. Confirm the mapping against the Bybit UI badge.
  - `authStatus === 2` with only `GA` means a general (unverified) advertiser.

### F6 · wrong-number · The release-time part of the trust score is a constant
- **Where:**
  - `lib/exchanges/binance.ts:132` reads `avgReleaseTimeOfLatestOnline`, which is not in the search response. The raw advertiser keys are: `userNo, nickName, monthOrderCount, monthFinishRate, positiveRate, userType, userGrade, userIdentity, vipLevel, activeTimeInSecond, …`.
  - Bybit sets `avgReleaseSec: undefined`.
- **Evidence:** 0 of 281 Binance merchants and 0 of 58 Bybit merchants have `avgReleaseSec`. Every trust score therefore includes a flat 12/20 for release (`lib/analytics.ts:218-225`), and the "Release" column is always empty.
- **Fix:**
  - Drop the release component and rescale the other two parts.
  - Alternatively, fill release time only for top-of-book merchants from the profile endpoint already used in `lib/qr-resolve.ts` (`avgReleaseTimeSec`). Bybit exposes `latestReleaseTime` per item, but its semantics need checking.
  - See D7 for a defensible score.

### F7 · misleading · The trust score barely tells merchants apart and rewards tiny samples
- **Where:** `lib/analytics.ts:206-227`, duplicated at `:328-345`, `lib/dashboard.ts:92`, and `app/(app)/merchants/[id]/page.tsx:43`. That is four copies.
- **Evidence:**
  - Completion is linear on 0..1 × 50, but real values sit between 0.92 and 1.00, so the real spread is about 4 points.
  - The order count saturates at 2,000 per 30 days.
  - DGAK (15 orders, 100 %) gets 50 completion points, the same as HASSY (3,677 orders, 99.6 %).
  - The Binance top 8 all score 91–92.
- **Fix:**
  - Use the Wilson lower bound of completion with `n = orders30d`; formula in D7. DGAK then gets 0.796 and HASSY 0.993.
  - Keep one shared `trustScore()` and import it everywhere.

### F8 · wrong-number · The risk page always flags "merchant churn" on the 1h range
- **Where:** `lib/risk.ts:157-176`.
- **Evidence:** `/api/risk?exchange=binance&range=1h` returns the `merchant-churn` signal with "205/205 fresh". The window starts one hour ago, so every merchant's `firstTs` in the window is ≥ `hourAgo`.
- **Fix:**
  - "Fresh" should mean `merchants.first_seen_ts >= hourAgo`. The column already exists; `listAllKnownMerchants` drops it.
  - Do not evaluate churn when the window is shorter than 2 hours.

### F9 · misleading · The price-spike z-score fires on tiny moves
- **Where:** `lib/risk.ts:98-121`, `lib/stats.ts:41-51`.
- **Evidence:**
  - 1h range: latest mid 347.555 vs MA20 347.878, a −0.09 % move, is reported as z = −3.92, which is ALERT level.
  - The z-score compares the last *level* with all earlier levels in the range. That is not "vs MA20" as the doc comment and detail text say. In a trending or step-priced market almost any latest point looks extreme.
- **Fix:**
  - Compute z on 5-minute *changes*: `r_t = mid_t/mid_{t−1} − 1`.
  - Use a robust scale: `z = (r_last − median(r)) / (1.4826·MAD(r))` over the last 24 h.
  - Fire only when |z| ≥ 3 **and** |r| ≥ 0.25 %.

### F10 · wrong-number · Arbitrage cards price the whole capital at the best ad, even when that ad is tiny
- **Where:** `components/arbitrage/cross-exchange.tsx:126-139`, `lib/arbitrage.ts:70-86`.
- **Evidence:**
  - Binance best ask 348.36 (DGAK) holds 300.30 USDT, about Rs 104.6k, and only accepts orders of Rs 104,500–104,609.
  - Bybit best ask 348.72 holds 7.62 USDT, Rs 2,656.
  - "Net on Rs 500,000" uses those prices. Walking the book with the ladder logic gives an effective price of 348.392 on Binance and **349.79 on Bybit**, which is +1.07 LKR per USDT.
  - The only warning shown is about min/max limits, never about the available amount.
- **Fix:**
  - Default the cards to `fillAmount(asks, "SELL", capital)` for the buy leg, then `fillAmount(bids, "BUY", usdt × topBid)` for the sell leg, once F1 is fixed.
  - Show the "top of book" price only as a secondary line.

### F11 · misleading · The Compare head-to-head verdict uses top-of-book only
- **Where:** `lib/compare.ts:99-155`.
- **Evidence:**

  | | Top-of-book buy price | Gap | Effective buy price at Rs 1M | Gap |
  |---|---|---|---|---|
  | Binance | 348.36 | 0.36 | 348.486 | 1.47 |
  | Bybit | 348.72 | | 349.956 | |

  At Rs 5M Bybit asks reach 365.26, because 4.53M of the walk fills into outliers.
- **Fix:**
  - Add an amount selector, defaulting to Rs 500k.
  - Pick the verdict from `fillAmount` effective prices.
  - Show "fillable up to Rs X within 0.5 %".

### F12 · misleading · VWAP and median are skewed by outlier ads
- **Where:** `lib/analytics.ts:21-30,52-70`. The values go to `market_snapshots.vwap*`, the liquidity strip, and the "market median" used by merchants.
- **Evidence:**
  - Bybit ask VWAP = 364.54 against a best ask of 348.72 (+4.5 %). The ask median is 350.95.
  - Bybit asks at 384.50, 384.90, 385.00, 388.90, 389.00 and 399.35 are 10–15 % off the touch, inside the top 20 because the book is so thin.
  - VWAP is weighted by declared `available` over the whole top 20. That is not a price anyone can trade at.
- **Fix:**
  - Replace it with VWAP-to-fill: `vwap(X) = filledFiat / filledUsdt` from `fillAmount`, for example X = Rs 1M per side, and label it "Avg price for Rs 1M".
  - Exclude ads more than 3 % from the best price from the median, the depth and the HHI, and report them as "off-market ads: n".

### F13 · misleading · KPI values and their 24h sparklines come from different books
- **Where:**
  - `app/(app)/(home)/page.tsx:33-41`. History is `market_snapshots`, which holds all publishers.
  - The KPI values come from the page's default `merchantType=merchant` book.
  - The same pattern is in `lib/dashboard.ts:54-75` (market tiles: merchant book vs all-publisher spark and `change24h`).
- **Evidence:** The all-publisher best ask is 348.36 (DGAK, `userType: "user"`). The merchant-only best ask is a different ad (S_P_I_D_E_R, 348.40, the best `merchant`). The sparkline's last point and the "24h change" do not describe the number printed above them. The caption "24h, all ads" is easy to miss.
- **Fix:**
  - Either record a second snapshot series for the merchant variant (the KV book already exists every minute, `ingest/jobs.ts:62-74`), or compute the KPI value from the "all" book when no filter is set.
  - At minimum, put the label "all publishers" next to the change chip.

### F14 · misleading · The activity "Est. filled" figure is mostly price edits and noise
- **Where:** `lib/activity.ts:111-138`.
- **Evidence:** In local D1, Binance shows 72 counted "fills" adding up to Rs 3.73M.
  - Rs 2.02M (54 %) happened in an interval where the merchant's best price changed. `total_available_fiat = available × price`, so a price cut on a large ad looks like a fill.
  - Rs 2.04M (55 %) happened with **no change** in the merchant's 30-day order count.
  - Bids are declared budgets (F4), so a bid shrinking also does not prove a trade.
- **Fix:**
  - Store `total_available_asset` per side (USDT) in `merchant_snapshots` and measure drops in USDT.
  - Count a drop only on the ask side, and only when `orders_month` rose between the two sweeps.
  - Alternatively, publish Σ positive Δ`orders_month` as an "orders index". See D9.

### F15 · wrong-number · "Your position on the book" is capped at 20
- **Where:** `lib/dashboard.ts:117` asks for `getBook(..., 100)`. The KV copy only holds the top 20 (`lib/ingest/jobs.ts:28,32`), and `getBook` slices it (`lib/market-data.ts:35-36`).
- **Evidence:** Any merchant whose best ad is 21st or lower shows "not on the book". The positions shown are "x of ≤20".
- **Fix:**
  - On sweep ticks, write the full deep book to KV, about 300 ads per side.
  - Alternatively, rank from the `merchants` table: `rank = 1 + count(merchants with bestSellPrice < mine)` among merchants seen in the latest sweep.

### F16 · misleading · Offline advertisers count as liquidity (Bybit)
- **Where:** `lib/exchanges/bybit.ts:100-140` ignores `isOnline`.
- **Evidence:** Raw bid ads from ROYAL EXCHANGE, CEYLON_BANK (100,000 USDT), Navod_Wise (68,242 USDT), Lia876, EUROSTAR and CRyptoKiller all have `isOnline: false`. They are counted in best price, depth, HHI and imbalance.
- **Fix:**
  - Map `merchant.online = item.isOnline`.
  - Down-weight or exclude offline ads in depth and executable price.
  - Show a dot in the ads table.

### F17 · improvement · Ads with counterparty restrictions are shown as available to everyone
- **Where:** Normalisation in both adapters.
- **Evidence:**
  - Bybit CeylonVIP: `tradingPreferenceSet` requires completion ≥ 85 %, account ≥ 15 days and ≥ 5 orders.
  - Binance adverts carry `buyerRegDaysLimit`, `userTradeCompleteRateMin`, `userAllTradeCountMin` and `takerAdditionalKycRequired`.
- **Fix:** Normalise these into `ad.restrictions` and show a "restricted" badge. The best-price KPI should optionally exclude restricted ads.

### F18 · unclear · Binance available amount and max order use the gross fields
- **Where:** `lib/exchanges/binance.ts:112-114`.
- **Evidence:** DGAK raw values:
  - `surplusAmount 300.30`, but `tradableQuantity 300.00`.
  - `maxSingleTransAmount 104609`, but `dynamicMaxSingleTransAmount 104508`.
- **Fix:**
  - `available = Number(tradableQuantity ?? surplusAmount)`.
  - `maxOrder = min(maxSingleTransAmount, dynamicMaxSingleTransAmount || ∞)`.
  - This is a small (~0.1 %) difference, but it decides whether an exact-size ad is fillable.

### F19 · unclear · Bybit 30-day orders can silently fall back to lifetime counts
- **Where:** `lib/exchanges/bybit.ts:131-134`.
- **Evidence:** `finishNum` and `orderNum` are lifetime counts per ad. For example LedgerkingLK has 6,407 and 6,512 against `recentOrderNum` 1,274. When `recentOrderNum` is 0, a lifetime number is shown as "30d orders".
- **Fix:** Use `recentOrderNum` only, and `null` when it is missing.

### F20 · unclear · Bybit payment methods have no names, and the method breakdown covers only some ads
- **Where:** `lib/exchanges/bybit.ts:46`, `lib/market-insights.ts:222-256`.
- **Evidence:**
  - Rows read "Payment 90", "Payment 817", "Payment 18", "Payment 814", "Payment 78" and "Payment 815".
  - Books are fetched with bank-only `payTypes`, so rows such as "Mobiletopup" or "CashDeposit" (Binance) only include ads that *also* accept bank transfer. Their prices are not representative of those methods.
- **Fix:**
  - Add a name map, fetched once from Bybit's payment-list endpoint or hard-coded.
  - In the breakdown, show only the queried rails, or mark other rows "subset: ads that also accept bank transfer".

### F21 · misleading · Data gaps are drawn as straight lines
- **Where:**
  - `lib/history.ts:147-206`: `bucketize` emits only buckets that have data.
  - `connectNulls` is used in `components/historical/price-chart.tsx:94-172`, `spread-chart.tsx:60` and `depth-chart.tsx:50`.
  - `lib/stats.ts:28` (`sma` carries the last value forward over nulls).
- **Evidence:** Local D1 has a 20,040 s (5.6 h) gap at ts 1795100395. The 24h price, spread and depth charts join it with a straight segment, which looks like a calm market.
- **Fix:**
  - Fill the bucket grid from `since` to `now` with `null` rows.
  - Drop `connectNulls`, or bridge at most 2 buckets.
  - Show a "no data" band where gaps are longer than 3 buckets.
  - The KPI sparklines in `(home)/page.tsx` need the same treatment.

### F22 · unclear · MA20/MA60 count buckets, so their time span changes with the range
- **Where:** `components/historical/history-charts.tsx:271-301`.
- **Evidence:**
  - "MA20" means 100 min on 24h, 20 h on 7d, and 40 h on 30d.
  - Across the 5.6 h gap, 20 points cover more than 6 h.
  - The first 19 points show a running mean but are labelled MA20.
- **Fix:**
  - Use time-based averages, for example 1h/4h for ranges up to 24h and 24h/7d for 7d/30d, computed over the timestamp window.
  - Return `null` until the window is full, and label them with their duration.

### F23 · misleading · The rates premium uses mid instead of the side the user trades
- **Where:** `lib/fx/overview.ts:170-180`, `components/rates/premium-chart.tsx:50`, `app/(app)/rates/page.tsx:157`.
- **Evidence:**
  - The premium is `avgMid / ref − 1` for both references.
  - A remitter or seller receives the **bid**: Binance 346.75 vs mid 347.56, which is −0.23 % on the premium.
  - A buyer pays the **ask**.
  - The "best bank TT buy" reference is what a bank pays for USD. It should be compared with the P2P **bid**, like for like.
- **Fix:**
  - `sellPremium = bid / max(bankTtBuy) − 1`.
  - `buyPremium = ask / min(bankTtSell) − 1`. For CBSL, use the indicative rate for both.
  - Daily bid and ask are already in `p2pDaily` (`lib/fx/queries.ts:126`).
  - Add a note that USDT ≈ USD.

### F24 · misleading · Old snapshots can be shown as live
- **Where:**
  - `lib/fx/overview.ts:89-93` falls back to `latestMarketSnapshot` with no age check.
  - `lib/risk.ts:86-89,152-155` uses the latest snapshot and latest sweep, whatever their age.
- **Fix:**
  - Return `null`, or add a `stale: true` flag, when `now − ts > 600 s`.
  - Show "as of hh:mm" on the rates P2P card and on the risk page.

### F25 · unclear · Sri Lanka hours and days are rounded down by 30 minutes
- **Where:** `lib/db/queries.ts:277-281` (heatmap) and `lib/fx/queries.ts:123` (`p2pDaily`).
- **Evidence:**
  - UTC hour 18:00–19:00 is 23:30–00:29 in Sri Lanka. It is all counted as 23:00 on the previous day.
  - Half of every heatmap cell and 1/48 of every daily average is assigned to the wrong hour or day.
- **Fix:**
  - Build the heatmap from raw `market_snapshots`, which are kept 14 days, using `floor((ts + 19800) / 3600) % 24`.
  - Alternatively, roll up at 30-minute boundaries.

### F26 · misleading · The remittance "via USDT" route uses top-of-book for any amount
- **Where:** `components/rates/remittance.tsx:56-59`.
- **Fix:**
  - `viaUsdt = fillAmount(bids, "BUY", usdt × bestBid).filledFiat`, with a partial-fill warning.
  - The currency→USDT leg uses the CBSL mid cross rate. Add an explicit "FX spread %" input next to the fee, defaulting to about 1 %.

### F27 · improvement · The showcase heuristic flags low-frequency merchants
- **Where:** `lib/market-insights.ts:293-302`.
- **Evidence:** DGAK has 15 orders in 30 days, so it expects 0.06 orders in 3 h. A frozen 30-day count is normal for it, not evidence of a parked ad. The amount check is in LKR, so a showcase ad that is repriced escapes detection.
- **Fix:**
  - Require `orders30d × span / 30d ≥ 2` before a frozen order count counts as evidence.
  - Compare amounts in USDT, which needs the per-side asset column from F14.

### F28 · improvement · Downsampling hides spikes
- **Where:** `lib/risk.ts:60-67` and `lib/market-insights.ts:318` (`thin`), which pick every k-th point. The home KPIs use `thin(rows, 96)`.
- **Fix:** Use min/max-preserving downsampling: keep the bucket's min and max, or LTTB.

### F29 · unclear · The spread chart cuts off negative values
- **Where:** `components/historical/spread-chart.tsx:50` (`domain={[0,"auto"]}`).
- **Fix:** Use `["auto","auto"]` with a zero reference line, so a crossed book (spread < 0) is visible.

### F30 · misleading · The `depthBelow` alert adds both sides together
- **Where:** `lib/alerts/evaluate.ts:103-106`.
- **Evidence:** On Bybit, the bid placeholders keep the total above 400k USDT, so the alert never fires even when the asks vanish (13k).
- **Fix:** Add `askDepthBelow` and `bidDepthBelow` rules on near-touch depth (F4).

### F31 · misleading · The arbitrage projection ignores risk and capacity
- **Where:** `lib/arbitrage.ts:198-201`.
- **Fix:**
  - Cap cycles per day by fillable depth: `min(cycles, depthAtGap / capital)`.
  - Show a price-risk band, `±k·σ30` of the mid over the 15–30 min payment window, using σ of 30-minute mid changes from `market_snapshots`.
  - Note the bank-side costs: transfer fees, the per-transfer cap, and CEFTS vs SLIPS timing.
  - Note that taker-to-taker on one exchange is negative by construction (spread 1.61 / 1.72 LKR), so profit needs a maker leg (D5).

---

## 2. Verified correct (no need to re-check)

**Side mapping**
- **Binance query inversion** (`binance.ts:63`). Query `BUY` returns `adv.tradeType: "SELL"` ads at 348.36, above the bids at 346.75. The mapping is right.
- **Bybit `side`**. `"0"` is bids (raw 346.91 < asks 348.72), `"1"` is asks. No inversion is needed. Right.

**Market statistics and labels**
- `sideStats` best price: asks use `min`, bids use `max`. The spread is `bestAsk − bestBid`: +1.61 on Binance and +1.72 on Bybit. `spreadPct = spread/mid` gives 0.463 % and 0.494 %.
- KPI labels: "Best price to buy USDT" is `sell.bestPrice`, and "Best price to sell USDT" is `buy.bestPrice`.
- Green and red are used the same way everywhere: green is buy USDT / asks, red is sell USDT / bids. Checked in the KPIs, depth chart, ladder, ads table, liquidity strip, method breakdown, arbitrage cards and historical legend.
- The method breakdown's spread is `avgTopN(ask) − avgTopN(bid)`, with the right sorting per side.

**Units**
- Completion rate: Binance `monthFinishRate` is a fraction (1.0 or 0.996), and Bybit `recentExecuteRate` is 0–100, divided by 100. No off-by-100.
- Amounts: `available` is USDT on both exchanges (`surplusAmount` and `lastQuantity`). `minOrder` and `maxOrder` are LKR on both. Depth tooltips say USDT and LKR correctly.

**Walks and arbitrage maths**
- `fillAmount` (the ladder) skips ads whose minimum is too big, respects max and available amounts, and measures slippage against the top with the right sign per side.
- Arbitrage `askAds` and `bidAds` sorting, the `cycle()` formula, and `breakEvenSell = (capital+fixed)/(usdtSold·(1−sellFee))`.

**Compare and alerts**
- `lib/compare.ts` `summarize` maps sell ads to `buyUsdt` and buy ads to `sellUsdt`.
- `verdict`: lower ask wins the buy side, higher bid wins the sell side.
- `mergeSpreadSeries` uses an exact timestamp join, which is valid because both exchanges share the tick timestamp.
- The `evalOffMarket` edge direction is right per side and excludes ads that can't meet their own minimum. `evalMarketRule` uses mid and spreadPct as a fraction, matching its labels.

**Rollups and history**
- The hourly rollup's `first_value` / `last_value` with a full-frame window gives true open and close. High and low are max and min of mid.
- `marketSummary` and `p2pDaily` are weighted by sample count.
- `bucketize` gives true OHLC (first open, max high, min low, last close) and weighted means.

**Other**
- HHI is `Σ share²` on LKR value, and the top-k shares are right (apart from the input problem in F4).
- The KV live book is rejected after 5 minutes (`lib/live.ts:54`), and the page falls back to a live fetch.
- The SLT offset is applied in the heatmap, the merchant activity hours and the SLT day formatting (apart from the rounding in F25).
- Rates: the premium direction (`P2P/ref − 1`, positive means P2P is above) and the remittance cross rate (`(LKR/X)/(LKR/USD)` gives USD per unit of X) are right.

---

## 3. Decision features to add (ranked)

### D1 · "Price for my amount" as the headline number
For a user-entered amount A (LKR, default Rs 500k), show `effBuy(A) = fillAmount(asks,"SELL",A).effectivePrice` and `effSell(A)` on both exchanges, side by side.
- Also show the fillable capacity within 0.5 %: the largest A with `slippage ≤ 0.5 %`, found by bisection over `fillAmount`.
- Data: the KV book. Raise the KV copy to about 50 ads per side so Rs 1–5M sizes are covered (F11 shows Bybit runs out at about Rs 4.5M).
- Use it for the KPIs, the Compare verdict, arbitrage and remittance.

### D2 · Ad placement helper: "where to post to rank in the top N"
- Price to rank k:
  - Selling: `askPrice_k = sortedAsks[k−1].price − 0.01`.
  - Buying: `bidPrice_k = sortedBids[k−1].price + 0.01`.
- Count only ads whose `[minOrder, maxOrder]` overlaps the user's own limits, and only online, unrestricted ads (F16, F17).
- Show the margin of that price vs mid and vs the opposite best: `margin = (askPrice_k − bestBid)/bestBid`.
- Show the current rank of the user's own ad, using the full sweep (F15).
- Data: the KV book plus the `merchants` table.

### D3 · Near-touch liquidity (±0.5 % / ±1 %) per side, live and over time
- Formula in F4. It needs four new columns in `market_snapshots` and in the hourly rollup.
- It replaces the raw top-20 depth in the KPIs, the heatmap, the market share and the alerts.
- Show "asks within 0.5 %: 275 USDT" plainly. That one number would have told a Bybit buyer the book is empty.

### D4 · Best time to trade (SLT weekday × hour)
- For each cell, from raw snapshots (14 days) with SLT-exact hours (F25):
  - `askDev = median(bestAsk / dailyMedianMid − 1)`. A low value means a good time to buy.
  - `bidDev = median(bestBid / dailyMedianMid − 1)`. A high value means a good time to sell.
  - The median spread %.
  - Near-touch depth.
- Present it as two heatmaps ("cheapest hours to buy" and "best hours to sell") with the cell's n. Grey out cells with fewer than 5 days of data.

### D5 · Maker spread capture and merchant P&L
- For a merchant quoting both sides at rank k: `grossMargin = (askPrice_k − bidPrice_k)/bidPrice_k − makerFeeBuy − makerFeeSell`.
- Show its history from the snapshot series, as the median and the 10th/90th percentiles of `(bestAsk − bestBid)/mid` per day. The fee inputs default to 0 and are editable; check the current exchange maker fees.
- Add a cross-exchange version: buy at the Binance effective ask for size A, sell at the Bybit effective bid for size A, minus the network fee and a ±1σ30 price-risk band (F31).
- This is the realistic P2P business, unlike taker-to-taker arbitrage.

### D6 · Premium vs official and bank rates, by side
- `sellPremium = bid / bestBankTtBuy − 1` and `buyPremium = ask / bestBankTtSell − 1`, daily and live (F23).
- Add a remittance break-even: the P2P bid at which converting via USDT matches the bank TT. That is `bankTtBuy × (1 + feeUSDT%)`, with FX conversion cost added.
- Data: `p2pDaily` bid/ask plus `fx_rates`.

### D7 · A defensible merchant reliability score
- `completionLB = (p + z²/2n − z·√(p(1−p)/n + z²/4n²)) / (1 + z²/n)`, with `p = completion`, `n = orders30d` and `z = 1.96`.
- `score = 60·completionLB + 20·min(1, log10(1+orders30d)/log10(2000)) + 10·presence7d + 10·tenure`:
  - `presence7d` is the share of 7-day hours seen in `merchant_hourly`.
  - `tenure` is `min(1, (now − first_seen_ts)/90d)`.
- Add online status (Bybit) and the Binance `positiveRate` as tie-breakers.
- Example: DGAK 0.796 vs HASSY 0.993, a real gap where today they are tied.
- **Implemented (lib/merchant-score.ts), extended with the Binance profile:** `45·completionLB + 15·volume + 15·feedbackLB + 10·release + 5·presence7d + 5·tenure + 5·accountAge`. `feedbackLB` is the Wilson lower bound of positive/(positive+negative); `release` is 1 at ≤ 2 min and 0 at ≥ 15 min; `accountAge = min(1, registerDays/730)`. Unknown parts (Bybit, or a profile not collected yet) are dropped and the rest rescaled to 100.

### D8 · Spread and volatility regime
- The current spread % as a percentile of the last 7 days ("today's spread is in the 85th percentile").
- `σ30 = stdev(mid_t/mid_{t−30min} − 1)` over 24 h, shown as "expected move during a 15-min payment window: ±x LKR".
- Data: `market_snapshots`.

### D9 · Orders index as an activity proxy (replaces "est. filled")
- `ordersIndex(hour) = Σ_merchants max(0, Δorders_month)` between consecutive sweeps.
- Exchanges update this as a rolling 30-day count, so expired orders understate it. Present it as an index, not as LKR volume.
- Show it by exchange and SLT hour.
- Data: `merchant_snapshots` / `merchant_hourly.orders_month`.

### D10 · Alerts that answer a trade question
- "Effective buy price for Rs X < P" and "effective sell price for Rs X > P", using `fillAmount` on the in-memory book in `evaluateAlerts`.
- "Asks within 0.5 % < N USDT".
- "My ad lost top-3", using D2's rank.
