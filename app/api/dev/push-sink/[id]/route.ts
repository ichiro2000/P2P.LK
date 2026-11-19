import { NextResponse, type NextRequest } from "next/server";
import { getEnv } from "@/lib/db/client";
import { b64urlDecode, b64urlEncode, utf8 } from "@/lib/push/base64url";

/**
 * Local development only: a fake push service for the e2e tests. Endpoints
 * look like `http://localhost:3000/api/dev/push-sink/<status>-<anything>`
 * (lib/push/subscription.ts accepts them under `next dev` only). It checks
 * what a real push service checks (VAPID ES256 JWT for this audience, the
 * aes128gcm body, TTL/Urgency), records the request in KV (dev:push-sink) and
 * answers with <status> (201 when none), so 404/410/429/5xx handling can be
 * exercised end to end.
 *
 *   GET /api/dev/push-sink/all → { requests } newest first
 */

const KEY = "dev:push-sink";
const MAX = 30;

type SinkRecord = {
  id: string;
  at: string;
  status: number;
  ttl: string | null;
  urgency: string | null;
  topic: string | null;
  vapid: string;
  body: string;
};

function notFound() {
  return NextResponse.json({ error: "not found" }, { status: 404 });
}

async function verifyVapid(header: string | null, audience: string): Promise<string> {
  const m = /^vapid t=([\w-]+\.[\w-]+\.[\w-]+), k=([\w-]+)$/.exec(header ?? "");
  if (!m) return "missing or malformed vapid Authorization";
  const [h, c, s] = m[1].split(".");
  const key = await crypto.subtle.importKey("raw", b64urlDecode(m[2]), { name: "ECDSA", namedCurve: "P-256" }, false, [
    "verify",
  ]);
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, key, b64urlDecode(s), utf8(`${h}.${c}`));
  if (!ok) return "bad signature";
  const head = JSON.parse(new TextDecoder().decode(b64urlDecode(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(c)));
  const now = Date.now() / 1000;
  if (head.alg !== "ES256") return "alg";
  if (claims.aud !== audience) return `aud ${claims.aud}`;
  if (!(claims.exp > now && claims.exp <= now + 86400)) return "exp";
  if (!/^(mailto:|https:)/.test(claims.sub ?? "")) return "sub";
  return "ok";
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  if (process.env.NODE_ENV !== "development") return notFound();
  const { id } = await ctx.params;
  const vapid = await verifyVapid(req.headers.get("authorization"), "http://localhost:3000").catch(
    (e: Error) => `error ${e.message}`,
  );
  const body = new Uint8Array(await req.arrayBuffer());
  const wanted = Number(/^(\d{3})-/.exec(id)?.[1] ?? 201);
  const status =
    vapid !== "ok"
      ? 403
      : req.headers.get("content-encoding") !== "aes128gcm" || body.length < 86 + 17 || !req.headers.get("ttl")
        ? 400
        : wanted;
  const rec: SinkRecord = {
    id,
    at: new Date().toISOString(),
    status,
    ttl: req.headers.get("ttl"),
    urgency: req.headers.get("urgency"),
    topic: req.headers.get("topic"),
    vapid,
    body: b64urlEncode(body),
  };
  const kv = (await getEnv()).LIVE;
  const prev = ((await kv.get(KEY, "json")) as SinkRecord[] | null) ?? [];
  await kv.put(KEY, JSON.stringify([rec, ...prev].slice(0, MAX)));
  const headers: Record<string, string> = {};
  if (status === 429) headers["Retry-After"] = "120";
  return new NextResponse(status === 201 ? null : `sink ${status}`, { status, headers });
}

export async function GET() {
  if (process.env.NODE_ENV !== "development") return notFound();
  const kv = (await getEnv()).LIVE;
  return NextResponse.json(
    { requests: ((await kv.get(KEY, "json")) as SinkRecord[] | null) ?? [] },
    { headers: { "Cache-Control": "no-store" } },
  );
}
