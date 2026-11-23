import { TrendingDown, TrendingUp, Minus } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LINK_MIN_DAYS } from "@/lib/gold-signals";
import type { GoldReport } from "@/lib/gold-report";

const EX = { binance: "Binance", bybit: "Bybit" } as const;
const day = (d: string) =>
  formatSLT(`${d}T12:00:00+05:30`, { dateStyle: undefined, timeStyle: undefined, day: "numeric", month: "short" });
const rate = (v: number) => v.toFixed(2);
const pct = (v: number) => `${v >= 0 ? "+" : "−"}${Math.abs(v * 100).toFixed(2)}%`;

/**
 * Gold-based USDT/LKR prediction, result only: direction, and — once our
 * own USDT history backs the link — a predicted next-day rate with a 90 %
 * range. The maths lives in lib/gold-signals.ts.
 */
export function GoldSection({ report: g }: { report: GoldReport }) {
  const s = g.signal;
  const f = g.forecast;
  const d = g.latest;
  // Direction only when the gold signal fires; a fitted rate alone can be a tiny drift either way.
  const dir: "up" | "down" | null = s?.direction ?? null;
  const Icon = dir === "up" ? TrendingUp : dir === "down" ? TrendingDown : Minus;
  const color =
    dir === "up" ? "text-[color:var(--color-buy)]" : dir === "down" ? "text-[color:var(--color-sell)]" : "text-muted-foreground";
  const validated = g.link.verdict === "confirmed";

  const headline =
    !d || d.dev == null
      ? "Collecting gold data"
      : g.deviStale
        ? "Prediction paused"
        : g.link.verdict === "contradicted"
          ? "No gold-based prediction"
          : dir === "up"
        ? "USDT/LKR likely to rise"
        : dir === "down"
          ? "USDT/LKR likely to fall"
          : "No gold pressure on USDT/LKR";

  const why =
    !d || d.dev == null
      ? "The gold signal needs about 30 business days of Colombo gold prices before it can say anything."
      : g.deviStale
        ? "The latest Colombo gold price is out of date."
        : g.link.verdict === "contradicted"
          ? "In our own data, gold has not led USDT the way this idea expects."
          : dir === "up"
        ? "Gold in Colombo is unusually dear compared with Dubai and world prices. That raises the pull to bring gold in, paid for in dollars/USDT."
        : dir === "down"
          ? "Gold in Colombo is unusually cheap compared with Dubai and world prices. That lowers the pull to bring gold in, so less demand for dollars/USDT."
          : "Colombo gold is priced about where it normally is against Dubai and world prices.";

  return (
    <Card className="gap-3 px-3 py-4 sm:px-5">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="flex items-center gap-2.5">
          <Icon className={cn("size-6 shrink-0", color)} aria-hidden />
          <div>
            <div className={cn("text-base font-semibold", color)}>{headline}</div>
            <div className="text-xs text-muted-foreground">Next business day · {EX[g.exchange]}</div>
          </div>
        </div>
        <Badge
          variant="outline"
          className={cn(
            "h-5 text-[10px]",
            validated
              ? "border-[color:var(--color-buy)]/40 text-[color:var(--color-buy)]"
              : g.link.verdict === "contradicted"
                ? "border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]"
                : "text-muted-foreground",
          )}
        >
          {validated ? "backed by our data" : g.link.verdict === "contradicted" ? "data goes against it" : "experimental"}
        </Badge>
      </div>

      {f ? (
        <div className="grid grid-cols-3 gap-2 rounded-lg border px-3 py-2.5 text-center">
          <div>
            <div className="text-[11px] text-muted-foreground">Predicted</div>
            <div className={cn("font-mono text-lg font-semibold tabular-nums", color)}>{rate(f.rate)}</div>
            <div className="font-mono text-[11px] tabular-nums text-muted-foreground">{pct(f.change)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">Low</div>
            <div className="font-mono text-lg tabular-nums">{rate(f.low)}</div>
          </div>
          <div>
            <div className="text-[11px] text-muted-foreground">High</div>
            <div className="font-mono text-lg tabular-nums">{rate(f.high)}</div>
          </div>
        </div>
      ) : (
        <p className="rounded-lg border border-dashed px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
          {g.link.verdict === "contradicted"
            ? "Our USDT history shows gold has NOT led USDT the way this idea expects, so no rate is predicted."
            : g.link.verdict === "unclear"
              ? `No predicted rate: after ${g.link.n} days the link between gold and USDT is still not clear.`
              : `Predicted rates start once ${LINK_MIN_DAYS} days of USDT data confirm the gold link (${g.link.n} of ${LINK_MIN_DAYS} so far). Until then, direction only.`}
        </p>
      )}

      <p className="text-xs leading-relaxed text-pretty text-muted-foreground">
        {why}
        {f && " Range covers 9 in 10 past outcomes."} Estimate, not advice.
        {d && <> Based on Colombo gold of {day(d.day)}.</>}
      </p>
    </Card>
  );
}
