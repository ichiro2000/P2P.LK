import { NextRequest, NextResponse } from "next/server";
import { runIngest } from "@/lib/ingest";

/**
 * Protected ingest endpoint.
 *
 * Local dev — no auth required (CRON_SECRET unset).
 * Production — set CRON_SECRET and hit this from Vercel Cron with
 *   Authorization: Bearer $CRON_SECRET (Vercel adds this automatically for
 *   cron jobs defined in vercel.json).
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs"; // better-sqlite3 is a native module
export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (secret) {
    const auth = req.headers.get("authorization") ?? "";
    if (auth !== `Bearer ${secret}`) {
      return NextResponse.json(
        { error: "unauthorized" },
        { status: 401 },
      );
    }
  }

  try {
    const report = await runIngest();
    return NextResponse.json(report);
  } catch (err) {
    return NextResponse.json(
      {
        error: err instanceof Error ? err.message : "ingest failed",
      },
      { status: 500 },
    );
  }
}
