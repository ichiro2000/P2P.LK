import "server-only";
import { and, desc, eq, or, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import type { UserRole, UserStatus } from "@/lib/db/schema";

/** Queue tabs, in display order. "unverified" = pending_email. */
export const MEMBER_TABS = [
  { key: "pending_review", label: "Pending review" },
  { key: "approved", label: "Approved" },
  { key: "rejected", label: "Rejected" },
  { key: "suspended", label: "Suspended" },
  { key: "pending_email", label: "Unverified" },
] as const satisfies readonly { key: UserStatus; label: string }[];

export type MemberTab = (typeof MEMBER_TABS)[number]["key"];

export const LIST_LIMIT = 100;

export type MemberRow = {
  id: string;
  name: string;
  merchantName: string;
  email: string;
  whatsapp: string;
  binanceUrl: string | null;
  bybitUrl: string | null;
  role: UserRole;
  status: UserStatus;
  reviewNote: string | null;
  reviewedAt: number | null;
  createdAt: number;
};

export type AuditRow = {
  id: number;
  ts: number;
  actorEmail: string | null;
  action: string;
  targetId: string | null;
  detail: Record<string, unknown> | null;
};

function searchFilter(q: string): SQL | undefined {
  const term = q.trim().toLowerCase().slice(0, 100);
  if (!term) return undefined;
  const like = `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const u = schema.user;
  return or(
    sql`lower(${u.name}) LIKE ${like} ESCAPE '\\'`,
    sql`lower(${u.merchantName}) LIKE ${like} ESCAPE '\\'`,
    sql`lower(${u.email}) LIKE ${like} ESCAPE '\\'`,
  );
}

/** Counts per tab (respecting the search), the current tab's members, the
 *  number of active admins, and the last 20 admin actions — 4 queries. */
export async function loadMembers(tab: MemberTab, q: string) {
  const db = await getDb();
  const u = schema.user;
  const search = searchFilter(q);

  const [countRows, rows, [{ admins }], audit] = await Promise.all([
    db
      .select({ status: u.status, n: sql<number>`count(*)` })
      .from(u)
      .where(search)
      .groupBy(u.status),
    db
      .select({
        id: u.id,
        name: u.name,
        merchantName: u.merchantName,
        email: u.email,
        whatsapp: u.whatsapp,
        binanceUrl: u.binanceUrl,
        bybitUrl: u.bybitUrl,
        role: u.role,
        status: u.status,
        reviewNote: u.reviewNote,
        reviewedAt: u.reviewedAt,
        createdAt: u.createdAt,
      })
      .from(u)
      .where(and(eq(u.status, tab), search))
      .orderBy(tab === "pending_review" ? u.createdAt : desc(u.createdAt))
      .limit(LIST_LIMIT),
    db
      .select({ admins: sql<number>`count(*)` })
      .from(u)
      .where(and(eq(u.role, "admin"), eq(u.status, "approved"))),
    db
      .select({
        id: schema.auditLog.id,
        ts: schema.auditLog.ts,
        actorEmail: schema.auditLog.actorEmail,
        action: schema.auditLog.action,
        targetId: schema.auditLog.targetId,
        detail: schema.auditLog.detail,
      })
      .from(schema.auditLog)
      // Self-service events (user.sign_up, …) aren't admin actions.
      .where(sql`${schema.auditLog.action} NOT LIKE 'user.%'`)
      .orderBy(desc(schema.auditLog.ts), desc(schema.auditLog.id))
      .limit(20),
  ]);

  const counts = Object.fromEntries(MEMBER_TABS.map((t) => [t.key, 0])) as Record<MemberTab, number>;
  for (const c of countRows) if (c.status in counts) counts[c.status as MemberTab] = c.n;

  const members: MemberRow[] = rows.map((r) => ({
    ...r,
    reviewedAt: r.reviewedAt ? r.reviewedAt.getTime() : null,
    createdAt: r.createdAt.getTime(),
  }));

  return { counts, members, admins, audit: audit as AuditRow[] };
}
