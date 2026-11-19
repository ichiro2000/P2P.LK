import { Info } from "lucide-react";
import { PageSection } from "@/components/common/page";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { marketActivity } from "@/lib/db/trade-activity";
import type { ExchangeId } from "@/lib/exchanges";
import { MarketActivityPanel } from "./market-activity";

const TITLE = "Merchant trade activity";
const DESCRIPTION = "Daily, weekly and monthly completed orders of tracked Binance merchants, buy vs sell.";

/** Async server section for /merchants (wrapped in <Suspense> by the page). */
export async function MarketActivitySection({ exchange }: { exchange: ExchangeId }) {
  if (exchange !== "binance") {
    return (
      <PageSection title={TITLE}>
        <Card className="flex-row items-start gap-2 px-4 py-3 text-xs text-muted-foreground">
          <Info className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          <span>
            Trade activity comes from merchants&apos; public Binance profiles. Bybit only shows those numbers to
            signed-in users, so there is no Bybit equivalent. Switch to Binance to see it.
          </span>
        </Card>
      </PageSection>
    );
  }
  const data = await marketActivity("day").catch(() => null);
  return (
    <PageSection title={TITLE} description={DESCRIPTION}>
      {data ? (
        <MarketActivityPanel initial={data} />
      ) : (
        <Card className="px-4 py-6 text-center text-sm text-muted-foreground">Trade activity is unavailable right now.</Card>
      )}
    </PageSection>
  );
}

export function MarketActivitySkeleton() {
  return (
    <PageSection title={TITLE} description={DESCRIPTION}>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4" aria-busy>
        {Array.from({ length: 4 }, (_, i) => (
          <Skeleton key={i} className="h-24 rounded-xl" />
        ))}
      </div>
      <Skeleton className="h-72 rounded-xl" />
    </PageSection>
  );
}
