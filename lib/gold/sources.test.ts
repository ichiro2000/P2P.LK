import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseDeviTable, parseGulfNews, parseKhaleejTimes } from "./sources";

const fx = (f: string) => readFileSync(join(__dirname, "__fixtures__", f), "utf8");

describe("parseKhaleejTimes", () => {
  it("reads 24K and 22K from the real page's data-page JSON (22 Nov 2026)", () => {
    expect(parseKhaleejTimes(fx("khaleejtimes.html"))).toEqual([
      { karat: 24, value: 426.5 },
      { karat: 22, value: 395 },
    ]);
  });

  it("takes the latest non-empty slot (evening is empty until set)", () => {
    const page = (ev: string) =>
      `<div data-page="${JSON.stringify({
        props: { goldRates: { rates: [{ type: "24K", morning: "426.50", afternoon: "428.00", evening: ev }] } },
      }).replace(/"/g, "&quot;")}"></div>`;
    expect(parseKhaleejTimes(page(""))[0].value).toBe(428);
    expect(parseKhaleejTimes(page("430.25"))[0].value).toBe(430.25);
  });

  it("fails loudly on a changed page or an implausible number", () => {
    expect(() => parseKhaleejTimes("<html>nothing</html>")).toThrow(/data-page/);
    const tiny = `<div data-page="{&quot;props&quot;:{&quot;goldRates&quot;:{&quot;rates&quot;:[{&quot;type&quot;:&quot;24K&quot;,&quot;morning&quot;:&quot;4.26&quot;}]}}}"></div>`;
    expect(() => parseKhaleejTimes(tiny)).toThrow(/implausible/);
  });
});

describe("parseGulfNews", () => {
  it("reads the embedded goldApiData (real page, 22 Nov 2026)", () => {
    expect(parseGulfNews(fx("gulfnews.html"))).toEqual([
      { karat: 24, value: 426.5 },
      { karat: 22, value: 395 },
    ]);
  });
  it("never falls through to another country's prices when a UAE key is missing", () => {
    const page = fx("gulfnews.html").replace(/"carat24":\{[^}]*\},?/, "") + '"SAU":{"carat24":{"morning":441}}';
    expect(() => parseGulfNews(page)).toThrow(/implausible/);
    const withCountries = `"goldApiData":{"carat22":{"morning":395},"carat24":{"morning":426.5},"SAU":{"carat22":{"morning":404},"carat24":{"morning":441}}}`;
    expect(parseGulfNews(withCountries)).toEqual([
      { karat: 24, value: 426.5 },
      { karat: 22, value: 395 },
    ]);
    const uaeMissing = `"goldApiData":{"carat22":{"morning":395},"SAU":{"carat24":{"morning":441}}}`;
    expect(() => parseGulfNews(uaeMissing)).toThrow(/implausible/);
  });
  it("fails without goldApiData", () => {
    expect(() => parseGulfNews("<html/>")).toThrow(/goldApiData/);
  });
});

describe("parseDeviTable", () => {
  it("reads per-pawn 24K/22K with the year, oldest first, and drops per-gram rows", () => {
    const days = parseDeviTable(fx("devi-table.html"));
    // Fixture: Nov 21, 20, 19, 18 (2026) + Jun 22 2026, which was still per gram (45,065).
    expect(days.map((d) => d.day)).toEqual(["2026-11-18", "2026-11-19", "2026-11-20", "2026-11-21"]);
    expect(days.at(-1)).toEqual({ day: "2026-11-21", p24: 342_000, p22: 314_700 });
  });

  it("fails loudly when the table is gone or holds no per-pawn prices", () => {
    expect(() => parseDeviTable("<div>maintenance</div>")).toThrow(/not found/);
    expect(() =>
      parseDeviTable("<td>Jun 22, 2026</td><td> LKR 45,065.00 </td><td> LKR 41,310.00 </td>"),
    ).toThrow(/per-pawn/);
  });
});
