import { NextResponse, type NextRequest } from "next/server";
import { ASSET, FIAT } from "@/lib/constants";
import {
  UpstreamError,
  getExchange,
  resolvePayTypes,
  type BookQuery,
  type ExchangeId,
} from "@/lib/exchanges";
import { exchangeFromParam } from "@/lib/exchange-server";

/** Query params every market endpoint understands. Product scope is locked
 *  to USDT/LKR, so asset/fiat are fixed regardless of what's passed. */
export function parseMarketQuery(req: NextRequest): { exchange: ExchangeId; query: BookQuery } {
  const sp = req.nextUrl.searchParams;
  const exchange = exchangeFromParam(sp.get("exchange"));
  const adapter = getExchange(exchange);
  const selection = (sp.get("payTypes") ?? "").split(",")[0]?.trim();
  const amount = Number(sp.get("transAmount"));
  return {
    exchange,
    query: {
      asset: ASSET,
      fiat: FIAT.code,
      payTypes: resolvePayTypes(adapter, selection),
      publisherType: sp.get("publisher") === "merchant" ? "merchant" : null,
      // Rounded to 2 significant figures: an amount filter means a live
      // upstream call, so arbitrary amounts mustn't each be a distinct query.
      transAmount: Number.isFinite(amount) && amount > 0 && amount <= 1e10 ? String(roundAmount(amount)) : undefined,
    },
  };
}

function roundAmount(n: number): number {
  return Math.max(1, Number(n.toPrecision(2)));
}

export const CACHE_PUBLIC_SHORT = "public, max-age=10, s-maxage=20, stale-while-revalidate=60";

export function errorResponse(err: unknown) {
  if (err instanceof UpstreamError) {
    return NextResponse.json(
      { error: `${getExchange(err.exchange).label} is not responding right now.`, detail: err.message },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
  console.error(err);
  return NextResponse.json(
    { error: "Something went wrong." },
    { status: 500, headers: { "Cache-Control": "no-store" } },
  );
}
