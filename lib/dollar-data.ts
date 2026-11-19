import { and, asc, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db/client";
import { ASSET, FIAT } from "@/lib/constants";
import type { ExchangeId } from "@/lib/exchanges";
import type { DayPoint, FxPoint, MidPoint } from "@/lib/dollar-signals";

/**
 * D1 reads behind the dollar-vs-USDT maths. Each takes the Db so both the
 * risk page (getDb) and the cron alert engine (binding) can use them.
 */

const GOOGLE = "google";
const PAIR = "USD/LKR";
/** USDT mids are averaged into 5-minute buckets. */
const MID_BUCKET_SEC = 300;

/** Google USD/LKR readings since `sinceTs`, oldest first. */
export async function loadGoogle(db: Db, sinceTs: number): Promise<FxPoint[]> {
  const f = schema.fxIntraday;
  const rows = await db
    .select({ ts: f.ts, value: f.value })
    .from(f)
    .where(and(eq(f.pair, PAIR), eq(f.source, GOOGLE), gte(f.ts, sinceTs)))
    .orderBy(asc(f.ts));
  return rows.map((r) => ({ ts: Number(r.ts), value: Number(r.value) }));
}

/**
 * USDT/LKR mid per exchange in 5-minute buckets since `sinceTs`. Each point
 * is labelled with the LAST snapshot time in its bucket, so a mid at `ts`
 * never contains data from after `ts`. One GROUP BY query.
 */
export async function loadMids(
  db: Db,
  exchanges: readonly ExchangeId[],
  sinceTs: number,
): Promise<Record<ExchangeId, MidPoint[]>> {
  const m = schema.marketSnapshots;
  // D1 binds JS numbers as REAL; inline the integer so `ts / 300` divides as integers.
  const B = sql.raw(String(MID_BUCKET_SEC));
  const rows = await db
    .select({
      exchange: m.exchange,
      b: sql<number>`(${m.ts} / ${B})`.as("b"),
      ts: sql<number>`max(${m.ts})`,
      mid: sql<number | null>`avg(${m.mid})`,
    })
    .from(m)
    .where(and(inArray(m.exchange, [...exchanges]), eq(m.asset, ASSET), eq(m.fiat, FIAT.code), gte(m.ts, sinceTs), sql`${m.mid} > 0`))
    .groupBy(m.exchange, sql`b`)
    .orderBy(asc(sql`b`));
  const out = Object.fromEntries(exchanges.map((e) => [e, [] as MidPoint[]])) as Record<ExchangeId, MidPoint[]>;
  for (const r of rows) {
    if (r.mid == null) continue;
    out[r.exchange]?.push({ ts: Number(r.ts), mid: Number(r.mid) });
  }
  for (const e of exchanges) out[e].sort((a, b) => a.ts - b.ts);
  return out;
}

/** CBSL indicative USD/LKR per business day since `sinceDay`, oldest first.
 *  `fetchedAt` is when that day's value was first seen (or last revised). */
export async function loadCbsl(db: Db, sinceDay: string): Promise<(DayPoint & { fetchedAt: number })[]> {
  const f = schema.fxRates;
  const rows = await db
    .select({ day: f.asOf, value: f.value, fetchedAt: f.fetchedAt })
    .from(f)
    .where(and(eq(f.source, "cbsl"), eq(f.currency, "USD"), eq(f.rateType, "indicative"), gte(f.asOf, sinceDay)))
    .orderBy(asc(f.asOf));
  return rows.map((r) => ({ day: r.day, value: Number(r.value), fetchedAt: Number(r.fetchedAt) }));
}

/** The last two CBSL indicative days (cron: cheap, indexed by the PK). */
export async function loadCbslLatest(db: Db): Promise<(DayPoint & { fetchedAt: number })[]> {
  const f = schema.fxRates;
  const rows = await db
    .select({ day: f.asOf, value: f.value, fetchedAt: f.fetchedAt })
    .from(f)
    .where(and(eq(f.source, "cbsl"), eq(f.currency, "USD"), eq(f.rateType, "indicative")))
    .orderBy(desc(f.asOf))
    .limit(2);
  return rows.map((r) => ({ day: r.day, value: Number(r.value), fetchedAt: Number(r.fetchedAt) })).reverse();
}
