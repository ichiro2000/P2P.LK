import { pageMetadata } from "@/lib/seo";
import { Clock } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { Empty } from "@/components/common/empty";
import { KpiCard } from "@/components/common/kpi-card";
import { KpiGrid, PageBody, PageHeader, PageSection } from "@/components/common/page";
import { RangeTabs } from "@/components/historical/range-tabs";
import { SignalCard, type SignalLevel } from "@/components/risk/signal-card";
import { MerchantFlags } from "@/components/risk/merchant-flags";
import { getExchange } from "@/lib/exchanges";
import { getActiveExchange } from "@/lib/exchange-server";
import { computeRiskReport, type RiskReport, type RiskSignal } from "@/lib/risk";
import { listTrackedMarkets, parseRange } from "@/lib/db/queries";
import { gateRange } from "@/lib/member-gate";
import { CBSL_SIGNAL, CHURN_WARN, DEPTH_WARN, MOVE_WARN, USD_SIGNAL } from "@/lib/risk-signals";
import { DollarSection } from "@/components/risk/dollar-section";
import { AsOf } from "@/components/common/as-of";
import { ASSET, FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatPct, formatSLT } from "@/lib/format";

export const metadata = pageMetadata({
  title: "P2P Risk Signals: USDT/LKR Price Moves & Churn",
  description: "Live risk signals for Sri Lanka’s USDT/LKR P2P market on Binance and Bybit: sudden price moves, near-price liquidity drops, merchant churn, low-completion ads.",
  path: "/risk",
});
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

type Monitor = {
  id: string;
  level: SignalLevel;
  title: string;
  detail: string;
  metric?: string;
  spark?: (number | null)[];
  sparkLabel?: string;
  direction?: "up" | "down";
};

/**
 * Every metric the risk engine watches, as a card. A metric that fired a
 * signal shows the signal (level, title, explanation); otherwise it shows
 * its normal reading and, in plain words, what it is compared with.
 * Unknown signal ids are appended as-is.
 */
function buildMonitors(r: RiskReport): Monitor[] {
  const sig = new Map(r.signals.map((s) => [s.id, s]));
  const s = r.series;
  const c = r.checks;
  const nums = (xs?: (number | null)[]) => (xs ?? []).filter((v): v is number => v != null);
  const last = (xs?: (number | null)[]) => {
    const v = nums(xs);
    return v.length ? v[v.length - 1] : null;
  };
  const fromSignal = (x: RiskSignal, fallback: Partial<Monitor>): Monitor => ({
    ...fallback,
    id: x.id,
    level: x.level,
    title: x.title,
    detail: x.detail,
    metric: x.metric,
    spark: x.spark ?? fallback.spark,
    direction: x.direction,
  });
  const paused = r.freshness.snapshotStale ? " Paused: the market data is stale." : "";

  const depth = (side: "bid" | "ask"): Monitor => {
    const id = `${side}-depth-drop`;
    const d = side === "bid" ? c.bidDepth : c.askDepth;
    const name = side === "bid" ? "Buy-ad" : "Sell-ad";
    const what =
      d.basis === "near-touch"
        ? `${name} depth within 1% of the best price${side === "bid" ? " (declared budgets, not escrowed)" : " (escrowed USDT)"}`
        : `${name} top-20 depth (near-touch history still building)`;
    const base: Monitor = {
      id,
      level: "ok",
      title: `${name} depth`,
      detail: `${what}. Compares the median of the last 15 minutes with the 24 h median; warns below ${Math.round(DEPTH_WARN * 100)}%.${paused}`,
      spark: side === "bid" ? s?.bidDepth : s?.askDepth,
      sparkLabel: `${name} depth over ${r.range}`,
    };
    if (d.now != null && d.baseline != null && d.ratio != null)
      base.metric = `${formatCompact(d.now)} ${r.asset} · ${Math.round(d.ratio * 100)}% of 24h median`;
    else base.metric = "needs about an hour of data";
    const hit = sig.get(id);
    return hit ? fromSignal(hit, base) : base;
  };

  const p = c.price;
  const priceBase: Monitor = {
    id: "price-spike",
    level: "ok",
    title: "Price moves",
    detail:
      `Latest 15-minute change of the mid, compared with every 15-minute change in the last 24 h` +
      (p.typical != null ? ` (typical ±${(p.typical * 100).toFixed(2)}%)` : "") +
      `. Fires only when it is ${MOVE_WARN.z}× unusual and at least ${(MOVE_WARN.abs * 100).toFixed(2)}%.${paused}`,
    metric:
      p.move != null
        ? `${formatPct(p.move, { frac: 2, sign: true })} in 15 min${p.z != null ? ` · z ${p.z.toFixed(1)}` : ""}`
        : "needs about an hour of data",
    spark: s?.mid,
    sparkLabel: `Mid price over ${r.range}`,
  };
  const spreadNow = last(s?.spreadPct);
  const ch = c.churn;
  const churnBase: Monitor = {
    id: "merchant-churn",
    level: "ok",
    title: "Merchant churn",
    detail: ch
      ? `Advertisers in the latest sweep that were never seen before the sweep at ${formatSLT(ch.baselineTs, { timeStyle: "short", dateStyle: undefined })} SLT (${ch.baseline} listing then). Warns at ${Math.round(CHURN_WARN.share * 100)}% new.`
      : "Needs a sweep from about an hour ago to compare with.",
    metric: ch ? `${ch.fresh} new · ${ch.gone} gone · ${ch.current} active` : `${r.stats.activeMerchants} active`,
  };

  const d = r.dollar;
  const g2 = d?.googleChanges["2h"] ?? null;
  const lag = d?.exchanges[r.exchange].lag ?? null;
  const usdBase: Monitor = {
    id: "usd-google",
    level: "ok",
    title: "Dollar (Google) vs USDT",
    detail:
      `Google USD/LKR over 2 h vs the USDT mid. Fires when Google moves at least ${(USD_SIGNAL.move * 100).toFixed(2)}% and USDT has made less than half the expected move (beta × Google move). ` +
      `Paused when the Google reading is over 75 minutes old. An estimate, not advice.`,
    metric: !d
      ? "dollar data unavailable"
      : d.google.stale
        ? `paused · Google reading ${d.google.latest ? `from ${formatSLT(d.google.latest.ts, { timeStyle: "short", dateStyle: undefined })} SLT` : "missing"}`
        : g2
          ? `Google ${formatPct(g2.pct, { frac: 2, sign: true })} / 2h` + (lag ? ` · USDT ${formatPct(lag.actual, { frac: 2, sign: true })}` : "")
          : "needs two Google readings 2 h apart",
  };
  const cb = d?.cbsl.change ?? null;
  const cbslBase: Monitor = {
    id: "usd-cbsl",
    level: "ok",
    title: "CBSL dollar rate",
    detail: `CBSL's indicative USD/LKR vs the previous business day. A slow official rate, shown as context: watch from ${(CBSL_SIGNAL.watch * 100).toFixed(1)}%, warn from ${(CBSL_SIGNAL.warn * 100).toFixed(1)}%.`,
    metric: cb
      ? `${formatPct(cb.pct, { frac: 2, sign: true })} on ${formatSLT(`${cb.day}T12:00:00+05:30`, { dateStyle: undefined, timeStyle: undefined, day: "numeric", month: "short" })}${d?.cbsl.stale ? " (old)" : ""}`
      : "no CBSL data yet",
  };
  const usdHit = sig.get("usd-google-up") ?? sig.get("usd-google-down");
  const cbslHit = sig.get("usd-cbsl-up") ?? sig.get("usd-cbsl-down");

  const monitors: Monitor[] = [
    sig.get("price-spike") ? fromSignal(sig.get("price-spike")!, priceBase) : priceBase,
    depth("ask"),
    depth("bid"),
    {
      id: "spread",
      level: "info",
      title: "Spread",
      detail: "Gap between best Sell and Buy ads, as % of mid. Watched for context; it doesn't raise signals.",
      metric: spreadNow != null ? `${formatPct(spreadNow, { frac: 2 })} now` : undefined,
      spark: s?.spreadPct,
      sparkLabel: `Spread over ${r.range}`,
    },
    sig.get("merchant-churn") ? fromSignal(sig.get("merchant-churn")!, churnBase) : churnBase,
    usdHit ? fromSignal(usdHit, usdBase) : usdBase,
    cbslHit ? fromSignal(cbslHit, cbslBase) : cbslBase,
  ];
  const known = new Set(monitors.map((m) => m.id));
  for (const x of r.signals) if (!known.has(x.id)) monitors.push(fromSignal(x, {}));
  const rank = { alert: 0, warn: 1, info: 3, ok: 2 } as const;
  return monitors.sort((a, b) => rank[a.level] - rank[b.level]);
}

export default async function RiskPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);
  const { range, member } = await gateRange(parseRange(sp.range), "24h");

  const tracked = await listTrackedMarkets(ex, "30d");
  const hasData = tracked.some((t) => t.asset === ASSET && t.fiat === FIAT.code);
  const report = hasData ? await computeRiskReport(ex, ASSET, FIAT.code, range) : null;
  const symbol = FIAT.symbol;

  const alerts = report?.signals.filter((s) => s.level === "alert").length ?? 0;
  const warns = report?.signals.filter((s) => s.level === "warn").length ?? 0;

  return (
    <>
      <Topbar title="Risk" subtitle={`${ASSET} / ${FIAT.code} · ${adapter.label}`}>
        <MarketStar asset={ASSET} fiat={FIAT.code} />
        <LiveDot label="Monitoring" className="hidden sm:inline-flex" />
      </Topbar>

      <PageBody>
        <PageHeader
          eyebrow={`${adapter.label} · anomaly detection`}
          title={`Risk signals for ${ASSET}/${FIAT.code}`}
          description="Sudden price moves, near-price liquidity drops, merchant churn and low-completion merchants at the top of the book. Checks use fixed look-backs (15 minutes vs the last 24 hours); the range only changes the charts."
          actions={<RangeTabs value={range} member={member} />}
        />

        {!report ? (
          <Empty
            icon={Clock}
            title="No history for this market yet"
            description="Risk checks need a few stored snapshots. They appear within minutes of the collector's first run."
          />
        ) : (
          <>
            <KpiGrid>
              <KpiCard
                label="Latest mid"
                value={report.stats.latestMid != null ? formatFiat(report.stats.latestMid, symbol, 2) : "—"}
                sub={<AsOf ts={report.freshness.snapshotTs} stale={report.freshness.snapshotStale} />}
                spark={report.series?.mid}
              />
              <KpiCard
                label="15-min move"
                value={report.stats.move15m != null ? formatPct(report.stats.move15m, { frac: 2, sign: true }) : "—"}
                sub={
                  report.stats.priceZ != null
                    ? `z ${report.stats.priceZ.toFixed(1)} vs 24h of 15-min moves`
                    : "needs about an hour of data"
                }
                tone={report.checks.price.level !== "ok" ? "sell" : undefined}
              />
              <KpiCard
                label="Active merchants"
                value={String(report.stats.activeMerchants)}
                sub={
                  report.checks.churn
                    ? `${report.stats.fresh} new · ${report.stats.churned} gone in 1h`
                    : <AsOf ts={report.freshness.sweepTs} stale={report.freshness.sweepStale} prefix="sweep" />
                }
              />
              <KpiCard
                label="Open signals"
                value={String(report.signals.length)}
                sub={report.signals.length === 0 ? "market looks orderly" : `${alerts} alert · ${warns} warn`}
                tone={alerts > 0 ? "sell" : undefined}
              />
            </KpiGrid>

            <PageSection
              title="Signals"
              description={
                report.signals.length === 0
                  ? `Nothing unusual in the ${range} window. Every watched metric is shown below.`
                  : `${report.signals.length} signal${report.signals.length === 1 ? "" : "s"} firing, listed first.`
              }
            >
              <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
                {buildMonitors(report).map((m) => (
                  <SignalCard key={m.id} signal={m} sparkLabel={m.sparkLabel} />
                ))}
              </div>
            </PageSection>

            {report.dollar && (
              <PageSection
                id="dollar"
                title="Dollar rate vs USDT"
                description="Google USD/LKR (every 30 minutes) and CBSL's indicative rate (business days) against the USDT mid."
              >
                <DollarSection report={report.dollar} exchange={report.exchange} />
              </PageSection>
            )}

            <MerchantFlags flags={report.flaggedMerchants} />

            <p className="text-[11px] text-muted-foreground">
              Generated {formatSLT(report.generatedAt, { timeStyle: "short", dateStyle: undefined })} SLT · market data{" "}
              <AsOf ts={report.freshness.snapshotTs} stale={report.freshness.snapshotStale} /> · merchant sweep{" "}
              <AsOf ts={report.freshness.sweepTs} stale={report.freshness.sweepStale} /> · charts {range}
            </p>
          </>
        )}
      </PageBody>
    </>
  );
}
