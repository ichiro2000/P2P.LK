import { and, eq, sql } from "drizzle-orm";
import type { BatchItem } from "drizzle-orm/batch";
import { schema, type Db } from "@/lib/db/client";
import {
  fetchBinanceTradeInfo,
  type BinanceProfile,
  type BinanceReviews,
} from "@/lib/exchanges/binance-profile";
import { sltDay } from "@/lib/trade-trend";
import type { JobEnv, JobResult } from "./jobs";

/**
 * Binance "Trade Info" collector (job "profiles", runs after every 5-minute
 * sweep). Each run refreshes the PROFILE_BATCH most overdue Binance
 * merchants, 2 public requests each (profile + review statistics):
 *
 *   due after   2 h   merchants in the latest sweep (listing now)
 *              12 h   seen in the last 7 days
 *              24 h   seen in the last 30 days
 *   never fetched first, then the most overdue (overdue ÷ target).
 *
 * 12 merchants × 12 sweeps/h = 144 refreshes/h, so ~200 active merchants
 * come round about every 1.5–2.5 h and daily differences stay accurate.
 * Budget: 24 subrequests per run on top of the sweep's ≤ 64.
 *
 * Every success upserts `merchant_profiles` and the day's row in
 * `merchant_trade_daily` (last cumulative counters of the SLT day). A failure
 * only stamps fetched_at/ok/error, keeping the last good values, so a broken
 * profile is retried on the normal schedule instead of every run.
 */

export const PROFILE_BATCH = 12;
const CONCURRENCY = 3;
const DELAY_MS = 250;
const TIMEOUT_MS = 6000;
const TARGET_SEC = { active: 2 * 3600, week: 12 * 3600, month: 24 * 3600 } as const;
const ACTIVE_SLACK_SEC = 120;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The merchants to refresh now, most overdue first. */
export async function dueBinanceMerchants(db: Db, nowTs: number, limit = PROFILE_BATCH): Promise<string[]> {
  // Integers are inlined (sql.raw): D1 binds JS numbers as REAL.
  const now = sql.raw(String(Math.floor(nowTs)));
  const lim = sql.raw(String(Math.max(1, Math.min(100, Math.floor(limit)))));
  const T = TARGET_SEC;
  const rows = await db.all<{ id: string }>(sql`
    WITH latest AS (
      SELECT max(last_seen_ts) AS ts FROM merchants WHERE exchange = 'binance'
    ),
    m AS (
      SELECT merchant_id AS id, max(last_seen_ts) AS seen
      FROM merchants
      WHERE exchange = 'binance' AND last_seen_ts >= ${now} - ${sql.raw(String(30 * 86400))}
      GROUP BY merchant_id
    ),
    c AS (
      SELECT m.id, p.fetched_at AS f,
        CASE
          WHEN m.seen >= (SELECT ts FROM latest) - ${sql.raw(String(ACTIVE_SLACK_SEC))} THEN ${sql.raw(String(T.active))}
          WHEN m.seen >= ${now} - ${sql.raw(String(7 * 86400))} THEN ${sql.raw(String(T.week))}
          ELSE ${sql.raw(String(T.month))}
        END AS target
      FROM m
      LEFT JOIN merchant_profiles p ON p.exchange = 'binance' AND p.merchant_id = m.id
    )
    SELECT id FROM c
    WHERE f IS NULL OR ${now} - f >= target
    ORDER BY (f IS NULL) DESC, CASE WHEN f IS NULL THEN target ELSE 0 END,
      (${now} - coalesce(f, 0)) * 1.0 / target DESC, target ASC
    LIMIT ${lim}
  `);
  return rows.map((r) => r.id);
}

function profileValues(p: BinanceProfile, r: BinanceReviews | null) {
  return {
    nickName: p.nickName,
    completedOrders: p.completedOrders,
    completedBuy: p.completedBuy,
    completedSell: p.completedSell,
    orders30d: p.orders30d,
    buy30d: p.buy30d,
    sell30d: p.sell30d,
    completion30d: p.completion30d,
    avgReleaseSec: p.avgReleaseSec,
    avgPaySec: p.avgPaySec,
    registerDays: p.registerDays,
    firstTradeDays: p.firstTradeDays,
    counterparties: p.counterparties,
    depositUsdt: p.depositUsdt,
    kycVerified: p.kycVerified,
    emailVerified: p.emailVerified,
    mobileVerified: p.mobileVerified,
    tradeType: p.tradeType,
    userIdentity: p.userIdentity,
    vipLevel: p.vipLevel,
    lastActiveMs: p.lastActiveMs,
    // Reviews are optional: keep the previous counts when that call failed.
    ...(r ? { positive: r.positive, negative: r.negative, positiveRate: r.positiveRate } : {}),
  };
}

/** Upsert statements for one successful fetch (profile + the day's counters). */
function successStatements(db: Db, id: string, ts: number, p: BinanceProfile, r: BinanceReviews | null) {
  const ids = { exchange: "binance" as const, merchantId: id };
  const values = profileValues(p, r);
  const status = { fetchedAt: ts, okAt: ts, ok: true, error: null };
  const stmts: BatchItem<"sqlite">[] = [
    db
      .insert(schema.merchantProfiles)
      .values({ ...ids, ...status, ...values })
      .onConflictDoUpdate({
        target: [schema.merchantProfiles.exchange, schema.merchantProfiles.merchantId],
        set: { ...status, ...values },
      }),
  ];
  if (p.completedBuy != null && p.completedSell != null) {
    const counters = {
      completedBuy: p.completedBuy,
      completedSell: p.completedSell,
      completedOrders: p.completedOrders,
      ...(r ? { positive: r.positive, negative: r.negative } : {}),
    };
    stmts.push(
      db
        .insert(schema.merchantTradeDaily)
        .values({ ...ids, day: sltDay(ts), ...counters, firstTs: ts, lastTs: ts })
        .onConflictDoUpdate({
          target: [schema.merchantTradeDaily.exchange, schema.merchantTradeDaily.merchantId, schema.merchantTradeDaily.day],
          set: { ...counters, lastTs: ts },
        }),
    );
  }
  return stmts;
}

function failureStatement(db: Db, id: string, ts: number, error: string) {
  const status = { fetchedAt: ts, ok: false, error: error.slice(0, 200) };
  return db
    .insert(schema.merchantProfiles)
    .values({ exchange: "binance", merchantId: id, ...status })
    .onConflictDoUpdate({
      target: [schema.merchantProfiles.exchange, schema.merchantProfiles.merchantId],
      set: status,
    });
}

type Outcome = { id: string; ok: boolean; error?: string };

/** Fetch one merchant and build its statements. Never throws. */
async function fetchOne(db: Db, id: string, ts: number, timeoutMs: number): Promise<{ outcome: Outcome; stmts: BatchItem<"sqlite">[] }> {
  try {
    const info = await fetchBinanceTradeInfo(id, timeoutMs);
    if (!info) return { outcome: { id, ok: false, error: "no profile" }, stmts: [failureStatement(db, id, ts, "no profile")] };
    return { outcome: { id, ok: true }, stmts: successStatements(db, id, ts, info.profile, info.reviews) };
  } catch (err) {
    const msg = err instanceof Error ? (err.name === "AbortError" ? "timeout" : err.message) : String(err);
    return { outcome: { id, ok: false, error: msg }, stmts: [failureStatement(db, id, ts, msg)] };
  }
}

/** Refresh a list of Binance merchants (concurrency 3, small delay between rounds). */
export async function refreshProfiles(
  db: Db,
  ids: string[],
  ts: number,
  opts: { timeoutMs?: number; delayMs?: number } = {},
): Promise<Outcome[]> {
  const outcomes: Outcome[] = [];
  const stmts: BatchItem<"sqlite">[] = [];
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    if (i > 0) await sleep(opts.delayMs ?? DELAY_MS);
    const round = await Promise.all(
      ids.slice(i, i + CONCURRENCY).map((id) => fetchOne(db, id, ts, opts.timeoutMs ?? TIMEOUT_MS)),
    );
    for (const r of round) {
      outcomes.push(r.outcome);
      stmts.push(...r.stmts);
    }
  }
  // One round trip, one transaction.
  if (stmts.length) await db.batch(stmts as [BatchItem<"sqlite">, ...BatchItem<"sqlite">[]]);
  return outcomes;
}

/** The cron job. `ids` (dev) refreshes exactly those merchants. */
export async function profilesTick(
  env: Pick<JobEnv, "db">,
  ts: number,
  opts: { ids?: string[]; limit?: number } = {},
): Promise<JobResult & { outcomes: Outcome[] }> {
  const ids = opts.ids?.length ? opts.ids : await dueBinanceMerchants(env.db, ts, opts.limit);
  if (!ids.length) return { rows: 0, outcomes: [] };
  const outcomes = await refreshProfiles(env.db, ids, ts);
  const ok = outcomes.filter((o) => o.ok).length;
  // Fail the run (ingest_runs.ok = false) only when every fetch failed —
  // e.g. Binance blocking us — not for one dead profile.
  if (ok === 0) throw new Error(`all ${outcomes.length} profile fetches failed: ${outcomes[0]?.error ?? "?"}`);
  return { rows: ok, outcomes };
}

/** Latest stored profile for one merchant (null when never fetched). */
export async function getStoredProfile(db: Db, exchange: "binance" | "bybit", id: string) {
  const [row] = await db
    .select()
    .from(schema.merchantProfiles)
    .where(and(eq(schema.merchantProfiles.exchange, exchange), eq(schema.merchantProfiles.merchantId, id)))
    .limit(1);
  return row ?? null;
}
