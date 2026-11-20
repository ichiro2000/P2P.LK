import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/guard";
import { buildMarket } from "@/lib/analytics";
import { CACHE_PUBLIC_SHORT, errorResponse, parseMarketQuery } from "@/lib/api";
import { getBook, isCachedQuery } from "@/lib/market-data";

/** GET /api/p2p/market?exchange=binance&payTypes=BANK&publisher=merchant&transAmount=50000 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const { exchange, query } = parseMarketQuery(req);
  // Filtered queries go upstream (Binance relay / Bybit): tighter per-IP limit.
  if (!isCachedQuery(exchange, query)) {
    const live = await rateLimit(req, "write", "market-live");
    if (live) return live;
  }
  try {
    const book = await getBook(exchange, query);
    const snapshot = buildMarket(query.asset, query.fiat, [...book.buy, ...book.sell]);
    return NextResponse.json(
      { ...snapshot, exchange, fetchedAt: new Date(book.ts * 1000).toISOString(), source: book.source },
      { headers: { "Cache-Control": CACHE_PUBLIC_SHORT } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
