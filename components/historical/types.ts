/** One row shared by every time chart on the Historical page (x = `t`, ms). */
export type HistRow = {
  t: number;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  /** Time-based moving averages of the mid (labels come with the data). */
  maA: number | null;
  maB: number | null;
  /** Other exchange's mid on the same time grid. */
  cmp: number | null;
  /** Spread in percent (0.12 = 0.12 %). */
  spread: number | null;
  cmpSpread: number | null;
  /** Legacy top-20 depth per side (USDT). */
  bidDepth: number | null;
  askDepth: number | null;
  /** Near-touch depth per side (USDT within 1 % / 0.5 % of that side's best). */
  bidDepth1: number | null;
  askDepth1: number | null;
  bidDepth05: number | null;
  askDepth05: number | null;
};

export type CandleRow = {
  t: number;
  open: number;
  high: number;
  low: number;
  close: number;
  /** [low, high] — drives the floating bar the candle shape is drawn in. */
  range: [number, number];
};

/** Recharts sync group for every time chart on the page. */
export const HIST_SYNC = "hist";
