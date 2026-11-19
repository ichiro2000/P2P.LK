import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { googleSeries, parseGoogleRange } from "@/lib/fx/google-view";

const Query = z.object({ range: z.string().optional() });

/** GET /api/rates/google?range=24h|7d|30d — Google USD/LKR vs USDT P2P mid. */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  const range = parseGoogleRange(q.data.range);
  const points = await googleSeries(range);
  return NextResponse.json(
    { range, points },
    { headers: { "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=600" } },
  );
}
