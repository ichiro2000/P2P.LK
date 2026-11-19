import { describe, expect, it } from "vitest";
import { deriveMerchantTier, TIER_LABEL } from "@/lib/merchant-tier";

describe("deriveMerchantTier", () => {
  it("regular users get no badge, whatever their vipLevel", () => {
    expect(deriveMerchantTier({})).toBeNull();
    expect(deriveMerchantTier({ isMerchant: false, vipLevel: 3 })).toBeNull();
    expect(deriveMerchantTier({ isMerchant: null, userIdentity: "USER" })).toBeNull();
  });

  it("merchant + vipLevel 1/2/3 → bronze/silver/gold", () => {
    expect(deriveMerchantTier({ isMerchant: true, vipLevel: 1 })).toBe("bronze");
    expect(deriveMerchantTier({ isMerchant: true, vipLevel: 2 })).toBe("silver");
    expect(deriveMerchantTier({ isMerchant: true, vipLevel: 3 })).toBe("gold");
    expect(deriveMerchantTier({ isMerchant: true, vipLevel: 4 })).toBe("gold");
  });

  it("a merchant identity counts as merchant even without the flag (case-insensitive)", () => {
    expect(deriveMerchantTier({ userIdentity: "MASS_MERCHANT", vipLevel: 2 })).toBe("silver");
    expect(deriveMerchantTier({ userIdentity: "mass_merchant", vipLevel: 2 })).toBe("silver");
  });

  it("BLOCK_MERCHANT is always gold", () => {
    expect(deriveMerchantTier({ userIdentity: "BLOCK_MERCHANT", vipLevel: 1 })).toBe("gold");
    expect(deriveMerchantTier({ userIdentity: "block_merchant" })).toBe("gold");
  });

  it("merchant with missing / zero vipLevel falls back to bronze", () => {
    expect(deriveMerchantTier({ isMerchant: true })).toBe("bronze");
    expect(deriveMerchantTier({ isMerchant: true, vipLevel: null })).toBe("bronze");
    expect(deriveMerchantTier({ isMerchant: true, vipLevel: 0 })).toBe("bronze");
  });

  it("has a label for every tier", () => {
    expect(TIER_LABEL).toEqual({ bronze: "Bronze", silver: "Silver", gold: "Gold" });
  });
});
