import { expect, type APIRequestContext, type Page } from "@playwright/test";
import type { TestUser } from "./users";

/** The token Cloudflare's always-pass test site key hands out; the test
 *  secret key accepts it, so API sign-ins don't need the widget. */
const TURNSTILE_DUMMY_TOKEN = "XXXX.DUMMY.TOKEN.XXXX";

/**
 * Signs in through the Better Auth endpoint the form uses. Session cookies
 * land in the request context (shared with its browser context). Respects
 * the per-IP sign-in limit by waiting out `X-Retry-After` when hit.
 */
export async function apiSignIn(request: APIRequestContext, user: Pick<TestUser, "email" | "password">) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await request.post("/api/auth/sign-in/email", {
      headers: { "x-captcha-response": TURNSTILE_DUMMY_TOKEN, origin: "http://localhost:3000" },
      data: { email: user.email, password: user.password, rememberMe: true },
    });
    if (res.status() === 429) {
      const wait = Number(res.headers()["x-retry-after"] ?? 10);
      await new Promise((r) => setTimeout(r, Math.min(Math.max(wait, 1), 65) * 1000));
      continue;
    }
    expect(res.status(), `sign-in for ${user.email}: ${await res.text()}`).toBe(200);
    return;
  }
  throw new Error(`sign-in for ${user.email} kept hitting the rate limit`);
}

/** Waits until the Turnstile widget (test key, auto-solves) has issued its token. */
export async function waitForTurnstile(page: Page) {
  await expect
    .poll(
      () =>
        page.evaluate(() =>
          Array.from(document.querySelectorAll<HTMLInputElement>('input[name="cf-turnstile-response"]')).some(
            (i) => i.value.length > 0,
          ),
        ),
      { timeout: 30_000, message: "Turnstile never issued a token" },
    )
    .toBe(true);
}

type DevMail = { to: string; subject: string; text: string; at: string };

/**
 * Newest 6-digit code mailed to `email` (dev outbox, newest first) whose
 * subject matches, sent after `since`. Resolves null after `timeout`: the
 * dev outbox is one KV value, so two sends at the same instant (another
 * worker, other local tooling) can drop one — callers resend then.
 */
export async function readCode(
  request: APIRequestContext,
  email: string,
  opts: { subject: RegExp; since: number; timeout?: number },
): Promise<string | null> {
  const deadline = Date.now() + (opts.timeout ?? 15_000);
  for (;;) {
    const res = await request.get("/api/dev/mail");
    if (res.ok()) {
      const { mail } = (await res.json()) as { mail: DevMail[] };
      const hit = mail.find(
        (m) =>
          m.to.toLowerCase() === email.toLowerCase() &&
          opts.subject.test(m.subject) &&
          Date.parse(m.at) >= opts.since - 2_000,
      );
      const code = hit ? (hit.text.match(/\b(\d{6})\b/)?.[1] ?? hit.subject.match(/\b(\d{6})\b/)?.[1]) : null;
      if (code) return code;
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Submits a Turnstile-protected auth form (sign-up, sign-in, forgot
 * password) once the widget has a token. If the shared per-IP limit is hit
 * (other local tooling uses the same counters), waits out the server's
 * `X-Retry-After` and submits again.
 */
export async function submitProtectedForm(page: Page, button: ReturnType<Page["getByRole"]>, endpoint: string) {
  for (let attempt = 0; attempt < 3; attempt++) {
    await waitForTurnstile(page);
    const [res] = await Promise.all([
      page.waitForResponse((r) => r.url().includes(`/api/auth${endpoint}`) && r.request().method() === "POST"),
      button.click(),
    ]);
    if (res.status() !== 429) return res;
    const wait = Number(res.headers()["x-retry-after"] ?? 10);
    await page.waitForTimeout(Math.min(Math.max(wait, 1), 65) * 1000);
  }
  throw new Error(`${endpoint} kept hitting the rate limit`);
}
