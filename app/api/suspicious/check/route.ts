import { NextRequest, NextResponse } from "next/server";
import { reportsForUser } from "@/lib/db/suspicious";
import { parseBinanceProfile } from "@/lib/qr";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * GET /api/suspicious/check?decoded=<raw QR string or profile URL>
 *
 * Public — anyone can check a QR against the registry, no auth. Returns
 * `flagged: true` with the matching reports when the taker is in the list,
 * `flagged: false` otherwise. Parsing failures are a 422 so the caller can
 * show a "we couldn't read this QR" message instead of "not flagged".
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

  const reports = await reportsForUser(ref.userId);
  return NextResponse.json({
    flagged: reports.length > 0,
    profile: ref,
    reports,
  });
}
