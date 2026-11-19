import { Topbar } from "@/components/shell/topbar";
import { PageBody, PageHeader } from "@/components/common/page";
import { CompareLive } from "@/components/compare/compare-live";
import { COMPARE_RANGES, loadComparePayload, parseCompareRange } from "@/lib/compare-server";
import { gateRange } from "@/lib/member-gate";
import { ASSET, FIAT } from "@/lib/constants";
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Binance vs Bybit P2P: USDT/LKR Prices Compared",
  description:
    "Binance P2P vs Bybit P2P for USDT/LKR in Sri Lanka: where USDT is cheaper to buy and better to sell right now, spread and depth over time, market share.",
  path: "/compare",
});
export const dynamic = "force-dynamic";

type SP = Promise<Record<string, string | string[] | undefined>>;

export default async function ComparePage({ searchParams }: { searchParams: SP }) {
  const sp = await searchParams;
  const { range, member } = await gateRange(parseCompareRange(sp.range), "24h");
  const initial = await loadComparePayload(range);

  return (
    <>
      <Topbar title="Compare" subtitle={`Binance vs Bybit · ${ASSET}/${FIAT.code}`} />
      <PageBody>
        <PageHeader
          title="Binance vs Bybit"
          description="Where USDT is cheaper to buy and better to sell right now, how the two spreads move over time, and who lists more of the LKR market."
        />
        <CompareLive initial={initial} ranges={COMPARE_RANGES} member={member} />
      </PageBody>
    </>
  );
}
