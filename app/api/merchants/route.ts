import { NextRequest, NextResponse } from "next/server";
import { fetchBothSides, normalizeAds } from "@/lib/bybit";
import {
  buildMarket,
  mergeMerchantDirectory,
  summarizeMerchants,
} from "@/lib/analytics";
import { resolveBankPayTypes } from "@/lib/constants";
import { listAllKnownMerchants } from "@/lib/db/queries";

export const revalidate = 20;
export const dynamic = "force-dynamic";

/**
 * GET /api/merchants?asset=USDT&fiat=LKR
 *
 * Returns the full merchant directory: live counterparties on the current
 * book, merged with every merchant we've previously snapshotted for this
 * market. Inactive merchants carry their last-known stats.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asset = (sp.get("asset") ?? "USDT").toUpperCase();
  const fiat = (sp.get("fiat") ?? "USD").toUpperCase();
  const rawPay = sp.get("payTypes") ?? "";
  const paySelection = rawPay.split(",").map((s) => s.trim()).filter(Boolean);
  const payTypes =
    paySelection.length === 1
      ? resolveBankPayTypes(paySelection[0])
      : paySelection.length > 1
        ? paySelection
        : resolveBankPayTypes("");
  const publisherType = sp.get("publisher") === "merchant" ? "merchant" : null;

  try {
    const [{ buy, sell }, known] = await Promise.all([
      fetchBothSides({
        asset,
        fiat,
        rows: 20,
        payTypes,
        publisherType,
      }),
      listAllKnownMerchants(asset, fiat).catch(() => []),
    ]);

    const ads = [
      ...normalizeAds(buy, "BUY"),
      ...normalizeAds(sell, "SELL"),
    ];
    const snapshot = buildMarket(asset, fiat, ads);
    const marketMedian =
      snapshot.sell.medianPrice ?? snapshot.buy.medianPrice ?? null;
    const liveMerchants = summarizeMerchants(ads, marketMedian);
    const nowTs = Math.floor(Date.now() / 1000);
    const directory = mergeMerchantDirectory(
      liveMerchants,
      known,
      marketMedian,
      nowTs,
    );

    return NextResponse.json(
      {
        asset,
        fiat,
        fetchedAt: new Date().toISOString(),
        marketMedian,
        liveCount: liveMerchants.length,
        knownCount: known.length,
        merchants: directory,
      },
      {
        headers: {
          "Cache-Control": "public, s-maxage=20, stale-while-revalidate=60",
        },
      },
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json(
      { error: message, asset, fiat },
      { status: 502 },
    );
  }
}
