import "server-only";
import { asc, gte } from "drizzle-orm";
import { getDb, schema } from "@/lib/db/client";
import { p2pDaily } from "@/lib/fx/queries";
import { addDays, sltDate } from "@/lib/fx/http";
import type { ExchangeId } from "@/lib/exchanges";
import { loadCbsl } from "@/lib/dollar-data";
import type { Link } from "@/lib/dollar-signals";
import { DEVI, getSpotDaily, getSpotLive, type SpotDay } from "@/lib/gold/sources";
import {
  DEVI_STALE_DAYS,
  LAG_DAYS,
  goldDays,
  forwardPairs,
  goldDeviations,
  goldForecast,
  goldLink,
  goldSideLink,
  goldSignal,
  goldView,
  lagBeta,
  type GoldDevDay,
  type GoldForecast,
  type GoldSignal,
  type GoldView,
} from "@/lib/gold-signals";

/**
 * "Gold vs USDT" for the risk page: the owner's UAE-vs-Colombo pawn maths on
 * live numbers, plus the lag-corrected premium signal (lib/gold-signals.ts)
 * on the stored Devi history, world spot (PAXG daily) and CBSL's rate.
 *
 * Reads: gold_prices (≈ 1 year), CBSL days, USDT daily averages; spot comes
 * from public market APIs (cached per isolate).
 */

const HISTORY_DAYS = 400;
const CHART_DAYS = 120;

export type GoldChartPoint = { day: string; premium: number; adjusted: number; baseline: number | null };

export type GoldReport = {
  nowTs: number;
  exchange: ExchangeId;
  live: {
    uae24: number | null;
    uae22: number | null;
    uaeDay: string | null;
    sl24: number | null;
    sl22: number | null;
    slDay: string | null;
    spot: number | null;
    spotSource: string | null;
    usdt: number | null;
    v24: GoldView;
    v22: GoldView;
  };
  deviStale: boolean;
  uaeStale: boolean;
  beta: { beta: number; fitted: boolean; n: number };
  /** Latest Devi day with all legs. */
  latest: GoldDevDay | null;
  /** Gold deviation on day d vs USDT d → next day (needs our USDT history). */
  link: Link;
  /** Gold deviation vs Colombo's own next move (does the gap close on the gold side?). */
  goldSide: Link;
  signal: GoldSignal | null;
  /** Predicted next-day USDT/LKR — only once our USDT history backs the link. */
  forecast: GoldForecast | null;
  chart: GoldChartPoint[];
  sources: { uae: string; sl: string; spot: string | null };
};

const daysApart = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** Value at `day`, else the nearest earlier one within `maxBack` days. */
function atOrBefore<T extends { day: string }>(xs: readonly T[], day: string, maxBack: number): T | null {
  let best: T | null = null;
  for (const x of xs) {
    if (x.day > day) break;
    best = x;
  }
  return best && daysApart(best.day, day) <= maxBack ? best : null;
}

export async function computeGoldReport(
  ex: ExchangeId,
  usdtNow: number | null,
  nowTs = Math.floor(Date.now() / 1000),
): Promise<GoldReport> {
  const db = await getDb();
  const today = sltDate(new Date(nowTs * 1000));
  const since = addDays(today, -HISTORY_DAYS);
  const g = schema.goldPrices;
  const [rows, cbsl, daily, spotDaily, spotLive] = await Promise.all([
    db.select().from(g).where(gte(g.day, since)).orderBy(asc(g.day)),
    loadCbsl(db, since),
    p2pDaily(addDays(today, -120)),
    getSpotDaily(nowTs * 1000).catch(() => null),
    getSpotLive(nowTs * 1000).catch(() => null),
  ]);

  const series = (source: string, karat: number) =>
    rows.filter((r) => r.source === source && r.karat === karat).map((r) => ({ day: r.day, value: Number(r.value) }));
  const devi24 = series(DEVI.id, 24);
  const devi22 = series(DEVI.id, 22);
  const uae24 = series("uae", 24);
  const uae22 = series("uae", 22);
  const last = <T,>(xs: readonly T[]) => xs[xs.length - 1] ?? null;

  // ── live view (the owner's maths)
  const sl24 = last(devi24);
  const sl22 = last(devi22);
  const u24 = last(uae24);
  const u22 = last(uae22);
  const spot = spotLive?.price ?? null;
  const live = {
    uae24: u24?.value ?? null,
    uae22: u22?.value ?? null,
    uaeDay: u24?.day ?? null,
    sl24: sl24?.value ?? null,
    sl22: sl22?.value ?? null,
    slDay: sl24?.day ?? null,
    spot,
    spotSource: spotLive?.source ?? null,
    usdt: usdtNow,
    v24: goldView({ uaeGramAed: u24?.value ?? null, slPawnLkr: sl24?.value ?? null, spotUsdOz: spot, usdtLkr: usdtNow }),
    v22: goldView({
      uaeGramAed: u22?.value ?? null,
      slPawnLkr: sl22?.value ?? null,
      spotUsdOz: spot,
      usdtLkr: usdtNow,
      karat: 22,
    }),
  };
  const deviStale = !sl24 || daysApart(sl24.day, today) > DEVI_STALE_DAYS;
  const uaeStale = !u24 || daysApart(u24.day, today) > 1;

  // ── daily premium over world spot, lag-corrected
  const spots: SpotDay[] = spotDaily?.days ?? [];
  const official = cbsl.map((c) => ({ day: c.day, value: c.value }));
  const days = goldDays(
    devi24.map((d) => ({
      day: d.day,
      sl24: d.value,
      spot: atOrBefore(spots, d.day, 0)?.open ?? null,
      spotPast: atOrBefore(spots, addDays(d.day, -LAG_DAYS), 3)?.open ?? null,
      official: atOrBefore(official, d.day, 5)?.value ?? null,
    })),
  );
  // β from history BEFORE the latest day, so the day being judged can't flatten its own correction.
  const beta = lagBeta(days.slice(0, -1));
  const devs = goldDeviations(days, beta.beta);
  const latest = devs[devs.length - 1] ?? null;

  const usdtDaily = new Map(
    daily.filter((d) => d.exchange === ex && d.mid != null).map((d) => [d.day, d.mid as number]),
  );
  const link = goldLink(devs, usdtDaily);
  const goldSide = goldSideLink(devs, new Map(devi24.map((d) => [d.day, d.value])));
  const latestStale = deviStale || !latest || latest.day !== sl24?.day;
  const signal = goldSignal(latest, link, latestStale);
  const forecast = latestStale ? null : goldForecast(latest?.dev ?? null, forwardPairs(devs, usdtDaily), link, usdtNow);

  return {
    nowTs,
    exchange: ex,
    live,
    deviStale,
    uaeStale,
    beta,
    latest,
    link,
    goldSide,
    signal,
    forecast,
    chart: devs
      .filter((d) => d.day >= addDays(today, -CHART_DAYS))
      .map((d) => ({ day: d.day, premium: d.premium, adjusted: d.adjusted, baseline: d.baseline })),
    sources: { uae: "Dubai Gold & Jewellery Group (via Khaleej Times)", sl: DEVI.name, spot: spotDaily?.source ?? null },
  };
}

