import { sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db/client";
import { FX_SOURCES } from "./sources";
import type { FxSource, ParsedRate } from "./types";

/**
 * FX collector: runs every source with a per-source timeout and full error
 * isolation, upserts into `fx_rates` (one row per source × currency × type ×
 * day) and logs each source to `ingest_runs` as job "fx" (exchange = source
 * id) so the admin health panel and the /rates page can show freshness.
 *
 * Politeness: one request per source per run; sources on the same host run
 * one after another with HOST_SPACING_MS between them (CBSL's robots.txt asks
 * for Crawl-delay: 10).
 */

const TIMEOUT_MS = 20_000;
const HOST_SPACING_MS = 11_000;
/** D1 allows 100 bound parameters per statement; 6 columns → 16 rows. */
const ROWS_PER_INSERT = 16;
const STATEMENTS_PER_BATCH = 50;

/** Every 3 hours (SLT 02:47, 05:47, 08:47, 11:47, 14:47, 17:47, 20:47, 23:47).
 *  Minute 17 avoids the 5-minute sweep and the takers poll. */
export function fxDue(date: Date): boolean {
  return date.getUTCMinutes() === 17 && date.getUTCHours() % 3 === 0;
}

export type FxRunResult = {
  job: "fx";
  exchange: string;
  ok: boolean;
  rows: number;
  durationMs: number;
  error: string | null;
};

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function upsert(db: Db, source: string, rows: ParsedRate[], fetchedAt: number) {
  const values = rows.map((r) => ({ source, ...r, fetchedAt }));
  const statements = [];
  for (let i = 0; i < values.length; i += ROWS_PER_INSERT) {
    statements.push(
      db
        .insert(schema.fxRates)
        .values(values.slice(i, i + ROWS_PER_INSERT))
        .onConflictDoUpdate({
          target: [schema.fxRates.source, schema.fxRates.currency, schema.fxRates.rateType, schema.fxRates.asOf],
          set: { value: sql`excluded.value`, fetchedAt: sql`excluded.fetched_at` },
          // Unchanged values keep their original fetched_at (= first seen).
          setWhere: sql`${schema.fxRates.value} <> excluded.value`,
        }),
    );
  }
  for (let i = 0; i < statements.length; i += STATEMENTS_PER_BATCH) {
    const chunk = statements.slice(i, i + STATEMENTS_PER_BATCH);
    await db.batch(chunk as [(typeof chunk)[number], ...typeof chunk]);
  }
}

async function storedDaysBySource(db: Db): Promise<Map<string, number>> {
  const rows = await db
    .select({ source: schema.fxRates.source, days: sql<number>`count(distinct ${schema.fxRates.asOf})` })
    .from(schema.fxRates)
    .groupBy(schema.fxRates.source);
  return new Map(rows.map((r) => [r.source, Number(r.days)]));
}

async function runOne(db: Db, src: FxSource, now: Date, storedDays: number): Promise<FxRunResult> {
  const start = Date.now();
  const ts = Math.floor(now.getTime() / 1000);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(new Error(`timed out after ${TIMEOUT_MS / 1000}s`)), TIMEOUT_MS);
  let rows = 0;
  let error: string | null = null;
  try {
    const parsed = await src.fetch({ now, signal: ctrl.signal, storedDays });
    await upsert(db, src.id, parsed, Math.floor(Date.now() / 1000));
    rows = parsed.length;
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    console.warn(`[fx] ${src.id} failed: ${error}`);
  } finally {
    clearTimeout(timer);
  }
  const durationMs = Date.now() - start;
  await db
    .insert(schema.ingestRuns)
    .values({ exchange: src.id, job: "fx", ts, durationMs, ok: error == null, rows, error })
    .catch(() => undefined);
  return { job: "fx", exchange: src.id, ok: error == null, rows, durationMs, error };
}

/** Run the collector. `only` limits it to some source ids (dev tick). Never throws. */
export async function collectFx(db: Db, opts: { now?: Date; only?: string[] } = {}): Promise<FxRunResult[]> {
  const now = opts.now ?? new Date();
  const sources = opts.only?.length ? FX_SOURCES.filter((s) => opts.only!.includes(s.id)) : FX_SOURCES;
  const stored = await storedDaysBySource(db).catch(() => new Map<string, number>());

  const byHost = new Map<string, FxSource[]>();
  for (const s of sources) byHost.set(s.host, [...(byHost.get(s.host) ?? []), s]);

  const perHost = [...byHost.values()].map(async (group) => {
    const out: FxRunResult[] = [];
    for (const [i, s] of group.entries()) {
      if (i > 0) await sleep(HOST_SPACING_MS);
      out.push(await runOne(db, s, now, stored.get(s.id) ?? 0));
    }
    return out;
  });
  return (await Promise.all(perHost)).flat();
}
