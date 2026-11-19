/**
 * Merchant reliability score (D7). The ONE implementation: the merchant
 * directory, merchant detail page, member dashboard and reports all call
 * `reliabilityScore`. Pure and client-safe.
 *
 *   score = 45 · completionLB   confidence-adjusted 30-day completion
 *         + 15 · volume         min(1, log10(1 + orders30d) / log10(2000))
 *         + 15 · feedback       Wilson lower bound of positive / (positive + negative)
 *         + 10 · release        avg release time: 1 at ≤ 2 min, 0 at ≥ 15 min, linear
 *         +  5 · presence7d     share of the last 7 days' tracked hours they listed
 *         +  5 · tenure         min(1, days since we first saw them / 90)
 *         +  5 · accountAge     min(1, days since they registered / 730)
 *
 * completionLB is the Wilson lower bound (95 %, z = 1.96) of the 30-day
 * completion rate with n = 30-day orders. 15 orders at 100 % gives 0.796;
 * 3,677 orders at 99.6 % gives 0.993 — a small sample no longer ties a
 * long track record. Feedback uses the same bound, so 5 / 0 reviews (0.57)
 * scores below 24,698 / 86 (0.996).
 *
 * Feedback, release time and account age come from the exchange profile
 * (Binance "Trade Info", lib/ingest/profiles.ts). Bybit's profile needs a
 * login, and a Binance merchant may not be fetched yet: any part that is
 * unknown is left out and the known parts are rescaled to 0–100, so scores
 * stay comparable.
 */

export const RELIABILITY_WEIGHTS = {
  completion: 45,
  volume: 15,
  feedback: 15,
  release: 10,
  presence: 5,
  tenure: 5,
  accountAge: 5,
} as const;
/** Orders in 30 days at which the volume part saturates. */
export const VOLUME_SATURATION = 2000;
export const TENURE_FULL_DAYS = 90;
export const ACCOUNT_AGE_FULL_DAYS = 730;
/** Release time (seconds) for full marks / zero. */
export const RELEASE_FULL_SEC = 120;
export const RELEASE_ZERO_SEC = 900;
const Z = 1.96;

/** Wilson score interval lower bound for a proportion `p` observed over `n` trials. */
export function wilsonLowerBound(p: number, n: number, z = Z): number {
  if (!(n > 0) || !Number.isFinite(p)) return 0;
  const ph = Math.max(0, Math.min(1, p));
  const z2 = z * z;
  const centre = ph + z2 / (2 * n);
  const margin = z * Math.sqrt((ph * (1 - ph)) / n + z2 / (4 * n * n));
  return Math.max(0, (centre - margin) / (1 + z2 / n));
}

/** 1 at ≤ 2 min, 0 at ≥ 15 min, linear between; null when unknown. */
export function releaseScore(sec: number | null | undefined): number | null {
  if (sec == null || !Number.isFinite(sec) || sec < 0) return null;
  return Math.max(0, Math.min(1, (RELEASE_ZERO_SEC - sec) / (RELEASE_ZERO_SEC - RELEASE_FULL_SEC)));
}

/** Wilson lower bound of the positive-feedback share; null without reviews. */
export function feedbackScore(positive: number | null | undefined, negative: number | null | undefined): number | null {
  if (positive == null || negative == null || positive < 0 || negative < 0) return null;
  const n = positive + negative;
  if (n <= 0) return null;
  return wilsonLowerBound(positive / n, n);
}

export type ReliabilityInput = {
  /** 0..1, 30-day completion. */
  completionRate: number | null | undefined;
  orders30d: number | null | undefined;
  /** 0..1 share of tracked hours in the last 7 days they were listing; null = unknown. */
  presence7d?: number | null;
  /** Unix seconds first seen by our collector; null = unknown. */
  firstSeenTs?: number | null;
  /** Profile: 30-day average release time, seconds. */
  avgReleaseSec?: number | null;
  /** Profile: all-time feedback counts. */
  positive?: number | null;
  negative?: number | null;
  /** Profile: days since the account was registered. */
  registerDays?: number | null;
  /** Unix seconds "now" (for tenure). Defaults to the current time. */
  nowTs?: number;
};

type Part = "presence" | "tenure" | "feedback" | "release" | "accountAge";

export type ReliabilityParts = {
  /** Wilson lower bound, 0..1. */
  completionLB: number;
  /** 0..1 each; null when unknown. */
  volume: number;
  presence: number | null;
  tenure: number | null;
  feedback: number | null;
  release: number | null;
  accountAge: number | null;
  /** Points contributed by each part (after any rescaling). */
  points: { completion: number; volume: number } & Record<Part, number | null>;
};

export type Reliability = { score: number; parts: ReliabilityParts };

const unit = (v: number | null | undefined) =>
  v == null || !Number.isFinite(v) ? null : Math.max(0, Math.min(1, v));

export function reliabilityScore(input: ReliabilityInput): Reliability {
  const n = Math.max(0, input.orders30d ?? 0);
  const p = input.completionRate ?? 0;
  const completionLB = wilsonLowerBound(p, n);
  const volume = Math.min(1, Math.log10(1 + n) / Math.log10(VOLUME_SATURATION));
  const now = input.nowTs ?? Math.floor(Date.now() / 1000);
  const optional: Record<Part, number | null> = {
    presence: unit(input.presence7d),
    tenure:
      input.firstSeenTs == null || !(input.firstSeenTs > 0)
        ? null
        : unit((now - input.firstSeenTs) / (TENURE_FULL_DAYS * 86400)),
    feedback: feedbackScore(input.positive, input.negative),
    release: releaseScore(input.avgReleaseSec),
    accountAge:
      input.registerDays == null || input.registerDays < 0 ? null : unit(input.registerDays / ACCOUNT_AGE_FULL_DAYS),
  };

  const W = RELIABILITY_WEIGHTS;
  const parts = Object.keys(optional) as Part[];
  const known = W.completion + W.volume + parts.reduce((s, k) => s + (optional[k] != null ? W[k] : 0), 0);
  const scale = 100 / known;
  const pts = (k: Part) => (optional[k] != null ? W[k] * optional[k]! * scale : null);
  const points = {
    completion: W.completion * completionLB * scale,
    volume: W.volume * volume * scale,
    presence: pts("presence"),
    tenure: pts("tenure"),
    feedback: pts("feedback"),
    release: pts("release"),
    accountAge: pts("accountAge"),
  };
  const raw = points.completion + points.volume + parts.reduce((s, k) => s + (points[k] ?? 0), 0);
  return {
    score: Math.max(0, Math.min(100, Math.round(raw))),
    parts: { completionLB, volume, ...optional, points },
  };
}

/** Plain-language formula, shown in the "How it's calculated" popover. */
export const RELIABILITY_EXPLAINER = [
  "45 pts · completion, confidence-adjusted: the Wilson lower bound of the 30-day completion rate over the 30-day order count, so 15 orders at 100 % scores below 3,000 orders at 99.6 %.",
  "15 pts · volume: 30-day orders on a log scale, full marks at 2,000.",
  "15 pts · feedback: the same lower bound on positive ÷ all reviews, so a handful of reviews can't beat thousands.",
  "10 pts · release time: 30-day average, full marks at 2 min or less, none at 15 min.",
  "5 pts · presence: share of the last 7 days' tracked hours they had an ad up.",
  "5 pts · tenure: days since we first saw them, full marks at 90.",
  "5 pts · account age: days since they registered on the exchange, full marks at 2 years.",
  "Feedback, release time and account age come from the Binance profile; Bybit's needs a login. Any part we don't know is left out and the rest are rescaled to 100.",
] as const;
