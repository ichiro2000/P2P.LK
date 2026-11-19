import { describe, expect, it, vi } from "vitest";

// Only the zod shapes are tested; stub the request/DB helpers it re-exports.
vi.mock("@/lib/guard", () => ({ jsonError: vi.fn() }));
vi.mock("@/lib/member-data", () => ({ LimitError: class LimitError extends Error {} }));

import { FilterData, ItemBody, itemKeyFor } from "@/lib/member-api";

/** Saved-filter paths become dashboard links, so they're an open-redirect guard. */
describe("FilterData.path (internal paths only)", () => {
  const parse = (path: string) => FilterData.safeParse({ label: "x", path, search: "" });

  it.each(["/", "/markets", "/merchants/s123_ab-c", "/a/b/c"])("accepts %j", (p) => {
    expect(parse(p).success).toBe(true);
  });

  it.each([
    "//evil.com",
    "/\\evil.com",
    "https://evil.com",
    "javascript:alert(1)",
    "/%2F%2Fevil.com",
    "/.//evil.com",
    "/a?x=1",
    "/a#b",
    "/a b",
    "/a\tb",
    "evil.com",
    "",
    `/${"a".repeat(100)}`,
  ])("rejects %j", (p) => {
    expect(parse(p).success).toBe(false);
  });

  it("trims the path and strips a leading ? from search", () => {
    const r = FilterData.parse({ label: " My filter ", path: " /markets ", search: "?ex=bybit" });
    expect(r).toEqual({ label: "My filter", path: "/markets", search: "ex=bybit" });
  });
});

describe("itemKeyFor", () => {
  it("derives market and merchant keys on the server", () => {
    expect(itemKeyFor(ItemBody.parse({ kind: "market", data: { asset: "usdt", fiat: "lkr" } }))).toBe("USDT/LKR");
    expect(
      itemKeyFor(ItemBody.parse({ kind: "blocked_merchant", data: { exchange: "bybit", id: "s123", name: "X" } })),
    ).toBe("bybit:s123");
    expect(
      itemKeyFor(ItemBody.parse({ kind: "filter", itemKey: "k1", data: { label: "L", path: "/", search: "" } })),
    ).toBe("k1");
  });
});

describe("RuleCreate: dollar-rate rules", () => {
  it("accepts the new types as fractions up to 10 %, and old types still validate", async () => {
    const { RuleCreate } = await import("@/lib/member-api");
    expect(RuleCreate.safeParse({ exchange: "binance", type: "usdGoogleUp", threshold: 0.003 }).success).toBe(true);
    expect(RuleCreate.safeParse({ exchange: "bybit", type: "usdCbslDown", threshold: 0.005 }).success).toBe(true);
    expect(RuleCreate.safeParse({ exchange: "binance", type: "usdGoogleDown", threshold: 0.2 }).success).toBe(false);
    expect(RuleCreate.safeParse({ exchange: "binance", type: "usdNope", threshold: 0.01 }).success).toBe(false);
    expect(RuleCreate.safeParse({ exchange: "binance", type: "priceAbove", threshold: 330 }).success).toBe(true);
    expect(RuleCreate.safeParse({ exchange: "binance", type: "depthBelow", threshold: 5000 }).success).toBe(true);
  });
});
