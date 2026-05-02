import { Topbar } from "@/components/shell/topbar";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { fetchBothSides, normalizeAds } from "@/lib/bybit";
import {
  buildMarket,
  mergeMerchantDirectory,
  summarizeMerchants,
} from "@/lib/analytics";
import { ASSET, FIAT, resolveBankPayTypes } from "@/lib/constants";
import { MerchantPanel } from "@/components/merchant/merchant-panel";
import { Empty } from "@/components/common/empty";
import { CloudOff } from "lucide-react";
import { listAllKnownMerchants } from "@/lib/db/queries";

export const revalidate = 30;

export const metadata = {
  title: "Merchants",
  description:
    "Counterparty analytics for Sri Lankan bank-transfer P2P on Bybit.",
};

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

export default async function MerchantsPage({
  searchParams,
}: {
  searchParams: SP;
}) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  let snapshot = null;
  let directory: ReturnType<typeof mergeMerchantDirectory> = [];
  try {
    const [{ buy, sell }, known] = await Promise.all([
      fetchBothSides({
        asset: filters.asset,
        fiat: filters.fiat,
        rows: 20,
        payTypes: resolveBankPayTypes(filters.payType),
        publisherType: filters.merchantType === "merchant" ? "merchant" : null,
      }),
      listAllKnownMerchants(filters.asset, filters.fiat).catch(() => []),
    ]);
    const ads = [
      ...normalizeAds(buy, "BUY"),
      ...normalizeAds(sell, "SELL"),
    ];
    snapshot = buildMarket(filters.asset, filters.fiat, ads);
    const marketMedian =
      snapshot.sell.medianPrice ?? snapshot.buy.medianPrice ?? null;
    const live = summarizeMerchants(ads, marketMedian);
    const nowTs = Math.floor(
      new Date(snapshot.fetchedAt).getTime() / 1000,
    );
    directory = mergeMerchantDirectory(live, known, marketMedian, nowTs);
  } catch {
    snapshot = null;
  }

  const subtitle = `${ASSET} / ${FIAT.code} · ${FIAT.name}`;

  return (
    <>
      <Topbar title="Merchants" subtitle={subtitle}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} />
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Merchant analytics"
          title={`Who's making the market in ${ASSET}/${FIAT.code}?`}
          description="Every counterparty we've seen on the LKR book, ranked by a composite trust score built from completion rate, order volume and release time. Toggle Active Now to filter to merchants currently listing."
        />

        <FilterBar initial={filters} />

        {snapshot ? (
          <MerchantPanel
            initial={snapshot}
            initialDirectory={directory}
            filters={filters}
          />
        ) : (
          <Empty
            icon={CloudOff}
            title="Couldn't reach Bybit P2P"
            description="The public P2P endpoint rejected our request or is temporarily unavailable."
            tone="warn"
          />
        )}
      </div>
    </>
  );
}
