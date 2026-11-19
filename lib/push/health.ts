import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { vapidProblem } from "./send";
import { pushEnv } from "./server";

/**
 * Push health for /admin/system. Sends are logged to ingest_runs (job
 * "push"): `rows` = devices delivered, `error` starts with the number of
 * failed devices ("3 failed: …"), so 24 h totals are two SUMs.
 */
export type PushHealth = {
  vapid: { configured: boolean; problem: string | null; publicKeyTail: string | null };
  subscriptions: number;
  members: number;
  failing: number;
  staleDevices: number;
  sent24h: number;
  failed24h: number;
  runs24h: number;
  lastError: { ts: number; message: string } | null;
  lastSuccessTs: number | null;
};

/** Devices not opened for this long are listed as possibly stale (they still get pushes). */
export const STALE_DEVICE_SEC = 30 * 86400;

export async function loadPushHealth(now = Math.floor(Date.now() / 1000)): Promise<PushHealth> {
  const [env, db] = await Promise.all([pushEnv(), getDb()]);
  const problem = vapidProblem(env);
  const pub = (env.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "").trim();

  const [subs] = await db.all<{ n: number; members: number; failing: number; stale: number }>(sql`
    SELECT count(*) AS n, count(DISTINCT user_id) AS members,
           coalesce(sum(failure_count > 0), 0) AS failing,
           coalesce(sum(last_seen_at < ${now - STALE_DEVICE_SEC}), 0) AS stale
    FROM push_subscriptions`);
  const [runs] = await db.all<{ runs: number; sent: number; failed: number; last_ok: number | null }>(sql`
    SELECT count(*) AS runs, coalesce(sum(rows), 0) AS sent,
           coalesce(sum(CASE WHEN ok = 0 THEN CAST(error AS INTEGER) ELSE 0 END), 0) AS failed,
           (SELECT max(ts) FROM ingest_runs WHERE job = 'push' AND rows > 0) AS last_ok
    FROM ingest_runs WHERE job = 'push' AND ts >= ${now - 86400}`);
  const [last] = await db.all<{ ts: number; error: string }>(sql`
    SELECT ts, error FROM ingest_runs WHERE job = 'push' AND ok = 0 ORDER BY ts DESC, id DESC LIMIT 1`);

  return {
    vapid: { configured: !problem, problem, publicKeyTail: pub ? `…${pub.slice(-8)}` : null },
    subscriptions: Number(subs?.n ?? 0),
    members: Number(subs?.members ?? 0),
    failing: Number(subs?.failing ?? 0),
    staleDevices: Number(subs?.stale ?? 0),
    sent24h: Number(runs?.sent ?? 0),
    failed24h: Number(runs?.failed ?? 0),
    runs24h: Number(runs?.runs ?? 0),
    lastError: last ? { ts: Number(last.ts), message: last.error } : null,
    lastSuccessTs: runs?.last_ok != null ? Number(runs.last_ok) : null,
  };
}
