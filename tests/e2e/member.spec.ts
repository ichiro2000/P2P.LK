import { submitProtectedForm } from "./support/auth";
import { expect, memberTest, test } from "./support/fixtures";

/** Member flows: the worker's approved account (created in D1, signed in once). */
memberTest.describe("member flows", () => {
  memberTest.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "ex", value: "binance", url: "http://localhost:3000" }]);
  });

  memberTest("dashboard renders", async ({ page, member }) => {
    await page.goto("/app");
    await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
    await expect(page.getByText(member.merchantName).first()).toBeVisible();
  });

  memberTest("star a market and find it in the workspace", async ({ page }) => {
    await page.goto("/historical");
    const star = page.getByRole("button", { name: /^(Add USDT\/LKR to|Remove USDT\/LKR from) watchlist$/ });
    await expect(star).toHaveAttribute("aria-pressed", "false");
    // Clicks are ignored until the synced list has loaded; retry until it sticks.
    await expect(async () => {
      if ((await star.getAttribute("aria-pressed")) !== "true") await star.click();
      await expect(star).toHaveAttribute("aria-pressed", "true", { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });

    await page.goto("/workspace");
    const watchlist = page.getByRole("region", { name: "Watchlist" });
    await expect(watchlist.getByRole("link", { name: /USDT\/LKR/ })).toBeVisible();

    // Clean up: unstar from the workspace card.
    await watchlist.getByRole("button", { name: "Remove USDT/LKR from watchlist" }).click();
    await expect(watchlist.getByText("No markets saved yet")).toBeVisible();
  });

  memberTest("alert rule fires on a tick and lands in the inbox", async ({ page }) => {
    await page.goto("/alerts");
    await expect(page.getByRole("heading", { level: 1, name: "Alerts" })).toBeVisible();
    // The form is a no-op until the client knows the member's session; the
    // rules list only renders (empty state) once it does.
    // If the shared per-IP session check was rate-limited (see report), the
    // client stays in guest mode until a reload.
    await expect(async () => {
      if (!(await page.getByRole("region", { name: "Rules" }).getByText("No alert rules yet").isVisible())) {
        await page.reload();
      }
      await expect(page.getByRole("region", { name: "Rules" }).getByText("No alert rules yet")).toBeVisible({
        timeout: 8_000,
      });
    }).toPass({ timeout: 45_000 });

    // Mid price above Rs 1: true for any live USDT/LKR book.
    await page.getByLabel(/^Threshold/).fill("1");
    await page.getByRole("switch", { name: "Email me" }).click();
    await expect(page.getByText("In-app only")).toBeVisible();
    await page.getByRole("button", { name: "Add rule" }).click();
    const rules = page.getByRole("region", { name: "Rules" });
    const rule = rules.getByRole("listitem").filter({ hasText: "Mid above" });
    await expect(rule).toContainText("Rs 1.00");

    const tick = await page.request.get("/api/dev/tick", { timeout: 60_000 });
    expect(tick.ok()).toBe(true);

    const inbox = page.getByRole("region", { name: "Inbox" });
    await expect(async () => {
      await page.reload();
      await expect(inbox.getByText(/Binance mid above Rs 1\.00/).first()).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });

    // Clean up: clear the inbox and delete the rule.
    await inbox.getByRole("button", { name: "Clear" }).click();
    await expect(inbox.getByText("No events yet")).toBeVisible();
    await rule.getByRole("button", { name: "Delete rule" }).click();
    await expect(rules.getByText("No alert rules yet")).toBeVisible();
  });

  memberTest("blocking a merchant hides their ads on Markets", async ({ page }) => {
    const market = await page.request.get("/api/p2p/market?exchange=binance");
    const { ads } = (await market.json()) as { ads: { tradeType: string; merchant: { id: string; name: string } }[] };
    // The Markets table opens on the "Buy USDT" side, i.e. SELL ads. A
    // brand-new advertiser has no detail page until the next sweep, so take
    // the first one the merchant page knows.
    let target: { id: string; name: string } | undefined;
    for (const a of ads.filter((x) => x.tradeType === "SELL").slice(0, 10)) {
      const html = await (await page.request.get(`/merchants/${encodeURIComponent(a.merchant.id)}`)).text();
      if (!html.includes("Merchant not found")) {
        target = a.merchant;
        break;
      }
    }
    if (!target) return test.skip(true, "no live Binance ads to block");

    await page.goto(`/merchants/${encodeURIComponent(target.id)}`);
    const saved = page.waitForResponse(
      (r) => r.url().includes("/api/me/items") && r.request().method() !== "GET" && r.ok(),
    );
    await page.getByRole("button", { name: `Block ${target.name}` }).click();
    await saved;
    const unblock = page.getByRole("button", { name: `Unblock ${target.name}` });
    await expect(unblock).toHaveAttribute("aria-pressed", "true");

    // The target comes from the all-publishers book, so show every publisher
    // (the Markets default is verified merchants only).
    await page.goto("/?merchantType=all");
    await expect(page.getByText(/\d+ ads? hidden by your blocklist/)).toBeVisible();

    // Clean up.
    await page.goto(`/merchants/${encodeURIComponent(target.id)}`);
    const removed = page.waitForResponse(
      (r) => r.url().includes("/api/me/items") && r.request().method() !== "GET" && r.ok(),
    );
    await page.getByRole("button", { name: `Unblock ${target.name}` }).click();
    await removed;
    await expect(page.getByRole("button", { name: `Block ${target.name}` })).toHaveAttribute("aria-pressed", "false");
  });

  memberTest("7-day history is open to members", async ({ page }) => {
    await page.goto("/historical");
    const range = page.getByRole("radiogroup", { name: "Time range" });
    await range.getByRole("radio", { name: "7D" }).click();
    await expect(page).toHaveURL(/[?&]range=7d/);
    await expect(range.getByRole("radio", { name: "7D" })).toHaveAttribute("aria-checked", "true");
    await expect(page.getByRole("heading", { level: 2, name: "USDT/LKR over 7d" })).toBeVisible();
  });
});

test("7-day history is locked for guests", async ({ page }) => {
  await page.goto("/historical?range=7d");
  // The server falls back to 24h for guests.
  await expect(page.getByRole("heading", { level: 2, name: "USDT/LKR over 24h" })).toBeVisible();
  const range = page.getByRole("radiogroup", { name: "Time range" });
  await expect(range.getByRole("radio", { name: "7D" })).toHaveCount(0);
  const locked = range.getByRole("link", { name: "7D: members only. Create a free account" });
  await expect(locked).toHaveAttribute("href", /^\/sign-up\?next=/);
});

test("approved member signs in through the UI and a hostile ?next stays on site", async ({ page, member }) => {
  await page.goto("/sign-in?next=//evil.com");
  await page.getByLabel("Email").fill(member.email);
  await page.getByLabel("Password", { exact: true }).fill(member.password);
  const res = await submitProtectedForm(page, page.getByRole("button", { name: "Sign in" }), "/sign-in/email");
  expect(res.status()).toBe(200);
  await expect(page).toHaveURL("http://localhost:3000/app");
  await expect(page.getByRole("heading", { level: 1, name: "Dashboard" })).toBeVisible();
});
