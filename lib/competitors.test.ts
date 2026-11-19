import { describe, expect, it } from "vitest";
import {
  compareCompetitors,
  inMinBand,
  medianOwnSpread,
  netOwnSpread,
  ownSpread,
  selfAd,
  spreadVsMedian,
} from "@/lib/competitors";
import { ask, bid } from "@/lib/test-utils/ads";

const TICK = 0.01;
const ME = { id: "me", name: "Me" };

describe("ownSpread", () => {
  it("ask − bid in LKR and as a share of the mid", () => {
    const s = ownSpread(310, 300)!;
    expect(s.lkr).toBe(10);
    expect(s.mid).toBe(305);
    expect(s.pct).toBeCloseTo(10 / 305, 10);
  });
  it("null with one side only", () => {
    expect(ownSpread(310, null)).toBeNull();
    expect(ownSpread(null, 300)).toBeNull();
    expect(ownSpread(0, 300)).toBeNull();
  });
  it("crossed (ask below bid) is negative", () => {
    const s = ownSpread(299, 300)!;
    expect(s.lkr).toBe(-1);
    expect(s.pct).toBeLessThan(0);
  });
  it("net after the maker fee is ask×(1−f) − bid/(1−f)", () => {
    expect(netOwnSpread(310, 300, 0)).toBe(10);
    expect(netOwnSpread(310, 300, 0.001)).toBeCloseTo(310 * 0.999 - 300 / 0.999, 10);
    expect(netOwnSpread(310, null, 0.001)).toBeNull();
  });
  it("median over two-sided merchants only", () => {
    const m = medianOwnSpread([
      { bestSellPrice: 310, bestBuyPrice: 300 },
      { bestSellPrice: 305, bestBuyPrice: 300 },
      { bestSellPrice: 320, bestBuyPrice: 300 },
      { bestSellPrice: 310, bestBuyPrice: null },
    ])!;
    expect(m.count).toBe(3);
    expect(m.lkr).toBe(10);
    expect(spreadVsMedian(ownSpread(302, 300), m)).toBe("tight");
    expect(spreadVsMedian(ownSpread(330, 300), m)).toBe("wide");
    expect(spreadVsMedian(ownSpread(310, 300), m)).toBe("typical");
    expect(medianOwnSpread([{ bestSellPrice: 1, bestBuyPrice: null }])).toBeNull();
  });
});

describe("inMinBand", () => {
  it("keeps minimums within ±band of the reference", () => {
    expect(inMinBand(50_000, 50_000, 0.1)).toBe(true);
    expect(inMinBand(55_000, 50_000, 0.1)).toBe(true);
    expect(inMinBand(45_000, 50_000, 0.1)).toBe(true);
    expect(inMinBand(55_001, 50_000, 0.1)).toBe(false);
    expect(inMinBand(62_500, 50_000, 0.25)).toBe(true);
    expect(inMinBand(25_000, 50_000, 0.5)).toBe(true);
    expect(inMinBand(24_999, 50_000, 0.5)).toBe(false);
  });
  it("'any' keeps everything", () => {
    expect(inMinBand(1_000_000, 50_000, null)).toBe(true);
  });
});

describe("compareCompetitors", () => {
  const book = [
    ask(310, { id: "a", minOrder: 50_000, maxOrder: 1_000_000, available: 10_000 }),
    ask(309, { id: "b", minOrder: 60_000, maxOrder: 1_000_000, available: 10_000 }),
    ask(308, { id: "far", minOrder: 500_000, maxOrder: 2_000_000, available: 10_000 }),
    ask(307, { id: "off", minOrder: 50_000, maxOrder: 1_000_000, available: 10_000, online: false }),
    ask(311, { id: "mine", minOrder: 50_000, maxOrder: 1_000_000, available: 10_000, merchant: ME }),
    bid(300, { id: "b1", minOrder: 50_000, maxOrder: 1_000_000, available: 10_000 }),
    bid(301, { id: "b2", minOrder: 45_000, maxOrder: 1_000_000, available: 10_000 }),
    bid(299, { id: "bmine", minOrder: 50_000, maxOrder: 1_000_000, available: 10_000, merchant: ME }),
  ];

  it("band filtering by minimum order (no self id: your ads compete too)", () => {
    const r = compareCompetitors(book, { side: "SELL", refMin: 50_000, band: 0.1 }, TICK);
    expect(r.rows.map((x) => x.ad.id)).toEqual(["a", "mine"]);
    const wide = compareCompetitors(book, { side: "SELL", refMin: 50_000, band: 0.25 }, TICK);
    expect(wide.rows.map((x) => x.ad.id)).toEqual(["b", "a", "mine"]);
    const any = compareCompetitors(book, { side: "SELL", refMin: 50_000, band: null }, TICK);
    expect(any.rows.map((x) => x.ad.id)).toEqual(["far", "b", "a", "mine"]);
  });

  it("online & unrestricted by default; off includes offline ads", () => {
    const r = compareCompetitors(book, { side: "SELL", refMin: 50_000, band: 0.25, onlineOnly: false }, TICK);
    expect(r.rows.map((x) => x.ad.id)).toEqual(["off", "b", "a", "mine"]);
  });

  it("excludes your own ads from competitors and adds a You row", () => {
    const r = compareCompetitors(book, { side: "SELL", refMin: 50_000, band: 0.25, selfId: "me" }, TICK);
    expect(r.competing).toBe(2);
    expect(r.rows.map((x) => x.ad.id)).toEqual(["b", "a", "mine"]);
    expect(r.rows.filter((x) => x.isSelf).map((x) => x.ad.id)).toEqual(["mine"]);
    expect(r.selfRank).toBe(3);
    expect(r.groupSize).toBe(3);
    const b = r.rows[0];
    expect(b.gapLkr).toBe(-2);
    expect(b.ahead).toBe(true);
  });

  it("ranks Sell ads lowest first and Buy ads highest first", () => {
    const s = compareCompetitors(book, { side: "SELL", refMin: 50_000, band: 0.5 }, TICK);
    expect(s.rows.map((x) => x.ad.price)).toEqual([309, 310, 311]);
    const b = compareCompetitors(book, { side: "BUY", refMin: 50_000, band: 0.25, selfId: "me" }, TICK);
    expect(b.rows.map((x) => x.ad.price)).toEqual([301, 300, 299]);
    expect(b.selfRank).toBe(3);
    expect(b.best).toBe(301);
    expect(b.median).toBe(300.5);
  });

  it("to be #1: one tick better than the best competitor", () => {
    const s = compareCompetitors(book, { side: "SELL", refMin: 50_000, band: 0.25, selfId: "me" }, TICK);
    expect(s.toBeFirst).toBe(308.99);
    expect(s.alreadyFirst).toBe(false);
    const b = compareCompetitors(book, { side: "BUY", refMin: 50_000, band: 0.25, selfId: "me" }, TICK);
    expect(b.toBeFirst).toBe(301.01);
  });

  it("already #1 and empty groups", () => {
    const solo = [ask(300, { id: "x", minOrder: 50_000, available: 1000, merchant: ME }), ask(301, { minOrder: 50_000, available: 1000 })];
    const r = compareCompetitors(solo, { side: "SELL", refMin: 50_000, band: 0.1, selfId: "me" }, TICK);
    expect(r.selfRank).toBe(1);
    expect(r.alreadyFirst).toBe(true);
    const none = compareCompetitors([], { side: "SELL", refMin: 50_000, band: 0.1 }, TICK);
    expect(none.rows).toEqual([]);
    expect(none.toBeFirst).toBeNull();
  });

  it("ties share a rank", () => {
    const ads = [
      ask(310, { minOrder: 50_000, available: 1000 }),
      ask(310, { id: "mine2", minOrder: 50_000, available: 1000, merchant: ME }),
    ];
    const r = compareCompetitors(ads, { side: "SELL", refMin: 50_000, band: 0.1, selfId: "me" }, TICK);
    expect(r.rows.map((x) => x.rank)).toEqual([1, 1]);
    expect(r.alreadyFirst).toBe(false);
  });

  it("selfAd picks your best-priced ad on the side", () => {
    const ads = [ask(312, { merchant: ME }), ask(311, { merchant: ME }), bid(300, { merchant: ME })];
    expect(selfAd(ads, "SELL", "me")?.price).toBe(311);
    expect(selfAd(ads, "BUY", "me")?.price).toBe(300);
    expect(selfAd(ads, "SELL", null)).toBeNull();
  });
});
