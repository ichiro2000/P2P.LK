import { Clock, FileDown } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader, PageSection } from "@/components/common/page";
import { Empty } from "@/components/common/empty";
import { getExchange } from "@/lib/exchanges";
import { getActiveExchange } from "@/lib/exchange-server";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { RangeTabs } from "@/components/historical/range-tabs";
import { ReportPicker, type ReportKind } from "@/components/reports/report-picker";
import { ReportViewer } from "@/components/reports/report-viewer";
import { RecapCharts, type RecapPoint } from "@/components/reports/recap-charts";
import {
  dailyRecapReport,
  listAvailableMarkets,
  merchantScorecardReport,
  type ReportDocument,
} from "@/lib/reports";
import { listMarketSnapshots, listTrackedMarkets, parseRange } from "@/lib/db/queries";
import { ASSET, FIAT } from "@/lib/constants";
import { getViewer, isMember } from "@/lib/auth/session";
import { MembersTeaser } from "@/components/members/members-teaser";
import { privateMetadata } from "@/lib/seo";

export const metadata = privateMetadata("Reports", "follow");
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

const RANGE_LABEL: Record<string, string> = {
  "1h": "last hour",
  "6h": "last 6 hours",
  "24h": "last 24 hours",
  "7d": "last 7 days",
  "30d": "last 30 days",
};

function parseFilters(sp: Record<string, string | string[] | undefined>): FilterState {
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "merchant") === "all" ? "all" : "merchant",
  };
}

export default async function ReportsPage({ searchParams }: { searchParams: SP }) {
  // Reports and their CSV exports are members only (PLAN §9). Checked on the
  // server before any report data is built.
  const viewer = await getViewer();
  if (!isMember(viewer)) {
    return (
      <>
        <Topbar title="Reports" subtitle="Members only" />
        <PageBody>
          <MembersTeaser
            icon={FileDown}
            next="/reports"
            pending={!!viewer}
            title="Reports and CSV exports are for members"
            description="Create a free account to build daily recaps and merchant scorecards and download them as CSV."
            points={[
              "Daily recap over 24 hours, 7 days or 30 days",
              "Merchant scorecard from the live book",
              "One-click CSV for spreadsheets",
            ]}
          />
        </PageBody>
      </>
    );
  }

  const sp = await searchParams;
  const filters = parseFilters(sp);
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);
  const kindRaw = String(sp.kind ?? "recap") as ReportKind;
  const kind: ReportKind = kindRaw === "merchants" ? "merchants" : "recap";
  const range = parseRange(sp.range);

  const [tracked, available] = await Promise.all([listTrackedMarkets(ex, "30d"), listAvailableMarkets(ex)]);
  const hasHistory = available.some((m) => m.asset === filters.asset && m.fiat === filters.fiat);

  let doc: ReportDocument | null = null;
  let points: RecapPoint[] = [];
  let errorMsg: string | null = null;

  try {
    if (kind === "merchants") {
      doc = await merchantScorecardReport(ex, filters.asset, filters.fiat);
    } else if (hasHistory) {
      const [d, snaps] = await Promise.all([
        dailyRecapReport(ex, filters.asset, filters.fiat, range),
        listMarketSnapshots(ex, filters.asset, filters.fiat, range).catch(() => []),
      ]);
      doc = d;
      points = snaps.map((s) => ({
        t: s.ts * 1000,
        bid: s.bestBid,
        ask: s.bestAsk,
        mid: s.mid,
        spreadPct: s.spreadPct,
      }));
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "Report generation failed";
  }

  const mids = points.map((p) => p.mid).filter((v): v is number => v != null);
  const spreads = points.map((p) => p.spreadPct).filter((v): v is number => v != null);
  const rangeLabel = RANGE_LABEL[range] ?? range;

  return (
    <>
      <Topbar title="Reports" subtitle={`${ASSET}/${FIAT.code} · ${adapter.label}`} />
      <PageBody>
        <PageHeader
          title="Reports"
          description="Pick a report, set your filters and download a CSV to paste into a spreadsheet or share. The daily recap reads the stored history; the merchant scorecard uses the live book."
          actions={kind === "recap" ? <RangeTabs value={range} member /> : null}
        />

        <div className="space-y-3">
          <ReportPicker value={kind} />
          <FilterBar initial={filters} payTypes={adapter.payMethods} showPayType={false} />
        </div>

        {errorMsg ? (
          <Empty icon={Clock} title="Couldn't generate this report" description={errorMsg} tone="error" />
        ) : !doc ? (
          <Empty
            icon={Clock}
            title={kind === "recap" ? "No history for this market yet" : "Nothing to show"}
            description={
              kind === "recap"
                ? tracked.length === 0
                  ? "The collector hasn't stored any snapshots yet. Come back once it has run for a while."
                  : `Markets with history: ${tracked.map((t) => `${t.asset}/${t.fiat}`).join(", ")}.`
                : "Pick a report type above to begin."
            }
          />
        ) : (
          <>
            {kind === "recap" && (
              <PageSection title="Market over the window">
                <RecapCharts points={points} rangeLabel={rangeLabel} />
              </PageSection>
            )}
            <PageSection title="Report">
              <ReportViewer doc={doc} sparks={{ "Latest mid": mids, "Average spread": spreads }} />
            </PageSection>
          </>
        )}
      </PageBody>
    </>
  );
}
