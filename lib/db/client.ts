import { drizzle } from "drizzle-orm/libsql";
import { createClient, type Client } from "@libsql/client";
import path from "node:path";
import fs from "node:fs";
import * as schema from "./schema";

/**
 * Single async driver: libSQL.
 *
 * - Locally (no env vars): uses a file at data/p2p.db — libSQL is SQLite-
 *   compatible, so `npm run dev` has zero extra setup.
 * - On Vercel / remote: set DATABASE_URL (e.g. Turso) and optionally
 *   DATABASE_AUTH_TOKEN. The same Drizzle schema and queries work unchanged.
 *
 * We cache the client on globalThis so Next.js hot-reloads don't leak
 * connections during dev.
 */

const DB_DIR = path.join(process.cwd(), "data");
const LOCAL_DB_PATH = path.join(DB_DIR, "p2p.db");
const LOCAL_URL = `file:${LOCAL_DB_PATH}`;

declare global {
  // eslint-disable-next-line no-var
  var __p2pClient: Client | undefined;
  // eslint-disable-next-line no-var
  var __p2pSchemaReady: boolean | undefined;
}

function resolveConfig() {
  const envUrl = process.env.DATABASE_URL;
  if (envUrl) {
    return {
      url: envUrl,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    };
  }
  fs.mkdirSync(DB_DIR, { recursive: true });
  return { url: LOCAL_URL, authToken: undefined };
}

function getClient(): Client {
  if (global.__p2pClient) return global.__p2pClient;
  const cfg = resolveConfig();
  global.__p2pClient = createClient(cfg);
  return global.__p2pClient;
}

/**
 * Idempotent schema bootstrap. Runs once per process — gated behind a
 * globalThis flag so repeated imports (e.g. Next.js module re-eval) don't
 * re-issue the DDL on every request.
 *
 * For dev convenience we do this here rather than wiring drizzle-kit
 * migrations. In production, prefer a one-shot migration job.
 */
async function ensureSchema(client: Client) {
  if (global.__p2pSchemaReady) return;
  await client.executeMultiple(`
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
    CREATE INDEX IF NOT EXISTS idx_market_ts ON market_snapshots (asset, fiat, ts);
    CREATE INDEX IF NOT EXISTS idx_market_recent ON market_snapshots (ts);

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
    CREATE INDEX IF NOT EXISTS idx_merchant_ts ON merchant_snapshots (merchant_id, asset, fiat, ts);
    CREATE INDEX IF NOT EXISTS idx_merchant_market ON merchant_snapshots (asset, fiat, ts);
  `);
  global.__p2pSchemaReady = true;
}

const client = getClient();

/**
 * Exported as a Promise-returning helper. Call `await getDb()` at the top of
 * any query function. Schema is bootstrapped lazily on first use.
 */
export async function getDb() {
  await ensureSchema(client);
  return db;
}

export const db = drizzle(client, { schema });
export { schema };
export { LOCAL_DB_PATH as DB_PATH };
