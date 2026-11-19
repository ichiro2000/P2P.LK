import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse } from "@/lib/api";
import { marketActivity } from "@/lib/db/trade-activity";
import { PERIODS } from "@/lib/trade-trend";

/** Daily rows only change when the collector refreshes a profile (every 5 min). */
const CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=600";

const Query = z.object({
  period: z.enum(PERIODS as [string, ...string[]]).default("day"),
});

/**
 * GET /api/merchants/activity?period=day|week|month
 * Completed P2P orders across ALL fiat markets by the Binance merchants we
 * track (their all-time counters, differenced per SLT day), split by the
 * merchant's side: `buy` = merchant bought USDT, `sell` = merchant sold USDT.
 * Not LKR-only: Binance doesn't split the counters by fiat.
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  try {
    const data = await marketActivity(q.data.period as (typeof PERIODS)[number]);
    return NextResponse.json(
      {
        exchange: "binance",
        scope: "Completed P2P orders across all fiat markets by the Binance merchants we track",
        ...data,
      },
      { headers: { "Cache-Control": CACHE } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
