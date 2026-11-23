import { median, robustZ } from "@/lib/stats";
import { link, type Link } from "@/lib/dollar-signals";

/**
 * Gold vs USDT: pure maths (no DB), so every number can be unit tested.
 *
 * ── Owner's idea ───────────────────────────────────────────────────────
 * A Sri Lankan pawn (8 g) of 24K gold costs X LKR in Colombo and Y AED in
 * Dubai. Turn Y into LKR through USDT (the dirham is pegged at 3.6725 per
 * USD) and compare:
 *   Dubai cheaper than Colombo → people buy USDT to buy gold abroad →
 *   USDT/LKR may go UP; Dubai dearer → USDT/LKR may go DOWN.
 * As one rate: the gold-implied USDT/LKR = X ÷ (Y_gram × 8) × 3.6725, and
 * the gap = implied ÷ P2P − 1 (= Colombo ÷ Dubai − 1). `goldView`.
 *
 * ── Fact check (22 Nov 2026, lib/gold/sources.ts) ──────────────────────
 * 1. 426.5 × 8 = 3,412 AED (not 3,416); 353 ÷ 3.6725 = 96.12 LKR/AED (not
 *    96.5) → a Dubai pawn at USDT 353 is ≈ 327,961 LKR. Devi's 345,000 was
 *    the 20 Nov price; 21 Nov is 342,000.
 * 2. Colombo is ALWAYS dearer: legal imports pay 15 % duty + 18 % VAT +
 *    2.5 % SSCL, so supply is smuggled/recycled and the premium settles at
 *    the cost of that. Over Jun–Nov 2026 Colombo sat a median +4.9 % over
 *    world spot at the CBSL rate. "UAE cheaper → USDT up" would fire every
 *    single day, so the raw sign is not a signal.
 * 3. Dubai's board rate is just world spot + ≈ 2 %, so world spot (PAXG)
 *    is the anchor: it updates every minute and has daily history.
 * 4. Colombo reprices slowly (once per business day, 1,000-LKR steps): over
 *    the 6 months the premium correlates −0.51 with spot's 10-day change.
 *    When spot drops fast the premium balloons for a week with no dollar
 *    pressure at all. So the premium is lag-corrected first.
 *
 * ── The signal ─────────────────────────────────────────────────────────
 *   premium_d  = Devi 24K ÷ (spot_d per pawn × CBSL USD/LKR_d) − 1
 *   adjusted_d = premium_d − β × ln(spot_d ÷ spot_{d−14})   (β fitted, ≈ −0.4)
 *   dev        = adjusted − median(adjusted, previous 60 days)
 * dev > 0 → Colombo unusually dear vs the world → informal dollar demand →
 * USDT pressure UP; dev < 0 → DOWN. No USDT inside the formula, so the
 * back-test (`goldLink`: dev on day d vs USDT d → next day) cannot be fooled
 * by USDT's own mean reversion. Nothing is called predictive until that
 * back-test is clear.
 */

/** One Sri Lankan pawn / sovereign, in grams. */
export const PAWN_G = 8;
/** UAE dirham peg: AED per USD (USDT/AED trades at 3.68–3.70 on P2P). */
export const AED_PER_USD = 3.6725;
/** Grams in a troy ounce. */
export const TROY_OZ_G = 31.1034768;

/** Lag correction: spot change over this many calendar days. */
export const LAG_DAYS = 14;
/** β fallback (fitted on Jun–Nov 2026) and the sample needed to refit it. */
export const LAG_BETA_DEFAULT = -0.4;
export const LAG_BETA_MIN_DAYS = 40;
/** Baseline = median adjusted premium over the previous 60 business days. */
export const BASELINE_DAYS = 60;
export const BASELINE_MIN_DAYS = 30;
/** Robust-z scale floor: 0.5 % (one Devi step is ≈ 0.3 %). */
export const DEV_MIN_SCALE = 0.005;
/** Signal: "watch" from |z| 1.5 and 1 pt; "strong" from |z| 2 and 1.5 pt. */
export const GOLD_SIGNAL = { z: 1.5, dev: 0.01, strongZ: 2, strongDev: 0.015 } as const;
/** Devi publishes business days; older than this = stale (weekend + holiday). */
export const DEVI_STALE_DAYS = 4;
/** Back-test sample before a verdict is shown. */
export const LINK_MIN_DAYS = 30;

/* ── Plausibility bands (a parse that lands outside is a broken page) ── */

/** 24K / 22K per gram in AED. */
export const plausibleUaeGram = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 100 && v < 5_000;
/** 24K / 22K per pawn in LKR (per-gram values, ≈ 40k, fall below). */
export const plausibleSlPawn = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 100_000 && v < 5_000_000;
/** Gold spot per troy ounce in USD. */
export const plausibleSpotOz = (v: number | null | undefined): v is number =>
  v != null && Number.isFinite(v) && v > 500 && v < 50_000;

const pos = (v: number | null | undefined): v is number => v != null && Number.isFinite(v) && v > 0;

/* ── Live snapshot: the owner's worked example ───────────────────────── */

export type GoldInputs = {
  /** UAE (Dubai) retail per gram, AED. */
  uaeGramAed: number | null;
  /** Sri Lanka per pawn (8 g), LKR, same karat. */
  slPawnLkr: number | null;
  /** World spot per troy ounce in USD(T) (PAXG). */
  spotUsdOz?: number | null;
  /** USDT/LKR P2P mid. */
  usdtLkr: number | null;
  /** 24 or 22 — scales the spot benchmark (spot is 24K). */
  karat?: 24 | 22;
};

export type GoldView = {
  /** 8 g in Dubai: AED, USDT (÷ 3.6725), LKR through the P2P rate. */
  dubaiPawnAed: number | null;
  dubaiPawnUsdt: number | null;
  dubaiPawnLkr: number | null;
  /** Colombo − Dubai, LKR per pawn (positive = Dubai cheaper). */
  gapLkr: number | null;
  /** USDT/LKR at which a pawn costs the same in Colombo and Dubai. */
  impliedUae: number | null;
  /** Colombo ÷ Dubai − 1 = impliedUae ÷ USDT − 1. */
  premiumUae: number | null;
  /** 8 g of world spot (karat-scaled) in USDT. */
  spotPawnUsdt: number | null;
  /** USDT/LKR at which Colombo equals world spot. */
  impliedSpot: number | null;
  /** Colombo ÷ world spot − 1, through USDT. */
  premiumSpot: number | null;
  /** Dubai board ÷ world spot − 1 (normally ≈ +2 %). */
  uaeOverSpot: number | null;
};

export function goldView(i: GoldInputs): GoldView {
  const uae = plausibleUaeGram(i.uaeGramAed) ? i.uaeGramAed : null;
  const sl = plausibleSlPawn(i.slPawnLkr) ? i.slPawnLkr : null;
  const spot = plausibleSpotOz(i.spotUsdOz) ? i.spotUsdOz : null;
  const usdt = pos(i.usdtLkr) ? i.usdtLkr : null;
  const purity = (i.karat ?? 24) / 24;

  const dubaiPawnAed = uae != null ? uae * PAWN_G : null;
  const dubaiPawnUsdt = dubaiPawnAed != null ? dubaiPawnAed / AED_PER_USD : null;
  const dubaiPawnLkr = dubaiPawnUsdt != null && usdt != null ? dubaiPawnUsdt * usdt : null;
  const impliedUae = sl != null && dubaiPawnUsdt != null ? sl / dubaiPawnUsdt : null;
  const spotPawnUsdt = spot != null ? (spot / TROY_OZ_G) * PAWN_G * purity : null;
  const impliedSpot = sl != null && spotPawnUsdt != null ? sl / spotPawnUsdt : null;
  return {
    dubaiPawnAed,
    dubaiPawnUsdt,
    dubaiPawnLkr,
    gapLkr: sl != null && dubaiPawnLkr != null ? sl - dubaiPawnLkr : null,
    impliedUae,
    premiumUae: impliedUae != null && usdt != null ? impliedUae / usdt - 1 : null,
    spotPawnUsdt,
    impliedSpot,
    premiumSpot: impliedSpot != null && usdt != null ? impliedSpot / usdt - 1 : null,
    uaeOverSpot: dubaiPawnUsdt != null && spotPawnUsdt != null ? dubaiPawnUsdt / spotPawnUsdt - 1 : null,
  };
}

/* ── Daily series: premium over world spot, lag-corrected ────────────── */

/** One Devi business day with the spot and official rate of that day. */
export type GoldDayInput = {
  day: string;
  /** Devi 24K, LKR per pawn. */
  sl24: number;
  /** Spot USD/oz at the start of the day (UTC open ≈ 05:30 SLT, before Devi sets its price). */
  spot: number | null;
  /** Spot USD/oz LAG_DAYS earlier. */
  spotPast: number | null;
  /** CBSL indicative USD/LKR (latest business day ≤ day). */
  official: number | null;
};

export type GoldDay = {
  day: string;
  /** Colombo ÷ (world spot × official rate) − 1. */
  premium: number;
  /** ln(spot ÷ spot 14 days earlier). */
  spotChg: number;
};

export function goldDays(rows: readonly GoldDayInput[]): GoldDay[] {
  const out: GoldDay[] = [];
  for (const r of rows) {
    if (!plausibleSlPawn(r.sl24) || !plausibleSpotOz(r.spot) || !plausibleSpotOz(r.spotPast) || !pos(r.official)) continue;
    const spotPawnLkr = (r.spot / TROY_OZ_G) * PAWN_G * r.official;
    out.push({ day: r.day, premium: r.sl24 / spotPawnLkr - 1, spotChg: Math.log(r.spot / r.spotPast) });
  }
  return out.sort((a, b) => (a.day < b.day ? -1 : 1));
}

/** OLS slope of premium on spot change (the Devi lag), clamped to [−1, 0];
 *  the default until LAG_BETA_MIN_DAYS days exist. */
export function lagBeta(days: readonly GoldDay[]): { beta: number; fitted: boolean; n: number } {
  const n = days.length;
  if (n < LAG_BETA_MIN_DAYS) return { beta: LAG_BETA_DEFAULT, fitted: false, n };
  let mx = 0;
  let my = 0;
  for (const d of days) {
    mx += d.spotChg;
    my += d.premium;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (const d of days) {
    sxx += (d.spotChg - mx) ** 2;
    sxy += (d.spotChg - mx) * (d.premium - my);
  }
  if (sxx <= 0) return { beta: LAG_BETA_DEFAULT, fitted: false, n };
  return { beta: Math.max(-1, Math.min(0, sxy / sxx)), fitted: true, n };
}

export type GoldDevDay = GoldDay & {
  adjusted: number;
  /** Median adjusted premium of the previous BASELINE_DAYS (null while collecting). */
  baseline: number | null;
  dev: number | null;
  z: number | null;
  /** Days in the baseline sample. */
  n: number;
};

/** Adjusted premium, rolling baseline and robust z for every day. */
export function goldDeviations(days: readonly GoldDay[], beta: number): GoldDevDay[] {
  const adj = days.map((d) => d.premium - beta * d.spotChg);
  return days.map((d, i) => {
    const prior = adj.slice(Math.max(0, i - BASELINE_DAYS), i);
    const n = prior.length;
    if (n < BASELINE_MIN_DAYS) return { ...d, adjusted: adj[i], baseline: null, dev: null, z: null, n };
    const baseline = median(prior) as number;
    return { ...d, adjusted: adj[i], baseline, dev: adj[i] - baseline, z: robustZ(prior, adj[i], DEV_MIN_SCALE), n };
  });
}

/* ── Signal ──────────────────────────────────────────────────────────── */

export type GoldSignal = {
  /** Expected USDT direction. */
  direction: "up" | "down";
  strength: "watch" | "strong";
  level: "info" | "warn" | "alert";
  /** False until our own USDT history backs the link. */
  validated: boolean;
  day: GoldDevDay;
};

/**
 * Colombo unusually dear vs world gold (after the lag correction) → USDT
 * may rise; unusually cheap → may fall. Watch: |z| ≥ 1.5 and |dev| ≥ 1 pt;
 * strong: |z| ≥ 2 and |dev| ≥ 1.5 pt. Level: info until the back-test
 * confirms the link, then warn (watch) / alert (strong). Nothing when the
 * Devi price is stale or the data contradicts the idea.
 */
export function goldSignal(d: GoldDevDay | null, l: Pick<Link, "verdict">, stale: boolean): GoldSignal | null {
  if (!d || stale || d.dev == null || d.z == null) return null;
  if (l.verdict === "contradicted") return null;
  const a = Math.abs(d.dev);
  const z = Math.abs(d.z);
  if (a < GOLD_SIGNAL.dev - 1e-12 || z < GOLD_SIGNAL.z) return null;
  const strength = a >= GOLD_SIGNAL.strongDev - 1e-12 && z >= GOLD_SIGNAL.strongZ ? "strong" : "watch";
  const validated = l.verdict === "confirmed";
  const level = !validated ? "info" : strength === "strong" ? "alert" : "warn";
  return { direction: d.dev > 0 ? "up" : "down", strength, level, validated, day: d };
}

/* ── Back-tests ──────────────────────────────────────────────────────── */

const daysBetween = (a: string, b: string) =>
  Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / 86_400_000);

/** x = dev on day d, y = series change from d to the next day it has (≤ 3 days). */
export function forwardPairs(devs: readonly GoldDevDay[], series: ReadonlyMap<string, number>) {
  const keys = [...series.keys()].sort();
  const pairs: { x: number; y: number }[] = [];
  for (const d of devs) {
    if (d.dev == null) continue;
    const a = series.get(d.day);
    const next = keys.find((k) => k > d.day);
    if (!pos(a) || !next || daysBetween(d.day, next) > 3) continue;
    const b = series.get(next);
    if (!pos(b)) continue;
    pairs.push({ x: d.dev, y: b / a - 1 });
  }
  return pairs;
}

/** Does the gold deviation lead USDT? Positive and clear (t ≥ 2) = yes. */
export function goldLink(devs: readonly GoldDevDay[], usdtDaily: ReadonlyMap<string, number>, min = LINK_MIN_DAYS): Link {
  return link(forwardPairs(devs, usdtDaily), min);
}

/** The other way the gap can close: Colombo gold itself moving next day.
 *  Negative and clear = the gap closes on the gold side, not through USDT. */
export function goldSideLink(devs: readonly GoldDevDay[], sl24: ReadonlyMap<string, number>, min = LINK_MIN_DAYS): Link {
  return link(forwardPairs(devs, sl24), min);
}

/* ── Predicted rate ──────────────────────────────────────────────────── */

/** 90 % band: ±1.645 residual standard deviations. */
export const FORECAST_Z = 1.645;

export type GoldForecast = {
  /** Predicted USDT/LKR at the next business day. */
  rate: number;
  low: number;
  high: number;
  /** Predicted change (fraction). */
  change: number;
  /** Days the fit was made on. */
  n: number;
};

/**
 * Next-day USDT/LKR from today's gold deviation, fitted on OUR OWN pairs
 * (dev on day d → USDT change d → next day): change = a + b·dev, band from
 * the residual spread. Only once the link is confirmed (≥ LINK_MIN_DAYS
 * pairs, clearly positive) — before that there is no rate to give, only
 * a direction.
 */
export function goldForecast(
  dev: number | null,
  pairs: readonly { x: number; y: number }[],
  l: Pick<Link, "verdict">,
  usdtNow: number | null,
): GoldForecast | null {
  if (dev == null || !pos(usdtNow) || l.verdict !== "confirmed") return null;
  const n = pairs.length;
  if (n < LINK_MIN_DAYS) return null;
  let mx = 0;
  let my = 0;
  for (const p of pairs) {
    mx += p.x;
    my += p.y;
  }
  mx /= n;
  my /= n;
  let sxx = 0;
  let sxy = 0;
  for (const p of pairs) {
    sxx += (p.x - mx) ** 2;
    sxy += (p.x - mx) * (p.y - my);
  }
  if (sxx <= 0) return null;
  const b = sxy / sxx;
  const a = my - b * mx;
  let sse = 0;
  for (const p of pairs) sse += (p.y - (a + b * p.x)) ** 2;
  const sd = Math.sqrt(sse / Math.max(1, n - 2));
  const change = a + b * dev;
  return {
    rate: usdtNow * (1 + change),
    low: usdtNow * (1 + change - FORECAST_Z * sd),
    high: usdtNow * (1 + change + FORECAST_Z * sd),
    change,
    n,
  };
}
