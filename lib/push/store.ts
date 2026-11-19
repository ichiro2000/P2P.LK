import "server-only";
import { and, count, eq, lt } from "drizzle-orm";
import { schema, type Db } from "@/lib/db/client";
import { MAX_DEVICES } from "./deliver";
import { deviceLabel, endpointHash, type SubscriptionJson } from "./subscription";

/**
 * D1 side of the member push APIs. Subscriptions belong to the user (not the
 * session) and are keyed by endpoint: subscribing an endpoint that exists
 * re-binds it to the current user.
 */

const p = schema.pushSubscriptions;
const t = schema.pushTombstones;
const TOMBSTONE_KEEP_SEC = 90 * 86400;

export type SubscribeMode =
  /** The member pressed "Enable": always (re)register, clear any tombstone. */
  | "enable"
  /** Background re-sync on app open/focus: re-register, but never bring back
   *  a device the member removed or the push service reported dead. */
  | "sync";

export type SubscribeResult =
  | { status: "created" | "known"; id: string }
  | { status: "removed" | "gone" }
  | { status: "limit" };

export async function subscribe(
  db: Db,
  userId: string,
  sub: SubscriptionJson,
  ua: string | null,
  mode: SubscribeMode,
  now = Math.floor(Date.now() / 1000),
): Promise<SubscribeResult> {
  const hash = await endpointHash(sub.endpoint);
  const [existing] = await db.select().from(p).where(eq(p.endpoint, sub.endpoint)).limit(1);

  if (!existing) {
    if (mode === "sync") {
      const [tomb] = await db.select({ reason: t.reason }).from(t).where(eq(t.endpointHash, hash)).limit(1);
      if (tomb) return { status: tomb.reason };
    }
    const [{ n }] = await db.select({ n: count() }).from(p).where(eq(p.userId, userId));
    if (n >= MAX_DEVICES) return { status: "limit" };
  }

  const keysChanged = existing && (existing.p256dh !== sub.keys.p256dh || existing.auth !== sub.keys.auth);
  const resetFailures = mode === "enable" || keysChanged || (existing && existing.userId !== userId);
  const id = existing?.id ?? crypto.randomUUID();
  const userAgent = ua ? ua.slice(0, 300) : null;

  await db
    .insert(p)
    .values({
      id,
      userId,
      endpoint: sub.endpoint,
      p256dh: sub.keys.p256dh,
      auth: sub.keys.auth,
      userAgent,
      createdAt: now,
      lastSeenAt: now,
      failureCount: 0,
    })
    .onConflictDoUpdate({
      target: p.endpoint,
      set: {
        userId,
        p256dh: sub.keys.p256dh,
        auth: sub.keys.auth,
        userAgent,
        lastSeenAt: now,
        ...(resetFailures ? { failureCount: 0, nextAttemptAt: null } : {}),
      },
    });

  if (mode === "enable") {
    await db.batch([
      db.delete(t).where(eq(t.endpointHash, hash)),
      db.delete(t).where(lt(t.createdAt, now - TOMBSTONE_KEEP_SEC)),
    ]);
  }
  return { status: existing ? "known" : "created", id };
}

/** Remove one of the member's devices (by endpoint or id) and tombstone it. */
export async function unsubscribe(
  db: Db,
  userId: string,
  by: { endpoint?: string; id?: string },
  now = Math.floor(Date.now() / 1000),
): Promise<boolean> {
  const where = by.endpoint
    ? and(eq(p.userId, userId), eq(p.endpoint, by.endpoint))
    : by.id
      ? and(eq(p.userId, userId), eq(p.id, by.id))
      : undefined;
  if (!where) return false;
  const [row] = await db.select({ id: p.id, endpoint: p.endpoint }).from(p).where(where).limit(1);
  // Not ours (or already gone): still tombstone a given endpoint so a stale
  // browser subscription can't re-sync itself back.
  const endpoint = row?.endpoint ?? by.endpoint;
  const stmts = [];
  if (row) stmts.push(db.delete(p).where(eq(p.id, row.id)));
  if (endpoint) {
    const hash = await endpointHash(endpoint);
    stmts.push(
      db
        .insert(t)
        .values({ endpointHash: hash, userId, reason: "removed", createdAt: now })
        .onConflictDoUpdate({ target: t.endpointHash, set: { reason: "removed", userId, createdAt: now } }),
    );
  }
  if (stmts.length) await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
  return !!row;
}

/**
 * The browser replaced a subscription (`pushsubscriptionchange` in the
 * service worker). Moves the old row to the new endpoint, keeping its owner,
 * even when the session cookie has expired: knowing the old endpoint (a
 * secret capability URL) is the proof. Returns false when the old endpoint
 * is unknown.
 */
export async function rotate(
  db: Db,
  oldEndpoint: string,
  sub: SubscriptionJson,
  ua: string | null,
  now = Math.floor(Date.now() / 1000),
): Promise<{ userId: string } | null> {
  const [old] = await db.select().from(p).where(eq(p.endpoint, oldEndpoint)).limit(1);
  if (!old) return null;
  if (oldEndpoint === sub.endpoint) {
    await db
      .update(p)
      .set({ p256dh: sub.keys.p256dh, auth: sub.keys.auth, lastSeenAt: now, failureCount: 0, nextAttemptAt: null })
      .where(eq(p.id, old.id));
    return { userId: old.userId };
  }
  const [clash] = await db.select({ id: p.id }).from(p).where(eq(p.endpoint, sub.endpoint)).limit(1);
  await db.batch([
    clash
      ? db.delete(p).where(eq(p.id, old.id))
      : db
          .update(p)
          .set({
            endpoint: sub.endpoint,
            p256dh: sub.keys.p256dh,
            auth: sub.keys.auth,
            userAgent: ua ? ua.slice(0, 300) : old.userAgent,
            lastSeenAt: now,
            failureCount: 0,
            nextAttemptAt: null,
            lastError: null,
          })
          .where(eq(p.id, old.id)),
    ...(clash
      ? [db.update(p).set({ userId: old.userId, lastSeenAt: now }).where(eq(p.id, clash.id))]
      : []),
  ]);
  return { userId: old.userId };
}

export type DeviceView = {
  id: string;
  label: string;
  createdAt: number;
  lastSeenAt: number;
  lastSuccessAt: number | null;
  failureCount: number;
  lastError: string | null;
  lastErrorAt: number | null;
};

export async function listDevices(db: Db, userId: string): Promise<DeviceView[]> {
  const rows = await db.select().from(p).where(eq(p.userId, userId)).orderBy(p.createdAt);
  return rows.map((r) => ({
    id: r.id,
    label: deviceLabel(r.userAgent),
    createdAt: r.createdAt,
    lastSeenAt: r.lastSeenAt,
    lastSuccessAt: r.lastSuccessAt,
    failureCount: r.failureCount,
    // Only the status part: push-service bodies can be long and are not useful to members.
    lastError: r.lastError ? r.lastError.split(":")[0].slice(0, 60) : null,
    lastErrorAt: r.lastErrorAt,
  }));
}
