import { median } from "@/lib/stats";
import { sltHourCells, sltWeekday, type SltHourCell } from "@/lib/db/queries";
import type { ExchangeId } from "@/lib/exchanges";

/**
 * Best time to trade (D4): when, in Sri Lanka time, the best ask is cheapest
 * and the best bid is highest RELATIVE TO THAT DAY. Comparing with the day's
 * own median mid takes out the trend, so "Tuesday 10:00 looks cheap" means
 * cheap for that day, not just "the price was lower last week".
 *
 *   askDev = hour's mean best ask / day's median mid − 1   (lower = better to buy)
 *   bidDev = hour's mean best bid / day's median mid − 1   (higher = better to sell)
 *   spread = hour's mean spread % of mid
 *
 * Per cell the value is the median over the days that have that hour. Data:
 * the last 14 days of raw 1-minute snapshots, exact SLT hours.
 */

/** A (day, hour) needs this many minutes to count. */
export const MIN_MINUTES = 20;
/** Weekday × hour cells need this many days; the hour-of-day row needs more. */
export const MIN_DAYS_CELL = 1;
export const MIN_DAYS_HOUR = 3;
/** A day needs this many usable hours for its median mid. */
const MIN_HOURS_PER_DAY = 6;

export type BestTimeCell = {
  askDev: number | null;
  bidDev: number | null;
  spreadPct: number | null;
  /** Days behind the value, and minutes of data. */
  days: number;
  minutes: number;
  /** Below the sample minimum: show as "not enough data". */
  hidden: boolean;
};

export type BestTime = {
  /** [weekday 0=Sun..6][hour 0..23] */
  grid: BestTimeCell[][];
  /** Hour of day across all weekdays. */
  byHour: BestTimeCell[];
  days: number;
  minutes: number;
  /** Hours (SLT) with the lowest askDev / highest bidDev in `byHour`. */
  cheapestBuyHours: number[];
  bestSellHours: number[];
};

const empty = (): BestTimeCell => ({ askDev: null, bidDev: null, spreadPct: null, days: 0, minutes: 0, hidden: true });

export function bestTimeFromCells(rows: readonly SltHourCell[]): BestTime {
  const usable = rows.filter((r) => r.samples >= MIN_MINUTES && r.mid != null && r.mid > 0);
  const byDay = new Map<number, SltHourCell[]>();
  for (const r of usable) {
    const xs = byDay.get(r.day) ?? [];
    xs.push(r);
    byDay.set(r.day, xs);
  }
  const dayMedian = new Map<number, number>();
  for (const [day, xs] of byDay) {
    if (xs.length < MIN_HOURS_PER_DAY) continue;
    const m = median(xs.map((x) => x.mid as number));
    if (m != null && m > 0) dayMedian.set(day, m);
  }

  type Acc = { ask: number[]; bid: number[]; spread: number[]; days: Set<number>; minutes: number };
  const acc = () => ({ ask: [], bid: [], spread: [], days: new Set<number>(), minutes: 0 }) as Acc;
  const cells: Acc[][] = Array.from({ length: 7 }, () => Array.from({ length: 24 }, acc));
  const hours: Acc[] = Array.from({ length: 24 }, acc);
  for (const r of usable) {
    const ref = dayMedian.get(r.day);
    if (ref == null) continue;
    for (const a of [cells[sltWeekday(r.day)][r.hour], hours[r.hour]]) {
      if (r.ask != null) a.ask.push(r.ask / ref - 1);
      if (r.bid != null) a.bid.push(r.bid / ref - 1);
      if (r.spreadPct != null) a.spread.push(r.spreadPct);
      a.days.add(r.day);
      a.minutes += r.samples;
    }
  }
  const finish = (a: Acc, minDays: number): BestTimeCell => {
    if (!a.days.size) return empty();
    return {
      askDev: median(a.ask),
      bidDev: median(a.bid),
      spreadPct: median(a.spread),
      days: a.days.size,
      minutes: a.minutes,
      hidden: a.days.size < minDays,
    };
  };
  const grid = cells.map((row) => row.map((a) => finish(a, MIN_DAYS_CELL)));
  const byHour = hours.map((a) => finish(a, MIN_DAYS_HOUR));

  const shown = byHour.map((c, h) => ({ c, h })).filter((x) => !x.c.hidden);
  const pick = (key: "askDev" | "bidDev", dir: 1 | -1) =>
    shown
      .filter((x) => x.c[key] != null)
      .sort((a, b) => dir * ((a.c[key] as number) - (b.c[key] as number)))
      .slice(0, 3)
      .map((x) => x.h);
  return {
    grid,
    byHour,
    days: dayMedian.size,
    minutes: usable.reduce((s, r) => s + (dayMedian.has(r.day) ? r.samples : 0), 0),
    cheapestBuyHours: pick("askDev", 1),
    bestSellHours: pick("bidDev", -1),
  };
}

export async function bestTime(ex: ExchangeId, asset: string, fiat: string): Promise<BestTime> {
  return bestTimeFromCells(await sltHourCells(ex, asset, fiat));
}
