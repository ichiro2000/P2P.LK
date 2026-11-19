import { ArrowDownRight, ArrowUpRight } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Sparkline } from "@/components/charts/sparkline";
import { cn } from "@/lib/utils";

/**
 * Dashboard KPI tile: label, big mono number, optional change and sparkline.
 * Works as a server component (Sparkline is a client island).
 */
export function KpiCard({
  label,
  value,
  sub,
  change,
  changeLabel,
  tone,
  spark,
  sparkTone = "auto",
  icon,
  footer,
  className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  /** Fractional change: 0.012 = +1.2 %. */
  change?: number | null;
  changeLabel?: string;
  /** Colour of the value itself (buy/sell). */
  tone?: "buy" | "sell";
  spark?: readonly (number | null)[];
  sparkTone?: "auto" | "buy" | "sell" | "neutral";
  icon?: React.ReactNode;
  /** Extra line under the sub row (e.g. the for-your-amount price). */
  footer?: React.ReactNode;
  className?: string;
}) {
  const up = change != null && change > 0;
  const down = change != null && change < 0;
  return (
    <Card className={cn("gap-2 px-4 py-3.5", className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate text-xs text-muted-foreground">{label}</span>
        {icon}
      </div>
      <div
        className={cn(
          "font-mono text-xl font-semibold leading-none tracking-tight tabular-nums sm:text-2xl",
          tone === "buy" && "text-[color:var(--color-buy)]",
          tone === "sell" && "text-[color:var(--color-sell)]",
        )}
      >
        {value}
      </div>
      {(change != null || sub) && (
        <div className="flex min-w-0 items-center gap-1.5 text-[11px] text-muted-foreground">
          {change != null && Number.isFinite(change) && (
            <span
              className={cn(
                "inline-flex items-center gap-0.5 font-mono tabular-nums",
                up && "text-[color:var(--color-buy)]",
                down && "text-[color:var(--color-sell)]",
              )}
            >
              {up ? <ArrowUpRight className="size-3" /> : down ? <ArrowDownRight className="size-3" /> : null}
              {`${up ? "+" : ""}${(change * 100).toFixed(2)}%`}
            </span>
          )}
          {changeLabel && <span>{changeLabel}</span>}
          {sub && <span className="truncate">{sub}</span>}
        </div>
      )}
      {footer && <div className="min-w-0 text-[11px] text-muted-foreground">{footer}</div>}
      {spark && spark.length > 1 && (
        <Sparkline values={spark} tone={sparkTone} className="-mx-1 mt-0.5" label={`${label} trend`} />
      )}
    </Card>
  );
}
