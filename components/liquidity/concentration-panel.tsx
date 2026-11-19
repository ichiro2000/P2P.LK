import { ChartCard } from "@/components/charts/kit";
import { formatFiat, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConcentrationStats } from "@/lib/liquidity";

/**
 * Who holds the depth on one side: top-1/3/10 share, HHI and the top
 * merchants as share bars. HHI ≥ 0.25 is the usual "highly concentrated"
 * line (flagged in the warn tint); < 0.15 is competitive.
 */
export function ConcentrationPanel({
  stats,
  symbol,
  title = "Concentration",
  subtitle,
  className,
}: {
  stats: ConcentrationStats;
  symbol: string;
  title?: string;
  subtitle?: string;
  className?: string;
}) {
  const top = stats.merchants.slice(0, 6);
  const rest = stats.merchants.length - top.length;
  const restShare = 1 - top.reduce((s, m) => s + m.share, 0);
  const level = stats.hhi >= 0.25 ? "concentrated" : stats.hhi >= 0.15 ? "moderate" : "competitive";
  // HHI meter: 0 … 0.5+ mapped to the full bar.
  const meter = Math.min(1, stats.hhi / 0.5);

  return (
    <ChartCard
      title={title}
      description={subtitle}
      className={className}
      contentClassName="space-y-4 px-4"
      actions={
        <span className="font-mono text-[11px] tabular-nums text-muted-foreground">
          {stats.merchants.length} merchants · {formatFiat(stats.total, symbol, 0)}
        </span>
      }
    >
      <dl className="grid grid-cols-4 gap-3">
        <Metric label="HHI" value={stats.hhi.toFixed(3)} warn={stats.hhi >= 0.25} />
        <Metric label="Top 1" value={formatPct(stats.topShare[1], { frac: 1 })} warn={stats.topShare[1] > 0.4} />
        <Metric label="Top 3" value={formatPct(stats.topShare[3], { frac: 1 })} warn={stats.topShare[3] > 0.6} />
        <Metric label="Top 10" value={formatPct(stats.topShare[10], { frac: 1 })} />
      </dl>

      <div className="space-y-1.5">
        <div className="flex items-center justify-between text-[11px] text-muted-foreground">
          <span>Market structure</span>
          <span className={cn("font-medium", stats.hhi >= 0.25 ? "text-[color:var(--color-warn)]" : "text-foreground")}>
            {level}
          </span>
        </div>
        <div
          className="relative h-1.5 rounded-full bg-muted"
          role="meter"
          aria-valuemin={0}
          aria-valuemax={0.5}
          aria-valuenow={Number(stats.hhi.toFixed(3))}
          aria-label={`HHI ${stats.hhi.toFixed(3)}, ${level}`}
        >
          <div
            className={cn(
              "h-full rounded-full transition-[width] duration-500 ease-out",
              stats.hhi >= 0.25 ? "bg-[color:var(--color-warn)]" : "bg-foreground",
            )}
            style={{ width: `${Math.max(2, meter * 100)}%` }}
          />
          {/* 0.15 and 0.25 thresholds */}
          <span aria-hidden className="absolute inset-y-[-3px] left-[30%] w-px bg-border" />
          <span aria-hidden className="absolute inset-y-[-3px] left-1/2 w-px bg-border" />
        </div>
      </div>

      <ul className="space-y-2">
        {top.map((m, i) => (
          <li key={m.id} className="space-y-1">
            <div className="flex items-baseline gap-2 text-xs">
              <span className="w-5 shrink-0 font-mono text-[10px] text-muted-foreground">#{i + 1}</span>
              <span className={cn("min-w-0 flex-1 truncate", i === 0 && "font-medium")}>{m.name}</span>
              <span className="hidden font-mono tabular-nums text-muted-foreground sm:inline">
                {formatFiat(m.value, symbol, 0)}
              </span>
              <span className="w-12 text-right font-mono tabular-nums">{formatPct(m.share, { frac: 1 })}</span>
            </div>
            <div className="ml-7 h-1 rounded-full bg-muted">
              <div
                className="h-full rounded-full bg-[color:var(--color-chart-2)]"
                style={{ width: `${Math.max(1, (m.share / Math.max(top[0]?.share ?? 1, 1e-9)) * 100)}%` }}
              />
            </div>
          </li>
        ))}
        {rest > 0 && (
          <li className="flex justify-between pl-7 text-[11px] text-muted-foreground">
            <span>
              + {rest} other{rest === 1 ? "" : "s"}
            </span>
            <span className="font-mono tabular-nums">{formatPct(Math.max(0, restShare), { frac: 1 })}</span>
          </li>
        )}
      </ul>
    </ChartCard>
  );
}

function Metric({ label, value, warn }: { label: string; value: string; warn?: boolean }) {
  return (
    <div className="min-w-0 space-y-0.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("font-mono text-sm font-semibold tabular-nums", warn && "text-[color:var(--color-warn)]")}>
        {value}
      </dd>
    </div>
  );
}
