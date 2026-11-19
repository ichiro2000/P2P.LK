import { b64urlDecode, b64urlEncode, utf8 } from "./base64url";
import { importP256Private } from "./encrypt";

/**
 * VAPID (RFC 8292): an ES256 JWT that identifies this server to the push
 * service, sent as `Authorization: vapid t=<jwt>, k=<public key>`.
 *
 * Keys are the usual web-push format: the public key is the 65-byte
 * uncompressed P-256 point, the private key the 32-byte scalar, both
 * base64url. Generate them ONCE with `npx tsx scripts/gen-vapid.ts`; every
 * browser subscription is bound to the public key, so changing it orphans
 * every device (see DEPLOY.md → Push notifications).
 */

export type VapidKeys = { publicKey: string; privateKey: string; subject: string };

/** JWTs live 12 h (the spec's maximum is 24 h); reused until 1 h before expiry. */
export const JWT_TTL_SEC = 12 * 3600;
const JWT_REUSE_MARGIN_SEC = 3600;

export function validateVapidKeys(k: Partial<VapidKeys>): string | null {
  if (!k.publicKey || !k.privateKey) return "VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY are not set";
  try {
    const pub = b64urlDecode(k.publicKey);
    if (pub.length !== 65 || pub[0] !== 4) return "VAPID_PUBLIC_KEY is not a 65-byte uncompressed P-256 key";
    if (b64urlDecode(k.privateKey).length !== 32) return "VAPID_PRIVATE_KEY is not a 32-byte P-256 key";
  } catch {
    return "VAPID keys are not valid base64url";
  }
  if (!k.subject || !/^(mailto:[^\s@]+@[^\s@]+|https:\/\/\S+)$/.test(k.subject)) {
    return "VAPID_SUBJECT must be a mailto: address or an https: URL";
  }
  return null;
}

const keyCache = new Map<string, Promise<CryptoKey>>();

function signingKey(k: VapidKeys): Promise<CryptoKey> {
  const id = `${k.publicKey}.${k.privateKey}`;
  let p = keyCache.get(id);
  if (!p) {
    p = importP256Private(b64urlDecode(k.privateKey), b64urlDecode(k.publicKey), "ECDSA");
    // A failed import must not be cached forever.
    p.catch(() => keyCache.delete(id));
    keyCache.set(id, p);
  }
  return p;
}

/** The push service's origin, which is the JWT audience. */
export function audienceOf(endpoint: string): string {
  return new URL(endpoint).origin;
}

export async function signVapidJwt(k: VapidKeys, audience: string, nowSec: number): Promise<string> {
  const header = b64urlEncode(utf8(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(utf8(JSON.stringify({ aud: audience, exp: nowSec + JWT_TTL_SEC, sub: k.subject })));
  const input = `${header}.${claims}`;
  // Web Crypto's ECDSA output is already JOSE's raw r||s (64 bytes).
  const sig = await globalThis.crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, await signingKey(k), utf8(input));
  return `${input}.${b64urlEncode(sig)}`;
}

const jwtCache = new Map<string, { jwt: string; exp: number }>();

/** `Authorization` header value for one endpoint. JWTs are cached per
 *  audience + key, so a tick that pushes to many FCM devices signs once. */
export async function vapidAuthorization(k: VapidKeys, endpoint: string, nowSec: number): Promise<string> {
  const aud = audienceOf(endpoint);
  const id = `${aud}|${k.publicKey}|${k.subject}`;
  const hit = jwtCache.get(id);
  let jwt: string;
  if (hit && hit.exp - JWT_REUSE_MARGIN_SEC > nowSec) {
    jwt = hit.jwt;
  } else {
    jwt = await signVapidJwt(k, aud, nowSec);
    jwtCache.set(id, { jwt, exp: nowSec + JWT_TTL_SEC });
  }
  return `vapid t=${jwt}, k=${k.publicKey}`;
}

/** Test helper: forget cached JWTs/keys. */
export function _resetVapidCache() {
  jwtCache.clear();
  keyCache.clear();
}
