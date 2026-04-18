import { getDb, schema } from "./client";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type {
  MarketSnapshotRow,
  MerchantSnapshotRow,
} from "./schema";
import { SLT_OFFSET_SEC } from "@/lib/constants";

/** ── Time ranges ─────────────────────────────────────────────────────── */

export const RANGES = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
} as const;

export type RangeKey = keyof typeof RANGES;

export function rangeSinceSeconds(range: RangeKey): number {
  const now = Math.floor(Date.now() / 1000);
  return now - RANGES[range];
}

/** ── Market queries ──────────────────────────────────────────────────── */

export async function listMarketSnapshots(
  asset: string,
  fiat: string,
  range: RangeKey,
): Promise<MarketSnapshotRow[]> {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  return db
    .select()
    .from(schema.marketSnapshots)
    .where(
      and(
        eq(schema.marketSnapshots.asset, asset),
        eq(schema.marketSnapshots.fiat, fiat),
        gte(schema.marketSnapshots.ts, since),
      ),
    )
    .orderBy(asc(schema.marketSnapshots.ts));
}

export async function latestMarketSnapshot(
  asset: string,
  fiat: string,
): Promise<MarketSnapshotRow | undefined> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.marketSnapshots)
    .where(
      and(
        eq(schema.marketSnapshots.asset, asset),
        eq(schema.marketSnapshots.fiat, fiat),
      ),
    )
    .orderBy(desc(schema.marketSnapshots.ts))
    .limit(1);
  return rows[0];
}

/** Summary stats from the last `range` window. */
export async function marketSummary(
  asset: string,
  fiat: string,
  range: RangeKey,
) {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  const rows = await db
    .select({
      count: sql<number>`count(*)`.as("c"),
      avgMid: sql<number | null>`avg(${schema.marketSnapshots.mid})`.as("avg_mid"),
      minMid: sql<number | null>`min(${schema.marketSnapshots.mid})`.as("min_mid"),
      maxMid: sql<number | null>`max(${schema.marketSnapshots.mid})`.as("max_mid"),
      avgSpreadPct: sql<number | null>`avg(${schema.marketSnapshots.spreadPct})`.as(
        "avg_spread",
      ),
      avgBidDepth: sql<number | null>`avg(${schema.marketSnapshots.bidDepth})`.as(
        "avg_bid_depth",
      ),
      avgAskDepth: sql<number | null>`avg(${schema.marketSnapshots.askDepth})`.as(
        "avg_ask_depth",
      ),
    })
    .from(schema.marketSnapshots)
    .where(
      and(
        eq(schema.marketSnapshots.asset, asset),
        eq(schema.marketSnapshots.fiat, fiat),
        gte(schema.marketSnapshots.ts, since),
      ),
    );
  return rows[0];
}

/** All markets with at least one snapshot in the given range. */
export async function listTrackedMarkets(range: RangeKey = "24h") {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  return db
    .select({
      asset: schema.marketSnapshots.asset,
      fiat: schema.marketSnapshots.fiat,
      count: sql<number>`count(*)`,
      lastTs: sql<number>`max(${schema.marketSnapshots.ts})`,
    })
    .from(schema.marketSnapshots)
    .where(gte(schema.marketSnapshots.ts, since))
    .groupBy(schema.marketSnapshots.asset, schema.marketSnapshots.fiat)
    .orderBy(asc(schema.marketSnapshots.asset), asc(schema.marketSnapshots.fiat));
}

/**
 * Aggregate bid+ask depth by (day-of-week, hour-of-day) in Asia/Colombo.
 *
 * Bucketing in Sri Lanka time (UTC+5:30, no DST) means the heatmap columns
 * match what users see on the live clock — otherwise the server's tz (UTC in
 * prod) would shift every hour column by ~5.5h. See `SLT_OFFSET_SEC`.
 */
export async function depthHeatmap(
  asset: string,
  fiat: string,
  range: RangeKey = "7d",
) {
  const rows = await listMarketSnapshots(asset, fiat, range);

  type Cell = { sum: number; count: number };
  const grid: Cell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ sum: 0, count: 0 })),
  );

  for (const r of rows) {
    const d = new Date((r.ts + SLT_OFFSET_SEC) * 1000);
    const dow = d.getUTCDay();
    const hour = d.getUTCHours();
    const depth = (r.bidDepth ?? 0) + (r.askDepth ?? 0);
    const cell = grid[dow][hour];
    cell.sum += depth;
    cell.count += 1;
  }

  const flat: {
    dow: number;
    hour: number;
    avg: number;
    count: number;
  }[] = [];
  let globalMax = 0;
  for (let d = 0; d < 7; d++) {
    for (let h = 0; h < 24; h++) {
      const c = grid[d][h];
      const avg = c.count > 0 ? c.sum / c.count : 0;
      if (avg > globalMax) globalMax = avg;
      flat.push({ dow: d, hour: h, avg, count: c.count });
    }
  }

  return { cells: flat, max: globalMax, totalPoints: rows.length };
}

/**
 * Lightweight — just the (ts, mid) pairs in a market range. Used as an overlay
 * on the per-merchant price chart so the viewer can see the merchant's price
 * relative to the market median at each tick.
 */
export async function listMarketMids(
  asset: string,
  fiat: string,
  range: RangeKey,
): Promise<Array<{ ts: number; mid: number | null }>> {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  const rows = await db
    .select({
      ts: schema.marketSnapshots.ts,
      mid: schema.marketSnapshots.mid,
    })
    .from(schema.marketSnapshots)
    .where(
      and(
        eq(schema.marketSnapshots.asset, asset),
        eq(schema.marketSnapshots.fiat, fiat),
        gte(schema.marketSnapshots.ts, since),
      ),
    )
    .orderBy(asc(schema.marketSnapshots.ts));
  return rows;
}

/** ── Merchant queries ────────────────────────────────────────────────── */

export async function merchantHistory(
  merchantId: string,
  asset: string,
  fiat: string,
  range: RangeKey,
): Promise<MerchantSnapshotRow[]> {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  return db
    .select()
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.merchantId, merchantId),
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
        gte(schema.merchantSnapshots.ts, since),
      ),
    )
    .orderBy(asc(schema.merchantSnapshots.ts));
}

/**
 * Listing ticks (just the `ts` column) for a merchant over a wider, fixed
 * window — used by the weekday × hour heatmap so the pattern stays meaningful
 * regardless of which range tab the user has selected. A 24h selection gives
 * at most one row of activity; the heatmap needs a week of coverage to read
 * as a pattern. Capped at 30d to match the longest range we store.
 */
export async function merchantHeatmapTicks(
  merchantId: string,
  asset: string,
  fiat: string,
  windowSec: number = RANGES["30d"],
): Promise<number[]> {
  const db = await getDb();
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const rows = await db
    .select({ ts: schema.merchantSnapshots.ts })
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.merchantId, merchantId),
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
        gte(schema.merchantSnapshots.ts, since),
      ),
    )
    .orderBy(asc(schema.merchantSnapshots.ts));
  return rows.map((r) => r.ts);
}

/**
 * Most recent snapshot row we have for a single merchant in this market.
 * Used by the merchant detail page to populate the header card.
 */
export async function latestMerchantSnapshot(
  merchantId: string,
  asset: string,
  fiat: string,
): Promise<MerchantSnapshotRow | undefined> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.merchantId, merchantId),
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
      ),
    )
    .orderBy(desc(schema.merchantSnapshots.ts))
    .limit(1);
  return rows[0];
}

export async function merchantsInLatestTick(
  asset: string,
  fiat: string,
): Promise<MerchantSnapshotRow[]> {
  const db = await getDb();
  const latestRows = await db
    .select({ ts: sql<number>`max(${schema.merchantSnapshots.ts})` })
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
      ),
    )
    .limit(1);
  const ts = latestRows[0]?.ts;
  if (!ts) return [];

  return db
    .select()
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
        eq(schema.merchantSnapshots.ts, ts),
      ),
    );
}

/**
 * Every merchant we've ever seen in this market, collapsed to the most recent
 * snapshot row per merchant. Drives the "all merchants" directory view —
 * merchants who have dropped off the live book still appear here with their
 * last-known stats and `lastSeenTs`.
 */
export type KnownMerchantRow = {
  merchantId: string;
  merchantName: string;
  lastSeenTs: number;
  isMerchant: boolean | null;
  userIdentity: string | null;
  userGrade: number | null;
  vipLevel: number | null;
  ordersMonth: number | null;
  completionRate: number | null;
  avgReleaseSec: number | null;
  buyAds: number | null;
  sellAds: number | null;
  bestBuyPrice: number | null;
  bestSellPrice: number | null;
  totalAvailableFiat: number | null;
};

export async function listAllKnownMerchants(
  asset: string,
  fiat: string,
): Promise<KnownMerchantRow[]> {
  const db = await getDb();
  // DISTINCT ON keeps the most recent row per merchant_id; match Postgres'
  // requirement that the leading ORDER BY column equals the DISTINCT ON key.
  const rows = await db.execute<{
    merchant_id: string;
    merchant_name: string;
    last_seen_ts: number | string;
    is_merchant: boolean | null;
    user_identity: string | null;
    user_grade: number | null;
    vip_level: number | null;
    orders_month: number | null;
    completion_rate: number | null;
    avg_release_sec: number | null;
    buy_ads: number | null;
    sell_ads: number | null;
    best_buy_price: number | null;
    best_sell_price: number | null;
    total_available_fiat: number | null;
  }>(sql`
    SELECT DISTINCT ON (merchant_id)
      merchant_id,
      merchant_name,
      ts AS last_seen_ts,
      is_merchant,
      user_identity,
      user_grade,
      vip_level,
      orders_month,
      completion_rate,
      avg_release_sec,
      buy_ads,
      sell_ads,
      best_buy_price,
      best_sell_price,
      total_available_fiat
    FROM merchant_snapshots
    WHERE asset = ${asset} AND fiat = ${fiat}
    ORDER BY merchant_id, ts DESC
  `);
  return (rows as unknown as Array<Record<string, unknown>>).map((r) => ({
    merchantId: String(r.merchant_id),
    merchantName: String(r.merchant_name),
    lastSeenTs: Number(r.last_seen_ts),
    isMerchant:
      r.is_merchant == null ? null : Boolean(r.is_merchant),
    userIdentity: r.user_identity == null ? null : String(r.user_identity),
    userGrade: r.user_grade == null ? null : Number(r.user_grade),
    vipLevel: r.vip_level == null ? null : Number(r.vip_level),
    ordersMonth:
      r.orders_month == null ? null : Number(r.orders_month),
    completionRate:
      r.completion_rate == null ? null : Number(r.completion_rate),
    avgReleaseSec:
      r.avg_release_sec == null ? null : Number(r.avg_release_sec),
    buyAds: r.buy_ads == null ? null : Number(r.buy_ads),
    sellAds: r.sell_ads == null ? null : Number(r.sell_ads),
    bestBuyPrice:
      r.best_buy_price == null ? null : Number(r.best_buy_price),
    bestSellPrice:
      r.best_sell_price == null ? null : Number(r.best_sell_price),
    totalAvailableFiat:
      r.total_available_fiat == null ? null : Number(r.total_available_fiat),
  }));
}

export async function merchantChurnWindow(
  asset: string,
  fiat: string,
  range: RangeKey,
) {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  return db
    .select({
      merchantId: schema.merchantSnapshots.merchantId,
      merchantName: schema.merchantSnapshots.merchantName,
      firstTs: sql<number>`min(${schema.merchantSnapshots.ts})`.as("first_ts"),
      lastTs: sql<number>`max(${schema.merchantSnapshots.ts})`.as("last_ts"),
      ticks: sql<number>`count(*)`.as("ticks"),
      avgCompletion: sql<number>`avg(${schema.merchantSnapshots.completionRate})`.as(
        "avg_completion",
      ),
    })
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
        gte(schema.merchantSnapshots.ts, since),
      ),
    )
    // Postgres requires non-aggregated selected columns to be in GROUP BY.
    // merchant_name is 1:1 with merchant_id in this table so grouping by both
    // produces the same logical groups.
    .groupBy(
      schema.merchantSnapshots.merchantId,
      schema.merchantSnapshots.merchantName,
    );
}
