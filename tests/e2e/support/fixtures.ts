import fs from "node:fs";
import path from "node:path";
import { test as base, expect, type ConsoleMessage, type Page } from "@playwright/test";
import { apiSignIn } from "./auth";
import { createUser, deleteUser, type TestUser } from "./users";

export { expect };

export type SignedInUser = TestUser & { statePath: string };

const AUTH_DIR = path.resolve(__dirname, "../.auth");

/** Console noise that is expected and harmless. */
const ALLOWED_CONSOLE = [
  // Signed-out member-data probes answer 401 by design.
  /status of 401/,
  // React dev-only hint.
  /Download the React DevTools/,
  // Better Auth's per-IP limits (incl. 60/min on get-session) are shared
  // by every local client on this machine; a burst of page loads trips
  // them. The forms' own retries handle sign-in. Reported as a product
  // issue (CGNAT users share IPs) — see the e2e report.
  /status of 429 \(Too Many Requests\).*\/api\/auth\//,
  // The browser logs the 404 document itself on not-found pages.
  /status of 404 \(Not Found\)/,
];

/** Collects uncaught page errors and console errors for one page. */
export function watchErrors(page: Page) {
  const errors: string[] = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (m: ConsoleMessage) => {
    if (m.type() !== "error") return;
    const line = `console: ${m.text()} (${m.location().url})`;
    if (ALLOWED_CONSOLE.some((re) => re.test(line))) return;
    errors.push(line);
  });
  return errors;
}

async function signedInUser(
  kind: "member" | "admin",
  playwright: import("@playwright/test").PlaywrightWorkerArgs["playwright"],
  workerIndex: number,
): Promise<SignedInUser> {
  const user = await createUser({ tag: kind, role: kind === "admin" ? "admin" : "user", status: "approved" });
  const request = await playwright.request.newContext({ baseURL: "http://localhost:3000" });
  try {
    await apiSignIn(request, user);
    fs.mkdirSync(AUTH_DIR, { recursive: true });
    const statePath = path.join(AUTH_DIR, `${kind}-${workerIndex}.json`);
    await request.storageState({ path: statePath });
    return { ...user, statePath };
  } finally {
    await request.dispose();
  }
}

type WorkerFixtures = { member: SignedInUser; admin: SignedInUser };

/**
 * `member` / `admin`: one approved account per worker, created in D1 and
 * signed in once through the API (keeps well under the sign-in rate limit),
 * deleted when the worker ends.
 */
export const test = base.extend<{ consoleErrors: string[] }, WorkerFixtures>({
  /** Every test fails on uncaught page errors or console errors (see
   *  ALLOWED_CONSOLE). Tests that expect some can read and clear the list. */
  consoleErrors: [
    async ({ page }, use) => {
      const errors = watchErrors(page);
      await use(errors);
      expect(errors, "page errors / console errors during the test").toEqual([]);
    },
    { auto: true },
  ],
  member: [
    async ({ playwright }, use, workerInfo) => {
      const u = await signedInUser("member", playwright, workerInfo.workerIndex);
      await use(u);
      deleteUser(u.email);
      fs.rmSync(u.statePath, { force: true });
    },
    // Own budget: a sign-in may have to wait out the per-IP rate limit.
    { scope: "worker", timeout: 150_000 },
  ],
  admin: [
    async ({ playwright }, use, workerInfo) => {
      const u = await signedInUser("admin", playwright, workerInfo.workerIndex);
      await use(u);
      deleteUser(u.email);
      fs.rmSync(u.statePath, { force: true });
    },
    // Own budget: a sign-in may have to wait out the per-IP rate limit.
    { scope: "worker", timeout: 150_000 },
  ],
});

/** `page` is signed in as the worker's approved member. */
export const memberTest = test.extend({
  storageState: async ({ member }, provide) => provide(member.statePath),
});

/** `page` is signed in as the worker's admin. */
export const adminTest = test.extend({
  storageState: async ({ admin }, provide) => provide(admin.statePath),
});

/** No horizontal page scroll at the current viewport width. */
export async function expectNoHorizontalScroll(page: Page) {
  const width = page.viewportSize()!.width;
  const scrollWidth = await page.evaluate(() => document.documentElement.scrollWidth);
  expect(scrollWidth, `page is ${scrollWidth}px wide in a ${width}px viewport`).toBeLessThanOrEqual(width);
}

/** The page's `<h1>` (topbar title or auth card title) is on screen. */
export async function expectMainHeading(page: Page) {
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
}
