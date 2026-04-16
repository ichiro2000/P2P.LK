"use client";

import { useMemo } from "react";
import type { MarketSnapshot } from "@/lib/types";
import { usePolling } from "@/hooks/use-polling";
import { PricePanel } from "./price-panel";
import { SpreadWidget } from "./spread-widget";
import { DepthSnapshot } from "./depth-snapshot";
import { AdsTable } from "./ads-table";
import { Reveal } from "@/components/common/reveal";
import { formatRelative } from "@/lib/format";
import { Activity, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import { LiquidityStrip } from "./liquidity-strip";
import type { FilterState } from "./filter-bar";

export function LiveMarket({
  initial,
  filters,
}: {
  initial: MarketSnapshot;
  filters: FilterState;
}) {
  const url = useMemo(() => {
    const p = new URLSearchParams({
      asset: filters.asset,
      fiat: filters.fiat,
    });
    if (filters.payType) p.set("payTypes", filters.payType);
    if (filters.merchantType === "merchant") p.set("publisher", "merchant");
    return `/api/p2p/market?${p.toString()}`;
  }, [filters]);

  const { data, loading, error, lastUpdated, refetch } = usePolling<
    MarketSnapshot
  >(url, { initialData: initial, intervalMs: 20_000 });

  const market = data ?? initial;

  return (
    <div className="space-y-5">
      {/* top price tile + spread + depth */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <Reveal className="lg:col-span-2">
          <PricePanel market={market} />
        </Reveal>
        <Reveal delay={70} className="flex flex-col gap-4">
          <SpreadWidget market={market} />
          <LiquidityStrip market={market} />
        </Reveal>
      </div>

      {/* depth + ads */}
      <Reveal delay={100}>
        <DepthSnapshot market={market} />
      </Reveal>

      <Reveal delay={140}>
        <AdsTable market={market} />
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
              ? `Live feed offline — ${error.message}`
              : `Live feed · updated ${
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
