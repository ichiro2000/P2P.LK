"use client";

import { ArrowDownRight, ArrowUpRight, Check } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatInt, formatPct, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ExchangeSide, ExchangeSummary, LiveBooks, ShareNow } from "@/lib/compare";
import { verdict } from "@/lib/compare";
import { AmountPicker } from "@/components/market/amount-picker";
import { InfoPopover } from "@/components/common/info-popover";
import { WALK_EXPLAINER } from "@/components/market/amount-quote";

const S = FIAT.symbol;

/** Price for the visitor's amount (walked), top of book, fillable size,
 *  spread, depth and ad count per exchange, side by side, with the better
 *  venue for each direction called out — judged on the amount's price. */
export function HeadToHead({
  a,
  b,
  books,
  now,
}: {
  a: ExchangeSummary;
  b: ExchangeSummary;
  books: LiveBooks;
  now: ShareNow;
}) {
  const v = verdict(a, b);
  const label = (ex: string | null) => (ex === a.exchange ? a.label : ex === b.exchange ? b.label : null);
  const other = (ex: string | null) => (ex === a.exchange ? b.label : a.label);
  const amount = a.amount ?? b.amount;
  const amt = amount != null ? `${S} ${formatCompact(amount)}` : null;
  const best = (x: number | null, y: number | null, lowerWins: boolean) =>
    x == null || y == null || x === y ? null : (lowerWins ? x < y : x > y) ? a.exchange : b.exchange;

  const adsNow = (ex: string) =>
    now ? (ex === "binance" ? now.binanceAds : ex === "bybit" ? now.bybitAds : null) : null;

  const rows: {
    label: string;
    hint?: string;
    value: (s: ExchangeSummary) => React.ReactNode;
    best?: string | null;
  }[] = [
    ...(amt
      ? [
          {
            label: `Buy USDT, ${amt}`,
            hint: "Avg price, walked",
            value: (s: ExchangeSummary) => <Walked side={s.buyUsdt} />,
            best: v.buy,
          },
          {
            label: `Sell USDT, ${amt}`,
            hint: "Avg price, walked",
            value: (s: ExchangeSummary) => <Walked side={s.sellUsdt} />,
            best: v.sell,
          },
        ]
      : []),
    {
      label: "Best sell ad",
      hint: "Top of book (buy)",
      value: (s) => formatFiat(s.buyUsdt.best, S, 2),
      best: best(a.buyUsdt.best, b.buyUsdt.best, true),
    },
    {
      label: "Best buy ad",
      hint: "Top of book (sell)",
      value: (s) => formatFiat(s.sellUsdt.best, S, 2),
      best: best(a.sellUsdt.best, b.sellUsdt.best, false),
    },
    {
      label: "Buy within 0.5 %",
      hint: "LKR fillable near best",
      value: (s) => `${S} ${formatCompact(s.buyUsdt.quote?.fillable05 ?? null)}`,
      best: best(a.buyUsdt.quote?.fillable05 ?? null, b.buyUsdt.quote?.fillable05 ?? null, false),
    },
    {
      label: "Sell within 0.5 %",
      hint: "LKR fillable near best",
      value: (s) => `${S} ${formatCompact(s.sellUsdt.quote?.fillable05 ?? null)}`,
      best: best(a.sellUsdt.quote?.fillable05 ?? null, b.sellUsdt.quote?.fillable05 ?? null, false),
    },
    {
      label: "Spread",
      hint: "Best sell ad − best buy ad",
      value: (s) => (
        <>
          {formatFiat(s.spread, S, 2)}
          <span className="block text-[11px] font-normal text-muted-foreground">
            {formatPct(s.spreadPct, { frac: 2 })}
          </span>
        </>
      ),
      best:
        a.spreadPct != null && b.spreadPct != null && a.spreadPct !== b.spreadPct
          ? a.spreadPct < b.spreadPct
            ? a.exchange
            : b.exchange
          : null,
    },
    {
      label: "Sell-ad depth",
      hint: "LKR listed, top 20 ads",
      value: (s) => `${S} ${formatCompact(s.buyUsdt.depthFiat)}`,
    },
    {
      label: "Buy-ad depth",
      hint: "LKR listed, top 20 ads",
      value: (s) => `${S} ${formatCompact(s.sellUsdt.depthFiat)}`,
    },
    {
      label: "Ads listed",
      hint: "All LKR ads, latest sweep",
      value: (s) => formatInt(adsNow(s.exchange)),
    },
  ];

  const detail = (gap: number | null, winner: string | null, more: boolean) =>
    winner == null
      ? "Both exchanges are level, or neither book has a usable ad."
      : gap != null
        ? `${formatFiat(gap, S, 2)} ${more ? "more" : "less"} per USDT than ${other(winner)}${amt ? ` for ${amt}` : ""}`
        : `${other(winner)} can't fill ${amt ?? "it"} from its visible book.`;

  return (
    <div className="space-y-3">
      <Card className="gap-3 px-4 py-3.5">
        <div className="flex items-start justify-between gap-3">
          <p className="text-[11px] text-muted-foreground">
            The verdict uses the average price for your amount, not the single best ad, which is often too small or
            out of range.
          </p>
          <InfoPopover label="How the head-to-head is priced" title="How it's priced">
            <p>{WALK_EXPLAINER}</p>
            <p>A book that can&apos;t fill the whole amount loses to one that can.</p>
          </InfoPopover>
        </div>
        <AmountPicker />
      </Card>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <VerdictCard
          kind="buy"
          title={amt ? `Cheaper to buy USDT, ${amt}` : "Cheaper to buy USDT"}
          winner={label(v.buy)}
          price={v.buy ? v.buyPrice : null}
          detail={detail(v.buyGap, v.buy, false)}
        />
        <VerdictCard
          kind="sell"
          title={amt ? `Better to sell USDT, ${amt}` : "Better to sell USDT"}
          winner={label(v.sell)}
          price={v.sell ? v.sellPrice : null}
          detail={detail(v.sellGap, v.sell, true)}
        />
      </div>

      <Card className="gap-0 py-0">
        <div className="grid grid-cols-[minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1fr)] text-sm">
          <div className="border-b px-3 py-2.5 text-xs text-muted-foreground sm:px-4">Metric</div>
          {[a, b].map((s) => {
            const book = books[s.exchange];
            return (
              <div key={s.exchange} className="min-w-0 border-b border-l px-2 py-2.5 sm:px-4">
                <div className="truncate text-sm font-semibold">{s.label}</div>
                <div className="truncate text-[11px] text-muted-foreground">
                  {book.ok
                    ? `${book.source === "cache" ? "Cached" : "Live"} · ${formatSLT(book.ts, { dateStyle: undefined })} SLT`
                    : book.error}
                </div>
              </div>
            );
          })}
          {rows.map((r, i) => (
            <Row key={r.label} row={r} a={a} b={b} last={i === rows.length - 1} />
          ))}
        </div>
      </Card>
    </div>
  );
}

function Row({
  row,
  a,
  b,
  last,
}: {
  row: {
    label: string;
    hint?: string;
    value: (s: ExchangeSummary) => React.ReactNode;
    best?: string | null;
  };
  a: ExchangeSummary;
  b: ExchangeSummary;
  last: boolean;
}) {
  return (
    <>
      <div className={cn("min-w-0 px-2 py-2.5 sm:px-4", !last && "border-b")}>
        <div className="truncate text-xs font-medium sm:text-sm">{row.label}</div>
        {row.hint && <div className="truncate text-[11px] text-muted-foreground">{row.hint}</div>}
      </div>
      {[a, b].map((s) => {
        const best = row.best != null && row.best === s.exchange;
        return (
          <div
            key={s.exchange}
            className={cn(
              "flex min-w-0 items-start justify-between gap-0.5 border-l px-2 py-2.5 sm:gap-1 sm:px-4",
              !last && "border-b",
              best && "bg-muted/50",
            )}
          >
            <span className="min-w-0 whitespace-nowrap font-mono text-[11px] font-medium tabular-nums sm:text-sm">
              {s.ok ? row.value(s) : "—"}
            </span>
            {best && (
              <Check aria-label="Better" className="mt-0.5 size-3 shrink-0 text-foreground sm:size-3.5" />
            )}
          </div>
        );
      })}
    </>
  );
}

function VerdictCard({
  kind,
  title,
  winner,
  price,
  detail,
}: {
  kind: "buy" | "sell";
  title: string;
  winner: string | null;
  price: number | null;
  detail: string;
}) {
  const Icon = kind === "buy" ? ArrowDownRight : ArrowUpRight;
  return (
    <Card className="gap-1.5 px-4 py-3.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted-foreground">{title}</span>
        <Icon
          aria-hidden
          className={cn(
            "size-4",
            kind === "buy" ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]",
          )}
        />
      </div>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="text-lg font-semibold">{winner ?? "No clear winner"}</span>
        {winner && price != null && (
          <Badge
            variant="outline"
            className={cn(
              "font-mono tabular-nums",
              kind === "buy" ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]",
            )}
          >
            {formatFiat(price, S, 2)}
          </Badge>
        )}
      </div>
      <p className="text-[11px] text-muted-foreground">{detail}</p>
    </Card>
  );
}

/** Walked average for the amount, with fill caveats. */
function Walked({ side }: { side: ExchangeSide }) {
  const w = side.quote?.walk;
  if (!w || w.effectivePrice == null) return <span className="text-muted-foreground">no fill</span>;
  return (
    <>
      {formatFiat(w.effectivePrice, S, 2)}
      <span className="block text-[11px] font-normal text-muted-foreground">
        {w.partial
          ? `only ${S} ${formatCompact(w.filledFiat)}`
          : side.quote?.gapPct != null && side.quote.gapPct > 0.00005
            ? `${formatPct(side.quote.gapPct, { frac: 2, sign: true })} vs best`
            : "at best"}
      </span>
    </>
  );
}
