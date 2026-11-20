import { and, desc, eq, gte, inArray, sql } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { ExchangeId } from "@/lib/exchanges";
import { ACTIVE_SLACK_SEC, type KnownMerchantInput } from "@/lib/analytics";
import { profileStatsMap, type ProfileStats } from "./trade-activity";

/**
 * Reads for the merchant directory and the reliability score (D7):
 * every known merchant from the full 10-minute sweep (`merchants`), with
 * first-seen time (tenure) and hours listed in the last 7 days (presence,
 * from `merchant_hourly`).
 */

const WEEK = 7 * 86400;
/** D1 caps bound parameters at 100 per statement. */
const MAX_IDS = 90;

export type MerchantDirectoryData = {
  known: KnownMerchantInput[];
  latestSweepTs: number | null;
  /** Distinct hours with any merchant data in the last 7 days (presence denominator). */
  trackedHours7d: number;
};

async function presence(ex: ExchangeId, asset: string, fiat: string, ids?: string[]) {
  const h = schema.merchantHourly;
  const db = await getDb();
  const since = Math.floor(Date.now() / 1000) - WEEK;
  const market = and(eq(h.exchange, ex), eq(h.asset, asset), eq(h.fiat, fiat), gte(h.hourTs, since));
  const [perMerchant, [tracked]] = await Promise.all([
    db
      .select({ merchantId: h.merchantId, hours: sql<number>`count(*)` })
      .from(h)
      .where(and(market, sql`${h.samples} > 0`, ids ? inArray(h.merchantId, ids) : undefined))
      .groupBy(h.merchantId),
    db.select({ hours: sql<number>`count(distinct ${h.hourTs})` }).from(h).where(market),
  ]);
  return {
    hours: new Map(perMerchant.map((r) => [r.merchantId, Number(r.hours)])),
    tracked: Number(tracked?.hours ?? 0),
  };
}

/** Every merchant ever seen on this market, plus presence and the latest sweep time. */
export async function merchantDirectoryData(
  ex: ExchangeId,
  asset: string,
  fiat: string,
): Promise<MerchantDirectoryData> {
  const m = schema.merchants;
  const db = await getDb();
  const [rows, pres, profiles] = await Promise.all([
    db
      .select()
      .from(m)
      .where(and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat)))
      .orderBy(desc(m.lastSeenTs)),
    presence(ex, asset, fiat).catch(() => ({ hours: new Map<string, number>(), tracked: 0 })),
    profileStatsMap(ex).catch(() => new Map<string, ProfileStats>()),
  ]);
  const known: KnownMerchantInput[] = rows.map((r) => ({
    ...profileFields(profiles.get(r.merchantId)),
    merchantId: r.merchantId,
    merchantName: r.merchantName,
    lastSeenTs: r.lastSeenTs,
    firstSeenTs: r.firstSeenTs,
    presenceHours: pres.tracked > 0 ? (pres.hours.get(r.merchantId) ?? 0) : null,
    isMerchant: r.isMerchant,
    userIdentity: r.userIdentity,
    userGrade: r.userGrade,
    vipLevel: r.vipLevel,
    ordersMonth: r.ordersMonth,
    completionRate: r.completionRate,
    // Profile (Binance Trade Info) first; ads rarely carry it.
    avgReleaseSec: profiles.get(r.merchantId)?.avgReleaseSec ?? r.avgReleaseSec,
    buyAds: r.buyAds,
    sellAds: r.sellAds,
    bestBuyPrice: r.bestBuyPrice,
    bestSellPrice: r.bestSellPrice,
    totalAvailableFiat: r.totalAvailableFiat,
  }));
  const latestSweepTs = rows.reduce<number | null>((mx, r) => (mx == null || r.lastSeenTs > mx ? r.lastSeenTs : mx), null);
  return { known, latestSweepTs, trackedHours7d: pres.tracked };
}

/** Binance profile inputs of the score and directory (all null when not collected). */
function profileFields(p: ProfileStats | undefined) {
  return {
    avgReleaseSec: p?.avgReleaseSec ?? null,
    positive: p?.positive ?? null,
    negative: p?.negative ?? null,
    positiveRate: p?.positiveRate ?? null,
    registerDays: p?.registerDays ?? null,
  };
}

export type ReliabilityExtras = { presence7d: number | null; firstSeenTs: number | null } & ReturnType<typeof profileFields>;

/** Presence, tenure and profile inputs for a few merchants (detail page, dashboard). */
export async function reliabilityInputs(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  ids: string[],
): Promise<Map<string, ReliabilityExtras>> {
  const list = [...new Set(ids)].slice(0, MAX_IDS);
  const out = new Map<string, ReliabilityExtras>();
  if (!list.length) return out;
  const m = schema.merchants;
  const db = await getDb();
  const [rows, pres, profiles] = await Promise.all([
    db
      .select({ merchantId: m.merchantId, firstSeenTs: m.firstSeenTs })
      .from(m)
      .where(and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat), inArray(m.merchantId, list))),
    presence(ex, asset, fiat, list).catch(() => ({ hours: new Map<string, number>(), tracked: 0 })),
    profileStatsMap(ex, list).catch(() => new Map<string, ProfileStats>()),
  ]);
  const first = new Map(rows.map((r) => [r.merchantId, r.firstSeenTs]));
  for (const id of list) {
    out.set(id, {
      presence7d: pres.tracked > 0 ? Math.min(1, (pres.hours.get(id) ?? 0) / pres.tracked) : null,
      firstSeenTs: first.get(id) ?? null,
      ...profileFields(profiles.get(id)),
    });
  }
  return out;
}

/**
 * Best Sell / Buy prices of every merchant listing both sides in the latest
 * sweep (for the market's median own spread). One indexed read.
 */
export async function twoSidedPrices(
  ex: ExchangeId,
  asset: string,
  fiat: string,
): Promise<{ bestSellPrice: number | null; bestBuyPrice: number | null }[]> {
  const m = schema.merchants;
  const db = await getDb();
  const market = and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat));
  const latest = db.select({ ts: sql<number>`max(${m.lastSeenTs})` }).from(m).where(market);
  return db
    .select({ bestSellPrice: m.bestSellPrice, bestBuyPrice: m.bestBuyPrice })
    .from(m)
    .where(
      and(
        market,
        sql`${m.lastSeenTs} >= (${latest}) - ${ACTIVE_SLACK_SEC}`,
        sql`${m.bestSellPrice} > 0`,
        sql`${m.bestBuyPrice} > 0`,
      ),
    );
}
