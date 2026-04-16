"use client";

import { useState } from "react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { MarketSnapshot, NormalizedAd } from "@/lib/types";
import {
  formatCompact,
  formatDuration,
  formatFiat,
  formatPct,
} from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ShieldCheck, Star } from "lucide-react";

type Side = "BUY" | "SELL";

export function AdsTable({ market }: { market: MarketSnapshot }) {
  const [side, setSide] = useState<Side>("SELL"); // Sell ads = prices buyers see
  const fiat = getFiat(market.fiat);
  const symbol = fiat?.symbol ?? market.fiat;

  const ads = market.ads
    .filter((a) => a.tradeType === side)
    .sort((a, b) =>
      side === "BUY" ? b.price - a.price : a.price - b.price,
    )
    .slice(0, 12);

  return (
    <div className="rounded-lg border border-border bg-card/60">
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <div className="flex flex-col">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Live ads
          </div>
          <div className="mt-0.5 text-[11px] text-muted-foreground/70">
            Top {ads.length} of {market.ads.filter((a) => a.tradeType === side).length}
          </div>
        </div>

        <Tabs
          value={side}
          onValueChange={(v) => setSide(v as Side)}
          className="w-auto"
        >
          <TabsList className="h-8">
            <TabsTrigger
              value="SELL"
              className="data-[state=active]:text-[color:var(--color-sell)] px-3 text-xs"
            >
              I want to buy
            </TabsTrigger>
            <TabsTrigger
              value="BUY"
              className="data-[state=active]:text-[color:var(--color-buy)] px-3 text-xs"
            >
              I want to sell
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow className="border-border hover:bg-transparent">
              <TableHead className="w-[180px]">Merchant</TableHead>
              <TableHead className="text-right">Price</TableHead>
              <TableHead className="text-right">Available</TableHead>
              <TableHead className="text-right">Limits</TableHead>
              <TableHead>Payment</TableHead>
              <TableHead className="text-right">Release</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ads.length === 0 && (
              <TableRow>
                <TableCell
                  colSpan={6}
                  className="py-10 text-center text-sm text-muted-foreground"
                >
                  No ads on this side
                </TableCell>
              </TableRow>
            )}
            {ads.map((ad, i) => (
              <AdRow
                key={ad.id}
                ad={ad}
                side={side}
                symbol={symbol}
                isBest={i === 0}
                marketMedian={
                  side === "BUY"
                    ? market.buy.medianPrice
                    : market.sell.medianPrice
                }
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
  marketMedian,
}: {
  ad: NormalizedAd;
  side: Side;
  symbol: string;
  isBest: boolean;
  marketMedian: number | null;
}) {
  const priceColor =
    side === "BUY"
      ? "text-[color:var(--color-buy)]"
      : "text-[color:var(--color-sell)]";

  const premium =
    marketMedian && marketMedian > 0
      ? (ad.price - marketMedian) / marketMedian
      : null;

  return (
    <TableRow
      className={cn(
        "border-border transition-colors hover:bg-accent/40",
        isBest && "bg-primary/[0.03]",
      )}
    >
      <TableCell className="py-3">
        <div className="flex items-center gap-2 min-w-0">
          <MerchantAvatar name={ad.merchant.name} />
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
            <div className="mt-0.5 flex items-center gap-2 text-[11px] text-muted-foreground">
              <span className="font-mono tabular-nums">
                {formatCompact(ad.merchant.orders30d)} orders
              </span>
              <span>·</span>
              <span className="font-mono tabular-nums">
                {formatPct(ad.merchant.completionRate, { frac: 1 })}
              </span>
            </div>
          </div>
        </div>
      </TableCell>

      <TableCell className="py-3 text-right">
        <div
          className={cn(
            "font-mono text-sm font-semibold tabular-nums",
            priceColor,
          )}
        >
          {formatFiat(ad.price, symbol, 2)}
        </div>
        {premium != null && (
          <div
            className={cn(
              "mt-0.5 font-mono text-[10px] tabular-nums",
              Math.abs(premium) < 0.001
                ? "text-muted-foreground/70"
                : premium > 0
                  ? "text-[color:var(--color-warn)]/80"
                  : "text-[color:var(--color-buy)]/80",
            )}
          >
            {formatPct(premium, { frac: 2, sign: true })}
          </div>
        )}
      </TableCell>

      <TableCell className="py-3 text-right">
        <div className="font-mono text-sm tabular-nums text-foreground">
          {formatCompact(ad.available)}
        </div>
        <div className="mt-0.5 font-mono text-[10px] uppercase tracking-wide text-muted-foreground/70">
          {ad.asset}
        </div>
      </TableCell>

      <TableCell className="py-3 text-right">
        <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {formatCompact(ad.minOrder)}
          <span className="mx-1 text-muted-foreground/50">–</span>
          {formatCompact(ad.maxOrder)}
        </div>
      </TableCell>

      <TableCell className="py-3">
        <div className="flex flex-wrap gap-1">
          {ad.payMethods.slice(0, 3).map((pm) => (
            <Badge
              key={pm.id}
              variant="secondary"
              className="bg-secondary/70 text-[10px] font-medium text-foreground/80 hover:bg-secondary"
            >
              {pm.short ?? pm.name}
            </Badge>
          ))}
          {ad.payMethods.length > 3 && (
            <Badge
              variant="outline"
              className="text-[10px] border-dashed text-muted-foreground"
            >
              +{ad.payMethods.length - 3}
            </Badge>
          )}
        </div>
      </TableCell>

      <TableCell className="py-3 text-right">
        <div className="flex items-center justify-end gap-1 font-mono text-[11px] tabular-nums text-muted-foreground">
          {isBest && (
            <Star
              className="h-3 w-3 text-primary"
              strokeWidth={2}
              aria-label="Best price"
            />
          )}
          {formatDuration(ad.merchant.avgReleaseSec)}
        </div>
      </TableCell>
    </TableRow>
  );
}

function MerchantAvatar({ name }: { name: string }) {
  const initials = (name || "?")
    .split(/[\s_\-]+/)
    .map((w) => w[0])
    .slice(0, 2)
    .join("")
    .toUpperCase();

  return (
    <div
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full border border-border bg-muted/60 font-mono text-[10px] font-medium text-muted-foreground"
      aria-hidden
    >
      {initials}
    </div>
  );
}
