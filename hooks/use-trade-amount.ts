"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * The visitor's trade size (LKR) and whether walks may use offline and
 * restricted ads. Shared by Markets, Compare and Arbitrage, remembered in
 * localStorage, and kept in sync across tabs and components through
 * `useSyncExternalStore`. Server render and first paint use the defaults.
 */

export const DEFAULT_TRADE_AMOUNT = 100_000;
export const TRADE_AMOUNT_PRESETS = [50_000, 100_000, 500_000, 1_000_000] as const;
export const MAX_TRADE_AMOUNT = 1e9;

const KEY_AMOUNT = "p2plk:v1:trade-amount";
const KEY_ALL = "p2plk:v1:trade-include-all";
const EVENT = "p2plk:trade-amount";

function readRaw(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string) {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // Private mode / quota: keep working for this page view.
  }
  window.dispatchEvent(new Event(EVENT));
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY_AMOUNT || e.key === KEY_ALL) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, cb);
  };
}

export function parseTradeAmount(raw: string | null | undefined): number {
  const n = Number(String(raw ?? "").replace(/,/g, ""));
  return Number.isFinite(n) && n > 0 ? Math.min(n, MAX_TRADE_AMOUNT) : DEFAULT_TRADE_AMOUNT;
}

const amountSnapshot = () => parseTradeAmount(readRaw(KEY_AMOUNT));
const allSnapshot = () => readRaw(KEY_ALL) === "1";
const serverAmount = () => DEFAULT_TRADE_AMOUNT;
const serverAll = () => false;

/** [amount in LKR, setAmount]. */
export function useTradeAmount() {
  const amount = useSyncExternalStore(subscribe, amountSnapshot, serverAmount);
  const setAmount = useCallback((n: number) => {
    if (Number.isFinite(n) && n > 0) write(KEY_AMOUNT, String(Math.min(Math.round(n), MAX_TRADE_AMOUNT)));
  }, []);
  return [amount, setAmount] as const;
}

/** [includeAll, setIncludeAll]: when true, walks also use offline and restricted ads. */
export function useIncludeAllAds() {
  const all = useSyncExternalStore(subscribe, allSnapshot, serverAll);
  const set = useCallback((v: boolean) => write(KEY_ALL, v ? "1" : "0"), []);
  return [all, set] as const;
}
