import { describe, expect, it } from "vitest";
import {
  classifyShowcase,
  depthCurve,
  LADDER_AMOUNTS,
  methodBreakdown,
  priceLadder,
  showcaseMap,
  thin,
  type StabilityStats,
} from "@/lib/market-insights";
import { ask, bid } from "@/lib/test-utils/ads";

describe("depthCurve", () => {
  it("cumulates bids downward and asks upward around the mid, padded to a symmetric domain", () => {
    const c = depthCurve([
      bid(330, { available: 10 }),
      bid(329, { available: 20 }),
      ask(336, { available: 15 }),
      ask(334, { available: 5 }),
    ]);
    expect(c.mid).toBe(332);
    expect(c.bidTotal).toBe(30);
    expect(c.askTotal).toBe(20);
    expect(c.domain).toEqual([328, 336]);
    expect(c.points).toEqual([
      { price: 328, bid: 30, ask: null }, // flat extension to the domain edge
      { price: 329, bid: 30, ask: null },
      { price: 330, bid: 10, ask: null },
      { price: 332, bid: 0, ask: 0 },
      { price: 334, bid: null, ask: 5 },
      { price: 336, bid: null, ask: 20 },
    ]);
  });

  it("merges ads at the same price into one level", () => {
    const c = depthCurve([bid(330, { available: 1 }), ask(334, { available: 5 }), ask(334, { available: 7 })]);
    expect(c.points.filter((p) => p.price === 334)).toEqual([{ price: 334, bid: null, ask: 12 }]);
  });

  it("caps the half-width at 4 % of mid so an outlier can't squash the chart", () => {
    const c = depthCurve([bid(330), ask(334), ask(1000)]);
    expect(c.domain![1] - c.mid!).toBeCloseTo(c.mid! * 0.04, 10);
  });

  it("ignores zero-price ads", () => {
    const c = depthCurve([bid(0, { available: 999 }), bid(330), ask(334)]);
    expect(c.bidTotal).toBe(100);
  });

  it("empty book → no points, null mid/domain", () => {
    expect(depthCurve([])).toEqual({ points: [], mid: null, domain: null, bidTotal: 0, askTotal: 0 });
  });

  it("one-sided book uses that side's best as the mid", () => {
    const c = depthCurve([ask(334, { available: 5 })]);
    expect(c.mid).toBe(334);
    expect(c.bidTotal).toBe(0);
    expect(c.points[0]).toEqual({ price: 334, bid: 0, ask: 0 });
  });
});

describe("priceLadder", () => {
  it("buy = walk asks, sell = walk bids, one row per amount", () => {
    const rows = priceLadder([ask(334, { available: 10_000 }), bid(330, { available: 10_000 })]);
    expect(rows.map((r) => r.amount)).toEqual([...LADDER_AMOUNTS]);
    expect(rows[0].buy.effectivePrice).toBeCloseTo(334, 9);
    expect(rows[0].sell.effectivePrice).toBeCloseTo(330, 9);
  });

  it("uses the shared walk: skips a too-big minimum and leaves offline ads out", () => {
    const ads = [
      ask(330, { available: 1000, minOrder: 100_000 }),
      ask(331, { available: 1000, online: false }),
      ask(332, { available: 1000 }),
    ];
    const [row] = priceLadder(ads, [50_000]);
    expect(row.buy.effectivePrice).toBeCloseTo(332, 9);
    const [all] = priceLadder(ads, [50_000], { includeOffline: true });
    expect(all.buy.effectivePrice).toBeCloseTo(331, 9);
  });
});

describe("methodBreakdown", () => {
  const BANK = { id: "BANK", name: "Bank Transfer" };
  const CASH = { id: "CASH", name: "" };

  it("groups by pay method; multi-method ads count towards each", () => {
    const rows = methodBreakdown(
      [
        ask(336, { payMethods: [BANK, CASH] }),
        ask(334, { payMethods: [BANK] }),
        bid(330, { payMethods: [BANK] }),
        bid(332, { payMethods: [BANK] }),
      ],
      1,
    );
    const bank = rows.find((r) => r.id === "BANK")!;
    expect(bank).toMatchObject({ buyPrice: 334, sellPrice: 332, spread: 2, askCount: 2, bidCount: 2 });
    expect(bank.spreadPct).toBeCloseTo(2 / 333, 12);
    const cash = rows.find((r) => r.id === "CASH")!;
    expect(cash).toMatchObject({ name: "CASH", buyPrice: 336, sellPrice: null, spread: null, spreadPct: null });
    // Busiest method first.
    expect(rows[0].id).toBe("BANK");
  });

  it("averages the best N prices", () => {
    const rows = methodBreakdown([ask(330), ask(332), ask(340), bid(320)], 2);
    expect(rows[0].buyPrice).toBe(331);
    expect(rows[0].askDepth).toBe(300);
  });
});

describe("classifyShowcase", () => {
  const base: StabilityStats = {
    merchantId: "m",
    samples: 24,
    firstTs: 0,
    lastTs: 3 * 3600,
    minAvailFiat: 1_000_000,
    maxAvailFiat: 1_000_000,
    // 500 orders / 30 d → 2.08 expected in 3 h: a frozen count is evidence.
    minOrders: 500,
    maxOrders: 500,
  };

  it("flags frozen amount + frozen order count over enough samples and span", () => {
    expect(classifyShowcase(base)).toEqual({
      level: "likely",
      samples: 24,
      spanSec: 10_800,
      availFiat: 1_000_000,
      expectedOrders: (500 * 10_800) / (30 * 86400),
      amountUnit: "fiat",
    });
  });

  it("flags 3 h of 10-minute sweeps (19 samples)", () => {
    expect(classifyShowcase({ ...base, samples: 19 })?.level).toBe("likely");
  });

  it("doesn't flag a low-frequency merchant whose pace predicts < 2 orders (F27)", () => {
    // DGAK: 15 orders / 30 d → 0.06 expected in 3 h.
    expect(classifyShowcase({ ...base, minOrders: 15, maxOrders: 15 })).toBeNull();
    // 479 / 30 d over 3 h = 1.996 → still not enough.
    expect(classifyShowcase({ ...base, minOrders: 479, maxOrders: 479 })).toBeNull();
    // A longer frozen window makes the same pace count: 240 / 30 d over 6 h = 2.
    expect(classifyShowcase({ ...base, minOrders: 240, maxOrders: 240, lastTs: 6 * 3600 })).not.toBeNull();
  });

  it("compares USDT when available, so a repriced idle ad is still caught", () => {
    const repriced = { ...base, minAvailFiat: 950_000, maxAvailFiat: 1_000_000, minAvailAsset: 2_870, maxAvailAsset: 2_870 };
    expect(classifyShowcase(repriced)?.amountUnit).toBe("asset");
    // …and a USDT change unflags it even if LKR looks frozen.
    expect(classifyShowcase({ ...base, minAvailAsset: 2_000, maxAvailAsset: 2_870 })).toBeNull();
  });

  it("tolerates a ≤1 % amount wobble", () => {
    expect(classifyShowcase({ ...base, minAvailFiat: 990_000 })).not.toBeNull();
    expect(classifyShowcase({ ...base, minAvailFiat: 989_000 })).toBeNull();
  });

  it.each([
    ["too few samples", { samples: 11 }],
    ["too short a span", { lastTs: 3 * 3600 - 1 }],
    ["orders moved", { maxOrders: 501 }],
    ["orders unknown", { minOrders: null }],
    ["amount unknown", { maxAvailFiat: null }],
    ["nothing listed", { minAvailFiat: 0, maxAvailFiat: 0 }],
  ])("not flagged when %s", (_label, patch) => {
    expect(classifyShowcase({ ...base, ...patch } as StabilityStats)).toBeNull();
  });

  it("showcaseMap keeps only flagged merchants", () => {
    const m = showcaseMap([base, { ...base, merchantId: "busy", maxOrders: 560 }]);
    expect(Object.keys(m)).toEqual(["m"]);
  });
});

describe("thin", () => {
  it("returns a copy when already short enough", () => {
    const xs = [1, 2, 3];
    const out = thin(xs, 3);
    expect(out).toEqual(xs);
    expect(out).not.toBe(xs);
  });

  it("evenly samples down to max points, keeping first and last", () => {
    const xs = Array.from({ length: 101 }, (_, i) => i);
    const out = thin(xs, 5);
    expect(out).toEqual([0, 25, 50, 75, 100]);
  });
});
