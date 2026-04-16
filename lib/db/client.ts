import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

/**
 * Singleton better-sqlite3 connection. We intentionally store the instance on
 * `globalThis` so that Next.js hot-reloads (which re-evaluate this module on
 * every request during dev) don't leak file descriptors.
 *
 * Production note: better-sqlite3 only works in long-running Node runtimes.
 * When deploying to Vercel serverless or Edge, swap the connection here for
 * a libSQL/Turso or Postgres driver — the schema and query layer are unchanged.
 */

const DB_DIR = path.join(process.cwd(), "data");
const DB_PATH = path.join(DB_DIR, "p2p.db");

declare global {
  // eslint-disable-next-line no-var
  var __p2pDb: Database.Database | undefined;
}

function getHandle() {
  if (global.__p2pDb) return global.__p2pDb;
  fs.mkdirSync(DB_DIR, { recursive: true });
  const sqlite = new Database(DB_PATH);
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("synchronous = NORMAL");
  sqlite.pragma("foreign_keys = ON");
  bootstrapSchema(sqlite);
  global.__p2pDb = sqlite;
  return sqlite;
}

/**
 * Idempotent schema bootstrap — run on first connection.
 * In production we'd use drizzle-kit migrations; for this project the schema
 * is small enough that embedding DDL here keeps the dev loop trivial.
 */
function bootstrapSchema(sqlite: Database.Database) {
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS market_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      asset TEXT NOT NULL,
      fiat TEXT NOT NULL,
      best_bid REAL,
      best_ask REAL,
      mid REAL,
      spread REAL,
      spread_pct REAL,
      median_bid REAL,
      median_ask REAL,
      vwap_bid REAL,
      vwap_ask REAL,
      bid_count INTEGER,
      ask_count INTEGER,
      bid_depth REAL,
      ask_depth REAL,
      bid_depth_fiat REAL,
      ask_depth_fiat REAL
    );
    CREATE INDEX IF NOT EXISTS idx_market_ts
      ON market_snapshots (asset, fiat, ts);
    CREATE INDEX IF NOT EXISTS idx_market_recent
      ON market_snapshots (ts);

    CREATE TABLE IF NOT EXISTS merchant_snapshots (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      asset TEXT NOT NULL,
      fiat TEXT NOT NULL,
      merchant_id TEXT NOT NULL,
      merchant_name TEXT NOT NULL,
      is_merchant INTEGER,
      orders_month INTEGER,
      completion_rate REAL,
      avg_release_sec INTEGER,
      buy_ads INTEGER,
      sell_ads INTEGER,
      best_buy_price REAL,
      best_sell_price REAL,
      total_available_fiat REAL
    );
    CREATE INDEX IF NOT EXISTS idx_merchant_ts
      ON merchant_snapshots (merchant_id, asset, fiat, ts);
    CREATE INDEX IF NOT EXISTS idx_merchant_market
      ON merchant_snapshots (asset, fiat, ts);
  `);
}

export const db = drizzle(getHandle(), { schema });
export { schema };
export { DB_PATH };
