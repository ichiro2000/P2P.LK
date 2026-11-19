import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse } from "@/lib/api";
import { FX_RATE_TYPES } from "@/lib/db/schema";
import { isFxCurrency } from "@/lib/fx/currencies";
import { latestRates } from "@/lib/fx/queries";
import { getRatesOverview } from "@/lib/fx/overview";

/** Rates change a few times a day; let the edge hold them for 5 minutes. */
const CACHE = "public, max-age=60, s-maxage=300, stale-while-revalidate=900";

const Query = z.object({
  /** "overview" = everything /rates renders; "latest" = just the rate rows. */
  view: z.enum(["overview", "latest"]).default("latest"),
  currency: z
    .string()
    .trim()
    .toUpperCase()
    .refine(isFxCurrency, "unsupported currency")
    .optional(),
  type: z.enum(FX_RATE_TYPES).optional(),
});

/**
 * GET /api/rates?view=latest[&currency=USD][&type=tt_buy]
 *   → { data: LatestRate[] }  latest + previous value per source/currency/type
 * GET /api/rates?view=overview
 *   → { data: RatesOverview } CBSL headline, history, cards, P2P premium
 * Values are LKR per 1 unit of the foreign currency. Indicative only.
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  try {
    const data =
      q.data.view === "overview"
        ? await getRatesOverview()
        : await latestRates({ currency: q.data.currency, type: q.data.type });
    return NextResponse.json({ data }, { headers: { "Cache-Control": CACHE } });
  } catch (err) {
    return errorResponse(err);
  }
}
