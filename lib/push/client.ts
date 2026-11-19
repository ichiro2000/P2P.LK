import { b64urlDecode, bytesEqual } from "./base64url";
import { isIosNow, isStandaloneNow, pushSupportedNow, storage } from "@/lib/pwa/platform";

/**
 * Browser side of Web Push: enable / disable on this device, the self-heal
 * that runs on every app open and focus, and a tiny store for
 * useSyncExternalStore. Client only.
 *
 * Why notifications "stop after a few days" elsewhere, and what this file
 * does about each (see also public/sw.js and DEPLOY.md):
 *   - the browser rotated or dropped the subscription → `syncPush()` on every
 *     open/focus re-subscribes and re-registers it (and refreshes
 *     last_seen_at on the server);
 *   - the server lost it (DB restore, 410 cleanup of a stale copy) → the
 *     sync POST re-creates it (unless the member removed this device);
 *   - the VAPID key changed → the stored subscription's key no longer
 *     matches the server's → unsubscribe + subscribe with the new key;
 *   - permission was revoked → the server copy is removed.
 */

export type PushStatus =
  | "loading"
  | "unsupported" //   no Push API (old browser, or iOS outside the Home Screen app)
  | "ios-install" //   iOS/iPadOS Safari tab: must Add to Home Screen first
  | "unconfigured" //  server has no VAPID keys
  | "denied" //        notifications blocked in browser settings
  | "off" //           supported, not subscribed on this device
  | "on"; //           subscribed and registered on the server

export type PushSnapshot = { status: PushStatus; deviceId: string | null; error: string | null };

const LOADING: PushSnapshot = { status: "loading", deviceId: null, error: null };
/** Per-device opt-in + this device's server id ("This device" in the list). */
export const LOCAL_KEY = "p2plk.push.v1";
type Local = { on: boolean; id: string | null };

let snapshot: PushSnapshot = LOADING;
const listeners = new Set<() => void>();

function set(next: Partial<PushSnapshot>) {
  const s = { ...snapshot, ...next };
  if (s.status !== snapshot.status || s.deviceId !== snapshot.deviceId || s.error !== snapshot.error) {
    snapshot = s;
    for (const l of listeners) l();
  }
}

export function subscribePush(onChange: () => void) {
  listeners.add(onChange);
  return () => listeners.delete(onChange);
}
export const getPushSnapshot = () => snapshot;
export const getPushServerSnapshot = () => LOADING;

function readLocal(): Local {
  try {
    const v = JSON.parse(storage.get(LOCAL_KEY) ?? "null") as Partial<Local> | null;
    return { on: v?.on === true, id: typeof v?.id === "string" ? v.id : null };
  } catch {
    return { on: false, id: null };
  }
}
function writeLocal(v: Local | null) {
  storage.set(LOCAL_KEY, v ? JSON.stringify(v) : null);
}

export type SubscribeResponse = { status: "created" | "known" | "removed" | "gone"; id?: string; publicKey?: string };

/* ── Pure decisions (unit-tested) ─────────────────────────────────────── */

export type HealInput = {
  permission: NotificationPermission;
  hasSub: boolean;
  /** The member turned push on for this device earlier. */
  optedIn: boolean;
};

export type HealAction =
  | "none"
  | "drop" //       permission gone but a subscription lingers → remove it everywhere
  | "post" //       re-register the existing subscription (refreshes last_seen_at)
  | "subscribe"; // opted in, permission granted, but no subscription → make one

/** Step 1 of the self-heal: what to do before talking to the server. */
export function healAction(s: HealInput): HealAction {
  if (s.permission !== "granted") return s.hasSub ? "drop" : "none";
  if (s.hasSub) return "post";
  return s.optedIn ? "subscribe" : "none";
}

export type AfterSync =
  | "ok" //      registered; nothing else to do
  | "rekey" //   the subscription uses an old VAPID key → unsubscribe, subscribe with the new one
  | "forget" //  the member removed this device → unsubscribe here, stop syncing
  | "replace"; // the push service reported it dead → new subscription

/** Step 2: what the server's answer means. `keyMatch` compares the
 *  subscription's applicationServerKey with the server's current key. */
export function afterSync(status: SubscribeResponse["status"], keyMatch: boolean | null): AfterSync {
  if (status === "removed") return "forget";
  if (status === "gone") return "replace";
  return keyMatch === false ? "rekey" : "ok";
}

/** Compares a subscription's applicationServerKey with a base64url key. */
export function keyMatches(subKey: ArrayBuffer | null | undefined, publicKey: string): boolean | null {
  if (!subKey) return null;
  try {
    return bytesEqual(new Uint8Array(subKey), b64urlDecode(publicKey));
  } catch {
    return null;
  }
}

/* ── Network ──────────────────────────────────────────────────────────── */

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    credentials: "same-origin",
  });
  const json = (await r.json().catch(() => ({}))) as T & { error?: string };
  if (!r.ok) throw new HttpError(r.status, json.error ?? `Request failed (HTTP ${r.status}).`);
  return json;
}

async function serverKey(): Promise<string | null> {
  try {
    return (await api<{ publicKey: string }>("/api/push/key")).publicKey;
  } catch (err) {
    if (err instanceof HttpError && err.status === 503) return null;
    throw err;
  }
}

async function registration(timeoutMs = 10_000): Promise<ServiceWorkerRegistration> {
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing?.active) return existing;
  if (!existing) await navigator.serviceWorker.register("/sw.js", { scope: "/", updateViaCache: "none" });
  return Promise.race([
    navigator.serviceWorker.ready,
    new Promise<never>((_, rej) => setTimeout(() => rej(new Error("Service worker didn't start.")), timeoutMs)),
  ]);
}

function postSub(sub: PushSubscription, mode: "enable" | "sync") {
  return api<SubscribeResponse>("/api/me/push/subscribe", { subscription: sub.toJSON(), mode });
}

async function freshSubscribe(reg: ServiceWorkerRegistration, publicKey: string): Promise<PushSubscription> {
  return reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64urlDecode(publicKey) });
}

async function dropLocal(sub: PushSubscription | null) {
  if (sub) await sub.unsubscribe().catch(() => false);
}

/* ── Status probe ─────────────────────────────────────────────────────── */

function baseStatus(): PushStatus | null {
  if (!pushSupportedNow()) return isIosNow() && !isStandaloneNow() ? "ios-install" : "unsupported";
  if (Notification.permission === "denied") return "denied";
  return null;
}

/* ── Public API ───────────────────────────────────────────────────────── */

let inflight: Promise<void> | null = null;

/**
 * Self-heal. Runs on every app open and on focus (throttled by the caller);
 * safe to call any time, never throws, never prompts.
 */
export function syncPush(): Promise<void> {
  if (!inflight) inflight = doSync().finally(() => (inflight = null));
  return inflight;
}

async function doSync(): Promise<void> {
  const base = baseStatus();
  const local = readLocal();
  if (base === "unsupported" || base === "ios-install") return set({ status: base, deviceId: null });
  // Whether this browser holds a subscription right now (for the status
  // shown if a later step fails, e.g. offline).
  let haveSub = false;
  try {
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    haveSub = !!sub;
    const action = healAction({ permission: Notification.permission, hasSub: !!sub, optedIn: local.on });

    if (action === "drop") {
      if (sub) await api("/api/me/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
      await dropLocal(sub);
      if (Notification.permission === "denied") writeLocal(null);
      return set({ status: base ?? "off", deviceId: null, error: null });
    }
    if (action === "none") return set({ status: base ?? "off", deviceId: null, error: null });

    if (action === "subscribe") {
      const key = await serverKey();
      if (!key) return set({ status: "unconfigured", deviceId: null });
      sub = await freshSubscribe(reg, key);
      haveSub = true;
    }

    let res = await postSub(sub!, "sync");
    const next = afterSync(res.status, res.publicKey ? keyMatches(sub!.options.applicationServerKey, res.publicKey) : null);
    if (next === "forget") {
      await dropLocal(sub);
      writeLocal(null);
      return set({ status: "off", deviceId: null, error: null });
    }
    if (next === "rekey" || next === "replace") {
      const key = res.publicKey ?? (await serverKey());
      if (next === "rekey") await api("/api/me/push/unsubscribe", { endpoint: sub!.endpoint }).catch(() => undefined);
      await dropLocal(sub);
      haveSub = false;
      if (!key) return set({ status: "unconfigured", deviceId: null });
      sub = await freshSubscribe(reg, key);
      res = await postSub(sub, "enable");
    }
    writeLocal({ on: true, id: res.id ?? local.id });
    set({ status: "on", deviceId: res.id ?? local.id, error: null });
  } catch (err) {
    if (err instanceof HttpError && (err.status === 401 || err.status === 403)) {
      // Signed out / not approved: leave the device as it is.
      return set({ status: base ?? (haveSub ? "on" : "off"), error: null });
    }
    if (err instanceof HttpError && err.status === 503) return set({ status: "unconfigured", deviceId: null });
    set({ status: base ?? (haveSub ? "on" : "off"), error: (err as Error).message || "Couldn't check notifications." });
  }
}

/** "Enable notifications" (call from a click handler: it may prompt). */
export async function enablePush(): Promise<{ ok: true } | { ok: false; error: string }> {
  const base = baseStatus();
  if (base === "unsupported") return { ok: false, error: "This browser can't show notifications." };
  if (base === "ios-install") return { ok: false, error: "Add P2P.LK to your Home Screen first, then open it from there." };
  try {
    // Ask first, inside the user gesture (iOS requires it).
    const permission = Notification.permission === "granted" ? "granted" : await Notification.requestPermission();
    if (permission !== "granted") {
      set({ status: permission === "denied" ? "denied" : "off" });
      return { ok: false, error: permission === "denied" ? "Notifications are blocked for this site." : "Permission wasn't granted." };
    }
    const key = await serverKey();
    if (!key) {
      set({ status: "unconfigured" });
      return { ok: false, error: "Notifications aren't set up on the server yet." };
    }
    const reg = await registration();
    let sub = await reg.pushManager.getSubscription();
    if (sub && keyMatches(sub.options.applicationServerKey, key) === false) {
      await dropLocal(sub);
      sub = null;
    }
    sub ??= await freshSubscribe(reg, key);
    const res = await postSub(sub, "enable");
    writeLocal({ on: true, id: res.id ?? null });
    set({ status: "on", deviceId: res.id ?? null, error: null });
    return { ok: true };
  } catch (err) {
    const msg = (err as Error).message || "Couldn't turn on notifications.";
    set({ error: msg });
    return { ok: false, error: msg };
  }
}

/** "Turn off on this device", and explicit sign-out. Never throws. */
export async function disablePush(): Promise<void> {
  writeLocal(null);
  if (!pushSupportedNow()) return;
  try {
    const reg = await navigator.serviceWorker.getRegistration("/");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await api("/api/me/push/unsubscribe", { endpoint: sub.endpoint }).catch(() => undefined);
      await dropLocal(sub);
    }
  } catch {
    /* best effort */
  }
  set({ status: baseStatus() ?? "off", deviceId: null, error: null });
}

/** This device's server id, if push is on here. */
export function thisDeviceId(): string | null {
  return snapshot.deviceId ?? readLocal().id;
}

/** After this device was removed from the list on this device. */
export async function forgetThisDevice(): Promise<void> {
  await disablePush();
}
