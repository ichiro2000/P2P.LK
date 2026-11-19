import { utf8 } from "./base64url";
import { encryptPayload, PayloadTooLargeError } from "./encrypt";
import { validateVapidKeys, vapidAuthorization, type VapidKeys } from "./vapid";

/**
 * One Web Push request (RFC 8030) and the rule for what its response means.
 * No "server-only" marker: the cron (worker.ts bundle) sends pushes too.
 */

/** Worker bindings/secrets push needs. All optional so the cron's full env
 *  and the request env both fit; missing keys = push not configured. */
export type PushEnv = {
  VAPID_PUBLIC_KEY?: string;
  VAPID_PRIVATE_KEY?: string;
  VAPID_SUBJECT?: string;
  LIVE?: KVNamespace;
};

export type PushSubscriptionKeys = { endpoint: string; p256dh: string; auth: string };

/** Kept small: title, body, a same-origin path and a collapse tag. No
 *  account data — it passes through the browser vendor's push service. */
export type PushPayload = { title: string; body: string; url: string; tag: string };

export type PushOptions = {
  /** Seconds the push service may hold the message for an offline device. */
  ttl: number;
  urgency: "very-low" | "low" | "normal" | "high";
  /** Collapse key: a newer undelivered message with the same topic replaces
   *  the older one (RFC 8030 §5.4). ≤ 32 base64url characters. */
  topic?: string;
};

/** What to do with the subscription after a send. */
export type PushAction =
  | "ok" //         2xx: delivered to the push service
  | "gone" //       404/410: subscription is dead → delete it (the ONLY delete)
  | "too_large" //  413: payload too big → keep, shrink the payload
  | "retry" //      429/5xx/network/timeout → keep, count, back off
  | "auth" //       401/403: VAPID problem → keep, alert the admin
  | "rejected"; //  any other 4xx (malformed request: our bug) → keep, count

export type PushResult = {
  action: PushAction;
  /** HTTP status, or 0 for a network error / timeout. */
  status: number;
  /** Seconds, from a 429/503 Retry-After header. */
  retryAfterSec?: number;
  error?: string;
};

export function classifyStatus(status: number): PushAction {
  if (status >= 200 && status < 300) return "ok";
  if (status === 404 || status === 410) return "gone";
  if (status === 413) return "too_large";
  if (status === 401 || status === 403) return "auth";
  if (status === 429 || status >= 500 || status === 0) return "retry";
  return "rejected";
}

export function parseRetryAfter(v: string | null, nowMs = Date.now()): number | undefined {
  if (!v) return undefined;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0) return Math.round(n);
  const at = Date.parse(v);
  return Number.isFinite(at) ? Math.max(0, Math.round((at - nowMs) / 1000)) : undefined;
}

export function vapidFromEnv(env: PushEnv | null | undefined): VapidKeys | null {
  const k = {
    publicKey: (env?.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "").trim(),
    privateKey: (env?.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || "").trim(),
    subject: (env?.VAPID_SUBJECT || process.env.VAPID_SUBJECT || "").trim(),
  };
  return validateVapidKeys(k) ? null : k;
}

/** Why push is not configured, or null when it is. */
export function vapidProblem(env: PushEnv | null | undefined): string | null {
  return validateVapidKeys({
    publicKey: (env?.VAPID_PUBLIC_KEY || process.env.VAPID_PUBLIC_KEY || "").trim(),
    privateKey: (env?.VAPID_PRIVATE_KEY || process.env.VAPID_PRIVATE_KEY || "").trim(),
    subject: (env?.VAPID_SUBJECT || process.env.VAPID_SUBJECT || "").trim(),
  });
}

const TOPIC_RE = /^[A-Za-z0-9_-]{1,32}$/;
const SEND_TIMEOUT_MS = 10_000;

export type Fetcher = (input: string, init: RequestInit) => Promise<Response>;

export async function sendPush(
  sub: PushSubscriptionKeys,
  payload: PushPayload,
  env: PushEnv | null | undefined,
  opts: PushOptions,
  deps: { fetch?: Fetcher; nowSec?: number } = {},
): Promise<PushResult> {
  const vapid = vapidFromEnv(env);
  if (!vapid) return { action: "auth", status: 0, error: vapidProblem(env) ?? "VAPID not configured" };

  let body: Uint8Array<ArrayBuffer>;
  try {
    body = (await encryptPayload(utf8(JSON.stringify(payload)), { p256dh: sub.p256dh, auth: sub.auth })).body;
  } catch (err) {
    if (err instanceof PayloadTooLargeError) return { action: "too_large", status: 413, error: err.message };
    // Bad keys stored for this subscription: the browser handed us garbage.
    return { action: "rejected", status: 0, error: `encrypt: ${(err as Error).message}` };
  }

  const nowSec = deps.nowSec ?? Math.floor(Date.now() / 1000);
  const headers: Record<string, string> = {
    Authorization: await vapidAuthorization(vapid, sub.endpoint, nowSec),
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(Math.max(0, Math.floor(opts.ttl))),
    Urgency: opts.urgency,
  };
  if (opts.topic) {
    if (!TOPIC_RE.test(opts.topic)) throw new Error(`invalid push topic "${opts.topic}"`);
    headers.Topic = opts.topic;
  }

  const doFetch = deps.fetch ?? ((u, i) => fetch(u, i));
  let res: Response;
  try {
    res = await doFetch(sub.endpoint, {
      method: "POST",
      headers,
      body,
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
  } catch (err) {
    // Network error or timeout: never a reason to drop the device.
    return { action: "retry", status: 0, error: `network: ${(err as Error).message}`.slice(0, 300) };
  }
  const action = classifyStatus(res.status);
  if (action === "ok") {
    await res.body?.cancel().catch(() => undefined);
    return { action, status: res.status };
  }
  const text = await res.text().catch(() => "");
  return {
    action,
    status: res.status,
    retryAfterSec: parseRetryAfter(res.headers.get("retry-after")),
    error: `HTTP ${res.status}${text ? `: ${text.replace(/\s+/g, " ").slice(0, 200)}` : ""}`,
  };
}
