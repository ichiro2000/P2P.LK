/**
 * Server-only helpers for turning a raw QR payload into a real Binance
 * advertiserNo. The QR often encodes a short-link that redirects to the real
 * profile, e.g.:
 *
 *   QR content : https://www.binance.com/qr/dplk97c5100d65da48f3ae0afbaa77b59398
 *   Redirects  : https://c2c.binance.com/en/advertiserDetail
 *                  ?advertiserNo=s53bce2057f9933d5b7ba27cbc054caf2
 *
 * The sync `parseBybitProfile` in `@/lib/qr` can't follow redirects, so this
 * module wraps it with an HTTP round-trip for the short-link case.
 */

import { parseBybitProfile, type BybitProfileRef } from "@/lib/qr";

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
 * then return the final URL.
 *
 * Two paths, tried in order:
 *   1. Plain `fetch` with `redirect: "follow"` — fast (~200 ms) and works
 *      for redirect endpoints Binance doesn't gate.
 *   2. Headless Chromium via `playwright-core` — handles AWS WAF's JS
 *      challenge that protects `www.binance.com/qr/*`. Slower
 *      (~2–4 s) and more memory-hungry, so we only engage it when the
 *      plain fetch came back with a WAF-shaped response.
 *
 * Returns `null` when both paths fail or the URL isn't Binance-hosted.
 */
export async function resolveBinanceShortLink(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<string | null> {
  const parsed = safeParseUrl(url);
  if (!parsed || !isBinanceHost(parsed.hostname)) return null;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts?.timeoutMs ?? 5000);
  let wafChallenged = false;
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
    // AWS WAF returns 202 with the same URL + a JS-challenge body. That's
    // the signal to escalate to the headless browser.
    if (
      res.status === 202 &&
      res.headers.get("x-amzn-waf-action") === "challenge"
    ) {
      console.log(`[qr-resolve] WAF challenge detected for ${url}`);
      wafChallenged = true;
    } else if (finalParsed && isBinanceHost(finalParsed.hostname)) {
      return finalUrl;
    }
  } catch (err) {
    console.log(
      `[qr-resolve] fetch error for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    // Fall through to the browser fallback.
  } finally {
    clearTimeout(timer);
  }

  // WAF path — dynamic import so the Playwright code never lands in a
  // bundle it shouldn't (and local dev without Chromium just skips it).
  if (wafChallenged || /\/qr\//.test(url)) {
    console.log(
      `[qr-resolve] escalating to browser (waf=${wafChallenged}) for ${url}`,
    );
    try {
      const { resolveShortLinkViaBrowser } = await import(
        "@/lib/qr-resolve-browser"
      );
      const browserUrl = await resolveShortLinkViaBrowser(url, {
        timeoutMs: 15000,
      });
      const browserParsed = browserUrl ? safeParseUrl(browserUrl) : null;
      if (browserParsed && isBinanceHost(browserParsed.hostname)) {
        return browserUrl;
      }
    } catch (err) {
      console.error(
        `[qr-resolve] browser resolver import/call failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Browser not available (local dev, image mis-built) — fall back
      // to whatever the sync parser produced.
    }
  }
  return null;
}

/**
 * Async superset of `parseBybitProfile`: when the sync parser can't get a
 * real advertiserNo (e.g. the QR is a short-link to `binance.com/qr/XXX`),
 * we fetch the URL, follow redirects to the `advertiserDetail` page, and
 * re-parse the final URL.
 *
 * Returns `null` only when neither the sync pass nor the redirect lookup
 * yields a Binance identifier.
 */
export async function resolveBinanceProfile(
  raw: string,
): Promise<BybitProfileRef | null> {
  const trimmed = raw.trim();

  const sync = parseBybitProfile(trimmed);
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

  const resolved = parseBybitProfile(finalUrl);
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
 * Live advertiser profile — populated from Binance by whichever path
 * succeeds first: the cheap `adv/search` probe (free, instant) for
 * advertisers with active ads, or a Chromium scrape of the
 * `advertiserDetail` page (expensive, ~3 s) for takers who only open
 * orders and never publish.
 *
 * Fields beyond the original set (all-time trades, join date, avg times,
 * verifications) are only populated when the browser path ran — the
 * `adv/search` response doesn't include them.
 */
export type BybitAdvertiserPublic = {
  nickName: string | null;
  userIdentity: string | null;
  monthOrderCount: number | null;
  monthFinishRate: number | null;
  userGrade: number | null;
  vipLevel: number | null;
  allTradeCount: number | null;
  avgReleaseTimeSec: number | null;
  avgPayTimeSec: number | null;
  registerTime: number | null;
  emailVerified: boolean | null;
  mobileVerified: boolean | null;
  kycVerified: boolean | null;
};

/** Fiat markets scanned when probing for an advertiser's active ads. USDT is
 *  the asset — it's the most common P2P asset and hitting the rest doubles
 *  the request count without materially improving coverage. Order is most-
 *  liquid first so we exit fast when we get a hit on the first try. */
const PROBE_FIATS = ["USD", "AED", "EUR", "INR", "LKR", "NGN", "RUB"] as const;

/**
 * Resolve an advertiser's public profile by user id.
 *
 * Stubbed for the Bybit port: the previous implementation hit Binance's
 * `profile-and-ads-list` endpoint, which obviously doesn't apply here. Bybit
 * has an equivalent (`/fiat/otc/configuration/queryUserDetail` and friends)
 * but the response shape differs significantly enough that wiring it up is a
 * separate task — see SUMMARY.md.
 *
 * Returning null degrades the suspicious-merchant detail flow gracefully:
 * the page renders with whatever stored fields we already have, and the
 * "live profile" panel shows a "not available" state rather than stale
 * Binance data. The unused-symbol noise is silenced below.
 */
export async function fetchBybitAdvertiserPublic(
  advertiserNo: string,
  opts?: {
    timeoutMs?: number;
    fiats?: readonly string[];
    skipBrowser?: boolean;
  },
): Promise<BybitAdvertiserPublic | null> {
  void advertiserNo;
  void opts;
  // Reference internal helpers so the deletion remains a one-line change
  // when the Bybit profile endpoint is wired in.
  void fetchProfileDirect;
  void probeAdvSearch;
  void PROBE_FIATS;
  return null;
}

/** One round-trip to the public profile endpoint. Returns the advertiser's
 *  nickname + full stats + verification flags, same shape as what the
 *  advertiserDetail page renders. */
async function fetchProfileDirect(
  advertiserNo: string,
  timeoutMs: number,
): Promise<BybitAdvertiserPublic | null> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(
      `https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/user/profile-and-ads-list?userNo=${encodeURIComponent(advertiserNo)}`,
      {
        method: "GET",
        signal: ctrl.signal,
        cache: "no-store",
        headers: {
          Accept: "application/json",
          "User-Agent": BROWSER_UA,
          clienttype: "web",
        },
      },
    );
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: {
        userDetailVo?: {
          userNo?: string;
          nickName?: string;
          userIdentity?: string | null;
          userGrade?: number | null;
          vipLevel?: number | null;
          orderCount?: number | string | null;
          monthOrderCount?: number | string | null;
          monthFinishRate?: number | string | null;
          emailVerified?: boolean | null;
          /** Binance uses `bindMobile` in this payload, not `mobileVerified`. */
          bindMobile?: boolean | null;
          kycVerified?: boolean | null;
          /** Always null in this endpoint — join date has to be derived
           *  from `userStatsRet.registerDays`. */
          registrationTime?: number | string | null;
          userStatsRet?: {
            registerDays?: number | null;
            avgReleaseTimeOfLatest30day?: number | null;
            avgPayTimeOfLatest30day?: number | null;
          } | null;
        } | null;
      } | null;
    };
    const u = json?.data?.userDetailVo;
    if (!u?.nickName) return null;
    const toNum = (v: number | string | null | undefined): number | null =>
      v == null || v === "" ? null : Number(v);
    const toBool = (v: boolean | null | undefined): boolean | null =>
      typeof v === "boolean" ? v : null;

    // `registrationTime` isn't set on this payload. Derive an approximate
    // join timestamp from `userStatsRet.registerDays` so the detail page
    // can show "Joined <date>" — matches the Binance UI label within ±1
    // day of the displayed date.
    const registerDays = toNum(u.userStatsRet?.registerDays);
    const registerTime =
      registerDays != null
        ? Date.now() - registerDays * 24 * 60 * 60 * 1000
        : null;

    return {
      nickName: u.nickName,
      userIdentity: u.userIdentity ?? null,
      userGrade: toNum(u.userGrade),
      vipLevel: toNum(u.vipLevel),
      allTradeCount: toNum(u.orderCount),
      monthOrderCount: toNum(u.monthOrderCount),
      monthFinishRate: toNum(u.monthFinishRate),
      avgReleaseTimeSec: toNum(u.userStatsRet?.avgReleaseTimeOfLatest30day),
      avgPayTimeSec: toNum(u.userStatsRet?.avgPayTimeOfLatest30day),
      registerTime,
      emailVerified: toBool(u.emailVerified),
      mobileVerified: toBool(u.bindMobile),
      kycVerified: toBool(u.kycVerified),
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

async function probeAdvSearch(
  advertiserNo: string,
  fiat: string,
  tradeType: "BUY" | "SELL",
  timeoutMs: number,
): Promise<BybitAdvertiserPublic | null> {
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
      // Fields not carried on the ad-search response. The detail page
      // will fall through to the browser scrape to populate these.
      allTradeCount: null,
      avgReleaseTimeSec: null,
      avgPayTimeSec: null,
      registerTime: null,
      emailVerified: null,
      mobileVerified: null,
      kycVerified: null,
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
