"use client";

import { cn } from "@/lib/utils";
import { EXCHANGES, EXCHANGE_IDS } from "@/lib/exchanges";
import { useExchange } from "./exchange-context";

/** Binance / Bybit segmented control. Instant: the tab flips immediately
 *  (optimistic) while the page re-renders with the other exchange's data. */
export function ExchangeSwitch({ className }: { className?: string }) {
  const { exchange, switching, setExchange } = useExchange();
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-md border border-border bg-card/50 p-0.5 text-[11px] font-medium",
        switching && "opacity-80",
        className,
      )}
      role="radiogroup"
      aria-label="Exchange"
      aria-busy={switching}
    >
      {EXCHANGE_IDS.map((id) => {
        const active = id === exchange;
        return (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => setExchange(id)}
            className={cn(
              "inline-flex h-7 min-w-14 items-center justify-center rounded-[5px] px-2.5 leading-none transition-colors",
              active
                ? "bg-foreground text-background"
                : "text-muted-foreground hover:text-foreground",
            )}
          >
            {EXCHANGES[id].label}
          </button>
        );
      })}
    </div>
  );
}
