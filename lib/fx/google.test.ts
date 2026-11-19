import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { googleDue, parseGoogleFinance } from "./google";

const fixture = readFileSync(join(__dirname, "__fixtures__/google-finance-usd-lkr.html"), "utf8");

describe("parseGoogleFinance", () => {
  it("reads price and previous close from the real page", () => {
    expect(parseGoogleFinance(fixture)).toEqual({ price: 332.9905, prevClose: 332.8847 });
  });
  it("ignores the related-instrument price spans", () => {
    expect(() => parseGoogleFinance('<span jsname="Pdsbrc" class=""><span>331.5</span></span>')).toThrow(/not found/);
  });
  it("rejects a page without the price", () => {
    expect(() => parseGoogleFinance("<html>consent</html>")).toThrow(/not found/);
  });
  it("rejects implausible values", () => {
    expect(() => parseGoogleFinance('"USD / LKR",3,null,[3.3,0.1,0.03,4],null,3.2')).toThrow(/implausible/);
  });
  it("rejects when two USD/LKR entries disagree", () => {
    const html = `"USD / LKR",3,null,[332.99,0.1,0.03,4],null,332.88 … "USD / LKR",3,null,[350.0,0.1,0.03,4],null,332.88`;
    expect(() => parseGoogleFinance(html)).toThrow(/conflicting/);
  });
});

describe("googleDue", () => {
  it("runs at :03 and :33 UTC only", () => {
    expect(googleDue(new Date("2026-11-20T10:03:00Z"))).toBe(true);
    expect(googleDue(new Date("2026-11-20T10:33:00Z"))).toBe(true);
    expect(googleDue(new Date("2026-11-20T10:17:00Z"))).toBe(false);
  });
});
