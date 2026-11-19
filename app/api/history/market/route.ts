import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { rateLimit, readQuery } from "@/lib/guard";
import { errorResponse, parseMarketQuery } from "@/lib/api";
import { RANGES, type RangeKey } from "@/lib/db/queries";
import { historyBundle } from "@/lib/history";
import { memberRangeGuard, rangeCacheControl } from "@/lib/member-gate";

const RANGE_KEYS = Object.keys(RANGES) as [RangeKey, ...RangeKey[]];

/** Unknown values fall back (old contract) instead of failing the request. */
const Query = z.object({
  range: z.enum(RANGE_KEYS).catch("24h").default("24h"),
  /** `detail=1` adds candles + the other exchange's series. */
  detail: z.enum(["0", "1"]).catch("0").default("0"),
});

/**
 * GET /api/history/market?exchange=binance&range=24h[&detail=1]
 *
 * `points` keeps its original shape (ts, bid, ask, mid, spreadPct, medianBid,
 * medianAsk, bidDepth, askDepth). Series are bucketed so they never exceed
 * ~360 points; long ranges read hourly rollups.
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const q = readQuery(req, Query);
  if (!q.ok) return q.res;
  const { exchange, query } = parseMarketQuery(req);
  const { range, detail } = q.data;
  const locked = await memberRangeGuard(req, range);
  if (locked) return locked;
  try {
    const b = await historyBundle(exchange, query.asset, query.fiat, range, {
      compare: detail === "1",
    });
    return NextResponse.json(
      {
        exchange,
        asset: query.asset,
        fiat: query.fiat,
        range,
        bucketSec: b.bucketSec,
        summary: b.summary,
        points: b.points.map((p) => ({
          ts: p.ts,
          bid: p.bid,
          ask: p.ask,
          mid: p.mid,
          spreadPct: p.spreadPct,
          medianBid: null,
          medianAsk: null,
          bidDepth: p.bidDepth,
          askDepth: p.askDepth,
        })),
        ...(detail === "1"
          ? { candleSec: b.candleSec, candles: b.candles, compare: b.compare }
          : {}),
      },
      {
        headers: {
          "Cache-Control": rangeCacheControl(range, "public, max-age=30, s-maxage=60, stale-while-revalidate=120"),
        },
      },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
