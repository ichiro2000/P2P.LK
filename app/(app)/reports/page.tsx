import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { Badge } from "@/components/ui/badge";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { ReportPicker, type ReportKind } from "@/components/reports/report-picker";
import { ReportViewer } from "@/components/reports/report-viewer";
import { Empty } from "@/components/common/empty";
import { RangeTabs } from "@/components/historical/range-tabs";
import {
  dailyRecapReport,
  listAvailableMarkets,
  merchantScorecardReport,
  type ReportDocument,
} from "@/lib/reports";
import { listTrackedMarkets, RANGES, type RangeKey } from "@/lib/db/queries";
import { ASSET, FIAT } from "@/lib/constants";
import { Clock } from "lucide-react";

export const metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): FilterState {
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "merchant") === "all" ? "all" : "merchant",
  };
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const kindRaw = String(sp.kind ?? "recap") as ReportKind;
  const kind: ReportKind = kindRaw === "merchants" ? "merchants" : "recap";
  const rangeKey = String(sp.range ?? "24h") as RangeKey;
  const range: RangeKey = rangeKey in RANGES ? rangeKey : "24h";

  const [tracked, available] = await Promise.all([
    listTrackedMarkets("30d"),
    listAvailableMarkets(),
  ]);
  const hasHistory = available.some(
    (m) => m.asset === filters.asset && m.fiat === filters.fiat,
  );

  let doc: ReportDocument | null = null;
  let errorMsg: string | null = null;

  try {
    if (kind === "merchants") {
      doc = await merchantScorecardReport(filters.asset, filters.fiat);
    } else if (hasHistory) {
      doc = await dailyRecapReport(filters.asset, filters.fiat, range);
    }
  } catch (err) {
    errorMsg = err instanceof Error ? err.message : "Report generation failed";
  }

  const subtitle = `${ASSET} / ${FIAT.code} · ${FIAT.name}`;

  return (
    <>
      <Topbar title="Reports" subtitle={subtitle}>
        <Badge
          variant="outline"
          className="hidden sm:inline-flex border-dashed bg-transparent text-[10px] text-muted-foreground/80"
        >
          CSV export
        </Badge>
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Reports"
          title="Exportable snapshots of the LKR bank market"
          description="Pick a report type, set your filters, and download a CSV you can paste into a spreadsheet or share with a counterparty. Daily recap reads the ingested time-series; merchant scorecards run against the live feed."
          right={kind === "recap" ? <RangeTabs value={range} /> : null}
        />

        <ReportPicker value={kind} />

        <FilterBar initial={filters} />

        {errorMsg ? (
          <Empty
            icon={Clock}
            title="Couldn't generate this report"
            description={errorMsg}
            tone="error"
          />
        ) : !doc ? (
          <Empty
            icon={Clock}
            title={
              kind === "recap"
                ? "No history for this market yet"
                : "Nothing to show"
            }
            description={
              kind === "recap"
                ? tracked.length === 0
                  ? "The ingest worker hasn't run. Start it with `npm run ingest:loop` to accumulate snapshots, then come back to generate a recap."
                  : `Tracked markets with history: ${tracked.map((t) => `${t.asset}/${t.fiat}`).join(", ")}.`
                : "Pick a report type above to begin."
            }
          />
        ) : (
          <ReportViewer doc={doc} />
        )}
      </div>
    </>
  );
}
