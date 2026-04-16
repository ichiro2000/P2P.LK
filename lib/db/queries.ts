import { getDb, schema } from "./client";
import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import type {
  MarketSnapshotRow,
  MerchantSnapshotRow,
} from "./schema";

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

/** Aggregate bid+ask depth by (day-of-week, hour-of-day) in the local tz. */
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
    const d = new Date(r.ts * 1000);
    const dow = d.getDay();
    const hour = d.getHours();
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
