import { expect, test } from "./support/fixtures";

test.describe("app shell", () => {
  test.beforeEach(async ({ context }) => {
    await context.addCookies([{ name: "ex", value: "binance", url: "http://localhost:3000" }]);
  });

  test("exchange switch changes the topbar and the page content", async ({ page, context }) => {
    await page.goto("/");
    const group = page.getByRole("radiogroup", { name: "Exchange" });
    const binance = group.getByRole("radio", { name: "Binance" });
    const bybit = group.getByRole("radio", { name: "Bybit" });
    await expect(binance).toHaveAttribute("aria-checked", "true");
    await expect(page.getByText("USDT / LKR · Binance P2P")).toBeVisible();

    await bybit.click();
    await expect(bybit).toHaveAttribute("aria-checked", "true");
    await expect(binance).toHaveAttribute("aria-checked", "false");
    // Topbar subtitle and the page body both re-render for Bybit.
    await expect(page.getByText("USDT / LKR · Bybit P2P")).toBeVisible();
    await expect(page.getByText(/Bybit P2P · LKR bank transfers/)).toBeVisible();
    await expect(page.getByText(/Binance P2P · LKR bank transfers/)).toHaveCount(0);
    expect((await context.cookies()).find((c) => c.name === "ex")?.value).toBe("bybit");

    // The choice sticks across a reload.
    await page.reload();
    await expect(page.getByRole("radiogroup", { name: "Exchange" }).getByRole("radio", { name: "Bybit" })).toHaveAttribute(
      "aria-checked",
      "true",
    );

    // Clicks before hydration do nothing; retry until the switch takes.
    const binanceAgain = page.getByRole("radiogroup", { name: "Exchange" }).getByRole("radio", { name: "Binance" });
    await expect(async () => {
      await binanceAgain.click();
      await expect(binanceAgain).toHaveAttribute("aria-checked", "true", { timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    await expect(page.getByText("USDT / LKR · Binance P2P")).toBeVisible();
  });

  test("theme toggle switches light and dark", async ({ page }) => {
    await page.emulateMedia({ colorScheme: "light" });
    await page.goto("/");
    const html = page.locator("html");
    await expect(html).not.toHaveClass(/\bdark\b/);

    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitemradio", { name: "Dark" }).click();
    await expect(html).toHaveClass(/\bdark\b/);

    // Remembered across navigation.
    await page.goto("/merchants");
    await expect(html).toHaveClass(/\bdark\b/);

    await page.getByRole("button", { name: "Theme" }).click();
    await page.getByRole("menuitemradio", { name: "Light" }).click();
    await expect(html).not.toHaveClass(/\bdark\b/);
  });

  test("⌘K / Ctrl+K palette navigates to a page", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { level: 1, name: "Live markets" })).toBeVisible();

    const dialog = page.getByRole("dialog", { name: "Search P2P.LK" });
    // The shortcut listener attaches on hydration; retry the keypress until then.
    await expect(async () => {
      if (!(await dialog.isVisible())) await page.keyboard.press("ControlOrMeta+k");
      await expect(dialog).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 15_000 });
    const input = dialog.getByRole("combobox");
    await expect(input).toBeFocused();
    await input.fill("liquidity");
    await expect(dialog.getByRole("option", { name: /Liquidity/ }).first()).toBeVisible();
    await input.press("Enter");

    await expect(page).toHaveURL(/\/liquidity$/);
    await expect(page.getByRole("heading", { level: 1, name: "Liquidity" })).toBeVisible();
    await expect(dialog).toBeHidden();
  });

  test("mobile tab bar navigates and More opens the menu", async ({ page, isMobile }) => {
    test.skip(!isMobile, "bottom tab bar is phone-only");
    await page.goto("/");
    const tabs = page.getByRole("navigation", { name: "Primary" });
    await expect(tabs).toBeVisible();

    await tabs.getByRole("link", { name: "Merchants" }).click();
    await expect(page).toHaveURL(/\/merchants$/);
    await expect(tabs.getByRole("link", { name: "Merchants" })).toHaveAttribute("aria-current", "page");
    await expect(page.getByRole("heading", { level: 1, name: "Merchants" })).toBeVisible();

    await tabs.getByRole("link", { name: "History" }).click();
    await expect(page).toHaveURL(/\/historical/);

    const more = tabs.getByRole("button", { name: "More" });
    await more.click();
    const sheet = page.getByRole("dialog");
    await expect(sheet).toBeVisible();
    await sheet.getByRole("link", { name: "Risk" }).click();
    await expect(page).toHaveURL(/\/risk$/);
    await expect(sheet).toBeHidden();
  });
});
