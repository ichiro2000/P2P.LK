import { Topbar } from "@/components/shell/topbar";
import { KpiGrid, PageBody, PageHeader, PageSection } from "@/components/common/page";
import { KpiCard } from "@/components/common/kpi-card";
import { Empty } from "@/components/common/empty";
import { UsdChart } from "@/components/rates/usd-chart";
import { PremiumChart } from "@/components/rates/premium-chart";
import { BankTable } from "@/components/rates/bank-table";
import { RateCalculator } from "@/components/rates/calculator";
import { RemittanceFinder } from "@/components/rates/remittance";
import { SourcesList } from "@/components/rates/sources-list";
import { GoogleSection } from "@/components/rates/google-section";
import { buildMatrix, formatDay, formatRate, pctChange, type SourceView } from "@/components/rates/model";
import { FX_CURRENCIES, HEADLINE_CURRENCIES } from "@/lib/fx/currencies";
import { getRatesOverview } from "@/lib/fx/overview";
import { formatPct, formatSLT } from "@/lib/format";
import { Landmark } from "lucide-react";
import { KEYWORDS, pageMetadata } from "@/lib/seo";
import { JsonLd, datasetJsonLd } from "@/components/seo/json-ld";

export const metadata = pageMetadata({
  title: "Dollar Rate Today: CBSL, Bank TT & Google USD/LKR",
  description:
    "Today's dollar rate in Sri Lanka: CBSL indicative USD/LKR, bank TT buying and selling rates for 24 currencies, the Google dollar rate and the USDT P2P premium.",
  path: "/rates",
  // Live price image from ./opengraph-image.tsx.
  ogImage: false,
});
export const dynamic = "force-dynamic";

const pct = (v: number | null) => (v == null ? "—" : formatPct(v, { frac: 2, sign: true }));
const ratio = (a: number | null | undefined, b: number | null | undefined) => (a != null && b ? a / b - 1 : null);
const formatSltTime = (ts: number) => formatSLT(ts, { dateStyle: undefined, timeStyle: "short" });

export default async function RatesPage() {
  const o = await getRatesOverview();
  // Google mid-market rows have their own section; the matrix is banks + CBSL.
  const matrix = buildMatrix(o.latest.filter((r): r is typeof r & { type: Exclude<typeof r.type, "mid"> } => r.type !== "mid"));
  const sources: SourceView[] = o.sources.map(({ id, name, shortName, kind, pageUrl, lastOkTs }) => ({
    id,
    name,
    shortName,
    kind,
    pageUrl,
    lastOkTs,
  }));
  const banks = sources.filter((s) => s.kind === "bank");
  const currencyNames: Record<string, string> = Object.fromEntries(
    Object.entries(FX_CURRENCIES).map(([c, v]) => [c, v.name]),
  );

  // Currencies at least one bank quotes, USD first then headline order.
  const order = ["USD", ...HEADLINE_CURRENCIES];
  const bankCurrencies = Object.keys(FX_CURRENCIES)
    .filter((c) => banks.some((b) => matrix[b.id]?.[c]))
    .sort((a, b) => {
      const ia = order.indexOf(a);
      const ib = order.indexOf(b);
      return (ia < 0 ? 99 : ia) - (ib < 0 ? 99 : ib) || a.localeCompare(b);
    })
    .map((code) => ({ code, name: currencyNames[code] ?? code }));

  const { indicative, ttBuy, ttSell } = o.usd;
  const spark30 = o.usd.history.slice(-30).map((h) => h.indicative);

  // Best USD bank rates right now (CBSL excluded).
  let bestBuy: { v: number; name: string } | null = null;
  let bestSell: { v: number; name: string } | null = null;
  for (const b of banks) {
    const c = matrix[b.id]?.USD;
    if (c?.tt_buy && (!bestBuy || c.tt_buy.v > bestBuy.v)) bestBuy = { v: c.tt_buy.v, name: b.shortName };
    if (c?.tt_sell && (!bestSell || c.tt_sell.v < bestSell.v)) bestSell = { v: c.tt_sell.v, name: b.shortName };
  }
  const p2pBestBid = o.p2p.reduce<{ v: number; label: string } | null>(
    (m, q) => (q.bid != null && (!m || q.bid > m.v) ? { v: q.bid, label: q.label } : m),
    null,
  );
  const p2pBestAsk = o.p2p.reduce<{ v: number; label: string } | null>(
    (m, q) => (q.ask != null && (!m || q.ask < m.v) ? { v: q.ask, label: q.label } : m),
    null,
  );
  const firstP2PDay = o.premiumHistory[0]?.day ?? null;
  const hasData = o.latest.length > 0;

  return (
    <>
      {hasData && (
        <JsonLd
          data={datasetJsonLd({
            name: "Sri Lanka rupee exchange rates: CBSL, bank TT and USDT P2P",
            description:
              "Daily USD/LKR and other LKR exchange rates collected from the Central Bank of Sri Lanka and Sri Lankan banks' public rate pages (indicative, TT buying and TT selling), with the Google USD/LKR mid-market rate and the Binance and Bybit USDT/LKR P2P premium over the official dollar.",
            path: "/rates",
            variables: [
              "CBSL indicative USD/LKR",
              "CBSL average TT buying and selling rates",
              "Bank TT buying rate (LKR per unit)",
              "Bank TT selling rate (LKR per unit)",
              "Google USD/LKR mid-market rate",
              "USDT/LKR P2P premium vs CBSL and bank TT",
            ],
            keywords: KEYWORDS,
            temporalCoverage: o.usd.history[0]?.day ? `${o.usd.history[0].day}/..` : undefined,
            dateModified: indicative?.asOf,
          })}
        />
      )}
      <Topbar title="Exchange rates" subtitle="LKR vs USD and 24 currencies · CBSL + banks" />
      <PageBody>
        <PageHeader
          title="Rupee exchange rates"
          description="Collected directly from the Central Bank of Sri Lanka and each bank's own public rates page, a few times a day. Compare bank TT rates, convert amounts, and see how far the USDT P2P market sits above the official dollar."
        />

        {!hasData ? (
          <Empty
            icon={Landmark}
            title="No rates collected yet"
            description="The rates collector runs every 3 hours. In development, run /api/dev/tick?fx=1 to collect now."
          />
        ) : (
          <>
            <PageSection
              title="USD/LKR today"
              description={indicative ? `Central Bank of Sri Lanka, as of ${formatDay(indicative.asOf)}` : undefined}
            >
              <KpiGrid>
                <KpiCard
                  label="CBSL indicative"
                  value={formatRate(indicative?.value)}
                  change={pctChange(indicative?.value, indicative?.prev)}
                  changeLabel={indicative?.prevAsOf ? `vs ${formatDay(indicative.prevAsOf, true)}` : undefined}
                  spark={spark30}
                  sparkTone="neutral"
                />
                <KpiCard
                  label="CBSL avg TT buying"
                  value={formatRate(ttBuy?.value)}
                  change={pctChange(ttBuy?.value, ttBuy?.prev)}
                  changeLabel={ttBuy ? formatDay(ttBuy.asOf, true) : undefined}
                  tone="buy"
                />
                <KpiCard
                  label="CBSL avg TT selling"
                  value={formatRate(ttSell?.value)}
                  change={pctChange(ttSell?.value, ttSell?.prev)}
                  changeLabel={ttSell ? formatDay(ttSell.asOf, true) : undefined}
                  tone="sell"
                />
                <KpiCard
                  label="Best bank TT buying"
                  value={formatRate(bestBuy?.v)}
                  sub={bestBuy ? `${bestBuy.name} · best of ${banks.length} banks` : undefined}
                />
              </KpiGrid>
              <UsdChart history={o.usd.history} />
            </PageSection>

            <GoogleSection />

            {o.cards.length > 0 && (
              <PageSection title="Other currencies" description="CBSL indicative, LKR per unit. Change vs previous business day; 30-day trend.">
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 2xl:grid-cols-6">
                  {o.cards.map((c) => (
                    <KpiCard
                      key={c.currency}
                      label={`${c.currency} · ${c.name}`}
                      value={formatRate(c.value)}
                      change={pctChange(c.value, c.prev)}
                      spark={c.spark}
                      sparkTone="neutral"
                    />
                  ))}
                </div>
              </PageSection>
            )}

            <PageSection
              id="p2p-premium"
              title="P2P premium"
              description="How much more (or less) the USDT/LKR P2P market pays than the official dollar. Live from the Binance and Bybit books."
            >
              <KpiGrid>
                {o.p2p.map((q) => (
                  <KpiCard
                    key={q.exchange}
                    label={`${q.label}: sell USDT vs CBSL`}
                    value={pct(ratio(q.bid, indicative?.value))}
                    sub={
                      q.bid == null
                        ? "no live price"
                        : `buy USDT ${pct(ratio(q.ask, indicative?.value))}${q.stale && q.ts ? ` · stale, as of ${formatSltTime(q.ts)}` : ""}`
                    }
                    className={q.stale ? "ring-1 ring-[color:var(--color-warn)]" : undefined}
                  />
                ))}
                <KpiCard
                  label="Sell USDT vs bank TT"
                  value={pct(ratio(p2pBestBid?.v, bestBuy?.v))}
                  sub={
                    p2pBestBid && bestBuy
                      ? `${p2pBestBid.label} ${formatRate(p2pBestBid.v)} vs ${bestBuy.name} ${formatRate(bestBuy.v)}`
                      : undefined
                  }
                  tone={(ratio(p2pBestBid?.v, bestBuy?.v) ?? 0) > 0 ? "buy" : undefined}
                />
                <KpiCard
                  label="Buy USDT vs bank TT"
                  value={pct(ratio(p2pBestAsk?.v, bestSell?.v))}
                  sub={
                    p2pBestAsk && bestSell
                      ? `${p2pBestAsk.label} ${formatRate(p2pBestAsk.v)} vs ${bestSell.name} ${formatRate(bestSell.v)}`
                      : undefined
                  }
                />
              </KpiGrid>
              <PremiumChart rows={o.premiumHistory} firstP2PDay={firstP2PDay} />
              <p className="text-[11px] text-muted-foreground">
                Premium = P2P price ÷ reference − 1, for the side you trade (1 USDT ≈ 1 USD). &ldquo;Sell USDT&rdquo; compares the best P2P buy ad with the highest bank TT
                buying rate (what you&apos;d get for dollars); &ldquo;Buy USDT&rdquo; compares the cheapest P2P sell ad with the
                lowest bank TT selling rate. Best single ads only — not a quote for size.
              </p>
            </PageSection>

            <PageSection
              id="banks"
              title="Bank rates"
              description="Board rates from each bank's own website. TT = telegraphic transfer (remittances, account transfers); Notes = cash."
            >
              <BankTable
                matrix={matrix}
                sources={sources}
                currencies={bankCurrencies}
                initialHistory={{ currency: "USD", rows: o.usdHistory14 }}
              />
            </PageSection>

            <PageSection id="calculator" title="Converter" description="Pick a bank (or CBSL), an amount and a direction.">
              <RateCalculator matrix={matrix} sources={sources} currencyNames={currencyNames} />
            </PageSection>

            <PageSection
              id="remittance"
              title="Remittance route finder"
              description="Sending money home: bank TT versus buying USDT abroad and selling it on the LKR P2P market."
            >
              <RemittanceFinder
                matrix={matrix}
                sources={sources}
                p2p={o.p2p.map((q) => ({ exchange: q.exchange, label: q.label, bid: q.bid }))}
                currencyNames={currencyNames}
              />
            </PageSection>
          </>
        )}

        <PageSection id="sources" title="Sources" description="Where every number on this page comes from.">
          <SourcesList sources={o.sources} latest={o.latest} />
        </PageSection>
      </PageBody>
    </>
  );
}
