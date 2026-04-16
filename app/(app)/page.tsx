import { Topbar } from "@/components/shell/topbar";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { LiveMarket } from "@/components/market/live-market";
import { SectionHeader } from "@/components/common/section-header";
import { LiveDot } from "@/components/common/live-dot";
import { fetchBothSides, normalizeAds } from "@/lib/binance";
import { buildMarket } from "@/lib/analytics";
import { ASSETS, FIATS } from "@/lib/constants";
import { Empty } from "@/components/common/empty";
import { CloudOff } from "lucide-react";

export const revalidate = 20;

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(sp: Record<string, string | string[] | undefined>): FilterState {
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

export default async function HomePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);

  let snapshotOrNull = null;
  try {
    const { buy, sell } = await fetchBothSides({
      asset: filters.asset,
      fiat: filters.fiat,
      payTypes: filters.payType ? [filters.payType] : [],
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

  const fiat = FIATS.find((f) => f.code === filters.fiat);
  const subtitle = `${filters.asset} / ${filters.fiat}${fiat ? ` · ${fiat.name}` : ""}`;

  return (
    <>
      <Topbar title="Live markets" subtitle={subtitle}>
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <div className="mx-auto w-full max-w-7xl px-4 sm:px-6 py-6 sm:py-8 space-y-6">
        <SectionHeader
          kicker="Market overview"
          title={`${filters.asset} on Binance P2P · ${fiat?.flag ?? ""} ${filters.fiat}`}
          description="Top-of-book prices, round-trip spread, live depth and the advertisements you can actually trade against — refreshed every 20 seconds."
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
