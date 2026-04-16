"use client";

import { useMemo, useState } from "react";
import type { MarketSnapshot } from "@/lib/types";
import { usePolling } from "@/hooks/use-polling";
import { ArbitrageTable } from "./arbitrage-table";
import { Reveal } from "@/components/common/reveal";
import { Stat } from "@/components/common/stat";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { formatPct, formatRelative } from "@/lib/format";
import { Activity, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { withinMarketArbitrage } from "@/lib/analytics";

type ArbitrageResponse = {
  snapshots: MarketSnapshot[];
  fetchedAt: string;
};

export function ArbitragePanel({
  initial,
  asset,
  fiats,
}: {
  initial: ArbitrageResponse;
  asset: string;
  fiats: string[];
}) {
  const [feePct, setFeePct] = useState(0.5); // %
  const [slipPct, setSlipPct] = useState(0.2); // %

  const url = useMemo(
    () => `/api/p2p/markets?asset=${asset}&fiats=${fiats.join(",")}`,
    [asset, fiats],
  );

  const { data, loading, lastUpdated, refetch, error } = usePolling<
    ArbitrageResponse
  >(url, { initialData: initial, intervalMs: 30_000 });

  const snapshots = data?.snapshots ?? initial.snapshots;

  const rows = useMemo(
    () => withinMarketArbitrage(snapshots, feePct / 100, slipPct / 100),
    [snapshots, feePct, slipPct],
  );

  const topNet = rows[0]?.netPct ?? null;
  const positive = rows.filter((r) => r.netPct > 0).length;
  const avgSpread =
    rows.length > 0
      ? rows.reduce((s, r) => s + r.grossPct, 0) / rows.length
      : null;

  return (
    <div className="space-y-5">
      <Reveal>
        <Card className="border-border bg-card/60">
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4">
            <Stat
              label="Best net spread"
              value={topNet != null ? formatPct(topNet, { frac: 2, sign: true }) : "—"}
              delta={
                topNet != null ? { value: topNet, format: "pct" } : undefined
              }
              footnote={rows[0] ? `${asset}/${rows[0].buyFiat}` : undefined}
            />
            <Stat
              label="Positive opportunities"
              value={`${positive} / ${rows.length}`}
              footnote="After fees and slippage"
            />
            <Stat
              label="Average gross"
              value={
                avgSpread != null ? formatPct(avgSpread, { frac: 2 }) : "—"
              }
              footnote="Across scanned markets"
            />
            <Stat
              label="Markets scanned"
              value={snapshots.length.toString()}
              footnote={`${asset} · ${fiats.length} fiats`}
            />
          </CardContent>
        </Card>
      </Reveal>

      <Reveal delay={80}>
        <div className="flex flex-wrap items-center gap-4 rounded-lg border border-border bg-card/60 p-4">
          <div className="flex items-center gap-3">
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Fee assumption
              </Label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={feePct}
                  onChange={(e) => setFeePct(parseFloat(e.target.value))}
                  className="h-1 w-32 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
                <span className="font-mono text-[11px] tabular-nums text-foreground w-12 text-right">
                  {feePct.toFixed(2)}%
                </span>
              </div>
            </div>
            <div className="flex flex-col gap-1.5">
              <Label className="text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                Slippage
              </Label>
              <div className="flex items-center gap-2">
                <input
                  type="range"
                  min={0}
                  max={2}
                  step={0.05}
                  value={slipPct}
                  onChange={(e) => setSlipPct(parseFloat(e.target.value))}
                  className="h-1 w-32 cursor-pointer appearance-none rounded-full bg-muted accent-primary"
                />
                <span className="font-mono text-[11px] tabular-nums text-foreground w-12 text-right">
                  {slipPct.toFixed(2)}%
                </span>
              </div>
            </div>
          </div>
          <p className="flex-1 text-[11px] leading-relaxed text-muted-foreground">
            Net spread = gross − fee − slippage. A round-trip buys asset on the
            SELL side and sells back on the BUY side within the same fiat.
            Positive values suggest genuine dislocation; negative values are
            the market-maker spread you&apos;d pay.
          </p>
        </div>
      </Reveal>

      <Reveal delay={120}>
        <ArbitrageTable
          snapshots={snapshots}
          feePct={feePct / 100}
          slipPct={slipPct / 100}
        />
      </Reveal>

      <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
        <div className="flex items-center gap-1.5">
          <Activity
            className={cn(
              "h-3 w-3",
              loading ? "animate-spin text-primary" : "text-primary/70",
            )}
            strokeWidth={2}
          />
          <span>
            {error
              ? `Feed offline — ${error.message}`
              : `Scanning every 30s · updated ${
                  lastUpdated ? formatRelative(new Date(lastUpdated)) : "now"
                }`}
          </span>
        </div>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-2.5 py-1 font-mono text-[11px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <RefreshCw
            className={cn("h-3 w-3", loading && "animate-spin")}
            strokeWidth={2}
          />
          Refresh
        </button>
      </div>
    </div>
  );
}
