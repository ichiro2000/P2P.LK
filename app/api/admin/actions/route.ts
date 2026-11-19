import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { dbFromBinding, getEnv, schema } from "@/lib/db/client";
import { adminFromRequest } from "@/lib/auth/session";
import { jsonError, readJson, requireAdmin } from "@/lib/guard";
import { audit } from "@/lib/member-data";
import { collectFx } from "@/lib/fx/collect";
import { retentionTick } from "@/lib/ingest/jobs";

/**
 * POST /api/admin/actions { action: "collect_fx" | "retention" }
 *
 * Runs one maintenance job now, on the request, and returns its result.
 * A short KV lock (also the cooldown) stops double runs: a second request for
 * the same action while the lock is held gets 409. The lock is not released
 * early — it doubles as a cooldown so a double click can't hit the bank
 * sites (or the delete queries) twice. Every run is audited.
 */

const NO_STORE = { "Cache-Control": "no-store" };

const ACTIONS = {
  collect_fx: { lockSec: 120, audit: "system.collect_fx" },
  retention: { lockSec: 60, audit: "system.retention" },
} as const;
type Action = keyof typeof ACTIONS;

const Body = z.object({ action: z.enum(Object.keys(ACTIONS) as [Action, ...Action[]]) }).strict();

const lockKey = (a: Action) => `lock:admin-action:${a}`;
/** Same-isolate guard: KV is eventually consistent, memory is not. */
const running = new Map<Action, number>();

export async function POST(req: NextRequest) {
  const denied = await requireAdmin(req);
  if (denied) return denied;
  const admin = await adminFromRequest(req);
  if (!admin) return jsonError(403, "Admins only — sign in with an admin account.");

  const body = await readJson(req, Body);
  if (!body.ok) return body.res;
  const action = body.data.action;
  const { lockSec } = ACTIONS[action];

  const busy = (until: number) => {
    const wait = Math.ceil((until - Date.now()) / 1000);
    return jsonError(409, `Already ran or running — try again in ${wait}s.`, { retryAfter: wait });
  };
  const now = Date.now();
  const lockUntil = now + lockSec * 1000;
  // Claim in memory before any await, so two clicks on one isolate can't
  // both get past the KV read.
  const memUntil = running.get(action) ?? 0;
  if (memUntil > now) return busy(memUntil);
  running.set(action, lockUntil);

  const env = await getEnv();
  const held = await env.LIVE.get<{ until: number; by: string }>(lockKey(action), "json").catch(() => null);
  if (held && held.until > now) {
    running.set(action, held.until);
    return busy(held.until);
  }
  // KV's minimum TTL is 60 s.
  await env.LIVE.put(lockKey(action), JSON.stringify({ until: lockUntil, by: admin.email }), {
    expirationTtl: Math.max(60, lockSec),
  });

  const db = dbFromBinding(env.DB);
  const start = Date.now();
  let result: Record<string, unknown>;
  let ok = true;

  if (action === "collect_fx") {
    const runs = await collectFx(db);
    ok = runs.every((r) => r.ok);
    result = {
      sources: runs.length,
      ok: runs.filter((r) => r.ok).length,
      rows: runs.reduce((n, r) => n + r.rows, 0),
      failed: runs.filter((r) => !r.ok).map((r) => ({ source: r.exchange, error: r.error })),
    };
  } else {
    const ts = Math.floor(start / 1000);
    let rows = 0;
    let error: string | null = null;
    try {
      rows = (await retentionTick({ db, kv: env.LIVE }, ts)).rows;
    } catch (err) {
      ok = false;
      error = err instanceof Error ? err.message : String(err);
    }
    // Log like the cron does, so the health panel shows the manual run.
    await db
      .insert(schema.ingestRuns)
      .values({ exchange: null, job: "retention", ts, durationMs: Date.now() - start, ok, rows, error })
      .catch(() => undefined);
    result = { deleted: rows, ...(error ? { error } : {}) };
  }
  const durationMs = Date.now() - start;

  await audit({
    actorId: admin.id,
    actorEmail: admin.email,
    action: ACTIONS[action].audit,
    targetType: "system",
    targetId: action,
    detail: { ok, durationMs, ...result },
  });

  return NextResponse.json({ action, ok, durationMs, result }, { headers: NO_STORE });
}
