import { NextRequest, NextResponse } from "next/server";
import { dbFromBinding, getEnv } from "@/lib/db/client";
import { runScheduled } from "@/lib/ingest/run";
import { collectFx } from "@/lib/fx/collect";
import { collectGoogleRate } from "@/lib/fx/google";
import { collectGold } from "@/lib/gold/collect";
import { profilesTick } from "@/lib/ingest/profiles";

/**
 * Local development only: run one cron tick on demand.
 *   GET /api/dev/tick                → normal plan for the current minute
 *   GET /api/dev/tick?all=1          → force sweep + rollup + profiles + takers + retention
 *   GET /api/dev/tick?google=1       → run only the Google USD/LKR reading
 *   GET /api/dev/tick?gold=1         → run only the gold collector (UAE + Devi)
 *   GET /api/dev/tick?fx=1           → run only the FX rates collector
 *   GET /api/dev/tick?fx=cbsl,hnb    → … only those FX sources
 *   GET /api/dev/tick?cronfx=1       → normal tick + the cron's FX step (obeys
 *                                      the fxCollector feature flag)
 *   GET /api/dev/tick?profiles=1     → only the Binance Trade Info collector
 *                                      (12 most overdue; &limit=N up to 40)
 *   GET /api/dev/tick?profiles=1&id=s…,s… → refresh exactly those merchants
 * In production there is no HTTP ingest route at all — Cloudflare Cron calls
 * the worker's `scheduled` handler directly.
 */
export async function GET(req: NextRequest) {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }
  const all = req.nextUrl.searchParams.get("all") === "1";
  const env = await getEnv();
  if (req.nextUrl.searchParams.get("google") === "1") {
    return NextResponse.json({ results: [await collectGoogleRate(dbFromBinding(env.DB))] });
  }
  if (req.nextUrl.searchParams.get("gold") === "1") {
    return NextResponse.json({ results: [await collectGold(dbFromBinding(env.DB))] });
  }
  const fx = req.nextUrl.searchParams.get("fx");
  if (fx) {
    const only = fx === "1" ? undefined : fx.split(",").map((s) => s.trim()).filter(Boolean);
    return NextResponse.json({ results: await collectFx(dbFromBinding(env.DB), { only }) });
  }
  if (req.nextUrl.searchParams.get("profiles") === "1") {
    const ids = (req.nextUrl.searchParams.get("id") ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .slice(0, 40);
    const limit = Math.min(40, Number(req.nextUrl.searchParams.get("limit")) || 12);
    const r = await profilesTick({ db: dbFromBinding(env.DB) }, Math.floor(Date.now() / 1000), { ids, limit }).catch(
      (err: unknown) => ({ rows: 0, outcomes: [], error: err instanceof Error ? err.message : String(err) }),
    );
    return NextResponse.json({ results: [r] });
  }
  const cronFx = req.nextUrl.searchParams.get("cronfx") === "1";
  const results = await runScheduled(env, Date.now(), {
    ...(all ? { sweep: true, profiles: true, takers: true, retention: true } : {}),
    ...(cronFx ? { fx: true } : {}),
  });
  return NextResponse.json({ results });
}
