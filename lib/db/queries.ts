import { and, asc, desc, eq, gte, max, sql } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { MerchantRow, MerchantSnapshotRow } from "./schema";
import type { ExchangeId } from "@/lib/exchanges";
import { SLT_OFFSET_SEC } from "@/lib/constants";

/** ── Time ranges ─────────────────────────────────────────────────────── */

export const RANGES = {
  "1h": 60 * 60,
  "6h": 6 * 60 * 60,
  "24h": 24 * 60 * 60,
  "7d": 7 * 24 * 60 * 60,
  "30d": 30 * 24 * 60 * 60,
} as const;

export type RangeKey = keyof typeof RANGES;

/** Safe parse — `"constructor" in RANGES` is true, so never use `in`. */
export function parseRange(v: unknown, fallback: RangeKey = "24h"): RangeKey {
  return typeof v === "string" && Object.hasOwn(RANGES, v) ? (v as RangeKey) : fallback;
}

export function rangeSinceSeconds(range: RangeKey): number {
  return Math.floor(Date.now() / 1000) - RANGES[range];
}

/** Chart resolution per range — keeps every series ≤ ~720 points. */
const BUCKET_SEC: Record<RangeKey, number> = {
  "1h": 60,
  "6h": 60,
  "24h": 300,
  "7d": 3600,
  "30d": 3600,
};

/** Ranges that read raw rows; longer ones read the hourly rollups. */
const isShort = (r: RangeKey) => RANGES[r] <= RANGES["24h"];

/** ── Market ──────────────────────────────────────────────────────────── */

/** One point of a market time-series (raw tick, 5-min bucket or hour). */
export type MarketPoint = {
  ts: number;
  bestBid: number | null;
  bestAsk: number | null;
  mid: number | null;
  spread: number | null;
  spreadPct: number | null;
  medianBid: number | null;
  medianAsk: number | null;
  vwapBid: number | null;
  vwapAsk: number | null;
  bidCount: number | null;
  askCount: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  bidDepthFiat: number | null;
  askDepthFiat: number | null;
  /** Near-touch depth per side (see the glossary in lib/db/schema): USDT
   *  within 0.5 % / 1 % of that side's best price, and LKR for 1 %. Null on
   *  rows written before migration 0005. */
  bidDepth05: number | null;
  askDepth05: number | null;
  bidDepth1: number | null;
  askDepth1: number | null;
  bidDepth05Fiat: number | null;
  askDepth05Fiat: number | null;
  bidDepth1Fiat: number | null;
  askDepth1Fiat: number | null;
  /** Best prices of the verified-merchant book at the same tick. */
  merchantBestBid: number | null;
  merchantBestAsk: number | null;
  /** Only set for hourly points. */
  high?: number | null;
  low?: number | null;
  open?: number | null;
  close?: number | null;
};

const n = (v: unknown) => (v == null ? null : Number(v));

export async function listMarketSnapshots(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  range: RangeKey,
): Promise<MarketPoint[]> {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  const bucket = BUCKET_SEC[range];

  if (!isShort(range)) {
    const rows = await db
      .select()
      .from(schema.marketHourly)
      .where(
        and(
          eq(schema.marketHourly.exchange, ex),
          eq(schema.marketHourly.asset, asset),
          eq(schema.marketHourly.fiat, fiat),
          gte(schema.marketHourly.hourTs, since - (since % 3600)),
        ),
      )
      .orderBy(asc(schema.marketHourly.hourTs));
    return rows.map((r) => {
      const spread =
        r.avgBestAsk != null && r.avgBestBid != null ? r.avgBestAsk - r.avgBestBid : null;
      return {
        ts: r.hourTs,
        bestBid: r.avgBestBid,
        bestAsk: r.avgBestAsk,
        mid: r.avgMid,
        spread,
        spreadPct: r.avgSpreadPct,
        medianBid: null,
        medianAsk: null,
        vwapBid: null,
        vwapAsk: null,
        bidCount: r.avgBidCount != null ? Math.round(r.avgBidCount) : null,
        askCount: r.avgAskCount != null ? Math.round(r.avgAskCount) : null,
        bidDepth: r.avgBidDepth,
        askDepth: r.avgAskDepth,
        bidDepthFiat: r.avgBidDepthFiat,
        askDepthFiat: r.avgAskDepthFiat,
        bidDepth05: r.bidDepth05,
        askDepth05: r.askDepth05,
        bidDepth1: r.bidDepth1,
        askDepth1: r.askDepth1,
        bidDepth05Fiat: r.bidDepth05Fiat,
        askDepth05Fiat: r.askDepth05Fiat,
        bidDepth1Fiat: r.bidDepth1Fiat,
        askDepth1Fiat: r.askDepth1Fiat,
        merchantBestBid: r.avgMerchantBestBid,
        merchantBestAsk: r.avgMerchantBestAsk,
        high: r.highMid,
        low: r.lowMid,
        open: r.openMid,
        close: r.closeMid,
      };
    });
  }

  if (bucket === 60) {
    const rows = await db
      .select()
      .from(schema.marketSnapshots)
      .where(
        and(
          eq(schema.marketSnapshots.exchange, ex),
          eq(schema.marketSnapshots.asset, asset),
          eq(schema.marketSnapshots.fiat, fiat),
          gte(schema.marketSnapshots.ts, since),
        ),
      )
      .orderBy(asc(schema.marketSnapshots.ts));
    return rows.map(({ id: _id, exchange: _e, asset: _a, fiat: _f, ...p }) => p);
  }

  const m = schema.marketSnapshots;
  // D1 binds JS numbers as REAL: `ts / ?` would be float division and never
  // group anything. BUCKET_SEC values are fixed integers, so inline them.
  const B = sql.raw(String(Math.trunc(bucket)));
  const rows = await db
    .select({
      ts: sql<number>`(${m.ts} / ${B}) * ${B}`,
      bestBid: sql<number>`avg(${m.bestBid})`,
      bestAsk: sql<number>`avg(${m.bestAsk})`,
      mid: sql<number>`avg(${m.mid})`,
      spread: sql<number>`avg(${m.spread})`,
      spreadPct: sql<number>`avg(${m.spreadPct})`,
      medianBid: sql<number>`avg(${m.medianBid})`,
      medianAsk: sql<number>`avg(${m.medianAsk})`,
      vwapBid: sql<number>`avg(${m.vwapBid})`,
      vwapAsk: sql<number>`avg(${m.vwapAsk})`,
      bidCount: sql<number>`round(avg(${m.bidCount}))`,
      askCount: sql<number>`round(avg(${m.askCount}))`,
      bidDepth: sql<number>`avg(${m.bidDepth})`,
      askDepth: sql<number>`avg(${m.askDepth})`,
      bidDepthFiat: sql<number>`avg(${m.bidDepthFiat})`,
      askDepthFiat: sql<number>`avg(${m.askDepthFiat})`,
      bidDepth05: sql<number>`avg(${m.bidDepth05})`,
      askDepth05: sql<number>`avg(${m.askDepth05})`,
      bidDepth1: sql<number>`avg(${m.bidDepth1})`,
      askDepth1: sql<number>`avg(${m.askDepth1})`,
      bidDepth05Fiat: sql<number>`avg(${m.bidDepth05Fiat})`,
      askDepth05Fiat: sql<number>`avg(${m.askDepth05Fiat})`,
      bidDepth1Fiat: sql<number>`avg(${m.bidDepth1Fiat})`,
      askDepth1Fiat: sql<number>`avg(${m.askDepth1Fiat})`,
      merchantBestBid: sql<number>`avg(${m.merchantBestBid})`,
      merchantBestAsk: sql<number>`avg(${m.merchantBestAsk})`,
    })
    .from(m)
    .where(and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat), gte(m.ts, since)))
    .groupBy(sql`${m.ts} / ${B}`)
    .orderBy(sql`1`);
  return rows.map((r) => Object.fromEntries(Object.entries(r).map(([k, v]) => [k, n(v)])) as MarketPoint);
}

/** Data older than this is shown as stale, not live (F24). */
export const STALE_AFTER_SEC = 10 * 60;

/** Age in seconds of a unix-seconds timestamp, and whether it is stale. */
export function freshness(
  ts: number | null | undefined,
  nowSec = Math.floor(Date.now() / 1000),
  staleAfterSec = STALE_AFTER_SEC,
) {
  if (ts == null) return { ts: null, ageSec: null, stale: true } as const;
  const ageSec = Math.max(0, nowSec - ts);
  return { ts, ageSec, stale: ageSec > staleAfterSec };
}

export async function latestMarketSnapshot(ex: ExchangeId, asset: string, fiat: string) {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.marketSnapshots)
    .where(
      and(
        eq(schema.marketSnapshots.exchange, ex),
        eq(schema.marketSnapshots.asset, asset),
        eq(schema.marketSnapshots.fiat, fiat),
      ),
    )
    .orderBy(desc(schema.marketSnapshots.ts))
    .limit(1);
  return row;
}

export type MarketSummary = {
  count: number;
  avgMid: number | null;
  minMid: number | null;
  maxMid: number | null;
  avgSpreadPct: number | null;
  avgBidDepth: number | null;
  avgAskDepth: number | null;
};

export async function marketSummary(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  range: RangeKey,
): Promise<MarketSummary> {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  if (isShort(range)) {
    const m = schema.marketSnapshots;
    const [r] = await db
      .select({
        count: sql<number>`count(*)`,
        avgMid: sql<number | null>`avg(${m.mid})`,
        minMid: sql<number | null>`min(${m.mid})`,
        maxMid: sql<number | null>`max(${m.mid})`,
        avgSpreadPct: sql<number | null>`avg(${m.spreadPct})`,
        avgBidDepth: sql<number | null>`avg(${m.bidDepth})`,
        avgAskDepth: sql<number | null>`avg(${m.askDepth})`,
      })
      .from(m)
      .where(and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat), gte(m.ts, since)));
    return { ...r, count: Number(r?.count ?? 0) };
  }
  const h = schema.marketHourly;
  const w = (col: unknown) => sql<number | null>`sum(${col} * ${h.samples}) / nullif(sum(${h.samples}), 0)`;
  const [r] = await db
    .select({
      count: sql<number>`coalesce(sum(${h.samples}), 0)`,
      avgMid: w(h.avgMid),
      minMid: sql<number | null>`min(${h.lowMid})`,
      maxMid: sql<number | null>`max(${h.highMid})`,
      avgSpreadPct: w(h.avgSpreadPct),
      avgBidDepth: w(h.avgBidDepth),
      avgAskDepth: w(h.avgAskDepth),
    })
    .from(h)
    .where(and(eq(h.exchange, ex), eq(h.asset, asset), eq(h.fiat, fiat), gte(h.hourTs, since)));
  return { ...r, count: Number(r?.count ?? 0) };
}

/** Markets with data in the range (asset/fiat pairs) for one exchange. */
export async function listTrackedMarkets(ex: ExchangeId, range: RangeKey = "24h") {
  const db = await getDb();
  const h = schema.marketHourly;
  const since = rangeSinceSeconds(range);
  return db
    .select({
      asset: h.asset,
      fiat: h.fiat,
      count: sql<number>`sum(${h.samples})`,
      lastTs: sql<number>`max(${h.hourTs})`,
    })
    .from(h)
    .where(and(eq(h.exchange, ex), gte(h.hourTs, since - (since % 3600))))
    .groupBy(h.asset, h.fiat)
    .orderBy(asc(h.asset), asc(h.fiat));
}

/** Raw market_snapshots are kept 14 days; SLT-exact grids read them. */
export const RAW_DAYS = 14;

/** One (SLT day, SLT hour) aggregate of raw snapshots. */
export type SltHourCell = {
  /** SLT day number: floor((ts + 5:30) / 86400). Weekday = (day + 4) % 7, 0 = Sunday. */
  day: number;
  /** SLT hour 0..23. */
  hour: number;
  samples: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadPct: number | null;
  /** Near-touch depth within 1 % (USDT) and the rows that carried it. */
  bidDepth1: number | null;
  askDepth1: number | null;
  depthSamples: number;
};

/**
 * Raw snapshots grouped by exact Sri Lanka hour (UTC+05:30) and day, for the
 * weekday × hour views (F25, D4). Bucketing is done in SQL on integers: the
 * offset and widths are inlined (D1 binds JS numbers as REAL, which would
 * turn `/` into float division).
 */
export async function sltHourCells(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  days = RAW_DAYS,
): Promise<SltHourCell[]> {
  const db = await getDb();
  const m = schema.marketSnapshots;
  const since = Math.floor(Date.now() / 1000) - Math.min(days, RAW_DAYS) * 86400;
  const OFF = sql.raw(String(Math.trunc(SLT_OFFSET_SEC)));
  const rows = await db
    .select({
      day: sql<number>`(${m.ts} + ${OFF}) / 86400`,
      hour: sql<number>`((${m.ts} + ${OFF}) % 86400) / 3600`,
      samples: sql<number>`count(*)`,
      bid: sql<number | null>`avg(${m.bestBid})`,
      ask: sql<number | null>`avg(${m.bestAsk})`,
      mid: sql<number | null>`avg(${m.mid})`,
      spreadPct: sql<number | null>`avg(${m.spreadPct})`,
      bidDepth1: sql<number | null>`avg(${m.bidDepth1})`,
      askDepth1: sql<number | null>`avg(${m.askDepth1})`,
      depthSamples: sql<number>`count(${m.askDepth1})`,
    })
    .from(m)
    .where(and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat), gte(m.ts, since), sql`${m.mid} IS NOT NULL`))
    .groupBy(sql`1`, sql`2`)
    .orderBy(sql`1`, sql`2`);
  return rows.map((r) => ({
    day: Number(r.day),
    hour: Number(r.hour),
    samples: Number(r.samples),
    bid: n(r.bid),
    ask: n(r.ask),
    mid: n(r.mid),
    spreadPct: n(r.spreadPct),
    bidDepth1: n(r.bidDepth1),
    askDepth1: n(r.askDepth1),
    depthSamples: Number(r.depthSamples),
  }));
}

export const sltWeekday = (sltDay: number) => (((sltDay + 4) % 7) + 7) % 7;

export type DepthHeatCell = {
  dow: number;
  hour: number;
  /** Mean near-touch depth within 1 %, USDT. */
  ask: number | null;
  bid: number | null;
  /** Minutes of data behind the cell, and how many distinct days. */
  count: number;
  days: number;
};

/**
 * Near-touch depth (within 1 % of each side's best) by weekday × hour in
 * exact Sri Lanka time, from the last 14 days of raw snapshots.
 */
export async function depthHeatmap(ex: ExchangeId, asset: string, fiat: string) {
  const rows = await sltHourCells(ex, asset, fiat);
  return depthHeatFromCells(rows);
}

export function depthHeatFromCells(rows: readonly SltHourCell[]) {
  const grid = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ a: 0, b: 0, n: 0, days: 0 })),
  );
  let totalPoints = 0;
  for (const r of rows) {
    if (!r.depthSamples || r.askDepth1 == null || r.bidDepth1 == null) continue;
    const c = grid[sltWeekday(r.day)][r.hour];
    c.a += r.askDepth1 * r.depthSamples;
    c.b += r.bidDepth1 * r.depthSamples;
    c.n += r.depthSamples;
    c.days += 1;
    totalPoints += r.depthSamples;
  }
  const cells: DepthHeatCell[] = [];
  let maxAsk = 0;
  let maxBid = 0;
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const c = grid[dow][hour];
      const ask = c.n ? c.a / c.n : null;
      const bid = c.n ? c.b / c.n : null;
      if (ask != null && ask > maxAsk) maxAsk = ask;
      if (bid != null && bid > maxBid) maxBid = bid;
      cells.push({ dow, hour, ask, bid, count: c.n, days: c.days });
    }
  }
  return { cells, maxAsk, maxBid, totalPoints };
}

export async function listMarketMids(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  range: RangeKey,
): Promise<Array<{ ts: number; mid: number | null }>> {
  const series = await listMarketSnapshots(ex, asset, fiat, range);
  return series.map((p) => ({ ts: p.ts, mid: p.mid }));
}

/** ── Merchants ───────────────────────────────────────────────────────── */

/** A point in a merchant's history (raw 10-min sweep or hourly rollup). */
export type MerchantPoint = Pick<
  MerchantSnapshotRow,
  | "ts"
  | "ordersMonth"
  | "completionRate"
  | "buyAds"
  | "sellAds"
  | "bestBuyPrice"
  | "bestSellPrice"
  | "totalAvailableFiat"
>;

export async function merchantHistory(
  ex: ExchangeId,
  merchantId: string,
  asset: string,
  fiat: string,
  range: RangeKey,
): Promise<MerchantPoint[]> {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  if (isShort(range)) {
    const s = schema.merchantSnapshots;
    return db
      .select({
        ts: s.ts,
        ordersMonth: s.ordersMonth,
        completionRate: s.completionRate,
        buyAds: s.buyAds,
        sellAds: s.sellAds,
        bestBuyPrice: s.bestBuyPrice,
        bestSellPrice: s.bestSellPrice,
        totalAvailableFiat: s.totalAvailableFiat,
      })
      .from(s)
      .where(
        and(
          eq(s.exchange, ex),
          eq(s.merchantId, merchantId),
          eq(s.asset, asset),
          eq(s.fiat, fiat),
          gte(s.ts, since),
        ),
      )
      .orderBy(asc(s.ts));
  }
  const h = schema.merchantHourly;
  return db
    .select({
      ts: h.hourTs,
      ordersMonth: h.ordersMonth,
      completionRate: h.completionRate,
      buyAds: h.maxBuyAds,
      sellAds: h.maxSellAds,
      bestBuyPrice: h.avgBuyPrice,
      bestSellPrice: h.avgSellPrice,
      totalAvailableFiat: h.maxAvailableFiat,
    })
    .from(h)
    .where(
      and(
        eq(h.exchange, ex),
        eq(h.merchantId, merchantId),
        eq(h.asset, asset),
        eq(h.fiat, fiat),
        gte(h.hourTs, since),
      ),
    )
    .orderBy(asc(h.hourTs));
}

/** Hours (with sweep counts) a merchant was listing — feeds the weekday ×
 *  hour activity heatmap. */
export async function merchantActivityHours(
  ex: ExchangeId,
  merchantId: string,
  asset: string,
  fiat: string,
  windowSec: number = RANGES["30d"],
): Promise<Array<{ ts: number; samples: number }>> {
  const db = await getDb();
  const h = schema.merchantHourly;
  const since = Math.floor(Date.now() / 1000) - windowSec;
  return db
    .select({ ts: h.hourTs, samples: h.samples })
    .from(h)
    .where(
      and(
        eq(h.exchange, ex),
        eq(h.merchantId, merchantId),
        eq(h.asset, asset),
        eq(h.fiat, fiat),
        gte(h.hourTs, since),
      ),
    )
    .orderBy(asc(h.hourTs));
}

export async function getMerchant(
  ex: ExchangeId,
  merchantId: string,
  asset: string,
  fiat: string,
): Promise<MerchantRow | undefined> {
  const db = await getDb();
  const [row] = await db
    .select()
    .from(schema.merchants)
    .where(
      and(
        eq(schema.merchants.exchange, ex),
        eq(schema.merchants.merchantId, merchantId),
        eq(schema.merchants.asset, asset),
        eq(schema.merchants.fiat, fiat),
      ),
    )
    .limit(1);
  return row;
}

/** Timestamp of the latest merchant sweep for an exchange. */
export async function latestSweepTs(ex: ExchangeId, asset: string, fiat: string) {
  const db = await getDb();
  const [r] = await db
    .select({ ts: max(schema.merchants.lastSeenTs) })
    .from(schema.merchants)
    .where(
      and(
        eq(schema.merchants.exchange, ex),
        eq(schema.merchants.asset, asset),
        eq(schema.merchants.fiat, fiat),
      ),
    );
  return r?.ts ?? null;
}

/** Merchants listing in the most recent sweep. */
export async function merchantsInLatestTick(
  ex: ExchangeId,
  asset: string,
  fiat: string,
): Promise<MerchantRow[]> {
  const ts = await latestSweepTs(ex, asset, fiat);
  if (!ts) return [];
  const db = await getDb();
  return db
    .select()
    .from(schema.merchants)
    .where(
      and(
        eq(schema.merchants.exchange, ex),
        eq(schema.merchants.asset, asset),
        eq(schema.merchants.fiat, fiat),
        eq(schema.merchants.lastSeenTs, ts),
      ),
    );
}

export type KnownMerchantRow = {
  merchantId: string;
  merchantName: string;
  lastSeenTs: number;
  isMerchant: boolean | null;
  userIdentity: string | null;
  userGrade: number | null;
  vipLevel: number | null;
  ordersMonth: number | null;
  completionRate: number | null;
  avgReleaseSec: number | null;
  buyAds: number | null;
  sellAds: number | null;
  bestBuyPrice: number | null;
  bestSellPrice: number | null;
  totalAvailableFiat: number | null;
};

/** Every merchant ever seen on this market — one indexed read of the
 *  `merchants` table (was a full-history DISTINCT ON scan). */
export async function listAllKnownMerchants(
  ex: ExchangeId,
  asset: string,
  fiat: string,
): Promise<KnownMerchantRow[]> {
  const db = await getDb();
  const rows = await db
    .select()
    .from(schema.merchants)
    .where(
      and(
        eq(schema.merchants.exchange, ex),
        eq(schema.merchants.asset, asset),
        eq(schema.merchants.fiat, fiat),
      ),
    )
    .orderBy(desc(schema.merchants.lastSeenTs));
  return rows.map(({ exchange: _e, asset: _a, fiat: _f, firstSeenTs: _fs, ...r }) => r);
}

/** Per-merchant presence over a window: first/last seen, sweeps seen, avg
 *  completion. Raw sweeps for ≤24h, hourly rollups beyond. */
export async function merchantChurnWindow(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  range: RangeKey,
) {
  const db = await getDb();
  const since = rangeSinceSeconds(range);
  if (isShort(range)) {
    const s = schema.merchantSnapshots;
    return db
      .select({
        merchantId: s.merchantId,
        merchantName: sql<string>`max(${s.merchantName})`,
        firstTs: sql<number>`min(${s.ts})`,
        lastTs: sql<number>`max(${s.ts})`,
        ticks: sql<number>`count(*)`,
        avgCompletion: sql<number>`avg(${s.completionRate})`,
      })
      .from(s)
      .where(and(eq(s.exchange, ex), eq(s.asset, asset), eq(s.fiat, fiat), gte(s.ts, since)))
      .groupBy(s.merchantId);
  }
  const h = schema.merchantHourly;
  const m = schema.merchants;
  return db
    .select({
      merchantId: h.merchantId,
      merchantName: sql<string>`max(${m.merchantName})`,
      firstTs: sql<number>`min(${h.hourTs})`,
      lastTs: sql<number>`max(${h.hourTs}) + 3599`,
      ticks: sql<number>`sum(${h.samples})`,
      avgCompletion: sql<number>`avg(${h.completionRate})`,
    })
    .from(h)
    .leftJoin(
      m,
      and(
        eq(m.exchange, h.exchange),
        eq(m.merchantId, h.merchantId),
        eq(m.asset, h.asset),
        eq(m.fiat, h.fiat),
      ),
    )
    .where(and(eq(h.exchange, ex), eq(h.asset, asset), eq(h.fiat, fiat), gte(h.hourTs, since)))
    .groupBy(h.merchantId);
}

/** Merchant ids in the sweep closest to `targetTs` (within ± `toleranceSec`),
 *  from the raw `merchant_snapshots` (kept 3 days). Null when none. */
export async function merchantsInSweepNear(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  targetTs: number,
  toleranceSec = 10 * 60,
): Promise<{ ts: number; ids: Set<string> } | null> {
  const db = await getDb();
  const s = schema.merchantSnapshots;
  const T = sql.raw(String(Math.trunc(targetTs)));
  const [hit] = await db
    .select({ ts: s.ts })
    .from(s)
    .where(
      and(
        eq(s.exchange, ex),
        eq(s.asset, asset),
        eq(s.fiat, fiat),
        gte(s.ts, targetTs - toleranceSec),
        sql`${s.ts} <= ${targetTs + toleranceSec}`,
      ),
    )
    .groupBy(s.ts)
    .orderBy(sql`abs(${s.ts} - ${T})`)
    .limit(1);
  if (!hit) return null;
  const rows = await db
    .select({ id: s.merchantId })
    .from(s)
    .where(and(eq(s.exchange, ex), eq(s.asset, asset), eq(s.fiat, fiat), eq(s.ts, hit.ts)));
  return { ts: hit.ts, ids: new Set(rows.map((r) => r.id)) };
}
