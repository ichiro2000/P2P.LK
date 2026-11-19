"use client";

import { useState } from "react";
import { ChartCard } from "@/components/charts/kit";
import { KpiCard } from "@/components/common/kpi-card";
import { formatInt, formatPct } from "@/lib/format";
import { TRADE_SIDES, buyShare, dayIso, type Period } from "@/lib/trade-trend";
import type { TrendSet } from "@/lib/db/trade-activity";
import { PeriodToggle, TRADE_LEGEND, TradeBars, growthText, periodWord } from "@/components/merchant/trade-bars";

/** Buy/sell trade trend for one Binance merchant, Daily / Weekly / Monthly. */
export function MerchantTradeTrend({
  trend,
  buy30d,
  sell30d,
  firstDay,
}: {
  trend: TrendSet;
  buy30d: number | null;
  sell30d: number | null;
  /** First stored SLT day (null = nothing yet). */
  firstDay: number | null;
}) {
  const [period, setPeriod] = useState<Period>("day");
  const { buckets, growth } = trend[period];
  const running = buckets.at(-1);
  const share = buyShare(buy30d, sell30d);
  const g = growthText(growth?.total);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <KpiCard
          label={`${periodWord(period, "this")} so far`}
          value={running?.total != null ? formatInt(running.total) : "—"}
          sub={running?.total != null ? `${formatInt(running.sell)} sold · ${formatInt(running.buy)} bought` : "Not measured yet"}
        />
        <KpiCard
          label={`${periodWord(period, "last")} (complete)`}
          value={growth ? formatInt(growth.current.total) : "—"}
          change={growth?.total ?? null}
          changeLabel={growth ? `vs ${growth.previous.label}` : undefined}
          sub={growth ? undefined : `Needs two fully collected ${period}s`}
        />
        <KpiCard
          className="col-span-2 lg:col-span-1"
          label="30-day split (Binance)"
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
          sub={share == null ? "No 30-day trades" : `sold ${formatInt(sell30d)} · bought ${formatInt(buy30d)}`}
        />
      </div>

      <ChartCard
        title="Completed trades, buy vs sell"
        description={
          <>
            Daily change in their all-time Binance counters (every fiat market, not LKR only). Faded bars are
            estimated, partly collected or still running.
          </>
        }
        legend={TRADE_LEGEND}
        actions={<PeriodToggle value={period} onChange={setPeriod} />}
        footer={
          growth && (growth.buy != null || growth.sell != null) ? (
            <>
              {periodWord(period, "last")} vs the one before: total {g}
              {growth.sell != null && ` · ${TRADE_SIDES.sold.label} ${growthText(growth.sell)}`}
              {growth.buy != null && ` · ${TRADE_SIDES.bought.label} ${growthText(growth.buy)}`}
            </>
          ) : undefined
        }
      >
        <TradeBars
          buckets={buckets}
          period={period}
          label={`Completed trades per ${period}, merchant sold vs bought USDT`}
          emptyHint={
            firstDay == null
              ? "We haven't collected this merchant's counters yet."
              : `Counters collected since ${dayIso(firstDay)}. A day's trades appear once we have the day before it too.`
          }
        />
      </ChartCard>
    </div>
  );
}
