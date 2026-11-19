import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";
import { ASSET, FIAT } from "@/lib/constants";
import { DEFAULT_EXCHANGE } from "@/lib/exchanges";
import { sitemapMerchants } from "@/lib/db/seo";

/**
 * sitemap.xml, built per request on the Worker (D1 read, no filesystem).
 *
 * Merchant detail URLs: the exchange is chosen by a cookie, so a crawler
 * (no cookie) always renders /merchants/<id> against the default exchange.
 * Only that exchange's merchants are listed; the others would render
 * "merchant not found" for Googlebot. Capped at 1,000 merchants seen in the
 * last 30 days, newest first, well under the 50,000-URL limit.
 */
export const dynamic = "force-dynamic";

const MERCHANT_CAP = 1_000;
const ACTIVE_DAYS = 30;

type Entry = MetadataRoute.Sitemap[number];

const STATIC: { path: string; changeFrequency: Entry["changeFrequency"]; priority: number }[] = [
  { path: "/", changeFrequency: "always", priority: 1.0 },
  { path: "/rates", changeFrequency: "hourly", priority: 0.9 },
  { path: "/merchants", changeFrequency: "hourly", priority: 0.8 },
  { path: "/compare", changeFrequency: "hourly", priority: 0.8 },
  { path: "/historical", changeFrequency: "hourly", priority: 0.7 },
  { path: "/arbitrage", changeFrequency: "hourly", priority: 0.7 },
  { path: "/liquidity", changeFrequency: "hourly", priority: 0.6 },
  { path: "/risk", changeFrequency: "hourly", priority: 0.6 },
  { path: "/suspicious", changeFrequency: "daily", priority: 0.5 },
];

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date();
  const pages: MetadataRoute.Sitemap = STATIC.map((p) => ({
    url: absoluteUrl(p.path),
    lastModified: now,
    changeFrequency: p.changeFrequency,
    priority: p.priority,
  }));

  let merchants: MetadataRoute.Sitemap = [];
  try {
    const sinceTs = Math.floor(now.getTime() / 1000) - ACTIVE_DAYS * 86_400;
    const rows = await sitemapMerchants(DEFAULT_EXCHANGE, ASSET, FIAT.code, { sinceTs, limit: MERCHANT_CAP });
    merchants = rows.map((r) => ({
      url: absoluteUrl(`/merchants/${encodeURIComponent(r.merchantId)}`),
      lastModified: new Date(r.lastSeenTs * 1000),
      changeFrequency: "daily",
      priority: 0.5,
    }));
  } catch {
    // D1 unavailable: still serve the static pages rather than a 500.
  }

  return [...pages, ...merchants];
}
