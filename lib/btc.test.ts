import { describe, expect, it } from "vitest";
import { BTC_HISTORY_SOURCES, BTC_SOURCES, btcInLkr, plausibleBtc } from "./btc";

describe("btcInLkr", () => {
  it("prices BTC through the USDT/LKR rate", () => {
    expect(btcInLkr({ price: 100_000, change24h: null }, 300).lkr).toBe(30_000_000);
  });
  it("compounds the BTC and USDT 24h moves", () => {
    const r = btcInLkr({ price: 100_000, change24h: 0.02 }, 306, 300);
    expect(r.usdtChange).toBeCloseTo(0.02);
    expect(r.lkrChange).toBeCloseTo(1.02 * 1.02 - 1);
  });
  it("moves when only USDT/LKR moves", () => {
    const a = btcInLkr({ price: 100_000, change24h: 0 }, 300).lkr!;
    const b = btcInLkr({ price: 100_000, change24h: 0 }, 303).lkr!;
    expect(b / a - 1).toBeCloseTo(0.01);
  });
  it("is empty without a USDT price", () => {
    expect(btcInLkr({ price: 100_000, change24h: 0 }, null).lkr).toBeNull();
  });
});

describe("BTC sources", () => {
  const [binance, bybit, okx] = BTC_SOURCES;
  it("parse each exchange's ticker", () => {
    expect(binance.parse({ lastPrice: "95000.5", priceChangePercent: "-1.5" })).toMatchObject({ price: 95000.5, change24h: -0.015 });
    expect(bybit.parse({ result: { list: [{ lastPrice: "95000", price24hPcnt: "0.01" }] } })).toMatchObject({ price: 95000, change24h: 0.01 });
    expect(okx.parse({ data: [{ last: "99000", open24h: "90000" }] }).change24h).toBeCloseTo(0.1);
  });
  it("reject garbage", () => {
    expect(() => binance.parse({ lastPrice: "0" })).toThrow();
    expect(plausibleBtc(NaN)).toBe(false);
  });
});

describe("BTC history sources", () => {
  it("parse candles oldest first, whatever order the source uses", () => {
    const desc = [["2000", "1", "1", "1", "60000"], ["1000", "1", "1", "1", "59000"]];
    for (const s of BTC_HISTORY_SOURCES) {
      const j = s.name === "Binance" ? [...desc].reverse() : s.name === "Bybit" ? { result: { list: desc } } : { data: desc };
      expect(s.parse(j)).toEqual([{ t: 1000, price: 59000 }, { t: 2000, price: 60000 }]);
    }
  });
});
