import { listMarketSnapshots, type RangeKey } from "@/lib/db/queries";
import { SLT_OFFSET_SEC } from "@/lib/constants";
import type {
  PatternCell,
  PatternsResult,
  HourTrend,
  WeekdayTrend,
} from "@/lib/patterns-types";

export type {
  PatternSide,
  PatternCell,
  PatternGrid,
  HourTrend,
  WeekdayTrend,
  PatternsResult,
} from "@/lib/patterns-types";
export { WEEKDAY_LABELS } from "@/lib/patterns-types";

/**
 * Market-pattern aggregation.
 *
 * Recurring time-of-day / day-of-week behaviour in P2P books — when the spread
 * is widest, when depth dries up, when the bid side or ask side leads — is a
 * pricing edge for anyone running scheduled buys or sells. We bucket every
 * stored snapshot into a (weekday × hour) cell and average each metric inside
 * the cell. With ingest running every 5 min, a 30-day window gives ~288
 * samples per cell for a 7×24 grid (= 168 cells, ~ 8,640 samples).
 *
 * Time bucketing is in Asia/Colombo to match the rest of the app — see
 * `SLT_OFFSET_SEC`.
 */

type Accumulator = {
  bidSum: number;
  bidCount: number;
  askSum: number;
  askCount: number;
  midSum: number;
  midCount: number;
  spreadPctSum: number;
  spreadPctCount: number;
  bidDepthSum: number;
  bidDepthCount: number;
  askDepthSum: number;
  askDepthCount: number;
  bidCountSum: number;
  bidCountCount: number;
  askCountSum: number;
  askCountCount: number;
  samples: number;
};

function emptyAcc(): Accumulator {
  return {
    bidSum: 0,
    bidCount: 0,
    askSum: 0,
    askCount: 0,
    midSum: 0,
    midCount: 0,
    spreadPctSum: 0,
    spreadPctCount: 0,
    bidDepthSum: 0,
    bidDepthCount: 0,
    askDepthSum: 0,
    askDepthCount: 0,
    bidCountSum: 0,
    bidCountCount: 0,
    askCountSum: 0,
    askCountCount: 0,
    samples: 0,
  };
}

function avgOrNull(sum: number, count: number): number | null {
  return count > 0 ? sum / count : null;
}

export async function computePatterns(
  asset: string,
  fiat: string,
  range: RangeKey = "30d",
): Promise<PatternsResult> {
  const rows = await listMarketSnapshots(asset, fiat, range);

  // 7 weekdays × 24 hours.
  const grid: Accumulator[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => emptyAcc()),
  );
  const hourAcc: Accumulator[] = Array.from({ length: 24 }, () => emptyAcc());
  const dowAcc: Accumulator[] = Array.from({ length: 7 }, () => emptyAcc());

  for (const r of rows) {
    const d = new Date((r.ts + SLT_OFFSET_SEC) * 1000);
    const dow = d.getUTCDay();
    const hour = d.getUTCHours();

    const buckets = [grid[dow][hour], hourAcc[hour], dowAcc[dow]];

    for (const a of buckets) {
      a.samples += 1;
      if (r.bestBid != null) {
        a.bidSum += r.bestBid;
        a.bidCount += 1;
      }
      if (r.bestAsk != null) {
        a.askSum += r.bestAsk;
        a.askCount += 1;
      }
      if (r.mid != null) {
        a.midSum += r.mid;
        a.midCount += 1;
      }
      if (r.spreadPct != null) {
        a.spreadPctSum += r.spreadPct;
        a.spreadPctCount += 1;
      }
      if (r.bidDepth != null) {
        a.bidDepthSum += r.bidDepth;
        a.bidDepthCount += 1;
      }
      if (r.askDepth != null) {
        a.askDepthSum += r.askDepth;
        a.askDepthCount += 1;
      }
      if (r.bidCount != null) {
        a.bidCountSum += r.bidCount;
        a.bidCountCount += 1;
      }
      if (r.askCount != null) {
        a.askCountSum += r.askCount;
        a.askCountCount += 1;
      }
    }
  }

  const cells: PatternCell[] = [];
  let maxBidDepth = 0;
  let maxAskDepth = 0;
  let maxSpreadPct = 0;
  for (let dow = 0; dow < 7; dow++) {
    for (let hour = 0; hour < 24; hour++) {
      const a = grid[dow][hour];
      const cell: PatternCell = {
        dow,
        hour,
        avgBestBid: avgOrNull(a.bidSum, a.bidCount),
        avgBestAsk: avgOrNull(a.askSum, a.askCount),
        avgMid: avgOrNull(a.midSum, a.midCount),
        avgSpreadPct: avgOrNull(a.spreadPctSum, a.spreadPctCount),
        avgBidDepth: avgOrNull(a.bidDepthSum, a.bidDepthCount),
        avgAskDepth: avgOrNull(a.askDepthSum, a.askDepthCount),
        avgBidCount: avgOrNull(a.bidCountSum, a.bidCountCount),
        avgAskCount: avgOrNull(a.askCountSum, a.askCountCount),
        samples: a.samples,
      };
      cells.push(cell);
      if ((cell.avgBidDepth ?? 0) > maxBidDepth) maxBidDepth = cell.avgBidDepth!;
      if ((cell.avgAskDepth ?? 0) > maxAskDepth) maxAskDepth = cell.avgAskDepth!;
      if ((cell.avgSpreadPct ?? 0) > maxSpreadPct)
        maxSpreadPct = cell.avgSpreadPct!;
    }
  }

  const hourTrend: HourTrend[] = hourAcc.map((a, hour) => ({
    hour,
    avgBestBid: avgOrNull(a.bidSum, a.bidCount),
    avgBestAsk: avgOrNull(a.askSum, a.askCount),
    avgSpreadPct: avgOrNull(a.spreadPctSum, a.spreadPctCount),
    avgBidDepth: avgOrNull(a.bidDepthSum, a.bidDepthCount),
    avgAskDepth: avgOrNull(a.askDepthSum, a.askDepthCount),
    samples: a.samples,
  }));

  const weekdayTrend: WeekdayTrend[] = dowAcc.map((a, dow) => ({
    dow,
    avgBestBid: avgOrNull(a.bidSum, a.bidCount),
    avgBestAsk: avgOrNull(a.askSum, a.askCount),
    avgSpreadPct: avgOrNull(a.spreadPctSum, a.spreadPctCount),
    avgBidDepth: avgOrNull(a.bidDepthSum, a.bidDepthCount),
    avgAskDepth: avgOrNull(a.askDepthSum, a.askDepthCount),
    samples: a.samples,
  }));

  return {
    grid: {
      cells,
      maxBidDepth,
      maxAskDepth,
      maxSpreadPct,
      totalSamples: rows.length,
      range,
    },
    hourTrend,
    weekdayTrend,
  };
}

