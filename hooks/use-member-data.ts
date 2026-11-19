"use client";

import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import { toast } from "sonner";
import { authClient } from "@/lib/auth/client";
import {
  alertRules as guestRules,
  favouriteMerchants,
  savedFilters,
  useStorageValue,
  watchlistMarkets,
  STORAGE_KEYS,
  type MarketRef,
  type MerchantRef,
  type SavedFilter,
} from "@/lib/storage";
import type { AlertEventRow, AlertRuleRow, AlertType, UserItemKind } from "@/lib/db/schema";
import type { ExchangeId } from "@/lib/exchanges/types";

/**
 * One client data layer for the workspace, blocklist and alerts.
 *
 *   member (approved / admin) → /api/me/* (D1), synced across devices
 *   guest  (signed out, pending) → lib/storage.ts (this browser)
 *
 * Components call the hooks below and don't care which. Member data lives in
 * a small module store (useSyncExternalStore): one shared fetch per kind,
 * optimistic writes, refetch on failure. The session decides the mode; if
 * the API answers 401/403 (session cache lagging a suspension, say) the
 * store drops back to guest mode for that user.
 */

/* ── Shapes the UI sees ──────────────────────────────────────────────── */

export type WatchMarket = { key: string; asset: string; fiat: string; addedAt: string };
export type FavMerchant = {
  key: string;
  exchange: ExchangeId | null;
  id: string;
  name: string;
  asset?: string;
  fiat?: string;
  addedAt: string;
};
export type BlockedMerchant = FavMerchant & { exchange: ExchangeId; reason?: string };
export type Filter = { id: string; label: string; path: string; search: string; createdAt: string };
export type MemberRule = AlertRuleRow;
export type MemberEvent = AlertEventRow;
export type MerchantInput = { exchange: ExchangeId; id: string; name: string; asset?: string; fiat?: string };

type ServerItem = { kind: UserItemKind; itemKey: string; data: Record<string, unknown>; createdAt: number };

/* ── Mode ─────────────────────────────────────────────────────────────── */

export type MemberMode = "loading" | "member" | "guest";

type SessionUser = { id: string; status?: string | null; role?: string | null };

/* ── Module store ─────────────────────────────────────────────────────── */

type SlotKey = UserItemKind | "rules" | "events";
type Slot = {
  status: "idle" | "loading" | "ready" | "error";
  rows: readonly unknown[];
  unread: number;
};

const IDLE: Slot = Object.freeze({ status: "idle", rows: Object.freeze([]), unread: 0 }) as Slot;
const slots = new Map<string, Slot>();
const denied = new Set<string>();
const inflight = new Map<string, Promise<void>>();
const listeners = new Set<() => void>();

/** Users the server has confirmed as members on this page load. Covers the
 *  session cookie cache lagging a fresh approval by up to a minute. */
const serverMembers = new Set<string>();

const sk = (uid: string, key: SlotKey) => `${uid}|${key}`;
const emit = () => listeners.forEach((l) => l());
function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}
const getSlot = (uid: string | null, key: SlotKey) => (uid ? (slots.get(sk(uid, key)) ?? IDLE) : IDLE);
function setSlot(uid: string, key: SlotKey, patch: Partial<Slot>) {
  slots.set(sk(uid, key), { ...getSlot(uid, key), ...patch });
  emit();
}

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

async function api<T>(method: string, url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, {
    method,
    cache: "no-store",
    credentials: "same-origin",
    headers: body !== undefined ? { "content-type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const json = (await res.json().catch(() => ({}))) as { error?: string } & T;
  if (!res.ok) throw new ApiError(res.status, json.error ?? `Request failed (${res.status})`);
  return json;
}

const URLS: Record<SlotKey, string> = {
  market: "/api/me/items?kind=market",
  merchant: "/api/me/items?kind=merchant",
  blocked_merchant: "/api/me/items?kind=blocked_merchant",
  filter: "/api/me/items?kind=filter",
  rules: "/api/me/rules",
  events: "/api/me/events?limit=200",
};

function handleAuthError(uid: string, err: unknown) {
  if (err instanceof ApiError && (err.status === 401 || err.status === 403)) {
    denied.add(uid);
    emit();
    return true;
  }
  return false;
}

/** Fetch a slot once (shared by every hook instance); `force` refetches. */
function load(uid: string, key: SlotKey, force = false): Promise<void> {
  const id = sk(uid, key);
  const cur = getSlot(uid, key);
  if (!force && (cur.status === "ready" || cur.status === "error")) return Promise.resolve();
  const running = inflight.get(id);
  if (running) return running;
  if (cur.status === "idle") setSlot(uid, key, { status: "loading" });
  const p = api<{ items?: ServerItem[]; rules?: MemberRule[]; events?: MemberEvent[]; unread?: number }>(
    "GET",
    URLS[key],
  )
    .then((json) => {
      const rows = (key === "rules" ? json.rules : key === "events" ? json.events : json.items) ?? [];
      setSlot(uid, key, { status: "ready", rows, unread: json.unread ?? 0 });
    })
    .catch((err) => {
      if (!handleAuthError(uid, err)) setSlot(uid, key, { status: "error" });
    })
    .finally(() => inflight.delete(id));
  inflight.set(id, p);
  return p;
}

/** Refetch every loaded slot for this user (after an import, say). */
export function invalidateMemberData(uid: string) {
  for (const id of [...slots.keys()]) {
    if (!id.startsWith(`${uid}|`)) continue;
    void load(uid, id.slice(uid.length + 1) as SlotKey, true);
  }
}

/** Optimistic write: apply `next` now, run `req`, refetch on failure. */
async function mutate<T>(
  uid: string,
  key: SlotKey,
  next: ((s: Slot) => Partial<Slot>) | null,
  req: () => Promise<T>,
): Promise<T | null> {
  if (next) setSlot(uid, key, next(getSlot(uid, key)));
  try {
    return await req();
  } catch (err) {
    if (!handleAuthError(uid, err)) {
      toast.error(err instanceof Error ? err.message : "Couldn't save that change.");
    }
    void load(uid, key, true);
    return null;
  }
}

/* ── Hooks: mode + slot ───────────────────────────────────────────────── */

/** Who is using the app, as far as the client can tell. */
export function useMemberMode(): { mode: MemberMode; isMember: boolean; userId: string | null } {
  const { data, isPending } = authClient.useSession();
  const user = (data?.user ?? null) as SessionUser | null;
  const hinted = useSyncExternalStore(
    subscribe,
    () => (user ? serverMembers.has(user.id) : false),
    () => false,
  );
  const sessionMember = !!user && (user.status === "approved" || user.role === "admin" || hinted);
  const isDenied = useSyncExternalStore(
    subscribe,
    () => (user ? denied.has(user.id) : false),
    () => false,
  );
  const mode: MemberMode = isPending && !data ? "loading" : sessionMember && !isDenied ? "member" : "guest";
  return { mode, isMember: mode === "member", userId: mode === "member" ? user!.id : null };
}

/** Server pages that already checked membership call this (via
 *  <MemberHint>) so the client agrees without waiting for the session cache. */
export function hintServerMember(uid: string) {
  if (serverMembers.has(uid)) return;
  serverMembers.add(uid);
  denied.delete(uid);
  emit();
}

function useSlot(uid: string | null, key: SlotKey): Slot {
  const slot = useSyncExternalStore(
    subscribe,
    () => getSlot(uid, key),
    () => IDLE,
  );
  useEffect(() => {
    if (uid) void load(uid, key);
  }, [uid, key]);
  return slot;
}

const EMPTY_MARKETS: MarketRef[] = [];
const EMPTY_MERCHANTS: MerchantRef[] = [];
const EMPTY_FILTERS: SavedFilter[] = [];
const iso = (sec: number) => new Date(sec * 1000).toISOString();
const str = (v: unknown) => (typeof v === "string" ? v : undefined);

/* ── Watchlist (markets) ──────────────────────────────────────────────── */

export function useWatchlist() {
  const { mode, userId } = useMemberMode();
  const guest = useStorageValue(() => watchlistMarkets.list(), [STORAGE_KEYS.markets], EMPTY_MARKETS);
  const slot = useSlot(userId, "market");

  const items = useMemo<WatchMarket[]>(() => {
    if (mode === "loading") return [];
    if (userId) {
      return (slot.rows as ServerItem[]).map((r) => ({
        key: r.itemKey,
        asset: str(r.data.asset) ?? r.itemKey.split("/")[0],
        fiat: str(r.data.fiat) ?? r.itemKey.split("/")[1],
        addedAt: iso(r.createdAt),
      }));
    }
    return guest.map((m) => ({ key: `${m.asset}/${m.fiat}`, asset: m.asset, fiat: m.fiat, addedAt: m.addedAt }));
  }, [mode, userId, slot.rows, guest]);

  const keys = useMemo(() => new Set(items.map((i) => i.key)), [items]);
  const has = useCallback(
    (asset: string, fiat: string) => keys.has(`${asset.toUpperCase()}/${fiat.toUpperCase()}`),
    [keys],
  );

  /** Returns the new state (true = now on the watchlist). */
  const toggle = useCallback(
    (asset: string, fiat: string): boolean => {
      const a = asset.toUpperCase();
      const f = fiat.toUpperCase();
      const key = `${a}/${f}`;
      if (!userId) return watchlistMarkets.toggle(a, f);
      const on = !keys.has(key);
      if (on) {
        const row: ServerItem = { kind: "market", itemKey: key, data: { asset: a, fiat: f }, createdAt: now() };
        void mutate(userId, "market", (s) => ({ rows: [row, ...s.rows] }), () =>
          api("POST", "/api/me/items", { kind: "market", data: { asset: a, fiat: f } }),
        );
      } else {
        void mutate(
          userId,
          "market",
          (s) => ({ rows: (s.rows as ServerItem[]).filter((r) => r.itemKey !== key) }),
          () => api("DELETE", `/api/me/items?kind=market&key=${encodeURIComponent(key)}`),
        );
      }
      return on;
    },
    [userId, keys],
  );

  const remove = useCallback(
    (asset: string, fiat: string) => {
      if (has(asset, fiat)) toggle(asset, fiat);
    },
    [has, toggle],
  );

  return { mode, items, has, toggle, remove, ready: mode === "guest" || slot.status === "ready" };
}

const now = () => Math.floor(Date.now() / 1000);

/* ── Merchants: favourites + blocklist ────────────────────────────────── */

function toMerchant(r: ServerItem): BlockedMerchant {
  const [ex, ...rest] = r.itemKey.split(":");
  return {
    key: r.itemKey,
    exchange: (str(r.data.exchange) ?? ex) as ExchangeId,
    id: str(r.data.id) ?? rest.join(":"),
    name: str(r.data.name) ?? "Unknown",
    asset: str(r.data.asset),
    fiat: str(r.data.fiat),
    reason: str(r.data.reason),
    addedAt: iso(r.createdAt),
  };
}

const mKey = (exchange: ExchangeId, id: string) => `${exchange}:${id}`;

export function useFavouriteMerchants() {
  const { mode, userId } = useMemberMode();
  const guest = useStorageValue(() => favouriteMerchants.list(), [STORAGE_KEYS.merchants], EMPTY_MERCHANTS);
  const slot = useSlot(userId, "merchant");

  const items = useMemo<FavMerchant[]>(() => {
    if (mode === "loading") return [];
    if (userId) return (slot.rows as ServerItem[]).map(toMerchant);
    return guest.map((m) => ({
      key: m.exchange ? mKey(m.exchange as ExchangeId, m.id) : m.id,
      exchange: (m.exchange as ExchangeId | undefined) ?? null,
      id: m.id,
      name: m.name,
      asset: m.asset,
      fiat: m.fiat,
      addedAt: m.addedAt,
    }));
  }, [mode, userId, slot.rows, guest]);

  const has = useCallback(
    (exchange: ExchangeId, id: string) => items.some((m) => m.id === id && (m.exchange == null || m.exchange === exchange)),
    [items],
  );

  const remove = useCallback(
    (m: Pick<FavMerchant, "exchange" | "id">) => {
      if (!userId) return favouriteMerchants.remove(m.id);
      const key = mKey(m.exchange ?? "binance", m.id);
      void mutate(
        userId,
        "merchant",
        (s) => ({ rows: (s.rows as ServerItem[]).filter((r) => r.itemKey !== key) }),
        () => api("DELETE", `/api/me/items?kind=merchant&key=${encodeURIComponent(key)}`),
      );
    },
    [userId],
  );

  const toggle = useCallback(
    (m: MerchantInput): boolean => {
      if (!userId) return favouriteMerchants.toggle(m);
      if (has(m.exchange, m.id)) {
        remove(m);
        return false;
      }
      const data = { exchange: m.exchange, id: m.id, name: m.name, asset: m.asset, fiat: m.fiat };
      const row: ServerItem = { kind: "merchant", itemKey: mKey(m.exchange, m.id), data, createdAt: now() };
      void mutate(userId, "merchant", (s) => ({ rows: [row, ...s.rows] }), () =>
        api("POST", "/api/me/items", { kind: "merchant", data }),
      );
      return true;
    },
    [userId, has, remove],
  );

  return { mode, items, has, toggle, remove, ready: mode === "guest" || slot.status === "ready" };
}

/** Members-only merchant blocklist. Guests get `enabled: false` and an
 *  empty list (nothing is hidden for them). */
export function useBlocklist() {
  const { mode, userId } = useMemberMode();
  const slot = useSlot(userId, "blocked_merchant");

  const items = useMemo<BlockedMerchant[]>(
    () => (userId ? (slot.rows as ServerItem[]).map(toMerchant) : []),
    [userId, slot.rows],
  );
  const keys = useMemo(() => new Set(items.map((i) => i.key)), [items]);
  const isBlocked = useCallback((exchange: ExchangeId, id: string) => keys.has(mKey(exchange, id)), [keys]);

  const block = useCallback(
    (m: MerchantInput & { reason?: string }) => {
      if (!userId) return;
      const data = { exchange: m.exchange, id: m.id, name: m.name, asset: m.asset, fiat: m.fiat, reason: m.reason };
      const row: ServerItem = { kind: "blocked_merchant", itemKey: mKey(m.exchange, m.id), data, createdAt: now() };
      void mutate(
        userId,
        "blocked_merchant",
        (s) => ({ rows: [row, ...(s.rows as ServerItem[]).filter((r) => r.itemKey !== row.itemKey)] }),
        () => api("POST", "/api/me/items", { kind: "blocked_merchant", data }),
      );
    },
    [userId],
  );

  const unblock = useCallback(
    (exchange: ExchangeId, id: string) => {
      if (!userId) return;
      const key = mKey(exchange, id);
      void mutate(
        userId,
        "blocked_merchant",
        (s) => ({ rows: (s.rows as ServerItem[]).filter((r) => r.itemKey !== key) }),
        () => api("DELETE", `/api/me/items?kind=blocked_merchant&key=${encodeURIComponent(key)}`),
      );
    },
    [userId],
  );

  return { mode, enabled: !!userId, items, isBlocked, block, unblock, count: items.length };
}

/* ── Saved filters ────────────────────────────────────────────────────── */

export function useSavedFilters() {
  const { mode, userId } = useMemberMode();
  const guest = useStorageValue(() => savedFilters.list(), [STORAGE_KEYS.filters], EMPTY_FILTERS);
  const slot = useSlot(userId, "filter");

  const items = useMemo<Filter[]>(() => {
    if (mode === "loading") return [];
    if (userId) {
      return (slot.rows as ServerItem[]).map((r) => ({
        id: r.itemKey,
        label: str(r.data.label) ?? "Saved filter",
        path: str(r.data.path) ?? "/",
        search: str(r.data.search) ?? "",
        createdAt: iso(r.createdAt),
      }));
    }
    return guest;
  }, [mode, userId, slot.rows, guest]);

  const add = useCallback(
    (label: string, path: string, search: string): Filter => {
      if (!userId) return savedFilters.add(label, path, search);
      const id = crypto.randomUUID();
      const data = { label: label.slice(0, 80), path, search: search.replace(/^\?/, "") };
      const row: ServerItem = { kind: "filter", itemKey: id, data, createdAt: now() };
      void mutate(userId, "filter", (s) => ({ rows: [row, ...s.rows] }), () =>
        api("POST", "/api/me/items", { kind: "filter", itemKey: id, data }),
      );
      return { id, ...data, createdAt: iso(row.createdAt) };
    },
    [userId],
  );

  const remove = useCallback(
    (id: string) => {
      if (!userId) return savedFilters.remove(id);
      void mutate(
        userId,
        "filter",
        (s) => ({ rows: (s.rows as ServerItem[]).filter((r) => r.itemKey !== id) }),
        () => api("DELETE", `/api/me/items?kind=filter&key=${encodeURIComponent(id)}`),
      );
    },
    [userId],
  );

  return { mode, items, add, remove, ready: mode === "guest" || slot.status === "ready" };
}

/* ── Alert rules (members only) ───────────────────────────────────────── */

export type RuleDraft = {
  exchange: ExchangeId;
  type: AlertType;
  threshold: number;
  label?: string | null;
  email?: boolean;
  cooldownSec?: number;
};
export type RulePatch = Partial<Pick<MemberRule, "enabled" | "email" | "cooldownSec" | "threshold" | "label" | "exchange">>;

export function useAlertRules() {
  const { mode, userId } = useMemberMode();
  const slot = useSlot(userId, "rules");
  const rules = slot.rows as MemberRule[];

  const create = useCallback(
    async (draft: RuleDraft): Promise<MemberRule | null> => {
      if (!userId) return null;
      const res = await mutate(userId, "rules", null, () => api<{ rule: MemberRule }>("POST", "/api/me/rules", draft));
      if (res) setSlot(userId, "rules", { rows: [res.rule, ...(getSlot(userId, "rules").rows as MemberRule[])] });
      return res?.rule ?? null;
    },
    [userId],
  );

  const update = useCallback(
    (id: string, patch: RulePatch) => {
      if (!userId) return;
      void mutate(
        userId,
        "rules",
        (s) => ({ rows: (s.rows as MemberRule[]).map((r) => (r.id === id ? { ...r, ...patch } : r)) }),
        () => api("PATCH", `/api/me/rules/${encodeURIComponent(id)}`, patch),
      );
    },
    [userId],
  );

  const remove = useCallback(
    (id: string) => {
      if (!userId) return;
      void mutate(
        userId,
        "rules",
        (s) => ({ rows: (s.rows as MemberRule[]).filter((r) => r.id !== id) }),
        () => api("DELETE", `/api/me/rules/${encodeURIComponent(id)}`),
      );
    },
    [userId],
  );

  return { mode, enabled: !!userId, rules, create, update, remove, ready: slot.status === "ready" };
}

/* ── Alert events / inbox (members only) ──────────────────────────────── */

export function useAlertEvents() {
  const { mode, userId } = useMemberMode();
  const slot = useSlot(userId, "events");
  const events = slot.rows as MemberEvent[];

  const markRead = useCallback(
    (ids?: string[]) => {
      if (!userId) return;
      const target = ids ? new Set(ids) : null;
      void mutate(
        userId,
        "events",
        (s) => {
          const rows = (s.rows as MemberEvent[]).map((e) => (!target || target.has(e.id) ? { ...e, read: true } : e));
          return { rows, unread: rows.filter((e) => !e.read).length };
        },
        () => api("POST", "/api/me/events", ids ? { ids } : {}),
      );
    },
    [userId],
  );

  const clear = useCallback(() => {
    if (!userId) return;
    void mutate(userId, "events", () => ({ rows: [], unread: 0 }), () => api("DELETE", "/api/me/events"));
  }, [userId]);

  const refresh = useCallback(() => {
    if (userId) void load(userId, "events", true);
  }, [userId]);

  return {
    mode,
    enabled: !!userId,
    events,
    unread: slot.status === "ready" ? events.filter((e) => !e.read).length : slot.unread,
    markRead,
    clear,
    refresh,
    ready: slot.status === "ready",
  };
}

/** Called by the global poller when new events arrive: refresh the inbox if
 *  something on screen is showing it. */
export function notifyNewEvents(uid: string) {
  if (getSlot(uid, "events").status !== "idle") void load(uid, "events", true);
}

/* ── One-time guest → member import ───────────────────────────────────── */

const importing = new Set<string>();
const importFlag = (uid: string) => `p2plk:v1:imported:${uid}`;

/**
 * On a member's first sign-in in this browser, copy the guest workspace
 * (watchlist, favourites, saved filters, old local alert rules) into their
 * account. The server import is idempotent, so a repeat is harmless; the
 * per-user flag just avoids the request.
 */
export function useGuestImport() {
  const { userId } = useMemberMode();
  useEffect(() => {
    if (!userId || importing.has(userId)) return;
    let done = false;
    try {
      done = window.localStorage.getItem(importFlag(userId)) === "1";
    } catch {
      return;
    }
    if (done) return;
    const payload = {
      markets: watchlistMarkets.list().map(({ asset, fiat }) => ({ asset, fiat })),
      merchants: favouriteMerchants.list().map(({ exchange, id, name, asset, fiat }) => ({
        exchange,
        id,
        name,
        asset,
        fiat,
      })),
      filters: savedFilters.list().map(({ id, label, path, search }) => ({ id, label, path, search })),
      rules: guestRules.list().map(({ type, threshold, label, enabled, cooldownSec }) => ({
        type,
        threshold,
        label,
        enabled,
        cooldownSec,
      })),
    };
    const markDone = () => {
      try {
        window.localStorage.setItem(importFlag(userId), "1");
      } catch {
        /* ignore */
      }
    };
    const total = payload.markets.length + payload.merchants.length + payload.filters.length + payload.rules.length;
    if (total === 0) {
      markDone();
      return;
    }
    importing.add(userId);
    api<{ imported: number }>("POST", "/api/me/import", payload)
      .then(({ imported }) => {
        markDone();
        invalidateMemberData(userId);
        if (imported > 0) {
          toast.success(`Moved ${imported} saved item${imported === 1 ? "" : "s"} from this browser to your account`);
        }
      })
      .catch((err) => {
        // Try again on the next page load.
        console.warn("[import]", err);
      })
      .finally(() => importing.delete(userId));
  }, [userId]);
}
