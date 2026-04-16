"use client";

import { useMemo } from "react";
import type { MarketSnapshot } from "@/lib/types";
import { usePolling } from "@/hooks/use-polling";
import { MerchantTable } from "./merchant-table";
import { Stat } from "@/components/common/stat";
import { Reveal } from "@/components/common/reveal";
import { Card, CardContent } from "@/components/ui/card";
import { formatCompact, formatPct, formatRelative } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { summarizeMerchants } from "@/lib/analytics";
import { Activity, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/components/market/filter-bar";

export function MerchantPanel({
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
      rows: "20",
    });
    if (filters.payType) p.set("payTypes", filters.payType);
    if (filters.merchantType === "merchant") p.set("publisher", "merchant");
    return `/api/p2p/market?${p.toString()}`;
  }, [filters]);

  const { data, loading, lastUpdated, refetch, error } = usePolling<
    MarketSnapshot
  >(url, { initialData: initial, intervalMs: 30_000 });

  const market = data ?? initial;
  const fiat = getFiat(market.fiat);
  const symbol = fiat?.symbol ?? market.fiat;

  const marketMedian =
    market.sell.medianPrice ?? market.buy.medianPrice ?? null;

  const merchants = useMemo(
    () => summarizeMerchants(market.ads, marketMedian),
    [market.ads, marketMedian],
  );

  const verifiedCount = merchants.filter((m) => m.isMerchant).length;
  const avgCompletion =
    merchants.length > 0
      ? merchants.reduce((s, m) => s + m.completionRate, 0) / merchants.length
      : 0;
  const totalDepthFiat = merchants.reduce(
    (s, m) => s + m.totalAvailableFiat,
    0,
  );
  const avgTrust =
    merchants.length > 0
      ? merchants.reduce((s, m) => s + m.trustScore, 0) / merchants.length
      : 0;

  return (
    <div className="space-y-5">
      <Reveal>
        <Card className="border-border bg-card/60">
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4">
            <Stat
              label="Unique merchants"
              value={merchants.length.toString()}
              footnote={`${verifiedCount} verified`}
            />
            <Stat
              label="Average trust"
              value={Math.round(avgTrust).toString()}
              footnote="0–100 composite score"
            />
            <Stat
              label="Completion (avg)"
              value={formatPct(avgCompletion, { frac: 1 })}
              footnote="30d order completion"
            />
            <Stat
              label="Market depth"
              value={`${symbol} ${formatCompact(totalDepthFiat)}`}
              footnote={`${market.asset} tradable`}
            />
          </CardContent>
        </Card>
      </Reveal>

      <Reveal delay={80}>
        <MerchantTable
          merchants={merchants}
          symbol={symbol}
          asset={market.asset}
          fiat={market.fiat}
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
              : `Refreshed every 30s · updated ${
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
