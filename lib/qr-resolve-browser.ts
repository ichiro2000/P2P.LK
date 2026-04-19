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
