import { ChartCard } from "@/components/charts/kit";
import { SLT_OFFSET_SEC } from "@/lib/constants";
import { formatPct, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";

type Hour = { ts: number; present: number; total: number };

const DAY = 86400;
const NO_STYLE = { dateStyle: undefined, timeStyle: undefined } as const;
const TICKS = [0, 6, 12, 18];

/**
 * Uptime grid for the last `days` days: one row per Sri Lanka day, one cell
 * per hour, each shaded by how often the merchant was on the book during
 * that hour's sweeps. Rollup hours start on the UTC hour, so in SLT (+5:30)
 * each cell runs from :30 to :30.
 */
export function UptimeWeek({ hours, days = 7, now }: { hours: Hour[]; days?: number; now: number }) {
  const total = hours.reduce((s, h) => s + h.total, 0);
  const present = hours.reduce((s, h) => s + h.present, 0);

  if (total === 0) {
    return (
      <ChartCard title="Uptime" description={`No sweeps in the last ${days} days yet.`}>
        <div className="h-8 rounded-md border border-dashed border-border" />
      </ChartCard>
    );
  }

  const sltDay = (ts: number) => Math.floor((ts + SLT_OFFSET_SEC) / DAY);
  const today = sltDay(now);
  const byTs = new Map(hours.map((h) => [h.ts, h]));
  const rows = Array.from({ length: days }, (_, i) => {
    const day = today - (days - 1 - i);
    // First rollup hour whose SLT start falls on this day (00:30 SLT).
    const firstTs = day * DAY - SLT_OFFSET_SEC + 1800;
    const cells = Array.from({ length: 24 }, (_, c) => {
      const ts = firstTs + c * 3600;
      return { ts, future: ts > now, h: byTs.get(ts) };
    });
    const p = cells.reduce((s, c) => s + (c.h?.present ?? 0), 0);
    const t = cells.reduce((s, c) => s + (c.h?.total ?? 0), 0);
    return { day, label: formatSLT(day * DAY - SLT_OFFSET_SEC, { ...NO_STYLE, weekday: "short", day: "numeric" }), cells, pct: t ? p / t : null };
  });
  const uptime = present / total;
  const time = (ts: number) => formatSLT(ts, { ...NO_STYLE, hour: "2-digit", minute: "2-digit" });

  return (
    <ChartCard
      title="Uptime"
      description={`Last ${days} days · on the book in ${present} of ${total} sweeps`}
      actions={<span className="font-mono text-sm tabular-nums">{formatPct(uptime, { frac: 1 })}</span>}
      contentClassName="px-4"
    >
      <div role="img" aria-label={`Uptime over the last ${days} days ${formatPct(uptime, { frac: 1 })}`} className="space-y-1">
        {rows.map((r) => (
          <div key={r.day} className="flex items-center gap-2">
            <span className="w-12 shrink-0 font-mono text-[10px] text-muted-foreground">{r.label}</span>
            <div className="flex h-4 flex-1 gap-px overflow-hidden rounded-sm">
              {r.cells.map((c) => {
                const range = `${formatSLT(c.ts, { ...NO_STYLE, weekday: "short", day: "numeric", month: "short" })}, ${time(c.ts)}–${time(c.ts + 3600)}`;
                return (
                  <div
                    key={c.ts}
                    className={cn("flex-1", c.future ? "bg-transparent" : tone(c.h))}
                    title={c.future ? undefined : c.h ? `${range} · ${c.h.present}/${c.h.total} sweeps` : `${range} · no sweeps`}
                  />
                );
              })}
            </div>
            <span className="w-11 shrink-0 text-right font-mono text-[10px] tabular-nums text-muted-foreground">
              {r.pct == null ? "—" : formatPct(r.pct, { frac: 0 })}
            </span>
          </div>
        ))}
        <div className="flex items-center gap-2 pt-1">
          <span className="w-12 shrink-0" />
          <div className="relative h-3 flex-1 font-mono text-[10px] text-muted-foreground">
            {TICKS.map((c) => (
              <span key={c} className="absolute" style={{ left: `${(c / 24) * 100}%` }}>
                {time(rows[0].cells[c].ts)}
              </span>
            ))}
          </div>
          <span className="w-11 shrink-0" />
        </div>
      </div>
    </ChartCard>
  );
}

function tone(h: Hour | undefined) {
  if (!h || h.total === 0) return "bg-muted/50";
  const f = h.present / h.total;
  if (f >= 0.9) return "bg-[color:var(--color-buy)]/80";
  if (f >= 0.6) return "bg-[color:var(--color-buy)]/50";
  if (f >= 0.3) return "bg-[color:var(--color-warn)]/50";
  if (f > 0) return "bg-[color:var(--color-sell)]/45";
  return "bg-muted";
}
