import { describe, expect, it } from "vitest";
import { BANNER_MAX, DEFAULT_FLAGS, FLAGS_KEY, FlagsSchema } from "@/lib/flags-schema";

describe("flags schema", () => {
  it("defaults: sign-ups, alert emails and the FX collector on, no banner", () => {
    expect(DEFAULT_FLAGS).toEqual({ signupsOpen: true, alertEmails: true, fxCollector: true, banner: "" });
    expect(FLAGS_KEY).toBe("flags:v1");
  });

  it("the defaults validate against the schema", () => {
    expect(FlagsSchema.parse(DEFAULT_FLAGS)).toEqual(DEFAULT_FLAGS);
  });

  it("banner is trimmed and capped", () => {
    expect(FlagsSchema.parse({ ...DEFAULT_FLAGS, banner: "  Maintenance tonight  " }).banner).toBe(
      "Maintenance tonight",
    );
    expect(FlagsSchema.safeParse({ ...DEFAULT_FLAGS, banner: "x".repeat(BANNER_MAX) }).success).toBe(true);
    expect(FlagsSchema.safeParse({ ...DEFAULT_FLAGS, banner: "x".repeat(BANNER_MAX + 1) }).success).toBe(false);
  });

  it("every flag is required and typed", () => {
    expect(FlagsSchema.safeParse({ ...DEFAULT_FLAGS, signupsOpen: "yes" }).success).toBe(false);
    const { fxCollector: _omit, ...missing } = DEFAULT_FLAGS;
    expect(FlagsSchema.safeParse(missing).success).toBe(false);
  });
});
