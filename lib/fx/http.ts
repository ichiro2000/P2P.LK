import { SLT_OFFSET_SEC } from "@/lib/constants";
import { isPlausible, type FxCurrency } from "./currencies";
import type { FxRateType, ParsedRate } from "./types";

/**
 * Shared helpers for the FX parsers: a polite fetch, a tiny regex HTML table
 * reader (Workers have no DOM), strict number parsing, and SLT dates.
 */

/** Generic, honest UA. Some bank WAFs reject UAs that don't start with
 *  "Mozilla/5.0", so we use the conventional "(compatible; …)" form. */
export const FX_USER_AGENT = "Mozilla/5.0 (compatible; P2P.LK rates collector)";

export class FxParseError extends Error {
  constructor(source: string, message: string) {
    super(`[${source}] ${message}`);
    this.name = "FxParseError";
  }
}

export async function fetchText(
  url: string,
  signal: AbortSignal,
  init?: { method?: "GET" | "POST"; body?: URLSearchParams; accept?: string },
): Promise<string> {
  const res = await fetch(url, {
    method: init?.method ?? "GET",
    body: init?.body,
    signal,
    redirect: "follow",
    headers: {
      "User-Agent": FX_USER_AGENT,
      Accept: init?.accept ?? "text/html,application/xhtml+xml,application/json;q=0.9,*/*;q=0.8",
      "Accept-Language": "en",
      ...(init?.body ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status} from ${new URL(url).host}`);
  const text = await res.text();
  if (text.length > 3_000_000) throw new Error("response too large");
  return text;
}

export async function fetchJson<T>(url: string, signal: AbortSignal): Promise<T> {
  const text = await fetchText(url, signal, { accept: "application/json" });
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`invalid JSON from ${new URL(url).host}`);
  }
}

/* ── HTML ──────────────────────────────────────────────────────────────── */

const ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "-",
  mdash: "-",
};

export function decodeEntities(s: string): string {
  return s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === "#") {
      const code = e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : m;
    }
    return ENTITIES[e.toLowerCase()] ?? m;
  });
}

/** Visible text of an HTML fragment, whitespace collapsed. */
export function textOf(fragment: string): string {
  return decodeEntities(fragment.replace(/<[^>]*>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
}

export type HtmlTable = { text: string; rows: string[][] };

/**
 * Every `<table>` in the document as rows of cell texts. HTML comments are
 * removed first (banks leave old commented-out cells in their markup).
 * Nested tables aren't supported — none of our sources use them.
 */
export function htmlTables(html: string): HtmlTable[] {
  const clean = html.replace(/<!--[\s\S]*?-->/g, "");
  const out: HtmlTable[] = [];
  for (const t of clean.match(/<table\b[\s\S]*?<\/table>/gi) ?? []) {
    const rows: string[][] = [];
    for (const r of t.match(/<tr\b[\s\S]*?<\/tr>/gi) ?? []) {
      const cells = [...r.matchAll(/<t([dh])\b[^>]*>([\s\S]*?)<\/t\1>/gi)].map((m) => textOf(m[2]));
      if (cells.length) rows.push(cells);
    }
    out.push({ text: textOf(t), rows });
  }
  return out;
}

/** First table whose text contains every needle (case-insensitive). */
export function findTable(html: string, needles: string[]): HtmlTable | null {
  const lower = needles.map((n) => n.toLowerCase());
  return htmlTables(html).find((t) => lower.every((n) => t.text.toLowerCase().includes(n))) ?? null;
}

/** "1,234.50" → 1234.5. Dashes, blanks and zero → null (banks use 0.0000
 *  for "not quoted"). Anything else that isn't a plain number → null. */
export function num(cell: string | undefined): number | null {
  if (cell == null) return null;
  const s = cell.replace(/,/g, "").trim();
  if (!/^\d+(\.\d+)?$/.test(s)) return null;
  const v = Number(s);
  return v > 0 ? v : null;
}

/* ── Dates (Sri Lanka time) ───────────────────────────────────────────── */

/** YYYY-MM-DD of `d` in Sri Lanka. */
export function sltDate(d: Date): string {
  return new Date(d.getTime() + SLT_OFFSET_SEC * 1000).toISOString().slice(0, 10);
}

export function addDays(day: string, n: number): string {
  const t = Date.parse(`${day}T00:00:00Z`) + n * 86_400_000;
  return new Date(t).toISOString().slice(0, 10);
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/**
 * Pull a date out of free text: "2026-11-19", "19.11.2026", "19/11/2026",
 * "19 Nov 2026", "19th November 2026", "Thursday, November 19 2026".
 * Returns null when nothing parses or the date is far from `now` (a stale
 * page date is still accepted up to 10 days back; future dates are not).
 */
export function findDate(text: string, now: Date): string | null {
  let y: number | undefined, m: number | undefined, d: number | undefined;
  let r = text.match(/\b(20\d\d)-(\d\d)-(\d\d)\b/);
  if (r) [y, m, d] = [+r[1], +r[2], +r[3]];
  if (!y && (r = text.match(/\b(\d{1,2})[./](\d{1,2})[./](20\d\d)\b/))) [d, m, y] = [+r[1], +r[2], +r[3]];
  if (!y && (r = text.match(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(20\d\d)\b/))) {
    const mi = MONTHS.indexOf(r[2].slice(0, 3).toLowerCase());
    if (mi >= 0) [d, m, y] = [+r[1], mi + 1, +r[3]];
  }
  if (!y && (r = text.match(/\b([A-Za-z]{3,9})\s+(\d{1,2}),?\s+(20\d\d)\b/))) {
    const mi = MONTHS.indexOf(r[1].slice(0, 3).toLowerCase());
    if (mi >= 0) [d, m, y] = [+r[2], mi + 1, +r[3]];
  }
  if (!y || !m || !d || m > 12 || d > 31) return null;
  const iso = `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
  const today = sltDate(now);
  if (iso > addDays(today, 1) || iso < addDays(today, -10)) return null;
  return iso > today ? today : iso;
}

/* ── Building rows ────────────────────────────────────────────────────── */

/**
 * Collects parsed values with sanity checks. Implausible values are dropped
 * (and counted); a buy above its sell, or a spread over 20 %, drops the pair.
 * `finish()` throws if USD didn't come through — every source we use quotes
 * USD, so its absence means the layout changed.
 */
export class RateBag {
  private rows = new Map<string, ParsedRate>();
  rejected = 0;
  constructor(
    private source: string,
    private asOf: string,
  ) {}

  add(currency: FxCurrency | null, rateType: FxRateType, value: number | null, asOf = this.asOf) {
    if (!currency || value == null) return;
    if (!isPlausible(currency, value)) {
      this.rejected++;
      return;
    }
    this.rows.set(`${currency}:${rateType}:${asOf}`, { currency, rateType, value, asOf });
  }

  /** Add a buy/sell pair after checking they're consistent. */
  pair(currency: FxCurrency | null, kind: "tt" | "cash", buy: number | null, sell: number | null, asOf = this.asOf) {
    if (!currency) return;
    if (buy != null && sell != null && (buy > sell * 1.001 || (sell - buy) / sell > 0.2)) {
      this.rejected++;
      return;
    }
    this.add(currency, kind === "tt" ? "tt_buy" : "cash_buy", buy, asOf);
    this.add(currency, kind === "tt" ? "tt_sell" : "cash_sell", sell, asOf);
  }

  finish(): ParsedRate[] {
    const rows = [...this.rows.values()];
    if (!rows.some((r) => r.currency === "USD")) {
      throw new FxParseError(this.source, `no USD rate parsed (${rows.length} rows, ${this.rejected} rejected)`);
    }
    return rows;
  }
}
