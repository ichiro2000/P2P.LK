import { describe, expect, it } from "vitest";
import {
  addDays,
  decodeEntities,
  findDate,
  findTable,
  FxParseError,
  htmlTables,
  num,
  RateBag,
  sltDate,
  textOf,
} from "@/lib/fx/http";

const NOW = new Date("2026-11-19T06:00:00Z"); // 11:30 in Colombo

describe("num (strict cell parser)", () => {
  it.each([
    ["1,234.50", 1234.5],
    [" 330.40 ", 330.4],
    ["2.0511", 2.0511],
    ["12", 12],
  ])("%j → %d", (cell, v) => {
    expect(num(cell)).toBe(v);
  });

  it.each([undefined, "", "-", "0", "0.0000", "N/A", "-330.5", "330.5x", "1e3", "330."])("%j → null", (cell) => {
    expect(num(cell)).toBeNull();
  });
});

describe("HTML helpers", () => {
  it("decodeEntities handles named, decimal and hex entities", () => {
    expect(decodeEntities("A &amp; B &lt;x&gt; &#39;q&#39; &#x2014; &nbsp;&unknown;")).toBe("A & B <x> 'q' \u2014  &unknown;");
  });

  it("textOf strips tags and collapses whitespace", () => {
    expect(textOf("<td>\n <img src=x> &nbsp; USD </td>")).toBe("USD");
  });

  it("htmlTables reads th/td cells per row and skips commented-out markup", () => {
    const html = `
      <table><tr><th>Code</th><th>Buy</th></tr>
      <tr><td>USD</td><!-- <td>999</td> --><td>330.5</td></tr></table>
      <table><tr><td>other</td></tr></table>`;
    const t = htmlTables(html);
    expect(t).toHaveLength(2);
    expect(t[0].rows).toEqual([
      ["Code", "Buy"],
      ["USD", "330.5"],
    ]);
  });

  it("findTable matches every needle, case-insensitive", () => {
    const html = "<table><tr><td>Bank Notes</td></tr></table><table><tr><td>bank notes telegraphic transfers</td></tr></table>";
    expect(findTable(html, ["Bank Notes", "Telegraphic Transfers"])?.text).toBe("bank notes telegraphic transfers");
    expect(findTable(html, ["missing"])).toBeNull();
  });
});

describe("dates", () => {
  it("sltDate is the calendar day in Colombo", () => {
    expect(sltDate(new Date("2026-11-19T18:29:59Z"))).toBe("2026-11-19");
    expect(sltDate(new Date("2026-11-19T18:30:00Z"))).toBe("2026-11-20");
  });

  it("addDays crosses month and year boundaries", () => {
    expect(addDays("2026-11-30", 1)).toBe("2026-12-01");
    expect(addDays("2026-01-01", -1)).toBe("2025-12-31");
  });

  it.each([
    ["Rate as at 2026-11-19", "2026-11-19"],
    ["19.11.2026", "2026-11-19"],
    ["18/11/2026", "2026-11-18"],
    ["17 Nov 2026", "2026-11-17"],
    ["16th November 2026", "2026-11-16"],
    ["Thursday, November 19 2026, 08:17:33 AM", "2026-11-19"],
    ["Nov. 9, 2026", null], // abbreviation with dot after month isn't a supported shape
  ])("findDate(%j) → %s", (text, out) => {
    expect(findDate(text, NOW)).toBe(out);
  });

  it("accepts up to 10 days stale, clamps tomorrow to today, rejects further", () => {
    expect(findDate("2026-11-09", NOW)).toBe("2026-11-09");
    expect(findDate("2026-11-08", NOW)).toBeNull();
    expect(findDate("2026-11-20", NOW)).toBe("2026-11-19");
    expect(findDate("2026-11-21", NOW)).toBeNull();
  });

  it("rejects impossible or missing dates", () => {
    expect(findDate("2026-13-01", NOW)).toBeNull();
    expect(findDate("32/11/2026", NOW)).toBeNull();
    expect(findDate("no date here", NOW)).toBeNull();
  });
});

describe("RateBag", () => {
  it("keeps plausible values keyed by currency/type/day", () => {
    const bag = new RateBag("t", "2026-11-19");
    bag.pair("USD", "tt", 328.75, 336.75);
    bag.add("USD", "tt_buy", 329); // same key → replaces
    bag.add(null, "tt_buy", 1);
    bag.add("EUR", "tt_buy", null);
    expect(bag.finish()).toEqual([
      { currency: "USD", rateType: "tt_buy", value: 329, asOf: "2026-11-19" },
      { currency: "USD", rateType: "tt_sell", value: 336.75, asOf: "2026-11-19" },
    ]);
  });

  it("rejects USD/LKR outside 150–600", () => {
    const bag = new RateBag("t", "2026-11-19");
    bag.add("USD", "indicative", 149);
    bag.add("USD", "indicative", 601);
    expect(bag.rejected).toBe(2);
    expect(() => bag.finish()).toThrow(FxParseError);
  });

  it("drops a pair whose buy is above its sell, or whose spread is over 20 %", () => {
    const bag = new RateBag("t", "2026-11-19");
    bag.pair("USD", "tt", 340, 330);
    bag.pair("USD", "cash", 260, 340);
    expect(bag.rejected).toBe(2);
    // A 0.1 % inversion is tolerated (rounding on bank pages).
    bag.pair("USD", "tt", 330.3, 330);
    expect(bag.rejected).toBe(2);
  });

  it("one-sided pairs keep the side that exists", () => {
    const bag = new RateBag("t", "2026-11-19");
    bag.pair("USD", "cash", null, 337.4);
    expect(bag.finish()).toEqual([{ currency: "USD", rateType: "cash_sell", value: 337.4, asOf: "2026-11-19" }]);
  });

  it("finish() throws when no USD came through", () => {
    const bag = new RateBag("src", "2026-11-19");
    bag.add("EUR", "tt_buy", 360);
    expect(() => bag.finish()).toThrow("[src] no USD rate parsed (1 rows, 0 rejected)");
  });
});
