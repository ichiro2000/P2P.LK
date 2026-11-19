import { describe, expect, it } from "vitest";
import {
  acceptsMethod,
  constructBook,
  isVerified,
  mergeSpreadSeries,
  NO_FILTER,
  passesFilter,
  payMethodOptions,
  shareOf,
  spreadBetween,
  summarize,
  verdict,
} from "@/lib/compare";
import { ask, bid } from "@/lib/test-utils/ads";
import { books, errBook, okBook } from "@/lib/test-utils/books";

describe("summarize", () => {
  it("buy USDT = sell ads (lowest), sell USDT = buy ads (highest)", () => {
    const s = summarize(
      okBook(
        "binance",
        [bid(330, { available: 10 }), bid(332, { available: 20 })],
        [ask(338, { available: 5 }), ask(336, { available: 5 })],
      ),
    );
    expect(s.buyUsdt).toEqual({ best: 336, count: 2, depthFiat: 338 * 5 + 336 * 5, depthAsset: 10 });
    expect(s.sellUsdt).toEqual({ best: 332, count: 2, depthFiat: 330 * 10 + 332 * 20, depthAsset: 30 });
    expect(s.amount).toBeNull();
    expect(s.spread).toBe(4);
    expect(s.mid).toBe(334);
    expect(s.spreadPct).toBeCloseTo(4 / 334, 12);
    expect(s.ok).toBe(true);
  });

  it("ignores zero prices when picking the best", () => {
    const s = summarize(okBook("bybit", [bid(0)], [ask(0), ask(340)]));
    expect(s.buyUsdt.best).toBe(340);
    expect(s.sellUsdt.best).toBeNull();
    expect(s.spread).toBeNull();
  });

  it("a failed book summarizes as empty", () => {
    const s = summarize(errBook("bybit"));
    expect(s).toMatchObject({ ok: false, spread: null, spreadPct: null, mid: null });
    expect(s.buyUsdt).toEqual({ best: null, count: 0, depthFiat: 0, depthAsset: 0 });
  });
});

describe("verdict", () => {
  const sum = (ex: "binance" | "bybit", bestBid: number, bestAsk: number) =>
    summarize(okBook(ex, [bid(bestBid)], [ask(bestAsk)]));

  it("lower ask wins buying, higher bid wins selling", () => {
    const v = verdict(sum("binance", 330, 336), sum("bybit", 331, 337));
    expect(v).toMatchObject({ buy: "binance", sell: "bybit", buyGap: 1, sellGap: 1, buyPrice: 336, sellPrice: 331 });
  });

  it("ties and missing sides → null", () => {
    const v = verdict(sum("binance", 330, 336), sum("bybit", 330, 336));
    expect(v.buy).toBeNull();
    expect(v.sell).toBeNull();
    expect(v.buyGap).toBe(0);
    const w = verdict(sum("binance", 330, 336), summarize(errBook("bybit")));
    expect(w).toMatchObject({ buy: null, sell: null, buyGap: null, sellGap: null });
  });

  it("F11: with an amount, the walked price decides, not the best ad", () => {
    // Audit example (Rs 1M): Binance best ask 348.36 vs Bybit 348.72, but
    // Bybit's cheap asks are tiny, so for size Binance wins by far more.
    const binance = okBook("binance", [bid(346.75, { available: 10_000 })], [
      ask(348.36, { available: 300, minOrder: 104_500, maxOrder: 104_508 }),
      ask(348.5, { available: 10_000 }),
    ]);
    const bybit = okBook("bybit", [bid(346.91, { available: 10 })], [
      ask(348.2, { available: 7.6, maxOrder: 2655 }),
      ask(349.99, { available: 213 }),
      ask(355, { available: 10_000 }),
    ]);
    const top = verdict(summarize(binance), summarize(bybit));
    expect(top.buy).toBe("bybit"); // 348.20 < 348.36 at the very top
    const a = summarize(binance, 1_000_000);
    const b = summarize(bybit, 1_000_000);
    const v = verdict(a, b);
    expect(v.buy).toBe("binance");
    expect(v.buyPrice).toBeCloseTo(a.buyUsdt.quote!.walk.effectivePrice!, 9);
    expect(v.buyGap!).toBeGreaterThan(3);
    // Bybit's bids can't take Rs 1M (10 USDT), Binance's can: Binance wins selling.
    expect(b.sellUsdt.quote!.walk.partial).toBe(true);
    expect(v.sell).toBe("binance");
    expect(v.sellGap).toBeNull();
  });

  it("with an amount, neither book filling → compare the partial fills", () => {
    const a = summarize(okBook("binance", [], [ask(330, { available: 1 })]), 1_000_000);
    const b = summarize(okBook("bybit", [], [ask(331, { available: 1 })]), 1_000_000);
    expect(verdict(a, b).buy).toBe("binance");
  });
});

describe("pay methods and filters", () => {
  it("payMethodOptions: configured rails first, then other methods seen on the book", () => {
    const b = okBook(
      "binance",
      [bid(330, { payMethods: [{ id: "BANK", name: "Bank" }, { id: "LANKAPAY", name: "" }] })],
      [ask(336, { payMethods: [{ id: "CASH", name: "Cash Deposit" }] })],
    );
    expect(payMethodOptions(b)).toEqual([
      { id: "BANK", label: "Bank Transfer" },
      { id: "LANKAPAY", label: "LANKAPAY" },
      { id: "CASH", label: "Cash Deposit" },
    ]);
    expect(payMethodOptions(errBook("bybit"))).toEqual([{ id: "BANK", label: "Bank Transfer" }]);
  });

  it("acceptsMethod: empty pay type accepts anything", () => {
    const a = ask(1, { payMethods: [{ id: "BANK", name: "Bank" }] });
    expect(acceptsMethod(a, "")).toBe(true);
    expect(acceptsMethod(a, "BANK")).toBe(true);
    expect(acceptsMethod(a, "CASH")).toBe(false);
  });

  it("isVerified follows the merchant tier", () => {
    expect(isVerified(ask(1, { merchant: { isMerchant: true } }))).toBe(true);
    expect(isVerified(ask(1, { merchant: { isMerchant: false, userIdentity: "MASS_MERCHANT" } }))).toBe(true);
    expect(isVerified(ask(1, { merchant: { isMerchant: false } }))).toBe(false);
  });

  it("passesFilter: verified, completion (percent) and order thresholds", () => {
    const a = ask(1, { merchant: { isMerchant: false, completionRate: 0.95, orders30d: 50 } });
    expect(passesFilter(a, NO_FILTER)).toBe(true);
    expect(passesFilter(a, { ...NO_FILTER, verifiedOnly: true })).toBe(false);
    expect(passesFilter(a, { ...NO_FILTER, minCompletion: 95 })).toBe(true);
    expect(passesFilter(a, { ...NO_FILTER, minCompletion: 96 })).toBe(false);
    expect(passesFilter(a, { ...NO_FILTER, minOrders: 50 })).toBe(true);
    expect(passesFilter(a, { ...NO_FILTER, minOrders: 51 })).toBe(false);
  });

  it("constructBook: filters and sorts the chosen side best-first", () => {
    const live = books(
      okBook(
        "binance",
        [bid(330), bid(333), bid(331, { payMethods: [{ id: "CASH", name: "Cash" }] })],
        [ask(338), ask(335, { merchant: { orders30d: 1 } }), ask(336, { merchant: { orders30d: 100 } })],
      ),
      errBook("bybit"),
    );
    const asks = constructBook(live, {
      exchange: "binance",
      side: "SELL",
      payType: "",
      filter: { ...NO_FILTER, minOrders: 1 },
    });
    expect(asks.map((a) => a.price)).toEqual([335, 336]);
    const bids = constructBook(live, { exchange: "binance", side: "BUY", payType: "BANK", filter: NO_FILTER });
    expect(bids.map((a) => a.price)).toEqual([333, 330]);
    expect(constructBook(live, { exchange: "bybit", side: "BUY", payType: "", filter: NO_FILTER })).toEqual([]);
  });
});

describe("spreadBetween / shareOf", () => {
  it("spreadBetween: absolute and as a fraction of the first price", () => {
    expect(spreadBetween(330, 333)).toEqual({ abs: 3, pct: 3 / 330 });
    expect(spreadBetween(0, 5)).toEqual({ abs: 5, pct: null });
  });

  it("shareOf: first value's share of the total", () => {
    expect(shareOf(3, 1)).toBe(0.75);
    expect(shareOf(0, 0)).toBeNull();
    expect(shareOf(null, 1)).toBeNull();
    expect(shareOf(1, null)).toBeNull();
  });
});

describe("mergeSpreadSeries", () => {
  it("joins on exact timestamps, leaves gaps null, sorts ascending, converts to ms", () => {
    const out = mergeSpreadSeries(
      [
        { ts: 200, spread: 2, spreadPct: 0.02 },
        { ts: 100, spread: 1, spreadPct: 0.01 },
      ],
      [
        { ts: 100, spread: 3, spreadPct: 0.03 },
        { ts: 300, spread: 4, spreadPct: 0.04 },
      ],
    );
    expect(out).toEqual([
      { t: 100_000, binance: 0.01, binanceAbs: 1, bybit: 0.03, bybitAbs: 3 },
      { t: 200_000, binance: 0.02, binanceAbs: 2, bybit: null, bybitAbs: null },
      { t: 300_000, binance: null, binanceAbs: null, bybit: 0.04, bybitAbs: 4 },
    ]);
  });

  it("empty in → empty out", () => {
    expect(mergeSpreadSeries([], [])).toEqual([]);
  });
});
