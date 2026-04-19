import Link from "next/link";
import { notFound } from "next/navigation";
import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { Reveal } from "@/components/common/reveal";
import { Empty } from "@/components/common/empty";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Stat } from "@/components/common/stat";
import { ASSET, FIAT } from "@/lib/constants";
import {
  activityForSuspicious,
  reportsForUser,
  suspiciousHeatmapTicks,
  suspiciousOrderHistory,
  type SuspiciousReport,
} from "@/lib/db/suspicious";
import { HourHeatmap } from "@/components/merchant/detail/activity-panels";
import { OrderTrendChart } from "@/components/suspicious/order-trend-chart";
import { formatCompact, formatPct, formatRelative, formatSLT } from "@/lib/format";
import {
  AlertTriangle,
  Check,
  ExternalLink,
  ShieldAlert,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  fetchBinanceAdvertiserPublic,
  type BinanceAdvertiserPublic,
} from "@/lib/qr-resolve";

export const metadata = { title: "Suspicious taker · detail" };
export const dynamic = "force-dynamic";

function binanceUrl(userId: string) {
  return `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(userId)}`;
}

export default async function SuspiciousDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);

  const reports = await reportsForUser(id);
  if (reports.length === 0) {
    notFound();
  }

  // `reportsForUser` orders by ts DESC, so the first element is newest and the
  // last is earliest. We need the earliest for "orders since flagged" math.
  const firstReportTs = reports[reports.length - 1].ts;

  const [activity, heatmapTicks, orderHistory, binanceLive] = await Promise.all([
    activityForSuspicious(id, firstReportTs).catch(() => null),
    suspiciousHeatmapTicks(id).catch(() => []),
    suspiciousOrderHistory(id).catch(() => []),
    // Live Binance fetch — public endpoint, no auth. Gives us verifications,
    // join date, and all-time trade count that we don't store locally.
    fetchBinanceAdvertiserPublic(id).catch(() => null),
  ]);

  const head = reports[0];
  const displayName =
    activity?.merchantName ??
    binanceLive?.nickName ??
    head.displayName ??
    "Unknown taker";
  const isActive = activity?.isActive ?? false;
  const ordersDelta = activity?.ordersDelta ?? null;
  const stillTrading = ordersDelta != null && ordersDelta > 0;

  return (
    <>
      <Topbar
        title={displayName}
        subtitle={`Flagged taker · ${ASSET}/${FIAT.code}`}
      />

      <div className="mx-auto w-full max-w-6xl space-y-6 px-4 py-6 sm:px-6 sm:py-8">
        <SectionHeader
          kicker="Suspicious taker · detail"
          title={displayName}
          description="Every report filed against this taker, plus whether they're still active on the LKR book and whether their order count has kept climbing since the first flag."
        />

        {isActive && (
          <Reveal>
            <div className="flex items-start gap-3 rounded-lg border border-[color:var(--color-sell)]/60 bg-[color:var(--color-sell-muted)] px-4 py-3">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-sell)]" />
              <div>
                <div className="text-sm font-semibold text-[color:var(--color-sell)]">
                  Active on the LKR book right now
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  This flagged taker appears in the most recent ingest tick. If
                  you&apos;re trading now, decline their offer and warn your
                  counterparties.
                </div>
              </div>
            </div>
          </Reveal>
        )}
        {!isActive && stillTrading && (
          <Reveal>
            <div className="flex items-start gap-3 rounded-lg border border-[color:var(--color-warn)]/60 bg-card/50 px-4 py-3">
              <TrendingUp className="mt-0.5 h-5 w-5 shrink-0 text-[color:var(--color-warn)]" />
              <div>
                <div className="text-sm font-semibold text-[color:var(--color-warn)]">
                  Still trading after the first report
                </div>
                <div className="mt-0.5 text-[12px] text-muted-foreground">
                  Their rolling 30d order count has grown by{" "}
                  <span className="font-mono font-semibold">
                    +{ordersDelta}
                  </span>{" "}
                  since{" "}
                  <span className="font-mono">
                    {formatSLT(firstReportTs)} SLT
                  </span>
                  . They may be offline right now but the book has seen them
                  since.
                </div>
              </div>
            </div>
          </Reveal>
        )}

        <Reveal delay={40}>
          <HeaderCard
            userId={id}
            displayName={displayName}
            isActive={isActive}
            lastSeenTs={activity?.lastSeenTs ?? null}
            reportsCount={reports.length}
            ordersLatest={activity?.ordersLatest ?? null}
            ordersAtReport={activity?.ordersAtReport ?? null}
            ordersDelta={ordersDelta}
            ticksSinceReport={activity?.ticksSinceReport ?? 0}
            binance={binanceLive}
          />
        </Reveal>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Reveal delay={80}>
            <OrderTrendChart
              points={orderHistory}
              firstReportTs={firstReportTs}
            />
          </Reveal>
          <Reveal delay={110}>
            <HourHeatmap merchantTicks={heatmapTicks} />
          </Reveal>
        </div>

        <Reveal delay={140}>
          <ReportsList reports={reports} />
        </Reveal>

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 text-[11px] text-muted-foreground">
          <span>{reports.length} report{reports.length === 1 ? "" : "s"} on record</span>
          <Link
            href="/suspicious"
            className="inline-flex items-center gap-1.5 text-primary hover:underline"
          >
            ← Back to registry
          </Link>
        </div>
      </div>
    </>
  );
}

function HeaderCard({
  userId,
  displayName,
  isActive,
  lastSeenTs,
  reportsCount,
  ordersLatest,
  ordersAtReport,
  ordersDelta,
  ticksSinceReport,
  binance,
}: {
  userId: string;
  displayName: string;
  isActive: boolean;
  lastSeenTs: number | null;
  reportsCount: number;
  ordersLatest: number | null;
  ordersAtReport: number | null;
  ordersDelta: number | null;
  ticksSinceReport: number;
  binance: BinanceAdvertiserPublic | null;
}) {
  return (
    <Card className="border-border bg-card/60">
      <CardContent className="flex flex-col gap-5 p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex min-w-0 items-start gap-3">
            <div className="relative shrink-0">
              <div className="flex h-12 w-12 items-center justify-center rounded-full border border-[color:var(--color-sell)]/40 bg-[color:var(--color-sell-muted)] text-[color:var(--color-sell)]">
                <ShieldAlert className="h-5 w-5" />
              </div>
              <span
                aria-hidden
                className={cn(
                  "absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card",
                  isActive
                    ? "bg-[color:var(--color-sell)] animate-pulse"
                    : "bg-muted-foreground/40",
                )}
              />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="truncate text-lg font-semibold text-foreground">
                  {displayName}
                </h1>
                <Badge
                  variant="outline"
                  className="border-[color:var(--color-sell)]/40 text-[10px] font-semibold uppercase tracking-wider text-[color:var(--color-sell)]"
                >
                  {reportsCount} report{reportsCount === 1 ? "" : "s"}
                </Badge>
                <span
                  className={cn(
                    "rounded-full px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider",
                    isActive
                      ? "bg-[color:var(--color-sell-muted)] text-[color:var(--color-sell)]"
                      : "bg-muted text-muted-foreground",
                  )}
                >
                  {isActive ? "Active" : "Offline"}
                </span>
              </div>
              <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-muted-foreground">
                <span className="font-mono">{ASSET}/{FIAT.code}</span>
                <span className="text-muted-foreground/40">·</span>
                <span
                  className="truncate font-mono text-muted-foreground/70"
                  title={userId}
                >
                  {userId}
                </span>
                <span className="text-muted-foreground/40">·</span>
                <span>
                  {lastSeenTs
                    ? isActive
                      ? "Live on book"
                      : `Last seen ${formatRelative(new Date(lastSeenTs * 1000))}`
                    : "Never seen on LKR book"}
                </span>
                {binance?.userIdentity && (
                  <>
                    <span className="text-muted-foreground/40">·</span>
                    <span className="font-mono text-muted-foreground/70">
                      {binance.userIdentity.toLowerCase().replace(/_/g, " ")}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={binanceUrl(userId)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-card/50 px-3 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
            >
              <ExternalLink className="h-3.5 w-3.5" strokeWidth={2} />
              View on Binance
            </a>
          </div>
        </div>

        <div className="grid grid-cols-2 gap-x-6 gap-y-5 md:grid-cols-3 lg:grid-cols-6">
          <Stat
            label="All trades"
            value={
              binance?.allTradeCount != null
                ? formatCompact(binance.allTradeCount)
                : "—"
            }
            footnote={
              binance?.allTradeCount != null
                ? "lifetime · live from Binance"
                : "needs Binance profile"
            }
          />
          <Stat
            label="Orders 30d (latest)"
            value={
              ordersLatest != null
                ? formatCompact(ordersLatest)
                : binance?.monthOrderCount != null
                  ? formatCompact(binance.monthOrderCount)
                  : "—"
            }
            footnote={
              ordersLatest != null
                ? "rolling 30d · our snapshots"
                : binance?.monthOrderCount != null
                  ? "rolling 30d · live from Binance"
                  : "rolling 30d"
            }
          />
          <Stat
            label="30d completion rate"
            value={
              binance?.monthFinishRate != null
                ? formatPct(binance.monthFinishRate, { frac: 2 })
                : "—"
            }
            footnote={
              binance?.monthFinishRate != null
                ? binance.monthFinishRate < 0.9
                  ? "below 90% — high appeal rate"
                  : "live from Binance"
                : "needs Binance profile"
            }
          />
          <Stat
            label="Orders at first report"
            value={ordersAtReport != null ? formatCompact(ordersAtReport) : "—"}
            footnote={
              ordersAtReport == null
                ? "no snapshot at that time"
                : "snapshot closest to flag date"
            }
          />
          <Stat
            label="Change since flagged"
            value={
              ordersDelta == null
                ? "—"
                : `${ordersDelta > 0 ? "+" : ""}${ordersDelta}`
            }
            footnote="positive → still trading"
            delta={
              ordersDelta != null
                ? {
                    value: ordersDelta,
                    format: "abs",
                    tone:
                      ordersDelta > 0
                        ? "sell"
                        : ordersDelta < 0
                          ? "buy"
                          : "muted",
                  }
                : undefined
            }
          />
          <Stat
            label="Ticks since flag"
            value={formatCompact(ticksSinceReport)}
            footnote={
              ticksSinceReport > 0
                ? "LKR listing ticks after first report"
                : "hasn't relisted on LKR since flag"
            }
          />
        </div>

        {binance &&
          (binance.avgReleaseTimeSec != null ||
            binance.avgPayTimeSec != null ||
            binance.registerTime != null ||
            binance.emailVerified != null ||
            binance.mobileVerified != null ||
            binance.kycVerified != null) && (
            <div className="flex flex-wrap items-center gap-x-5 gap-y-2 border-t border-border/60 pt-4 text-[11px] text-muted-foreground">
              {binance.registerTime != null && (
                <span>
                  Joined{" "}
                  <span className="font-mono text-foreground">
                    {formatSLT(new Date(binance.registerTime), {
                      dateStyle: "medium",
                    })}
                  </span>
                </span>
              )}
              {binance.avgReleaseTimeSec != null && (
                <span>
                  Avg release{" "}
                  <span className="font-mono text-foreground">
                    {formatDurationShort(binance.avgReleaseTimeSec)}
                  </span>
                </span>
              )}
              {binance.avgPayTimeSec != null && (
                <span>
                  Avg pay{" "}
                  <span className="font-mono text-foreground">
                    {formatDurationShort(binance.avgPayTimeSec)}
                  </span>
                </span>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                {binance.emailVerified && <VerificationPill label="Email" />}
                {binance.mobileVerified && <VerificationPill label="SMS" />}
                {binance.kycVerified && <VerificationPill label="ID" />}
              </div>
            </div>
          )}
      </CardContent>
    </Card>
  );
}


function ReportsList({ reports }: { reports: SuspiciousReport[] }) {
  if (reports.length === 0) {
    return (
      <Empty
        icon={ShieldAlert}
        title="No reports"
        description="There are no reports filed against this taker."
      />
    );
  }

  // Unique reasons → at-a-glance summary row
  const reasonCounts = new Map<string, number>();
  for (const r of reports) {
    reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
  }
  const sortedReasons = Array.from(reasonCounts.entries()).sort(
    (a, b) => b[1] - a[1],
  );

  return (
    <Card className="border-border bg-card/60">
      <CardContent className="space-y-3 p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Reports filed
          </div>
          <div className="flex flex-wrap items-center gap-1.5 font-mono text-[10px] text-muted-foreground">
            {sortedReasons.map(([reason, count]) => (
              <Badge
                key={reason}
                variant="outline"
                className="border-[color:var(--color-sell)]/30 text-[9px] font-semibold uppercase tracking-wider text-[color:var(--color-sell)]"
              >
                {count}× {reason}
              </Badge>
            ))}
          </div>
        </div>

        <ul className="divide-y divide-border/40">
          {reports.map((r) => (
            <li key={r.id} className="py-3 text-xs">
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
                  <span className="text-muted-foreground">
                    · by {r.reporter}
                  </span>
                )}
              </div>
              {r.notes && (
                <p className="mt-1 text-muted-foreground">{r.notes}</p>
              )}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function VerificationPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-buy)]/30 bg-[color:var(--color-buy-muted)] px-1.5 py-0.5 font-mono text-[10px] font-semibold text-[color:var(--color-buy)]">
      <Check className="h-2.5 w-2.5" strokeWidth={3} />
      {label}
    </span>
  );
}

/** Short humanized seconds → "1m 38s" or "5m 26s". Mirrors how Binance's
 *  profile page renders avg times but stays on one line. */
function formatDurationShort(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}
