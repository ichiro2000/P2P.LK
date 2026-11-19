import { execFileSync } from "node:child_process";
import path from "node:path";

/**
 * Local D1 / KV access for test setup and cleanup, through wrangler's
 * `--local` mode (the same `.wrangler/state` the dev server uses).
 */

const ROOT = path.resolve(__dirname, "../../..");

function wrangler(args: string[]): string {
  let last: unknown;
  // The dev server and the other worker share the SQLite file; a write can
  // briefly find it locked, so retry a few times before giving up.
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      return execFileSync("npx", ["wrangler", ...args], {
        cwd: ROOT,
        encoding: "utf8",
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, WRANGLER_SEND_METRICS: "false", NO_COLOR: "1" },
      });
    } catch (err) {
      last = err;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 500 * (attempt + 1));
    }
  }
  const e = last as { stderr?: string; stdout?: string; message?: string };
  throw new Error(`wrangler ${args.slice(0, 3).join(" ")} failed: ${e.stderr || e.stdout || e.message}`);
}

/** SQL string literal. */
export function q(v: string | number | null): string {
  if (v === null) return "NULL";
  if (typeof v === "number") return String(v);
  return `'${v.replace(/'/g, "''")}'`;
}

/** Runs one or more `;`-separated statements and returns the last result set. */
export function sql<T = Record<string, unknown>>(command: string): T[] {
  const out = wrangler(["d1", "execute", "p2p-lk", "--local", "--json", "--command", command]);
  const parsed = JSON.parse(out) as { results: T[] }[];
  return parsed[parsed.length - 1]?.results ?? [];
}

export function kvGet(key: string): string | null {
  try {
    const v = wrangler(["kv", "key", "get", "--local", "--binding", "LIVE", key]);
    return v.trim() === "Value not found" ? null : v;
  } catch {
    return null;
  }
}

export function kvPut(key: string, value: string): void {
  wrangler(["kv", "key", "put", "--local", "--binding", "LIVE", key, value]);
}

export function kvDelete(key: string): void {
  try {
    wrangler(["kv", "key", "delete", "--local", "--binding", "LIVE", key]);
  } catch {
    // Already gone.
  }
}

/** The dev push sink's request log (app/api/dev/push-sink) only ever holds
 *  test traffic, and so do the sends to it logged in ingest_runs. */
export function purgePushSink(): void {
  if (kvGet("dev:push-sink") !== null) kvDelete("dev:push-sink");
  sql(`delete from ingest_runs where job = 'push'`);
}

export const E2E_DOMAIN = "@e2e.test";

/** Removes every `@e2e.test` account and what hangs off it (sessions,
 *  member data, verification codes, audit rows about or by them). */
export function purgeE2eData(): void {
  const like = q(`%${E2E_DOMAIN}`);
  const ids = `(select id from user where email like ${like})`;
  sql(
    [
      `delete from audit_log where actor_email like ${like} or detail like ${q(`%${E2E_DOMAIN}%`)} or target_id in ${ids} or actor_id in ${ids}`,
      `delete from push_subscriptions where user_id in ${ids}`,
      `delete from push_tombstones where user_id in ${ids}`,
      `delete from alert_events where user_id in ${ids}`,
      `delete from alert_rules where user_id in ${ids}`,
      `delete from user_items where user_id in ${ids}`,
      `delete from session where user_id in ${ids}`,
      `delete from account where user_id in ${ids}`,
      `delete from verification where identifier like ${q(`%${E2E_DOMAIN}%`)}`,
      `delete from user where email like ${like}`,
    ].join("; "),
  );
}

/** Drops mail to or about `@e2e.test` accounts from the dev outbox (KV), keeping everyone else's. */
export function purgeE2eMail(): void {
  const raw = kvGet("dev:outbox");
  if (!raw) return;
  try {
    const mail = JSON.parse(raw) as { to: string }[];
    // To a test address, or about one (the admin "new member" notices).
    const kept = mail.filter((m) => !JSON.stringify(m).toLowerCase().includes(E2E_DOMAIN));
    if (kept.length !== mail.length) kvPut("dev:outbox", JSON.stringify(kept));
  } catch {
    // Not JSON: leave it alone.
  }
}

export const DEFAULT_FLAGS = { signupsOpen: true, alertEmails: true, fxCollector: true, banner: "" };

/** Feature flags back to defaults (all on, no banner) if a test left them changed. */
export function resetFlags(): void {
  const raw = kvGet("flags:v1");
  let current: unknown = null;
  try {
    current = raw ? JSON.parse(raw) : null;
  } catch {
    current = null;
  }
  if (current !== null && JSON.stringify(current) !== JSON.stringify(DEFAULT_FLAGS)) {
    kvPut("flags:v1", JSON.stringify(DEFAULT_FLAGS));
  }
}

/** Better Auth's per-IP counters (sign-up is 3 per 5 minutes). */
export function clearRateLimits(): void {
  sql("delete from rate_limit");
}
