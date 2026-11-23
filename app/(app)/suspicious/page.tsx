import Link from "next/link";
import { Lock, Plus } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { KpiGrid, PageBody, PageHeader, PageSection } from "@/components/common/page";
import { KpiCard } from "@/components/common/kpi-card";
import { buttonVariants } from "@/components/ui/button";
import { QrChecker } from "@/components/suspicious/qr-checker";
import { RegistryList } from "@/components/suspicious/registry-list";
import { ReportsWeekChart, type WeekPoint } from "@/components/suspicious/reports-week-chart";
import { bulkActivityForSuspicious, listSuspicious, type SuspiciousReport } from "@/lib/db/suspicious";
import { pageMetadata } from "@/lib/seo";
import { getViewer, isMember } from "@/lib/auth/session";
import { Callout } from "@/components/suspicious/parts";

export const metadata = pageMetadata({
  title: "Suspicious P2P Takers: Check a Binance Profile",
  description:
    "Community registry of suspicious USDT/LKR P2P takers reported by Sri Lankan merchants. Check a Binance Share-Profile QR in your browser before you trade.",
  path: "/suspicious",
});
export const dynamic = "force-dynamic";

const WEEK = 7 * 86_400;
const WEEKS = 12;

/** Reports per week for the last `WEEKS` weeks (ts in seconds; t in ms). */
function weeklyCounts(reports: SuspiciousReport[], nowSec: number): WeekPoint[] {
  const end = nowSec;
  const start = end - WEEKS * WEEK;
  const counts = new Array<number>(WEEKS).fill(0);
  for (const r of reports) {
    if (r.ts < start || r.ts > end) continue;
    const i = Math.min(WEEKS - 1, Math.floor((r.ts - start) / WEEK));
    counts[i] += 1;
  }
  return counts.map((reports, i) => ({ t: (start + i * WEEK) * 1000, reports }));
}

/** Request time (server render — evaluated once per request). */
function nowSeconds() {
  return Math.floor(Date.now() / 1000);
}

export default async function SuspiciousPage() {
  // Guests get the counts and the QR check only. The full registry (names,
  // reasons, profile links) is for approved members, so it can't be scraped
  // or used by a flagged taker to see who else is listed.
  const [reports, viewer] = await Promise.all([listSuspicious(), getViewer()]);
  const canSeeList = isMember(viewer);

  // Earliest report per taker → "orders since flagged". `listSuspicious` is
  // newest-first, so the minimum ts per userId is the first report.
  const firstTsById = new Map<string, number>();
  for (const r of reports) {
    const cur = firstTsById.get(r.userId);
    if (cur === undefined || r.ts < cur) firstTsById.set(r.userId, r.ts);
  }
  const activity = await bulkActivityForSuspicious(
    "binance",
    Array.from(firstTsById.entries()).map(([merchantId, firstReportTs]) => ({
      merchantId,
      firstReportTs,
    })),
  ).catch(() => new Map());

  const acts = Array.from(activity.values());
  const liveNow = acts.filter((a) => a.isActive).length;
  const stillTrading = acts.filter((a) => (a.ordersDelta ?? 0) > 0).length;
  const nowSec = nowSeconds();
  const weeks = weeklyCounts(reports, nowSec);
  const last30 = reports.filter((r) => r.ts >= nowSec - 30 * 86_400).length;

  return (
    <>
      <Topbar title="Suspicious takers" subtitle="Community registry" />
      <PageBody>
        <PageHeader
          eyebrow="Community registry"
          title="Is this taker safe to trade with?"
          description="Upload a Binance Share-Profile QR to check it against reports from other merchants. The QR is decoded in your browser, so the image never leaves your device."
          actions={
            <Link href="/suspicious/new" className={buttonVariants({ className: "h-10 w-full sm:h-9 sm:w-auto" })}>
              <Plus /> Add report
            </Link>
          }
        />

        <KpiGrid>
          <KpiCard label="Flagged takers" value={firstTsById.size} sub={`${reports.length} reports in total`} />
          <KpiCard label="Reports · 30 days" value={last30} spark={weeks.map((w) => w.reports)} sparkTone="neutral" />
          <KpiCard
            label="Live on the book"
            value={liveNow}
            tone={liveNow > 0 ? "sell" : undefined}
            sub="in the latest tick"
          />
          <KpiCard
            label="Still trading"
            value={stillTrading}
            tone={stillTrading > 0 ? "sell" : undefined}
            sub="orders up since flagged"
          />
        </KpiGrid>

        <div className="grid gap-6 lg:grid-cols-2">
          <PageSection title="Check a QR" description="Find out in seconds whether a taker has been reported.">
            <QrChecker />
          </PageSection>
          <PageSection title="Activity" description="How many reports the community files each week.">
            <ReportsWeekChart weeks={weeks} />
          </PageSection>
        </div>

        <PageSection
          title="Registry"
          description={
            canSeeList
              ? "Takers on the book right now are listed first, then takers still trading after their first report."
              : undefined
          }
        >
          {canSeeList ? (
            <RegistryList reports={reports} activity={Object.fromEntries(activity)} />
          ) : (
            <Callout tone="neutral" icon={Lock} title="The full registry is for approved merchants">
              <p>
                {firstTsById.size.toLocaleString("en-US")} takers are flagged. To check one, upload their Binance QR
                above. Approved P2P.LK merchants can browse the whole list.
              </p>
              <Link
                href={viewer ? "/account/status" : "/sign-in?next=%2Fsuspicious"}
                className={buttonVariants({ variant: "outline", className: "mt-3 h-10 sm:h-9" })}
              >
                {viewer ? "Check account status" : "Sign in"}
              </Link>
            </Callout>
          )}
        </PageSection>
      </PageBody>
    </>
  );
}
