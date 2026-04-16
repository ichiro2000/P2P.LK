import type {
  MarketSnapshot,
  NormalizedAd,
  SideStats,
  TradeType,
} from "./types";

/** Quick numeric helpers. */
function median(arr: number[]): number | null {
  if (!arr.length) return null;
  const s = [...arr].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Volume-weighted average price across the provided ads.
 * For BUY side: seller's ask prices (what you'd pay to buy asset).
 * For SELL side: buyer's bid prices (what you'd receive to sell asset).
 */
function vwap(ads: NormalizedAd[]): number | null {
  if (!ads.length) return null;
  let num = 0;
  let den = 0;
  for (const a of ads) {
    num += a.price * a.available;
    den += a.available;
  }
  return den > 0 ? num / den : null;
}

export function sideStats(ads: NormalizedAd[], tradeType: TradeType): SideStats {
  const filtered = ads.filter((a) => a.tradeType === tradeType);
  if (!filtered.length) {
    return {
      tradeType,
      count: 0,
      bestPrice: null,
      medianPrice: null,
      vwap: null,
      totalAvailable: 0,
      totalAvailableFiat: 0,
    };
  }

  // On BUY side (merchants buying fiat for asset), *lower* price is better for seller of fiat.
  // On SELL side (merchants selling asset for fiat), *lower* price is better for buyer.
  //
  // Binance already returns ads pre-sorted by best-price. To be defensive:
  //  - BUY (you sell USDT → they pay fiat) → best = highest price
  //  - SELL (you buy USDT → you pay fiat)  → best = lowest price
  const prices = filtered.map((a) => a.price);
  const best =
    tradeType === "BUY"
      ? Math.max(...prices)
      : Math.min(...prices);

  const totalAvailable = filtered.reduce((s, a) => s + a.available, 0);
  const totalAvailableFiat = filtered.reduce(
    (s, a) => s + a.available * a.price,
    0,
  );

  return {
    tradeType,
    count: filtered.length,
    bestPrice: best,
    medianPrice: median(prices),
    vwap: vwap(filtered),
    totalAvailable,
    totalAvailableFiat,
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
  //   If you bought USDT on SELL side (paying .sell.bestPrice) and
  //   immediately sold it on BUY side (receiving .buy.bestPrice),
  //   you'd lose (sell.bestPrice − buy.bestPrice) per unit.
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

export type MerchantSummary = {
  id: string;
  name: string;
  isMerchant: boolean;
  grade?: number;
  orders30d: number;
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
  /** Deviation from market median, positive = premium, negative = discount. */
  premiumVsMedian: number | null;
  /** Trust score 0..100 derived from completion rate, order count, release time. */
  trustScore: number;
  /** Competitiveness 0..100 — how aggressive their pricing is. */
  competitiveness: number;
  payMethods: string[];
};

/**
 * Aggregate per-merchant analytics from a flat list of normalized ads.
 * `marketMedian` is the median price across the full market, used for premium calc.
 */
export function summarizeMerchants(
  ads: NormalizedAd[],
  marketMedian: number | null,
): MerchantSummary[] {
  const map = new Map<string, MerchantSummary & { _prices: number[] }>();

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
        premiumVsMedian: null,
        trustScore: 0,
        competitiveness: 0,
        payMethods: [],
        _prices: [],
      };
      map.set(a.merchant.id, m);
    }
    m.adCount += 1;
    m.totalAvailableFiat += a.available * a.price;
    m._prices.push(a.price);

    if (a.tradeType === "BUY") {
      m.buyAds += 1;
      m.bestBuyPrice =
        m.bestBuyPrice == null ? a.price : Math.max(m.bestBuyPrice, a.price);
    } else {
      m.sellAds += 1;
      m.bestSellPrice =
        m.bestSellPrice == null ? a.price : Math.min(m.bestSellPrice, a.price);
    }

    for (const pm of a.payMethods) {
      if (!m.payMethods.includes(pm.name)) m.payMethods.push(pm.name);
    }
  }

  const summaries: MerchantSummary[] = [];
  for (const m of map.values()) {
    const avgPrice =
      m._prices.length > 0
        ? m._prices.reduce((s, p) => s + p, 0) / m._prices.length
        : null;

    const premium =
      avgPrice != null && marketMedian != null && marketMedian > 0
        ? (avgPrice - marketMedian) / marketMedian
        : null;

    // Trust score: weighted blend of completion rate, order volume, release speed.
    //   completion (0..1)           → 50 pts
    //   orders (log-scaled, cap 2k) → 30 pts
    //   release time (faster=better) → 20 pts
    const completionPts = Math.max(0, Math.min(1, m.completionRate)) * 50;

    const ordersNorm = Math.min(
      1,
      Math.log10(Math.max(1, m.orders30d)) / Math.log10(2000),
    );
    const orderPts = ordersNorm * 30;

    const releasePts = (() => {
      if (m.avgReleaseSec == null) return 12; // neutral default
      if (m.avgReleaseSec <= 60) return 20;
      if (m.avgReleaseSec <= 180) return 16;
      if (m.avgReleaseSec <= 300) return 12;
      if (m.avgReleaseSec <= 600) return 8;
      return 4;
    })();

    const trust = Math.round(completionPts + orderPts + releasePts);

    // Competitiveness: how close is best ad to market median.
    //   within 0.1% of median → 100
    //   1% away               → 60
    //   2% away               → 30
    //   >3%                   → 0
    const dev =
      marketMedian != null && avgPrice != null
        ? Math.abs(avgPrice - marketMedian) / marketMedian
        : null;
    const competitiveness =
      dev == null
        ? 0
        : dev < 0.001
          ? 100
          : dev < 0.005
            ? 85
            : dev < 0.01
              ? 60
              : dev < 0.02
                ? 30
                : dev < 0.03
                  ? 10
                  : 0;

    summaries.push({
      ...m,
      premiumVsMedian: premium,
      trustScore: Math.max(0, Math.min(100, trust)),
      competitiveness,
    });
  }

  return summaries.sort((a, b) => b.trustScore - a.trustScore);
}

/** ── Arbitrage ────────────────────────────────────────────────────────── */

export type ArbitrageRow = {
  asset: string;
  buyFiat: string;
  sellFiat: string;
  /** Best SELL-side ask in buyFiat (cost to acquire 1 asset) */
  buyPrice: number;
  /** Best BUY-side bid in sellFiat (amount received for 1 asset) */
  sellPrice: number;
  /** Available quantity in asset units on limiting side */
  depth: number;
  /** Gross spread % — sellPrice (USD-equiv) vs buyPrice (USD-equiv) */
  grossPct: number;
  /** After an assumed 0.5% fee round-trip + 0.2% slippage */
  netPct: number;
  /** 0..100 liquidity score based on depth */
  liquidityScore: number;
  /** 0..100 risk score (lower = safer). High spreads on shallow books → high risk. */
  riskScore: number;
  updatedAt: string;
};

/**
 * Compute within-market spread opportunities (one-fiat buy→sell round trip).
 * Pure within-market: buys on SELL ads, immediately sells on BUY ads.
 * Result positive when BUY-ask > SELL-bid (rare but possible in dislocated markets).
 */
export function withinMarketArbitrage(
  markets: MarketSnapshot[],
  assumedFeePct = 0.005,
  assumedSlipPct = 0.002,
): ArbitrageRow[] {
  const rows: ArbitrageRow[] = [];

  for (const m of markets) {
    if (m.sell.bestPrice == null || m.buy.bestPrice == null) continue;

    // Within-market round trip: buy asset on SELL side, sell on BUY side
    const buyPrice = m.sell.bestPrice;
    const sellPrice = m.buy.bestPrice;
    if (buyPrice <= 0) continue;

    const grossPct = (sellPrice - buyPrice) / buyPrice;
    const netPct = grossPct - assumedFeePct - assumedSlipPct;

    const depth = Math.min(m.buy.totalAvailable, m.sell.totalAvailable);
    const liquidity = Math.min(
      100,
      Math.round((Math.log10(Math.max(1, depth)) / Math.log10(50000)) * 100),
    );

    // Risk rises with low liquidity and high headline spread
    const risk = Math.max(
      0,
      Math.min(
        100,
        Math.round(100 - liquidity + Math.max(0, grossPct * 400)),
      ),
    );

    rows.push({
      asset: m.asset,
      buyFiat: m.fiat,
      sellFiat: m.fiat,
      buyPrice,
      sellPrice,
      depth,
      grossPct,
      netPct,
      liquidityScore: liquidity,
      riskScore: risk,
      updatedAt: m.fetchedAt,
    });
  }

  return rows.sort((a, b) => b.netPct - a.netPct);
}
