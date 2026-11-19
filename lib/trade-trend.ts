/**
 * Buy/sell trade trends from cumulative counters (merchant_trade_daily).
 * Pure and client-safe; the SQL in lib/db/trade-activity.ts mirrors
 * `cumulativeToSpans` + `spreadSpans` for the market-wide sums.
 *
 * Each stored day holds the LAST all-time counters seen that SLT day.
 *
 *   trades on day D = counters(D) − counters(previous stored day)
 *
 * - First stored day: no baseline, so no value (never 0).
 * - Gap of 2..MAX_GAP_DAYS days (collector down, merchant not refreshed):
 *   the difference is spread evenly over the missed days and flagged
 *   `estimated`. Longer gaps stay unknown.
 * - A counter that goes DOWN (Binance recount, account change) is treated
 *   as a reset: that day stays unknown and the next day diffs against the
 *   new value.
 * - A one-day spike (up, then back down to at least the day before) is a
 *   bad reading: that row is ignored and the gap rule applies around it.
 *
 * Days are SLT calendar days as integers: floor((ts + 19800) / 86400).
 * Weeks start on Monday (SLT); months are calendar months.
 */

import { SLT_OFFSET_SEC } from "@/lib/constants";

export const MAX_GAP_DAYS = 7;
export type Period = "day" | "week" | "month";
export const PERIODS: readonly Period[] = ["day", "week", "month"];
/** Buckets shown per period. */
export const BUCKETS: Record<Period, number> = { day: 30, week: 12, month: 12 };

/** SLT calendar day (days since 1970-01-01) of a unix-seconds time. */
export const sltDay = (ts: number) => Math.floor((ts + SLT_OFFSET_SEC) / 86400);
/** "2026-11-20" for a day number. */
export const dayIso = (day: number) => new Date(day * 86_400_000).toISOString().slice(0, 10);
/** Monday of the day's week. 1970-01-01 was a Thursday (weekday 3, Mon = 0). */
export const weekStart = (day: number) => day - ((((day + 3) % 7) + 7) % 7);
export function monthStart(day: number) {
  const d = new Date(day * 86_400_000);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1) / 86_400_000);
}
export function monthEnd(day: number) {
  const d = new Date(day * 86_400_000);
  return Math.round(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1) / 86_400_000) - 1;
}

/** First and last day (inclusive) of the bucket containing `day`. */
export function bucketRange(period: Period, day: number): [number, number] {
  if (period === "day") return [day, day];
  if (period === "week") {
    const s = weekStart(day);
    return [s, s + 6];
  }
  return [monthStart(day), monthEnd(day)];
}

export type CumRow = { day: number; buy: number | null; sell: number | null };
/** One difference between two consecutive stored days, ending on `day`. */
export type SpanRow = { day: number; span: number; buy: number; sell: number };

/** Consecutive stored days → differences (resets, nulls and long gaps dropped). */
export function cumulativeToSpans(rows: readonly CumRow[]): SpanRow[] {
  const all = [...rows].sort((a, b) => a.day - b.day);
  // A one-day spike (the next day falls back, but not below the day before)
  // is a bad reading, not trades: drop that row so the days around it are
  // spread as a gap instead.
  const spike = (prev: CumRow | undefined, cur: CumRow, next: CumRow | undefined, k: "buy" | "sell") =>
    prev?.[k] != null && cur[k] != null && next?.[k] != null && next[k] < cur[k] && next[k] >= prev[k];
  const sorted = all.filter((cur, i) => !spike(all[i - 1], cur, all[i + 1], "buy") && !spike(all[i - 1], cur, all[i + 1], "sell"));
  const out: SpanRow[] = [];
  for (let i = 1; i < sorted.length; i++) {
    const prev = sorted[i - 1];
    const cur = sorted[i];
    const span = cur.day - prev.day;
    if (span < 1 || span > MAX_GAP_DAYS) continue;
    if (cur.buy == null || cur.sell == null || prev.buy == null || prev.sell == null) continue;
    const buy = cur.buy - prev.buy;
    const sell = cur.sell - prev.sell;
    if (buy < 0 || sell < 0) continue; // reset
    out.push({ day: cur.day, span, buy, sell });
  }
  return out;
}

export type DayAgg = {
  buy: number;
  sell: number;
  /** Merchants contributing to the day. */
  merchants: number;
  /** Trades on this day that were spread from a gap (0 = all measured). */
  estimated: number;
};

/** Spread each span evenly over its days. */
export function spreadSpans(spans: readonly SpanRow[]): Map<number, DayAgg> {
  const out = new Map<number, DayAgg>();
  for (const s of spans) {
    for (let k = 0; k < s.span; k++) {
      const day = s.day - k;
      const a = out.get(day) ?? { buy: 0, sell: 0, merchants: 0, estimated: 0 };
      const b = s.buy / s.span;
      const sl = s.sell / s.span;
      a.buy += b;
      a.sell += sl;
      a.merchants += 1;
      if (s.span > 1) a.estimated += b + sl;
      out.set(day, a);
    }
  }
  return out;
}

export type Bucket = {
  /** First day of the bucket (SLT day number). */
  start: number;
  /** Last day (inclusive). */
  end: number;
  /** null = no data for any day of the bucket (shown as a gap, never 0). */
  buy: number | null;
  sell: number | null;
  total: number | null;
  /** Days with data / days of the bucket elapsed so far. */
  daysCovered: number;
  daysElapsed: number;
  /** Every elapsed day has data. */
  complete: boolean;
  /** The bucket contains today (period still running). */
  inProgress: boolean;
  /** Some trades in the bucket were spread from a gap. */
  estimated: boolean;
  /** Most merchants contributing on any day (market view). */
  merchants: number;
};

/** The last `count` buckets up to and including the one with `today`. */
export function bucketize(days: ReadonlyMap<number, DayAgg>, period: Period, today: number, count = BUCKETS[period]): Bucket[] {
  const out: Bucket[] = [];
  let [start, end] = bucketRange(period, today);
  for (let i = 0; i < count; i++) {
    let buy = 0;
    let sell = 0;
    let covered = 0;
    let est = 0;
    let merchants = 0;
    const last = Math.min(end, today);
    for (let d = start; d <= last; d++) {
      const a = days.get(d);
      if (!a) continue;
      covered += 1;
      buy += a.buy;
      sell += a.sell;
      est += a.estimated;
      merchants = Math.max(merchants, a.merchants);
    }
    const elapsed = last - start + 1;
    out.push({
      start,
      end,
      buy: covered ? buy : null,
      sell: covered ? sell : null,
      total: covered ? buy + sell : null,
      daysCovered: covered,
      daysElapsed: elapsed,
      complete: covered === elapsed,
      inProgress: end >= today,
      estimated: est > 0.5,
      merchants,
    });
    [start, end] = bucketRange(period, start - 1);
  }
  return out.reverse();
}

/** (current − previous) / previous; null without a usable base. */
export function growth(current: number | null | undefined, previous: number | null | undefined): number | null {
  if (current == null || previous == null || !(previous > 0)) return null;
  return (current - previous) / previous;
}

export type PeriodGrowth<B extends Bucket = Bucket> = {
  current: B;
  previous: B;
  total: number | null;
  buy: number | null;
  sell: number | null;
};

/**
 * Latest COMPLETE period against the one before it (both fully covered).
 * The running period is never compared with a full one.
 */
export function periodGrowth<B extends Bucket>(buckets: readonly B[]): PeriodGrowth<B> | null {
  const done = buckets.filter((b) => !b.inProgress);
  const current = done.at(-1);
  const previous = done.at(-2);
  if (!current || !previous || !current.complete || !previous.complete) return null;
  return {
    current,
    previous,
    total: growth(current.total, previous.total),
    buy: growth(current.buy, previous.buy),
    sell: growth(current.sell, previous.sell),
  };
}

/** Buy share of a buy/sell split, 0..1; null when both are zero/unknown. */
export function buyShare(buy: number | null | undefined, sell: number | null | undefined): number | null {
  if (buy == null || sell == null) return null;
  const t = buy + sell;
  return t > 0 ? buy / t : null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** Short label: "20 Nov" (day, week = its Monday) or "Nov 26" (month). */
export function bucketLabel(period: Period, start: number): string {
  const d = new Date(start * 86_400_000);
  if (period === "month") return `${MONTHS[d.getUTCMonth()]} ${String(d.getUTCFullYear()).slice(2)}`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

export function periodNoun(period: Period) {
  return period === "day" ? "day" : period === "week" ? "week" : "month";
}

/**
 * Side names for completed orders. Binance counts are the MERCHANT's side: a
 * completed buy order means the merchant bought USDT (the user sold).
 * Colours follow the site convention — green is the side where users buy
 * USDT — so "merchant sold USDT" is green and "merchant bought USDT" red.
 */
export const TRADE_SIDES = {
  sold: { label: "Merchant sold USDT", hint: "users bought", color: "var(--color-buy)" },
  bought: { label: "Merchant bought USDT", hint: "users sold", color: "var(--color-sell)" },
} as const;
