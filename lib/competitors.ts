/**
 * Merchant tools: own spread and competitor compare. Pure and client-safe.
 *
 * Side vocabulary is the advertiser's (same as Binance / Bybit and
 * `lib/placement.ts`):
 *   - A merchant's Sell ad (tradeType "SELL") is where users buy USDT. Its
 *     price is the merchant's ask; best for the taker = lowest.
 *   - A merchant's Buy ad (tradeType "BUY") is where users sell USDT. Its
 *     price is the merchant's bid; best for the taker = highest.
 *
 * Competitors reuse `competingAds` from the placement helper (same side,
 * online, unrestricted, can fill an order, same rail, overlapping limits)
 * and add one filter of their own: the ad's minimum order is close to a
 * reference minimum (within ±band).
 */

import { competingAds, placementPrice, type OrderLimits } from "@/lib/placement";
import type { NormalizedAd, TradeType } from "@/lib/types";

/* ── Own spread ──────────────────────────────────────────────────────── */

export type OwnSpread = {
  /** Best Sell-ad price − best Buy-ad price, LKR per USDT. Negative = crossed. */
  lkr: number;
  /** `lkr` as a fraction of `mid`. */
  pct: number;
  /** (ask + bid) / 2. */
  mid: number;
};

/**
 * A merchant's own spread: their best Sell-ad price (ask) minus their best
 * Buy-ad price (bid). Null unless they quote both sides.
 */
export function ownSpread(
  bestSell: number | null | undefined,
  bestBuy: number | null | undefined,
): OwnSpread | null {
  if (bestSell == null || bestBuy == null || !(bestSell > 0) || !(bestBuy > 0)) return null;
  const lkr = bestSell - bestBuy;
  const mid = (bestSell + bestBuy) / 2;
  return { lkr, pct: lkr / mid, mid };
}

/**
 * Own spread after the maker fee on both legs, LKR per USDT. Selling USDT
 * the fee comes out of the USDT sold (you net ask × (1 − fee)); buying USDT
 * it comes out of the USDT received (each USDT costs bid ÷ (1 − fee)).
 */
export function netOwnSpread(
  bestSell: number | null | undefined,
  bestBuy: number | null | undefined,
  fee: number,
): number | null {
  if (!ownSpread(bestSell, bestBuy)) return null;
  const f = Number.isFinite(fee) && fee >= 0 && fee < 1 ? fee : 0;
  return bestSell! * (1 - f) - bestBuy! / (1 - f);
}

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type SpreadMedian = { lkr: number; pct: number; count: number };

/**
 * Median own spread among two-sided merchants (rows without both prices
 * are skipped). Pass only merchants listing now.
 */
export function medianOwnSpread(
  rows: readonly { bestSellPrice: number | null; bestBuyPrice: number | null }[],
): SpreadMedian | null {
  const lkr: number[] = [];
  const pct: number[] = [];
  for (const r of rows) {
    const s = ownSpread(r.bestSellPrice, r.bestBuyPrice);
    if (!s) continue;
    lkr.push(s.lkr);
    pct.push(s.pct);
  }
  if (!lkr.length) return null;
  return { lkr: median(lkr)!, pct: median(pct)!, count: lkr.length };
}

/** "tight" / "typical" / "wide" vs the market median (±25 % of it). */
export function spreadVsMedian(s: OwnSpread | null, m: SpreadMedian | null): "tight" | "typical" | "wide" | null {
  if (!s || !m) return null;
  const tol = Math.max(Math.abs(m.lkr) * 0.25, 0.01);
  if (s.lkr < m.lkr - tol) return "tight";
  if (s.lkr > m.lkr + tol) return "wide";
  return "typical";
}

/* ── Competitor compare ──────────────────────────────────────────────── */

/** Closeness bands for the minimum order; null = any minimum. */
export const MIN_BANDS = [0.1, 0.25, 0.5, null] as const;
export type MinBand = (typeof MIN_BANDS)[number];

/** Custom reference-minimum presets, LKR. */
export const MIN_PRESETS = [5_000, 10_000, 25_000, 50_000, 100_000] as const;

/** Whether an ad's minimum order is within ±band of the reference. */
export function inMinBand(minOrder: number, refMin: number, band: MinBand): boolean {
  if (band == null) return true;
  if (!(refMin > 0)) return true;
  const m = Math.max(0, minOrder || 0);
  return Math.abs(m - refMin) <= band * refMin + 1e-9;
}

/** Better for the taker: Sell ads lower, Buy ads higher. */
export const isBetter = (side: TradeType, a: number, b: number) => (side === "SELL" ? a < b : a > b);

/** The merchant's best-priced ad on one side, or null. */
export function selfAd(ads: readonly NormalizedAd[], side: TradeType, merchantId: string | null | undefined): NormalizedAd | null {
  if (!merchantId) return null;
  let best: NormalizedAd | null = null;
  for (const a of ads) {
    if (a.tradeType !== side || a.merchant.id !== merchantId || !(a.price > 0)) continue;
    if (!best || isBetter(side, a.price, best.price)) best = a;
  }
  return best;
}

export type CompetitorQuery = {
  side: TradeType;
  /** Reference minimum order, LKR. */
  refMin: number;
  band: MinBand;
  /** Optional max order, LKR: competitors must overlap [refMin, maxOrder]. */
  maxOrder?: number | null;
  /** Pay-method id; "" / undefined = any rail. */
  payType?: string;
  /** Online & unrestricted only (default true). */
  onlineOnly?: boolean;
  /** The merchant comparing: their ads become the "You" row, not competitors. */
  selfId?: string | null;
};

export type CompetitorRow = {
  ad: NormalizedAd;
  /** 1-based rank among competitors and you (ties share the better rank). */
  rank: number;
  isSelf: boolean;
  /** Their price − your price (LKR); null without a "You" row. */
  gapLkr: number | null;
  /** gapLkr / your price. */
  gapPct: number | null;
  /** Better for the taker than you. */
  ahead: boolean;
};

export type CompetitorResult = {
  side: TradeType;
  /** Competitors plus your row (when you have an ad on this side), best first. */
  rows: CompetitorRow[];
  /** Number of competitor ads (excluding you). */
  competing: number;
  self: NormalizedAd | null;
  /** Your rank in the group (1-based) and the group size including you. */
  selfRank: number | null;
  groupSize: number;
  /** Best and median competitor price. */
  best: number | null;
  median: number | null;
  /** One tick better than the best competitor; null when there is none. */
  toBeFirst: number | null;
  /** You're already strictly better than every competitor. */
  alreadyFirst: boolean;
};

export function compareCompetitors(
  ads: readonly NormalizedAd[],
  q: CompetitorQuery,
  tick: number,
): CompetitorResult {
  const onlineOnly = q.onlineOnly ?? true;
  const max = q.maxOrder != null && q.maxOrder > 0 ? q.maxOrder : 0;
  const limits: OrderLimits | undefined = max > 0 ? { min: Math.max(0, q.refMin || 0), max } : undefined;
  const opts = {
    includeOffline: !onlineOnly,
    includeRestricted: !onlineOnly,
    payType: q.payType || undefined,
    limits,
    excludeMerchantId: q.selfId ?? null,
  };
  // Placement's competing-ad filter first, then the minimum-order band.
  const comp = competingAds(ads, q.side, opts).filter((a) => inMinBand(a.minOrder, q.refMin, q.band));
  const self = selfAd(ads, q.side, q.selfId);

  const better = (a: number, b: number) => isBetter(q.side, a, b);
  const prices = comp.map((a) => a.price);
  const best = prices[0] ?? null;
  const med = median(prices);

  // "To be #1": the placement helper's rank-1 price over this group.
  const place = placementPrice(comp, q.side, 1, tick, { ...opts, limits: undefined });
  const toBeFirst = place.status === "undercut" ? place.price : null;

  const all = self ? [...comp, self] : [...comp];
  all.sort((x, y) => {
    if (x.price !== y.price) return q.side === "SELL" ? x.price - y.price : y.price - x.price;
    // Ties: competitors first (no guaranteed order on the exchange).
    return (x === self ? 1 : 0) - (y === self ? 1 : 0);
  });

  const rows: CompetitorRow[] = all.map((a) => {
    // Rank = 1 + ads strictly better for the taker.
    const rank = 1 + all.filter((o) => better(o.price, a.price)).length;
    const isSelf = a === self;
    const gapLkr = self && !isSelf ? a.price - self.price : null;
    return {
      ad: a,
      rank,
      isSelf,
      gapLkr,
      gapPct: gapLkr != null && self ? gapLkr / self.price : null,
      ahead: self != null && !isSelf && better(a.price, self.price),
    };
  });

  const selfRow = rows.find((r) => r.isSelf);
  return {
    side: q.side,
    rows,
    competing: comp.length,
    self,
    selfRank: selfRow?.rank ?? null,
    groupSize: all.length,
    best,
    median: med,
    toBeFirst,
    alreadyFirst: self != null && (best == null || better(self.price, best)),
  };
}

/* ── Per-merchant extras for the compare table ───────────────────────── */

/** What the compare table shows about a competitor beyond their ad. */
export type CompetitorInfo = {
  /** Best Sell / Buy price while listing (for their own spread). */
  bestSellPrice: number | null;
  bestBuyPrice: number | null;
  avgReleaseSec: number | null;
  positiveRate: number | null;
  trustScore: number | null;
};

/**
 * Extras for the merchants that have ads in `ads`, from the directory
 * (latest sweep, profiles, reliability). Only the ids in the book are kept so
 * the payload to the client stays small.
 */
export function competitorInfoFrom(
  directory: readonly {
    id: string;
    isActive: boolean;
    bestSellPrice: number | null;
    bestBuyPrice: number | null;
    avgReleaseSec?: number | null;
    positiveRate?: number | null;
    trustScore: number;
  }[],
  ads?: readonly NormalizedAd[],
): Record<string, CompetitorInfo> {
  const ids = ads ? new Set(ads.map((a) => a.merchant.id)) : null;
  const out: Record<string, CompetitorInfo> = {};
  for (const m of directory) {
    if (ids && !ids.has(m.id)) continue;
    out[m.id] = {
      bestSellPrice: m.isActive ? m.bestSellPrice : null,
      bestBuyPrice: m.isActive ? m.bestBuyPrice : null,
      avgReleaseSec: m.avgReleaseSec ?? null,
      positiveRate: m.positiveRate ?? null,
      trustScore: m.trustScore,
    };
  }
  return out;
}

/** Best Sell / Buy price per merchant from a book (fallback when the directory lacks them). */
export function bookBestPrices(ads: readonly NormalizedAd[]): Map<string, { sell: number | null; buy: number | null }> {
  const out = new Map<string, { sell: number | null; buy: number | null }>();
  for (const a of ads) {
    if (!(a.price > 0)) continue;
    const e = out.get(a.merchant.id) ?? { sell: null, buy: null };
    if (a.tradeType === "SELL") e.sell = e.sell == null ? a.price : Math.min(e.sell, a.price);
    else e.buy = e.buy == null ? a.price : Math.max(e.buy, a.price);
    out.set(a.merchant.id, e);
  }
  return out;
}
