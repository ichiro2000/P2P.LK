import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/guard";
import { getBtcHistory } from "@/lib/btc";

/** GET /api/p2p/btc/history → { points: [{ t, price }], source } (24 h, 15-minute BTC/USDT closes). */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  try {
    const { points, source } = await getBtcHistory();
    return NextResponse.json(
      { points, source },
      { headers: { "Cache-Control": "public, max-age=60, s-maxage=120, stale-while-revalidate=300" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Bitcoin history is not available right now." },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
