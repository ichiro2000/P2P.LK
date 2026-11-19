import "server-only";
import { and, asc, eq, gte, sql } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { SLT_OFFSET_SEC } from "@/lib/constants";
import { addDays, sltDate } from "./http";
import type { FxRateType } from "./types";

/** ── Reads for /rates and /api/rates/* ─────────────────────────────────── */

export type LatestRate = {
  source: string;
  currency: string;
  type: FxRateType;
  value: number;
  asOf: string;
  /** The value on the previous stored day (for daily change), if any. */
  prev: number | null;
  prevAsOf: string | null;
};

/**
 * Latest (and previous) value per source × currency × type, looking back
 * `days` days. One query with a window function — a few hundred rows.
 */
export async function latestRates(opts: { currency?: string; type?: FxRateType; days?: number } = {}) {
  const db = await getDb();
  const since = addDays(sltDate(new Date()), -(opts.days ?? 21));
  const f = schema.fxRates;
  const where = [gte(f.asOf, since)];
  if (opts.currency) where.push(eq(f.currency, opts.currency));
  if (opts.type) where.push(eq(f.rateType, opts.type));
  const ranked = db
    .select({
      source: f.source,
      currency: f.currency,
      type: f.rateType,
      value: f.value,
      asOf: f.asOf,
      rn: sql<number>`row_number() over (partition by ${f.source}, ${f.currency}, ${f.rateType} order by ${f.asOf} desc)`.as("rn"),
    })
    .from(f)
    .where(and(...where))
    .as("ranked");
  const rows = await db.select().from(ranked).where(sql`${ranked.rn} <= 2`);

  const out = new Map<string, LatestRate>();
  // rn 1 first so the map holds the latest; rn 2 then fills `prev`.
  rows.sort((a, b) => Number(a.rn) - Number(b.rn));
  for (const r of rows) {
    const key = `${r.source}|${r.currency}|${r.type}`;
    const cur = out.get(key);
    if (!cur) {
      out.set(key, { source: r.source, currency: r.currency, type: r.type, value: r.value, asOf: r.asOf, prev: null, prevAsOf: null });
    } else if (cur.prev == null) {
      cur.prev = r.value;
      cur.prevAsOf = r.asOf;
    }
  }
  return [...out.values()];
}

export type SeriesPoint = { day: string; value: number };

/** Daily series for one source × currency × type since `sinceDay` (inclusive). */
export async function rateSeries(
  source: string,
  currency: string,
  type: FxRateType,
  sinceDay?: string,
): Promise<SeriesPoint[]> {
  const db = await getDb();
  const f = schema.fxRates;
  const where = [eq(f.source, source), eq(f.currency, currency), eq(f.rateType, type)];
  if (sinceDay) where.push(gte(f.asOf, sinceDay));
  const rows = await db
    .select({ day: f.asOf, value: f.value })
    .from(f)
    .where(and(...where))
    .orderBy(asc(f.asOf));
  return rows;
}

/** Every source's values for one currency over the last `days` days
 *  (sparklines in the bank table). */
export async function currencyHistory(currency: string, days = 14) {
  const db = await getDb();
  const f = schema.fxRates;
  const since = addDays(sltDate(new Date()), -(days - 1));
  return db
    .select({ source: f.source, type: f.rateType, day: f.asOf, value: f.value })
    .from(f)
    .where(and(eq(f.currency, currency), gte(f.asOf, since)))
    .orderBy(asc(f.asOf));
}

/** Best bank TT buying rate (max across banks, CBSL excluded) per day. */
export async function bestBankTtBuyByDay(currency: string, sinceDay: string) {
  const db = await getDb();
  const f = schema.fxRates;
  const rows = await db
    .select({ day: f.asOf, value: sql<number>`max(${f.value})` })
    .from(f)
    .where(
      and(
        eq(f.currency, currency),
        eq(f.rateType, "tt_buy"),
        gte(f.asOf, sinceDay),
        sql`${f.source} not like 'cbsl%'`,
      ),
    )
    .groupBy(f.asOf)
    .orderBy(asc(f.asOf));
  return rows.map((r) => ({ day: r.day, value: Number(r.value) }));
}

/** Lowest bank TT selling rate per day (what the cheapest bank charges for a
 *  dollar) — the like-for-like reference for *buying* USDT. */
export async function bestBankTtSellByDay(currency: string, sinceDay: string) {
  const db = await getDb();
  const f = schema.fxRates;
  const rows = await db
    .select({ day: f.asOf, value: sql<number>`min(${f.value})` })
    .from(f)
    .where(
      and(
        eq(f.currency, currency),
        eq(f.rateType, "tt_sell"),
        gte(f.asOf, sinceDay),
        sql`${f.source} not like 'cbsl%'`,
      ),
    )
    .groupBy(f.asOf)
    .orderBy(asc(f.asOf));
  return rows.map((r) => ({ day: r.day, value: Number(r.value) }));
}

export type P2PDay = { exchange: string; day: string; mid: number | null; bid: number | null; ask: number | null };

/** Daily USDT/LKR P2P averages (SLT days) from the hourly rollups. */
export async function p2pDaily(sinceDay: string): Promise<P2PDay[]> {
  const db = await getDb();
  const h = schema.marketHourly;
  const m = schema.marketSnapshots;
  const sinceTs = Date.parse(`${sinceDay}T00:00:00Z`) / 1000 - SLT_OFFSET_SEC;
  // Raw minute snapshots (kept 14 days) give exact SLT days; the hourly
  // rollups are UTC-aligned, so an SLT day boundary falls mid-hour there
  // (DATA-AUDIT F25). Use raw for the recent window, rollups before it.
  const rawFrom = Math.max(sinceTs, Math.floor(Date.now() / 1000) - 13 * 86400);
  const rawFromDay = new Date((rawFrom + SLT_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
  const rawStart = Date.parse(`${rawFromDay}T00:00:00Z`) / 1000 - SLT_OFFSET_SEC; // whole SLT day
  const OFF = sql.raw(String(SLT_OFFSET_SEC));
  const hDay = sql<string>`date(${h.hourTs} + ${OFF}, 'unixepoch')`;
  const mDay = sql<string>`date(${m.ts} + ${OFF}, 'unixepoch')`;
  const w = (col: unknown) => sql<number | null>`sum(${col} * ${h.samples}) / nullif(sum(case when ${col} is not null then ${h.samples} end), 0)`;
  const [old, recent] = await Promise.all([
    db
      .select({ exchange: h.exchange, day: hDay, mid: w(h.avgMid), bid: w(h.avgBestBid), ask: w(h.avgBestAsk) })
      .from(h)
      .where(and(eq(h.asset, "USDT"), eq(h.fiat, "LKR"), gte(h.hourTs, sinceTs), sql`${h.hourTs} < ${rawStart}`))
      .groupBy(h.exchange, hDay),
    db
      .select({
        exchange: m.exchange,
        day: mDay,
        mid: sql<number | null>`avg(${m.mid})`,
        bid: sql<number | null>`avg(${m.bestBid})`,
        ask: sql<number | null>`avg(${m.bestAsk})`,
      })
      .from(m)
      .where(and(eq(m.asset, "USDT"), eq(m.fiat, "LKR"), gte(m.ts, rawStart)))
      .groupBy(m.exchange, mDay),
  ]);
  const n = (v: unknown) => (v == null ? null : Number(v));
  return [...old, ...recent]
    .map((r) => ({ exchange: r.exchange, day: r.day, mid: n(r.mid), bid: n(r.bid), ask: n(r.ask) }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export type SourceHealth = { source: string; lastOkTs: number | null; lastTs: number; lastOk: boolean; error: string | null };

/** Latest collector run per FX source (ingest_runs keeps 7 days). */
export async function fxSourceHealth(): Promise<SourceHealth[]> {
  const db = await getDb();
  const r = schema.ingestRuns;
  const rows = await db
    .select({
      source: r.exchange,
      lastTs: sql<number>`max(${r.ts})`,
      lastOkTs: sql<number | null>`max(case when ${r.ok} = 1 then ${r.ts} end)`,
    })
    .from(r)
    .where(eq(r.job, "fx"))
    .groupBy(r.exchange);
  const last = await db
    .select({ source: r.exchange, ts: r.ts, ok: r.ok, error: r.error })
    .from(r)
    .where(and(eq(r.job, "fx"), sql`${r.id} in (select max(id) from ingest_runs where job = 'fx' group by exchange)`));
  const lastBy = new Map(last.map((l) => [l.source, l]));
  return rows
    .filter((x): x is typeof x & { source: string } => x.source != null)
    .map((x) => ({
      source: x.source,
      lastTs: Number(x.lastTs),
      lastOkTs: x.lastOkTs == null ? null : Number(x.lastOkTs),
      lastOk: lastBy.get(x.source)?.ok ?? false,
      error: lastBy.get(x.source)?.error ?? null,
    }));
}

/** CBSL indicative values for several currencies since `sinceDay`. */
export async function cbslIndicativeSince(currencies: string[], sinceDay: string) {
  const db = await getDb();
  const f = schema.fxRates;
  return db
    .select({ currency: f.currency, day: f.asOf, value: f.value })
    .from(f)
    .where(
      and(
        eq(f.source, "cbsl"),
        eq(f.rateType, "indicative"),
        gte(f.asOf, sinceDay),
        sql`${f.currency} in (${sql.join(currencies.map((c) => sql`${c}`), sql`, `)})`,
      ),
    )
    .orderBy(asc(f.asOf));
}
