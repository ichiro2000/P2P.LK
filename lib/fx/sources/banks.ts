import { currencyFromLabel, isFxCurrency, type FxCurrency } from "../currencies";
import {
  FxParseError,
  RateBag,
  fetchJson,
  fetchText,
  findDate,
  findTable,
  num,
  sltDate,
  type HtmlTable,
} from "../http";
import type { FetchCtx, FxSource } from "../types";

/**
 * Licensed commercial banks. Each parser reads the bank's own public
 * exchange-rate page (HTML table or the JSON endpoint the page itself calls),
 * in a single request, and maps columns by position after checking the header
 * still says what we expect. See lib/fx/SOURCES.md for the terms/robots review.
 */

type Cols = {
  /** Index of the cell holding the currency name/code. */
  label: number;
  cashBuy?: number;
  cashSell?: number;
  ttBuy: number;
  ttSell: number;
};

/** Shared table walker: header check, then one pair per currency row. */
function parseTable(
  id: string,
  table: HtmlTable | null,
  headerNeedles: string[],
  cols: Cols,
  asOf: string,
) {
  if (!table) throw new FxParseError(id, "rates table not found");
  const text = table.text.toLowerCase();
  for (const n of headerNeedles) {
    if (!text.includes(n.toLowerCase())) throw new FxParseError(id, `header changed (missing "${n}")`);
  }
  const bag = new RateBag(id, asOf);
  const seen = new Set<FxCurrency>();
  for (const r of table.rows) {
    const cur = currencyFromLabel(r[cols.label] ?? "");
    if (!cur || seen.has(cur)) continue;
    seen.add(cur);
    bag.pair(cur, "tt", num(r[cols.ttBuy]), num(r[cols.ttSell]));
    if (cols.cashBuy != null || cols.cashSell != null) {
      bag.pair(
        cur,
        "cash",
        cols.cashBuy != null ? num(r[cols.cashBuy]) : null,
        cols.cashSell != null ? num(r[cols.cashSell]) : null,
      );
    }
  }
  return bag.finish();
}

const today = (ctx: FetchCtx) => sltDate(ctx.now);

/* ── Commercial Bank of Ceylon ─────────────────────────────────────────── */
// Columns: Currency(colspan 2) | Currency buy/sell | Cheques buy/sell | TT buy/sell
export const combank: FxSource = {
  id: "combank",
  name: "Commercial Bank of Ceylon",
  shortName: "ComBank",
  kind: "bank",
  pageUrl: "https://www.combank.lk/rates-tariff#exchange-rates",
  host: "www.combank.lk",
  async fetch(ctx) {
    const html = await fetchText("https://www.combank.lk/rates-tariff", ctx.signal);
    const table = findTable(html, ["Telegraphic Transfers", "Rupees per unit"]);
    const asOf = findDate(table?.text ?? "", ctx.now) ?? today(ctx);
    return parseTable("combank", table, ["Cheques", "Buying Rate", "Selling Rate"], {
      label: 0, cashBuy: 1, cashSell: 2, ttBuy: 5, ttSell: 6,
    }, asOf);
  },
};

/* ── People's Bank ─────────────────────────────────────────────────────── */
// Columns: (blank) | Currency | Currency buy/sell | TC's/Drafts buy/sell | TT buy/sell
export const peoples: FxSource = {
  id: "peoples",
  name: "People's Bank",
  shortName: "People's",
  kind: "bank",
  pageUrl: "https://www.peoplesbank.lk/exchange-rates/",
  host: "www.peoplesbank.lk",
  async fetch(ctx) {
    const html = await fetchText("https://www.peoplesbank.lk/exchange-rates/", ctx.signal);
    const table = findTable(html, ["Telegraphic Transfers", "Buying Rate"]);
    return parseTable("peoples", table, ["Drafts", "Selling Rate"], {
      label: 1, cashBuy: 2, cashSell: 3, ttBuy: 6, ttSell: 7,
    }, today(ctx));
  },
};

/* ── NDB Bank ──────────────────────────────────────────────────────────── */
// Columns: Currency | Code | Currency buy/sell | DD buy/sell | TT buy/sell
export const ndb: FxSource = {
  id: "ndb",
  name: "National Development Bank",
  shortName: "NDB",
  kind: "bank",
  pageUrl: "https://www.ndbbank.com/rates/exchange-rates",
  host: "www.ndbbank.com",
  async fetch(ctx) {
    const html = await fetchText("https://www.ndbbank.com/rates/exchange-rates", ctx.signal);
    const table = findTable(html, ["Telegraphic Transfer Buying Rate"]);
    const asOf = findDate(table?.rows[0]?.join(" ") ?? "", ctx.now) ?? today(ctx);
    return parseTable("ndb", table, ["Currency Buying Rate", "Telegraphic Transfer Selling Rate"], {
      label: 1, cashBuy: 2, cashSell: 3, ttBuy: 6, ttSell: 7,
    }, asOf);
  },
};

/* ── Nations Trust Bank ────────────────────────────────────────────────── */
// Columns: Code | Notes buy/sell | DD buy/sell | TT buy/sell | Import bill
export const ntb: FxSource = {
  id: "ntb",
  name: "Nations Trust Bank",
  shortName: "NTB",
  kind: "bank",
  pageUrl: "https://www.nationstrust.com/exchange-rates",
  host: "www.nationstrust.com",
  async fetch(ctx) {
    const html = await fetchText("https://www.nationstrust.com/exchange-rates", ctx.signal);
    const table = findTable(html, ["Bank Notes", "Telegraphic Transfers"]);
    const asOf = findDate(html.match(/as at[^<]{0,60}/i)?.[0] ?? "", ctx.now) ?? today(ctx);
    return parseTable("ntb", table, ["Demand Draft", "Selling Rate"], {
      label: 0, cashBuy: 1, cashSell: 2, ttBuy: 5, ttSell: 6,
    }, asOf);
  },
};

/* ── DFCC Bank ─────────────────────────────────────────────────────────── */
// Columns: Code | DD buy | Note encashment | TT buy | DD/TT sell | Note sell
export const dfcc: FxSource = {
  id: "dfcc",
  name: "DFCC Bank",
  shortName: "DFCC",
  kind: "bank",
  pageUrl: "https://www.dfcc.lk/rates-and-tariff/exchange-rates",
  host: "www.dfcc.lk",
  async fetch(ctx) {
    const html = await fetchText("https://www.dfcc.lk/rates-and-tariff/exchange-rates", ctx.signal);
    const table = findTable(html, ["TT Buying", "DD / TT Selling"]);
    return parseTable("dfcc", table, ["Currency Note Encashment", "Currency Note Selling"], {
      label: 0, cashBuy: 2, cashSell: 5, ttBuy: 3, ttSell: 4,
    }, today(ctx));
  },
};

/* ── Amãna Bank ────────────────────────────────────────────────────────── */
// Columns: Currency(colspan 2) | Bank buying | Bank selling | Currency (notes) selling
// Amãna publishes one buying/selling pair; we file it as TT (approximate).
export const amana: FxSource = {
  id: "amana",
  name: "Amãna Bank",
  shortName: "Amãna",
  kind: "bank",
  pageUrl: "https://www.amanabank.lk/business/treasury/exchange-rates.html",
  host: "www.amanabank.lk",
  async fetch(ctx) {
    const html = await fetchText("https://www.amanabank.lk/business/treasury/exchange-rates.html", ctx.signal);
    const table = findTable(html, ["Bank Buying", "Bank Selling"]);
    if (!table) throw new FxParseError("amana", "rates table not found");
    const bag = new RateBag("amana", today(ctx));
    for (const r of table.rows) {
      const cur = currencyFromLabel(r[0] ?? "");
      if (!cur) continue;
      bag.pair(cur, "tt", num(r[1]), num(r[2]));
      bag.add(cur, "cash_sell", num(r[3]));
    }
    return bag.finish();
  },
};

/* ── Sampath Bank (JSON used by their rates page) ──────────────────────── */
type SampathRow = { CurrCode?: string; TTBUY?: string; TTSEL?: string; RateWEF?: string };
export const sampath: FxSource = {
  id: "sampath",
  name: "Sampath Bank",
  shortName: "Sampath",
  kind: "bank",
  pageUrl: "https://www.sampath.lk/rates-and-charges?activeTab=exchange-rates",
  host: "www.sampath.lk",
  async fetch(ctx) {
    const json = await fetchJson<{ success?: boolean; data?: SampathRow[] }>(
      "https://www.sampath.lk/api/exchange-rates",
      ctx.signal,
    );
    if (!json.success || !Array.isArray(json.data)) throw new FxParseError("sampath", "unexpected payload");
    const asOf = findDate(json.data[0]?.RateWEF ?? "", ctx.now) ?? today(ctx);
    const bag = new RateBag("sampath", asOf);
    for (const r of json.data) {
      const code = r.CurrCode === "CNH" ? "CNY" : r.CurrCode;
      if (!isFxCurrency(code)) continue;
      bag.pair(code, "tt", num(r.TTBUY), num(r.TTSEL));
    }
    return bag.finish();
  },
};

/* ── Hatton National Bank (JSON used by their rates page) ──────────────── */
type HnbRow = { currencyCode?: string; buyingRate?: number; sellingRate?: number; status?: string; updated_on?: string };
export const hnb: FxSource = {
  id: "hnb",
  name: "Hatton National Bank",
  shortName: "HNB",
  kind: "bank",
  pageUrl: "https://www.hnb.lk/rates-and-tariffs",
  host: "venus.hnb.lk",
  async fetch(ctx) {
    const json = await fetchJson<{ ex?: HnbRow[] }>("https://venus.hnb.lk/api/get_rates_contents_web", ctx.signal);
    if (!Array.isArray(json.ex)) throw new FxParseError("hnb", "unexpected payload");
    // Labelled "Telegraphic Transfer Buying/Selling Rate" on hnb.lk.
    const bag = new RateBag("hnb", today(ctx));
    for (const r of json.ex) {
      if (r.status && r.status !== "CURRENT") continue;
      const code = r.currencyCode === "CNH" ? "CNY" : r.currencyCode;
      if (!isFxCurrency(code)) continue;
      const ts = r.updated_on ? Date.parse(r.updated_on) : NaN;
      const asOf = Number.isFinite(ts) ? (findDate(sltDate(new Date(ts)), ctx.now) ?? undefined) : undefined;
      const n = (v: unknown) => (typeof v === "number" && v > 0 ? v : null);
      bag.pair(code, "tt", n(r.buyingRate), n(r.sellingRate), asOf);
    }
    return bag.finish();
  },
};
