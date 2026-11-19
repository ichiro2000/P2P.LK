import type { MetadataRoute } from "next";
import { absoluteUrl } from "@/lib/seo";

/**
 * Crawl rules. Private areas carry `noindex` in their metadata too; robots
 * only stops the crawl.
 *
 * Not disallowed on purpose:
 *  - /sign-in, /sign-up, /verify, /forgot-password: they carry `noindex`,
 *    and Google must be able to fetch them to see it.
 *  - /alerts, /workspace, /reports, /suspicious/new: linked from the
 *    sidebar on every page, so a robots block would get the bare URLs
 *    "indexed, though blocked". They carry `noindex` instead.
 *  - /suspicious/<id>: same reason. Those pages are `noindex` for privacy;
 *    a robots block would hide the noindex and let the bare URL get indexed
 *    from external links.
 */
const PRIVATE = ["/api", "/admin", "/app", "/account"];

/** `/app` as a bare prefix would also block `/apple-icon.png`, so every
 *  path is pinned with `$` (exact) plus its `/` subtree. */
const DISALLOW = PRIVATE.flatMap((p) => [`${p}$`, `${p}/`]);

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: "/",
        disallow: DISALLOW,
      },
    ],
    sitemap: absoluteUrl("/sitemap.xml"),
  };
}
