import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { CACHE_PUBLIC_SHORT, errorResponse } from "@/lib/api";
import {
  COMPARE_RANGES,
  loadBooksPayload,
  loadComparePayload,
} from "@/lib/compare-server";
import { memberRangeGuard, rangeCacheControl } from "@/lib/member-gate";

const Query = z.object({
  range: z.enum(COMPARE_RANGES).default("24h"),
  /** "books" = live books only (arbitrage page); "full" adds history + share. */
  view: z.enum(["full", "books"]).default("full"),
});

/**
 * GET /api/compare?range=24h            → books + spread history + market share
 * GET /api/compare?view=books           → both exchanges' live books only
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  if (q.data.view === "full") {
    const locked = await memberRangeGuard(req, q.data.range);
    if (locked) return locked;
  }
  try {
    const body =
      q.data.view === "books" ? await loadBooksPayload() : await loadComparePayload(q.data.range);
    return NextResponse.json(body, {
      headers: {
        "Cache-Control":
          q.data.view === "books" ? CACHE_PUBLIC_SHORT : rangeCacheControl(q.data.range, CACHE_PUBLIC_SHORT),
      },
    });
  } catch (err) {
    return errorResponse(err);
  }
}
