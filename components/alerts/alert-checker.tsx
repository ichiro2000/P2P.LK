"use client";

import { useEffect, useMemo, useRef } from "react";
import { toast } from "sonner";
import type { MarketSnapshot } from "@/lib/types";
import {
  alertEvents,
  alertRules,
  useStorageValue,
  STORAGE_KEYS,
  type AlertRule,
} from "@/lib/storage";
import { cooldownExpired, evaluateRule } from "@/lib/alert-engine";
import { getFiat } from "@/lib/constants";
import { formatFiat, formatPct, formatCompact } from "@/lib/format";

/**
 * Runs quietly inside the app layout. Every 30s it visits each unique
 * asset/fiat that any enabled rule references, fetches a snapshot from our
 * existing /api/p2p/market proxy, evaluates each rule, and fires both a
 * sonner toast and a persisted event if the rule triggers (respecting its
 * cooldown).
 *
 * Zero work is done when there are no enabled rules, so the mount cost is
 * near-free for users who never create an alert.
 */
export function AlertChecker({ intervalMs = 30_000 }: { intervalMs?: number }) {
  const rules = useStorageValue(
    () => alertRules.list(),
    [STORAGE_KEYS.rules],
    [],
  );

  const enabled = useMemo(() => rules.filter((r) => r.enabled), [rules]);
  const markets = useMemo(() => {
    const set = new Set<string>();
    for (const r of enabled) set.add(`${r.asset}/${r.fiat}`);
    return [...set];
  }, [enabled]);

  // Keep latest rules in a ref so the interval body always sees fresh state.
  const rulesRef = useRef<AlertRule[]>(enabled);
  useEffect(() => {
    rulesRef.current = enabled;
  }, [enabled]);

  useEffect(() => {
    if (markets.length === 0) return;

    let cancelled = false;

    async function tick() {
      for (const key of markets) {
        if (cancelled) return;
        if (document.visibilityState !== "visible") return;
        const [asset, fiat] = key.split("/");
        try {
          const res = await fetch(
            `/api/p2p/market?asset=${asset}&fiat=${fiat}&rows=10`,
            { cache: "no-store" },
          );
          if (!res.ok) continue;
          const snap = (await res.json()) as MarketSnapshot;

          const matching = rulesRef.current.filter(
            (r) => r.asset === asset && r.fiat === fiat,
          );

          for (const rule of matching) {
            const { fired, observed } = evaluateRule(rule, snap);
            if (!fired) continue;
            if (!cooldownExpired(rule)) continue;

            alertRules.update(rule.id, {
              lastFiredAt: new Date().toISOString(),
            });
            const ev = alertEvents.push({
              ruleId: rule.id,
              ruleLabel: rule.label ?? describeRule(rule),
              asset: rule.asset,
              fiat: rule.fiat,
              type: rule.type,
              observed,
              threshold: rule.threshold,
              at: new Date().toISOString(),
            });

            toast(ev.ruleLabel, {
              description: describeObservation(rule, observed),
              duration: 6000,
            });
          }
        } catch {
          // Network hiccups are common for the public feed; the next tick
          // will try again.
        }
      }
    }

    // First tick immediately, then interval.
    tick();
    const id = setInterval(tick, intervalMs);
    const onVis = () => {
      if (document.visibilityState === "visible") tick();
    };
    document.addEventListener("visibilitychange", onVis);
    return () => {
      cancelled = true;
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVis);
    };
  }, [markets, intervalMs]);

  return null;
}

function describeRule(r: AlertRule): string {
  const sym = getFiat(r.fiat)?.symbol ?? r.fiat;
  switch (r.type) {
    case "priceAbove":
      return `${r.asset}/${r.fiat} mid > ${formatFiat(r.threshold, sym, 2)}`;
    case "priceBelow":
      return `${r.asset}/${r.fiat} mid < ${formatFiat(r.threshold, sym, 2)}`;
    case "spreadAbove":
      return `${r.asset}/${r.fiat} spread > ${formatPct(r.threshold, { frac: 2 })}`;
    case "spreadBelow":
      return `${r.asset}/${r.fiat} spread < ${formatPct(r.threshold, { frac: 2 })}`;
    case "depthBelow":
      return `${r.asset}/${r.fiat} depth < ${formatCompact(r.threshold)} ${r.asset}`;
  }
}

function describeObservation(r: AlertRule, observed: number): string {
  const sym = getFiat(r.fiat)?.symbol ?? r.fiat;
  switch (r.type) {
    case "priceAbove":
    case "priceBelow":
      return `Observed mid ${formatFiat(observed, sym, 2)}`;
    case "spreadAbove":
    case "spreadBelow":
      return `Observed spread ${formatPct(observed, { frac: 2 })}`;
    case "depthBelow":
      return `Observed depth ${formatCompact(observed)} ${r.asset}`;
  }
}
