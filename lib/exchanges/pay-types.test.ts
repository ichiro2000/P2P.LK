import { describe, expect, it } from "vitest";
import { ALL_PAY_METHODS, EXCHANGES, EXCHANGE_IDS, payTypeLabel, resolvePayTypes } from "@/lib/exchanges";

describe("payment method filter", () => {
  for (const ex of EXCHANGE_IDS) {
    const a = EXCHANGES[ex];
    const banks = a.bankPayTypes.map((p) => p.id);

    it(`${ex}: default is the bank rails`, () => {
      expect(resolvePayTypes(a, "")).toEqual(banks);
      expect(resolvePayTypes(a, null)).toEqual(banks);
      expect(payTypeLabel(a, "")).toBeNull();
    });

    it(`${ex}: "all" is every method`, () => {
      expect(resolvePayTypes(a, ALL_PAY_METHODS)).toEqual(a.payMethods.map((p) => p.id));
      expect(payTypeLabel(a, ALL_PAY_METHODS)).toBe("all payment methods");
    });

    it(`${ex}: any listed method resolves to itself`, () => {
      for (const m of a.payMethods) {
        expect(resolvePayTypes(a, m.id)).toEqual([m.id]);
        expect(payTypeLabel(a, m.id)).toBe(m.label);
      }
    });

    it(`${ex}: unknown ids fall back to the bank rails`, () => {
      expect(resolvePayTypes(a, "NOPE")).toEqual(banks);
    });

    it(`${ex}: bank rails come first, are grouped bank, and ids are unique`, () => {
      const ids = a.payMethods.map((p) => p.id);
      expect(new Set(ids).size).toBe(ids.length);
      expect(ids.slice(0, banks.length)).toEqual(banks);
      for (const b of banks) expect(a.payMethods.find((p) => p.id === b)?.group).toBe("bank");
      expect(a.payMethods.length).toBeGreaterThan(banks.length);
    });
  }
});
