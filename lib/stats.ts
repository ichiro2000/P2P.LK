/** Small, dependency-free stats helpers used by historical/risk views. */

export function mean(xs: readonly number[]): number | null {
  if (!xs.length) return null;
  let s = 0;
  for (const x of xs) s += x;
  return s / xs.length;
}

export function stdev(xs: readonly number[]): number | null {
  const m = mean(xs);
  if (m == null) return null;
  if (xs.length < 2) return 0;
  let s = 0;
  for (const x of xs) s += (x - m) ** 2;
  return Math.sqrt(s / (xs.length - 1));
}

/** Simple moving average with no leading NaNs — output has the same length,
 *  with points before `window` filled with running-mean values. */
export function sma(xs: readonly (number | null)[], window: number): (number | null)[] {
  const out: (number | null)[] = [];
  const buf: number[] = [];
  let sum = 0;
  for (let i = 0; i < xs.length; i++) {
    const v = xs[i];
    if (v == null) {
      out.push(out[i - 1] ?? null);
      continue;
    }
    buf.push(v);
    sum += v;
    if (buf.length > window) {
      sum -= buf.shift() as number;
    }
    out.push(sum / buf.length);
  }
  return out;
}

/** z-score of the last element vs prior window. Returns null if insufficient data. */
export function zScoreOfLast(xs: readonly (number | null)[]): number | null {
  const clean = xs.filter((x): x is number => x != null);
  if (clean.length < 4) return null;
  const last = clean[clean.length - 1];
  const prior = clean.slice(0, -1);
  const m = mean(prior);
  const s = stdev(prior);
  if (m == null || s == null || s === 0) return null;
  return (last - m) / s;
}

/** Histogram buckets for price distribution. */
export function histogram(xs: readonly number[], buckets = 20) {
  if (!xs.length) return { bins: [], counts: [], min: 0, max: 0 };
  const min = Math.min(...xs);
  const max = Math.max(...xs);
  if (min === max) {
    return {
      bins: [min],
      counts: [xs.length],
      min,
      max,
    };
  }
  const width = (max - min) / buckets;
  const counts = new Array(buckets).fill(0);
  for (const x of xs) {
    const idx = Math.min(buckets - 1, Math.floor((x - min) / width));
    counts[idx] += 1;
  }
  const bins = counts.map((_, i) => min + width * i + width / 2);
  return { bins, counts, min, max };
}

/** Median of finite numbers; null when empty. */
export function median(xs: readonly number[]): number | null {
  const s = xs.filter((x) => Number.isFinite(x)).sort((a, b) => a - b);
  if (!s.length) return null;
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** Median absolute deviation from the median (unscaled). */
export function mad(xs: readonly number[]): number | null {
  const m = median(xs);
  if (m == null) return null;
  return median(xs.map((x) => Math.abs(x - m)));
}

/** Share of `xs` strictly below `v`, plus half the ties (0..1). Null if empty. */
export function percentileRank(xs: readonly number[], v: number): number | null {
  const clean = xs.filter((x) => Number.isFinite(x));
  if (!clean.length || !Number.isFinite(v)) return null;
  let below = 0;
  let equal = 0;
  for (const x of clean) {
    if (x < v) below++;
    else if (x === v) equal++;
  }
  return (below + equal / 2) / clean.length;
}

/**
 * Robust z-score: (x − median) / (1.4826 · MAD), with a floor on the scale.
 * P2P prices move in steps, so most short-window changes are exactly 0 and the
 * MAD can be 0; `minScale` keeps a single tick from looking infinite.
 */
export function robustZ(sample: readonly number[], x: number, minScale = 0): number | null {
  const m = median(sample);
  const d = mad(sample);
  if (m == null || d == null || !Number.isFinite(x)) return null;
  const scale = Math.max(1.4826 * d, minScale);
  return scale > 0 ? (x - m) / scale : null;
}

/**
 * Time-based moving average over `windowSec` on a (possibly gappy) series.
 * Point i averages the non-null values with ts in (ts_i − window, ts_i],
 * weighted by `w` (samples). Null when the point itself is null, when the
 * data doesn't reach back a full window, or when less than `minCoverage` of
 * the window has samples (so a gap never turns into a flat average).
 * `expectedPerSec` = samples one second of full data would carry.
 */
export function timeSma(
  ts: readonly number[],
  vals: readonly (number | null)[],
  windowSec: number,
  opts: { w?: readonly number[]; expectedPerSec: number; minCoverage?: number },
): (number | null)[] {
  const minCov = opts.minCoverage ?? 0.5;
  const out: (number | null)[] = [];
  let lo = 0;
  let sum = 0;
  let wsum = 0;
  const first = ts[0];
  for (let i = 0; i < ts.length; i++) {
    const v = vals[i];
    const w = opts.w?.[i] ?? 1;
    if (v != null && Number.isFinite(v)) {
      sum += v * w;
      wsum += w;
    }
    while (lo <= i && ts[lo] <= ts[i] - windowSec) {
      const lv = vals[lo];
      const lw = opts.w?.[lo] ?? 1;
      if (lv != null && Number.isFinite(lv)) {
        sum -= lv * lw;
        wsum -= lw;
      }
      lo++;
    }
    const full = ts[i] - first >= windowSec - 1e-9;
    const covered = wsum >= minCov * windowSec * opts.expectedPerSec;
    out.push(v != null && full && covered && wsum > 0 ? sum / wsum : null);
  }
  return out;
}

/**
 * Downsample to about `max` points keeping each slice's lowest and highest
 * value (in time order), so spikes survive (F28). A slice with no values
 * keeps one null point, so gaps survive too. The last point is always kept.
 */
export function downsampleMinMax<T>(xs: readonly T[], max: number, val: (x: T) => number | null): T[] {
  if (xs.length <= max || max < 4) return xs.slice();
  const slices = Math.max(1, Math.floor((max - 1) / 2));
  const step = (xs.length - 1) / slices;
  const out: T[] = [];
  for (let s = 0; s < slices; s++) {
    const a = Math.floor(s * step);
    const b = Math.max(a + 1, Math.floor((s + 1) * step));
    let iMin = -1;
    let iMax = -1;
    for (let i = a; i < b; i++) {
      const v = val(xs[i]);
      if (v == null || !Number.isFinite(v)) continue;
      if (iMin < 0 || v < (val(xs[iMin]) as number)) iMin = i;
      if (iMax < 0 || v > (val(xs[iMax]) as number)) iMax = i;
    }
    if (iMin < 0) out.push(xs[a]);
    else if (iMin === iMax) out.push(xs[iMin]);
    else for (const i of iMin < iMax ? [iMin, iMax] : [iMax, iMin]) out.push(xs[i]);
  }
  out.push(xs[xs.length - 1]);
  return out;
}
