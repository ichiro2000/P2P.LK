"use client";

import { useState } from "react";
import Link from "next/link";
import { TrendingDown, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { ChartCard } from "@/components/charts/kit";
import { KpiCard } from "@/components/common/kpi-card";
import { formatInt, formatPct } from "@/lib/format";
import { TRADE_SIDES, buyShare, dayIso, type Period } from "@/lib/trade-trend";
import type { MarketActivity, Mover } from "@/lib/db/trade-activity";
import { PeriodToggle, TRADE_LEGEND, TradeBars, growthText, periodWord } from "./trade-bars";
import { cn } from "@/lib/utils";

/**
 * Market-wide merchant activity (Binance): completed orders of the merchants
 * we track, per day / week / month, split by the merchant's side, with
 * growth over a matched set of merchants and the top movers week over week.
 */
export function MarketActivityPanel({ initial }: { initial: MarketActivity }) {
  const [period, setPeriod] = useState<Period>(initial.period);
  const [cache, setCache] = useState<Partial<Record<Period, MarketActivity>>>({ [initial.period]: initial });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const data = cache[period] ?? initial;

  async function choose(p: Period) {
    setPeriod(p);
    setError(null);
    if (cache[p]) return;
    setLoading(true);
    try {
      const r = await fetch(`/api/merchants/activity?period=${p}`);
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const next = (await r.json()) as MarketActivity;
      setCache((c) => ({ ...c, [p]: next }));
    } catch (e) {
      setError(e instanceof Error ? e.message : "failed");
    } finally {
      setLoading(false);
    }
  }

  const g = data.growth;
  const shown = data.period === period;
  const share = data.split30d ? buyShare(data.split30d.buy, data.split30d.sell) : null;
  const running = data.buckets.at(-1);

  return (
    <div className="space-y-3">
      <p className="text-xs text-muted-foreground">
        Completed P2P orders across <strong className="font-medium text-foreground">all fiat markets</strong> by the{" "}
        {formatInt(data.tracked)} Binance merchants we track (merchants seen on the LKR book in the last 30
        days). Binance doesn&apos;t split its counters by currency, so this is not LKR-only volume.
      </p>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <KpiCard
          label={`${periodWord(period, "last")} (complete)`}
          value={g ? formatInt(g.current.buy + g.current.sell) : "—"}
          change={g?.total ?? null}
          changeLabel={g ? `vs ${g.previous.label}` : undefined}
          sub={g ? undefined : `Needs two fully collected ${period}s`}
          footer={g ? `${formatInt(g.matched)} merchants in both` : undefined}
        />
        <KpiCard
          label={TRADE_SIDES.sold.label}
          tone="buy"
          value={g ? formatInt(g.current.sell) : "—"}
          change={g?.sell ?? null}
          changeLabel={g ? TRADE_SIDES.sold.hint : undefined}
        />
        <KpiCard
          label={TRADE_SIDES.bought.label}
          tone="sell"
          value={g ? formatInt(g.current.buy) : "—"}
          change={g?.buy ?? null}
          changeLabel={g ? TRADE_SIDES.bought.hint : undefined}
        />
        <KpiCard
          label="30 days, sold / bought"
          value={
            share == null ? (
              "—"
            ) : (
              <span>
                <span className="text-[color:var(--color-buy)]">{formatPct(1 - share, { frac: 0 })}</span>
                <span className="text-muted-foreground"> / </span>
                <span className="text-[color:var(--color-sell)]">{formatPct(share, { frac: 0 })}</span>
              </span>
            )
          }
          sub={data.split30d ? `${formatInt(data.split30d.sell + data.split30d.buy)} orders · ${formatInt(data.split30d.merchants)} merchants` : "No profiles yet"}
        />
      </div>

      <ChartCard
        title="Completed orders by tracked merchants"
        description={
          <>
            Sum of each merchant&apos;s daily counter change. Bars grow as we track more merchants, so growth % above
            only compares merchants collected on every day of both periods. Faded bars are estimated, partly collected
            or still running.
          </>
        }
        legend={TRADE_LEGEND}
        actions={<PeriodToggle value={period} onChange={choose} />}
        footer={
          running?.total != null && shown
            ? `${periodWord(period, "this")} so far: ${formatInt(running.total)} orders by up to ${formatInt(running.merchants)} merchants.`
            : undefined
        }
      >
        <div className={cn("transition-opacity", (loading || !shown) && "opacity-50")} aria-busy={loading}>
          {error ? (
            <p className="py-10 text-center text-sm text-muted-foreground">Couldn&apos;t load this period ({error}).</p>
          ) : (
            <TradeBars
              buckets={data.buckets}
              period={data.period}
              showMerchants
              label={`Completed orders per ${data.period} by tracked Binance merchants, sold vs bought USDT`}
              emptyHint="Each merchant needs two days of collected counters before their daily trades count. Check back tomorrow."
            />
          )}
        </div>
      </ChartCard>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <MoverList title="Fastest growing" icon={TrendingUp} movers={data.movers.rising} data={data} />
        <MoverList title="Slowing down" icon={TrendingDown} movers={data.movers.falling} data={data} />
      </div>
    </div>
  );
}

function MoverList({
  title,
  icon: Icon,
  movers,
  data,
}: {
  title: string;
  icon: typeof TrendingUp;
  movers: Mover[];
  data: MarketActivity;
}) {
  const w = data.movers.window;
  return (
    <Card className="gap-0 py-0">
      <div className="space-y-0.5 border-b border-border px-4 py-3">
        <h4 className="flex items-center gap-1.5 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" aria-hidden />
          {title}
        </h4>
        <p className="text-[11px] text-muted-foreground">
          Completed orders {dayIso(w.cur[0])} – {dayIso(w.cur[1])} vs the 7 days before · at least{" "}
          {data.movers.minBase} orders in the earlier week
        </p>
      </div>
      {movers.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">
          {data.movers.eligible === 0
            ? "Needs 14 days of collected counters."
            : "No merchant moved this way."}
        </p>
      ) : (
        <ol className="divide-y divide-border">
          {movers.map((m, i) => (
            <li key={m.id} className="flex items-center gap-3 px-4 py-2">
              <span className="w-4 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <Link
                  href={`/merchants/${encodeURIComponent(m.id)}`}
                  className="-my-2 block truncate py-2 text-sm font-medium underline-offset-4 hover:underline"
                >
                  {m.name}
                </Link>
                <div className="truncate font-mono text-[11px] tabular-nums text-muted-foreground">
                  {formatInt(m.prev)} → {formatInt(m.cur)} ·{" "}
                  <span className="text-[color:var(--color-buy)]">{formatInt(m.sell)} sold</span> ·{" "}
                  <span className="text-[color:var(--color-sell)]">{formatInt(m.buy)} bought</span>
                </div>
              </div>
              <span
                className={cn(
                  "shrink-0 font-mono text-xs font-semibold tabular-nums",
                  m.growth > 0 ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]",
                )}
              >
                {growthText(m.growth)}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}
