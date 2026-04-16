import { NextRequest, NextResponse } from "next/server";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket } from "@/lib/analytics";
import { DEFAULT_ARB_FIATS } from "@/lib/constants";

export const revalidate = 30;
export const dynamic = "force-dynamic";

/**
 * GET /api/p2p/markets?asset=USDT&fiats=LKR,INR,PKR
 * Returns array of MarketSnapshots — used for arbitrage scanner.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asset = (sp.get("asset") ?? "USDT").toUpperCase();
  const fiatsParam = sp.get("fiats");
  const fiats = fiatsParam
    ? fiatsParam.split(",").map((s) => s.trim().toUpperCase()).filter(Boolean)
    : DEFAULT_ARB_FIATS;

  const rows = Math.min(20, Math.max(5, Number(sp.get("rows") ?? 10)));

  const snapshots = await Promise.all(
    fiats.map(async (fiat) => {
      try {
        const { buy, sell } = await fetchBothSides({
          asset,
          fiat,
          rows,
          publisherType: null,
        });
        const ads = [
          ...normalizeAds(buy, "BUY"),
          ...normalizeAds(sell, "SELL"),
        ];
        return buildMarket(asset, fiat, ads);
      } catch {
        return buildMarket(asset, fiat, []);
      }
    }),
  );

  return NextResponse.json(
    { snapshots, fetchedAt: new Date().toISOString() },
    {
      headers: {
        "Cache-Control":
          "public, s-maxage=30, stale-while-revalidate=90",
      },
    },
  );
}
