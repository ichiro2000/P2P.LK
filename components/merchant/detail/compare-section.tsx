import { PageSection } from "@/components/common/page";
import { Skeleton } from "@/components/ui/skeleton";
import { CompetitorCompare } from "@/components/merchant/competitor-compare";
import { buildMerchantDirectory } from "@/lib/analytics";
import { competitorInfoFrom } from "@/lib/competitors";
import { merchantDirectoryData } from "@/lib/db/merchant-directory";
import { getExchange, type ExchangeId } from "@/lib/exchanges";
import { getBook } from "@/lib/market-data";
import { LIVE_DEEP_N } from "@/lib/live";

const TITLE = "Compare with competitors";
const DESCRIPTION =
  "Live ads on the same side whose minimum order is close to this merchant's: who a taker with the same order size sees instead.";

/**
 * Async server section (the page wraps it in <Suspense>): the full live book
 * (every publisher, every bank rail, up to LIVE_DEEP_N a side) and the
 * directory extras (reliability, release time, feedback, own spread).
 * Refreshing re-renders the server page; there's no poller here.
 */
export async function CompetitorSection({
  exchange,
  asset,
  fiat,
  id,
  name,
}: {
  exchange: ExchangeId;
  asset: string;
  fiat: string;
  id: string;
  name: string;
}) {
  const [book, dir] = await Promise.all([
    getBook(exchange, { asset, fiat, publisherType: null }, LIVE_DEEP_N).catch(() => null),
    merchantDirectoryData(exchange, asset, fiat).catch(() => null),
  ]);
  if (!book) {
    return (
      <PageSection id="compare" title={TITLE} description={DESCRIPTION}>
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          The live book isn&apos;t available right now. Try again in a minute.
        </p>
      </PageSection>
    );
  }
  const ads = [...book.buy, ...book.sell];
  const directory = dir
    ? buildMerchantDirectory({ known: dir.known, latestSweepTs: dir.latestSweepTs, trackedHours7d: dir.trackedHours7d })
    : [];
  return (
    <PageSection id="compare" title={TITLE} description={DESCRIPTION}>
      <CompetitorCompare
        exchange={exchange}
        ads={ads}
        bookTs={book.ts}
        info={competitorInfoFrom(directory, ads)}
        selfId={id}
        selfName={name}
        payTypes={getExchange(exchange).bankPayTypes}
        scopeNote={`every publisher, all bank rails, top ${LIVE_DEEP_N} a side`}
      />
    </PageSection>
  );
}

export function CompetitorSectionSkeleton() {
  return (
    <PageSection id="compare" title={TITLE} description={DESCRIPTION}>
      <Skeleton className="h-96 w-full rounded-xl" />
    </PageSection>
  );
}
