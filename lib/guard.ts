import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { getEnv } from "@/lib/db/client";
import { adminFromRequest } from "@/lib/auth/session";

/**
 * Request guards shared by every API route: per-IP rate limits (Workers Rate
 * Limiting bindings), JSON body validation (zod), Cloudflare Turnstile, and
 * the admin gate. Each returns either the value or a ready Response, so
 * routes read as:
 *
 *   const limited = await rateLimit(req, "write"); if (limited) return limited;
 */

const NO_STORE = { "Cache-Control": "no-store" };

export function jsonError(status: number, error: string, extra?: Record<string, unknown>) {
  return NextResponse.json({ error, ...extra }, { status, headers: NO_STORE });
}

/** The caller's address. On Cloudflare `cf-connecting-ip` is set by the
 *  edge and can't be forged; `x-forwarded-for` is client-controlled, so it's
 *  only read under `next dev` (no Cloudflare in front). */
function rawClientIp(req: NextRequest): string {
  return (
    req.headers.get("cf-connecting-ip") ??
    (process.env.NODE_ENV === "development"
      ? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim()
      : undefined) ??
    "local"
  );
}

/** Rate-limit key for an address. IPv6 is keyed by its /64: one subscriber
 *  normally holds a whole /64, so per-address keys could be rotated at will
 *  (the same rule Better Auth's own limiter uses). */
export function ipKey(ip: string): string {
  if (!ip.includes(":")) return ip;
  const mapped = /^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/i.exec(ip);
  if (mapped) return mapped[1];
  const [head, tail, extra] = ip.toLowerCase().split("::");
  if (extra !== undefined) return ip;
  const left = head ? head.split(":") : [];
  const right = tail !== undefined ? (tail ? tail.split(":") : []) : null;
  const groups = right ? [...left, ...Array(Math.max(0, 8 - left.length - right.length)).fill("0"), ...right] : left;
  if (groups.length !== 8 || !groups.every((g) => /^[0-9a-f]{1,4}$/.test(g))) return ip;
  return `${groups.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, "")).join(":")}::/64`;
}

export function clientIp(req: NextRequest): string {
  return ipKey(rawClientIp(req));
}

type Bucket = "read" | "write" | "admin";
const BINDING = { read: "RL_READ", write: "RL_WRITE", admin: "RL_ADMIN" } as const;

/** Returns a 429 Response when the caller is over the limit, else null.
 *  Fails open if the binding is missing or errors — a limiter outage must not
 *  take the site down. */
export async function rateLimit(
  req: NextRequest,
  bucket: Bucket,
  /** Separate allowance within a bucket, so e.g. QR checks can't use up the
   *  removal-request allowance. */
  scope = "default",
): Promise<NextResponse | null> {
  try {
    const env = await getEnv();
    const limiter = env[BINDING[bucket]];
    if (!limiter) return null;
    const { success } = await limiter.limit({ key: `${bucket}:${scope}:${clientIp(req)}` });
    if (success) return null;
  } catch (err) {
    console.warn(`[guard] rate limiter ${bucket} unavailable: ${(err as Error).message}`);
    return null;
  }
  return NextResponse.json(
    { error: "Too many requests — please wait a minute and try again." },
    { status: 429, headers: { ...NO_STORE, "Retry-After": "60" } },
  );
}

/** Parse + validate a JSON body. Rejects non-JSON content types so a plain
 *  cross-site <form> post can't reach the handler. */
export async function readJson<S extends z.ZodType>(
  req: NextRequest,
  schema: S,
): Promise<{ ok: true; data: z.infer<S> } | { ok: false; res: NextResponse }> {
  const ct = req.headers.get("content-type") ?? "";
  if (!ct.toLowerCase().startsWith("application/json")) {
    return { ok: false, res: jsonError(415, "Expected an application/json body.") };
  }
  const text = await readBodyText(req, 16_384);
  if (text === null) return { ok: false, res: jsonError(413, "Request body too large.") };
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, res: jsonError(400, "Invalid JSON body.") };
  }
  return validate(schema, raw);
}

/**
 * The request body as text, or null once it passes `maxBytes`. Reads the
 * stream itself: `Content-Length` alone isn't enough, because a chunked
 * request has none and `req.json()` would buffer and parse all of it.
 */
export async function readBodyText(req: NextRequest, maxBytes: number): Promise<string | null> {
  if (Number(req.headers.get("content-length") ?? 0) > maxBytes) return null;
  if (!req.body) return "";
  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > maxBytes) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    chunks.push(value);
  }
  const buf = new Uint8Array(size);
  let off = 0;
  for (const c of chunks) {
    buf.set(c, off);
    off += c.byteLength;
  }
  return new TextDecoder().decode(buf);
}

export function validate<S extends z.ZodType>(
  schema: S,
  raw: unknown,
): { ok: true; data: z.infer<S> } | { ok: false; res: NextResponse } {
  const parsed = schema.safeParse(raw);
  if (parsed.success) return { ok: true, data: parsed.data };
  const issue = parsed.error.issues[0];
  const field = issue?.path.join(".") || "input";
  return {
    ok: false,
    res: jsonError(400, `${field}: ${issue?.message ?? "invalid"}`, {
      issues: parsed.error.issues.map((i) => ({ path: i.path.join("."), message: i.message })),
    }),
  };
}

/** Validate URL search params against an object schema. */
export function readQuery<S extends z.ZodType>(req: NextRequest, schema: S) {
  return validate(schema, Object.fromEntries(req.nextUrl.searchParams));
}

/** Admin gate: a signed-in account with the admin role (the old shared
 *  admin secret is gone). Rate-limited per IP. */
export async function requireAdmin(req: NextRequest): Promise<NextResponse | null> {
  const limited = await rateLimit(req, "admin");
  if (limited) return limited;
  if (await adminFromRequest(req).catch(() => null)) return null;
  return jsonError(403, "Admins only — sign in with an admin account.");
}

function siteHostname(env: CloudflareEnv | null): string | null {
  const base = env?.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL;
  try {
    return base ? new URL(base).hostname : null;
  } catch {
    return null;
  }
}

/** Cloudflare's always-pass test secret, used only in development. */
const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";

/**
 * Verify a Turnstile token server-side. Fails closed in production when no
 * secret is configured; in development falls back to the test secret.
 */
export async function verifyTurnstile(
  req: NextRequest,
  token: string | null | undefined,
): Promise<NextResponse | null> {
  const env = await getEnv().catch(() => null);
  const secret =
    env?.TURNSTILE_SECRET_KEY ||
    process.env.TURNSTILE_SECRET_KEY ||
    (process.env.NODE_ENV === "development" ? TURNSTILE_TEST_SECRET : "");
  if (!secret) return jsonError(503, "Bot protection is not configured on this server.");
  if (!token) return jsonError(403, "Please complete the human check and try again.");
  try {
    const body = new FormData();
    body.append("secret", secret);
    body.append("response", token);
    body.append("remoteip", rawClientIp(req));
    const r = await fetch("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      body,
    });
    const json = (await r.json()) as { success?: boolean; hostname?: string };
    // A token solved on another site with our site key doesn't count. The
    // test secret reports "example.com", so only checked outside development.
    if (json.success && (process.env.NODE_ENV === "development" || json.hostname === siteHostname(env))) {
      return null;
    }
  } catch (err) {
    console.warn(`[guard] turnstile verify failed: ${(err as Error).message}`);
    return jsonError(503, "Couldn't verify the human check — please try again.");
  }
  return jsonError(403, "Human check failed — please try again.");
}

/** Common field shapes. */
export const zText = (max: number) =>
  z
    .string()
    .trim()
    .max(max, `must be at most ${max} characters`)
    .transform((s) => s || null)
    .nullish()
    .transform((v) => v ?? null);

export const zRequiredText = (max: number, message: string) =>
  z.string({ error: message }).trim().min(1, message).max(max, `must be at most ${max} characters`);
