import { describe, expect, it } from "vitest";
import {
  feedbackScore,
  releaseScore,
  reliabilityScore,
  wilsonLowerBound,
} from "@/lib/merchant-score";

describe("wilsonLowerBound", () => {
  it("audit D7 worked examples: DGAK 15 @ 100 % → 0.796, HASSY 3,677 @ 99.6 % → 0.993", () => {
    expect(wilsonLowerBound(1, 15)).toBeCloseTo(0.796, 3);
    expect(wilsonLowerBound(0.996, 3677)).toBeCloseTo(0.993, 3);
  });

  it("no orders → 0; clamps p to 0..1", () => {
    expect(wilsonLowerBound(1, 0)).toBe(0);
    expect(wilsonLowerBound(7, 100)).toBe(wilsonLowerBound(1, 100));
    expect(wilsonLowerBound(-1, 100)).toBe(0);
  });

  it("grows with sample size at the same rate", () => {
    expect(wilsonLowerBound(0.98, 50)).toBeLessThan(wilsonLowerBound(0.98, 500));
  });
});

describe("profile parts", () => {
  it("release: full marks ≤ 2 min, none ≥ 15 min, linear between; unknown → null", () => {
    expect(releaseScore(60)).toBe(1);
    expect(releaseScore(120)).toBe(1);
    expect(releaseScore(900)).toBe(0);
    expect(releaseScore(3600)).toBe(0);
    expect(releaseScore(510)).toBeCloseTo(0.5, 12);
    expect(releaseScore(null)).toBeNull();
    expect(releaseScore(-5)).toBeNull();
  });

  it("feedback: Wilson lower bound, a few perfect reviews lose to thousands", () => {
    const big = feedbackScore(24_698, 86)!; // the example merchant, 99.65 %
    const tiny = feedbackScore(5, 0)!;
    expect(big).toBeGreaterThan(0.99);
    expect(tiny).toBeLessThan(0.6);
    expect(feedbackScore(0, 0)).toBeNull();
    expect(feedbackScore(null, 3)).toBeNull();
  });
});

describe("reliabilityScore", () => {
  const now = 1_000 * 86400;
  const full = {
    completionRate: 1,
    orders30d: 1999,
    presence7d: 1,
    firstSeenTs: now - 90 * 86400,
    avgReleaseSec: 90,
    positive: 10_000,
    negative: 0,
    registerDays: 800,
    nowTs: now,
  };

  it("45 completion + 15 volume + 15 feedback + 10 release + 5 presence + 5 tenure + 5 account age", () => {
    const r = reliabilityScore(full);
    const lb = wilsonLowerBound(1, 1999);
    const fb = wilsonLowerBound(1, 10_000);
    expect(r.parts.volume).toBe(1);
    expect(r.parts.release).toBe(1);
    expect(r.parts.accountAge).toBe(1);
    expect(r.score).toBe(Math.round(45 * lb + 15 + 15 * fb + 10 + 5 + 5 + 5));
  });

  it("F7: a small perfect sample no longer ties a long track record", () => {
    const dgak = reliabilityScore({ completionRate: 1, orders30d: 15 });
    const hassy = reliabilityScore({ completionRate: 0.996, orders30d: 3677 });
    expect(hassy.score - dgak.score).toBeGreaterThan(20);
  });

  it("no profile (Bybit, or not fetched yet) → the known parts are rescaled to 100", () => {
    const r = reliabilityScore({ completionRate: 1, orders30d: 5000 });
    expect(r.parts.presence).toBeNull();
    expect(r.parts.tenure).toBeNull();
    expect(r.parts.feedback).toBeNull();
    expect(r.parts.release).toBeNull();
    expect(r.parts.accountAge).toBeNull();
    expect(r.score).toBe(Math.round(((45 * wilsonLowerBound(1, 5000) + 15) * 100) / 60));
    // A perfect merchant scores the same 100 with or without a profile.
    const noProfile = reliabilityScore({ completionRate: 1, orders30d: 1e9, presence7d: 1, firstSeenTs: now - 900 * 86400, nowTs: now });
    const withProfile = reliabilityScore({ ...full, orders30d: 1e9, positive: 1e9 });
    expect(noProfile.score).toBe(withProfile.score);
  });

  it("slow release and poor feedback pull the score down", () => {
    const fast = reliabilityScore(full);
    const slow = reliabilityScore({ ...full, avgReleaseSec: 900 });
    const badFb = reliabilityScore({ ...full, positive: 80, negative: 20 });
    expect(fast.score - slow.score).toBe(10);
    expect(badFb.score).toBeLessThan(fast.score - 3);
  });

  it("points always add up to the score", () => {
    const r = reliabilityScore({ ...full, avgReleaseSec: 300, presence7d: 0.4, registerDays: 100 });
    const p = r.parts.points;
    const sum = p.completion + p.volume + (p.feedback ?? 0) + (p.release ?? 0) + (p.presence ?? 0) + (p.tenure ?? 0) + (p.accountAge ?? 0);
    expect(r.score).toBe(Math.round(sum));
  });

  it("missing data → 0, clamps presence and tenure", () => {
    expect(reliabilityScore({ completionRate: null, orders30d: null }).score).toBe(0);
    const r = reliabilityScore({ completionRate: 1, orders30d: 10, presence7d: 3, firstSeenTs: now - 900 * 86400, nowTs: now });
    expect(r.parts.presence).toBe(1);
    expect(r.parts.tenure).toBe(1);
  });
});
