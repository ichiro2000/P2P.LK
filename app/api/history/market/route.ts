import { NextRequest, NextResponse } from "next/server";
import { listMarketSnapshots, marketSummary, RANGES, type RangeKey } from "@/lib/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asset = (sp.get("asset") ?? "USDT").toUpperCase();
  const fiat = (sp.get("fiat") ?? "LKR").toUpperCase();
  const rangeKey = (sp.get("range") ?? "24h") as RangeKey;
  const range: RangeKey = rangeKey in RANGES ? rangeKey : "24h";

  const [rows, summary] = await Promise.all([
    listMarketSnapshots(asset, fiat, range),
    marketSummary(asset, fiat, range),
  ]);

  return NextResponse.json({
    asset,
    fiat,
    range,
    summary,
    points: rows.map((r) => ({
      ts: r.ts,
      bid: r.bestBid,
      ask: r.bestAsk,
      mid: r.mid,
      spreadPct: r.spreadPct,
      medianBid: r.medianBid,
      medianAsk: r.medianAsk,
      bidDepth: r.bidDepth,
      askDepth: r.askDepth,
    })),
  });
}
