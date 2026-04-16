import { db, schema } from "@/lib/db/client";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket, summarizeMerchants } from "@/lib/analytics";
import { DEFAULT_ARB_FIATS } from "@/lib/constants";

export type IngestMarket = { asset: string; fiat: string };
export type IngestReport = {
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  marketsAttempted: number;
  marketsSucceeded: number;
  marketRowsInserted: number;
  merchantRowsInserted: number;
  errors: { market: string; error: string }[];
};

const DEFAULT_MARKETS: IngestMarket[] = DEFAULT_ARB_FIATS.map((fiat) => ({
  asset: "USDT",
  fiat,
}));

/**
 * Capture one snapshot per market.
 * Uses the same normalized layer as the live pages so analytics are consistent.
 *
 * Safe to call concurrently; all writes are wrapped in a single transaction
 * per market to keep rollback simple if the Binance request partially fails.
 */
export async function runIngest(
  markets: IngestMarket[] = DEFAULT_MARKETS,
): Promise<IngestReport> {
  const startedAt = new Date().toISOString();
  const start = Date.now();
  const ts = Math.floor(start / 1000);

  const report: IngestReport = {
    startedAt,
    finishedAt: "",
    durationMs: 0,
    marketsAttempted: markets.length,
    marketsSucceeded: 0,
    marketRowsInserted: 0,
    merchantRowsInserted: 0,
    errors: [],
  };

  for (const { asset, fiat } of markets) {
    try {
      const { buy, sell } = await fetchBothSides({
        asset,
        fiat,
        rows: 20,
        publisherType: null,
      });

      if (buy.length === 0 && sell.length === 0) {
        // Still record the market row with nulls so gaps are visible.
        db.insert(schema.marketSnapshots)
          .values({
            ts,
            asset,
            fiat,
            bestBid: null,
            bestAsk: null,
            mid: null,
            spread: null,
            spreadPct: null,
            medianBid: null,
            medianAsk: null,
            vwapBid: null,
            vwapAsk: null,
            bidCount: 0,
            askCount: 0,
            bidDepth: 0,
            askDepth: 0,
            bidDepthFiat: 0,
            askDepthFiat: 0,
          })
          .run();
        report.marketRowsInserted += 1;
        continue;
      }

      const ads = [
        ...normalizeAds(buy, "BUY"),
        ...normalizeAds(sell, "SELL"),
      ];
      const snapshot = buildMarket(asset, fiat, ads);
      const medianForPremium =
        snapshot.sell.medianPrice ?? snapshot.buy.medianPrice ?? null;
      const merchants = summarizeMerchants(ads, medianForPremium);

      db.insert(schema.marketSnapshots)
        .values({
          ts,
          asset,
          fiat,
          bestBid: snapshot.buy.bestPrice,
          bestAsk: snapshot.sell.bestPrice,
          mid: snapshot.mid,
          spread: snapshot.spread,
          spreadPct: snapshot.spreadPct,
          medianBid: snapshot.buy.medianPrice,
          medianAsk: snapshot.sell.medianPrice,
          vwapBid: snapshot.buy.vwap,
          vwapAsk: snapshot.sell.vwap,
          bidCount: snapshot.buy.count,
          askCount: snapshot.sell.count,
          bidDepth: snapshot.buy.totalAvailable,
          askDepth: snapshot.sell.totalAvailable,
          bidDepthFiat: snapshot.buy.totalAvailableFiat,
          askDepthFiat: snapshot.sell.totalAvailableFiat,
        })
        .run();
      report.marketRowsInserted += 1;

      if (merchants.length > 0) {
        const insert = db
          .insert(schema.merchantSnapshots)
          .values(
            merchants.map((m) => ({
              ts,
              asset,
              fiat,
              merchantId: m.id,
              merchantName: m.name,
              isMerchant: m.isMerchant,
              ordersMonth: m.orders30d,
              completionRate: m.completionRate,
              avgReleaseSec: m.avgReleaseSec ?? null,
              buyAds: m.buyAds,
              sellAds: m.sellAds,
              bestBuyPrice: m.bestBuyPrice,
              bestSellPrice: m.bestSellPrice,
              totalAvailableFiat: m.totalAvailableFiat,
            })),
          )
          .run();
        report.merchantRowsInserted += insert.changes ?? merchants.length;
      }

      report.marketsSucceeded += 1;
    } catch (err) {
      report.errors.push({
        market: `${asset}/${fiat}`,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  report.finishedAt = new Date().toISOString();
  report.durationMs = Date.now() - start;
  return report;
}
