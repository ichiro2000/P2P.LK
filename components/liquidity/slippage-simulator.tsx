"use client";

import { useEffect, useState } from "react";
import { Area, AreaChart, CartesianGrid, ReferenceLine, XAxis, YAxis } from "recharts";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import {
  ANIM,
  C,
  ChartCard,
  ChartFrame,
  FadeGradient,
  GRID,
  MARGIN,
  ValueTooltip,
  axisX,
  axisY,
  type ChartConfig,
} from "@/components/charts/kit";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatCompact, formatFiat, formatPct, formatPrice } from "@/lib/format";
import { getFiat } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { SlippageResult } from "@/lib/liquidity";
import type { ExchangeId } from "@/lib/exchanges";

type Side = "SELL" | "BUY";
const PRESETS = [100_000, 500_000, 1_000_000, 5_000_000] as const;

type Fetched = { key: string; result: SlippageResult | null; error: string | null };

/**
 * Walks the live top-20 book for a fiat amount: effective price, slippage,
 * how many ads / merchants it takes, and the fill curve.
 * Calls /api/liquidity/slippage, debounced 250 ms.
 */
export function SlippageSimulator({
  asset,
  fiat,
  exchange,
  defaultAmount = 500_000,
}: {
  asset: string;
  fiat: string;
  exchange: ExchangeId;
  defaultAmount?: number;
}) {
  const [side, setSide] = useState<Side>("SELL");
  const [amount, setAmount] = useState<number>(defaultAmount);
  const [fetched, setFetched] = useState<Fetched | null>(null);
  const symbol = getFiat(fiat)?.symbol ?? fiat;

  const valid = Number.isFinite(amount) && amount > 0;
  const key = `${exchange}|${side}|${amount}`;

  useEffect(() => {
    if (!valid) return;
    const ac = new AbortController();
    const id = setTimeout(async () => {
      try {
        const qs = new URLSearchParams({ exchange, side, amount: String(amount) });
        const res = await fetch(`/api/liquidity/slippage?${qs}`, { signal: ac.signal });
        const json = (await res.json()) as SlippageResult & { error?: string };
        if (!res.ok) throw new Error(json.error ?? `${res.status} ${res.statusText}`);
        setFetched({ key, result: json, error: null });
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setFetched({ key, result: null, error: (e as Error).message });
      }
    }, 250);
    return () => {
      clearTimeout(id);
      ac.abort();
    };
  }, [exchange, side, amount, valid, key]);

  // Keep showing the previous result while the next one loads.
  const result = valid ? (fetched?.result ?? null) : null;
  const error = valid ? (fetched?.error ?? null) : null;
  const loading = valid && fetched?.key !== key;

  const filled = result?.filledFiat ?? 0;
  const fillPct = amount > 0 ? filled / amount : 0;
  const isThin = (result?.shortfall ?? 0) > 0;
  const buying = side === "SELL";

  return (
    <ChartCard
      title="Slippage simulator"
      description={`Walks the live top-20 ${buying ? "Sell" : "Buy"} ads to fill your amount, respecting each ad's limits.`}
      actions={
        <Tabs value={side} onValueChange={(v) => setSide(v as Side)}>
          <TabsList aria-label="Direction">
            <TabsTrigger value="SELL" className="px-3 text-xs">
              Buy {asset}
            </TabsTrigger>
            <TabsTrigger value="BUY" className="px-3 text-xs">
              Sell {asset}
            </TabsTrigger>
          </TabsList>
        </Tabs>
      }
      contentClassName="space-y-5 px-4"
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="slip-amount" className="text-xs text-muted-foreground">
            Amount ({fiat})
          </Label>
          <div className="flex items-center gap-2">
            <span className="font-mono text-sm text-muted-foreground">{symbol}</span>
            <Input
              id="slip-amount"
              type="number"
              inputMode="numeric"
              value={amount || ""}
              onChange={(e) => setAmount(Number(e.target.value) || 0)}
              className="h-9 w-full font-mono tabular-nums sm:w-44"
              min={0}
              step={10_000}
            />
          </div>
        </div>
        <div className="flex flex-wrap gap-1.5">
          {PRESETS.map((p) => (
            <button
              key={p}
              type="button"
              onClick={() => setAmount(p)}
              aria-pressed={amount === p}
              className={cn(
                "h-9 rounded-md border px-3 font-mono text-xs tabular-nums transition-colors",
                amount === p
                  ? "border-foreground/30 bg-muted text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground",
              )}
            >
              {formatCompact(p)}
            </button>
          ))}
        </div>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Filled</span>
          <span className="font-mono tabular-nums">
            {formatFiat(filled, symbol, 0)} / {formatFiat(amount, symbol, 0)}
          </span>
        </div>
        <div
          className="h-1.5 overflow-hidden rounded-full bg-muted"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(fillPct * 100)}
          aria-label="Share of the amount the book can fill"
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              isThin ? "bg-[color:var(--color-warn)]" : "bg-foreground",
            )}
            style={{ width: `${Math.max(2, Math.min(100, fillPct * 100))}%` }}
          />
        </div>
      </div>

      {error && (
        <div className="rounded-md border border-[color:var(--color-sell)]/30 px-3 py-2 text-xs text-[color:var(--color-sell)]">
          {error}
        </div>
      )}

      <dl className={cn("grid grid-cols-2 gap-x-4 gap-y-4 md:grid-cols-4", loading && "opacity-60")}>
        <ResultStat label="Top price" value={result?.topPrice != null ? formatFiat(result.topPrice, symbol, 2) : "—"} />
        <ResultStat
          label="Effective price"
          value={result?.effectivePrice != null ? formatFiat(result.effectivePrice, symbol, 2) : "—"}
        />
        <ResultStat
          label="Slippage"
          value={result?.slippagePct != null ? formatPct(result.slippagePct, { frac: 3, sign: true }) : "—"}
          warn={result?.slippagePct != null && result.slippagePct > 0.002}
        />
        <ResultStat
          label={`${asset} ${buying ? "received" : "sold"}`}
          value={result ? `${formatCompact(result.filledAsset)} ${asset}` : "—"}
        />
      </dl>

      {result && (
        <div className="flex flex-col gap-2 rounded-md border px-3 py-2 text-xs text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
          <span className="flex items-start gap-1.5">
            {isThin ? (
              <>
                <TriangleAlert className="mt-px size-3.5 shrink-0 text-[color:var(--color-warn)]" aria-hidden />
                <span>
                  The top 20 ads can&apos;t fill it all — short by{" "}
                  <span className="font-mono tabular-nums text-foreground">
                    {formatFiat(result.shortfall, symbol, 0)}
                  </span>
                  .
                </span>
              </>
            ) : (
              <>
                <ShieldCheck className="mt-px size-3.5 shrink-0 text-[color:var(--color-buy)]" aria-hidden />
                <span>Fills in full from the current book.</span>
              </>
            )}
          </span>
          <span className="font-mono tabular-nums">
            {result.adsConsumed} ads · {result.merchantsConsumed} merchant{result.merchantsConsumed === 1 ? "" : "s"}
          </span>
        </div>
      )}

      {result && result.steps.length > 0 && (
        <div className="grid gap-5 lg:grid-cols-2">
          <FillCurve result={result} symbol={symbol} buying={buying} />
          <StepList result={result} symbol={symbol} asset={asset} buying={buying} />
        </div>
      )}
    </ChartCard>
  );
}

function ResultStat({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0 space-y-1">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd
        className={cn(
          "truncate font-mono text-base font-semibold tabular-nums sm:text-lg",
          warn && "text-[color:var(--color-warn)]",
        )}
      >
        {value}
      </dd>
    </div>
  );
}

/** Price paid at each LKR filled — a step per ad. */
function FillCurve({ result, symbol, buying }: { result: SlippageResult; symbol: string; buying: boolean }) {
  const color = buying ? C.buy : C.sell;
  const data = [
    { x: 0, price: result.steps[0].price },
    ...result.steps.map((s) => ({ x: s.cumulativeFiat, price: s.price })),
  ];
  const config = { price: { label: "Ad price", color } } satisfies ChartConfig;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">Fill curve</div>
      <ChartFrame
        config={config}
        height="sm"
        label={`Fill curve: price moves from ${formatPrice(result.topPrice, 2)} to ${formatPrice(result.steps[result.steps.length - 1].price, 2)} ${symbol} across ${result.steps.length} ads; effective ${formatPrice(result.effectivePrice, 2)}.`}
      >
        <AreaChart data={data} margin={MARGIN}>
          <defs>
            <FadeGradient id="slip-fill" color={color} from={0.22} />
          </defs>
          <CartesianGrid {...GRID} />
          <XAxis dataKey="x" type="number" domain={[0, "dataMax"]} tickFormatter={(v: number) => formatCompact(v)} {...axisX} />
          <YAxis
            domain={[
              (min: number) => min - Math.max(0.05, min * 0.0005),
              (max: number) => max + Math.max(0.05, max * 0.0005),
            ]}
            tickFormatter={(v: number) => formatPrice(v, 2)}
            {...axisY}
          />
          <ValueTooltip
            labelFormatter={(l) => `${symbol} ${formatCompact(Number(l))} filled`}
            valueFormatter={(v) => `${symbol} ${formatPrice(v, 2)}`}
          />
          {result.effectivePrice != null && (
            <ReferenceLine
              y={result.effectivePrice}
              stroke="var(--color-muted-foreground)"
              strokeDasharray="4 3"
              label={{ value: "effective", position: "insideTopRight", fill: "var(--color-muted-foreground)", fontSize: 10 }}
            />
          )}
          <Area
            dataKey="price"
            name="Ad price"
            type="stepBefore"
            stroke={color}
            strokeWidth={1.75}
            fill="url(#slip-fill)"
            dot={false}
            {...ANIM}
          />
        </AreaChart>
      </ChartFrame>
    </div>
  );
}

/** Ads consumed, in order. Stacked cards on phones, a compact grid on md+. */
function StepList({
  result,
  symbol,
  asset,
  buying,
}: {
  result: SlippageResult;
  symbol: string;
  asset: string;
  buying: boolean;
}) {
  const visible = result.steps.slice(0, 8);
  const top = result.topPrice;
  return (
    <div className="space-y-1.5">
      <div className="text-xs font-medium">Fill path</div>
      <ol className="divide-y overflow-hidden rounded-md border">
        <li className="hidden grid-cols-[2rem_minmax(0,1fr)_6rem_5rem_4rem] gap-3 bg-muted/50 px-3 py-1.5 text-[11px] text-muted-foreground md:grid">
          <span>#</span>
          <span>Merchant</span>
          <span className="text-right">Price</span>
          <span className="text-right">{asset}</span>
          <span className="text-right">vs top</span>
        </li>
        {visible.map((s, i) => {
          const dev = top != null && top > 0 ? (buying ? (s.price - top) / top : (top - s.price) / top) : null;
          const devCls = cn(
            "font-mono tabular-nums",
            dev != null && dev > 0.002 ? "text-[color:var(--color-warn)]" : "text-muted-foreground",
          );
          return (
            <li key={s.adId} className="px-3 py-2 text-xs">
              {/* Phone: two-line card */}
              <div className="flex items-baseline justify-between gap-3 md:hidden">
                <span className="min-w-0 truncate font-medium">
                  <span className="mr-1.5 font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                  {s.merchantName}
                </span>
                <span className="font-mono tabular-nums">{formatPrice(s.price, 2)}</span>
              </div>
              <div className="mt-0.5 flex justify-between gap-3 text-[11px] text-muted-foreground md:hidden">
                <span className="font-mono tabular-nums">
                  {formatCompact(s.assetFilled)} {asset} · {symbol} {formatCompact(s.fiatFilled)}
                </span>
                <span className={devCls}>{dev != null ? formatPct(dev, { frac: 2, sign: true }) : "—"}</span>
              </div>
              {/* md+: grid row */}
              <div className="hidden grid-cols-[2rem_minmax(0,1fr)_6rem_5rem_4rem] items-center gap-3 md:grid">
                <span className="font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
                <span className="truncate font-medium">{s.merchantName}</span>
                <span className="text-right font-mono tabular-nums">{formatPrice(s.price, 2)}</span>
                <span className="text-right font-mono tabular-nums text-muted-foreground">
                  {formatCompact(s.assetFilled)}
                </span>
                <span className={cn("text-right", devCls)}>
                  {dev != null ? formatPct(dev, { frac: 2, sign: true }) : "—"}
                </span>
              </div>
            </li>
          );
        })}
        {result.steps.length > visible.length && (
          <li className="px-3 py-2 text-[11px] text-muted-foreground">
            + {result.steps.length - visible.length} more ad{result.steps.length - visible.length === 1 ? "" : "s"}
          </li>
        )}
      </ol>
    </div>
  );
}
