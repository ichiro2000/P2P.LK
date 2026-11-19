import type {
  MarketSnapshot,
  NormalizedAd,
  SideStats,
  TradeType,
} from "./types";
import { isTradable } from "./liquidity";
import { reliabilityScore, type ReliabilityParts } from "./merchant-score";

/** Ads priced within this fraction of a side's best price are "near touch". */
export const NEAR_TOUCH_BAND = 0.02;

/** Quick numeric helpers. */
function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** USDT one order on this ad can take: available, capped by the max order. */
function orderSizeAsset(a: NormalizedAd) {
  const byMax = a.maxOrder > 0 && a.price > 0 ? a.maxOrder / a.price : Infinity;
  return Math.max(0, Math.min(a.available, byMax));
}

/**
 * Near-touch VWAP: price weighted by the USDT one order could take, over
 * the ads already filtered to the ±2 % band.
 */
function vwap(ads: NormalizedAd[]): number | null {
  let num = 0;
  let den = 0;
  for (const a of ads) {
    const w = orderSizeAsset(a);
    num += a.price * w;
    den += w;
  }
  return den > 0 ? num / den : null;
}

/** Ads within ±`band` of the side's best price. */
export function nearTouch(ads: NormalizedAd[], best: number, band = NEAR_TOUCH_BAND) {
  return ads.filter((a) => Math.abs(a.price / best - 1) <= band);
}

export function sideStats(ads: NormalizedAd[], tradeType: TradeType): SideStats {
  const filtered = ads.filter((a) => a.tradeType === tradeType && a.price > 0);
  if (!filtered.length) {
    return {
      tradeType,
      count: 0,
      bestPrice: null,
      medianPrice: null,
      vwap: null,
      nearTouchCount: 0,
      totalAvailable: 0,
      totalAvailableFiat: 0,
      tradableAvailable: 0,
      excludedCount: 0,
    };
  }

  //  - BUY ads (bids, you sell USDT)  → best = highest price
  //  - SELL ads (asks, you buy USDT)  → best = lowest price
  const prices = filtered.map((a) => a.price);
  const best = tradeType === "BUY" ? Math.max(...prices) : Math.min(...prices);
  const near = nearTouch(filtered, best);

  let tradableAvailable = 0;
  let excludedCount = 0;
  for (const a of filtered) {
    if (isTradable(a)) tradableAvailable += a.available;
    else excludedCount += 1;
  }

  return {
    tradeType,
    count: filtered.length,
    bestPrice: best,
    medianPrice: median(near.map((a) => a.price)),
    vwap: vwap(near),
    nearTouchCount: near.length,
    totalAvailable: filtered.reduce((s, a) => s + a.available, 0),
    totalAvailableFiat: filtered.reduce((s, a) => s + a.available * a.price, 0),
    tradableAvailable,
    excludedCount,
  };
}

/**
 * Build a market snapshot from normalized ads.
 * `ads` should contain both sides, with tradeType set.
 */
export function buildMarket(
  asset: string,
  fiat: string,
  ads: NormalizedAd[],
): MarketSnapshot {
  const buy = sideStats(ads, "BUY");
  const sell = sideStats(ads, "SELL");

  // Spread: cost of round-trip = SELL-side ask − BUY-side bid.
  const spread =
    sell.bestPrice != null && buy.bestPrice != null
      ? sell.bestPrice - buy.bestPrice
      : null;

  const mid =
    sell.bestPrice != null && buy.bestPrice != null
      ? (sell.bestPrice + buy.bestPrice) / 2
      : null;

  const spreadPct = spread != null && mid ? spread / mid : null;

  return {
    asset,
    fiat,
    buy,
    sell,
    spread,
    spreadPct,
    mid,
    ads,
    fetchedAt: new Date().toISOString(),
  };
}

/** ── Merchant analytics ───────────────────────────────────────────────── */

/** The market's best price per side, the reference for merchant gaps. */
export type SideRefs = {
  /** Lowest ask (where takers buy USDT). */
  bestAsk: number | null;
  /** Highest bid (where takers sell USDT). */
  bestBid: number | null;
};

/** Gap from a merchant's best ad to the market's best on that side, as a
 *  fraction, ≥ 0 and lower = better. Null when they don't quote the side. */
export function sideGaps(
  m: { bestSellPrice: number | null; bestBuyPrice: number | null },
  refs: SideRefs,
) {
  const askGap =
    m.bestSellPrice != null && refs.bestAsk
      ? Math.max(0, (m.bestSellPrice - refs.bestAsk) / refs.bestAsk)
      : null;
  const bidGap =
    m.bestBuyPrice != null && refs.bestBid
      ? Math.max(0, (refs.bestBid - m.bestBuyPrice) / refs.bestBid)
      : null;
  return { askGap, bidGap };
}

/** 100 at the best price, minus one point per basis point behind it, on
 *  the merchant's better side. 0 when they quote neither side. */
export function competitivenessFrom(askGap: number | null, bidGap: number | null) {
  const gaps = [askGap, bidGap].filter((g): g is number => g != null);
  if (!gaps.length) return 0;
  const bps = Math.min(...gaps) * 10_000;
  return Math.max(0, Math.round(100 - bps));
}

export type MerchantSummary = {
  id: string;
  name: string;
  isMerchant: boolean;
  userIdentity?: string;
  grade?: number;
  vipLevel?: number | null;
  /** null = the exchange didn't send a 30-day count. */
  orders30d: number | null;
  completionRate: number;
  avgReleaseSec?: number;
  avgResponseSec?: number;
  adCount: number;
  buyAds: number;
  sellAds: number;
  totalAvailableFiat: number;
  /** Merchant's best BUY price (higher is better) */
  bestBuyPrice: number | null;
  /** Merchant's best SELL price (lower is better) */
  bestSellPrice: number | null;
  /** (their best ask − market best ask) / market best ask. ≥ 0, lower is better. */
  askVsBest: number | null;
  /** (market best bid − their best bid) / market best bid. ≥ 0, lower is better. */
  bidVsBest: number | null;
  /**
   * @deprecated kept for API compatibility. Now the per-side gap to the
   * best price (ask side if they quote asks, else bid side), never the
   * old cross-side "vs ask median".
   */
  premiumVsMedian: number | null;
  /** Reliability score 0..100 (see `lib/merchant-score.ts`). Name kept for API compatibility. */
  trustScore: number;
  scoreParts?: ReliabilityParts;
  /** 100 − basis points behind the best price on their better side (0..100). */
  competitiveness: number;
  payMethods: string[];
};

function sideRefsFrom(ads: NormalizedAd[]): SideRefs {
  let bestAsk: number | null = null;
  let bestBid: number | null = null;
  for (const a of ads) {
    if (!(a.price > 0)) continue;
    if (a.tradeType === "SELL") bestAsk = bestAsk == null ? a.price : Math.min(bestAsk, a.price);
    else bestBid = bestBid == null ? a.price : Math.max(bestBid, a.price);
  }
  return { bestAsk, bestBid };
}

/**
 * Aggregate per-merchant analytics from a flat list of normalized ads.
 * Gaps and competitiveness are measured per side against the best ask /
 * best bid of the same ad list (pass `refs` to override). The second
 * argument used to be the ask median; a number is still accepted and
 * ignored so older callers keep compiling.
 */
export function summarizeMerchants(
  ads: NormalizedAd[],
  refs?: SideRefs | number | null,
): MerchantSummary[] {
  const r: SideRefs = refs != null && typeof refs === "object" ? refs : sideRefsFrom(ads);
  const map = new Map<string, MerchantSummary>();

  for (const a of ads) {
    let m = map.get(a.merchant.id);
    if (!m) {
      m = {
        ...a.merchant,
        adCount: 0,
        buyAds: 0,
        sellAds: 0,
        totalAvailableFiat: 0,
        bestBuyPrice: null,
        bestSellPrice: null,
        askVsBest: null,
        bidVsBest: null,
        premiumVsMedian: null,
        trustScore: 0,
        competitiveness: 0,
        payMethods: [],
      };
      map.set(a.merchant.id, m);
    }
    m.adCount += 1;
    m.totalAvailableFiat += a.available * a.price;

    if (a.tradeType === "BUY") {
      m.buyAds += 1;
      m.bestBuyPrice = m.bestBuyPrice == null ? a.price : Math.max(m.bestBuyPrice, a.price);
    } else {
      m.sellAds += 1;
      m.bestSellPrice = m.bestSellPrice == null ? a.price : Math.min(m.bestSellPrice, a.price);
    }

    for (const pm of a.payMethods) {
      if (!m.payMethods.includes(pm.name)) m.payMethods.push(pm.name);
    }
  }

  const summaries: MerchantSummary[] = [];
  for (const m of map.values()) {
    const { askGap, bidGap } = sideGaps(m, r);
    const rel = reliabilityScore({ completionRate: m.completionRate, orders30d: m.orders30d });
    summaries.push({
      ...m,
      askVsBest: askGap,
      bidVsBest: bidGap,
      premiumVsMedian: askGap ?? bidGap,
      trustScore: rel.score,
      scoreParts: rel.parts,
      competitiveness: competitivenessFrom(askGap, bidGap),
    });
  }

  return summaries.sort((a, b) => b.trustScore - a.trustScore);
}

/**
 * Directory row — a merchant from the full sweep (`merchants` table) with
 * whether they were listing in the latest sweep.
 */
export type MerchantRow = MerchantSummary & {
  /** Listing in the latest 5-minute sweep (lastSeenTs ≥ latest sweep − 120 s). */
  isActive: boolean;
  /** Unix seconds of the most recent sweep that saw them. */
  lastSeenTs: number;
  /** Unix seconds first seen by our collector (null if unknown). */
  firstSeenTs?: number | null;
  /** 0..1 share of tracked hours in the last 7 days they listed (null if unknown). */
  presence7d?: number | null;
  /** Binance profile (lib/ingest/profiles.ts); null when not collected / Bybit. */
  positiveRate?: number | null;
  /** positive + negative reviews. */
  feedbackCount?: number | null;
  /** Days since they registered on the exchange. */
  registerDays?: number | null;
};

export type KnownMerchantInput = {
  merchantId: string;
  merchantName: string;
  lastSeenTs: number;
  firstSeenTs?: number | null;
  /** Hours in the last 7 days with ≥ 1 sweep seeing them. */
  presenceHours?: number | null;
  isMerchant: boolean | null;
  userIdentity: string | null;
  userGrade: number | null;
  vipLevel: number | null;
  ordersMonth: number | null;
  completionRate: number | null;
  avgReleaseSec: number | null;
  buyAds: number | null;
  sellAds: number | null;
  bestBuyPrice: number | null;
  bestSellPrice: number | null;
  totalAvailableFiat: number | null;
  /** Binance profile fields (all optional; null = not collected). */
  positive?: number | null;
  negative?: number | null;
  positiveRate?: number | null;
  registerDays?: number | null;
};

/** A merchant counts as active if the latest sweep (or the one before) saw them. */
export const ACTIVE_SLACK_SEC = 120;

/**
 * The merchant directory, built from the full 5-minute sweep (the
 * `merchants` table), not the top-20 book:
 *   - active  = seen in the latest sweep (`lastSeenTs ≥ latestSweepTs − 120`)
 *   - gaps    = per side, vs the best ask / best bid among active merchants
 *   - score   = reliability (Wilson completion + volume + presence + tenure)
 * `liveAds` (optional, any book) only adds pay-method names.
 */
export function buildMerchantDirectory(args: {
  known: KnownMerchantInput[];
  latestSweepTs: number | null;
  /** Hours of data in the 7-day window (presence denominator). */
  trackedHours7d?: number | null;
  liveAds?: NormalizedAd[];
  nowTs?: number;
}): MerchantRow[] {
  const { known, latestSweepTs } = args;
  const nowTs = args.nowTs ?? Math.floor(Date.now() / 1000);
  const sweep = latestSweepTs ?? Math.max(0, ...known.map((k) => k.lastSeenTs));
  const isActive = (k: KnownMerchantInput) => sweep > 0 && k.lastSeenTs >= sweep - ACTIVE_SLACK_SEC;

  // Per-side reference: the best price among merchants listing now.
  const refs: SideRefs = { bestAsk: null, bestBid: null };
  for (const k of known) {
    if (!isActive(k)) continue;
    if (k.bestSellPrice != null && k.bestSellPrice > 0)
      refs.bestAsk = refs.bestAsk == null ? k.bestSellPrice : Math.min(refs.bestAsk, k.bestSellPrice);
    if (k.bestBuyPrice != null && k.bestBuyPrice > 0)
      refs.bestBid = refs.bestBid == null ? k.bestBuyPrice : Math.max(refs.bestBid, k.bestBuyPrice);
  }

  const methods = new Map<string, string[]>();
  for (const a of args.liveAds ?? []) {
    const list = methods.get(a.merchant.id) ?? [];
    for (const pm of a.payMethods) if (!list.includes(pm.name)) list.push(pm.name);
    methods.set(a.merchant.id, list);
  }

  const denom = args.trackedHours7d ?? null;
  const rows: MerchantRow[] = known.map((k) => {
    const active = isActive(k);
    // Prices only mean something while they're listing.
    const prices = {
      bestSellPrice: active ? k.bestSellPrice : null,
      bestBuyPrice: active ? k.bestBuyPrice : null,
    };
    const { askGap, bidGap } = sideGaps(prices, refs);
    const presence7d =
      k.presenceHours != null && denom != null && denom > 0 ? Math.min(1, k.presenceHours / denom) : null;
    const rel = reliabilityScore({
      completionRate: k.completionRate,
      orders30d: k.ordersMonth,
      presence7d,
      firstSeenTs: k.firstSeenTs ?? null,
      avgReleaseSec: k.avgReleaseSec,
      positive: k.positive ?? null,
      negative: k.negative ?? null,
      registerDays: k.registerDays ?? null,
      nowTs,
    });
    return {
      id: k.merchantId,
      name: k.merchantName,
      isMerchant: Boolean(k.isMerchant),
      userIdentity: k.userIdentity ?? undefined,
      grade: k.userGrade ?? undefined,
      vipLevel: k.vipLevel ?? null,
      orders30d: k.ordersMonth,
      completionRate: k.completionRate ?? 0,
      avgReleaseSec: k.avgReleaseSec ?? undefined,
      adCount: active ? (k.buyAds ?? 0) + (k.sellAds ?? 0) : 0,
      buyAds: active ? (k.buyAds ?? 0) : 0,
      sellAds: active ? (k.sellAds ?? 0) : 0,
      totalAvailableFiat: k.totalAvailableFiat ?? 0,
      bestBuyPrice: k.bestBuyPrice,
      bestSellPrice: k.bestSellPrice,
      askVsBest: askGap,
      bidVsBest: bidGap,
      premiumVsMedian: askGap ?? bidGap,
      trustScore: rel.score,
      scoreParts: rel.parts,
      competitiveness: active ? competitivenessFrom(askGap, bidGap) : 0,
      payMethods: methods.get(k.merchantId) ?? [],
      isActive: active,
      lastSeenTs: k.lastSeenTs,
      firstSeenTs: k.firstSeenTs ?? null,
      presence7d,
      positiveRate: k.positiveRate ?? null,
      feedbackCount: k.positive != null && k.negative != null ? k.positive + k.negative : null,
      registerDays: k.registerDays ?? null,
    };
  });

  return rows.sort((a, b) => {
    if (a.isActive !== b.isActive) return a.isActive ? -1 : 1;
    return b.trustScore - a.trustScore;
  });
}
