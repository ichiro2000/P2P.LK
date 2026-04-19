/**
 * Headless-browser fallback for resolving Binance QR short-links.
 *
 * Binance protects `www.binance.com/qr/*` (and other share-link hostnames)
 * with an AWS WAF JS challenge — plain `fetch()` from Node gets a 202 + an
 * HTML page saying "JavaScript required". We launch a real Chromium,
 * navigate to the short-link, let the challenge solve, and read the final
 * URL (which lands on `c2c.binance.com/…advertiserNo=…`).
 *
 * The cost isn't trivial: ~2–4 s per resolve and ~250 MB peak memory. We
 * only hit this path when the sync parser + `adv/search` chain have both
 * failed, and we cache successful resolutions in-process so the same QR
 * doesn't rebooting Chromium on every upload.
 *
 * Requirements at runtime:
 *   - `chromium` binary on PATH (we set PLAYWRIGHT_CHROMIUM_EXECUTABLE in
 *     the Dockerfile to `/usr/bin/chromium`).
 *   - `playwright-core` installed.
 *
 * Set `PLAYWRIGHT_CHROMIUM_DISABLE=1` to hard-disable the resolver (used
 * in local dev when Chromium isn't installed).
 */

import { chromium, type Browser } from "playwright";

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

let browserPromise: Promise<Browser> | null = null;

function isEnabled(): boolean {
  return process.env.PLAYWRIGHT_CHROMIUM_DISABLE !== "1";
}

async function getBrowser(): Promise<Browser> {
  if (!browserPromise) {
    // `executablePath: undefined` → Playwright uses its own bundled
    // Chromium (the base image at mcr.microsoft.com/playwright ships it
    // at /ms-playwright/...). Can still be overridden in dev via env.
    const execPath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined;
    console.log(
      `[qr-resolve-browser] launching chromium (exec=${execPath ?? "<bundled>"}, PLAYWRIGHT_BROWSERS_PATH=${process.env.PLAYWRIGHT_BROWSERS_PATH ?? "<unset>"}, HOME=${process.env.HOME ?? "<unset>"}, cwd=${process.cwd()})`,
    );
    browserPromise = chromium
      .launch({
        executablePath: execPath,
        headless: true,
        args: [
          "--no-sandbox",
          "--disable-dev-shm-usage",
          "--disable-gpu",
          "--disable-setuid-sandbox",
          // Keep Chromium from phoning home and opening unnecessary
          // background services. Reduces memory and startup time.
          "--no-default-browser-check",
          "--no-first-run",
          "--disable-extensions",
          "--disable-background-networking",
          "--disable-sync",
          "--metrics-recording-only",
          "--mute-audio",
        ],
      })
      .then((b) => {
        console.log("[qr-resolve-browser] chromium launched");
        return b;
      })
      .catch((err) => {
        console.error(
          `[qr-resolve-browser] chromium launch failed: ${err instanceof Error ? err.message : String(err)}`,
        );
        // Don't cache the rejection — the next call should retry. This
        // matters on cold deploys where Chromium may briefly be missing
        // before the image is fully ready.
        browserPromise = null;
        throw err;
      });
  }
  return browserPromise;
}

// In-process LRU-ish cache — first N successful resolutions, ~10 min TTL.
// QR short-links don't rotate, so repeat uploads of the same image don't
// need to re-launch Chromium.
const CACHE_MAX = 200;
const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { url: string; at: number }>();

function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (Date.now() - hit.at > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return hit.url;
}

function cacheSet(key: string, url: string) {
  if (cache.size >= CACHE_MAX) {
    // Evict the oldest entry — Map iteration order is insertion order.
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { url, at: Date.now() });
}

// Cache for profile-scrape results, keyed on advertiserNo. Profiles are
// expensive to fetch (~3 s of Chromium time) and don't change often, so a
// 5-minute TTL covers repeat views of the same detail page comfortably.
const PROFILE_CACHE_TTL_MS = 5 * 60 * 1000;
const profileCache = new Map<
  string,
  { profile: BrowserBinanceProfile; at: number }
>();

export type BrowserBinanceProfile = {
  nickName: string | null;
  userIdentity: string | null;
  userGrade: number | null;
  vipLevel: number | null;
  /** All-time finished trades across the whole account. */
  allTradeCount: number | null;
  /** Rolling 30-day finished trade count. */
  monthOrderCount: number | null;
  /** Rolling 30-day completion rate (0–1). */
  monthFinishRate: number | null;
  /** Average release time, in seconds. */
  avgReleaseTimeSec: number | null;
  /** Average pay time, in seconds. */
  avgPayTimeSec: number | null;
  /** Unix milliseconds of account creation (from Binance's registerTime). */
  registerTime: number | null;
  emailVerified: boolean | null;
  mobileVerified: boolean | null;
  kycVerified: boolean | null;
};

/**
 * Load the Binance `advertiserDetail` page in a real browser and scrape the
 * advertiser object off the XHR responses the page makes on first paint. We
 * prefer network interception over DOM scraping because the JSON structure
 * is stable across Binance's UI rewrites, whereas the rendered HTML
 * (class names, selector hierarchy) changes every few releases.
 *
 * Returns `null` when the browser is disabled, the navigation fails, or no
 * advertiser-shaped payload showed up within the timeout. Successful
 * lookups are cached for 5 minutes in-process.
 */
export async function fetchBinanceProfileViaBrowser(
  advertiserNo: string,
  opts?: { timeoutMs?: number },
): Promise<BrowserBinanceProfile | null> {
  if (!isEnabled()) {
    console.log(
      "[qr-resolve-browser] disabled via env, skipping profile scrape",
    );
    return null;
  }
  if (!/^[sS]?[A-Za-z0-9]{10,}$/.test(advertiserNo)) return null;

  const cached = profileCache.get(advertiserNo);
  if (cached && Date.now() - cached.at < PROFILE_CACHE_TTL_MS) {
    console.log(`[qr-resolve-browser] profile cache hit for ${advertiserNo}`);
    return cached.profile;
  }

  const timeout = opts?.timeoutMs ?? 15000;
  console.log(`[qr-resolve-browser] scraping profile for ${advertiserNo}`);

  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch {
    return null;
  }

  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1280, height: 720 },
    locale: "en-US",
    timezoneId: "UTC",
    extraHTTPHeaders: { "Accept-Language": "en-US,en;q=0.9" },
  });
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "media" || t === "font") return route.abort();
    return route.continue();
  });

  const page = await context.newPage();

  // Collect candidate advertiser objects from every JSON response the page
  // makes. The richest one wins — sometimes Binance hits multiple endpoints
  // (ad list, user info) and each returns a subset of fields.
  const candidates: Record<string, unknown>[] = [];
  page.on("response", async (res) => {
    try {
      const url = res.url();
      if (!/\/bapi\/c2c\//.test(url)) return;
      const ct = res.headers()["content-type"] ?? "";
      if (!ct.includes("application/json")) return;
      const text = await res.text();
      if (!text.includes("nickName")) return;
      const json: unknown = JSON.parse(text);
      collectAdvertiserObjects(json, advertiserNo, candidates);
    } catch {
      // Ignore — many responses won't match; only the one that does matters.
    }
  });

  try {
    const target = `https://c2c.binance.com/en/advertiserDetail?advertiserNo=${encodeURIComponent(advertiserNo)}`;
    await page.goto(target, { timeout, waitUntil: "domcontentloaded" });
    // Give the client-side code time to fire its XHRs. We wait either for
    // the first captured candidate or a short idle window, whichever comes
    // first.
    const deadline = Date.now() + Math.min(timeout, 8000);
    while (Date.now() < deadline && candidates.length === 0) {
      await page.waitForTimeout(250);
    }
    if (candidates.length === 0) {
      console.warn(
        `[qr-resolve-browser] no advertiser XHR captured for ${advertiserNo}`,
      );
      return null;
    }
    const merged = mergeAdvertiserCandidates(candidates);
    const normalized = normalizeAdvertiser(merged);
    profileCache.set(advertiserNo, { profile: normalized, at: Date.now() });
    console.log(
      `[qr-resolve-browser] scraped profile for ${advertiserNo}: ${normalized.nickName ?? "<no name>"}`,
    );
    return normalized;
  } catch (err) {
    console.error(
      `[qr-resolve-browser] profile scrape failed for ${advertiserNo}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}

/**
 * Recursively walk a JSON response and collect any object shaped like a
 * Binance advertiser block (has `nickName` + an identifier that matches
 * our advertiserNo). Covers both the direct profile endpoint and the
 * ad-list endpoints that return `{ advertiser: {...} }` per row.
 */
function collectAdvertiserObjects(
  node: unknown,
  advertiserNo: string,
  out: Record<string, unknown>[],
  depth = 0,
): void {
  if (depth > 8) return;
  if (!node || typeof node !== "object") return;
  if (Array.isArray(node)) {
    for (const item of node) collectAdvertiserObjects(item, advertiserNo, out, depth + 1);
    return;
  }
  const obj = node as Record<string, unknown>;
  const identifierMatches =
    obj.userNo === advertiserNo ||
    obj.advertiserNo === advertiserNo ||
    obj.userId === advertiserNo;
  if (
    typeof obj.nickName === "string" &&
    obj.nickName &&
    (identifierMatches || !("userNo" in obj || "advertiserNo" in obj))
  ) {
    out.push(obj);
  }
  for (const value of Object.values(obj)) {
    collectAdvertiserObjects(value, advertiserNo, out, depth + 1);
  }
}

/** Merge multiple advertiser candidate objects — later values win when
 *  earlier ones are null/undefined. This lets us aggregate across XHR
 *  endpoints that each carry a subset of the full profile. */
function mergeAdvertiserCandidates(
  candidates: Record<string, unknown>[],
): Record<string, unknown> {
  const merged: Record<string, unknown> = {};
  for (const c of candidates) {
    for (const [k, v] of Object.entries(c)) {
      if (v === null || v === undefined) continue;
      if (merged[k] === undefined || merged[k] === null) merged[k] = v;
    }
  }
  return merged;
}

function normalizeAdvertiser(d: Record<string, unknown>): BrowserBinanceProfile {
  const toNum = (v: unknown): number | null => {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const toBool = (v: unknown): boolean | null =>
    typeof v === "boolean" ? v : null;
  return {
    nickName: typeof d.nickName === "string" ? d.nickName : null,
    userIdentity: typeof d.userIdentity === "string" ? d.userIdentity : null,
    userGrade: toNum(d.userGrade),
    vipLevel: toNum(d.vipLevel),
    // Binance exposes the all-time count under a couple of names; prefer
    // the most specific. `orderCount` is the lifetime total on recent
    // responses; older ones used `totalOrders`.
    allTradeCount: toNum(d.orderCount) ?? toNum(d.totalOrders),
    monthOrderCount: toNum(d.monthOrderCount),
    monthFinishRate: toNum(d.monthFinishRate),
    avgReleaseTimeSec: toNum(d.avgReleaseTimeOfLatestOnline),
    avgPayTimeSec: toNum(d.avgPayTime ?? d.avgResponseTime),
    registerTime: toNum(d.registerTime),
    emailVerified: toBool(d.emailVerified),
    mobileVerified: toBool(d.mobileVerified),
    kycVerified: toBool(d.kycVerified ?? d.certifiedKyc),
  };
}

export async function resolveShortLinkViaBrowser(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<string | null> {
  if (!isEnabled()) {
    console.log("[qr-resolve-browser] disabled via env, skipping");
    return null;
  }
  const timeout = opts?.timeoutMs ?? 15000;
  const cached = cacheGet(url);
  if (cached) {
    console.log(`[qr-resolve-browser] cache hit for ${url}`);
    return cached;
  }
  console.log(`[qr-resolve-browser] resolving ${url}`);

  let browser: Browser;
  try {
    browser = await getBrowser();
  } catch {
    return null;
  }

  const context = await browser.newContext({
    userAgent: BROWSER_UA,
    viewport: { width: 1280, height: 720 },
    // WAF checks for these headers; matching a real browser reduces
    // the chance of an extra challenge loop.
    locale: "en-US",
    timezoneId: "UTC",
    extraHTTPHeaders: {
      "Accept-Language": "en-US,en;q=0.9",
    },
  });
  // Block images/media/fonts — we only care about the final URL, and
  // skipping asset loads cuts resolve time roughly in half.
  await context.route("**/*", (route) => {
    const t = route.request().resourceType();
    if (t === "image" || t === "media" || t === "font") {
      return route.abort();
    }
    return route.continue();
  });

  const page = await context.newPage();
  try {
    // `waitUntil: "load"` fires on each navigation. The WAF challenge
    // page issues a full-page reload after solving, which counts as a
    // new navigation — using "domcontentloaded" + a post-challenge
    // networkidle gets us the final page reliably.
    await page.goto(url, { timeout, waitUntil: "domcontentloaded" });
    // Give the WAF JS a beat to run + trigger its reload.
    await page
      .waitForURL(
        (u) =>
          /advertiserDetail\?advertiserNo=/.test(u.toString()) ||
          /advertiserNo=/.test(u.toString()),
        { timeout: Math.min(timeout, 12000) },
      )
      .catch(() => {
        // Fall through — maybe the redirect landed on a page without
        // the param in the URL; we'll still return page.url() and let
        // the caller decide.
      });
    const finalUrl = page.url();
    console.log(
      `[qr-resolve-browser] landed on ${finalUrl} (from ${url})`,
    );
    if (!finalUrl || finalUrl === url) return null;
    cacheSet(url, finalUrl);
    return finalUrl;
  } catch (err) {
    console.error(
      `[qr-resolve-browser] resolve failed for ${url}: ${err instanceof Error ? err.message : String(err)}`,
    );
    return null;
  } finally {
    // Always close the page + context. Leaking contexts is the fastest
    // path to OOM on the 1 GB instance.
    await page.close().catch(() => {});
    await context.close().catch(() => {});
  }
}
