/**
 * Email delivery core, with the env passed in explicitly. No "server-only"
 * marker and no OpenNext context lookup, so the cron (`scheduled` handler,
 * bundled from worker.ts outside Next) can send mail too. App code keeps
 * calling `sendEmail()` from ./send, which resolves the env and delegates here.
 *
 * Production sends through Cloudflare Email Service (the `EMAIL` send_email
 * binding, from EMAIL_FROM on the onboarded p2p.lk domain). In development,
 * mail goes to a local outbox in KV (read it at /api/dev/mail) and the console.
 *
 * Cost guard: Workers Paid includes 3,000 emails a month per account, then
 * $0.35 per 1,000, with no switch to stop overage. So we count our own sends
 * per calendar month (UTC) in KV and stop before the allowance:
 *   - alert emails stop at EMAIL_ALERT_CAP (alerts still fire in the app and
 *     as push notifications),
 *   - every other email (sign-up codes, password resets, approvals) stops at
 *     EMAIL_MONTHLY_CAP.
 * Both leave headroom for other workers on the account.
 */

export type Email = {
  to: string;
  subject: string;
  html: string;
  text: string;
  /** "alert" mail is the first to stop when the monthly allowance runs low. */
  kind?: "alert" | "account";
};

export type DevMail = Email & { at: string };

export type MailEnv = Partial<Pick<CloudflareEnv, "EMAIL" | "EMAIL_FROM" | "LIVE">>;

export const DEV_OUTBOX_KEY = "dev:outbox";
const DEV_OUTBOX_MAX = 30;

/** Our share of the 3,000 included emails a month. */
export const EMAIL_MONTHLY_CAP = 2500;
export const EMAIL_ALERT_CAP = 1800;

export class EmailCapError extends Error {
  constructor(kind: string, cap: number) {
    super(`Monthly email limit reached (${kind}: ${cap}). Not sent, to stay inside the plan's included email.`);
    this.name = "EmailCapError";
  }
}

export const monthKey = (d = new Date()) => `email:count:${d.toISOString().slice(0, 7)}`;

/** Sent this month (UTC calendar month). */
export async function emailsSentThisMonth(kv: KVNamespace | undefined, d = new Date()): Promise<number> {
  if (!kv) return 0;
  return Number((await kv.get(monthKey(d))) ?? 0) || 0;
}

/** "Name <addr@x>" → { name, email }; a bare address stays a string. */
function parseFrom(from: string): string | { name: string; email: string } {
  const m = from.match(/^\s*"?([^"<]*?)"?\s*<([^>]+)>\s*$/);
  return m ? { name: m[1].trim(), email: m[2].trim() } : from.trim();
}

export async function deliverEmail(mail: Email, env: MailEnv | null): Promise<void> {
  if (process.env.NODE_ENV !== "production" && env?.LIVE) {
    const prev = ((await env.LIVE.get(DEV_OUTBOX_KEY, "json")) as DevMail[] | null) ?? [];
    const next = [{ ...mail, at: new Date().toISOString() }, ...prev].slice(0, DEV_OUTBOX_MAX);
    await env.LIVE.put(DEV_OUTBOX_KEY, JSON.stringify(next));
    console.info(`[email:dev] to=${mail.to} subject="${mail.subject}"\n${mail.text}`);
    return;
  }

  const from = env?.EMAIL_FROM || process.env.EMAIL_FROM;
  if (!env?.EMAIL || !from) {
    throw new Error("Email is not configured on this server (EMAIL binding / EMAIL_FROM).");
  }

  const kind = mail.kind ?? "account";
  const cap = kind === "alert" ? EMAIL_ALERT_CAP : EMAIL_MONTHLY_CAP;
  const sent = await emailsSentThisMonth(env.LIVE);
  if (sent >= cap) throw new EmailCapError(kind, cap);

  await env.EMAIL.send({ from: parseFrom(from), to: mail.to, subject: mail.subject, html: mail.html, text: mail.text });

  // Approximate under concurrency (KV has no atomic increment); the caps sit
  // well below the allowance to absorb that.
  if (env.LIVE) {
    await env.LIVE.put(monthKey(), String(sent + 1), { expirationTtl: 40 * 86400 }).catch(() => undefined);
  }
}
