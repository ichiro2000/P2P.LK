"use client";

import Link from "next/link";
import { useMemo } from "react";
import type { MarketRef } from "@/lib/storage";
import type { MarketSnapshot } from "@/lib/types";
import { usePolling } from "@/hooks/use-polling";
import { Card, CardContent } from "@/components/ui/card";
import { MarketStar } from "./star-button";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { ArrowDownRight, ArrowUpRight } from "lucide-react";

/**
 * Compact live card for a single watchlisted market. Polls at 30s (workspace
 * is many cards so we don't want to hammer Bybit). Links through to the
 * Live Markets page preset on this pair.
 */
export function WatchlistMarketCard({ ref }: { ref: MarketRef }) {
  const url = useMemo(
    () => `/api/p2p/market?asset=${ref.asset}&fiat=${ref.fiat}&rows=10`,
    [ref.asset, ref.fiat],
  );
  const { data, loading } = usePolling<MarketSnapshot>(url, {
    intervalMs: 30_000,
  });

  const fiat = getFiat(ref.fiat);
  const symbol = fiat?.symbol ?? ref.fiat;

  const bid = data?.buy.bestPrice ?? null;
  const ask = data?.sell.bestPrice ?? null;
  const spreadPct = data?.spreadPct ?? null;
  const depth =
    data != null
      ? (data.buy.totalAvailable ?? 0) + (data.sell.totalAvailable ?? 0)
      : null;

  return (
    <Link
      href={`/?asset=${ref.asset}&fiat=${ref.fiat}`}
      className="group block"
    >
      <Card className="card-lift border-border bg-card/60 transition-colors group-hover:border-primary/30">
        <CardContent className="p-4">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="text-base">{fiat?.flag ?? "🏳"}</span>
                <span className="font-mono text-sm font-semibold text-foreground">
                  {ref.asset}/{ref.fiat}
                </span>
              </div>
              <div className="mt-0.5 truncate text-[11px] text-muted-foreground">
                {fiat?.name ?? ref.fiat}
              </div>
            </div>
            <MarketStar asset={ref.asset} fiat={ref.fiat} size="sm" />
          </div>

          <div className="mt-4 grid grid-cols-2 gap-3">
            {/* Buy Ads (publisher buying = retail sell context) → red.
                Sell Ads (publisher selling = retail buy context) → green. */}
            <PriceBlock
              tone="sell"
              label="BUY ADS"
              value={bid}
              symbol={symbol}
              loading={loading && bid == null}
            />
            <PriceBlock
              tone="buy"
              label="SELL ADS"
              value={ask}
              symbol={symbol}
              loading={loading && ask == null}
            />
          </div>

          <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 font-mono text-[10px] tabular-nums text-muted-foreground">
            <span>
              Spread{" "}
              <span
                className={cn(
                  "text-foreground/80",
                  spreadPct != null && spreadPct < 0.003
                    ? "text-[color:var(--color-buy)]"
                    : "",
                )}
              >
                {spreadPct != null ? formatPct(spreadPct, { frac: 2 }) : "—"}
              </span>
            </span>
            <span>
              Depth{" "}
              <span className="text-foreground/80">
                {depth != null
                  ? `${formatCompact(depth)} ${ref.asset}`
                  : "—"}
              </span>
            </span>
          </div>
        </CardContent>
      </Card>
    </Link>
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
  const color =
    tone === "buy"
      ? "text-[color:var(--color-buy)]"
      : "text-[color:var(--color-sell)]";
  return (
    <div>
      <div
        className={cn(
          "flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider",
          color,
        )}
      >
        <Icon className="h-3 w-3" strokeWidth={2.25} />
        {label}
      </div>
      <div
        className={cn(
          "mt-1 font-mono text-lg font-semibold tabular-nums leading-none",
          value != null ? "text-foreground" : "text-muted-foreground/60",
          loading && "animate-pulse",
        )}
      >
        {value != null ? formatFiat(value, symbol, 4) : "—"}
      </div>
    </div>
  );
}
