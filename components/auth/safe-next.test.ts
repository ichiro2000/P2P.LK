import { describe, expect, it } from "vitest";
import { param, safeNext } from "@/components/auth/safe-next";

describe("safeNext", () => {
  it.each([
    ["/app", "/app"],
    ["/merchants/abc", "/merchants/abc"],
    ["/markets?ex=bybit&r=24h", "/markets?ex=bybit&r=24h"],
    ["/alerts#new", "/alerts#new"],
    ["/a/../reports", "/reports"], // dot segments resolved
    ["/sign-inx", "/sign-inx"], // only the exact auth routes are blocked
    ["/%2F%2Fevil.com", "/%2F%2Fevil.com"], // stays a same-site path
  ])("allows %j → %j", (raw, out) => {
    expect(safeNext(raw)).toBe(out);
  });

  it.each([
    ["//evil.com"],
    ["///evil.com"],
    ["/\\evil.com"],
    ["/\\/evil.com"],
    ["/x\\evil.com"],
    ["https://evil.com"],
    ["http://evil.com/app"],
    ["javascript:alert(1)"],
    ["JAVASCRIPT:alert(1)"],
    ["data:text/html,<script>alert(1)</script>"],
    ["evil.com"],
    ["app"],
    [" /app"], // leading space
    ["/\tevil.com"],
    ["/\nevil.com"],
    ["/\r\n//evil.com"],
    ["/app\u0000"],
    ["/app\u007f"],
    ["/sign-in"],
    ["/sign-in/"],
    ["/sign-in?next=/app"],
    ["/sign-up"],
    ["/verify"],
    ["/forgot-password/x"],
    ["/x/../sign-in"], // resolves to an auth page
    ["/.//evil.com"], // dot segment collapses to "//evil.com"
    ["/..//evil.com"],
    ["/a/..//evil.com"],
    ["/./\\evil.com"],
    [""],
  ])("rejects %j", (raw) => {
    expect(safeNext(raw)).toBeNull();
  });

  it("rejects over-long values", () => {
    expect(safeNext(`/${"a".repeat(511)}`)).toBe(`/${"a".repeat(511)}`);
    expect(safeNext(`/${"a".repeat(512)}`)).toBeNull();
  });

  it("takes the first value of an array and ignores non-strings", () => {
    expect(safeNext(["/app", "//evil.com"])).toBe("/app");
    expect(safeNext(["//evil.com", "/app"])).toBeNull();
    expect(safeNext([])).toBeNull();
    expect(safeNext(null)).toBeNull();
    expect(safeNext(undefined)).toBeNull();
  });

  it("the returned path never resolves off-site", () => {
    const attacks = ["/%2F%2Fevil.com", "/%5Cevil.com", "/.//evil.com", "/..//evil.com", "/%09/evil.com", "/./%2F/evil.com"];
    for (const a of attacks) {
      const out = safeNext(a);
      if (out != null) expect(new URL(out, "https://p2p.lk").origin).toBe("https://p2p.lk");
    }
  });
});

describe("param", () => {
  it("first value, or empty string", () => {
    expect(param("x")).toBe("x");
    expect(param(["a", "b"])).toBe("a");
    expect(param(undefined)).toBe("");
    expect(param([])).toBe("");
  });
});
