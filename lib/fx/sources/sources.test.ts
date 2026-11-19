import { readFileSync } from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { FX_SOURCE_META, FX_SOURCES } from "@/lib/fx/sources";
import { amana, combank, dfcc, hnb, ndb, ntb, peoples, sampath } from "@/lib/fx/sources/banks";
import { CBSL_CURRENCIES, cbslIndicative, cbslTt } from "@/lib/fx/sources/cbsl";
import type { FetchCtx, FxSource, ParsedRate } from "@/lib/fx/types";

/**
 * Parser tests against trimmed copies of each source's real page / JSON
 * (lib/fx/__fixtures__, fetched 2026-11-19). `fetch` is stubbed: no network.
 */

const fixture = (name: string) => readFileSync(new URL(`../__fixtures__/${name}`, import.meta.url), "utf8");

const ctx = (storedDays = 100): FetchCtx => ({
  now: new Date("2026-11-19T06:00:00Z"), // 11:30 in Colombo
  signal: new AbortController().signal,
  storedDays,
});

function serve(body: string, status = 200) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => new Response(body, { status }));
  vi.stubGlobal("fetch", fn);
  return fn;
}

const pick = (rows: ParsedRate[], cur: string, day = "2026-11-19") =>
  Object.fromEntries(rows.filter((r) => r.currency === cur && r.asOf === day).map((r) => [r.rateType, r.value]));

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("bank sources (fixtures)", () => {
  type Case = { id: string; src: FxSource; file: string; url: string; usd: Record<string, number>; currencies: number };
  const cases: Case[] = ([
    [combank, "combank.html", "https://www.combank.lk/rates-tariff", { cash_buy: 326.82, cash_sell: 336.75, tt_buy: 328.75, tt_sell: 336.75 }, 16],
    [peoples, "peoples.html", "https://www.peoplesbank.lk/exchange-rates/", { cash_buy: 328.7029, cash_sell: 336.8528, tt_buy: 328.9332, tt_sell: 336.6172 }, 24],
    [ndb, "ndb.html", "https://www.ndbbank.com/rates/exchange-rates", { cash_buy: 328.25, cash_sell: 337.25, tt_buy: 328.25, tt_sell: 337.25 }, 20],
    [ntb, "ntb.html", "https://www.nationstrust.com/exchange-rates", { cash_buy: 325.03, cash_sell: 338.21, tt_buy: 327.49, tt_sell: 338.21 }, 24],
    [dfcc, "dfcc.html", "https://www.dfcc.lk/rates-and-tariff/exchange-rates", { cash_buy: 326.8, cash_sell: 338.8, tt_buy: 328.05, tt_sell: 337.55 }, 20],
    [amana, "amana.html", "https://www.amanabank.lk/business/treasury/exchange-rates.html", { tt_buy: 330.4, tt_sell: 335.4, cash_sell: 337.4 }, 22],
    [sampath, "sampath.json", "https://www.sampath.lk/api/exchange-rates", { tt_buy: 328.75, tt_sell: 336.75 }, 6],
    [hnb, "hnb.json", "https://venus.hnb.lk/api/get_rates_contents_web", { tt_buy: 329.15, tt_sell: 336.4 }, 7],
  ] as const satisfies readonly (readonly [FxSource, string, string, Record<string, number>, number])[]).map(
    ([src, file, url, usd, currencies]) => ({ id: src.id, src, file, url, usd, currencies }),
  );

  it.each(cases)("$id parses USD and the other currencies", async ({ src, file, url, usd, currencies }) => {
    const fetchFn = serve(fixture(file));
    const rows = await src.fetch(ctx());
    expect(fetchFn).toHaveBeenCalledTimes(1);
    expect(fetchFn.mock.calls[0][0]).toBe(url);
    expect(pick(rows, "USD")).toEqual(usd);
    expect(new Set(rows.map((r) => r.currency)).size).toBe(currencies);
    // Every stored value passed the plausibility band for its currency.
    expect(rows.every((r) => r.value > 0 && r.asOf === "2026-11-19")).toBe(true);
  });

  it("columns are mapped per bank (spot checks off USD)", async () => {
    serve(fixture("combank.html"));
    expect(pick(await combank.fetch(ctx()), "JPY").tt_buy).toBeGreaterThan(1.5);
    serve(fixture("ndb.html"));
    expect(pick(await ndb.fetch(ctx()), "CNY")).toMatchObject({ tt_buy: 48.51, cash_buy: 48.51, cash_sell: 51.91 });
    serve(fixture("sampath.json"));
    expect(pick(await sampath.fetch(ctx()), "JPY")).toEqual({ tt_buy: 2.0511, tt_sell: 2.1239 });
  });

  it("a changed header is an error, not junk rows", async () => {
    serve(fixture("combank.html").replaceAll("Cheques", "Drafts"));
    await expect(combank.fetch(ctx())).rejects.toThrow('[combank] header changed (missing "Cheques")');
  });

  it("a missing table is an error", async () => {
    serve("<html><body><p>Maintenance</p></body></html>");
    await expect(peoples.fetch(ctx())).rejects.toThrow("[peoples] rates table not found");
    await expect(amana.fetch(ctx())).rejects.toThrow("[amana] rates table not found");
  });

  it("an implausible USD rate is dropped, and with no USD left the run fails", async () => {
    serve(fixture("dfcc.html").replace(">328.05<", ">32.805<").replace(">337.55<", ">33.755<"));
    const rows = await dfcc.fetch(ctx());
    expect(pick(rows, "USD")).toEqual({ cash_buy: 326.8, cash_sell: 338.8 });

    const json = JSON.parse(fixture("sampath.json"));
    json.data[0].TTBUY = "650.10";
    json.data[0].TTSEL = "660.20";
    serve(JSON.stringify(json));
    await expect(sampath.fetch(ctx())).rejects.toThrow(/\[sampath\] no USD rate parsed \(\d+ rows, 2 rejected\)/);
  });

  it("sampath: offshore CNH is filed as CNY; bad payloads are rejected", async () => {
    const json = JSON.parse(fixture("sampath.json"));
    json.data = json.data.filter((r: { CurrCode: string }) => r.CurrCode !== "CNY");
    json.data.push({ CurrCode: "CNH", TTBUY: "49.1", TTSEL: "51.2", RateWEF: json.data[0].RateWEF });
    serve(JSON.stringify(json));
    expect(pick(await sampath.fetch(ctx()), "CNY")).toEqual({ tt_buy: 49.1, tt_sell: 51.2 });

    serve(JSON.stringify({ success: false }));
    await expect(sampath.fetch(ctx())).rejects.toThrow("[sampath] unexpected payload");
  });

  it("hnb: skips non-current rows and non-numeric rates", async () => {
    const json = JSON.parse(fixture("hnb.json"));
    json.ex.unshift({ currencyCode: "USD", buyingRate: 1, sellingRate: 1, status: "OLD" });
    json.ex.push({ currencyCode: "AUD", buyingRate: "216", sellingRate: 228, status: "CURRENT" });
    serve(JSON.stringify(json));
    const rows = await hnb.fetch(ctx());
    expect(pick(rows, "USD")).toEqual({ tt_buy: 329.15, tt_sell: 336.4 });
    expect(pick(rows, "AUD")).toEqual({ tt_sell: 228 });

    serve(JSON.stringify({}));
    await expect(hnb.fetch(ctx())).rejects.toThrow("[hnb] unexpected payload");
  });

  it("HTTP errors and invalid JSON surface as errors", async () => {
    serve("nope", 503);
    await expect(ntb.fetch(ctx())).rejects.toThrow("HTTP 503 from www.nationstrust.com");
    serve("<html>not json</html>");
    await expect(hnb.fetch(ctx())).rejects.toThrow("invalid JSON from venus.hnb.lk");
  });
});

describe("CBSL sources (fixtures)", () => {
  it("indicative: one rate per currency per day, from the POSTed date range", async () => {
    const fetchFn = serve(fixture("cbsl_ind.html"));
    const rows = await cbslIndicative.fetch(ctx());
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe("https://www.cbsl.gov.lk/cbsl_custom/exrates/exrates_results.php");
    expect(init?.method).toBe("POST");
    const body = init?.body as URLSearchParams;
    expect(body.get("txtStart")).toBe("2026-11-12");
    expect(body.get("txtEnd")).toBe("2026-11-19");
    expect(body.getAll("chk_cur[]")).toContain("USD~US Dollar");

    expect(rows).toHaveLength(12); // USD, EUR, JPY × 4 days
    expect(rows.filter((r) => r.currency === "USD")).toEqual([
      { currency: "USD", rateType: "indicative", value: 332.7616, asOf: "2026-11-19" },
      { currency: "USD", rateType: "indicative", value: 332.7638, asOf: "2026-11-18" },
      { currency: "USD", rateType: "indicative", value: 332.7381, asOf: "2026-11-17" },
      { currency: "USD", rateType: "indicative", value: 332.6211, asOf: "2026-11-16" },
    ]);
  });

  it("first run backfills a year", async () => {
    const fetchFn = serve(fixture("cbsl_ind.html"));
    await cbslIndicative.fetch(ctx(0));
    expect((fetchFn.mock.calls[0][1]?.body as URLSearchParams).get("txtStart")).toBe("2025-11-19");
  });

  it("average TT: buy/sell pairs per day, currency from the section heading", async () => {
    const fetchFn = serve(fixture("cbsl_tt.html"));
    const rows = await cbslTt.fetch(ctx());
    expect(fetchFn.mock.calls[0][0]).toBe("https://www.cbsl.gov.lk/cbsl_custom/exratestt/exrates_resultstt.php");
    expect(rows).toHaveLength(24); // 3 currencies × 4 days × buy/sell
    expect(pick(rows, "USD")).toEqual({ tt_buy: 328.3704, tt_sell: 337.2712 });
    expect(pick(rows, "JPY", "2026-11-16")).toEqual({ tt_buy: 2.0476, tt_sell: 2.1207 });
  });

  it("average TT: an unexpected header is an error", async () => {
    serve(fixture("cbsl_tt.html").replaceAll("Buy Rate", "Rate"));
    await expect(cbslTt.fetch(ctx())).rejects.toThrow("[cbsl_tt] unexpected header for USD");
  });

  it("an out-of-band USD value is rejected", async () => {
    serve(fixture("cbsl_ind.html").replaceAll(/> 332\.\d+ </g, "> 33.27 <"));
    await expect(cbslIndicative.fetch(ctx())).rejects.toThrow("[cbsl] no USD rate parsed (8 rows, 4 rejected)");
  });

  it("only currencies we store are listed", () => {
    expect(CBSL_CURRENCIES).toContain("USD");
    expect(CBSL_CURRENCIES).toHaveLength(25);
  });
});

describe("source registry", () => {
  it("unique ids, metadata for each", () => {
    const ids = FX_SOURCES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    expect(Object.keys(FX_SOURCE_META)).toEqual(ids);
    for (const s of FX_SOURCES) expect(new URL(s.pageUrl).protocol).toBe("https:");
  });
});
