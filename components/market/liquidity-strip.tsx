import type { MarketSnapshot } from "@/lib/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Two stacked horizontal bars showing relative BID vs ASK depth.
 * Bars scale to the larger of the two. Immediately shows when
 * one side is deeply over-stocked (signalling where the pressure is).
 */
export function LiquidityStrip({ market }: { market: MarketSnapshot }) {
  const bid = market.buy.totalAvailable;
  const ask = market.sell.totalAvailable;
  const max = Math.max(bid, ask, 1);
  const bidPct = (bid / max) * 100;
  const askPct = (ask / max) * 100;

  const imbalance = bid + ask > 0 ? (bid - ask) / (bid + ask) : 0;
  // Retail framing: heavy bid depth means merchants are competing to BUY
  // — the place retail goes to SELL. Heavy ask depth is the inverse.
  const imbalanceText =
    imbalance > 0.1
      ? "Sell pressure"
      : imbalance < -0.1
        ? "Buy pressure"
        : "Balanced book";

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Depth (top 20)
          </CardTitle>
          <span
            className={cn(
              "font-mono text-[10px] tabular-nums",
              // Heavy BID side = retail sell-pressure → red;
              // Heavy ASK side = retail buy-pressure → green.
              imbalance > 0.1
                ? "text-[color:var(--color-sell)]"
                : imbalance < -0.1
                  ? "text-[color:var(--color-buy)]"
                  : "text-muted-foreground",
            )}
          >
            {imbalanceText}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {/* BID (publisher BUY ads) = retail sell context → red.
            ASK (publisher SELL ads) = retail buy context → green. */}
        <Bar
          label="BID"
          pct={bidPct}
          value={`${formatCompact(bid)} ${market.asset}`}
          tone="sell"
        />
        <Bar
          label="ASK"
          pct={askPct}
          value={`${formatCompact(ask)} ${market.asset}`}
          tone="buy"
        />
      </CardContent>
    </Card>
  );
}

function Bar({
  label,
  pct,
  value,
  tone,
}: {
  label: string;
  pct: number;
  value: string;
  tone: "buy" | "sell";
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between text-[11px]">
        <span
          className={cn(
            "font-mono tracking-wide",
            tone === "buy"
              ? "text-[color:var(--color-buy)]"
              : "text-[color:var(--color-sell)]",
          )}
        >
          {label}
        </span>
        <span className="font-mono tabular-nums text-foreground/80">
          {value}
        </span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-muted/50">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            tone === "buy"
              ? "bg-[color:var(--color-buy)]"
              : "bg-[color:var(--color-sell)]",
          )}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
