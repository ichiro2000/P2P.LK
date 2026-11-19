import { and, desc, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { SuspiciousRemovalRequestRow } from "./schema";
import type { ExchangeId } from "@/lib/exchanges";

export type RemovalRequest = SuspiciousRemovalRequestRow;
export type RemovalStatus = "pending" | "approved" | "rejected";

export class RemovalRequestError extends Error {
  constructor(
    message: string,
    public status: 404 | 409,
  ) {
    super(message);
  }
}

export async function createRemovalRequest(input: {
  exchange: ExchangeId;
  userId: string;
  reason: string;
  reporterContact: string | null;
}): Promise<RemovalRequest> {
  const db = await getDb();
  const [inserted] = await db
    .insert(schema.suspiciousRemovalRequests)
    .values({ ...input, ts: Math.floor(Date.now() / 1000), status: "pending" })
    .returning();
  return inserted;
}

export async function listRemovalRequests(opts?: {
  status?: RemovalStatus | "all";
}): Promise<RemovalRequest[]> {
  const db = await getDb();
  const r = schema.suspiciousRemovalRequests;
  const status = opts?.status ?? "pending";
  return db
    .select()
    .from(r)
    .where(status === "all" ? undefined : eq(r.status, status))
    .orderBy(desc(r.ts));
}

export async function hasPendingRemovalRequest(ex: ExchangeId, userId: string): Promise<boolean> {
  const db = await getDb();
  const r = schema.suspiciousRemovalRequests;
  const [row] = await db
    .select({ c: sql<number>`count(*)` })
    .from(r)
    .where(and(eq(r.exchange, ex), eq(r.userId, userId), eq(r.status, "pending")));
  return Number(row?.c ?? 0) > 0;
}

/**
 * Admin decision. The status flip is conditional (`WHERE status='pending'`)
 * and runs in the same D1 batch (transaction) as the retraction, so two
 * admins clicking at once can't both apply a decision.
 */
export async function decideRemovalRequest(input: {
  id: number;
  decision: "approved" | "rejected";
  reviewNote: string | null;
  /** Admin user id — recorded on the reports this approval retracts. */
  reviewedBy: string;
}): Promise<{ request: RemovalRequest; retractedCount: number }> {
  const db = await getDb();
  const r = schema.suspiciousRemovalRequests;
  const t = schema.suspiciousTakers;
  const now = Math.floor(Date.now() / 1000);

  const [existing] = await db.select().from(r).where(eq(r.id, input.id)).limit(1);
  if (!existing) throw new RemovalRequestError(`Removal request ${input.id} not found.`, 404);
  if (existing.status !== "pending") {
    throw new RemovalRequestError(`Removal request ${input.id} is already ${existing.status}.`, 409);
  }

  const update = db
    .update(r)
    .set({ status: input.decision, reviewedTs: now, reviewNote: input.reviewNote })
    .where(and(eq(r.id, input.id), eq(r.status, "pending")))
    .returning();

  if (input.decision === "rejected") {
    const [updated] = await update;
    if (!updated) throw new RemovalRequestError(`Removal request ${input.id} was already decided.`, 409);
    return { request: updated, retractedCount: 0 };
  }

  // Retraction only applies if the status flip in the same transaction did.
  const retract = db
    .update(t)
    .set({
      status: "retracted",
      reviewedBy: input.reviewedBy,
      reviewedTs: now,
      reviewNote: `Removal request #${input.id} approved${input.reviewNote ? `: ${input.reviewNote}` : ""}`.slice(0, 1000),
    })
    .where(
      and(
        eq(t.exchange, existing.exchange),
        eq(t.userId, existing.userId),
        eq(t.status, "active"),
        sql`EXISTS (SELECT 1 FROM suspicious_removal_requests WHERE id = ${input.id} AND status = 'approved' AND reviewed_ts = ${now})`,
      ),
    )
    .returning({ id: t.id });
  const [updatedRows, retracted] = await db.batch([update, retract]);
  const updated = updatedRows[0];
  if (!updated) throw new RemovalRequestError(`Removal request ${input.id} was already decided.`, 409);
  return { request: updated, retractedCount: retracted.length };
}
