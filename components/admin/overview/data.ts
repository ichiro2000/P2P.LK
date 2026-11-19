import "server-only";
import { getEnv } from "@/lib/db/client";
import { SLT_OFFSET_SEC } from "@/lib/constants";
import { USER_STATUSES, type UserStatus } from "@/lib/db/schema";

/**
 * Everything /admin shows, read in ONE D1 batch (one round trip, cheap
 * aggregates only):
 *
 *   users      counts by status/role (ix_user_status), sign-ups per SLT day
 *   ingest     24 h per job × exchange: runs, failures, last success,
 *              p50/p95 duration (window functions), last error, hourly
 *              success rate; uses ix_runs_job_ts (job, exchange, ts)
 *   registry   pending submissions, active reports, pending removals
 *              (status indexes)
 *   database   size from D1's meta.size_after; row counts — exact for small
 *              tables, rowid-range estimates (O(log n)) for the big ones
 */

export const DAY_SEC = 86_400;
export const D1_LIMIT_BYTES = 10 * 1024 ** 3;
export const SIGNUP_DAYS = 30;

/** Stale after this long without a successful run (seconds). */
export const STALE_AFTER: Record<string, number> = {
  book: 3 * 60,
  sweep: 10 * 60,
  alerts: 3 * 60,
  fx: 4 * 3600,
  rollup: 10 * 60,
  takers: 30 * 60,
  retention: 26 * 3600,
};

/** Rows always shown, even with no runs in 24 h (that IS the problem). */
const EXPECTED: { job: string; ex: string }[] = [
  { job: "book", ex: "binance" },
  { job: "book", ex: "bybit" },
  { job: "sweep", ex: "binance" },
  { job: "sweep", ex: "bybit" },
  { job: "alerts", ex: "" },
  { job: "rollup", ex: "" },
  { job: "takers", ex: "binance" },
  { job: "fx", ex: "" },
  { job: "retention", ex: "" },
];
const JOB_ORDER = EXPECTED.map((e) => e.job);

export type IngestHealth = {
  job: string;
  /** "" = not per exchange (alerts, rollup, retention) or all FX sources. */
  exchange: string;
  runs: number;
  failures: number;
  lastOkTs: number | null;
  lastRunTs: number | null;
  p50Ms: number | null;
  p95Ms: number | null;
  lastError: { ts: number; message: string } | null;
  /** 24 hourly buckets, oldest first; null = no runs that hour. */
  hourlyOk: (number | null)[];
  stale: boolean;
  staleAfterSec: number | null;
};

export type Overview = {
  now: number;
  users: {
    byStatus: Record<UserStatus, number>;
    total: number;
    admins: number;
    signups: { day: number; label: string; n: number }[];
    signups30: number;
  };
  ingest: IngestHealth[];
  registry: { pending: number; active: number; removals: number };
  database: {
    sizeBytes: number | null;
    tables: { name: string; rows: number; estimate: boolean }[];
  };
};

/** FX runs are logged per source; the overview folds them into one row. */
const EX = `CASE WHEN job = 'fx' THEN '' ELSE coalesce(exchange, '') END`;

const EXACT_TABLES = ["user", "merchants", "suspicious_takers", "alert_rules"] as const;
const ESTIMATED_TABLES = [
  "market_snapshots",
  "market_hourly",
  "merchant_snapshots",
  "merchant_hourly",
  "taker_snapshots",
  "fx_rates",
  "ingest_runs",
  "alert_events",
  "audit_log",
] as const;

type Row = Record<string, unknown>;
const num = (v: unknown) => (v == null ? 0 : Number(v));
const numOrNull = (v: unknown) => (v == null ? null : Number(v));

const dayLabel = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

export async function loadOverview(): Promise<Overview> {
  const env = await getEnv();
  const db = env.DB;
  const now = Math.floor(Date.now() / 1000);
  const since24 = now - DAY_SEC;
  // SLT day index (days since epoch, Sri Lanka time).
  const today = Math.floor((now + SLT_OFFSET_SEC) / DAY_SEC);
  const firstDay = today - (SIGNUP_DAYS - 1);
  const signupSinceMs = (firstDay * DAY_SEC - SLT_OFFSET_SEC) * 1000;

  // One row, one column per table (D1 caps compound SELECTs at 5 terms).
  const tableCounts = `SELECT ${[
    ...EXACT_TABLES.map((t) => `(SELECT count(*) FROM "${t}") AS "${t}"`),
    ...ESTIMATED_TABLES.map(
      (t) => `coalesce((SELECT max(rowid) FROM "${t}") - (SELECT min(rowid) FROM "${t}") + 1, 0) AS "${t}"`,
    ),
  ].join(", ")}`;

  const results = await db.batch<Row>([
    // 0 users by status × role
    db.prepare(`SELECT status, role, count(*) AS n FROM "user" GROUP BY status, role`),
    // 1 sign-ups per SLT day
    db
      .prepare(
        `SELECT CAST((created_at / 1000 + ?2) / 86400 AS INTEGER) AS day, count(*) AS n
         FROM "user" WHERE created_at >= ?1 GROUP BY day`,
      )
      .bind(signupSinceMs, SLT_OFFSET_SEC),
    // 2 ingest aggregates, 24 h
    db
      .prepare(
        `SELECT job, ${EX} AS ex, count(*) AS runs, sum(ok = 0) AS fails,
                max(CASE WHEN ok = 1 THEN ts END) AS last_ok, max(ts) AS last_ts
         FROM ingest_runs WHERE ts >= ?1 GROUP BY job, ex`,
      )
      .bind(since24),
    // 3 p50 / p95 duration of successful runs (nearest-rank)
    db
      .prepare(
        `SELECT job, ex, duration_ms AS d, rn, cnt FROM (
           SELECT job, ${EX} AS ex, duration_ms,
                  row_number() OVER (PARTITION BY job, ${EX} ORDER BY duration_ms) AS rn,
                  count(*) OVER (PARTITION BY job, ${EX}) AS cnt
           FROM ingest_runs WHERE ts >= ?1 AND ok = 1)
         WHERE rn = (cnt * 50 + 99) / 100 OR rn = (cnt * 95 + 99) / 100`,
      )
      .bind(since24),
    // 4 last error per row, 24 h
    db
      .prepare(
        `SELECT job, ex, ts, error FROM (
           SELECT job, ${EX} AS ex, ts, error,
                  row_number() OVER (PARTITION BY job, ${EX} ORDER BY ts DESC) AS rn
           FROM ingest_runs WHERE ts >= ?1 AND ok = 0)
         WHERE rn = 1`,
      )
      .bind(since24),
    // 5 hourly success counts, 24 h
    db
      .prepare(
        `SELECT job, ${EX} AS ex, CAST((ts - ?1) / 3600 AS INTEGER) AS h, count(*) AS n, sum(ok) AS okn
         FROM ingest_runs WHERE ts >= ?1 GROUP BY job, ex, h`,
      )
      .bind(since24),
    // 6 last success beyond 24 h for the low-volume jobs (7-day table)
    db.prepare(
      `SELECT job, ${EX} AS ex, max(ts) AS last_ok FROM ingest_runs
       WHERE ok = 1 AND job IN ('retention', 'takers', 'fx') GROUP BY job, ex`,
    ),
    // 7 registry
    db.prepare(
      `SELECT (SELECT count(*) FROM suspicious_takers WHERE status = 'pending') AS pending,
              (SELECT count(*) FROM suspicious_takers WHERE status = 'active') AS active,
              (SELECT count(*) FROM suspicious_removal_requests WHERE status = 'pending') AS removals`,
    ),
    // 8 table row counts
    db.prepare(tableCounts),
    // 9 database size (meta.size_after)
    db.prepare("SELECT 1"),
  ]);
  const rows = (i: number) => (results[i]?.results ?? []) as Row[];

  // ── users
  const byStatus = Object.fromEntries(USER_STATUSES.map((s) => [s, 0])) as Record<UserStatus, number>;
  let admins = 0;
  for (const r of rows(0)) {
    const s = String(r.status) as UserStatus;
    if (s in byStatus) byStatus[s] += num(r.n);
    if (r.role === "admin") admins += num(r.n);
  }
  const perDay = new Map(rows(1).map((r) => [num(r.day), num(r.n)]));
  const signups = Array.from({ length: SIGNUP_DAYS }, (_, i) => {
    const day = firstDay + i;
    return { day, label: dayLabel.format(new Date(day * DAY_SEC * 1000)), n: perDay.get(day) ?? 0 };
  });

  // ── ingest
  const key = (r: Row) => `${r.job}|${r.ex ?? ""}`;
  const map = new Map<string, IngestHealth>();
  const ensure = (job: string, ex: string) => {
    const k = `${job}|${ex}`;
    let h = map.get(k);
    if (!h) {
      h = {
        job,
        exchange: ex,
        runs: 0,
        failures: 0,
        lastOkTs: null,
        lastRunTs: null,
        p50Ms: null,
        p95Ms: null,
        lastError: null,
        hourlyOk: Array.from({ length: 24 }, () => null),
        stale: false,
        staleAfterSec: STALE_AFTER[job] ?? null,
      };
      map.set(k, h);
    }
    return h;
  };
  for (const e of EXPECTED) ensure(e.job, e.ex);
  for (const r of rows(2)) {
    const h = ensure(String(r.job), String(r.ex ?? ""));
    h.runs = num(r.runs);
    h.failures = num(r.fails);
    h.lastOkTs = numOrNull(r.last_ok);
    h.lastRunTs = numOrNull(r.last_ts);
  }
  for (const r of rows(3)) {
    const h = map.get(key(r));
    if (!h) continue;
    const cnt = num(r.cnt);
    const rn = num(r.rn);
    if (rn === Math.floor((cnt * 50 + 99) / 100)) h.p50Ms = num(r.d);
    if (rn === Math.floor((cnt * 95 + 99) / 100)) h.p95Ms = num(r.d);
  }
  for (const r of rows(4)) {
    const h = map.get(key(r));
    if (h) h.lastError = { ts: num(r.ts), message: String(r.error ?? "") };
  }
  for (const r of rows(5)) {
    const h = map.get(key(r));
    const i = Math.floor(num(r.h));
    // A run at exactly `now` lands in bucket 24; fold it into the last hour.
    if (h && i >= 0 && num(r.n) > 0) h.hourlyOk[Math.min(23, i)] = num(r.okn) / num(r.n);
  }
  for (const r of rows(6)) {
    const h = map.get(key(r));
    if (h && h.lastOkTs == null) h.lastOkTs = numOrNull(r.last_ok);
  }
  const ingest = [...map.values()].sort(
    (a, b) =>
      (JOB_ORDER.indexOf(a.job) + 1 || 99) - (JOB_ORDER.indexOf(b.job) + 1 || 99) ||
      a.exchange.localeCompare(b.exchange),
  );
  for (const h of ingest) {
    h.stale = h.staleAfterSec != null && (h.lastOkTs == null || now - h.lastOkTs > h.staleAfterSec);
  }

  // ── registry
  const reg = rows(7)[0] ?? {};

  // ── database
  const sizes = results.map((r) => (r?.meta as { size_after?: number } | undefined)?.size_after ?? null);
  const sizeBytes = sizes[9] ?? sizes.find((s) => s != null) ?? null;
  const counts = rows(8)[0] ?? {};
  const estimated = new Set<string>(ESTIMATED_TABLES);
  const tables = [...EXACT_TABLES, ...ESTIMATED_TABLES]
    .map((t) => ({ name: t as string, rows: Math.max(0, num(counts[t])), estimate: estimated.has(t) }))
    .sort((a, b) => b.rows - a.rows);

  return {
    now,
    users: {
      byStatus,
      total: Object.values(byStatus).reduce((a, b) => a + b, 0),
      admins,
      signups,
      signups30: signups.reduce((a, s) => a + s.n, 0),
    },
    ingest,
    registry: { pending: num(reg.pending), active: num(reg.active), removals: num(reg.removals) },
    database: { sizeBytes, tables },
  };
}
