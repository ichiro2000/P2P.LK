import { NextRequest, NextResponse } from "next/server";
import {
  fetchBybitAdvertiserPublic,
  resolveBinanceProfile,
} from "@/lib/qr-resolve";
import { latestMerchantSnapshotAnyMarket } from "@/lib/db/suspicious";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/suspicious/lookup?decoded=<raw QR string or profile URL>
 *
 * Public, unauthenticated — used by the "Add report" form to pre-fill the
 * display name after a QR upload. Resolution order:
 *
 *   1. Parse the QR content and, if it's a short-link, follow redirects
 *      server-side to extract the real advertiserNo.
 *   2. Look that advertiserNo up in our merchant_snapshots table — free and
 *      instant when the taker is already in the LKR directory.
 *   3. Otherwise hit Binance's public advertiser-detail endpoint for the
 *      live nickname. Returns `displayName: null` when all three fail so the
 *      form knows to fall back to manual entry.
 */
export async function GET(req: NextRequest) {
  const decoded = req.nextUrl.searchParams.get("decoded");
  if (!decoded || !decoded.trim()) {
    return NextResponse.json(
      { error: "Missing `decoded` query param." },
      { status: 400 },
    );
  }

  const ref = await resolveBinanceProfile(decoded);
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
  if (snap?.merchantName) {
    return NextResponse.json({
      profile: ref,
      displayName: snap.merchantName,
      lastSeenTs: snap.ts,
      source: "snapshot" as const,
    });
  }

  // Live Binance fetch — the taker hasn't been captured by our LKR ingest.
  const live = await fetchBybitAdvertiserPublic(ref.userId).catch(() => null);
  if (live?.nickName) {
    return NextResponse.json({
      profile: ref,
      displayName: live.nickName,
      lastSeenTs: null,
      source: "binance" as const,
      binance: live,
    });
  }

  return NextResponse.json({
    profile: ref,
    displayName: null,
    lastSeenTs: null,
    source: "none" as const,
  });
}
