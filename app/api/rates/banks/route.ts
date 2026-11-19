import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse } from "@/lib/api";
import { isFxCurrency } from "@/lib/fx/currencies";
import { currencyHistory } from "@/lib/fx/queries";

const CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=900";

const Query = z.object({
  currency: z.string().trim().toUpperCase().refine(isFxCurrency, "unsupported currency").default("USD"),
  days: z.coerce.number().int().min(2).max(60).default(14),
});

/** GET /api/rates/banks?currency=EUR&days=14
 *  → { data: { source, type, day, value }[] } every source's daily values for
 *  one currency (the bank table's sparklines). */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  try {
    const data = await currencyHistory(q.data.currency, q.data.days);
    return NextResponse.json({ currency: q.data.currency, days: q.data.days, data }, { headers: { "Cache-Control": CACHE } });
  } catch (err) {
    return errorResponse(err);
  }
}
