"use client";

import { useMemo, useState } from "react";
import type { MarketSnapshot } from "@/lib/types";
import { usePolling } from "@/hooks/use-polling";
import { MerchantTable } from "./merchant-table";
import { Stat } from "@/components/common/stat";
import { Reveal } from "@/components/common/reveal";
import { Card, CardContent } from "@/components/ui/card";
import { Switch } from "@/components/ui/switch";
import { formatCompact, formatPct, formatRelative } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import type { MerchantRow } from "@/lib/analytics";
import { Activity, RefreshCw } from "lucide-react";
import { cn } from "@/lib/utils";
import type { FilterState } from "@/components/market/filter-bar";

type DirectoryResponse = {
  asset: string;
  fiat: string;
  fetchedAt: string;
  marketMedian: number | null;
  liveCount: number;
  knownCount: number;
  merchants: MerchantRow[];
};

export function MerchantPanel({
  initial,
  initialDirectory,
  filters,
}: {
  initial: MarketSnapshot;
  initialDirectory: MerchantRow[];
  filters: FilterState;
}) {
  const [activeOnly, setActiveOnly] = useState(false);

  const url = useMemo(() => {
    const p = new URLSearchParams({
      asset: filters.asset,
      fiat: filters.fiat,
    });
    if (filters.payType) p.set("payTypes", filters.payType);
    if (filters.merchantType === "merchant") p.set("publisher", "merchant");
    return `/api/merchants?${p.toString()}`;
  }, [filters]);

  const initialData = useMemo<DirectoryResponse>(
    () => ({
      asset: initial.asset,
      fiat: initial.fiat,
      fetchedAt: initial.fetchedAt,
      marketMedian:
        initial.sell.medianPrice ?? initial.buy.medianPrice ?? null,
      liveCount: initialDirectory.filter((m) => m.isActive).length,
      knownCount: initialDirectory.length,
      merchants: initialDirectory,
    }),
    [initial, initialDirectory],
  );

  const { data, loading, lastUpdated, refetch, error } =
    usePolling<DirectoryResponse>(url, {
      initialData,
      intervalMs: 30_000,
    });

  const directory = data?.merchants ?? initialDirectory;
  const fiat = getFiat(initial.fiat);
  const symbol = fiat?.symbol ?? initial.fiat;

  const filtered = useMemo(
    () => (activeOnly ? directory.filter((m) => m.isActive) : directory),
    [directory, activeOnly],
  );

  const activeCount = directory.filter((m) => m.isActive).length;
  const verifiedCount = filtered.filter((m) => m.isMerchant).length;
  const avgCompletion =
    filtered.length > 0
      ? filtered.reduce((s, m) => s + m.completionRate, 0) / filtered.length
      : 0;
  // Depth is a live metric — only active merchants contribute a real
  // tradable book. Summing inactive merchants' last-known depth would
  // massively inflate the number (historical stale data).
  const totalDepthFiat = directory
    .filter((m) => m.isActive)
    .reduce((s, m) => s + m.totalAvailableFiat, 0);
  const avgTrust =
    filtered.length > 0
      ? filtered.reduce((s, m) => s + m.trustScore, 0) / filtered.length
      : 0;

  return (
    <div className="space-y-5">
      <Reveal>
        <Card className="border-border bg-card/60">
          <CardContent className="grid grid-cols-2 gap-x-6 gap-y-5 p-5 md:grid-cols-4">
            <Stat
              label={activeOnly ? "Active merchants" : "Merchants tracked"}
              value={filtered.length.toString()}
              footnote={
                activeOnly
                  ? `${verifiedCount} verified`
                  : `${activeCount} active now · ${verifiedCount} verified`
              }
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
              label="Live market depth"
              value={`${symbol} ${formatCompact(totalDepthFiat)}`}
              footnote={`Across ${activeCount} active merchants`}
            />
          </CardContent>
        </Card>
      </Reveal>

      <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-card/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <Switch
            checked={activeOnly}
            onCheckedChange={(next) => setActiveOnly(Boolean(next))}
            aria-label="Filter active merchants"
          />
          <div className="flex flex-col">
            <span className="text-sm font-medium text-foreground">
              Active Now
            </span>
            <span className="text-[11px] text-muted-foreground">
              {activeOnly
                ? `Showing ${filtered.length} merchants currently listing ads`
                : `Showing all ${directory.length} merchants ever seen on this market`}
            </span>
          </div>
        </div>
        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-[color:var(--color-buy)]" />
            {activeCount} active
          </span>
          <span className="text-muted-foreground/40">·</span>
          <span className="inline-flex items-center gap-1">
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
            {Math.max(0, directory.length - activeCount)} offline
          </span>
        </div>
      </div>

      <Reveal delay={80}>
        <MerchantTable
          merchants={filtered}
          symbol={symbol}
          asset={initial.asset}
          fiat={initial.fiat}
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
