import { and, eq, gte, inArray, notInArray, or, sql } from "drizzle-orm";
import { buildMarket } from "@/lib/analytics";
import { ASSET, FIAT, SLT_OFFSET_SEC } from "@/lib/constants";
import { schema, type Db } from "@/lib/db/client";
import type { AlertType } from "@/lib/db/schema";
import { deliverEmail, type MailEnv } from "@/lib/email/deliver";
import { alertFired } from "@/lib/email/templates";
import { deliverAlertPushes } from "@/lib/push/deliver";
import { getFlags } from "@/lib/flags";
import type { ExchangeId } from "@/lib/exchanges";
import type { MarketSnapshot, NormalizedAd } from "@/lib/types";
import { NEAR_BANDS, nearTouchDepth } from "@/lib/near-touch";
import { loadCbslLatest, loadGoogle, loadMids } from "@/lib/dollar-data";
import {
  CBSL_STALE_DAYS,
  GOOGLE_CORR_DAYS,
  GOOGLE_MIN_PAIRS,
  GOOGLE_STALE_SEC,
  cbslDayChange,
  dayTs,
  googleChange,
  googlePairs,
  lagGap,
  link,
  midAt,
  type Change,
  type DayPoint,
  type FxPoint,
  type Link,
  type MidPoint,
} from "@/lib/dollar-signals";

/**
 * Server-side alert engine. Runs once per cron tick, right after the book
 * jobs, against the books those jobs just fetched (passed in memory — never
 * refetches an exchange, never reads KV).
 *
 * D1 cost per tick:
 *   no enabled rules     → 1 indexed SELECT (rules ⋈ user)
 *   rules, none fire     → 1 SELECT
 *   some fire            → + 1 SELECT blocked merchants (only if an
 *                            offMarketAd rule is in play)
 *                          + 1 SELECT email throttle (only if an email is due)
 *   dollar rules due     → + 1 SELECT Google readings (last 3 h, ≤ 7 rows)
 *                          and/or 1 SELECT the last two CBSL days (LIMIT 2)
 *     …and one fires     → + 2 SELECTs for the message context (7 days of
 *                            Google readings and 5-min USDT mids)
 *                          + 1 db.batch (event INSERTs + lastFiredAt UPDATEs)
 * Emails are combined per user and throttled to one per user per 10 minutes.
 */

export type ExchangeBook = { buy: NormalizedAd[]; sell: NormalizedAd[] };
export type AlertEnv = { db: Db; mail: MailEnv & { BETTER_AUTH_URL?: string; NEXT_PUBLIC_SITE_URL?: string } };

const EMAIL_THROTTLE_SEC = 10 * 60;
/** Ads per side used for the offMarketAd reference average. */
const REF_N = 5;
/** Ads per side behind the legacy `depthBelow` sum (it always meant top 20). */
const LEGACY_TOP_N = 20;
/** Band for the per-side near-touch depth rules. */
export const DEPTH_RULE_BAND = NEAR_BANDS["1"];
/** D1 allows 100 bound parameters per statement. */
const MAX_PARAMS = 100;

const EX_NAME: Record<ExchangeId, string> = { binance: "Binance", bybit: "Bybit" };

export type RuleRow = {
  id: string;
  userId: string;
  exchange: ExchangeId;
  type: AlertType;
  threshold: number;
  label: string | null;
  email: boolean;
  cooldownSec: number;
  lastFiredAt: number | null;
  userEmail: string;
};

export type Fired = {
  rule: RuleRow;
  observed: number;
  detail: string;
};

const fmtPrice = (n: number) => n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtPct = (f: number) => `${(f * 100).toFixed(2)}%`;
const fmtAmt = (n: number) => n.toLocaleString("en-US", { maximumFractionDigits: 0 });

export function defaultLabel(r: Pick<RuleRow, "exchange" | "type" | "threshold">): string {
  const ex = EX_NAME[r.exchange];
  switch (r.type) {
    case "priceAbove":
      return `${ex} mid price above ${fmtPrice(r.threshold)}`;
    case "priceBelow":
      return `${ex} mid price below ${fmtPrice(r.threshold)}`;
    case "spreadAbove":
      return `${ex} spread above ${fmtPct(r.threshold)}`;
    case "spreadBelow":
      return `${ex} spread below ${fmtPct(r.threshold)}`;
    case "depthBelow":
      return `${ex} top-20 depth (both sides) below ${fmtAmt(r.threshold)} ${ASSET}`;
    case "askDepthBelow":
      return `${ex} sell ads within 1% of best below ${fmtAmt(r.threshold)} ${ASSET}`;
    case "bidDepthBelow":
      return `${ex} buy ads within 1% of best below ${fmtAmt(r.threshold)} ${ASSET} (declared)`;
    case "offMarketAd":
      return `${ex} ad ${fmtPct(r.threshold)} better than top-${REF_N}`;
    case "usdGoogleUp":
      return `Google USD/LKR up ≥ ${fmtPct(r.threshold)} in 2 h (USDT on ${ex})`;
    case "usdGoogleDown":
      return `Google USD/LKR down ≥ ${fmtPct(r.threshold)} in 2 h (USDT on ${ex})`;
    case "usdCbslUp":
      return `CBSL USD/LKR up ≥ ${fmtPct(r.threshold)} in a day (USDT on ${ex})`;
    case "usdCbslDown":
      return `CBSL USD/LKR down ≥ ${fmtPct(r.threshold)} in a day (USDT on ${ex})`;
  }
}

/* ── Dollar-rate rules ────────────────────────────────────────────────── */

export const DOLLAR_TYPES = ["usdGoogleUp", "usdGoogleDown", "usdCbslUp", "usdCbslDown"] as const satisfies readonly AlertType[];
const isGoogleType = (t: AlertType) => t === "usdGoogleUp" || t === "usdGoogleDown";
const isCbslType = (t: AlertType) => t === "usdCbslUp" || t === "usdCbslDown";
export const isDollarType = (t: AlertType) => isGoogleType(t) || isCbslType(t);

/** 2 h Google window. Readings are loaded a bit wider so the start matches. */
const GOOGLE_RULE_SEC = 2 * 3600;

export type DollarInputs = {
  /** Google readings of the last ~3 h, oldest first (null = not loaded). */
  google: FxPoint[] | null;
  /** The last two CBSL days, oldest first (null = not loaded). */
  cbsl: (DayPoint & { fetchedAt: number })[] | null;
  /** SLT date of `ts`. */
  today: string;
};

export type DollarTrigger = { change: Change; kind: "google" | "cbsl"; day?: string; prevDay?: string };

/**
 * Does a dollar rule fire on the stored data? Only on data that is current
 * and NEW since the rule last fired (a Google reading taken after
 * lastFiredAt; a CBSL day first seen after it), so one reading or one CBSL
 * rate fires a rule at most once, whatever the cooldown.
 */
export function dollarTrigger(rule: RuleRow, inp: DollarInputs, ts: number): DollarTrigger | null {
  const t = rule.threshold;
  const after = rule.lastFiredAt ?? -Infinity;
  if (isGoogleType(rule.type)) {
    const g = inp.google;
    const last = g?.[g.length - 1];
    if (!g || !last || ts - last.ts > GOOGLE_STALE_SEC || last.ts <= after) return null;
    const c = googleChange(g, GOOGLE_RULE_SEC);
    if (!c) return null;
    const hit = rule.type === "usdGoogleUp" ? c.pct >= t - 1e-12 : c.pct <= -t + 1e-12;
    return hit ? { change: c, kind: "google" } : null;
  }
  if (isCbslType(rule.type)) {
    const rows = inp.cbsl;
    if (!rows || rows.length < 2) return null;
    const latest = rows[rows.length - 1];
    if (latest.fetchedAt <= after) return null;
    if (dayTs(inp.today) - dayTs(latest.day) > CBSL_STALE_DAYS * 86400) return null;
    const c = cbslDayChange(rows);
    if (!c) return null;
    const hit = rule.type === "usdCbslUp" ? c.pct >= t - 1e-12 : c.pct <= -t + 1e-12;
    return hit ? { change: c, kind: "cbsl", day: c.day, prevDay: c.prevDay } : null;
  }
  return null;
}

export type DollarContext = {
  /** USDT mid now on the rule's exchange (from the fresh book). */
  usdtNow: number | null;
  /** 5-min USDT mids of the last ~8 days for that exchange. */
  mids: readonly MidPoint[];
  /** Measured Google ↔ USDT link for that exchange (7 days of 30-min moves). */
  link: Link | null;
};

const signed = (f: number) => `${f >= 0 ? "+" : "−"}${(Math.abs(f) * 100).toFixed(2)}%`;
const hmSlt = (ts: number) =>
  new Date((ts + SLT_OFFSET_SEC) * 1000).toISOString().slice(11, 16);

function linkClause(l: Link | null): string {
  if (!l) return "how closely it follows isn't measured yet";
  switch (l.verdict) {
    case "confirmed":
      return `historically it follows with beta ${(l.beta ?? 0).toFixed(2)} (r ${(l.r ?? 0).toFixed(2)}, last 7 days)`;
    case "collecting":
      return `how closely it follows isn't measured yet (${l.n} of ${l.min} readings)`;
    case "unclear":
      return `our data shows no clear link yet${l.r != null ? ` (r ${l.r.toFixed(2)})` : ""}`;
    case "contradicted":
      return `in our data it has not followed the dollar lately (r ${(l.r ?? 0).toFixed(2)})`;
  }
}

/** The message: dollar move, then how far USDT on the rule's exchange has followed. */
export function dollarDetail(rule: RuleRow, trig: DollarTrigger, ctx: DollarContext): string {
  const c = trig.change;
  const ex = EX_NAME[rule.exchange];
  if (trig.kind === "google") {
    const head = `Google USD/LKR ${fmtPrice(c.from)} → ${fmtPrice(c.to)} (${signed(c.pct)} in 2h, ${hmSlt(c.fromTs)}–${hmSlt(c.toTs)} SLT).`;
    const start = midAt(ctx.mids, c.fromTs);
    if (ctx.usdtNow == null || start == null) return `${head} USDT/LKR on ${ex}: no price at the start of the window to compare.`;
    const moved = ctx.usdtNow / start - 1;
    const lag = lagGap(c.pct, moved, ctx.link ?? { beta: null, verdict: "collecting" });
    const usdt = !lag.lagging
      ? `USDT/LKR on ${ex} has already moved ${signed(moved)}`
      : Math.abs(moved) < 0.0005
        ? `USDT/LKR on ${ex} hasn't moved yet (${signed(moved)})`
        : Math.sign(moved) !== Math.sign(c.pct)
          ? `USDT/LKR on ${ex} has gone the other way so far (${signed(moved)})`
          : `USDT/LKR on ${ex} has moved only ${signed(moved)} so far`;
    return `${head} ${usdt} — ${linkClause(ctx.link)}. An estimate, not advice.`;
  }
  const day = (d?: string) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }) : "");
  const head = `CBSL indicative USD/LKR ${fmtPrice(c.from)} → ${fmtPrice(c.to)} (${signed(c.pct)}, ${day(trig.day)} vs ${day(trig.prevDay)}).`;
  // USDT now vs its average over the previous CBSL day (SLT).
  const prev = trig.prevDay ? dayTs(trig.prevDay) : null;
  const dayMids = prev == null ? [] : ctx.mids.filter((m) => m.ts > prev && m.ts <= prev + 86400).map((m) => m.mid);
  const prevAvg = dayMids.length ? dayMids.reduce((a, b) => a + b, 0) / dayMids.length : null;
  const usdt =
    ctx.usdtNow != null && prevAvg != null
      ? ` USDT/LKR on ${ex} is ${fmtPrice(ctx.usdtNow)}, ${signed(ctx.usdtNow / prevAvg - 1)} vs its ${day(trig.prevDay)} average.`
      : "";
  return `${head}${usdt} CBSL is a slow official rate: context, not a trigger. Not advice.`;
}

/** Market-level rules. price = mid of best bid/ask, spread = spreadPct
 *  (fraction). `depthBelow` (legacy) = total available on both sides of the
 *  top-20 book in `snap`. `askDepthBelow` / `bidDepthBelow` = near-touch depth
 *  of ONE side within 1 % of that side's best price, from `book` (falls back
 *  to the ads in `snap`). */
export function evalMarketRule(rule: RuleRow, snap: MarketSnapshot, book?: ExchangeBook): Fired | null {
  const t = rule.threshold;
  switch (rule.type) {
    case "priceAbove":
    case "priceBelow": {
      const m = snap.mid;
      if (m == null) return null;
      const hit = rule.type === "priceAbove" ? m > t : m < t;
      return hit
        ? { rule, observed: m, detail: `Mid price ${fmtPrice(m)} ${FIAT.code} ${rule.type === "priceAbove" ? ">" : "<"} ${fmtPrice(t)}` }
        : null;
    }
    case "spreadAbove":
    case "spreadBelow": {
      const s = snap.spreadPct;
      if (s == null) return null;
      const hit = rule.type === "spreadAbove" ? s > t : s < t;
      return hit
        ? { rule, observed: s, detail: `Spread ${fmtPct(s)} ${rule.type === "spreadAbove" ? ">" : "<"} ${fmtPct(t)}` }
        : null;
    }
    case "depthBelow": {
      if (snap.buy.count + snap.sell.count === 0) return null; // empty book = no data, not "no depth"
      const d = snap.buy.totalAvailable + snap.sell.totalAvailable;
      return d < t
        ? { rule, observed: d, detail: `Top-20 depth, both sides, ${fmtAmt(d)} ${ASSET} < ${fmtAmt(t)}` }
        : null;
    }
    case "askDepthBelow":
    case "bidDepthBelow": {
      const side = rule.type === "askDepthBelow" ? "SELL" : "BUY";
      const ads = book ? (side === "SELL" ? book.sell : book.buy) : snap.ads;
      // An empty side is "no data", not "no depth" — same rule as above.
      if (!ads.some((a) => a.tradeType === side)) return null;
      const d = nearTouchDepth(ads, side, DEPTH_RULE_BAND);
      if (d.usdt >= t) return null;
      const name = side === "SELL" ? "Sell ads (you buy USDT)" : "Buy ads (you sell USDT, declared)";
      return {
        rule,
        observed: d.usdt,
        detail: `${name} within 1% of the best price: ${fmtAmt(d.usdt)} ${ASSET} across ${d.ads} ad${d.ads === 1 ? "" : "s"} < ${fmtAmt(t)}`,
      };
    }
    default:
      return null;
  }
}

/**
 * Taker signal. For each side, rank ads best-first (BUY side = advertiser
 * buys USDT, best = highest; SELL side = advertiser sells, best = lowest).
 * An ad fires when it beats the average of the top-5 *other* ads on its side
 * by at least `threshold` (fraction). The user's blocked merchants are left
 * out of both the candidates and the reference average. Returns the single
 * most off-market ad across both sides.
 */
export function evalOffMarket(rule: RuleRow, book: ExchangeBook, blocked: Set<string> | undefined): Fired | null {
  let best: { ad: NormalizedAd; ref: number; edge: number } | null = null;
  for (const side of ["SELL", "BUY"] as const) {
    const ads = (side === "SELL" ? book.sell : book.buy)
      // Skip ads that can't fill their own minimum order (not really tradable).
      .filter((a) => a.tradeType === side && a.price > 0 && a.available > 0 && a.available * a.price >= a.minOrder)
      .filter((a) => !blocked?.has(`${rule.exchange}:${a.merchant.id}`))
      .sort((a, b) => (side === "SELL" ? a.price - b.price : b.price - a.price));
    if (ads.length < 2) continue;
    for (let i = 0; i < Math.min(ads.length, REF_N); i++) {
      const others = ads.filter((_, j) => j !== i).slice(0, REF_N);
      const ref = others.reduce((s, a) => s + a.price, 0) / others.length;
      const p = ads[i].price;
      const edge = side === "SELL" ? (ref - p) / ref : (p - ref) / ref;
      if (edge >= rule.threshold && (!best || edge > best.edge)) best = { ad: ads[i], ref, edge };
    }
  }
  if (!best) return null;
  const { ad, ref, edge } = best;
  const verb = ad.tradeType === "SELL" ? "selling" : "buying";
  const dir = ad.tradeType === "SELL" ? "below" : "above";
  return {
    rule,
    observed: ad.price,
    detail:
      `${ad.merchant.name || "Unknown merchant"} ${verb} ${ASSET} at ${fmtPrice(ad.price)} ${FIAT.code} ` +
      `(${fmtPct(edge)} ${dir} top-${REF_N} avg ${fmtPrice(ref)}), ${fmtAmt(ad.available)} ${ASSET} available` +
      (ad.maxOrder ? `, limit ${fmtAmt(ad.minOrder)}–${fmtAmt(ad.maxOrder)} ${FIAT.code}` : ""),
  };
}

/** Cooldown: a rule is due when it has never fired, or at least
 *  `cooldownSec` has passed since it last did. */
export function isRuleDue(rule: Pick<RuleRow, "lastFiredAt" | "cooldownSec">, ts: number): boolean {
  return rule.lastFiredAt == null || ts - rule.lastFiredAt >= rule.cooldownSec;
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

export async function evaluateAlerts(
  env: AlertEnv,
  books: Partial<Record<ExchangeId, ExchangeBook>>,
  ts: number,
): Promise<{ rows: number }> {
  const exchanges = (Object.keys(books) as ExchangeId[]).filter((e) => books[e]);
  if (exchanges.length === 0) return { rows: 0 };
  const { db } = env;
  const r = schema.alertRules;
  const u = schema.user;

  // 1. Every enabled rule for the fresh books, members only. Uses
  //    ix_alert_rules_enabled (enabled, exchange); user is joined by PK.
  const rules: RuleRow[] = await db
    .select({
      id: r.id,
      userId: r.userId,
      exchange: r.exchange,
      type: r.type,
      threshold: r.threshold,
      label: r.label,
      email: r.email,
      cooldownSec: r.cooldownSec,
      lastFiredAt: r.lastFiredAt,
      userEmail: u.email,
    })
    .from(r)
    .innerJoin(u, eq(u.id, r.userId))
    .where(
      and(
        eq(r.enabled, true),
        inArray(r.exchange, exchanges),
        eq(r.asset, ASSET),
        eq(r.fiat, FIAT.code),
        or(eq(u.status, "approved"), and(eq(u.role, "admin"), notInArray(u.status, ["suspended", "rejected"]))),
      ),
    );

  const due = rules.filter((x) => isRuleDue(x, ts));
  if (due.length === 0) return { rows: 0 };

  // Books arrive up to 100 deep; the snapshot keeps the top-20 meaning the
  // price / spread / legacy depth rules have always had.
  const snaps = new Map<ExchangeId, MarketSnapshot>();
  for (const ex of exchanges) {
    const b = books[ex]!;
    snaps.set(ex, buildMarket(ASSET, FIAT.code, [...b.buy.slice(0, LEGACY_TOP_N), ...b.sell.slice(0, LEGACY_TOP_N)]));
  }

  // 2. Blocked merchants, only for users with an offMarketAd rule due.
  const offUsers = [...new Set(due.filter((x) => x.type === "offMarketAd").map((x) => x.userId))];
  const blocked = new Map<string, Set<string>>();
  for (const ids of chunk(offUsers, MAX_PARAMS - 1)) {
    const rows = await db
      .select({ userId: schema.userItems.userId, itemKey: schema.userItems.itemKey })
      .from(schema.userItems)
      .where(and(eq(schema.userItems.kind, "blocked_merchant"), inArray(schema.userItems.userId, ids)));
    for (const row of rows) {
      let s = blocked.get(row.userId);
      if (!s) blocked.set(row.userId, (s = new Set()));
      s.add(row.itemKey);
    }
  }

  const fired: Fired[] = [];
  for (const rule of due) {
    if (isDollarType(rule.type)) continue;
    const f =
      rule.type === "offMarketAd"
        ? evalOffMarket(rule, books[rule.exchange]!, blocked.get(rule.userId))
        : evalMarketRule(rule, snaps.get(rule.exchange)!, books[rule.exchange]);
    if (f) fired.push(f);
  }

  // 2b. Dollar rules: read Google / CBSL only when such rules are due.
  const dollarDue = due.filter((x) => isDollarType(x.type));
  if (dollarDue.length > 0) {
    try {
      fired.push(...(await evalDollarRules(db, dollarDue, snaps, ts)));
    } catch (err) {
      console.warn(`[alerts] dollar rules failed: ${(err as Error).message}`);
    }
  }
  if (fired.length === 0) return { rows: 0 };

  // 3. Email: one combined message per user, at most one per 10 minutes.
  // The `alertEmails` feature flag (/admin/system) can switch email off;
  // events are still recorded below.
  const emailOn = (await getFlags(env.mail)).alertEmails;
  const emailUsers = emailOn ? [...new Set(fired.filter((f) => f.rule.email).map((f) => f.rule.userId))] : [];
  const emailedUsers = new Set<string>();
  if (emailUsers.length > 0) {
    try {
      const recent = new Set<string>();
      for (const ids of chunk(emailUsers, MAX_PARAMS - 2)) {
        const rows = await db
          .selectDistinct({ userId: schema.alertEvents.userId })
          .from(schema.alertEvents)
          .where(
            and(
              inArray(schema.alertEvents.userId, ids),
              gte(schema.alertEvents.ts, ts - EMAIL_THROTTLE_SEC),
              eq(schema.alertEvents.emailed, true),
            ),
          );
        for (const row of rows) recent.add(row.userId);
      }
      const base = (env.mail.BETTER_AUTH_URL || env.mail.NEXT_PUBLIC_SITE_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
      await Promise.all(
        emailUsers
          .filter((id) => !recent.has(id))
          .map(async (userId) => {
            const mine = fired.filter((f) => f.rule.userId === userId && f.rule.email);
            const to = mine[0].rule.userEmail;
            try {
              await deliverEmail(
                alertFired(to, mine.map((f) => ({ label: f.rule.label || defaultLabel(f.rule), detail: f.detail })), `${base}/alerts`),
                env.mail,
              );
              emailedUsers.add(userId);
            } catch (err) {
              console.warn(`[alerts] email to user ${userId} failed: ${(err as Error).message}`);
            }
          }),
      );
    } catch (err) {
      // Never let mail (or the throttle lookup) break the tick.
      console.warn(`[alerts] email step failed: ${(err as Error).message}`);
    }
  }

  // 4. One batch: event INSERTs (chunked to the param limit) + lastFiredAt.
  const events = fired.map((f) => ({
    id: crypto.randomUUID(),
    userId: f.rule.userId,
    ruleId: f.rule.id,
    ruleLabel: f.rule.label || defaultLabel(f.rule),
    exchange: f.rule.exchange,
    type: f.rule.type,
    observed: f.observed,
    threshold: f.rule.threshold,
    detail: f.detail,
    ts,
    read: false,
    emailed: f.rule.email && emailedUsers.has(f.rule.userId),
  }));
  const perInsert = Math.floor(MAX_PARAMS / Object.keys(events[0]).length);
  const statements = [
    ...chunk(events, perInsert).map((rows) => db.insert(schema.alertEvents).values(rows)),
    ...chunk(
      fired.map((f) => f.rule.id),
      MAX_PARAMS - 1,
    ).map((ids) => db.update(r).set({ lastFiredAt: ts }).where(inArray(r.id, ids))),
  ];
  await db.batch(statements as [(typeof statements)[number], ...typeof statements]);

  // 5. Web Push to every device of each member with a fired rule. Runs after
  //    the events are stored, never throws, and isn't tied to the email
  //    flag or per-rule email setting (lib/push/deliver.ts).
  const pushUsers = [...new Set(fired.map((f) => f.rule.userId))];
  await Promise.all(
    pushUsers.map((userId) =>
      deliverAlertPushes(
        env.mail,
        db,
        userId,
        fired
          .filter((f) => f.rule.userId === userId)
          .map((f) => ({ label: f.rule.label || defaultLabel(f.rule), detail: f.detail })),
      ),
    ),
  );
  return { rows: events.length };
}

/** Dollar rules: 1–2 small reads; 2 more only when one actually fires. */
async function evalDollarRules(
  db: Db,
  rules: RuleRow[],
  snaps: Map<ExchangeId, MarketSnapshot>,
  ts: number,
): Promise<Fired[]> {
  const needGoogle = rules.some((r) => isGoogleType(r.type));
  const needCbsl = rules.some((r) => isCbslType(r.type));
  const [google, cbsl] = await Promise.all([
    needGoogle ? loadGoogle(db, ts - GOOGLE_RULE_SEC - 3600) : null,
    needCbsl ? loadCbslLatest(db) : null,
  ]);
  const today = new Date((ts + SLT_OFFSET_SEC) * 1000).toISOString().slice(0, 10);
  const hits = rules
    .map((rule) => ({ rule, trig: dollarTrigger(rule, { google, cbsl, today }, ts) }))
    .filter((h): h is { rule: RuleRow; trig: DollarTrigger } => h.trig != null);
  if (hits.length === 0) return [];

  // Context for the message (rare: only when a rule fired).
  const since = ts - (GOOGLE_CORR_DAYS + 1) * 86400;
  const exs = [...new Set(hits.map((h) => h.rule.exchange))];
  const anyGoogle = hits.some((h) => h.trig.kind === "google");
  const [history, mids] = await Promise.all([anyGoogle ? loadGoogle(db, since) : null, loadMids(db, exs, since)]);
  // Beta from the 7 days before the 2 h window being reported (see googlePairs).
  const linkFor = (e: ExchangeId, until: number) =>
    history ? link(googlePairs(history, mids[e], ts - GOOGLE_CORR_DAYS * 86400, until), GOOGLE_MIN_PAIRS) : null;
  return hits.map(({ rule, trig }) => ({
    rule,
    observed: Math.abs(trig.change.pct),
    detail: dollarDetail(rule, trig, {
      usdtNow: snaps.get(rule.exchange)?.mid ?? null,
      mids: mids[rule.exchange] ?? [],
      link: trig.kind === "google" ? linkFor(rule.exchange, trig.change.fromTs) : null,
    }),
  }));
}

/** Nightly retention SQL for alert_events: 30 days, and at most 500 per user. */
export const ALERT_EVENTS_MAX_AGE_SEC = 30 * 86400;
export const ALERT_EVENTS_MAX_PER_USER = 500;

export function alertRetentionSql(nowTs: number) {
  return [
    sql`DELETE FROM alert_events WHERE ts < ${nowTs - ALERT_EVENTS_MAX_AGE_SEC}`,
    sql`DELETE FROM alert_events WHERE id IN (
          SELECT id FROM (
            SELECT id, row_number() OVER (PARTITION BY user_id ORDER BY ts DESC, id) AS rn
            FROM alert_events
            WHERE user_id IN (SELECT user_id FROM alert_events GROUP BY user_id HAVING count(*) > ${ALERT_EVENTS_MAX_PER_USER})
          ) WHERE rn > ${ALERT_EVENTS_MAX_PER_USER})`,
  ];
}
