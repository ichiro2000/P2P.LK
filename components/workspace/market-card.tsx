"use client";

import Link from "next/link";
import { useMemo } from "react";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

import type { MarketSnapshot } from "@/lib/types";
import { usePolling } from "@/hooks/use-polling";
import { Card } from "@/components/ui/card";
import { MarketStar } from "./star-button";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * Compact live card for one watchlisted market. Polls every 30s (the
 * workspace can hold many cards) and links to the Markets page for the pair.
 */
export function WatchlistMarketCard({ market }: { market: { asset: string; fiat: string } }) {
  const url = useMemo(
    () => `/api/p2p/market?asset=${market.asset}&fiat=${market.fiat}&rows=10`,
    [market.asset, market.fiat],
  );
  const { data, loading } = usePolling<MarketSnapshot>(url, { intervalMs: 30_000 });

  const fiat = getFiat(market.fiat);
  const symbol = fiat?.symbol ?? market.fiat;

  const bid = data?.buy.bestPrice ?? null;
  const ask = data?.sell.bestPrice ?? null;
  const spreadPct = data?.spreadPct ?? null;
  const depth = data != null ? (data.buy.totalAvailable ?? 0) + (data.sell.totalAvailable ?? 0) : null;

  return (
    <Card className="relative gap-3 px-4 py-3.5 transition-colors hover:bg-muted/30">
      <div className="flex items-start justify-between gap-2">
        <Link
          href={`/?asset=${market.asset}&fiat=${market.fiat}`}
          className="min-w-0 after:absolute after:inset-0 after:content-['']"
        >
          <div className="font-mono text-sm font-semibold">
            {market.asset}/{market.fiat}
          </div>
          <div className="truncate text-xs text-muted-foreground">{fiat?.name ?? market.fiat}</div>
        </Link>
        <MarketStar asset={market.asset} fiat={market.fiat} size="md" className="relative z-10" />
      </div>

      <div className="grid grid-cols-2 gap-3">
        {/* Buy ads (publisher buying = you sell) → sell tint; sell ads → buy tint. */}
        <PriceBlock tone="sell" label="Buy ads" value={bid} symbol={symbol} loading={loading && bid == null} />
        <PriceBlock tone="buy" label="Sell ads" value={ask} symbol={symbol} loading={loading && ask == null} />
      </div>

      <div className="flex items-center justify-between border-t pt-2.5 text-xs text-muted-foreground">
        <span>
          Spread{" "}
          <span className="font-mono tabular-nums text-foreground">
            {spreadPct != null ? formatPct(spreadPct, { frac: 2 }) : "—"}
          </span>
        </span>
        <span>
          Depth{" "}
          <span className="font-mono tabular-nums text-foreground">
            {depth != null ? `${formatCompact(depth)} ${market.asset}` : "—"}
          </span>
        </span>
      </div>
    </Card>
  );
}

function PriceBlock({
  tone,
  label,
  value,
  symbol,
  loading,
}: {
  tone: "buy" | "sell";
  label: string;
  value: number | null;
  symbol: string;
  loading: boolean;
}) {
  const Icon = tone === "buy" ? ArrowUpRight : ArrowDownRight;
  return (
    <div className="min-w-0">
      <div
        className={cn(
          "flex items-center gap-1 text-xs font-medium",
          tone === "buy" ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]",
        )}
      >
        <Icon className="size-3.5" />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 truncate font-mono text-lg font-semibold leading-none tabular-nums",
          value == null && "text-muted-foreground",
          loading && "animate-pulse",
        )}
      >
        {value != null ? formatFiat(value, symbol, 2) : "—"}
      </div>
    </div>
  );
}
