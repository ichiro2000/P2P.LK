import { median, robustZ } from "@/lib/stats";
import {
  CBSL_STALE_DAYS,
  LAG_SHARE,
  dayTs,
  lagGap,
  type Change,
  type Lag,
  type Link,
  type Verdict,
} from "@/lib/dollar-signals";

/**
 * Pure signal maths behind the risk page (no DB), so the thresholds can be
 * unit-tested and back-tested on normal data.
 *
 * Calibration (DATA-AUDIT F8 / F9): a signal needs BOTH a statistical
 * surprise and a move large enough to matter for a trade, so the quiet
 * step-priced P2P market doesn't light up on one-tick changes.
 */

/* ── Price move ──────────────────────────────────────────────────────── */

/** Window of the change we score, and the grid it is measured on. */
export const MOVE_WINDOW_SEC = 15 * 60;
export const MOVE_GRID_SEC = 5 * 60;
/** Robust scale floor: 0.05 %. Below that one price tick looks infinite. */
export const MOVE_MIN_SCALE = 0.0005;
export const MOVE_WARN = { z: 3, abs: 0.0025 } as const;
export const MOVE_ALERT = { z: 5, abs: 0.005 } as const;
/** The latest change must end this close to now to count as "current". */
export const MOVE_MAX_LAG_SEC = 10 * 60;

export type PriceMove = {
  /** Latest 15-min change of the mid (fraction), null if not computable. */
  move: number | null;
  /** Robust z of `move` against the earlier 15-min changes in the sample. */
  z: number | null;
  /** Median |change| of the sample: a "typical" 15-min move. */
  typical: number | null;
  /** Changes in the reference sample. */
  n: number;
  level: "ok" | "warn" | "alert";
};

/**
 * 15-min returns r_t = mid_t / mid_{t−15m} − 1 on a 5-min grid (bucket means),
 * skipping pairs where either end is missing. The latest return is scored
 * against all earlier ones with a robust z (median / 1.4826·MAD).
 */
export function priceMove(points: readonly { ts: number; mid: number | null }[], nowSec: number): PriceMove {
  const grid = new Map<number, { s: number; n: number }>();
  for (const p of points) {
    if (p.mid == null || !Number.isFinite(p.mid) || p.mid <= 0) continue;
    const b = Math.floor(p.ts / MOVE_GRID_SEC) * MOVE_GRID_SEC;
    const g = grid.get(b) ?? { s: 0, n: 0 };
    g.s += p.mid;
    g.n += 1;
    grid.set(b, g);
  }
  const mids = new Map([...grid].map(([b, g]) => [b, g.s / g.n]));
  const keys = [...mids.keys()].sort((a, b) => a - b);
  const rets: { ts: number; r: number }[] = [];
  for (const t of keys) {
    const prev = mids.get(t - MOVE_WINDOW_SEC);
    if (prev != null) rets.push({ ts: t, r: mids.get(t)! / prev - 1 });
  }
  const none: PriceMove = { move: null, z: null, typical: null, n: 0, level: "ok" };
  if (rets.length < 2) return none;
  const last = rets[rets.length - 1];
  // Bucket start + one bucket = end of the latest measured interval.
  if (nowSec - (last.ts + MOVE_GRID_SEC) > MOVE_MAX_LAG_SEC) return { ...none, n: rets.length - 1 };
  const sample = rets.slice(0, -1).map((x) => x.r);
  const z = sample.length >= 12 ? robustZ(sample, last.r, MOVE_MIN_SCALE) : null;
  const typical = median(sample.map(Math.abs));
  const abs = Math.abs(last.r);
  const level =
    z != null && Math.abs(z) >= MOVE_ALERT.z && abs >= MOVE_ALERT.abs
      ? "alert"
      : z != null && Math.abs(z) >= MOVE_WARN.z && abs >= MOVE_WARN.abs
        ? "warn"
        : "ok";
  return { move: last.r, z, typical, n: sample.length, level };
}

/* ── Near-touch depth drop ───────────────────────────────────────────── */

export const DEPTH_WARN = 0.35;
export const DEPTH_ALERT = 0.15;
/** "Now" is the median of the last 15 minutes, so one odd minute can't fire. */
export const DEPTH_NOW_SEC = 15 * 60;
/** At least this many points in the baseline. */
export const DEPTH_MIN_POINTS = 12;

export type DepthDrop = {
  now: number | null;
  baseline: number | null;
  ratio: number | null;
  level: "ok" | "warn" | "alert";
};

/** Median depth of the last 15 min vs the median of the whole window. */
export function depthDrop(
  points: readonly { ts: number; v: number | null }[],
  nowSec: number,
): DepthDrop {
  const vals = points.filter((p): p is { ts: number; v: number } => p.v != null && Number.isFinite(p.v));
  const recent = vals.filter((p) => p.ts > nowSec - DEPTH_NOW_SEC).map((p) => p.v);
  const now = median(recent);
  const baseline = median(vals.map((p) => p.v));
  if (now == null || baseline == null || baseline <= 0 || vals.length < DEPTH_MIN_POINTS) {
    return { now, baseline, ratio: null, level: "ok" };
  }
  const ratio = now / baseline;
  return { now, baseline, ratio, level: ratio < DEPTH_ALERT ? "alert" : ratio < DEPTH_WARN ? "warn" : "ok" };
}

/* ── Merchant churn ──────────────────────────────────────────────────── */

export const CHURN_WARN = { share: 0.15, min: 5 } as const;
export const CHURN_ALERT = { share: 0.3, min: 10 } as const;

export type Churn = {
  /** Listing now, first seen after the baseline sweep. */
  fresh: number;
  /** In the baseline sweep, not listing now (noisy: sweeps are capped). */
  gone: number;
  current: number;
  baseline: number;
  level: "ok" | "warn" | "alert";
};

/**
 * Like-with-like churn: the latest sweep vs the sweep about an hour earlier.
 * "Fresh" uses each merchant's first-ever sighting, so a merchant who was
 * simply quiet for a while doesn't count as new.
 */
export function churn(
  current: readonly { merchantId: string; firstSeenTs: number }[],
  baselineIds: ReadonlySet<string>,
  baselineTs: number,
): Churn {
  const now = new Set(current.map((m) => m.merchantId));
  const fresh = current.filter((m) => m.firstSeenTs > baselineTs).length;
  let gone = 0;
  for (const id of baselineIds) if (!now.has(id)) gone++;
  const share = baselineIds.size ? fresh / baselineIds.size : 0;
  const level =
    fresh >= CHURN_ALERT.min && share >= CHURN_ALERT.share
      ? "alert"
      : fresh >= CHURN_WARN.min && share >= CHURN_WARN.share
        ? "warn"
        : "ok";
  return { fresh, gone, current: current.length, baseline: baselineIds.size, level };
}

/* ── Dollar rate vs USDT (Google intraday, CBSL daily) ───────────────── */

/**
 * Google signal ("USD up — USDT likely to rise"). Fires when Google moved at
 * least `move` in 2 h AND USDT lags (it moved less than half the expected
 * move). Alert from `alertMove`, only once the link is measured.
 * `expectedMin` stops a tiny measured beta from firing on noise.
 * Calibration and back-test: lib/dollar-signals.test.ts.
 */
export const USD_SIGNAL = {
  windowSec: 2 * 3600,
  move: 0.0015,
  alertMove: 0.005,
  lagShare: LAG_SHARE,
  expectedMin: 0.0005,
} as const;

/** CBSL day change: a slow, official rate, so context — "watch" (info) from
 *  0.5 %, warn from 1 %. Back-tested on the stored CBSL year. */
export const CBSL_SIGNAL = { watch: 0.005, warn: 0.01 } as const;

export type UsdSignal = {
  direction: "up" | "down";
  level: "info" | "warn" | "alert";
  move: Change;
  lag: Lag;
  verdict: Verdict;
};

/**
 * "USD up — USDT likely to rise" / "USD down — USDT likely to fall".
 * Needs a current Google reading and current USDT data, |2 h Google move| ≥
 * 0.15 %, USDT lagging by at least half the expected move, and an expected
 * move of at least 0.05 %. Level: warn; alert from 0.5 % once the link is
 * confirmed; info when we have enough data but no clear link; nothing when
 * the data contradicts the hypothesis.
 */
export function usdSignal(input: {
  move: Change | null;
  googleStale: boolean;
  usdtStale: boolean;
  /** USDT mid change from the Google window start to now. */
  usdtSince: number | null;
  link: Pick<Link, "beta" | "verdict">;
}): UsdSignal | null {
  const { move, link: l } = input;
  if (!move || input.googleStale || input.usdtStale || input.usdtSince == null) return null;
  if (Math.abs(move.pct) < USD_SIGNAL.move - 1e-12) return null;
  if (l.verdict === "contradicted") return null;
  const lag = lagGap(move.pct, input.usdtSince, l, USD_SIGNAL.lagShare);
  if (!lag.lagging || Math.abs(lag.expected) < USD_SIGNAL.expectedMin) return null;
  const level =
    l.verdict === "unclear"
      ? "info"
      : l.verdict === "confirmed" && Math.abs(move.pct) >= USD_SIGNAL.alertMove
        ? "alert"
        : "warn";
  return { direction: move.pct > 0 ? "up" : "down", level, move, lag, verdict: l.verdict };
}

export type CbslSignal = {
  direction: "up" | "down";
  level: "info" | "warn";
  change: Change & { day: string; prevDay: string };
};

/** CBSL day change ≥ 0.5 % → watch (info); ≥ 1 % → warn. Only when the
 *  latest CBSL day is recent (≤ 5 calendar days old). */
export function cbslSignal(c: (Change & { day: string; prevDay: string }) | null, today: string): CbslSignal | null {
  if (!c) return null;
  if (dayTs(today) - dayTs(c.day) > CBSL_STALE_DAYS * 86400) return null;
  const a = Math.abs(c.pct);
  if (a < CBSL_SIGNAL.watch - 1e-12) return null;
  return { direction: c.pct > 0 ? "up" : "down", level: a >= CBSL_SIGNAL.warn ? "warn" : "info", change: c };
}
