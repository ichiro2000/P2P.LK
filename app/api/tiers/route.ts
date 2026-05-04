import { NextRequest, NextResponse } from "next/server";
import { fetchBybitP2P, normalizeAds } from "@/lib/bybit";
import { ASSET, FIAT, TIER_AMOUNTS_USD, resolveBankPayTypes } from "@/lib/constants";
import type { NormalizedAd, TradeType } from "@/lib/types";
import type { TierBlock, TiersResponse } from "@/lib/tiers-types";

export type { TierBlock, TiersResponse } from "@/lib/tiers-types";

export const revalidate = 30;
export const dynamic = "force-dynamic";

/**
 * Best-price ranking is direction-aware:
 *   BUY  side (publisher buys USDT, retail sells USDT) — higher price = better
 *                                                       for the retail seller
 *   SELL side (publisher sells USDT, retail buys USDT) — lower price = better
 *                                                       for the retail buyer
 */
function sortBySideBest(ads: NormalizedAd[], side: TradeType): NormalizedAd[] {
  return [...ads].sort((a, b) =>
    side === "BUY" ? b.price - a.price : a.price - b.price,
  );
}

function median(ns: number[]): number | null {
  if (!ns.length) return null;
  const s = [...ns].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

async function fetchTier(
  asset: string,
  fiat: string,
  payTypes: string[],
  amount: number,
  side: TradeType,
): Promise<TierBlock> {
  // Bybit's `amount` filter narrows to ads whose [minAmount, maxAmount] window
  // covers this ticket. 20 rows is the page cap; for these small-fiat books
  // the long tail at any one ticket is shallow, so 20 is enough to show the
  // best 5 plus a "+N more" hint.
  let items: NormalizedAd[] = [];
  try {
    const raw = await fetchBybitP2P({
      asset,
      fiat,
      tradeType: side,
      payTypes,
      transAmount: String(amount),
      rows: 20,
      page: 1,
    });
    items = normalizeAds(raw, side);
  } catch {
    // If Bybit hiccups for one tier, the whole page should still render —
    // surface an empty block rather than 502 the page.
    items = [];
  }

  const sorted = sortBySideBest(items, side);
  return {
    amount,
    side,
    bestPrice: sorted[0]?.price ?? null,
    medianPrice: median(sorted.map((a) => a.price)),
    totalCount: sorted.length,
    ads: sorted.slice(0, 5),
  };
}

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asset = (sp.get("asset") ?? ASSET).toUpperCase();
  const fiat = (sp.get("fiat") ?? FIAT.code).toUpperCase();
  const payTypes = resolveBankPayTypes(sp.get("payType") ?? "");

  // 6 tiers × 2 sides = 12 parallel Bybit calls. Bybit's public endpoint
  // accepts these without rate-limiting at this volume in our testing; if it
  // ever does, drop to sequential per side.
  const buyTiers = await Promise.all(
    TIER_AMOUNTS_USD.map((amt) => fetchTier(asset, fiat, payTypes, amt, "BUY")),
  );
  const sellTiers = await Promise.all(
    TIER_AMOUNTS_USD.map((amt) => fetchTier(asset, fiat, payTypes, amt, "SELL")),
  );

  const body: TiersResponse = {
    asset,
    fiat,
    fetchedAt: new Date().toISOString(),
    tiers: { buy: buyTiers, sell: sellTiers },
  };

  return NextResponse.json(body, {
    headers: {
      "Cache-Control": "public, s-maxage=30, stale-while-revalidate=120",
    },
  });
}
