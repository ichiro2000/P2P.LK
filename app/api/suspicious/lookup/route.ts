import { NextRequest, NextResponse } from "next/server";
import { parseBinanceProfile } from "@/lib/qr";
import { latestMerchantSnapshotAnyMarket } from "@/lib/db/suspicious";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/suspicious/lookup?decoded=<raw QR string or profile URL>
 *
 * Public, unauthenticated — used by the "Add report" form to pre-fill the
 * display name after a QR upload. We look up the parsed advertiserNo in our
 * merchant_snapshots table and return the most recent nickname we've seen for
 * that merchant. Falls back gracefully to `displayName: null` when the taker
 * has never listed on the LKR book (new / fresh account).
 */
export async function GET(req: NextRequest) {
  const decoded = req.nextUrl.searchParams.get("decoded");
  if (!decoded || !decoded.trim()) {
    return NextResponse.json(
      { error: "Missing `decoded` query param." },
      { status: 400 },
    );
  }

  const ref = parseBinanceProfile(decoded);
  if (!ref) {
    return NextResponse.json(
      {
        error:
          "Couldn't find a Binance advertiserNo in the decoded content. Not a recognizable Binance P2P profile.",
      },
      { status: 422 },
    );
  }

  const snap = await latestMerchantSnapshotAnyMarket(ref.userId).catch(
    () => null,
  );

  return NextResponse.json({
    profile: ref,
    displayName: snap?.merchantName ?? null,
    lastSeenTs: snap?.ts ?? null,
  });
}
