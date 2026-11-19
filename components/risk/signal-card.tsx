import { AlertTriangle, CheckCircle2, Info, ShieldAlert, TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Sparkline } from "@/components/charts/sparkline";
import { cn } from "@/lib/utils";
import type { RiskSignal } from "@/lib/risk";

export type SignalLevel = RiskSignal["level"] | "ok";

const LEVEL = {
  ok: { icon: CheckCircle2, label: "normal", icon_: "text-[color:var(--color-buy)]", bar: "bg-border", badge: "text-muted-foreground" },
  info: { icon: Info, label: "info", icon_: "text-muted-foreground", bar: "bg-muted-foreground/50", badge: "text-muted-foreground" },
  warn: {
    icon: AlertTriangle,
    label: "warn",
    icon_: "text-[color:var(--color-warn)]",
    bar: "bg-[color:var(--color-warn)]",
    badge: "border-[color:var(--color-warn)]/40 text-[color:var(--color-warn)]",
  },
  alert: {
    icon: ShieldAlert,
    label: "alert",
    icon_: "text-[color:var(--color-sell)]",
    bar: "bg-[color:var(--color-sell)]",
    badge: "border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]",
  },
} as const;

/** Directional (dollar) signals: green for up, red for down, as elsewhere. */
const DIRECTION = {
  up: { icon: TrendingUp, icon_: "text-[color:var(--color-buy)]", bar: "bg-[color:var(--color-buy)]", label: "USDT up" },
  down: { icon: TrendingDown, icon_: "text-[color:var(--color-sell)]", bar: "bg-[color:var(--color-sell)]", label: "USDT down" },
} as const;

/**
 * One risk signal (or a monitored metric in its normal state): level,
 * title, metric, explanation and — when the data allows — a sparkline of
 * the series that triggered it.
 */
export function SignalCard({
  signal,
  level = signal.level,
  sparkTone = "neutral",
  sparkLabel,
}: {
  signal: Pick<RiskSignal, "id" | "title" | "detail" | "metric" | "spark" | "direction"> & { level: SignalLevel };
  level?: SignalLevel;
  sparkTone?: "auto" | "buy" | "sell" | "neutral";
  sparkLabel?: string;
}) {
  const cfg = LEVEL[level];
  const dir = level !== "ok" && signal.direction ? DIRECTION[signal.direction] : null;
  const Icon = dir?.icon ?? cfg.icon;
  // A directional "info" is a watch item (e.g. the CBSL day change).
  const badge = dir && level === "info" ? "watch" : cfg.label;
  const spark = signal.spark?.filter((v) => v != null) ?? [];
  return (
    <Card className="relative gap-0 overflow-hidden px-4 py-3.5">
      <span aria-hidden className={cn("absolute inset-y-0 left-0 w-1", dir?.bar ?? cfg.bar)} />
      <div className="flex items-start gap-3">
        <Icon className={cn("mt-0.5 size-4 shrink-0", dir?.icon_ ?? cfg.icon_)} strokeWidth={1.75} aria-hidden />
        <div className="min-w-0 flex-1 space-y-1">
          <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
            <h3 className="text-sm font-medium">{signal.title}</h3>
            <Badge variant="outline" className={cn("h-5 text-[10px] uppercase tracking-wide", cfg.badge)}>
              <span className="sr-only">{dir ? `${dir.label}, level: ` : "Level: "}</span>
              {badge}
            </Badge>
          </div>
          {signal.metric && (
            <div className="font-mono text-xs tabular-nums text-foreground/80">{signal.metric}</div>
          )}
          <p className="text-xs leading-relaxed text-pretty text-muted-foreground">{signal.detail}</p>
        </div>
      </div>
      {spark.length > 1 && (
        <Sparkline
          values={signal.spark ?? []}
          tone={level === "alert" ? "sell" : sparkTone}
          className="mt-2 h-10"
          label={sparkLabel ?? `${signal.title} trend`}
        />
      )}
    </Card>
  );
}
