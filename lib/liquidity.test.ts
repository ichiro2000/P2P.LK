import { describe, expect, it } from "vitest";
import {
  concentrationByMerchant,
  fillableWithin,
  isTradable,
  orderCapFiat,
  quoteAmount,
  walkBook,
} from "@/lib/liquidity";
import { ask, bid } from "@/lib/test-utils/ads";

describe("walkBook", () => {
  it("SELL side (buying USDT): walks asks cheapest first, slippage = (eff − top) / top", () => {
    // Input deliberately unsorted.
    const ads = [
      ask(340, { available: 100, merchant: { id: "C" } }),
      ask(330, { available: 100, merchant: { id: "A" } }), // 33,000 LKR
      ask(335, { available: 100, merchant: { id: "B" } }), // 33,500 LKR
    ];
    const r = walkBook(ads, "SELL", 50_000);
    expect(r.steps.map((s) => s.price)).toEqual([330, 335]);
    expect(r.filledFiat).toBe(50_000);
    const asset = 100 + 17_000 / 335;
    expect(r.filledAsset).toBeCloseTo(asset, 10);
    expect(r.effectivePrice).toBeCloseTo(50_000 / asset, 10);
    expect(r.topPrice).toBe(330);
    expect(r.slippagePct).toBeCloseTo((50_000 / asset - 330) / 330, 12);
    expect(r.shortfall).toBe(0);
    expect(r.partial).toBe(false);
    expect(r.adsConsumed).toBe(2);
    expect(r.merchantsConsumed).toBe(2);
    expect(r.steps[1]).toMatchObject({ cumulativeFiat: 50_000, fiatFilled: 17_000 });
  });

  it("BUY side (selling USDT): walks bids highest first, slippage = (top − eff) / top", () => {
    const r = walkBook([bid(320, { available: 100 }), bid(330, { available: 100 })], "BUY", 40_000);
    expect(r.steps.map((s) => s.price)).toEqual([330, 320]);
    expect(r.effectivePrice!).toBeLessThan(330);
    expect(r.slippagePct).toBeCloseTo((330 - r.effectivePrice!) / 330, 12);
  });

  it("filling entirely at top of book has zero slippage", () => {
    const r = walkBook([ask(330, { available: 1000 }), ask(340)], "SELL", 10_000);
    expect(r.slippagePct).toBe(0);
    expect(r.adsConsumed).toBe(1);
  });

  it("reports a shortfall when the book is too thin", () => {
    const r = walkBook([ask(330, { available: 10 })], "SELL", 10_000);
    expect(r.filledFiat).toBe(3_300);
    expect(r.shortfall).toBe(6_700);
    expect(r.partial).toBe(true);
  });

  it("caps each ad at its max order", () => {
    const r = walkBook(
      [ask(330, { available: 1000, maxOrder: 5_000 }), ask(331, { available: 1000 })],
      "SELL",
      10_000,
    );
    expect(r.steps.map((s) => s.fiatFilled)).toEqual([5_000, 5_000]);
  });

  it("F1: skips (does not stop at) an ad whose min order exceeds what is left", () => {
    const r = walkBook(
      [
        ask(330, { available: 10 }), // 3,300
        ask(331, { available: 1000, minOrder: 50_000 }),
        ask(332, { available: 1000 }),
      ],
      "SELL",
      10_000,
    );
    expect(r.steps.map((s) => s.price)).toEqual([330, 332]);
    expect(r.filledFiat).toBe(10_000);
    expect(r.skippedForMin).toBe(1);
    expect(r.partial).toBe(false);
  });

  it("F1: never fills an ad below its own minimum (cap < min → unusable)", () => {
    // 10 USDT × 330 = 3,300 LKR available but the ad's minimum is 5,000.
    const tiny = ask(330, { available: 10, minOrder: 5_000 });
    expect(orderCapFiat(tiny)).toBe(0);
    const r = walkBook([tiny, ask(335, { available: 1000 })], "SELL", 3_000);
    expect(r.steps.map((s) => s.price)).toEqual([335]);
  });

  it("audit F1 worked example: a Rs 50,000 buy on Binance fills (skips DGAK's Rs 104.5k minimum)", () => {
    // Binance asks, sweep 2026-11-19 (normalised: net available, dynamic max).
    const book = [
      ask(348.36, { available: 300, minOrder: 104_500, maxOrder: 104_508, merchant: { id: "DGAK" } }),
      ask(348.4, { available: 1998.6, minOrder: 300_000, maxOrder: 450_000, merchant: { id: "S_P_I_D_E_R" } }),
      ask(348.45, { available: 1998.6, minOrder: 60_000, maxOrder: 250_000, merchant: { id: "PANDA" } }),
      ask(348.5, { available: 3651.38, minOrder: 200_000, maxOrder: 1_272_507, merchant: { id: "NUWA" } }),
      ask(348.8, { available: 1223.16, minOrder: 50_000, maxOrder: 426_639, merchant: { id: "LAYA1ST" } }),
    ];
    const r = walkBook(book, "SELL", 50_000);
    expect(r.filledFiat).toBe(50_000);
    expect(r.effectivePrice).toBeCloseTo(348.8, 9);
    expect(r.steps[0].merchantId).toBe("LAYA1ST");
    expect(r.skippedForMin).toBe(4);
    // Rs 500k: DGAK takes its 104,508 max, the 395,492 left clears S_P_I_D_E_R's 300k minimum.
    const big = walkBook(book, "SELL", 500_000);
    expect(big.partial).toBe(false);
    expect(big.steps.map((s) => s.merchantId)).toEqual(["DGAK", "S_P_I_D_E_R"]);
    expect(big.steps[1].fiatFilled).toBeCloseTo(500_000 - 104_508, 6);
  });

  it("walks in USDT when unit is asset", () => {
    const r = walkBook([bid(330, { available: 5 }), bid(320, { available: 100 })], "BUY", 10, { unit: "asset" });
    expect(r.unit).toBe("asset");
    expect(r.filledAsset).toBeCloseTo(10, 12);
    expect(r.filledFiat).toBeCloseTo(5 * 330 + 5 * 320, 9);
    expect(r.targetFiat).toBeNull();
    expect(r.partial).toBe(false);
  });

  it("USDT walk respects the LKR min order of each ad", () => {
    const r = walkBook(
      [bid(330, { available: 100, minOrder: 50_000 }), bid(320, { available: 100 })],
      "BUY",
      10,
      { unit: "asset" },
    );
    expect(r.steps.map((s) => s.price)).toEqual([320]);
  });

  it("F16/F17: leaves offline and restricted ads out by default, counts them as excluded", () => {
    const ads = [
      ask(330, { available: 1000, online: false }),
      ask(331, { available: 1000, restricted: true }),
      ask(332, { available: 1000 }),
    ];
    const r = walkBook(ads, "SELL", 10_000);
    expect(r.steps.map((s) => s.price)).toEqual([332]);
    expect(r.topPrice).toBe(332);
    expect(r.excluded).toBe(2);
    const all = walkBook(ads, "SELL", 10_000, { includeOffline: true, includeRestricted: true });
    expect(all.steps.map((s) => s.price)).toEqual([330]);
    expect(all.excluded).toBe(0);
    expect(isTradable(ads[0])).toBe(false);
    expect(isTradable(ads[0], { includeOffline: true })).toBe(true);
    expect(isTradable(ask(1))).toBe(true); // unknown online status = online
  });

  it("flags steps whose ad has a min order", () => {
    const r = walkBook([ask(330, { available: 1000, minOrder: 1_000 })], "SELL", 5_000);
    expect(r.steps[0].minOrderRespected).toBe(true);
  });

  it("skips ads with no availability or a non-positive price", () => {
    const r = walkBook(
      [ask(0, { available: 100 }), ask(330, { available: 0 }), ask(335, { available: 100 })],
      "SELL",
      1_000,
    );
    expect(r.steps.map((s) => s.price)).toEqual([335]);
  });

  it("counts distinct merchants", () => {
    const m = { id: "same" };
    const r = walkBook(
      [ask(330, { available: 1, merchant: m }), ask(331, { available: 1, merchant: m })],
      "SELL",
      10_000,
    );
    expect(r.adsConsumed).toBe(2);
    expect(r.merchantsConsumed).toBe(1);
  });

  it("a remainder under half a rupee counts as filled", () => {
    expect(walkBook([ask(330, { available: 100 })], "SELL", 33_000.4).partial).toBe(false);
  });

  it("empty side or zero target → nothing filled, null prices", () => {
    const empty = walkBook([bid(330)], "SELL", 1_000);
    expect(empty).toMatchObject({ filledFiat: 0, topPrice: null, effectivePrice: null, slippagePct: null });
    expect(empty.shortfall).toBe(1_000);

    const zero = walkBook([ask(330)], "SELL", 0);
    expect(zero).toMatchObject({ filledFiat: 0, adsConsumed: 0, effectivePrice: null, shortfall: 0 });
    expect(zero.topPrice).toBe(330);

    const negative = walkBook([ask(330)], "SELL", -5);
    expect(negative.adsConsumed).toBe(0);
    expect(negative.shortfall).toBe(0);
  });
});

describe("fillableWithin", () => {
  it("counts every ad inside the band, then solves the partial fill on the next one", () => {
    // Best 100; limit 100.5. Ad 2 at 100.4 is within; ad 3 at 102 is partly usable.
    const ads = [
      ask(100, { available: 10 }), // 1,000 LKR
      ask(100.4, { available: 10 }), // 1,004 LKR
      ask(102, { available: 1000 }),
    ];
    const f = fillableWithin(ads, "SELL", 0.005);
    const F = 2004;
    const Q = 20;
    const x = (100.5 * Q - F) / (1 - 100.5 / 102);
    expect(f).toBeCloseTo(F + x, 6);
    // Walking exactly that amount averages at the limit.
    const w = walkBook(ads, "SELL", f);
    expect(w.effectivePrice).toBeCloseTo(100.5, 9);
  });

  it("works on bids (average may fall to best × (1 − tol))", () => {
    const ads = [bid(100, { available: 10 }), bid(98, { available: 1000 })];
    const f = fillableWithin(ads, "BUY", 0.005);
    expect(walkBook(ads, "BUY", f).effectivePrice).toBeCloseTo(99.5, 9);
  });

  it("stops when the partial take would be under that ad's minimum", () => {
    const ads = [ask(100, { available: 10 }), ask(102, { available: 1000, minOrder: 10_000 })];
    expect(fillableWithin(ads, "SELL", 0.005)).toBe(1000);
  });

  it("empty book → 0", () => {
    expect(fillableWithin([], "SELL")).toBe(0);
  });
});

describe("quoteAmount", () => {
  it("gap is effective vs the best listed ad (incl. ones the walk can't use)", () => {
    const ads = [
      ask(348.36, { available: 300, minOrder: 104_500, maxOrder: 104_508 }),
      ask(348.8, { available: 1223.16, minOrder: 50_000, maxOrder: 426_639 }),
    ];
    const q = quoteAmount(ads, "SELL", 50_000);
    expect(q.best).toBe(348.36);
    expect(q.walk.effectivePrice).toBeCloseTo(348.8, 9);
    expect(q.gap).toBeCloseTo(0.44, 9);
    expect(q.gapPct).toBeCloseTo(0.44 / 348.36, 12);
  });

  it("sell side gap is positive when you receive less than the best bid", () => {
    const q = quoteAmount([bid(346.75, { available: 10 }), bid(346, { available: 1000 })], "BUY", 100_000);
    expect(q.gap!).toBeGreaterThan(0);
    expect(q.best).toBe(346.75);
  });
});

describe("concentrationByMerchant", () => {
  it("shares, top-N shares and HHI in fiat terms", () => {
    const ads = [
      ask(100, { available: 50, merchant: { id: "A", name: "A" } }), // 5,000
      ask(100, { available: 10, merchant: { id: "A", name: "A" } }), // +1,000 → 6,000
      ask(100, { available: 30, merchant: { id: "B", name: "B" } }), // 3,000
      ask(100, { available: 10, merchant: { id: "C", name: "C" } }), // 1,000
    ];
    const c = concentrationByMerchant(ads);
    expect(c.total).toBe(10_000);
    expect(c.merchants.map((m) => [m.id, m.share])).toEqual([
      ["A", 0.6],
      ["B", 0.3],
      ["C", 0.1],
    ]);
    expect(c.hhi).toBeCloseTo(0.36 + 0.09 + 0.01, 12);
    expect(c.topShare[1]).toBeCloseTo(0.6, 12);
    expect(c.topShare[3]).toBeCloseTo(1, 12);
    expect(c.topShare[10]).toBeCloseTo(1, 12);
  });

  it("monopoly → HHI 1; N equal merchants → HHI 1/N", () => {
    expect(concentrationByMerchant([ask(330, { merchant: { id: "A" } })]).hhi).toBe(1);
    const four = [1, 2, 3, 4].map((i) => ask(330, { merchant: { id: `m${i}` } }));
    expect(concentrationByMerchant(four).hhi).toBeCloseTo(0.25, 12);
  });

  it("asset mode weighs by USDT, not LKR", () => {
    const ads = [
      ask(100, { available: 10, merchant: { id: "cheap" } }),
      ask(400, { available: 10, merchant: { id: "dear" } }),
    ];
    expect(concentrationByMerchant(ads, undefined, "asset").merchants[0].share).toBe(0.5);
    expect(concentrationByMerchant(ads, undefined, "fiat").merchants[0]).toMatchObject({ id: "dear", share: 0.8 });
  });

  it("filters by side when given", () => {
    const ads = [bid(330, { merchant: { id: "B" } }), ask(330, { merchant: { id: "S" } })];
    expect(concentrationByMerchant(ads, "BUY").merchants.map((m) => m.id)).toEqual(["B"]);
    expect(concentrationByMerchant(ads).merchants).toHaveLength(2);
  });

  it("empty or zero-depth book → zero shares and HHI 0", () => {
    expect(concentrationByMerchant([])).toEqual({
      total: 0,
      topShare: { 1: 0, 3: 0, 10: 0 },
      hhi: 0,
      merchants: [],
    });
    const c = concentrationByMerchant([ask(330, { available: 0 })]);
    expect(c.hhi).toBe(0);
    expect(c.merchants[0].share).toBe(0);
  });
});
