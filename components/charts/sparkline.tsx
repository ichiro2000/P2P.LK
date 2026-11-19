"use client";

import { useId } from "react";
import { Area, AreaChart, YAxis } from "recharts";
import { ChartContainer } from "@/components/ui/chart";
import { cn } from "@/lib/utils";
import { ANIM } from "./kit";

/**
 * Tiny trend line for KPI cards and table rows. No axes, no tooltip.
 * `tone` picks the colour: up/down follow the first→last change unless forced.
 */
export function Sparkline({
  values,
  tone = "auto",
  className,
  label,
}: {
  values: readonly (number | null)[];
  tone?: "auto" | "buy" | "sell" | "neutral";
  className?: string;
  label?: string;
}) {
  const id = useId().replace(/:/g, "");
  const pts = values.filter((v): v is number => v != null && Number.isFinite(v));
  if (pts.length < 2) return <div className={cn("h-8 w-full", className)} aria-hidden />;

  const resolved =
    tone === "auto" ? (pts[pts.length - 1] >= pts[0] ? "buy" : "sell") : tone;
  const color =
    resolved === "buy"
      ? "var(--color-buy)"
      : resolved === "sell"
        ? "var(--color-sell)"
        : "var(--color-chart-2)";
  const data = values.map((v, i) => ({ i, v }));

  return (
    <ChartContainer
      config={{ v: { label: label ?? "value", color } }}
      className={cn("aspect-auto h-8 w-full", className)}
      role="img"
      aria-label={label}
    >
      <AreaChart data={data} margin={{ top: 2, right: 0, bottom: 2, left: 0 }}>
        <defs>
          <linearGradient id={`sp-${id}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.25} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <YAxis hide domain={["dataMin", "dataMax"]} />
        <Area
          dataKey="v"
          type="monotone"
          stroke={color}
          strokeWidth={1.5}
          fill={`url(#sp-${id})`}
          dot={false}
          connectNulls
          {...ANIM}
        />
      </AreaChart>
    </ChartContainer>
  );
}
