import type { Page } from "@playwright/test";
import { expect, expectMainHeading, expectNoHorizontalScroll, test } from "./support/fixtures";
import { PUBLIC_PAGES, resolvePath } from "./support/pages";

async function checkPage(page: Page, scheme: "light" | "dark") {
  await expect(page.locator("html")).toHaveClass(scheme === "dark" ? /\bdark\b/ : /^(?!.*\bdark\b)/);
  await expectMainHeading(page);
  await expectNoHorizontalScroll(page);
}

/**
 * Every public page loads with no page/console errors (checked by the
 * shared fixture), shows its h1 and has no sideways scroll — first in light
 * mode, then again with the OS switched to dark (`colorScheme: 'dark'`).
 * One page load covers both, to stay under the dev server's per-IP
 * session-check limit.
 */
for (const route of PUBLIC_PAGES) {
  test(`${route} loads cleanly in light and dark`, async ({ page }) => {
    const url = await resolvePath(page.request, route);
    await page.emulateMedia({ colorScheme: "light" });
    const res = await page.goto(url);
    expect(res?.status(), `${url} status`).toBe(200);
    await page.waitForLoadState("networkidle");
    await checkPage(page, "light");

    await page.emulateMedia({ colorScheme: "dark" });
    await checkPage(page, "dark");
  });
}

test("a public page renders dark from the first paint", async ({ page }) => {
  await page.emulateMedia({ colorScheme: "dark" });
  await page.goto("/merchants");
  await checkPage(page, "dark");
});
