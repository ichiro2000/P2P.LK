import { count, eq, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db/client";
import { addDays, sltDate } from "@/lib/fx/http";
import { DEVI, fetchDevi, fetchUae, type DeviDay } from "./sources";

/**
 * Gold collector (job "gold"): every hour at :47 UTC — clear of the sweep
 * (:x0), profiles (:x5), takers (:07/:22/:37/:52), Google (:03/:33) and
 * the 3-hourly FX run (:17).
 *
 *   UAE  24K/22K AED per gram → gold_prices (source "uae", today's SLT day;
 *        the latest reading of the day wins). 3 board updates a day.
 *   Devi 24K/22K LKR per pawn → gold_prices (source "devi", Devi's own day).
 *        First run backfills the 6-month table (≈ 125 per-pawn days); after
 *        that only the last week is rewritten.
 *
 * One source failing never stops the other. Logs one ingest_runs row.
 */

/** Hourly at :47 UTC (SLT :17). */
export function goldDue(date: Date): boolean {
  return date.getUTCMinutes() === 47;
}

/** Devi days stored before switching from backfill to the short refresh. */
const BACKFILLED_DAYS = 60;
/** D1: 100 bound parameters per statement; 5 columns → 20 rows. */
const ROWS_PER_INSERT = 20;

type Row = typeof schema.goldPrices.$inferInsert;

async function upsert(db: Db, rows: Row[]) {
  if (!rows.length) return;
  const g = schema.goldPrices;
  const stmts = [];
  for (let i = 0; i < rows.length; i += ROWS_PER_INSERT) {
    stmts.push(
      db
        .insert(g)
        .values(rows.slice(i, i + ROWS_PER_INSERT))
        .onConflictDoUpdate({
          target: [g.source, g.karat, g.day],
          set: { value: sql`excluded.value`, fetchedAt: sql`excluded.fetched_at` },
        }),
    );
  }
  await db.batch(stmts as [(typeof stmts)[number], ...typeof stmts]);
}

export const deviRows = (days: readonly DeviDay[], fetchedAt: number): Row[] =>
  days.flatMap((d) => [
    { source: DEVI.id, karat: 24, day: d.day, value: d.p24, fetchedAt },
    ...(d.p22 != null ? [{ source: DEVI.id, karat: 22, day: d.day, value: d.p22, fetchedAt }] : []),
  ]);

export async function collectGold(db: Db, now = new Date()) {
  const ts = Math.floor(now.getTime() / 1000);
  const start = Date.now();
  const today = sltDate(now);
  const errors: string[] = [];
  let rows = 0;
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);

  const uae = fetchUae(ac.signal)
    .then(async ({ prices }) => {
      const r = prices.map((p) => ({ source: "uae", karat: p.karat, day: today, value: p.value, fetchedAt: ts }));
      await upsert(db, r);
      rows += r.length;
    })
    .catch((e: Error) => errors.push(`uae: ${e.message}`));

  const devi = (async () => {
    const [{ n }] = await db
      .select({ n: count() })
      .from(schema.goldPrices)
      .where(eq(schema.goldPrices.source, DEVI.id));
    const backfill = n < BACKFILLED_DAYS;
    const days = await fetchDevi(ac.signal, backfill ? "6month" : "month");
    const keep = backfill ? days : days.filter((d) => d.day >= addDays(today, -7));
    const r = deviRows(keep, ts);
    await upsert(db, r);
    rows += r.length;
  })().catch((e: Error) => errors.push(`devi: ${e.message}`));

  await Promise.all([uae, devi]);
  clearTimeout(timer);
  const ok = errors.length === 0;
  const error = ok ? null : errors.join("; ").slice(0, 300);
  if (error) console.warn(`[gold] ${error}`);
  await db
    .insert(schema.ingestRuns)
    .values({ job: "gold", exchange: null, ts, durationMs: Date.now() - start, ok, rows, error })
    .catch(() => undefined);
  return { job: "gold" as const, ok, rows, error };
}
