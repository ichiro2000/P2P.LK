import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema, type Db } from "./client";
import type { ExchangeId } from "@/lib/exchanges";
import { refreshProfiles } from "@/lib/ingest/profiles";
import {
  BUCKETS,
  MAX_GAP_DAYS,
  bucketLabel,
  bucketRange,
  bucketize,
  cumulativeToSpans,
  growth,
  periodGrowth,
  spreadSpans,
  sltDay,
  type Bucket,
  type DayAgg,
  type Period,
  type PeriodGrowth,
} from "@/lib/trade-trend";
import type { MerchantProfileRow } from "./schema";

/**
 * Reads for merchant "Trade Info" (merchant_profiles) and buy/sell trade
 * trends (merchant_trade_daily). The maths lives in lib/trade-trend.ts; the
 * market-wide SQL below mirrors `cumulativeToSpans` + `spreadSpans`.
 *
 * Binance counts are ALL fiat markets a merchant trades, not LKR only.
 */

/* ── One merchant ──────────────────────────────────────────────────────── */

export type TrendBucket = Bucket & { label: string };
export type TrendSet = Record<Period, { buckets: TrendBucket[]; growth: PeriodGrowth<TrendBucket> | null }>;

export function trendSet(days: ReadonlyMap<number, DayAgg>, today: number): TrendSet {
  const one = (p: Period) => {
    const buckets = bucketize(days, p, today).map((b) => ({ ...b, label: bucketLabel(p, b.start) }));
    return { buckets, growth: periodGrowth(buckets) };
  };
  return { day: one("day"), week: one("week"), month: one("month") };
}

export async function merchantProfile(ex: ExchangeId, id: string): Promise<MerchantProfileRow | null> {
  const db = await getDb();
  const p = schema.merchantProfiles;
  const [row] = await db
    .select()
    .from(p)
    .where(and(eq(p.exchange, ex), eq(p.merchantId, id)))
    .limit(1);
  return row ?? null;
}

/**
 * The stored profile, fetching it once on demand when this Binance merchant
 * was never collected. Bounded: `timeoutMs` per request, and any outcome
 * (even a failure) writes a row, so a merchant is fetched on demand at most
 * once; after that the collector owns it.
 */
export async function ensureMerchantProfile(
  ex: ExchangeId,
  id: string,
  timeoutMs = 1800,
): Promise<MerchantProfileRow | null> {
  const row = await merchantProfile(ex, id);
  if (row || ex !== "binance") return row;
  const db = await getDb();
  await refreshProfiles(db, [id], Math.floor(Date.now() / 1000), { timeoutMs, delayMs: 0 });
  return merchantProfile(ex, id);
}

/** Daily trend for one merchant (all three periods, built from ≤ 400 rows). */
export async function merchantTradeTrend(ex: ExchangeId, id: string, nowTs = Math.floor(Date.now() / 1000)) {
  const db = await getDb();
  const t = schema.merchantTradeDaily;
  const today = sltDay(nowTs);
  const rows = await db
    .select({ day: t.day, buy: t.completedBuy, sell: t.completedSell, lastTs: t.lastTs })
    .from(t)
    .where(and(eq(t.exchange, ex), eq(t.merchantId, id), gte(t.day, today - 400)))
    .orderBy(t.day);
  const days = spreadSpans(cumulativeToSpans(rows));
  return { trend: trendSet(days, today), storedDays: rows.length, firstDay: rows[0]?.day ?? null, today };
}

/* ── Directory inputs ──────────────────────────────────────────────────── */

export type ProfileStats = {
  avgReleaseSec: number | null;
  positive: number | null;
  negative: number | null;
  positiveRate: number | null;
  registerDays: number | null;
};

/** Profile fields the directory and score use, for every collected merchant. */
export async function profileStatsMap(ex: ExchangeId, ids?: string[]): Promise<Map<string, ProfileStats>> {
  if (ex !== "binance" || ids?.length === 0) return new Map();
  const db = await getDb();
  const p = schema.merchantProfiles;
  const rows = await db
    .select({
      id: p.merchantId,
      orders30d: p.orders30d,
      avgReleaseSec: p.avgReleaseSec,
      positive: p.positive,
      negative: p.negative,
      positiveRate: p.positiveRate,
      registerDays: p.registerDays,
      okAt: p.okAt,
    })
    .from(p)
    .where(and(eq(p.exchange, ex), ids ? inArray(p.merchantId, ids.slice(0, 90)) : undefined));
  const now = Math.floor(Date.now() / 1000);
  return new Map(
    rows
      .filter((r) => r.okAt != null)
      .map((r) => [
        r.id,
        {
          avgReleaseSec: profileReleaseSec(r),
          positive: r.positive,
          negative: r.negative,
          positiveRate: r.positiveRate,
          // Stored days age with the row; add the days since it was fetched.
          registerDays: r.registerDays != null ? r.registerDays + Math.floor((now - (r.okAt ?? now)) / 86400) : null,
        },
      ]),
  );
}

/** Binance reports 0 s release when there were no orders in 30 days: unknown, not instant. */
export function profileReleaseSec(p: { orders30d: number | null; avgReleaseSec: number | null }) {
  return p.avgReleaseSec != null && p.avgReleaseSec > 0 && (p.orders30d ?? 0) > 0 ? p.avgReleaseSec : null;
}

/* ── Market-wide activity ──────────────────────────────────────────────── */

/** Minimum trades in the previous 7 days to rank a merchant's growth. */
export const MOVERS_MIN_BASE = 50;
const MOVERS_N = 8;

type DayRow = { day: number; buy: number; sell: number; merchants: number; est: number };
type WindowRow = { id: string; bkt: number; buy: number; sell: number; days: number };

const int = (n: number) => sql.raw(String(Math.trunc(n)));

/** Per-merchant differences between consecutive stored days, spread over
 *  their days (k = 0..span−1), for days in [from, to]. Same rules as
 *  cumulativeToSpans + spreadSpans (spike rows dropped, resets and gaps
 *  over MAX_GAP_DAYS skipped). Callers filter on `dd`. Integers are inlined: D1 binds JS numbers
 *  as REAL. */
const spreadCte = (from: number, to: number) => sql`
  WITH r AS (
    SELECT merchant_id, day, completed_buy AS b, completed_sell AS s,
      lag(completed_buy) OVER w AS b0, lag(completed_sell) OVER w AS s0,
      lead(completed_buy) OVER w AS b1, lead(completed_sell) OVER w AS s1
    FROM merchant_trade_daily
    WHERE exchange = 'binance' AND day BETWEEN ${int(from - 2 * MAX_GAP_DAYS)} AND ${int(to + MAX_GAP_DAYS)}
    WINDOW w AS (PARTITION BY merchant_id ORDER BY day)
  ),
  c AS (
    SELECT merchant_id, day, b, s FROM r
    WHERE NOT coalesce(b1 < b AND b1 >= b0, 0) AND NOT coalesce(s1 < s AND s1 >= s0, 0)
  ),
  d AS (
    SELECT merchant_id, day, b, s,
      lag(day) OVER w AS pd, lag(b) OVER w AS pb, lag(s) OVER w AS ps
    FROM c
    WINDOW w AS (PARTITION BY merchant_id ORDER BY day)
  ),
  sp AS (
    SELECT merchant_id, day, day - pd AS span, b - pb AS db, s - ps AS ds
    FROM d
    WHERE pd IS NOT NULL AND day - pd BETWEEN 1 AND ${int(MAX_GAP_DAYS)}
      AND b IS NOT NULL AND s IS NOT NULL AND pb IS NOT NULL AND ps IS NOT NULL
      AND b >= pb AND s >= ps
  ),
  k(n) AS (VALUES (0), (1), (2), (3), (4), (5), (6)),
  x AS (
    SELECT sp.merchant_id, sp.day - k.n AS dd, sp.span,
      sp.db * 1.0 / sp.span AS vb, sp.ds * 1.0 / sp.span AS vs
    FROM sp JOIN k ON k.n < sp.span
  )`;

async function marketDays(db: Db, from: number, to: number): Promise<Map<number, DayAgg>> {
  const rows = await db.all<DayRow>(sql`
    ${spreadCte(from, to)}
    SELECT dd AS day, sum(vb) AS buy, sum(vs) AS sell, count(DISTINCT merchant_id) AS merchants,
      sum(CASE WHEN span > 1 THEN vb + vs ELSE 0 END) AS est
    FROM x WHERE dd BETWEEN ${int(from)} AND ${int(to)}
    GROUP BY dd`);
  return new Map(
    rows.map((r) => [
      Number(r.day),
      { buy: Number(r.buy), sell: Number(r.sell), merchants: Number(r.merchants), estimated: Number(r.est) },
    ]),
  );
}

/** Per merchant: trades in [prev] (bkt 0) and [cur] (bkt 1), with days covered. */
async function merchantWindows(db: Db, prev: [number, number], cur: [number, number]) {
  const rows = await db.all<WindowRow>(sql`
    ${spreadCte(prev[0], cur[1])}
    SELECT merchant_id AS id,
      CASE WHEN dd >= ${int(cur[0])} THEN 1 ELSE 0 END AS bkt,
      sum(vb) AS buy, sum(vs) AS sell, count(DISTINCT dd) AS days
    FROM x WHERE dd BETWEEN ${int(prev[0])} AND ${int(cur[1])}
    GROUP BY merchant_id, bkt`);
  const lenPrev = prev[1] - prev[0] + 1;
  const lenCur = cur[1] - cur[0] + 1;
  const by = new Map<string, { prev?: WindowRow; cur?: WindowRow }>();
  for (const r of rows) {
    const e = by.get(r.id) ?? {};
    if (Number(r.bkt) === 1) e.cur = r;
    else e.prev = r;
    by.set(r.id, e);
  }
  // Matched set: merchants with every day of BOTH windows covered, so a
  // merchant we started tracking mid-way never reads as growth.
  const matched: { id: string; prev: WindowRow; cur: WindowRow }[] = [];
  for (const [id, e] of by) {
    if (e.prev && e.cur && Number(e.prev.days) === lenPrev && Number(e.cur.days) === lenCur)
      matched.push({ id, prev: e.prev, cur: e.cur });
  }
  return matched;
}

export type Mover = {
  id: string;
  name: string;
  /** Trades in the previous / latest 7 complete days. */
  prev: number;
  cur: number;
  growth: number;
  /** Latest 7 days, merchant's own side. */
  buy: number;
  sell: number;
};

export type MarketActivity = {
  period: Period;
  /** SLT day number of today. */
  today: number;
  /** Binance merchants with a collected profile (the "N" in the label). */
  tracked: number;
  /** Profiles refreshed in the last 3 hours. */
  freshProfiles: number;
  buckets: TrendBucket[];
  /** Latest complete period vs the one before, over merchants covered in both. */
  growth: {
    current: { start: number; end: number; label: string; buy: number; sell: number };
    previous: { start: number; end: number; label: string; buy: number; sell: number };
    total: number | null;
    buy: number | null;
    sell: number | null;
    matched: number;
  } | null;
  /** Σ Binance 30-day buy / sell over tracked merchants (their own sides). */
  split30d: { buy: number; sell: number; merchants: number } | null;
  movers: {
    minBase: number;
    window: { prev: [number, number]; cur: [number, number] };
    rising: Mover[];
    falling: Mover[];
    eligible: number;
  };
};

export async function marketActivity(period: Period, nowTs = Math.floor(Date.now() / 1000)): Promise<MarketActivity> {
  const db = await getDb();
  const today = sltDay(nowTs);
  let from = bucketRange(period, today)[0];
  for (let i = 1; i < BUCKETS[period]; i++) from = bucketRange(period, from - 1)[0];

  const curP = bucketRange(period, bucketRange(period, today)[0] - 1);
  const prevP = bucketRange(period, curP[0] - 1);
  const moversCur: [number, number] = [today - 7, today - 1];
  const moversPrev: [number, number] = [today - 14, today - 8];

  const p = schema.merchantProfiles;
  const [days, matched, moverRows, [counts]] = await Promise.all([
    marketDays(db, from, today),
    merchantWindows(db, prevP, curP),
    merchantWindows(db, moversPrev, moversCur),
    db
      .select({
        tracked: sql<number>`count(*)`,
        fresh: sql<number>`sum(case when ${p.okAt} >= ${int(nowTs - 3 * 3600)} then 1 else 0 end)`,
        buy: sql<number | null>`sum(case when ${p.okAt} >= ${int(nowTs - 86400)} then ${p.buy30d} end)`,
        sell: sql<number | null>`sum(case when ${p.okAt} >= ${int(nowTs - 86400)} then ${p.sell30d} end)`,
        recent: sql<number>`sum(case when ${p.okAt} >= ${int(nowTs - 86400)} and ${p.buy30d} is not null then 1 else 0 end)`,
      })
      .from(p)
      .where(and(eq(p.exchange, "binance"), sql`${p.okAt} IS NOT NULL`)),
  ]);

  const buckets = bucketize(days, period, today).map((b) => ({ ...b, label: bucketLabel(period, b.start) }));

  const sum = (xs: typeof matched, k: "prev" | "cur", side: "buy" | "sell") =>
    xs.reduce((s, m) => s + Number(m[k][side]), 0);
  const g =
    matched.length > 0
      ? (() => {
          const cur = { buy: sum(matched, "cur", "buy"), sell: sum(matched, "cur", "sell") };
          const prev = { buy: sum(matched, "prev", "buy"), sell: sum(matched, "prev", "sell") };
          return {
            current: { start: curP[0], end: curP[1], label: bucketLabel(period, curP[0]), ...cur },
            previous: { start: prevP[0], end: prevP[1], label: bucketLabel(period, prevP[0]), ...prev },
            total: growth(cur.buy + cur.sell, prev.buy + prev.sell),
            buy: growth(cur.buy, prev.buy),
            sell: growth(cur.sell, prev.sell),
            matched: matched.length,
          };
        })()
      : null;

  // Movers: 7 complete days vs the 7 before, minimum base to skip tiny samples.
  const eligible = moverRows
    .map((m) => {
      const prev = Number(m.prev.buy) + Number(m.prev.sell);
      const cur = Number(m.cur.buy) + Number(m.cur.sell);
      return { id: m.id, prev, cur, buy: Number(m.cur.buy), sell: Number(m.cur.sell), growth: growth(cur, prev) };
    })
    .filter((m): m is Omit<Mover, "name"> => m.prev >= MOVERS_MIN_BASE && m.growth != null);
  const rising = [...eligible].filter((m) => m.growth > 0).sort((a, b) => b.growth - a.growth).slice(0, MOVERS_N);
  const falling = [...eligible].filter((m) => m.growth < 0).sort((a, b) => a.growth - b.growth).slice(0, MOVERS_N);
  const names = await moverNames(db, [...rising, ...falling].map((m) => m.id));
  const named = (xs: Omit<Mover, "name">[]) => xs.map((m) => ({ ...m, name: names.get(m.id) ?? m.id }));

  return {
    period,
    today,
    tracked: Number(counts?.tracked ?? 0),
    freshProfiles: Number(counts?.fresh ?? 0),
    buckets,
    growth: g,
    split30d:
      counts?.buy != null && counts?.sell != null
        ? { buy: Number(counts.buy), sell: Number(counts.sell), merchants: Number(counts.recent ?? 0) }
        : null,
    movers: {
      minBase: MOVERS_MIN_BASE,
      window: { prev: moversPrev, cur: moversCur },
      rising: named(rising),
      falling: named(falling),
      eligible: eligible.length,
    },
  };
}

async function moverNames(db: Db, ids: string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map();
  const m = schema.merchants;
  const rows = await db
    .select({ id: m.merchantId, name: m.merchantName })
    .from(m)
    .where(and(eq(m.exchange, "binance"), sql`${m.merchantId} IN (${sql.join(ids.map((i) => sql`${i}`), sql`, `)})`))
    .orderBy(desc(m.lastSeenTs));
  const out = new Map<string, string>();
  for (const r of rows) if (!out.has(r.id)) out.set(r.id, r.name);
  return out;
}
