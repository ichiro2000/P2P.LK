import "server-only";
import { and, desc, eq, gte } from "drizzle-orm";
import { getDb, schema } from "./client";
import type { ExchangeId } from "@/lib/exchanges";

export type SitemapMerchant = { merchantId: string; lastSeenTs: number };

/**
 * Merchants seen on the book recently, newest first, for the sitemap. One
 * read on `ix_merchants_seen` (exchange, asset, fiat, last_seen_ts); only two
 * small columns come back.
 */
export async function sitemapMerchants(
  ex: ExchangeId,
  asset: string,
  fiat: string,
  opts: { sinceTs: number; limit: number },
): Promise<SitemapMerchant[]> {
  const db = await getDb();
  const m = schema.merchants;
  return db
    .select({ merchantId: m.merchantId, lastSeenTs: m.lastSeenTs })
    .from(m)
    .where(and(eq(m.exchange, ex), eq(m.asset, asset), eq(m.fiat, fiat), gte(m.lastSeenTs, opts.sinceTs)))
    .orderBy(desc(m.lastSeenTs))
    .limit(opts.limit);
}

/** Merchant name for metadata: a primary-key lookup, two columns. */
export async function merchantName(
  ex: ExchangeId,
  merchantId: string,
  asset: string,
  fiat: string,
): Promise<{ name: string; lastSeenTs: number } | null> {
  const db = await getDb();
  const m = schema.merchants;
  const [row] = await db
    .select({ name: m.merchantName, lastSeenTs: m.lastSeenTs })
    .from(m)
    .where(and(eq(m.exchange, ex), eq(m.merchantId, merchantId), eq(m.asset, asset), eq(m.fiat, fiat)))
    .limit(1);
  return row ?? null;
}
