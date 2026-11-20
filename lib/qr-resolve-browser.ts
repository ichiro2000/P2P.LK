import puppeteer from "@cloudflare/puppeteer";
import { getEnv } from "@/lib/db/client";

/**
 * Headless-browser fallback for Binance QR short-links that sit behind an AWS
 * WAF JS challenge. Runs on Cloudflare Browser Rendering — nothing launches
 * inside our own Worker, so a burst of lookups can't exhaust our memory.
 *
 * Safety:
 *   - Only Binance hosts may be loaded; every request the page makes to any
 *     other host is aborted (no SSRF via redirects).
 *   - Results cached in KV for 7 days, keyed by the short-link.
 *   - A KV lock keeps at most one session running at a time.
 */

const ALLOWED = ["binance.com", "binance.me", "bnc.lt"];
const isAllowedHost = (h: string) =>
  ALLOWED.some((s) => h === s || h.endsWith(`.${s}`));

const CACHE_TTL = 7 * 86400;
/** Headless-browser launches allowed per UTC day, across the whole site. */
const BROWSER_LAUNCHES_PER_DAY = 40;
const LOCK_KEY = "qr:browser-lock";
const LOCK_TTL = 60;

export async function resolveShortLinkViaBrowser(
  url: string,
  opts?: { timeoutMs?: number },
): Promise<string | null> {
  let start: URL;
  try {
    start = new URL(url);
  } catch {
    return null;
  }
  if (start.protocol !== "https:" || !isAllowedHost(start.hostname)) return null;

  const env = await getEnv();
  const cacheKey = `qr:resolved:${start.toString()}`;
  const cached = await env.LIVE.get(cacheKey);
  if (cached) return cached;
  // A recent failure for this exact URL: don't launch a browser again.
  const missKey = `qr:miss:${start.toString()}`;
  if (await env.LIVE.get(missKey)) return null;

  // Browser Rendering is billed by the hour past the free allowance, and this
  // path is reachable without signing in: cap launches per UTC day site-wide.
  const dayKey = `qr:browser:day:${new Date().toISOString().slice(0, 10)}`;
  const launches = Number((await env.LIVE.get(dayKey)) ?? 0) || 0;
  if (launches >= BROWSER_LAUNCHES_PER_DAY) return null;
  await env.LIVE.put(dayKey, String(launches + 1), { expirationTtl: 2 * 86400 });

  // Single-flight: if another resolve is in progress, don't start a second
  // browser — the caller falls back to the sync parse.
  if (await env.LIVE.get(LOCK_KEY)) return null;
  await env.LIVE.put(LOCK_KEY, "1", { expirationTtl: LOCK_TTL });

  const timeout = Math.min(opts?.timeoutMs ?? 15000, 20000);
  let browser: Awaited<ReturnType<typeof puppeteer.launch>> | null = null;
  try {
    browser = await puppeteer.launch(env.BROWSER);
    const page = await browser.newPage();
    await page.setRequestInterception(true);
    page.on("request", (req) => {
      try {
        const h = new URL(req.url()).hostname;
        // Binance pages pull assets from their CDN (bnbstatic) — allow those
        // read-only; block everything else.
        const sub = (d: string) => h === d || h.endsWith(`.${d}`);
        if (isAllowedHost(h) || sub("bnbstatic.com") || sub("awswaf.com")) {
          void req.continue();
        } else {
          void req.abort();
        }
      } catch {
        void req.abort();
      }
    });
    await page.goto(start.toString(), { timeout, waitUntil: "domcontentloaded" });
    await page
      .waitForFunction(() => /advertiserNo=/.test(location.href), {
        timeout: Math.min(timeout, 12000),
      })
      .catch(() => undefined);
    const finalUrl = page.url();
    const final = new URL(finalUrl);
    if (!isAllowedHost(final.hostname)) return null;
    if (/advertiserNo=/.test(finalUrl)) {
      await env.LIVE.put(cacheKey, finalUrl, { expirationTtl: CACHE_TTL });
    } else {
      await env.LIVE.put(missKey, "1", { expirationTtl: 3600 }).catch(() => undefined);
    }
    return finalUrl;
  } catch (err) {
    console.error(`[qr-resolve-browser] ${(err as Error).message}`);
    await env.LIVE.put(missKey, "1", { expirationTtl: 3600 }).catch(() => undefined);
    return null;
  } finally {
    await browser?.close().catch(() => undefined);
    await env.LIVE.delete(LOCK_KEY).catch(() => undefined);
  }
}
