import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatFiat, formatPct } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { ConcentrationStats } from "@/lib/liquidity";

/**
 * Who owns the depth? Shows top-N share, HHI, and a stacked bar of the top
 * 10 merchants plus "other". HHI ≥ 0.25 is the US DoJ "highly concentrated"
 * threshold — we flag it in amber.
 */
export function ConcentrationPanel({
  stats,
  symbol,
  title = "Concentration",
  subtitle,
}: {
  stats: ConcentrationStats;
  symbol: string;
  title?: string;
  subtitle?: string;
}) {
  const topN = stats.merchants.slice(0, 10);
  const otherShare = 1 - topN.reduce((s, m) => s + m.share, 0);
  const otherCount = Math.max(0, stats.merchants.length - topN.length);

  const hhiTone =
    stats.hhi >= 0.25
      ? "text-[color:var(--color-warn)]"
      : stats.hhi >= 0.15
        ? "text-foreground"
        : "text-[color:var(--color-buy)]";

  return (
    <Card className="card-lift border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <div>
            <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              {title}
            </CardTitle>
            {subtitle && (
              <p className="mt-0.5 text-[10px] text-muted-foreground/70">
                {subtitle}
              </p>
            )}
          </div>
          <span className="font-mono text-[10px] tabular-nums text-muted-foreground">
            {stats.merchants.length} merchants · {formatFiat(stats.total, symbol, 0)}
          </span>
        </div>
      </CardHeader>

      <CardContent className="space-y-4 pb-5">
        <div className="grid grid-cols-3 gap-4">
          <MiniMetric
            label="Top 1"
            value={formatPct(stats.topShare[1], { frac: 1 })}
            tone={stats.topShare[1] > 0.4 ? "warn" : "neutral"}
          />
          <MiniMetric
            label="Top 3"
            value={formatPct(stats.topShare[3], { frac: 1 })}
            tone={stats.topShare[3] > 0.6 ? "warn" : "neutral"}
          />
          <MiniMetric
            label="Top 10"
            value={formatPct(stats.topShare[10], { frac: 1 })}
          />
        </div>

        <div>
          <div className="mb-1.5 flex items-baseline justify-between text-[11px]">
            <span className="text-muted-foreground">Share of depth</span>
            <span className={cn("font-mono tabular-nums", hhiTone)}>
              HHI {stats.hhi.toFixed(3)}
              {stats.hhi >= 0.25 && (
                <span className="ml-1.5 text-[9px] uppercase tracking-wider">
                  concentrated
                </span>
              )}
            </span>
          </div>
          <StackedBar segments={topN} otherShare={otherShare} />
        </div>

        <div className="space-y-1">
          {topN.slice(0, 5).map((m, i) => (
            <MerchantRow
              key={m.id}
              rank={i + 1}
              name={m.name}
              share={m.share}
              value={formatFiat(m.value, symbol, 0)}
              top={i === 0}
            />
          ))}
          {(otherCount > 0 || topN.length > 5) && (
            <div className="flex items-center justify-between px-1 pt-2 text-[11px] text-muted-foreground">
              <span>
                + {otherCount + Math.max(0, topN.length - 5)} other
                {otherCount + Math.max(0, topN.length - 5) === 1 ? "" : "s"}
              </span>
              <span className="font-mono tabular-nums">
                {formatPct(
                  otherShare +
                    topN
                      .slice(5)
                      .reduce((s, m) => s + m.share, 0),
                  { frac: 1 },
                )}
              </span>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function MiniMetric({
  label,
  value,
  tone = "neutral",
}: {
  label: string;
  value: string;
  tone?: "neutral" | "warn";
}) {
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </span>
      <span
        className={cn(
          "font-mono text-sm font-semibold tabular-nums",
          tone === "warn"
            ? "text-[color:var(--color-warn)]"
            : "text-foreground",
        )}
      >
        {value}
      </span>
    </div>
  );
}

/** Palette rotated through the first 10 segments. Kept to chart tokens so the
 *  whole app stays on the same 5-hue spectrum. */
const SEG_COLORS = [
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
  "var(--color-chart-1)",
  "var(--color-chart-2)",
  "var(--color-chart-3)",
  "var(--color-chart-4)",
  "var(--color-chart-5)",
];

function StackedBar({
  segments,
  otherShare,
}: {
  segments: { id: string; share: number; name: string }[];
  otherShare: number;
}) {
  return (
    <div className="flex h-2.5 w-full overflow-hidden rounded-full bg-muted/50">
      {segments.map((s, i) => (
        <div
          key={s.id}
          title={`${s.name} · ${formatPct(s.share, { frac: 1 })}`}
          className="h-full transition-[width,opacity] duration-300 hover:opacity-90"
          style={{
            width: `${s.share * 100}%`,
            backgroundColor: SEG_COLORS[i % SEG_COLORS.length],
            opacity: 1 - (i / 18),
          }}
        />
      ))}
      {otherShare > 0.001 && (
        <div
          title={`Other · ${formatPct(otherShare, { frac: 1 })}`}
          className="h-full bg-muted"
          style={{ width: `${otherShare * 100}%` }}
        />
      )}
    </div>
  );
}

function MerchantRow({
  rank,
  name,
  share,
  value,
  top,
}: {
  rank: number;
  name: string;
  share: number;
  value: string;
  top?: boolean;
}) {
  return (
    <div className="flex items-center gap-3 px-1 py-1 text-[12px]">
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground w-5">
        #{rank}
      </span>
      <span
        aria-hidden
        className="inline-block h-1.5 w-1.5 shrink-0 rounded-full"
        style={{ backgroundColor: SEG_COLORS[(rank - 1) % SEG_COLORS.length] }}
      />
      <span
        className={cn(
          "truncate",
          top ? "font-medium text-foreground" : "text-foreground/85",
        )}
      >
        {name}
      </span>
      <span className="ml-auto font-mono tabular-nums text-muted-foreground">
        {value}
      </span>
      <span className="w-12 text-right font-mono tabular-nums text-foreground/80">
        {formatPct(share, { frac: 1 })}
      </span>
    </div>
  );
}

