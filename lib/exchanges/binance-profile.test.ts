import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBinanceProfile, parseBinanceReviews } from "./binance-profile";

const fx = (f: string) => JSON.parse(readFileSync(join(__dirname, "__fixtures__", f), "utf8"));

describe("parseBinanceProfile (real response, CHAMICRO TRADING)", () => {
  const p = parseBinanceProfile(fx("binance-profile.json"))!;
  it("matches the Trade Info panel", () => {
    expect(p.orders30d).toBe(2129);
    expect(p.completion30d).toBe(1);
    expect(p.avgReleaseSec! / 60).toBeCloseTo(3.11, 2); // "3.11 Minute(s)"
    expect(p.avgPaySec! / 60).toBeCloseTo(3.89, 2); // "3.89 Minute(s)"
    expect(p.registerDays).toBe(1809);
    expect(p.firstTradeDays).toBe(1808);
    expect(p.counterparties).toBe(55405);
    expect(p.completedBuy).toBe(50910);
    expect(p.tradeType).toBe("c2c_only"); // "P2P Only Trader"
  });
  it("keeps the 30-day buy/sell split and deposit", () => {
    expect(p.buy30d! + p.sell30d!).toBe(p.orders30d);
    expect(p.depositUsdt).toBe(1000);
    expect(p.kycVerified).toBe(true);
  });
  it("returns null, not zeros, for missing numbers", () => {
    const q = parseBinanceProfile({ data: { userDetailVo: { userNo: "s123456789012" } } })!;
    expect(q.completedOrders).toBeNull();
    expect(q.avgReleaseSec).toBeNull();
    expect(parseBinanceProfile({ data: null })).toBeNull();
  });
});

describe("parseBinanceReviews", () => {
  it("matches 99.65% · 24,698 / 86", () => {
    const r = parseBinanceReviews(fx("binance-review-stats.json"))!;
    expect(r.positive).toBe(24698);
    expect(r.negative).toBe(86);
    expect(r.positiveRate!).toBeCloseTo(0.9965, 4);
  });
  it("handles no reviews", () => {
    expect(parseBinanceReviews({ data: { positiveCount: 0, negativeCount: 0 } })?.positiveRate).toBeNull();
    expect(parseBinanceReviews({ data: null })).toBeNull();
  });
});
