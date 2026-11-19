"use client";

/**
 * Shared chart kit — every chart in the app is built from these pieces so
 * they look, animate and behave the same:
 *
 * - `ChartFrame`   shadcn <ChartContainer> with a responsive height and
 *                  theme-aware series colours (light + dark).
 * - `axisX/axisY`  quiet mono ticks, no axis lines.
 * - `GRID`         horizontal dashed gridlines only.
 * - `ANIM`         one short ease-out for every series, so polling updates
 *                  glide instead of jumping.
 * - `ChartCard`    card shell with title, description, legend and actions.
 * - `Legend`       inline swatches (works for solid, dashed and muted).
 * - `TimeTooltip`  shadcn tooltip that formats the x value as SLT time.
 *
 * Colours: buy = var(--color-buy), sell = var(--color-sell), neutral series
 * use var(--color-chart-1..5) (grayscale ramp, flips in dark mode).
 */

import type * as React from "react";
import {
  ChartContainer,
  ChartTooltip,
  ChartTooltipContent,
  type ChartConfig,
} from "@/components/ui/chart";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { SLT_TZ } from "@/lib/constants";

export type { ChartConfig };

/** Series palette. Use these keys in ChartConfig colours. */
export const C = {
  buy: "var(--color-buy)",
  sell: "var(--color-sell)",
  warn: "var(--color-warn)",
  fg: "var(--color-chart-1)",
  c2: "var(--color-chart-2)",
  c3: "var(--color-chart-3)",
  c4: "var(--color-chart-4)",
  c5: "var(--color-chart-5)",
  muted: "var(--color-muted-foreground)",
  border: "var(--color-border)",
} as const;

/** One animation for every series: short and smooth. */
export const ANIM = {
  isAnimationActive: true,
  animationDuration: 450,
  animationEasing: "ease-out",
} as const;

const TICK = {
  fill: "var(--color-muted-foreground)",
  fontSize: 10,
  fontFamily: "var(--font-mono)",
} as const;

export const axisX = {
  tick: TICK,
  axisLine: false,
  tickLine: false,
  tickMargin: 8,
  minTickGap: 28,
} as const;

export const axisY = {
  tick: TICK,
  axisLine: false,
  tickLine: false,
  tickMargin: 4,
  width: 56,
} as const;

export const GRID = {
  vertical: false,
  strokeDasharray: "3 3",
  stroke: "var(--color-border)",
} as const;

/** Standard margins: tight on phones, no wasted gutters. */
export const MARGIN = { top: 8, right: 8, bottom: 0, left: 0 } as const;

/** Height presets. Phones get shorter charts so the page stays scannable. */
const HEIGHTS = {
  xs: "h-24",
  sm: "h-44 sm:h-52",
  md: "h-56 sm:h-72",
  lg: "h-64 sm:h-80 lg:h-96",
} as const;

export function ChartFrame({
  config,
  height = "md",
  className,
  children,
  label,
  interactive = false,
}: {
  config: ChartConfig;
  height?: keyof typeof HEIGHTS;
  className?: string;
  /** Text alternative for screen readers. */
  label?: string;
  /** Has its own keyboard controls (e.g. a range brush): exposed as a named
   *  group instead of an image, which can't contain focusable parts. */
  interactive?: boolean;
  children: React.ComponentProps<typeof ChartContainer>["children"];
}) {
  return (
    <ChartContainer
      config={config}
      role={interactive ? "group" : "img"}
      aria-label={label}
      className={cn("aspect-auto w-full", HEIGHTS[height], className)}
    >
      {children}
    </ChartContainer>
  );
}

/* ── Time formatting (always Sri Lanka time) ───────────────────────────── */

const fmtCache = new Map<string, Intl.DateTimeFormat>();
function dtf(key: string, opts: Intl.DateTimeFormatOptions) {
  let f = fmtCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", { timeZone: SLT_TZ, ...opts });
    fmtCache.set(key, f);
  }
  return f;
}

/** Pick a tick format from the visible span (ms). */
export function timeTick(spanMs: number) {
  const day = 86_400_000;
  if (spanMs <= day * 1.1)
    return (v: number) => dtf("hm", { hour: "2-digit", minute: "2-digit", hour12: false }).format(v);
  if (spanMs <= day * 8)
    return (v: number) => dtf("dh", { weekday: "short", hour: "2-digit", hour12: false }).format(v);
  if (spanMs <= day * 400)
    return (v: number) => dtf("dm", { day: "numeric", month: "short" }).format(v);
  return (v: number) => dtf("my", { month: "short", year: "2-digit" }).format(v);
}

export function fullTime(v: number) {
  return dtf("full", {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(v);
}

export function spanOf<T>(rows: readonly T[], key: (r: T) => number) {
  if (rows.length < 2) return 0;
  return key(rows[rows.length - 1]) - key(rows[0]);
}

/** Recharts tooltip for time-series charts (x = epoch ms). */
export function TimeTooltip({
  valueFormatter,
  indicator = "line",
}: {
  valueFormatter?: (v: number, key: string) => string;
  indicator?: "line" | "dot" | "dashed";
}) {
  return (
    <ChartTooltip
      cursor={{ stroke: "var(--color-border)", strokeWidth: 1 }}
      content={
        <ChartTooltipContent
          indicator={indicator}
          labelFormatter={(_, payload) => {
            const t = (payload?.[0]?.payload as { t?: number } | undefined)?.t;
            return t ? fullTime(t) : "";
          }}
          formatter={
            valueFormatter
              ? (value, name, item) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: item.color }}
                      />
                      {String(item.name ?? name)}
                    </span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {valueFormatter(Number(value), String(item.dataKey ?? name))}
                    </span>
                  </div>
                )
              : undefined
          }
        />
      }
    />
  );
}

/** Plain (non-time) tooltip with an optional value formatter. */
export function ValueTooltip({
  valueFormatter,
  labelFormatter,
  indicator = "dot",
}: {
  valueFormatter?: (v: number, key: string) => string;
  labelFormatter?: (label: unknown) => React.ReactNode;
  indicator?: "line" | "dot" | "dashed";
}) {
  return (
    <ChartTooltip
      cursor={{ fill: "var(--color-muted)", opacity: 0.5 }}
      content={
        <ChartTooltipContent
          indicator={indicator}
          labelFormatter={labelFormatter ? (l) => labelFormatter(l) : undefined}
          formatter={
            valueFormatter
              ? (value, name, item) => (
                  <div className="flex w-full items-center justify-between gap-3">
                    <span className="flex items-center gap-1.5 text-muted-foreground">
                      <span
                        className="size-2 shrink-0 rounded-[2px]"
                        style={{ background: item.color ?? item.payload?.fill }}
                      />
                      {String(item.name ?? name)}
                    </span>
                    <span className="font-mono font-medium tabular-nums text-foreground">
                      {valueFormatter(Number(value), String(item.dataKey ?? name))}
                    </span>
                  </div>
                )
              : undefined
          }
        />
      }
    />
  );
}

/** Vertical gradient for area fills. Put inside <defs>. */
export function FadeGradient({ id, color, from = 0.28 }: { id: string; color: string; from?: number }) {
  return (
    <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor={color} stopOpacity={from} />
      <stop offset="100%" stopColor={color} stopOpacity={0} />
    </linearGradient>
  );
}

/* ── Card + legend ─────────────────────────────────────────────────────── */

export type LegendItem = {
  label: string;
  color: string;
  dashed?: boolean;
  /** Hidden series render as a struck, faded swatch. */
  hidden?: boolean;
  onClick?: () => void;
};

export function Legend({ items, className }: { items: LegendItem[]; className?: string }) {
  return (
    <div className={cn("flex flex-wrap items-center gap-x-3 gap-y-1", className)}>
      {items.map((it) => {
        const body = (
          <>
            <span
              aria-hidden
              className="inline-block h-0 w-3"
              style={{
                borderTop: `2px ${it.dashed ? "dashed" : "solid"} ${it.color}`,
              }}
            />
            <span className={cn(it.hidden && "line-through")}>{it.label}</span>
          </>
        );
        const cls = cn(
          "inline-flex items-center gap-1.5 text-[11px] text-muted-foreground",
          it.hidden && "opacity-50",
        );
        return it.onClick ? (
          <button
            key={it.label}
            type="button"
            onClick={it.onClick}
            aria-pressed={!it.hidden}
            className={cn(cls, "min-h-6 rounded-sm hover:text-foreground focus-visible:outline-2")}
          >
            {body}
          </button>
        ) : (
          <span key={it.label} className={cls}>
            {body}
          </span>
        );
      })}
    </div>
  );
}

export function ChartCard({
  title,
  description,
  legend,
  actions,
  footer,
  className,
  contentClassName,
  children,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  legend?: LegendItem[];
  /** Right side of the header (range tabs, toggles…). Wraps under the title on phones. */
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  className?: string;
  contentClassName?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className={cn("gap-3 py-4", className)}>
      <CardHeader className="flex flex-col gap-2 px-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <CardTitle className="text-sm font-medium">{title}</CardTitle>
          {description && (
            <CardDescription className="text-xs">{description}</CardDescription>
          )}
          {legend && <Legend items={legend} className="pt-1" />}
        </div>
        {actions && <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div>}
      </CardHeader>
      <CardContent className={cn("px-2 sm:px-4", contentClassName)}>{children}</CardContent>
      {footer && <div className="px-4 text-[11px] text-muted-foreground">{footer}</div>}
    </Card>
  );
}

/** Placeholder shown inside a chart area when there aren't enough points. */
export function ChartEmpty({
  title = "Not enough data yet",
  hint = "The collector adds a point every minute — check back shortly.",
  className,
}: {
  title?: string;
  hint?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex h-full min-h-40 flex-col items-center justify-center gap-1 rounded-md border border-dashed text-center",
        className,
      )}
    >
      <span className="text-sm text-foreground">{title}</span>
      <span className="max-w-xs text-xs text-muted-foreground">{hint}</span>
    </div>
  );
}
