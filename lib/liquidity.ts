import type { NormalizedAd, TradeType } from "./types";

/**
 * Walk the sorted book and fill a target fiat amount.
 * Returns the list of ads consumed (with partial fills), effective price and
 * slippage relative to top of book.
 *
 * Side semantics:
 *   - tradeType === "SELL" → we're BUYING the asset, walking SELL ads (asks) low→high.
 *   - tradeType === "BUY"  → we're SELLING the asset, walking BUY ads (bids) high→low.
 *
 * `targetFiat` is the fiat amount the caller wants to spend (buy side) or receive (sell side).
 */
export type FillStep = {
  adId: string;
  merchantId: string;
  merchantName: string;
  price: number;
  fiatFilled: number;
  assetFilled: number;
  cumulativeFiat: number;
  cumulativeAsset: number;
  /** Whether this ad's min-order clamps the fill below naive greedy. */
  minOrderRespected: boolean;
};

export type SlippageResult = {
  side: TradeType;
  targetFiat: number;
  filledFiat: number;
  filledAsset: number;
  shortfall: number; // targetFiat - filledFiat, ≥ 0
  topPrice: number | null;
  effectivePrice: number | null;
  /** Fractional slippage vs top-of-book (positive = worse than top). */
  slippagePct: number | null;
  /** Number of ads needed to fill. */
  adsConsumed: number;
  /** Number of distinct merchants needed to fill. */
  merchantsConsumed: number;
  steps: FillStep[];
};

export function computeSlippage(
  ads: NormalizedAd[],
  tradeType: TradeType,
  targetFiat: number,
): SlippageResult {
  const side = ads
    .filter((a) => a.tradeType === tradeType)
    .sort((a, b) =>
      tradeType === "SELL" ? a.price - b.price : b.price - a.price,
    );

  const steps: FillStep[] = [];
  let remainingFiat = Math.max(0, targetFiat);
  let filledFiat = 0;
  let filledAsset = 0;
  const merchantIds = new Set<string>();

  for (const ad of side) {
    if (remainingFiat <= 0) break;
    if (ad.available <= 0 || ad.price <= 0) continue;

    // How much fiat could this ad alone absorb?
    const adMaxFiat = ad.available * ad.price;
    const minFiat = Math.max(0, ad.minOrder);

    if (remainingFiat < minFiat) {
      // Can't partially consume without breaching min-order — stop.
      break;
    }

    const takeFiat = Math.min(adMaxFiat, remainingFiat, ad.maxOrder || Infinity);
    const takeAsset = takeFiat / ad.price;

    filledFiat += takeFiat;
    filledAsset += takeAsset;
    remainingFiat -= takeFiat;
    merchantIds.add(ad.merchant.id);

    steps.push({
      adId: ad.id,
      merchantId: ad.merchant.id,
      merchantName: ad.merchant.name,
      price: ad.price,
      fiatFilled: takeFiat,
      assetFilled: takeAsset,
      cumulativeFiat: filledFiat,
      cumulativeAsset: filledAsset,
      minOrderRespected: minFiat > 0,
    });
  }

  const topPrice = side[0]?.price ?? null;
  const effectivePrice = filledAsset > 0 ? filledFiat / filledAsset : null;
  const slippagePct =
    topPrice != null && effectivePrice != null && topPrice > 0
      ? // "worse than top" — for SELL side (buying asset) worse = higher effective.
        // For BUY side (selling asset) worse = lower effective.
        tradeType === "SELL"
        ? (effectivePrice - topPrice) / topPrice
        : (topPrice - effectivePrice) / topPrice
      : null;

  return {
    side: tradeType,
    targetFiat,
    filledFiat,
    filledAsset,
    shortfall: Math.max(0, targetFiat - filledFiat),
    topPrice,
    effectivePrice,
    slippagePct,
    adsConsumed: steps.length,
    merchantsConsumed: merchantIds.size,
    steps,
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
