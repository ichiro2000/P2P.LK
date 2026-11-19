import Link from "next/link";
import { AlertTriangle, ArrowRight, Database, Flag, Inbox, ShieldAlert, UserCheck } from "lucide-react";
import { Card } from "@/components/ui/card";
import { KpiCard } from "@/components/common/kpi-card";
import { KpiGrid, PageSection } from "@/components/common/page";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatInt, formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import { D1_LIMIT_BYTES, type IngestHealth, type Overview } from "./data";
import { JOB_LABEL, ago, bytes, exLabel, ms } from "./format";
import { SignupsChart } from "./signups-chart";

/* ── Users ─────────────────────────────────────────────────────────────── */

const linkCls =
  "inline-flex min-h-8 items-center gap-1 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";

export function UsersSection({ users }: { users: Overview["users"] }) {
  const s = users.byStatus;
  const pending = s.pending_review;
  return (
    <PageSection
      title="Users"
      description={`${formatInt(users.total)} accounts · ${formatInt(users.signups30)} sign-ups in 30 days`}
      actions={
        <Link href="/admin/members" className={linkCls}>
          Members <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      <KpiGrid>
        <Link
          href="/admin/members?status=pending_review"
          className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <KpiCard
            label="Pending review"
            value={formatInt(pending)}
            sub={pending > 0 ? "Open the queue →" : "Queue is empty"}
            icon={<UserCheck className={cn("size-4", pending > 0 ? "text-[color:var(--color-warn)]" : "text-muted-foreground")} />}
            className={cn("h-full transition-colors hover:bg-muted/40", pending > 0 && "border-[color:var(--color-warn)]/40")}
          />
        </Link>
        <KpiCard label="Approved" value={formatInt(s.approved)} sub="Active members" />
        <KpiCard label="Admins" value={formatInt(users.admins)} />
        <KpiCard label="Unverified email" value={formatInt(s.pending_email)} sub="Waiting for the code" />
      </KpiGrid>
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="gap-2 px-4 py-3.5 lg:col-span-2">
          <div className="flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Sign-ups per day</span>
            <span className="text-xs text-muted-foreground">Last 30 days, SLT</span>
          </div>
          <SignupsChart data={users.signups} />
        </Card>
        <Card className="gap-0 px-4 py-3.5">
          <span className="mb-2 text-sm font-medium">By status</span>
          <dl className="divide-y divide-border text-sm">
            {(
              [
                ["Pending review", s.pending_review],
                ["Approved", s.approved],
                ["Unverified email", s.pending_email],
                ["Rejected", s.rejected],
                ["Suspended", s.suspended],
              ] as const
            ).map(([label, n]) => (
              <div key={label} className="flex items-center justify-between gap-3 py-2">
                <dt className="text-muted-foreground">{label}</dt>
                <dd className="font-mono tabular-nums">{formatInt(n)}</dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </PageSection>
  );
}

/* ── Ingest health ─────────────────────────────────────────────────────── */

function HourBars({ values, label }: { values: (number | null)[]; label: string }) {
  const runs = values.filter((v): v is number => v != null);
  const rate = runs.length ? runs.reduce((a, b) => a + b, 0) / runs.length : null;
  return (
    <div
      role="img"
      aria-label={`${label}: ${rate == null ? "no runs" : `${Math.round(rate * 100)}% successful`} in the last 24 hours`}
      title="Success rate per hour, last 24 h (oldest left)"
      className="flex h-6 w-full min-w-24 items-end gap-px"
    >
      {values.map((v, i) => (
        <span
          key={i}
          className={cn(
            "flex-1 rounded-[1px]",
            v == null
              ? "bg-muted"
              : v >= 1
                ? "bg-[color:var(--color-buy)]/70"
                : v === 0
                  ? "bg-[color:var(--color-sell)]"
                  : "bg-[color:var(--color-warn)]",
          )}
          style={{ height: v == null ? "20%" : `${Math.max(20, v * 100)}%` }}
        />
      ))}
    </div>
  );
}

function StaleBadge({ h }: { h: IngestHealth }) {
  if (!h.stale) return null;
  return (
    <span
      className="inline-flex h-5 items-center gap-1 rounded-full border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell)]/10 px-2 text-[11px] font-medium text-[color:var(--color-sell)]"
      title={h.staleAfterSec ? `No success for over ${Math.round(h.staleAfterSec / 60)} min` : undefined}
    >
      <AlertTriangle className="size-3" aria-hidden /> Stale
    </span>
  );
}

const rowName = (h: IngestHealth) => ({
  job: JOB_LABEL[h.job] ?? h.job,
  ex: h.job === "fx" ? "All sources" : exLabel(h.exchange),
});

function Failures({ n, runs }: { n: number; runs: number }) {
  return (
    <span className={cn("font-mono tabular-nums", n > 0 ? "text-[color:var(--color-sell)]" : "text-muted-foreground")}>
      {formatInt(n)}
      <span className="text-muted-foreground">/{formatInt(runs)}</span>
    </span>
  );
}

function LastError({ h, now }: { h: IngestHealth; now: number }) {
  if (!h.lastError) return <span className="text-muted-foreground">—</span>;
  return (
    <span className="block min-w-0">
      <span className="line-clamp-2 break-words text-xs text-[color:var(--color-sell)]" title={h.lastError.message}>
        {h.lastError.message || "(no message)"}
      </span>
      <span className="text-[11px] text-muted-foreground">{ago(h.lastError.ts, now)}</span>
    </span>
  );
}

export function IngestSection({ ingest, now }: { ingest: IngestHealth[]; now: number }) {
  const stale = ingest.filter((h) => h.stale).length;
  const fails = ingest.reduce((n, h) => n + h.failures, 0);
  return (
    <PageSection
      title="Ingest health"
      description={`Last 24 h · ${stale ? `${stale} stale` : "nothing stale"} · ${formatInt(fails)} failed runs`}
      actions={
        <Link href="/admin/system" className={linkCls}>
          All runs <ArrowRight className="size-3.5" />
        </Link>
      }
    >
      {/* Phones: cards */}
      <div className="grid gap-2 md:hidden">
        {ingest.map((h) => {
          const n = rowName(h);
          return (
            <Card key={`${h.job}|${h.exchange}`} className={cn("gap-2 px-3.5 py-3", h.stale && "border-[color:var(--color-sell)]/40")}>
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0 truncate text-sm font-medium">
                  {n.job}
                  {n.ex && <span className="font-normal text-muted-foreground"> · {n.ex}</span>}
                </div>
                <StaleBadge h={h} />
              </div>
              <dl className="grid grid-cols-[1fr_auto_auto] gap-x-3 gap-y-2 text-xs">
                <div>
                  <dt className="text-muted-foreground">Last success</dt>
                  <dd className="font-mono tabular-nums">{ago(h.lastOkTs, now)}</dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">Failed</dt>
                  <dd>
                    <Failures n={h.failures} runs={h.runs} />
                  </dd>
                </div>
                <div>
                  <dt className="text-muted-foreground">p50 / p95</dt>
                  <dd className="font-mono whitespace-nowrap tabular-nums">
                    {ms(h.p50Ms)} / {ms(h.p95Ms)}
                  </dd>
                </div>
              </dl>
              <HourBars values={h.hourlyOk} label={`${n.job} ${n.ex}`.trim()} />
              {h.lastError && <LastError h={h} now={now} />}
            </Card>
          );
        })}
      </div>

      {/* Desktop: table */}
      <Card className="hidden gap-0 overflow-hidden py-0 md:flex">
        <Table className="table-fixed">
          <TableHeader>
            <TableRow>
              <TableHead className="w-[16%] pl-4">Job</TableHead>
              <TableHead className="w-[16%]">Last success</TableHead>
              <TableHead className="w-[10%] text-right">Failed 24 h</TableHead>
              <TableHead className="w-[14%] text-right">p50 / p95</TableHead>
              <TableHead className="w-[26%]">Last error</TableHead>
              <TableHead className="w-[18%] pr-4">Success, 24 h</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {ingest.map((h) => {
              const n = rowName(h);
              return (
                <TableRow key={`${h.job}|${h.exchange}`}>
                  <TableCell className="pl-4 align-top whitespace-normal">
                    <div className="text-sm font-medium">{n.job}</div>
                    {n.ex && <div className="text-xs text-muted-foreground">{n.ex}</div>}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span
                        className="font-mono text-xs tabular-nums"
                        title={h.lastOkTs ? formatSLT(h.lastOkTs, { timeStyle: "medium" }) : undefined}
                      >
                        {ago(h.lastOkTs, now)}
                      </span>
                      <StaleBadge h={h} />
                    </div>
                  </TableCell>
                  <TableCell className="text-right align-top text-xs">
                    <Failures n={h.failures} runs={h.runs} />
                  </TableCell>
                  <TableCell className="text-right align-top font-mono text-xs tabular-nums">
                    {ms(h.p50Ms)} / {ms(h.p95Ms)}
                  </TableCell>
                  <TableCell className="align-top whitespace-normal">
                    <LastError h={h} now={now} />
                  </TableCell>
                  <TableCell className="pr-4 align-top">
                    <HourBars values={h.hourlyOk} label={`${n.job} ${n.ex}`.trim()} />
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Card>
    </PageSection>
  );
}

/* ── Registry ──────────────────────────────────────────────────────────── */

export function RegistrySection({ registry }: { registry: Overview["registry"] }) {
  const tiles = [
    {
      href: "/admin/registry",
      label: "Pending submissions",
      value: registry.pending,
      sub: "Member reports awaiting review",
      icon: Flag,
      warn: registry.pending > 0,
    },
    {
      href: "/admin/registry",
      label: "Active reports",
      value: registry.active,
      sub: "Public on /suspicious",
      icon: ShieldAlert,
      warn: false,
    },
    {
      href: "/admin/removals",
      label: "Removal requests",
      value: registry.removals,
      sub: "Pending",
      icon: Inbox,
      warn: registry.removals > 0,
    },
  ];
  return (
    <PageSection title="Suspicious registry">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {tiles.map((t) => (
          <Link
            key={t.label}
            href={t.href}
            className="rounded-xl outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
          >
            <KpiCard
              label={t.label}
              value={formatInt(t.value)}
              sub={t.sub}
              icon={
                <t.icon
                  className={cn("size-4", t.warn ? "text-[color:var(--color-warn)]" : "text-muted-foreground")}
                />
              }
              className={cn("h-full transition-colors hover:bg-muted/40", t.warn && "border-[color:var(--color-warn)]/40")}
            />
          </Link>
        ))}
      </div>
    </PageSection>
  );
}

/* ── Database ──────────────────────────────────────────────────────────── */

export function DatabaseSection({ database }: { database: Overview["database"] }) {
  const pct = database.sizeBytes != null ? database.sizeBytes / D1_LIMIT_BYTES : null;
  const tone =
    pct == null ? "" : pct >= 0.8 ? "bg-[color:var(--color-sell)]" : pct >= 0.5 ? "bg-[color:var(--color-warn)]" : "bg-foreground/70";
  return (
    <PageSection title="Database" description="Cloudflare D1 · 10 GB limit per database">
      <div className="grid gap-3 lg:grid-cols-3">
        <Card className="gap-3 px-4 py-3.5">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs text-muted-foreground">Size</span>
            <Database className="size-4 text-muted-foreground" aria-hidden />
          </div>
          <div className="font-mono text-2xl font-semibold leading-none tracking-tight tabular-nums">
            {bytes(database.sizeBytes)}
          </div>
          <div
            className="h-1.5 w-full overflow-hidden rounded-full bg-muted"
            role="meter"
            aria-label="Share of the 10 GB D1 limit"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={pct == null ? undefined : Math.round(pct * 1000) / 10}
          >
            <div className={cn("h-full rounded-full", tone)} style={{ width: `${Math.min(100, (pct ?? 0) * 100)}%` }} />
          </div>
          <div className="text-xs text-muted-foreground">
            {pct == null ? "Size unavailable" : `${(pct * 100).toFixed(pct < 0.01 ? 3 : 1)}% of 10 GB`}
          </div>
        </Card>
        <Card className="gap-0 px-4 py-3.5 lg:col-span-2">
          <div className="mb-1 flex items-baseline justify-between gap-2">
            <span className="text-sm font-medium">Rows per table</span>
            <span className="text-xs text-muted-foreground">≈ = estimate from the rowid range</span>
          </div>
          <dl className="grid gap-x-6 sm:grid-cols-2">
            {database.tables.map((t) => (
              <div key={t.name} className="flex items-center justify-between gap-3 border-b border-border py-1.5 text-sm">
                <dt className="min-w-0 truncate font-mono text-xs text-muted-foreground">{t.name}</dt>
                <dd className="font-mono text-xs tabular-nums">
                  {t.estimate && t.rows > 0 ? "≈ " : ""}
                  {formatInt(t.rows)}
                </dd>
              </div>
            ))}
          </dl>
        </Card>
      </div>
    </PageSection>
  );
}
