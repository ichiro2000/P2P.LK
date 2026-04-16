import type { AlertRule, AlertRuleType } from "@/lib/storage";
import type { MarketSnapshot } from "@/lib/types";

export type AlertEvaluation = {
  rule: AlertRule;
  observed: number;
  fired: boolean;
};

/**
 * Pure evaluator — given a rule and a market snapshot, returns whether the
 * condition is met plus the observed numeric. Kept pure so it's easy to test.
 */
export function evaluateRule(
  rule: AlertRule,
  snapshot: MarketSnapshot,
): AlertEvaluation {
  const observed = observeMetric(rule.type, snapshot);
  if (observed == null) return { rule, observed: NaN, fired: false };

  let fired = false;
  switch (rule.type) {
    case "priceAbove":
      fired = observed > rule.threshold;
      break;
    case "priceBelow":
      fired = observed < rule.threshold;
      break;
    case "spreadAbove":
      fired = observed > rule.threshold;
      break;
    case "spreadBelow":
      fired = observed < rule.threshold;
      break;
    case "depthBelow":
      fired = observed < rule.threshold;
      break;
  }

  return { rule, observed, fired };
}

function observeMetric(
  type: AlertRuleType,
  snap: MarketSnapshot,
): number | null {
  switch (type) {
    case "priceAbove":
    case "priceBelow":
      // Mid as the canonical price for "is it above X?"
      return snap.mid;
    case "spreadAbove":
    case "spreadBelow":
      return snap.spreadPct;
    case "depthBelow":
      return snap.buy.totalAvailable + snap.sell.totalAvailable;
  }
}

export const RULE_TYPE_META: Record<
  AlertRuleType,
  { label: string; unit: "price" | "percent" | "asset"; comparator: string }
> = {
  priceAbove: { label: "Mid price above", unit: "price", comparator: ">" },
  priceBelow: { label: "Mid price below", unit: "price", comparator: "<" },
  spreadAbove: { label: "Spread above", unit: "percent", comparator: ">" },
  spreadBelow: { label: "Spread below", unit: "percent", comparator: "<" },
  depthBelow: { label: "Total depth below", unit: "asset", comparator: "<" },
};

/** Returns true if the rule can fire again given its cooldown. */
export function cooldownExpired(
  rule: AlertRule,
  nowMs = Date.now(),
): boolean {
  if (!rule.lastFiredAt) return true;
  const last = new Date(rule.lastFiredAt).getTime();
  return nowMs - last >= rule.cooldownSec * 1000;
}
