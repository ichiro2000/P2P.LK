import "server-only";
import { cookies } from "next/headers";
import { DEFAULT_EXCHANGE, isExchangeId, type ExchangeId } from "@/lib/exchanges";

export const EXCHANGE_COOKIE = "ex";

/** Exchange the visitor last picked in the top-bar switch (cookie), or the
 *  default. Server components call this; API routes accept `?exchange=`. */
export async function getActiveExchange(): Promise<ExchangeId> {
  const v = (await cookies()).get(EXCHANGE_COOKIE)?.value;
  return isExchangeId(v) ? v : DEFAULT_EXCHANGE;
}

export function exchangeFromParam(v: string | null | undefined): ExchangeId {
  return isExchangeId(v) ? v : DEFAULT_EXCHANGE;
}
