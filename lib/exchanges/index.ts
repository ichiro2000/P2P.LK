import { binance } from "./binance";
import { bybit } from "./bybit";
import type { ExchangeAdapter, ExchangeId } from "./types";

export * from "./types";

export const EXCHANGES: Record<ExchangeId, ExchangeAdapter> = { binance, bybit };

export const DEFAULT_EXCHANGE: ExchangeId = "binance";

export function getExchange(id: ExchangeId): ExchangeAdapter {
  return EXCHANGES[id];
}
