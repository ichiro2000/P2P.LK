import "server-only";
import { and, desc, eq, inArray, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "./client";

/**
 * Suspicious-registry moderation (admin) and "my reports" (member).
 *
 *   pending   → member submission waiting for review
 *   active    → public
 *   rejected  → declined before it went public
 *   retracted → taken down after it was public
 */

export const REGISTRY_STATUSES = ["pending", "active", "rejected", "retracted"] as const;
export type RegistryStatus = (typeof REGISTRY_STATUSES)[number];

export const REGISTRY_TABS = [
  { key: "pending", label: "Pending" },
  { key: "active", label: "Active" },
  { key: "rejected", label: "Rejected" },
  { key: "retracted", label: "Retracted" },
] as const satisfies readonly { key: RegistryStatus; label: string }[];

export const REGISTRY_LIST_LIMIT = 100;

export type RegistryRow = {
  id: number;
  ts: number;
  exchange: string;
  userId: string;
  profileUrl: string;
  displayName: string | null;
  reason: string;
  notes: string | null;
  reporter: string | null;
  status: RegistryStatus;
  submittedBy: string | null;
  submitterName: string | null;
  submitterMerchant: string | null;
  submitterEmail: string | null;
  reviewedTs: number | null;
  reviewNote: string | null;
  reviewerEmail: string | null;
  /** Other active reports for the same taker (excluding this one). */
  otherActive: number;
};

function searchFilter(q: string): SQL | undefined {
  const term = q.trim().toLowerCase().slice(0, 100);
  if (!term) return undefined;
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const t = schema.suspiciousTakers;
  const u = schema.user;
  const parts: SQL[] = [
    sql`lower(${t.userId}) LIKE ${like} ESCAPE '\\'`,
    sql`lower(coalesce(${t.displayName}, '')) LIKE ${like} ESCAPE '\\'`,
    sql`lower(${t.reason}) LIKE ${like} ESCAPE '\\'`,
    sql`lower(coalesce(${t.reporter}, '')) LIKE ${like} ESCAPE '\\'`,
    sql`lower(coalesce(${u.email}, '')) LIKE ${like} ESCAPE '\\'`,
    sql`lower(coalesce(${u.name}, '')) LIKE ${like} ESCAPE '\\'`,
  ];
  // "#42" or "42" also finds report 42.
  const asId = term.replace(/^#/, "");
  if (/^\d{1,12}$/.test(asId)) parts.push(eq(t.id, Number(asId)));
  return or(...parts);
}

/** Tab counts (respecting the search) + the current tab's rows — 2 queries. */
export async function loadRegistry(tab: RegistryStatus, q: string) {
  const db = await getDb();
  const t = schema.suspiciousTakers;
  const u = schema.user;
  const search = searchFilter(q);

  const otherActive = sql<number>`(SELECT count(*) FROM suspicious_takers o WHERE o.exchange = ${t.exchange} AND o.user_id = ${t.userId} AND o.status = 'active' AND o.id <> ${t.id})`;
  const reviewerEmail = sql<string | null>`(SELECT r.email FROM "user" r WHERE r.id = ${t.reviewedBy})`;

  const [countRows, rows] = await Promise.all([
    db
      .select({ status: t.status, n: sql<number>`count(*)` })
      .from(t)
      .leftJoin(u, eq(u.id, t.submittedBy))
      .where(search)
      .groupBy(t.status),
    db
      .select({
        id: t.id,
        ts: t.ts,
        exchange: t.exchange,
        userId: t.userId,
        profileUrl: t.profileUrl,
        displayName: t.displayName,
        reason: t.reason,
        notes: t.notes,
        reporter: t.reporter,
        status: t.status,
        submittedBy: t.submittedBy,
        submitterName: u.name,
        submitterMerchant: u.merchantName,
        submitterEmail: u.email,
        reviewedTs: t.reviewedTs,
        reviewNote: t.reviewNote,
        reviewerEmail,
        otherActive,
      })
      .from(t)
      .leftJoin(u, eq(u.id, t.submittedBy))
      .where(and(eq(t.status, tab), search))
      // Oldest first for the review queue, newest first elsewhere.
      .orderBy(tab === "pending" ? t.ts : desc(t.ts), desc(t.id))
      .limit(REGISTRY_LIST_LIMIT),
  ]);

  const counts = Object.fromEntries(REGISTRY_STATUSES.map((s) => [s, 0])) as Record<RegistryStatus, number>;
  for (const c of countRows) if (c.status in counts) counts[c.status as RegistryStatus] = Number(c.n);

  return {
    counts,
    rows: rows.map((r) => ({ ...r, otherActive: Number(r.otherActive ?? 0) })) as RegistryRow[],
  };
}

/* ── Moderation ──────────────────────────────────────────────────────── */

export type ModerationAction = "publish" | "reject" | "retract" | "restore";

/** Allowed source statuses and the resulting status per action. */
export const TRANSITIONS: Record<ModerationAction, { from: RegistryStatus[]; to: RegistryStatus }> = {
  publish: { from: ["pending"], to: "active" },
  reject: { from: ["pending"], to: "rejected" },
  retract: { from: ["active"], to: "retracted" },
  restore: { from: ["retracted", "rejected"], to: "active" },
};

export type ModerationResult =
  | { ok: true; before: RegistryStatus; report: { id: number; userId: string; exchange: string; reason: string; status: RegistryStatus } }
  | { ok: false; code: 404 }
  | { ok: false; code: 409; status: RegistryStatus };

/**
 * One moderation decision. The expected source status is part of the
 * UPDATE's WHERE clause, so two admins (or a double click) can't both apply a
 * decision: the loser gets `{ ok: false, code: 409 }`.
 */
export async function moderateReport(input: {
  id: number;
  action: ModerationAction;
  note: string | null;
  adminId: string;
}): Promise<ModerationResult> {
  const db = await getDb();
  const t = schema.suspiciousTakers;
  const tr = TRANSITIONS[input.action];

  const [existing] = await db
    .select({ id: t.id, status: t.status })
    .from(t)
    .where(eq(t.id, input.id))
    .limit(1);
  if (!existing) return { ok: false, code: 404 };

  const [updated] = await db
    .update(t)
    .set({
      status: tr.to,
      reviewedBy: input.adminId,
      reviewedTs: Math.floor(Date.now() / 1000),
      reviewNote: input.note,
    })
    .where(and(eq(t.id, input.id), inArray(t.status, tr.from)))
    .returning({ id: t.id, userId: t.userId, exchange: t.exchange, reason: t.reason, status: t.status });

  if (!updated) {
    // Re-read: it may have moved since the first select.
    const [now] = await db.select({ status: t.status }).from(t).where(eq(t.id, input.id)).limit(1);
    return { ok: false, code: 409, status: (now?.status ?? existing.status) as RegistryStatus };
  }
  return { ok: true, before: existing.status as RegistryStatus, report: { ...updated, status: updated.status as RegistryStatus } };
}

/* ── Member: my submissions ─────────────────────────────────────────── */

export type MyReport = {
  id: number;
  ts: number;
  userId: string;
  displayName: string | null;
  reason: string;
  status: RegistryStatus;
  reviewedTs: number | null;
  reviewNote: string | null;
};

export async function listMyReports(userId: string, limit = 50): Promise<MyReport[]> {
  const db = await getDb();
  const t = schema.suspiciousTakers;
  const rows = await db
    .select({
      id: t.id,
      ts: t.ts,
      userId: t.userId,
      displayName: t.displayName,
      reason: t.reason,
      status: t.status,
      reviewedTs: t.reviewedTs,
      reviewNote: t.reviewNote,
    })
    .from(t)
    .where(eq(t.submittedBy, userId))
    .orderBy(desc(t.ts), desc(t.id))
    .limit(limit);
  return rows as MyReport[];
}
