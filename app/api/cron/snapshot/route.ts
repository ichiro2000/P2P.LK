import { NextRequest, NextResponse } from "next/server";
import { runIngest } from "@/lib/ingest";

/**
 * Protected ingest endpoint.
 *
 * On DigitalOcean App Platform we don't use this — the dedicated `ingest`
 * worker (see .do/app.yaml) runs `scripts/ingest.ts --loop` continuously.
 * This route is kept for manual triggers and for alternative hosts that
 * prefer HTTP-driven cron (e.g. external schedulers).
 *
 * Local dev — no auth required (CRON_SECRET unset).
 * Production — set CRON_SECRET and pass it as `Authorization: Bearer …`.
 */
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
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
