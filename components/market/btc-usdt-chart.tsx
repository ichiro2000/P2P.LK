"use client";

import { useMemo, useState } from "react";
import { CartesianGrid, Line, LineChart, ReferenceLine, XAxis, YAxis } from "recharts";
import {
  ANIM,
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
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { usePolling } from "@/hooks/use-polling";
import type { MarketHistoryPoint } from "./market-kpis";
import type { BtcPoint, BtcSpot } from "@/lib/btc";
import type { GooglePoint } from "@/lib/fx/google-view";
import type { MarketSnapshot } from "@/lib/types";
import { formatFiat, formatPct, formatPrice } from "@/lib/format";
import { FIAT } from "@/lib/constants";
import { cn } from "@/lib/utils";

type Mode = "change" | "price";

const config = {
  usdt: { label: "USDT/LKR (P2P mid)", color: "var(--color-chart-1)" },
  google: { label: "Google USD/LKR", color: "var(--color-chart-3)" },
  btc: { label: "BTC/USDT", color: "#f7931a" },
} satisfies ChartConfig;

type Row = { t: number; usdt: number | null; google: number | null; btc: number | null };

/**
 * Last value at or before t (step), from points sorted oldest first. Older
 * than `maxAgeMs` counts as missing, so a gap in the collector shows as a gap
 * instead of a flat line.
 */
function stepAt<P extends { t: number }>(
  points: P[],
  t: number,
  get: (p: P) => number | null,
  maxAgeMs = Infinity,
): number | null {
  let v: number | null = null;
  let at = -Infinity;
  for (const p of points) {
    if (p.t > t) break;
    const x = get(p);
    if (x != null) {
      v = x;
      at = p.t;
    }
  }
  return v != null && t - at <= maxAgeMs ? v : null;
}

const first = (rows: Row[], k: keyof Row) => rows.find((r) => r[k] != null)?.[k] ?? null;
const last = (rows: Row[], k: keyof Row) => [...rows].reverse().find((r) => r[k] != null)?.[k] ?? null;
const chg = (a: number | null, b: number | null) => (a != null && b != null && a > 0 ? b / a - 1 : null);

function Stat({ label, value, change }: { label: string; value: string; change: number | null }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[11px] text-muted-foreground">{label}</div>
      <div className="font-mono text-sm font-semibold tabular-nums">{value}</div>
      <div
        className={cn(
          "font-mono text-[11px] tabular-nums text-muted-foreground",
          change != null && change > 0 && "text-[color:var(--color-buy)]",
          change != null && change < 0 && "text-[color:var(--color-sell)]",
        )}
      >
        {change == null ? "—" : `${formatPct(change, { frac: 2, sign: true })} 24h`}
      </div>
    </div>
  );
}

/**
 * 24 h of the USDT/LKR P2P mid next to the Google USD/LKR rate and Bitcoin
 * (BTC/USDT), on 15-minute steps, with
 * the live prices as the last point. "% change" puts every line on one
 * scale so the moves can be compared.
 */
export function BtcUsdtChart({
  market,
  history,
}: {
  market: MarketSnapshot;
  /** 24 h USDT/LKR book history (same book as the page). */
  history: MarketHistoryPoint[];
}) {
  const [mode, setMode] = useState<Mode>("price");
  const { data: g } = usePolling<{ points: GooglePoint[] }>("/api/rates/google?range=24h", { intervalMs: 5 * 60_000 });
  const { data: h } = usePolling<{ points: BtcPoint[] }>("/api/p2p/btc/history", { intervalMs: 5 * 60_000 });
  const { data: spot } = usePolling<BtcSpot>("/api/p2p/btc", { intervalMs: 20_000 });

  const rows = useMemo<Row[]>(() => {
    const btcPts = h?.points ?? [];
    const gPts = (g?.points ?? []).filter((p) => p.google != null);
    const usdtPts = history
      .filter((p) => p.bid != null && p.ask != null)
      .map((p) => ({ t: p.t, mid: (p.bid! + p.ask!) / 2 }));
    // x axis: Bitcoin's 15-minute closes (open time + 15 min).
    const out: Row[] = btcPts.map((b) => {
      const t = b.t + 15 * 60_000;
      const usdt = stepAt(usdtPts, t, (p) => p.mid, 60 * 60_000);
      const google = stepAt(gPts, t, (p) => p.google, 2 * 3600_000);
      return { t, usdt, google, btc: b.price };
    });
    // Live point: the polled book and spot price.
    const liveBtc = spot?.price ?? btcPts.at(-1)?.price ?? null;
    const liveUsdt = market.mid;
    if (liveUsdt != null || liveBtc != null) {
      out.push({
        t: Math.max(Date.parse(market.fetchedAt) || 0, (out.at(-1)?.t ?? 0) + 60_000),
        usdt: liveUsdt,
        google: gPts.at(-1)?.google ?? null,
        btc: liveBtc,
      });
    }
    return out;
  }, [g, h, spot, history, market.mid, market.fetchedAt]);

  const base = useMemo(
    () => ({ usdt: first(rows, "usdt"), google: first(rows, "google"), btc: first(rows, "btc") }),
    [rows],
  );
  const now = { usdt: last(rows, "usdt"), google: last(rows, "google"), btc: last(rows, "btc") };

  const data = useMemo(
    () =>
      mode === "price"
        ? rows
        : rows.map((r) => ({
            t: r.t,
            usdt: chg(base.usdt, r.usdt),
            google: chg(base.google, r.google),
            btc: chg(base.btc, r.btc),
          })),
    [rows, mode, base],
  );
  const tick = timeTick(spanOf(data, (d) => d.t));
  const premium = now.usdt != null && now.google ? now.usdt / now.google - 1 : null;
  const sym = FIAT.symbol;

  return (
    <ChartCard
      title="USDT/LKR, Google rate and Bitcoin: last 24 hours"
      description={
        mode === "change"
          ? "Change since 24 h ago for USDT/LKR, the Google rate and BTC/USDT, on one scale."
          : "USDT/LKR and Google USD/LKR on the left axis (LKR), BTC/USDT on the right axis."
      }
      legend={[
        { label: config.usdt.label, color: config.usdt.color },
        { label: config.google.label, color: config.google.color, dashed: true },
        { label: config.btc.label, color: config.btc.color },
      ]}
      actions={
        <ToggleGroup
          value={[mode]}
          onValueChange={(v) => v[0] && setMode(v[0] as Mode)}
          variant="outline"
          size="sm"
          spacing={0}
          aria-label="Chart view"
        >
          <ToggleGroupItem value="price" className="px-2.5 text-xs">
            Prices
          </ToggleGroupItem>
          <ToggleGroupItem value="change" className="px-2.5 text-xs">
            % change
          </ToggleGroupItem>
        </ToggleGroup>
      }
      footer="15-minute steps. USDT/LKR from our P2P collector (same book as above), Google USD/LKR as last published, Bitcoin from exchange spot closes. The last point is live."
    >
      <div className="grid grid-cols-2 gap-3 px-4 sm:grid-cols-4">
        <Stat label="USDT/LKR (P2P mid)" value={formatFiat(now.usdt, sym, 2)} change={chg(base.usdt, now.usdt)} />
        <Stat label="Google USD/LKR" value={formatFiat(now.google, sym, 2)} change={chg(base.google, now.google)} />
        <div className="min-w-0">
          <div className="truncate text-[11px] text-muted-foreground">USDT premium vs Google</div>
          <div className="font-mono text-sm font-semibold tabular-nums">
            {premium == null ? "—" : formatPct(premium, { frac: 2, sign: true })}
          </div>
          <div className="font-mono text-[11px] tabular-nums text-muted-foreground">
            {now.usdt != null && now.google != null ? `${formatFiat(now.usdt - now.google, sym, 2)} per USDT` : ""}
          </div>
        </div>
        <Stat label="BTC/USDT" value={formatPrice(now.btc, 2)} change={chg(base.btc, now.btc)} />
      </div>

      {rows.length < 3 ? (
        <ChartEmpty title="Loading 24 h history…" hint="Needs the P2P collector and the Bitcoin price feed." />
      ) : (
        <ChartFrame config={config} height="lg" label="USDT/LKR, Google USD/LKR and Bitcoin over 24 hours">
          <LineChart data={data} margin={{ ...MARGIN, right: mode === "price" ? 0 : MARGIN.right }}>
            <CartesianGrid {...GRID} />
            <XAxis
              dataKey="t"
              type="number"
              scale="time"
              domain={["dataMin", "dataMax"]}
              tickFormatter={(v) => tick(Number(v))}
              {...axisX}
            />
            {mode === "change" ? (
              <>
                <YAxis yAxisId="l" {...axisY} tickFormatter={(v) => `${(Number(v) * 100).toFixed(1)}%`} />
                <ReferenceLine yAxisId="l" y={0} stroke="var(--color-border)" />
              </>
            ) : (
              <>
                <YAxis
                  yAxisId="l"
                  {...axisY}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => Number(v).toFixed(1)}
                />
                <YAxis
                  yAxisId="r"
                  orientation="right"
                  {...axisY}
                  domain={["auto", "auto"]}
                  tickFormatter={(v) => `${(Number(v) / 1000).toFixed(1)}k`}
                />
              </>
            )}
            <TimeTooltip
              valueFormatter={(v, key) =>
                mode === "change"
                  ? formatPct(v, { frac: 2, sign: true })
                  : key === "btc"
                    ? `${formatPrice(v, 2)} USDT`
                    : formatFiat(v, sym, 2)
              }
            />
            <Line yAxisId="l" type="monotone" dataKey="usdt" name={config.usdt.label} stroke="var(--color-usdt)" strokeWidth={2} dot={false} {...ANIM} />
            <Line yAxisId="l" type="stepAfter" dataKey="google" name={config.google.label} stroke="var(--color-google)" strokeWidth={1.75} strokeDasharray="5 4" dot={false} {...ANIM} />
            <Line yAxisId={mode === "price" ? "r" : "l"} type="monotone" dataKey="btc" name={config.btc.label} stroke="var(--color-btc)" strokeWidth={1.75} dot={false} connectNulls {...ANIM} />
          </LineChart>
        </ChartFrame>
      )}
    </ChartCard>
  );
}
