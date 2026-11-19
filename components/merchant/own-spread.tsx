"use client";

import { Settings2 } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { FeeSettingsControl } from "@/components/common/fee-settings";
import { useFeeSettings } from "@/hooks/use-fee-settings";
import { LEVEL_LABEL, makerFeeRate, pctText } from "@/lib/fees";
import { netOwnSpread, ownSpread, spreadVsMedian, type SpreadMedian } from "@/lib/competitors";
import { FIAT } from "@/lib/constants";
import { formatFiat, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

const S = FIAT.symbol;

/** "Your fees" link: opens the shared fee settings (merchant level, base fee). */
export function YourFeesButton({ className }: { className?: string }) {
  return (
    <Popover>
      <PopoverTrigger
        className={cn(
          "-my-2 inline-flex min-h-8 items-center gap-1 rounded-md text-foreground underline underline-offset-4 hover:text-foreground/80 focus-visible:outline-2",
          className,
        )}
      >
        <Settings2 className="size-3" aria-hidden />
        Your fees
      </PopoverTrigger>
      <PopoverContent side="bottom" align="start" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <FeeSettingsControl className="border-0" />
      </PopoverContent>
    </Popover>
  );
}

/**
 * The own spread after the visitor's maker fee on both legs:
 * ask × (1 − fee) − bid ÷ (1 − fee), per USDT. Client-only because the fee
 * settings live in localStorage.
 */
export function NetOwnSpread({ ask, bid, className }: { ask: number | null; bid: number | null; className?: string }) {
  const [fees] = useFeeSettings();
  const fee = makerFeeRate(fees);
  const net = netOwnSpread(ask, bid, fee);
  if (net == null) return null;
  return (
    <span className={cn("inline-flex flex-wrap items-center gap-x-1.5", className)}>
      <span>
        After {pctText(fee)} maker fee ({LEVEL_LABEL[fees.level]}):{" "}
        <span
          className={cn(
            "font-mono font-medium tabular-nums",
            net < 0 ? "text-[color:var(--color-sell)]" : "text-foreground",
          )}
        >
          {formatFiat(net, S, 2)}
        </span>
      </span>
      <span aria-hidden>·</span>
      <YourFeesButton />
    </span>
  );
}

/** One line of own spread for lists: "Rs 1.20 · 0.37%", or "one side only". */
export function OwnSpreadText({
  ask,
  bid,
  stacked = false,
  className,
}: {
  ask: number | null;
  bid: number | null;
  /** Percent on a second line (narrow table columns). */
  stacked?: boolean;
  className?: string;
}) {
  const s = ownSpread(ask, bid);
  if (!s) return <span className={cn("text-muted-foreground", className)}>one side only</span>;
  return (
    <span
      className={cn(
        "font-mono tabular-nums",
        stacked && "inline-flex flex-col items-end leading-tight",
        s.lkr < 0 && "text-[color:var(--color-warn)]",
        className,
      )}
    >
      <span>{formatFiat(s.lkr, S, 2)}</span>
      <span className="text-muted-foreground">
        {stacked ? "" : " · "}
        {formatPct(s.pct, { frac: 2 })}
      </span>
    </span>
  );
}

/** "Market median Rs 1.10 (0.33%) across 42 two-sided merchants · yours is wide". */
export function SpreadMedianText({
  median,
  ask,
  bid,
  scope = "merchants",
}: {
  median: SpreadMedian | null;
  ask?: number | null;
  bid?: number | null;
  scope?: string;
}) {
  if (!median) return <span>No two-sided {scope} right now</span>;
  const verdict = ask !== undefined ? spreadVsMedian(ownSpread(ask, bid), median) : null;
  return (
    <span>
      Median{" "}
      <span className="font-mono tabular-nums text-foreground">
        {formatFiat(median.lkr, S, 2)} ({formatPct(median.pct, { frac: 2 })})
      </span>{" "}
      across {median.count} two-sided {scope}
      {verdict && (
        <>
          {" · "}
          <span className={cn(verdict === "wide" && "text-[color:var(--color-warn)]", verdict === "tight" && "text-foreground")}>
            yours is {verdict}
          </span>
        </>
      )}
    </span>
  );
}
