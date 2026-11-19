import type { Page } from "@playwright/test";
import { adminTest, expect, memberTest } from "./support/fixtures";
import { createUser, deleteUser, userRow } from "./support/users";

/** Table row on desktop, card list item on phones. */
function entry(page: Page, text: string) {
  return page
    .getByRole("row")
    .or(page.getByRole("listitem"))
    .filter({ hasText: text })
    .filter({ visible: true });
}

adminTest.describe("admin flows", () => {
  adminTest("approves a pending member and the audit log records it", async ({ page, admin }) => {
    const pending = await createUser({ tag: "pending", status: "pending_review" });
    try {
      await page.goto("/admin/members");
      await expect(page.getByRole("heading", { level: 1, name: "Members" })).toBeVisible();
      const row = entry(page, pending.email);
      await expect(row).toBeVisible();

      await row.getByRole("button", { name: "Approve" }).click();
      const dialog = page.getByRole("dialog", { name: "Approve this member?" });
      await expect(dialog).toContainText(pending.email);
      await dialog.getByRole("button", { name: "Approve" }).click();
      await expect(dialog).toBeHidden();
      await expect(page.getByText(`Approved — email sent · ${pending.name}`)).toBeVisible();
      await expect(row).toBeHidden();
      expect(userRow(pending.email)?.status).toBe("approved");

      await page.goto("/admin/audit");
      const audit = entry(page, pending.email).filter({ hasText: "member.approve" });
      await expect(audit.first()).toBeVisible();
      await expect(audit.first()).toContainText(admin.email);
    } finally {
      deleteUser(pending.email);
    }
  });

  adminTest("site banner flag shows the banner, then resets", async ({ page, browser }, testInfo) => {
    // The banner is one site-wide flag: run this on one project only so the
    // two projects don't flip it under each other. The phone layout is
    // checked from here with a 360 px context.
    adminTest.skip(testInfo.project.name !== "desktop", "global flag, exercised once (desktop + 360 px context)");
    const text = `E2E banner ${Date.now()}`;
    await page.goto("/admin/system");
    const field = page.getByLabel("Site banner");
    await expect(field).toHaveValue("");

    try {
      // Typing before hydration doesn't reach React state; retry until the
      // form sees the change (Save enables).
      const save = page.getByRole("button", { name: "Save banner" });
      await expect(async () => {
        await field.fill("");
        await field.fill(text);
        await expect(save).toBeEnabled({ timeout: 1_000 });
      }).toPass({ timeout: 15_000 });
      await save.click();
      const banner = page.getByRole("region", { name: "Announcement" });
      await expect(banner).toContainText(text);

      // Shown site-wide, including to the public pages. Other server module
      // instances cache flags for up to 15 s (by design), so reload until
      // the new text is everywhere.
      await expect(async () => {
        await page.goto("/merchants");
        await expect(page.getByRole("region", { name: "Announcement" })).toContainText(text, { timeout: 1_000 });
      }).toPass({ timeout: 45_000 });

      const phone = await browser.newContext({
        baseURL: "http://localhost:3000",
        viewport: { width: 360, height: 780 },
        isMobile: true,
        hasTouch: true,
      });
      try {
        const p = await phone.newPage();
        await expect(async () => {
          await p.goto("/");
          await expect(p.getByRole("region", { name: "Announcement" })).toContainText(text, { timeout: 1_000 });
        }).toPass({ timeout: 45_000 });
        const width = await p.evaluate(() => document.documentElement.scrollWidth);
        expect(width).toBeLessThanOrEqual(360);
      } finally {
        await phone.close();
      }
    } finally {
      // Reset through the UI (global teardown also restores the defaults).
      await expect(async () => {
        await page.goto("/admin/system");
        const remove = page.getByRole("button", { name: "Remove banner" });
        if (await remove.count()) await remove.click();
        await expect(remove).toHaveCount(0, { timeout: 3_000 });
        await expect(page.getByLabel("Site banner")).toHaveValue("", { timeout: 1_000 });
      }).toPass({ timeout: 45_000 });
      await expect(async () => {
        await page.goto("/merchants");
        await expect(page.getByRole("region", { name: "Announcement" })).toHaveCount(0, { timeout: 1_000 });
      }).toPass({ timeout: 45_000 });
    }
  });
});

memberTest("non-admins get a 404 on /admin", async ({ page, consoleErrors }) => {
  const res = await page.goto("/admin");
  expect(res?.status()).toBe(404);
  await expect(page.getByRole("heading", { name: "The page you're after is off-book" })).toBeVisible();

  const sub = await page.goto("/admin/members");
  expect(sub?.status()).toBe(404);

  // Known dev-only noise: when notFound() comes from the admin layout, React
  // re-renders the root on the client and warns about next-themes' inline
  // <script>. Reported; not an app error.
  const noise = /Encountered a script tag while rendering React component/;
  consoleErrors.splice(0, consoleErrors.length, ...consoleErrors.filter((e) => !noise.test(e)));
});
