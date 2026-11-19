import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse, parseMarketQuery } from "@/lib/api";
import { activityIndex } from "@/lib/activity";

const Query = z.object({
  top: z.coerce.number().int().min(1).max(50).catch(20).default(20),
});

/**
 * GET /api/liquidity/activity?exchange=binance[&top=20]
 * Activity index: last 24h vs the 24h before — orders index (rises in
 * merchants' 30-day order counts), ads, merchants and near-touch depth.
 * Real trade volume isn't public; the orders index is an index, not volume.
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  const { exchange, query } = parseMarketQuery(req);
  try {
    const data = await activityIndex(exchange, query.asset, query.fiat, { topMerchants: q.data.top });
    return NextResponse.json(
      {
        ...data,
        note: "orders = Σ rises in merchants' 30-day order counts between back-to-back sweeps (an index; undercounts). nearAsk/nearBid = USDT within 1% of each side's best; bids are declared, not escrowed.",
      },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
