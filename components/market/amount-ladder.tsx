import type { MarketSnapshot } from "@/lib/types";
import { priceLadder } from "@/lib/market-insights";
import type { WalkResult } from "@/lib/liquidity";
import { Card } from "@/components/ui/card";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { FIAT } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * "What would I actually get for Rs X?" — walks the visible book for four
 * ticket sizes on both sides. Respects each ad's min/max order limits.
 */
export function AmountLadder({ market, includeAll = false }: { market: MarketSnapshot; includeAll?: boolean }) {
  const rows = priceLadder(market.ads, undefined, { includeOffline: includeAll, includeRestricted: includeAll });
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {rows.map((r) => (
        <Card key={r.amount} className="gap-3 px-4 py-3.5">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">
              {FIAT.symbol} {formatCompact(r.amount)}
            </span>
            <span className="text-[11px] text-muted-foreground">ticket</span>
          </div>
          <Side label="Buy USDT" fill={r.buy} tone="buy" />
          <Side label="Sell USDT" fill={r.sell} tone="sell" />
        </Card>
      ))}
    </div>
  );
}

function Side({ label, fill, tone }: { label: string; fill: WalkResult; tone: "buy" | "sell" }) {
  const none = fill.effectivePrice == null;
  return (
    <div className="space-y-0.5 border-t border-border pt-2.5">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">{label}</span>
        <span
          className={cn(
            "font-mono text-base font-semibold tabular-nums",
            none
              ? "text-muted-foreground"
              : tone === "buy"
                ? "text-[color:var(--color-buy)]"
                : "text-[color:var(--color-sell)]",
          )}
        >
          {none ? "—" : formatFiat(fill.effectivePrice, FIAT.symbol, 2)}
        </span>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-muted-foreground">
        {none ? (
          <span>No ad accepts this amount</span>
        ) : (
          <>
            <span className="font-mono tabular-nums">
              ≈ {formatCompact(fill.filledAsset)} USDT · {fill.adsConsumed} ad{fill.adsConsumed === 1 ? "" : "s"}
            </span>
            <span
              className={cn(
                "font-mono tabular-nums",
                fill.slippagePct != null && fill.slippagePct > 0.002 && "text-[color:var(--color-warn)]",
              )}
            >
              {fill.slippagePct != null && fill.slippagePct > 0.00005
                ? `${formatPct(fill.slippagePct, { frac: 2 })} vs best`
                : "at best price"}
            </span>
          </>
        )}
      </div>
      {!none && fill.partial && (
        <div className="text-[11px] text-[color:var(--color-warn)]">
          Only {FIAT.symbol} {formatCompact(fill.filledFiat)} fillable on the visible book
        </div>
      )}
    </div>
  );
}
