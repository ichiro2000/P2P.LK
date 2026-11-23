"use client";

import { useMemo } from "react";
import { RefreshCw } from "lucide-react";
import type { ExchangeId } from "@/lib/exchanges";
import type { MarketSnapshot } from "@/lib/types";
import type { ShowcaseMap } from "@/lib/market-insights";
import { usePolling } from "@/hooks/use-polling";
import { formatRelative } from "@/lib/format";
import { cn } from "@/lib/utils";
import { PageSection } from "@/components/common/page";
import { MarketKpis, type MarketHistoryPoint } from "./market-kpis";
import { DepthChart } from "./depth-chart";
import { LiquidityStrip } from "./liquidity-strip";
import { AmountLadder } from "./amount-ladder";
import { MethodBreakdown } from "./method-breakdown";
import { AdsTable } from "./ads-table";
import type { FilterState } from "./filter-bar";
import { AmountQuotePanel } from "./amount-quote";
import { AdPlacement, type OwnPlacement } from "./ad-placement";
import { BtcLkr } from "./btc-lkr";
import { BtcUsdtChart } from "./btc-usdt-chart";
import { GoogleChart } from "@/components/rates/google-chart";
import type { GooglePoint } from "@/lib/fx/google-view";
import { useIncludeAllAds, useTradeAmount } from "@/hooks/use-trade-amount";
import { quoteAmount } from "@/lib/liquidity";

export type { MarketHistoryPoint };

/**
 * Client shell for the Live Markets page: one poller (20 s) feeds every
 * panel. Everything below is derived from the 40 ads in the snapshot, so
 * no panel makes its own request.
 */
export function LiveMarket({
  initial,
  filters,
  exchange,
  history,
  showcase,
  exchangeLabel,
  payTypeLabel,
  google,
  googleDay,
  own,
}: {
  initial: MarketSnapshot;
  filters: FilterState;
  exchange: ExchangeId;
  history: MarketHistoryPoint[];
  showcase: ShowcaseMap;
  exchangeLabel: string;
  payTypeLabel: string | null;
  /** Google USD/LKR mid-market rate (server-rendered), for the placement margins. */
  google: number | null;
  /** Last 24 h of USDT mid vs Google USD/LKR (server-rendered). */
  googleDay: GooglePoint[];
  own: OwnPlacement;
}) {
  const url = useMemo(() => {
    const p = new URLSearchParams({ exchange });
    if (filters.payType) p.set("payTypes", filters.payType);
    if (filters.merchantType === "merchant") p.set("publisher", "merchant");
    return `/api/p2p/market?${p.toString()}`;
  }, [filters, exchange]);

  const { data, loading, error, lastUpdated, refetch } = usePolling<MarketSnapshot>(url, {
    initialData: initial,
    intervalMs: 20_000,
  });
  const market = data ?? initial;
  const [amount] = useTradeAmount();
  const [includeAll] = useIncludeAllAds();
  const walkOpts = { includeOffline: includeAll, includeRestricted: includeAll };
  const quotes = {
    amount,
    buy: quoteAmount(market.ads, "SELL", amount, walkOpts),
    sell: quoteAmount(market.ads, "BUY", amount, walkOpts),
  };

  return (
    <div className="space-y-6 lg:space-y-8">
      <MarketKpis market={market} history={history} quotes={quotes} merchantsOnly={filters.merchantType === "merchant"} />

      <BtcLkr market={market} history={history} />

      <BtcUsdtChart market={market} history={history} />

      <PageSection
        title="USDT/LKR vs Google USD/LKR"
        description="The USDT P2P mid against Google's mid-market dollar, and the premium between them."
      >
        <GoogleChart initial={{ range: "24h", points: googleDay }} />
      </PageSection>

      <AmountQuotePanel buy={quotes.buy} sell={quotes.sell} amount={amount} scope="the top 20 ads per side" />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <DepthChart market={market} className="lg:col-span-2" />
        <LiquidityStrip market={market} />
      </div>

      <PageSection
        title="Price ladder"
        description="Average price for four ticket sizes across the visible ads, one order per ad. Same walk as “Price for your amount”."
      >
        <AmountLadder market={market} includeAll={includeAll} />
      </PageSection>

      <PageSection
        title="By payment method"
        description="Average of the best N ads that accept each method. An ad listing several methods counts for each."
      >
        <MethodBreakdown market={market} exchange={exchange} payType={filters.payType} />
      </PageSection>

      <PageSection
        id="placement"
        className="scroll-mt-20"
        title="For merchants: ad placement"
        description="Where to price your own ad to rank in the top 1, 3 or 5, on the same live book."
      >
        <AdPlacement
          market={market}
          exchange={exchange}
          exchangeLabel={exchangeLabel}
          payTypeLabel={payTypeLabel}
          merchantsOnly={filters.merchantType === "merchant"}
          google={google}
          own={own}
        />
      </PageSection>

      <PageSection title="Live ads" description="Top 20 ads per side for the current filters.">
        <AdsTable market={market} showcase={showcase} exchange={exchange} />
      </PageSection>

      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
        <span aria-live="polite" suppressHydrationWarning>
          {error
            ? `Live feed offline: ${error.message}`
            : `Updates every 20 s · last ${lastUpdated ? formatRelative(new Date(lastUpdated)) : "just now"}`}
        </span>
        <button
          type="button"
          onClick={() => refetch()}
          className="inline-flex h-10 items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-2"
        >
          <RefreshCw className={cn("size-3.5", loading && "animate-spin")} />
          Refresh
        </button>
      </div>
    </div>
  );
}
