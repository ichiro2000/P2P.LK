"use client";

import { useState } from "react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { AsOf } from "@/components/common/as-of";
import { DollarChart } from "@/components/risk/dollar-chart";
import { EXCHANGE_IDS, type ExchangeId } from "@/lib/exchanges/types";
import { formatPct, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { CBSL_MIN_DAYS, GOOGLE_MIN_PAIRS, WINDOWS, type Change, type Link, type Verdict } from "@/lib/dollar-signals";
import type { DollarReport } from "@/lib/dollar-report";

const EX: Record<ExchangeId, string> = { binance: "Binance", bybit: "Bybit" };
const hm = (ts: number) => formatSLT(ts, { timeStyle: "short", dateStyle: undefined });
const day = (d: string) => formatSLT(`${d}T12:00:00+05:30`, { dateStyle: undefined, timeStyle: undefined, day: "numeric", month: "short" });
const pct = (v: number) => formatPct(v, { frac: 2, sign: true });
const lkr = (v: number) => `${v > 0 ? "+" : v < 0 ? "−" : ""}${Math.abs(v).toFixed(2)} LKR`;
/** Green up, red down (site convention); flat stays neutral. */
const tone = (v: number | null | undefined) =>
  v == null || Math.abs(v) < 1e-9 ? "" : v > 0 ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]";

function Delta({ c, missing = "no reading" }: { c: Change | null; missing?: string }) {
  if (!c) return <span className="text-muted-foreground">— <span className="sr-only">{missing}</span></span>;
  return (
    <span className="flex flex-col items-end leading-tight">
      <span className={cn("font-mono tabular-nums", tone(c.pct))}>{pct(c.pct)}</span>
      <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{lkr(c.abs)}</span>
    </span>
  );
}

const VERDICT: Record<Verdict, { label: string; cls: string }> = {
  collecting: { label: "collecting", cls: "text-muted-foreground" },
  confirmed: { label: "data supports it", cls: "border-[color:var(--color-buy)]/40 text-[color:var(--color-buy)]" },
  unclear: { label: "no clear link yet", cls: "text-muted-foreground" },
  contradicted: { label: "data goes against it", cls: "border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]" },
};

function LinkRow({ title, l, unit }: { title: string; l: Link; unit: string }) {
  const v = VERDICT[l.verdict];
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center justify-between gap-x-2 gap-y-1">
        <span className="text-xs text-muted-foreground">{title}</span>
        <Badge variant="outline" className={cn("h-5 text-[10px]", v.cls)}>
          {v.label}
        </Badge>
      </div>
      <div className="font-mono text-xs tabular-nums">
        {l.verdict === "collecting" ? (
          <span>
            collecting — {l.n} of {l.min} {unit}
          </span>
        ) : (
          <span>
            r {l.r != null ? l.r.toFixed(2) : "—"} · beta {l.beta != null ? l.beta.toFixed(2) : "—"} · n {l.n} {unit}
          </span>
        )}
      </div>
    </div>
  );
}

/**
 * "Dollar rate vs USDT": Google USD/LKR (30-min) and CBSL indicative (daily)
 * changes next to the USDT mid over the same span, the co-movement measured
 * from our own history, expected vs actual USDT move, and an indexed chart.
 * Server data only; the toggles switch between precomputed views.
 */
export function DollarSection({ report, exchange }: { report: DollarReport; exchange: ExchangeId }) {
  const [both, setBoth] = useState(false);
  const exs: ExchangeId[] = both ? [...EXCHANGE_IDS] : [exchange];
  const g = report.google;
  const cb = report.cbsl.change;

  const toggle = (
    <ToggleGroup
      value={[both ? "both" : "one"]}
      onValueChange={(v) => v[0] && setBoth(v[0] === "both")}
      variant="outline"
      size="sm"
      aria-label="Exchanges shown"
    >
      <ToggleGroupItem value="one" className="px-3 text-xs">
        {EX[exchange]}
      </ToggleGroupItem>
      <ToggleGroupItem value="both" className="px-3 text-xs">
        Both
      </ToggleGroupItem>
    </ToggleGroup>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <p className="max-w-3xl text-xs leading-relaxed text-pretty text-muted-foreground">
          Hypothesis: USDT/LKR moves with the dollar — when Google&rsquo;s or CBSL&rsquo;s USD/LKR rises, USDT tends to rise
          too, and the same when they fall. The numbers below are measured from our own stored history and say whether
          the data backs that up. Estimates, not advice.
        </p>
        <div className="shrink-0">{toggle}</div>
      </div>

      <div className="grid grid-cols-1 gap-3 lg:grid-cols-3">
        {/* ── change table */}
        <Card className="gap-2 px-3 py-3.5 sm:px-4 lg:col-span-2">
          <h4 className="text-sm font-medium">Changes, dollar vs USDT</h4>
          <table className="w-full table-fixed text-xs">
            <caption className="sr-only">
              Google and CBSL USD/LKR changes next to the USDT mid change over the same span, in percent and LKR
            </caption>
            <thead>
              <tr className="text-[11px] text-muted-foreground">
                <th scope="col" className="w-[34%] py-1 text-left font-normal">
                  Window
                </th>
                <th scope="col" className="py-1 text-right font-normal">
                  Dollar
                </th>
                {exs.map((e) => (
                  <th key={e} scope="col" className="py-1 text-right font-normal">
                    USDT {EX[e]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y">
              {WINDOWS.map((w) => (
                <tr key={w.key}>
                  <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                    Google {w.label}
                  </th>
                  <td className="py-1.5 text-right">
                    <Delta c={report.googleChanges[w.key]} />
                  </td>
                  {exs.map((e) => (
                    <td key={e} className="py-1.5 text-right">
                      <Delta c={report.exchanges[e].changes[w.key]} missing="no USDT data" />
                    </td>
                  ))}
                </tr>
              ))}
              <tr>
                <th scope="row" className="py-1.5 pr-2 text-left font-normal">
                  CBSL day
                  {cb && (
                    <span className="block text-[10px] text-muted-foreground">
                      {day(cb.prevDay)} → {day(cb.day)}
                    </span>
                  )}
                </th>
                <td className="py-1.5 text-right">
                  <Delta c={cb} missing="no CBSL data" />
                </td>
                {exs.map((e) => (
                  <td key={e} className="py-1.5 text-right">
                    <Delta c={report.exchanges[e].cbslDay} missing="no USDT data for those days" />
                  </td>
                ))}
              </tr>
            </tbody>
          </table>
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            USDT is measured between the same two Google readings (median mid of the 10 minutes before each), and as the
            daily average for the CBSL days. Google <AsOf ts={g.latest?.ts} stale={g.stale} />
            {cb && (
              <>
                {" "}
                · CBSL {day(cb.day)}
                {report.cbsl.stale && <span className="text-[color:var(--color-warn)]"> (old)</span>}
              </>
            )}
            .
          </p>
        </Card>

        {/* ── measured link */}
        <Card className="gap-3 px-3 py-3.5 sm:px-4">
          <h4 className="text-sm font-medium">Does USDT follow the dollar?</h4>
          {exs.map((e) => (
            <div key={e} className="space-y-2">
              {both && <div className="text-[11px] font-medium">{EX[e]}</div>}
              <LinkRow title="Google, 30-min moves, last 7 days" l={report.exchanges[e].googleLink} unit="pairs" />
              <LinkRow title="CBSL, day changes, last 90 days" l={report.exchanges[e].cbslLink} unit="days" />
            </div>
          ))}
          <p className="text-[11px] leading-relaxed text-muted-foreground">
            r = correlation of USDT moves with dollar moves; beta = how much USDT moved per 1% dollar move. Shown only from{" "}
            {GOOGLE_MIN_PAIRS} Google pairs / {CBSL_MIN_DAYS} CBSL days; &ldquo;supports&rdquo; needs a clearly positive r (t ≥ 2).
          </p>
        </Card>
      </div>

      {/* ── expected vs actual */}
      <Card className="gap-2 px-3 py-3.5 sm:px-4">
        <h4 className="text-sm font-medium">Expected vs actual USDT move (last 2 h of Google)</h4>
        {(() => {
          const m = report.googleChanges["2h"];
          if (!m) return <p className="text-xs text-muted-foreground">Needs two Google readings about 2 hours apart.</p>;
          if (g.stale)
            return (
              <p className="text-xs text-[color:var(--color-warn)]">
                The latest Google reading is from {formatSLT(m.toTs)} SLT, too old to compare with USDT now.
              </p>
            );
          return (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {exs.map((e) => {
                const v = report.exchanges[e];
                const l = v.lag;
                return (
                  <div key={e} className="space-y-1 text-xs">
                    <div className="font-medium">{EX[e]}</div>
                    {!l ? (
                      <p className="text-muted-foreground">
                        {v.usdt.stale ? "USDT data is stale — not compared." : "No USDT data at the start of the window."}
                      </p>
                    ) : (
                      <>
                        <p className="leading-relaxed text-pretty">
                          Google {pct(m.pct)} ({m.from.toFixed(2)} → {m.to.toFixed(2)}, {hm(m.fromTs)}–{hm(m.toTs)} SLT).{" "}
                          {l.betaMeasured ? `Measured beta ${l.beta.toFixed(2)}` : "Beta not measured yet, assuming 1:1"} →
                          expected <span className={cn("font-mono tabular-nums", tone(l.expected))}>{pct(l.expected)}</span>; USDT
                          moved <span className={cn("font-mono tabular-nums", tone(l.actual))}>{pct(l.actual)}</span> since{" "}
                          {hm(m.fromTs)}.
                        </p>
                        <p className={cn("font-medium", l.lagging && Math.abs(l.expected) >= 0.0005 ? tone(l.expected) : "text-muted-foreground")}>
                          {Math.abs(l.expected) < 0.0005
                            ? "The dollar barely moved — nothing to follow."
                            : l.lagging
                              ? `USDT hasn't caught up: expected ${pct(l.expected)}, moved ${pct(l.actual)}.`
                              : `USDT has followed: expected ${pct(l.expected)}, moved ${pct(l.actual)}.`}
                        </p>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          );
        })()}
      </Card>

      <DollarChart chart={report.chart} exchanges={exs} />
    </div>
  );
}
