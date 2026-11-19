import { describe, expect, it } from "vitest";
import {
  GOOGLE_MIN_PAIRS,
  cbslDayChange,
  cbslPairs,
  googleChange,
  googlePairs,
  indexedSeries,
  lagGap,
  link,
  midAt,
  midChange,
  readingNear,
  type FxPoint,
  type MidPoint,
} from "@/lib/dollar-signals";
import { CBSL_SIGNAL, USD_SIGNAL, cbslSignal, usdSignal } from "@/lib/risk-signals";

const T0 = 1_800_000_000 - (1_800_000_000 % 1800) + 180; // a :03 / :33 reading time
const H = 3600;

/** Deterministic PRNG so the back-test is stable. */
function rng(seed: number) {
  return () => {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** Standard normal (Box–Muller). */
const gauss = (r: () => number) => Math.sqrt(-2 * Math.log(r() || 1e-12)) * Math.cos(2 * Math.PI * r());

const flatMids = (from: number, to: number, mid: number): MidPoint[] => {
  const out: MidPoint[] = [];
  for (let t = from; t <= to; t += 300) out.push({ ts: t, mid });
  return out;
};

describe("lookups", () => {
  const g: FxPoint[] = [
    { ts: T0, value: 300 },
    { ts: T0 + 1795, value: 301 }, // a few seconds early
    { ts: T0 + 3600, value: 302 },
  ];

  it("readingNear picks the closest reading within the tolerance, never at/after `before`", () => {
    expect(readingNear(g, T0 + 1800, 600, T0 + 3600)?.value).toBe(301);
    expect(readingNear(g, T0 + 1800, 600, T0 + 1795)).toBeNull();
    expect(readingNear(g, T0 + 900, 300, T0 + 3600)).toBeNull();
  });

  it("googleChange: 30 min uses the early reading, not the one an hour back", () => {
    const c = googleChange(g, 1800)!;
    expect(c.from).toBe(301);
    expect(c.to).toBe(302);
    expect(c.abs).toBeCloseTo(1, 12);
    expect(c.pct).toBeCloseTo(302 / 301 - 1, 12);
    // No reading near 24 h ago → no number (not a shorter window in disguise).
    expect(googleChange(g, 24 * H)).toBeNull();
  });

  it("midAt is the median of the 10 minutes ending at t, with no look-ahead", () => {
    const m: MidPoint[] = [
      { ts: 1000, mid: 300 },
      { ts: 1300, mid: 310 },
      { ts: 1500, mid: 305 },
      { ts: 1600, mid: 999 }, // after t
    ];
    expect(midAt(m, 1500)).toBe(305);
    expect(midAt(m, 1550)).toBe(305); // median(300, 310, 305); 1600 is after t
    expect(midAt(m, 5000)).toBeNull(); // nothing in the last 10 min: no stale fill
    expect(midAt(m, 1000)).toBe(300);
    expect(midChange(m, 1000, 1550)?.pct).toBeCloseTo(305 / 300 - 1, 12);
  });

  it("cbslDayChange compares the latest business day with the previous stored one", () => {
    const c = cbslDayChange([
      { day: "2026-11-13", value: 332.5 },
      { day: "2026-11-16", value: 334.16 },
    ])!;
    expect(c.prevDay).toBe("2026-11-13");
    expect(c.day).toBe("2026-11-16");
    expect(c.pct).toBeCloseTo(334.16 / 332.5 - 1, 12);
    expect(cbslDayChange([{ day: "2026-11-16", value: 1 }])).toBeNull();
  });
});

describe("link (correlation, beta, verdict)", () => {
  const xs = Array.from({ length: 60 }, (_, i) => Math.sin(i * 1.7) * 0.001);

  it("measures r and beta of y on x", () => {
    const l = link(
      xs.map((x) => ({ x, y: 0.9 * x + 0.0001 })),
      48,
    );
    expect(l.r).toBeCloseTo(1, 9);
    expect(l.beta).toBeCloseTo(0.9, 9);
    expect(l.verdict).toBe("confirmed");
  });

  it("says 'collecting' below the minimum sample, with no number", () => {
    const l = link(
      xs.slice(0, 47).map((x) => ({ x, y: x })),
      48,
    );
    expect(l).toMatchObject({ n: 47, min: 48, r: null, beta: null, verdict: "collecting" });
  });

  it("negative co-movement contradicts the hypothesis; noise is 'unclear'", () => {
    expect(link(xs.map((x) => ({ x, y: -x })), 48).verdict).toBe("contradicted");
    const r = rng(3);
    const noise = link(
      xs.map((x) => ({ x, y: gauss(r) * 0.001 })),
      48,
    );
    expect(Math.abs(noise.t!)).toBeLessThan(2);
    expect(noise.verdict).toBe("unclear");
  });

  it("a dollar that never moved gives no beta", () => {
    expect(link(Array.from({ length: 50 }, () => ({ x: 0, y: 0.001 })), 48)).toMatchObject({ beta: null, verdict: "unclear" });
  });

  it("matches a hand-computed example", () => {
    // x: 1,2,3,4 ; y: 2,4,5,4 → sxx 5, syy 4.75, sxy 3.5.
    const p = [1, 2, 3, 4].map((x, i) => ({ x, y: [2, 4, 5, 4][i] }));
    const l = link(p, 3);
    expect(l.beta).toBeCloseTo(0.7, 12);
    expect(l.r).toBeCloseTo(3.5 / Math.sqrt(5 * 4.75), 12);
  });
});

describe("pairs", () => {
  it("googlePairs aligns USDT to each Google reading and skips gaps that are not ~30 min", () => {
    const g: FxPoint[] = [
      { ts: T0, value: 300 },
      { ts: T0 + 1800, value: 303 },
      { ts: T0 + 5400, value: 306 }, // 60 min later: a missed run, skipped
      { ts: T0 + 7200, value: 306 },
    ];
    const m: MidPoint[] = [
      ...flatMids(T0 - 600, T0, 310),
      ...flatMids(T0 + 1500, T0 + 1800, 313.1),
      ...flatMids(T0 + 5100, T0 + 7200, 320),
    ];
    const p = googlePairs(g, m, 0);
    expect(p).toHaveLength(2);
    expect(p[0].x).toBeCloseTo(0.01, 12);
    expect(p[0].y).toBeCloseTo(0.01, 12);
    expect(p[1]).toMatchObject({ ts: T0 + 7200, x: 0, y: 0 });
  });

  it("googlePairs can leave out the window being judged (untilTs)", () => {
    const g: FxPoint[] = [0, 1, 2, 3].map((k) => ({ ts: T0 + k * 1800, value: 300 + k }));
    const m = flatMids(T0 - 600, T0 + 5400, 310);
    expect(googlePairs(g, m, 0)).toHaveLength(3);
    expect(googlePairs(g, m, 0, T0 + 3600).map((p) => p.ts)).toEqual([T0 + 1800, T0 + 3600]);
  });

  it("cbslPairs needs USDT on both CBSL days", () => {
    const cbsl = [
      { day: "2026-11-12", value: 300 },
      { day: "2026-11-13", value: 303 },
      { day: "2026-11-16", value: 303 },
    ];
    const usdt = new Map([
      ["2026-11-12", 310],
      ["2026-11-13", 313.1],
    ]);
    const p = cbslPairs(cbsl, usdt, "2026-01-01");
    expect(p).toEqual([{ day: "2026-11-13", x: expect.closeTo(0.01, 12), y: expect.closeTo(0.01, 12) }]);
  });
});

describe("expected vs actual (lag)", () => {
  it("USDT hasn't caught up: expected +0.40%, moved +0.05%", () => {
    const l = lagGap(0.004, 0.0005, { beta: null, verdict: "collecting" });
    expect(l).toMatchObject({ beta: 1, betaMeasured: false, lagging: true });
    expect(l.expected).toBeCloseTo(0.004, 12);
    expect(l.gap).toBeCloseTo(0.0035, 12);
  });

  it("uses the measured beta once confirmed; not lagging after half the move", () => {
    const l = lagGap(0.004, 0.0025, { beta: 0.9, verdict: "confirmed" });
    expect(l.betaMeasured).toBe(true);
    expect(l.expected).toBeCloseTo(0.0036, 12);
    expect(l.lagging).toBe(false);
    // exactly half the expected move counts as lagging (gap ≥ half)
    expect(lagGap(0.004, 0.0018, { beta: 0.9, verdict: "confirmed" }).lagging).toBe(true);
  });

  it("works for falls too", () => {
    expect(lagGap(-0.003, -0.0002, { beta: null, verdict: "collecting" }).lagging).toBe(true);
    expect(lagGap(-0.003, -0.002, { beta: null, verdict: "collecting" }).lagging).toBe(false);
  });
});

describe("usdSignal thresholds", () => {
  const move = (pct: number) => ({ from: 333, to: 333 * (1 + pct), fromTs: T0, toTs: T0 + 2 * H, abs: 333 * pct, pct });
  const base = { googleStale: false, usdtStale: false, usdtSince: 0.0002, link: { beta: null, verdict: "collecting" as const } };

  it("fires up / down at ≥ 0.15 % in 2 h with USDT lagging (warn while the link is unmeasured)", () => {
    expect(usdSignal({ ...base, move: move(0.0015) })).toMatchObject({ direction: "up", level: "warn" });
    expect(usdSignal({ ...base, usdtSince: -0.0002, move: move(-0.002) })).toMatchObject({ direction: "down", level: "warn" });
    expect(usdSignal({ ...base, move: move(0.0014) })).toBeNull();
  });

  it("does not fire when USDT already followed, or on stale data", () => {
    expect(usdSignal({ ...base, usdtSince: 0.0012, move: move(0.002) })).toBeNull();
    expect(usdSignal({ ...base, googleStale: true, move: move(0.004) })).toBeNull();
    expect(usdSignal({ ...base, usdtStale: true, move: move(0.004) })).toBeNull();
    expect(usdSignal({ ...base, usdtSince: null, move: move(0.004) })).toBeNull();
  });

  it("levels follow the measured link", () => {
    expect(usdSignal({ ...base, move: move(0.006) })?.level).toBe("warn"); // unmeasured: capped at warn
    expect(usdSignal({ ...base, move: move(0.006), link: { beta: 0.8, verdict: "confirmed" } })?.level).toBe("alert");
    expect(usdSignal({ ...base, move: move(0.003), link: { beta: 0.8, verdict: "confirmed" } })?.level).toBe("warn");
    expect(usdSignal({ ...base, move: move(0.003), link: { beta: 0.1, verdict: "unclear" } })?.level).toBe("info");
    expect(usdSignal({ ...base, move: move(0.006), link: { beta: -0.5, verdict: "contradicted" } })).toBeNull();
    // A tiny measured beta means a negligible expected move: no signal.
    expect(usdSignal({ ...base, usdtSince: 0, move: move(0.003), link: { beta: 0.1, verdict: "confirmed" } })).toBeNull();
  });
});

describe("cbslSignal thresholds", () => {
  const c = (pct: number, day = "2026-11-19") => ({
    from: 332,
    to: 332 * (1 + pct),
    fromTs: 0,
    toTs: 0,
    abs: 332 * pct,
    pct,
    day,
    prevDay: "2026-11-18",
  });
  it("watch (info) from 0.5 %, warn from 1 %, nothing below or on an old day", () => {
    expect(cbslSignal(c(0.0049), "2026-11-19")).toBeNull();
    expect(cbslSignal(c(CBSL_SIGNAL.watch), "2026-11-19")).toMatchObject({ direction: "up", level: "info" });
    expect(cbslSignal(c(-0.012), "2026-11-20")).toMatchObject({ direction: "down", level: "warn" });
    expect(cbslSignal(c(0.02, "2026-11-10"), "2026-11-20")).toBeNull();
  });
});

describe("indexedSeries", () => {
  it("indexes Google and USDT to 100 at the first point and computes the premium", () => {
    const G0 = T0 - 180; // on the 30-min grid
    const g: FxPoint[] = [
      { ts: G0 - 60, value: 300 },
      { ts: G0 + 1800 - 60, value: 303 },
    ];
    const m = [...flatMids(G0 - 600, G0, 330), ...flatMids(G0 + 1500, G0 + 1800, 336.6)];
    const s = indexedSeries(g, { binance: m }, G0 + 1800, 1800, 1800);
    expect(s).toHaveLength(2);
    // Off-grid "now" adds a final point.
    expect(indexedSeries(g, { binance: m }, G0 + 1900, 1800, 1800).at(-1)?.t).toBe((G0 + 1900) * 1000);
    expect(s[0]).toMatchObject({ google: 100, binance: 100, bybit: null });
    expect(s[1].google).toBeCloseTo(101, 9);
    expect(s[1].binance).toBeCloseTo(102, 9);
    expect(s[1].binancePremium).toBeCloseTo(336.6 / 303 - 1, 12);
  });
});

/**
 * Back-test of the Google rule on a synthetic market (no real 30-min Google
 * history is stored yet). Google: every 30 min, 35 % of readings change,
 * by N(0, 0.035 %) with a 5 % chance of a 3× move (fat tails). That is a
 * daily σ of ≈ 0.15 % — MORE volatile than CBSL's stored year (robust daily
 * σ ≈ 0.08 %), so the fire rate here is an upper bound for normal days.
 * USDT: half of each dollar move in the same 30 min, 0.3 more in the next
 * 5 min, plus its own tick noise. A "jump" is +0.4 % that USDT has not
 * reacted to yet.
 */
function synthetic(days: number, seed: number, jumpAt?: number) {
  const r = rng(seed);
  const google: FxPoint[] = [];
  const mids: MidPoint[] = [];
  let g = 300;
  let u = 330;
  let prev = 0;
  for (let i = 0; i <= days * 48; i++) {
    const ts = T0 + i * 1800;
    let ret = 0;
    if (r() < 0.35) ret = gauss(r) * 0.00035 * (r() < 0.05 ? 3 : 1);
    const jump = jumpAt != null && i === jumpAt;
    if (jump) ret = 0.004;
    g *= 1 + ret;
    // USDT over (ts − 30 min, ts]: lagged part of the previous move, then the same-interval part.
    for (let k = 1; k <= 6; k++) {
      if (k === 1) u *= 1 + 0.3 * prev;
      if (k === 3 && !jump) u *= 1 + 0.5 * ret;
      if (r() < 0.35) u += (r() < 0.5 ? -1 : 1) * 0.01 * (1 + Math.floor(r() * 4));
      mids.push({ ts: ts - 1800 + k * 300, mid: Math.round(u * 100) / 100 });
    }
    prev = jump ? 0 : ret;
    google.push({ ts, value: Math.round(g * 100) / 100 });
  }
  return { google, mids };
}

function fireRate(google: FxPoint[], mids: MidPoint[], from: number) {
  let fired = 0;
  let checks = 0;
  for (let i = from; i < google.length; i++) {
    const now = google[i].ts + 60; // the cron sees a reading a minute later
    const gs = google.slice(0, i + 1);
    const ms = mids.filter((m) => m.ts <= now);
    const move = googleChange(gs, USD_SIGNAL.windowSec);
    const a = move ? midAt(ms, move.fromTs) : null;
    const b = midAt(ms, now);
    checks++;
    const s = usdSignal({
      move,
      googleStale: false,
      usdtStale: false,
      usdtSince: a != null && b != null ? b / a - 1 : null,
      link: { beta: null, verdict: "collecting" },
    });
    if (s) fired++;
  }
  return { fired, checks, rate: fired / checks };
}

describe("back-test: Google 2 h rule", () => {
  it("normal days almost never fire (< 1 % of readings); a +0.4 % jump with USDT lagging does", () => {
    const quiet = synthetic(30, 11);
    const q = fireRate(quiet.google, quiet.mids, 48);
    console.log(`[back-test] Google 2h ≥ ${USD_SIGNAL.move * 100}% + lag: ${q.fired}/${q.checks} readings (${(q.rate * 100).toFixed(2)}%) on 29 quiet synthetic days`);
    expect(q.rate).toBeLessThan(0.01);

    const ev = synthetic(3, 11, 100);
    const hit = ev.google.findIndex((p) => p.ts === T0 + 100 * 1800);
    const move = googleChange(ev.google.slice(0, hit + 1), USD_SIGNAL.windowSec)!;
    const ms = ev.mids.filter((m) => m.ts <= ev.google[hit].ts + 60);
    const s = usdSignal({
      move,
      googleStale: false,
      usdtStale: false,
      usdtSince: midAt(ms, ev.google[hit].ts + 60)! / midAt(ms, move.fromTs)! - 1,
      link: { beta: null, verdict: "collecting" },
    });
    expect(s).toMatchObject({ direction: "up", level: "warn" });
  });

  it("correlation and beta recover the simulated same-interval link (beta ≈ 0.5)", () => {
    const { google, mids } = synthetic(10, 5);
    const l = link(googlePairs(google, mids, 0), GOOGLE_MIN_PAIRS);
    expect(l.n).toBeGreaterThan(GOOGLE_MIN_PAIRS);
    expect(l.verdict).toBe("confirmed");
    expect(l.beta!).toBeGreaterThan(0.35);
    expect(l.beta!).toBeLessThan(0.65);
  });
});
