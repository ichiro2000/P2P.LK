# SEO for P2P.LK

Modelled on the SEO work the owner's SEO experts did on LinkInvitation (invitation.lk): commits `1ec9a762`, `7662fe80`, `cde3619f`, `3147edcb`, `1a972a74`, `dee36577`, `4fe449a2`, `a2ec4969`, `86f0504d`, `363b8fa7`, plus its `TODO.md` and `public/llms.txt`. Their rules are adapted here to a finance and market-data site.

## Where things live

| What | File |
|---|---|
| Site name, base URL, default title and description, keywords, `pageMetadata()` | `lib/seo.ts` |
| Root metadata (`metadataBase`, title template, robots, geo), `<html lang="en-LK">`, site JSON-LD | `app/layout.tsx` |
| JSON-LD helpers (`JsonLd`, Organization + WebSite, BreadcrumbList, Dataset) | `components/seo/json-ld.tsx` |
| robots.txt | `app/robots.ts` |
| sitemap.xml (static pages + up to 1,000 active merchants from D1) | `app/sitemap.ts`, `lib/db/seo.ts` |
| Share images (next/og PNG) | `app/opengraph-image.tsx` (site-wide), `app/(app)/rates/opengraph-image.tsx` (live prices), `components/seo/og-frame.tsx` |
| Web manifest and icons | `app/manifest.ts`, `app/icon.svg`, `app/apple-icon.png`, `public/icon-192.png`, `public/icon-512.png`, `public/icon-maskable-512.png` |
| LLM summary | `public/llms.txt` |

### Adding a page

```ts
import { pageMetadata } from "@/lib/seo";

export const metadata = pageMetadata({
  title: "Keyword-first title",      // " | P2P.LK" is appended; keep the result <= 60 chars
  description: "140-160 chars, keyword first, says what the page shows.",
  path: "/the-path",                 // self-canonical, never a query string
});
```

Private pages use `privateMetadata("Title")` (noindex). Use `absoluteTitle: true` when the title already contains the brand. Pass `ogImage: false` when the route segment has its own `opengraph-image.tsx`; otherwise the explicit default image overrides it. Add the URL to `STATIC` in `app/sitemap.ts` and to `public/llms.txt`.

## Checklist (LinkInvitation rule -> P2P.LK)

### Technical

- [x] **`metadataBase` set once** in the root layout, from `NEXT_PUBLIC_SITE_URL`, defaulting to `https://p2p.lk`. A localhost value is ignored in production builds, so a forgotten `wrangler.jsonc` var cannot publish localhost canonicals.
- [x] **No root canonical.** LinkInvitation's `7662fe80` fixed a root `canonical: "/"` that cascaded to every page, so Google indexed only the homepage. Every public page here sets its own self-canonical through `pageMetadata()`. Filter query strings (`?payType=`, `?range=`, `?merchantType=`) canonicalise to the bare path.
- [x] **Title template** `%s | P2P.LK`. Every rendered title is 53 to 59 characters, keyword first; the homepage uses `title.absolute` (LinkInvitation `1a972a74`, `86f0504d`).
- [x] **Descriptions are 145 to 159 characters**, keyword first, with no truncation (`3147edcb`, `a2ec4969`).
- [x] **No `keywords` meta tag** (LinkInvitation `dee36577`: Google ignores it and Bing treats long lists as stuffing). `KEYWORDS` in `lib/seo.ts` feeds the Dataset JSON-LD and llms.txt only.
- [x] **robots.txt** blocks `/api`, `/admin`, `/app` and `/account`, each pinned with `$` plus `/`. The pin matters because a bare `/app` prefix would also block `/apple-icon.png`. Sitemap is referenced.
- [x] **Noindex in metadata**, kept crawlable so Google can see it. This covers auth pages (`noindex, follow`); `/alerts`, `/workspace`, `/reports` and `/suspicious/new`, which are linked from the sidebar, so a robots block would get them "indexed, though blocked"; the admin layout (`noindex, nofollow` for every admin page, including future ones); `/app`; `/account`; and merchants that are not found.
- [x] **sitemap.xml** is dynamic and runs on the Worker (`force-dynamic`, one indexed D1 read, no filesystem). It lists 9 public pages with `changeFrequency` and `priority`. It also lists up to 1,000 merchants seen in the last 30 days, with `lastModified` taken from `lastSeenTs`. If D1 fails, it falls back to the static pages instead of returning a 500. The cap is far below Google's 50,000-URL limit; for chunking, copy LinkInvitation's `generateSitemaps` pattern if the cap is ever raised.
- [x] **Real PNG share images** through next/og (LinkInvitation `cde3619f`: WhatsApp, Facebook, X and LinkedIn ignore SVG). The site-wide image is static and rendered at build. `/rates` gets a live image with the Binance and Bybit USDT buy prices and Google USD/LKR. Its data comes from the KV book and one D1 row, with `Cache-Control: s-maxage=300`. Only the bundled default font is used, so no font is fetched.
- [x] **Twitter cards** `summary_large_image` on every page.
- [x] **Web manifest** with 192, 512 and maskable icons, an SVG favicon and a 180 px apple-touch-icon, drawn from the brand mark.
- [x] **llms.txt** follows LinkInvitation's layout: summary, "What it is", key pages, how the numbers are made.
- [x] **Metadata for social bots is in `<head>`.** Next 16 streams `generateMetadata` output for browsers and Googlebot, which renders JS. For HTML-only bots (facebookexternalhit, WhatsApp, bingbot and others) it is blocking and lands in `<head>`. Both cases were verified on `/merchants/[id]`.

### Structured data

- [x] **Organization and WebSite** in the root layout, as one `@graph` with stable `@id`s (`https://p2p.lk/#organization`, `#website`). Page-level schema points at `@id` instead of copying sparse Organization objects (LinkInvitation `363b8fa7`).
- [x] **No `SearchAction`**: merchant search is client-side and has no `?q=` URL. Add one only if a crawlable search URL ships.
- [x] **BreadcrumbList** on `/merchants/[id]` (Live markets > Merchants > name). The last item has no `item`, per Google.
- [x] **Dataset** on `/rates`. It covers the CBSL, bank TT, Google and P2P-premium series, with `temporalCoverage` from the first stored day and `dateModified` from the latest CBSL day. `ExchangeRateSpecification` was not used: it describes a currency-exchange service's own offer, and P2P.LK does not exchange money.
- [x] **No invented facts**: no ratings, phone numbers, addresses or `sameAs` links. Add `sameAs` to the Organization once official social profiles exist (LinkInvitation `dee36577`).
- [x] **JSON-LD is escaped** for `</script>`, U+2028 and U+2029, because merchant names are user-controlled.

### Local and language

- [x] `<html lang="en-LK">`, `og:locale` `en_LK`, `geo.region` `LK`, `geo.placename` Sri Lanka, Dataset `spatialCoverage` Sri Lanka.
- [x] **No hreflang**: the site has one language and one URL set, so nothing pairs with it. Add it with `alternates.languages` if Sinhala or Tamil versions ship.
- [x] Sri Lanka keywords in titles and descriptions: "USDT to LKR", "Binance P2P", "Bybit P2P", "dollar rate", "CBSL", "bank TT", "Sri Lanka".

### On-page

- [x] **One `<h1>` per page.** It is the Topbar title. Loading skeletons now render their "Loading" title as a `<p>` (`titleAs="p"`), so the streamed HTML doesn't carry a second h1. Exception: `historical/`, `risk/` and `liquidity/loading.tsx` were left for the agent working there. Each needs `titleAs="p"` on its `<Topbar>`.
- [x] Keyword-first eyebrows and descriptions are already in place (LinkInvitation `4fe449a2` pattern: brand-voice H1, keyword in eyebrow, title and description).
- [x] **Crawlable text.** `/arbitrage` gained a short "About this data" section. Every other public page already server-renders its numbers and a description.
- [x] The site has no `<img>` elements; the SVG icons are `aria-hidden`. Link text is descriptive ("All merchants", "Back to all merchants", "View on Binance").

### Privacy decisions

- **`/suspicious` (registry list): indexed.** It explains the registry and the QR check, which is useful and searchable.
- **`/suspicious/[id]` (one flagged taker): `noindex, follow`, not in the sitemap, not blocked in robots.txt.** These pages name a person on the strength of unverified community reports, and removal requests exist because reports can be wrong. They must not rank for someone's nickname or user id. The noindex stays visible to Google, and the page title still names the taker so a link shared between merchants previews usefully.
- **`/merchants/[id]`: indexed, with one exception.** These are public business profiles that Binance and Bybit already publish. The exchange comes from a cookie, and crawlers have no cookie, so they always render the default exchange (Binance). Only Binance merchants go in the sitemap. A merchant page viewed under the other exchange, or one never seen, is `noindex`.

### Performance and Core Web Vitals (from PLAN.md section 3; LinkInvitation's cache rule)

- [x] Pages read the KV book and are server-rendered with real numbers. The new SEO code adds no client JS: the JSON-LD is a static script, and metadata is resolved on the server.
- [x] OG images are cached at the edge: the static one at build, the `/rates` one for 5 minutes.
- [ ] Run Lighthouse and PageSpeed Insights on production against the PLAN.md targets (LCP < 1.2 s on 4G, INP < 100 ms, home JS < 150 KB). Watch CLS from the live tables.

### Left to do (needs the owner or a later change)

- [ ] **Set `NEXT_PUBLIC_SITE_URL` to `https://p2p.lk`** in `wrangler.jsonc` `vars` before the production deploy (it is `http://localhost:3000` today). Production falls back to `https://p2p.lk` anyway, but a staging host should set its own value.
- [ ] Google Search Console: verify the `p2p.lk` Domain property with a DNS TXT record in Cloudflare DNS (no code change), then submit `https://p2p.lk/sitemap.xml`.
- [ ] Bing Webmaster Tools: import from Search Console and submit the sitemap.
- [ ] Rich Results Test on `/`, `/rates` and one `/merchants/<id>`. Schema.org validator for the Dataset. The Dataset should appear in Google Dataset Search within a few weeks.
- [ ] Share `/` and `/rates` in WhatsApp and the Facebook Sharing Debugger to confirm the preview images.
- [ ] Apply the metadata for `/historical`, `/risk` and `/liquidity` (blocks below), and `titleAs="p"` in their `loading.tsx`.
- [ ] Optional: put the exchange in the merchant URL (`/merchants/<id>?exchange=bybit` or `/bybit/merchants/<id>`) so Bybit merchants can be indexed too. Return a real 404 status for unknown merchants: today they render a 200 page marked `noindex`.
- [ ] Optional: add Organization `sameAs` and a contact point once official social and support channels exist.
- [ ] After 2 to 4 weeks, check Search Console Performance for CTR by page and rewrite low-CTR descriptions (LinkInvitation `3147edcb` did this for its sample pages).

#### Metadata for the three pages edited by another agent

```ts
// app/(app)/historical/page.tsx  (replace `export const metadata = { title: "Historical" };`)
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata({
  title: "USDT/LKR Price History: Binance & Bybit P2P Charts",
  description:
    "USDT to LKR price history from Binance P2P and Bybit P2P: best bid and ask, spread and order-book depth recorded every minute, with candles and hourly rollups.",
  path: "/historical",
});

// app/(app)/risk/page.tsx  (replace `export const metadata = { title: "Risk" };`)
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata({
  title: "P2P Risk Signals: USDT/LKR Price Moves & Churn",
  description:
    "Live risk signals for Sri Lanka's USDT/LKR P2P market on Binance and Bybit: sudden price moves, near-price liquidity drops, merchant churn, low-completion ads.",
  path: "/risk",
});

// app/(app)/liquidity/page.tsx  (replace `export const metadata = { title: "Liquidity" };`)
import { pageMetadata } from "@/lib/seo";
export const metadata = pageMetadata({
  title: "USDT/LKR P2P Liquidity: Depth & Slippage by Hour",
  description:
    "How much USDT you can buy or sell for LKR on Binance P2P and Bybit P2P before the price moves: live fill simulator, depth by merchant and liquidity by hour.",
  path: "/liquidity",
});
```

## Deploy day

1. In `wrangler.jsonc`, set `vars.NEXT_PUBLIC_SITE_URL` to `"https://p2p.lk"` and run `npm run cf-typegen`.
2. Run `npm run cf:build`. Confirm the build lists `/opengraph-image`, `/rates/opengraph-image-<hash>`, `/robots.txt`, `/sitemap.xml` and `/manifest.webmanifest` without errors (next/og under OpenNext).
3. Deploy to the owner's new Cloudflare account. Then check:
   - `curl -s https://p2p.lk/robots.txt` shows the `Sitemap: https://p2p.lk/sitemap.xml` line.
   - `curl -s https://p2p.lk/sitemap.xml | grep -c '<loc>'` returns 9 or more, and merchant URLs are present once the sweep has run.
   - `curl -sI https://p2p.lk/opengraph-image` returns `200 image/png`.
   - `curl -s -A bingbot https://p2p.lk/rates | grep -E 'canonical|og:image|ld\+json'` shows `https://p2p.lk/...` absolute URLs, not localhost.
4. Search Console: add a DNS TXT record for the Domain property, verify it, submit the sitemap, and use URL Inspection to request indexing for `/`, `/rates`, `/merchants` and `/compare`.
5. Bing Webmaster Tools: import from Search Console.
6. Test the share previews: Facebook Sharing Debugger on `/` and `/rates`, plus a WhatsApp message to yourself.
7. Run the Rich Results Test on `/` (Organization, WebSite), `/rates` (Dataset) and one `/merchants/<id>` (BreadcrumbList).
8. A week later, check Search Console "Pages". Expected exclusions: noindexed auth, member and taker pages, and the robots-blocked `/api`, `/admin`, `/app` and `/account`. Anything else is a bug.
