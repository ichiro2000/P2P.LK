import { and, eq } from "drizzle-orm";
import { schema, type Db } from "@/lib/db/client";
import type { PushSubscriptionRow } from "@/lib/db/schema";
import { endpointHash } from "./subscription";
import {
  sendPush,
  vapidProblem,
  type Fetcher,
  type PushEnv,
  type PushOptions,
  type PushPayload,
  type PushResult,
} from "./send";

/**
 * Sending to a member's devices, and what each push-service answer does to
 * the stored subscription. No "server-only" marker: lib/alerts/evaluate.ts
 * (cron) calls deliverAlertPushes().
 *
 * Reliability rules (DEPLOY.md → Push notifications):
 *   - delete ONLY on 404/410 (+ tombstone "gone");
 *   - 429/5xx/network → keep, count, back off (1, 2, 4 … 60 min, or the
 *     push service's Retry-After, capped at 1 h) and retry on the next alert;
 *   - 413 → retry once with a minimal payload, keep;
 *   - 401/403 → VAPID problem: keep, log loudly to ingest_runs (job "push");
 *   - every push carries a visible notification (the service worker always
 *     calls showNotification), urgency high, TTL 1 h, Topic "alerts".
 */

export type AlertPushItem = { label: string; detail: string };

/** Alerts older than this are not worth showing: the push service drops them. */
export const ALERT_TTL_SEC = 3600;
export const ALERT_TOPIC = "alerts";
const MAX_BACKOFF_SEC = 3600;
const BASE_BACKOFF_SEC = 60;
/** Per-user device cap (subscribe API enforces it). */
export const MAX_DEVICES = 10;

const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

export function alertPayload(items: AlertPushItem[]): PushPayload {
  const n = items.length;
  if (n === 1) {
    return { title: clip(items[0].label, 80), body: clip(items[0].detail, 300), url: "/alerts", tag: ALERT_TOPIC };
  }
  const lines = items.slice(0, 3).map((i) => `• ${clip(i.label, 70)}`);
  if (n > 3) lines.push(`+${n - 3} more`);
  return { title: `${n} P2P.LK alerts`, body: lines.join("\n"), url: "/alerts", tag: ALERT_TOPIC };
}

/** The tiny fallback after a 413 (never expected: our payloads are ~300 B). */
export function minimalPayload(p: PushPayload): PushPayload {
  return { title: "P2P.LK", body: "You have a new alert.", url: p.url, tag: p.tag };
}

export function backoffSec(failureCount: number, retryAfterSec?: number): number {
  const exp = BASE_BACKOFF_SEC * 2 ** Math.max(0, Math.min(failureCount - 1, 10));
  return Math.min(MAX_BACKOFF_SEC, Math.max(exp, retryAfterSec ?? 0));
}

/** Devices in backoff are skipped by alert sends (test sends ignore it). */
export function isDue(row: Pick<PushSubscriptionRow, "nextAttemptAt">, now: number): boolean {
  return row.nextAttemptAt == null || row.nextAttemptAt <= now;
}

export type RowChange =
  | { kind: "delete" }
  | {
      kind: "update";
      set: Partial<
        Pick<PushSubscriptionRow, "lastSuccessAt" | "failureCount" | "lastError" | "lastErrorAt" | "nextAttemptAt">
      >;
    };

/** What a push result does to the stored row. Pure; unit-tested. */
export function changeFor(row: Pick<PushSubscriptionRow, "failureCount">, r: PushResult, now: number): RowChange {
  switch (r.action) {
    case "ok":
      return { kind: "update", set: { lastSuccessAt: now, failureCount: 0, nextAttemptAt: null } };
    case "gone":
      return { kind: "delete" };
    case "retry": {
      const failureCount = row.failureCount + 1;
      return {
        kind: "update",
        set: {
          failureCount,
          lastError: r.error ?? `HTTP ${r.status}`,
          lastErrorAt: now,
          nextAttemptAt: now + backoffSec(failureCount, r.retryAfterSec),
        },
      };
    }
    case "auth":
      // A VAPID problem is the server's fault and affects every device:
      // record it, but no per-device backoff, so the next alert after the
      // fix goes out at once.
      return {
        kind: "update",
        set: { failureCount: row.failureCount + 1, lastError: r.error ?? `HTTP ${r.status}`, lastErrorAt: now },
      };
    case "too_large":
    case "rejected": {
      const failureCount = row.failureCount + 1;
      return {
        kind: "update",
        set: {
          failureCount,
          lastError: r.error ?? `HTTP ${r.status}`,
          lastErrorAt: now,
          nextAttemptAt: now + backoffSec(failureCount),
        },
      };
    }
  }
}

export type DeviceOutcome = { id: string; action: PushResult["action"]; status: number; error?: string };

export type DeliverDeps = { fetch?: Fetcher; now?: number };

/** Short "2 failed: 410 ×1, 429 ×1" summary; the leading number is read by
 *  the admin push-health query (CAST(error AS INTEGER)). */
export function failureSummary(outcomes: DeviceOutcome[]): string | null {
  const failed = outcomes.filter((o) => o.action !== "ok");
  if (failed.length === 0) return null;
  const by = new Map<string, number>();
  for (const o of failed) {
    const k = o.status ? `${o.status}` : o.action === "auth" ? "vapid" : "network";
    by.set(k, (by.get(k) ?? 0) + 1);
  }
  const parts = [...by].map(([k, n]) => `${k} ×${n}`).join(", ");
  const auth = failed.find((o) => o.action === "auth");
  const gone = failed.filter((o) => o.action === "gone").length;
  return [
    `${failed.length} failed: ${parts}`,
    gone ? `${gone} expired device${gone === 1 ? "" : "s"} removed` : "",
    auth ? `VAPID REJECTED — check VAPID_* secrets (${auth.error ?? auth.status})` : "",
  ]
    .filter(Boolean)
    .join(" · ")
    .slice(0, 500);
}

/** Send one payload to the given rows, apply each result to D1, and log one
 *  `ingest_runs` row (job "push"). Never throws. */
export async function sendToRows(
  env: PushEnv | null | undefined,
  db: Db,
  rows: PushSubscriptionRow[],
  payload: PushPayload,
  opts: PushOptions,
  deps: DeliverDeps = {},
): Promise<DeviceOutcome[]> {
  if (rows.length === 0) return [];
  const now = deps.now ?? Math.floor(Date.now() / 1000);
  const started = Date.now();
  const problem = vapidProblem(env);
  if (problem) {
    console.error(`[push] not sent to ${rows.length} device(s): ${problem}`);
    await logRun(db, now, 0, false, `${rows.length} failed: vapid ×${rows.length} · VAPID NOT CONFIGURED — ${problem}`, 0);
    return rows.map((r) => ({ id: r.id, action: "auth", status: 0, error: problem }));
  }

  const outcomes = await Promise.all(
    rows.map(async (row): Promise<{ row: PushSubscriptionRow; result: PushResult }> => {
      const sub = { endpoint: row.endpoint, p256dh: row.p256dh, auth: row.auth };
      try {
        let result = await sendPush(sub, payload, env, opts, { fetch: deps.fetch, nowSec: now });
        if (result.action === "too_large") {
          result = await sendPush(sub, minimalPayload(payload), env, opts, { fetch: deps.fetch, nowSec: now });
        }
        return { row, result };
      } catch (err) {
        return { row, result: { action: "retry", status: 0, error: `send: ${(err as Error).message}` } };
      }
    }),
  );

  try {
    const statements = [];
    for (const { row, result } of outcomes) {
      const change = changeFor(row, result, now);
      // Matched on the endpoint too: if the browser rotated the subscription
      // while this send was in flight, the new endpoint is left alone.
      const where = and(eq(schema.pushSubscriptions.id, row.id), eq(schema.pushSubscriptions.endpoint, row.endpoint));
      if (change.kind === "delete") {
        statements.push(db.delete(schema.pushSubscriptions).where(where));
        statements.push(
          db
            .insert(schema.pushTombstones)
            .values({ endpointHash: await endpointHash(row.endpoint), userId: row.userId, reason: "gone", createdAt: now })
            .onConflictDoUpdate({
              target: schema.pushTombstones.endpointHash,
              set: { reason: "gone", createdAt: now },
            }),
        );
      } else {
        statements.push(db.update(schema.pushSubscriptions).set(change.set).where(where));
      }
    }
    if (statements.length) await db.batch(statements as [(typeof statements)[number], ...typeof statements]);
  } catch (err) {
    console.error(`[push] couldn't record results: ${(err as Error).message}`);
  }

  const result: DeviceOutcome[] = outcomes.map(({ row, result: r }) => ({
    id: row.id,
    action: r.action,
    status: r.status,
    error: r.error,
  }));
  const summary = failureSummary(result);
  if (result.some((o) => o.action === "auth")) console.error(`[push] ${summary}`);
  else if (summary) console.warn(`[push] ${summary}`);
  await logRun(db, now, result.filter((o) => o.action === "ok").length, !summary, summary, Date.now() - started);
  return result;
}

async function logRun(db: Db, ts: number, rows: number, ok: boolean, error: string | null, durationMs: number) {
  await db
    .insert(schema.ingestRuns)
    .values({ job: "push", exchange: null, ts, durationMs, ok, rows, error })
    .catch((err) => console.warn(`[push] couldn't log run: ${(err as Error).message}`));
}

/**
 * Push fired alerts to every device of one member. Called by the alert
 * engine after the events are stored. Never throws; a push problem must
 * never break the cron tick or the email.
 */
export async function deliverAlertPushes(
  env: PushEnv | null | undefined,
  db: Db,
  userId: string,
  items: AlertPushItem[],
  deps: DeliverDeps = {},
): Promise<DeviceOutcome[]> {
  if (items.length === 0) return [];
  try {
    const now = deps.now ?? Math.floor(Date.now() / 1000);
    const rows = await db.select().from(schema.pushSubscriptions).where(eq(schema.pushSubscriptions.userId, userId));
    const due = rows.filter((r) => isDue(r, now));
    return await sendToRows(env, db, due, alertPayload(items), { ttl: ALERT_TTL_SEC, urgency: "high", topic: ALERT_TOPIC }, { ...deps, now });
  } catch (err) {
    console.error(`[push] alert push for user ${userId} failed: ${(err as Error).message}`);
    return [];
  }
}

/** "Send test notification": all of the member's devices (or one), ignoring backoff. */
export async function sendTestPush(
  env: PushEnv | null | undefined,
  db: Db,
  userId: string,
  deviceId?: string,
  deps: DeliverDeps = {},
): Promise<DeviceOutcome[]> {
  const p = schema.pushSubscriptions;
  const rows = await db
    .select()
    .from(p)
    .where(deviceId ? and(eq(p.userId, userId), eq(p.id, deviceId)) : eq(p.userId, userId));
  return sendToRows(
    env,
    db,
    rows,
    {
      title: "P2P.LK test notification",
      body: "Notifications work on this device. Your alerts will arrive like this.",
      url: "/alerts",
      tag: "test",
    },
    { ttl: 300, urgency: "high", topic: "test" },
    deps,
  );
}
