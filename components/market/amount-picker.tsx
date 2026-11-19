"use client";

import { useId, useState } from "react";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  TRADE_AMOUNT_PRESETS,
  parseTradeAmount,
  useIncludeAllAds,
  useTradeAmount,
} from "@/hooks/use-trade-amount";
import { FIAT } from "@/lib/constants";
import { formatCompact } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * "Your amount" control: an LKR input plus presets, shared across Markets,
 * Compare and Arbitrage (remembered in localStorage). Optionally the switch
 * that lets walks use offline and restricted ads.
 */
export function AmountPicker({
  label = "Your amount",
  showIncludeAll = true,
  className,
}: {
  label?: string;
  showIncludeAll?: boolean;
  className?: string;
}) {
  const id = useId();
  const [amount, setAmount] = useTradeAmount();
  const [includeAll, setIncludeAll] = useIncludeAllAds();
  // While typing, keep the raw text so "" or "1," don't snap back.
  const [draft, setDraft] = useState<string | null>(null);

  return (
    <div className={cn("flex flex-col gap-3 md:flex-row md:flex-wrap md:items-end md:gap-x-5", className)}>
      <div className="flex min-w-0 flex-col gap-1.5">
        <label htmlFor={`${id}-amt`} className="text-xs text-muted-foreground">
          {label} ({FIAT.code})
        </label>
        <div className="flex items-center gap-2">
          <span className="font-mono text-sm text-muted-foreground">{FIAT.symbol}</span>
          <Input
            id={`${id}-amt`}
            inputMode="numeric"
            value={draft ?? amount.toLocaleString("en-US")}
            onChange={(e) => {
              setDraft(e.target.value);
              const n = Number(e.target.value.replace(/,/g, ""));
              if (Number.isFinite(n) && n > 0) setAmount(parseTradeAmount(e.target.value));
            }}
            onBlur={() => setDraft(null)}
            className="h-10 w-full font-mono tabular-nums md:h-9 md:w-40"
          />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Amount presets">
        {TRADE_AMOUNT_PRESETS.map((p) => (
          <button
            key={p}
            type="button"
            onClick={() => {
              setDraft(null);
              setAmount(p);
            }}
            aria-pressed={amount === p}
            className={cn(
              "h-10 min-w-12 rounded-md border px-3 font-mono text-xs tabular-nums transition-colors md:h-9",
              amount === p
                ? "border-foreground/30 bg-muted text-foreground"
                : "border-border text-muted-foreground hover:text-foreground",
            )}
          >
            {formatCompact(p)}
          </button>
        ))}
      </div>
      {showIncludeAll && (
        <label htmlFor={`${id}-all`} className="flex min-h-10 cursor-pointer items-center gap-2 text-xs md:min-h-9">
          <Switch id={`${id}-all`} checked={includeAll} onCheckedChange={(v) => setIncludeAll(Boolean(v))} />
          Include offline &amp; restricted ads
        </label>
      )}
    </div>
  );
}
