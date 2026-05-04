import { Topbar } from "@/components/shell/topbar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { Empty } from "@/components/common/empty";
import { PatternHeatmap } from "@/components/patterns/pattern-heatmap";
import { PatternTrends } from "@/components/patterns/pattern-trends";
import { computePatterns } from "@/lib/patterns";
import { ASSET, FIAT, PAYMENT_LABEL } from "@/lib/constants";
import { Calendar } from "lucide-react";
import type { RangeKey } from "@/lib/db/queries";

export const metadata = {
  title: "Patterns",
  description:
    "Hour-of-day and weekday patterns in price, spread and depth on the USD / Wise USDT P2P book.",
};

// Patterns aggregate the snapshot history; cheap to recompute on every request,
// and we want the heatmap to drift with the latest tick.
export const revalidate = 300;

type SP = Promise<Record<string, string | string[] | undefined>>;

const ALLOWED_RANGES: RangeKey[] = ["7d", "30d"];

export default async function PatternsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const requested = String(sp.range ?? "30d") as RangeKey;
  const range: RangeKey = ALLOWED_RANGES.includes(requested) ? requested : "30d";

  let result: Awaited<ReturnType<typeof computePatterns>> | null = null;
  let error: string | null = null;
  try {
    result = await computePatterns(ASSET, FIAT.code, range);
  } catch (err) {
    error = err instanceof Error ? err.message : "unknown error";
  }

  const subtitle = `${ASSET} / ${FIAT.code} · ${PAYMENT_LABEL}`;

  return (
    <>
      <Topbar title="Market patterns" subtitle={subtitle}>
        <LiveDot label={`${range}`} className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Recurring cycles"
          title="When does the book widen, when does depth dry up?"
          description={`Hour-of-day × weekday averages for price, spread and depth on the ${PAYMENT_LABEL} book. Bid-side and ask-side are split so you can see who shows up when. Data is bucketed in Asia/Colombo time.`}
          right={
            <RangeTabs current={range} />
          }
        />

        {result == null ? (
          <Empty
            icon={Calendar}
            title="Patterns aren't ready yet"
            description={
              error
                ? `Couldn't load history: ${error}. The ingest worker writes a snapshot every 5 minutes — patterns become meaningful once we have at least a few days of data.`
                : "The ingest worker writes a snapshot every 5 minutes — patterns become meaningful once we have at least a few days of data. Check back in a day or two."
            }
            tone="warn"
          />
        ) : result.grid.totalSamples === 0 ? (
          <Empty
            icon={Calendar}
            title={`No history yet for ${ASSET}/${FIAT.code}`}
            description="The ingest worker writes a snapshot every 5 minutes. Once a few days of ticks have accumulated, this page will surface the recurring weekday × hour patterns."
            tone="warn"
          />
        ) : (
          <div className="space-y-6">
            <PatternHeatmap result={result} fiat={FIAT.code} />
            <PatternTrends result={result} fiat={FIAT.code} />
          </div>
        )}
      </div>
    </>
  );
}

function RangeTabs({ current }: { current: RangeKey }) {
  return (
    <div className="inline-flex rounded-md border border-border bg-card/60 p-0.5 text-[11px] font-mono">
      {ALLOWED_RANGES.map((r) => (
        <a
          key={r}
          href={`?range=${r}`}
          className={`px-2.5 py-1 rounded transition-colors ${
            current === r
              ? "bg-primary/15 text-foreground"
              : "text-muted-foreground hover:text-foreground"
          }`}
        >
          {r}
        </a>
      ))}
    </div>
  );
}
