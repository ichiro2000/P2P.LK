import { dbFromBinding, schema } from "@/lib/db/client";
import { EXCHANGE_IDS, type ExchangeId } from "@/lib/exchanges";
import { bookTick, retentionTick, rollupTick, sweepTick, type JobEnv, type JobResult } from "./jobs";
import { takersTick } from "./takers";
import { profilesTick } from "./profiles";
import { collectFx, fxDue } from "@/lib/fx/collect";
import { collectGoogleRate, googleDue } from "@/lib/fx/google";
import { evaluateAlerts, type ExchangeBook } from "@/lib/alerts/evaluate";
import { getFlags } from "@/lib/flags";
import { SWEEP_SEC } from "@/lib/constants";

type Job = "book" | "sweep" | "takers" | "rollup" | "retention" | "alerts" | "profiles";

/** Run one job, time it, and record the outcome in `ingest_runs` (the admin
 *  health panel and "is the feed live?" checks read from there). Never throws. */
async function tracked(
  env: JobEnv,
  job: Job,
  exchange: ExchangeId | null,
  ts: number,
  fn: () => Promise<JobResult>,
) {
  const start = Date.now();
  let ok = true;
  let rows = 0;
  let error: string | null = null;
  try {
    rows = (await fn()).rows;
  } catch (err) {
    ok = false;
    error = err instanceof Error ? err.message : String(err);
    console.error(`[ingest] ${job}${exchange ? `:${exchange}` : ""} failed: ${error}`);
  }
  const durationMs = Date.now() - start;
  await env.db
    .insert(schema.ingestRuns)
    .values({ exchange, job, ts, durationMs, ok, rows, error })
    .catch(() => undefined);
  return { job, exchange, ok, rows, durationMs, error };
}

export type TickPlan = {
  sweep: boolean;
  /** Binance "Trade Info" refresh (lib/ingest/profiles.ts), after each sweep. */
  profiles: boolean;
  takers: boolean;
  retention: boolean;
  fx: boolean;
  google: boolean;
};

/** Tick timestamp in seconds, rounded down to the minute. Cloudflare's
 *  `scheduledTime` can land a second or more past the minute; market buckets
 *  ((ts / B) * B) and merchant rows are joined on exact ts, so an unrounded
 *  ts breaks uptime and the merchant charts on bucketed ranges. */
export function tickTs(scheduledTimeMs: number): number {
  return Math.floor(scheduledTimeMs / 60_000) * 60;
}

/** Which jobs run at a given minute. One cron (`* * * * *`) drives all of them. */
export function planFor(date: Date): TickPlan {
  const m = date.getUTCMinutes();
  return {
    // Full book + merchant directory: every 10 min (D1 write budget, see DEPLOY.md §10).
    sweep: m % (SWEEP_SEC / 60) === 0,
    profiles: m % 5 === 0,
    takers: m % 15 === 7,
    // 20:30 UTC = 02:00 Sri Lanka — quietest hour.
    retention: date.getUTCHours() === 20 && m === 30,
    fx: fxDue(date),
    google: googleDue(date),
  };
}

export async function runScheduled(
  // The rest of the worker env (EMAIL, EMAIL_FROM, BETTER_AUTH_URL)
  // is used by the alert emails.
  bindings: { DB: D1Database; LIVE: KVNamespace } & Partial<CloudflareEnv>,
  scheduledTime: number,
  override?: Partial<TickPlan>,
) {
  const env: JobEnv = { db: dbFromBinding(bindings.DB), kv: bindings.LIVE };
  const ts = tickTs(scheduledTime);
  const date = new Date(ts * 1000);
  const plan = { ...planFor(date), ...override };

  // Exchanges run in parallel — one being slow or down never delays the other.
  // Fresh books are kept in memory for the alert engine (no refetch).
  const books: Partial<Record<ExchangeId, ExchangeBook>> = {};
  const keep = (ex: ExchangeId, r: JobResult) => ((books[ex] = r.book), r);
  const marketJobs = EXCHANGE_IDS.map((ex) =>
    plan.sweep
      ? tracked(env, "sweep", ex, ts, () => sweepTick(env, ex, ts).then((r) => keep(ex, r)))
      : tracked(env, "book", ex, ts, () => bookTick(env, ex, ts).then((r) => keep(ex, r))),
  );
  const results = await Promise.all(marketJobs);
  results.push(await tracked(env, "alerts", null, ts, () => evaluateAlerts({ db: env.db, mail: bindings }, books, ts)));

  // Only the current hour changes; the previous one is finished off during the
  // first 10 minutes. Recomputing more is wasted D1 writes (each REPLACE bills
  // a delete + insert + index updates).
  if (plan.sweep) {
    const hours = date.getUTCMinutes() < 10 ? 2 : 1;
    results.push(await tracked(env, "rollup", null, ts, () => rollupTick(env, ts, hours)));
  }
  // 12 most overdue Binance merchants × 2 requests (job "profiles").
  if (plan.profiles) results.push(await tracked(env, "profiles", "binance", ts, () => profilesTick(env, ts)));
  if (plan.takers) results.push(await tracked(env, "takers", "binance", ts, () => takersTick(env, ts)));
  if (plan.retention) results.push(await tracked(env, "retention", null, ts, () => retentionTick(env, ts)));
  // FX rates for /rates: every 3 hours; logs its own ingest_runs rows (job "fx").
  // The `fxCollector` feature flag (/admin/system) can switch it off.
  // Google mid-market USD/LKR: every 30 minutes (job "fx_google"), same flag.
  const fxOn = plan.fx || plan.google ? (await getFlags(bindings)).fxCollector : false;
  const fx = plan.fx && fxOn ? await collectFx(env.db, { now: date }) : [];
  const google = plan.google && fxOn ? [await collectGoogleRate(env.db, date)] : [];
  return [...results, ...fx, ...google];
}
