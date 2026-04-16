/** Lightweight formatters — Intl-based, memoized per locale/currency. */

const nfCache = new Map<string, Intl.NumberFormat>();
function nf(key: string, opts: Intl.NumberFormatOptions) {
  let f = nfCache.get(key);
  if (!f) {
    f = new Intl.NumberFormat("en-US", opts);
    nfCache.set(key, f);
  }
  return f;
}

/** 330.50 → "330.50", 0.0123 → "0.0123". Auto-picks fraction digits. */
export function formatPrice(n: number | null | undefined, maxFrac = 4): string {
  if (n == null || !Number.isFinite(n)) return "—";
  const abs = Math.abs(n);
  const frac = abs >= 100 ? 2 : abs >= 1 ? 3 : maxFrac;
  return nf(`p${frac}`, {
    minimumFractionDigits: frac,
    maximumFractionDigits: frac,
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

/** Currency with supplied symbol: "Rs 330.50". Uses decimal style + prefix
 *  because many fiats (LKR, BDT, IDR) aren't well-supported by Intl currency. */
export function formatFiat(
  n: number | null | undefined,
  symbol: string,
  frac = 2,
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
