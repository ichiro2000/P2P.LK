import type { Metadata } from "next";

/**
 * Single source of truth for P2P.LK's search and social metadata.
 *
 * Rules carried over from the LinkInvitation SEO audits (see SEO.md):
 *  - Every indexable page sets its OWN self-referencing canonical. The root
 *    layout never sets one: a root `canonical: "/"` cascades to every page
 *    that forgets to override it and tells Google they are all duplicates of
 *    the homepage.
 *  - Titles stay under ~60 characters once the " | P2P.LK" suffix is added;
 *    use `absoluteTitle` when the keyword-first title already names the brand.
 *  - Descriptions are 140-160 characters, keyword first, no truncation.
 *  - No `keywords` meta tag (Google ignores it, Bing reads long lists as
 *    stuffing). KEYWORDS below feeds llms.txt and Dataset JSON-LD only.
 *  - Share images are real PNGs from next/og (opengraph-image.tsx); SVG
 *    previews are ignored by WhatsApp, Facebook, X and LinkedIn.
 */

export const SITE_NAME = "P2P.LK";

const FALLBACK_URL = "https://p2p.lk";

/**
 * Absolute origin with no trailing slash. NEXT_PUBLIC_SITE_URL wins, except
 * that a localhost value is ignored in production builds: wrangler.jsonc
 * ships `http://localhost:3000` for local dev, and a deploy that forgot to
 * change it must not publish localhost canonicals and sitemap URLs.
 */
function resolveSiteUrl(): string {
  const raw = (process.env.NEXT_PUBLIC_SITE_URL ?? "").trim().replace(/\/+$/, "");
  if (!raw) return FALLBACK_URL;
  try {
    const u = new URL(raw);
    const local = /^(localhost|127\.0\.0\.1|\[::1\])$/.test(u.hostname);
    if (local && process.env.NODE_ENV === "production") return FALLBACK_URL;
    return u.origin;
  } catch {
    return FALLBACK_URL;
  }
}

export const SITE_URL = resolveSiteUrl();

/** Homepage / fallback title (absolute, 53 chars). */
export const DEFAULT_TITLE = "USDT to LKR Today: Binance & Bybit P2P Rates | P2P.LK";

export const TITLE_TEMPLATE = `%s | ${SITE_NAME}`;

export const DEFAULT_DESCRIPTION =
  "Live USDT to LKR rates from Binance P2P and Bybit P2P in Sri Lanka: best bank-transfer prices, spread, depth, merchants and the Google dollar rate.";

/** The site-wide share image (app/opengraph-image.tsx). Pages that set
 *  `openGraph` replace the inherited file-convention image, so pageMetadata()
 *  names it explicitly. A segment with its own opengraph-image file (e.g.
 *  /rates) still wins over this. */
export const DEFAULT_OG_IMAGE = {
  url: "/opengraph-image",
  width: 1200,
  height: 630,
  alt: "P2P.LK: USDT/LKR live P2P rates from Binance and Bybit for Sri Lanka",
  type: "image/png",
};

export const LOCALE = "en-LK";
export const OG_LOCALE = "en_LK";

export const KEYWORDS = [
  "USDT to LKR",
  "USDT LKR rate today",
  "Binance P2P Sri Lanka",
  "Bybit P2P LKR",
  "Google dollar rate Sri Lanka",
  "CBSL dollar rate",
  "bank TT rates Sri Lanka",
  "P2P merchants Sri Lanka",
] as const;

/** Stable @id values so page-level JSON-LD can reference the root entities
 *  instead of repeating sparse copies (LinkInvitation fix 363b8fa7). */
export const ORG_ID = `${SITE_URL}/#organization`;
export const WEBSITE_ID = `${SITE_URL}/#website`;

/** Absolute URL for a site path ("/rates" -> "https://p2p.lk/rates"). */
export function absoluteUrl(path = "/"): string {
  return path === "/" ? SITE_URL : `${SITE_URL}${path.startsWith("/") ? path : `/${path}`}`;
}

/** `noindex, follow`: keep the page out of results but let link equity flow. */
export const NOINDEX: NonNullable<Metadata["robots"]> = { index: false, follow: true };

/** `noindex, nofollow` for private areas (admin, account). */
export const NOINDEX_NOFOLLOW: NonNullable<Metadata["robots"]> = { index: false, follow: false };

export type PageMetaInput = {
  /** Page title; the root template appends " | P2P.LK" unless `absoluteTitle`. */
  title: string;
  description: string;
  /** Canonical path, e.g. "/rates". Query strings are never canonical. */
  path: string;
  /** Render `title` as-is (it already carries the brand). */
  absoluteTitle?: boolean;
  /** Shorter title for social cards; defaults to the full title. */
  socialTitle?: string;
  /** Keep out of the index (members, auth, privacy-sensitive detail pages). */
  noindex?: boolean | "nofollow";
  ogType?: "website" | "article";
  /** false when the route segment has its own opengraph-image file: an
   *  explicit image list here would override it. */
  ogImage?: boolean;
};

/** Metadata for one page: title, description, canonical, Open Graph, Twitter. */
export function pageMetadata({
  title,
  description,
  path,
  absoluteTitle = false,
  socialTitle,
  noindex = false,
  ogType = "website",
  ogImage = true,
}: PageMetaInput): Metadata {
  const images = ogImage ? { images: [DEFAULT_OG_IMAGE] } : {};
  const fullTitle = absoluteTitle ? title : `${title} | ${SITE_NAME}`;
  const social = socialTitle ?? fullTitle;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: {
      title: social,
      description,
      url: path,
      siteName: SITE_NAME,
      locale: OG_LOCALE,
      type: ogType,
      ...images,
    },
    twitter: {
      card: "summary_large_image",
      title: social,
      description,
      ...images,
    },
    ...(noindex ? { robots: noindex === "nofollow" ? NOINDEX_NOFOLLOW : NOINDEX } : {}),
  };
}

/** Minimal metadata for private pages: a title and noindex, nothing else. */
export function privateMetadata(title: string, robots: "follow" | "nofollow" = "nofollow"): Metadata {
  return { title, robots: robots === "follow" ? NOINDEX : NOINDEX_NOFOLLOW };
}
