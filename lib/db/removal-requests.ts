import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { SuspiciousRemovalRequestRow } from "./schema";

export type RemovalRequest = SuspiciousRemovalRequestRow;
export type RemovalStatus = "pending" | "approved" | "rejected";

/**
 * A public request to un-flag a taker. No admin token required — the gate is
 * the admin review step downstream. `reporterContact` is optional (email /
 * handle) so the admin can get back to the requester for clarifications.
 */
export async function createRemovalRequest(input: {
  binanceUserId: string;
  reason: string;
  reporterContact: string | null;
}): Promise<RemovalRequest> {
  const db = await getDb();
  const row = {
    ts: Math.floor(Date.now() / 1000),
    binanceUserId: input.binanceUserId,
    reason: input.reason,
    reporterContact: input.reporterContact,
    status: "pending" as const,
    reviewedTs: null,
    reviewNote: null,
  };
  const [inserted] = await db
    .insert(schema.suspiciousRemovalRequests)
    .values(row)
    .returning();
  return inserted;
}

export async function listRemovalRequests(opts?: {
  status?: RemovalStatus | "all";
}): Promise<RemovalRequest[]> {
  const db = await getDb();
  const status = opts?.status ?? "pending";
  const q = db
    .select()
    .from(schema.suspiciousRemovalRequests)
    .orderBy(desc(schema.suspiciousRemovalRequests.ts));
  if (status === "all") return q;
  return q.where(eq(schema.suspiciousRemovalRequests.status, status));
}

export async function getRemovalRequest(
  id: number,
): Promise<RemovalRequest | null> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.suspiciousRemovalRequests)
    .where(eq(schema.suspiciousRemovalRequests.id, id))
    .limit(1);
  return rows[0] ?? null;
}

/** Is there already a pending request for this taker? Used to stop duplicate
 *  submissions from the public form. */
export async function hasPendingRemovalRequest(
  binanceUserId: string,
): Promise<boolean> {
  const db = await getDb();
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.suspiciousRemovalRequests)
    .where(
      and(
        eq(schema.suspiciousRemovalRequests.binanceUserId, binanceUserId),
        eq(schema.suspiciousRemovalRequests.status, "pending"),
      ),
    );
  return Number(row?.c ?? 0) > 0;
}

/**
 * Admin decision. On `approved` we also flip every active report for that
 * taker to `status = 'retracted'`, which hides them from `listSuspicious` and
 * `reportsForUser` in one shot. We keep the retracted rows — an audit trail —
 * and record how many we touched so the admin UI can confirm the effect.
 */
export async function decideRemovalRequest(input: {
  id: number;
  decision: "approved" | "rejected";
  reviewNote: string | null;
}): Promise<{ request: RemovalRequest; retractedCount: number }> {
  const db = await getDb();
  const now = Math.floor(Date.now() / 1000);

  const existing = await getRemovalRequest(input.id);
  if (!existing) {
    throw new Error(`Removal request ${input.id} not found.`);
  }
  if (existing.status !== "pending") {
    throw new Error(
      `Removal request ${input.id} is already ${existing.status}.`,
    );
  }

  const [updated] = await db
    .update(schema.suspiciousRemovalRequests)
    .set({
      status: input.decision,
      reviewedTs: now,
      reviewNote: input.reviewNote,
    })
    .where(eq(schema.suspiciousRemovalRequests.id, input.id))
    .returning();

  let retractedCount = 0;
  if (input.decision === "approved") {
    const retracted = await db
      .update(schema.suspiciousTakers)
      .set({ status: "retracted" })
      .where(
        and(
          eq(schema.suspiciousTakers.binanceUserId, existing.binanceUserId),
          eq(schema.suspiciousTakers.status, "active"),
        ),
      )
      .returning({ id: schema.suspiciousTakers.id });
    retractedCount = retracted.length;
  }

  return { request: updated, retractedCount };
}
