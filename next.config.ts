import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

/**
 * Content-Security-Policy (production). Scripts, data and frames only from
 * this site plus Cloudflare Turnstile and Web Analytics, so an injected script can't load code
 * from, or send data to, another origin. 'unsafe-inline' stays for scripts
 * until a nonce-based pass (Next's inline bootstrap scripts need nonces).
 * `next dev` needs eval, so dev keeps the short policy.
 */
const TURNSTILE = "https://challenges.cloudflare.com";
/** Cloudflare Web Analytics, injected by Cloudflare on the zone. */
const CF_INSIGHTS_JS = "https://static.cloudflareinsights.com";
const CF_INSIGHTS_API = "https://cloudflareinsights.com";
const CSP_PROD = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${TURNSTILE} ${CF_INSIGHTS_JS}`,
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  `connect-src 'self' ${TURNSTILE} ${CF_INSIGHTS_API}`,
  `frame-src ${TURNSTILE}`,
  "worker-src 'self' blob:",
  "manifest-src 'self'",
  "media-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  "upgrade-insecure-requests",
].join("; ");
const CSP_DEV = "frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'";

/** Baseline security headers for every response. */
const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=()" },
  { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
  {
    key: "Content-Security-Policy",
    value: process.env.NODE_ENV === "production" ? CSP_PROD : CSP_DEV,
  },
];

const nextConfig: NextConfig = {
  poweredByHeader: false,
  async headers() {
    return [
      { source: "/:path*", headers: SECURITY_HEADERS },
      // The service worker must never be served stale from an HTTP cache, or
      // a fixed sw.js could take up to 24 h to reach browsers. On Cloudflare,
      // public/ files are served by Workers Static Assets before Next runs,
      // so public/_headers sets the same headers there.
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          { key: "Service-Worker-Allowed", value: "/" },
          { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        ],
      },
    ];
  },
  experimental: {
    optimizePackageImports: ["lucide-react", "recharts", "date-fns"],
  },
};

export default nextConfig;

// Gives `next dev` access to local D1 / KV bindings (miniflare, persisted in
// .wrangler/state — the same store `wrangler d1 migrations apply --local` uses).
initOpenNextCloudflareForDev();
