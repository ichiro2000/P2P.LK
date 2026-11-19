"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import { ANIM, C, ChartFrame, GRID, MARGIN, ValueTooltip, axisX, axisY } from "@/components/charts/kit";

/** Sign-ups per Sri Lanka day, last 30 days. */
export function SignupsChart({ data }: { data: { label: string; n: number }[] }) {
  return (
    <ChartFrame
      config={{ n: { label: "Sign-ups", color: C.fg } }}
      height="sm"
      label="Sign-ups per day, last 30 days"
    >
      <BarChart data={data} margin={MARGIN}>
        <CartesianGrid {...GRID} />
        <XAxis dataKey="label" {...axisX} interval="preserveStartEnd" />
        <YAxis {...axisY} width={28} allowDecimals={false} />
        <ValueTooltip valueFormatter={(v) => String(v)} />
        <Bar dataKey="n" fill="var(--color-n)" radius={[3, 3, 0, 0]} maxBarSize={18} {...ANIM} />
      </BarChart>
    </ChartFrame>
  );
}
