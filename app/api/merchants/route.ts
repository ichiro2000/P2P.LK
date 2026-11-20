import { NextRequest, NextResponse } from "next/server";
import { rateLimit } from "@/lib/guard";
import { buildMerchantDirectory } from "@/lib/analytics";
import { CACHE_PUBLIC_SHORT, errorResponse, parseMarketQuery } from "@/lib/api";
import { merchantDirectoryData } from "@/lib/db/merchant-directory";
import { getBook } from "@/lib/market-data";
import { deriveMerchantTier } from "@/lib/merchant-tier";
import { LIVE_DEEP_N } from "@/lib/live";

/**
 * GET /api/merchants?exchange=binance[&publisher=merchant]
 * Every merchant the 10-minute sweep has seen on this market. `isActive` =
 * seen in the latest sweep; `askVsBest` / `bidVsBest` are per-side gaps to
 * the best price among active merchants; `trustScore` is the reliability
 * score from `lib/merchant-score.ts`. The live top-20 book only adds
 * pay-method names. `book=1` also returns the full live book (every
 * publisher, every bank rail, up to LIVE_DEEP_N ads a side) for the
 * competitor compare on /merchants.
 */
export async function GET(req: NextRequest) {
  const limited = await rateLimit(req, "read");
  if (limited) return limited;
  const { exchange, query } = parseMarketQuery(req);
  const withBook = req.nextUrl.searchParams.get("book") === "1";
  try {
    const [book, data, deep] = await Promise.all([
      getBook(exchange, { ...query, payTypes: [] }).catch(() => null),
      merchantDirectoryData(exchange, query.asset, query.fiat),
      withBook
        ? getBook(exchange, { asset: query.asset, fiat: query.fiat, publisherType: null }, LIVE_DEEP_N).catch(() => null)
        : null,
    ]);
    let directory = buildMerchantDirectory({
      known: data.known,
      latestSweepTs: data.latestSweepTs,
      trackedHours7d: data.trackedHours7d,
      liveAds: book ? [...book.buy, ...book.sell] : [],
    });
    if (query.publisherType === "merchant") {
      directory = directory.filter(
        (m) => deriveMerchantTier({ isMerchant: m.isMerchant, userIdentity: m.userIdentity, vipLevel: m.vipLevel }) != null,
      );
    }
    const active = directory.filter((m) => m.isActive);
    const best = (xs: (number | null)[], lowest: boolean) => {
      const v = xs.filter((x): x is number => x != null && x > 0);
      return v.length ? (lowest ? Math.min(...v) : Math.max(...v)) : null;
    };
    return NextResponse.json(
      {
        exchange,
        asset: query.asset,
        fiat: query.fiat,
        fetchedAt: new Date((data.latestSweepTs ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
        latestSweepTs: data.latestSweepTs,
        /** Per-side references the gaps are measured against. */
        bestAsk: best(active.map((m) => m.bestSellPrice), true),
        bestBid: best(active.map((m) => m.bestBuyPrice), false),
        /** @deprecated always null; gaps are per side now. */
        marketMedian: null,
        liveCount: active.length,
        knownCount: data.known.length,
        merchants: directory,
        ...(withBook ? { book: deep ? { ads: [...deep.buy, ...deep.sell], ts: deep.ts } : null } : {}),
      },
      { headers: { "Cache-Control": CACHE_PUBLIC_SHORT } },
    );
  } catch (err) {
    return errorResponse(err);
  }
}
