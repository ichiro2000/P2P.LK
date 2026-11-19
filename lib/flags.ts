import { getEnv } from "@/lib/db/client";
import { DEFAULT_FLAGS, FLAGS_KEY, FlagsSchema, type Flags } from "./flags-schema";

/**
 * Feature flags, stored as one JSON document in KV (`flags:v1`) and edited
 * on /admin/system (PATCH /api/admin/flags).
 *
 * Works in both contexts:
 *   - Next request (pages, route handlers, auth hooks): `getFlags()`
 *   - cron (`scheduled` handler): `getFlags(env)` with the worker bindings
 *
 * Reads go through a short per-isolate memory cache, so the app shell can
 * call this on every page for free. Writes update this isolate's cache at
 * once; other isolates (and KV's own edge cache) catch up within about a
 * minute. Any read failure falls back to the defaults (everything on), so a
 * KV outage never closes sign-ups or stops the collectors.
 *
 * No "server-only" marker: the cron bundle (worker.ts) imports this too.
 */

export { BANNER_MAX, DEFAULT_FLAGS, FLAGS_KEY, FlagsSchema, type Flags } from "./flags-schema";

const CACHE_MS = 15_000;
// On globalThis, not module scope: bundlers can load this module more than
// once per isolate (route handlers vs pages), and a write must update every
// copy's cache.
const CACHE = Symbol.for("p2plk.flags.cache");
type Cache = { at: number; flags: Flags } | null;
const store = globalThis as unknown as Record<symbol, Cache | undefined>;

type FlagsEnv = { LIVE?: KVNamespace } | null | undefined;

async function kvOf(env: FlagsEnv): Promise<KVNamespace> {
  if (env?.LIVE) return env.LIVE;
  return (await getEnv()).LIVE;
}

/** Stored JSON → full flags. Unknown keys are dropped; a bad value for one
 *  flag falls back to that flag's default without touching the others. */
function normalize(raw: unknown): Flags {
  const out: Flags = { ...DEFAULT_FLAGS };
  if (!raw || typeof raw !== "object") return out;
  const shape = FlagsSchema.shape;
  for (const k of Object.keys(shape) as (keyof Flags)[]) {
    const parsed = shape[k].safeParse((raw as Record<string, unknown>)[k]);
    if (parsed.success) (out as Record<keyof Flags, unknown>)[k] = parsed.data;
  }
  return out;
}

export async function getFlags(env?: FlagsEnv, opts: { fresh?: boolean } = {}): Promise<Flags> {
  const cached = store[CACHE] ?? null;
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.flags;
  try {
    const kv = await kvOf(env);
    const flags = normalize(await kv.get(FLAGS_KEY, "json"));
    store[CACHE] = { at: Date.now(), flags };
    return flags;
  } catch (err) {
    console.warn(`[flags] read failed, using ${cached ? "cached" : "default"} flags: ${(err as Error).message}`);
    return cached?.flags ?? DEFAULT_FLAGS;
  }
}

/** Merge a partial update over the current (fresh) flags and store them.
 *  Returns the previous and the new flags (for the audit log). */
export async function setFlags(
  patch: Partial<Flags>,
  env?: FlagsEnv,
): Promise<{ before: Flags; after: Flags }> {
  const kv = await kvOf(env);
  const before = normalize(await kv.get(FLAGS_KEY, "json"));
  const after = normalize({ ...before, ...patch });
  await kv.put(FLAGS_KEY, JSON.stringify(after));
  store[CACHE] = { at: Date.now(), flags: after };
  return { before, after };
}
