import { sql } from "drizzle-orm";
import { schema, type Db } from "@/lib/db/client";
import { FxParseError, fetchText, sltDate } from "./http";

/**
 * Google's USD → LKR rate (the number Google Search shows), read from the
 * public Google Finance quote page every 30 minutes.
 *
 * Why this page: google.com/robots.txt disallows /search for crawlers but not
 * /finance/quote/*, and it carries the same mid-market feed. One request per
 * run, strict parsing, sanity band — a layout change fails loudly in
 * ingest_runs (job "fx_google") instead of storing junk.
 */

export const GOOGLE_SOURCE = {
  id: "google",
  name: "Google Finance (mid-market)",
  shortName: "Google",
  pageUrl: "https://www.google.com/finance/quote/USD-LKR",
} as const;

const PAIR = "USD/LKR";
const URL_ = `${GOOGLE_SOURCE.pageUrl}?hl=en`;
/** Plausible USD/LKR band; anything outside means we parsed the wrong number. */
const BAND: [number, number] = [150, 600];

export type GoogleQuote = { price: number; prevClose: number | null };

const inBand = (v: number) => Number.isFinite(v) && v >= BAND[0] && v <= BAND[1];

/**
 * Reads the page's embedded data entry that is explicitly labelled
 * "USD / LKR": `"USD / LKR",<n>,null,[price, change, pct…],null,prevClose`.
 * (The visible price spans are not used: the page also lists related
 * instruments with the same markup, and the first one is not USD/LKR.)
 * If the label appears more than once, every occurrence must agree.
 */
export function parseGoogleFinance(html: string): GoogleQuote {
  const hits = [...html.matchAll(/"USD \/ LKR",\d+,null,\[(\d+(?:\.\d+)?),[^\]]*\],null,(\d+(?:\.\d+)?)/g)];
  if (!hits.length) throw new FxParseError("google", "USD/LKR price not found on the page");
  const price = Number(hits[0][1]);
  const prevClose = Number(hits[0][2]);
  if (!inBand(price)) throw new FxParseError("google", `implausible USD/LKR ${price}`);
  for (const h of hits.slice(1)) {
    if (Math.abs(Number(h[1]) - price) / price > 0.005) {
      throw new FxParseError("google", `conflicting USD/LKR values ${price} vs ${h[1]}`);
    }
  }
  return { price, prevClose: inBand(prevClose) ? prevClose : null };
}

/** Every 30 minutes, at :03 and :33 UTC — clear of the 5-minute sweep (:x0/:x5),
 *  the takers poll (:07/:22/:37/:52) and the 3-hourly bank run (:17). */
export function googleDue(date: Date): boolean {
  return date.getUTCMinutes() % 30 === 3;
}

/** Fetch, parse and store one reading. Logs to ingest_runs; never throws. */
export async function collectGoogleRate(db: Db, now = new Date()) {
  const ts = Math.floor(now.getTime() / 1000);
  const start = Date.now();
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 15_000);
  let ok = true;
  let error: string | null = null;
  let quote: GoogleQuote | null = null;
  try {
    quote = parseGoogleFinance(await fetchText(URL_, ac.signal));
    await db.batch([
      db
        .insert(schema.fxIntraday)
        .values({ source: GOOGLE_SOURCE.id, pair: PAIR, ts, value: quote.price, prevClose: quote.prevClose })
        .onConflictDoNothing(),
      // Daily close for the long-range charts: the latest reading of the SLT day wins.
      db
        .insert(schema.fxRates)
        .values({ source: GOOGLE_SOURCE.id, currency: "USD", rateType: "mid", value: quote.price, asOf: sltDate(now), fetchedAt: ts })
        .onConflictDoUpdate({
          target: [schema.fxRates.source, schema.fxRates.currency, schema.fxRates.rateType, schema.fxRates.asOf],
          set: { value: sql`excluded.value`, fetchedAt: sql`excluded.fetched_at` },
        }),
    ]);
  } catch (err) {
    ok = false;
    error = (err as Error).message.slice(0, 300);
    console.warn(`[fx_google] ${error}`);
  } finally {
    clearTimeout(timer);
  }
  await db
    .insert(schema.ingestRuns)
    .values({ job: "fx_google", exchange: null, ts, durationMs: Date.now() - start, ok, rows: ok ? 1 : 0, error })
    .catch(() => undefined);
  return { job: "fx_google" as const, ok, rows: ok ? 1 : 0, error, quote };
}
