import { NextRequest, NextResponse } from "next/server";
import { fetchBothSides, normalizeAds } from "@/lib/bybit";
import { computeSlippage } from "@/lib/liquidity";
import { resolveBankPayTypes } from "@/lib/constants";
import type { TradeType } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/liquidity/slippage?asset=USDT&fiat=LKR&side=SELL&amount=500000
 *
 * side: "SELL" = you want to BUY the asset (walks ask book)
 *       "BUY"  = you want to SELL the asset (walks bid book)
 * amount: target fiat amount.
 */
export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asset = (sp.get("asset") ?? "USDT").toUpperCase();
  const fiat = (sp.get("fiat") ?? "USD").toUpperCase();
  const sideParam = (sp.get("side") ?? "SELL").toUpperCase();
  const side: TradeType = sideParam === "BUY" ? "BUY" : "SELL";
  const amount = Number(sp.get("amount") ?? 0);

  if (!Number.isFinite(amount) || amount <= 0) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 },
    );
  }

  try {
    const { buy, sell } = await fetchBothSides({
      asset,
      fiat,
      rows: 20,
      payTypes: resolveBankPayTypes(""),
      publisherType: null,
    });
    const ads = [
      ...normalizeAds(buy, "BUY"),
      ...normalizeAds(sell, "SELL"),
    ];
    const result = computeSlippage(ads, side, amount);
    return NextResponse.json({ asset, fiat, ...result });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "failed" },
      { status: 502 },
    );
  }
}
