import { drizzle, type DrizzleD1Database } from "drizzle-orm/d1";
import { getCloudflareContext } from "@opennextjs/cloudflare";
import * as schema from "./schema";

export type Db = DrizzleD1Database<typeof schema>;

/** Drizzle handle over a D1 binding. Cheap to create — D1 has no
 *  connection pool, so per-request instances are the norm on Workers. */
export function dbFromBinding(d1: D1Database): Db {
  return drizzle(d1, { schema });
}

/** For server components / route handlers running inside the Next app.
 *  The cron worker passes its own `env.DB` via `dbFromBinding` instead. */
export async function getDb(): Promise<Db> {
  const { env } = await getCloudflareContext({ async: true });
  return dbFromBinding(env.DB);
}

export async function getEnv(): Promise<CloudflareEnv> {
  const { env } = await getCloudflareContext({ async: true });
  return env;
}

export { schema };
