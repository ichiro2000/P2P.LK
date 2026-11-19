import { ChartCard } from "@/components/charts/kit";
import { formatPct, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Uptime ribbon: the range split into buckets, each shaded by how often the
 * merchant was on the book during the sweeps that fell inside it.
 */
export function UptimeStrip({
  marketTicks,
  merchantTicks,
  buckets = 48,
}: {
  marketTicks: number[];
  merchantTicks: number[];
  buckets?: number;
}) {
  if (marketTicks.length === 0) {
    return (
      <ChartCard title="Uptime" description="No sweeps in this range yet.">
        <div className="h-8 rounded-md border border-dashed border-border" />
      </ChartCard>
    );
  }

  const first = marketTicks[0];
  const last = marketTicks[marketTicks.length - 1];
  const width = Math.max(1, last - first) / buckets;
  const cells = Array.from({ length: buckets }, () => ({ present: 0, total: 0 }));
  const seen = new Set(merchantTicks);
  let present = 0;
  for (const t of marketTicks) {
    const c = cells[Math.min(buckets - 1, Math.floor((t - first) / width))];
    c.total += 1;
    if (seen.has(t)) {
      c.present += 1;
      present += 1;
    }
  }
  const uptime = present / marketTicks.length;

  return (
    <ChartCard
      title="Uptime"
      description={`On the book in ${present} of ${marketTicks.length} sweeps`}
      actions={<span className="font-mono text-sm tabular-nums">{formatPct(uptime, { frac: 1 })}</span>}
      contentClassName="px-4"
    >
      <div className="flex h-8 w-full gap-px overflow-hidden rounded-md" role="img" aria-label={`Uptime ${formatPct(uptime, { frac: 1 })}`}>
        {cells.map((c, i) => {
          const f = c.total ? c.present / c.total : 0;
          return (
            <div
              key={i}
              className={cn("flex-1", tone(f, c.total === 0))}
              title={c.total ? `${c.present}/${c.total} sweeps` : "No sweeps in this slice"}
            />
          );
        })}
      </div>
      <div className="mt-2 flex justify-between font-mono text-[10px] text-muted-foreground">
        <span>{formatSLT(first)}</span>
        <span>{formatSLT(last)}</span>
      </div>
    </ChartCard>
  );
}

function tone(f: number, empty: boolean) {
  if (empty) return "bg-muted/50";
  if (f >= 0.9) return "bg-[color:var(--color-buy)]/80";
  if (f >= 0.6) return "bg-[color:var(--color-buy)]/50";
  if (f >= 0.3) return "bg-[color:var(--color-warn)]/50";
  if (f > 0) return "bg-[color:var(--color-sell)]/45";
  return "bg-muted";
}
