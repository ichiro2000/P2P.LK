import { beforeAll, describe, expect, it } from "vitest";
import { b64urlEncode } from "./base64url";
import { classifyStatus, parseRetryAfter, sendPush, vapidProblem, type PushEnv } from "./send";
import { _resetVapidCache } from "./vapid";
import { isAllowedPushEndpoint, SubscriptionJson, deviceLabel } from "./subscription";

let env: PushEnv;
let sub: { endpoint: string; p256dh: string; auth: string };

beforeAll(async () => {
  _resetVapidCache();
  const vapid = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign"])) as CryptoKeyPair;
  env = {
    VAPID_PUBLIC_KEY: b64urlEncode(await crypto.subtle.exportKey("raw", vapid.publicKey)),
    VAPID_PRIVATE_KEY: (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d!,
    VAPID_SUBJECT: "mailto:alerts@p2p.lk",
  };
  const ua = (await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  sub = {
    endpoint: "https://fcm.googleapis.com/fcm/send/abc",
    p256dh: b64urlEncode(await crypto.subtle.exportKey("raw", ua.publicKey)),
    auth: b64urlEncode(crypto.getRandomValues(new Uint8Array(16))),
  };
});

const payload = { title: "t", body: "b", url: "/alerts", tag: "alerts" };
const opts = { ttl: 3600, urgency: "high" as const, topic: "alerts" };

describe("push response → action", () => {
  it.each([
    [201, "ok"],
    [200, "ok"],
    [202, "ok"],
    [404, "gone"],
    [410, "gone"],
    [413, "too_large"],
    [429, "retry"],
    [500, "retry"],
    [502, "retry"],
    [503, "retry"],
    [0, "retry"],
    [401, "auth"],
    [403, "auth"],
    [400, "rejected"],
  ])("HTTP %i → %s", (status, action) => {
    expect(classifyStatus(status)).toBe(action);
  });

  it("only 404/410 ever delete", () => {
    for (let s = 100; s < 600; s++) {
      if (classifyStatus(s) === "gone") expect([404, 410]).toContain(s);
    }
  });

  it("parses Retry-After seconds and dates", () => {
    expect(parseRetryAfter("120")).toBe(120);
    expect(parseRetryAfter(null)).toBeUndefined();
    expect(parseRetryAfter(new Date(1_000_000 + 30_000).toUTCString(), 1_000_000)).toBe(30);
  });
});

describe("sendPush", () => {
  it("POSTs the encrypted body with VAPID, TTL, Urgency and Topic", async () => {
    let seen: { url: string; init: RequestInit } | null = null;
    const r = await sendPush(sub, payload, env, opts, {
      fetch: async (url, init) => {
        seen = { url, init };
        return new Response(null, { status: 201 });
      },
    });
    expect(r).toEqual({ action: "ok", status: 201 });
    const h = seen!.init.headers as Record<string, string>;
    expect(seen!.url).toBe(sub.endpoint);
    expect(seen!.init.method).toBe("POST");
    expect(h.TTL).toBe("3600");
    expect(h.Urgency).toBe("high");
    expect(h.Topic).toBe("alerts");
    expect(h["Content-Encoding"]).toBe("aes128gcm");
    expect(h.Authorization).toMatch(new RegExp(`^vapid t=[\\w-]+\\.[\\w-]+\\.[\\w-]+, k=${env.VAPID_PUBLIC_KEY}$`));
    const body = seen!.init.body as Uint8Array;
    expect(body.length).toBeGreaterThan(86 + 16);
    expect(body.length).toBeLessThan(500); // small payload
  });

  it("maps failures without throwing, keeping Retry-After", async () => {
    const r429 = await sendPush(sub, payload, env, opts, {
      fetch: async () => new Response("slow down", { status: 429, headers: { "Retry-After": "90" } }),
    });
    expect(r429).toMatchObject({ action: "retry", status: 429, retryAfterSec: 90 });
    const r410 = await sendPush(sub, payload, env, opts, { fetch: async () => new Response("", { status: 410 }) });
    expect(r410).toMatchObject({ action: "gone", status: 410 });
    const net = await sendPush(sub, payload, env, opts, {
      fetch: async () => {
        throw new TypeError("fetch failed");
      },
    });
    expect(net).toMatchObject({ action: "retry", status: 0 });
    expect(net.error).toMatch(/network/);
  });

  it("refuses to send without VAPID keys (auth problem, nothing fetched)", async () => {
    let called = false;
    const r = await sendPush(sub, payload, {}, opts, {
      fetch: async () => {
        called = true;
        return new Response(null, { status: 201 });
      },
    });
    expect(called).toBe(false);
    expect(r.action).toBe("auth");
    expect(vapidProblem({})).toMatch(/not set/);
  });

  it("rejects an invalid Topic", async () => {
    await expect(sendPush(sub, payload, env, { ...opts, topic: "has space" })).rejects.toThrow(/topic/);
  });
});

describe("subscription validation", () => {
  it("accepts only real push services over https", () => {
    for (const ok of [
      "https://fcm.googleapis.com/fcm/send/x",
      "https://updates.push.services.mozilla.com/wpush/v2/x",
      "https://web.push.apple.com/QG1",
      "https://wns2-par02p.notify.windows.com/w/?token=x",
    ]) {
      expect(isAllowedPushEndpoint(ok), ok).toBe(true);
    }
    for (const bad of [
      "http://fcm.googleapis.com/fcm/send/x",
      "https://evil.com/fcm.googleapis.com",
      "https://fcm.googleapis.com.evil.com/x",
      "https://user:pw@fcm.googleapis.com/x",
      "https://fcm.googleapis.com:8443/x",
      "https://127.0.0.1/x",
      "not a url",
    ]) {
      expect(isAllowedPushEndpoint(bad), bad).toBe(false);
    }
  });

  it("checks the key lengths", () => {
    const good = { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } };
    expect(SubscriptionJson.safeParse(good).success).toBe(true);
    expect(SubscriptionJson.safeParse({ ...good, keys: { ...good.keys, auth: sub.p256dh } }).success).toBe(false);
    expect(SubscriptionJson.safeParse({ ...good, keys: { ...good.keys, p256dh: sub.auth } }).success).toBe(false);
  });

  it("labels devices", () => {
    expect(deviceLabel("Mozilla/5.0 (iPhone; CPU iPhone OS 17_4 like Mac OS X) AppleWebKit/605.1.15 Version/17.4 Mobile/15E148 Safari/604.1")).toBe("Safari on iPhone");
    expect(deviceLabel("Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36")).toBe("Chrome on Android");
    expect(deviceLabel(null)).toBe("Unknown device");
  });
});
