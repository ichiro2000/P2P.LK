import { readCode, submitProtectedForm } from "./support/auth";
import { expect, test } from "./support/fixtures";
import { deleteUser, e2eEmail, e2ePassword } from "./support/users";

/**
 * The whole account journey through the UI: sign up → emailed code →
 * verify → pending review → sign out → sign in → status page, then a
 * password reset and a sign-in with the new password.
 */
test.describe("auth journey", () => {
  const email = e2eEmail("journey");
  const password = e2ePassword();
  const newPassword = e2ePassword();

  test.afterAll(() => deleteUser(email));

  test("sign up, verify, review, sign in, reset password", async ({ page }) => {
    test.setTimeout(180_000);
    const pending = page.getByRole("heading", { level: 1, name: "Thanks, we're reviewing your account" });

    await test.step("sign up", async () => {
      await page.goto("/sign-up");
      await expect(page.getByRole("heading", { level: 1, name: /create/i })).toBeVisible();
      // Step 1 of 2: the account.
      await expect(page.getByText("Step 1 of 2 · Your account")).toBeVisible();
      await page.getByRole("button", { name: "Continue" }).click();
      await expect(page.getByText("Enter your name.")).toBeVisible(); // can't skip ahead empty
      await page.getByLabel("Your name").fill("E2E Journey");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByLabel("Confirm password").fill(password);
      await page.getByRole("button", { name: "Continue" }).click();

      // Step 2 of 2: merchant details (Back keeps what was typed).
      await expect(page.getByText("Step 2 of 2 · Your merchant details")).toBeVisible();
      await page.getByRole("button", { name: "Back" }).click();
      await expect(page.getByLabel("Your name")).toHaveValue("E2E Journey");
      await page.getByRole("button", { name: "Continue" }).click();
      await page.getByLabel("Merchant name").fill("E2E Journey Desk");
      await page.getByLabel("WhatsApp number").fill("077 123 4567");
      await expect(page.getByText("Saved as +94771234567")).toBeVisible();
      await page.getByRole("checkbox", { name: /I agree/ }).check();
      const since = Date.now();
      const res = await submitProtectedForm(page, page.getByRole("button", { name: "Create account" }), "/sign-up/email");
      expect(res.status()).toBe(200);
      await expect(page).toHaveURL(/\/verify\?email=/);

      let code = await readCode(page.request, email, { subject: /verification code/, since });
      if (!code) {
        // Lost in the shared dev outbox: use the real "Resend code" button,
        // which unlocks after its 60 s cooldown.
        const resend = page.getByRole("button", { name: "Resend code" });
        await expect(resend).toBeEnabled({ timeout: 65_000 });
        const again = Date.now();
        await resend.click();
        code = await readCode(page.request, email, { subject: /verification code/, since: again });
      }
      expect(code, "verification code mailed").not.toBeNull();
      await test.step("verify the emailed code", async () => {
        // Six digits auto-submit.
        await page.getByLabel("Verification code").fill(code!);
        await expect(page).toHaveURL(/\/account\/status$/);
        await expect(pending).toBeVisible();
      });
    });

    await test.step("sign out", async () => {
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL("/");
      await expect(page.getByRole("button", { name: "Sign in" }).first()).toBeVisible();
    });

    await test.step("sign in lands on the status page", async () => {
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      const res = await submitProtectedForm(page, page.getByRole("button", { name: "Sign in" }), "/sign-in/email");
      expect(res.status()).toBe(200);
      await expect(page).toHaveURL(/\/account\/status$/);
      await expect(pending).toBeVisible();
      await page.getByRole("button", { name: "Sign out" }).click();
      await expect(page).toHaveURL("/");
    });

    await test.step("forgot password → reset → sign in with the new password", async () => {
      await page.goto("/sign-in");
      await page.getByRole("link", { name: "Forgot password?" }).click();
      await expect(page).toHaveURL(/\/forgot-password/);
      await page.getByLabel("Email").fill(email);
      let code: string | null = null;
      for (let attempt = 0; attempt < 2 && !code; attempt++) {
        if (attempt > 0) await page.getByRole("button", { name: "Use a different email or resend" }).click();
        const since = Date.now();
        await submitProtectedForm(page, page.getByRole("button", { name: "Send reset code" }), "/forget-password/email-otp");
        await expect(page.getByLabel("Reset code")).toBeVisible();
        code = await readCode(page.request, email, { subject: /password reset code/, since });
      }
      expect(code, "reset code mailed").not.toBeNull();
      await page.getByLabel("Reset code").fill(code!);
      await page.getByLabel("New password", { exact: true }).fill(newPassword);
      await page.getByLabel("Confirm new password").fill(newPassword);
      await page.getByRole("button", { name: "Set new password" }).click();

      await expect(page).toHaveURL(/\/sign-in\?reset=1/);
      await expect(page.getByText("Password changed. Sign in with your new password.")).toBeVisible();
      await expect(page.getByLabel("Email")).toHaveValue(email);
      await page.getByLabel("Password", { exact: true }).fill(newPassword);
      const res = await submitProtectedForm(page, page.getByRole("button", { name: "Sign in" }), "/sign-in/email");
      expect(res.status()).toBe(200);
      await expect(page).toHaveURL(/\/account\/status$/);
      await expect(pending).toBeVisible();
    });
  });
});
