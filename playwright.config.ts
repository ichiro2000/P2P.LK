import { defineConfig, devices } from "@playwright/test";

/**
 * End-to-end tests (Phase 8). They run against the dev server that is
 * already up on :3000 (`next dev` with local D1/KV); this config never
 * starts or restarts a server. Test data uses `@e2e.test` emails only and
 * is removed by the global teardown.
 */
export default defineConfig({
  testDir: "tests/e2e",
  globalSetup: "./tests/e2e/global-setup.ts",
  globalTeardown: "./tests/e2e/global-teardown.ts",
  // Two workers at most: tests write to one local D1 file.
  workers: 2,
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  timeout: 60_000,
  expect: { timeout: 10_000 },
  reporter: [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    actionTimeout: 15_000,
    navigationTimeout: 30_000,
  },
  projects: [
    {
      name: "desktop",
      use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } },
    },
    {
      name: "mobile",
      // Pixel 5 profile (touch, mobile UA, DPR) narrowed to the 360 px target.
      use: { ...devices["Pixel 5"], viewport: { width: 360, height: 780 } },
    },
  ],
});
