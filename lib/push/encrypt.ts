import { b64urlDecode, b64urlEncode, concat, utf8 } from "./base64url";

/**
 * Web Push message encryption, RFC 8291 ("aes128gcm", RFC 8188), on Web
 * Crypto only — no Node APIs, so it runs in the Workers cron and in Next
 * route handlers alike. Verified against the RFC 8291 Appendix A vectors in
 * encrypt.test.ts.
 *
 *   ecdh_secret = ECDH(as_private, ua_public)
 *   PRK_key     = HMAC(auth_secret, ecdh_secret)
 *   IKM         = HMAC(PRK_key, "WebPush: info" 0x00 ua_public as_public 0x01)
 *   PRK         = HMAC(salt, IKM)
 *   CEK         = HMAC(PRK, "Content-Encoding: aes128gcm" 0x00 0x01)[0..16]
 *   NONCE       = HMAC(PRK, "Content-Encoding: nonce" 0x00 0x01)[0..12]
 *   body        = salt(16) rs(4) idlen(1)=65 as_public(65)
 *                 AES-128-GCM(CEK, NONCE, plaintext 0x02)
 */

export const RECORD_SIZE = 4096;
/** Push services must accept a 4096-byte body: 86 header + 16 tag + 1
 *  delimiter leave 3993 bytes of plaintext. Our payloads are ~300 bytes. */
export const MAX_PLAINTEXT = 4096 - 86 - 16 - 1;

export class PayloadTooLargeError extends Error {
  constructor(size: number) {
    super(`push payload is ${size} bytes (max ${MAX_PLAINTEXT})`);
    this.name = "PayloadTooLargeError";
  }
}

const subtle = () => globalThis.crypto.subtle;

async function hmac(key: Uint8Array<ArrayBuffer>, data: Uint8Array<ArrayBuffer>): Promise<Uint8Array<ArrayBuffer>> {
  const k = await subtle().importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return new Uint8Array(await subtle().sign("HMAC", k, data));
}

/** Uncompressed P-256 point (0x04 || X || Y) → JWK x/y. */
export function pointToXY(pub: Uint8Array): { x: string; y: string } {
  if (pub.length !== 65 || pub[0] !== 0x04) throw new Error("expected a 65-byte uncompressed P-256 public key");
  return { x: b64urlEncode(pub.slice(1, 33)), y: b64urlEncode(pub.slice(33, 65)) };
}

/** A P-256 private key from its raw 32-byte scalar plus the public point. */
export async function importP256Private(
  d: Uint8Array,
  pub: Uint8Array,
  alg: "ECDH" | "ECDSA",
): Promise<CryptoKey> {
  if (d.length !== 32) throw new Error("expected a 32-byte P-256 private key");
  const jwk: JsonWebKey = { kty: "EC", crv: "P-256", d: b64urlEncode(d), ...pointToXY(pub), ext: true };
  return subtle().importKey(
    "jwk",
    jwk,
    { name: alg, namedCurve: "P-256" },
    false,
    alg === "ECDH" ? ["deriveBits"] : ["sign"],
  );
}

export type EncryptKeys = {
  /** Subscription `keys.p256dh` (base64url, 65 bytes). */
  p256dh: string;
  /** Subscription `keys.auth` (base64url, 16 bytes). */
  auth: string;
};

/** Test hook: fixed sender key pair + salt (RFC vectors). Production
 *  always generates a fresh key pair and salt per message. */
export type EncryptFixed = {
  asPrivate: Uint8Array<ArrayBuffer>;
  asPublic: Uint8Array<ArrayBuffer>;
  salt: Uint8Array<ArrayBuffer>;
};

export type EncryptTrace = {
  ecdhSecret: Uint8Array;
  prkKey: Uint8Array;
  keyInfo: Uint8Array;
  ikm: Uint8Array;
  prk: Uint8Array;
  cek: Uint8Array;
  nonce: Uint8Array;
  header: Uint8Array;
  ciphertext: Uint8Array;
};

export async function encryptPayload(
  plaintext: Uint8Array<ArrayBuffer>,
  keys: EncryptKeys,
  fixed?: EncryptFixed,
): Promise<{ body: Uint8Array<ArrayBuffer>; trace: EncryptTrace }> {
  if (plaintext.length > MAX_PLAINTEXT) throw new PayloadTooLargeError(plaintext.length);
  const uaPublic = b64urlDecode(keys.p256dh);
  const authSecret = b64urlDecode(keys.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("invalid p256dh key");
  if (authSecret.length !== 16) throw new Error("invalid auth secret");

  let asPrivateKey: CryptoKey;
  let asPublic: Uint8Array<ArrayBuffer>;
  let salt: Uint8Array<ArrayBuffer>;
  if (fixed) {
    asPrivateKey = await importP256Private(fixed.asPrivate, fixed.asPublic, "ECDH");
    asPublic = fixed.asPublic;
    salt = fixed.salt;
  } else {
    const pair = (await subtle().generateKey({ name: "ECDH", namedCurve: "P-256" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;
    asPrivateKey = pair.privateKey;
    asPublic = new Uint8Array(await subtle().exportKey("raw", pair.publicKey));
    salt = globalThis.crypto.getRandomValues(new Uint8Array(16));
  }

  const uaKey = await subtle().importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdhSecret = new Uint8Array(
    await subtle().deriveBits({ name: "ECDH", public: uaKey } as EcdhKeyDeriveParams, asPrivateKey, 256),
  );

  const prkKey = await hmac(authSecret, ecdhSecret);
  const keyInfo = concat(utf8("WebPush: info\0"), uaPublic, asPublic);
  const ikm = await hmac(prkKey, concat(keyInfo, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);

  const header = new Uint8Array(16 + 4 + 1 + asPublic.length);
  header.set(salt, 0);
  new DataView(header.buffer).setUint32(16, RECORD_SIZE, false);
  header[20] = asPublic.length;
  header.set(asPublic, 21);

  const aes = await subtle().importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const ciphertext = new Uint8Array(
    await subtle().encrypt(
      { name: "AES-GCM", iv: nonce, tagLength: 128 },
      aes,
      // Single (last) record: plaintext, then the 0x02 delimiter, no padding.
      concat(plaintext, new Uint8Array([2])),
    ),
  );

  return {
    body: concat(header, ciphertext),
    trace: { ecdhSecret, prkKey, keyInfo, ikm, prk, cek, nonce, header, ciphertext },
  };
}
