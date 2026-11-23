import { describe, expect, it } from "vitest";
import {
  AED_PER_USD,
  BASELINE_MIN_DAYS,
  LAG_BETA_DEFAULT,
  LAG_BETA_MIN_DAYS,
  TROY_OZ_G,
  goldDays,
  goldDeviations,
  goldForecast,
  goldLink,
  goldSignal,
  goldView,
  lagBeta,
  type GoldDay,
  type GoldDevDay,
} from "@/lib/gold-signals";

describe("goldView — the owner's worked example, corrected", () => {
  // 22 Nov 2026: UAE 24K 426.50 AED/g, Sri Lanka 24K pawn 345,000, USDT 353.
  const v = goldView({ uaeGramAed: 426.5, slPawnLkr: 345_000, usdtLkr: 353 });

  it("8 g of UAE gold is 3,412 AED (not 3,416)", () => {
    expect(v.dubaiPawnAed).toBeCloseTo(3412, 6);
  });

  it("AED → USDT at the 3.6725 peg, then LKR at the P2P rate: ≈ 327,961 (not 329,644)", () => {
    expect(v.dubaiPawnUsdt).toBeCloseTo(3412 / AED_PER_USD, 6);
    expect(Math.round(v.dubaiPawnLkr!)).toBe(327_961);
  });

  it("Colombo is ≈ 5.2 % dearer; gold-implied USDT ≈ 371.3", () => {
    expect(v.gapLkr).toBeCloseTo(345_000 - v.dubaiPawnLkr!, 6);
    expect(v.impliedUae).toBeCloseTo(371.34, 2);
    expect(v.premiumUae).toBeCloseTo(345_000 / v.dubaiPawnLkr! - 1, 9);
    expect(v.premiumUae!).toBeCloseTo(0.0519, 3);
  });

  it("spot benchmark (scaled for 22K) and Dubai's mark-up over spot", () => {
    const s = goldView({ uaeGramAed: 426.5, slPawnLkr: 345_000, usdtLkr: 353, spotUsdOz: 3540 });
    expect(s.spotPawnUsdt).toBeCloseTo((3540 / TROY_OZ_G) * 8, 6);
    expect(s.uaeOverSpot!).toBeCloseTo(0.0206, 3); // Dubai board ≈ spot + 2 %
    const k22 = goldView({ uaeGramAed: 395, slPawnLkr: 314_700, usdtLkr: 353, spotUsdOz: 3540, karat: 22 });
    expect(k22.spotPawnUsdt).toBeCloseTo((3540 / TROY_OZ_G) * 8 * (22 / 24), 6);
  });

  it("rejects implausible inputs (e.g. a per-gram Colombo price) instead of producing junk", () => {
    const bad = goldView({ uaeGramAed: 4.265, slPawnLkr: 45_065, usdtLkr: 0 });
    expect(bad.dubaiPawnAed).toBeNull();
    expect(bad.premiumUae).toBeNull();
  });
});

const dayStr = (i: number, start = "2026-06-01") =>
  new Date(Date.parse(`${start}T00:00:00Z`) + i * 86_400_000).toISOString().slice(0, 10);

describe("goldDays", () => {
  it("premium over spot at the official rate, and the 14-day spot change", () => {
    const [d] = goldDays([{ day: "2026-11-21", sl24: 342_000, spot: 3540, spotPast: 3900, official: 332.82 }]);
    const spotPawn = (3540 / TROY_OZ_G) * 8 * 332.82;
    expect(d.premium).toBeCloseTo(342_000 / spotPawn - 1, 9);
    expect(d.premium).toBeCloseTo(0.129, 2); // the inflated raw reading of 21 Nov
    expect(d.spotChg).toBeCloseTo(Math.log(3540 / 3900), 9);
  });

  it("skips days with a missing or implausible leg", () => {
    expect(
      goldDays([
        { day: "2026-06-22", sl24: 45_065, spot: 3600, spotPast: 3600, official: 300 },
        { day: "2026-06-23", sl24: 342_000, spot: null, spotPast: 3600, official: 300 },
        { day: "2026-06-24", sl24: 342_000, spot: 3600, spotPast: 3600, official: null },
      ]),
    ).toEqual([]);
  });
});

describe("lagBeta", () => {
  it("falls back to the default with too little data", () => {
    expect(lagBeta([])).toEqual({ beta: LAG_BETA_DEFAULT, fitted: false, n: 0 });
  });

  it("recovers the slope of premium on spot change, clamped to [−1, 0]", () => {
    const days: GoldDay[] = Array.from({ length: LAG_BETA_MIN_DAYS + 5 }, (_, i) => {
      const spotChg = 0.05 * Math.sin(i);
      return { day: dayStr(i), spotChg, premium: 0.05 - 0.45 * spotChg };
    });
    const b = lagBeta(days);
    expect(b.fitted).toBe(true);
    expect(b.beta).toBeCloseTo(-0.45, 6);
    const up = days.map((d) => ({ ...d, premium: 0.05 + 2 * d.spotChg }));
    expect(lagBeta(up).beta).toBe(0);
  });
});

describe("goldDeviations", () => {
  it("lag correction removes a spot-driven premium spike", () => {
    // Premium is exactly 5 % − 0.4 × spot change: after correction it is flat.
    const days: GoldDay[] = Array.from({ length: 80 }, (_, i) => {
      const spotChg = i > 70 ? -0.12 : 0.02 * Math.sin(i);
      return { day: dayStr(i), spotChg, premium: 0.05 - 0.4 * spotChg };
    });
    const last = goldDeviations(days, -0.4).at(-1)!;
    expect(last.premium).toBeCloseTo(0.098, 3); // raw: looks like +4.8 pt
    expect(last.dev).toBeCloseTo(0, 9); // corrected: nothing there
    expect(goldSignal(last, { verdict: "unclear" }, false)).toBeNull();
  });

  it("collects until BASELINE_MIN_DAYS prior days exist; today never in its own baseline", () => {
    const days: GoldDay[] = Array.from({ length: BASELINE_MIN_DAYS + 1 }, (_, i) => ({
      day: dayStr(i),
      spotChg: 0,
      premium: i === BASELINE_MIN_DAYS ? 0.09 : 0.05 + (i % 2 ? 0.002 : -0.002),
    }));
    const devs = goldDeviations(days, -0.4);
    expect(devs[BASELINE_MIN_DAYS - 1].dev).toBeNull();
    const last = devs[BASELINE_MIN_DAYS];
    expect(last.baseline).toBeCloseTo(0.05, 6);
    expect(last.dev).toBeCloseTo(0.04, 6);
  });
});

describe("goldSignal", () => {
  const d = (dev: number, z: number): GoldDevDay => ({
    day: "2026-11-21",
    premium: 0.05 + dev,
    spotChg: 0,
    adjusted: 0.05 + dev,
    baseline: 0.05,
    dev,
    z,
    n: 60,
  });

  it("the structural premium alone never fires", () => {
    expect(goldSignal(d(0, 0), { verdict: "confirmed" }, false)).toBeNull();
  });

  it("unusually dear → USDT up; unusually cheap → down; info until validated", () => {
    expect(goldSignal(d(0.012, 1.6), { verdict: "collecting" }, false)).toMatchObject({
      direction: "up",
      strength: "watch",
      level: "info",
      validated: false,
    });
    expect(goldSignal(d(-0.012, -1.6), { verdict: "confirmed" }, false)).toMatchObject({ direction: "down", level: "warn" });
    expect(goldSignal(d(0.02, 2.5), { verdict: "confirmed" }, false)).toMatchObject({ strength: "strong", level: "alert" });
  });

  it("needs size AND surprise, a fresh Devi price, and no contrary evidence", () => {
    expect(goldSignal(d(0.008, 5), { verdict: "confirmed" }, false)).toBeNull();
    expect(goldSignal(d(0.03, 1.2), { verdict: "confirmed" }, false)).toBeNull();
    expect(goldSignal(d(0.03, 3), { verdict: "confirmed" }, true)).toBeNull();
    expect(goldSignal(d(0.03, 3), { verdict: "contradicted" }, false)).toBeNull();
  });
});

describe("goldLink", () => {
  const devs = (n: number, f: (i: number) => number): GoldDevDay[] =>
    Array.from({ length: n }, (_, i) => ({
      day: dayStr(i),
      premium: 0,
      spotChg: 0,
      adjusted: 0,
      baseline: 0,
      dev: f(i),
      z: 0,
      n: 60,
    }));

  it("confirms when a high deviation is followed by USDT rising the next day", () => {
    const g = devs(60, (i) => 0.01 * Math.sin(i * 1.3));
    const usdt = new Map<string, number>();
    let px = 350;
    g.forEach((x, i) => {
      usdt.set(x.day, px);
      px *= 1 + 0.3 * x.dev! + 0.0003 * Math.cos(i * 7);
    });
    const l = goldLink(g, usdt);
    expect(l.verdict).toBe("confirmed");
    expect(l.beta!).toBeGreaterThan(0);
  });

  it("collects with too few USDT days (production has 3 so far)", () => {
    const g = devs(60, (i) => 0.01 * Math.sin(i));
    const usdt = new Map(g.slice(-3).map((x) => [x.day, 350]));
    expect(goldLink(g, usdt).verdict).toBe("collecting");
  });

  it("does not pair across a gap longer than 3 days", () => {
    const g = devs(2, () => 0.01);
    const usdt = new Map([
      [dayStr(0), 350],
      [dayStr(10), 360],
    ]);
    expect(goldLink(g, usdt, 1).n).toBe(0);
  });
});

describe("goldForecast", () => {
  const pairs = Array.from({ length: 40 }, (_, i) => {
    const x = 0.01 * Math.sin(i * 1.3);
    return { x, y: 0.0002 + 0.3 * x + 0.0005 * Math.cos(i * 7) };
  });

  it("no rate until the link is confirmed", () => {
    expect(goldForecast(0.02, pairs, { verdict: "collecting" }, 350)).toBeNull();
    expect(goldForecast(0.02, pairs, { verdict: "unclear" }, 350)).toBeNull();
    expect(goldForecast(0.02, pairs.slice(0, 10), { verdict: "confirmed" }, 350)).toBeNull();
    expect(goldForecast(0.02, pairs, { verdict: "confirmed" }, null)).toBeNull();
  });

  it("predicts from the fitted slope, with a band around it", () => {
    const f = goldForecast(0.02, pairs, { verdict: "confirmed" }, 350)!;
    expect(f.change).toBeCloseTo(0.0002 + 0.3 * 0.02, 3);
    expect(f.rate).toBeCloseTo(350 * (1 + f.change), 9);
    expect(f.low).toBeLessThan(f.rate);
    expect(f.high).toBeGreaterThan(f.rate);
    expect(f.high - f.low).toBeLessThan(1); // residual noise is tiny here
  });
});
