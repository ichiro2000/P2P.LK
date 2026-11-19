import { beforeEach, describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, utf8 } from "./base64url";
import { _resetVapidCache, audienceOf, JWT_TTL_SEC, signVapidJwt, validateVapidKeys, vapidAuthorization } from "./vapid";

async function newKeys() {
  const pair = (await crypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, true, ["sign", "verify"])) as CryptoKeyPair;
  const jwk = await crypto.subtle.exportKey("jwk", pair.privateKey);
  const publicKey = b64urlEncode(await crypto.subtle.exportKey("raw", pair.publicKey));
  return { publicKey, privateKey: jwk.d!, subject: "mailto:alerts@p2p.lk", verifyKey: pair.publicKey };
}

const decodeJson = (s: string) => JSON.parse(new TextDecoder().decode(b64urlDecode(s)));

describe("VAPID JWT (RFC 8292, ES256)", () => {
  beforeEach(() => _resetVapidCache());

  it("has the right header, claims and a verifiable raw r||s signature", async () => {
    const k = await newKeys();
    const now = 1_800_000_000;
    const jwt = await signVapidJwt(k, "https://fcm.googleapis.com", now);
    const [h, c, sig] = jwt.split(".");
    expect(decodeJson(h)).toEqual({ typ: "JWT", alg: "ES256" });
    const claims = decodeJson(c);
    expect(claims).toEqual({ aud: "https://fcm.googleapis.com", exp: now + JWT_TTL_SEC, sub: "mailto:alerts@p2p.lk" });
    expect(claims.exp - now).toBeLessThanOrEqual(24 * 3600); // spec maximum
    const raw = b64urlDecode(sig);
    expect(raw.length).toBe(64); // JOSE format, not DER
    const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, k.verifyKey, raw, utf8(`${h}.${c}`));
    expect(ok).toBe(true);
  });

  it("builds `vapid t=…, k=…` with the endpoint origin as audience and reuses the JWT", async () => {
    const k = await newKeys();
    const ep = "https://fcm.googleapis.com/fcm/send/abc:def";
    expect(audienceOf(ep)).toBe("https://fcm.googleapis.com");
    const a = await vapidAuthorization(k, ep, 1000);
    expect(a).toMatch(/^vapid t=[\w-]+\.[\w-]+\.[\w-]+, k=[\w-]+$/);
    expect(a.endsWith(`, k=${k.publicKey}`)).toBe(true);
    expect(await vapidAuthorization(k, ep + "x", 1000 + 60)).toBe(a); // cached for the same audience
    const later = await vapidAuthorization(k, ep, 1000 + JWT_TTL_SEC);
    expect(later).not.toBe(a); // re-signed near expiry
    const other = await vapidAuthorization(k, "https://web.push.apple.com/abc", 1000);
    expect(decodeJson(other.split("t=")[1].split(".")[1]).aud).toBe("https://web.push.apple.com");
  });

  it("validates key formats and the subject", async () => {
    const k = await newKeys();
    expect(validateVapidKeys(k)).toBeNull();
    expect(validateVapidKeys({ ...k, publicKey: "" })).toMatch(/not set/);
    expect(validateVapidKeys({ ...k, publicKey: k.privateKey })).toMatch(/65-byte/);
    expect(validateVapidKeys({ ...k, privateKey: k.publicKey })).toMatch(/32-byte/);
    expect(validateVapidKeys({ ...k, subject: "alerts@p2p.lk" })).toMatch(/mailto/);
    expect(validateVapidKeys({ ...k, subject: "https://p2p.lk" })).toBeNull();
  });
});
