import { and, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { ExchangeId } from "@/lib/exchanges";
import { SHOWCASE_WINDOW_SEC, type StabilityStats } from "@/lib/market-insights";

/** D1 caps bound parameters at 100 per statement. */
const MAX_IDS = 90;

/**
 * Per-merchant min/max of listed amount and 30d orders over the recent
 * window of 5-minute sweeps — the input for showcase-ad detection.
 * Pass `merchantIds` to read only those merchants (uses the per-merchant
 * index, so it's cheap enough for every Live Markets render).
 */
export async function merchantStability(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  opts: { merchantIds?: readonly string[]; windowSec?: number } = {},
): Promise<StabilityStats[]> {
  const ids = opts.merchantIds ? [...new Set(opts.merchantIds)].slice(0, MAX_IDS) : null;
  if (ids && ids.length === 0) return [];
  const since = Math.floor(Date.now() / 1000) - (opts.windowSec ?? SHOWCASE_WINDOW_SEC);
  const s = schema.merchantSnapshots;
  const db = await getDb();
  const rows = await db
    .select({
      merchantId: s.merchantId,
      samples: sql<number>`count(*)`,
      firstTs: sql<number>`min(${s.ts})`,
      lastTs: sql<number>`max(${s.ts})`,
      minAvailFiat: sql<number | null>`min(${s.totalAvailableFiat})`,
      maxAvailFiat: sql<number | null>`max(${s.totalAvailableFiat})`,
      // USDT listed across both sides (F27): repricing doesn't move it.
      minAvailAsset: sql<number | null>`min(coalesce(${s.bidAvailable}, 0) + coalesce(${s.askAvailable}, 0))`,
      maxAvailAsset: sql<number | null>`max(coalesce(${s.bidAvailable}, 0) + coalesce(${s.askAvailable}, 0))`,
      /** Sweeps written before the per-side USDT columns existed. */
      assetGaps: sql<number>`sum(case when ${s.bidAvailable} is null and ${s.askAvailable} is null then 1 else 0 end)`,
      minOrders: sql<number | null>`min(${s.ordersMonth})`,
      maxOrders: sql<number | null>`max(${s.ordersMonth})`,
    })
    .from(s)
    .where(
      and(
        eq(s.exchange, ex),
        eq(s.asset, asset),
        eq(s.fiat, fiat),
        gte(s.ts, since),
        ids ? inArray(s.merchantId, ids) : undefined,
      ),
    )
    .groupBy(s.merchantId);
  return rows.map((r) => ({
    merchantId: r.merchantId,
    samples: Number(r.samples),
    firstTs: Number(r.firstTs),
    lastTs: Number(r.lastTs),
    minAvailFiat: r.minAvailFiat == null ? null : Number(r.minAvailFiat),
    maxAvailFiat: r.maxAvailFiat == null ? null : Number(r.maxAvailFiat),
    // Any pre-0005 sweep in the window → compare LKR instead (null here).
    minAvailAsset: Number(r.assetGaps) > 0 || r.minAvailAsset == null ? null : Number(r.minAvailAsset),
    maxAvailAsset: Number(r.assetGaps) > 0 || r.maxAvailAsset == null ? null : Number(r.maxAvailAsset),
    minOrders: r.minOrders == null ? null : Number(r.minOrders),
    maxOrders: r.maxOrders == null ? null : Number(r.maxOrders),
  }));
}
