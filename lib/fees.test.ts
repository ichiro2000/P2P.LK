import { describe, expect, it } from "vitest";
import {
  DEFAULT_FEE_SETTINGS,
  effectiveMakerFee,
  levelFromVip,
  makerFeeRate,
  makerFeeUsdt,
  ordersFor,
} from "./fees";

const s = (level: "none" | "bronze" | "silver" | "gold") => ({ ...DEFAULT_FEE_SETTINGS, level });

describe("makerFeeRate (Binance verified-merchant table)", () => {
  it("applies the level discount to 0.1 %", () => {
    expect(makerFeeRate(s("none"))).toBeCloseTo(0.001, 10);
    expect(makerFeeRate(s("bronze"))).toBeCloseTo(0.0008, 10); // 0.08 % — the fee page screenshot
    expect(makerFeeRate(s("silver"))).toBeCloseTo(0.0007, 10); // 0.1 × (1 − 0.30)
    expect(makerFeeRate(s("gold"))).toBeCloseTo(0.0005, 10);
  });
  it("uses a custom base rate", () => {
    expect(makerFeeRate({ level: "silver", baseMakerFee: 0.002 })).toBeCloseTo(0.0014, 10);
  });
});

describe("makerFeeUsdt with the 0.07 USDT minimum", () => {
  it("rate dominates on large orders", () => {
    // 1,000 USDT, one order, Bronze: 0.8 USDT > 0.07
    expect(makerFeeUsdt(1000, 1, s("bronze"))).toBeCloseTo(0.8, 10);
  });
  it("minimum bites on small orders", () => {
    // 50 USDT at 0.08 % = 0.04 < 0.07 → 0.07
    expect(makerFeeUsdt(50, 1, s("bronze"))).toBeCloseTo(0.07, 10);
    // 5 orders of 20 USDT → 5 × 0.07
    expect(makerFeeUsdt(100, 5, s("bronze"))).toBeCloseTo(0.35, 10);
    expect(effectiveMakerFee(100, 5, s("bronze"))).toBeCloseTo(0.0035, 10);
  });
  it("zero amount costs nothing", () => {
    expect(makerFeeUsdt(0, 3, s("gold"))).toBe(0);
  });
});

describe("helpers", () => {
  it("orders needed for a capital", () => {
    expect(ordersFor(500_000, 150_000)).toBe(4);
    expect(ordersFor(100_000, 0)).toBe(1);
  });
  it("vipLevel → level", () => {
    expect(levelFromVip(1)).toBe("bronze");
    expect(levelFromVip(2)).toBe("silver");
    expect(levelFromVip(3)).toBe("gold");
    expect(levelFromVip(null)).toBe("none");
  });
});
