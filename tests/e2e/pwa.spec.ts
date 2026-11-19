import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { chromium, type APIRequestContext } from "@playwright/test";
import { apiSignIn } from "./support/auth";
import { expect, memberTest, test } from "./support/fixtures";
import { fakeSubscription, sinkRequests } from "./support/push";
import { createUser, deleteUser } from "./support/users";
import { q, sql } from "./support/db";

/**
 * Installability (manifest, service worker, offline page) and Web Push
 * (member APIs, guards, the server's send path, the notifications card).
 *
 * Push is verified two ways:
 *   - always: against the dev push sink (app/api/dev/push-sink), which checks
 *     the VAPID JWT and the aes128gcm body like a real push service and
 *     answers with any status, so the 404/410/429 rules run end to end;
 *   - live (desktop project, when Google Chrome is installed): a real Chrome
 *     subscribes to Firebase Cloud Messaging, the server sends a test push,
 *     FCM answers 201 and the service worker shows the notification.
 */

/* ── Installability ───────────────────────────────────────────────────── */

test("manifest is valid and its icons load", async ({ request }) => {
  const res = await request.get("/manifest.webmanifest");
  expect(res.status()).toBe(200);
  const m = await res.json();
  expect(m).toMatchObject({ id: "/", scope: "/", display: "standalone", short_name: "P2P.LK" });
  expect(m.name).toBeTruthy();
  expect(m.start_url).toMatch(/^\/\?source=pwa$/);
  expect(m.theme_color).toMatch(/^#/);
  expect(m.background_color).toMatch(/^#/);
  const sizes = m.icons.map((i: { sizes: string }) => i.sizes);
  expect(sizes).toEqual(expect.arrayContaining(["192x192", "512x512"]));
  expect(m.icons.some((i: { purpose?: string }) => i.purpose === "maskable")).toBe(true);
  for (const icon of [...m.icons, { src: "/badge-96.png" }, { src: "/apple-icon.png" }]) {
    const r = await request.get(icon.src);
    expect(r.status(), icon.src).toBe(200);
    expect(r.headers()["content-type"], icon.src).toContain("image/png");
  }
  expect(m.shortcuts.map((s: { short_name: string }) => s.short_name)).toEqual(["Markets", "Rates", "Alerts"]);
  for (const s of m.shortcuts) expect(s.url).toMatch(/^\/(rates|alerts)?\?source=pwa-shortcut$/);
});

test("iOS meta tags and the service worker's headers", async ({ request }) => {
  const html = await (await request.get("/rates")).text();
  expect(html).toMatch(/<meta name="mobile-web-app-capable" content="yes"/);
  expect(html).toMatch(/<meta name="apple-mobile-web-app-title" content="P2P.LK"/);
  expect(html).toMatch(/<meta name="apple-mobile-web-app-status-bar-style" content="default"/);
  expect(html).toMatch(/<link rel="apple-touch-icon"/);
  expect(html).toMatch(/viewport-fit=cover/);
  const sw = await request.get("/sw.js");
  expect(sw.status()).toBe(200);
  expect(sw.headers()["content-type"]).toContain("javascript");
  expect(sw.headers()["cache-control"]).toBe("no-cache");
  expect(sw.headers()["service-worker-allowed"]).toBe("/");
});

test("the service worker controls the page and serves the offline page", async ({ page, context, consoleErrors }) => {
  await page.goto("/rates");
  await page.waitForFunction(() => !!navigator.serviceWorker?.controller, null, { timeout: 30_000 });
  // Only the offline page and icons are cached; never a page or an API answer.
  const cached = await page.evaluate(async () => {
    const out: string[] = [];
    for (const k of await caches.keys()) {
      for (const r of await (await caches.open(k)).keys()) out.push(new URL(r.url).pathname);
    }
    return out.sort();
  });
  expect(cached).toEqual(["/badge-96.png", "/icon-192.png", "/icon-512.png", "/icon-maskable-512.png", "/offline.html"]);

  await context.setOffline(true);
  try {
    await page.goto("/historical");
    await expect(page.getByRole("heading", { level: 1, name: "You're offline" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Try again" })).toBeVisible();
  } finally {
    await context.setOffline(false);
  }
  // Offline sub-requests the browser itself reports are expected here.
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !/ERR_INTERNET_DISCONNECTED/.test(e)));
  await page.goto("/rates");
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
});

/* ── Guards ───────────────────────────────────────────────────────────── */

const ROUTES: [method: "get" | "post", path: string, body?: unknown][] = [
  ["get", "/api/me/push"],
  ["post", "/api/me/push/subscribe", { subscription: {}, mode: "enable" }],
  ["post", "/api/me/push/unsubscribe", { id: "x" }],
  ["post", "/api/me/push/test", {}],
];

test("push member APIs: 401 for guests", async ({ request }) => {
  for (const [method, url, data] of ROUTES) {
    const res = await request[method](url, data ? { data } : undefined);
    expect(res.status(), `${method} ${url}`).toBe(401);
    expect(res.headers()["cache-control"]).toContain("no-store");
  }
});

test("push member APIs: 403 for a pending account", async ({ playwright }) => {
  test.skip(test.info().project.name !== "desktop", "one project is enough (sign-in rate limit)");
  const user = await createUser({ tag: "pushpending", status: "pending_review" });
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    await apiSignIn(request, user);
    for (const [method, url, data] of ROUTES) {
      const res = await request[method](url, data ? { data } : undefined);
      expect(res.status(), `${method} ${url}`).toBe(403);
    }
  } finally {
    await request.dispose();
    deleteUser(user.email);
  }
});

/* ── Server send path (dev push sink) ─────────────────────────────────── */

async function subscribe(request: APIRequestContext, json: unknown, mode: "enable" | "sync" = "enable") {
  return request.post("/api/me/push/subscribe", { data: { subscription: json, mode } });
}

memberTest.describe("push API", () => {
  memberTest.skip(({ isMobile }) => isMobile, "API-only: desktop project");

  memberTest("subscribe → list → send test → the push service gets a valid encrypted push", async ({ page, member }) => {
    const req = page.request;
    const sub = await fakeSubscription(201);
    const created = await subscribe(req, sub.json);
    expect(created.status()).toBe(201);
    const { id, status, publicKey } = await created.json();
    expect(status).toBe("created");
    expect(publicKey).toMatch(/^[\w-]{87}$/);

    // Same endpoint again = upsert (refreshes last_seen_at), no duplicate.
    const again = await subscribe(req, sub.json, "sync");
    expect(again.status()).toBe(200);
    expect((await again.json()).status).toBe("known");
    const list = await (await req.get("/api/me/push")).json();
    expect(list.devices.filter((d: { id: string }) => d.id === id)).toHaveLength(1);
    expect(list.max).toBe(10);

    const test1 = await req.post("/api/me/push/test", { data: { id } });
    expect(test1.status()).toBe(200);
    expect((await test1.json()).results).toEqual([{ id, ok: true, status: 201, action: "ok" }]);

    const [rec] = await sinkRequests(req, sub.endpoint);
    expect(rec).toMatchObject({ status: 201, vapid: "ok", ttl: "300", urgency: "high", topic: "test" });
    expect(await sub.decrypt(rec.body)).toEqual({
      title: "P2P.LK test notification",
      body: "Notifications work on this device. Your alerts will arrive like this.",
      url: "/alerts",
      tag: "test",
    });
    const row = sql<{ last_success_at: number | null; failure_count: number }>(
      `select last_success_at, failure_count from push_subscriptions where id = ${q(id)} and user_id = ${q(member.id)}`,
    )[0];
    expect(row.last_success_at).toBeGreaterThan(0);
    expect(row.failure_count).toBe(0);
    await req.post("/api/me/push/unsubscribe", { data: { id } });
  });

  memberTest("410 deletes the device; a later background sync of it is refused as gone", async ({ page }) => {
    const req = page.request;
    const sub = await fakeSubscription(410);
    const { id } = await (await subscribe(req, sub.json)).json();
    const res = await (await req.post("/api/me/push/test", { data: { id } })).json();
    expect(res.results).toEqual([{ id, ok: false, status: 410, action: "gone" }]);
    expect(sql(`select id from push_subscriptions where id = ${q(id)}`)).toHaveLength(0);
    const sync = await subscribe(req, sub.json, "sync");
    expect((await sync.json()).status).toBe("gone");
    // The member pressing "Enable" again always works.
    expect((await (await subscribe(req, sub.json, "enable")).json()).status).toBe("created");
    await req.post("/api/me/push/unsubscribe", { data: { endpoint: sub.endpoint } });
  });

  memberTest("429 and 5xx keep the device, count the failure and back off", async ({ page }) => {
    const req = page.request;
    for (const status of [429, 503]) {
      const sub = await fakeSubscription(status);
      const { id } = await (await subscribe(req, sub.json)).json();
      const res = await (await req.post("/api/me/push/test", { data: { id } })).json();
      expect(res.results[0]).toMatchObject({ ok: false, status, action: "retry" });
      const row = sql<{ failure_count: number; next_attempt_at: number; last_error: string }>(
        `select failure_count, next_attempt_at, last_error from push_subscriptions where id = ${q(id)}`,
      )[0];
      expect(row.failure_count).toBe(1);
      // 429 carries Retry-After: 120 from the sink; 503 → the 60 s first step.
      const wait = row.next_attempt_at - Math.floor(Date.now() / 1000);
      expect(wait).toBeGreaterThan(status === 429 ? 100 : 40);
      expect(wait).toBeLessThanOrEqual(status === 429 ? 120 : 60);
      expect(row.last_error).toContain(String(status));
      await req.post("/api/me/push/unsubscribe", { data: { id } });
    }
    const log = sql<{ ok: number; error: string }>(
      `select ok, error from ingest_runs where job = 'push' and error like '1 failed: 503%' order by id desc limit 1`,
    )[0];
    expect(log.ok).toBe(0);
    expect(parseInt(log.error, 10)).toBe(1);
  });

  memberTest("a removed device can't re-sync itself back; rotation keeps the owner without a session", async ({ page, playwright }) => {
    const req = page.request;
    const sub = await fakeSubscription(201);
    const { id } = await (await subscribe(req, sub.json)).json();
    expect((await (await req.post("/api/me/push/unsubscribe", { data: { id } })).json()).removed).toBe(true);
    expect((await (await subscribe(req, sub.json, "sync")).json()).status).toBe("removed");

    // pushsubscriptionchange: the service worker posts old + new, maybe signed out.
    const a = await fakeSubscription(201);
    const b = await fakeSubscription(201);
    const { id: aid } = await (await subscribe(req, a.json)).json();
    // No cookies: the service worker may run after the session expired.
    const anon = await playwright.request.newContext({
      baseURL: "http://localhost:3000",
      storageState: { cookies: [], origins: [] },
    });
    try {
      const unknown = await anon.post("/api/push/rotate", { data: { oldEndpoint: b.endpoint, subscription: a.json } });
      expect(unknown.status()).toBe(404);
      const rot = await anon.post("/api/push/rotate", { data: { oldEndpoint: a.endpoint, subscription: b.json } });
      expect(rot.status()).toBe(200);
      expect((await rot.json()).status).toBe("rotated");
    } finally {
      await anon.dispose();
    }
    const rows = sql<{ id: string; endpoint: string }>(`select id, endpoint from push_subscriptions where id = ${q(aid)}`);
    expect(rows).toEqual([{ id: aid, endpoint: b.endpoint }]);
    await req.post("/api/me/push/unsubscribe", { data: { id: aid } });
  });

  memberTest("rejects other hosts and caps devices at 10", async ({ page }) => {
    const req = page.request;
    const good = await fakeSubscription(201);
    const evil = await subscribe(req, { ...good.json, endpoint: "https://evil.example/push" });
    expect(evil.status()).toBe(400);
    const ids: string[] = [];
    // Other tests in this worker share the member: fill up to the cap.
    const { devices } = await (await req.get("/api/me/push")).json();
    for (let i = devices.length; i < 10; i++) {
      const s = await fakeSubscription(201);
      const r = await subscribe(req, s.json);
      expect(r.status()).toBe(201);
      ids.push((await r.json()).id);
    }
    const over = await subscribe(req, good.json);
    expect(over.status()).toBe(409);
    expect((await over.json()).limit).toBe(true);
    for (const id of ids) await req.post("/api/me/push/unsubscribe", { data: { id } });
  });
});

/* ── Notifications card (browser push stubbed to the sink) ───────────── */

/** Chromium in Playwright has no push service (FCM keys) and headless
 *  reports notification permission as denied, so the browser's PushManager
 *  is replaced with one that hands out a dev-sink subscription. Everything
 *  from there on (client logic, API, encryption, VAPID, send) is real. */
const STUB_PUSH = () => {
  const SINK = `${location.origin}/api/dev/push-sink/201-ui${Math.random().toString(36).slice(2, 10)}`;
  type Sub = PushSubscription & { toJSON(): PushSubscriptionJSON };
  let current: Sub | null = null;
  const b64u = (buf: ArrayBuffer) =>
    btoa(String.fromCharCode(...new Uint8Array(buf))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  Object.defineProperty(Notification, "permission", { get: () => "granted", configurable: true });
  Notification.requestPermission = async () => "granted";
  PushManager.prototype.getSubscription = async () => current;
  PushManager.prototype.subscribe = async (opts?: PushSubscriptionOptionsInit) => {
    const pair = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
    const p256dh = b64u(await crypto.subtle.exportKey("raw", pair.publicKey));
    const auth = b64u(crypto.getRandomValues(new Uint8Array(16)).buffer);
    const k = opts!.applicationServerKey as Uint8Array;
    const key = k.buffer.slice(k.byteOffset, k.byteOffset + k.byteLength);
    current = {
      endpoint: SINK,
      expirationTime: null,
      options: { userVisibleOnly: true, applicationServerKey: key },
      toJSON: () => ({ endpoint: SINK, expirationTime: null, keys: { p256dh, auth } }),
      unsubscribe: async () => ((current = null), true),
    } as unknown as Sub;
    return current;
  };
};

memberTest("notifications card: enable, send test, turn off", async ({ page }) => {
  await page.addInitScript(STUB_PUSH);
  await page.goto("/alerts");
  const card = page.getByTestId("push-card");
  await expect(card.getByTestId("push-status")).toHaveText("Off");
  await card.getByRole("button", { name: "Enable notifications" }).click();
  await expect(card.getByTestId("push-status")).toHaveText("On");
  const devices = page.getByTestId("push-devices");
  await expect(devices.getByText("This device")).toBeVisible();

  const sent = page.waitForResponse((r) => r.url().endsWith("/api/me/push/test") && r.request().method() === "POST");
  await card.getByRole("button", { name: "Send test" }).click();
  const res = await (await sent).json();
  expect(res.results).toHaveLength(1);
  expect(res.results[0]).toMatchObject({ ok: true, status: 201 });
  await expect(page.getByText("Test sent. It should appear in a few seconds.")).toBeVisible();
  await expect(devices.getByText(/Last delivered/)).toBeVisible();

  await card.getByRole("button", { name: "Turn off here" }).click();
  await expect(card.getByTestId("push-status")).toHaveText("Off");
  await expect(page.getByText("No devices yet.")).toBeVisible();
});

/* ── Live: real Chrome → FCM ──────────────────────────────────────────── */

const CHROME = "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

memberTest("live: Chrome subscribes to FCM, FCM accepts the push (201) and the notification shows", async ({ member }) => {
  memberTest.skip(test.info().project.name !== "desktop", "desktop project only");
  memberTest.skip(!fs.existsSync(CHROME), "Google Chrome not installed");
  memberTest.setTimeout(240_000);

  // A fresh profile with notifications pre-allowed for the dev origin
  // (Playwright's bundled Chromium has no FCM credentials).
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "p2plk-push-"));
  fs.mkdirSync(path.join(dir, "Default"));
  fs.writeFileSync(
    path.join(dir, "Default", "Preferences"),
    JSON.stringify({ profile: { content_settings: { exceptions: { notifications: { "http://localhost:3000,*": { setting: 1 } } } } } }),
  );
  const port = 9300 + Math.floor(Math.random() * 500);
  const proc = spawn(CHROME, [`--user-data-dir=${dir}`, `--remote-debugging-port=${port}`, "--headless=new", "--no-first-run", "--no-default-browser-check", "about:blank"], { stdio: "ignore" });
  try {
    let browser: Awaited<ReturnType<typeof chromium.connectOverCDP>> | null = null;
    for (let i = 0; i < 30 && !browser; i++) {
      browser = await chromium.connectOverCDP(`http://127.0.0.1:${port}`).catch(() => null);
      if (!browser) await new Promise((r) => setTimeout(r, 300));
    }
    expect(browser, "Chrome DevTools endpoint").toBeTruthy();
    const ctx = browser!.contexts()[0];
    await ctx.addCookies(JSON.parse(fs.readFileSync(member.statePath, "utf8")).cookies);
    const page = await ctx.newPage();
    await page.goto("http://localhost:3000/alerts");
    const card = page.getByTestId("push-card");
    await card.getByRole("button", { name: "Enable notifications" }).click();
    // FCM registration in a fresh profile can take a while under load.
    await expect(card.getByTestId("push-status")).toHaveText("On", { timeout: 90_000 });
    const endpoint = await page.evaluate(async () => (await (await navigator.serviceWorker.ready).pushManager.getSubscription())?.endpoint);
    expect(endpoint).toMatch(/^https:\/\/fcm\.googleapis\.com\//);

    const res = await page.evaluate(async () => {
      const r = await fetch("/api/me/push/test", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      return (await r.json()) as { results: unknown[] };
    });
    expect(res.results).toEqual([expect.objectContaining({ ok: true, status: 201, action: "ok" })]);

    // FCM delivers it back to this Chrome; the service worker shows it.
    await expect
      .poll(
        () =>
          page.evaluate(async () =>
            (await (await navigator.serviceWorker.ready).getNotifications()).map((n) => `${n.title}|${n.tag}|${JSON.stringify(n.data)}`),
          ),
        { timeout: 45_000 },
      )
      .toContain('P2P.LK test notification|test|{"url":"/alerts"}');
    await browser!.close().catch(() => undefined);
  } finally {
    if (proc.exitCode === null) {
      const exited = new Promise((r) => proc.once("exit", r));
      proc.kill();
      await Promise.race([exited, new Promise((r) => setTimeout(r, 5000))]);
    }
    fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 300 });
  }
});
