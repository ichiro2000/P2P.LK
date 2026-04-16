import type { MarketSnapshot } from "@/lib/types";
import { formatFiat, formatPct } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { Info } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Single headline: the market-maker spread between the top Buy ad and top Sell ad.
 * Also shows the mid price (micro).
 */
export function SpreadWidget({ market }: { market: MarketSnapshot }) {
  const fiat = getFiat(market.fiat);
  const symbol = fiat?.symbol ?? market.fiat;

  const { spread, spreadPct, mid } = market;
  const tight = spreadPct != null && spreadPct < 0.003;

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Spread
          </CardTitle>
          <Tooltip>
            <TooltipTrigger
              render={
                <button
                  type="button"
                  className="text-muted-foreground/60 hover:text-foreground transition-colors"
                  aria-label="About spread"
                >
                  <Info className="h-3 w-3" strokeWidth={1.75} />
                </button>
              }
            />
            <TooltipContent
              side="top"
              className="max-w-[240px] text-[11px] leading-relaxed"
            >
              <p>
                Difference between the top Sell ad and top Buy ad. Wider
                spreads mean worse round-trip cost and often thinner liquidity.
              </p>
            </TooltipContent>
          </Tooltip>
        </div>
      </CardHeader>
      <CardContent>
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-3xl font-semibold tabular-nums text-foreground leading-none">
            {spread != null ? formatFiat(spread, symbol, 2) : "—"}
          </span>
          {spreadPct != null && (
            <span
              className={cn(
                "font-mono text-[12px] tabular-nums leading-none",
                tight
                  ? "text-[color:var(--color-buy)]"
                  : "text-muted-foreground",
              )}
            >
              {formatPct(spreadPct, { frac: 2 })}
            </span>
          )}
        </div>

        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
          <span>
            Mid{" "}
            <span className="font-mono tabular-nums text-foreground/80">
              {mid != null ? formatFiat(mid, symbol, 2) : "—"}
            </span>
          </span>
          {/* Buy ads (publisher buying = retail sell context) → red.
              Sell ads (publisher selling = retail buy context) → green. */}
          <span>
            Buy ads{" "}
            <span className="font-mono tabular-nums text-[color:var(--color-sell)]">
              {market.buy.bestPrice != null
                ? formatFiat(market.buy.bestPrice, symbol, 2)
                : "—"}
            </span>
          </span>
          <span>
            Sell ads{" "}
            <span className="font-mono tabular-nums text-[color:var(--color-buy)]">
              {market.sell.bestPrice != null
                ? formatFiat(market.sell.bestPrice, symbol, 2)
                : "—"}
            </span>
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
