import { describe, expect, it, vi } from "vitest";

// The evaluator module also holds the D1 / email side of the cron job. Only
// its pure helpers are tested here, so stub the server-side imports.
vi.mock("@/lib/db/client", () => ({ schema: {} }));
vi.mock("@/lib/email/deliver", () => ({ deliverEmail: vi.fn() }));
vi.mock("@/lib/email/templates", () => ({ alertFired: vi.fn() }));
vi.mock("@/lib/flags", () => ({ getFlags: vi.fn() }));

import { buildMarket } from "@/lib/analytics";
import {
  defaultLabel,
  dollarDetail,
  dollarTrigger,
  evalMarketRule,
  evalOffMarket,
  isRuleDue,
  type ExchangeBook,
  type RuleRow,
} from "@/lib/alerts/evaluate";
import type { AlertType } from "@/lib/db/schema";
import { ask, bid } from "@/lib/test-utils/ads";
import type { NormalizedAd } from "@/lib/types";

const rule = (type: AlertType, threshold: number, over: Partial<RuleRow> = {}): RuleRow => ({
  id: "r1",
  userId: "u1",
  exchange: "binance",
  type,
  threshold,
  label: null,
  email: false,
  cooldownSec: 600,
  lastFiredAt: null,
  userEmail: "member@example.test",
  ...over,
});

// best bid 330, best ask 336 → mid 333, spread 6 (≈1.8 %), depth 30 USDT.
const snap = buildMarket("USDT", "LKR", [
  bid(330, { available: 10 }),
  bid(329, { available: 5 }),
  ask(336, { available: 10 }),
  ask(337, { available: 5 }),
]);
const SPREAD_PCT = 6 / 333;

describe("evalMarketRule", () => {
  it("priceAbove / priceBelow compare the mid price strictly", () => {
    expect(evalMarketRule(rule("priceAbove", 332), snap)).toMatchObject({ observed: 333 });
    expect(evalMarketRule(rule("priceAbove", 333), snap)).toBeNull();
    expect(evalMarketRule(rule("priceBelow", 334), snap)).toMatchObject({ observed: 333 });
    expect(evalMarketRule(rule("priceBelow", 333), snap)).toBeNull();
  });

  it("spreadAbove / spreadBelow compare spread % (a fraction)", () => {
    expect(evalMarketRule(rule("spreadAbove", 0.01), snap)?.observed).toBeCloseTo(SPREAD_PCT, 12);
    expect(evalMarketRule(rule("spreadAbove", 0.02), snap)).toBeNull();
    expect(evalMarketRule(rule("spreadBelow", 0.02), snap)).not.toBeNull();
    expect(evalMarketRule(rule("spreadBelow", 0.01), snap)).toBeNull();
  });

  it("depthBelow (legacy) sums USDT on both sides", () => {
    expect(evalMarketRule(rule("depthBelow", 31), snap)).toMatchObject({ observed: 30 });
    expect(evalMarketRule(rule("depthBelow", 30), snap)).toBeNull();
  });

  it("askDepthBelow / bidDepthBelow look at ONE side, within 1% of that side's best", () => {
    // Bids: 330 (10) and 329 (5) are both within 1% of 330. A far-off
    // placeholder bid at 300 holds 1M but is outside the band.
    const book: ExchangeBook = {
      buy: [bid(330, { available: 10 }), bid(329, { available: 5 }), bid(300, { available: 1_000_000 })],
      sell: [ask(336, { available: 10 }), ask(337, { available: 5 }), ask(350, { available: 9_999 })],
    };
    const s = buildMarket("USDT", "LKR", [...book.buy, ...book.sell]);
    expect(evalMarketRule(rule("askDepthBelow", 16), s, book)).toMatchObject({ observed: 15 });
    expect(evalMarketRule(rule("askDepthBelow", 15), s, book)).toBeNull();
    expect(evalMarketRule(rule("bidDepthBelow", 16), s, book)).toMatchObject({ observed: 15 });
    // The old sum would never fire here: the placeholder keeps it huge.
    expect(evalMarketRule(rule("depthBelow", 100_000), s)).toBeNull();
  });

  it("per-side depth caps each ad at its max order and skips offline ads", () => {
    const book: ExchangeBook = {
      buy: [bid(330)],
      sell: [
        ask(336, { available: 100, maxOrder: 336 * 2 }), // max order = 2 USDT
        ask(336.5, { available: 50, online: false } as never),
      ],
    };
    const s = buildMarket("USDT", "LKR", [...book.buy, ...book.sell]);
    expect(evalMarketRule(rule("askDepthBelow", 3), s, book)?.observed).toBeCloseTo(2, 9);
  });

  it("per-side depth with an empty side is no data, not zero", () => {
    const book: ExchangeBook = { buy: [bid(330)], sell: [] };
    const s = buildMarket("USDT", "LKR", book.buy);
    expect(evalMarketRule(rule("askDepthBelow", 1e9), s, book)).toBeNull();
    expect(evalMarketRule(rule("bidDepthBelow", 1e9), s, book)).not.toBeNull();
  });

  it("an empty book never fires (no data ≠ no depth)", () => {
    const empty = buildMarket("USDT", "LKR", []);
    for (const t of ["priceAbove", "priceBelow", "spreadAbove", "spreadBelow", "depthBelow"] as const) {
      expect(evalMarketRule(rule(t, t.endsWith("Below") ? 1e9 : -1e9), empty)).toBeNull();
    }
  });

  it("one-sided book: no mid or spread → price/spread rules stay quiet", () => {
    const one = buildMarket("USDT", "LKR", [ask(336)]);
    expect(evalMarketRule(rule("priceAbove", 0), one)).toBeNull();
    expect(evalMarketRule(rule("spreadBelow", 1), one)).toBeNull();
    expect(evalMarketRule(rule("depthBelow", 1e9), one)).not.toBeNull();
  });

  it("offMarketAd is not a market rule", () => {
    expect(evalMarketRule(rule("offMarketAd", 0), snap)).toBeNull();
  });

  it("detail text shows the observed value and the comparison", () => {
    expect(evalMarketRule(rule("priceAbove", 332), snap)!.detail).toBe("Mid price 333.00 LKR > 332.00");
    expect(evalMarketRule(rule("spreadBelow", 0.02), snap)!.detail).toBe("Spread 1.80% < 2.00%");
    expect(evalMarketRule(rule("depthBelow", 100), snap)!.detail).toBe("Top-20 depth, both sides, 30 USDT < 100");
    expect(evalMarketRule(rule("askDepthBelow", 100), snap)!.detail).toBe(
      "Sell ads (you buy USDT) within 1% of the best price: 15 USDT across 2 ads < 100",
    );
  });
});

describe("evalOffMarket", () => {
  const book = (buy: NormalizedAd[], sell: NormalizedAd[]): ExchangeBook => ({ buy, sell });
  const fives = (p: number, mk: typeof ask) => [1, 2, 3, 4, 5].map((i) => mk(p, { merchant: { id: `ref${p}-${i}` } }));

  it("fires when an ask beats the average of the top-5 OTHER asks by the threshold", () => {
    const cheap = ask(330, { merchant: { id: "cheap", name: "Cheap Co" } });
    const f = evalOffMarket(rule("offMarketAd", 0.02), book([], [cheap, ...fives(340, ask)]), undefined)!;
    expect(f.observed).toBe(330);
    expect(f.detail).toContain("Cheap Co selling USDT at 330.00 LKR");
    expect(f.detail).toContain("2.94% below top-5 avg 340.00");
    // Edge = 10 / 340 ≈ 2.94 % — just under 3 % doesn't fire.
    expect(evalOffMarket(rule("offMarketAd", 0.03), book([], [cheap, ...fives(340, ask)]), undefined)).toBeNull();
  });

  it("the reference uses only the top 5 others, so a far-away 7th ad doesn't move it", () => {
    const cheap = ask(330, { merchant: { id: "cheap" } });
    const silly = ask(10_000, { merchant: { id: "silly" } });
    const f = evalOffMarket(rule("offMarketAd", 0.02), book([], [silly, cheap, ...fives(340, ask)]), undefined)!;
    expect(f.detail).toContain("top-5 avg 340.00");
  });

  it("BUY side: a bid above the others' average fires (buying, above)", () => {
    const rich = bid(350, { merchant: { id: "rich", name: "Rich" } });
    const f = evalOffMarket(rule("offMarketAd", 0.02), book([rich, ...fives(340, bid)], []), undefined)!;
    expect(f.observed).toBe(350);
    expect(f.detail).toContain("Rich buying USDT at 350.00 LKR (2.94% above top-5 avg 340.00)");
  });

  it("returns the single most off-market ad across both sides", () => {
    const a = ask(330, { merchant: { id: "a" } }); // 10/340 ≈ 2.9 %
    const b = bid(360, { merchant: { id: "b" } }); // 20/340 ≈ 5.9 %
    const f = evalOffMarket(rule("offMarketAd", 0.02), book([b, ...fives(340, bid)], [a, ...fives(340, ask)]), undefined)!;
    expect(f.observed).toBe(360);
  });

  it("blocked merchants are excluded from both the candidates and the reference", () => {
    const cheap = ask(330, { merchant: { id: "cheap" } });
    const asks = [cheap, ...fives(340, ask)];
    expect(evalOffMarket(rule("offMarketAd", 0.02), book([], asks), new Set(["binance:cheap"]))).toBeNull();
    // Blocking on the other exchange has no effect.
    expect(evalOffMarket(rule("offMarketAd", 0.02), book([], asks), new Set(["bybit:cheap"]))).not.toBeNull();

    // A blocked *reference* ad drops out of the average: here a blocked 400
    // would otherwise drag the reference up and make 340 look off-market.
    const fair = ask(340, { merchant: { id: "fair" } });
    const high = ask(400, { merchant: { id: "high" } });
    const r = rule("offMarketAd", 0.01);
    const refs = [345, 345, 345, 345].map((p, i) => ask(p, { merchant: { id: `r${i}` } }));
    expect(evalOffMarket(r, book([], [fair, high, ...refs]), undefined)!.detail).toContain("top-5 avg 356.00");
    const withBlock = evalOffMarket(r, book([], [fair, high, ...refs]), new Set(["binance:high"]));
    // Without the 400 ad, 340 vs 345 is 1.45 % — still fires, but against a 345 reference.
    expect(withBlock!.detail).toContain("top-5 avg 345.00");
  });

  it("ignores untradable ads (zero price/amount, or can't fill their own minimum)", () => {
    const tooBig = ask(300, { available: 1, minOrder: 1_000, merchant: { id: "big" } });
    const empty = ask(300, { available: 0, merchant: { id: "empty" } });
    expect(evalOffMarket(rule("offMarketAd", 0.02), book([], [tooBig, empty, ...fives(340, ask)]), undefined)).toBeNull();
  });

  it("ignores ads whose tradeType doesn't match the side they were filed under", () => {
    const stray = bid(300, { merchant: { id: "stray" } });
    expect(evalOffMarket(rule("offMarketAd", 0.02), book([], [stray, ...fives(340, ask)]), undefined)).toBeNull();
  });

  it("needs at least two ads on a side", () => {
    expect(evalOffMarket(rule("offMarketAd", 0), book([bid(1)], [ask(1)]), undefined)).toBeNull();
  });

  it("includes the order limits when the ad has a max order", () => {
    const cheap = ask(330, { minOrder: 5_000, maxOrder: 100_000, merchant: { id: "c" } });
    const f = evalOffMarket(rule("offMarketAd", 0.02), book([], [cheap, ...fives(340, ask)]), undefined)!;
    expect(f.detail).toMatch(/limit 5,000–100,000 LKR$/);
  });
});

describe("isRuleDue (cooldown)", () => {
  it("never-fired rules are always due", () => {
    expect(isRuleDue({ lastFiredAt: null, cooldownSec: 3600 }, 0)).toBe(true);
  });

  it("due once the full cooldown has passed, not before", () => {
    expect(isRuleDue({ lastFiredAt: 1_000, cooldownSec: 600 }, 1_599)).toBe(false);
    expect(isRuleDue({ lastFiredAt: 1_000, cooldownSec: 600 }, 1_600)).toBe(true);
    expect(isRuleDue({ lastFiredAt: 1_000, cooldownSec: 0 }, 1_000)).toBe(true);
  });
});

describe("defaultLabel", () => {
  it.each([
    ["priceAbove", 340, "Binance mid price above 340.00"],
    ["priceBelow", 1234.5, "Binance mid price below 1,234.50"],
    ["spreadAbove", 0.015, "Binance spread above 1.50%"],
    ["spreadBelow", 0.005, "Binance spread below 0.50%"],
    ["depthBelow", 25_000, "Binance top-20 depth (both sides) below 25,000 USDT"],
    ["askDepthBelow", 2_000, "Binance sell ads within 1% of best below 2,000 USDT"],
    ["bidDepthBelow", 2_000, "Binance buy ads within 1% of best below 2,000 USDT (declared)"],
    ["offMarketAd", 0.02, "Binance ad 2.00% better than top-5"],
  ] as const)("%s %d", (type, threshold, label) => {
    expect(defaultLabel({ exchange: "binance", type, threshold })).toBe(label);
  });

  it("names the exchange", () => {
    expect(defaultLabel({ exchange: "bybit", type: "priceAbove", threshold: 1 })).toMatch(/^Bybit /);
  });
});

/* ── Dollar-rate rules ─────────────────────────────────────────────── */

describe("dollar rules", () => {
  // 2026-11-20 14:03 SLT = 08:33 UTC
  const NOW = Date.UTC(2026, 10, 20, 8, 33, 30) / 1000;
  const READ = NOW - 30; // the latest reading
  const google = [
    { ts: READ - 2 * 3600, value: 332.99 },
    { ts: READ - 5400, value: 333.2 },
    { ts: READ - 3600, value: 333.6 },
    { ts: READ - 1800, value: 333.9 },
    { ts: READ, value: 334.1 },
  ];
  const cbsl = [
    { day: "2026-11-18", value: 332.76, fetchedAt: NOW - 2 * 86400 },
    { day: "2026-11-19", value: 334.84, fetchedAt: NOW - 3 * 3600 },
  ];
  const inp = { google, cbsl, today: "2026-11-20" };

  it("Google up/down fires on the 2 h change vs the threshold", () => {
    const t = dollarTrigger(rule("usdGoogleUp", 0.003), inp, NOW)!;
    expect(t.kind).toBe("google");
    expect(t.change.pct).toBeCloseTo(334.1 / 332.99 - 1, 12);
    expect(dollarTrigger(rule("usdGoogleUp", 0.004), inp, NOW)).toBeNull();
    expect(dollarTrigger(rule("usdGoogleDown", 0.001), inp, NOW)).toBeNull();
    const down = google.map((p) => ({ ...p, value: 700 - p.value }));
    expect(dollarTrigger(rule("usdGoogleDown", 0.003), { ...inp, google: down }, NOW)).not.toBeNull();
  });

  it("fires only on a reading newer than the last fire, and never on a stale one", () => {
    expect(dollarTrigger(rule("usdGoogleUp", 0.003, { lastFiredAt: READ }), inp, NOW)).toBeNull();
    expect(dollarTrigger(rule("usdGoogleUp", 0.003, { lastFiredAt: READ - 1 }), inp, NOW)).not.toBeNull();
    expect(dollarTrigger(rule("usdGoogleUp", 0.003), inp, READ + 76 * 60)).toBeNull();
    expect(dollarTrigger(rule("usdGoogleUp", 0.003), { ...inp, google: null }, NOW)).toBeNull();
  });

  it("CBSL fires once per new CBSL day, only when the day is recent", () => {
    const t = dollarTrigger(rule("usdCbslUp", 0.005), inp, NOW)!;
    expect(t).toMatchObject({ kind: "cbsl", day: "2026-11-19", prevDay: "2026-11-18" });
    expect(dollarTrigger(rule("usdCbslUp", 0.01), inp, NOW)).toBeNull();
    expect(dollarTrigger(rule("usdCbslDown", 0.005), inp, NOW)).toBeNull();
    expect(dollarTrigger(rule("usdCbslUp", 0.005, { lastFiredAt: NOW - 3600 }), inp, NOW)).toBeNull();
    expect(dollarTrigger(rule("usdCbslUp", 0.005), { ...inp, today: "2026-11-30" }, NOW)).toBeNull();
  });

  it("the Google message gives both rates, the move and how far USDT followed", () => {
    const t = dollarTrigger(rule("usdGoogleUp", 0.003), inp, NOW)!;
    const mids = [{ ts: t.change.fromTs - 60, mid: 340 }];
    const detail = dollarDetail(rule("usdGoogleUp", 0.003), t, {
      usdtNow: 340.068,
      mids,
      link: { n: 300, min: 48, r: 0.45, beta: 0.9, t: 8.7, verdict: "confirmed" },
    });
    expect(detail).toBe(
      "Google USD/LKR 332.99 → 334.10 (+0.33% in 2h, 12:03–14:03 SLT). USDT/LKR on Binance hasn't moved yet (+0.02%) — " +
        "historically it follows with beta 0.90 (r 0.45, last 7 days). An estimate, not advice.",
    );
    const unmeasured = dollarDetail(rule("usdGoogleUp", 0.003), t, {
      usdtNow: 341.2,
      mids,
      link: { n: 12, min: 48, r: null, beta: null, t: null, verdict: "collecting" },
    });
    expect(unmeasured).toContain("has already moved +0.35%");
    expect(unmeasured).toContain("isn't measured yet (12 of 48 readings)");
    const opposite = dollarDetail(rule("usdGoogleUp", 0.003), t, { usdtNow: 339.5, mids, link: null });
    expect(opposite).toContain("has gone the other way so far (−0.15%)");
  });

  it("the CBSL message is context, with USDT vs the previous day's average", () => {
    const t = dollarTrigger(rule("usdCbslUp", 0.005), inp, NOW)!;
    const d18 = Date.parse("2026-11-18T00:00:00+05:30") / 1000;
    const detail = dollarDetail(rule("usdCbslUp", 0.005), t, {
      usdtNow: 336.6,
      mids: [
        { ts: d18 + 3600, mid: 330 },
        { ts: d18 + 7200, mid: 330 },
      ],
      link: null,
    });
    expect(detail).toBe(
      "CBSL indicative USD/LKR 332.76 → 334.84 (+0.63%, 19 Nov vs 18 Nov). USDT/LKR on Binance is 336.60, +2.00% vs its 18 Nov average. " +
        "CBSL is a slow official rate: context, not a trigger. Not advice.",
    );
  });

  it("labels the new rule types", () => {
    expect(defaultLabel({ exchange: "binance", type: "usdGoogleUp", threshold: 0.003 })).toBe(
      "Google USD/LKR up ≥ 0.30% in 2 h (USDT on Binance)",
    );
    expect(defaultLabel({ exchange: "bybit", type: "usdCbslDown", threshold: 0.005 })).toMatch(/CBSL USD\/LKR down ≥ 0.50%/);
  });

  it("market rules ignore dollar types (no accidental fire from the book)", () => {
    expect(evalMarketRule(rule("usdGoogleUp", 0.000001), snap)).toBeNull();
  });
});
