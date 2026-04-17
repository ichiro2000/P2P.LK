/**
 * Parse Binance P2P profile identifiers out of a QR-decoded string.
 *
 * Binance's "Share Profile" QR (Share Image on p2p.binance.com / the mobile
 * app) doesn't use one canonical URL shape — depending on app version and
 * locale, a Binance merchant share QR can encode any of:
 *
 *   https://p2p.binance.com/en/advertiserDetail?advertiserNo=s0123abcd...
 *   https://www.binance.com/en/p2p/advertiserDetail?advertiserNo=s0123abcd...
 *   https://app.binance.com/en/download?_dp=...&advertiserNo=s0123abcd...
 *   https://app.binance.com/uni/cpay/.../share?merchantNo=s0123abcd...
 *   https://app.binance.com/en/p2p/share?userNo=s0123abcd...
 *   bnc://app.binance.com/payment/secretpay?advertiserNo=s0123abcd...
 *   https://s.binance.com/XXXXXX                     (short-link)
 *
 * We try the specific identifier-param path first (yields the clean
 * advertiserNo). When none of the known keys match, we fall back to using
 * the QR content itself as the identifier *if* it's clearly a Binance link
 * — imperfect (short-links vs full URLs for the same merchant differ) but
 * better than rejecting a report we could otherwise dedupe against itself.
 */

export type BinanceProfileRef = {
  /** Stable identifier — either the advertiserNo/merchantNo/userNo, or a
   *  normalized Binance URL fallback when no param matched. */
  userId: string;
  /** Canonical shareable profile URL (best-effort). */
  profileUrl: string;
};

/** Query-param keys that, across Binance's share URL shapes, carry the
 *  stable merchant identifier. Ordered from most to least specific. */
const IDENTIFIER_KEYS = [
  "advertiserNo",
  "advertiserno",
  "advertiserId",
  "advertiserid",
  "merchantNo",
  "merchantno",
  "merchantId",
  "merchantid",
  "userNo",
  "userno",
  "userId",
  "userid",
] as const;

const BINANCE_HOST_SUFFIXES = [
  "binance.com",
  "binance.me",
  "bnc.lt",
] as const;

/** Extract a stable identifier from arbitrary decoded QR content. */
export function parseBinanceProfile(raw: string): BinanceProfileRef | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;

  // 1. URL-shaped content — walk the query string for a known identifier.
  const parsed = safeParseUrl(trimmed);
  if (parsed) {
    for (const key of IDENTIFIER_KEYS) {
      const v = parsed.searchParams.get(key);
      if (v && v.trim()) return clean(v.trim());
    }

    // 2. Short-link paths on Binance domains (`https://s.binance.com/AbC123`).
    if (isBinanceHost(parsed.hostname)) {
      const segments = parsed.pathname
        .split("/")
        .map((s) => s.trim())
        .filter(Boolean);
      // For short-links the path is a single opaque code; use it as the id.
      if (segments.length === 1 && /^[A-Za-z0-9_-]{4,}$/.test(segments[0])) {
        return {
          userId: `${parsed.hostname.toLowerCase()}/${segments[0]}`,
          profileUrl: trimmed,
        };
      }
      // 3. Any other Binance URL — keep the decoded string as the stable
      //    identifier so two uploads of the same QR match.
      return {
        userId: normalizedUrlKey(parsed),
        profileUrl: trimmed,
      };
    }
  }

  // 4. Non-URL payload (app-scheme deeplink, raw string). Regex sweep for
  //    any known identifier key anywhere in the content.
  for (const key of IDENTIFIER_KEYS) {
    const m = new RegExp(`${key}=([A-Za-z0-9_-]+)`, "i").exec(trimmed);
    if (m) return clean(m[1]);
  }

  // 5. Bare advertiser-number-looking string.
  if (/^[Ss]?[A-Za-z0-9]{8,}$/.test(trimmed)) return clean(trimmed);

  return null;
}

function safeParseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

function isBinanceHost(host: string): boolean {
  const h = host.toLowerCase();
  return BINANCE_HOST_SUFFIXES.some((suf) => h === suf || h.endsWith(`.${suf}`));
}

function normalizedUrlKey(url: URL): string {
  // Drop hash and locale paths that vary without changing identity.
  const host = url.hostname.toLowerCase();
  const path = url.pathname.replace(/^\/(en|zh|ar|ru|ja|ko|es|fr)(\/|$)/, "/");
  // Canonicalise query params alphabetically so order doesn't break dedupe.
  const params = [...url.searchParams.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");
  return params ? `${host}${path}?${params}` : `${host}${path}`;
}

function clean(userId: string): BinanceProfileRef {
  const c = userId.trim();
  return {
    userId: c,
    profileUrl: `https://p2p.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(c)}`,
  };
}
