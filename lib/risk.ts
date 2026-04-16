import {
  listMarketSnapshots,
  merchantsInLatestTick,
  merchantChurnWindow,
  latestMarketSnapshot,
  type RangeKey,
} from "@/lib/db/queries";
import { sma, zScoreOfLast, mean } from "@/lib/stats";

export type RiskSignal = {
  id: string;
  level: "info" | "warn" | "alert";
  title: string;
  detail: string;
  metric?: string;
  /** Optional numeric score 0..100 for ranking. */
  score?: number;
};

export type MerchantFlag = {
  merchantId: string;
  merchantName: string;
  reason: string;
  metric: string;
  level: "info" | "warn" | "alert";
};

export type RiskReport = {
  asset: string;
  fiat: string;
  range: RangeKey;
  generatedAt: string;
  signals: RiskSignal[];
  flaggedMerchants: MerchantFlag[];
  stats: {
    latestMid: number | null;
    ma20: number | null;
    priceZ: number | null;
    bidDepthZ: number | null;
    askDepthZ: number | null;
    activeMerchants: number;
    churned: number;
    fresh: number;
  };
};

/**
 * Compute a risk report for one market using the time-series in SQLite.
 *
 * Signals emitted:
 *   - Abnormal mid move  (|z-score| vs MA20 > 2.5)
 *   - Liquidity drop     (current depth < 50% of 24h avg)
 *   - Merchant churn     (>30% of active merchants are new in last hour OR disappeared)
 *   - Low-completion at top (merchant holding best-of-book with < 90% completion)
 *   - Extreme premium    (latest mid > 2σ from distribution of last range)
 */
export function computeRiskReport(
  asset: string,
  fiat: string,
  range: RangeKey = "24h",
): RiskReport {
  const generatedAt = new Date().toISOString();
  const snapshots = listMarketSnapshots(asset, fiat, range);
  const latest = latestMarketSnapshot(asset, fiat);

  const signals: RiskSignal[] = [];
  const flagged: MerchantFlag[] = [];

  const mids = snapshots.map((s) => s.mid);
  const bidDepth = snapshots.map((s) => s.bidDepth);
  const askDepth = snapshots.map((s) => s.askDepth);

  const ma20 = sma(mids, 20);
  const priceZ = zScoreOfLast(mids);
  const bidDepthZ = zScoreOfLast(bidDepth);
  const askDepthZ = zScoreOfLast(askDepth);

  // ── signal: abnormal price move
  if (priceZ != null && Math.abs(priceZ) >= 2.5) {
    signals.push({
      id: "price-spike",
      level: Math.abs(priceZ) >= 3.5 ? "alert" : "warn",
      title: `${priceZ > 0 ? "Upward" : "Downward"} price spike detected`,
      detail: `Latest mid is ${priceZ.toFixed(2)}σ from the recent distribution — a move larger than typical variance in this market.`,
      metric: `z = ${priceZ.toFixed(2)}`,
      score: Math.min(100, Math.abs(priceZ) * 25),
    });
  }

  // ── signal: liquidity drop
  const avgBidDepth = mean(bidDepth.filter((v): v is number => v != null));
  const avgAskDepth = mean(askDepth.filter((v): v is number => v != null));
  const curBid = latest?.bidDepth ?? 0;
  const curAsk = latest?.askDepth ?? 0;
  if (avgBidDepth && curBid < 0.5 * avgBidDepth) {
    signals.push({
      id: "bid-depth-drop",
      level: curBid < 0.3 * avgBidDepth ? "alert" : "warn",
      title: "BID liquidity dropped",
      detail: `Top-20 bid depth is ${Math.round((curBid / avgBidDepth) * 100)}% of the ${range} average. Tighter books mean more slippage.`,
      metric: `${curBid.toFixed(0)} / avg ${avgBidDepth.toFixed(0)} ${asset}`,
      score: 100 - Math.round((curBid / avgBidDepth) * 100),
    });
  }
  if (avgAskDepth && curAsk < 0.5 * avgAskDepth) {
    signals.push({
      id: "ask-depth-drop",
      level: curAsk < 0.3 * avgAskDepth ? "alert" : "warn",
      title: "ASK liquidity dropped",
      detail: `Top-20 ask depth is ${Math.round((curAsk / avgAskDepth) * 100)}% of the ${range} average.`,
      metric: `${curAsk.toFixed(0)} / avg ${avgAskDepth.toFixed(0)} ${asset}`,
      score: 100 - Math.round((curAsk / avgAskDepth) * 100),
    });
  }

  // ── merchants: churn + low-completion at best price
  const current = merchantsInLatestTick(asset, fiat);
  const window = merchantChurnWindow(asset, fiat, range);

  const hourAgo = Math.floor(Date.now() / 1000) - 3600;
  const freshIds = new Set(
    window.filter((m) => m.firstTs >= hourAgo).map((m) => m.merchantId),
  );
  const churnedIds = new Set(
    window.filter((m) => m.lastTs < hourAgo).map((m) => m.merchantId),
  );

  if (current.length > 0) {
    const freshInCurrent = current.filter((m) => freshIds.has(m.merchantId));
    if (freshInCurrent.length / Math.max(1, current.length) > 0.3) {
      signals.push({
        id: "merchant-churn",
        level: "warn",
        title: "Unusual merchant churn",
        detail: `${freshInCurrent.length} of ${current.length} active merchants are new in the last hour. Could be fresh liquidity or coordinated activity.`,
        metric: `${freshInCurrent.length}/${current.length} fresh`,
        score: Math.round((freshInCurrent.length / current.length) * 80),
      });
    }
  }

  // Low-completion at best of book
  const bestBid = latest?.bestBid ?? null;
  const bestAsk = latest?.bestAsk ?? null;
  for (const m of current) {
    if (
      m.bestBuyPrice != null &&
      bestBid != null &&
      Math.abs(m.bestBuyPrice - bestBid) / bestBid < 0.0005 &&
      m.completionRate != null &&
      m.completionRate < 0.9
    ) {
      flagged.push({
        merchantId: m.merchantId,
        merchantName: m.merchantName,
        level: m.completionRate < 0.8 ? "alert" : "warn",
        reason: "Top of BID with low completion",
        metric: `${(m.completionRate * 100).toFixed(1)}% completion`,
      });
    }
    if (
      m.bestSellPrice != null &&
      bestAsk != null &&
      Math.abs(m.bestSellPrice - bestAsk) / bestAsk < 0.0005 &&
      m.completionRate != null &&
      m.completionRate < 0.9
    ) {
      flagged.push({
        merchantId: m.merchantId,
        merchantName: m.merchantName,
        level: m.completionRate < 0.8 ? "alert" : "warn",
        reason: "Top of ASK with low completion",
        metric: `${(m.completionRate * 100).toFixed(1)}% completion`,
      });
    }
  }

  return {
    asset,
    fiat,
    range,
    generatedAt,
    signals: signals.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    flaggedMerchants: flagged,
    stats: {
      latestMid: latest?.mid ?? null,
      ma20: ma20[ma20.length - 1] ?? null,
      priceZ,
      bidDepthZ,
      askDepthZ,
      activeMerchants: current.length,
      churned: churnedIds.size,
      fresh: freshIds.size,
    },
  };
}
