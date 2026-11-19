import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const root = fileURLToPath(new URL(".", import.meta.url));

/**
 * Unit tests for the pure logic (lib/, components/, hooks/). Playwright E2E
 * lives in tests/e2e and is run separately.
 */
export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\//, replacement: `${root}/` },
      // `import "server-only"` throws outside a React Server Component build;
      // in unit tests it is just an empty module.
      { find: /^server-only$/, replacement: `${root}/vitest.server-only.ts` },
    ],
  },
  test: {
    environment: "node",
    include: ["lib/**/*.test.ts", "components/**/*.test.ts", "hooks/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/e2e/**", ".next/**", ".open-next/**", ".wrangler/**"],
    // Pin the zone so any Date formatting not routed through SLT helpers is
    // still deterministic.
    env: { TZ: "UTC" },
  },
});
