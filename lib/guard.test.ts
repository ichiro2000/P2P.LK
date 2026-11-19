import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

// guard.ts also holds the rate-limit / Turnstile / admin gates, which need
// Cloudflare bindings and auth. Only the pure validators are tested here.
vi.mock("@/lib/db/client", () => ({ getEnv: vi.fn() }));
vi.mock("@/lib/auth/session", () => ({ adminFromRequest: vi.fn() }));

import { validate, zRequiredText, zText } from "@/lib/guard";

describe("zText (optional text)", () => {
  const s = zText(5);

  it("trims; empty / whitespace / null / undefined all become null", () => {
    expect(s.parse("  hi  ")).toBe("hi");
    expect(s.parse("")).toBeNull();
    expect(s.parse("   ")).toBeNull();
    expect(s.parse(null)).toBeNull();
    expect(s.parse(undefined)).toBeNull();
  });

  it("max length applies after trimming", () => {
    expect(s.parse("  12345  ")).toBe("12345");
    const r = s.safeParse("123456");
    expect(r.success).toBe(false);
    expect(r.error?.issues[0].message).toBe("must be at most 5 characters");
  });

  it("rejects non-strings", () => {
    expect(s.safeParse(5).success).toBe(false);
  });

  it("works as an optional object field", () => {
    const o = z.object({ note: zText(10) });
    expect(o.parse({})).toEqual({ note: null });
    expect(o.parse({ note: " x " })).toEqual({ note: "x" });
  });
});

describe("zRequiredText", () => {
  const s = zRequiredText(5, "Name is required");

  it("trims and requires at least one character", () => {
    expect(s.parse("  Ann ")).toBe("Ann");
    expect(s.safeParse("   ").error?.issues[0].message).toBe("Name is required");
    expect(s.safeParse("").error?.issues[0].message).toBe("Name is required");
  });

  it("missing / wrong type uses the custom message", () => {
    expect(s.safeParse(undefined).error?.issues[0].message).toBe("Name is required");
    expect(s.safeParse(42).error?.issues[0].message).toBe("Name is required");
  });

  it("enforces the max length", () => {
    expect(s.safeParse("123456").error?.issues[0].message).toBe("must be at most 5 characters");
  });
});

describe("validate", () => {
  const schema = z.object({ name: zRequiredText(10, "required"), meta: z.object({ age: z.number().int() }) });

  it("returns the parsed data on success", () => {
    expect(validate(schema, { name: " Bo ", meta: { age: 3 } })).toEqual({
      ok: true,
      data: { name: "Bo", meta: { age: 3 } },
    });
  });

  it("returns a 400 no-store JSON response naming the first bad field", async () => {
    const r = validate(schema, { name: "", meta: { age: 1.5 } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.res.status).toBe(400);
    expect(r.res.headers.get("Cache-Control")).toBe("no-store");
    const body = (await r.res.json()) as { error: string; issues: unknown[] };
    expect(body.error).toBe("name: required");
    expect(body.issues).toEqual([
      { path: "name", message: "required" },
      { path: "meta.age", message: expect.any(String) },
    ]);
  });

  it("uses 'input' when the issue has no path", async () => {
    const r = validate(z.string(), 5);
    if (r.ok) throw new Error("expected failure");
    expect(((await r.res.json()) as { error: string }).error).toMatch(/^input: /);
  });
});
