import { describe, expect, it } from "vitest";
import { parseBinanceProfile } from "@/lib/qr";

const canonical = (id: string) => `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(id)}`;

describe("parseBinanceProfile", () => {
  it.each([
    ["https://p2p.binance.com/en/advertiserDetail?advertiserNo=s0123abcd", "s0123abcd"],
    ["https://www.binance.com/en/p2p/advertiserDetail?advertiserNo=s0123abcd", "s0123abcd"],
    ["https://app.binance.com/en/download?_dp=xyz&advertiserNo=s0123abcd", "s0123abcd"],
    ["https://app.binance.com/uni/cpay/x/share?merchantNo=s0123abcd", "s0123abcd"],
    ["https://app.binance.com/en/p2p/share?userNo=s0123abcd", "s0123abcd"],
    ["bnc://app.binance.com/payment/secretpay?advertiserNo=s0123abcd", "s0123abcd"],
    ["  https://p2p.binance.com/x?advertiserNo=%20s99%20  ", "s99"],
  ])("extracts the advertiser number from %s", (raw, id) => {
    expect(parseBinanceProfile(raw)).toEqual({ userId: id, profileUrl: canonical(id) });
  });

  it("prefers the most specific key when several are present", () => {
    expect(parseBinanceProfile("https://binance.com/x?userNo=u1&advertiserNo=a1")?.userId).toBe("a1");
  });

  it("short links: host + code as the id, original URL kept", () => {
    expect(parseBinanceProfile("https://s.binance.com/AbC123")).toEqual({
      userId: "s.binance.com/AbC123",
      profileUrl: "https://s.binance.com/AbC123",
    });
  });

  it("other Binance URLs: a normalized key that ignores locale and param order", () => {
    const a = parseBinanceProfile("https://www.binance.com/en/p2p/foo?b=2&a=1");
    const b = parseBinanceProfile("https://WWW.binance.com/fr/p2p/foo?a=1&b=2#frag");
    expect(a?.userId).toBe("www.binance.com/p2p/foo?a=1&b=2");
    expect(b?.userId).toBe(a?.userId);
    expect(parseBinanceProfile("https://binance.me/x/y")?.userId).toBe("binance.me/x/y");
  });

  it("non-URL payloads: regex sweep for a known key", () => {
    expect(parseBinanceProfile("open advertiserNo=s0123abcd please")?.userId).toBe("s0123abcd");
  });

  it("bare advertiser numbers", () => {
    expect(parseBinanceProfile("s0123abcdef")?.userId).toBe("s0123abcdef");
    expect(parseBinanceProfile("12345678")?.userId).toBe("12345678");
  });

  it.each([
    "",
    "   ",
    "hello world",
    "short1",
    "https://example.com/path",
    "https://binance.com.evil.io/x", // look-alike host, no id
    "https://evilbinance.com/x",
  ])("returns null for %j", (raw) => {
    expect(parseBinanceProfile(raw)).toBeNull();
  });
});
