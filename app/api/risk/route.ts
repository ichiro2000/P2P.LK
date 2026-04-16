import { NextRequest, NextResponse } from "next/server";
import { RANGES, type RangeKey } from "@/lib/db/queries";
import { computeRiskReport } from "@/lib/risk";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const asset = (sp.get("asset") ?? "USDT").toUpperCase();
  const fiat = (sp.get("fiat") ?? "LKR").toUpperCase();
  const rangeKey = (sp.get("range") ?? "24h") as RangeKey;
  const range: RangeKey = rangeKey in RANGES ? rangeKey : "24h";

  const report = computeRiskReport(asset, fiat, range);
  return NextResponse.json(report);
}
