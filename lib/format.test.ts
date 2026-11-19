import { afterEach, describe, expect, it, vi } from "vitest";
import {
  formatCompact,
  formatCount,
  formatDuration,
  formatFiat,
  formatInt,
  formatPct,
  formatPrice,
  formatRelative,
  formatSigned,
  formatSLT,
} from "@/lib/format";

// 2026-11-19 10:00:00 UTC = 15:30 in Sri Lanka (UTC+5:30, no DST).
const TS = Date.UTC(2026, 10, 19, 10, 0, 0) / 1000;

describe("formatSLT", () => {
  it("renders epoch seconds in Asia/Colombo, short date + 24h time", () => {
    expect(formatSLT(TS)).toBe("19/11/2026, 15:30");
  });

  it("accepts Date and ISO string inputs", () => {
    expect(formatSLT(new Date(TS * 1000))).toBe("19/11/2026, 15:30");
    expect(formatSLT("2026-11-19T10:00:00Z")).toBe("19/11/2026, 15:30");
  });

  it("crosses midnight in SLT before UTC does", () => {
    // 19:00 UTC = 00:30 next day in Colombo.
    expect(formatSLT(Date.UTC(2026, 10, 19, 19, 0) / 1000)).toBe("20/11/2026, 00:30");
  });

  it("missing or invalid input → em dash", () => {
    expect(formatSLT(null)).toBe("—");
    expect(formatSLT(undefined)).toBe("—");
    expect(formatSLT("not a date")).toBe("—");
    expect(formatSLT(Number.NaN)).toBe("—");
  });

  it("options override the default; { dateStyle: undefined } is time only", () => {
    expect(formatSLT(TS, { timeStyle: "medium" })).toBe("19/11/2026, 15:30:00");
    expect(formatSLT(TS, { dateStyle: undefined })).toBe("15:30");
  });

  it("cache key: { dateStyle: undefined } never collides with the default format", () => {
    // Whichever is formatted first must not be served for the other.
    expect(formatSLT(TS, {})).toBe("19/11/2026, 15:30");
    expect(formatSLT(TS, { dateStyle: undefined })).toBe("15:30");
    expect(formatSLT(TS)).toBe("19/11/2026, 15:30");
    expect(formatSLT(TS, { timeStyle: undefined })).toBe("19/11/2026");
    expect(formatSLT(TS, { dateStyle: undefined })).toBe("15:30");
  });
});

describe("formatPrice", () => {
  it("picks fraction digits by magnitude", () => {
    expect(formatPrice(330.5)).toBe("330.50");
    expect(formatPrice(1234567.891)).toBe("1,234,567.89");
    expect(formatPrice(1.5)).toBe("1.500");
    expect(formatPrice(0.0123)).toBe("0.0123");
    expect(formatPrice(0.0123, 6)).toBe("0.012300");
    expect(formatPrice(-330.5)).toBe("-330.50");
    expect(formatPrice(0)).toBe("0.0000");
  });

  it("missing / non-finite → em dash", () => {
    expect(formatPrice(null)).toBe("—");
    expect(formatPrice(undefined)).toBe("—");
    expect(formatPrice(Number.NaN)).toBe("—");
    expect(formatPrice(Infinity)).toBe("—");
  });
});

describe("formatPct", () => {
  it("fractions as percent with 2 decimals", () => {
    expect(formatPct(0.985)).toBe("98.50%");
    expect(formatPct(0.0123)).toBe("1.23%");
    expect(formatPct(-0.005)).toBe("-0.50%");
  });

  it("frac and sign options", () => {
    expect(formatPct(0.0123, { frac: 1 })).toBe("1.2%");
    expect(formatPct(0.0123, { sign: true })).toBe("+1.23%");
    expect(formatPct(-0.0123, { sign: true })).toBe("-1.23%");
    expect(formatPct(0, { sign: true })).toBe("0.00%");
    // Different options must not share a cached formatter.
    expect(formatPct(0.0123)).toBe("1.23%");
  });

  it("missing / non-finite → em dash", () => {
    expect(formatPct(null)).toBe("—");
    expect(formatPct(Number.NaN)).toBe("—");
  });
});

describe("formatCompact", () => {
  it("compact notation with one decimal", () => {
    expect(formatCompact(999)).toBe("999");
    expect(formatCompact(12_345)).toBe("12.3K");
    expect(formatCompact(1_200_000)).toBe("1.2M");
    expect(formatCompact(3_000_000_000)).toBe("3B");
    expect(formatCompact(-12_345)).toBe("-12.3K");
  });

  it("missing / non-finite → em dash", () => {
    expect(formatCompact(undefined)).toBe("—");
    expect(formatCompact(-Infinity)).toBe("—");
  });
});

describe("other formatters", () => {
  it("formatInt / formatSigned / formatFiat", () => {
    expect(formatInt(1234567.6)).toBe("1,234,568");
    expect(formatSigned(0.523)).toBe("+0.52");
    expect(formatSigned(-1.5, 1)).toBe("-1.5");
    expect(formatSigned(0)).toBe("0.00");
    expect(formatFiat(330.5, "Rs")).toBe("Rs 330.50");
    expect(formatFiat(1_000_000, "Rs", 0)).toBe("Rs 1,000,000");
    expect(formatFiat(null, "Rs")).toBe("—");
  });

  it("formatDuration", () => {
    expect(formatDuration(12.4)).toBe("12s");
    expect(formatDuration(180)).toBe("3m");
    expect(formatDuration(185)).toBe("3m 5s");
    expect(formatDuration(3600)).toBe("1h");
    expect(formatDuration(4320)).toBe("1h 12m");
    expect(formatDuration(-1)).toBe("—");
    expect(formatDuration(null)).toBe("—");
  });

  describe("formatRelative", () => {
    afterEach(() => vi.useRealTimers());

    it("buckets elapsed time against the current clock", () => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-11-19T12:00:00Z"));
      expect(formatRelative("2026-11-19T11:59:58Z")).toBe("just now");
      expect(formatRelative("2026-11-19T11:59:30Z")).toBe("30s ago");
      expect(formatRelative(new Date("2026-11-19T11:55:00Z"))).toBe("5m ago");
      expect(formatRelative("2026-11-19T09:00:00Z")).toBe("3h ago");
      expect(formatRelative("2026-11-17T12:00:00Z")).toBe("2d ago");
      expect(formatRelative(null)).toBe("—");
    });
  });
});

describe("formatCount", () => {
  it("is always a whole number", () => {
    expect(formatCount(80.4)).toBe("80");
    expect(formatCount(39.6)).toBe("40");
    expect(formatCount(1234.5)).toBe("1,235");
    expect(formatCount(12_345)).toBe("12.3K");
    expect(formatCount(null)).toBe("—");
  });
});
