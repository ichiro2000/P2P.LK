/* P2P.LK service worker.
 *
 * Scope "/". Served with Cache-Control: no-cache (next.config.ts) so every
 * deploy's copy is picked up on the next navigation; bump VERSION whenever
 * this file changes (old caches are deleted on activate).
 *
 * What it does — and deliberately does not:
 *   - precaches ONLY the offline page and static icons;
 *   - navigations: network first (with navigation preload); offline → the
 *     offline page. Pages are never cached (they are personalised);
 *   - never touches /api/*, auth, /app, /account, /admin or any other
 *     request: those go straight to the network, uncached;
 *   - push: ALWAYS shows a notification (a push without one makes Chrome
 *     and Safari revoke the subscription after a few silent pushes);
 *   - pushsubscriptionchange: re-subscribes with the current VAPID key and
 *     tells the server, so a browser-side rotation never silently stops
 *     alerts;
 *   - notificationclick: focuses an open P2P.LK window or opens one, at a
 *     validated same-origin URL from the payload (default /alerts).
 */

const VERSION = "2026-11-20.13";
const CACHE = `p2plk-static-${VERSION}`;
const OFFLINE_URL = "/offline.html";
const PRECACHE = [OFFLINE_URL, "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/badge-96.png"];
const DEFAULT_URL = "/alerts";
const DEFAULT_TITLE = "P2P.LK";

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(CACHE);
      // One by one, failures tolerated: a missing icon (or a flaky network
      // during install) must never stop the worker — and with it push —
      // from installing. `cache: "reload"` skips the HTTP cache.
      await Promise.allSettled(
        PRECACHE.map(async (url) => {
          const res = await fetch(new Request(url, { cache: "reload" }));
          if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
          // Cloudflare static assets redirect /offline.html → /offline. A
          // "redirected" response can't answer a navigation, so store a
          // clean copy under the original URL.
          const clean = res.redirected
            ? new Response(await res.blob(), { status: res.status, statusText: res.statusText, headers: res.headers })
            : res;
          await cache.put(url, clean);
        }),
      );
      await self.skipWaiting();
    })(),
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(keys.filter((k) => k.startsWith("p2plk-") && k !== CACHE).map((k) => caches.delete(k)));
      if (self.registration.navigationPreload) {
        await self.registration.navigationPreload.enable().catch(() => undefined);
      }
      await self.clients.claim();
    })(),
  );
});

/* ── Fetch ─────────────────────────────────────────────────────────────── */

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // Personalised or dynamic: never intercepted, never cached.
  if (url.pathname.startsWith("/api/")) return;

  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const preloaded = await event.preloadResponse;
          if (preloaded) return preloaded;
          return await fetch(req);
        } catch {
          const offline = await caches.match(OFFLINE_URL, { cacheName: CACHE });
          return (
            offline ||
            new Response("You're offline.", { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8" } })
          );
        }
      })(),
    );
    return;
  }

  // Precached static icons: cache first. Everything else: browser default.
  if (PRECACHE.includes(url.pathname) && !url.search) {
    event.respondWith(caches.match(url.pathname, { cacheName: CACHE }).then((hit) => hit || fetch(req)));
  }
});

/* ── Push ──────────────────────────────────────────────────────────────── */

/** A same-origin path from the payload, or the default. Never another origin. */
function safeUrl(raw) {
  try {
    if (typeof raw !== "string" || !raw) return DEFAULT_URL;
    const u = new URL(raw, self.location.origin);
    if (u.origin !== self.location.origin) return DEFAULT_URL;
    // "//host" would be read as protocol-relative by openWindow.
    if (u.pathname.startsWith("//")) return DEFAULT_URL;
    return u.pathname + u.search + u.hash;
  } catch {
    return DEFAULT_URL;
  }
}

function str(v, max, fallback) {
  return typeof v === "string" && v.trim() ? v.slice(0, max) : fallback;
}

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    try {
      data = { body: event.data ? event.data.text() : "" };
    } catch {
      data = {};
    }
  }
  if (!data || typeof data !== "object") data = {};
  const title = str(data.title, 120, DEFAULT_TITLE);
  const tag = str(data.tag, 64, "p2plk");
  const options = {
    body: str(data.body, 500, "You have a new alert."),
    tag,
    renotify: true,
    icon: "/icon-192.png",
    badge: "/badge-96.png",
    timestamp: Date.now(),
    data: { url: safeUrl(data.url) },
  };
  // Always show something, even if the options are rejected by the platform.
  event.waitUntil(
    self.registration
      .showNotification(title, options)
      .catch(() => self.registration.showNotification(DEFAULT_TITLE, { body: options.body, data: options.data })),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const target = safeUrl(event.notification.data && event.notification.data.url);
  event.waitUntil(
    (async () => {
      const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      const same = all.filter((c) => {
        try {
          return new URL(c.url).origin === self.location.origin;
        } catch {
          return false;
        }
      });
      const exact = same.find((c) => new URL(c.url).pathname === new URL(target, self.location.origin).pathname);
      const client = exact || same[0];
      if (client) {
        await client.focus().catch(() => undefined);
        if (!exact && "navigate" in client) {
          await client.navigate(target).catch(() => client.postMessage({ type: "p2plk:navigate", url: target }));
        }
        return;
      }
      await self.clients.openWindow(target);
    })(),
  );
});

/* ── Subscription rotation ─────────────────────────────────────────────── */

function b64ToBytes(s) {
  const b64 = s.replace(/-/g, "+").replace(/_/g, "/");
  const bin = atob(b64 + "===".slice((b64.length + 3) % 4));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

async function currentKey(oldSub) {
  // Prefer the server's current key (it may have been rotated on purpose);
  // fall back to the key the old subscription used.
  try {
    const r = await fetch("/api/push/key", { cache: "no-store" });
    if (r.ok) {
      const j = await r.json();
      if (j && typeof j.publicKey === "string") return b64ToBytes(j.publicKey);
    }
  } catch {
    /* offline: use the old key */
  }
  return oldSub && oldSub.options ? oldSub.options.applicationServerKey : null;
}

self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const oldSub = event.oldSubscription || null;
      let sub = event.newSubscription || (await self.registration.pushManager.getSubscription());
      if (!sub) {
        const key = await currentKey(oldSub);
        if (!key) return;
        sub = await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      }
      await fetch("/api/push/rotate", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ oldEndpoint: oldSub ? oldSub.endpoint : null, subscription: sub.toJSON() }),
      });
    })().catch(() => undefined),
  );
});

/* ── Messages from the page ────────────────────────────────────────────── */

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "p2plk:version" && event.ports && event.ports[0]) {
    event.ports[0].postMessage({ version: VERSION });
  }
});
