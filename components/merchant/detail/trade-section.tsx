import { PageSection } from "@/components/common/page";
import { ensureMerchantProfile, merchantTradeTrend } from "@/lib/db/trade-activity";
import type { ExchangeId } from "@/lib/exchanges";
import { TradeInfoBybit, TradeInfoCard, TradeInfoCollecting, TradeInfoSkeleton } from "./trade-info";
import { MerchantTradeTrend } from "./trade-trend";

const TITLE = "Trade info and buy/sell trend";

/**
 * Async server section (wrapped in <Suspense> by the page, so the rest of the
 * page never waits on it). A Binance merchant we never collected is fetched
 * once on demand with a 1.8 s timeout; otherwise it shows a "collecting" note.
 */
export async function MerchantTradeSection({
  exchange,
  id,
  adOrders30d,
  adCompletion,
}: {
  exchange: ExchangeId;
  id: string;
  adOrders30d: number | null;
  adCompletion: number | null;
}) {
  if (exchange !== "binance") {
    return (
      <PageSection title="Trade info">
        <TradeInfoBybit orders30d={adOrders30d} completionRate={adCompletion} />
      </PageSection>
    );
  }
  const [profile, trend] = await Promise.all([
    ensureMerchantProfile(exchange, id).catch(() => null),
    merchantTradeTrend(exchange, id).catch(() => null),
  ]);
  return (
    <PageSection
      title={TITLE}
      description="From the merchant's public Binance profile. Binance counts every fiat market they trade, not LKR only."
    >
      <div className="space-y-4">
        {profile?.okAt != null ? <TradeInfoCard profile={profile} /> : <TradeInfoCollecting error={profile?.error} />}
        {trend && (
          <MerchantTradeTrend
            trend={trend.trend}
            buy30d={profile?.buy30d ?? null}
            sell30d={profile?.sell30d ?? null}
            firstDay={trend.firstDay}
          />
        )}
      </div>
    </PageSection>
  );
}

export function MerchantTradeSectionSkeleton() {
  return (
    <PageSection title={TITLE}>
      <TradeInfoSkeleton />
    </PageSection>
  );
}
