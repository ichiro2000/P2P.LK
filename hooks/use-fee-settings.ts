"use client";

import { useCallback, useSyncExternalStore } from "react";
import { DEFAULT_FEE_SETTINGS, MERCHANT_LEVELS, type FeeSettings, type MerchantLevel } from "@/lib/fees";

/**
 * The visitor's fee setup (merchant level, base maker fee, minimum per
 * order), shared by every calculator and remembered in localStorage.
 * Server render / first paint use Binance's published defaults.
 */

const KEY = "p2plk:v1:fee-settings";
const EVENT = "p2plk:fee-settings";

function readRaw(): string | null {
  try {
    return window.localStorage.getItem(KEY);
  } catch {
    return null;
  }
}

export function parseFeeSettings(raw: string | null): FeeSettings {
  if (!raw) return DEFAULT_FEE_SETTINGS;
  try {
    const v = JSON.parse(raw) as Partial<FeeSettings>;
    const level = MERCHANT_LEVELS.includes(v.level as MerchantLevel) ? (v.level as MerchantLevel) : "none";
    const base = Number(v.baseMakerFee);
    const min = Number(v.minFeeUsdt);
    return {
      level,
      baseMakerFee: Number.isFinite(base) && base >= 0 && base <= 0.05 ? base : DEFAULT_FEE_SETTINGS.baseMakerFee,
      minFeeUsdt: Number.isFinite(min) && min >= 0 && min <= 100 ? min : DEFAULT_FEE_SETTINGS.minFeeUsdt,
    };
  } catch {
    return DEFAULT_FEE_SETTINGS;
  }
}

function subscribe(cb: () => void) {
  const onStorage = (e: StorageEvent) => {
    if (e.key === KEY) cb();
  };
  window.addEventListener("storage", onStorage);
  window.addEventListener(EVENT, cb);
  return () => {
    window.removeEventListener("storage", onStorage);
    window.removeEventListener(EVENT, cb);
  };
}

// The snapshot is the raw string (stable identity for useSyncExternalStore);
// parsing happens per render, which is cheap.
const snapshot = () => readRaw() ?? "";
const serverSnapshot = () => "";

export function useFeeSettings(): [FeeSettings, (patch: Partial<FeeSettings>) => void] {
  const raw = useSyncExternalStore(subscribe, snapshot, serverSnapshot);
  const settings = parseFeeSettings(raw || null);
  const update = useCallback((patch: Partial<FeeSettings>) => {
    const next = { ...parseFeeSettings(readRaw()), ...patch };
    try {
      window.localStorage.setItem(KEY, JSON.stringify(next));
    } catch {
      // private mode: still notify this page
    }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [settings, update];
}
