import { FxParseError, decodeEntities, fetchText } from "@/lib/fx/http";
import { plausibleSlPawn, plausibleSpotOz, plausibleUaeGram } from "@/lib/gold-signals";

/**
 * Gold price sources for the gold-vs-USDT signal. Strict parsers (Workers
 * have no DOM): a layout change fails loudly in ingest_runs ("gold") instead
 * of storing junk. Fact-checked 22 Nov 2026 — see lib/gold-signals.ts.
 *
 *   UAE   Dubai Gold & Jewellery Group 24K/22K board rate, AED per gram.
 *         Khaleej Times (Inertia `data-page` JSON), Gulf News as fallback.
 *         Their chart XHR API returns made-up numbers — never use it.
 *   SL    Devi Jewellers, Colombo, 24K/22K. The site says "LKR /g" but the
 *         figures are per PAWN (8 g); before 27 Jun 2026 they really were
 *         per gram, so rows outside the pawn band are dropped.
 *   Spot  PAXG/XAUT (1 token = 1 troy oz of gold) on Binance / OKX / Bybit.
 */

export type Karat = 24 | 22;
export type KaratPrice = { karat: Karat; value: number };

/* ── UAE ─────────────────────────────────────────────────────────────── */

export const UAE_SOURCES = [
  { id: "khaleejtimes", name: "Khaleej Times (DGJG rate)", url: "https://www.khaleejtimes.com/gold-forex" },
  { id: "gulfnews", name: "Gulf News (DGJG rate)", url: "https://gulfnews.com/gold-forex" },
] as const;

const n = (s: string | number | null | undefined): number | null => {
  if (s == null) return null;
  const v = typeof s === "number" ? s : Number(String(s).replace(/,/g, "").trim());
  return s === "" || !Number.isFinite(v) ? null : v;
};

/** The latest non-empty slot of the day (the evening slot is "" until set). */
const latestSlot = (...slots: (string | number | null | undefined)[]) => {
  for (const s of slots.reverse()) {
    const v = n(s);
    if (v != null) return v;
  }
  return null;
};

function uaeResult(source: string, p24: number | null, p22: number | null): KaratPrice[] {
  if (!plausibleUaeGram(p24)) throw new FxParseError(source, `implausible UAE 24K ${p24}`);
  const out: KaratPrice[] = [{ karat: 24, value: p24 }];
  // 22K is 22/24 of 24K plus a slightly bigger margin (≈ 0.926).
  if (plausibleUaeGram(p22) && p22 / p24 > 0.88 && p22 / p24 < 0.96) out.push({ karat: 22, value: p22 });
  return out;
}

/** Khaleej Times: props.goldRates.rates[] {type, morning, afternoon, evening}. */
export function parseKhaleejTimes(html: string): KaratPrice[] {
  const m = html.match(/data-page="([^"]+)"/);
  if (!m) throw new FxParseError("khaleejtimes", "data-page not found");
  let rates: { type?: string; morning?: string; afternoon?: string; evening?: string }[];
  try {
    rates = JSON.parse(decodeEntities(m[1]))?.props?.goldRates?.rates;
  } catch {
    throw new FxParseError("khaleejtimes", "data-page is not JSON");
  }
  if (!Array.isArray(rates)) throw new FxParseError("khaleejtimes", "goldRates missing");
  const row = (t: string) => {
    const r = rates.find((x) => x.type === t);
    return r ? latestSlot(r.morning, r.afternoon, r.evening) : null;
  };
  return uaeResult("khaleejtimes", row("24K"), row("22K"));
}

/** Gulf News: "goldApiData":{"carat22":{…},"carat24":{…},"SAU":{"carat24":…},…}.
 *  Only the UAE part (before the first nested country object) is read, so a
 *  missing UAE key can never fall through to Saudi or Qatari prices. */
export function parseGulfNews(html: string): KaratPrice[] {
  const key = '"goldApiData":{';
  const start = html.indexOf(key);
  if (start < 0) throw new FxParseError("gulfnews", "goldApiData not found");
  const rest = html.slice(start + key.length, start + key.length + 20_000);
  const end = rest.search(/"[A-Z]{3}":\{/);
  const uae = end < 0 ? rest.slice(0, Math.max(0, rest.indexOf("}}") + 1)) : rest.slice(0, end);
  const carat = (k: string) => {
    const m = uae.match(new RegExp(`"carat${k}":\\{([^}]*)\\}`));
    if (!m) return null;
    try {
      const o = JSON.parse(`{${m[1]}}`) as Record<string, number | string>;
      return latestSlot(o.morning, o.afternoon, o.evening);
    } catch {
      return null;
    }
  };
  return uaeResult("gulfnews", carat("24"), carat("22"));
}

const UAE_PARSERS: Record<(typeof UAE_SOURCES)[number]["id"], (html: string) => KaratPrice[]> = {
  khaleejtimes: parseKhaleejTimes,
  gulfnews: parseGulfNews,
};

/** First UAE source that parses. Throws with every source's error. */
export async function fetchUae(signal: AbortSignal): Promise<{ source: string; prices: KaratPrice[] }> {
  const errors: string[] = [];
  for (const s of UAE_SOURCES) {
    try {
      if (signal.aborted) break;
      // Own time limit per source, so a hung first source still leaves time for the fallback.
      const perSource = AbortSignal.any([signal, AbortSignal.timeout(10_000)]);
      return { source: s.id, prices: UAE_PARSERS[s.id](await fetchText(s.url, perSource)) };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  throw new Error(`UAE gold unavailable (${errors.join("; ")})`);
}

/* ── Sri Lanka (Devi Jewellers) ──────────────────────────────────────── */

export const DEVI = {
  id: "devi",
  name: "Devi Jewellers, Colombo",
  pageUrl: "https://devijewellers.lk/gold-rate/",
  /** HTML history table (newest first) — has the year, unlike the chart JSON. */
  tableUrl: (range: "month" | "3month" | "6month") =>
    `https://devijewellers.lk/wp-admin/admin-ajax.php?action=gpt_get_rates&range=${range}`,
} as const;

export type DeviDay = { day: string; p24: number; p22: number | null };

const MONTHS: Record<string, string> = {
  Jan: "01", Feb: "02", Mar: "03", Apr: "04", May: "05", Jun: "06",
  Jul: "07", Aug: "08", Sep: "09", Oct: "10", Nov: "11", Dec: "12",
};

/**
 * Rows `<td>Nov 21, 2026</td><td …> LKR 342,000.00 …</td><td …> LKR 314,700.00`.
 * Returns days oldest first; rows outside the pawn band are dropped (the
 * site published per-gram prices until late June 2026).
 */
export function parseDeviTable(html: string): DeviDay[] {
  const re = /<td>\s*([A-Z][a-z]{2}) (\d{1,2}), (\d{4})\s*<\/td>\s*<td[^>]*>\s*LKR ([\d,]+(?:\.\d+)?)[\s\S]*?<td[^>]*>\s*LKR ([\d,]+(?:\.\d+)?)/g;
  const byDay = new Map<string, DeviDay>();
  let seen = 0;
  for (const m of html.matchAll(re)) {
    seen++;
    const mm = MONTHS[m[1]];
    if (!mm) continue;
    const day = `${m[3]}-${mm}-${m[2].padStart(2, "0")}`;
    const p24 = n(m[4]);
    const p22raw = n(m[5]);
    if (!plausibleSlPawn(p24)) continue;
    const p22 = plausibleSlPawn(p22raw) && p22raw / p24 > 0.88 && p22raw / p24 < 0.96 ? p22raw : null;
    // Newest first on the page: keep the first row seen for a day.
    if (!byDay.has(day)) byDay.set(day, { day, p24, p22 });
  }
  if (seen === 0) throw new FxParseError("devi", "rate table not found");
  if (byDay.size === 0) throw new FxParseError("devi", "no plausible per-pawn prices in the table");
  return [...byDay.values()].sort((a, b) => (a.day < b.day ? -1 : 1));
}

export async function fetchDevi(signal: AbortSignal, range: "month" | "6month" = "month"): Promise<DeviDay[]> {
  return parseDeviTable(await fetchText(DEVI.tableUrl(range), signal));
}

/* ── World spot (PAXG / XAUT, USD per troy ounce) ────────────────────── */

type Row = (string | number)[];
const UA = { Accept: "application/json", "User-Agent": "Mozilla/5.0 (compatible; P2P.LK)" };

export type SpotDay = { day: string; open: number; close: number };

/** UTC day of a kline open time = the SLT day it covers from 05:30. */
const utcDay = (ms: number) => new Date(ms).toISOString().slice(0, 10);

const klines = (list: unknown, msIndex = 0): SpotDay[] =>
  (Array.isArray(list) ? (list as Row[]) : [])
    .map((r) => ({ day: utcDay(Number(r[msIndex])), open: Number(r[1]), close: Number(r[4]) }))
    .filter((p) => plausibleSpotOz(p.open) && plausibleSpotOz(p.close))
    .sort((a, b) => (a.day < b.day ? -1 : 1));

export const SPOT_DAILY_SOURCES = [
  {
    name: "Binance PAXG",
    url: "https://data-api.binance.vision/api/v3/klines?symbol=PAXGUSDT&interval=1d&limit=400",
    parse: (j: unknown) => klines(j),
  },
  {
    name: "OKX PAXG",
    url: "https://www.okx.com/api/v5/market/history-candles?instId=PAXG-USDT&bar=1Dutc&limit=100",
    parse: (j: unknown) => klines((j as { data?: unknown }).data),
  },
] as const;

export const SPOT_LIVE_SOURCES = [
  {
    name: "Binance PAXG",
    url: "https://data-api.binance.vision/api/v3/ticker/price?symbol=PAXGUSDT",
    parse: (j: unknown) => n((j as { price?: string }).price),
  },
  {
    name: "OKX PAXG",
    url: "https://www.okx.com/api/v5/market/ticker?instId=PAXG-USDT",
    parse: (j: unknown) => n((j as { data?: { last?: string }[] }).data?.[0]?.last),
  },
  {
    name: "Bybit XAUT",
    url: "https://api.bybit.com/v5/market/tickers?category=spot&symbol=XAUTUSDT",
    parse: (j: unknown) => n((j as { result?: { list?: { lastPrice?: string }[] } }).result?.list?.[0]?.lastPrice),
  },
] as const;

let liveCache: { price: number; source: string; ts: number } | null = null;
let dailyCache: { days: SpotDay[]; source: string; ts: number } | null = null;

/** Gold spot USD/oz now, cached 60 s per isolate (5 min stale fallback). */
export async function getSpotLive(now = Date.now()) {
  if (liveCache && now - liveCache.ts < 60_000) return liveCache;
  for (const s of SPOT_LIVE_SOURCES) {
    try {
      const res = await fetch(s.url, { headers: UA, signal: AbortSignal.timeout(4_000) });
      if (!res.ok) continue;
      const price = s.parse(await res.json());
      if (!plausibleSpotOz(price)) continue;
      liveCache = { price, source: s.name, ts: now };
      return liveCache;
    } catch {
      /* next source */
    }
  }
  if (liveCache && now - liveCache.ts < 5 * 60_000) return liveCache;
  return null;
}

/** Daily gold spot (UTC days, oldest first), cached 1 h per isolate. */
export async function getSpotDaily(now = Date.now()) {
  if (dailyCache && now - dailyCache.ts < 3_600_000) return dailyCache;
  for (const s of SPOT_DAILY_SOURCES) {
    try {
      const res = await fetch(s.url, { headers: UA, signal: AbortSignal.timeout(6_000) });
      if (!res.ok) continue;
      const days = s.parse(await res.json());
      if (days.length < 30) continue;
      dailyCache = { days, source: s.name, ts: now };
      return dailyCache;
    } catch {
      /* next source */
    }
  }
  return dailyCache;
}

/** Test hook. */
export function _resetGoldSpotCache() {
  liveCache = null;
  dailyCache = null;
}
