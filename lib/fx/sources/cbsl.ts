import { FX_CURRENCIES, currencyFromLabel, isFxCurrency, type FxCurrency } from "../currencies";
import { FxParseError, RateBag, addDays, fetchText, num, sltDate, textOf } from "../http";
import type { FetchCtx, FxSource } from "../types";

/**
 * Central Bank of Sri Lanka — the public "Exchange Rates" search tools at
 * cbsl.gov.lk/en/rates-and-indicators/exchange-rates. Each is a plain HTML
 * form that POSTs to a results page listing one table per currency:
 *
 *   indicative  /cbsl_custom/exrates/exrates_results.php     (≈55 currencies)
 *   TT averages /cbsl_custom/exratestt/exrates_resultstt.php (9 currencies)
 *
 * One request per run each, for a date range (the last 7 days normally, or a
 * full year on the first run so the chart has history from day one).
 * robots.txt allows /cbsl_custom/ with Crawl-delay: 10 — the collector spaces
 * requests to the same host accordingly.
 */

const BASE = "https://www.cbsl.gov.lk/cbsl_custom";
const PAGE = "https://www.cbsl.gov.lk/en/rates-and-indicators/exchange-rates";

/** Form values exactly as the CBSL search form names them. */
const INDICATIVE_FORM: Partial<Record<FxCurrency, string>> = {
  USD: "US Dollar",
  EUR: "Euro",
  GBP: "Sterling Pound",
  JPY: "Japanese Yen",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  CNY: "Chinese Yuan (Renminbi)",
  SGD: "Singapore Dollar",
  HKD: "Hong Kong Dollar",
  NZD: "New Zealand Dollar",
  INR: "Indian Rupee",
  AED: "UAE  Dirham",
  SAR: "Saudi Arabian Riyal",
  QAR: "Qatar Riyal",
  KWD: "Kuwait Dinar",
  OMR: "Oman Rial",
  BHD: "Bahrain Dinar",
  JOD: "Jordan Dinar",
  MYR: "Malaysia  Ringgit",
  THB: "Thailand Baht",
  SEK: "Swedish Kroner",
  NOK: "Norwegian Kroner",
  DKK: "Danish Kroner",
  KRW: "Korean Won",
};

const TT_FORM: Partial<Record<FxCurrency, string>> = {
  USD: "United States Dollar",
  EUR: "Euro",
  GBP: "British Pound",
  JPY: "Yen",
  AUD: "Australian Dollar",
  CAD: "Canadian Dollar",
  CHF: "Swiss Franc",
  CNY: "Renminbi",
  SGD: "Singapore Dollar",
};

function rangeFor(ctx: FetchCtx) {
  const end = sltDate(ctx.now);
  // First runs backfill a year (still one request); afterwards a week, so a
  // missed day or a late revision is picked up on the next run.
  const days = ctx.storedDays < 30 ? 365 : 7;
  return { start: addDays(end, -days), end };
}

function form(ctx: FetchCtx, currencies: Partial<Record<FxCurrency, string>>) {
  const { start, end } = rangeFor(ctx);
  const body = new URLSearchParams({
    lookupPage: "lookup_daily_exchange_rates.php",
    startRange: "2006-11-11",
    rangeType: "dates",
    txtStart: start,
    txtEnd: end,
    submit_button: "Submit",
  });
  for (const [code, name] of Object.entries(currencies)) body.append("chk_cur[]", `${code}~${name}`);
  return body;
}

/** Split the results page into (heading, table) sections. */
function sections(html: string) {
  const out: { heading: string; table: string }[] = [];
  // Split on <h2 so a heading is only ever paired with a table that follows
  // it before the next heading.
  for (const chunk of html.split(/<h2\b/i).slice(1)) {
    const heading = chunk.match(/^[^>]*>([\s\S]*?)<\/h2>/i)?.[1];
    const table = chunk.match(/<table\b[\s\S]*?<\/table>/i)?.[0];
    if (heading != null && table) out.push({ heading: textOf(heading), table });
  }
  return out;
}

function rowsOf(table: string) {
  const rows: string[][] = [];
  for (const r of table.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
    rows.push([...r.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((c) => textOf(c[2])));
  }
  return rows;
}

const isDay = (s: string | undefined) => !!s && /^20\d\d-\d\d-\d\d$/.test(s);

export const cbslIndicative: FxSource = {
  id: "cbsl",
  name: "Central Bank of Sri Lanka",
  shortName: "CBSL",
  kind: "central-bank",
  pageUrl: `${PAGE}/daily-indicative-exchange-rates`,
  host: "www.cbsl.gov.lk",
  async fetch(ctx) {
    const html = await fetchText(`${BASE}/exrates/exrates_results.php`, ctx.signal, {
      method: "POST",
      body: form(ctx, INDICATIVE_FORM),
    });
    const bag = new RateBag("cbsl", sltDate(ctx.now));
    for (const { table } of sections(html)) {
      const rows = rowsOf(table);
      // Header: Date | 1 USD -> LKR | 1 LKR -> USD
      const code = rows[0]?.[1]?.match(/1\s+([A-Z]{3})\s*->\s*LKR/)?.[1];
      const cur = code === "CNH" ? null : code && isFxCurrency(code) ? code : null;
      if (!cur) continue;
      for (const r of rows.slice(1)) {
        if (isDay(r[0])) bag.add(cur, "indicative", num(r[1]), r[0]);
      }
    }
    return bag.finish();
  },
};

export const cbslTt: FxSource = {
  id: "cbsl_tt",
  name: "Central Bank of Sri Lanka (average TT rates)",
  shortName: "CBSL avg TT",
  kind: "central-bank",
  pageUrl: `${PAGE}/daily-buy-and-sell-exchange-rates`,
  host: "www.cbsl.gov.lk",
  async fetch(ctx) {
    const html = await fetchText(`${BASE}/exratestt/exrates_resultstt.php`, ctx.signal, {
      method: "POST",
      body: form(ctx, TT_FORM),
    });
    const bag = new RateBag("cbsl_tt", sltDate(ctx.now));
    for (const { heading, table } of sections(html)) {
      const cur = currencyFromLabel(heading);
      if (!cur || !TT_FORM[cur]) continue;
      const rows = rowsOf(table);
      const head = (rows[0] ?? []).join(" ").toLowerCase();
      if (!head.includes("buy") || !head.includes("sell")) {
        throw new FxParseError("cbsl_tt", `unexpected header for ${cur}: ${head}`);
      }
      for (const r of rows.slice(1)) {
        if (isDay(r[0])) bag.pair(cur, "tt", num(r[1]), num(r[2]), r[0]);
      }
    }
    return bag.finish();
  },
};

/** Exposed for the sources doc / tests. */
export const CBSL_CURRENCIES = Object.keys(INDICATIVE_FORM).filter((c) => c in FX_CURRENCIES);
