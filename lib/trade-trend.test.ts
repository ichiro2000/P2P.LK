import { describe, expect, it } from "vitest";
import {
  bucketLabel,
  bucketRange,
  bucketize,
  buyShare,
  cumulativeToSpans,
  dayIso,
  growth,
  monthEnd,
  monthStart,
  periodGrowth,
  sltDay,
  spreadSpans,
  weekStart,
  type CumRow,
} from "@/lib/trade-trend";

/** Day number of an ISO date. */
const D = (iso: string) => Math.round(Date.parse(`${iso}T00:00:00Z`) / 86_400_000);

describe("SLT days", () => {
  it("UTC+05:30 exactly: 18:29:59 UTC is still the same SLT day, 18:30 is the next", () => {
    const before = Date.parse("2026-11-19T18:29:59Z") / 1000;
    const after = Date.parse("2026-11-19T18:30:00Z") / 1000;
    expect(dayIso(sltDay(before))).toBe("2026-11-19");
    expect(dayIso(sltDay(after))).toBe("2026-11-20");
  });

  it("weeks start on Monday", () => {
    // 2026-11-20 is a Friday; its week starts Mon 2026-11-16.
    expect(dayIso(weekStart(D("2026-11-20")))).toBe("2026-11-16");
    expect(dayIso(weekStart(D("2026-11-16")))).toBe("2026-11-16");
    expect(dayIso(weekStart(D("2026-11-22")))).toBe("2026-11-16"); // Sunday
    expect(dayIso(weekStart(D("2026-11-23")))).toBe("2026-11-23");
    // Before 1970-01-05 (the first Monday) the modulo must stay positive.
    expect(dayIso(weekStart(D("1970-01-01")))).toBe("1969-12-29");
  });

  it("months: first and last day, leap years", () => {
    expect(dayIso(monthStart(D("2026-11-20")))).toBe("2026-11-01");
    expect(dayIso(monthEnd(D("2026-11-20")))).toBe("2026-11-30");
    expect(dayIso(monthEnd(D("2028-02-10")))).toBe("2028-02-29");
    expect(bucketRange("month", D("2026-12-31")).map(dayIso)).toEqual(["2026-12-01", "2026-12-31"]);
    expect(bucketRange("week", D("2026-11-20")).map(dayIso)).toEqual(["2026-11-16", "2026-11-22"]);
  });

  it("labels", () => {
    expect(bucketLabel("day", D("2026-11-20"))).toBe("20 Nov");
    expect(bucketLabel("month", D("2026-11-01"))).toBe("Nov 26");
  });
});

describe("daily differences", () => {
  const rows = (xs: [string, number | null, number | null][]): CumRow[] =>
    xs.map(([d, buy, sell]) => ({ day: D(d), buy, sell }));

  it("the first day has no baseline → no value (not 0)", () => {
    const days = spreadSpans(cumulativeToSpans(rows([["2026-11-20", 100, 200]])));
    expect(days.size).toBe(0);
  });

  it("consecutive days: today − previous day, per side", () => {
    const spans = cumulativeToSpans(
      rows([
        ["2026-11-18", 100, 200],
        ["2026-11-19", 130, 210],
        ["2026-11-20", 131, 260],
      ]),
    );
    expect(spans).toEqual([
      { day: D("2026-11-19"), span: 1, buy: 30, sell: 10 },
      { day: D("2026-11-20"), span: 1, buy: 1, sell: 50 },
    ]);
    const days = spreadSpans(spans);
    expect(days.get(D("2026-11-18"))).toBeUndefined();
    expect(days.get(D("2026-11-19"))).toEqual({ buy: 30, sell: 10, merchants: 1, estimated: 0 });
  });

  it("input order doesn't matter", () => {
    const a = cumulativeToSpans(rows([["2026-11-19", 130, 210], ["2026-11-18", 100, 200]]));
    expect(a).toEqual([{ day: D("2026-11-19"), span: 1, buy: 30, sell: 10 }]);
  });

  it("a gap is spread evenly over the missed days and marked estimated", () => {
    const days = spreadSpans(
      cumulativeToSpans(
        rows([
          ["2026-11-10", 0, 0],
          ["2026-11-13", 30, 60], // 3-day gap
        ]),
      ),
    );
    for (const d of ["2026-11-11", "2026-11-12", "2026-11-13"]) {
      expect(days.get(D(d))).toEqual({ buy: 10, sell: 20, merchants: 1, estimated: 30 });
    }
    expect(days.get(D("2026-11-10"))).toBeUndefined();
  });

  it("gaps longer than 7 days stay unknown", () => {
    const spans = cumulativeToSpans(rows([["2026-11-01", 0, 0], ["2026-11-09", 80, 80]]));
    expect(spans).toEqual([]);
  });

  it("a counter reset leaves that day unknown and re-bases the next day", () => {
    const spans = cumulativeToSpans(
      rows([
        ["2026-11-18", 500, 500],
        ["2026-11-19", 20, 510], // buy counter went down
        ["2026-11-20", 25, 515],
      ]),
    );
    expect(spans).toEqual([{ day: D("2026-11-20"), span: 1, buy: 5, sell: 5 }]);
  });

  it("a one-day spike is ignored; the days around it are spread as a gap", () => {
    const spans = cumulativeToSpans(
      rows([
        ["2026-11-17", 100, 100],
        ["2026-11-18", 1_000_100, 105], // bad reading
        ["2026-11-19", 110, 110],
        ["2026-11-20", 120, 111],
      ]),
    );
    expect(spans).toEqual([
      { day: D("2026-11-19"), span: 2, buy: 10, sell: 10 },
      { day: D("2026-11-20"), span: 1, buy: 10, sell: 1 },
    ]);
  });

  it("missing counters on either day → unknown", () => {
    expect(cumulativeToSpans(rows([["2026-11-18", 1, null], ["2026-11-19", 2, 2]]))).toEqual([]);
  });

  it("zero trades on a measured day is a real 0", () => {
    const days = spreadSpans(cumulativeToSpans(rows([["2026-11-18", 5, 5], ["2026-11-19", 5, 5]])));
    expect(days.get(D("2026-11-19"))).toEqual({ buy: 0, sell: 0, merchants: 1, estimated: 0 });
  });
});

describe("buckets", () => {
  const today = D("2026-11-20"); // Friday
  const daily = (from: string, to: string, buy = 10, sell = 20, estimated = 0) => {
    const m = new Map<number, { buy: number; sell: number; merchants: number; estimated: number }>();
    for (let d = D(from); d <= D(to); d++) m.set(d, { buy, sell, merchants: 1, estimated });
    return m;
  };

  it("daily: one bucket per day, days without data are null (a gap, not 0)", () => {
    const days = daily("2026-11-18", "2026-11-20");
    days.delete(D("2026-11-19"));
    const b = bucketize(days, "day", today, 4);
    expect(b.map((x) => dayIso(x.start))).toEqual(["2026-11-17", "2026-11-18", "2026-11-19", "2026-11-20"]);
    expect(b.map((x) => x.total)).toEqual([null, 30, null, 30]);
    expect(b[3].inProgress).toBe(true);
    expect(b[2].complete).toBe(false);
  });

  it("weekly (Monday-based): the running week counts only elapsed days", () => {
    const b = bucketize(daily("2026-11-09", "2026-11-20"), "week", today, 3);
    expect(b.map((x) => dayIso(x.start))).toEqual(["2026-11-02", "2026-11-09", "2026-11-16"]);
    expect(b[0]).toMatchObject({ total: null, daysCovered: 0, complete: false });
    expect(b[1]).toMatchObject({ buy: 70, sell: 140, total: 210, daysElapsed: 7, complete: true, inProgress: false });
    expect(b[2]).toMatchObject({ total: 150, daysCovered: 5, daysElapsed: 5, complete: true, inProgress: true });
  });

  it("monthly: calendar months, partial coverage is flagged", () => {
    const b = bucketize(daily("2026-10-10", "2026-11-20"), "month", today, 2);
    expect(b.map((x) => dayIso(x.start))).toEqual(["2026-10-01", "2026-11-01"]);
    expect(b[0]).toMatchObject({ daysCovered: 22, daysElapsed: 31, complete: false, total: 22 * 30 });
    expect(b[1]).toMatchObject({ daysCovered: 20, daysElapsed: 20, complete: true, inProgress: true });
  });

  it("estimated days mark the bucket", () => {
    const b = bucketize(daily("2026-11-19", "2026-11-19", 10, 20, 30), "day", today, 2);
    expect(b[0].estimated).toBe(true);
    expect(b[1].estimated).toBe(false);
  });
});

describe("growth", () => {
  it("growth %: change over the previous value; no base → null", () => {
    expect(growth(150, 100)).toBeCloseTo(0.5, 12);
    expect(growth(50, 100)).toBeCloseTo(-0.5, 12);
    expect(growth(10, 0)).toBeNull();
    expect(growth(null, 10)).toBeNull();
  });

  it("compares the last complete period with the one before, never the running one", () => {
    const today = D("2026-11-20");
    const days = new Map<number, { buy: number; sell: number; merchants: number; estimated: number }>();
    for (let d = D("2026-11-02"); d <= today; d++) {
      const wk = weekStart(d);
      // Week of 2 Nov: 10/day, week of 9 Nov: 15/day, running week: 100/day.
      const v = wk === D("2026-11-02") ? 10 : wk === D("2026-11-09") ? 15 : 100;
      days.set(d, { buy: v, sell: v, merchants: 1, estimated: 0 });
    }
    const g = periodGrowth(bucketize(days, "week", today, 4))!;
    expect(dayIso(g.current.start)).toBe("2026-11-09");
    expect(dayIso(g.previous.start)).toBe("2026-11-02");
    expect(g.total).toBeCloseTo(0.5, 12);
    expect(g.buy).toBeCloseTo(0.5, 12);
  });

  it("needs two fully covered periods", () => {
    const today = D("2026-11-20");
    const days = new Map([[D("2026-11-19"), { buy: 1, sell: 1, merchants: 1, estimated: 0 }]]);
    expect(periodGrowth(bucketize(days, "day", today, 5))).toBeNull();
    days.set(D("2026-11-18"), { buy: 1, sell: 3, merchants: 1, estimated: 0 });
    const g = periodGrowth(bucketize(days, "day", today, 5))!;
    expect(g.total).toBeCloseTo(-0.5, 12);
    expect(g.sell).toBeCloseTo(-2 / 3, 12);
  });

  it("buy share", () => {
    expect(buyShare(30, 70)).toBeCloseTo(0.3, 12);
    expect(buyShare(0, 0)).toBeNull();
    expect(buyShare(null, 3)).toBeNull();
  });
});
