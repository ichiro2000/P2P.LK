import { ChartCard, ChartEmpty } from "@/components/charts/kit";
import { formatCompact } from "@/lib/format";
import type { DepthHeatCell } from "@/lib/db/queries";
import { DOW, DOW_LONG, SltHeatGrid, hh, type HeatCell } from "./slt-heat-grid";

/** Cells with fewer minutes than this are shown as "not enough data". */
const MIN_MINUTES = 20;

/**
 * Near-touch depth (within 1 % of each side's best price) by weekday × hour,
 * exact Sri Lanka time, last 14 days of raw snapshots. Sell ads (what a buyer
 * can take, escrowed) and buy ads (declared budgets) are separate grids:
 * adding them would let placeholder bids hide an empty ask side.
 */
export function DepthHeatmap({
  cells,
  maxAsk,
  maxBid,
  totalPoints,
  asset,
}: {
  cells: DepthHeatCell[];
  maxAsk: number;
  maxBid: number;
  totalPoints: number;
  asset: string;
}) {
  const title = "Liquidity heatmap";
  const description = `Average ${asset} within 1% of the best price, by weekday and hour (Sri Lanka time), last 14 days.`;
  const filled = cells.filter((c) => c.count >= MIN_MINUTES && c.ask != null);
  if (totalPoints === 0 || filled.length === 0) {
    return (
      <ChartCard title={title} description={description}>
        <ChartEmpty
          title="Not enough coverage yet"
          hint="Fills in as near-price depth is recorded across the days of the week."
        />
      </ChartCard>
    );
  }

  const grid = (side: "ask" | "bid"): HeatCell[][] => {
    const max = side === "ask" ? maxAsk : maxBid;
    return Array.from({ length: 7 }, (_, d) =>
      Array.from({ length: 24 }, (_, h) => {
        const c = cells.find((x) => x.dow === d && x.hour === h);
        const v = c?.[side];
        const label = `${DOW[d]} ${hh(h)}`;
        if (!c || v == null || c.count < MIN_MINUTES)
          return { level: null, tone: "fg", title: `${label} · not enough data (${c?.count ?? 0} min)` };
        return {
          level: max > 0 ? v / max : 0,
          tone: side === "ask" ? "buy" : "sell",
          title: `${label} · ${formatCompact(v)} ${asset} · ${c.count} min over ${c.days} day${c.days === 1 ? "" : "s"}`,
        };
      }),
    );
  };
  const best = filled.reduce((a, b) => ((b.ask ?? 0) > (a.ask ?? 0) ? b : a), filled[0]);
  const worst = filled.reduce((a, b) => ((b.ask ?? 0) < (a.ask ?? 0) ? b : a), filled[0]);
  const coverage = filled.length / 168;

  return (
    <ChartCard
      title={title}
      description={description}
      footer={
        <>
          Most sell-ad depth:{" "}
          <span className="text-foreground">
            {DOW[best.dow]} {hh(best.hour)}
          </span>{" "}
          ({formatCompact(best.ask)} {asset}) · least:{" "}
          <span className="text-foreground">
            {DOW[worst.dow]} {hh(worst.hour)}
          </span>{" "}
          ({formatCompact(worst.ask)} {asset}) · {Math.round(coverage * 100)}% of hours covered ·{" "}
          {formatCompact(totalPoints)} minutes · grey = under {MIN_MINUTES} minutes of data
        </>
      }
    >
      <div className="space-y-4">
        <section className="space-y-1.5">
          <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-medium">
            <span>Sell ads within 1% · USDT you can buy</span>
            <span className="font-mono text-[11px] font-normal text-muted-foreground">max {formatCompact(maxAsk)}</span>
          </h3>
          <SltHeatGrid
            rows={grid("ask")}
            labels={DOW}
            ariaLabel="Sell-ad depth within 1% of the best price, by weekday and hour, Sri Lanka time. Scrolls sideways."
          />
        </section>
        <section className="space-y-1.5">
          <h3 className="flex flex-wrap items-baseline justify-between gap-2 text-xs font-medium">
            <span>Buy ads within 1% · USDT you can sell (declared)</span>
            <span className="font-mono text-[11px] font-normal text-muted-foreground">max {formatCompact(maxBid)}</span>
          </h3>
          <SltHeatGrid
            rows={grid("bid")}
            labels={DOW}
            ariaLabel="Buy-ad depth within 1% of the best price, declared, by weekday and hour, Sri Lanka time. Scrolls sideways."
          />
        </section>
      </div>

      <div className="sr-only">
        <table>
          <caption>{description}</caption>
          <thead>
            <tr>
              <th scope="col">Day</th>
              <th scope="col">Hour (SLT)</th>
              <th scope="col">Sell ads within 1% ({asset})</th>
              <th scope="col">Buy ads within 1% ({asset}, declared)</th>
              <th scope="col">Minutes of data</th>
            </tr>
          </thead>
          <tbody>
            {filled.map((c) => (
              <tr key={`${c.dow}-${c.hour}`}>
                <td>{DOW_LONG[c.dow]}</td>
                <td>{hh(c.hour)}</td>
                <td>{Math.round(c.ask ?? 0)}</td>
                <td>{Math.round(c.bid ?? 0)}</td>
                <td>{c.count}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </ChartCard>
  );
}
