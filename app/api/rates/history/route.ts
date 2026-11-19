import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse } from "@/lib/api";
import { FX_RATE_TYPES } from "@/lib/db/schema";
import { isFxCurrency } from "@/lib/fx/currencies";
import { addDays, sltDate } from "@/lib/fx/http";
import { rateSeries } from "@/lib/fx/queries";
import { FX_SOURCES } from "@/lib/fx/sources";

const CACHE = "public, max-age=300, s-maxage=900, stale-while-revalidate=3600";
const RANGE_DAYS = { "1w": 7, "1m": 31, "3m": 92, "1y": 366, all: null } as const;

const Query = z.object({
  source: z.enum(FX_SOURCES.map((s) => s.id) as [string, ...string[]]).default("cbsl"),
  currency: z.string().trim().toUpperCase().refine(isFxCurrency, "unsupported currency").default("USD"),
  type: z.enum(FX_RATE_TYPES).default("indicative"),
  range: z.enum(["1w", "1m", "3m", "1y", "all"]).default("1y"),
});

/** GET /api/rates/history?source=cbsl&currency=USD&type=indicative&range=1y
 *  → { data: { day, value }[] } one point per published day. */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  const { source, currency, type, range } = q.data;
  const days = RANGE_DAYS[range];
  try {
    const data = await rateSeries(source, currency, type, days ? addDays(sltDate(new Date()), -days) : undefined);
    return NextResponse.json({ source, currency, type, range, data }, { headers: { "Cache-Control": CACHE } });
  } catch (err) {
    return errorResponse(err);
  }
}
