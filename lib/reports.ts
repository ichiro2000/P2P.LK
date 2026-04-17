import { getDb, schema } from "@/lib/db/client";
import {
  listMarketSnapshots,
  marketSummary,
  latestMarketSnapshot,
  RANGES,
  type RangeKey,
} from "@/lib/db/queries";
import { and, asc, eq, gte } from "drizzle-orm";
import { computeRiskReport } from "@/lib/risk";
import { mean, stdev } from "@/lib/stats";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket, summarizeMerchants } from "@/lib/analytics";
import { resolveBankPayTypes } from "@/lib/constants";
import { formatSLT } from "@/lib/format";

/** ── Shared types ────────────────────────────────────────────────────── */

export type ReportColumn = {
  key: string;
  header: string;
  /** Optional formatter hint — rendered client-side. */
  format?: "price" | "pct" | "int" | "compact" | "duration" | "datetime";
  align?: "left" | "right";
};

export type ReportTable = {
  id: string;
  title: string;
  subtitle?: string;
  columns: ReportColumn[];
  rows: Record<string, string | number | null>[];
};

export type ReportDocument = {
  kind: string;
  title: string;
  subtitle: string;
  generatedAt: string;
  meta: { label: string; value: string }[];
  tables: ReportTable[];
};

/** ── Daily market recap ──────────────────────────────────────────────── */

/**
 * Recap for one market over a given range. Uses the ingested time-series
 * exclusively — the point of a recap is what happened, not the live tick.
 */
export async function dailyRecapReport(
  asset: string,
  fiat: string,
  range: RangeKey = "24h",
): Promise<ReportDocument> {
  const [snapshots, summary, latest, risk] = await Promise.all([
    listMarketSnapshots(asset, fiat, range),
    marketSummary(asset, fiat, range),
    latestMarketSnapshot(asset, fiat),
    computeRiskReport(asset, fiat, range),
  ]);
  const first = snapshots[0];

  const mids = snapshots
    .map((s) => s.mid)
    .filter((v): v is number => v != null);
  const σ = stdev(mids);
  const μ = mean(mids);

  // Top merchants in the range ranked by average fiat depth.
  const since = Math.floor(Date.now() / 1000) - RANGES[range];
  const db = await getDb();
  const latestMerchants = await db
    .select({
      name: schema.merchantSnapshots.merchantName,
      orders: schema.merchantSnapshots.ordersMonth,
      completion: schema.merchantSnapshots.completionRate,
      depth: schema.merchantSnapshots.totalAvailableFiat,
      ts: schema.merchantSnapshots.ts,
    })
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
        gte(schema.merchantSnapshots.ts, since),
      ),
    )
    .orderBy(asc(schema.merchantSnapshots.ts));

  // Reduce to per-merchant averages within the window.
  const mMap = new Map<
    string,
    { name: string; orders: number; completion: number; depth: number; ticks: number }
  >();
  for (const r of latestMerchants) {
    const e = mMap.get(r.name) ?? {
      name: r.name,
      orders: 0,
      completion: 0,
      depth: 0,
      ticks: 0,
    };
    e.orders = Math.max(e.orders, r.orders ?? 0);
    e.completion += r.completion ?? 0;
    e.depth += r.depth ?? 0;
    e.ticks += 1;
    mMap.set(r.name, e);
  }
  const topMerchants = [...mMap.values()]
    .map((e) => ({
      name: e.name,
      orders: e.orders,
      completion: e.ticks > 0 ? e.completion / e.ticks : 0,
      avgDepth: e.ticks > 0 ? e.depth / e.ticks : 0,
      ticks: e.ticks,
    }))
    .sort((a, b) => b.avgDepth - a.avgDepth)
    .slice(0, 10);

  return {
    kind: "daily-recap",
    title: `${asset}/${fiat} recap · ${range}`,
    subtitle: `Binance P2P · ${snapshots.length} snapshots`,
    generatedAt: new Date().toISOString(),
    meta: [
      {
        label: "First tick",
        value: formatSLT(first?.ts),
      },
      {
        label: "Latest mid",
        value: latest?.mid != null ? latest.mid.toFixed(2) : "—",
      },
      {
        label: "Range min / max",
        value:
          summary?.minMid != null && summary?.maxMid != null
            ? `${summary.minMid.toFixed(2)} / ${summary.maxMid.toFixed(2)}`
            : "—",
      },
      {
        label: "Average spread",
        value:
          summary?.avgSpreadPct != null
            ? (summary.avgSpreadPct * 100).toFixed(2) + "%"
            : "—",
      },
      {
        label: "Std. dev. of mid",
        value: σ != null ? σ.toFixed(2) : "—",
      },
      {
        label: "Signals fired",
        value: String(risk.signals.length),
      },
    ],
    tables: [
      {
        id: "signals",
        title: "Risk signals",
        subtitle: "Anomalies from statistical baseline",
        columns: [
          { key: "level", header: "Level" },
          { key: "title", header: "Title" },
          { key: "detail", header: "Detail" },
          { key: "metric", header: "Metric", align: "right" },
        ],
        rows:
          risk.signals.length > 0
            ? risk.signals.map((s) => ({
                level: s.level.toUpperCase(),
                title: s.title,
                detail: s.detail,
                metric: s.metric ?? "",
              }))
            : [
                {
                  level: "OK",
                  title: "No anomalies detected",
                  detail: `Mid price, depth and merchant churn all within ${range} norms (μ ≈ ${μ?.toFixed(2) ?? "—"}, σ ≈ ${σ?.toFixed(2) ?? "—"}).`,
                  metric: "",
                },
              ],
      },
      {
        id: "top-merchants",
        title: "Top merchants by average depth",
        subtitle: `Window: ${range}`,
        columns: [
          { key: "rank", header: "#", align: "right" },
          { key: "name", header: "Merchant" },
          { key: "orders", header: "30d orders", format: "int", align: "right" },
          {
            key: "completion",
            header: "Completion",
            format: "pct",
            align: "right",
          },
          {
            key: "avgDepth",
            header: "Avg. depth (fiat)",
            format: "compact",
            align: "right",
          },
          { key: "ticks", header: "Ticks seen", align: "right" },
        ],
        rows: topMerchants.map((m, i) => ({
          rank: i + 1,
          name: m.name,
          orders: m.orders,
          completion: m.completion,
          avgDepth: m.avgDepth,
          ticks: m.ticks,
        })),
      },
    ],
  };
}

/** ── Merchant rail competitiveness ───────────────────────────────────── */

/**
 * For a single market: snapshots the current ad book and ranks merchants by
 * price competitiveness (distance from market median) alongside trust.
 * Pure client report — uses the live feed, not the ingested series.
 */
export async function merchantScorecardReport(
  asset: string,
  fiat: string,
): Promise<ReportDocument> {
  const { buy, sell } = await fetchBothSides({
    asset,
    fiat,
    rows: 20,
    payTypes: resolveBankPayTypes(""),
    publisherType: null,
  });
  const ads = [
    ...normalizeAds(buy, "BUY"),
    ...normalizeAds(sell, "SELL"),
  ];
  const market = buildMarket(asset, fiat, ads);
  const median = market.sell.medianPrice ?? market.buy.medianPrice ?? null;
  const merchants = summarizeMerchants(ads, median);

  const verified = merchants.filter((m) => m.isMerchant).length;

  return {
    kind: "merchant-scorecard",
    title: `Merchant scorecard · ${asset}/${fiat}`,
    subtitle: `${merchants.length} merchants · ${verified} verified`,
    generatedAt: new Date().toISOString(),
    meta: [
      { label: "Best bid", value: market.buy.bestPrice?.toFixed(2) ?? "—" },
      { label: "Best ask", value: market.sell.bestPrice?.toFixed(2) ?? "—" },
      { label: "Median", value: median?.toFixed(2) ?? "—" },
    ],
    tables: [
      {
        id: "merchants",
        title: "Merchants ranked by trust score",
        subtitle: "Composite of completion rate, order volume and release time",
        columns: [
          { key: "rank", header: "#", align: "right" },
          { key: "name", header: "Merchant" },
          { key: "trust", header: "Trust", format: "int", align: "right" },
          {
            key: "orders",
            header: "30d orders",
            format: "int",
            align: "right",
          },
          {
            key: "completion",
            header: "Completion",
            format: "pct",
            align: "right",
          },
          {
            key: "premium",
            header: "Premium",
            format: "pct",
            align: "right",
          },
          {
            key: "depth",
            header: "Depth (fiat)",
            format: "compact",
            align: "right",
          },
          {
            key: "release",
            header: "Release",
            format: "duration",
            align: "right",
          },
          { key: "rails", header: "Rails" },
        ],
        rows: merchants.map((m, i) => ({
          rank: i + 1,
          name: m.name,
          trust: m.trustScore,
          orders: m.orders30d,
          completion: m.completionRate,
          premium: m.premiumVsMedian,
          depth: m.totalAvailableFiat,
          release: m.avgReleaseSec ?? null,
          rails: m.payMethods.join(", "),
        })),
      },
    ],
  };
}

/** ── Discovery ───────────────────────────────────────────────────────── */

/**
 * Returns the list of (asset, fiat) pairs that have any history — used to
 * populate the Reports picker and prevent users from running recap reports
 * against markets the ingest has never seen.
 */
export async function listAvailableMarkets() {
  const db = await getDb();
  return db
    .selectDistinct({
      asset: schema.marketSnapshots.asset,
      fiat: schema.marketSnapshots.fiat,
    })
    .from(schema.marketSnapshots)
    .orderBy(
      asc(schema.marketSnapshots.asset),
      asc(schema.marketSnapshots.fiat),
    );
}

