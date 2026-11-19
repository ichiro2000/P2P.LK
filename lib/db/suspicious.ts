import { and, asc, desc, eq, gte, inArray } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { SuspiciousTakerRow } from "./schema";
import { RANGES, latestSweepTs } from "./queries";
import { ASSET, FIAT } from "@/lib/constants";
import type { ExchangeId } from "@/lib/exchanges";

/**
 * What the public registry (pages, /api/suspicious, the QR check) may show.
 * Moderation fields stay out: `submittedBy` / `reviewedBy` are account ids
 * (they'd tie reports to members and admins) and `reviewNote` is the
 * moderator's internal note. Admin and "my reports" views read their own
 * queries in registry-admin.ts.
 */
function publicColumns() {
  const t = schema.suspiciousTakers;
  return {
    id: t.id,
    exchange: t.exchange,
    ts: t.ts,
    userId: t.userId,
    profileUrl: t.profileUrl,
    displayName: t.displayName,
    reason: t.reason,
    notes: t.notes,
    reporter: t.reporter,
    status: t.status,
  };
}

export type SuspiciousReport = Pick<
  SuspiciousTakerRow,
  "id" | "exchange" | "ts" | "userId" | "profileUrl" | "displayName" | "reason" | "notes" | "reporter" | "status"
>;

export async function listSuspicious(ex?: ExchangeId): Promise<SuspiciousReport[]> {
  const db = await getDb();
  const t = schema.suspiciousTakers;
  return db
    .select(publicColumns())
    .from(t)
    .where(ex ? and(eq(t.status, "active"), eq(t.exchange, ex)) : eq(t.status, "active"))
    .orderBy(desc(t.ts));
}

/** Active reports for one user. Empty array = not flagged. */
export async function reportsForUser(ex: ExchangeId, userId: string): Promise<SuspiciousReport[]> {
  const db = await getDb();
  const t = schema.suspiciousTakers;
  return db
    .select(publicColumns())
    .from(t)
    .where(and(eq(t.exchange, ex), eq(t.userId, userId), eq(t.status, "active")))
    .orderBy(desc(t.ts));
}

/** Best known display name for a user id — from the merchant directory
 *  (if they advertise) or the taker poll. Used to pre-fill report forms. */
export async function knownNameForUser(ex: ExchangeId, userId: string): Promise<string | null> {
  const db = await getDb();
  const [m] = await db
    .select({ name: schema.merchants.merchantName })
    .from(schema.merchants)
    .where(and(eq(schema.merchants.exchange, ex), eq(schema.merchants.merchantId, userId)))
    .orderBy(desc(schema.merchants.lastSeenTs))
    .limit(1);
  if (m?.name) return m.name;
  const [t] = await db
    .select({ name: schema.takerSnapshots.nickName })
    .from(schema.takerSnapshots)
    .where(and(eq(schema.takerSnapshots.exchange, ex), eq(schema.takerSnapshots.userId, userId)))
    .orderBy(desc(schema.takerSnapshots.ts))
    .limit(1);
  return t?.name ?? null;
}

/**
 * Activity summary for a flagged user:
 *  - isActive         listing in the latest merchant sweep, or their 30d
 *                     order count rose in the last 24h
 *  - lastSeenTs       latest observation (listing or profile poll)
 *  - ordersLatest / ordersAtReport / ordersDelta   30d order count now vs at first report
 *  - ticksSinceReport number of stat changes observed since the report
 *  - merchantName     latest nickname
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

const EMPTY: SuspiciousActivity = {
  isActive: false,
  lastSeenTs: null,
  ordersLatest: null,
  ordersAtReport: null,
  ordersDelta: null,
  ticksSinceReport: 0,
  merchantName: null,
};

/** Bulk activity — three queries total regardless of how many users. */
export async function bulkActivityForSuspicious(
  ex: ExchangeId,
  items: Array<{ merchantId: string; firstReportTs: number }>,
): Promise<Map<string, SuspiciousActivity>> {
  const out = new Map<string, SuspiciousActivity>();
  if (items.length === 0) return out;
  const ids = [...new Set(items.map((i) => i.merchantId))];
  const db = await getDb();

  const [snaps, listings, sweepTs] = await Promise.all([
    db
      .select()
      .from(schema.takerSnapshots)
      .where(and(eq(schema.takerSnapshots.exchange, ex), inArray(schema.takerSnapshots.userId, ids)))
      .orderBy(asc(schema.takerSnapshots.ts)),
    db
      .select()
      .from(schema.merchants)
      .where(and(eq(schema.merchants.exchange, ex), inArray(schema.merchants.merchantId, ids))),
    latestSweepTs(ex, ASSET, FIAT.code),
  ]);

  const now = Math.floor(Date.now() / 1000);
  for (const item of items) {
    const mine = snaps.filter((s) => s.userId === item.merchantId);
    const listing = listings.find((l) => l.merchantId === item.merchantId);
    if (mine.length === 0 && !listing) {
      out.set(item.merchantId, EMPTY);
      continue;
    }
    const latest = mine.at(-1);
    const sinceReport = mine.filter((s) => s.ts >= item.firstReportTs);
    const prev = mine.at(-2);
    const ordersLatest = latest?.ordersMonth ?? listing?.ordersMonth ?? null;
    const ordersAtReport = sinceReport[0]?.ordersMonth ?? null;
    const recentlyTraded =
      latest != null &&
      prev != null &&
      now - latest.ts < 86400 &&
      (latest.ordersMonth ?? 0) > (prev.ordersMonth ?? 0);
    out.set(item.merchantId, {
      isActive: (sweepTs != null && listing?.lastSeenTs === sweepTs) || recentlyTraded,
      lastSeenTs: Math.max(latest?.ts ?? 0, listing?.lastSeenTs ?? 0) || null,
      ordersLatest,
      ordersAtReport,
      ordersDelta:
        ordersLatest != null && ordersAtReport != null ? ordersLatest - ordersAtReport : null,
      ticksSinceReport: sinceReport.length,
      merchantName: latest?.nickName ?? listing?.merchantName ?? null,
    });
  }
  return out;
}

export async function activityForSuspicious(
  ex: ExchangeId,
  merchantId: string,
  firstReportTs: number,
): Promise<SuspiciousActivity> {
  const map = await bulkActivityForSuspicious(ex, [{ merchantId, firstReportTs }]);
  return map.get(merchantId) ?? EMPTY;
}

/** Observation timestamps (profile changes + hours listed) for the weekday ×
 *  hour heatmap on the detail page. */
export async function suspiciousHeatmapTicks(
  ex: ExchangeId,
  userId: string,
  windowSec: number = RANGES["30d"],
): Promise<number[]> {
  const db = await getDb();
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const [snaps, hours] = await Promise.all([
    db
      .select({ ts: schema.takerSnapshots.ts })
      .from(schema.takerSnapshots)
      .where(
        and(
          eq(schema.takerSnapshots.exchange, ex),
          eq(schema.takerSnapshots.userId, userId),
          gte(schema.takerSnapshots.ts, since),
        ),
      ),
    db
      .select({ ts: schema.merchantHourly.hourTs })
      .from(schema.merchantHourly)
      .where(
        and(
          eq(schema.merchantHourly.exchange, ex),
          eq(schema.merchantHourly.merchantId, userId),
          gte(schema.merchantHourly.hourTs, since),
        ),
      ),
  ]);
  return [...snaps, ...hours].map((r) => r.ts).sort((a, b) => a - b);
}

/** 30d order count / completion history for a flagged user. */
export async function suspiciousOrderHistory(
  ex: ExchangeId,
  userId: string,
  windowSec: number = RANGES["30d"],
): Promise<Array<{ ts: number; ordersMonth: number | null; completionRate: number | null }>> {
  const db = await getDb();
  const since = Math.floor(Date.now() / 1000) - windowSec;
  const t = schema.takerSnapshots;
  return db
    .select({ ts: t.ts, ordersMonth: t.ordersMonth, completionRate: t.completionRate })
    .from(t)
    .where(and(eq(t.exchange, ex), eq(t.userId, userId), gte(t.ts, since)))
    .orderBy(asc(t.ts));
}

export async function addReport(input: {
  exchange: ExchangeId;
  userId: string;
  profileUrl: string;
  displayName: string | null;
  reason: string;
  notes: string | null;
  reporter: string | null;
  /** "active" for admins (publish now), "pending" for member submissions. */
  status: "active" | "pending";
  submittedBy: string;
}): Promise<SuspiciousTakerRow> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);
  const [inserted] = await db
    .insert(schema.suspiciousTakers)
    .values({
      ...input,
      ts: now,
      // Admin posts are reviewed by definition.
      ...(input.status === "active" ? { reviewedBy: input.submittedBy, reviewedTs: now } : {}),
    })
    .returning();
  return inserted;
}
