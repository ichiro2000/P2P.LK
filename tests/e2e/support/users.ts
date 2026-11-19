import { randomBytes, randomUUID } from "node:crypto";
import { hashPassword } from "better-auth/crypto";
import { E2E_DOMAIN, q, sql } from "./db";

export type TestUser = {
  id: string;
  email: string;
  password: string;
  name: string;
  merchantName: string;
};

type Status = "pending_email" | "pending_review" | "approved" | "rejected" | "suspended";

/** Unique throwaway address on the test domain. */
export function e2eEmail(tag: string): string {
  return `${tag}-${Date.now().toString(36)}-${randomBytes(3).toString("hex")}${E2E_DOMAIN}`;
}

/** Throwaway password (stays out of logs and source). */
export function e2ePassword(): string {
  return `E2e-${randomBytes(9).toString("base64url")}`;
}

/**
 * Inserts a verified email+password account straight into local D1, so
 * fixtures don't spend the sign-up rate limit. The real sign-up flow is
 * covered by auth.spec.ts.
 */
export async function createUser(opts: {
  tag: string;
  status?: Status;
  role?: "user" | "admin";
  name?: string;
}): Promise<TestUser> {
  const id = `e2e_${randomUUID().replace(/-/g, "")}`;
  const email = e2eEmail(opts.tag);
  const password = e2ePassword();
  const name = opts.name ?? `E2E ${opts.tag} ${randomBytes(2).toString("hex")}`;
  const merchantName = `${name} Desk`;
  const hash = await hashPassword(password);
  const now = Date.now();
  const status = opts.status ?? "approved";
  sql(
    [
      `insert into user (id, name, email, email_verified, created_at, updated_at, merchant_name, whatsapp, role, status)
       values (${q(id)}, ${q(name)}, ${q(email)}, 1, ${now}, ${now}, ${q(merchantName)}, '+94771234567', ${q(opts.role ?? "user")}, ${q(status)})`,
      `insert into account (id, account_id, provider_id, user_id, password, created_at, updated_at)
       values (${q(`acc_${id}`)}, ${q(id)}, 'credential', ${q(id)}, ${q(hash)}, ${now}, ${now})`,
    ].join("; "),
  );
  return { id, email, password, name, merchantName };
}

export function setUser(email: string, fields: { status?: Status; role?: "user" | "admin" }): void {
  const sets = Object.entries(fields)
    .filter(([, v]) => v != null)
    .map(([k, v]) => `${k} = ${q(v as string)}`);
  if (sets.length) sql(`update user set ${sets.join(", ")} where email = ${q(email)}`);
}

export function userRow(email: string): { id: string; status: string; role: string } | undefined {
  return sql<{ id: string; status: string; role: string }>(
    `select id, status, role from user where email = ${q(email)}`,
  )[0];
}

/** Deletes one test account and everything tied to it. */
export function deleteUser(email: string): void {
  if (!email.endsWith(E2E_DOMAIN)) throw new Error(`refusing to delete non-test user ${email}`);
  const id = `(select id from user where email = ${q(email)})`;
  sql(
    [
      `delete from audit_log where target_id in ${id} or actor_id in ${id} or detail like ${q(`%${email}%`)}`,
      `delete from push_subscriptions where user_id in ${id}`,
      `delete from push_tombstones where user_id in ${id}`,
      `delete from alert_events where user_id in ${id}`,
      `delete from alert_rules where user_id in ${id}`,
      `delete from user_items where user_id in ${id}`,
      `delete from session where user_id in ${id}`,
      `delete from account where user_id in ${id}`,
      `delete from verification where identifier like ${q(`%${email}%`)}`,
      `delete from user where email = ${q(email)}`,
    ].join("; "),
  );
}
