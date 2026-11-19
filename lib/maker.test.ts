import { describe, expect, it } from "vitest";
import { breakEvenAsk, makerCycle, makerNet } from "@/lib/maker";

describe("makerCycle — worked example", () => {
  // Buy ad at 346.56, Sell ad at 348.35, Rs 1,000,000, 0.1 % maker fee
  // per side, 4 cycles a day, ±0.2 % price-risk band.
  const r = makerCycle({
    bid: 346.56,
    ask: 348.35,
    capital: 1_000_000,
    feeBuy: 0.001,
    feeSell: 0.001,
    cyclesPerDay: 4,
    riskBand: 0.002,
  })!;
  const usdt = 1_000_000 / 346.56;

  it("gross spread per USDT and per cycle", () => {
    expect(r.grossPerUsdt).toBeCloseTo(1.79, 10);
    expect(r.grossPct).toBeCloseTo(1.79 / 346.56, 12);
    expect(r.usdtPerCycle).toBeCloseTo(usdt, 9);
    expect(r.grossPerCycle).toBeCloseTo(usdt * 1.79, 6); // ≈ Rs 5,165.05
  });

  it("net after fees ≈ Rs 3,155.73", () => {
    const net = usdt * 0.999 * 0.999 * 348.35 - 1_000_000;
    expect(r.netPerCycle).toBeCloseTo(net, 6);
    expect(r.netPerCycle).toBeCloseTo(3155.73, 2);
    expect(r.feesPerCycle).toBeCloseTo(r.grossPerCycle - net, 6);
    expect(r.perDay).toBeCloseTo(net * 4, 6);
  });

  it("break-even spread = bid / (1 − f)² − bid", () => {
    expect(r.breakEvenAsk).toBeCloseTo(346.56 / (0.999 * 0.999), 10);
    expect(r.breakEvenSpread).toBeCloseTo(346.56 / (0.999 * 0.999) - 346.56, 10); // ≈ 0.694
    expect(makerNet(1_000_000, 346.56, r.breakEvenAsk, 0.001, 0.001)).toBeCloseTo(0, 6);
  });

  it("downside: the worse of a 0.2 % drop on the sell leg or a 0.2 % rise on the buy leg", () => {
    const sellDown = makerNet(1_000_000, 346.56, 348.35 * 0.998, 0.001, 0.001);
    const buyUp = makerNet(1_000_000, 346.56 * 1.002, 348.35, 0.001, 0.001);
    expect(r.downsidePerCycle).toBeCloseTo(Math.min(sellDown, buyUp), 6);
    expect(r.downsideLeg).toBe("sell");
    expect(r.downsidePerCycle).toBeLessThan(r.netPerCycle);
  });

  it("break-even move zeroes the net", () => {
    expect(r.breakEvenMove).not.toBeNull();
    expect(makerNet(1_000_000, 346.56, 348.35 * (1 - r.breakEvenMove!), 0.001, 0.001)).toBeCloseTo(0, 6);
  });
});

describe("makerCycle — edges", () => {
  const base = { bid: 346, ask: 348, capital: 100_000, feeBuy: 0, feeSell: 0, cyclesPerDay: 1, riskBand: 0 };
  it("zero fees: net = gross; break-even spread 0", () => {
    const r = makerCycle(base)!;
    expect(r.netPerCycle).toBeCloseTo(r.grossPerCycle, 9);
    expect(r.breakEvenSpread).toBe(0);
    expect(r.downsidePerCycle).toBeCloseTo(r.netPerCycle, 9);
  });
  it("crossed or too-thin spread → negative net and no break-even move", () => {
    const r = makerCycle({ ...base, ask: 346.2, feeBuy: 0.001, feeSell: 0.001 })!;
    expect(r.netPerCycle).toBeLessThan(0);
    expect(r.breakEvenMove).toBeNull();
  });
  it("rejects bad input", () => {
    expect(makerCycle({ ...base, bid: 0 })).toBeNull();
    expect(makerCycle({ ...base, capital: -1 })).toBeNull();
    expect(makerCycle({ ...base, feeBuy: 1 })).toBeNull();
  });
  it("breakEvenAsk", () => {
    expect(breakEvenAsk(300, 0, 0)).toBe(300);
    expect(breakEvenAsk(300, 0.5, 0)).toBe(600);
  });
});
