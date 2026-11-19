import { describe, expect, it } from "vitest";
import { b64urlDecode, b64urlEncode, concat, utf8 } from "./base64url";
import { encryptPayload, importP256Private, MAX_PLAINTEXT, PayloadTooLargeError } from "./encrypt";

/** RFC 8291 §5 + Appendix A, whitespace removed. */
const V = {
  plaintext: "When I grow up, I want to be a watermelon",
  asPublic: "BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  asPrivate: "yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw",
  uaPublic: "BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4",
  uaPrivate: "q1dXpw3UpT5VOmu_cf_v6ih07Aems3njxI-JWgLcM94",
  salt: "DGv6ra1nlYgDCS1FRnbzlw",
  authSecret: "BTBZMqHH6r4Tts7J_aSIgg",
  ecdhSecret: "kyrL1jIIOHEzg3sM2ZWRHDRB62YACZhhSlknJ672kSs",
  prkKey: "Snr3JMxaHVDXHWJn5wdC52WjpCtd2EIEGBykDcZW32k",
  keyInfo:
    "V2ViUHVzaDogaW5mbwAEJXGyvs3942BVGq8e0PTNNmwRzr5VX4m8t7GGpTM5FzFo7OLr4BhZe9MEebhuPI-OztV3ylkYfpJGmQ22ggCLDgT-M_SrDepxkU21WCP3O1SUj0EwbZIHMtu5pZpTKGSCIA5Zent7wmC6HCJ5mFgJkuk5cwAvMBKiiujwa7t45ewP",
  ikm: "S4lYMb_L0FxCeq0WhDx813KgSYqU26kOyzWUdsXYyrg",
  prk: "09_eUZGrsvxChDCGRCdkLiDXrReGOEVeSCdCcPBSJSc",
  cek: "oIhVW04MRdy2XN9CiKLxTg",
  nonce: "4h_95klXJ5E_qnoN",
  header:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8",
  ciphertext: "8pfeW0KbunFT06SuDKoJH9Ql87S1QUrdirN6GcG7sFz1y1sqLgVi1VhjVkHsUoEsbI_0LpXMuGvnzQ",
  body:
    "DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN",
};

const fixed = { asPrivate: b64urlDecode(V.asPrivate), asPublic: b64urlDecode(V.asPublic), salt: b64urlDecode(V.salt) };

/** Receiver side of RFC 8291 (what the browser does), for round trips. */
async function decrypt(body: Uint8Array<ArrayBuffer>, uaPrivate: Uint8Array, uaPublic: Uint8Array<ArrayBuffer>, auth: Uint8Array<ArrayBuffer>) {
  const s = crypto.subtle;
  const salt = body.slice(0, 16);
  const rs = new DataView(body.buffer, body.byteOffset).getUint32(16);
  const idlen = body[20];
  const asPublic = body.slice(21, 21 + idlen);
  const ct = body.slice(21 + idlen);
  const priv = await importP256Private(uaPrivate, uaPublic, "ECDH");
  const asKey = await s.importKey("raw", asPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await s.deriveBits({ name: "ECDH", public: asKey } as EcdhKeyDeriveParams, priv, 256));
  const hmac = async (k: Uint8Array<ArrayBuffer>, d: Uint8Array<ArrayBuffer>) =>
    new Uint8Array(await s.sign("HMAC", await s.importKey("raw", k, { name: "HMAC", hash: "SHA-256" }, false, ["sign"]), d));
  const prkKey = await hmac(auth, ecdh);
  const ikm = await hmac(prkKey, concat(utf8("WebPush: info\0"), uaPublic, asPublic, new Uint8Array([1])));
  const prk = await hmac(salt, ikm);
  const cek = (await hmac(prk, concat(utf8("Content-Encoding: aes128gcm\0"), new Uint8Array([1])))).slice(0, 16);
  const nonce = (await hmac(prk, concat(utf8("Content-Encoding: nonce\0"), new Uint8Array([1])))).slice(0, 12);
  const key = await s.importKey("raw", cek, "AES-GCM", false, ["decrypt"]);
  const padded = new Uint8Array(await s.decrypt({ name: "AES-GCM", iv: nonce, tagLength: 128 }, key, ct));
  let end = padded.length - 1;
  while (end >= 0 && padded[end] === 0) end--;
  expect(padded[end]).toBe(2); // last-record delimiter
  return { rs, text: new TextDecoder().decode(padded.slice(0, end)) };
}

describe("RFC 8291 aes128gcm encryption", () => {
  it("matches every Appendix A intermediate value and the §5 message body", async () => {
    const { body, trace } = await encryptPayload(utf8(V.plaintext), { p256dh: V.uaPublic, auth: V.authSecret }, fixed);
    expect(b64urlEncode(trace.ecdhSecret)).toBe(V.ecdhSecret);
    expect(b64urlEncode(trace.prkKey)).toBe(V.prkKey);
    expect(b64urlEncode(trace.keyInfo)).toBe(V.keyInfo);
    expect(b64urlEncode(trace.ikm)).toBe(V.ikm);
    expect(b64urlEncode(trace.prk)).toBe(V.prk);
    expect(b64urlEncode(trace.cek)).toBe(V.cek);
    expect(b64urlEncode(trace.nonce)).toBe(V.nonce);
    expect(b64urlEncode(trace.header)).toBe(V.header);
    expect(trace.header.length).toBe(86);
    expect(b64urlEncode(trace.ciphertext)).toBe(V.ciphertext);
    expect(b64urlEncode(body)).toBe(V.body);
  });

  it("the RFC receiver key decrypts the RFC body", async () => {
    const out = await decrypt(b64urlDecode(V.body), b64urlDecode(V.uaPrivate), b64urlDecode(V.uaPublic), b64urlDecode(V.authSecret));
    expect(out).toEqual({ rs: 4096, text: V.plaintext });
  });

  it("round-trips with a fresh random sender key and salt each time", async () => {
    const keys = { p256dh: V.uaPublic, auth: V.authSecret };
    const a = await encryptPayload(utf8('{"title":"x"}'), keys);
    const b = await encryptPayload(utf8('{"title":"x"}'), keys);
    expect(b64urlEncode(a.body)).not.toBe(b64urlEncode(b.body)); // new salt + key pair
    const out = await decrypt(a.body, b64urlDecode(V.uaPrivate), b64urlDecode(V.uaPublic), b64urlDecode(V.authSecret));
    expect(out.text).toBe('{"title":"x"}');
  });

  it("refuses payloads over the 4096-byte body limit and bad keys", async () => {
    const keys = { p256dh: V.uaPublic, auth: V.authSecret };
    await expect(encryptPayload(new Uint8Array(MAX_PLAINTEXT + 1), keys)).rejects.toBeInstanceOf(PayloadTooLargeError);
    const max = await encryptPayload(new Uint8Array(MAX_PLAINTEXT), keys);
    expect(max.body.length).toBe(4096);
    await expect(encryptPayload(utf8("x"), { p256dh: V.authSecret, auth: V.authSecret })).rejects.toThrow(/p256dh/);
    await expect(encryptPayload(utf8("x"), { p256dh: V.uaPublic, auth: V.uaPublic })).rejects.toThrow(/auth/);
  });
});
