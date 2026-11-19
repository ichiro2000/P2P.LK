import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { ArbitrageLive } from "@/components/arbitrage/arbitrage-live";
import { loadBooksPayload } from "@/lib/compare-server";
import { ASSET, FIAT } from "@/lib/constants";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "USDT/LKR P2P Arbitrage: Binance & Bybit Price Gaps",
  description:
    "Find USDT/LKR arbitrage between Binance P2P and Bybit P2P and across Sri Lankan bank-transfer methods, with a profit-per-cycle calculator after fees.",
  path: "/arbitrage",
});
export const dynamic = "force-dynamic";

export default async function ArbitragePage() {
  const initial = await loadBooksPayload();
  return (
    <>
      <Topbar title="Arbitrage" subtitle={`${ASSET}/${FIAT.code} · Binance + Bybit`} />
      <PageBody>
        <PageHeader
          title="LKR arbitrage tools"
          description="Gaps between the best buy and sell ads across exchanges and pay methods, and what one round trip would make after fees."
        />
        <ArbitrageLive initial={initial} />
        <section aria-labelledby="about-arbitrage" className="max-w-2xl space-y-2 text-sm text-pretty text-muted-foreground">
          <h2 id="about-arbitrage" className="text-sm font-medium text-foreground">
            About this data
          </h2>
          <p>
            Prices come from the Binance P2P and Bybit P2P order books for USDT/LKR with Sri Lankan bank-transfer
            payment methods, captured every minute. One cycle means spending LKR on the cheapest sell ad, moving the
            USDT to the other exchange when the legs differ, and selling it to the best buy ad. Profit is shown after
            the trading and transfer fees you enter.
          </p>
          <p>
            These are advertised prices, not quotes. Prices can move between the two legs, ad limits cap the size, and
            every P2P trade carries counterparty risk. Nothing here is financial advice.
          </p>
        </section>
      </PageBody>
    </>
  );
}
