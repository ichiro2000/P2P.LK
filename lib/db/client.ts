import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "./schema";

/**
 * Postgres driver. Targets Supabase by default but works with any Postgres
 * endpoint via `DATABASE_URL`.
 *
 * Transaction pooler note — Supabase's transaction pooler (port 6543) does
 * NOT support prepared statements. We set `prepare: false` globally so every
 * query runs as a simple query. Safe on session poolers and direct
 * connections too; negligible perf cost for our workload.
 *
 * The client is cached on globalThis so Next.js hot-reloads during dev
 * don't accumulate pool handles.
 */

declare global {
  // eslint-disable-next-line no-var
  var __p2pSql: postgres.Sql | undefined;
  // eslint-disable-next-line no-var
  var __p2pSchemaReady: Promise<void> | undefined;
}

function getClient(): postgres.Sql {
  if (global.__p2pSql) return global.__p2pSql;

  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Copy .env.example to .env.local and paste " +
        "your DO Managed Postgres transaction-pool URL (port 25061, " +
        "sslmode=require).",
    );
  }

  global.__p2pSql = postgres(url, {
    // REQUIRED for any pgBouncer-style transaction pooler (DO connection
    // pool in Transaction mode). Harmless on direct connections.
    prepare: false,
    // Keep the pool small. App Platform runs a handful of containers and we
    // don't need more than a few connections per container.
    max: 10,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return global.__p2pSql;
}

/**
 * Idempotent schema bootstrap. Runs each DDL as its own simple query so it
 * works through the transaction pooler. Cached as a single in-flight promise
 * per process so concurrent requests don't race to create the same tables.
 */
function ensureSchema(): Promise<void> {
  if (global.__p2pSchemaReady) return global.__p2pSchemaReady;

  const c = getClient();
  global.__p2pSchemaReady = (async () => {
    const statements = [
      `CREATE TABLE IF NOT EXISTS market_snapshots (
        id             SERIAL PRIMARY KEY,
        ts             BIGINT NOT NULL,
        asset          TEXT NOT NULL,
        fiat           TEXT NOT NULL,
        best_bid       REAL,
        best_ask       REAL,
        mid            REAL,
        spread         REAL,
        spread_pct     REAL,
        median_bid     REAL,
        median_ask     REAL,
        vwap_bid       REAL,
        vwap_ask       REAL,
        bid_count      INTEGER,
        ask_count      INTEGER,
        bid_depth      REAL,
        ask_depth      REAL,
        bid_depth_fiat REAL,
        ask_depth_fiat REAL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_market_ts
         ON market_snapshots (asset, fiat, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_market_recent
         ON market_snapshots (ts)`,
      `CREATE TABLE IF NOT EXISTS merchant_snapshots (
        id                    SERIAL PRIMARY KEY,
        ts                    BIGINT NOT NULL,
        asset                 TEXT NOT NULL,
        fiat                  TEXT NOT NULL,
        merchant_id           TEXT NOT NULL,
        merchant_name         TEXT NOT NULL,
        is_merchant           BOOLEAN,
        orders_month          INTEGER,
        completion_rate       REAL,
        avg_release_sec       INTEGER,
        buy_ads               INTEGER,
        sell_ads              INTEGER,
        best_buy_price        REAL,
        best_sell_price       REAL,
        total_available_fiat  REAL
      )`,
      `CREATE INDEX IF NOT EXISTS idx_merchant_ts
         ON merchant_snapshots (merchant_id, asset, fiat, ts)`,
      `CREATE INDEX IF NOT EXISTS idx_merchant_market
         ON merchant_snapshots (asset, fiat, ts)`,
      `CREATE TABLE IF NOT EXISTS suspicious_takers (
        id               SERIAL PRIMARY KEY,
        ts               BIGINT NOT NULL,
        binance_user_id  TEXT NOT NULL,
        profile_url      TEXT NOT NULL,
        display_name     TEXT,
        reason           TEXT NOT NULL,
        notes            TEXT,
        reporter         TEXT,
        status           TEXT NOT NULL DEFAULT 'active'
      )`,
      `CREATE INDEX IF NOT EXISTS idx_suspicious_user
         ON suspicious_takers (binance_user_id)`,
      `CREATE INDEX IF NOT EXISTS idx_suspicious_ts
         ON suspicious_takers (ts)`,
    ];
    for (const stmt of statements) {
      await c.unsafe(stmt);
    }
  })();

  // Swallow the error so we retry on next call (don't cache a rejected promise).
  global.__p2pSchemaReady.catch(() => {
    global.__p2pSchemaReady = undefined;
  });

  return global.__p2pSchemaReady;
}

declare global {
  // eslint-disable-next-line no-var
  var __p2pDrizzle: ReturnType<typeof drizzle> | undefined;
}

/**
 * Get a Drizzle handle with the schema guaranteed to exist. Call this at the
 * top of every query function: `const db = await getDb();`
 *
 * The drizzle instance is created lazily so modules that don't touch the DB
 * can still be imported without DATABASE_URL set (matters for build steps,
 * tests and side-effect-free imports).
 */
export async function getDb() {
  await ensureSchema();
  if (!global.__p2pDrizzle) {
    global.__p2pDrizzle = drizzle(getClient(), { schema });
  }
  return global.__p2pDrizzle;
}

export { schema };
