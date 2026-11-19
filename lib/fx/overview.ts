import "server-only";
import { buildMarket } from "@/lib/analytics";
import { ASSET, FIAT } from "@/lib/constants";
import { latestMarketSnapshot } from "@/lib/db/queries";
import { EXCHANGE_IDS, getExchange, type ExchangeId } from "@/lib/exchanges";
import { getBook } from "@/lib/market-data";
import { FX_CURRENCIES, HEADLINE_CURRENCIES, type FxCurrency } from "./currencies";
import { addDays, sltDate } from "./http";
import {
  bestBankTtBuyByDay,
  bestBankTtSellByDay,
  cbslIndicativeSince,
  currencyHistory,
  fxSourceHealth,
  latestRates,
  p2pDaily,
  rateSeries,
  type LatestRate,
} from "./queries";
import { FX_SOURCES } from "./sources";

/**
 * Everything the /rates page renders, assembled server-side in one place so
 * the page and `/api/rates` return the same shapes. Values are LKR per unit.
 */

export type SourceInfo = {
  id: string;
  name: string;
  shortName: string;
  kind: "central-bank" | "bank";
  pageUrl: string;
  lastOkTs: number | null;
  lastOk: boolean | null;
  error: string | null;
};

export type HistoryRow = { day: string; indicative: number | null; ttBuy: number | null; ttSell: number | null };

export type MiniCard = {
  currency: FxCurrency;
  name: string;
  value: number;
  prev: number | null;
  asOf: string;
  spark: number[];
};

export type P2PQuote = {
  exchange: ExchangeId;
  label: string;
  bid: number | null;
  ask: number | null;
  mid: number | null;
  ts: number | null;
  /** True when the price is older than 10 minutes (fallback snapshot). */
  stale: boolean;
};

/** One day. P2P bid = best Buy-ad price (what you get selling USDT);
 *  ask = cheapest Sell-ad price (what you pay buying USDT). References:
 *  CBSL indicative, the highest bank TT buying rate (compare with bid) and
 *  the lowest bank TT selling rate (compare with ask). Daily averages. */
export type PremiumPoint = {
  day: string;
  cbsl: number | null;
  ttBuy: number | null;
  ttSell: number | null;
  binanceBid: number | null;
  binanceAsk: number | null;
  bybitBid: number | null;
  bybitAsk: number | null;
};

const STALE_SEC = 600;

export type BankHistoryRow = { source: string; type: string; day: string; value: number };

export type RatesOverview = {
  today: string;
  sources: SourceInfo[];
  latest: LatestRate[];
  usd: {
    indicative: LatestRate | null;
    ttBuy: LatestRate | null;
    ttSell: LatestRate | null;
    history: HistoryRow[];
  };
  cards: MiniCard[];
  usdHistory14: BankHistoryRow[];
  p2p: P2PQuote[];
  premiumHistory: PremiumPoint[];
};

async function p2pQuote(ex: ExchangeId): Promise<P2PQuote> {
  const label = getExchange(ex).label;
  try {
    const book = await getBook(ex, { asset: ASSET, fiat: FIAT.code });
    const m = buildMarket(ASSET, FIAT.code, [...book.buy, ...book.sell]);
    const stale = Date.now() / 1000 - book.ts > STALE_SEC;
    return { exchange: ex, label, bid: m.buy.bestPrice, ask: m.sell.bestPrice, mid: m.mid, ts: book.ts, stale };
  } catch {
    // Upstream down: fall back to the last stored minute snapshot — flagged
    // stale when it's old, so the page never presents it as live.
    const s = await latestMarketSnapshot(ex, ASSET, FIAT.code).catch(() => undefined);
    const ts = s?.ts ?? null;
    const stale = ts == null || Date.now() / 1000 - ts > STALE_SEC;
    return { exchange: ex, label, bid: s?.bestBid ?? null, ask: s?.bestAsk ?? null, mid: s?.mid ?? null, ts, stale };
  }
}

/** Carry the last known value forward over days a source didn't publish
 *  (weekends, holidays). */
function carry(days: string[], series: { day: string; value: number }[]) {
  const by = new Map(series.map((p) => [p.day, p.value]));
  let last: number | null = null;
  const firstDay = series[0]?.day;
  return days.map((d) => {
    if (by.has(d)) last = by.get(d)!;
    return firstDay && d >= firstDay ? last : null;
  });
}

export async function getRatesOverview(): Promise<RatesOverview> {
  const today = sltDate(new Date());
  const since30 = addDays(today, -30);
  const since1y = addDays(today, -366);

  const [latest, health, usdInd, usdBuy, usdSell, cardRows, usdHistory14, p2p, p2pDays, bestTt, bestTtSell] = await Promise.all([
    latestRates(),
    fxSourceHealth().catch(() => []),
    rateSeries("cbsl", "USD", "indicative"),
    rateSeries("cbsl_tt", "USD", "tt_buy"),
    rateSeries("cbsl_tt", "USD", "tt_sell"),
    cbslIndicativeSince(HEADLINE_CURRENCIES, since30),
    currencyHistory("USD", 14),
    Promise.all(EXCHANGE_IDS.map(p2pQuote)),
    p2pDaily(since1y).catch(() => []),
    bestBankTtBuyByDay("USD", since1y),
    bestBankTtSellByDay("USD", since1y),
  ]);

  const healthBy = new Map(health.map((h) => [h.source, h]));
  const sources: SourceInfo[] = FX_SOURCES.map((s) => {
    const h = healthBy.get(s.id);
    return {
      id: s.id,
      name: s.name,
      shortName: s.shortName,
      kind: s.kind,
      pageUrl: s.pageUrl,
      lastOkTs: h?.lastOkTs ?? null,
      lastOk: h ? h.lastOk : null,
      error: h?.error ?? null,
    };
  });

  const find = (source: string, type: string) =>
    latest.find((r) => r.source === source && r.currency === "USD" && r.type === type) ?? null;

  // USD history: union of days across the three CBSL series.
  const days = [...new Set([...usdInd, ...usdBuy, ...usdSell].map((p) => p.day))].sort();
  const ind = new Map(usdInd.map((p) => [p.day, p.value]));
  const buy = new Map(usdBuy.map((p) => [p.day, p.value]));
  const sell = new Map(usdSell.map((p) => [p.day, p.value]));
  const history = days.map((day) => ({
    day,
    indicative: ind.get(day) ?? null,
    ttBuy: buy.get(day) ?? null,
    ttSell: sell.get(day) ?? null,
  }));

  const cards: MiniCard[] = [];
  for (const cur of HEADLINE_CURRENCIES) {
    const l = latest.find((r) => r.source === "cbsl" && r.currency === cur && r.type === "indicative");
    if (!l) continue;
    cards.push({
      currency: cur,
      name: FX_CURRENCIES[cur].name,
      value: l.value,
      prev: l.prev,
      asOf: l.asOf,
      spark: cardRows.filter((r) => r.currency === cur).map((r) => r.value),
    });
  }

  // P2P premium history: one point per day that has P2P data.
  const p2pDayList = [...new Set(p2pDays.map((p) => p.day))].sort();
  const cbslCarry = carry(p2pDayList, usdInd);
  const ttBuyCarry = carry(p2pDayList, bestTt);
  const ttSellCarry = carry(p2pDayList, bestTtSell);
  const p2pAt = (day: string, ex: ExchangeId) => p2pDays.find((p) => p.day === day && p.exchange === ex);
  const premiumHistory: PremiumPoint[] = p2pDayList.map((day, i) => ({
    day,
    cbsl: cbslCarry[i],
    ttBuy: ttBuyCarry[i],
    ttSell: ttSellCarry[i],
    binanceBid: p2pAt(day, "binance")?.bid ?? null,
    binanceAsk: p2pAt(day, "binance")?.ask ?? null,
    bybitBid: p2pAt(day, "bybit")?.bid ?? null,
    bybitAsk: p2pAt(day, "bybit")?.ask ?? null,
  }));

  return {
    today,
    sources,
    latest,
    usd: { indicative: find("cbsl", "indicative"), ttBuy: find("cbsl_tt", "tt_buy"), ttSell: find("cbsl_tt", "tt_sell"), history },
    cards,
    usdHistory14,
    p2p,
    premiumHistory,
  };
}
