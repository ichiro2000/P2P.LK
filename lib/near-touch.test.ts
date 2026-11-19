import { describe, expect, it } from "vitest";
import { availableBySide, nearTouchCols, nearTouchDepth, nearTouchImbalance, tradableSide } from "@/lib/near-touch";
import { ask, bid } from "@/lib/test-utils/ads";

describe("nearTouchDepth", () => {
  it("asks: sums ads priced within x of the LOWEST ask", () => {
    const ads = [ask(350), ask(351.7), ask(351.8), ask(400, { available: 1e6 })];
    // 1% of 350 → ≤ 353.5: three ads. 0.5% → ≤ 351.75: two ads.
    expect(nearTouchDepth(ads, "SELL", 0.01)).toMatchObject({ usdt: 300, ads: 3 });
    expect(nearTouchDepth(ads, "SELL", 0.005)).toMatchObject({ usdt: 200, ads: 2 });
  });

  it("bids: within x BELOW the highest bid; far-off placeholder bids don't count", () => {
    const ads = [bid(346), bid(343), bid(307, { available: 5_000_000 })];
    expect(nearTouchDepth(ads, "BUY", 0.01)).toMatchObject({ usdt: 200, ads: 2 });
  });

  it("caps each ad at what one order can take (maxOrder / price)", () => {
    const d = nearTouchDepth([ask(350, { available: 1000, maxOrder: 35_000 })], "SELL", 0.01);
    expect(d.usdt).toBeCloseTo(100, 9);
    expect(d.fiat).toBeCloseTo(35_000, 6);
  });

  it("skips offline ads (ad.online or merchant.online === false) and junk", () => {
    const ads = [
      ask(350, { online: false } as never),
      ask(350.5, { merchant: { online: false } as never }),
      ask(351, { available: 0 }),
      ask(351.2),
    ];
    // Best tradable ask is 351.2, so the band is measured from there.
    expect(nearTouchDepth(ads, "SELL", 0.005)).toMatchObject({ usdt: 100, ads: 1 });
    expect(tradableSide(ads, "SELL").map((a) => a.price)).toEqual([351.2]);
  });

  it("empty side → zeros", () => {
    expect(nearTouchDepth([bid(300)], "SELL", 0.01)).toEqual({ usdt: 0, fiat: 0, ads: 0 });
  });

  it("nearTouchCols fills every column", () => {
    const c = nearTouchCols({ buy: [bid(346)], sell: [ask(348)] });
    expect(c).toMatchObject({ bidDepth05: 100, askDepth05: 100, bidDepth1: 100, askDepth1: 100 });
    expect(c.askDepth1Fiat).toBeCloseTo(34_800, 6);
  });
});

describe("nearTouchImbalance", () => {
  it("(bid − ask) / (bid + ask); null when both empty", () => {
    expect(nearTouchImbalance(300, 100)).toBe(0.5);
    expect(nearTouchImbalance(0, 0)).toBeNull();
    expect(nearTouchImbalance(null, 50)).toBe(-1);
  });
});

describe("availableBySide", () => {
  it("sums USDT per merchant per side", () => {
    const m = { merchant: { id: "M" } };
    const out = availableBySide([ask(350, m), ask(351, { ...m, available: 50 }), bid(346, { ...m, available: 7 })]);
    expect(out.get("M")).toEqual({ ask: 150, bid: 7 });
  });
});

describe("restricted ads", () => {
  it("are left out of near-touch depth", () => {
    expect(nearTouchDepth([ask(350, { restricted: true }), ask(350.1)], "SELL", 0.01)).toMatchObject({ usdt: 100, ads: 1 });
  });
});
