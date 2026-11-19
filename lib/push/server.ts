import "server-only";
import { getEnv } from "@/lib/db/client";
import { vapidFromEnv, type PushEnv } from "./send";

/** Request-time push env (bindings + secrets). VAPID_* are secrets set with
 *  `wrangler secret put`, so they aren't in the generated CloudflareEnv type. */
export async function pushEnv(): Promise<PushEnv> {
  return (await getEnv()) as CloudflareEnv & PushEnv;
}

/** The public VAPID key browsers subscribe with, or null when push isn't configured. */
export async function vapidPublicKey(): Promise<string | null> {
  return vapidFromEnv(await pushEnv())?.publicKey ?? null;
}
