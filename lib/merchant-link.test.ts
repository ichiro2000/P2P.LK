import { describe, expect, it } from "vitest";
import { binanceAdvertiserId, bybitAdvertiserId, linkedAdvertisers } from "@/lib/merchant-link";

describe("binanceAdvertiserId", () => {
  it.each([
    ["https://p2p.binance.com/en/advertiserDetail?advertiserNo=s0123abcd", "s0123abcd"],
    ["https://www.binance.com/en/p2p/advertiserDetail?advertiserNo=s0123abcd", "s0123abcd"],
    ["https://app.binance.com/en/p2p/share?merchantNo=s0123abcd", "s0123abcd"],
    ["https://app.binance.com/en/p2p/share?userNo=s0123abcd", "s0123abcd"],
  ])("%s → %s", (url, id) => {
    expect(binanceAdvertiserId(url)).toBe(id);
  });

  it.each([
    [null],
    [undefined],
    [""],
    ["https://s.binance.com/AbC123"], // short link carries no id
    ["https://www.binance.com/en/p2p"], // whole-URL fallback
    ["https://p2p.binance.com/x?advertiserNo=abc"], // too short
    ["https://p2p.binance.com/x?advertiserNo=a%2Fbcdef"], // "/" in id
  ])("%j → null", (url) => {
    expect(binanceAdvertiserId(url)).toBeNull();
  });
});

describe("bybitAdvertiserId", () => {
  it.each([
    ["https://www.bybit.com/en/p2p/profile/s1a2b3c4/USDT/LKR/item", "s1a2b3c4"],
    ["https://www.bybit.com/fiat/trade/otc/profile/s1a2b3c4/USDT/LKR/item", "s1a2b3c4"],
    ["https://www.bybit.com/en/p2p/PROFILE/s1a2b3c4", "s1a2b3c4"],
    ["www.bybit.com/en/p2p/profile/s1a2b3c4", "s1a2b3c4"],
    ["https://bybit.com/fiat/trade/otc?userId=s1a2b3c4", "s1a2b3c4"],
    ["https://bybit.com/x?uid=%20abcd1234%20", "abcd1234"],
    ["https://bybit.com/x?makerId=abcd1234", "abcd1234"],
  ])("%s → %s", (url, id) => {
    expect(bybitAdvertiserId(url)).toBe(id);
  });

  it.each([
    [null],
    [""],
    ["https://bybit.com.evil.io/en/p2p/profile/s1a2b3c4"],
    ["https://evilbybit.com/en/p2p/profile/s1a2b3c4"],
    ["https://www.binance.com/en/p2p/profile/s1a2b3c4"],
    ["https://www.bybit.com/en/p2p/profile/"],
    ["https://www.bybit.com/en/p2p/profile/ab"], // too short
    ["https://www.bybit.com/en/p2p/profile/s1a2%2Fb3c4"], // decodes to "/"
    ["https://www.bybit.com/en/p2p"],
    ["https://"],
  ])("%j → null", (url) => {
    expect(bybitAdvertiserId(url)).toBeNull();
  });

  it("a malformed %-escape in the profile segment → null, not a throw", () => {
    expect(() => bybitAdvertiserId("https://www.bybit.com/en/p2p/profile/%E0%A4%A/USDT")).not.toThrow();
    expect(bybitAdvertiserId("https://www.bybit.com/en/p2p/profile/%E0%A4%A/USDT")).toBeNull();
    // ...and still falls back to a query-string id.
    expect(bybitAdvertiserId("https://www.bybit.com/en/p2p/profile/%ZZ?userId=abcd1234")).toBe("abcd1234");
  });
});

describe("linkedAdvertisers", () => {
  it("lists every id readable from the member's links", () => {
    expect(
      linkedAdvertisers({
        binanceUrl: "https://p2p.binance.com/en/advertiserDetail?advertiserNo=s0123abcd",
        bybitUrl: "https://www.bybit.com/en/p2p/profile/s1a2b3c4/USDT/LKR/item",
      }),
    ).toEqual([
      { exchange: "binance", id: "s0123abcd" },
      { exchange: "bybit", id: "s1a2b3c4" },
    ]);
    expect(linkedAdvertisers({ binanceUrl: null, bybitUrl: "https://s.binance.com/x" })).toEqual([]);
  });
});
