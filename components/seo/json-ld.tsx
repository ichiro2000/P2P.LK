import { absoluteUrl, DEFAULT_DESCRIPTION, LOCALE, ORG_ID, SITE_NAME, SITE_URL, WEBSITE_ID } from "@/lib/seo";

/**
 * Inline JSON-LD with escaping that is safe inside a <script> element.
 * JSON.stringify alone leaves `<`, `>` and U+2028/U+2029 untouched, so a
 * merchant name containing `</script>` could break out of the tag. The
 * separator regexes are built from char codes so this file never contains
 * the raw characters.
 */
const LS_RE = new RegExp(String.fromCharCode(0x2028), "g");
const PS_RE = new RegExp(String.fromCharCode(0x2029), "g");

function escapeForScript(json: string): string {
  return json
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
    .replace(/&/g, "\\u0026")
    .replace(LS_RE, "\\u2028")
    .replace(PS_RE, "\\u2029");
}

type Thing = Record<string, unknown>;

export function JsonLd({ data }: { data: Thing | Thing[] }) {
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: escapeForScript(JSON.stringify(data)) }}
    />
  );
}

/** Site-wide entities, rendered once by the root layout. No SearchAction:
 *  merchant search is client-side and has no crawlable `?q=` URL. */
export function siteJsonLd(): Thing {
  return {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        "@id": ORG_ID,
        name: SITE_NAME,
        url: SITE_URL,
        logo: { "@type": "ImageObject", url: absoluteUrl("/icon-512.png"), width: 512, height: 512 },
        description:
          "Independent market-data site tracking USDT/LKR peer-to-peer prices on Binance and Bybit for Sri Lanka.",
        areaServed: { "@type": "Country", name: "Sri Lanka" },
      },
      {
        "@type": "WebSite",
        "@id": WEBSITE_ID,
        name: SITE_NAME,
        url: SITE_URL,
        description: DEFAULT_DESCRIPTION,
        inLanguage: LOCALE,
        publisher: { "@id": ORG_ID },
      },
    ],
  };
}

/** BreadcrumbList. The last item (current page) omits `item`, per Google. */
export function breadcrumbJsonLd(items: { name: string; path?: string }[]): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: it.name,
      ...(it.path && i < items.length - 1 ? { item: absoluteUrl(it.path) } : {}),
    })),
  };
}

/** Dataset (Google Dataset Search). Only facts the page really publishes. */
export function datasetJsonLd(d: {
  name: string;
  description: string;
  path: string;
  variables: string[];
  keywords?: readonly string[];
  temporalCoverage?: string;
  dateModified?: string;
}): Thing {
  return {
    "@context": "https://schema.org",
    "@type": "Dataset",
    name: d.name,
    description: d.description,
    url: absoluteUrl(d.path),
    creator: { "@id": ORG_ID },
    publisher: { "@id": ORG_ID },
    isAccessibleForFree: true,
    inLanguage: LOCALE,
    spatialCoverage: { "@type": "Place", name: "Sri Lanka" },
    variableMeasured: d.variables,
    ...(d.keywords ? { keywords: [...d.keywords] } : {}),
    ...(d.temporalCoverage ? { temporalCoverage: d.temporalCoverage } : {}),
    ...(d.dateModified ? { dateModified: d.dateModified } : {}),
  };
}
