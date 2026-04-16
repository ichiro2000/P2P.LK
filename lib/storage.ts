/**
 * Typed, SSR-safe localStorage layer for the workspace.
 *
 * All state here is anonymous and client-only — when we eventually bolt on auth
 * this module becomes the "guest fallback" and the same shapes mirror to the
 * backend for signed-in users.
 *
 * Every read returns a default on the server or when parse fails, so callers
 * never have to null-check `localStorage` themselves.
 */

const PREFIX = "p2plk:v1:";

type MarketKey = `${string}/${string}`; // "USDT/LKR"

export type MarketRef = {
  asset: string;
  fiat: string;
  /** ISO timestamp added */
  addedAt: string;
};

export type MerchantRef = {
  id: string;
  name: string;
  asset?: string;
  fiat?: string;
  addedAt: string;
};

export type SavedFilter = {
  id: string;
  label: string;
  /** Route the filter applies to, e.g. "/" or "/merchants" */
  path: string;
  /** URL search string without the leading "?" */
  search: string;
  createdAt: string;
};

export type RecentVisit = {
  path: string;
  search: string;
  title: string;
  at: string;
};

export type AlertRuleType =
  | "priceAbove"
  | "priceBelow"
  | "spreadAbove"
  | "spreadBelow"
  | "depthBelow";

export type AlertRule = {
  id: string;
  type: AlertRuleType;
  asset: string;
  fiat: string;
  /** Numeric threshold. Units depend on type:
   *   priceAbove/priceBelow: fiat/asset price
   *   spreadAbove/spreadBelow: decimal fraction (0.01 = 1%)
   *   depthBelow: asset units */
  threshold: number;
  label?: string;
  enabled: boolean;
  createdAt: string;
  /** Cooldown — don't re-fire within N seconds of last fire. */
  cooldownSec: number;
  lastFiredAt?: string;
};

export type AlertEvent = {
  id: string;
  ruleId: string;
  ruleLabel: string;
  asset: string;
  fiat: string;
  type: AlertRuleType;
  observed: number;
  threshold: number;
  at: string;
  read: boolean;
};

/** ── Keys ─────────────────────────────────────────────────────────────── */
const K = {
  markets: PREFIX + "markets",
  merchants: PREFIX + "merchants",
  filters: PREFIX + "filters",
  recent: PREFIX + "recent",
  rules: PREFIX + "rules",
  events: PREFIX + "events",
} as const;

/** ── Low-level helpers ───────────────────────────────────────────────── */

function read<T>(key: string, fallback: T): T {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function write<T>(key: string, value: T) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
    // Broadcast to sibling tabs and our own React hooks.
    window.dispatchEvent(new CustomEvent("p2plk:storage", { detail: { key } }));
  } catch {
    // ignore quota errors
  }
}

function marketKey(asset: string, fiat: string): MarketKey {
  return `${asset.toUpperCase()}/${fiat.toUpperCase()}`;
}

function id(prefix = "id"): string {
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/** ── Markets (watchlist) ─────────────────────────────────────────────── */

export const watchlistMarkets = {
  list(): MarketRef[] {
    return read<MarketRef[]>(K.markets, []);
  },
  has(asset: string, fiat: string): boolean {
    const k = marketKey(asset, fiat);
    return this.list().some((m) => marketKey(m.asset, m.fiat) === k);
  },
  toggle(asset: string, fiat: string): boolean {
    const list = this.list();
    const k = marketKey(asset, fiat);
    const idx = list.findIndex((m) => marketKey(m.asset, m.fiat) === k);
    if (idx >= 0) {
      list.splice(idx, 1);
      write(K.markets, list);
      return false;
    }
    list.unshift({
      asset: asset.toUpperCase(),
      fiat: fiat.toUpperCase(),
      addedAt: new Date().toISOString(),
    });
    write(K.markets, list);
    return true;
  },
  remove(asset: string, fiat: string) {
    const k = marketKey(asset, fiat);
    write(
      K.markets,
      this.list().filter((m) => marketKey(m.asset, m.fiat) !== k),
    );
  },
};

/** ── Merchants (favourites) ──────────────────────────────────────────── */

export const favouriteMerchants = {
  list(): MerchantRef[] {
    return read<MerchantRef[]>(K.merchants, []);
  },
  has(merchantId: string): boolean {
    return this.list().some((m) => m.id === merchantId);
  },
  toggle(ref: Omit<MerchantRef, "addedAt">): boolean {
    const list = this.list();
    const idx = list.findIndex((m) => m.id === ref.id);
    if (idx >= 0) {
      list.splice(idx, 1);
      write(K.merchants, list);
      return false;
    }
    list.unshift({ ...ref, addedAt: new Date().toISOString() });
    write(K.merchants, list);
    return true;
  },
  remove(merchantId: string) {
    write(K.merchants, this.list().filter((m) => m.id !== merchantId));
  },
};

/** ── Saved filters ───────────────────────────────────────────────────── */

export const savedFilters = {
  list(): SavedFilter[] {
    return read<SavedFilter[]>(K.filters, []);
  },
  add(label: string, path: string, search: string): SavedFilter {
    const list = this.list();
    const entry: SavedFilter = {
      id: id("f"),
      label,
      path,
      search: search.replace(/^\?/, ""),
      createdAt: new Date().toISOString(),
    };
    list.unshift(entry);
    write(K.filters, list.slice(0, 24));
    return entry;
  },
  remove(filterId: string) {
    write(K.filters, this.list().filter((f) => f.id !== filterId));
  },
};

/** ── Recently visited (ring buffer of 8) ─────────────────────────────── */

export const recent = {
  list(): RecentVisit[] {
    return read<RecentVisit[]>(K.recent, []);
  },
  track(visit: Omit<RecentVisit, "at">) {
    const now = new Date().toISOString();
    const list = this.list().filter(
      (v) => !(v.path === visit.path && v.search === visit.search),
    );
    list.unshift({ ...visit, at: now });
    write(K.recent, list.slice(0, 8));
  },
  clear() {
    write(K.recent, []);
  },
};

/** ── Alert rules + event log ─────────────────────────────────────────── */

export const alertRules = {
  list(): AlertRule[] {
    return read<AlertRule[]>(K.rules, []);
  },
  create(
    rule: Omit<AlertRule, "id" | "createdAt" | "enabled" | "cooldownSec"> & {
      enabled?: boolean;
      cooldownSec?: number;
    },
  ): AlertRule {
    const entry: AlertRule = {
      id: id("r"),
      enabled: rule.enabled ?? true,
      cooldownSec: rule.cooldownSec ?? 300,
      createdAt: new Date().toISOString(),
      ...rule,
    };
    write(K.rules, [entry, ...this.list()]);
    return entry;
  },
  update(ruleId: string, patch: Partial<AlertRule>) {
    write(
      K.rules,
      this.list().map((r) =>
        r.id === ruleId ? { ...r, ...patch } : r,
      ),
    );
  },
  remove(ruleId: string) {
    write(K.rules, this.list().filter((r) => r.id !== ruleId));
  },
};

export const alertEvents = {
  list(): AlertEvent[] {
    return read<AlertEvent[]>(K.events, []);
  },
  push(event: Omit<AlertEvent, "id" | "read">) {
    const entry: AlertEvent = {
      ...event,
      id: id("e"),
      read: false,
    };
    // Cap at 50 to avoid bloating localStorage.
    write(K.events, [entry, ...this.list()].slice(0, 50));
    return entry;
  },
  markRead(eventId: string) {
    write(
      K.events,
      this.list().map((e) => (e.id === eventId ? { ...e, read: true } : e)),
    );
  },
  markAllRead() {
    write(
      K.events,
      this.list().map((e) => ({ ...e, read: true })),
    );
  },
  clear() {
    write(K.events, []);
  },
  unreadCount(): number {
    return this.list().filter((e) => !e.read).length;
  },
};

/** ── React hook: subscribe to any key ────────────────────────────────── */

import { useEffect, useState } from "react";

/**
 * Client-only state mirror of a localStorage selector.
 *
 * First render on the client matches the server-rendered HTML (returns
 * `fallback`), and we hydrate from real localStorage in a mount effect.
 * Further writes to the same keys re-trigger via our custom "p2plk:storage"
 * event (same tab) and the native "storage" event (other tabs).
 */
export function useStorageValue<T>(
  fn: () => T,
  /** List of keys the selector reads from — drives subscription scope. */
  keys: string[],
  /** Initial value to render during SSR and before the mount effect runs. */
  fallback: T,
): T {
  const [value, setValue] = useState<T>(fallback);

  useEffect(() => {
    setValue(fn());
    const onLocal = (e: Event) => {
      const key = (e as CustomEvent<{ key: string }>).detail?.key;
      if (!key || keys.includes(key)) setValue(fn());
    };
    const onStorage = (e: StorageEvent) => {
      if (!e.key || keys.includes(e.key)) setValue(fn());
    };
    window.addEventListener("p2plk:storage", onLocal as EventListener);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener("p2plk:storage", onLocal as EventListener);
      window.removeEventListener("storage", onStorage);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [keys.join("|")]);

  return value;
}

export const STORAGE_KEYS = K;
