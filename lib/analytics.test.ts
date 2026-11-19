import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildMarket,
  buildMerchantDirectory,
  competitivenessFrom,
  sideGaps,
  sideStats,
  summarizeMerchants,
  type KnownMerchantInput,
} from "@/lib/analytics";
import { ask, bid } from "@/lib/test-utils/ads";

describe("sideStats", () => {
  it("returns an empty shape when the side has no ads", () => {
    expect(sideStats([bid(330)], "SELL")).toEqual({
      tradeType: "SELL",
      count: 0,
      bestPrice: null,
      medianPrice: null,
      vwap: null,
      nearTouchCount: 0,
      totalAvailable: 0,
      totalAvailableFiat: 0,
      tradableAvailable: 0,
      excludedCount: 0,
    });
    expect(sideStats([], "BUY").count).toBe(0);
  });

  it("BUY side (bids, where you sell USDT): best = highest price", () => {
    const s = sideStats([bid(330), bid(333), bid(331), ask(320)], "BUY");
    expect(s.bestPrice).toBe(333);
    expect(s.count).toBe(3);
  });

  it("SELL side (asks, where you buy USDT): best = lowest price", () => {
    const s = sideStats([ask(340), ask(336), ask(338), bid(400)], "SELL");
    expect(s.bestPrice).toBe(336);
    expect(s.count).toBe(3);
  });

  it("does not rely on input order", () => {
    expect(sideStats([ask(338), ask(336), ask(340)], "SELL").bestPrice).toBe(336);
  });

  it("median: middle value for odd counts, mean of the two middles for even (within the band)", () => {
    expect(sideStats([ask(301), ask(300), ask(302)], "SELL").medianPrice).toBe(301);
    expect(sideStats([ask(303), ask(300), ask(302), ask(301)], "SELL").medianPrice).toBe(301.5);
  });

  it("F12: median and VWAP ignore ads more than 2 % from the best (Bybit 2026-11-19 asks)", () => {
    // Touch at 348.72; outliers at 384.50–399.35 are 10–15 % off.
    const asks = [
      ask(348.72, { available: 7.615, maxOrder: 2655.5 }),
      ask(349.99, { available: 213.55 }),
      ask(350.95, { available: 1997.59, maxOrder: 485_000 }),
      ask(356.95, { available: 113.15 }),
      ask(384.5, { available: 7.59 }),
      ask(384.9, { available: 600.29 }),
      ask(389, { available: 2000 }),
      ask(399.35, { available: 600.29 }),
    ];
    const s = sideStats(asks, "SELL");
    expect(s.nearTouchCount).toBe(3); // 356.95 is 2.36 % off
    expect(s.medianPrice).toBe(349.99);
    // weights: min(available, maxOrder / price)
    const w = [2655.5 / 348.72, 213.55, 485_000 / 350.95];
    const p = [348.72, 349.99, 350.95];
    expect(s.vwap).toBeCloseTo((w[0] * p[0] + w[1] * p[1] + w[2] * p[2]) / (w[0] + w[1] + w[2]), 9);
    expect(s.vwap!).toBeLessThan(351);
    // depth still sums every listed ad
    expect(s.totalAvailable).toBeCloseTo(asks.reduce((x, a) => x + a.available, 0), 9);
  });

  it("VWAP is null when nothing is available", () => {
    const s = sideStats([ask(300, { available: 0 }), ask(301, { available: 0 })], "SELL");
    expect(s.vwap).toBeNull();
    expect(s.bestPrice).toBe(300);
  });

  it("tradable depth leaves offline and restricted ads out", () => {
    const s = sideStats(
      [bid(330, { available: 100 }), bid(329, { available: 50, online: false }), bid(328, { available: 7, restricted: true })],
      "BUY",
    );
    expect(s.totalAvailable).toBe(157);
    expect(s.tradableAvailable).toBe(100);
    expect(s.excludedCount).toBe(2);
  });

  it("single ad: best = median = vwap = its price", () => {
    const s = sideStats([bid(332.5, { available: 50 })], "BUY");
    expect(s).toMatchObject({
      count: 1,
      bestPrice: 332.5,
      medianPrice: 332.5,
      vwap: 332.5,
      totalAvailable: 50,
      totalAvailableFiat: 332.5 * 50,
    });
  });
});

describe("buildMarket", () => {
  afterEach(() => vi.useRealTimers());

  it("spread = best ask − best bid, mid and spread % of mid", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    const ads = [bid(330), bid(332), ask(336), ask(338)];
    const m = buildMarket("USDT", "LKR", ads);
    expect(m.buy.bestPrice).toBe(332);
    expect(m.sell.bestPrice).toBe(336);
    expect(m.spread).toBe(4);
    expect(m.mid).toBe(334);
    expect(m.spreadPct).toBeCloseTo(4 / 334, 12);
    expect(m.asset).toBe("USDT");
    expect(m.fiat).toBe("LKR");
    expect(m.ads).toBe(ads);
    expect(m.fetchedAt).toBe("2026-11-19T10:00:00.000Z");
  });

  it("a crossed book gives a negative spread", () => {
    const m = buildMarket("USDT", "LKR", [bid(340), ask(335)]);
    expect(m.spread).toBe(-5);
    expect(m.spreadPct).toBeLessThan(0);
  });

  it("one side missing → spread, mid and spread % are null", () => {
    for (const ads of [[bid(330)], [ask(336)], []]) {
      const m = buildMarket("USDT", "LKR", ads);
      expect(m.spread).toBeNull();
      expect(m.mid).toBeNull();
      expect(m.spreadPct).toBeNull();
    }
  });
});

describe("summarizeMerchants", () => {
  it("aggregates per merchant: counts, depth, best prices per side, pay methods", () => {
    const m = { id: "A", name: "Alice", orders30d: 100, completionRate: 0.9 };
    const ads = [
      bid(330, { merchant: m, available: 10, payMethods: [{ id: "BANK", name: "Bank" }] }),
      bid(332, { merchant: m, available: 10, payMethods: [{ id: "BANK", name: "Bank" }] }),
      ask(338, { merchant: m, available: 5, payMethods: [{ id: "CASH", name: "Cash" }] }),
      ask(336, { merchant: m, available: 5, payMethods: [{ id: "BANK", name: "Bank" }] }),
    ];
    const [s] = summarizeMerchants(ads);
    expect(s).toMatchObject({
      id: "A",
      name: "Alice",
      adCount: 4,
      buyAds: 2,
      sellAds: 2,
      bestBuyPrice: 332,
      bestSellPrice: 336,
      payMethods: ["Bank", "Cash"],
    });
    expect(s.totalAvailableFiat).toBe(330 * 10 + 332 * 10 + 338 * 5 + 336 * 5);
  });

  it("F3: gaps are per side against that side's best, never ask-median vs bids", () => {
    // Audit example: ask median 348.91 made every bidder a "discount".
    const ads = [
      ask(348.36, { merchant: { id: "DGAK" } }),
      ask(348.88, { merchant: { id: "ISSL" } }),
      bid(346.75, { merchant: { id: "ISSL" } }),
      bid(346.13, { merchant: { id: "SMART" } }),
    ];
    const by = Object.fromEntries(summarizeMerchants(ads).map((m) => [m.id, m]));
    expect(by.DGAK.askVsBest).toBe(0);
    expect(by.DGAK.bidVsBest).toBeNull();
    expect(by.ISSL.askVsBest).toBeCloseTo((348.88 - 348.36) / 348.36, 12);
    expect(by.ISSL.bidVsBest).toBe(0); // the best bidder is at the best bid
    expect(by.SMART.bidVsBest).toBeCloseTo((346.75 - 346.13) / 346.75, 12);
    expect(by.SMART.askVsBest).toBeNull();
    expect(by.ISSL.competitiveness).toBe(100);
    expect(by.SMART.competitiveness).toBe(Math.round(100 - ((346.75 - 346.13) / 346.75) * 10_000));
  });

  it("a legacy numeric second argument is ignored", () => {
    const [s] = summarizeMerchants([ask(336, { merchant: { id: "A" } })], 300);
    expect(s.askVsBest).toBe(0);
  });

  it("scores with the shared reliability score (no release-time part)", () => {
    const [s] = summarizeMerchants([ask(330, { merchant: { completionRate: 1, orders30d: 15 } })]);
    // presence/tenure unknown → completion + volume rescaled to 100
    const lb = 0.7961;
    const vol = Math.log10(16) / Math.log10(2000);
    expect(s.trustScore).toBe(Math.round(((45 * lb + 15 * vol) * 100) / 60));
  });

  it("sorts by score, highest first; empty input → []", () => {
    const out = summarizeMerchants([
      ask(330, { merchant: { id: "low", completionRate: 0.5, orders30d: 10 } }),
      ask(330, { merchant: { id: "high", completionRate: 0.996, orders30d: 3677 } }),
    ]);
    expect(out.map((m) => m.id)).toEqual(["high", "low"]);
    expect(summarizeMerchants([])).toEqual([]);
  });
});

describe("sideGaps / competitivenessFrom", () => {
  it("gaps are ≥ 0 and null for a side not quoted", () => {
    expect(sideGaps({ bestSellPrice: 101, bestBuyPrice: null }, { bestAsk: 100, bestBid: 99 })).toEqual({
      askGap: 0.01, // 1 %
      bidGap: null,
    });
    expect(sideGaps({ bestSellPrice: 99, bestBuyPrice: 100 }, { bestAsk: 100, bestBid: 99 })).toEqual({
      askGap: 0,
      bidGap: 0,
    });
  });

  it("competitiveness = 100 − bps behind best on the better side, floored at 0", () => {
    expect(competitivenessFrom(0.001, 0.02)).toBe(90);
    expect(competitivenessFrom(null, 0)).toBe(100);
    expect(competitivenessFrom(0.05, null)).toBe(0);
    expect(competitivenessFrom(null, null)).toBe(0);
  });
});

describe("buildMerchantDirectory", () => {
  const known = (over: Partial<KnownMerchantInput>): KnownMerchantInput => ({
    merchantId: "M",
    merchantName: "Merchant",
    lastSeenTs: 1_000,
    firstSeenTs: null,
    presenceHours: null,
    isMerchant: true,
    userIdentity: null,
    userGrade: null,
    vipLevel: 1,
    ordersMonth: 100,
    completionRate: 0.99,
    avgReleaseSec: null,
    buyAds: 1,
    sellAds: 0,
    bestBuyPrice: null,
    bestSellPrice: null,
    totalAvailableFiat: 1_000,
    ...over,
  });

  it("F2: active = seen in the latest sweep (with 120 s slack), not 'on the top-20 book'", () => {
    const rows = buildMerchantDirectory({
      known: [
        known({ merchantId: "now", lastSeenTs: 10_000 }),
        known({ merchantId: "prev", lastSeenTs: 9_900 }),
        known({ merchantId: "old", lastSeenTs: 9_000 }),
      ],
      latestSweepTs: 10_000,
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.now.isActive).toBe(true);
    expect(by.prev.isActive).toBe(true);
    expect(by.old.isActive).toBe(false);
    expect(by.old.adCount).toBe(0);
    expect(rows.at(-1)!.id).toBe("old"); // inactive last
  });

  it("F3: per-side gaps vs the best among active merchants only", () => {
    const rows = buildMerchantDirectory({
      known: [
        known({ merchantId: "a1", bestSellPrice: 348.36, lastSeenTs: 10_000 }),
        known({ merchantId: "a2", bestSellPrice: 348.88, bestBuyPrice: 346.75, lastSeenTs: 10_000 }),
        known({ merchantId: "b1", bestBuyPrice: 346.13, lastSeenTs: 10_000 }),
        // inactive merchant with a stale better price doesn't set the reference
        known({ merchantId: "gone", bestSellPrice: 300, bestBuyPrice: 400, lastSeenTs: 1 }),
      ],
      latestSweepTs: 10_000,
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.a1.askVsBest).toBe(0);
    expect(by.a2.askVsBest).toBeCloseTo(0.52 / 348.36, 12);
    expect(by.a2.bidVsBest).toBe(0);
    expect(by.b1.bidVsBest).toBeCloseTo(0.62 / 346.75, 12);
    expect(by.gone.askVsBest).toBeNull();
    expect(by.gone.competitiveness).toBe(0);
  });

  it("D7: presence and tenure feed the score; pay methods come from live ads", () => {
    const now = 100 * 86400;
    const rows = buildMerchantDirectory({
      known: [
        known({ merchantId: "vet", firstSeenTs: now - 90 * 86400, presenceHours: 168, lastSeenTs: now }),
        known({ merchantId: "new", firstSeenTs: now - 9 * 86400, presenceHours: 17, lastSeenTs: now }),
      ],
      latestSweepTs: now,
      trackedHours7d: 168,
      liveAds: [ask(1, { merchant: { id: "vet" }, payMethods: [{ id: "BANK", name: "Bank Transfer" }] })],
      nowTs: now,
    });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by.vet.presence7d).toBe(1);
    expect(by.vet.scoreParts!.tenure).toBe(1);
    expect(by.new.presence7d).toBeCloseTo(17 / 168, 12);
    expect(by.new.scoreParts!.tenure).toBeCloseTo(0.1, 12);
    // presence + tenure are 10 of the 70 known points → rescaled by 100/70.
    const k = 100 / 70;
    expect(by.vet.trustScore - by.new.trustScore).toBe(
      Math.round(by.vet.scoreParts!.points.completion + by.vet.scoreParts!.points.volume + 10 * k) -
        Math.round(
          by.new.scoreParts!.points.completion + by.new.scoreParts!.points.volume + (5 * (17 / 168) + 5 * 0.1) * k,
        ),
    );
    expect(by.vet.payMethods).toEqual(["Bank Transfer"]);
    expect(by.new.payMethods).toEqual([]);
  });

  it("keeps a missing 30-day count as null", () => {
    const [r] = buildMerchantDirectory({ known: [known({ ordersMonth: null })], latestSweepTs: 1_000 });
    expect(r.orders30d).toBeNull();
  });
});
