import { describe, expect, it } from "vitest";
import { safeHttpsUrl } from "./safe-url";
import { parseBinanceProfile } from "./qr";
import { escapeCell } from "./csv";

describe("security regressions", () => {
  it("only https links become hrefs", () => {
    expect(safeHttpsUrl("https://p2p.binance.com/en/x")).toBe("https://p2p.binance.com/en/x");
    for (const bad of ["javascript:alert(1)", "javascript://binance.com/%0aalert(1)", "data:text/html,x", "http://p2p.binance.com/", "https://u:p@binance.com/", "", null]) {
      expect(safeHttpsUrl(bad)).toBeNull();
    }
  });

  it("QR content with a non-web scheme never becomes a stored profile link", () => {
    const r = parseBinanceProfile("javascript://binance.com/%0aalert(document.domain)");
    expect(r?.profileUrl ?? "").not.toMatch(/^javascript:/i);
    const ok = parseBinanceProfile("http://s.binance.com/AbC12345");
    expect(ok?.profileUrl).toBe("https://s.binance.com/AbC12345");
  });

  it("CSV cells that a spreadsheet would run as formulas are neutralised", () => {
    for (const v of ["=1+1", " =cmd", "+x", "-x", "@x", "\t=x"]) expect(escapeCell(v).replace(/^"/, "")).toMatch(/^'/);
    expect(escapeCell("plain")).toBe("plain");
  });
});
