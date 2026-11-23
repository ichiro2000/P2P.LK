import { PageSection } from "@/components/common/page";
import { Skeleton } from "@/components/ui/skeleton";
import { formatFiat, formatInt, formatPct, formatPrice, formatSLT } from "@/lib/format";
import { getBook } from "@/lib/market-data";
import { LIVE_DEEP_N } from "@/lib/live";
import { FIAT } from "@/lib/constants";
import { cn } from "@/lib/utils";
import type { ExchangeId } from "@/lib/exchanges";
import type { NormalizedAd } from "@/lib/types";

const TITLE = "Their live ads";
const S = FIAT.symbol;

type Row = { ad: NormalizedAd; rank: number; of: number; gap: number | null };

/** This merchant's ads on one side, with their place in that side's book
 *  (best for the taker first, so rank 1 = the top ad). */
function rowsFor(side: NormalizedAd[], id: string): Row[] {
  const best = side[0]?.price ?? null;
  return side.flatMap((ad, i) =>
    ad.merchant.id === id
      ? [{ ad, rank: i + 1, of: side.length, gap: best ? Math.abs(ad.price - best) / best : null }]
      : [],
  );
}

/**
 * Async server section (the page wraps it in <Suspense>). Reads the same
 * deep live book as the competitor section, so it costs no extra upstream
 * call while that one is fresh.
 */
export async function MerchantListingsSection({
  exchange,
  asset,
  fiat,
  id,
}: {
  exchange: ExchangeId;
  asset: string;
  fiat: string;
  id: string;
}) {
  const book = await getBook(exchange, { asset, fiat, publisherType: null }, LIVE_DEEP_N).catch(() => null);
  if (!book) {
    return (
      <PageSection id="listings" title={TITLE}>
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          The live book isn&apos;t available right now. Try again in a minute.
        </p>
      </PageSection>
    );
  }
  const sell = rowsFor(book.sell, id);
  const buy = rowsFor(book.buy, id);
  const depth = Math.max(book.sell.length, book.buy.length);
  const description = `Every ad they have on the ${asset}/${fiat} bank-transfer book right now · as of ${formatSLT(book.ts, { dateStyle: undefined, timeStyle: "short" })} SLT · we see the top ${depth} ads a side`;

  return (
    <PageSection id="listings" title={TITLE} description={description}>
      {sell.length + buy.length === 0 ? (
        <p className="rounded-xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">
          No live ads in the top {depth} on either side right now.
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          <SideCard title="Sell ads" hint="they sell USDT · you buy" tone="buy" rows={sell} asset={asset} />
          <SideCard title="Buy ads" hint="they buy USDT · you sell" tone="sell" rows={buy} asset={asset} />
        </div>
      )}
    </PageSection>
  );
}

function SideCard({
  title,
  hint,
  tone,
  rows,
  asset,
}: {
  title: string;
  hint: string;
  tone: "buy" | "sell";
  rows: Row[];
  asset: string;
}) {
  const color = tone === "buy" ? "text-[color:var(--color-buy)]" : "text-[color:var(--color-sell)]";
  return (
    <div className="rounded-xl border border-border bg-card">
      <div className="flex items-baseline justify-between gap-2 border-b border-border px-4 py-3">
        <span className="text-sm font-medium">
          <span className={color}>{title}</span> <span className="text-xs font-normal text-muted-foreground">({rows.length})</span>
        </span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </div>
      {rows.length === 0 ? (
        <p className="px-4 py-6 text-center text-xs text-muted-foreground">No live {title.toLowerCase()}.</p>
      ) : (
        <ul className="divide-y divide-border">
          {rows.map(({ ad, rank, of, gap }) => (
            <li key={ad.id} className="space-y-2 px-4 py-3">
              <div className="flex items-baseline justify-between gap-3">
                <span className={cn("font-mono text-lg font-semibold tabular-nums", color)}>
                  {formatFiat(ad.price, S, 2)}
                </span>
                <span className="text-right text-[11px] text-muted-foreground">
                  <span className="font-mono font-medium text-foreground tabular-nums">#{rank}</span> of {of}
                  {gap != null && (gap < 0.00005 ? " · best price" : ` · ${formatPct(gap, { frac: 2 })} off best`)}
                </span>
              </div>
              <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
                <div>
                  <dt className="text-[11px] text-muted-foreground">Available</dt>
                  <dd className="font-mono tabular-nums">
                    {formatPrice(ad.available, 2)} {asset}
                  </dd>
                </div>
                <div>
                  <dt className="text-[11px] text-muted-foreground">Order limit</dt>
                  <dd className="font-mono tabular-nums">
                    {S} {formatInt(ad.minOrder)} – {formatInt(ad.maxOrder)}
                  </dd>
                </div>
              </dl>
              <div className="flex flex-wrap gap-1">
                {ad.payMethods.map((m) => (
                  <span key={m.id} className="rounded-full border border-border px-2 py-0.5 text-[11px] text-muted-foreground">
                    {m.short ?? m.name}
                  </span>
                ))}
              </div>
              {ad.restrictions?.length ? (
                <p className={cn("text-[11px]", ad.restricted ? "text-[color:var(--color-warn)]" : "text-muted-foreground")}>
                  Takers need: {ad.restrictions.join(" · ")}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function MerchantListingsSkeleton() {
  return (
    <PageSection id="listings" title={TITLE}>
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <Skeleton className="h-48 w-full rounded-xl" />
        <Skeleton className="h-48 w-full rounded-xl" />
      </div>
    </PageSection>
  );
}
