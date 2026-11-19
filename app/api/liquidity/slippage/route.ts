import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse, parseMarketQuery } from "@/lib/api";
import { walkBook } from "@/lib/liquidity";
import { getBook } from "@/lib/market-data";

const Query = z.object({
  side: z
    .string()
    .optional()
    .transform((v) => ((v ?? "SELL").toUpperCase() === "BUY" ? ("BUY" as const) : ("SELL" as const))),
  amount: z.coerce
    .number({ error: "amount must be a positive number" })
    .positive("amount must be a positive number")
    .max(1e10, "amount is too large"),
  /** "all" also walks offline and restricted ads (excluded by default). */
  include: z.string().optional(),
});

/**
 * GET /api/liquidity/slippage?exchange=binance&side=SELL&amount=500000
 *   side SELL = you buy the asset (walks the ask book); BUY = you sell it.
 *   Walks the top 20 ads per side (the same book the page shows) with the
 *   shared `walkBook`: ads whose minimum doesn't fit are skipped, offline and
 *   restricted ads are left out unless `include=all`.
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  const { exchange, query } = parseMarketQuery(req);
  try {
    const book = await getBook(exchange, { asset: query.asset, fiat: query.fiat });
    const all = q.data.include === "all";
    const result = walkBook([...book.buy, ...book.sell], q.data.side, q.data.amount, {
      includeOffline: all,
      includeRestricted: all,
    });
    return NextResponse.json(
      { exchange, asset: query.asset, fiat: query.fiat, ...result },
      { headers: { "Cache-Control": "public, max-age=10, s-maxage=20" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
