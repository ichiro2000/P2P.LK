/**
 * Client-safe type + constant exports for the patterns module.
 *
 * `lib/patterns.ts` itself imports `lib/db/queries` (and transitively the
 * `postgres` driver), which the bundler will not let into a Client Component
 * bundle. This file holds the pieces the heatmap / trends client components
 * actually need at runtime, keeping the DB layer behind the server boundary.
 */

// Inlined to keep this file fully decoupled from the DB layer — even an
// `import type` from `@/lib/db/queries` can drag the postgres driver into the
// client bundle on some bundler versions, so we duplicate the literal-union
// here. The shape must match what `RangeKey` resolves to.
export type RangeKey = "1h" | "6h" | "24h" | "7d" | "30d";

export type PatternSide = "buy" | "sell" | "spread";

export type PatternCell = {
  dow: number;
  hour: number;
  avgBestBid: number | null;
  avgBestAsk: number | null;
  avgMid: number | null;
  avgSpreadPct: number | null;
  avgBidDepth: number | null;
  avgAskDepth: number | null;
  avgBidCount: number | null;
  avgAskCount: number | null;
  samples: number;
};

export type PatternGrid = {
  cells: PatternCell[];
  maxBidDepth: number;
  maxAskDepth: number;
  maxSpreadPct: number;
  totalSamples: number;
  range: RangeKey;
};

export type HourTrend = {
  hour: number;
  avgBestBid: number | null;
  avgBestAsk: number | null;
  avgSpreadPct: number | null;
  avgBidDepth: number | null;
  avgAskDepth: number | null;
  samples: number;
};

export type WeekdayTrend = {
  dow: number;
  avgBestBid: number | null;
  avgBestAsk: number | null;
  avgSpreadPct: number | null;
  avgBidDepth: number | null;
  avgAskDepth: number | null;
  samples: number;
};

export type PatternsResult = {
  grid: PatternGrid;
  hourTrend: HourTrend[];
  weekdayTrend: WeekdayTrend[];
};

export const WEEKDAY_LABELS = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
];
