import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import type { MarketSnapshot } from "@/lib/types";
import { formatFiat, formatCompact } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { cn } from "@/lib/utils";

/**
 * A pair of big price displays — BUY best bid & SELL best ask.
 * The green (buy) value is what sellers of USDT receive; red (sell) is what buyers pay.
 */
export function PricePanel({ market }: { market: MarketSnapshot }) {
  const fiat = getFiat(market.fiat);
  const symbol = fiat?.symbol ?? market.fiat;

  return (
    <div className="grid grid-cols-1 divide-y divide-border rounded-lg border border-border bg-card/60 md:grid-cols-2 md:divide-x md:divide-y-0">
      <PriceTile
        tone="buy"
        label="Top Buy Ads"
        helper={`Highest price you can sell ${market.asset} for`}
        price={market.buy.bestPrice}
        symbol={symbol}
        available={market.buy.totalAvailable}
        asset={market.asset}
        ads={market.buy.count}
      />
      <PriceTile
        tone="sell"
        label="Top Sell Ads"
        helper={`Lowest price you'll pay to buy ${market.asset}`}
        price={market.sell.bestPrice}
        symbol={symbol}
        available={market.sell.totalAvailable}
        asset={market.asset}
        ads={market.sell.count}
      />
    </div>
  );
}

function PriceTile({
  tone,
  label,
  helper,
  price,
  symbol,
  available,
  asset,
  ads,
}: {
  tone: "buy" | "sell";
  label: string;
  helper: string;
  price: number | null;
  symbol: string;
  available: number;
  asset: string;
  ads: number;
}) {
  const Icon = tone === "buy" ? ArrowUpRight : ArrowDownRight;
  // Retail-centric coloring: publisher's BUY ad = your sell opportunity
  // (red), publisher's SELL ad = your buy opportunity (green). Matches
  // Binance P2P's own UI convention.
  const color =
    tone === "buy"
      ? "text-[color:var(--color-sell)]"
      : "text-[color:var(--color-buy)]";
  const bg =
    tone === "buy"
      ? "bg-[color:var(--color-sell-muted)]"
      : "bg-[color:var(--color-buy-muted)]";

  return (
    <div className="relative p-5 sm:p-6">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <span
              className={cn(
                "flex h-6 w-6 items-center justify-center rounded-md",
                bg,
                color,
              )}
            >
              <Icon className="h-3.5 w-3.5" strokeWidth={2.25} />
            </span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {label}
            </span>
          </div>
          <p className="mt-1 text-[11px] text-muted-foreground/70">
            {helper}
          </p>
        </div>
      </div>

      <div className="mt-4 flex items-baseline gap-2">
        <span
          className={cn(
            "font-mono text-3xl sm:text-4xl font-semibold tabular-nums tracking-tight leading-none",
            color,
          )}
        >
          {price != null ? formatFiat(price, symbol, 2) : "—"}
        </span>
        <span className="text-xs text-muted-foreground">/ {asset}</span>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/60 pt-3">
        <MiniStat label="Depth" value={`${formatCompact(available)} ${asset}`} />
        <MiniStat label="Ads" value={ads.toString()} />
      </div>
    </div>
  );
}

function MiniStat({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span className="font-mono text-sm font-medium tabular-nums text-foreground">
        {value}
      </span>
    </div>
  );
}
