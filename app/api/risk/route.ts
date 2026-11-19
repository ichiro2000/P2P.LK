import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse, parseMarketQuery } from "@/lib/api";
import { RANGES, type RangeKey } from "@/lib/db/queries";
import { computeRiskReport } from "@/lib/risk";
import { memberRangeGuard, rangeCacheControl } from "@/lib/member-gate";

const RANGE_KEYS = Object.keys(RANGES) as [RangeKey, ...RangeKey[]];
const Query = z.object({ range: z.enum(RANGE_KEYS).catch("24h").default("24h") });

export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  const locked = await memberRangeGuard(req, q.data.range);
  if (locked) return locked;
  const { exchange, query } = parseMarketQuery(req);
  try {
    const report = await computeRiskReport(exchange, query.asset, query.fiat, q.data.range);
    return NextResponse.json(report, {
      headers: {
        "Cache-Control": rangeCacheControl(q.data.range, "public, max-age=30, s-maxage=60, stale-while-revalidate=120"),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
