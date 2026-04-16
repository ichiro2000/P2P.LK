import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * Uptime ribbon — a single horizontal strip split into N buckets across the
 * selected range. Each bucket is coloured by how often the merchant appeared
 * in market ticks that fell inside it. Lets the reader eyeball reliability
 * across time without needing a full presence log.
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
      <Card className="card-lift border-border bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Uptime ribbon
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-[11px] text-muted-foreground">
            No market ticks in this range yet.
          </div>
        </CardContent>
      </Card>
    );
  }

  const first = marketTicks[0];
  const last = marketTicks[marketTicks.length - 1];
  const span = Math.max(1, last - first);
  const width = span / buckets;

  type Cell = { present: number; total: number };
  const cells: Cell[] = Array.from({ length: buckets }, () => ({
    present: 0,
    total: 0,
  }));
  const merchantSet = new Set(merchantTicks);

  for (const t of marketTicks) {
    const idx = Math.min(buckets - 1, Math.floor((t - first) / width));
    cells[idx].total += 1;
    if (merchantSet.has(t)) cells[idx].present += 1;
  }

  const overallTotal = marketTicks.length;
  const overallPresent = marketTicks.filter((t) => merchantSet.has(t)).length;
  const uptime = overallTotal > 0 ? overallPresent / overallTotal : 0;

  const firstLabel = new Date(first * 1000).toLocaleString();
  const lastLabel = new Date(last * 1000).toLocaleString();

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Uptime ribbon
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          {overallPresent}/{overallTotal} ticks · {formatPct(uptime, { frac: 1 })}
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex h-8 w-full overflow-hidden rounded-md border border-border bg-muted/30">
          {cells.map((c, i) => {
            const fill =
              c.total === 0 ? 0 : Math.max(0, Math.min(1, c.present / c.total));
            const tone = toneForFraction(fill, c.total === 0);
            return (
              <div
                key={i}
                className={cn("flex-1 border-r border-border/40 last:border-r-0", tone)}
                title={
                  c.total === 0
                    ? "No market ticks in this slice"
                    : `${c.present}/${c.total} ticks · ${formatPct(fill, { frac: 0 })}`
                }
              />
            );
          })}
        </div>
        <div className="mt-2 flex items-center justify-between font-mono text-[10px] text-muted-foreground">
          <span>{firstLabel}</span>
          <span>{lastLabel}</span>
        </div>
      </CardContent>
    </Card>
  );
}

function toneForFraction(f: number, empty: boolean): string {
  if (empty) return "bg-muted/40";
  if (f >= 0.9) return "bg-[color:var(--color-buy)]/80";
  if (f >= 0.6) return "bg-[color:var(--color-buy)]/55";
  if (f >= 0.3) return "bg-[color:var(--color-warn)]/55";
  if (f > 0) return "bg-[color:var(--color-sell)]/50";
  return "bg-muted";
}

/**
 * 7×24 hour-of-day heatmap showing when the merchant is usually online. Good
 * for "best time to catch them" questions — rows are days (Mon → Sun in local
 * time), columns are hours.
 */
export function HourHeatmap({
  merchantTicks,
}: {
  merchantTicks: number[];
}) {
  type Cell = { count: number };
  const grid: Cell[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => ({ count: 0 })),
  );

  for (const t of merchantTicks) {
    const d = new Date(t * 1000);
    // Monday-first: 0=Mon … 6=Sun
    const jsDow = d.getDay();
    const dow = (jsDow + 6) % 7;
    const hour = d.getHours();
    grid[dow][hour].count += 1;
  }

  let max = 0;
  for (const row of grid) for (const c of row) if (c.count > max) max = c.count;

  if (max === 0) {
    return (
      <Card className="card-lift border-border bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            When they&apos;re usually online
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-[11px] text-muted-foreground">
            No listing history in this range.
          </div>
        </CardContent>
      </Card>
    );
  }

  const rowLabels = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          When they&apos;re usually online
        </CardTitle>
        <span className="font-mono text-[10px] text-muted-foreground">
          local time · darker = more ticks
        </span>
      </CardHeader>
      <CardContent>
        <div className="flex flex-col gap-1">
          <div className="flex items-center gap-1 pl-8 font-mono text-[9px] text-muted-foreground">
            {Array.from({ length: 24 }, (_, h) => (
              <div key={h} className="flex-1 text-center">
                {h % 3 === 0 ? String(h).padStart(2, "0") : ""}
              </div>
            ))}
          </div>
          {grid.map((row, d) => (
            <div key={d} className="flex items-center gap-1">
              <div className="w-7 shrink-0 font-mono text-[10px] text-muted-foreground">
                {rowLabels[d]}
              </div>
              <div className="flex flex-1 gap-0.5">
                {row.map((cell, h) => {
                  const f = cell.count / max;
                  return (
                    <div
                      key={h}
                      className="h-4 flex-1 rounded-[2px]"
                      style={{
                        backgroundColor:
                          cell.count === 0
                            ? "var(--color-muted)"
                            : `color-mix(in srgb, var(--color-primary) ${
                                20 + f * 70
                              }%, transparent)`,
                      }}
                      title={`${rowLabels[d]} ${String(h).padStart(2, "0")}:00 — ${cell.count} tick${cell.count === 1 ? "" : "s"}`}
                    />
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
