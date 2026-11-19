import { median } from "@/lib/stats";

/**
 * Dollar rate vs USDT: pure maths (no DB), so every threshold can be unit
 * tested and back-tested.
 *
 * Hypothesis (owner): USDT/LKR on P2P moves WITH the dollar. When Google's
 * USD/LKR or CBSL's USD/LKR rises, USDT/LKR tends to rise too, and the same
 * when they fall. That is treated as a hypothesis: the correlation and beta
 * below are measured from our own history, and nothing is claimed until the
 * sample is big enough (see `verdict`).
 *
 * Series conventions
 *   - Google readings: `{ ts, value }`, LKR per USD, every ~30 min, ascending.
 *   - USDT mids: `{ ts, mid }`, ascending. `ts` is the END of the interval
 *     the mid was averaged over, so a mid at `ts` never contains data from
 *     after `ts` (no look-ahead).
 *   - CBSL: `{ day: "YYYY-MM-DD", value }`, business days only, ascending.
 */

export type FxPoint = { ts: number; value: number };
export type MidPoint = { ts: number; mid: number };
export type DayPoint = { day: string; value: number };

/* ── Constants ───────────────────────────────────────────────────────── */

/** Google is read every 30 minutes. */
export const GOOGLE_STEP_SEC = 30 * 60;
/** A pair of consecutive Google readings counts as one 30-min step only when
 *  they are 20–40 minutes apart (a missed run must not become a 60-min step). */
export const PAIR_GAP_SEC: readonly [number, number] = [20 * 60, 40 * 60];
/** Window start may be this far from the exact target time. */
export const GOOGLE_MATCH_TOL_SEC = 10 * 60;
/** The latest Google reading is "current" up to 75 min (two missed runs). */
export const GOOGLE_STALE_SEC = 75 * 60;
/** USDT mid at t = median of the mids in (t − 10 min, t]. */
export const MID_LOOKBACK_SEC = 10 * 60;
/** The latest CBSL day must be this recent (weekend + a holiday). */
export const CBSL_STALE_DAYS = 5;

/** Change-table windows for Google (and USDT over the same readings). */
export const WINDOWS = [
  { key: "30m", label: "30 min", sec: 30 * 60 },
  { key: "2h", label: "2 h", sec: 2 * 3600 },
  { key: "24h", label: "24 h", sec: 24 * 3600 },
] as const;
export type WindowKey = (typeof WINDOWS)[number]["key"];

/** Correlation look-backs and minimum samples before a number is shown. */
export const GOOGLE_CORR_DAYS = 7;
export const GOOGLE_MIN_PAIRS = 48;
export const CBSL_CORR_DAYS = 90;
export const CBSL_MIN_DAYS = 15;
/** |t| at or above this counts as a clear (≈95 %) link. */
export const T_CLEAR = 2;

/** USDT "lags" when it moved less than this share of the expected move. */
export const LAG_SHARE = 0.5;

/* ── Lookups ─────────────────────────────────────────────────────────── */

/** Index of the last point with ts ≤ t, or −1. Binary search. */
function lastAtOrBefore<T extends { ts: number }>(xs: readonly T[], t: number): number {
  let lo = 0;
  let hi = xs.length - 1;
  let ans = -1;
  while (lo <= hi) {
    const m = (lo + hi) >> 1;
    if (xs[m].ts <= t) {
      ans = m;
      lo = m + 1;
    } else hi = m - 1;
  }
  return ans;
}

/** Reading closest to `target` within ±tol that is strictly before `before`. */
export function readingNear(xs: readonly FxPoint[], target: number, tol: number, before: number): FxPoint | null {
  const i = lastAtOrBefore(xs, target + tol);
  let best: FxPoint | null = null;
  for (let j = i; j >= 0 && xs[j].ts >= target - tol; j--) {
    const p = xs[j];
    if (p.ts >= before) continue;
    if (!best || Math.abs(p.ts - target) < Math.abs(best.ts - target)) best = p;
  }
  return best;
}

/** USDT mid at t: median of the mids that END in (t − 10 min, t]. Null when
 *  the market had no data then (never 0, never a value from after t). */
export function midAt(xs: readonly MidPoint[], t: number, lookback = MID_LOOKBACK_SEC): number | null {
  const i = lastAtOrBefore(xs, t);
  const vals: number[] = [];
  for (let j = i; j >= 0 && xs[j].ts > t - lookback; j--) {
    const v = xs[j].mid;
    if (Number.isFinite(v) && v > 0) vals.push(v);
  }
  return median(vals);
}

/* ── Changes ─────────────────────────────────────────────────────────── */

export type Change = {
  from: number;
  to: number;
  fromTs: number;
  toTs: number;
  /** to − from, in LKR. */
  abs: number;
  /** to ÷ from − 1. */
  pct: number;
};

const change = (from: number, to: number, fromTs: number, toTs: number): Change => ({
  from,
  to,
  fromTs,
  toTs,
  abs: to - from,
  pct: to / from - 1,
});

/** Google change over `sec`, ending at the latest reading. Null when there is
 *  no reading near the window start. */
export function googleChange(xs: readonly FxPoint[], sec: number): Change | null {
  const last = xs[xs.length - 1];
  if (!last) return null;
  const start = readingNear(xs, last.ts - sec, GOOGLE_MATCH_TOL_SEC, last.ts);
  return start ? change(start.value, last.value, start.ts, last.ts) : null;
}

/** USDT change between two moments (aligned to Google's readings). */
export function midChange(xs: readonly MidPoint[], fromTs: number, toTs: number): Change | null {
  const a = midAt(xs, fromTs);
  const b = midAt(xs, toTs);
  return a != null && b != null ? change(a, b, fromTs, toTs) : null;
}

/** Latest CBSL day vs the previous stored business day. */
export function cbslDayChange(xs: readonly DayPoint[]): (Change & { day: string; prevDay: string }) | null {
  if (xs.length < 2) return null;
  const a = xs[xs.length - 2];
  const b = xs[xs.length - 1];
  return { ...change(a.value, b.value, dayTs(a.day), dayTs(b.day)), day: b.day, prevDay: a.day };
}

/** Midnight SLT of a "YYYY-MM-DD" day, as epoch seconds. */
export const dayTs = (day: string) => Date.parse(`${day}T00:00:00+05:30`) / 1000;

/* ── Correlation / beta ──────────────────────────────────────────────── */

export type Verdict = "collecting" | "confirmed" | "unclear" | "contradicted";

export type Link = {
  /** Paired returns used. */
  n: number;
  /** Minimum before a number is shown. */
  min: number;
  /** Pearson correlation, null when collecting or undefined. */
  r: number | null;
  /** OLS slope of USDT returns on dollar returns: cov(x,y) / var(x). */
  beta: number | null;
  /** t statistic of r: r·√((n−2)/(1−r²)). */
  t: number | null;
  verdict: Verdict;
};

/** Pearson r, OLS beta and the hypothesis verdict for paired returns. */
export function link(pairs: readonly { x: number; y: number }[], min: number): Link {
  const n = pairs.length;
  const none: Link = { n, min, r: null, beta: null, t: null, verdict: "collecting" };
  if (n < min || n < 3) return none;
  let mx = 0;
  let my = 0;
  for (const p of pairs) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let syy = 0;
  let sxy = 0;
  for (const p of pairs) {
    const dx = p.x - mx;
    const dy = p.y - my;
    sxx += dx * dx;
    syy += dy * dy;
    sxy += dx * dy;
  }
  // The dollar never moved (or USDT never did): no slope can be measured.
  if (sxx <= 0) return { ...none, verdict: "unclear" };
  const beta = sxy / sxx;
  if (syy <= 0) return { ...none, beta, verdict: "unclear" };
  const r = Math.max(-1, Math.min(1, sxy / Math.sqrt(sxx * syy)));
  const t = Math.abs(r) >= 1 ? Math.sign(r) * Infinity : r * Math.sqrt((n - 2) / (1 - r * r));
  const verdict: Verdict = t >= T_CLEAR ? "confirmed" : t <= -T_CLEAR ? "contradicted" : "unclear";
  return { n, min, r, beta, t, verdict };
}

/**
 * 30-minute returns: Google between consecutive readings 20–40 min apart,
 * USDT mid at the same two timestamps. Pairs with a missing side are skipped.
 * `untilTs` (optional) keeps only pairs that end by then: the move being
 * judged is left out of the beta it is judged against, so a big lagging
 * move can't drag its own expectation down.
 */
export function googlePairs(
  google: readonly FxPoint[],
  mids: readonly MidPoint[],
  sinceTs: number,
  untilTs = Infinity,
): { ts: number; x: number; y: number }[] {
  const out: { ts: number; x: number; y: number }[] = [];
  for (let i = 1; i < google.length; i++) {
    const a = google[i - 1];
    const b = google[i];
    if (a.ts < sinceTs || b.ts > untilTs) continue;
    const gap = b.ts - a.ts;
    if (gap < PAIR_GAP_SEC[0] || gap > PAIR_GAP_SEC[1]) continue;
    const ua = midAt(mids, a.ts);
    const ub = midAt(mids, b.ts);
    if (ua == null || ub == null) continue;
    out.push({ ts: b.ts, x: b.value / a.value - 1, y: ub / ua - 1 });
  }
  return out;
}

/**
 * CBSL business-day changes vs USDT daily-average changes over the SAME two
 * days (both must exist). Only days on or after `sinceDay`.
 */
export function cbslPairs(
  cbsl: readonly DayPoint[],
  usdtDaily: ReadonlyMap<string, number>,
  sinceDay: string,
): { day: string; x: number; y: number }[] {
  const out: { day: string; x: number; y: number }[] = [];
  for (let i = 1; i < cbsl.length; i++) {
    const a = cbsl[i - 1];
    const b = cbsl[i];
    if (b.day < sinceDay) continue;
    const ua = usdtDaily.get(a.day);
    const ub = usdtDaily.get(b.day);
    if (ua == null || ub == null || !(ua > 0) || !(ub > 0)) continue;
    out.push({ day: b.day, x: b.value / a.value - 1, y: ub / ua - 1 });
  }
  return out;
}

/* ── Expected vs actual ──────────────────────────────────────────────── */

export type Lag = {
  /** Beta used: measured when the link is confirmed, else 1 (the hypothesis). */
  beta: number;
  betaMeasured: boolean;
  /** beta × dollar move. */
  expected: number;
  /** USDT's actual move over the same span, up to now. */
  actual: number;
  /** expected − actual (same sign as expected when USDT lags). */
  gap: number;
  /** USDT moved less than `lagShare` of the expected move in its direction. */
  lagging: boolean;
};

/** How far USDT has followed a dollar move. Beta falls back to 1 (the
 *  stated hypothesis) until a positive link is measured. */
export function lagGap(dollarMove: number, usdtMove: number, l: Pick<Link, "beta" | "verdict">, lagShare = LAG_SHARE): Lag {
  const betaMeasured = l.verdict === "confirmed" && l.beta != null && l.beta > 0;
  const beta = betaMeasured ? (l.beta as number) : 1;
  const expected = beta * dollarMove;
  const gap = expected - usdtMove;
  const lagging = expected > 0 ? usdtMove < expected * (1 - lagShare) + 1e-12 : expected < 0 ? usdtMove > expected * (1 - lagShare) - 1e-12 : false;
  return { beta, betaMeasured, expected, actual: usdtMove, gap, lagging };
}

/* ── Chart series ────────────────────────────────────────────────────── */

export type IndexedPoint = {
  /** epoch ms */
  t: number;
  google: number | null;
  binance: number | null;
  bybit: number | null;
  binancePremium: number | null;
  bybitPremium: number | null;
};

/**
 * Chart rows on a fixed grid (30 min for 24 h, 1 h for 7 d): Google (last
 * reading at or before the grid time, at most 2 h old) and each exchange's
 * mid (median of the 10 min ending at the grid time), both indexed to 100 at
 * the first grid point where each has a value; premium = mid ÷ Google − 1.
 */
export function indexedSeries(
  google: readonly FxPoint[],
  mids: Partial<Record<"binance" | "bybit", readonly MidPoint[]>>,
  nowTs: number,
  spanSec: number,
  stepSec: number,
): IndexedPoint[] {
  const start = Math.ceil((nowTs - spanSec) / stepSec) * stepSec;
  const raw: { t: number; g: number | null; b: number | null; y: number | null }[] = [];
  // Grid points, plus "now" so the latest reading shows without waiting for the next grid step.
  const times: number[] = [];
  for (let t = start; t <= nowTs; t += stepSec) times.push(t);
  if (times[times.length - 1] !== nowTs) times.push(nowTs);
  for (const t of times) {
    const gi = lastAtOrBefore(google, t);
    const g = gi >= 0 && t - google[gi].ts <= 7200 ? google[gi].value : null;
    const b = mids.binance ? midAt(mids.binance, t) : null;
    const y = mids.bybit ? midAt(mids.bybit, t) : null;
    raw.push({ t, g, b, y });
  }
  const base = (k: "g" | "b" | "y") => raw.find((r) => r[k] != null)?.[k] ?? null;
  const g0 = base("g");
  const b0 = base("b");
  const y0 = base("y");
  const idx = (v: number | null, v0: number | null) => (v != null && v0 ? (v / v0) * 100 : null);
  const prem = (p: number | null, g: number | null) => (p != null && g ? p / g - 1 : null);
  return raw.map((r) => ({
    t: r.t * 1000,
    google: idx(r.g, g0),
    binance: idx(r.b, b0),
    bybit: idx(r.y, y0),
    binancePremium: prem(r.b, r.g),
    bybitPremium: prem(r.y, r.g),
  }));
}
