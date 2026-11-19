import Link from "next/link";
import { notFound } from "next/navigation";
import { AlertTriangle, ArrowLeft, Check, ExternalLink, TrendingUp } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { KpiGrid, PageBody, PageHeader, PageSection } from "@/components/common/page";
import { KpiCard } from "@/components/common/kpi-card";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { ASSET, FIAT } from "@/lib/constants";
import {
  activityForSuspicious,
  reportsForUser,
  suspiciousOrderHistory,
  type SuspiciousReport,
} from "@/lib/db/suspicious";
import { OrderTrendChart } from "@/components/suspicious/order-trend-chart";
import { RemovalRequestForm } from "@/components/suspicious/removal-request-form";
import { Callout, ReasonBadge, ReportItem } from "@/components/suspicious/parts";
import { formatPct, formatSLT, formatCount } from "@/lib/format";
import { fetchBinanceAdvertiserPublic, type BinanceAdvertiserPublic } from "@/lib/qr-resolve";
import { NOINDEX, NOINDEX_NOFOLLOW, SITE_NAME } from "@/lib/seo";
import type { Metadata } from "next";

export const dynamic = "force-dynamic";

/**
 * Individual taker pages are `noindex` on purpose. They name a person on the
 * strength of unverified community reports, so they must not rank for that
 * person's nickname or user id; removal requests exist precisely because a
 * report can be wrong. They stay crawlable (no robots.txt block) so Google
 * can see the noindex. Merchants find them through the registry and the QR
 * check; the registry list itself is indexed. The title still names the
 * taker so a link shared between merchants previews usefully.
 */
export async function generateMetadata({ params }: { params: Promise<{ id: string }> }): Promise<Metadata> {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);
  const reports = await reportsForUser("binance", id).catch(() => []);
  if (reports.length === 0) return { title: "Taker not found", robots: NOINDEX_NOFOLLOW };
  const name = reports[0].displayName || "Unknown taker";
  const n = reports.length;
  const title = `Flagged taker: ${name} (${n} report${n === 1 ? "" : "s"})`;
  const description = `Community reports from Sri Lankan P2P merchants about Binance taker ${name}. Check the reasons and recent activity before you trade.`;
  return {
    title,
    description,
    robots: NOINDEX,
    openGraph: { title, description, siteName: SITE_NAME, type: "website" },
    twitter: { card: "summary_large_image", title, description },
  };
}

function binanceUrl(userId: string) {
  return `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(userId)}`;
}

export default async function SuspiciousDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id: raw } = await params;
  const id = decodeURIComponent(raw);

  const reports = await reportsForUser("binance", id);
  if (reports.length === 0) notFound();

  // `reportsForUser` is newest-first, so the last element is the first report.
  const firstReportTs = reports[reports.length - 1].ts;

  const [activity, orderHistory, binance] = await Promise.all([
    activityForSuspicious("binance", id, firstReportTs).catch(() => null),
    suspiciousOrderHistory("binance", id).catch(() => []),
    // Live Binance fetch (public, no auth): verifications, join date and
    // all-time trade count that we don't store locally.
    fetchBinanceAdvertiserPublic(id).catch(() => null),
  ]);

  const head = reports[0];
  const displayName = activity?.merchantName ?? binance?.nickName ?? head.displayName ?? "Unknown taker";
  const isActive = activity?.isActive ?? false;
  const ordersDelta = activity?.ordersDelta ?? null;
  const stillTrading = ordersDelta != null && ordersDelta > 0;
  const n = reports.length;

  return (
    <>
      <Topbar title={displayName} subtitle={`Flagged taker · ${ASSET}/${FIAT.code}`} />
      <PageBody>
        <PageHeader
          eyebrow={
            <Link href="/suspicious" className="inline-flex items-center gap-1 hover:text-foreground">
              <ArrowLeft className="size-3.5" /> Registry
            </Link>
          }
          title={
            <span className="inline-flex flex-wrap items-center gap-2">
              <span className="break-all">{displayName}</span>
              <Badge
                variant="outline"
                className="border-[color:var(--color-sell)]/40 font-mono tabular-nums text-[color:var(--color-sell)]"
              >
                {n} report{n === 1 ? "" : "s"}
              </Badge>
            </span>
          }
          description={<ProfileMeta userId={id} binance={binance} />}
          actions={
            <a
              href={binanceUrl(id)}
              target="_blank"
              rel="noopener noreferrer"
              className={buttonVariants({ variant: "outline", className: "h-10 w-full sm:h-9 sm:w-auto" })}
            >
              <ExternalLink /> View on Binance
            </a>
          }
        />

        {isActive && (
          <Callout tone="sell" icon={AlertTriangle} title="Active on the LKR book right now" role="alert">
            This taker appears in the most recent ingest tick. If you&apos;re trading now, decline their offer and
            warn your counterparties.
          </Callout>
        )}
        {!isActive && stillTrading && (
          <Callout tone="warn" icon={TrendingUp} title="Still trading after the first report">
            Their rolling 30-day order count has grown by{" "}
            <span className="font-mono font-semibold text-foreground">+{ordersDelta}</span> since{" "}
            <span className="font-mono">{formatSLT(firstReportTs)} SLT</span>. They may be offline now, but the
            book has seen them since.
          </Callout>
        )}

        <Stats
          binance={binance}
          reportsCount={n}
          ordersLatest={activity?.ordersLatest ?? null}
          ordersAtReport={activity?.ordersAtReport ?? null}
          ordersDelta={ordersDelta}
          ticksSinceReport={activity?.ticksSinceReport ?? 0}
        />

        <BinanceFacts binance={binance} />

        <PageSection title="Order trend">
          <OrderTrendChart points={orderHistory} firstReportTs={firstReportTs} />
        </PageSection>

        <PageSection title="Reports filed" description={`${n} report${n === 1 ? "" : "s"} on record, newest first.`}>
          <ReportsList reports={reports} />
        </PageSection>

        <PageSection>
          <RemovalRequestForm binanceUserId={id} displayName={displayName} />
        </PageSection>
      </PageBody>
    </>
  );
}

function ProfileMeta({ userId, binance }: { userId: string; binance: BinanceAdvertiserPublic | null }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
      <span className="font-mono">
        {ASSET}/{FIAT.code}
      </span>
      <span aria-hidden>·</span>
      <span className="font-mono break-all" title={userId}>
        {userId}
      </span>
      {binance?.userIdentity && (
        <>
          <span aria-hidden>·</span>
          <span className="font-mono">{binance.userIdentity.toLowerCase().replace(/_/g, " ")}</span>
        </>
      )}
    </span>
  );
}

function Stats({
  binance,
  reportsCount,
  ordersLatest,
  ordersAtReport,
  ordersDelta,
  ticksSinceReport,
}: {
  binance: BinanceAdvertiserPublic | null;
  reportsCount: number;
  ordersLatest: number | null;
  ordersAtReport: number | null;
  ordersDelta: number | null;
  ticksSinceReport: number;
}) {
  // Fresh accounts are the strongest scam signal: red under 30 days, a
  // warning note under 90.
  const ageDays =
    binance?.registerTime != null ? Math.max(0, Math.floor(msSince(binance.registerTime) / 86_400_000)) : null;
  const ageSub =
    ageDays == null
      ? "needs Binance profile"
      : ageDays < 30
        ? "under 30 days · fresh account"
        : ageDays < 90
          ? "under 90 days · still new"
          : "since registration";

  const orders30 = ordersLatest ?? binance?.monthOrderCount ?? null;
  const ordersSub =
    ordersLatest != null ? "our snapshots" : binance?.monthOrderCount != null ? "live from Binance" : "rolling 30 days";

  return (
    <KpiGrid>
      <KpiCard
        label="Account age"
        value={ageDays != null ? formatAgeDays(ageDays) : "—"}
        tone={ageDays != null && ageDays < 30 ? "sell" : undefined}
        sub={ageSub}
      />
      <KpiCard
        label="All trades"
        value={formatCount(binance?.allTradeCount)}
        sub={binance?.allTradeCount != null ? "lifetime · Binance" : "needs Binance profile"}
      />
      <KpiCard label="Orders · 30 days" value={formatCount(orders30)} sub={ordersSub} />
      <KpiCard
        label="Completion · 30 days"
        value={binance?.monthFinishRate != null ? formatPct(binance.monthFinishRate, { frac: 2 }) : "—"}
        tone={binance?.monthFinishRate != null && binance.monthFinishRate < 0.9 ? "sell" : undefined}
        sub={
          binance?.monthFinishRate == null
            ? "needs Binance profile"
            : binance.monthFinishRate < 0.9
              ? "below 90% · many cancels"
              : "live from Binance"
        }
      />
      <KpiCard
        label="Orders at first report"
        value={formatCount(ordersAtReport)}
        sub={ordersAtReport == null ? "no snapshot then" : "closest snapshot"}
      />
      <KpiCard
        label="Change since flagged"
        value={ordersDelta == null ? "—" : `${ordersDelta > 0 ? "+" : ""}${ordersDelta}`}
        tone={ordersDelta != null && ordersDelta > 0 ? "sell" : undefined}
        sub="positive = still trading"
      />
      <KpiCard
        label="Ticks since flag"
        value={formatCount(ticksSinceReport)}
        sub={ticksSinceReport > 0 ? "LKR listings after report" : "not relisted since"}
      />
      <KpiCard label="Reports" value={reportsCount} tone="sell" sub="active on record" />
    </KpiGrid>
  );
}

function BinanceFacts({ binance }: { binance: BinanceAdvertiserPublic | null }) {
  if (
    !binance ||
    (binance.avgReleaseTimeSec == null &&
      binance.avgPayTimeSec == null &&
      binance.registerTime == null &&
      !binance.emailVerified &&
      !binance.mobileVerified &&
      !binance.kycVerified)
  ) {
    return null;
  }
  return (
    <Card className="gap-0 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-xs sm:flex sm:flex-wrap sm:items-center sm:gap-x-6">
        {binance.registerTime != null && (
          <Fact label="Joined">{formatSLT(new Date(binance.registerTime), { dateStyle: "medium" })}</Fact>
        )}
        {binance.avgReleaseTimeSec != null && (
          <Fact label="Avg release">{formatDurationShort(binance.avgReleaseTimeSec)}</Fact>
        )}
        {binance.avgPayTimeSec != null && <Fact label="Avg pay">{formatDurationShort(binance.avgPayTimeSec)}</Fact>}
        {(binance.emailVerified || binance.mobileVerified || binance.kycVerified) && (
          <div className="col-span-2 flex flex-wrap items-center gap-1.5 sm:col-span-1">
            <dt className="sr-only">Verified</dt>
            {binance.emailVerified && <VerificationPill label="Email" />}
            {binance.mobileVerified && <VerificationPill label="SMS" />}
            {binance.kycVerified && <VerificationPill label="ID" />}
          </div>
        )}
      </dl>
    </Card>
  );
}

function Fact({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-0.5 sm:flex-row sm:items-baseline sm:gap-1.5">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="font-mono tabular-nums text-foreground">{children}</dd>
    </div>
  );
}

function ReportsList({ reports }: { reports: SuspiciousReport[] }) {
  const reasonCounts = new Map<string, number>();
  for (const r of reports) reasonCounts.set(r.reason, (reasonCounts.get(r.reason) ?? 0) + 1);
  const sortedReasons = Array.from(reasonCounts.entries()).sort((a, b) => b[1] - a[1]);

  return (
    <Card className="gap-4 px-4 py-4">
      {sortedReasons.length > 1 && (
        <div className="flex flex-wrap gap-1.5">
          {sortedReasons.map(([reason, count]) => (
            <ReasonBadge key={reason} reason={`${count}× ${reason}`} />
          ))}
        </div>
      )}
      <ul className="divide-y divide-border">
        {reports.map((r) => (
          <ReportItem key={r.id} report={r} />
        ))}
      </ul>
    </Card>
  );
}

function VerificationPill({ label }: { label: string }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-md border border-[color:var(--color-buy)]/30 bg-[color:var(--color-buy)]/10 px-1.5 py-0.5 font-mono text-xs font-medium text-[color:var(--color-buy)]">
      <Check className="size-3" strokeWidth={3} />
      {label}
    </span>
  );
}

/** Seconds → "1m 38s". */
function formatDurationShort(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return s > 0 ? `${m}m ${s}s` : `${m}m`;
}

/** Account age in days → "14d", "8mo", "1y 3mo". */
function formatAgeDays(days: number): string {
  if (!Number.isFinite(days) || days < 0) return "—";
  if (days < 60) return `${days}d`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo`;
  const years = Math.floor(months / 12);
  const remMonths = months % 12;
  return remMonths > 0 ? `${years}y ${remMonths}mo` : `${years}y`;
}

/** Milliseconds since `ms` (server render — evaluated once per request). */
function msSince(ms: number): number {
  return Date.now() - ms;
}
