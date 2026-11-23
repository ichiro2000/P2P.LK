import { CloudOff } from "lucide-react";
import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { FilterBar, type FilterState } from "@/components/market/filter-bar";
import { LiveMarket, type MarketHistoryPoint } from "@/components/market/live-market";
import { LiveDot } from "@/components/common/live-dot";
import { Empty } from "@/components/common/empty";
import { MarketStar } from "@/components/workspace/star-button";
import { buildMarket } from "@/lib/analytics";
import { ASSET, FIAT } from "@/lib/constants";
import { getExchange, payTypeLabel, resolvePayTypes } from "@/lib/exchanges";
import { getActiveExchange } from "@/lib/exchange-server";
import { getBook } from "@/lib/market-data";
import { listMarketSnapshots } from "@/lib/db/queries";
import { googleSeries, latestGoogle } from "@/lib/fx/google-view";
import { GoogleStrip } from "@/components/market/google-strip";
import { marketRegime } from "@/lib/regime";
import { RegimeBadge } from "@/components/historical/regime-badge";
import { merchantStability } from "@/lib/db/insights";
import { showcaseMap, type ShowcaseMap } from "@/lib/market-insights";
import { downsampleMinMax } from "@/lib/stats";
import type { MarketSnapshot } from "@/lib/types";
import type { OwnPlacement } from "@/components/market/ad-placement";
import { getViewer, isMember } from "@/lib/auth/session";
import { linkedAdvertisers } from "@/lib/merchant-link";
import { rankOn } from "@/lib/dashboard";
import { LIVE_DEEP_N } from "@/lib/live";
import type { ExchangeId } from "@/lib/exchanges";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "USDT to LKR Today: Binance & Bybit P2P Rates | P2P.LK",
  absoluteTitle: true,
  description:
    "Live USDT to LKR rate in Sri Lanka from Binance P2P and Bybit P2P: best bank-transfer buy and sell prices, spread, depth and the Google dollar rate.",
  path: "/",
});

type SP = Promise<Record<string, string | string[] | undefined>>;

function parseFilters(sp: Record<string, string | string[] | undefined>): FilterState {
  // Asset + fiat are locked to USDT/LKR; payType narrows to one bank rail
  // or stays empty to mean "all".
  return {
    asset: ASSET,
    fiat: FIAT.code,
    payType: String(sp.payType ?? ""),
    merchantType: String(sp.merchantType ?? "merchant") === "all" ? "all" : "merchant",
  };
}

/**
 * Last 24 h of the market from D1, downsampled for sparklines (min/max kept,
 * so spikes survive). The prices come from the SAME book as the KPI values
 * above them (F13): the verified-merchant series when the page shows
 * merchants only, the all-publishers series otherwise. Merchant prices are
 * recorded from migration 0005 on; until two points exist the sparkline
 * stays empty rather than borrowing the other book. Depth is the top-20 sum
 * of the all-publishers book either way. Empty on error.
 */
async function recentHistory(
  ex: Parameters<typeof listMarketSnapshots>[0],
  variant: FilterState["merchantType"],
): Promise<MarketHistoryPoint[]> {
  try {
    const rows = await listMarketSnapshots(ex, ASSET, FIAT.code, "24h");
    const pts = rows.map((r) => {
      const bid = variant === "merchant" ? r.merchantBestBid : r.bestBid;
      const ask = variant === "merchant" ? r.merchantBestAsk : r.bestAsk;
      return {
        t: r.ts * 1000,
        bid,
        ask,
        spread: bid != null && ask != null ? ask - bid : null,
        depth: r.bidDepth != null || r.askDepth != null ? (r.bidDepth ?? 0) + (r.askDepth ?? 0) : null,
      };
    });
    const priced = pts.filter((p) => p.bid != null || p.ask != null);
    if (priced.length < 2) return [];
    return downsampleMinMax(priced, 96, (p) => p.ask);
  } catch {
    return [];
  }
}

/**
 * The signed-in member's own ads on the full book (merchants and users,
 * every rail, up to LIVE_DEEP_N per side) for the placement helper. Null
 * for visitors, members without a linked profile on this exchange, or on
 * any error: the helper works without it.
 */
async function ownPlacement(ex: ExchangeId): Promise<OwnPlacement> {
  try {
    const viewer = await getViewer();
    if (!isMember(viewer)) return null;
    const link = linkedAdvertisers(viewer).find((l) => l.exchange === ex);
    if (!link) return null;
    const book = await getBook(ex, { asset: ASSET, fiat: FIAT.code, publisherType: null }, LIVE_DEEP_N);
    const mine = [...book.sell, ...book.buy].find((a) => a.merchant.id === link.id);
    return {
      id: link.id,
      name: mine?.merchant.name ?? "Your profile",
      ask: rankOn(book.sell, link.id, "ask"),
      bid: rankOn(book.buy, link.id, "bid"),
      scanned: Math.min(book.sell.length, book.buy.length),
    };
  } catch {
    return null;
  }
}

export default async function HomePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const filters = parseFilters(sp);
  const ex = await getActiveExchange();
  const adapter = getExchange(ex);

  // Stored history is the bank-rail market only, so a different payment
  // filter gets no sparklines rather than another market's trend.
  const historyP = filters.payType ? Promise.resolve([]) : recentHistory(ex, filters.merchantType);
  const ownP = ownPlacement(ex);
  let snapshot: MarketSnapshot | null = null;
  let showcase: ShowcaseMap = {};
  try {
    const book = await getBook(ex, {
      asset: filters.asset,
      fiat: filters.fiat,
      payTypes: resolvePayTypes(adapter, filters.payType),
      publisherType: filters.merchantType === "merchant" ? "merchant" : null,
    });
    const ads = [...book.buy, ...book.sell];
    snapshot = {
      ...buildMarket(filters.asset, filters.fiat, ads),
      fetchedAt: new Date(book.ts * 1000).toISOString(),
    };
    const stats = await merchantStability(ex, filters.asset, filters.fiat, {
      merchantIds: ads.map((a) => a.merchant.id),
    }).catch(() => []);
    showcase = showcaseMap(stats);
  } catch {
    snapshot = null;
  }
  const [history, google, own, regime, googleDay] = await Promise.all([
    historyP,
    latestGoogle().catch(() => null),
    ownP,
    marketRegime(ex, ASSET, FIAT.code).catch(() => null),
    googleSeries("24h").catch(() => []),
  ]);
  const payLabel = payTypeLabel(adapter, filters.payType);

  return (
    <>
      <Topbar title="Live markets" subtitle={`${ASSET} / ${FIAT.code} · ${adapter.label} P2P`}>
        <MarketStar asset={filters.asset} fiat={filters.fiat} size="md" className="size-10 sm:size-8" />
        <LiveDot label="Live" className="hidden sm:inline-flex" />
      </Topbar>

      <PageBody>
        <PageHeader
          eyebrow={`${FIAT.flag} ${adapter.label} P2P · LKR ${payLabel ?? "bank transfers"}`}
          title="USDT / LKR live market"
          description="Best prices, spread, order-book depth and the ads you can trade against right now. Updates every 20 seconds."
          actions={<GoogleStrip google={google} mid={snapshot?.mid ?? null} />}
        />

        {regime && !filters.payType && <RegimeBadge regime={regime} />}

        <FilterBar initial={filters} payTypes={adapter.payMethods} />

        {snapshot ? (
          <LiveMarket
            initial={snapshot}
            filters={filters}
            exchange={ex}
            history={history}
            showcase={showcase}
            exchangeLabel={adapter.label}
            payTypeLabel={payLabel}
            google={google?.value ?? null}
            googleDay={googleDay}
            own={own}
          />
        ) : (
          <Empty
            icon={CloudOff}
            title={`Couldn't reach ${adapter.label} P2P`}
            description="The public P2P endpoint rejected our request or is temporarily unavailable. Try refreshing in a few seconds."
            tone="warn"
          />
        )}
      </PageBody>
    </>
  );
}
