import { describe, expect, it } from "vitest";
import { histogram, mean, sma, stdev, zScoreOfLast } from "@/lib/stats";

describe("mean / stdev", () => {
  it("mean of empty is null", () => {
    expect(mean([])).toBeNull();
    expect(mean([1, 2, 3, 4])).toBe(2.5);
  });

  it("sample standard deviation (n − 1); single value → 0", () => {
    expect(stdev([])).toBeNull();
    expect(stdev([5])).toBe(0);
    expect(stdev([2, 4, 4, 4, 5, 5, 7, 9])).toBeCloseTo(Math.sqrt(32 / 7), 12);
  });
});

describe("sma", () => {
  it("keeps the input length; leading points are running means", () => {
    expect(sma([1, 2, 3, 4, 5], 3)).toEqual([1, 1.5, 2, 3, 4]);
  });

  it("window 1 is the identity", () => {
    expect(sma([3, 1, 4], 1)).toEqual([3, 1, 4]);
  });

  it("nulls carry the previous average forward and don't enter the window", () => {
    expect(sma([2, null, 4, 6], 2)).toEqual([2, 2, 3, 5]);
  });

  it("leading nulls stay null; empty in → empty out", () => {
    expect(sma([null, null, 2], 3)).toEqual([null, null, 2]);
    expect(sma([], 5)).toEqual([]);
  });
});

describe("zScoreOfLast", () => {
  it("z-score of the last value against the earlier ones", () => {
    const prior = [1, 2, 3, 4];
    const m = 2.5;
    const s = Math.sqrt(((1.5 ** 2) * 2 + (0.5 ** 2) * 2) / 3);
    expect(zScoreOfLast([...prior, 10])).toBeCloseTo((10 - m) / s, 12);
  });

  it("ignores nulls", () => {
    expect(zScoreOfLast([1, null, 2, 3, 4, null, 10])).toBeCloseTo(zScoreOfLast([1, 2, 3, 4, 10])!, 12);
  });

  it("needs at least 4 values and a non-zero spread", () => {
    expect(zScoreOfLast([1, 2, 3])).toBeNull();
    expect(zScoreOfLast([1, null, 2, null, 3])).toBeNull();
    expect(zScoreOfLast([5, 5, 5, 9])).toBeNull();
  });
});

describe("histogram", () => {
  it("empty input", () => {
    expect(histogram([])).toEqual({ bins: [], counts: [], min: 0, max: 0 });
  });

  it("all-equal values collapse to one bin", () => {
    expect(histogram([3, 3, 3])).toEqual({ bins: [3], counts: [3], min: 3, max: 3 });
  });

  it("equal-width buckets with bin centres; the max lands in the last bucket", () => {
    const h = histogram([0, 1, 2, 3, 4, 10], 5);
    expect(h.min).toBe(0);
    expect(h.max).toBe(10);
    expect(h.bins).toEqual([1, 3, 5, 7, 9]);
    // 0,1 → [0,2) · 2,3 → [2,4) · 4 → [4,6) · 10 (= max) → last bucket
    expect(h.counts).toEqual([2, 2, 1, 0, 1]);
  });

  it("defaults to 20 buckets", () => {
    const h = histogram([0, 100]);
    expect(h.counts).toHaveLength(20);
    expect(h.counts[0]).toBe(1);
    expect(h.counts[19]).toBe(1);
  });
});

import { downsampleMinMax, mad, median, percentileRank, robustZ, timeSma } from "@/lib/stats";

describe("robust helpers", () => {
  it("median / mad", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
    expect(median([])).toBeNull();
    expect(mad([1, 1, 2, 2, 4, 6, 9])).toBe(1);
  });

  it("robustZ floors the scale so step data with MAD 0 doesn't explode", () => {
    expect(robustZ([0, 0, 0, 0], 0.001, 0.0005)).toBeCloseTo(2, 9);
    expect(robustZ([0, 0, 0, 0], 0.001)).toBeNull();
  });

  it("percentileRank counts below plus half the ties", () => {
    expect(percentileRank([1, 2, 3, 4], 3)).toBe(0.625);
    expect(percentileRank([], 1)).toBeNull();
  });
});

describe("timeSma (F22)", () => {
  const ts = Array.from({ length: 10 }, (_, i) => i * 60);
  it("null until a full window of data is behind the point", () => {
    const v = timeSma(ts, ts.map(() => 10), 180, { expectedPerSec: 1 / 60 });
    expect(v.slice(0, 3)).toEqual([null, null, null]);
    expect(v[3]).toBe(10);
  });

  it("averages by time, and goes null across a gap", () => {
    const vals = [1, 2, 3, 4, null, null, null, null, 9, 10];
    const v = timeSma(ts, vals, 120, { expectedPerSec: 1 / 60 });
    expect(v[3]).toBe(3.5);
    expect(v[4]).toBeNull(); // no value at the point itself
    expect(v[8]).toBe(9); // half the window has data: allowed at the default 50 %
    const strict = timeSma(ts, vals, 120, { expectedPerSec: 1 / 60, minCoverage: 0.75 });
    expect(strict[8]).toBeNull();
    expect(strict[9]).toBe(9.5);
  });
});

describe("downsampleMinMax", () => {
  it("keeps each slice's min and max, in time order, and the last point", () => {
    const xs = [5, 9, 1, 5, 5, 5, 5, 7];
    const out = downsampleMinMax(xs, 5, (x) => x);
    expect(out).toContain(9);
    expect(out).toContain(1);
    expect(out[out.length - 1]).toBe(7);
  });

  it("an all-null slice keeps one null so gaps survive", () => {
    const xs = Array.from({ length: 30 }, (_, i) => (i >= 10 && i < 22 ? null : i));
    expect(downsampleMinMax(xs, 10, (x) => x)).toContain(null);
  });
});
