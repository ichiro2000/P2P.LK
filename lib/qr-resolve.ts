/**
 * Server-only helpers for turning a raw QR payload into a real Binance
 * advertiserNo. The QR often encodes a short-link that redirects to the real
 * profile, e.g.:
 *
 *   QR content : https://www.binance.com/qr/dplk97c5100d65da48f3ae0afbaa77b59398
 *   Redirects  : https://c2c.binance.com/en/advertiserDetail
 *                  ?advertiserNo=s53bce2057f9933d5b7ba27cbc054caf2
 *
 * The sync `parseBinanceProfile` in `@/lib/qr` can't follow redirects, so this
 * module wraps it with an HTTP round-trip for the short-link case.
 */

import { parseBinanceProfile, type BinanceProfileRef } from "@/lib/qr";

const BINANCE_HOST_SUFFIXES = [
  "binance.com",
  "binance.me",
  "bnc.lt",
] as const;

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

function isBinanceHost(host: string): boolean {
  const h = host.toLowerCase();
  return BINANCE_HOST_SUFFIXES.some((suf) => h === suf || h.endsWith(`.${suf}`));
}

/**
 * A "shortlink-ish" userId is one where the sync parser didn't find a real
 * `advertiserNo` — the fallback either wraps the URL hostname/path or an
 * opaque code, but is not a real Binance identifier (which always looks like
 * `s<32 hex chars>`).
 *
 * Real advertiserNos look like `s53bce2057f9933d5b7ba27cbc054caf2`. We use a
 * loose regex that still accepts slightly shorter legacy IDs.
 */
function looksLikeAdvertiserNo(v: string): boolean {
  return /^[sS]?[A-Za-z0-9]{16,}$/.test(v) && !v.includes("/") && !v.includes("?");
}

/**
 * Follow redirects on a Binance-domain URL to land on the real profile page,
 * then return the final URL. Returns `null` when the URL is off-domain, the
 * fetch fails, or the host we end up on is no longer Binance.
 */
export async function resolveBinanceShortLink(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<string | null> {
  const parsed = safeParseUrl(url);
  if (!parsed || !isBinanceHost(parsed.hostname)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 5000);
  try {
    // GET + redirect: "follow" is the default. We use GET rather than HEAD
    // because Binance's short-link endpoint returns 405 on HEAD. The body is
    // read-then-discarded; response.url holds the post-redirect location.
    const res = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: ctrl.signal,
      headers: {
        "User-Agent": BROWSER_UA,
        Accept: "text/html,application/xhtml+xml",
      },
      // Don't cache short-link resolutions — if Binance ever rotates them
      // the QR would stop matching against stored reports.
      cache: "no-store",
    });
    const finalUrl = res.url;
    const finalParsed = safeParseUrl(finalUrl);
    if (!finalParsed || !isBinanceHost(finalParsed.hostname)) return null;
    return finalUrl;
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Async superset of `parseBinanceProfile`: when the sync parser can't get a
 * real advertiserNo (e.g. the QR is a short-link to `binance.com/qr/XXX`),
 * we fetch the URL, follow redirects to the `advertiserDetail` page, and
 * re-parse the final URL.
 *
 * Returns `null` only when neither the sync pass nor the redirect lookup
 * yields a Binance identifier.
 */
export async function resolveBinanceProfile(
  raw: string,
): Promise<BinanceProfileRef | null> {
  const trimmed = raw.trim();

  const sync = parseBinanceProfile(trimmed);
  if (sync && looksLikeAdvertiserNo(sync.userId)) {
    return sync;
  }

  // Binance QR payloads sometimes omit the scheme — `www.binance.com/qr/XXX`
  // rather than `https://www.binance.com/qr/XXX`. Promote it to a full URL
  // so `fetch` will accept it and follow the redirect.
  const fetchable = looksLikeSchemelessUrl(trimmed)
    ? `https://${trimmed}`
    : trimmed;

  const asUrl = safeParseUrl(fetchable);
  if (!asUrl) return sync;

  const finalUrl = await resolveBinanceShortLink(fetchable);
  if (!finalUrl) return sync;

  const resolved = parseBinanceProfile(finalUrl);
  // If the follow-through found a real advertiserNo, that always beats the
  // opaque-URL fallback. Otherwise return whatever the sync pass gave us.
  if (resolved && looksLikeAdvertiserNo(resolved.userId)) return resolved;
  return sync;
}

function looksLikeSchemelessUrl(s: string): boolean {
  if (/^https?:\/\//i.test(s)) return false;
  // "host/path" — any Binance-ish host before the first slash.
  const m = /^([a-z0-9.-]+)\//i.exec(s);
  if (!m) return false;
  return isBinanceHost(m[1]);
}

function safeParseUrl(s: string): URL | null {
  try {
    return new URL(s);
  } catch {
    return null;
  }
}

/**
 * Look up an advertiser via Binance's public `adv/search` endpoint — the same
 * one that backs our live markets ingest. We scan several common fiat/asset
 * combos for any ad listed by this advertiser; the first hit gives us the
 * nickname and current stats from the `advertiser` object on the ad.
 *
 * This is best-effort: advertisers with no active ads anywhere (typical for
 * buy-side takers like the one in the user's screenshot, who only opens
 * orders instead of publishing) won't be found. Returns `null` in that case
 * so the form falls back to manual display-name entry.
 */
export type BinanceAdvertiserPublic = {
  nickName: string | null;
  userIdentity: string | null;
  monthOrderCount: number | null;
  monthFinishRate: number | null;
  userGrade: number | null;
  vipLevel: number | null;
};

/** Fiat markets scanned when probing for an advertiser's active ads. USDT is
 *  the asset — it's the most common P2P asset and hitting the rest doubles
 *  the request count without materially improving coverage. Order is most-
 *  liquid first so we exit fast when we get a hit on the first try. */
const PROBE_FIATS = ["USD", "AED", "EUR", "INR", "LKR", "NGN", "RUB"] as const;

export async function fetchBinanceAdvertiserPublic(
  advertiserNo: string,
  opts?: { timeoutMs?: number; fiats?: readonly string[] },
): Promise<BinanceAdvertiserPublic | null> {
  if (!/^[sS]?[A-Za-z0-9]{10,}$/.test(advertiserNo)) return null;
  const timeoutMs = opts?.timeoutMs ?? 4000;
  const fiats = opts?.fiats ?? PROBE_FIATS;

  for (const fiat of fiats) {
    for (const tradeType of ["BUY", "SELL"] as const) {
      const hit = await probeAdvSearch(advertiserNo, fiat, tradeType, timeoutMs);
      if (hit) return hit;
    }
  }
  return null;
}

async function probeAdvSearch(
  advertiserNo: string,
  fiat: string,
  tradeType: "BUY" | "SELL",
  timeoutMs: number,
): Promise<BinanceAdvertiserPublic | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      "https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search",
      {
        method: "POST",
        signal: ctrl.signal,
        cache: "no-store",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": BROWSER_UA,
          clienttype: "web",
        },
        body: JSON.stringify({
          asset: "USDT",
          fiat,
          tradeType,
          page: 1,
          rows: 20,
          payTypes: [],
          publisherType: null,
          merchantCheck: false,
          transAmount: "",
          countries: [],
          proMerchantAds: false,
          shieldMerchantAds: false,
        }),
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: Array<{
        advertiser?: {
          userNo?: string;
          nickName?: string;
          userIdentity?: string;
          userGrade?: number;
          vipLevel?: number;
          monthOrderCount?: number | string;
          monthFinishRate?: number | string;
        };
      }>;
    };
    const rows = json.data ?? [];
    const match = rows.find((r) => r.advertiser?.userNo === advertiserNo);
    if (!match?.advertiser) return null;
    const a = match.advertiser;
    const toNum = (v: number | string | undefined) =>
      v == null || v === "" ? null : Number(v);
    return {
      nickName: a.nickName ?? null,
      userIdentity: a.userIdentity ?? null,
      monthOrderCount: toNum(a.monthOrderCount),
      monthFinishRate: toNum(a.monthFinishRate),
      userGrade: a.userGrade ?? null,
      vipLevel: a.vipLevel ?? null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
