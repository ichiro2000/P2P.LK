import {
  freshness,
  listMarketSnapshots,
  merchantsInLatestTick,
  merchantsInSweepNear,
  latestMarketSnapshot,
  latestSweepTs,
  type MarketPoint,
  type RangeKey,
} from "@/lib/db/queries";
import { downsampleMinMax } from "@/lib/stats";
import {
  churn,
  depthDrop,
  priceMove,
  MOVE_ALERT,
  MOVE_WARN,
  MOVE_WINDOW_SEC,
  DEPTH_ALERT,
  DEPTH_WARN,
  CHURN_WARN,
  CBSL_SIGNAL,
  USD_SIGNAL,
  type Churn,
  type DepthDrop,
  type PriceMove,
} from "@/lib/risk-signals";
import type { ExchangeId } from "@/lib/exchanges";
import { computeDollarReport, type DollarReport } from "@/lib/dollar-report";
import type { Link } from "@/lib/dollar-signals";
import { formatSLT } from "@/lib/format";

export type RiskSignal = {
  id: string;
  level: "info" | "warn" | "alert";
  title: string;
  detail: string;
  metric?: string;
  /** Optional numeric score 0..100 for ranking. */
  score?: number;
  /** Optional small trend for a sparkline (≤ 60 points, oldest first). */
  spark?: (number | null)[];
  /** Expected direction of USDT (dollar signals): up = green, down = red. */
  direction?: "up" | "down";
};

export type MerchantFlag = {
  merchantId: string;
  merchantName: string;
  reason: string;
  metric: string;
  level: "info" | "warn" | "alert";
};

/** What each monitor compared, in plain words, plus its reading. */
export type RiskChecks = {
  price: PriceMove;
  bidDepth: DepthDrop & { basis: "near-touch" | "top-20" };
  askDepth: DepthDrop & { basis: "near-touch" | "top-20" };
  churn: (Churn & { baselineTs: number }) | null;
};

export type RiskReport = {
  exchange: ExchangeId;
  asset: string;
  fiat: string;
  range: RangeKey;
  generatedAt: string;
  signals: RiskSignal[];
  flaggedMerchants: MerchantFlag[];
  checks: RiskChecks;
  /** Age of the inputs (F24). Signals are not raised on stale data. */
  freshness: {
    snapshotTs: number | null;
    snapshotStale: boolean;
    sweepTs: number | null;
    sweepStale: boolean;
  };
  stats: {
    latestMid: number | null;
    /** Latest 15-min change of the mid (fraction). */
    move15m: number | null;
    /** Median |15-min change| over the last 24 h. */
    typicalMove15m: number | null;
    /** Robust z of the latest 15-min change. */
    priceZ: number | null;
    activeMerchants: number;
    churned: number;
    fresh: number;
  };
  /** Downsampled series behind the monitors (≤ 60 points, oldest first,
   *  min/max kept so spikes survive). */
  series?: {
    ts: number[];
    mid: (number | null)[];
    bidDepth: (number | null)[];
    askDepth: (number | null)[];
    spreadPct: (number | null)[];
  };
  /** Dollar rate vs USDT (USDT/LKR only; null if it could not be computed). */
  dollar?: DollarReport | null;
};

const SPARK = 60;
const spark = (pts: readonly MarketPoint[], key: keyof MarketPoint) =>
  downsampleMinMax(pts, SPARK, (p) => (p[key] as number | null) ?? null).map((p) => (p[key] as number | null) ?? null);

const USD_SIGNAL_MOVE = USD_SIGNAL.move;
const CBSL_WATCH = CBSL_SIGNAL.watch;
const CBSL_WARN = CBSL_SIGNAL.warn;

const pct = (f: number, d = 2) => `${f >= 0 ? "+" : "−"}${Math.abs(f * 100).toFixed(d)}%`;
const amt = (v: number) => v.toLocaleString("en-US", { maximumFractionDigits: 0 });

/** Rows with near-touch depth win; older rows only have the legacy top-20 sum. */
function depthSeries(pts: readonly MarketPoint[], side: "bid" | "ask") {
  const near = pts.map((p) => ({ ts: p.ts, v: side === "bid" ? p.bidDepth1 : p.askDepth1 }));
  const nearCount = near.filter((p) => p.v != null).length;
  if (nearCount >= 12) return { basis: "near-touch" as const, pts: near };
  return { basis: "top-20" as const, pts: pts.map((p) => ({ ts: p.ts, v: side === "bid" ? p.bidDepth : p.askDepth })) };
}

/**
 * Risk report for one market. Every check compares like with like and is
 * evaluated on a fixed look-back, whatever the chart range:
 *   - price move     latest 15-min change of the mid vs the 15-min changes of
 *                    the last 24 h (robust z), AND at least 0.25 % in size;
 *   - depth drop     near-touch depth (within 1 % of each side's best),
 *                    median of the last 15 min vs the 24 h median;
 *   - merchant churn latest sweep vs the sweep an hour earlier; "new" = first
 *                    ever seen after that sweep;
 *   - low completion at the top of the book (latest sweep).
 * Nothing is raised when the latest snapshot / sweep is over 10 minutes old.
 */
export async function computeRiskReport(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  range: RangeKey = "24h",
): Promise<RiskReport> {
  const nowSec = Math.floor(Date.now() / 1000);
  const generatedAt = new Date(nowSec * 1000).toISOString();
  const [rangePts, day, latest, sweepTs] = await Promise.all([
    listMarketSnapshots(ex, asset, fiat, range),
    range === "24h" ? null : listMarketSnapshots(ex, asset, fiat, "24h"),
    latestMarketSnapshot(ex, asset, fiat),
    latestSweepTs(ex, asset, fiat),
  ]);
  const last24 = day ?? rangePts;
  const snapF = freshness(latest?.ts ?? null, nowSec);
  // Sweeps run every 10 minutes; allow one missed before calling it stale.
  const sweepF = freshness(sweepTs, nowSec, 25 * 60);

  const signals: RiskSignal[] = [];
  const flagged: MerchantFlag[] = [];

  const series = {
    ts: downsampleMinMax(rangePts, SPARK, (p) => p.mid).map((p) => p.ts),
    mid: spark(rangePts, "mid"),
    bidDepth: [] as (number | null)[],
    askDepth: [] as (number | null)[],
    spreadPct: spark(rangePts, "spreadPct"),
  };

  // ── stale data: say so, and don't raise market signals on old numbers
  if (snapF.stale) {
    signals.push({
      id: "stale-data",
      level: "alert",
      title: "Market data is stale",
      detail:
        snapF.ts == null
          ? "No market snapshot has been stored yet, so nothing can be checked."
          : `The newest snapshot is ${Math.round((snapF.ageSec ?? 0) / 60)} minutes old. The collector may be down; the checks below are paused until fresh data arrives.`,
      metric: snapF.ts != null ? `last data ${Math.round((snapF.ageSec ?? 0) / 60)} min ago` : "no data",
      score: 100,
    });
  }

  // ── price move: latest 15-min change vs the last 24 h of 15-min changes
  const price = priceMove(last24, nowSec);
  if (!snapF.stale && price.level !== "ok" && price.move != null && price.z != null) {
    signals.push({
      id: "price-spike",
      level: price.level,
      title: `${price.move > 0 ? "Upward" : "Downward"} price move`,
      detail:
        `The mid moved ${pct(price.move)} in the last 15 minutes. A typical 15-minute move over the last 24 h is ` +
        `±${((price.typical ?? 0) * 100).toFixed(2)}%, so this one is ${Math.abs(price.z).toFixed(1)}× the usual spread of moves. ` +
        `It fires only at ${MOVE_WARN.z}× and ${(MOVE_WARN.abs * 100).toFixed(2)}% or more (alert at ${MOVE_ALERT.z}× and ${(MOVE_ALERT.abs * 100).toFixed(1)}%).`,
      metric: `${pct(price.move)} in 15 min · z ${price.z.toFixed(1)}`,
      score: Math.min(100, Math.abs(price.z) * 15),
      spark: series.mid,
    });
  }

  // ── near-touch depth per side: last 15 min vs the 24 h median
  const depthCheck = (side: "bid" | "ask") => {
    const s = depthSeries(last24, side);
    return { ...depthDrop(s.pts, nowSec), basis: s.basis };
  };
  const bidDepth = depthCheck("bid");
  const askDepth = depthCheck("ask");
  // Sparks show the same measure the check used.
  series.bidDepth = spark(rangePts, bidDepth.basis === "near-touch" ? "bidDepth1" : "bidDepth");
  series.askDepth = spark(rangePts, askDepth.basis === "near-touch" ? "askDepth1" : "askDepth");
  for (const [side, d] of [
    ["ask", askDepth],
    ["bid", bidDepth],
  ] as const) {
    if (snapF.stale || d.level === "ok" || d.ratio == null || d.now == null || d.baseline == null) continue;
    const name = side === "ask" ? "Sell-ad" : "Buy-ad";
    const what =
      d.basis === "near-touch"
        ? `${name} depth within 1% of the best price${side === "bid" ? " (declared, not escrowed)" : ""}`
        : `${name} top-20 depth`;
    signals.push({
      id: `${side}-depth-drop`,
      level: d.level,
      title: `${name} liquidity dropped`,
      detail:
        `${what}: the last 15 minutes' median is ${Math.round(d.ratio * 100)}% of its 24 h median. ` +
        `Warns below ${Math.round(DEPTH_WARN * 100)}%, alert below ${Math.round(DEPTH_ALERT * 100)}%. Thinner books mean more slippage.`,
      metric: `${amt(d.now)} / 24h median ${amt(d.baseline)} ${asset}`,
      score: 100 - Math.round(d.ratio * 100),
      spark: side === "bid" ? series.bidDepth : series.askDepth,
    });
  }

  // ── merchants: churn (latest sweep vs ~1 h earlier) + low completion at top
  const current = await merchantsInLatestTick(ex, asset, fiat);
  const base = sweepTs != null ? await merchantsInSweepNear(ex, asset, fiat, sweepTs - 3600) : null;
  const ch = base && current.length ? { ...churn(current, base.ids, base.ts), baselineTs: base.ts } : null;
  if (ch && !sweepF.stale && ch.level !== "ok") {
    signals.push({
      id: "merchant-churn",
      level: ch.level,
      title: "Unusual merchant churn",
      detail:
        `${ch.fresh} advertisers listing now were never seen before the sweep an hour ago (${ch.baseline} were listing then). ` +
        `Fires when new advertisers are at least ${Math.round(CHURN_WARN.share * 100)}% of that and ${CHURN_WARN.min} or more. ` +
        `Could be fresh liquidity or coordinated accounts.`,
      metric: `${ch.fresh} new · ${ch.gone} gone · ${ch.current} active`,
      score: Math.min(100, Math.round((ch.fresh / Math.max(1, ch.baseline)) * 200)),
    });
  }

  // Low-completion at best of book (only meaningful on a fresh sweep)
  const bestBid = latest?.bestBid ?? null;
  const bestAsk = latest?.bestAsk ?? null;
  for (const m of sweepF.stale ? [] : current) {
    if (
      m.bestBuyPrice != null &&
      bestBid != null &&
      Math.abs(m.bestBuyPrice - bestBid) / bestBid < 0.0005 &&
      m.completionRate != null &&
      m.completionRate < 0.9
    ) {
      flagged.push({
        merchantId: m.merchantId,
        merchantName: m.merchantName,
        level: m.completionRate < 0.8 ? "alert" : "warn",
        reason: "Top of BID with low completion",
        metric: `${(m.completionRate * 100).toFixed(1)}% completion`,
      });
    }
    if (
      m.bestSellPrice != null &&
      bestAsk != null &&
      Math.abs(m.bestSellPrice - bestAsk) / bestAsk < 0.0005 &&
      m.completionRate != null &&
      m.completionRate < 0.9
    ) {
      flagged.push({
        merchantId: m.merchantId,
        merchantName: m.merchantName,
        level: m.completionRate < 0.8 ? "alert" : "warn",
        reason: "Top of ASK with low completion",
        metric: `${(m.completionRate * 100).toFixed(1)}% completion`,
      });
    }
  }

  // ── dollar rate vs USDT (Google 2 h move with USDT lagging; CBSL day change)
  let dollar: DollarReport | null = null;
  if (asset === "USDT" && fiat === "LKR") {
    try {
      dollar = await computeDollarReport(nowSec);
      signals.push(...dollarSignals(dollar, ex));
    } catch (err) {
      console.warn(`[risk] dollar report failed: ${(err as Error).message}`);
    }
  }

  return {
    exchange: ex,
    asset,
    fiat,
    range,
    generatedAt,
    signals: signals.sort((a, b) => (b.score ?? 0) - (a.score ?? 0)),
    flaggedMerchants: flagged,
    checks: { price, bidDepth, askDepth, churn: ch },
    freshness: {
      snapshotTs: snapF.ts,
      snapshotStale: snapF.stale,
      sweepTs: sweepF.ts,
      sweepStale: sweepF.stale,
    },
    stats: {
      latestMid: latest?.mid ?? null,
      move15m: price.move,
      typicalMove15m: price.typical,
      priceZ: price.z,
      activeMerchants: current.length,
      churned: ch?.gone ?? 0,
      fresh: ch?.fresh ?? 0,
    },
    series,
    dollar,
  };
}

const EX_LABEL: Record<ExchangeId, string> = { binance: "Binance", bybit: "Bybit" };
const rs = (v: number) => v.toFixed(2);
const hm = (ts: number) => formatSLT(ts, { timeStyle: "short", dateStyle: undefined });
const day = (d: string) => formatSLT(`${d}T12:00:00+05:30`, { dateStyle: undefined, timeStyle: undefined, day: "numeric", month: "short" });

/** Plain words for what the measured link says (never claims an unmeasured one). */
export function linkWords(l: Link, unit: "30-min moves" | "days"): string {
  const r = l.r != null ? `r ${l.r.toFixed(2)}` : "";
  const b = l.beta != null ? `, beta ${l.beta.toFixed(2)}` : "";
  switch (l.verdict) {
    case "collecting":
      return `not measured yet — collecting ${l.n} of ${l.min} ${unit}`;
    case "confirmed":
      return `measured: ${r}${b} over ${l.n} ${unit} — the data supports it`;
    case "contradicted":
      return `measured: ${r}${b} over ${l.n} ${unit} — the data goes against it`;
    case "unclear":
      return `measured: ${r || "no variation"}${b} over ${l.n} ${unit} — no clear link yet`;
  }
}

/** Risk signals from the dollar report, for one exchange. */
export function dollarSignals(d: DollarReport, ex: ExchangeId): RiskSignal[] {
  const out: RiskSignal[] = [];
  const v = d.exchanges[ex];
  const s = v.signal;
  if (s && v.lag) {
    const up = s.direction === "up";
    const l = s.lag;
    const betaText = l.betaMeasured
      ? `USDT has followed the dollar with beta ${l.beta.toFixed(2)} (r ${(v.googleLink.r ?? 0).toFixed(2)} over ${v.googleLink.n} 30-min moves, last 7 days)`
      : `Assuming USDT follows the dollar 1:1 — the hypothesis; ${linkWords(v.googleLink, "30-min moves")}`;
    out.push({
      id: `usd-google-${s.direction}`,
      level: s.level,
      direction: s.direction,
      title: up ? "USD up — USDT likely to rise" : "USD down — USDT likely to fall",
      detail:
        `Compares Google's USD/LKR with the ${EX_LABEL[ex]} USDT mid. Google ${up ? "rose" : "fell"} ${pct(s.move.pct)} in 2 h ` +
        `(${rs(s.move.from)} → ${rs(s.move.to)}, readings at ${hm(s.move.fromTs)} and ${hm(s.move.toTs)} SLT). ` +
        `${betaText}, so USDT should have moved about ${pct(l.expected)}; it has moved ${pct(l.actual)} since ${hm(s.move.fromTs)} ` +
        `(gap ${pct(l.gap)}). Fires when Google moves at least ${(USD_SIGNAL_MOVE * 100).toFixed(2)}% in 2 h and USDT has made less than half the expected move. ` +
        `An estimate from past co-movement, not advice.`,
      metric: `Google ${pct(s.move.pct)} / 2h · USDT ${pct(l.actual)} · expected ${pct(l.expected)}`,
      score: Math.min(95, 40 + Math.abs(s.move.pct) * 10_000),
    });
  }
  const c = d.cbslSignal;
  if (c) {
    const up = c.direction === "up";
    const u = v.cbslDay;
    out.push({
      id: `usd-cbsl-${c.direction}`,
      level: c.level,
      direction: c.direction,
      title: up ? "CBSL dollar rate up — watch USDT" : "CBSL dollar rate down — watch USDT",
      detail:
        `Compares CBSL's indicative USD/LKR with the ${EX_LABEL[ex]} USDT daily average. CBSL ${up ? "rose" : "fell"} ${pct(c.change.pct)} on ` +
        `${day(c.change.day)} vs ${day(c.change.prevDay)} (${rs(c.change.from)} → ${rs(c.change.to)}). ` +
        (u ? `USDT averaged ${pct(u.pct)} between the same days. ` : "") +
        `Daily link, last 90 days: ${linkWords(v.cbslLink, "days")}. ` +
        `CBSL is a slow official rate, so this is context: watch from ${(CBSL_WATCH * 100).toFixed(1)}%, warn from ${(CBSL_WARN * 100).toFixed(1)}%. An estimate, not advice.`,
      metric: `CBSL ${pct(c.change.pct)} (${c.change.abs >= 0 ? "+" : "−"}${rs(Math.abs(c.change.abs))} LKR)` + (u ? ` · USDT ${pct(u.pct)}` : ""),
      score: c.level === "warn" ? 50 : 20,
    });
  }
  return out;
}

/** Re-exported for the page copy. */
export { MOVE_WINDOW_SEC };
