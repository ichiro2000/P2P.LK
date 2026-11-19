import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery, zRequiredText } from "@/lib/guard";

const Query = z.object({ decoded: zRequiredText(2048, "Missing `decoded` query param.") });
import { reportsForUser } from "@/lib/db/suspicious";
import { resolveBinanceProfile } from "@/lib/qr-resolve";

/**
 * GET /api/suspicious/check?decoded=<raw QR string or profile URL>
 *
 * Public — anyone can check a QR against the registry, no auth. Returns
 * `flagged: true` with the matching reports when the taker is in the list,
 * `flagged: false` otherwise. Parsing failures are a 422 so the caller can
 * show a "we couldn't read this QR" message instead of "not flagged".
 */
export async function GET(req: NextRequest) {
  // Resolving a QR can follow redirects or start a headless browser, so it
  // shares the strict write bucket.
  const limited = await rateLimit(req, "write", "qr");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  const { decoded } = q.data;

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

  const reports = await reportsForUser("binance", ref.userId);
  return NextResponse.json({
    flagged: reports.length > 0,
    profile: ref,
    reports,
  });
}
