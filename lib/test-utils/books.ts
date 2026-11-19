import type { LiveBook, LiveBooks } from "@/lib/compare";
import type { ExchangeId } from "@/lib/exchanges/types";
import type { NormalizedAd } from "@/lib/types";

/** A healthy cached book for one exchange. */
export function okBook(exchange: ExchangeId, buy: NormalizedAd[], sell: NormalizedAd[]): LiveBook {
  return {
    exchange,
    label: exchange === "binance" ? "Binance" : "Bybit",
    ok: true,
    ts: 1_763_500_000,
    source: "cache",
    payTypes: [{ id: "BANK", label: "Bank Transfer" }],
    buy,
    sell,
  };
}

export function errBook(exchange: ExchangeId): LiveBook {
  return {
    exchange,
    label: exchange === "binance" ? "Binance" : "Bybit",
    ok: false,
    error: "upstream down",
    payTypes: [{ id: "BANK", label: "Bank Transfer" }],
  };
}

export function books(binance: LiveBook, bybit: LiveBook): LiveBooks {
  return { binance, bybit };
}
