import "server-only";
import { and, desc, eq, isNull, sql, type SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { EXCHANGE_IDS } from "@/lib/exchanges";
import { FX_SOURCE_META } from "@/lib/fx/sources";
import { getFlags, type Flags } from "@/lib/flags";

export const RUN_LIMIT = 200;
export const RUN_JOBS = ["book", "sweep", "alerts", "push", "rollup", "takers", "fx", "retention"] as const;
export type RunJob = (typeof RUN_JOBS)[number];

/** "none" = runs without an exchange (alerts, rollup, retention). */
export const RUN_EXCHANGES = [...EXCHANGE_IDS, ...Object.keys(FX_SOURCE_META), "none"] as const;

export type RunFilter = { job: RunJob | null; exchange: string | null; failed: boolean };

export type RunRow = {
  id: number;
  job: string;
  exchange: string | null;
  ts: number;
  durationMs: number;
  ok: boolean;
  rows: number;
  error: string | null;
};

export type FxSourceRow = {
  id: string;
  name: string;
  kind: string;
  pageUrl: string;
  rows: number;
  lastFetchedAt: number | null;
  latestAsOf: string | null;
  lastRun: { ts: number; ok: boolean; error: string | null; rows: number } | null;
};

export function parseRunFilter(sp: Record<string, string | string[] | undefined>): RunFilter {
  const one = (k: string) => {
    const v = sp[k];
    return (Array.isArray(v) ? v[0] : v) ?? "";
  };
  const job = one("job");
  const ex = one("exchange");
  return {
    job: (RUN_JOBS as readonly string[]).includes(job) ? (job as RunJob) : null,
    exchange: (RUN_EXCHANGES as readonly string[]).includes(ex) ? ex : null,
    failed: one("failed") === "1",
  };
}

export async function loadSystem(filter: RunFilter): Promise<{
  now: number;
  runs: RunRow[];
  fx: FxSourceRow[];
  flags: Flags;
}> {
  const db = await getDb();
  const r = schema.ingestRuns;
  const where: SQL[] = [];
  if (filter.job) where.push(eq(r.job, filter.job));
  if (filter.exchange === "none") where.push(isNull(r.exchange));
  else if (filter.exchange) where.push(eq(r.exchange, filter.exchange));
  if (filter.failed) where.push(eq(r.ok, false));

  const [runs, fxCounts, fxLastRuns, flags] = await Promise.all([
    db
      .select()
      .from(r)
      .where(where.length ? and(...where) : undefined)
      .orderBy(desc(r.ts), desc(r.id))
      .limit(RUN_LIMIT),
    db
      .select({
        source: schema.fxRates.source,
        rows: sql<number>`count(*)`,
        last: sql<number | null>`max(${schema.fxRates.fetchedAt})`,
        asOf: sql<string | null>`max(${schema.fxRates.asOf})`,
      })
      .from(schema.fxRates)
      .groupBy(schema.fxRates.source),
    // Latest fx run per source (uses ix_runs_job_ts: job = 'fx', exchange, ts).
    db.all<{ exchange: string; ts: number; ok: number; error: string | null; rows: number }>(sql`
      SELECT exchange, ts, ok, error, rows FROM (
        SELECT exchange, ts, ok, error, rows,
               row_number() OVER (PARTITION BY exchange ORDER BY ts DESC, id DESC) AS rn
        FROM ingest_runs WHERE job = 'fx')
      WHERE rn = 1`),
    getFlags(null, { fresh: true }),
  ]);

  const counts = new Map(fxCounts.map((c) => [c.source, c]));
  const lastRuns = new Map(fxLastRuns.map((x) => [x.exchange, x]));
  const ids = new Set([...Object.keys(FX_SOURCE_META), ...counts.keys()]);
  const fx: FxSourceRow[] = [...ids].map((id) => {
    const meta = FX_SOURCE_META[id];
    const c = counts.get(id);
    const lr = lastRuns.get(id);
    return {
      id,
      name: meta?.name ?? id,
      kind: meta?.kind ?? "retired",
      pageUrl: meta?.pageUrl ?? "",
      rows: Number(c?.rows ?? 0),
      lastFetchedAt: c?.last != null ? Number(c.last) : null,
      latestAsOf: c?.asOf ?? null,
      lastRun: lr ? { ts: Number(lr.ts), ok: Boolean(lr.ok), error: lr.error, rows: Number(lr.rows) } : null,
    };
  });

  return { now: Math.floor(Date.now() / 1000), runs: runs as RunRow[], fx, flags };
}
