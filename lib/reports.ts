import { getDb, schema } from "@/lib/db/client";
import {
  listMarketSnapshots,
  marketSummary,
  latestMarketSnapshot,
  RANGES,
  type RangeKey,
} from "@/lib/db/queries";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { computeRiskReport } from "@/lib/risk";
import { mean, stdev } from "@/lib/stats";
import { buildMarket, summarizeMerchants } from "@/lib/analytics";
import { getExchange, type ExchangeId } from "@/lib/exchanges";
import { getBook } from "@/lib/market-data";
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
  ex: ExchangeId,
  asset: string,
  fiat: string,
  range: RangeKey = "24h",
): Promise<ReportDocument> {
  const [snapshots, summary, latest, risk] = await Promise.all([
    listMarketSnapshots(ex, asset, fiat, range),
    marketSummary(ex, asset, fiat, range),
    latestMarketSnapshot(ex, asset, fiat),
    computeRiskReport(ex, asset, fiat, range),
  ]);
  const first = snapshots[0];

  const mids = snapshots
    .map((s) => s.mid)
    .filter((v): v is number => v != null);
  const σ = stdev(mids);
  const μ = mean(mids);

  // Top merchants in the range ranked by average fiat depth — aggregated in
  // SQL and grouped by merchant id (was: every raw row loaded into memory and
  // grouped by display name).
  const since = Math.floor(Date.now() / 1000) - RANGES[range];
  const db = await getDb();
  const h = schema.merchantHourly;
  const m = schema.merchants;
  const topMerchants = (
    await db
      .select({
        name: sql<string>`max(${m.merchantName})`,
        orders: sql<number>`max(${h.ordersMonth})`,
        completion: sql<number>`avg(${h.completionRate})`,
        avgDepth: sql<number>`avg(${h.maxAvailableFiat})`,
        ticks: sql<number>`sum(${h.samples})`,
      })
      .from(h)
      .leftJoin(
        m,
        and(
          eq(m.exchange, h.exchange),
          eq(m.merchantId, h.merchantId),
          eq(m.asset, h.asset),
          eq(m.fiat, h.fiat),
        ),
      )
      .where(
        and(
          eq(h.exchange, ex),
          eq(h.asset, asset),
          eq(h.fiat, fiat),
          gte(h.hourTs, since - (since % 3600)),
        ),
      )
      .groupBy(h.merchantId)
      .orderBy(desc(sql`avg(${h.maxAvailableFiat})`))
      .limit(10)
  ).map((r) => ({
    name: r.name ?? "—",
    orders: Number(r.orders ?? 0),
    completion: Number(r.completion ?? 0),
    avgDepth: Number(r.avgDepth ?? 0),
    ticks: Number(r.ticks ?? 0),
  }));

  return {
    kind: "daily-recap",
    title: `${asset}/${fiat} recap · ${range}`,
    subtitle: `${getExchange(ex).label} P2P · ${snapshots.length} data points`,
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
          { key: "ticks", header: "Sweeps seen", align: "right" },
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
 * the reliability score, with each side's gap to the best price.
 * Pure client report — uses the live feed, not the ingested series.
 */
export async function merchantScorecardReport(
  ex: ExchangeId,
  asset: string,
  fiat: string,
): Promise<ReportDocument> {
  const book = await getBook(ex, { asset, fiat });
  const ads = [...book.buy, ...book.sell];
  const market = buildMarket(asset, fiat, ads);
  const median = market.sell.medianPrice ?? market.buy.medianPrice ?? null;
  const merchants = summarizeMerchants(ads);

  const verified = merchants.filter((m) => m.isMerchant).length;

  return {
    kind: "merchant-scorecard",
    title: `Merchant scorecard · ${getExchange(ex).label} ${asset}/${fiat}`,
    subtitle: `${merchants.length} merchants · ${verified} verified`,
    generatedAt: new Date().toISOString(),
    meta: [
      { label: "Best bid", value: market.buy.bestPrice?.toFixed(2) ?? "—" },
      { label: "Best ask", value: market.sell.bestPrice?.toFixed(2) ?? "—" },
      { label: "Median ask (±2% of best)", value: median?.toFixed(2) ?? "—" },
    ],
    tables: [
      {
        id: "merchants",
        title: "Merchants ranked by reliability score",
        subtitle: "Confidence-adjusted completion (Wilson lower bound) and 30-day volume; gaps are per side vs the best ad",
        columns: [
          { key: "rank", header: "#", align: "right" },
          { key: "name", header: "Merchant" },
          { key: "trust", header: "Reliability", format: "int", align: "right" },
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
          { key: "askGap", header: "Ask vs best", format: "pct", align: "right" },
          { key: "bidGap", header: "Bid vs best", format: "pct", align: "right" },
          {
            key: "depth",
            header: "Depth (fiat)",
            format: "compact",
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
          askGap: m.askVsBest,
          bidGap: m.bidVsBest,
          depth: m.totalAvailableFiat,
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
export async function listAvailableMarkets(ex: ExchangeId) {
  const db = await getDb();
  const h = schema.marketHourly;
  return db
    .selectDistinct({ asset: h.asset, fiat: h.fiat })
    .from(h)
    .where(eq(h.exchange, ex))
    .orderBy(asc(h.asset), asc(h.fiat));
}
