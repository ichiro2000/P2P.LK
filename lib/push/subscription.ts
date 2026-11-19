import { z } from "zod";
import { b64urlDecode } from "./base64url";

/**
 * Validation for subscriptions sent by browsers (`PushSubscription.toJSON()`).
 * Client-safe: no bindings, no server-only imports.
 */

/** Push services we deliver to. The server POSTs to whatever endpoint a
 *  browser hands us, so only real push services are accepted (no SSRF via a
 *  made-up endpoint). Covers Chrome/Edge/Brave/Opera/Samsung (FCM), Firefox
 *  (Mozilla autopush), Edge legacy (WNS) and Safari/iOS (Apple). A browser
 *  on a push service not listed here gets a clear error, never a silent
 *  failure — add its host suffix here. */
export const PUSH_HOST_SUFFIXES = [
  "fcm.googleapis.com",
  "android.googleapis.com",
  "push.services.mozilla.com",
  "notify.windows.com",
  "push.apple.com",
] as const;

export function isAllowedPushEndpoint(endpoint: string): boolean {
  let u: URL;
  try {
    u = new URL(endpoint);
  } catch {
    return false;
  }
  // Local development only: the fake push service the e2e tests send to
  // (app/api/dev/push-sink). `next build` inlines NODE_ENV, so production
  // never accepts it.
  if (process.env.NODE_ENV === "development" && u.origin === "http://localhost:3000") {
    return u.pathname.startsWith("/api/dev/push-sink/");
  }
  if (u.protocol !== "https:" || u.username || u.password || (u.port && u.port !== "443")) return false;
  const host = u.hostname.toLowerCase();
  return PUSH_HOST_SUFFIXES.some((s) => host === s || host.endsWith(`.${s}`));
}

const zKey = (bytes: number, name: string) =>
  z
    .string()
    .trim()
    .max(200)
    .refine((s) => {
      try {
        const b = b64urlDecode(s);
        return b.length === bytes && (bytes !== 65 || b[0] === 4);
      } catch {
        return false;
      }
    }, `invalid ${name} key`);

export const zEndpoint = z
  .string()
  .trim()
  .max(1024)
  .refine(isAllowedPushEndpoint, "this browser's push service isn't supported");

export const SubscriptionJson = z.object({
  endpoint: zEndpoint,
  expirationTime: z.number().nullish(),
  keys: z.object({ p256dh: zKey(65, "p256dh"), auth: zKey(16, "auth") }),
});
export type SubscriptionJson = z.infer<typeof SubscriptionJson>;

/** "Chrome on Android", "Safari on iPhone"… from a User-Agent string. Only a
 *  label for the devices list; never used for decisions. */
export function deviceLabel(ua: string | null | undefined): string {
  if (!ua) return "Unknown device";
  const os = /iPhone/.test(ua)
    ? "iPhone"
    : /iPad/.test(ua)
      ? "iPad"
      : /Android/.test(ua)
        ? "Android"
        : /Windows/.test(ua)
          ? "Windows"
          : /CrOS/.test(ua)
            ? "ChromeOS"
            : /Mac OS X|Macintosh/.test(ua)
              ? "Mac"
              : /Linux/.test(ua)
                ? "Linux"
                : "";
  const browser = /EdgA?\//.test(ua)
    ? "Edge"
    : /OPR\/|Opera/.test(ua)
      ? "Opera"
      : /SamsungBrowser/.test(ua)
        ? "Samsung Internet"
        : /Firefox\/|FxiOS/.test(ua)
          ? "Firefox"
          : /CriOS|Chrome\//.test(ua)
            ? "Chrome"
            : /Safari\//.test(ua)
              ? "Safari"
              : "Browser";
  return os ? `${browser} on ${os}` : browser;
}

/** Hex SHA-256 of an endpoint (tombstones store this, not the endpoint). */
export async function endpointHash(endpoint: string): Promise<string> {
  const d = await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
  return [...new Uint8Array(d)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
