import { Topbar } from "@/components/shell/topbar";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { MarketStar } from "@/components/workspace/star-button";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket } from "@/lib/analytics";
import { ASSETS, FIATS } from "@/lib/constants";
import { MerchantPanel } from "@/components/merchant/merchant-panel";
import { Empty } from "@/components/common/empty";
import { CloudOff } from "lucide-react";

export const revalidate = 30;

export const metadata = {
  title: "Merchants",
  description: "Counterparty analytics, trust scores and rail coverage for Binance P2P.",
};

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(
  sp: Record<string, string | string[] | undefined>,
): FilterState {
  const asset = String(sp.asset ?? "USDT").toUpperCase();
  const fiat = String(sp.fiat ?? "LKR").toUpperCase();
  const payType = String(sp.payType ?? "");
  const merchantType = String(sp.merchantType ?? "all");

  return {
    asset: (ASSETS as readonly string[]).includes(asset) ? asset : "USDT",
    fiat: FIATS.some((f) => f.code === fiat) ? fiat : "LKR",
    payType,
    merchantType: merchantType === "merchant" ? "merchant" : "all",
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
  try {
    const { buy, sell } = await fetchBothSides({
      asset: filters.asset,
      fiat: filters.fiat,
      rows: 20,
      payTypes: filters.payType ? [filters.payType] : [],
      publisherType: filters.merchantType === "merchant" ? "merchant" : null,
    });
    const ads = [
      ...normalizeAds(buy, "BUY"),
      ...normalizeAds(sell, "SELL"),
    ];
    snapshot = buildMarket(filters.asset, filters.fiat, ads);
  } catch {
    snapshot = null;
  }

  const fiat = FIATS.find((f) => f.code === filters.fiat);
  const subtitle = `${filters.asset} / ${filters.fiat}${fiat ? ` · ${fiat.name}` : ""}`;

  return (
    <>
      <Topbar title="Merchants" subtitle={subtitle}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} />
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Merchant analytics"
          title={`Who's making the market in ${filters.asset}/${filters.fiat}?`}
          description="Counterparties ranked by a composite trust score built from completion rate, order volume and release time. Premium vs median reveals who's pricing aggressively and who's skimming."
        />

        <FilterBar initial={filters} />

        {snapshot ? (
          <MerchantPanel initial={snapshot} filters={filters} />
        ) : (
          <Empty
            icon={CloudOff}
            title="Couldn't reach Binance P2P"
            description="The public P2P endpoint rejected our request or is temporarily unavailable."
            tone="warn"
          />
        )}
      </div>
    </>
  );
}
