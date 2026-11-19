/**
 * Pure, client-safe analytics for the Live Markets and Merchants pages.
 * Everything here works on the normalized ads already in a MarketSnapshot,
 * so it can run on the server for the first paint and again on the client
 * after each poll without another request.
 *
 * Side vocabulary (same as the rest of the app):
 *   tradeType "BUY"  = bids: publishers buying USDT  → where you SELL USDT.
 *   tradeType "SELL" = asks: publishers selling USDT → where you BUY USDT.
 */

import type { NormalizedAd, TradeType } from "./types";
import { walkBook, type WalkOptions, type WalkResult } from "./liquidity";

/* ── Order-book depth curve ─────────────────────────────────────────────── */

export type DepthPoint = {
  price: number;
  /** Cumulative bid size (USDT) available at this price or better. */
  bid: number | null;
  /** Cumulative ask size (USDT) available at this price or better. */
  ask: number | null;
};

export type DepthCurve = {
  points: DepthPoint[];
  mid: number | null;
  /** Symmetric x-domain around mid, so bids and asks mirror. */
  domain: [number, number] | null;
  bidTotal: number;
  askTotal: number;
};

const byBest = (side: TradeType) => (a: NormalizedAd, b: NormalizedAd) =>
  side === "SELL" ? a.price - b.price : b.price - a.price;

function sideOf(ads: readonly NormalizedAd[], side: TradeType) {
  return ads.filter((a) => a.tradeType === side && a.price > 0).sort(byBest(side));
}

/**
 * Stepped cumulative depth. Bids accumulate from mid downward, asks from mid
 * upward. Render bids with `type="stepBefore"` and asks with `"stepAfter"`
 * on an ascending numeric price axis — the steps then sit exactly on each
 * ad's price.
 */
export function depthCurve(ads: readonly NormalizedAd[]): DepthCurve {
  const bids = sideOf(ads, "BUY");
  const asks = sideOf(ads, "SELL");
  const bestBid = bids[0]?.price ?? null;
  const bestAsk = asks[0]?.price ?? null;
  const mid =
    bestBid != null && bestAsk != null
      ? (bestBid + bestAsk) / 2
      : bestBid ?? bestAsk ?? null;

  // Merge ads at the same price into one level.
  const levels = (list: NormalizedAd[]) => {
    const out: { price: number; size: number }[] = [];
    for (const a of list) {
      const last = out[out.length - 1];
      if (last && last.price === a.price) last.size += a.available;
      else out.push({ price: a.price, size: a.available });
    }
    return out;
  };

  const bidPts: DepthPoint[] = [];
  let cum = 0;
  for (const l of levels(bids)) {
    cum += l.size;
    bidPts.push({ price: l.price, bid: cum, ask: null });
  }
  const bidTotal = cum;
  bidPts.reverse(); // ascending price

  const askPts: DepthPoint[] = [];
  cum = 0;
  for (const l of levels(asks)) {
    cum += l.size;
    askPts.push({ price: l.price, bid: null, ask: cum });
  }
  const askTotal = cum;

  if (mid == null) return { points: [], mid: null, domain: null, bidTotal, askTotal };

  // Crossed or touching books: keep the anchor strictly between sides.
  const points: DepthPoint[] = [
    ...bidPts.filter((p) => p.price <= mid),
    { price: mid, bid: 0, ask: 0 },
    ...askPts.filter((p) => p.price >= mid),
  ];

  const lo = bidPts[0]?.price ?? mid;
  const hi = askPts[askPts.length - 1]?.price ?? mid;
  // Mirror around mid, capped at ±4 % so one silly outlier ad doesn't
  // squash the whole curve.
  const cap = mid * 0.04;
  const half = Math.min(cap, Math.max(mid - lo, hi - mid, mid * 0.002));
  // Extend each side flat to the domain edge so the area reaches the frame.
  const first = points[0];
  if (bidPts.length && first.price > mid - half) {
    points.unshift({ price: mid - half, bid: bidTotal, ask: null });
  }
  const last = points[points.length - 1];
  if (askPts.length && last.price < mid + half) {
    points.push({ price: mid + half, bid: null, ask: askTotal });
  }

  return {
    points,
    mid,
    domain: [mid - half, mid + half],
    bidTotal,
    askTotal,
  };
}

/* ── Price for amount (walk the book) ───────────────────────────────────── */

export const LADDER_AMOUNTS = [50_000, 100_000, 500_000, 1_000_000] as const;

export type LadderRow = { amount: number; buy: WalkResult; sell: WalkResult };

/** "Buy" = you buy USDT (walk asks). "Sell" = you sell USDT (walk bids).
 *  Uses the one shared walk in `lib/liquidity.ts`. */
export function priceLadder(
  ads: readonly NormalizedAd[],
  amounts: readonly number[] = LADDER_AMOUNTS,
  opts: WalkOptions = {},
): LadderRow[] {
  return amounts.map((amount) => ({
    amount,
    buy: walkBook(ads, "SELL", amount, opts),
    sell: walkBook(ads, "BUY", amount, opts),
  }));
}

/* ── Per-payment-method breakdown ───────────────────────────────────────── */

export const TOP_N_OPTIONS = [1, 3, 5, 10] as const;
export type TopN = (typeof TOP_N_OPTIONS)[number];

export type MethodRow = {
  id: string;
  name: string;
  /** Avg of the best N ask prices (you buy USDT here). */
  buyPrice: number | null;
  /** Avg of the best N bid prices (you sell USDT here). */
  sellPrice: number | null;
  spread: number | null;
  spreadPct: number | null;
  askDepth: number;
  bidDepth: number;
  askCount: number;
  bidCount: number;
};

function avgTop(list: NormalizedAd[], n: number) {
  const top = list.slice(0, n);
  return top.length ? top.reduce((s, a) => s + a.price, 0) / top.length : null;
}

/**
 * Price, spread and depth per payment method found in the ads. An ad that
 * accepts several methods counts towards each of them.
 */
export function methodBreakdown(ads: readonly NormalizedAd[], topN: number): MethodRow[] {
  const groups = new Map<string, { name: string; bids: NormalizedAd[]; asks: NormalizedAd[] }>();
  for (const a of ads) {
    for (const pm of a.payMethods) {
      let g = groups.get(pm.id);
      if (!g) {
        g = { name: pm.name || pm.id, bids: [], asks: [] };
        groups.set(pm.id, g);
      }
      (a.tradeType === "BUY" ? g.bids : g.asks).push(a);
    }
  }
  const rows: MethodRow[] = [];
  for (const [id, g] of groups) {
    g.bids.sort(byBest("BUY"));
    g.asks.sort(byBest("SELL"));
    const buyPrice = avgTop(g.asks, topN);
    const sellPrice = avgTop(g.bids, topN);
    const spread = buyPrice != null && sellPrice != null ? buyPrice - sellPrice : null;
    const mid = buyPrice != null && sellPrice != null ? (buyPrice + sellPrice) / 2 : null;
    rows.push({
      id,
      name: g.name,
      buyPrice,
      sellPrice,
      spread,
      spreadPct: spread != null && mid ? spread / mid : null,
      askDepth: g.asks.reduce((s, a) => s + a.available, 0),
      bidDepth: g.bids.reduce((s, a) => s + a.available, 0),
      askCount: g.asks.length,
      bidCount: g.bids.length,
    });
  }
  return rows.sort((a, b) => b.askCount + b.bidCount - (a.askCount + a.bidCount));
}

/* ── Showcase-ad detection (estimate) ───────────────────────────────────── */

/** Per-merchant aggregates over a recent window of 5-minute sweeps. */
export type StabilityStats = {
  merchantId: string;
  samples: number;
  firstTs: number;
  lastTs: number;
  minAvailFiat: number | null;
  maxAvailFiat: number | null;
  /** Listed USDT (bids + asks) range. Null when any sweep in the window
   *  predates the per-side USDT columns (then the LKR range is used). */
  minAvailAsset?: number | null;
  maxAvailAsset?: number | null;
  minOrders: number | null;
  maxOrders: number | null;
};

export type ShowcaseFlag = {
  /** "likely" = amount and order count both frozen for the whole window. */
  level: "likely";
  samples: number;
  spanSec: number;
  availFiat: number | null;
  /** Orders the merchant's own 30-day pace predicts over the window. */
  expectedOrders: number;
  /** Which amount was compared: USDT (preferred) or LKR (older rows). */
  amountUnit: "asset" | "fiat";
};

export const SHOWCASE_WINDOW_SEC = 6 * 3600;
/** Need at least this much continuous evidence before calling it. */
const MIN_SAMPLES = 24; // ≈ 2 h of 5-minute sweeps
const MIN_SPAN_SEC = 3 * 3600;
/** Listed amount may wobble this much (rounding, small partial edits). */
const AMOUNT_TOLERANCE = 0.01;
/**
 * A frozen 30-day order count only counts as evidence when the merchant's
 * own pace says at least this many orders should have landed in the
 * window (F27): orders30d × span / 30 d ≥ 2. A merchant with 15 orders a
 * month expects 0.06 orders in 3 h, so a frozen count tells us nothing.
 */
export const SHOWCASE_MIN_EXPECTED_ORDERS = 2;
const MONTH_SEC = 30 * 86400;

/**
 * Heuristic: an advertiser whose listed amount (USDT across their ads, or
 * LKR for older rows) and 30-day order count never move over several hours
 * of sweeps — while their usual pace says orders should have landed — is
 * probably not trading: a "showcase" ad parked for visibility. USDT is
 * compared rather than LKR so repricing an idle ad doesn't hide it. It's an
 * estimate: per-ad history isn't stored, only per-merchant totals.
 */
export function classifyShowcase(s: StabilityStats): ShowcaseFlag | null {
  const span = s.lastTs - s.firstTs;
  if (s.samples < MIN_SAMPLES || span < MIN_SPAN_SEC) return null;
  if (s.minOrders == null || s.maxOrders == null || s.maxOrders !== s.minOrders) return null;
  const expectedOrders = (s.maxOrders * span) / MONTH_SEC;
  if (expectedOrders < SHOWCASE_MIN_EXPECTED_ORDERS) return null;

  const useAsset = s.minAvailAsset != null && s.maxAvailAsset != null && s.maxAvailAsset > 0;
  const lo = useAsset ? s.minAvailAsset! : s.minAvailFiat;
  const hi = useAsset ? s.maxAvailAsset! : s.maxAvailFiat;
  if (lo == null || hi == null || hi <= 0) return null;
  if ((hi - lo) / hi > AMOUNT_TOLERANCE) return null;
  return {
    level: "likely",
    samples: s.samples,
    spanSec: span,
    availFiat: s.maxAvailFiat,
    expectedOrders,
    amountUnit: useAsset ? "asset" : "fiat",
  };
}

export type ShowcaseMap = Record<string, ShowcaseFlag>;

export function showcaseMap(stats: readonly StabilityStats[]): ShowcaseMap {
  const out: ShowcaseMap = {};
  for (const s of stats) {
    const f = classifyShowcase(s);
    if (f) out[s.merchantId] = f;
  }
  return out;
}

/* ── Series helpers ─────────────────────────────────────────────────────── */

/** Evenly thin a series to at most `max` points (keeps first and last). */
export function thin<T>(rows: readonly T[], max: number): T[] {
  if (rows.length <= max) return rows.slice();
  const step = (rows.length - 1) / (max - 1);
  const out: T[] = [];
  for (let i = 0; i < max; i++) out.push(rows[Math.round(i * step)]);
  return out;
}
