"use client";

import { useMemo, useState } from "react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { usePolling } from "@/hooks/use-polling";
import { cn } from "@/lib/utils";
import {
  formatCompact,
  formatFiat,
  formatPct,
  formatRelative,
} from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { Activity, RefreshCw, ShieldCheck, Star } from "lucide-react";
import type { TierBlock, TiersResponse } from "@/lib/tiers-types";
import type { NormalizedAd, TradeType } from "@/lib/types";

type Side = TradeType;

export function TiersBoard({ initial }: { initial: TiersResponse }) {
  const url = useMemo(
    () => `/api/tiers?asset=${initial.asset}&fiat=${initial.fiat}`,
    [initial.asset, initial.fiat],
  );
  const { data, loading, error, lastUpdated, refetch } =
    usePolling<TiersResponse>(url, {
      initialData: initial,
      intervalMs: 30_000,
    });

  const [side, setSide] = useState<Side>("SELL");
  const snap = data ?? initial;
  const tiers = side === "SELL" ? snap.tiers.sell : snap.tiers.buy;
  const fiat = getFiat(snap.fiat);
  const symbol = fiat?.symbol ?? snap.fiat;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Tabs
          value={side}
          onValueChange={(v) => setSide(v as Side)}
          className="w-auto"
        >
          <TabsList className="h-9">
            <TabsTrigger
              value="SELL"
              className="data-[state=active]:text-[color:var(--color-buy)] px-4 text-xs"
            >
              I want to BUY USDT
            </TabsTrigger>
            <TabsTrigger
              value="BUY"
              className="data-[state=active]:text-[color:var(--color-sell)] px-4 text-xs"
            >
              I want to SELL USDT
            </TabsTrigger>
          </TabsList>
        </Tabs>

        <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
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
              : `Updated ${
                  lastUpdated ? formatRelative(new Date(lastUpdated)) : "now"
                }`}
          </span>
          <button
            type="button"
            onClick={() => refetch()}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-card/50 px-2 py-0.5 font-mono text-[10px] hover:border-primary/40 hover:text-foreground"
          >
            <RefreshCw
              className={cn("h-3 w-3", loading && "animate-spin")}
              strokeWidth={2}
            />
            Refresh
          </button>
        </div>
      </div>

      {/* Best-rate-per-tier strip across the top — quick scan. */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {tiers.map((t) => (
          <TierSummary key={t.amount} block={t} symbol={symbol} side={side} />
        ))}
      </div>

      {/* Per-tier expanded leaderboards (top 5 each). */}
      <div className="space-y-4">
        {tiers.map((t) => (
          <TierTable key={t.amount} block={t} symbol={symbol} side={side} />
        ))}
      </div>
    </div>
  );
}

function TierSummary({
  block,
  symbol,
  side,
}: {
  block: TierBlock;
  symbol: string;
  side: Side;
}) {
  const priceColor =
    side === "BUY"
      ? "text-[color:var(--color-sell)]"
      : "text-[color:var(--color-buy)]";

  return (
    <div className="rounded-lg border border-border bg-card/60 p-3">
      <div className="flex items-center justify-between">
        <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          ${block.amount}
        </div>
        <Badge
          variant="outline"
          className="h-4 border-dashed bg-transparent px-1.5 text-[9px] font-medium tracking-wide text-muted-foreground/80"
        >
          {block.totalCount} ads
        </Badge>
      </div>
      <div className={cn("mt-1.5 font-mono text-lg font-semibold tabular-nums", priceColor)}>
        {block.bestPrice != null ? formatFiat(block.bestPrice, symbol, 4) : "—"}
      </div>
      <div className="mt-0.5 font-mono text-[10px] tabular-nums text-muted-foreground/70">
        median {block.medianPrice != null ? formatFiat(block.medianPrice, symbol, 4) : "—"}
      </div>
    </div>
  );
}

function TierTable({
  block,
  symbol,
  side,
}: {
  block: TierBlock;
  symbol: string;
  side: Side;
}) {
  return (
    <div className="rounded-lg border border-border bg-card/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex items-baseline gap-2">
          <div className="text-sm font-semibold text-foreground">
            ${block.amount} ticket
          </div>
          <div className="text-[11px] text-muted-foreground/80">
            {block.totalCount === 0
              ? "no ads accepting this size"
              : `top ${block.ads.length} of ${block.totalCount}`}
          </div>
        </div>
        <Badge
          variant="secondary"
          className={cn(
            "h-5 px-2 text-[10px] uppercase tracking-wide",
            side === "BUY"
              ? "text-[color:var(--color-sell)]"
              : "text-[color:var(--color-buy)]",
          )}
        >
          {side === "BUY" ? "publishers BUY USDT" : "publishers SELL USDT"}
        </Badge>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[180px]">Merchant</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Limits</TableHead>
              <TableHead className="text-right">30-day vol</TableHead>
              <TableHead className="text-right">Completion</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {block.ads.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-8 text-center text-sm text-muted-foreground"
                >
                  No advertisers accept ${block.amount} on this side right now
                </TableCell>
              </TableRow>
            )}
            {block.ads.map((ad, i) => (
              <AdRow
                key={ad.id}
                ad={ad}
                side={side}
                symbol={symbol}
                isBest={i === 0}
              />
            ))}
          </TableBody>
        </Table>
      </div>
    </div>
  );
}

function AdRow({
  ad,
  side,
  symbol,
  isBest,
}: {
  ad: NormalizedAd;
  side: Side;
  symbol: string;
  isBest: boolean;
}) {
  const priceColor =
    side === "BUY"
      ? "text-[color:var(--color-sell)]"
      : "text-[color:var(--color-buy)]";

  return (
    <TableRow
      className={cn(
        "border-border transition-colors hover:bg-accent/40",
        isBest && "bg-primary/[0.03]",
      )}
    >
      <TableCell className="py-3">
        <div className="flex items-center gap-2 min-w-0">
          <div
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 font-mono text-[10px] font-medium text-muted-foreground"
            aria-hidden
          >
            {(ad.merchant.name || "?")
              .split(/[\s_\-]+/)
              .map((w) => w[0])
              .slice(0, 2)
              .join("")
              .toUpperCase()}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <span className="truncate text-sm font-medium text-foreground">
                {ad.merchant.name}
              </span>
              {ad.merchant.isMerchant && (
                <ShieldCheck
                  className="h-3 w-3 shrink-0 text-primary"
                  strokeWidth={2}
                  aria-label="Verified merchant"
                />
              )}
            </div>
            <div className="mt-0.5 flex items-center gap-1 text-[10px] text-muted-foreground/80">
              {ad.payMethods.slice(0, 2).map((pm) => (
                <Badge
                  key={pm.id}
                  variant="secondary"
                  className="bg-secondary/70 text-[9px] font-medium text-foreground/80"
                >
                  {pm.short ?? pm.name}
                </Badge>
              ))}
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell className="py-3 text-right">
        <div className={cn("flex items-center justify-end gap-1 font-mono text-sm font-semibold tabular-nums", priceColor)}>
          {isBest && <Star className="h-3 w-3 text-primary" strokeWidth={2} />}
          {formatFiat(ad.price, symbol, 4)}
        </div>
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-sm tabular-nums text-foreground">
        {formatCompact(ad.available)}
      </TableCell>

      <TableCell className="py-3 text-right">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatCompact(ad.minOrder)}
          <span className="mx-1 text-muted-foreground/50">–</span>
          {formatCompact(ad.maxOrder)}
        </div>
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatCompact(ad.merchant.orders30d)}
      </TableCell>

      <TableCell className="py-3 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
        {formatPct(ad.merchant.completionRate, { frac: 1 })}
      </TableCell>
    </TableRow>
  );
}
