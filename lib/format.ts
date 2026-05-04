/** Lightweight formatters — Intl-based, memoized per locale/currency. */

import { SLT_TZ } from "@/lib/constants";

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", opts);
    nfCache.set(key, f);
  }
  return f;
}

/**
 * Price formatter — locked to 4 fractional digits across the app.
 *
 * USDT/USD via Wise quotes the spread on the third decimal (e.g. $1.012 vs
 * $1.015), so trimming to 2 digits hides where merchants actually compete.
 * 4 digits keeps the leaderboards distinguishable and matches the precision
 * Bybit publishes on its own list page.
 *
 * `maxFrac` is kept on the signature for backwards compatibility but no
 * longer narrows the result — anyone passing a smaller value used to get
 * fewer digits; they now consistently get 4.
 */
export function formatPrice(n: number | null | undefined, _maxFrac = 4): string {
  void _maxFrac;
  if (n == null || !Number.isFinite(n)) return "—";
  return nf("p4", {
    minimumFractionDigits: 4,
    maximumFractionDigits: 4,
  }).format(n);
}

/** Compact formatter: 12,345 → "12.3K", 1,200,000 → "1.2M" */
export function formatCompact(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return nf("compact", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

/** Plain integer with thousand separators. */
export function formatInt(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return nf("int", { maximumFractionDigits: 0 }).format(n);
}

/** Percent. 0.985 → "98.5%", 0.0123 → "1.23%". */
export function formatPct(
  n: number | null | undefined,
  opts?: { frac?: number; sign?: boolean },
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const frac = opts?.frac ?? (Math.abs(n) < 0.01 ? 2 : 2);
  const sign = opts?.sign ? "exceptZero" : "auto";
  return nf(`pct${frac}${sign}`, {
    style: "percent",
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
    signDisplay: sign as "auto" | "exceptZero",
  }).format(n);
}

/** Signed number with sign always shown (e.g. "+0.52"). */
export function formatSigned(
  n: number | null | undefined,
  frac = 2,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return nf(`s${frac}`, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
    signDisplay: "exceptZero",
  }).format(n);
}

/** Currency with supplied symbol: "$ 1.0125". Uses decimal style + prefix
 *  because many fiats (LKR, BDT, IDR) aren't well-supported by Intl currency.
 *
 *  Default fractional digits = 4 to match Bybit's published precision on the
 *  Wise USD book — the spread there lives below the cent. Callers that want
 *  coarser display (e.g. depth/volume rendering) can override.
 */
export function formatFiat(
  n: number | null | undefined,
  symbol: string,
  frac = 4,
): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${symbol} ${nf(`f${frac}`, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
  }).format(n)}`;
}

/** Humanize seconds into "12s", "3m", "1h 12m". */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return "—";
  if (sec < 60) return `${Math.round(sec)}s`;
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  if (m < 60) return s > 0 ? `${m}m ${s}s` : `${m}m`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return rm > 0 ? `${h}h ${rm}m` : `${h}h`;
}

/**
 * Format an epoch-seconds (or Date / ISO string) timestamp in Sri Lanka Time.
 *
 * Use this everywhere a timestamp is rendered on the server — plain
 * `toLocaleString()` picks up the container's tz (UTC in prod) and silently
 * shows the wrong wall-clock to users.
 *
 * Default: short date + short 24h time, e.g. "17/04/2026, 14:30". Override via
 * `opts` to customize (e.g. `{ timeStyle: "medium" }` for seconds).
 */
const dfCache = new Map<string, Intl.DateTimeFormat>();
export function formatSLT(
  input: number | string | Date | null | undefined,
  opts?: Intl.DateTimeFormatOptions,
): string {
  if (input == null) return "—";
  const d =
    typeof input === "number"
      ? new Date(input * 1000)
      : typeof input === "string"
        ? new Date(input)
        : input;
  if (!(d instanceof Date) || Number.isNaN(d.getTime())) return "—";
  const key = JSON.stringify(opts ?? {});
  let f = dfCache.get(key);
  if (!f) {
    f = new Intl.DateTimeFormat("en-GB", {
      timeZone: SLT_TZ,
      dateStyle: "short",
      timeStyle: "short",
      hour12: false,
      ...opts,
    });
    dfCache.set(key, f);
  }
  return f.format(d);
}

/** "3s ago", "2m ago", "just now". */
export function formatRelative(iso: string | Date | null | undefined): string {
  if (!iso) return "—";
  const d = typeof iso === "string" ? new Date(iso) : iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 3) return "just now";
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  return `${Math.floor(diff / 86400)}d ago`;
}
