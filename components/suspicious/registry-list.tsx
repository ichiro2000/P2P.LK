import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Empty } from "@/components/common/empty";
import { formatSLT } from "@/lib/format";
import type { SuspiciousReport, SuspiciousActivity } from "@/lib/db/suspicious";
import {
  ShieldAlert,
  ExternalLink,
  AlertTriangle,
  TrendingUp,
  ChevronRight,
  Activity,
} from "lucide-react";
import { cn } from "@/lib/utils";

type ActivityMap = Record<string, SuspiciousActivity>;

/**
 * Server-rendered list of every active report, grouped by taker. Active-on-
 * market takers float to the top with a red warning — they're the ones most
 * likely to be mid-scam right now. Takers who keep trading after being
 * flagged get an "orders still climbing" badge, which is usually a stronger
 * signal than the raw report count.
 */
export function RegistryList({
  reports,
  activity = {},
}: {
  reports: SuspiciousReport[];
  activity?: ActivityMap;
}) {
  if (reports.length === 0) {
    return (
      <Card className="border-border bg-card/60">
        <CardHeader className="pb-2">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Registry
          </CardTitle>
        </CardHeader>
        <CardContent>
          <Empty
            icon={ShieldAlert}
            title="No reports yet"
            description="When a community member adds a flagged taker, it shows up here."
          />
        </CardContent>
      </Card>
    );
  }

  const grouped = new Map<string, SuspiciousReport[]>();
  for (const r of reports) {
    const list = grouped.get(r.binanceUserId) ?? [];
    list.push(r);
    grouped.set(r.binanceUserId, list);
  }

  // Sort order:
  //   1. Active on market right now — most dangerous, sort top
  //   2. Still trading (ordersDelta > 0) since flagged — keeps scamming
  //   3. Everyone else, newest report first
  const takers = Array.from(grouped.entries())
    .map(([userId, rs]) => ({
      userId,
      reports: rs,
      activity: activity[userId],
    }))
    .sort((a, b) => {
      const aActive = a.activity?.isActive ? 1 : 0;
      const bActive = b.activity?.isActive ? 1 : 0;
      if (aActive !== bActive) return bActive - aActive;
      const aDelta = a.activity?.ordersDelta ?? 0;
      const bDelta = b.activity?.ordersDelta ?? 0;
      if (aDelta !== bDelta) return bDelta - aDelta;
      return b.reports[0].ts - a.reports[0].ts;
    });

  const activeCount = takers.filter((t) => t.activity?.isActive).length;

  return (
    <Card className="border-border bg-card/60">
      <CardHeader className="pb-2">
        <div className="flex items-center justify-between">
          <CardTitle className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Registry
          </CardTitle>
          <span className="font-mono text-[10px] text-muted-foreground">
            {takers.length} taker{takers.length === 1 ? "" : "s"} ·{" "}
            {reports.length} report{reports.length === 1 ? "" : "s"}
            {activeCount > 0 && (
              <>
                {" · "}
                <span className="text-[color:var(--color-sell)]">
                  {activeCount} live on book
                </span>
              </>
            )}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-3 pb-4">
        {takers.map(({ userId, reports: rs, activity: act }) => (
          <TakerBlock
            key={userId}
            userId={userId}
            reports={rs}
            activity={act}
          />
        ))}
      </CardContent>
    </Card>
  );
}

function TakerBlock({
  userId,
  reports,
  activity,
}: {
  userId: string;
  reports: SuspiciousReport[];
  activity?: SuspiciousActivity;
}) {
  const head = reports[0];
  const displayName = activity?.merchantName ?? head.displayName ?? null;
  const isActive = activity?.isActive ?? false;
  const ordersDelta = activity?.ordersDelta ?? null;
  const stillTrading = ordersDelta != null && ordersDelta > 0;

  return (
    <div
      className={cn(
        "group relative rounded-md border px-3 py-3 transition-colors",
        isActive
          ? "border-[color:var(--color-sell)]/60 bg-[color:var(--color-sell-muted)]/40"
          : stillTrading
            ? "border-[color:var(--color-warn)]/40 bg-card/40"
            : "border-border/60 bg-card/40",
      )}
    >
      {isActive && (
        <div className="mb-2 flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-sell)]">
          <AlertTriangle className="h-3 w-3 animate-pulse" />
          Active on the Wise book right now
        </div>
      )}

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link
              href={`/suspicious/${encodeURIComponent(userId)}`}
              className="truncate text-sm font-medium text-foreground hover:text-primary hover:underline"
            >
              {displayName ?? "Unknown taker"}
            </Link>
            <Badge
              variant="outline"
              className="h-4 text-[9px] font-semibold uppercase tracking-wider"
            >
              {reports.length} report{reports.length === 1 ? "" : "s"}
            </Badge>
            {stillTrading && (
              <Badge
                variant="outline"
                className="h-4 gap-1 border-[color:var(--color-warn)]/60 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-warn)]"
              >
                <TrendingUp className="h-2.5 w-2.5" />+{ordersDelta} orders since
                flagged
              </Badge>
            )}
            {!isActive && activity && activity.ticksSinceReport > 0 && (
              <Badge
                variant="outline"
                className="h-4 gap-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground"
              >
                <Activity className="h-2.5 w-2.5" />
                {activity.ticksSinceReport} ticks since flagged
              </Badge>
            )}
          </div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 font-mono text-[10px] text-muted-foreground">
            <span>advertiserNo: {userId}</span>
            <a
              href={head.profileUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1 underline hover:text-foreground"
            >
              Open on Bybit <ExternalLink className="h-3 w-3" />
            </a>
            {activity?.lastSeenTs && (
              <span className="text-muted-foreground/70">
                · last seen {formatSLT(activity.lastSeenTs)} SLT
              </span>
            )}
          </div>
        </div>
        <Link
          href={`/suspicious/${encodeURIComponent(userId)}`}
          className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border bg-card/50 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
        >
          Details <ChevronRight className="h-3 w-3" />
        </Link>
      </div>

      <ul className="mt-2 space-y-2 border-t border-border/60 pt-2">
        {reports.map((r) => (
          <li key={r.id} className="text-xs">
            <div className="flex flex-wrap items-center gap-2">
              <Badge
                variant="outline"
                className="border-[color:var(--color-sell)]/40 text-[color:var(--color-sell)]"
              >
                {r.reason}
              </Badge>
              <span className="text-muted-foreground">
                {formatSLT(r.ts)} SLT
              </span>
              {r.reporter && (
                <span className="text-muted-foreground">· by {r.reporter}</span>
              )}
            </div>
            {r.notes && <p className="mt-1 text-muted-foreground">{r.notes}</p>}
          </li>
        ))}
      </ul>
    </div>
  );
}
