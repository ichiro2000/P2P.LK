import { ExternalLink } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Empty } from "@/components/common/empty";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInt, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { RETENTION_SEC } from "@/lib/ingest/jobs";
import { ALERT_EVENTS_MAX_AGE_SEC, ALERT_EVENTS_MAX_PER_USER } from "@/lib/alerts/evaluate";
import { JOB_LABEL, ago, exLabel, ms } from "@/components/admin/overview/format";
import { FX_SOURCE_META } from "@/lib/fx/sources";
import type { FxSourceRow, RunRow } from "./data";

const runEx = (ex: string) => FX_SOURCE_META[ex]?.shortName ?? exLabel(ex);

/* ── Ingest runs ───────────────────────────────────────────────────────── */

function StatusPill({ ok }: { ok: boolean }) {
  return (
    <span
      className={cn(
        "inline-flex h-5 items-center rounded-full border px-2 text-[11px] font-medium whitespace-nowrap",
        ok
          ? "border-[color:var(--color-buy)]/40 bg-[color:var(--color-buy)]/10 text-[color:var(--color-buy)]"
          : "border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 text-[color:var(--color-sell)]",
      )}
    >
      {ok ? "OK" : "Failed"}
    </span>
  );
}

const time = (ts: number) => formatSLT(ts, { dateStyle: undefined, timeStyle: "medium" });
const day = (ts: number) => formatSLT(ts, { day: "numeric", month: "short", timeStyle: undefined, dateStyle: undefined });

export function RunsList({ runs }: { runs: RunRow[] }) {
  if (runs.length === 0) {
    return <Empty title="No runs match" description="Runs are kept for 7 days. Try clearing a filter." />;
  }
  return (
    <>
      {/* Phones: cards */}
      <ul className="grid gap-2 md:hidden">
        {runs.map((r) => (
          <li key={r.id}>
            <Card className={cn("gap-1.5 px-3.5 py-3", !r.ok && "border-[color:var(--color-sell)]/40")}>
              <div className="flex items-center justify-between gap-2">
                <span className="min-w-0 truncate text-sm font-medium">
                  {JOB_LABEL[r.job] ?? r.job}
                  {r.exchange && <span className="font-normal text-muted-foreground"> · {runEx(r.exchange)}</span>}
                </span>
                <StatusPill ok={r.ok} />
              </div>
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 font-mono text-xs tabular-nums text-muted-foreground">
                <span>
                  {day(r.ts)} {time(r.ts)}
                </span>
                <span>{ms(r.durationMs)}</span>
                <span>{formatInt(r.rows)} rows</span>
              </div>
              {r.error && <p className="break-words text-xs text-[color:var(--color-sell)]">{r.error}</p>}
            </Card>
          </li>
        ))}
      </ul>

      {/* Desktop: table */}
      <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[17%] pl-4">Time (SLT)</TableHead>
              <TableHead className="w-[17%]">Job</TableHead>
              <TableHead className="w-[9%]">Status</TableHead>
              <TableHead className="w-[10%] text-right">Duration</TableHead>
              <TableHead className="w-[9%] text-right">Rows</TableHead>
              <TableHead className="w-[38%] pr-4">Error</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {runs.map((r) => (
              <TableRow key={r.id}>
                <TableCell className="pl-4 font-mono text-xs tabular-nums">
                  <span className="text-muted-foreground">{day(r.ts)}</span> {time(r.ts)}
                </TableCell>
                <TableCell className="truncate text-sm">
                  {JOB_LABEL[r.job] ?? r.job}
                  {r.exchange && <span className="text-muted-foreground"> · {runEx(r.exchange)}</span>}
                </TableCell>
                <TableCell>
                  <StatusPill ok={r.ok} />
                </TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{ms(r.durationMs)}</TableCell>
                <TableCell className="text-right font-mono text-xs tabular-nums">{formatInt(r.rows)}</TableCell>
                <TableCell className="pr-4 whitespace-normal">
                  {r.error ? (
                    <span className="line-clamp-2 break-words text-xs text-[color:var(--color-sell)]" title={r.error}>
                      {r.error}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </>
  );
}

/* ── FX sources ────────────────────────────────────────────────────────── */

export function FxSources({ sources, now }: { sources: FxSourceRow[]; now: number }) {
  return (
    <Card className="gap-0 divide-y divide-border py-0">
      {sources.map((s) => {
        const failed = s.lastRun && !s.lastRun.ok;
        return (
          <div key={s.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5">
                <span className="text-sm font-medium">{s.name}</span>
                <span className="font-mono text-[11px] text-muted-foreground">{s.id}</span>
                {s.pageUrl && (
                  <a
                    href={s.pageUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="inline-flex min-h-6 items-center text-muted-foreground hover:text-foreground"
                    aria-label={`${s.name} rates page`}
                  >
                    <ExternalLink className="size-3.5" />
                  </a>
                )}
              </div>
              {failed && (
                <p className="mt-0.5 break-words text-xs text-[color:var(--color-sell)]">
                  Last run failed {ago(s.lastRun!.ts, now)}: {s.lastRun!.error}
                </p>
              )}
            </div>
            <dl className="grid shrink-0 grid-cols-3 gap-3 text-xs sm:w-80">
              <div>
                <dt className="text-muted-foreground">Last change</dt>
                <dd
                  className="font-mono tabular-nums"
                  title="fx_rates.fetched_at: when a value last changed (unchanged values keep their first-seen time)"
                >
                  {ago(s.lastFetchedAt, now)}
                </dd>
              </div>
              <div>
                <dt className="text-muted-foreground">Last run</dt>
                <dd className={cn("font-mono tabular-nums", failed && "text-[color:var(--color-sell)]")}>
                  {s.lastRun ? ago(s.lastRun.ts, now) : "never"}
                </dd>
              </div>
              <div className="text-right">
                <dt className="text-muted-foreground">Rows</dt>
                <dd className="font-mono tabular-nums">{formatInt(s.rows)}</dd>
              </div>
            </dl>
          </div>
        );
      })}
    </Card>
  );
}

/* ── Retention ─────────────────────────────────────────────────────────── */

const days = (sec: number) => `${Math.round(sec / 86400)} days`;

const RETENTION: { table: string; what: string; keep: string }[] = [
  { table: "market_snapshots", what: "Raw market snapshot, 1/min per exchange", keep: days(RETENTION_SEC.marketSnapshots) },
  { table: "market_hourly", what: "Hourly OHLC and averages", keep: "Forever" },
  { table: "merchants", what: "One row per merchant (latest state)", keep: "Forever" },
  { table: "merchant_snapshots", what: "Raw merchant stats, every 10-min sweep", keep: days(RETENTION_SEC.merchantSnapshots) },
  { table: "merchant_hourly", what: "Per merchant per hour", keep: days(RETENTION_SEC.merchantHourly) },
  { table: "taker_snapshots", what: "Flagged takers, change-only + daily heartbeat", keep: days(RETENTION_SEC.takerSnapshots) },
  { table: "ingest_runs", what: "Job log (this page and the health panel)", keep: days(RETENTION_SEC.ingestRuns) },
  {
    table: "alert_events",
    what: "Fired alerts (in-app inbox)",
    keep: `${days(ALERT_EVENTS_MAX_AGE_SEC)}, max ${ALERT_EVENTS_MAX_PER_USER} per user`,
  },
  { table: "fx_rates", what: "One row per source × currency × type × day", keep: "Forever" },
  { table: "audit_log", what: "Every admin action", keep: "Forever" },
];

export function RetentionSummary() {
  return (
    <Card className="gap-0 py-0">
      <dl className="divide-y divide-border">
        {RETENTION.map((r) => (
          <div key={r.table} className="grid grid-cols-[1fr_auto] items-baseline gap-x-4 gap-y-0.5 px-4 py-2.5">
            <dt className="min-w-0">
              <span className="block truncate font-mono text-xs">{r.table}</span>
              <span className="block text-xs text-muted-foreground">{r.what}</span>
            </dt>
            <dd
              className={cn(
                "text-right text-xs font-medium whitespace-nowrap",
                r.keep === "Forever" ? "text-muted-foreground" : "text-foreground",
              )}
            >
              {r.keep}
            </dd>
          </div>
        ))}
      </dl>
      <p className="border-t border-border px-4 py-2.5 text-[11px] text-muted-foreground">
        The retention job runs daily at 02:00 SLT (20:30 UTC). Hourly rollups run with every 5-minute sweep.
      </p>
    </Card>
  );
}
