import type { AlertType } from "@/lib/db/schema";
import type { ExchangeId } from "@/lib/exchanges/types";
import { ASSET, FIAT } from "@/lib/constants";
import { formatCompact, formatFiat, formatPct } from "@/lib/format";

/**
 * Labels and units for server-side alert rules. Thresholds are stored as
 * the cron evaluates them: price in LKR, spread and taker signal as a
 * fraction (0.01 = 1%), depth in USDT.
 *
 * `depthBelow` (both sides of the top 20 added together) is legacy: old
 * rules keep firing on it, but new rules pick one side, measured within 1%
 * of that side's best price.
 */
export const RULE_TYPES: AlertType[] = [
  "priceAbove",
  "priceBelow",
  "spreadAbove",
  "spreadBelow",
  "askDepthBelow",
  "bidDepthBelow",
  "offMarketAd",
  "usdGoogleUp",
  "usdGoogleDown",
  "usdCbslUp",
  "usdCbslDown",
];

/** Dollar-rate rules: the exchange only picks which USDT price the message compares. */
export const DOLLAR_RULES: ReadonlySet<AlertType> = new Set(["usdGoogleUp", "usdGoogleDown", "usdCbslUp", "usdCbslDown"]);

export const RULE_TYPE_META: Record<
  AlertType,
  { label: string; short: string; unit: "price" | "percent" | "asset"; comparator: string; hint: string }
> = {
  priceAbove: { label: "Mid price above", short: "Mid above", unit: "price", comparator: ">", hint: "For example 330" },
  priceBelow: { label: "Mid price below", short: "Mid below", unit: "price", comparator: "<", hint: "For example 320" },
  spreadAbove: { label: "Spread above", short: "Spread above", unit: "percent", comparator: ">", hint: "0.5 means 0.5%" },
  spreadBelow: { label: "Spread below", short: "Spread below", unit: "percent", comparator: "<", hint: "0.5 means 0.5%" },
  depthBelow: {
    label: "Top-20 depth, both sides, below (old rule)",
    short: "Top-20 depth below",
    unit: "asset",
    comparator: "<",
    hint: "Both sides of the top 20 ads added together",
  },
  askDepthBelow: {
    label: "Sell ads within 1% of best below (USDT to buy)",
    short: "Sell-ad depth (1%) below",
    unit: "asset",
    comparator: "<",
    hint: "USDT you could buy within 1% of the best price, for example 2000",
  },
  bidDepthBelow: {
    label: "Buy ads within 1% of best below (USDT to sell)",
    short: "Buy-ad depth (1%) below",
    unit: "asset",
    comparator: "<",
    hint: "Declared USDT buyers will take within 1% of the best price, for example 2000",
  },
  offMarketAd: {
    label: "Taker signal: an ad priced X% better than the top-5 average",
    short: "Taker signal",
    unit: "percent",
    comparator: "≥",
    hint: "1 means an ad at least 1% better than the top-5 average",
  },
  usdGoogleUp: {
    label: "Google dollar rises ≥ X% in 2 h (USDT tends to follow up)",
    short: "Google USD/LKR up in 2 h ≥",
    unit: "percent",
    comparator: "≥",
    hint: "0.3 means Google's USD/LKR up at least 0.3% over 2 hours. Checked on each 30-minute reading; the message shows how far USDT on the chosen exchange has followed.",
  },
  usdGoogleDown: {
    label: "Google dollar falls ≥ X% in 2 h (USDT tends to follow down)",
    short: "Google USD/LKR down in 2 h ≥",
    unit: "percent",
    comparator: "≥",
    hint: "0.3 means Google's USD/LKR down at least 0.3% over 2 hours. Checked on each 30-minute reading; the message shows how far USDT on the chosen exchange has followed.",
  },
  usdCbslUp: {
    label: "CBSL dollar rate rises ≥ X% in a day (USDT tends to follow up)",
    short: "CBSL USD/LKR day change up ≥",
    unit: "percent",
    comparator: "≥",
    hint: "0.5 means CBSL's indicative rate up at least 0.5% vs the previous business day. At most once per new CBSL rate.",
  },
  usdCbslDown: {
    label: "CBSL dollar rate falls ≥ X% in a day (USDT tends to follow down)",
    short: "CBSL USD/LKR day change down ≥",
    unit: "percent",
    comparator: "≥",
    hint: "0.5 means CBSL's indicative rate down at least 0.5% vs the previous business day. At most once per new CBSL rate.",
  },
};

export const EXCHANGE_LABEL: Record<ExchangeId, string> = { binance: "Binance", bybit: "Bybit" };

/** Cooldown presets (seconds). */
export const COOLDOWNS = [
  { sec: 300, label: "5 min" },
  { sec: 900, label: "15 min" },
  { sec: 1800, label: "30 min" },
  { sec: 3600, label: "1 hour" },
  { sec: 10_800, label: "3 hours" },
  { sec: 21_600, label: "6 hours" },
  { sec: 86_400, label: "24 hours" },
] as const;

export function cooldownLabel(sec: number) {
  const hit = COOLDOWNS.find((c) => c.sec === sec);
  if (hit) return hit.label;
  return sec >= 3600 ? `${Math.round(sec / 360) / 10} h` : `${Math.round(sec / 60)} min`;
}

/** Format a stored value (threshold or observed) for its rule type. */
export function formatRuleValue(type: AlertType, v: number) {
  const unit = RULE_TYPE_META[type].unit;
  if (unit === "price") return formatFiat(v, FIAT.symbol, 2);
  if (unit === "percent") return formatPct(v, { frac: 2 });
  return `${formatCompact(v)} ${ASSET}`;
}

/** Plain-language rule label, used when the member doesn't type one. */
export function describeRule(r: { exchange: ExchangeId; type: AlertType; threshold: number }) {
  const ex = EXCHANGE_LABEL[r.exchange];
  const m = RULE_TYPE_META[r.type];
  if (r.type === "offMarketAd") return `${ex} taker signal ≥ ${formatRuleValue(r.type, r.threshold)} better than top 5`;
  if (DOLLAR_RULES.has(r.type)) return `${m.short} ${formatRuleValue(r.type, r.threshold)} (USDT on ${ex})`;
  return `${ex} ${m.short.toLowerCase()} ${formatRuleValue(r.type, r.threshold)}`;
}
