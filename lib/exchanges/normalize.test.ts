import { describe, expect, it } from "vitest";
import { binanceRestrictions, normalizeBinanceAd, type BinanceAdItem } from "@/lib/exchanges/binance";
import {
  bybitPayName,
  bybitRestrictions,
  bybitVerifiedLevel,
  normalizeBybitAd,
  type BybitItem,
} from "@/lib/exchanges/bybit";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import { isVerified } from "@/lib/compare";

/* Trimmed from real public responses, 2026-11-20 (USDT/LKR, bank rails). */

const dgak = {
  adv: {
    advNo: "12956770077768695808",
    tradeType: "SELL",
    asset: "USDT",
    fiatUnit: "LKR",
    price: "348.36",
    surplusAmount: "300.30",
    tradableQuantity: "300.00",
    maxSingleTransAmount: "104609",
    minSingleTransAmount: "104500",
    dynamicMaxSingleTransAmount: "104508",
    buyerKycLimit: null,
    buyerRegDaysLimit: null,
    buyerBtcPositionLimit: null,
    userAllTradeCountMin: null,
    userTradeCompleteRateMin: null,
    takerAdditionalKycRequired: 0,
    isTradable: true,
    tradeMethods: [{ identifier: "BANK", tradeMethodName: "Bank Transfer" }],
  },
  advertiser: {
    userNo: "s6336c43e55c034e48524db990b6ff9f7",
    nickName: "DGAK",
    monthOrderCount: 15,
    monthFinishRate: 1.0,
    userType: "user",
    userGrade: 2,
    userIdentity: "",
    vipLevel: null,
  },
} as unknown as BinanceAdItem;

const ledgerking = {
  id: "1",
  side: 1,
  userId: "0",
  userMaskId: "s-ledger",
  nickName: "LedgerkingLK",
  tokenId: "USDT",
  currencyId: "LKR",
  price: "349.98",
  lastQuantity: "226.6922",
  quantity: "1000",
  minAmount: "50000.00",
  maxAmount: "79337.73",
  payments: ["14"],
  orderNum: 6512,
  finishNum: 6407,
  recentOrderNum: 1274,
  recentExecuteRate: 100,
  userType: "PERSONAL",
  authStatus: 1,
  authTag: ["VA1", "GA", "VA", "VA2", "VA3"],
  isOnline: false,
  verificationOrderSwitch: true,
  tradingPreferenceSet: { isKyc: 1, hasRegisterTime: 0, hasCompleteRateDay30: 0, hasOrderFinishNumberDay30: 0 },
} as unknown as BybitItem;

const ceylonVip = {
  ...ledgerking,
  id: "2",
  nickName: "CeylonVIP",
  price: "345.85",
  authStatus: 2,
  authTag: ["GA"],
  isOnline: false,
  verificationOrderSwitch: false,
  payments: ["817", "14"],
  recentOrderNum: 440,
  tradingPreferenceSet: {
    isKyc: 1,
    hasRegisterTime: 1,
    registerTimeThreshold: 15,
    hasOrderFinishNumberDay30: 1,
    orderFinishNumberDay30: 5,
    hasCompleteRateDay30: 1,
    completeRateDay30: "85",
  },
} as unknown as BybitItem;

const cryptoSeller = {
  ...ledgerking,
  id: "3",
  nickName: "crypto_seller_",
  price: "348.72",
  authTag: ["VA1", "GA", "VA"],
  isOnline: true,
  verificationOrderSwitch: false,
  recentOrderNum: 146,
  tradingPreferenceSet: {
    isKyc: 1,
    hasRegisterTime: 1,
    registerTimeThreshold: 30,
    hasNationalLimit: 1,
    nationalLimit: "LKA",
  },
} as unknown as BybitItem;

describe("Binance normalisation", () => {
  it("F18: uses net tradable quantity and the dynamic max order", () => {
    const ad = normalizeBinanceAd(dgak, "SELL");
    expect(ad.available).toBe(300);
    expect(ad.maxOrder).toBe(104_508);
    expect(ad.minOrder).toBe(104_500);
  });

  it("falls back to the gross fields when the net ones are missing", () => {
    const raw = { ...dgak, adv: { ...dgak.adv, tradableQuantity: null, dynamicMaxSingleTransAmount: null } };
    const ad = normalizeBinanceAd(raw as unknown as BinanceAdItem, "SELL");
    expect(ad.available).toBeCloseTo(300.3, 9);
    expect(ad.maxOrder).toBe(104_609);
  });

  it("no counterparty conditions → not restricted, online unknown", () => {
    const ad = normalizeBinanceAd(dgak, "SELL");
    expect(ad.restricted).toBe(false);
    expect(ad.restrictions).toBeUndefined();
    expect(ad.online).toBeUndefined();
    expect(ad.merchant.orders30d).toBe(15);
  });

  it("F17: trade-history conditions restrict; account age and extra KYC are listed only", () => {
    expect(binanceRestrictions({ userTradeCompleteRateMin: "0.9", userAllTradeCountMin: 10 })).toEqual({
      restricted: true,
      restrictions: ["≥ 90% completion", "≥ 10 trades"],
    });
    expect(binanceRestrictions({ buyerRegDaysLimit: 30, takerAdditionalKycRequired: 1 })).toEqual({
      restricted: false,
      restrictions: ["account ≥ 30 days", "extra KYC check"],
    });
  });
});

describe("Bybit normalisation", () => {
  it("F5: VA tags make a verified advertiser with a tier (userType is always PERSONAL)", () => {
    expect(bybitVerifiedLevel(["VA1", "GA", "VA", "VA2", "VA3"])).toBe(3);
    expect(bybitVerifiedLevel(["VA1", "GA", "VA", "VA2"])).toBe(2);
    expect(bybitVerifiedLevel(["VA1", "GA", "VA"])).toBe(1);
    expect(bybitVerifiedLevel(["VA1", "BA", "GA", "VA"])).toBe(3);
    expect(bybitVerifiedLevel(["GA"])).toBe(0);

    const top = normalizeBybitAd(ledgerking, "SELL");
    expect(top.merchant).toMatchObject({ isMerchant: true, vipLevel: 3 });
    expect(deriveMerchantTier(top.merchant)).toBe("gold");
    expect(deriveMerchantTier(normalizeBybitAd(cryptoSeller, "SELL").merchant)).toBe("bronze");
    const general = normalizeBybitAd(ceylonVip, "SELL");
    expect(general.merchant).toMatchObject({ isMerchant: false, vipLevel: null });
    expect(deriveMerchantTier(general.merchant)).toBeNull();
    // "Verified only" no longer empties the Bybit book.
    expect(isVerified(top)).toBe(true);
    expect(isVerified(general)).toBe(false);
  });

  it("F16: carries isOnline", () => {
    expect(normalizeBybitAd(ledgerking, "SELL").online).toBe(false);
    expect(normalizeBybitAd(cryptoSeller, "SELL").online).toBe(true);
  });

  it("F17: completion / order minimums and a verification order restrict; account age and nationality don't", () => {
    const vip = normalizeBybitAd(ceylonVip, "BUY");
    expect(vip.restricted).toBe(true);
    expect(vip.restrictions).toEqual(["≥ 85% completion (30d)", "≥ 5 orders (30d)", "account ≥ 15 days"]);
    expect(normalizeBybitAd(ledgerking, "SELL")).toMatchObject({
      restricted: true,
      restrictions: ["verification order first"],
    });
    const seller = normalizeBybitAd(cryptoSeller, "SELL");
    expect(seller.restricted).toBe(false);
    expect(seller.restrictions).toEqual(["account ≥ 30 days", "LKA residents only"]);
    expect(bybitRestrictions({ tradingPreferenceSet: null }).restricted).toBe(false);
  });

  it("F19: 30-day orders only — never the lifetime count", () => {
    expect(normalizeBybitAd(ledgerking, "SELL").merchant.orders30d).toBe(1274);
    const zero = normalizeBybitAd({ ...ledgerking, recentOrderNum: 0 }, "SELL");
    expect(zero.merchant.orders30d).toBe(0);
    const missing = normalizeBybitAd({ ...ledgerking, recentOrderNum: undefined }, "SELL");
    expect(missing.merchant.orders30d).toBeNull();
  });

  it("F20: names LKR payment methods from Bybit's list, otherwise 'Bybit method #id'", () => {
    expect(normalizeBybitAd(ceylonVip, "BUY").payMethods.map((m) => m.name)).toEqual([
      "Bank Transfer (Sri Lanka)",
      "Bank Transfer",
    ]);
    expect(bybitPayName("90")).toBe("Cash in Person");
    expect(bybitPayName("814")).toBe("Genie");
    expect(bybitPayName("9999")).toBe("Bybit method #9999");
  });
});
