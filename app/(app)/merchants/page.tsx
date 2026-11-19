import { Suspense } from "react";
import { CloudOff } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { LiveDot } from "@/components/common/live-dot";
import { Empty } from "@/components/common/empty";
import { MarketStar } from "@/components/workspace/star-button";
import { MerchantPanel } from "@/components/merchant/merchant-panel";
import { MarketActivitySection, MarketActivitySkeleton } from "@/components/merchant/market-activity-section";
import { buildMarket, buildMerchantDirectory, type MerchantRow } from "@/lib/analytics";
import { ASSET, FIAT } from "@/lib/constants";
import { getExchange, resolvePayTypes } from "@/lib/exchanges";
import { getActiveExchange } from "@/lib/exchange-server";
import { getBook } from "@/lib/market-data";
import { merchantDirectoryData } from "@/lib/db/merchant-directory";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import { merchantStability } from "@/lib/db/insights";
import { showcaseMap, type ShowcaseMap } from "@/lib/market-insights";
import type { MarketSnapshot, NormalizedAd } from "@/lib/types";
import type { ExchangeId } from "@/lib/exchanges";
import { LIVE_DEEP_N } from "@/lib/live";
import { getViewer, isMember } from "@/lib/auth/session";
import { linkedAdvertisers } from "@/lib/merchant-link";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Binance & Bybit P2P Merchants in Sri Lanka (LKR)",
  description:
    "Every USDT/LKR P2P merchant on Binance and Bybit bank-transfer ads, ranked by reliability: completion rate, 30-day orders, time on the book and tenure.",
  path: "/merchants",
});

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(sp: Record<string, string | string[] | undefined>): FilterState {
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "merchant") === "all" ? "all" : "merchant",
  };
}

/** The signed-in member's linked advertiser id on this exchange, if any. */
async function ownMerchantId(ex: ExchangeId): Promise<string | null> {
  try {
    const viewer = await getViewer();
    if (!isMember(viewer)) return null;
    return linkedAdvertisers(viewer).find((l) => l.exchange === ex)?.id ?? null;
  } catch {
    return null;
  }
}

export default async function MerchantsPage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);

  let snapshot: MarketSnapshot | null = null;
  let directory: MerchantRow[] = [];
  let showcase: ShowcaseMap = {};
  // Competitor compare: the full book (every publisher, up to LIVE_DEEP_N a side).
  let deep: { ads: NormalizedAd[]; ts: number } | null = null;
  const selfIdP = ownMerchantId(ex);
  try {
    const [book, known, stability, deepBook] = await Promise.all([
      getBook(ex, {
        asset: filters.asset,
        fiat: filters.fiat,
        payTypes: resolvePayTypes(adapter, ""),
        publisherType: filters.merchantType === "merchant" ? "merchant" : null,
      }),
      merchantDirectoryData(ex, filters.asset, filters.fiat).catch(() => null),
      merchantStability(ex, filters.asset, filters.fiat).catch(() => []),
      getBook(ex, { asset: filters.asset, fiat: filters.fiat, publisherType: null }, LIVE_DEEP_N).catch(() => null),
    ]);
    deep = deepBook ? { ads: [...deepBook.buy, ...deepBook.sell], ts: deepBook.ts } : null;
    const ads = [...book.buy, ...book.sell];
    snapshot = buildMarket(filters.asset, filters.fiat, ads);
    // The directory comes from the full 5-minute sweep, not the top-20 book.
    directory = buildMerchantDirectory({
      known: known?.known ?? [],
      latestSweepTs: known?.latestSweepTs ?? null,
      trackedHours7d: known?.trackedHours7d ?? null,
      liveAds: ads,
    });
    if (filters.merchantType === "merchant") {
      directory = directory.filter(
        (m) => deriveMerchantTier({ isMerchant: m.isMerchant, userIdentity: m.userIdentity, vipLevel: m.vipLevel }) != null,
      );
    }
    showcase = showcaseMap(stability);
  } catch {
    snapshot = null;
  }
  const selfId = await selfIdP;

  return (
    <>
      <Topbar title="Merchants" subtitle={`${ASSET} / ${FIAT.code} · ${adapter.label} P2P`}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} size="md" className="size-10 sm:size-8" />
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <PageBody>
        <PageHeader
          eyebrow="Merchant analytics"
          title={`Who makes the ${ASSET}/${FIAT.code} market`}
          description="Every advertiser our 5-minute sweep has seen on the LKR bank-transfer book, ranked by a reliability score: confidence-adjusted completion, 30-day volume, feedback, release time, presence, tenure and account age. “Static ad?” marks listings whose amount and orders haven't moved for hours — an estimate."
        />

        <FilterBar initial={filters} payTypes={adapter.bankPayTypes} showPayType={false} />

        {snapshot ? (
          <MerchantPanel
            initial={snapshot}
            initialDirectory={directory}
            filters={filters}
            exchange={ex}
            showcase={showcase}
            initialBook={deep}
            selfId={selfId}
          />
        ) : (
          <Empty
            icon={CloudOff}
            title={`Couldn't reach ${adapter.label} P2P`}
            description="The public P2P endpoint rejected our request or is temporarily unavailable."
            tone="warn"
          />
        )}

        <Suspense fallback={<MarketActivitySkeleton />}>
          <MarketActivitySection exchange={ex} />
        </Suspense>
      </PageBody>
    </>
  );
}
