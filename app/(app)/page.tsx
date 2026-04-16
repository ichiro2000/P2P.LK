import { Topbar } from "@/components/shell/topbar";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { LiveMarket } from "@/components/market/live-market";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket } from "@/lib/analytics";
import { ASSET, FIAT, resolveBankPayTypes } from "@/lib/constants";
import { Empty } from "@/components/common/empty";
import { CloudOff } from "lucide-react";

export const revalidate = 20;

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): FilterState {
  // Asset + fiat are locked to USDT/LKR; payType narrows to one of the two
  // bank identifiers or stays empty to mean "both".
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "all") === "merchant" ? "merchant" : "all",
  };
}

export default async function HomePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  let snapshotOrNull = null;
  try {
    const { buy, sell } = await fetchBothSides({
      asset: filters.asset,
      fiat: filters.fiat,
      payTypes: resolveBankPayTypes(filters.payType),
      publisherType: filters.merchantType === "merchant" ? "merchant" : null,
      rows: 20,
    });
    const ads = [
      ...normalizeAds(buy, "BUY"),
      ...normalizeAds(sell, "SELL"),
    ];
    snapshotOrNull = buildMarket(filters.asset, filters.fiat, ads);
  } catch {
    snapshotOrNull = null;
  }

  const subtitle = `${filters.asset} / ${filters.fiat} · ${FIAT.name}`;

  return (
    <>
      <Topbar title="Live markets" subtitle={subtitle}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} />
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Market overview"
          title={`${FIAT.flag} USDT on Binance P2P · LKR bank transfers`}
          description="Top-of-book prices, round-trip spread, live depth and the advertisements you can actually trade against — scoped to Sri Lankan bank transfers. Refreshed every 20 seconds."
        />

        <FilterBar initial={filters} />

        {snapshotOrNull ? (
          <LiveMarket initial={snapshotOrNull} filters={filters} />
        ) : (
          <Empty
            icon={CloudOff}
            title="Couldn't reach Binance P2P"
            description="The public P2P endpoint rejected our request or is temporarily unavailable. This happens occasionally — try refreshing in a few seconds."
            tone="warn"
          />
        )}
      </div>
    </>
  );
}
