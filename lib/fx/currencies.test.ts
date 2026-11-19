import { describe, expect, it } from "vitest";
import { currencyFromLabel, isFxCurrency, isPlausible, plausibleBand } from "@/lib/fx/currencies";

describe("plausibility bands", () => {
  it("USD/LKR must sit within 150–600 (inclusive)", () => {
    expect(plausibleBand("USD")).toEqual([150, 600]);
    expect(isPlausible("USD", 150)).toBe(true);
    expect(isPlausible("USD", 332.76)).toBe(true);
    expect(isPlausible("USD", 600)).toBe(true);
    expect(isPlausible("USD", 149.99)).toBe(false);
    expect(isPlausible("USD", 600.01)).toBe(false);
  });

  it("other currencies: 0.5×–2× of the reference", () => {
    expect(plausibleBand("JPY")).toEqual([1.05, 4.2]);
    expect(isPlausible("JPY", 2.05)).toBe(true);
    // A USD-sized number landing in the JPY row is rejected.
    expect(isPlausible("JPY", 330)).toBe(false);
    expect(isPlausible("KWD", 2.05)).toBe(false);
  });

  it("zero, negative and non-finite are never plausible", () => {
    for (const v of [0, -330, Number.NaN, Infinity]) expect(isPlausible("USD", v)).toBe(false);
  });
});

describe("isFxCurrency", () => {
  it("only our own codes, no prototype keys", () => {
    expect(isFxCurrency("USD")).toBe(true);
    expect(isFxCurrency("usd")).toBe(false);
    expect(isFxCurrency("CNH")).toBe(false);
    expect(isFxCurrency("toString")).toBe(false);
    expect(isFxCurrency(undefined)).toBe(false);
  });
});

describe("currencyFromLabel", () => {
  it.each([
    ["USD", "USD"],
    [" USD Flag   USD ", "USD"],
    ["US DOLLARS", "USD"],
    ["US Dollar", "USD"],
    ["U.S. Dollar", "USD"],
    ["United States Dollar", "USD"],
    ["Australian Dollar", "AUD"],
    ["Hong Kong Dollar", "HKD"],
    ["New Zealand Dollars", "NZD"],
    ["Sterling Pound", "GBP"],
    ["British Pounds", "GBP"],
    ["Japanese Yen", "JPY"],
    ["Yen", "JPY"],
    ["Euro", "EUR"],
    ["Swiss Franc", "CHF"],
    ["Chinese Yuan (Renminbi)", "CNY"],
    ["Chinese Yuan (CNH)", "CNY"],
    ["Offshore Yuan", "CNY"],
    ["U.A.E Dirham", "AED"],
    ["UAE  Dirham", "AED"],
    ["Saudi Riyal", "SAR"],
    ["Qatar Riyal", "QAR"],
    ["Kuwaiti Dinar", "KWD"],
    ["Malaysia  Ringgit", "MYR"],
    ["Thai Baht", "THB"],
    ["Swedish Kroner", "SEK"],
    ["Norwegian Krone", "NOK"],
    ["Danish Kroner", "DKK"],
    ["Korean Won", "KRW"],
  ])("%j → %s", (label, code) => {
    expect(currencyFromLabel(label)).toBe(code);
  });

  it.each(["", "Exchange Rates", "Currency", "South African Rand", "Gold", "ZAR"])("%j → null", (label) => {
    expect(currencyFromLabel(label)).toBeNull();
  });
});
