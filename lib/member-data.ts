import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import type { AlertEventRow, AlertRuleRow, AlertType, UserItemKind } from "@/lib/db/schema";
import type { ExchangeId } from "@/lib/exchanges";

/**
 * Server-side member data (D1). The single source of truth for signed-in,
 * approved members; guests keep using lib/storage.ts (localStorage).
 *
 * Items (user_items):
 *   market            itemKey "USDT/LKR"                 data { asset, fiat }
 *   merchant          itemKey "<exchange>:<merchantId>"  data { exchange, id, name }
 *   blocked_merchant  itemKey "<exchange>:<merchantId>"  data { exchange, id, name, reason? }
 *   filter            itemKey "<uuid>"                   data { label, path, search }
 *
 * Limits keep one account from filling the DB.
 */

export const LIMITS = {
  items: { market: 50, merchant: 300, blocked_merchant: 500, filter: 50 } satisfies Record<UserItemKind, number>,
  rules: 50,
  eventsKept: 500,
} as const;

const now = () => Math.floor(Date.now() / 1000);

/* ── Items ───────────────────────────────────────────────────────────── */

export type MemberItem = {
  kind: UserItemKind;
  itemKey: string;
  data: Record<string, unknown>;
  createdAt: number;
};

export async function listItems(userId: string, kind?: UserItemKind): Promise<MemberItem[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.userItems)
    .where(kind ? and(eq(schema.userItems.userId, userId), eq(schema.userItems.kind, kind)) : eq(schema.userItems.userId, userId))
    .orderBy(desc(schema.userItems.createdAt));
  return rows.map((r) => ({ kind: r.kind, itemKey: r.itemKey, data: r.data, createdAt: r.createdAt }));
}

export class LimitError extends Error {}

/** Insert or replace one item. Throws LimitError when the kind is full. */
export async function upsertItem(userId: string, kind: UserItemKind, itemKey: string, data: Record<string, unknown>) {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.userItems)
    .where(and(eq(schema.userItems.userId, userId), eq(schema.userItems.kind, kind)));
  const exists = await db.query.userItems.findFirst({
    where: and(eq(schema.userItems.userId, userId), eq(schema.userItems.kind, kind), eq(schema.userItems.itemKey, itemKey)),
    columns: { itemKey: true },
  });
  if (!exists && n >= LIMITS.items[kind]) throw new LimitError(`You can save up to ${LIMITS.items[kind]} of these.`);
  await db
    .insert(schema.userItems)
    .values({ userId, kind, itemKey, data, createdAt: now() })
    .onConflictDoUpdate({
      target: [schema.userItems.userId, schema.userItems.kind, schema.userItems.itemKey],
      set: { data },
    });
}

export async function deleteItem(userId: string, kind: UserItemKind, itemKey: string) {
  const db = await getDb();
  await db
    .delete(schema.userItems)
    .where(and(eq(schema.userItems.userId, userId), eq(schema.userItems.kind, kind), eq(schema.userItems.itemKey, itemKey)));
}

/* ── Alert rules ─────────────────────────────────────────────────────── */

export type RuleInput = {
  exchange: ExchangeId;
  type: AlertType;
  asset: string;
  fiat: string;
  threshold: number;
  label?: string | null;
  enabled?: boolean;
  email?: boolean;
  cooldownSec?: number;
};

export async function listRules(userId: string): Promise<AlertRuleRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.alertRules)
    .where(eq(schema.alertRules.userId, userId))
    .orderBy(desc(schema.alertRules.createdAt));
}

export async function createRule(userId: string, input: RuleInput): Promise<AlertRuleRow> {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.alertRules)
    .where(eq(schema.alertRules.userId, userId));
  if (n >= LIMITS.rules) throw new LimitError(`You can have up to ${LIMITS.rules} alert rules.`);
  const row = {
    id: crypto.randomUUID(),
    userId,
    exchange: input.exchange,
    type: input.type,
    asset: input.asset,
    fiat: input.fiat,
    threshold: input.threshold,
    label: input.label ?? null,
    enabled: input.enabled ?? true,
    email: input.email ?? true,
    cooldownSec: input.cooldownSec ?? 1800,
    lastFiredAt: null,
    createdAt: now(),
  };
  await db.insert(schema.alertRules).values(row);
  return row;
}

export async function updateRule(userId: string, id: string, patch: Partial<RuleInput>) {
  const db = await getDb();
  await db
    .update(schema.alertRules)
    .set(patch)
    .where(and(eq(schema.alertRules.userId, userId), eq(schema.alertRules.id, id)));
}

export async function deleteRule(userId: string, id: string) {
  const db = await getDb();
  await db.delete(schema.alertRules).where(and(eq(schema.alertRules.userId, userId), eq(schema.alertRules.id, id)));
}

/* ── Alert events (inbox) ────────────────────────────────────────────── */

export async function listEvents(userId: string, limit = 100): Promise<AlertEventRow[]> {
  const db = await getDb();
  return db
    .select()
    .from(schema.alertEvents)
    .where(eq(schema.alertEvents.userId, userId))
    .orderBy(desc(schema.alertEvents.ts))
    .limit(Math.min(limit, LIMITS.eventsKept));
}

export async function unreadCount(userId: string): Promise<number> {
  const db = await getDb();
  const [{ n }] = await db
    .select({ n: sql<number>`count(*)` })
    .from(schema.alertEvents)
    .where(and(eq(schema.alertEvents.userId, userId), eq(schema.alertEvents.read, false)));
  return n;
}

export async function markEventsRead(userId: string, ids?: string[]) {
  const db = await getDb();
  if (!ids?.length) {
    await db.update(schema.alertEvents).set({ read: true }).where(eq(schema.alertEvents.userId, userId));
    return;
  }
  // D1 allows 100 bound parameters per statement (the API accepts 500 ids).
  for (let i = 0; i < ids.length; i += 90) {
    await db
      .update(schema.alertEvents)
      .set({ read: true })
      .where(and(eq(schema.alertEvents.userId, userId), inArray(schema.alertEvents.id, ids.slice(i, i + 90))));
  }
}

export async function clearEvents(userId: string) {
  const db = await getDb();
  await db.delete(schema.alertEvents).where(eq(schema.alertEvents.userId, userId));
}

/* ── Audit ───────────────────────────────────────────────────────────── */

export async function audit(row: {
  actorId: string | null;
  actorEmail?: string | null;
  action: string;
  targetType?: string;
  targetId?: string;
  detail?: Record<string, unknown>;
}) {
  const db = await getDb();
  await db.insert(schema.auditLog).values({ ts: now(), ...row });
}
