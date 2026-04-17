import { and, desc, eq } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { SuspiciousTakerRow } from "./schema";

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
