import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/db/client", () => ({ getDb: vi.fn(), schema: {} }));

import { bestTimeFromCells } from "@/lib/best-time";
import { depthHeatFromCells, sltWeekday, type SltHourCell } from "@/lib/db/queries";
import { volRegime } from "@/lib/regime";

const cell = (day: number, hour: number, over: Partial<SltHourCell> = {}): SltHourCell => ({
  day,
  hour,
  samples: 60,
  bid: 346,
  ask: 348,
  mid: 347,
  spreadPct: 2 / 347,
  bidDepth1: 1000,
  askDepth1: 500,
  depthSamples: 60,
  ...over,
});

/** `days` full SLT days; at `cheapHour` the ask dips 1 LKR, at `richHour` the bid rises 1 LKR. */
function days(n: number, cheapHour = 10, richHour = 20, startDay = 20_000) {
  const out: SltHourCell[] = [];
  for (let d = 0; d < n; d++) {
    const drift = d * 2; // the level moves day to day; deviations must not care
    for (let h = 0; h < 24; h++) {
      out.push(
        cell(startDay + d, h, {
          mid: 347 + drift,
          ask: 348 + drift - (h === cheapHour ? 1 : 0),
          bid: 346 + drift + (h === richHour ? 1 : 0),
        }),
      );
    }
  }
  return out;
}

describe("sltWeekday", () => {
  it("SLT day 0 (1970-01-01) was a Thursday", () => {
    expect(sltWeekday(0)).toBe(4);
    expect(sltWeekday(3)).toBe(0);
  });
});

describe("bestTimeFromCells (D4)", () => {
  it("finds the cheapest hour to buy and the best hour to sell, net of the daily drift", () => {
    const bt = bestTimeFromCells(days(5));
    expect(bt.cheapestBuyHours[0]).toBe(10);
    expect(bt.bestSellHours[0]).toBe(20);
    expect(bt.byHour[10].askDev).toBeLessThan(bt.byHour[11].askDev!);
    expect(bt.byHour[10].days).toBe(5);
    expect(bt.days).toBe(5);
  });

  it("hides hours with fewer than 3 days, and (day, hour)s with under 20 minutes", () => {
    const bt = bestTimeFromCells(days(2));
    expect(bt.byHour.every((c) => c.hidden)).toBe(true);
    expect(bt.cheapestBuyHours).toEqual([]);
    const thin = bestTimeFromCells(days(4).map((c) => (c.hour === 5 ? { ...c, samples: 10 } : c)));
    expect(thin.byHour[5]).toMatchObject({ days: 0, hidden: true });
    expect(thin.byHour[6].hidden).toBe(false);
  });

  it("weekday cells carry their own day counts", () => {
    const bt = bestTimeFromCells(days(7));
    const filled = bt.grid.flat().filter((c) => !c.hidden);
    expect(filled.length).toBe(7 * 24);
    expect(filled.every((c) => c.days === 1)).toBe(true);
  });
});

describe("depthHeatFromCells", () => {
  it("averages near-touch depth per side by weekday × hour, weighted by minutes", () => {
    const rows = [cell(3, 9, { askDepth1: 100, depthSamples: 30 }), cell(10, 9, { askDepth1: 400, depthSamples: 10 })];
    const h = depthHeatFromCells(rows);
    const c = h.cells.find((x) => x.dow === 0 && x.hour === 9)!;
    expect(c.ask).toBeCloseTo((100 * 30 + 400 * 10) / 40, 9);
    expect(c).toMatchObject({ count: 40, days: 2 });
    expect(h.maxAsk).toBeCloseTo(175, 9);
  });

  it("rows without near-touch depth (before migration 0005) are skipped", () => {
    const h = depthHeatFromCells([cell(3, 9, { askDepth1: null, bidDepth1: null, depthSamples: 0 })]);
    expect(h.totalPoints).toBe(0);
  });
});

describe("volRegime (D8)", () => {
  it("ranks the last hour's volatility against earlier hours", () => {
    const past = Array.from({ length: 48 }, (_, i) => ({ k: i + 1, n: 60, v: (1e-4 * (1 + (i % 4))) ** 2 }));
    const r = volRegime([{ k: 0, n: 60, v: (5e-4) ** 2 }, ...past]);
    expect(r.vol1h).toBeCloseTo(5e-4, 12);
    expect(r.volRank).toBe(1);
    expect(r.volN).toBe(48);
    expect(r.sigma24).toBeGreaterThan(0);
  });

  it("needs a day of hours and enough minutes per hour", () => {
    expect(volRegime([{ k: 0, n: 60, v: 1e-8 }, { k: 1, n: 60, v: 1e-8 }]).volRank).toBeNull();
    expect(volRegime([{ k: 0, n: 10, v: 1e-8 }]).vol1h).toBeNull();
  });
});
