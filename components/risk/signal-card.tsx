import { AlertTriangle, Info, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { RiskSignal } from "@/lib/risk";

const LEVEL_CONFIG = {
  info: {
    icon: Info,
    ring: "ring-border",
    iconClass: "text-muted-foreground",
    bar: "bg-muted-foreground/50",
  },
  warn: {
    icon: AlertTriangle,
    ring: "ring-[color:var(--color-warn)]/30",
    iconClass: "text-[color:var(--color-warn)]",
    bar: "bg-[color:var(--color-warn)]",
  },
  alert: {
    icon: ShieldAlert,
    ring: "ring-[color:var(--color-sell)]/30",
    iconClass: "text-[color:var(--color-sell)]",
    bar: "bg-[color:var(--color-sell)]",
  },
} as const;

export function SignalCard({ signal }: { signal: RiskSignal }) {
  const config = LEVEL_CONFIG[signal.level];
  const Icon = config.icon;

  return (
    <div
      className={cn(
        "card-lift relative flex gap-3 overflow-hidden rounded-lg border border-border bg-card/60 p-4 ring-1",
        config.ring,
      )}
    >
      <span
        aria-hidden
        className={cn("absolute inset-y-2 left-0 w-0.5 rounded-r-full", config.bar)}
      />
      <div
        className={cn(
          "flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-border bg-card/80",
          config.iconClass,
        )}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="text-sm font-medium text-foreground">
            {signal.title}
          </h3>
          {signal.metric && (
            <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
              {signal.metric}
            </span>
          )}
        </div>
        <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
          {signal.detail}
        </p>
      </div>
    </div>
  );
}
