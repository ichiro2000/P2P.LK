import { and, asc, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { MerchantSnapshotRow, SuspiciousTakerRow } from "./schema";
import { RANGES } from "./queries";
import { ASSET, FIAT } from "@/lib/constants";

export type SuspiciousReport = SuspiciousTakerRow;

export async function listSuspicious(): Promise<SuspiciousReport[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.suspiciousTakers)
    .where(eq(schema.suspiciousTakers.status, "active"))
    .orderBy(desc(schema.suspiciousTakers.ts));
}

/**
 * All active reports for a single binance userId (advertiserNo). Returns an
 * empty array when the taker isn't in the registry — callers use `length > 0`
 * as the "flagged" signal.
 */
export async function reportsForUser(
  binanceUserId: string,
): Promise<SuspiciousReport[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.suspiciousTakers)
    .where(
      and(
        eq(schema.suspiciousTakers.binanceUserId, binanceUserId),
        eq(schema.suspiciousTakers.status, "active"),
      ),
    )
    .orderBy(desc(schema.suspiciousTakers.ts));
}

/**
 * Most recent merchant snapshot we've ever recorded for a given advertiserNo
 * across any market. Used to map a QR-parsed userId → the merchant's nickname
 * so we can pre-fill the "Display name" field on the report form without
 * requiring manual entry. Returns `null` when the taker has never been seen
 * by our ingest worker (brand-new or non-LKR account).
 */
export async function latestMerchantSnapshotAnyMarket(
  merchantId: string,
): Promise<MerchantSnapshotRow | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.merchantSnapshots)
    .where(eq(schema.merchantSnapshots.merchantId, merchantId))
    .orderBy(desc(schema.merchantSnapshots.ts))
    .limit(1);
  return rows[0] ?? null;
}

/**
 * Listing-activity summary for one flagged taker on the LKR book:
 *  - `isActive`        → appeared in the single most recent market tick
 *  - `lastSeenTs`      → timestamp of their most recent merchant snapshot
 *  - `ordersLatest`    → Binance's 30d order count on their latest snapshot
 *  - `ordersAtReport`  → the 30d order count at the time of the first report
 *  - `ordersDelta`     → ordersLatest − ordersAtReport (negative when some
 *                        counted orders have dropped out of the rolling 30d
 *                        window, positive when they keep trading)
 *  - `ticksSinceReport`→ how many listing ticks we've seen since the first
 *                        report was filed (0 when they've gone quiet)
 *  - `merchantName`    → their most recent Binance nickname
 */
export type SuspiciousActivity = {
  isActive: boolean;
  lastSeenTs: number | null;
  ordersLatest: number | null;
  ordersAtReport: number | null;
  ordersDelta: number | null;
  ticksSinceReport: number;
  merchantName: string | null;
};

export async function activityForSuspicious(
  merchantId: string,
  firstReportTs: number,
  asset: string = ASSET,
  fiat: string = FIAT.code,
): Promise<SuspiciousActivity> {
  const db = await getDb();

  const [latestTick] = await db
    .select({ ts: sql<number>`max(${schema.merchantSnapshots.ts})` })
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
      ),
    )
    .limit(1);
  const latestMarketTs = latestTick?.ts ?? null;

  const latest = await latestMerchantSnapshotAnyMarket(merchantId);

  const atReportRows = await db
    .select()
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.merchantId, merchantId),
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
        gte(schema.merchantSnapshots.ts, firstReportTs),
      ),
    )
    .orderBy(asc(schema.merchantSnapshots.ts))
    .limit(1);
  const firstSinceReport = atReportRows[0] ?? null;

  const [countRow] = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.merchantId, merchantId),
        eq(schema.merchantSnapshots.asset, asset),
        eq(schema.merchantSnapshots.fiat, fiat),
        gte(schema.merchantSnapshots.ts, firstReportTs),
      ),
    );

  const ticksSinceReport = Number(countRow?.c ?? 0);

  const isActive =
    latest != null &&
    latestMarketTs != null &&
    latest.ts === latestMarketTs &&
    latest.asset === asset &&
    latest.fiat === fiat;

  const ordersLatest = latest?.ordersMonth ?? null;
  const ordersAtReport = firstSinceReport?.ordersMonth ?? null;
  const ordersDelta =
    ordersLatest != null && ordersAtReport != null
      ? ordersLatest - ordersAtReport
      : null;

  return {
    isActive,
    lastSeenTs: latest?.ts ?? null,
    ordersLatest,
    ordersAtReport,
    ordersDelta,
    ticksSinceReport,
    merchantName: latest?.merchantName ?? null,
  };
}

/**
 * Bulk version of `activityForSuspicious` — issues one query per taker but
 * fans them out in parallel. Registry-list volumes stay in the tens, so this
 * is fast enough and keeps the SQL obvious. Keys the result map by merchantId.
 */
export async function bulkActivityForSuspicious(
  items: Array<{ merchantId: string; firstReportTs: number }>,
  asset: string = ASSET,
  fiat: string = FIAT.code,
): Promise<Map<string, SuspiciousActivity>> {
  if (items.length === 0) return new Map();
  const entries = await Promise.all(
    items.map(async (i) => {
      const activity = await activityForSuspicious(
        i.merchantId,
        i.firstReportTs,
        asset,
        fiat,
      ).catch(
        (): SuspiciousActivity => ({
          isActive: false,
          lastSeenTs: null,
          ordersLatest: null,
          ordersAtReport: null,
          ordersDelta: null,
          ticksSinceReport: 0,
          merchantName: null,
        }),
      );
      return [i.merchantId, activity] as const;
    }),
  );
  return new Map(entries);
}

/**
 * Listing ticks for a flagged taker across the LKR book for the last N days.
 * Feeds the weekday × hour heatmap on the suspicious detail page so merchants
 * can see *when* the flagged taker is typically active.
 */
export async function suspiciousHeatmapTicks(
  merchantId: string,
  windowSec: number = RANGES["30d"],
  asset: string = ASSET,
  fiat: string = FIAT.code,
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
 * Order-count history (30d rolling from Binance) for a flagged taker. Used on
 * the suspicious detail page to chart whether they keep trading despite being
 * flagged — a rising line is the clearest "still scamming" signal.
 */
export async function suspiciousOrderHistory(
  merchantId: string,
  windowSec: number = RANGES["30d"],
  asset: string = ASSET,
  fiat: string = FIAT.code,
): Promise<Array<{ ts: number; ordersMonth: number | null; completionRate: number | null }>> {
  const db = await getDb();
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const rows = await db
    .select({
      ts: schema.merchantSnapshots.ts,
      ordersMonth: schema.merchantSnapshots.ordersMonth,
      completionRate: schema.merchantSnapshots.completionRate,
    })
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
  return rows;
}

export async function addReport(input: {
  binanceUserId: string;
  profileUrl: string;
  displayName: string | null;
  reason: string;
  notes: string | null;
  reporter: string | null;
}): Promise<SuspiciousReport> {
  const db = await getDb();
  const row = {
    ts: Math.floor(Date.now() / 1000),
    binanceUserId: input.binanceUserId,
    profileUrl: input.profileUrl,
    displayName: input.displayName,
    reason: input.reason,
    notes: input.notes,
    reporter: input.reporter,
    status: "active" as const,
  };
  const [inserted] = await db
    .insert(schema.suspiciousTakers)
    .values(row)
    .returning();
  return inserted;
}
