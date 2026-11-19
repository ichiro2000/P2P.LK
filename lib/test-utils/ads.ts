import type { NormalizedAd, TradeType } from "@/lib/types";

type AdInput = Partial<Omit<NormalizedAd, "merchant">> & {
  tradeType: TradeType;
  price: number;
  merchant?: Partial<NormalizedAd["merchant"]>;
};

let seq = 0;

/** Build a NormalizedAd for tests. Defaults: 100 USDT available, no min/max
 *  order, one bank-transfer method, and a merchant id unique to the ad. */
export function ad(input: AdInput): NormalizedAd {
  seq += 1;
  const { merchant, ...rest } = input;
  const id = rest.id ?? `ad${seq}`;
  return {
    id,
    asset: "USDT",
    fiat: "LKR",
    available: 100,
    minOrder: 0,
    maxOrder: 0,
    payMethods: [{ id: "BANK", name: "Bank Transfer" }],
    ...rest,
    merchant: {
      id: `m-${id}`,
      name: `Merchant ${id}`,
      isMerchant: false,
      orders30d: 0,
      completionRate: 1,
      ...merchant,
    },
  };
}

/** Shorthands: an ask (sell ad, where you buy USDT) and a bid (buy ad). */
export const ask = (price: number, extra: Omit<AdInput, "tradeType" | "price"> = {}) =>
  ad({ tradeType: "SELL", price, ...extra });
export const bid = (price: number, extra: Omit<AdInput, "tradeType" | "price"> = {}) =>
  ad({ tradeType: "BUY", price, ...extra });
