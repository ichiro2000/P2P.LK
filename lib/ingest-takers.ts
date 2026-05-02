/**
 * Taker-profile poller.
 *
 * Our main ingest only sees advertisers (users who publish ads on the LKR
 * book). Flagged takers like User-0805f never show up there because they
 * only open orders — they don't list — so `merchant_snapshots` stays
 * empty for them and the suspicious-detail page can't compute any of the
 * "still trading?" deltas.
 *
 * This module closes that gap by hitting Binance's public profile
 * endpoint (`profile-and-ads-list`) for every taker currently in the
 * registry and inserting one snapshot row per poll into the same
 * `merchant_snapshots` table. We reuse that table instead of adding a
 * new one so the existing `activityForSuspicious` / heatmap / order-
 * trend queries pick up the new data automatically.
 */
import { and, eq, sql } from "drizzle-orm";
import { getDb, schema } from "./db/client";
import { fetchBybitAdvertiserPublic } from "./qr-resolve";
import { ASSET, FIAT } from "./constants";

export type TakerPollReport = {
  pollStartedAt: string;
  pollFinishedAt: string;
  durationMs: number;
  takersAttempted: number;
  takersSucceeded: number;
  takerRowsInserted: number;
  errors: { takerId: string; error: string }[];
};

/** Concurrency cap for the per-taker profile fetches. Binance's public
 *  endpoint isn't formally rate-limited but we keep this low to be polite
 *  and so one burst doesn't saturate the web service's egress. */
const CONCURRENCY = 3;

/** Small delay between concurrent batches — lets Binance's CDN not think
 *  we're a scraping bot. At CONCURRENCY=3 and 250 ms between batches,
 *  polling ~100 flagged takers takes ~8 s. */
const BATCH_DELAY_MS = 250;

export async function runTakerPoll(): Promise<TakerPollReport> {
  const pollStartedAt = new Date().toISOString();
  const start = Date.now();
  const ts = Math.floor(start / 1000);

  const report: TakerPollReport = {
    pollStartedAt,
    pollFinishedAt: "",
    durationMs: 0,
    takersAttempted: 0,
    takersSucceeded: 0,
    takerRowsInserted: 0,
    errors: [],
  };

  const db = await getDb();

  // Distinct advertiserNos across all active reports. A single taker can
  // be flagged multiple times — we only need one poll per unique ID per
  // cycle. DB returns them as Array<{ id: string }>.
  const takerRows = await db
    .selectDistinct({ id: schema.suspiciousTakers.binanceUserId })
    .from(schema.suspiciousTakers)
    .where(eq(schema.suspiciousTakers.status, "active"));

  const takerIds = takerRows
    .map((r) => r.id)
    // Only poll rows that look like real Binance identifiers — the registry
    // may still have opaque short-link fallbacks from before the WAF fix,
    // and those aren't valid userNo values for the profile endpoint.
    .filter((id) => /^[sS]?[A-Za-z0-9]{16,}$/.test(id));

  report.takersAttempted = takerIds.length;
  if (takerIds.length === 0) {
    report.pollFinishedAt = new Date().toISOString();
    report.durationMs = Date.now() - start;
    return report;
  }

  // Run in small concurrent batches. Each batch resolves fully before the
  // next starts — simpler than a worker-pool, and total fan-out stays
  // bounded at CONCURRENCY.
  for (let i = 0; i < takerIds.length; i += CONCURRENCY) {
    const batch = takerIds.slice(i, i + CONCURRENCY);
    const results = await Promise.all(
      batch.map((id) => pollOne(id, ts).catch((err) => ({ id, err }))),
    );
    for (const r of results) {
      if ("err" in r) {
        report.errors.push({
          takerId: r.id,
          error: r.err instanceof Error ? r.err.message : String(r.err),
        });
        continue;
      }
      if (r.inserted) {
        report.takersSucceeded += 1;
        report.takerRowsInserted += 1;
      }
    }
    if (i + CONCURRENCY < takerIds.length) {
      await new Promise((resolve) => setTimeout(resolve, BATCH_DELAY_MS));
    }
  }

  report.pollFinishedAt = new Date().toISOString();
  report.durationMs = Date.now() - start;
  return report;
}

async function pollOne(
  takerId: string,
  ts: number,
): Promise<{ id: string; inserted: boolean }> {
  const profile = await fetchBybitAdvertiserPublic(takerId, {
    timeoutMs: 5000,
    skipBrowser: true,
  });
  if (!profile?.nickName) return { id: takerId, inserted: false };

  const db = await getDb();

  // Idempotent: if we've already written a snapshot with this exact ts
  // (e.g. the ingest job retried), skip. The same (merchantId, asset,
  // fiat, ts) tuple should only appear once.
  const existing = await db
    .select({ id: schema.merchantSnapshots.id })
    .from(schema.merchantSnapshots)
    .where(
      and(
        eq(schema.merchantSnapshots.merchantId, takerId),
        eq(schema.merchantSnapshots.asset, ASSET),
        eq(schema.merchantSnapshots.fiat, FIAT.code),
        eq(schema.merchantSnapshots.ts, ts),
      ),
    )
    .limit(1);
  if (existing.length > 0) return { id: takerId, inserted: false };

  await db.insert(schema.merchantSnapshots).values({
    ts,
    asset: ASSET,
    fiat: FIAT.code,
    merchantId: takerId,
    merchantName: profile.nickName,
    // Takers aren't merchants — keep the boolean explicit rather than null
    // so the detail page knows to skip merchant-only panels if we ever
    // branch on this later.
    isMerchant: false,
    userIdentity: profile.userIdentity,
    userGrade: profile.userGrade,
    vipLevel: profile.vipLevel,
    ordersMonth: profile.monthOrderCount,
    completionRate: profile.monthFinishRate,
    avgReleaseSec:
      profile.avgReleaseTimeSec != null
        ? Math.round(profile.avgReleaseTimeSec)
        : null,
    // Market-specific fields stay null — a taker snapshot isn't a live ad.
    buyAds: null,
    sellAds: null,
    bestBuyPrice: null,
    bestSellPrice: null,
    totalAvailableFiat: null,
  });

  return { id: takerId, inserted: true };
}

/** Debug helper — quick row count for a single taker so you can confirm
 *  the poll is landing rows. Not wired into a UI, just for
 *  `node -e "..."` spot checks. */
export async function countTakerSnapshots(takerId: string): Promise<number> {
  const db = await getDb();
  const rows = await db
    .select({ c: sql<number>`count(*)` })
    .from(schema.merchantSnapshots)
    .where(eq(schema.merchantSnapshots.merchantId, takerId));
  return Number(rows[0]?.c ?? 0);
}
