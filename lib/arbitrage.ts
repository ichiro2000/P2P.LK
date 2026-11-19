/**
 * LKR arbitrage maths. Pure and client-safe.
 *
 * One "cycle" = spend `capital` LKR buying USDT from a sell ad, (optionally)
 * move the USDT to another exchange, then sell it to a buy ad for LKR.
 *
 *   usdtBought   = capital / buyPrice × (1 − buyFee)
 *   usdtToSell   = usdtBought − transferFee            (cross-exchange only)
 *   lkrBack      = usdtToSell × sellPrice × (1 − sellFee)
 *   profit       = lkrBack − capital − fixedCost
 *
 * Fees are fractions (0.001 = 0.1 %). Nothing here is advice — prices move
 * between the two legs and every P2P trade carries counterparty risk.
 */

import { fillableWithin, walkBook, type WalkOptions, type WalkResult } from "@/lib/liquidity";
import { acceptsMethod, type LiveBooks } from "@/lib/compare";
import type { ExchangeId } from "@/lib/exchanges/types";
import type { NormalizedAd } from "@/lib/types";

export type Leg = { exchange: ExchangeId; payType: string };

export type Fees = {
  /** Fraction taken from the USDT you receive when buying. */
  buyFee: number;
  /** Fraction taken from the LKR you receive when selling. */
  sellFee: number;
  /** USDT withdrawal / network fee, charged only when the legs differ. */
  transferFeeUsdt: number;
  /** Fixed LKR cost per cycle (bank charges, etc.). */
  fixedCostLkr: number;
};

export const ZERO_FEES: Fees = { buyFee: 0, sellFee: 0, transferFeeUsdt: 0, fixedCostLkr: 0 };

/* ── Best prices for a leg ─────────────────────────────────────────────── */

/** Sell ads (asks) on a leg, cheapest first: where you buy USDT. */
export function askAds(books: LiveBooks, leg: Leg): NormalizedAd[] {
  const b = books[leg.exchange];
  if (!b?.ok) return [];
  return b.sell.filter((a) => acceptsMethod(a, leg.payType)).sort((x, y) => x.price - y.price);
}

/** Buy ads (bids) on a leg, highest first: where you sell USDT. */
export function bidAds(books: LiveBooks, leg: Leg): NormalizedAd[] {
  const b = books[leg.exchange];
  if (!b?.ok) return [];
  return b.buy.filter((a) => acceptsMethod(a, leg.payType)).sort((x, y) => y.price - x.price);
}

export const bestAsk = (books: LiveBooks, leg: Leg) => askAds(books, leg)[0] ?? null;
export const bestBid = (books: LiveBooks, leg: Leg) => bidAds(books, leg)[0] ?? null;

/* ── Gross spread between two legs ─────────────────────────────────────── */

export type Opportunity = {
  buy: Leg;
  sell: Leg;
  buyAd: NormalizedAd | null;
  sellAd: NormalizedAd | null;
  buyPrice: number | null;
  sellPrice: number | null;
  /** LKR per USDT, sellPrice − buyPrice. Positive = a gap exists. */
  gross: number | null;
  /** gross / buyPrice */
  grossPct: number | null;
};

export function opportunity(books: LiveBooks, buy: Leg, sell: Leg): Opportunity {
  const buyAd = bestAsk(books, buy);
  const sellAd = bestBid(books, sell);
  const buyPrice = buyAd?.price ?? null;
  const sellPrice = sellAd?.price ?? null;
  const gross = buyPrice != null && sellPrice != null ? sellPrice - buyPrice : null;
  return {
    buy,
    sell,
    buyAd,
    sellAd,
    buyPrice,
    sellPrice,
    gross,
    grossPct: gross != null && buyPrice ? gross / buyPrice : null,
  };
}

/* ── One cycle ─────────────────────────────────────────────────────────── */

export type CycleResult = {
  capital: number;
  buyPrice: number;
  sellPrice: number;
  usdtBought: number;
  transferFeeUsdt: number;
  usdtSold: number;
  lkrBack: number;
  feesLkr: number;
  profit: number;
  /** profit / capital */
  roi: number;
  /** Sell price needed to break even with these inputs. */
  breakEvenSell: number | null;
};

export function cycle(
  capital: number,
  buyPrice: number,
  sellPrice: number,
  fees: Fees,
  crossExchange: boolean,
): CycleResult | null {
  if (!(capital > 0) || !(buyPrice > 0) || !(sellPrice > 0)) return null;
  const transfer = crossExchange ? Math.max(0, fees.transferFeeUsdt) : 0;
  const usdtBought = (capital / buyPrice) * (1 - fees.buyFee);
  const usdtSold = Math.max(0, usdtBought - transfer);
  const lkrBack = usdtSold * sellPrice * (1 - fees.sellFee);
  const profit = lkrBack - capital - fees.fixedCostLkr;
  // Everything lost to fees, valued in LKR at the sell price.
  const grossLkr = (capital / buyPrice) * sellPrice;
  const feesLkr = grossLkr - lkrBack + fees.fixedCostLkr;
  const denom = usdtSold * (1 - fees.sellFee);
  return {
    capital,
    buyPrice,
    sellPrice,
    usdtBought,
    transferFeeUsdt: transfer,
    usdtSold,
    lkrBack,
    feesLkr,
    profit,
    roi: profit / capital,
    breakEvenSell: denom > 0 ? (capital + fees.fixedCostLkr) / denom : null,
  };
}

/* ── Slippage-aware cycle (walks the cached book) ──────────────────────── */

export type WalkedCycle = CycleResult & {
  /** LKR of the capital the ask book could not absorb. */
  buyShortfall: number;
  /** USDT the bid book could not absorb. */
  sellShortfallUsdt: number;
  /** LKR of capital that made the full round trip (< capital when the bid book is short). */
  matchedCapital: number;
  buyAdsUsed: number;
  sellAdsUsed: number;
  /** Best usable price on each leg (top of the walk). */
  topBuy: number | null;
  topSell: number | null;
  buyWalk: WalkResult;
  sellWalk: WalkResult;
};

/**
 * Same cycle, but both prices come from walking the visible book with the
 * shared `walkBook`: the buy leg spends `capital` LKR on asks, the sell leg
 * sells the USDT received (after fees and transfer) into bids, in USDT.
 * Ads whose minimum doesn't fit are skipped, offline / restricted ads are
 * left out by default. When the bid book is short, profit and ROI are for
 * the matched part only (`matchedCapital`); unsold USDT is reported in
 * `sellShortfallUsdt`, not counted as a loss.
 */
export function walkedCycle(
  asks: NormalizedAd[],
  bids: NormalizedAd[],
  capital: number,
  fees: Fees,
  crossExchange: boolean,
  opts: Omit<WalkOptions, "unit"> = {},
): WalkedCycle | null {
  if (!(capital > 0) || !asks.length || !bids.length) return null;
  const buy = walkBook(asks, "SELL", capital, opts);
  if (buy.effectivePrice == null || buy.filledFiat <= 0) return null;

  const transfer = crossExchange ? Math.max(0, fees.transferFeeUsdt) : 0;
  const usdtBought = buy.filledAsset * (1 - fees.buyFee);
  const usdtToSell = Math.max(0, usdtBought - transfer);
  const sell = walkBook(bids, "BUY", usdtToSell, { ...opts, unit: "asset" });
  if (sell.effectivePrice == null) return null;
  const usdtSold = Math.min(usdtToSell, sell.filledAsset);

  const base = cycle(buy.filledFiat, buy.effectivePrice, sell.effectivePrice, fees, crossExchange);
  if (!base) return null;
  const lkrBack = usdtSold * sell.effectivePrice * (1 - fees.sellFee);
  // When the bid book can't take all the USDT, the round trip is only the
  // matched part: count the LKR that bought the USDT actually sold, so
  // unsold USDT isn't booked as a loss.
  const matchedCapital = usdtToSell > 0 ? buy.filledFiat * Math.min(1, usdtSold / usdtToSell) : 0;
  const profit = lkrBack - matchedCapital - fees.fixedCostLkr;
  return {
    ...base,
    usdtSold,
    lkrBack,
    profit,
    roi: matchedCapital > 0 ? profit / matchedCapital : 0,
    matchedCapital,
    buyShortfall: buy.shortfall,
    sellShortfallUsdt: Math.max(0, usdtToSell - sell.filledAsset),
    buyAdsUsed: buy.adsConsumed,
    sellAdsUsed: sell.adsConsumed,
    topBuy: buy.topPrice,
    topSell: sell.topPrice,
    buyWalk: buy,
    sellWalk: sell,
  };
}

/* ── Projection ────────────────────────────────────────────────────────── */

export function project(profitPerCycle: number, cyclesPerDay: number, daysPerMonth = 30) {
  const perDay = profitPerCycle * Math.max(0, cyclesPerDay);
  return { perCycle: profitPerCycle, perDay, perMonth: perDay * Math.max(0, daysPerMonth) };
}

/* ── Realism: capacity and price risk (F31) ────────────────────────────── */

export type RoundTripCapacity = {
  /** LKR the ask book takes at an average within `tol` of its best usable price. */
  buyLkr: number;
  /** LKR the bid book pays out at an average within `tol` of its best usable price. */
  sellLkr: number;
  /**
   * Capital (LKR) that can make the whole round trip with each leg's
   * average within `tol` of its best usable price. The sell leg's capacity
   * is turned into USDT at the best bid and back into buy-side LKR at the
   * best ask, so the two legs are compared in the same unit.
   */
  capitalLkr: number;
  /** Which book runs out first. */
  limitedBy: "buy" | "sell" | null;
  topBuy: number | null;
  topSell: number | null;
};

const bestOf = (ads: readonly NormalizedAd[], side: "SELL" | "BUY", opts: WalkOptions) =>
  walkBook(ads, side, 0, opts).topPrice;

export function roundTripCapacity(
  asks: readonly NormalizedAd[],
  bids: readonly NormalizedAd[],
  tol = 0.005,
  opts: Omit<WalkOptions, "unit"> = {},
): RoundTripCapacity {
  const buyLkr = fillableWithin(asks, "SELL", tol, opts);
  const sellLkr = fillableWithin(bids, "BUY", tol, opts);
  const topBuy = bestOf(asks, "SELL", opts);
  const topSell = bestOf(bids, "BUY", opts);
  if (!topBuy || !topSell || buyLkr <= 0 || sellLkr <= 0) {
    return { buyLkr, sellLkr, capitalLkr: 0, limitedBy: null, topBuy, topSell };
  }
  const sellAsCapital = (sellLkr / topSell) * topBuy;
  const capitalLkr = Math.min(buyLkr, sellAsCapital);
  return { buyLkr, sellLkr, capitalLkr, limitedBy: buyLkr <= sellAsCapital ? "buy" : "sell", topBuy, topSell };
}

/**
 * Cycles per day the visible book supports at this capital: the user's
 * number, capped at ⌊capacity ÷ capital⌋ (F31), but never below one cycle
 * (one cycle is already priced by walking the book, slippage included).
 * A snapshot can't say how fast the book refills, so this is an upper
 * bound from what's listed now, not a forecast.
 */
export function cappedCycles(
  cyclesPerDay: number,
  capacityLkr: number,
  capital: number,
): { cycles: number; capped: boolean; overCapacity: boolean } {
  const want = Math.max(0, cyclesPerDay || 0);
  if (!(capital > 0)) return { cycles: 0, capped: false, overCapacity: false };
  const fits = Math.floor(Math.max(0, capacityLkr) / capital);
  const max = Math.max(1, fits);
  return { cycles: Math.min(want, max), capped: want > max, overCapacity: fits < 1 };
}

/**
 * Profit if the sell price moves `band` against you between the two legs
 * (the transfer or payment window): the LKR received shrinks by `band`.
 */
export function profitAtRisk(profit: number, lkrBack: number, band: number): number {
  return profit - Math.max(0, lkrBack) * Math.max(0, band || 0);
}

/* ── Cross-method pairs on one exchange ────────────────────────────────── */

export function methodPairs(
  books: LiveBooks,
  exchange: ExchangeId,
  methods: { id: string; label: string }[],
) {
  const out: (Opportunity & { buyLabel: string; sellLabel: string })[] = [];
  for (const bm of methods) {
    for (const sm of methods) {
      if (bm.id === sm.id) continue;
      const o = opportunity(books, { exchange, payType: bm.id }, { exchange, payType: sm.id });
      if (o.buyAd && o.sellAd) out.push({ ...o, buyLabel: bm.label, sellLabel: sm.label });
    }
  }
  return out.sort((a, b) => (b.gross ?? -Infinity) - (a.gross ?? -Infinity));
}

/** Parse a user-typed number; empty / invalid → fallback. */
export function num(v: string, fallback = 0) {
  const s = String(v).replace(/,/g, "").trim();
  // Number("") is 0, so check for empty explicitly.
  if (!s) return fallback;
  const n = Number(s);
  return Number.isFinite(n) ? n : fallback;
}
