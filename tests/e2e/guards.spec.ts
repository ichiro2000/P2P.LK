import { expect, test } from "./support/fixtures";

/** Guests are bounced to sign-in with a `next` back to where they were. */
for (const path of ["/app", "/account", "/admin"]) {
  test(`guest on ${path} gets a 307 to sign-in`, async ({ page }) => {
    const res = await page.request.get(path, { maxRedirects: 0 });
    expect(res.status()).toBe(307);
    const location = new URL(res.headers()["location"], "http://localhost:3000");
    expect(location.origin).toBe("http://localhost:3000");
    expect(location.pathname).toBe("/sign-in");
    expect(location.searchParams.get("next")).toBe(path);
  });
}

// Known gap: requireAdminPage() (lib/auth/session.ts, out of scope here)
// always sends `next=/admin`, so a guest opening /admin/system lands on the
// admin overview after signing in instead of the page they asked for.
test("guest on an admin sub-page keeps the deep link in next", async ({ page }) => {
  const res = await page.request.get("/admin/system", { maxRedirects: 0 });
  expect(res.status()).toBe(307);
  expect(new URL(res.headers()["location"], "http://localhost:3000").searchParams.get("next")).toBe("/admin/system");
});

test("guest following the redirect sees the sign-in form", async ({ page }) => {
  await page.goto("/account");
  await expect(page).toHaveURL(/\/sign-in\?next=%2Faccount$/);
  await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
});

/** Hostile `next` values never produce an off-site link. Signing in with
 *  one is covered in member.spec.ts. */
for (const next of ["//evil.com", "/\\evil.com", "https://evil.com", "%2F%2Fevil.com"]) {
  test(`sign-in ignores next=${next}`, async ({ page }) => {
    await page.goto(`/sign-in?next=${encodeURIComponent(next)}`);
    await expect(page.getByRole("heading", { level: 1, name: "Sign in" })).toBeVisible();
    const signUp = page.getByRole("link", { name: "Create a free account" });
    await expect(signUp).toHaveAttribute("href", "/sign-up");
    const hrefs = await page.getByRole("link").evaluateAll((as) => as.map((a) => (a as HTMLAnchorElement).href));
    for (const h of hrefs) expect(new URL(h).hostname, h).toBe("localhost");
  });
}
