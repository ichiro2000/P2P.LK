"use client";

import { safeHttpsUrl } from "@/lib/safe-url";
import { useMemo, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, ChevronRight, ExternalLink, Search, ShieldAlert, TrendingUp } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Empty } from "@/components/common/empty";
import { formatSLT } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SuspiciousActivity, SuspiciousReport } from "@/lib/db/suspicious";
import { ReasonBadge } from "./parts";

type ActivityMap = Record<string, SuspiciousActivity>;
type View = "all" | "live" | "trading";

type Taker = {
  userId: string;
  reports: SuspiciousReport[];
  activity?: SuspiciousActivity;
  name: string;
};

/**
 * Every active report grouped by taker. Takers live on the book right now
 * float to the top, then takers whose order count kept climbing after the
 * first flag, then everyone else by newest report. Search by nickname or
 * advertiserNo; filter to live / still-trading takers.
 */
export function RegistryList({
  reports,
  activity = {},
}: {
  reports: SuspiciousReport[];
  activity?: ActivityMap;
}) {
  const [q, setQ] = useState("");
  const [view, setView] = useState<View>("all");

  const takers = useMemo<Taker[]>(() => {
    const grouped = new Map<string, SuspiciousReport[]>();
    for (const r of reports) {
      const list = grouped.get(r.userId) ?? [];
      list.push(r);
      grouped.set(r.userId, list);
    }
    return Array.from(grouped.entries())
      .map(([userId, rs]) => ({
        userId,
        reports: rs,
        activity: activity[userId],
        name: activity[userId]?.merchantName ?? rs[0].displayName ?? "Unknown taker",
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
  }, [reports, activity]);

  const liveCount = takers.filter((t) => t.activity?.isActive).length;
  const tradingCount = takers.filter((t) => (t.activity?.ordersDelta ?? 0) > 0).length;

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return takers.filter((t) => {
      if (view === "live" && !t.activity?.isActive) return false;
      if (view === "trading" && !((t.activity?.ordersDelta ?? 0) > 0)) return false;
      if (!needle) return true;
      return (
        t.name.toLowerCase().includes(needle) ||
        t.userId.toLowerCase().includes(needle) ||
        t.reports.some((r) => r.reason.toLowerCase().includes(needle))
      );
    });
  }, [takers, q, view]);

  if (takers.length === 0) {
    return (
      <Empty
        icon={ShieldAlert}
        title="No reports yet"
        description="When a community member flags a taker, they show up here."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:max-w-xs">
          <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            type="search"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search name, advertiserNo or reason"
            aria-label="Search the registry"
            className="h-10 pl-9 sm:h-9"
          />
        </div>
        <Tabs value={view} onValueChange={(v) => setView(v as View)}>
          <TabsList className="h-10 w-full sm:h-9 sm:w-fit">
            <TabsTrigger value="all" className="px-2 text-xs sm:px-3 sm:text-sm">
              All <Count n={takers.length} />
            </TabsTrigger>
            <TabsTrigger value="live" className="px-2 text-xs sm:px-3 sm:text-sm">
              Live now <Count n={liveCount} />
            </TabsTrigger>
            <TabsTrigger value="trading" className="px-2 text-xs sm:px-3 sm:text-sm">
              Still trading <Count n={tradingCount} />
            </TabsTrigger>
          </TabsList>
        </Tabs>
      </div>

      {shown.length === 0 ? (
        <Empty
          icon={Search}
          title="No matching takers"
          description="Try another name or advertiserNo, or switch the filter back to All."
        />
      ) : (
        <ul className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {shown.map((t) => (
            <li key={t.userId}>
              <TakerCard taker={t} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Count({ n }: { n: number }) {
  return <span className="font-mono text-xs tabular-nums text-muted-foreground">{n}</span>;
}

function TakerCard({ taker }: { taker: Taker }) {
  const { userId, reports, activity, name } = taker;
  const head = reports[0];
  const isActive = activity?.isActive ?? false;
  const ordersDelta = activity?.ordersDelta ?? null;
  const stillTrading = ordersDelta != null && ordersDelta > 0;
  const href = `/suspicious/${encodeURIComponent(userId)}`;

  const reasons = Array.from(new Set(reports.map((r) => r.reason)));

  return (
    <Card
      className={cn(
        "h-full gap-3 px-4 py-3.5",
        isActive && "ring-[color:var(--color-sell)]/50",
        !isActive && stillTrading && "ring-[color:var(--color-warn)]/50",
      )}
    >
      {isActive && (
        <div className="flex items-center gap-1.5 text-xs font-medium text-[color:var(--color-sell)]">
          <AlertTriangle className="size-3.5" />
          Active on the LKR book right now
        </div>
      )}

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <Link href={href} className="block truncate text-sm font-semibold text-foreground hover:underline">
            {name}
          </Link>
          <div className="truncate font-mono text-xs text-muted-foreground" title={userId}>
            {userId}
          </div>
        </div>
        <Badge variant="outline" className="shrink-0 font-mono tabular-nums">
          {reports.length} report{reports.length === 1 ? "" : "s"}
        </Badge>
      </div>

      <div className="flex flex-wrap gap-1.5">
        {reasons.slice(0, 3).map((r) => (
          <ReasonBadge key={r} reason={r} />
        ))}
        {reasons.length > 3 && (
          <Badge variant="outline" className="text-muted-foreground">
            +{reasons.length - 3}
          </Badge>
        )}
      </div>

      {head.notes && <p className="line-clamp-2 text-xs leading-relaxed text-muted-foreground">{head.notes}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <span>
          Last report <span className="font-mono tabular-nums">{formatSLT(head.ts)}</span>
        </span>
        {activity?.lastSeenTs != null && (
          <span>
            Seen <span className="font-mono tabular-nums">{formatSLT(activity.lastSeenTs)}</span>
          </span>
        )}
        {stillTrading && (
          <span className="inline-flex items-center gap-1 text-[color:var(--color-warn)]">
            <TrendingUp className="size-3.5" />
            <span className="font-mono tabular-nums">+{ordersDelta}</span> orders since flagged
          </span>
        )}
        {!isActive && !stillTrading && activity && activity.ticksSinceReport > 0 && (
          <span className="inline-flex items-center gap-1">
            <Activity className="size-3.5" />
            <span className="font-mono tabular-nums">{activity.ticksSinceReport}</span> ticks since flagged
          </span>
        )}
      </div>

      <div className="mt-auto flex items-center gap-2 border-t pt-3">
        <Link
          href={href}
          className="inline-flex h-10 flex-1 items-center justify-center gap-1 rounded-lg border bg-background text-sm font-medium transition-colors hover:bg-muted sm:h-8 sm:flex-none sm:px-3"
        >
          Details <ChevronRight className="size-4" />
        </Link>
        <a
          href={safeHttpsUrl(head.profileUrl) ?? undefined}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground sm:h-8 sm:flex-none sm:px-3"
        >
          Binance <ExternalLink className="size-3.5" />
        </a>
      </div>
    </Card>
  );
}
