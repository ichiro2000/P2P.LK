import { describe, expect, it } from "vitest";
import { normalizeLkMobile, normalizeProfileUrl } from "@/lib/auth/validate";

describe("normalizeLkMobile", () => {
  it.each([
    ["0771234567", "+94771234567"],
    ["077 123 4567", "+94771234567"],
    ["077-123-4567", "+94771234567"],
    ["(077) 123 4567", "+94771234567"],
    ["771234567", "+94771234567"],
    ["94771234567", "+94771234567"],
    ["+94771234567", "+94771234567"],
    ["+94 77 123 4567", "+94771234567"],
    ["  +94-70-123-4567  ", "+94701234567"],
    ["0761234567", "+94761234567"],
  ])("%j → %s", (raw, out) => {
    expect(normalizeLkMobile(raw)).toBe(out);
  });

  it.each([
    "",
    "0112345678", // landline (Colombo)
    "+94112345678", // landline in E.164
    "077123456", // too short
    "07712345678", // too long
    "+9477123456",
    "0094771234567", // international 00 prefix isn't accepted
    "+940771234567", // trunk 0 after country code
    "+1 771234567",
    "+91 7712345678",
    "077123456a",
    "++94771234567",
    "94+771234567",
    "phone",
  ])("rejects %j", (raw) => {
    expect(normalizeLkMobile(raw)).toBeNull();
  });
});

describe("normalizeProfileUrl", () => {
  it("empty / missing → empty string (the field is optional)", () => {
    expect(normalizeProfileUrl("", "binance")).toBe("");
    expect(normalizeProfileUrl("   ", "binance")).toBe("");
    expect(normalizeProfileUrl(null, "bybit")).toBe("");
    expect(normalizeProfileUrl(undefined, "bybit")).toBe("");
  });

  it.each([
    ["https://p2p.binance.com/en/advertiserDetail?advertiserNo=s123", "binance"],
    ["https://www.binance.com/en/p2p/advertiserDetail?advertiserNo=s123", "binance"],
    ["https://binance.com/x", "binance"],
    ["https://WWW.BINANCE.COM/x", "binance"],
    ["https://www.bybit.com/en/p2p/profile/s123/USDT/LKR/item", "bybit"],
    ["https://bybit.com/", "bybit"],
  ] as const)("accepts %s", (raw, ex) => {
    const out = normalizeProfileUrl(raw, ex);
    expect(out).toBe(new URL(raw).toString());
  });

  it("adds https:// to a bare host", () => {
    expect(normalizeProfileUrl("p2p.binance.com/en/advertiserDetail?advertiserNo=s1", "binance")).toBe(
      "https://p2p.binance.com/en/advertiserDetail?advertiserNo=s1",
    );
    expect(normalizeProfileUrl("  www.bybit.com/en/p2p/profile/s1  ", "bybit")).toBe(
      "https://www.bybit.com/en/p2p/profile/s1",
    );
  });

  it.each([
    ["http://www.binance.com/x", "binance"], // plain http
    ["ftp://www.binance.com/x", "binance"],
    ["javascript:alert(1)", "binance"],
    ["https://binance.com.evil.io/x", "binance"], // look-alike suffix
    ["https://evilbinance.com/x", "binance"], // look-alike prefix
    ["https://binance.co/x", "binance"],
    ["https://binance.com@evil.io/x", "binance"], // userinfo trick
    ["https://evil.io/?u=https://binance.com", "binance"],
    ["https://www.bybit.com/x", "binance"], // wrong exchange
    ["https://www.binance.com/x", "bybit"],
    ["https://bybit.com.evil.io/", "bybit"],
    ["https://", "binance"],
    ["https://exa mple.com", "binance"],
  ] as const)("rejects %s for %s", (raw, ex) => {
    expect(normalizeProfileUrl(raw, ex)).toBeNull();
  });

  it("caps the stored URL at 300 characters", () => {
    const out = normalizeProfileUrl(`https://www.binance.com/${"a".repeat(400)}`, "binance");
    expect(out).toHaveLength(300);
  });
});
