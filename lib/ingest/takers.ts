import { and, desc, eq } from "drizzle-orm";
import { schema } from "@/lib/db/client";
import { fetchBinanceAdvertiserPublic } from "@/lib/qr-resolve";
import type { JobEnv, JobResult } from "./jobs";

/**
 * Poll public profiles of every actively-flagged taker. Takers live in their
 * own `taker_snapshots` table (they used to be written into
 * merchant_snapshots, which broke "latest tick" queries and the risk page).
 *
 * Change-only storage: a row is written when name / orders / completion
 * changes, plus a heartbeat row at least once a day so charts have points.
 */

const CONCURRENCY = 4;
const HEARTBEAT_SEC = 86400;

export async function takersTick(env: JobEnv, ts: number): Promise<JobResult> {
  const rows = await env.db
    .selectDistinct({ userId: schema.suspiciousTakers.userId })
    .from(schema.suspiciousTakers)
    .where(
      and(
        eq(schema.suspiciousTakers.status, "active"),
        eq(schema.suspiciousTakers.exchange, "binance"),
      ),
    );
  // Bybit profile polling is added once the Bybit profile endpoint is
  // verified; Bybit reports are stored but not polled yet.
  const ids = rows
    .map((r) => r.userId)
    .filter((id) => /^[sS]?[A-Za-z0-9]{16,}$/.test(id));

  let written = 0;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const results = await Promise.all(batch.map((id) => pollOne(env, id, ts).catch(() => false)));
    written += results.filter(Boolean).length;
  }
  return { rows: written };
}

async function pollOne(env: JobEnv, userId: string, ts: number): Promise<boolean> {
  const p = await fetchBinanceAdvertiserPublic(userId, { timeoutMs: 5000 });
  if (!p?.nickName) return false;

  const [last] = await env.db
    .select()
    .from(schema.takerSnapshots)
    .where(
      and(
        eq(schema.takerSnapshots.exchange, "binance"),
        eq(schema.takerSnapshots.userId, userId),
      ),
    )
    .orderBy(desc(schema.takerSnapshots.ts))
    .limit(1);

  const next = {
    nickName: p.nickName,
    userIdentity: p.userIdentity,
    userGrade: p.userGrade,
    vipLevel: p.vipLevel,
    ordersMonth: p.monthOrderCount,
    completionRate: p.monthFinishRate,
    avgReleaseSec: p.avgReleaseTimeSec != null ? Math.round(p.avgReleaseTimeSec) : null,
  };
  const changed =
    !last ||
    last.nickName !== next.nickName ||
    last.ordersMonth !== next.ordersMonth ||
    last.completionRate !== next.completionRate ||
    ts - last.ts >= HEARTBEAT_SEC;
  if (!changed) return false;

  await env.db
    .insert(schema.takerSnapshots)
    .values({ exchange: "binance", userId, ts, ...next });
  return true;
}
