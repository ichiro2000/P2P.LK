import "server-only";
import { getEnv } from "@/lib/db/client";
import { DEV_OUTBOX_KEY, deliverEmail, type DevMail, type Email, type MailEnv } from "./deliver";

/**
 * Outgoing email. Production sends through Cloudflare Email Service (the
 * `EMAIL` send_email binding) from EMAIL_FROM, within a monthly cap. In development, mail goes to a local
 * outbox in KV (read it at /api/dev/mail) and the console, so the whole
 * sign-up flow can be tested without an email account.
 *
 * The delivery logic lives in ./deliver (no "server-only", no OpenNext
 * context) so the cron's scheduled handler can send too; pass `env` there.
 */

export type { Email, DevMail };

/** `env` is optional: inside a Next request it's resolved from the OpenNext
 *  context; outside one (the cron), pass the worker env explicitly. */
export async function sendEmail(mail: Email, env?: MailEnv): Promise<void> {
  const resolved = env ?? (await getEnv().catch(() => null));
  await deliverEmail(mail, resolved);
}

/** Development only: recent mail from the local outbox. */
export async function readDevOutbox(): Promise<DevMail[]> {
  if (process.env.NODE_ENV === "production") return [];
  const env = await getEnv();
  return ((await env.LIVE.get(DEV_OUTBOX_KEY, "json")) as DevMail[] | null) ?? [];
}
