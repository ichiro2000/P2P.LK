import "server-only";
import { and, asc, desc, eq, gt, gte, lt, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { getDb, schema } from "./client";

/**
 * Audit log viewer queries. Keyset paging on `id` (monotonic with time):
 *   `before=<id>` → the next older page, `after=<id>` → the next newer page.
 * Filters come from the URL and are shared by the page and the CSV export.
 */

export const AUDIT_PAGE_SIZE = 50;
export const AUDIT_EXPORT_CAP = 5000;

export const ACTION_PREFIXES = ["member.", "registry.", "system.", "user."] as const;
export type ActionPrefix = (typeof ACTION_PREFIXES)[number];

const ymd = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/)
  .refine((s) => !Number.isNaN(Date.parse(`${s}T00:00:00Z`)));
const opt = <T extends z.ZodType>(s: T) =>
  z.preprocess((v) => (Array.isArray(v) ? v[0] : v === "" ? undefined : v), s.optional().catch(undefined));
const cursor = opt(z.coerce.number().int().positive().max(Number.MAX_SAFE_INTEGER));

export const AuditQuery = z.object({
  action: opt(z.enum(ACTION_PREFIXES)),
  actor: opt(z.string().trim().min(1).max(200)),
  targetType: opt(z.string().trim().regex(/^[a-z_]{1,40}$/)),
  targetId: opt(z.string().trim().min(1).max(200)),
  from: opt(ymd),
  to: opt(ymd),
  before: cursor,
  after: cursor,
});
export type AuditQuery = z.infer<typeof AuditQuery>;

/** Parse filters from a plain record (page searchParams or URLSearchParams). */
export function parseAuditQuery(raw: Record<string, string | string[] | undefined>): AuditQuery {
  const r = AuditQuery.safeParse(raw);
  return r.success ? r.data : {};
}

/** The filter part of a query as URL params (no cursor). */
export function auditFilterParams(q: AuditQuery): URLSearchParams {
  const p = new URLSearchParams();
  for (const k of ["action", "actor", "targetType", "targetId", "from", "to"] as const) {
    const v = q[k];
    if (v) p.set(k, String(v));
  }
  return p;
}

/** SLT is UTC+05:30 with no DST. Midnight SLT → unix seconds. */
const SLT_OFFSET_SEC = 5.5 * 3600;
const sltMidnight = (d: string) => Math.floor(Date.parse(`${d}T00:00:00Z`) / 1000) - SLT_OFFSET_SEC;

const likeEsc = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

function where(q: AuditQuery): SQL | undefined {
  const a = schema.auditLog;
  const parts: (SQL | undefined)[] = [];
  if (q.action) parts.push(sql`${a.action} LIKE ${`${likeEsc(q.action)}%`} ESCAPE '\\'`);
  if (q.actor) parts.push(sql`lower(coalesce(${a.actorEmail}, '')) LIKE ${`%${likeEsc(q.actor.toLowerCase())}%`} ESCAPE '\\'`);
  if (q.targetType) parts.push(eq(a.targetType, q.targetType));
  if (q.targetId) parts.push(eq(a.targetId, q.targetId));
  if (q.from) parts.push(gte(a.ts, sltMidnight(q.from)));
  if (q.to) parts.push(lt(a.ts, sltMidnight(q.to) + 86_400));
  return and(...parts);
}

export type AuditEntry = {
  id: number;
  ts: number;
  actorId: string | null;
  actorEmail: string | null;
  action: string;
  targetType: string | null;
  targetId: string | null;
  detail: Record<string, unknown> | null;
};

const COLS = {
  id: schema.auditLog.id,
  ts: schema.auditLog.ts,
  actorId: schema.auditLog.actorId,
  actorEmail: schema.auditLog.actorEmail,
  action: schema.auditLog.action,
  targetType: schema.auditLog.targetType,
  targetId: schema.auditLog.targetId,
  detail: schema.auditLog.detail,
};

/**
 * One page, newest first. Returns cursors for the neighbouring pages
 * (`olderBefore` / `newerAfter`), null when there's nothing that way.
 */
export async function listAudit(q: AuditQuery): Promise<{
  rows: AuditEntry[];
  olderBefore: number | null;
  newerAfter: number | null;
}> {
  const db = await getDb();
  const a = schema.auditLog;
  const base = where(q);
  const size = AUDIT_PAGE_SIZE;

  let rows: AuditEntry[];
  if (q.after && !q.before) {
    // Going newer: take the next `size + 1` ids above the cursor, then flip.
    const asc_ = (await db
      .select(COLS)
      .from(a)
      .where(and(base, gt(a.id, q.after)))
      .orderBy(asc(a.id))
      .limit(size + 1)) as AuditEntry[];
    const hasNewer = asc_.length > size;
    rows = asc_.slice(0, size).reverse();
    return {
      rows,
      newerAfter: hasNewer && rows.length ? rows[0].id : null,
      olderBefore: rows.length ? rows[rows.length - 1].id : null,
    };
  }

  const desc_ = (await db
    .select(COLS)
    .from(a)
    .where(and(base, q.before ? lt(a.id, q.before) : undefined))
    .orderBy(desc(a.id))
    .limit(size + 1)) as AuditEntry[];
  const hasOlder = desc_.length > size;
  rows = desc_.slice(0, size);
  return {
    rows,
    olderBefore: hasOlder && rows.length ? rows[rows.length - 1].id : null,
    // With a `before` cursor there is always something newer.
    newerAfter: q.before && rows.length ? rows[0].id : null,
  };
}

/** Distinct target types (for the filter select). */
export async function auditTargetTypes(): Promise<string[]> {
  const db = await getDb();
  const a = schema.auditLog;
  const rows = await db
    .selectDistinct({ t: a.targetType })
    .from(a)
    .where(sql`${a.targetType} IS NOT NULL`)
    .orderBy(asc(a.targetType));
  return rows.map((r) => r.t!).filter(Boolean);
}

/** Up to AUDIT_EXPORT_CAP rows of the current filter, newest first. */
export async function exportAudit(q: AuditQuery): Promise<AuditEntry[]> {
  const db = await getDb();
  const a = schema.auditLog;
  return (await db
    .select(COLS)
    .from(a)
    .where(where(q))
    .orderBy(desc(a.id))
    .limit(AUDIT_EXPORT_CAP)) as AuditEntry[];
}
