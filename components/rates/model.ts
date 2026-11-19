/**
 * Plain data shapes shared by the /rates server page and its client islands.
 * No server imports here, so client components can use it freely.
 */

export type RateType = "indicative" | "tt_buy" | "tt_sell" | "cash_buy" | "cash_sell";

/** One value: v = LKR per unit, p = previous published value, d = as-of day. */
export type Cell = { v: number; p: number | null; d: string };

/** source → currency → rate type → cell. Compact so it can ship to the client. */
export type RateMatrix = Record<string, Record<string, Partial<Record<RateType, Cell>>>>;

export type SourceView = {
  id: string;
  name: string;
  shortName: string;
  kind: "central-bank" | "bank";
  pageUrl: string;
  /** Last successful collector run (unix s). */
  lastOkTs: number | null;
};

export type CurrencyOption = { code: string; name: string };

export function buildMatrix(rows: { source: string; currency: string; type: RateType; value: number; prev: number | null; asOf: string }[]): RateMatrix {
  const m: RateMatrix = {};
  for (const r of rows) {
    ((m[r.source] ??= {})[r.currency] ??= {})[r.type] = { v: r.value, p: r.prev, d: r.asOf };
  }
  return m;
}

/** "2026-11-19" → epoch ms at Sri Lanka midnight (chart x values). */
export function dayToMs(day: string): number {
  return Date.parse(`${day}T00:00:00+05:30`);
}

const dayFmt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const dayFmtShort = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-11-19" → "19 Nov 2026" (or "19 Nov" with short). */
export function formatDay(day: string | null | undefined, short = false): string {
  if (!day) return "—";
  const t = Date.parse(`${day}T00:00:00Z`);
  if (!Number.isFinite(t)) return day;
  return (short ? dayFmtShort : dayFmt).format(t);
}

/** Fraction digits that suit a rate's size (JPY 2.0511, USD 328.75). */
export function rateFrac(v: number): number {
  return v >= 100 ? 2 : v >= 10 ? 3 : 4;
}

export function formatRate(v: number | null | undefined): string {
  if (v == null || !Number.isFinite(v)) return "—";
  const f = rateFrac(v);
  return v.toLocaleString("en-US", { minimumFractionDigits: f, maximumFractionDigits: f });
}

export function formatAmount(v: number | null | undefined, frac = 2): string {
  if (v == null || !Number.isFinite(v)) return "—";
  return v.toLocaleString("en-US", { minimumFractionDigits: frac, maximumFractionDigits: frac });
}

export function pctChange(v: number | null | undefined, prev: number | null | undefined): number | null {
  if (v == null || prev == null || !prev) return null;
  return (v - prev) / prev;
}

const msDayFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "Asia/Colombo" });

/** Chart x (epoch ms) → "Thu, 19 Nov 2026" in Sri Lanka time. */
export function formatMsDay(ms: unknown): string {
  const t = Number(ms);
  return Number.isFinite(t) && t > 0 ? msDayFmt.format(t) : "";
}
