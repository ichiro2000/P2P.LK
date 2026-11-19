import { ChartCard, ChartEmpty } from "@/components/charts/kit";
import { DOW, DOW_LONG, SltHeatGrid, hh, type HeatCell } from "@/components/liquidity/slt-heat-grid";
import { formatPct } from "@/lib/format";
import type { BestTime, BestTimeCell } from "@/lib/best-time";

type Key = "askDev" | "bidDev" | "spreadPct";

const pct = (v: number | null) => (v == null ? "—" : formatPct(v, { frac: 2, sign: true }));

/** Intensity 0..1 where 1 = best for the trader on that row. */
function scale(cells: readonly BestTimeCell[], key: Key) {
  const vals = cells.filter((c) => !c.hidden && c[key] != null).map((c) => c[key] as number);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  // Buying: low ask is good. Selling: high bid is good. Spread: narrow is good.
  const goodHigh = key === "bidDev";
  return (v: number) => (hi > lo ? (goodHigh ? (v - lo) / (hi - lo) : (hi - v) / (hi - lo)) : 0.5);
}

function toHeat(cells: readonly BestTimeCell[], key: Key, label: (h: number) => string, all: readonly BestTimeCell[]): HeatCell[] {
  const s = scale(all, key);
  const tone = key === "askDev" ? "buy" : key === "bidDev" ? "sell" : "fg";
  return cells.map((c, h) => {
    const v = c[key];
    const n = `${c.days} day${c.days === 1 ? "" : "s"}, ${c.minutes} min`;
    if (c.hidden || v == null) return { level: null, tone, title: `${label(h)} · not enough data (${n})` };
    const what = key === "spreadPct" ? `spread ${formatPct(v, { frac: 2 })}` : `${pct(v)} vs day's median`;
    return { level: s(v), tone, title: `${label(h)} · ${what} · ${n}` };
  });
}

const hours = (hs: number[]) => hs.map(hh).join(", ");

/**
 * Best time to trade (D4): how far the best Sell ad (where you buy) and the
 * best Buy ad (where you sell) sit from that day's median mid, by Sri Lanka
 * hour, plus the typical spread. Darker = better for that side. Cells with
 * too few samples are grey. Server-rendered.
 */
export function BestTimeCard({ data, exLabel }: { data: BestTime; exLabel: string }) {
  const title = "Best time to trade";
  const span = data.days >= 3 ? `${data.days} full days of the last 14` : "the last 14 days";
  const description = `${exLabel}, ${span}, Sri Lanka time. Prices relative to each day's median mid, so the trend doesn't count.`;
  const shown = data.byHour.filter((c) => !c.hidden);
  if (shown.length === 0) {
    return (
      <ChartCard title={title} description={description}>
        <ChartEmpty
          title="Not enough history yet"
          hint="Needs at least 3 days of minute data for each hour. It fills in over the next days."
        />
      </ChartCard>
    );
  }
  const weekCells = data.grid.flat();
  const hourLabel = (h: number) => hh(h);
  const profile: HeatCell[][] = [
    toHeat(data.byHour, "askDev", (h) => `Buy ${hourLabel(h)}`, data.byHour),
    toHeat(data.byHour, "bidDev", (h) => `Sell ${hourLabel(h)}`, data.byHour),
    toHeat(data.byHour, "spreadPct", (h) => `Spread ${hourLabel(h)}`, data.byHour),
  ];
  const weekday = (key: Key) =>
    data.grid.map((row, d) => toHeat(row, key, (h) => `${DOW[d]} ${hh(h)}`, weekCells));

  return (
    <ChartCard
      title={title}
      description={description}
      footer={
        <>
          Darker = better for that row: cheaper Sell ads (buy), higher Buy ads (sell), narrower spread. Grey = fewer
          than 3 days (hour rows) or no full hour of data (weekday cells). Hover a cell for its value and sample count.
        </>
      }
    >
      <div className="space-y-4">
        <dl className="grid grid-cols-1 gap-2 text-xs sm:grid-cols-2">
          <div className="rounded-md border border-border px-3 py-2">
            <dt className="text-muted-foreground">Cheapest hours to buy USDT</dt>
            <dd className="font-mono tabular-nums text-[color:var(--color-buy)]">
              {data.cheapestBuyHours.length ? hours(data.cheapestBuyHours) : "—"}
            </dd>
          </div>
          <div className="rounded-md border border-border px-3 py-2">
            <dt className="text-muted-foreground">Best hours to sell USDT</dt>
            <dd className="font-mono tabular-nums text-[color:var(--color-sell)]">
              {data.bestSellHours.length ? hours(data.bestSellHours) : "—"}
            </dd>
          </div>
        </dl>

        <section className="space-y-1.5">
          <h3 className="text-xs font-medium">By hour, all days</h3>
          <SltHeatGrid
            rows={profile}
            labels={["Buy", "Sell", "Spread"]}
            ariaLabel="Best hour to buy, to sell, and spread by Sri Lanka hour. Scrolls sideways."
          />
        </section>

        <details className="group space-y-1.5">
          <summary className="cursor-pointer text-xs font-medium text-muted-foreground hover:text-foreground">
            By weekday and hour (each cell is one or two days of data)
          </summary>
          <div className="space-y-3 pt-2">
            <p className="text-[11px] text-muted-foreground">Buy: best Sell ad vs the day&apos;s median</p>
            <SltHeatGrid rows={weekday("askDev")} labels={DOW} ariaLabel="Best Sell ad versus the day's median, by weekday and hour." />
            <p className="text-[11px] text-muted-foreground">Sell: best Buy ad vs the day&apos;s median</p>
            <SltHeatGrid rows={weekday("bidDev")} labels={DOW} ariaLabel="Best Buy ad versus the day's median, by weekday and hour." />
          </div>
        </details>
      </div>

      <div className="sr-only">
        <table>
          <caption>{description}</caption>
          <thead>
            <tr>
              <th scope="col">Hour (SLT)</th>
              <th scope="col">Best Sell ad vs day median</th>
              <th scope="col">Best Buy ad vs day median</th>
              <th scope="col">Spread</th>
              <th scope="col">Days</th>
            </tr>
          </thead>
          <tbody>
            {data.byHour.map((c, h) =>
              c.hidden ? null : (
                <tr key={h}>
                  <td>{hh(h)}</td>
                  <td>{pct(c.askDev)}</td>
                  <td>{pct(c.bidDev)}</td>
                  <td>{c.spreadPct != null ? formatPct(c.spreadPct, { frac: 2 }) : "—"}</td>
                  <td>{c.days}</td>
                </tr>
              ),
            )}
          </tbody>
        </table>
        <p>Weekdays: {DOW_LONG.join(", ")}.</p>
      </div>
    </ChartCard>
  );
}
