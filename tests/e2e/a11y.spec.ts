import AxeBuilder from "@axe-core/playwright";
import type { Page, TestInfo } from "@playwright/test";
import { adminTest, expect, memberTest, test } from "./support/fixtures";
import { ADMIN_PAGES, AUTH_PAGES, MEMBER_PAGES, PUBLIC_PAGES, resolvePath } from "./support/pages";

/**
 * axe (WCAG 2.0/2.1 A + AA) on every page, in light and dark, on both
 * projects (desktop 1280 px, Pixel 5 at 360 px), signed out and signed in.
 * Known issues that need a design decision are listed in KNOWN and skipped
 * by rule + page, each with a reason; everything else must be clean.
 */

// WCAG 2.1 A/AA, plus 2.2 AA for target-size (tap targets ≥ 24 px).
const TAGS = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

type Known = { rule: string; pages: RegExp; reason: string };
const KNOWN: Known[] = [];

type Found = { scheme: string; rule: string; impact: string; help: string; targets: string[] };

async function settle(page: Page) {
  // Pages poll every 20–30 s, so the network does go idle; Turnstile pages
  // keep a connection open, hence the cap.
  await page.waitForLoadState("networkidle", { timeout: 4_000 }).catch(() => {});
}

async function scan(page: Page, scheme: string): Promise<Found[]> {
  const res = await new AxeBuilder({ page })
    .withTags(TAGS)
    // Cloudflare's Turnstile iframe is third-party markup.
    .exclude('iframe[src*="challenges.cloudflare.com"]')
    .analyze();
  return res.violations.map((v) => ({
    scheme,
    rule: v.id,
    impact: v.impact ?? "",
    help: v.help,
    targets: v.nodes.map((n) => `${n.target.join(" ")} ${n.failureSummary?.split("\n")[1]?.trim() ?? ""}`),
  }));
}

/** Loads `url` in light mode, scans, flips to dark, scans again. */
async function audit(page: Page, url: string, testInfo: TestInfo) {
  await page.emulateMedia({ colorScheme: "light" });
  const res = await page.goto(url);
  expect(res?.status(), `${url} status`).toBeLessThan(400);
  await expect(page.getByRole("heading", { level: 1 }).first()).toBeVisible();
  await settle(page);
  const found = await scan(page, "light");

  await page.emulateMedia({ colorScheme: "dark" });
  await expect(page.locator("html")).toHaveClass(/\bdark\b/);
  found.push(...(await scan(page, "dark")));

  const path = new URL(page.url()).pathname;
  const known = found.filter((f) => KNOWN.some((k) => k.rule === f.rule && k.pages.test(path)));
  const open = found.filter((f) => !known.includes(f));
  if (found.length) {
    await testInfo.attach("axe-violations.json", {
      body: JSON.stringify({ url, found }, null, 2),
      contentType: "application/json",
    });
  }
  for (const k of known) testInfo.annotations.push({ type: "known-a11y", description: `${k.scheme} ${k.rule}` });
  expect(
    open.map((f) => `[${f.scheme}] ${f.rule} (${f.impact}): ${f.help}\n    ${f.targets.slice(0, 6).join("\n    ")}`),
    `axe violations on ${url}`,
  ).toEqual([]);
}

test.describe("a11y · signed out", () => {
  for (const route of [...PUBLIC_PAGES, ...AUTH_PAGES]) {
    test(`${route}`, async ({ page }, testInfo) => {
      await audit(page, await resolvePath(page.request, route), testInfo);
    });
  }
});

memberTest.describe("a11y · member", () => {
  for (const route of [...MEMBER_PAGES, "/", "/merchants/[id]", "/historical"]) {
    memberTest(`${route}`, async ({ page }, testInfo) => {
      await audit(page, await resolvePath(page.request, route), testInfo);
    });
  }
});

adminTest.describe("a11y · admin", () => {
  for (const route of ADMIN_PAGES) {
    adminTest(`${route}`, async ({ page }, testInfo) => {
      await audit(page, route, testInfo);
    });
  }
});
