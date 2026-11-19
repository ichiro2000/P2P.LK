import type { MarketSnapshot } from "@/lib/types";
import { ChartCard } from "@/components/charts/kit";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { FIAT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { InfoPopover } from "@/components/common/info-popover";
import { nearTouchDepth, nearTouchImbalance } from "@/lib/near-touch";

/**
 * Book balance: bid vs ask depth within 1 % of each side's best price
 * (online, unrestricted ads, one order each — DATA-AUDIT F4),
 * plus the round-trip numbers (mid, spread, near-touch median and VWAP per
 * side). Heavy bids = merchants competing to buy USDT, which is where
 * you'd go to sell.
 */
export function LiquidityStrip({ market }: { market: MarketSnapshot }) {
  const bid = nearTouchDepth(market.ads, "BUY", 0.01).usdt;
  const ask = nearTouchDepth(market.ads, "SELL", 0.01).usdt;
  const max = Math.max(bid, ask, 1);
  const imbalance = nearTouchImbalance(bid, ask) ?? 0;
  const sym = FIAT.symbol;
  const verdict =
    imbalance > 0.1 ? "More buyers than sellers" : imbalance < -0.1 ? "More sellers than buyers" : "Balanced book";

  return (
    <ChartCard
      title="Book balance"
      description={verdict}
      actions={
        <span className="font-mono text-xs tabular-nums text-muted-foreground">
          {formatPct(imbalance, { frac: 0, sign: true })}
        </span>
      }
      contentClassName="space-y-4 px-4"
    >
      <div className="space-y-3">
        <Bar label="Buy ads within 1% (declared)" value={bid} pct={(bid / max) * 100} tone="sell" />
        <Bar label="Sell ads within 1% (escrowed)" value={ask} pct={(ask / max) * 100} tone="buy" />
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-border pt-3 text-xs">
        <Item label="Mid" value={formatFiat(market.mid, sym, 2)} />
        <Item label="Spread" value={formatFiat(market.spread, sym, 2)} />
        <Item label="Median ask ±2%" value={formatFiat(market.sell.medianPrice, sym, 2)} />
        <Item label="Median bid ±2%" value={formatFiat(market.buy.medianPrice, sym, 2)} />
        <Item label="VWAP ask ±2%" value={formatFiat(market.sell.vwap, sym, 2)} />
        <Item label="VWAP bid ±2%" value={formatFiat(market.buy.vwap, sym, 2)} />
      </dl>
      <div className="flex items-center justify-between gap-2 text-[11px] text-muted-foreground">
        <span>
          Near touch: {market.sell.nearTouchCount ?? "—"} asks, {market.buy.nearTouchCount ?? "—"} bids within 2 % of best
        </span>
        <InfoPopover label="What median and VWAP mean here" title="Median and VWAP, near touch" side="top">
          <p>
            Both use only the ads priced within ±2 % of their side&apos;s best price, so far-off listings in a thin
            book don&apos;t drag them.
          </p>
          <p>Median: the middle price of those ads.</p>
          <p>
            VWAP: their average price weighted by the USDT one order can take from each ad (available, capped by the
            ad&apos;s max order). For what your own amount would cost, see “Price for your amount”.
          </p>
          <p>The bars above count online, unrestricted ads only.</p>
        </InfoPopover>
      </div>
    </ChartCard>
  );
}

function Item({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="truncate font-mono text-sm tabular-nums text-foreground">{value}</dd>
    </div>
  );
}

function Bar({
  label,
  value,
  pct,
  tone,
}: {
  label: string;
  value: number;
  pct: number;
  tone: "buy" | "sell";
}) {
  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{label}</span>
        <span className="font-mono tabular-nums text-foreground">{formatCompact(value)} USDT</span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-muted">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            tone === "buy" ? "bg-[color:var(--color-buy)]" : "bg-[color:var(--color-sell)]",
          )}
          style={{ width: `${Math.max(2, Math.min(100, pct))}%` }}
        />
      </div>
    </div>
  );
}
