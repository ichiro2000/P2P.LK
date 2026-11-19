"use client";

import { useState } from "react";
import { Area, AreaChart, CartesianGrid, XAxis, YAxis } from "recharts";
import {
  ANIM,
  C,
  ChartCard,
  ChartEmpty,
  ChartFrame,
  GRID,
  MARGIN,
  TimeTooltip,
  axisX,
  axisY,
  spanOf,
  timeTick,
  type ChartConfig,
} from "@/components/charts/kit";
import { Card } from "@/components/ui/card";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { FIAT } from "@/lib/constants";
import { formatCompact, formatInt, formatPct, formatSLT } from "@/lib/format";
import { shareOf, type SharePoint, type ShareNow } from "@/lib/compare";

const config = {
  binance: { label: "Binance", color: C.fg },
  bybit: { label: "Bybit", color: C.c3 },
} satisfies ChartConfig;

type Metric = "ads" | "vol";

/** Binance vs Bybit share of LKR ads and of listed volume, now and over time. */
export function MarketShare({
  series,
  now,
  range,
}: {
  series: SharePoint[];
  now: ShareNow;
  range: string;
}) {
  const [metric, setMetric] = useState<Metric>("ads");

  const data = series
    .map((p) => {
      const a = metric === "ads" ? p.binanceAds : p.binanceVol;
      const b = metric === "ads" ? p.bybitAds : p.bybitVol;
      const s = shareOf(a, b);
      return s == null ? null : { t: p.t, binance: s, bybit: 1 - s };
    })
    .filter((d): d is { t: number; binance: number; bybit: number } => d != null);
  const tick = timeTick(spanOf(data, (d) => d.t));

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
      <Card className="gap-4 px-4 py-4 lg:col-span-1">
        <div className="space-y-1">
          <div className="text-sm font-medium">Share right now</div>
          <div className="text-xs text-muted-foreground">
            {now
              ? `All LKR ads in the latest sweep, ${formatSLT(now.ts, { dateStyle: undefined })} SLT`
              : "Waiting for the first sweep of both exchanges."}
          </div>
        </div>
        <ShareBar
          title="Ads listed"
          a={now?.binanceAds ?? null}
          b={now?.bybitAds ?? null}
          fmt={(v) => formatInt(v)}
        />
        <ShareBar
          title="LKR within 1% of best"
          a={now?.binanceVol ?? null}
          b={now?.bybitVol ?? null}
          fmt={(v) => `${FIAT.symbol} ${formatCompact(v)}`}
        />
        <p className="text-[11px] text-muted-foreground">
          Volume share uses tradable depth near the price (both sides within 1% of their best, online and unrestricted ads, one order each), not trades done. Real volume is not
          public.
        </p>
      </Card>

      <ChartCard
        className="lg:col-span-2"
        title="Share over time"
        description={`Binance share of ${metric === "ads" ? "LKR ads" : "LKR near the price"}, ${range}.`}
        legend={[
          { label: "Binance", color: C.fg },
          { label: "Bybit", color: C.c3, dashed: true },
        ]}
        actions={
          <ToggleGroup
            value={[metric]}
            onValueChange={(v) => v[0] && setMetric(v[0] as Metric)}
            variant="outline"
            size="sm"
            spacing={0}
            aria-label="Share metric"
          >
            <ToggleGroupItem value="ads" className="px-2.5 text-xs">
              Ads
            </ToggleGroupItem>
            <ToggleGroupItem value="vol" className="px-2.5 text-xs">
              Volume
            </ToggleGroupItem>
          </ToggleGroup>
        }
      >
        {data.length < 2 ? (
          <ChartEmpty hint="Market share comes from the 5-minute merchant sweeps. Check back shortly." />
        ) : (
          <ChartFrame config={config} height="sm" label={`Binance vs Bybit share of ${metric === "ads" ? "ads" : "listed volume"} over ${range}`}>
            <AreaChart data={data} margin={MARGIN} stackOffset="expand">
              <CartesianGrid {...GRID} />
              <XAxis
                dataKey="t"
                type="number"
                scale="time"
                domain={["dataMin", "dataMax"]}
                tickFormatter={(v) => tick(Number(v))}
                {...axisX}
              />
              <YAxis {...axisY} width={40} tickFormatter={(v) => formatPct(Number(v), { frac: 0 })} />
              <TimeTooltip valueFormatter={(v) => formatPct(v, { frac: 1 })} />
              <Area
                type="monotone"
                dataKey="binance"
                name="Binance"
                stackId="s"
                stroke="var(--color-binance)"
                fill="var(--color-binance)"
                fillOpacity={0.18}
                strokeWidth={1.5}
                {...ANIM}
              />
              <Area
                type="monotone"
                dataKey="bybit"
                name="Bybit"
                stackId="s"
                stroke="var(--color-bybit)"
                strokeDasharray="5 4"
                fill="var(--color-bybit)"
                fillOpacity={0.08}
                strokeWidth={1.5}
                {...ANIM}
              />
            </AreaChart>
          </ChartFrame>
        )}
      </ChartCard>
    </div>
  );
}

function ShareBar({
  title,
  a,
  b,
  fmt,
}: {
  title: string;
  a: number | null;
  b: number | null;
  fmt: (v: number) => string;
}) {
  const s = shareOf(a, b);
  return (
    <div className="space-y-1.5">
      <div className="flex items-baseline justify-between gap-2 text-xs">
        <span className="font-medium">{title}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {s != null ? `${formatPct(s, { frac: 0 })} / ${formatPct(1 - s, { frac: 0 })}` : "—"}
        </span>
      </div>
      <div
        className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted"
        role="img"
        aria-label={
          s != null
            ? `${title}: Binance ${formatPct(s, { frac: 0 })}, Bybit ${formatPct(1 - s, { frac: 0 })}`
            : `${title}: no data`
        }
      >
        {s != null && (
          <>
            <div className="h-full transition-[width] duration-500" style={{ width: `${s * 100}%`, background: C.fg }} />
            <div
              className="h-full transition-[width] duration-500"
              style={{ width: `${(1 - s) * 100}%`, background: C.c3 }}
            />
          </>
        )}
      </div>
      <div className="flex justify-between gap-2 text-[11px] text-muted-foreground">
        <span className="truncate">
          Binance <span className="font-mono tabular-nums text-foreground">{a != null ? fmt(a) : "—"}</span>
        </span>
        <span className="truncate text-right">
          Bybit <span className="font-mono tabular-nums text-foreground">{b != null ? fmt(b) : "—"}</span>
        </span>
      </div>
    </div>
  );
}
