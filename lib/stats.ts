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
