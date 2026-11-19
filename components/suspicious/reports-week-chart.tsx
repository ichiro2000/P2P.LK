"use client";

import { Bar, BarChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
  ChartCard,
  ChartEmpty,
  ChartFrame,
  GRID,
  MARGIN,
  ValueTooltip,
  axisX,
  axisY,
  type ChartConfig,
} from "@/components/charts/kit";
import { SLT_TZ } from "@/lib/constants";

export type WeekPoint = { t: number; reports: number };

const config = {
  reports: { label: "Reports", color: C.sell },
} satisfies ChartConfig;

const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone: SLT_TZ, day: "numeric", month: "short" });

/** New registry reports per week (week starting on the labelled day, SLT). */
export function ReportsWeekChart({ weeks }: { weeks: WeekPoint[] }) {
  const total = weeks.reduce((s, w) => s + w.reports, 0);
  // String x values so the shadcn tooltip receives the label itself.
  const data = weeks.map((w) => ({ ...w, label: dayMonth.format(w.t) }));
  return (
    <ChartCard
      title="Reports per week"
      description={`Last ${weeks.length} weeks · ${total} report${total === 1 ? "" : "s"}`}
    >
      {total === 0 ? (
        <ChartEmpty title="No reports in this window" hint="New reports appear here as they are filed." />
      ) : (
        <ChartFrame config={config} height="sm" label={`Reports filed per week over the last ${weeks.length} weeks`}>
          <BarChart data={data} margin={MARGIN}>
            <CartesianGrid {...GRID} />
            <XAxis dataKey="label" {...axisX} />
            <YAxis {...axisY} width={28} allowDecimals={false} />
            <ValueTooltip
              labelFormatter={(l) => `Week of ${String(l)}`}
              valueFormatter={(v) => String(v)}
            />
            <Bar dataKey="reports" fill="var(--color-reports)" radius={[3, 3, 0, 0]} maxBarSize={28} {...ANIM} />
          </BarChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
