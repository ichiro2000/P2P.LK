import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/guard";
import { CACHE_PUBLIC_SHORT } from "@/lib/api";
import { getBtcSpot } from "@/lib/btc";

/** GET /api/p2p/btc → BTC/USDT spot { price, change24h, source, ts }. */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  try {
    const spot = await getBtcSpot();
    return NextResponse.json(spot, { headers: { "Cache-Control": CACHE_PUBLIC_SHORT } });
  } catch {
    return NextResponse.json(
      { error: "Bitcoin price is not available right now." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
