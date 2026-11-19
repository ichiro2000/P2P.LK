import type { NormalizedAd, TradeType } from "./types";

/**
 * THE book walk. Every "price for an amount" number on the site comes from
 * `walkBook`: the slippage simulator and its API, the market amount ladder
 * and KPI tiles, the Compare head-to-head, arbitrage cards and calculator,
 * and the remittance "via USDT" route. Don't add another one.
 *
 * Side semantics (same vocabulary as the rest of the app):
 *   - side "SELL" → walk asks (sell ads) low → high: the taker BUYS USDT.
 *   - side "BUY"  → walk bids (buy ads) high → low: the taker SELLS USDT.
 *
 * Rules, per ad, best price first:
 *   1. Offline and restricted ads are skipped unless the options include them.
 *   2. One order per ad. The most an order can take is
 *      cap = min(available × price, maxOrder) in LKR.
 *   3. An ad whose cap is below its own minimum can never be filled: skipped.
 *   4. take = min(cap, what's left). If take < minOrder the ad is skipped
 *      (a taker would just pick the next ad) — the walk does NOT stop.
 *   5. Partial fills are fine: the last ad usually fills only in part.
 *
 * The amount can be LKR (`unit: "fiat"`, default) or USDT (`unit: "asset"`).
 */

export type WalkUnit = "fiat" | "asset";

export type WalkOptions = {
  /** Amount unit. "fiat" = LKR (default), "asset" = USDT. */
  unit?: WalkUnit;
  /** Count ads whose advertiser is offline (Bybit). Default false. */
  includeOffline?: boolean;
  /** Count ads with counterparty restrictions. Default false. */
  includeRestricted?: boolean;
};

export type FillStep = {
  adId: string;
  merchantId: string;
  merchantName: string;
  price: number;
  fiatFilled: number;
  assetFilled: number;
  cumulativeFiat: number;
  cumulativeAsset: number;
  /** The ad has a minimum order the fill had to respect. */
  minOrderRespected: boolean;
};

export type WalkResult = {
  side: TradeType;
  unit: WalkUnit;
  /** The amount asked for, in `unit`. */
  target: number;
  /** LKR target (`target` when unit is fiat; null for USDT walks). Kept for the slippage API. */
  targetFiat: number | null;
  filledFiat: number;
  filledAsset: number;
  /** What could not be filled, in `unit` (≥ 0). */
  shortfall: number;
  /** True when the visible book can't fill the whole amount. */
  partial: boolean;
  /** Best price among the ads the walk may use (after online/restricted filtering). */
  topPrice: number | null;
  effectivePrice: number | null;
  /** Fractional slippage vs `topPrice`; positive = worse than the top. */
  slippagePct: number | null;
  adsConsumed: number;
  merchantsConsumed: number;
  /** Ads skipped because their minimum order didn't fit what was left. */
  skippedForMin: number;
  /** Ads left out for being offline or restricted. */
  excluded: number;
  steps: FillStep[];
};

/** @deprecated name kept for the slippage API / simulator. */
export type SlippageResult = WalkResult;

const FIAT_EPS = 0.5; // LKR
const ASSET_EPS = 0.005; // USDT

/** Whether the walk (and "tradable" depth) may use this ad. */
export function isTradable(ad: NormalizedAd, opts: WalkOptions = {}): boolean {
  if (!opts.includeOffline && ad.online === false) return false;
  if (!opts.includeRestricted && ad.restricted === true) return false;
  return true;
}

/** Ads of one side that the walk may use, best price first. */
export function walkableSide(
  ads: readonly NormalizedAd[],
  side: TradeType,
  opts: WalkOptions = {},
): { list: NormalizedAd[]; excluded: number } {
  let excluded = 0;
  const list: NormalizedAd[] = [];
  for (const a of ads) {
    if (a.tradeType !== side || !(a.price > 0)) continue;
    if (!isTradable(a, opts)) {
      excluded += 1;
      continue;
    }
    list.push(a);
  }
  list.sort((a, b) => (side === "SELL" ? a.price - b.price : b.price - a.price));
  return { list, excluded };
}

/** The most one order on this ad can take, in LKR (0 if unfillable). */
export function orderCapFiat(ad: NormalizedAd): number {
  if (!(ad.available > 0) || !(ad.price > 0)) return 0;
  const cap = Math.min(ad.available * ad.price, ad.maxOrder > 0 ? ad.maxOrder : Infinity);
  return cap >= Math.max(0, ad.minOrder) ? cap : 0;
}

export function walkBook(
  ads: readonly NormalizedAd[],
  side: TradeType,
  amount: number,
  opts: WalkOptions = {},
): WalkResult {
  const unit: WalkUnit = opts.unit ?? "fiat";
  const target = Number.isFinite(amount) ? Math.max(0, amount) : 0;
  const { list, excluded } = walkableSide(ads, side, opts);
  const eps = unit === "fiat" ? FIAT_EPS : ASSET_EPS;

  const steps: FillStep[] = [];
  const merchants = new Set<string>();
  let left = target;
  let filledFiat = 0;
  let filledAsset = 0;
  let skippedForMin = 0;

  for (const ad of list) {
    if (left <= eps) break;
    const cap = orderCapFiat(ad);
    if (cap <= 0) continue;
    const leftFiat = unit === "fiat" ? left : left * ad.price;
    const take = Math.min(cap, leftFiat);
    if (take < ad.minOrder) {
      skippedForMin += 1;
      continue;
    }
    const takeAsset = take / ad.price;
    filledFiat += take;
    filledAsset += takeAsset;
    left -= unit === "fiat" ? take : takeAsset;
    merchants.add(ad.merchant.id);
    steps.push({
      adId: ad.id,
      merchantId: ad.merchant.id,
      merchantName: ad.merchant.name,
      price: ad.price,
      fiatFilled: take,
      assetFilled: takeAsset,
      cumulativeFiat: filledFiat,
      cumulativeAsset: filledAsset,
      minOrderRespected: ad.minOrder > 0,
    });
  }

  const topPrice = list[0]?.price ?? null;
  const effectivePrice = filledAsset > 0 ? filledFiat / filledAsset : null;
  const slippagePct =
    topPrice != null && effectivePrice != null && topPrice > 0
      ? side === "SELL"
        ? (effectivePrice - topPrice) / topPrice
        : (topPrice - effectivePrice) / topPrice
      : null;
  const shortfall = Math.max(0, left);

  return {
    side,
    unit,
    target,
    targetFiat: unit === "fiat" ? target : null,
    filledFiat,
    filledAsset,
    shortfall: shortfall <= eps ? 0 : shortfall,
    partial: shortfall > eps,
    topPrice,
    effectivePrice,
    slippagePct,
    adsConsumed: steps.length,
    merchantsConsumed: merchants.size,
    skippedForMin,
    excluded,
    steps,
  };
}

/**
 * How much LKR can be traded with an average price within `tol` of the
 * best usable price (default 0.5 %). Walks the whole usable side once and
 * solves the last partial fill exactly: inside one ad the running average
 * moves monotonically, so the cut-off is closed-form. A partial take below
 * that ad's minimum order stops the count there.
 */
export function fillableWithin(
  ads: readonly NormalizedAd[],
  side: TradeType,
  tol = 0.005,
  opts: WalkOptions = {},
): number {
  const { list } = walkableSide(ads, side, opts);
  const best = list[0]?.price;
  if (best == null) return 0;
  // Limit average price: asks may average up to best·(1+tol), bids down to best·(1−tol).
  const limit = side === "SELL" ? best * (1 + tol) : best * (1 - tol);
  let F = 0; // LKR so far
  let Q = 0; // USDT so far
  for (const ad of list) {
    const cap = orderCapFiat(ad);
    if (cap <= 0) continue;
    const within = side === "SELL" ? ad.price <= limit : ad.price >= limit;
    if (within) {
      F += cap;
      Q += cap / ad.price;
      continue;
    }
    // avg(x) = (F + x) / (Q + x/p) hits `limit` at x = (L·Q − F) / (1 − L/p).
    const x = (limit * Q - F) / (1 - limit / ad.price);
    const take = Math.min(cap, Math.max(0, x));
    if (take >= ad.minOrder && take > 0) F += take;
    break;
  }
  return F;
}

/** Everything the "price for my amount" panels show for one side. */
export type AmountQuote = {
  walk: WalkResult;
  /** Top of book over every listed ad on the side (what the KPI shows). */
  best: number | null;
  /** Effective − best, in LKR per USDT, signed so positive = worse for you. */
  gap: number | null;
  gapPct: number | null;
  /** LKR fillable at an average within 0.5 % of the best usable price. */
  fillable05: number;
};

export function quoteAmount(
  ads: readonly NormalizedAd[],
  side: TradeType,
  amount: number,
  opts: WalkOptions = {},
): AmountQuote {
  const walk = walkBook(ads, side, amount, opts);
  let best: number | null = null;
  for (const a of ads) {
    if (a.tradeType !== side || !(a.price > 0)) continue;
    if (best == null || (side === "SELL" ? a.price < best : a.price > best)) best = a.price;
  }
  const eff = walk.effectivePrice;
  const gap = eff != null && best != null ? (side === "SELL" ? eff - best : best - eff) : null;
  return {
    walk,
    best,
    gap,
    gapPct: gap != null && best ? gap / best : null,
    fillable05: fillableWithin(ads, side, 0.005, opts),
  };
}

/** ── Concentration metrics ───────────────────────────────────────────── */

export type ConcentrationStats = {
  total: number;
  topShare: Record<1 | 3 | 10, number>;
  /** Herfindahl–Hirschman Index (0..1). 0 = perfect competition, 1 = monopoly. */
  hhi: number;
  /** Sorted descending by share. */
  merchants: { id: string; name: string; share: number; value: number }[];
};

export function concentrationByMerchant(
  ads: NormalizedAd[],
  tradeType?: TradeType,
  /** Use "fiat" (default) for depth in fiat value, or "asset" for asset units. */
  mode: "fiat" | "asset" = "fiat",
): ConcentrationStats {
  const filtered = tradeType ? ads.filter((a) => a.tradeType === tradeType) : ads;
  const sums = new Map<string, { name: string; value: number }>();

  for (const a of filtered) {
    const v = mode === "fiat" ? a.available * a.price : a.available;
    const cur = sums.get(a.merchant.id);
    if (cur) {
      cur.value += v;
    } else {
      sums.set(a.merchant.id, { name: a.merchant.name, value: v });
    }
  }

  const total = [...sums.values()].reduce((s, x) => s + x.value, 0);
  const merchants = [...sums.entries()]
    .map(([id, x]) => ({
      id,
      name: x.name,
      value: x.value,
      share: total > 0 ? x.value / total : 0,
    }))
    .sort((a, b) => b.share - a.share);

  const hhi = merchants.reduce((s, m) => s + m.share * m.share, 0);

  const topShare: Record<1 | 3 | 10, number> = {
    1: merchants.slice(0, 1).reduce((s, m) => s + m.share, 0),
    3: merchants.slice(0, 3).reduce((s, m) => s + m.share, 0),
    10: merchants.slice(0, 10).reduce((s, m) => s + m.share, 0),
  };

  return { total, topShare, hhi, merchants };
}
