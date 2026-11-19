import { and, asc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { RANGES, type RangeKey } from "@/lib/db/queries";
import type { ExchangeId } from "@/lib/exchanges";
import { SLT_OFFSET_SEC } from "@/lib/constants";
import { downsampleMinMax, timeSma } from "@/lib/stats";

/**
 * Historical market series for the Historical page.
 *
 * Short ranges (≤ 24h) read raw 1-min `market_snapshots`; long ranges read the
 * `market_hourly` rollups. Both are bucketed in JS on a fixed grid so:
 *   - every series stays ≤ 500 points,
 *   - candles carry real OHLC (first / max / min / last mid in the bucket),
 *   - Binance and Bybit land on the same timestamps and can be overlaid,
 *   - buckets with no data become null rows, so charts show gaps (F21),
 *   - buckets of an hour or more start on Sri Lanka hours (F25; for the
 *     hourly rollups, which are UTC hours, on the nearest whole hour).
 */

/** Line-chart resolution per range (seconds). */
export const LINE_BUCKET: Record<RangeKey, number> = {
  "1h": 60, // ≤ 60
  "6h": 60, // ≤ 360
  "24h": 300, // ≤ 288
  "7d": 3600, // ≤ 168
  "30d": 7200, // ≤ 360
};

/** Candle width per range (seconds). 7d / 30d come from hourly rollups. */
export const CANDLE_BUCKET: Record<RangeKey, number> = {
  "1h": 300, // 12
  "6h": 900, // 24
  "24h": 3600, // 24
  "7d": 3 * 3600, // 56
  "30d": 12 * 3600, // 60
};

export type HistPoint = {
  /** Bucket start, unix seconds. */
  ts: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  spreadPct: number | null;
  bidDepth: number | null;
  askDepth: number | null;
  bidDepthFiat: number | null;
  askDepthFiat: number | null;
  /** Near-touch depth (USDT within 0.5 % / 1 % of each side's best). */
  bidDepth05: number | null;
  askDepth05: number | null;
  bidDepth1: number | null;
  askDepth1: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  /** Raw samples in the bucket. */
  samples: number;
};

export type Candle = Pick<HistPoint, "ts" | "open" | "high" | "low" | "close" | "samples">;

export type ComparePoint = { ts: number; mid: number | null; spreadPct: number | null };

export type HistorySummary = {
  count: number;
  avgMid: number | null;
  minMid: number | null;
  maxMid: number | null;
  avgSpreadPct: number | null;
  avgBidDepth: number | null;
  avgAskDepth: number | null;
  /** Near-touch depth within 1 %; null when the window has none yet. */
  avgBidDepth1: number | null;
  avgAskDepth1: number | null;
};

/** One base row before bucketing (a raw tick, or one hourly rollup). */
type BaseRow = Omit<HistPoint, "samples"> & { w: number };

const isShort = (r: RangeKey) => RANGES[r] <= RANGES["24h"];
const num = (v: unknown) => (v == null || !Number.isFinite(Number(v)) ? null : Number(v));

async function loadBase(ex: ExchangeId, asset: string, fiat: string, range: RangeKey, since: number): Promise<BaseRow[]> {
  const db = await getDb();

  if (isShort(range)) {
    const m = schema.marketSnapshots;
    const rows = await db
      .select({
        ts: m.ts,
        bid: m.bestBid,
        ask: m.bestAsk,
        mid: m.mid,
        spreadPct: m.spreadPct,
        bidDepth: m.bidDepth,
        askDepth: m.askDepth,
        bidDepthFiat: m.bidDepthFiat,
        askDepthFiat: m.askDepthFiat,
        bidDepth05: m.bidDepth05,
        askDepth05: m.askDepth05,
        bidDepth1: m.bidDepth1,
        askDepth1: m.askDepth1,
      })
      .from(m)
      .where(and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat), gte(m.ts, since)))
      .orderBy(asc(m.ts));
    return rows.map((r) => ({
      ...r,
      open: r.mid,
      high: r.mid,
      low: r.mid,
      close: r.mid,
      w: 1,
    }));
  }

  const h = schema.marketHourly;
  const rows = await db
    .select()
    .from(h)
    .where(
      and(
        eq(h.exchange, ex),
        eq(h.asset, asset),
        eq(h.fiat, fiat),
        gte(h.hourTs, since - (since % 3600)),
      ),
    )
    .orderBy(asc(h.hourTs));
  return rows.map((r) => ({
    ts: r.hourTs,
    bid: r.avgBestBid,
    ask: r.avgBestAsk,
    mid: r.avgMid,
    spreadPct: r.avgSpreadPct,
    bidDepth: r.avgBidDepth,
    askDepth: r.avgAskDepth,
    bidDepthFiat: r.avgBidDepthFiat,
    askDepthFiat: r.avgAskDepthFiat,
    bidDepth05: r.bidDepth05,
    askDepth05: r.askDepth05,
    bidDepth1: r.bidDepth1,
    askDepth1: r.askDepth1,
    open: r.openMid,
    high: r.highMid,
    low: r.lowMid,
    close: r.closeMid,
    w: Math.max(1, r.samples),
  }));
}

const AVG_KEYS = [
  "bid",
  "ask",
  "mid",
  "spreadPct",
  "bidDepth",
  "askDepth",
  "bidDepthFiat",
  "askDepthFiat",
  "bidDepth05",
  "askDepth05",
  "bidDepth1",
  "askDepth1",
] as const;

/**
 * Grid offset for a bucket width. Buckets start where
 * (ts + offset) is a multiple of `sec`, so with the SLT offset a 1-hour
 * bucket starts on a Sri Lanka hour (xx:30 UTC). Hourly rollups are UTC
 * hours, so they can only use whole-hour offsets (5 h, half an hour short).
 */
export function bucketOffset(sec: number, hourlyRows: boolean): number {
  if (sec < 3600) return SLT_OFFSET_SEC % sec; // 0 for 1 / 5 / 15 min
  return (hourlyRows ? SLT_OFFSET_SEC - (SLT_OFFSET_SEC % 3600) : SLT_OFFSET_SEC) % sec;
}

const bucketStart = (ts: number, sec: number, offset: number) => Math.floor((ts + offset) / sec) * sec - offset;

/** A bucket with no data: every value null, samples 0. */
function emptyPoint(ts: number): HistPoint {
  const p = { ts, samples: 0, open: null, high: null, low: null, close: null } as HistPoint;
  for (const k of AVG_KEYS) p[k] = null;
  return p;
}

/**
 * Bucket base rows on a fixed `sec` grid. Weighted means, real OHLC.
 * `fill` = { from, to } inserts empty (null) buckets for every grid slot in
 * [from, to] that has no rows, so a missing hour stays a gap on the chart.
 */
export function bucketize(
  rows: readonly BaseRow[],
  sec: number,
  opts: { offset?: number; fill?: { from: number; to: number } } = {},
): HistPoint[] {
  const offset = opts.offset ?? 0;
  const dense = bucketizeDense(rows, sec, offset);
  if (!opts.fill) return dense;
  const first = bucketStart(opts.fill.from, sec, offset);
  const last = bucketStart(opts.fill.to, sec, offset);
  const byTs = new Map(dense.map((p) => [p.ts, p]));
  const out: HistPoint[] = [];
  for (let t = first; t <= last; t += sec) out.push(byTs.get(t) ?? emptyPoint(t));
  return out;
}

function bucketizeDense(rows: readonly BaseRow[], sec: number, offset: number): HistPoint[] {
  const out: HistPoint[] = [];
  let cur: {
    ts: number;
    sums: Record<(typeof AVG_KEYS)[number], { s: number; w: number }>;
    open: number | null;
    high: number | null;
    low: number | null;
    close: number | null;
    samples: number;
  } | null = null;

  const flush = () => {
    if (!cur) return;
    const p = { ts: cur.ts, samples: cur.samples } as HistPoint;
    for (const k of AVG_KEYS) {
      const a = cur.sums[k];
      p[k] = a.w > 0 ? a.s / a.w : null;
    }
    p.open = cur.open;
    p.high = cur.high;
    p.low = cur.low;
    p.close = cur.close;
    out.push(p);
  };

  for (const r of rows) {
    const b = bucketStart(r.ts, sec, offset);
    if (!cur || cur.ts !== b) {
      flush();
      cur = {
        ts: b,
        sums: Object.fromEntries(AVG_KEYS.map((k) => [k, { s: 0, w: 0 }])) as never,
        open: null,
        high: null,
        low: null,
        close: null,
        samples: 0,
      };
    }
    cur.samples += r.w;
    for (const k of AVG_KEYS) {
      const v = num(r[k]);
      if (v != null) {
        cur.sums[k].s += v * r.w;
        cur.sums[k].w += r.w;
      }
    }
    const o = num(r.open);
    const hi = num(r.high);
    const lo = num(r.low);
    const c = num(r.close);
    if (cur.open == null && o != null) cur.open = o;
    if (hi != null) cur.high = cur.high == null ? hi : Math.max(cur.high, hi);
    if (lo != null) cur.low = cur.low == null ? lo : Math.min(cur.low, lo);
    if (c != null) cur.close = c;
  }
  flush();
  return out;
}

function summarize(rows: readonly BaseRow[]): HistorySummary {
  let count = 0;
  let minMid: number | null = null;
  let maxMid: number | null = null;
  const acc = {
    mid: [0, 0],
    spreadPct: [0, 0],
    bidDepth: [0, 0],
    askDepth: [0, 0],
    bidDepth1: [0, 0],
    askDepth1: [0, 0],
  };
  for (const r of rows) {
    count += r.w;
    for (const k of ["mid", "spreadPct", "bidDepth", "askDepth", "bidDepth1", "askDepth1"] as const) {
      const v = num(r[k]);
      if (v != null) {
        acc[k][0] += v * r.w;
        acc[k][1] += r.w;
      }
    }
    const lo = num(r.low);
    const hi = num(r.high);
    if (lo != null) minMid = minMid == null ? lo : Math.min(minMid, lo);
    if (hi != null) maxMid = maxMid == null ? hi : Math.max(maxMid, hi);
  }
  const avg = (k: keyof typeof acc) => (acc[k][1] > 0 ? acc[k][0] / acc[k][1] : null);
  return {
    count,
    avgMid: avg("mid"),
    minMid,
    maxMid,
    avgSpreadPct: avg("spreadPct"),
    avgBidDepth: avg("bidDepth"),
    avgAskDepth: avg("askDepth"),
    avgBidDepth1: avg("bidDepth1"),
    avgAskDepth1: avg("askDepth1"),
  };
}

/** Moving averages of the mid, by real duration (F22). */
export const MA_WINDOWS: Record<RangeKey, readonly [{ sec: number; label: string }, { sec: number; label: string }]> = {
  "1h": [{ sec: 3600, label: "1h avg" }, { sec: 4 * 3600, label: "4h avg" }],
  "6h": [{ sec: 3600, label: "1h avg" }, { sec: 4 * 3600, label: "4h avg" }],
  "24h": [{ sec: 3600, label: "1h avg" }, { sec: 4 * 3600, label: "4h avg" }],
  "7d": [{ sec: 86400, label: "24h avg" }, { sec: 7 * 86400, label: "7d avg" }],
  "30d": [{ sec: 86400, label: "24h avg" }, { sec: 7 * 86400, label: "7d avg" }],
};

export type HistoryBundle = {
  exchange: ExchangeId;
  range: RangeKey;
  bucketSec: number;
  candleSec: number;
  /** Every grid slot from the start of the range to now; empty ones are null. */
  points: HistPoint[];
  candles: Candle[];
  summary: HistorySummary;
  /** Time-based moving averages of the mid, one value per point (null until
   *  a full window of data is behind it, or across a gap). */
  ma: { labels: [string, string]; a: (number | null)[]; b: (number | null)[] };
  /** Unix seconds of the newest stored row (null = none in range). */
  latestTs: number | null;
  /** The other exchange on the same time grid (for the overlay). */
  compare: { exchange: ExchangeId; points: ComparePoint[] } | null;
};

export async function historyBundle(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  range: RangeKey,
  opts: { compare?: boolean; now?: number } = {},
): Promise<HistoryBundle> {
  const other: ExchangeId = ex === "binance" ? "bybit" : "binance";
  const now = opts.now ?? Math.floor(Date.now() / 1000);
  const since = now - RANGES[range];
  const [wa, wb] = MA_WINDOWS[range];
  // Load one extra (longest) MA window before the range so the averages are
  // real from the first point. Only this exchange needs it.
  const warmSince = since - wb.sec;
  const [all, otherBase] = await Promise.all([
    loadBase(ex, asset, fiat, range, warmSince),
    opts.compare === false ? Promise.resolve(null) : loadBase(other, asset, fiat, range, since).catch(() => null),
  ]);
  const base = all.filter((r) => r.ts >= since - (isShort(range) ? 0 : since % 3600));
  const hourly = !isShort(range);
  const bucketSec = LINE_BUCKET[range];
  const candleSec = CANDLE_BUCKET[range];
  const off = bucketOffset(bucketSec, hourly);

  // MA on the warm-up grid, then trimmed to the visible range.
  const warmGrid = bucketize(all, bucketSec, { offset: off, fill: { from: warmSince, to: now } });
  const gridTs = warmGrid.map((p) => p.ts);
  const mids = warmGrid.map((p) => p.mid);
  const w = warmGrid.map((p) => p.samples);
  // Samples are 1-minute snapshots in raw rows and in the hourly rollups.
  const maOpts = { w, expectedPerSec: 1 / 60, minCoverage: 0.5 };
  const maA = timeSma(gridTs, mids, wa.sec, maOpts);
  const maB = timeSma(gridTs, mids, wb.sec, maOpts);
  const firstVisible = bucketStart(since, bucketSec, off);
  const startIdx = Math.max(0, gridTs.findIndex((t) => t >= firstVisible));
  const points = warmGrid.slice(startIdx);

  const candles = bucketize(base, candleSec, { offset: bucketOffset(candleSec, hourly) })
    .filter((c) => c.open != null && c.close != null && c.high != null && c.low != null)
    .map(({ ts, open, high, low, close, samples }) => ({ ts, open, high, low, close, samples }));
  const compare = otherBase?.length
    ? {
        exchange: other,
        points: bucketize(otherBase, bucketSec, { offset: off, fill: { from: since, to: now } }).map((p) => ({
          ts: p.ts,
          mid: p.mid,
          spreadPct: p.spreadPct,
        })),
      }
    : null;
  return {
    exchange: ex,
    range,
    bucketSec,
    candleSec,
    points,
    candles,
    summary: summarize(base),
    ma: { labels: [wa.label, wb.label], a: maA.slice(startIdx), b: maB.slice(startIdx) },
    latestTs: base.length ? base[base.length - 1].ts : null,
    compare,
  };
}

/** Min/max-preserving downsample on one numeric key (keeps spikes and gaps). */
export function downsampleBy<T>(xs: readonly T[], max: number, val: (x: T) => number | null): T[] {
  return downsampleMinMax(xs, max, val);
}

/** Even-stride downsample to at most `max` items (keeps the last one). */
export function downsample<T>(xs: readonly T[], max: number): T[] {
  if (xs.length <= max) return xs.slice();
  const step = xs.length / max;
  const out: T[] = [];
  for (let i = 0; i < max - 1; i++) out.push(xs[Math.floor(i * step)]);
  out.push(xs[xs.length - 1]);
  return out;
}
