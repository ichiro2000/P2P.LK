import { randomBytes, webcrypto } from "node:crypto";
import type { APIRequestContext } from "@playwright/test";
import { b64urlDecode, b64urlEncode, concat, utf8 } from "../../../lib/push/base64url";
import { importP256Private } from "../../../lib/push/encrypt";

/**
 * A fake browser push subscription whose endpoint is the dev push sink
 * (app/api/dev/push-sink). The sink answers with the status in the path
 * (`/201-…`, `/410-…`, `/429-…`), and we hold the receiver keys, so a
 * test can decrypt exactly what the server sent.
 */
export type FakeSub = {
  endpoint: string;
  json: { endpoint: string; expirationTime: null; keys: { p256dh: string; auth: string } };
  decrypt: (bodyB64: string) => Promise<unknown>;
};

const subtle = webcrypto.subtle as unknown as SubtleCrypto;

export async function fakeSubscription(status = 201): Promise<FakeSub> {
  const pair = (await subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"])) as CryptoKeyPair;
  const pub = new Uint8Array(await subtle.exportKey("raw", pair.publicKey));
  const d = b64urlDecode((await subtle.exportKey("jwk", pair.privateKey)).d!);
  const auth = new Uint8Array(randomBytes(16));
  const endpoint = `http://localhost:3000/api/dev/push-sink/${status}-${randomBytes(6).toString("hex")}`;
  return {
    endpoint,
    json: { endpoint, expirationTime: null, keys: { p256dh: b64urlEncode(pub), auth: b64urlEncode(auth) } },
    decrypt: async (bodyB64) => {
      const body = b64urlDecode(bodyB64);
      const salt = body.slice(0, 16);
      const idlen = body[20];
      const asPublic = body.slice(21, 21 + idlen);
      const priv = await importP256Private(d, pub, "ECDH");
      const asKey = await subtle.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
      const ecdh = new Uint8Array(await subtle.deriveBits({ name: "ECDH", public: asKey } as EcdhKeyDeriveParams, priv, 256));
      const hmac = async (k: Uint8Array<ArrayBuffer>, m: Uint8Array<ArrayBuffer>) =>
        new Uint8Array(
          await subtle.sign("HMAC", await subtle.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), m),
        );
      const ikm = await hmac(await hmac(auth, ecdh), concat(utf8("WebPush: info\0"), pub, asPublic, new Uint8Array([1])));
      const prk = await hmac(salt, ikm);
      const cek = (await hmac(prk, concat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
      const nonce = (await hmac(prk, concat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
      const key = await subtle.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
      const plain = new Uint8Array(await subtle.decrypt({ name: "AES-GCM", iv: nonce }, key, body.slice(21 + idlen)));
      let end = plain.length - 1;
      while (end >= 0 && plain[end] === 0) end--;
      if (plain[end] !== 2) throw new Error("missing last-record delimiter");
      return JSON.parse(new TextDecoder().decode(plain.slice(0, end)));
    },
  };
}

export type SinkRecord = {
  id: string;
  status: number;
  ttl: string | null;
  urgency: string | null;
  topic: string | null;
  vapid: string;
  body: string;
};

/** Requests the sink received for one fake endpoint, newest first. */
export async function sinkRequests(request: APIRequestContext, endpoint: string): Promise<SinkRecord[]> {
  const id = endpoint.split("/").pop()!;
  const res = await request.get("/api/dev/push-sink/all");
  const { requests } = (await res.json()) as { requests: SinkRecord[] };
  return requests.filter((r) => r.id === id);
}
