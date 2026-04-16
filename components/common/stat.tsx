import { cn } from "@/lib/utils";
import { TrendingDown, TrendingUp } from "lucide-react";

export type StatProps = {
  label: string;
  value: React.ReactNode;
  /** Optional change value in % (0.015 = +1.5%) or absolute — rendered as sub-line */
  delta?: {
    value: number;
    format?: "pct" | "abs";
    /** Force semantic color. If omitted, positive=buy, negative=sell. */
    tone?: "buy" | "sell" | "muted";
  };
  /** Small text below the value */
  footnote?: string;
  /** Optional inline icon or chip on the right */
  right?: React.ReactNode;
  className?: string;
};

export function Stat({
  label,
  value,
  delta,
  footnote,
  right,
  className,
}: StatProps) {
  const deltaTone =
    delta?.tone ??
    (delta == null
      ? "muted"
      : delta.value > 0
        ? "buy"
        : delta.value < 0
          ? "sell"
          : "muted");

  return (
    <div
      className={cn(
        "flex flex-col gap-1.5",
        className,
      )}
    >
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
          {label}
        </span>
        {right}
      </div>
      <div className="flex items-baseline gap-2">
        <span className="font-mono text-2xl font-semibold tabular-nums leading-none text-foreground">
          {value}
        </span>
        {delta && Number.isFinite(delta.value) && (
          <span
            className={cn(
              "inline-flex items-center gap-1 font-mono text-[11px] font-medium tabular-nums leading-none",
              deltaTone === "buy" && "text-[color:var(--color-buy)]",
              deltaTone === "sell" && "text-[color:var(--color-sell)]",
              deltaTone === "muted" && "text-muted-foreground",
            )}
          >
            {delta.value > 0 ? (
              <TrendingUp className="h-3 w-3" strokeWidth={2} />
            ) : delta.value < 0 ? (
              <TrendingDown className="h-3 w-3" strokeWidth={2} />
            ) : null}
            {delta.format === "pct"
              ? `${delta.value > 0 ? "+" : ""}${(delta.value * 100).toFixed(2)}%`
              : `${delta.value > 0 ? "+" : ""}${delta.value.toFixed(2)}`}
          </span>
        )}
      </div>
      {footnote && (
        <span className="text-[11px] text-muted-foreground/70">
          {footnote}
        </span>
      )}
    </div>
  );
}
