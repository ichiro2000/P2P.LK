/**
 * Ad placement (D2): the price a merchant must post to rank in the top N
 * against the ads a taker would actually compare theirs with. Pure and
 * client-safe.
 *
 * Vocabulary (same as the rest of the app, but from the MERCHANT's seat):
 *   - The merchant posts a Sell ad (tradeType "SELL", they sell USDT). It
 *     sits on the ask side, best = lowest. To rank N they undercut the
 *     Nth-cheapest competing ask by one price tick.
 *   - The merchant posts a Buy ad (tradeType "BUY", they buy USDT). It sits
 *     on the bid side, best = highest. To rank N they outbid the Nth-highest
 *     competing bid by one tick.
 *
 * "Competing" = same side, online, unrestricted, accepts the selected bank
 * rail (if any), can actually fill an order, and whose order range overlaps
 * the merchant's own min–max. A taker who wants Rs 50k never sees an ad that
 * starts at Rs 500k, so that ad doesn't compete for that taker.
 */

import { isTradable, orderCapFiat, type WalkOptions } from "@/lib/liquidity";
import type { ExchangeId } from "@/lib/exchanges/types";
import type { NormalizedAd, TradeType } from "@/lib/types";

/**
 * Smallest LKR price step per exchange. Verified on live data (2026-11-20):
 * Binance `adv.priceScale` = 2 and Bybit `symbolInfo.currency.scale` = 2
 * for USDT/LKR, so both quote to 0.01.
 */
export const PRICE_TICK: Record<ExchangeId, number> = { binance: 0.01, bybit: 0.01 };

export const PLACEMENT_RANKS = [1, 3, 5] as const;

export type OrderLimits = { min: number; max: number };

export type CompetingOptions = WalkOptions & {
  /** The merchant's own order range in LKR. Missing / 0 max = no upper bound. */
  limits?: OrderLimits;
  /** Pay-method id; "" / undefined = any rail. */
  payType?: string;
  /** Leave the merchant's own ads out of the competition. */
  excludeMerchantId?: string | null;
};

/** Effective LKR range an ad accepts right now: [minOrder, min(maxOrder, available × price)]. */
export function adRange(ad: NormalizedAd): OrderLimits | null {
  const cap = orderCapFiat(ad);
  if (cap <= 0) return null;
  return { min: Math.max(0, ad.minOrder), max: cap };
}

/** Whether the ad's effective order range overlaps the merchant's limits. */
export function overlapsLimits(ad: NormalizedAd, limits?: OrderLimits): boolean {
  const r = adRange(ad);
  if (!r) return false;
  if (!limits) return true;
  const lo = Math.max(0, limits.min || 0);
  const hi = limits.max > 0 ? limits.max : Infinity;
  if (hi < lo) return false;
  return r.min <= hi && r.max >= lo;
}

/** Competing ads on one side, best price first (asks low → high, bids high → low). */
export function competingAds(
  ads: readonly NormalizedAd[],
  side: TradeType,
  opts: CompetingOptions = {},
): NormalizedAd[] {
  const out: NormalizedAd[] = [];
  for (const a of ads) {
    if (a.tradeType !== side || !(a.price > 0)) continue;
    if (!isTradable(a, opts)) continue;
    if (opts.excludeMerchantId && a.merchant.id === opts.excludeMerchantId) continue;
    if (opts.payType && !a.payMethods.some((m) => m.id === opts.payType)) continue;
    if (!overlapsLimits(a, opts.limits)) continue;
    out.push(a);
  }
  return out.sort((x, y) => (side === "SELL" ? x.price - y.price : y.price - x.price));
}

/** Round to the tick grid without float noise (348.35000000000002 → 348.35). */
export function toTick(price: number, tick: number): number {
  const decimals = Math.max(0, Math.round(-Math.log10(tick)));
  return Number((Math.round(price / tick) * tick).toFixed(decimals));
}

/**
 * - "undercut": ≥ N competing ads; `price` beats the Nth by one tick, so you
 *   rank N or better (ties at the same price have no guaranteed order, so we
 *   never match the Nth price).
 * - "bounded": fewer than N competing ads in view, but the side is cut off at
 *   `visibleCap` ads. Anything better than the last ad in view by one tick
 *   ranks you at most #(competing + 1), which is ≤ N.
 * - "open": fewer than N competing ads and the whole side is in view: any
 *   price ranks you #(competing + 1). `price` is null — pick on margin.
 * - "empty": no ads on this side at all.
 */
export type PlacementStatus = "undercut" | "bounded" | "open" | "empty";

export type Placement = {
  /** Ad side the merchant posts ("SELL" = they sell USDT). */
  side: TradeType;
  rank: number;
  tick: number;
  status: PlacementStatus;
  /** Price to post, on the tick grid. Null when "open" / "empty". */
  price: number | null;
  /** The rank you'd get at `price` in the worst case. */
  rankAtPrice: number | null;
  /** Number of competing ads. */
  competing: number;
  /** The ad you have to beat (Nth competing), when there is one. */
  anchor: NormalizedAd | null;
  /** Best competing price (rank 1 today). */
  bestCompeting: number | null;
};

export function placementPrice(
  ads: readonly NormalizedAd[],
  side: TradeType,
  rank: number,
  tick: number,
  opts: CompetingOptions & {
    /** Ads per side the feed returns; when the side has this many, deeper ads exist. */
    visibleCap?: number;
  } = {},
): Placement {
  const n = Math.max(1, Math.floor(rank));
  const comp = competingAds(ads, side, opts);
  const dir = side === "SELL" ? -1 : 1; // sell: price down, buy: price up
  const base = {
    side,
    rank: n,
    tick,
    competing: comp.length,
    bestCompeting: comp[0]?.price ?? null,
  };
  if (comp.length >= n) {
    const anchor = comp[n - 1];
    return { ...base, status: "undercut", price: toTick(anchor.price + dir * tick, tick), rankAtPrice: n, anchor };
  }
  const sideAds = ads.filter((a) => a.tradeType === side && a.price > 0);
  if (sideAds.length === 0 && comp.length === 0) {
    return { ...base, status: "empty", price: null, rankAtPrice: null, anchor: null };
  }
  const cap = opts.visibleCap ?? Infinity;
  if (sideAds.length >= cap) {
    // Deeper ads exist but every one of them is priced worse than the last in view.
    const worst = sideAds.reduce((w, a) => (side === "SELL" ? Math.max(w, a.price) : Math.min(w, a.price)), side === "SELL" ? -Infinity : Infinity);
    return {
      ...base,
      status: "bounded",
      price: toTick(worst + dir * tick, tick),
      rankAtPrice: comp.length + 1,
      anchor: null,
    };
  }
  return { ...base, status: "open", price: null, rankAtPrice: comp.length + 1, anchor: null };
}

export type PlacementMargins = {
  /** price / mid − 1 (positive = above mid). */
  vsMid: number | null;
  /** price / Google USD/LKR − 1. */
  vsGoogle: number | null;
  /**
   * What the round trip earns if the other leg fills at today's best
   * opposite price: Sell ad → (price − bestBid)/bestBid,
   * Buy ad → (bestAsk − price)/price. Negative = you'd lose.
   */
  vsOpposite: number | null;
  /** The ad would cross the book: a sell below the best bid or a buy above the best ask. */
  crosses: boolean;
};

export function placementMargins(
  price: number | null,
  side: TradeType,
  ref: { mid: number | null; google: number | null; bestBid: number | null; bestAsk: number | null },
): PlacementMargins {
  if (price == null || !(price > 0)) return { vsMid: null, vsGoogle: null, vsOpposite: null, crosses: false };
  const vsMid = ref.mid ? price / ref.mid - 1 : null;
  const vsGoogle = ref.google ? price / ref.google - 1 : null;
  let vsOpposite: number | null = null;
  let crosses = false;
  if (side === "SELL" && ref.bestBid) {
    vsOpposite = (price - ref.bestBid) / ref.bestBid;
    crosses = price <= ref.bestBid;
  } else if (side === "BUY" && ref.bestAsk) {
    vsOpposite = (ref.bestAsk - price) / price;
    crosses = price >= ref.bestAsk;
  }
  return { vsMid, vsGoogle, vsOpposite, crosses };
}
