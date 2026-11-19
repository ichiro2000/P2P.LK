"use client";

import { Card } from "@/components/ui/card";
import { InfoPopover } from "@/components/common/info-popover";
import type { AmountQuote } from "@/lib/liquidity";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import { AmountPicker } from "./amount-picker";

const sym = FIAT.symbol;

export const WALK_EXPLAINER =
  "We walk the visible ads from the best price, one order per ad, within each ad's min and max order and available USDT. Ads whose minimum is bigger than what's left are skipped, not a dead end. Offline advertisers and ads with counterparty restrictions are left out unless you include them.";

/**
 * "Price for my amount" (D1): the effective price to buy and to sell the
 * chosen LKR amount, its gap to the best ad, and how much fills within
 * 0.5 % of the best price.
 */
export function AmountQuotePanel({
  buy,
  sell,
  amount,
  scope,
}: {
  buy: AmountQuote;
  sell: AmountQuote;
  amount: number;
  /** "the top 20 ads per side", etc. */
  scope: string;
}) {
  return (
    <Card className="gap-4 px-4 py-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-sm font-medium">Price for your amount</div>
          <p className="text-[11px] text-muted-foreground">
            Average price to fill {sym} {formatCompact(amount)} across {scope}.
          </p>
        </div>
        <InfoPopover label="How the price for your amount is worked out" title="How it's worked out">
          <p>{WALK_EXPLAINER}</p>
          <p>
            “Gap to best” compares that average with the single best ad. “Fillable within 0.5 %” is the most you can
            trade while your average stays within 0.5 % of the best usable price.
          </p>
        </InfoPopover>
      </div>
      <AmountPicker />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <QuoteSide title="Buy USDT" tone="buy" q={buy} amount={amount} />
        <QuoteSide title="Sell USDT" tone="sell" q={sell} amount={amount} />
      </div>
    </Card>
  );
}

export function QuoteSide({
  title,
  tone,
  q,
  amount,
}: {
  title: string;
  tone: "buy" | "sell";
  q: AmountQuote;
  amount: number;
}) {
  const w = q.walk;
  const none = w.effectivePrice == null;
  return (
    <div className="min-w-0 space-y-1.5 rounded-lg border border-border px-3 py-3">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-xs text-muted-foreground">
          {title} · {sym} {formatCompact(amount)}
        </span>
        <span
          className={cn(
            "font-mono text-lg font-semibold tabular-nums",
            none
              ? "text-muted-foreground"
              : tone === "buy"
                ? "text-[color:var(--color-buy)]"
                : "text-[color:var(--color-sell)]",
          )}
        >
          {none ? "—" : formatFiat(w.effectivePrice, sym, 2)}
        </span>
      </div>
      <dl className="grid grid-cols-2 gap-x-3 gap-y-1 text-[11px]">
        <dt className="text-muted-foreground">Best ad</dt>
        <dd className="text-right font-mono tabular-nums">{formatFiat(q.best, sym, 2)}</dd>
        <dt className="text-muted-foreground">Gap to best</dt>
        <dd
          className={cn(
            "text-right font-mono tabular-nums",
            q.gapPct != null && q.gapPct > 0.002 && "text-[color:var(--color-warn)]",
          )}
        >
          {q.gap == null
            ? "—"
            : Math.abs(q.gap) < 0.005
              ? "at best"
              : `${q.gap > 0 ? "+" : "−"}${Math.abs(q.gap).toFixed(2)} · ${formatPct(Math.abs(q.gapPct ?? 0), { frac: 2 })}`}
        </dd>
        <dt className="text-muted-foreground">Fillable within 0.5 %</dt>
        <dd className="text-right font-mono tabular-nums">
          {sym} {formatCompact(q.fillable05)}
        </dd>
        <dt className="text-muted-foreground">Fills with</dt>
        <dd className="text-right font-mono tabular-nums">
          {none ? "—" : `${formatCompact(w.filledAsset)} USDT · ${w.adsConsumed} ad${w.adsConsumed === 1 ? "" : "s"}`}
        </dd>
      </dl>
      {none ? (
        <p className="text-[11px] text-[color:var(--color-warn)]">No usable ad accepts this amount.</p>
      ) : (
        w.partial && (
          <p className="text-[11px] text-[color:var(--color-warn)]">
            Only {sym} {formatCompact(w.filledFiat)} fills on the visible book.
          </p>
        )
      )}
      {w.excluded > 0 && (
        <p className="text-[11px] text-muted-foreground">
          {w.excluded} offline or restricted ad{w.excluded === 1 ? "" : "s"} left out.
        </p>
      )}
    </div>
  );
}
