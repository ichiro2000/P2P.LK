import { NextRequest, NextResponse } from "next/server";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket } from "@/lib/analytics";

export const revalidate = 20;
export const dynamic = "force-dynamic";

/**
 * GET /api/p2p/market?asset=USDT&fiat=LKR&rows=20&payTypes=BANK,WISE&publisher=merchant
 * Returns a full MarketSnapshot (both sides + stats).
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asset = (sp.get("asset") ?? "USDT").toUpperCase();
  const fiat = (sp.get("fiat") ?? "LKR").toUpperCase();
  const rows = Math.min(20, Math.max(5, Number(sp.get("rows") ?? 20)));
  const payTypes =
    sp
      .get("payTypes")
      ?.split(",")
      .map((s) => s.trim())
      .filter(Boolean) ?? [];
  const publisherType =
    sp.get("publisher") === "merchant" ? "merchant" : null;
  const transAmount = sp.get("transAmount") ?? "";

  try {
    const { buy, sell } = await fetchBothSides({
      asset,
      fiat,
      rows,
      payTypes,
      publisherType,
      transAmount,
    });

    const ads = [
      ...normalizeAds(buy, "BUY"),
      ...normalizeAds(sell, "SELL"),
    ];
    const snapshot = buildMarket(asset, fiat, ads);

    return NextResponse.json(snapshot, {
      headers: {
        "Cache-Control":
          "public, s-maxage=20, stale-while-revalidate=60",
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message, asset, fiat },
      { status: 502 },
    );
  }
}
