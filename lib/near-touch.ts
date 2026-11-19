import type { NormalizedAd, TradeType } from "@/lib/types";

/**
 * Near-touch depth: how much can actually be traded close to the current
 * price, per side (DATA-AUDIT F4 / D3).
 *
 *   depth(side, x) = Σ min(available, maxOrder / price)
 *                    over ads on that side priced within x of the side's best
 *                    (asks: price ≤ bestAsk·(1+x), bids: price ≥ bestBid·(1−x))
 *
 * - The band is measured from the side's own best price, not from mid, so a
 *   wide spread doesn't empty both sides.
 * - One order per ad is capped by its max order size; that is what a taker
 *   can take from it in one go.
 * - Ads flagged offline (`online === false`, Bybit) or `restricted` (taker
 *   conditions beyond a normal verified account) are left out: this is depth
 *   a typical taker can reach. Adapters that don't report them keep every ad.
 * - Bid (BUY-ad) amounts are DECLARED budgets: buyers pay LKR later, nothing
 *   is escrowed. Ask (SELL-ad) amounts are frozen USDT. Label them that way.
 */

export const NEAR_BANDS = { "05": 0.005, "1": 0.01 } as const;
export type NearBand = keyof typeof NEAR_BANDS;

export type NearDepth = { usdt: number; fiat: number; ads: number };

/** Offline (Bybit `isOnline: false`) or restricted to a subset of takers
 *  (`restricted`, see lib/types). Read defensively: unknown = tradable. */
function isUntradable(a: NormalizedAd): boolean {
  const ad = a as NormalizedAd & { merchant: { online?: boolean } };
  return ad.online === false || ad.merchant?.online === false || ad.restricted === true;
}

/** Ads of one side that can be traded at all, best price first. */
export function tradableSide(ads: readonly NormalizedAd[], side: TradeType): NormalizedAd[] {
  return ads
    .filter(
      (a) =>
        a.tradeType === side &&
        Number.isFinite(a.price) &&
        a.price > 0 &&
        Number.isFinite(a.available) &&
        a.available > 0 &&
        !isUntradable(a),
    )
    .sort((a, b) => (side === "SELL" ? a.price - b.price : b.price - a.price));
}

/** Near-touch depth of one side within `band` (fraction) of its best price. */
export function nearTouchDepth(ads: readonly NormalizedAd[], side: TradeType, band: number): NearDepth {
  const sorted = tradableSide(ads, side);
  if (!sorted.length) return { usdt: 0, fiat: 0, ads: 0 };
  const best = sorted[0].price;
  // A hair of tolerance so an ad exactly on the edge isn't lost to rounding.
  const limit = side === "SELL" ? best * (1 + band) + 1e-9 : best * (1 - band) - 1e-9;
  let usdt = 0;
  let fiat = 0;
  let n = 0;
  for (const a of sorted) {
    if (side === "SELL" ? a.price > limit : a.price < limit) break;
    const cap = a.maxOrder > 0 ? a.maxOrder / a.price : Infinity;
    const amt = Math.min(a.available, cap);
    usdt += amt;
    fiat += amt * a.price;
    n += 1;
  }
  return { usdt, fiat, ads: n };
}

/** Column values for `market_snapshots` (see the glossary in lib/db/schema). */
export type NearTouchCols = {
  bidDepth05: number;
  askDepth05: number;
  bidDepth1: number;
  askDepth1: number;
  bidDepth05Fiat: number;
  askDepth05Fiat: number;
  bidDepth1Fiat: number;
  askDepth1Fiat: number;
};

export function nearTouchCols(book: { buy: readonly NormalizedAd[]; sell: readonly NormalizedAd[] }): NearTouchCols {
  const b05 = nearTouchDepth(book.buy, "BUY", NEAR_BANDS["05"]);
  const a05 = nearTouchDepth(book.sell, "SELL", NEAR_BANDS["05"]);
  const b1 = nearTouchDepth(book.buy, "BUY", NEAR_BANDS["1"]);
  const a1 = nearTouchDepth(book.sell, "SELL", NEAR_BANDS["1"]);
  return {
    bidDepth05: b05.usdt,
    askDepth05: a05.usdt,
    bidDepth1: b1.usdt,
    askDepth1: a1.usdt,
    bidDepth05Fiat: b05.fiat,
    askDepth05Fiat: a05.fiat,
    bidDepth1Fiat: b1.fiat,
    askDepth1Fiat: a1.fiat,
  };
}

/**
 * Book balance on near-touch depth: (bid − ask) / (bid + ask), −1..1.
 * Positive = more declared buying than escrowed selling near the price.
 * Null when both sides are empty.
 */
export function nearTouchImbalance(bid: number | null | undefined, ask: number | null | undefined): number | null {
  const b = bid ?? 0;
  const a = ask ?? 0;
  return b + a > 0 ? (b - a) / (b + a) : null;
}

/** USDT each merchant lists per side (Σ available), for merchant_snapshots. */
export function availableBySide(ads: readonly NormalizedAd[]): Map<string, { bid: number; ask: number }> {
  const out = new Map<string, { bid: number; ask: number }>();
  for (const a of ads) {
    const id = a.merchant?.id;
    if (!id || !Number.isFinite(a.available)) continue;
    let m = out.get(id);
    if (!m) out.set(id, (m = { bid: 0, ask: 0 }));
    if (a.tradeType === "BUY") m.bid += a.available;
    else if (a.tradeType === "SELL") m.ask += a.available;
  }
  return out;
}
