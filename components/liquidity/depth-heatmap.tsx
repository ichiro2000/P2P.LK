import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";
import { formatCompact } from "@/lib/format";
import { Empty } from "@/components/common/empty";
import { Clock } from "lucide-react";

type Cell = { dow: number; hour: number; avg: number; count: number };

const DOW = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * 7×24 heatmap of average depth by day-of-week × hour-of-day. Useful for
 * spotting trading windows, regional liquidity peaks and dead zones.
 *
 * Intensity is computed relative to the max across the whole grid so the
 * scale is meaningful at any absolute magnitude.
 */
export function DepthHeatmap({
  cells,
  max,
  totalPoints,
  asset,
}: {
  cells: Cell[];
  max: number;
  totalPoints: number;
  asset: string;
}) {
  if (totalPoints === 0 || max === 0) {
    return (
      <Card className="card-lift border-border bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Depth heatmap · day × hour
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Empty
            icon={Clock}
            title="Not enough coverage yet"
            description="Heatmap fills in as snapshots accumulate across days and hours. Keep the ingest loop running for at least a day or two."
          />
        </CardContent>
      </Card>
    );
  }

  // Lookup for fast access during render.
  const lookup = new Map<string, Cell>();
  for (const c of cells) lookup.set(`${c.dow}:${c.hour}`, c);

  // Hours labeled every 3 columns for legibility.
  const hourLabels = Array.from({ length: 24 }, (_, h) =>
    h % 3 === 0 ? String(h).padStart(2, "0") : "",
  );

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Depth heatmap
            </CardTitle>
            <p className="mt-0.5 text-[10px] text-muted-foreground/70">
              Avg. Buy + Sell ads ({asset}) by weekday × hour (SLT) · {totalPoints} ticks
            </p>
          </div>
          <Legend max={max} asset={asset} />
        </div>
      </CardHeader>

      <CardContent className="pb-4">
        <div className="overflow-x-auto">
          <div className="grid min-w-[520px] grid-cols-[36px_repeat(24,1fr)] gap-[2px]">
            {/* Header row — hours */}
            <div />
            {hourLabels.map((lbl, h) => (
              <div
                key={`h-${h}`}
                className="flex h-5 items-end justify-center pb-0.5 font-mono text-[9px] text-muted-foreground/70"
              >
                {lbl}
              </div>
            ))}

            {DOW.map((d, dow) => (
              <DowRow
                key={d}
                label={d}
                dow={dow}
                lookup={lookup}
                max={max}
                asset={asset}
              />
            ))}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function DowRow({
  label,
  dow,
  lookup,
  max,
  asset,
}: {
  label: string;
  dow: number;
  lookup: Map<string, Cell>;
  max: number;
  asset: string;
}) {
  const cells = Array.from({ length: 24 }, (_, h) => lookup.get(`${dow}:${h}`));
  return (
    <>
      <div className="flex h-5 items-center justify-end pr-2 font-mono text-[10px] text-muted-foreground">
        {label}
      </div>
      {cells.map((c, h) => (
        <HeatCell
          key={`${dow}-${h}`}
          cell={c}
          hour={h}
          dow={dow}
          max={max}
          asset={asset}
          label={label}
        />
      ))}
    </>
  );
}

function HeatCell({
  cell,
  hour,
  dow,
  max,
  asset,
  label,
}: {
  cell: Cell | undefined;
  hour: number;
  dow: number;
  max: number;
  asset: string;
  label: string;
}) {
  const intensity = cell && cell.count > 0 ? cell.avg / max : 0;

  const empty = !cell || cell.count === 0;
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const _ = dow;

  return (
    <div
      className={cn(
        "group relative h-5 w-full rounded-sm transition-colors",
        empty ? "bg-muted/30" : "bg-primary",
      )}
      style={empty ? undefined : { opacity: 0.12 + intensity * 0.88 }}
      title={
        empty
          ? `${label} ${String(hour).padStart(2, "0")}:00 — no data`
          : `${label} ${String(hour).padStart(2, "0")}:00\n${formatCompact(cell?.avg ?? 0)} ${asset} avg\n${cell?.count ?? 0} tick${cell?.count === 1 ? "" : "s"}`
      }
    />
  );
}

function Legend({ max, asset }: { max: number; asset: string }) {
  return (
    <div className="flex items-center gap-2 text-[9px] text-muted-foreground">
      <span className="font-mono">0</span>
      <div
        className="h-1.5 w-28 rounded-full"
        style={{
          backgroundImage: `linear-gradient(to right, color-mix(in oklab, var(--color-primary) 14%, transparent), var(--color-primary))`,
        }}
      />
      <span className="font-mono">
        {formatCompact(max)} {asset}
      </span>
    </div>
  );
}
