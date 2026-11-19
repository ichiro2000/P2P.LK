import { describe, expect, it, vi } from "vitest";

// history.ts loads rows from D1; only the pure bucketing is tested here.
vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(), schema: {} }));

import { bucketOffset, bucketize, downsample, downsampleBy, type HistPoint } from "@/lib/history";

type Row = Parameters<typeof bucketize>[0][number];

const row = (ts: number, mid: number | null, over: Partial<Row> = {}): Row => ({
  ts,
  bid: mid == null ? null : mid - 1,
  ask: mid == null ? null : mid + 1,
  mid,
  spreadPct: mid == null ? null : 2 / mid,
  bidDepth: 10,
  askDepth: 20,
  bidDepthFiat: 3_300,
  askDepthFiat: 6_600,
  bidDepth05: null,
  askDepth05: null,
  bidDepth1: null,
  askDepth1: null,
  open: mid,
  high: mid,
  low: mid,
  close: mid,
  w: 1,
  ...over,
});

describe("bucketize", () => {
  it("aligns buckets to multiples of the bucket size", () => {
    const out = bucketize([row(59, 330), row(60, 331), row(119, 332), row(185, 333)], 60);
    expect(out.map((p) => [p.ts, p.samples])).toEqual([
      [0, 1],
      [60, 2],
      [180, 1],
    ]);
  });

  it("real OHLC: first open, max high, min low, last close", () => {
    const [p] = bucketize([row(0, 330), row(10, 335), row(20, 328), row(30, 331)], 60);
    expect(p).toMatchObject({ open: 330, high: 335, low: 328, close: 331 });
    expect(p.mid).toBeCloseTo((330 + 335 + 328 + 331) / 4, 12);
  });

  it("averages are weighted by each row's sample count (hourly rollups)", () => {
    const [p] = bucketize([row(0, 300, { w: 3 }), row(3600, 340, { w: 1 })], 7200);
    expect(p.samples).toBe(4);
    expect(p.mid).toBeCloseTo((300 * 3 + 340) / 4, 12);
  });

  it("null values are skipped, not counted as zero; all-null → null", () => {
    const out = bucketize([row(0, null), row(10, 330), row(70, null)], 60);
    expect(out[0]).toMatchObject({ mid: 330, open: 330, close: 330, samples: 2 });
    expect(out[1]).toMatchObject({ mid: null, open: null, high: null, low: null, close: null, bidDepth: 10 });
  });

  it("string numbers from D1 are coerced; junk is ignored", () => {
    const [p] = bucketize(
      [row(0, 330, { bidDepth: "12" as unknown as number }), row(1, 330, { bidDepth: "n/a" as unknown as number })],
      60,
    );
    expect(p.bidDepth).toBe(12);
  });

  it("empty input → empty output", () => {
    expect(bucketize([], 60)).toEqual([]);
  });

  it("returns every HistPoint field", () => {
    const [p] = bucketize([row(0, 330)], 60);
    const keys: (keyof HistPoint)[] = [
      "ts", "bid", "ask", "mid", "spreadPct", "bidDepth", "askDepth", "bidDepthFiat",
      "askDepthFiat", "bidDepth05", "askDepth05", "bidDepth1", "askDepth1",
      "open", "high", "low", "close", "samples",
    ];
    expect(Object.keys(p).sort()).toEqual([...keys].sort());
  });
});

describe("downsample", () => {
  it("copies short input", () => {
    const xs = [1, 2, 3];
    expect(downsample(xs, 3)).toEqual(xs);
    expect(downsample(xs, 3)).not.toBe(xs);
  });

  it("even stride to max items, always keeping the last", () => {
    const xs = Array.from({ length: 10 }, (_, i) => i);
    expect(downsample(xs, 4)).toEqual([0, 2, 5, 9]);
    expect(downsample(xs, 1)).toEqual([9]);
  });
});

describe("bucketize: gaps and Sri Lanka alignment", () => {
  it("fill inserts null buckets for missing slots, so gaps stay gaps (F21)", () => {
    const out = bucketize([row(0, 330), row(180, 333)], 60, { fill: { from: 0, to: 240 } });
    expect(out.map((p) => [p.ts, p.mid, p.samples])).toEqual([
      [0, 330, 1],
      [60, null, 0],
      [120, null, 0],
      [180, 333, 1],
      [240, null, 0],
    ]);
    expect(out[1]).toMatchObject({ bid: null, open: null, bidDepth: null, askDepth1: null });
  });

  it("1-hour buckets from raw rows start on Sri Lanka hours (xx:30 UTC)", () => {
    expect(bucketOffset(3600, false)).toBe(1800);
    // 18:29 UTC = 23:59 SLT and 18:30 UTC = 00:00 SLT land in different hours.
    const t1829 = 18 * 3600 + 29 * 60;
    const t1830 = 18 * 3600 + 30 * 60;
    const out = bucketize([row(t1829, 330), row(t1830, 331)], 3600, { offset: bucketOffset(3600, false) });
    expect(out.map((p) => p.ts)).toEqual([17 * 3600 + 1800, 18 * 3600 + 1800]);
  });

  it("hourly rollups (UTC hours) can only use whole-hour offsets; sub-hour grids need none", () => {
    expect(bucketOffset(3600, true)).toBe(0);
    expect(bucketOffset(43200, true)).toBe(18000);
    expect(bucketOffset(300, false)).toBe(0);
    expect(bucketOffset(900, false)).toBe(0);
  });
});

describe("downsampleBy", () => {
  it("keeps a one-point spike that even-stride sampling would drop (F28)", () => {
    const xs = Array.from({ length: 100 }, (_, i) => ({ i, v: i === 37 ? 999 : 1 }));
    expect(downsample(xs, 10).some((x) => x.v === 999)).toBe(false);
    expect(downsampleBy(xs, 10, (x) => x.v).some((x) => x.v === 999)).toBe(true);
  });
});
