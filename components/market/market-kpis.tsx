import type { MarketSnapshot } from "@/lib/types";
import type { AmountQuote } from "@/lib/liquidity";
import { KpiCard } from "@/components/common/kpi-card";
import { KpiGrid } from "@/components/common/page";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { FIAT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import { nearTouchDepth } from "@/lib/near-touch";

/** One point of recent market history (from D1), already thinned. */
export type MarketHistoryPoint = {
  t: number;
  bid: number | null;
  ask: number | null;
  spread: number | null;
  depth: number | null;
};

function change(values: (number | null)[]) {
  const pts = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (pts.length < 2 || pts[0] === 0) return null;
  return (pts[pts.length - 1] - pts[0]) / Math.abs(pts[0]);
}

/**
 * Headline numbers. The big value is top of book (the single best ad); the
 * footer line is the walked price for the visitor's amount. Sparklines and
 * the % change are the last 24 h of the whole market from the collector,
 * so they still show when a filter narrows the live book.
 */
export function MarketKpis({
  market,
  history,
  quotes,
  merchantsOnly = false,
}: {
  market: MarketSnapshot;
  history: MarketHistoryPoint[];
  quotes?: { amount: number; buy: AmountQuote; sell: AmountQuote };
  /** The sparkline series follows the same book as the KPI (merchants-only
   *  view → the merchant book's own history), so say which. */
  merchantsOnly?: boolean;
}) {
  const sym = FIAT.symbol;
  const asks = history.map((h) => h.ask);
  const bids = history.map((h) => h.bid);
  const spreads = history.map((h) => h.spread);
  const hasHistory = history.length > 1;
  const trend = hasHistory ? (merchantsOnly ? "24h, merchants" : "24h, all ads") : "No history yet";
  // Depth that can actually be traded near the price: within 1 % of each
  // side's best, online & unrestricted ads, one order per ad (DATA-AUDIT F4).
  const bids1 = nearTouchDepth(market.ads, "BUY", 0.01);
  const asks1 = nearTouchDepth(market.ads, "SELL", 0.01);
  const listed = market.buy.totalAvailable + market.sell.totalAvailable;
  const excluded = (market.buy.excludedCount ?? 0) + (market.sell.excludedCount ?? 0);

  return (
    <KpiGrid>
      {/* Colour convention: sell ads (where you buy) = green, buy ads = red. */}
      <KpiCard
        label="Best price to buy USDT"
        value={formatFiat(market.sell.bestPrice, sym, 2)}
        tone="buy"
        change={change(asks)}
        changeLabel={trend}
        spark={asks}
        sparkTone="buy"
        footer={quotes && <ForAmount q={quotes.buy} amount={quotes.amount} />}
      />
      <KpiCard
        label="Best price to sell USDT"
        value={formatFiat(market.buy.bestPrice, sym, 2)}
        tone="sell"
        change={change(bids)}
        changeLabel={trend}
        spark={bids}
        sparkTone="sell"
        footer={quotes && <ForAmount q={quotes.sell} amount={quotes.amount} />}
      />
      <KpiCard
        label="Spread"
        value={formatFiat(market.spread, sym, 2)}
        sub={`${formatPct(market.spreadPct, { frac: 2 })} of mid · ${trend}`}
        spark={spreads}
        sparkTone="neutral"
        footer={
          quotes &&
          quotes.buy.walk.effectivePrice != null &&
          quotes.sell.walk.effectivePrice != null && (
            <span>
              For {sym} {formatCompact(quotes.amount)}:{" "}
              <span className="font-mono tabular-nums text-foreground">
                {formatFiat(quotes.buy.walk.effectivePrice - quotes.sell.walk.effectivePrice, sym, 2)}
              </span>
            </span>
          )
        }
      />
      <KpiCard
        label="Depth within 1% of best"
        value={`${formatCompact(bids1.usdt + asks1.usdt)} USDT`}
        sub={`To buy ${formatCompact(asks1.usdt)} · to sell ${formatCompact(bids1.usdt)} (declared)`}
        footer={`Online, unrestricted ads, one order each. Whole listed book: ${formatCompact(listed)} USDT${excluded > 0 ? `, ${excluded} ads offline/restricted` : ""}.`}
      />
    </KpiGrid>
  );
}

function ForAmount({ q, amount }: { q: AmountQuote; amount: number }) {
  const eff = q.walk.effectivePrice;
  return (
    <span className="flex min-w-0 flex-wrap items-baseline gap-x-1">
      <span>For {FIAT.symbol} {formatCompact(amount)}:</span>
      <span className="font-mono tabular-nums text-foreground">{eff == null ? "no fill" : formatFiat(eff, FIAT.symbol, 2)}</span>
      {eff != null && q.gapPct != null && (
        <span className={cn("font-mono tabular-nums", q.gapPct > 0.002 && "text-[color:var(--color-warn)]")}>
          {q.gapPct < 0.00005 ? "(at best)" : `(${formatPct(q.gapPct, { frac: 2, sign: true })})`}
        </span>
      )}
      {eff != null && q.walk.partial && <span className="text-[color:var(--color-warn)]">partial</span>}
    </span>
  );
}
