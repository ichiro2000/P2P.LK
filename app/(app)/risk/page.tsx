import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { Reveal } from "@/components/common/reveal";
import { Card, CardContent } from "@/components/ui/card";
import { Stat } from "@/components/common/stat";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { SignalCard } from "@/components/risk/signal-card";
import { MerchantFlags } from "@/components/risk/merchant-flags";
import { Empty } from "@/components/common/empty";
import { computeRiskReport } from "@/lib/risk";
import { listTrackedMarkets, RANGES, type RangeKey } from "@/lib/db/queries";
import { ASSET, FIAT } from "@/lib/constants";
import { formatFiat, formatSLT } from "@/lib/format";
import { ShieldCheck, Clock } from "lucide-react";

export const metadata = { title: "Risk" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): FilterState {
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "all") === "merchant" ? "merchant" : "all",
  };
}

export default async function RiskPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const rangeKey = String(sp.range ?? "24h") as RangeKey;
  const range: RangeKey = rangeKey in RANGES ? rangeKey : "24h";

  const tracked = await listTrackedMarkets("30d");
  const hasData = tracked.some(
    (t) => t.asset === filters.asset && t.fiat === filters.fiat,
  );

  const report = hasData
    ? await computeRiskReport(filters.asset, filters.fiat, range)
    : null;

  const symbol = FIAT.symbol;
  const subtitle = `${ASSET} / ${FIAT.code} · ${FIAT.name}`;

  return (
    <>
      <Topbar title="Risk" subtitle={subtitle}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} />
        <LiveDot label="Monitoring" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Anomaly detection"
          title={`Risk signals for ${filters.asset}/${filters.fiat}`}
          description="Statistical anomalies surfaced from the ingest time-series: sudden price moves, liquidity drops, merchant churn and low-completion counterparties at top of book."
        />

        <FilterBar initial={filters} />

        {!report ? (
          <Empty
            icon={Clock}
            title="No history for this market yet"
            description={
              tracked.length === 0
                ? "The ingest worker hasn't run. Start it with `npm run ingest:loop` locally, or deploy and let Vercel Cron tick every 5 minutes."
                : "Risk detection needs at least a few snapshots of this market. Switch to a tracked market or wait for the next tick."
            }
          />
        ) : (
          <>
            <Reveal>
              <Card className="border-border bg-card/60">
                <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4">
                  <Stat
                    label="Latest mid"
                    value={
                      report.stats.latestMid != null
                        ? formatFiat(report.stats.latestMid, symbol, 2)
                        : "—"
                    }
                    footnote={
                      report.stats.ma20 != null
                        ? `MA20 ${formatFiat(report.stats.ma20, symbol, 2)}`
                        : undefined
                    }
                  />
                  <Stat
                    label="Price z-score"
                    value={
                      report.stats.priceZ != null
                        ? report.stats.priceZ.toFixed(2) + "σ"
                        : "—"
                    }
                    footnote={
                      report.stats.priceZ != null &&
                      Math.abs(report.stats.priceZ) > 2
                        ? `Outside 2σ · vs ${range} distribution`
                        : `vs ${range} distribution`
                    }
                  />
                  <Stat
                    label="Active merchants"
                    value={report.stats.activeMerchants.toString()}
                    footnote={`${report.stats.fresh} fresh · ${report.stats.churned} churned`}
                  />
                  <Stat
                    label="Open signals"
                    value={report.signals.length.toString()}
                    footnote={
                      report.signals.length === 0
                        ? "Market looks orderly"
                        : `${report.signals.filter((s) => s.level === "alert").length} alert · ${report.signals.filter((s) => s.level === "warn").length} warn`
                    }
                  />
                </CardContent>
              </Card>
            </Reveal>

            <Reveal delay={70}>
              {report.signals.length === 0 ? (
                <Card className="border-border bg-card/60">
                  <CardContent className="flex items-center gap-3 p-5">
                    <div className="flex h-8 w-8 items-center justify-center rounded-md bg-[color:var(--color-buy-muted)] text-[color:var(--color-buy)]">
                      <ShieldCheck className="h-4 w-4" strokeWidth={1.75} />
                    </div>
                    <div>
                      <div className="text-sm font-medium text-foreground">
                        No anomalies detected
                      </div>
                      <div className="mt-0.5 text-[12px] text-muted-foreground">
                        Price, depth and merchant activity all sit within
                        their normal {range} distribution.
                      </div>
                    </div>
                  </CardContent>
                </Card>
              ) : (
                <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                  {report.signals.map((s) => (
                    <SignalCard key={s.id} signal={s} />
                  ))}
                </div>
              )}
            </Reveal>

            <Reveal delay={110}>
              <MerchantFlags flags={report.flaggedMerchants} />
            </Reveal>

            <div className="pt-1 text-[11px] text-muted-foreground">
              Generated {formatSLT(report.generatedAt, { timeStyle: "short", dateStyle: undefined })} SLT{" "}
              · window {range}
            </div>
          </>
        )}
      </div>
    </>
  );
}
