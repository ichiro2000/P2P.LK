import { and, desc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { freshness } from "@/lib/db/queries";
import { percentileRank } from "@/lib/stats";
import type { ExchangeId } from "@/lib/exchanges";

/**
 * Spread and volatility regime (D8): where today's numbers sit in the last
 * 7 days, from raw 1-minute snapshots.
 *
 *   spreadRank  share of the last 7 days' minutes with a NARROWER spread
 *               than now (0.8 = "wider than 80 % of the last 7 days").
 *   vol1h       stdev of 1-minute mid changes over the last 60 minutes.
 *   volRank     share of the last 7 days' hours with a LOWER vol1h.
 *   move15      typical mid move over a 15-minute payment window, in LKR:
 *               σ(1-min changes, last 24 h) · √15 · mid.
 */

const WINDOW_SEC = 7 * 86400;
/** Minimum minutes in an hour for its volatility to count. */
const MIN_PER_HOUR = 30;
/** Two snapshots further apart than this aren't a 1-minute change. */
const MAX_STEP_SEC = 120;

export type Regime = {
  ts: number | null;
  stale: boolean;
  spreadPct: number | null;
  spreadRank: number | null;
  /** Minutes behind the spread percentile. */
  spreadN: number;
  vol1h: number | null;
  volRank: number | null;
  /** Hours behind the volatility percentile. */
  volN: number;
  mid: number | null;
  move15: number | null;
};

/** Pure part: rank the latest hour's volatility against the earlier hours. */
export function volRegime(buckets: readonly { k: number; n: number; v: number }[]) {
  const ok = buckets.filter((b) => b.n >= MIN_PER_HOUR && Number.isFinite(b.v) && b.v >= 0);
  const now = ok.find((b) => b.k === 0);
  const past = ok.filter((b) => b.k > 0).map((b) => Math.sqrt(b.v));
  const vol1h = now ? Math.sqrt(now.v) : null;
  const day = ok.filter((b) => b.k < 24);
  const n24 = day.reduce((s, b) => s + b.n, 0);
  const var24 = n24 ? day.reduce((s, b) => s + b.v * b.n, 0) / n24 : null;
  return {
    vol1h,
    volRank: vol1h != null && past.length >= 24 ? percentileRank(past, vol1h) : null,
    volN: past.length,
    sigma24: var24 != null ? Math.sqrt(var24) : null,
  };
}

export async function marketRegime(ex: ExchangeId, asset: string, fiat: string): Promise<Regime> {
  const db = await getDb();
  const m = schema.marketSnapshots;
  const now = Math.floor(Date.now() / 1000);
  const since = now - WINDOW_SEC;
  const where = and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat), gte(m.ts, since));

  const [latest] = await db
    .select({ ts: m.ts, spreadPct: m.spreadPct, mid: m.mid })
    .from(m)
    .where(where)
    .orderBy(desc(m.ts))
    .limit(1);
  const f = freshness(latest?.ts ?? null, now);
  const cur = latest?.spreadPct ?? null;

  const N = sql.raw(String(now));
  const STEP = sql.raw(String(MAX_STEP_SEC));
  const [spreadRow, volRows] = await Promise.all([
    cur == null
      ? Promise.resolve(null)
      : db
          .select({
            n: sql<number>`count(*)`,
            below: sql<number>`sum(CASE WHEN ${m.spreadPct} < ${cur} THEN 1 ELSE 0 END)`,
            equal: sql<number>`sum(CASE WHEN ${m.spreadPct} = ${cur} THEN 1 ELSE 0 END)`,
          })
          .from(m)
          .where(and(where, sql`${m.spreadPct} IS NOT NULL`))
          .then((r) => r[0] ?? null),
    db.all<{ k: number; n: number; v: number }>(sql`
      SELECT (${N} - ts) / 3600 AS k, count(*) AS n, avg(r * r) - avg(r) * avg(r) AS v
      FROM (
        SELECT ts, mid / lag(mid) OVER w - 1 AS r, ts - lag(ts) OVER w AS gap
        FROM market_snapshots
        WHERE exchange = ${ex} AND asset = ${asset} AND fiat = ${fiat} AND ts >= ${since} AND mid > 0
        WINDOW w AS (ORDER BY ts)
      )
      WHERE r IS NOT NULL AND gap <= ${STEP}
      GROUP BY 1
    `),
  ]);

  const n = Number(spreadRow?.n ?? 0);
  const spreadRank = n >= 60 ? (Number(spreadRow?.below ?? 0) + Number(spreadRow?.equal ?? 0) / 2) / n : null;
  const vol = volRegime(volRows.map((r) => ({ k: Number(r.k), n: Number(r.n), v: Number(r.v) })));
  const mid = latest?.mid ?? null;
  return {
    ts: f.ts,
    stale: f.stale,
    spreadPct: cur,
    spreadRank,
    spreadN: n,
    vol1h: vol.vol1h,
    volRank: vol.volRank,
    volN: vol.volN,
    mid,
    move15: vol.sigma24 != null && mid != null ? vol.sigma24 * Math.sqrt(15) * mid : null,
  };
}
