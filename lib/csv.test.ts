import { afterEach, describe, expect, it, vi } from "vitest";
import { documentToCsv, downloadCsv, escapeCell, tableToCsv } from "@/lib/csv";
import type { ReportTable } from "@/lib/reports";

describe("escapeCell", () => {
  it("passes plain values through", () => {
    expect(escapeCell("Binance")).toBe("Binance");
    expect(escapeCell(330.5)).toBe("330.5");
    expect(escapeCell(0)).toBe("0");
  });

  it("null / undefined → empty cell", () => {
    expect(escapeCell(null)).toBe("");
    expect(escapeCell(undefined)).toBe("");
  });

  it("quotes cells with commas, quotes or line breaks and doubles inner quotes", () => {
    expect(escapeCell("a,b")).toBe('"a,b"');
    expect(escapeCell('say "hi"')).toBe('"say ""hi"""');
    expect(escapeCell("line1\nline2")).toBe('"line1\nline2"');
    expect(escapeCell("cr\rhere")).toBe('"cr\rhere"');
  });

  // Merchant names come straight from the exchanges, so a name like
  // "=HYPERLINK(...)" would run as a formula when the CSV is opened in a
  // spreadsheet. There is no guard today (see the test report).
  it("guards against CSV formula injection (cells starting with = + - @ tab or CR)", () => {
    expect(escapeCell("=HYPERLINK(\"http://x\")")).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(escapeCell("+1")).toBe("'+1");
    expect(escapeCell("-cmd")).toBe("'-cmd");
    expect(escapeCell("@SUM(A1)")).toBe("'@SUM(A1)");
    expect(escapeCell("\tx")).toBe("'\tx");
    expect(escapeCell(-12.5)).toBe("-12.5");
    expect(escapeCell("Normal Name")).toBe("Normal Name");
  });
});

const table: ReportTable = {
  id: "t",
  title: "Top merchants",
  subtitle: "Last 24h",
  columns: [
    { key: "name", header: "Name" },
    { key: "price", header: "Price, LKR" },
    { key: "note", header: "Note" },
  ],
  rows: [
    { name: "Alice", price: 330.5, note: null },
    { name: 'Bob "B"', price: 331, note: "x,y" },
  ],
};

describe("tableToCsv", () => {
  it("header row then one line per row, in column order", () => {
    expect(tableToCsv(table)).toBe(['Name,"Price, LKR",Note', "Alice,330.5,", '"Bob ""B""",331,"x,y"'].join("\n"));
  });

  it("missing keys become empty cells", () => {
    expect(tableToCsv({ ...table, rows: [{ name: "Only" }] })).toBe('Name,"Price, LKR",Note\nOnly,,');
  });
});

describe("documentToCsv", () => {
  afterEach(() => vi.useRealTimers());

  it("title, meta and a generated stamp, then each table with its own header comment", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-11-19T10:00:00Z"));
    const out = documentToCsv("Market report", [table, { ...table, title: "Second", subtitle: undefined, rows: [] }], [
      { label: "Range", value: "24h" },
    ]);
    expect(out.split("\n")).toEqual([
      "# Market report",
      "# Range: 24h",
      "# Generated: 2026-11-19T10:00:00.000Z",
      "",
      "# Top merchants",
      "# Last 24h",
      'Name,"Price, LKR",Note',
      "Alice,330.5,",
      '"Bob ""B""",331,"x,y"',
      "",
      "# Second",
      'Name,"Price, LKR",Note',
      "",
    ]);
  });
});

describe("downloadCsv", () => {
  it("is a no-op without a window (SSR / node)", () => {
    expect(() => downloadCsv("x.csv", "a,b")).not.toThrow();
  });
});
