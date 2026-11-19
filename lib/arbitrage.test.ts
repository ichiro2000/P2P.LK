import { describe, expect, it } from "vitest";
import {
  askAds,
  bestAsk,
  bestBid,
  bidAds,
  cappedCycles,
  cycle,
  methodPairs,
  num,
  opportunity,
  profitAtRisk,
  project,
  roundTripCapacity,
  walkedCycle,
  ZERO_FEES,
  type Fees,
} from "@/lib/arbitrage";
import { fillableWithin } from "@/lib/liquidity";
import { ask, bid } from "@/lib/test-utils/ads";
import { books, errBook, okBook } from "@/lib/test-utils/books";

const BANK = { id: "BANK", name: "Bank" };
const CASH = { id: "CASH", name: "Cash" };

describe("cycle — worked example", () => {
  // Capital Rs 1,000,000, buy 345, sell 348, sell fee 0.1 %, transfer fee
  // 1 USDT, other cost Rs 50, 2 cycles/day, 30 days.
  const fees: Fees = { buyFee: 0, sellFee: 0.001, transferFeeUsdt: 1, fixedCostLkr: 50 };
  const r = cycle(1_000_000, 345, 348, fees, true)!;

  it("profit per cycle ≈ Rs 7,289.30", () => {
    expect(r.usdtBought).toBeCloseTo(1_000_000 / 345, 9);
    expect(r.usdtSold).toBeCloseTo(1_000_000 / 345 - 1, 9);
    expect(r.profit).toBeCloseTo(7289.3, 2);
    expect(r.roi).toBeCloseTo(7289.3 / 1_000_000, 6);
  });

  it("per day ≈ Rs 14,578.61 and per month ≈ Rs 437,358.27", () => {
    const p = project(r.profit, 2, 30);
    expect(p.perCycle).toBe(r.profit);
    expect(p.perDay).toBeCloseTo(14578.61, 2);
    expect(p.perMonth).toBeCloseTo(437358.27, 2);
  });

  it("break-even sell ≈ Rs 345.48, and selling there nets ~0", () => {
    expect(r.breakEvenSell!).toBeCloseTo(345.48, 2);
    expect(cycle(1_000_000, 345, r.breakEvenSell!, fees, true)!.profit).toBeCloseTo(0, 6);
  });

  it("fees in LKR = gross − received + fixed cost", () => {
    const gross = (1_000_000 / 345) * 348;
    expect(r.feesLkr).toBeCloseTo(gross - r.lkrBack + 50, 6);
  });
});

describe("cycle — edge cases", () => {
  it("same-exchange cycles don't pay the transfer fee", () => {
    const fees: Fees = { ...ZERO_FEES, transferFeeUsdt: 5 };
    const r = cycle(1_000, 100, 110, fees, false)!;
    expect(r.transferFeeUsdt).toBe(0);
    expect(r.profit).toBeCloseTo(100, 9);
  });

  it("buy fee comes off the USDT bought", () => {
    const r = cycle(1_000, 100, 100, { ...ZERO_FEES, buyFee: 0.01 }, false)!;
    expect(r.usdtBought).toBeCloseTo(9.9, 12);
    expect(r.profit).toBeCloseTo(-10, 9);
  });

  it("a negative transfer fee is treated as zero", () => {
    expect(cycle(1_000, 100, 100, { ...ZERO_FEES, transferFeeUsdt: -3 }, true)!.transferFeeUsdt).toBe(0);
  });

  it("transfer fee larger than the USDT bought → nothing sold, no break-even", () => {
    const r = cycle(100, 100, 100, { ...ZERO_FEES, transferFeeUsdt: 5 }, true)!;
    expect(r.usdtSold).toBe(0);
    expect(r.lkrBack).toBe(0);
    expect(r.profit).toBe(-100);
    expect(r.breakEvenSell).toBeNull();
  });

  it.each([
    [0, 345, 348],
    [-1, 345, 348],
    [1_000, 0, 348],
    [1_000, 345, 0],
    [Number.NaN, 345, 348],
  ])("invalid inputs (%d, %d, %d) → null", (c, b, s) => {
    expect(cycle(c, b, s, ZERO_FEES, false)).toBeNull();
  });
});

describe("project", () => {
  it("clamps negative cycles/days to zero and defaults to 30 days", () => {
    expect(project(100, -2)).toEqual({ perCycle: 100, perDay: 0, perMonth: 0 });
    expect(project(100, 1).perMonth).toBe(3_000);
    expect(project(100, 1, -5).perMonth).toBe(0);
  });
});

describe("num", () => {
  it("parses numbers with thousands separators and whitespace", () => {
    expect(num("1,000,000")).toBe(1_000_000);
    expect(num(" 345.5 ")).toBe(345.5);
    expect(num("-2")).toBe(-2);
  });

  it("invalid input → fallback", () => {
    expect(num("abc")).toBe(0);
    expect(num("abc", 30)).toBe(30);
    expect(num("1e999", 7)).toBe(7);
  });

  it("empty input → fallback (as documented)", () => {
    expect(num("", 30)).toBe(30);
    expect(num("   ", 30)).toBe(30);
    expect(num("")).toBe(0);
  });
});

describe("legs on live books", () => {
  const bn = okBook(
    "binance",
    [bid(330, { payMethods: [BANK] }), bid(333, { payMethods: [CASH] }), bid(331, { payMethods: [BANK] })],
    [ask(338, { payMethods: [BANK] }), ask(335, { payMethods: [CASH] }), ask(336, { payMethods: [BANK] })],
  );
  const by = okBook("bybit", [bid(340, { payMethods: [BANK] })], [ask(332, { payMethods: [BANK] })]);
  const live = books(bn, by);

  it("askAds: sell ads for the pay method, cheapest first; bidAds: highest first", () => {
    expect(askAds(live, { exchange: "binance", payType: "BANK" }).map((a) => a.price)).toEqual([336, 338]);
    expect(bidAds(live, { exchange: "binance", payType: "BANK" }).map((a) => a.price)).toEqual([331, 330]);
    // Empty pay type = any method.
    expect(askAds(live, { exchange: "binance", payType: "" })[0].price).toBe(335);
    expect(bestBid(live, { exchange: "binance", payType: "" })!.price).toBe(333);
  });

  it("a failed book yields no ads", () => {
    const down = books(errBook("binance"), by);
    expect(askAds(down, { exchange: "binance", payType: "" })).toEqual([]);
    expect(bestAsk(down, { exchange: "binance", payType: "" })).toBeNull();
  });

  it("opportunity: buy on one leg's best ask, sell on the other's best bid", () => {
    const o = opportunity(live, { exchange: "bybit", payType: "BANK" }, { exchange: "binance", payType: "BANK" });
    expect(o.buyPrice).toBe(332);
    expect(o.sellPrice).toBe(331);
    expect(o.gross).toBe(-1);
    expect(o.grossPct).toBeCloseTo(-1 / 332, 12);

    const cross = opportunity(live, { exchange: "binance", payType: "CASH" }, { exchange: "bybit", payType: "BANK" });
    expect(cross.gross).toBe(5);

    const none = opportunity(live, { exchange: "bybit", payType: "CASH" }, { exchange: "binance", payType: "BANK" });
    expect(none).toMatchObject({ buyAd: null, buyPrice: null, gross: null, grossPct: null });
  });

  it("methodPairs: every ordered pair of distinct methods with both ads, best gross first", () => {
    const pairs = methodPairs(live, "binance", [
      { id: "BANK", label: "Bank" },
      { id: "CASH", label: "Cash" },
    ]);
    expect(pairs.map((p) => [p.buyLabel, p.sellLabel, p.gross])).toEqual([
      ["Bank", "Cash", 333 - 336],
      ["Cash", "Bank", 331 - 335],
    ]);
  });
});

describe("walkedCycle", () => {
  it("uses volume-weighted fills from both books", () => {
    const asks = [ask(330, { available: 10 }), ask(340, { available: 1000 })];
    const bids = [bid(350, { available: 1000 })];
    const r = walkedCycle(asks, bids, 10_000, ZERO_FEES, false)!;
    const usdt = 10 + 6_700 / 340;
    expect(r.buyPrice).toBeCloseTo(10_000 / usdt, 9);
    expect(r.sellPrice).toBeCloseTo(350, 9);
    expect(r.usdtSold).toBeCloseTo(usdt, 9);
    expect(r.profit).toBeCloseTo(usdt * 350 - 10_000, 6);
    expect(r).toMatchObject({ buyShortfall: 0, buyAdsUsed: 2, sellAdsUsed: 1, topBuy: 330, topSell: 350 });
    expect(r.sellShortfallUsdt).toBeCloseTo(0, 9);
  });

  it("only trades what the bid book can absorb", () => {
    const r = walkedCycle([ask(330, { available: 1000 })], [bid(340, { available: 10 })], 33_000, ZERO_FEES, false)!;
    expect(r.usdtSold).toBe(10);
    expect(r.sellShortfallUsdt).toBeCloseTo(90, 9);
    expect(r.lkrBack).toBe(3_400);
    // Profit on the matched 10 USDT (Rs 3,300 of capital), not a Rs 29.6k "loss".
    expect(r.matchedCapital).toBeCloseTo(3_300, 9);
    expect(r.profit).toBeCloseTo(100, 9);
    expect(r.roi).toBeCloseTo(100 / 3_300, 12);
  });

  it("F1/F10: small capital still fills — skips a best ask whose minimum is too big", () => {
    // Binance 2026-11-19: DGAK 348.36 only takes Rs 104,500–104,508 per order.
    const asks = [
      ask(348.36, { available: 300, minOrder: 104_500, maxOrder: 104_508 }),
      ask(348.8, { available: 1223.16, minOrder: 50_000, maxOrder: 426_639 }),
    ];
    const bids = [bid(349.5, { available: 100_000 })];
    const r = walkedCycle(asks, bids, 50_000, ZERO_FEES, false)!;
    expect(r).not.toBeNull();
    expect(r.buyPrice).toBeCloseTo(348.8, 9);
    expect(r.topBuy).toBe(348.36);
  });

  it("sells the USDT bought, in USDT, skipping bids whose LKR minimum is too big", () => {
    const asks = [ask(330, { available: 1000 })];
    const bids = [bid(345, { available: 1000, minOrder: 1_000_000 }), bid(340, { available: 1000 })];
    const r = walkedCycle(asks, bids, 33_000, { ...ZERO_FEES, transferFeeUsdt: 1 }, true)!;
    expect(r.sellPrice).toBeCloseTo(340, 9);
    expect(r.usdtSold).toBeCloseTo(99, 9);
    expect(r.sellShortfallUsdt).toBeCloseTo(0, 9);
  });

  it("leaves offline / restricted ads out unless asked", () => {
    const asks = [ask(330, { available: 1000, online: false }), ask(331, { available: 1000 })];
    const bids = [bid(340, { available: 1000, restricted: true }), bid(339, { available: 1000 })];
    const r = walkedCycle(asks, bids, 10_000, ZERO_FEES, false)!;
    expect([r.buyPrice, r.sellPrice]).toEqual([331, 339]);
    const all = walkedCycle(asks, bids, 10_000, ZERO_FEES, false, { includeOffline: true, includeRestricted: true })!;
    expect([all.buyPrice, all.sellPrice]).toEqual([330, 340]);
  });

  it("returns null without capital or books", () => {
    expect(walkedCycle([], [bid(1)], 100, ZERO_FEES, false)).toBeNull();
    expect(walkedCycle([ask(1)], [], 100, ZERO_FEES, false)).toBeNull();
    expect(walkedCycle([ask(1)], [bid(1)], 0, ZERO_FEES, false)).toBeNull();
  });
});

/* ── Realism (F31) ─────────────────────────────────────────────────────── */

describe("roundTripCapacity", () => {
  // Asks: 1,000 USDT at 348 and 1,000 at 349 (0.29 % worse), 1,000 at 360.
  const asks = [ask(348, { available: 1_000 }), ask(349, { available: 1_000 }), ask(360, { available: 1_000 })];
  // Bids: 500 USDT at 350, then 10,000 at 300 (far off).
  const bids = [bid(350, { available: 500 }), bid(300, { available: 10_000 })];

  it("uses fillableWithin on both legs and takes the smaller in capital terms", () => {
    const c = roundTripCapacity(asks, bids, 0.005);
    expect(c.buyLkr).toBeCloseTo(fillableWithin(asks, "SELL", 0.005), 6);
    expect(c.sellLkr).toBeCloseTo(fillableWithin(bids, "BUY", 0.005), 6);
    // Sell leg: 500 × 350 = 175,000 LKR; plus the closed-form partial at 300.
    expect(c.sellLkr).toBeGreaterThanOrEqual(175_000);
    expect(c.capitalLkr).toBeCloseTo(Math.min(c.buyLkr, (c.sellLkr / 350) * 348), 6);
    expect(c.limitedBy).toBe("sell");
    expect(c.topBuy).toBe(348);
    expect(c.topSell).toBe(350);
  });

  it("0 capacity when a side is empty", () => {
    expect(roundTripCapacity(asks, [], 0.005)).toMatchObject({ capitalLkr: 0, limitedBy: null });
  });
});

describe("cappedCycles", () => {
  it("caps at ⌊capacity / capital⌋", () => {
    expect(cappedCycles(10, 1_000_000, 300_000)).toEqual({ cycles: 3, capped: true, overCapacity: false });
    expect(cappedCycles(2, 1_000_000, 300_000)).toEqual({ cycles: 2, capped: false, overCapacity: false });
  });
  it("never below one walked cycle; flags capital above capacity", () => {
    expect(cappedCycles(4, 100_000, 300_000)).toEqual({ cycles: 1, capped: true, overCapacity: true });
  });
  it("no capital → 0", () => {
    expect(cappedCycles(4, 1e6, 0).cycles).toBe(0);
  });
});

describe("profitAtRisk", () => {
  it("takes band × LKR received off the profit", () => {
    expect(profitAtRisk(5_000, 1_000_000, 0.002)).toBeCloseTo(3_000, 9);
    expect(profitAtRisk(5_000, 1_000_000, 0)).toBe(5_000);
  });
});
