import { describe, expect, it } from "vitest";
import { planFor, tickTs } from "./run";

describe("tickTs", () => {
  it("rounds a late scheduledTime down to the minute", () => {
    // Production sweep stamped 1795154401 (1 s past 10:00:00 UTC boundary).
    expect(tickTs(1795154401_000)).toBe(1795154400);
    expect(tickTs(1795154459_999)).toBe(1795154400);
  });

  it("keeps an on-the-minute time unchanged", () => {
    expect(tickTs(1795154400_000)).toBe(1795154400);
  });

  it("lines sweeps up with 5-minute market buckets", () => {
    const ts = tickTs(1795154401_000);
    expect(ts % 300).toBe(0);
  });

  it("still plans the sweep for the rounded minute", () => {
    const ts = tickTs(1795154401_000);
    expect(planFor(new Date(ts * 1000)).sweep).toBe(true);
  });
});

describe("planFor gold", () => {
  it("runs the gold collector hourly at :47 UTC only", () => {
    expect(planFor(new Date("2026-11-22T09:47:00Z")).gold).toBe(true);
    expect(planFor(new Date("2026-11-22T09:17:00Z")).gold).toBe(false);
    expect(planFor(new Date("2026-11-22T09:48:00Z")).gold).toBe(false);
  });
});
