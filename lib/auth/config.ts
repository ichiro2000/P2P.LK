import "server-only";
import { betterAuth } from "better-auth";
import { APIError, createAuthMiddleware } from "better-auth/api";
import { drizzleAdapter } from "better-auth/adapters/drizzle";
import { captcha, emailOTP } from "better-auth/plugins";
import { nextCookies } from "better-auth/next-js";
import { and, eq } from "drizzle-orm";
import { dbFromBinding, getEnv, schema, type Db } from "@/lib/db/client";
import { sendEmail } from "@/lib/email/send";
import * as tpl from "@/lib/email/templates";
import { getFlags } from "@/lib/flags";
import { NAME_MAX, PASSWORD_MAX, PASSWORD_MIN, normalizeLkMobile, normalizeProfileUrl } from "./validate";

/**
 * Better Auth on D1.
 *
 * Flow: sign up (name, merchant name, WhatsApp, email, password, optional
 * Binance/Bybit profile) → 6-digit code by email (link too) → status
 * `pending_review` → an admin approves or rejects → email. Emails listed in
 * ADMIN_EMAILS become admins and skip review once verified.
 *
 * Workers have no long-lived process, and the D1 binding comes from the
 * request's env, so the auth instance is built per env (cached on the
 * binding object — one per isolate in practice).
 */

const TURNSTILE_TEST_SECRET = "1x0000000000000000000000000000000AA";
const DEV_SECRET = "dev-only-secret-change-me-dev-only-secret-change-me";

function adminEmails(env: CloudflareEnv): Set<string> {
  const raw = env.ADMIN_EMAILS || process.env.ADMIN_EMAILS || "";
  return new Set(raw.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean));
}

export function baseUrlOf(env: CloudflareEnv) {
  return (env.BETTER_AUTH_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

/**
 * Sign-up field rules (name, merchant name, WhatsApp, profile links).
 * Throws the user-facing APIError, else returns the normalised values.
 * Runs in the `/sign-up/email` before-hook as well as the create hook: Better
 * Auth answers a sign-up for an existing email with a fake success *without*
 * running the create hook, so validating only there would let anyone tell
 * registered emails apart (a bad WhatsApp number → 400 for new emails, 200
 * for existing ones).
 */
function checkSignUpFields(d: Record<string, unknown>) {
  const name = String(d.name ?? "").trim();
  const merchantName = String(d.merchantName ?? "").trim();
  if (!name || name.length > NAME_MAX)
    throw new APIError("BAD_REQUEST", { message: "Please enter your name (max 80 characters)." });
  if (!merchantName || merchantName.length > NAME_MAX)
    throw new APIError("BAD_REQUEST", { message: "Please enter your merchant name (max 80 characters)." });
  const whatsapp = normalizeLkMobile(String(d.whatsapp ?? ""));
  if (!whatsapp)
    throw new APIError("BAD_REQUEST", {
      message: "WhatsApp must be a Sri Lankan mobile number, e.g. +94 77 123 4567.",
    });
  const binanceUrl = normalizeProfileUrl(d.binanceUrl as string | null | undefined, "binance");
  const bybitUrl = normalizeProfileUrl(d.bybitUrl as string | null | undefined, "bybit");
  if (binanceUrl === null)
    throw new APIError("BAD_REQUEST", { message: "Binance profile link must be a binance.com link." });
  if (bybitUrl === null)
    throw new APIError("BAD_REQUEST", { message: "Bybit profile link must be a bybit.com link." });
  return { name, merchantName, whatsapp, binanceUrl: binanceUrl || null, bybitUrl: bybitUrl || null };
}

/** Better Auth endpoints this app never calls. Each one is a way around a
 *  guard on the endpoints we do use (Turnstile on password reset, the
 *  password itself for OTP sign-in), so they're switched off. */
const DISABLED_PATHS = [
  "/sign-in/email-otp",
  "/email-otp/request-password-reset",
  "/email-otp/check-verification-otp",
  "/email-otp/request-email-change",
  "/email-otp/change-email",
  "/send-verification-email",
  "/verify-email",
  "/request-password-reset",
  "/reset-password",
  "/change-email",
  "/delete-user",
];

async function audit(db: Db, row: Omit<typeof schema.auditLog.$inferInsert, "ts">) {
  await db
    .insert(schema.auditLog)
    .values({ ...row, ts: Math.floor(Date.now() / 1000) })
    .catch(() => undefined);
}

/** Code emails per address per UTC day. Generous for real users (a few
 *  resends plus a password reset), tight enough to stop abuse. */
export const OTP_EMAILS_PER_DAY = 8;

async function otpDailyGuard(kv: KVNamespace | undefined, email: string) {
  if (!kv) return;
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(email.trim().toLowerCase()));
  const id = Array.from(new Uint8Array(digest).slice(0, 12), (b) => b.toString(16).padStart(2, "0")).join("");
  const key = `otp:day:${new Date().toISOString().slice(0, 10)}:${id}`;
  const n = Number((await kv.get(key)) ?? 0) || 0;
  if (n >= OTP_EMAILS_PER_DAY) {
    throw new APIError("TOO_MANY_REQUESTS", { message: "Too many codes sent to this email today. Try again tomorrow." });
  }
  await kv.put(key, String(n + 1), { expirationTtl: 2 * 86400 });
}

function build(env: CloudflareEnv) {
  const db = dbFromBinding(env.DB);
  const prod = process.env.NODE_ENV === "production";
  // Public fallbacks only under `next dev` — never because NODE_ENV happens
  // to be unset or "test" in some other runtime.
  const dev = process.env.NODE_ENV === "development";
  const baseURL = baseUrlOf(env);
  const secret = env.BETTER_AUTH_SECRET || process.env.BETTER_AUTH_SECRET || (dev ? DEV_SECRET : "");
  if (!secret) throw new Error("BETTER_AUTH_SECRET is not set.");
  const turnstileSecret =
    env.TURNSTILE_SECRET_KEY || process.env.TURNSTILE_SECRET_KEY || (dev ? TURNSTILE_TEST_SECRET : "");
  if (!turnstileSecret) throw new Error("TURNSTILE_SECRET_KEY is not set (sign-up needs bot protection).");
  const admins = adminEmails(env);

  return betterAuth({
    appName: "P2P.LK",
    baseURL,
    secret,
    trustedOrigins: [baseURL],
    telemetry: { enabled: false },
    disabledPaths: DISABLED_PATHS,

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === "/sign-up/email") {
          // Same answer for new and existing emails (see checkSignUpFields).
          if (!(await getFlags(env, { fresh: true })).signupsOpen)
            throw new APIError("SERVICE_UNAVAILABLE", {
              message: "Sign-ups are paused right now. Please try again later.",
            });
          checkSignUpFields((ctx.body ?? {}) as Record<string, unknown>);
        }
        // Only email-verification codes go out through this (un-captcha'd)
        // endpoint; reset codes must come via /forget-password/email-otp,
        // which has Turnstile.
        if (ctx.path === "/email-otp/send-verification-otp" && ctx.body?.type !== "email-verification") {
          throw new APIError("BAD_REQUEST", { message: "Unsupported code type." });
        }
      }),
      after: createAuthMiddleware(async (ctx) => {
        // The fake success for an existing email echoes the raw input, the
        // real one the normalised user; the client only needs "no error".
        if (ctx.path === "/sign-up/email" && !(ctx.context.returned instanceof Error)) {
          return ctx.json({ token: null, user: null });
        }
      }),
    },
    database: drizzleAdapter(db, {
      provider: "sqlite",
      schema: {
        user: schema.user,
        session: schema.session,
        account: schema.account,
        verification: schema.verification,
        rateLimit: schema.rateLimit,
      },
    }),

    emailAndPassword: {
      enabled: true,
      requireEmailVerification: true,
      minPasswordLength: PASSWORD_MIN,
      maxPasswordLength: PASSWORD_MAX,
      autoSignIn: false,
      revokeSessionsOnPasswordReset: true,
    },
    emailVerification: {
      sendOnSignUp: true,
      autoSignInAfterVerification: true,
      async afterEmailVerification(u) {
        const isAdmin = admins.has(u.email.toLowerCase());
        const row = await db.query.user.findFirst({ where: eq(schema.user.id, u.id) });
        // The user.update.after hook may already have moved it to
        // pending_review in the same verify call — still finish onboarding.
        if (!row || (row.status !== "pending_email" && row.status !== "pending_review")) return;
        await db
          .update(schema.user)
          .set(
            isAdmin
              ? { status: "approved", role: "admin", reviewedAt: new Date(), reviewNote: "Admin by ADMIN_EMAILS" }
              : { status: "pending_review" },
          )
          .where(eq(schema.user.id, u.id));
        if (isAdmin) return;
        await sendEmail(tpl.underReview(row.email, row.name)).catch((e) => console.error("[auth] mail", e));
        for (const to of admins) {
          await sendEmail(
            tpl.adminNewMember(to, row, `${baseURL}/admin/members`),
          ).catch((e) => console.error("[auth] mail", e));
        }
      },
    },

    user: {
      additionalFields: {
        merchantName: { type: "string", required: true, input: true },
        whatsapp: { type: "string", required: true, input: true },
        binanceUrl: { type: "string", required: false, input: true },
        bybitUrl: { type: "string", required: false, input: true },
        role: { type: "string", required: false, input: false, defaultValue: "user" },
        status: { type: "string", required: false, input: false, defaultValue: "pending_email" },
        reviewNote: { type: "string", required: false, input: false },
      },
      changeEmail: { enabled: false },
      deleteUser: { enabled: false },
    },

    session: {
      expiresIn: 60 * 60 * 24 * 30,
      updateAge: 60 * 60 * 24,
      // Short cookie cache: most requests skip the D1 session lookup, and an
      // approval or suspension shows up within a minute.
      cookieCache: { enabled: true, maxAge: 60 },
    },

    rateLimit: {
      enabled: true,
      // In-memory (per isolate) on top of the Cloudflare rate-limit bindings
      // in app/api/auth/[...all]/route.ts. "database" would write a D1 row
      // on every request — anyone could run up the D1 write bill.
      // (Local dev keeps "database": no bill there, and the e2e suite's
      // retry handling depends on it.)
      storage: dev ? "database" : "memory",
      window: 60,
      max: 60,
      customRules: {
        "/sign-in/email": { window: 60, max: 5 },
        "/sign-up/email": { window: 300, max: 3 },
        "/email-otp/send-verification-otp": { window: 300, max: 3 },
        "/email-otp/verify-email": { window: 60, max: 6 },
        "/forget-password/email-otp": { window: 300, max: 3 },
        "/email-otp/reset-password": { window: 60, max: 6 },
        "/change-password": { window: 60, max: 5 },
        // Every page view checks the session. Many Sri Lankan mobile users
        // share one IP (carrier NAT), so the 60/min default would sign them
        // out of the UI; the cookie cache keeps this cheap.
        "/get-session": { window: 60, max: 2000 },
      },
    },

    advanced: {
      cookiePrefix: "p2plk",
      useSecureCookies: prod,
      ipAddress: { ipAddressHeaders: ["cf-connecting-ip"] },
      database: { generateId: () => crypto.randomUUID() },
    },

    databaseHooks: {
      user: {
        create: {
          async before(data) {
            // Admin kill switch (/admin/system → feature flags). Read fresh:
            // sign-ups are rare and must stop the moment it's switched off.
            // Not 403: sign-up turns a 403 from this hook into a fake success.
            if (!(await getFlags(env, { fresh: true })).signupsOpen)
              throw new APIError("SERVICE_UNAVAILABLE", {
                message: "Sign-ups are paused right now. Please try again later.",
              });
            return {
              data: {
                ...data,
                ...checkSignUpFields(data as Record<string, unknown>),
                // Sign-up never sets these, whatever the body says.
                image: null,
                role: "user",
                status: "pending_email",
              },
            };
          },
          async after(u) {
            await audit(db, { actorId: u.id, actorEmail: u.email, action: "user.sign_up", targetType: "user", targetId: u.id });
          },
        },
        update: {
          // Profile edits (/account) go through the same rules as sign-up.
          // Status/role are `input: false`, so members can't set them here.
          async before(data) {
            // Partial updates arrive with untouched fields as `undefined` —
            // only validate what's actually being changed.
            const d = Object.fromEntries(
              Object.entries(data as Record<string, unknown>).filter(([, v]) => v !== undefined),
            ) as Record<string, unknown>;
            // No profile pictures: never accept an image URL from the client.
            delete d.image;
            if ("name" in d) {
              const v = String(d.name ?? "").trim();
              if (!v || v.length > NAME_MAX) throw new APIError("BAD_REQUEST", { message: "Name must be 1–80 characters." });
              d.name = v;
            }
            if ("merchantName" in d) {
              const v = String(d.merchantName ?? "").trim();
              if (!v || v.length > NAME_MAX)
                throw new APIError("BAD_REQUEST", { message: "Merchant name must be 1–80 characters." });
              d.merchantName = v;
            }
            if ("whatsapp" in d) {
              const v = normalizeLkMobile(String(d.whatsapp ?? ""));
              if (!v) throw new APIError("BAD_REQUEST", { message: "WhatsApp must be a Sri Lankan mobile number." });
              d.whatsapp = v;
            }
            for (const [k, ex] of [["binanceUrl", "binance"], ["bybitUrl", "bybit"]] as const) {
              if (k in d) {
                const v = normalizeProfileUrl(d[k] as string | null, ex);
                if (v === null) throw new APIError("BAD_REQUEST", { message: `That isn't a valid ${ex}.com profile link.` });
                d[k] = v || null;
              }
            }
            return { data: d as typeof data };
          },
          // A password reset by email code also proves the address, and Better
          // Auth marks it verified without calling afterEmailVerification —
          // move such accounts on to review so they don't get stuck.
          async after(u) {
            if (!u.emailVerified) return;
            await db
              .update(schema.user)
              .set({ status: "pending_review" })
              .where(and(eq(schema.user.id, u.id), eq(schema.user.status, "pending_email")))
              .catch(() => undefined);
          },
        },
      },
      session: {
        create: {
          async before(s) {
            const row = await db.query.user.findFirst({
              where: eq(schema.user.id, s.userId),
              columns: { status: true },
            });
            if (row?.status === "suspended")
              throw new APIError("FORBIDDEN", { message: "This account is suspended. Contact support." });
          },
        },
      },
    },

    plugins: [
      emailOTP({
        otpLength: 6,
        expiresIn: 600,
        allowedAttempts: 5,
        storeOTP: "hashed",
        sendVerificationOnSignUp: true,
        overrideDefaultEmailVerification: true,
        async sendVerificationOTP({ email, otp, type }) {
          // Per-address daily cap on code emails. IP rate limits alone don't
          // stop someone with many IPs from flooding one inbox or burning
          // the account's daily sending quota through "resend code".
          if (type === "email-verification") {
            // Already verified: nothing to verify, send nothing (stops
            // "resend code" being used to mail any registered member).
            const u = await db.query.user.findFirst({
              where: eq(schema.user.email, email.trim().toLowerCase()),
              columns: { emailVerified: true },
            });
            if (u?.emailVerified) return;
          }
          await otpDailyGuard(env.LIVE, email);
          if (type === "email-verification") {
            const link = `${baseURL}/verify?email=${encodeURIComponent(email)}&code=${otp}`;
            await sendEmail(tpl.verifyEmail(email, otp, link));
          } else if (type === "forget-password") {
            await sendEmail(tpl.resetPassword(email, otp));
          } else if (type === "change-email") {
            await sendEmail(tpl.changeEmailCode(email, otp));
          }
          // "sign-in" OTPs are not offered.
        },
      }),
      captcha({
        provider: "cloudflare-turnstile",
        secretKey: turnstileSecret,
        endpoints: ["/sign-up/email", "/sign-in/email", "/forget-password/email-otp"],
        // A token solved on another site with our site key is refused. The
        // test secret reports "example.com", so only outside development.
        ...(dev ? {} : { allowedHostnames: [new URL(baseURL).hostname] }),
      }),
      nextCookies(),
    ],
  });
}

export type Auth = ReturnType<typeof build>;

const cache = new WeakMap<object, Auth>();

export async function getAuth(): Promise<Auth> {
  const env = await getEnv();
  let auth = cache.get(env.DB);
  if (!auth) {
    auth = build(env);
    cache.set(env.DB, auth);
  }
  return auth;
}
