import { describe, expect, it } from "vitest";
import {
  competingAds,
  overlapsLimits,
  placementMargins,
  placementPrice,
  PRICE_TICK,
  toTick,
} from "@/lib/placement";
import { ask, bid } from "@/lib/test-utils/ads";

const CASH = { id: "CASH", name: "Cash" };

describe("overlapsLimits", () => {
  // Range is [minOrder, min(maxOrder, available × price)].
  const a = ask(350, { minOrder: 100_000, maxOrder: 500_000, available: 10_000 });
  it("overlaps when the ranges touch", () => {
    expect(overlapsLimits(a, { min: 50_000, max: 100_000 })).toBe(true);
    expect(overlapsLimits(a, { min: 500_000, max: 900_000 })).toBe(true);
  });
  it("doesn't overlap a range wholly below the ad's minimum", () => {
    expect(overlapsLimits(a, { min: 10_000, max: 99_999 })).toBe(false);
  });
  it("uses the available amount, not the stated max", () => {
    // 300 USDT × 350 = Rs 105,000 effective max.
    const thin = ask(350, { minOrder: 1_000, maxOrder: 5_000_000, available: 300 });
    expect(overlapsLimits(thin, { min: 200_000, max: 1_000_000 })).toBe(false);
    expect(overlapsLimits(thin, { min: 100_000, max: 1_000_000 })).toBe(true);
  });
  it("max 0 = no upper bound; unfillable ads never compete", () => {
    expect(overlapsLimits(a, { min: 0, max: 0 })).toBe(true);
    const dead = ask(350, { minOrder: 200_000, maxOrder: 500_000, available: 100 }); // cap 35k < min
    expect(overlapsLimits(dead)).toBe(false);
  });
});

describe("competingAds", () => {
  const ads = [
    ask(349, { id: "off", online: false }),
    ask(348.5, { id: "restr", restricted: true }),
    ask(348.8, { id: "big", minOrder: 1_000_000, maxOrder: 5_000_000, available: 50_000 }),
    ask(349.2, { id: "cash", payMethods: [CASH] }),
    ask(349.5, { id: "ok2" }),
    ask(349.1, { id: "ok1" }),
    ask(348.9, { id: "mine", merchant: { id: "me" } }),
    bid(346, { id: "bidside" }),
  ];
  const opts = { limits: { min: 50_000, max: 500_000 }, payType: "BANK", excludeMerchantId: "me" };

  it("keeps only online, unrestricted, overlapping, same-rail ads on the side, best first", () => {
    // Default ad: 100 USDT, no min/max → [0, ~35k] doesn't reach Rs 50k; give the
    // fixture room so it overlaps.
    const roomy = ads.map((a) => (a.id.startsWith("ok") ? { ...a, available: 10_000 } : a));
    expect(competingAds(roomy, "SELL", opts).map((a) => a.id)).toEqual(["ok1", "ok2"]);
  });
  it("drops ads that can't fill the merchant's minimum (100 USDT ≈ Rs 35k < Rs 50k)", () => {
    expect(competingAds(ads, "SELL", opts)).toEqual([]);
  });
  it("includes offline / restricted ads when asked", () => {
    const ids = competingAds(ads, "SELL", { includeOffline: true, includeRestricted: true }).map((a) => a.id);
    expect(ids).toContain("off");
    expect(ids).toContain("restr");
  });
  it("sorts bids high → low", () => {
    const b = [bid(345), bid(346.5), bid(346)];
    expect(competingAds(b, "BUY").map((a) => a.price)).toEqual([346.5, 346, 345]);
  });
});

describe("placementPrice", () => {
  const tick = PRICE_TICK.binance;
  const asks = [348.36, 348.7, 348.8, 348.8, 348.88, 349.5].map((p) => ask(p, { available: 10_000 }));
  const bids = [346.55, 346.45, 346.4, 346.37, 346.35].map((p) => bid(p, { available: 10_000 }));

  it("both exchanges quote LKR to 0.01", () => {
    expect(PRICE_TICK).toEqual({ binance: 0.01, bybit: 0.01 });
  });

  it("Sell ad: undercut the Nth-cheapest competing ask by one tick", () => {
    expect(placementPrice(asks, "SELL", 1, tick).price).toBe(348.35);
    expect(placementPrice(asks, "SELL", 3, tick).price).toBe(348.79);
    const p5 = placementPrice(asks, "SELL", 5, tick);
    expect(p5).toMatchObject({ status: "undercut", price: 348.87, rankAtPrice: 5, competing: 6 });
    expect(p5.anchor?.price).toBe(348.88);
  });

  it("Buy ad: outbid the Nth-highest competing bid by one tick", () => {
    expect(placementPrice(bids, "BUY", 1, tick).price).toBe(346.56);
    expect(placementPrice(bids, "BUY", 3, tick).price).toBe(346.41);
    expect(placementPrice(bids, "BUY", 5, tick).price).toBe(346.36);
  });

  it("filters before ranking: an offline best ask doesn't set the price", () => {
    const withOff = [ask(348, { online: false, available: 10_000 }), ...asks];
    expect(placementPrice(withOff, "SELL", 1, tick).price).toBe(348.35);
  });

  it("fewer competing ads than N, whole side in view → open (any price ranks #k+1)", () => {
    const p = placementPrice(asks.slice(0, 2), "SELL", 3, tick, { visibleCap: 20 });
    expect(p).toMatchObject({ status: "open", price: null, rankAtPrice: 3, competing: 2 });
  });

  it("fewer competing than N but the side is cut off → beat the last ad in view", () => {
    // 6 asks in view and the feed caps at 6: deeper ads may exist, all ≥ 349.5.
    const p = placementPrice(asks, "SELL", 3, tick, {
      visibleCap: 6,
      limits: { min: 0, max: 0 },
      excludeMerchantId: null,
      payType: "CASH", // no ad accepts cash → 0 competing
    });
    expect(p).toMatchObject({ status: "bounded", price: 349.49, rankAtPrice: 1, competing: 0 });
  });

  it("empty side", () => {
    expect(placementPrice([], "BUY", 1, tick).status).toBe("empty");
  });
});

describe("placementMargins", () => {
  const ref = { mid: 347.455, google: 330.5, bestBid: 346.55, bestAsk: 348.36 };
  it("Sell ad margins vs mid, Google and the best bid", () => {
    const m = placementMargins(348.35, "SELL", ref);
    expect(m.vsMid).toBeCloseTo(348.35 / 347.455 - 1, 12);
    expect(m.vsGoogle).toBeCloseTo(348.35 / 330.5 - 1, 12);
    expect(m.vsOpposite).toBeCloseTo((348.35 - 346.55) / 346.55, 12);
    expect(m.crosses).toBe(false);
  });
  it("Buy ad margin vs the best ask; flags a crossed book", () => {
    const m = placementMargins(346.56, "BUY", ref);
    expect(m.vsOpposite).toBeCloseTo((348.36 - 346.56) / 346.56, 12);
    expect(placementMargins(348.4, "BUY", ref).crosses).toBe(true);
    expect(placementMargins(346.5, "SELL", ref).crosses).toBe(true);
  });
  it("nulls without a price or reference", () => {
    expect(placementMargins(null, "SELL", ref).vsMid).toBeNull();
    expect(placementMargins(348, "SELL", { mid: null, google: null, bestBid: null, bestAsk: null }).vsGoogle).toBeNull();
  });
});

describe("toTick", () => {
  it("removes float noise", () => {
    expect(toTick(348.36 - 0.01, 0.01)).toBe(348.35);
    expect(toTick(346.55 + 0.01, 0.01)).toBe(346.56);
  });
});
