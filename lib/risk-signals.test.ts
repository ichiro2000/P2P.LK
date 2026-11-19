import { describe, expect, it } from "vitest";
import { churn, depthDrop, priceMove, MOVE_GRID_SEC } from "@/lib/risk-signals";
import { zScoreOfLast } from "@/lib/stats";

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

/**
 * A quiet P2P book, minute by minute: the mid sits still most minutes and
 * steps by a few cents when the best ad is repriced (like 347.55 → 347.58),
 * with a slow drift. No real events.
 */
function quietMarket(minutes: number, seed = 7) {
  const r = rng(seed);
  let mid = 347.5;
  const out: { ts: number; mid: number }[] = [];
  for (let i = 0; i < minutes; i++) {
    if (r() < 0.35) mid += (r() < 0.5 ? -1 : 1) * (0.01 + Math.floor(r() * 6) * 0.01);
    if (r() < 0.01) mid += (r() < 0.5 ? -1 : 1) * 0.15; // occasional bigger reprice (~0.04 %)
    out.push({ ts: 1_800_000_000 + i * 60, mid: Math.round(mid * 100) / 100 });
  }
  return out;
}

describe("priceMove (F9)", () => {
  it("back-test: a quiet market almost never fires; the old level z-score fired often", () => {
    const pts = quietMarket(3 * 1440);
    let fired = 0;
    let oldFired = 0;
    let checks = 0;
    for (let i = 1440; i < pts.length; i += 5) {
      const now = pts[i].ts + 60;
      const win = pts.slice(i - 1440, i + 1);
      checks++;
      if (priceMove(win, now).level !== "ok") fired++;
      // Old rule: z of the latest LEVEL vs the 1h window, |z| ≥ 2.5.
      const z = zScoreOfLast(pts.slice(i - 59, i + 1).map((p) => p.mid));
      if (z != null && Math.abs(z) >= 2.5) oldFired++;
    }
    expect(fired / checks).toBeLessThan(0.01);
    expect(oldFired / checks).toBeGreaterThan(0.05);
  });

  it("a real 0.6 % jump in the last 15 minutes raises an alert", () => {
    const pts = quietMarket(1440);
    const last = pts[pts.length - 1];
    const jumped = [...pts, ...[1, 2, 3, 4, 5].map((k) => ({ ts: last.ts + k * 60, mid: last.mid * 1.006 }))];
    const m = priceMove(jumped, last.ts + 6 * 60);
    expect(m.level).toBe("alert");
    expect(m.move).toBeGreaterThan(0.004);
  });

  it("a 0.09 % move (the audit's 1h example) does not fire", () => {
    const pts = Array.from({ length: 300 }, (_, i) => ({ ts: i * 60, mid: 347.88 + (i % 7 === 0 ? 0.02 : 0) }));
    const end = pts[pts.length - 1].ts;
    const moved = [...pts, { ts: end + 60, mid: 347.555 }, { ts: end + 120, mid: 347.555 }];
    expect(priceMove(moved, end + 180).level).toBe("ok");
  });

  it("needs recent data: a feed that stopped 30 minutes ago reports no current move", () => {
    const pts = quietMarket(600);
    const m = priceMove(pts, pts[pts.length - 1].ts + 30 * 60);
    expect(m.move).toBeNull();
    expect(m.level).toBe("ok");
  });

  it("measures on a 5-minute grid of 15-minute changes", () => {
    const pts = Array.from({ length: 40 }, (_, i) => ({ ts: i * MOVE_GRID_SEC, mid: 100 + i * 0.01 }));
    const m = priceMove(pts, 40 * MOVE_GRID_SEC);
    expect(m.move).toBeCloseTo(100.39 / 100.36 - 1, 9);
  });
});

describe("depthDrop (F4 / near-touch)", () => {
  const series = (n: number, v: (i: number) => number | null) => Array.from({ length: n }, (_, i) => ({ ts: i * 300, v: v(i) }));

  it("compares the last 15 minutes' median with the window median", () => {
    const pts = series(288, (i) => (i >= 285 ? 100 : 1000));
    const d = depthDrop(pts, 288 * 300);
    expect(d.ratio).toBeCloseTo(0.1, 9);
    expect(d.level).toBe("alert");
  });

  it("one odd minute can't fire (median of the last 15 minutes)", () => {
    const pts = series(288, (i) => (i === 287 ? 1 : 1000));
    expect(depthDrop(pts, 288 * 300).level).toBe("ok");
  });

  it("too little history → no verdict", () => {
    expect(depthDrop(series(5, () => 1), 1500).ratio).toBeNull();
  });
});

describe("churn (F8)", () => {
  const cur = (ids: string[], first: number) => ids.map((merchantId) => ({ merchantId, firstSeenTs: first }));

  it("merchants already known before the baseline sweep are not 'fresh' (was 205/205)", () => {
    const ids = Array.from({ length: 205 }, (_, i) => `m${i}`);
    const c = churn(cur(ids, 1_000), new Set(ids), 5_000);
    expect(c).toMatchObject({ fresh: 0, gone: 0, level: "ok" });
  });

  it("fires on a real wave of brand-new advertisers", () => {
    const old = Array.from({ length: 40 }, (_, i) => `m${i}`);
    const now = [...cur(old, 1_000), ...cur(["n1", "n2", "n3", "n4", "n5", "n6", "n7"], 6_000)];
    expect(churn(now, new Set(old), 5_000)).toMatchObject({ fresh: 7, level: "warn" });
  });

  it("a couple of new names is normal", () => {
    const old = Array.from({ length: 200 }, (_, i) => `m${i}`);
    const now = [...cur(old.slice(5), 1_000), ...cur(["n1", "n2"], 6_000)];
    expect(churn(now, new Set(old), 5_000)).toMatchObject({ fresh: 2, gone: 5, level: "ok" });
  });
});
