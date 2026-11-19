import { describe, expect, it } from "vitest";
import { alertPayload, backoffSec, changeFor, failureSummary, isDue, minimalPayload } from "./deliver";
import { MAX_PLAINTEXT } from "./encrypt";

const now = 1_800_000_000;
const row = { failureCount: 2 };

describe("result → stored subscription", () => {
  it("success resets the failure state", () => {
    expect(changeFor(row, { action: "ok", status: 201 }, now)).toEqual({
      kind: "update",
      set: { lastSuccessAt: now, failureCount: 0, nextAttemptAt: null },
    });
  });

  it("deletes only when the push service says the subscription is gone", () => {
    expect(changeFor(row, { action: "gone", status: 410 }, now)).toEqual({ kind: "delete" });
    expect(changeFor(row, { action: "gone", status: 404 }, now)).toEqual({ kind: "delete" });
    for (const action of ["retry", "auth", "too_large", "rejected"] as const) {
      expect(changeFor(row, { action, status: 500 }, now).kind).toBe("update");
    }
  });

  it("429/5xx/network keep the device, count, and back off (honouring Retry-After)", () => {
    const c = changeFor(row, { action: "retry", status: 503, error: "HTTP 503" }, now);
    expect(c).toEqual({
      kind: "update",
      set: { failureCount: 3, lastError: "HTTP 503", lastErrorAt: now, nextAttemptAt: now + 240 },
    });
    const ra = changeFor({ failureCount: 0 }, { action: "retry", status: 429, retryAfterSec: 600 }, now);
    expect(ra.kind === "update" && ra.set.nextAttemptAt).toBe(now + 600);
    const net = changeFor({ failureCount: 0 }, { action: "retry", status: 0, error: "network: x" }, now);
    expect(net.kind === "update" && net.set.nextAttemptAt).toBe(now + 60);
  });

  it("a VAPID rejection keeps the device with no backoff", () => {
    const c = changeFor(row, { action: "auth", status: 403, error: "HTTP 403" }, now);
    expect(c).toEqual({ kind: "update", set: { failureCount: 3, lastError: "HTTP 403", lastErrorAt: now } });
  });

  it("backoff doubles from 1 min and is capped at 1 h (a device is never dark for long)", () => {
    expect([1, 2, 3, 4, 5, 6, 7, 50].map((n) => backoffSec(n))).toEqual([60, 120, 240, 480, 960, 1920, 3600, 3600]);
    expect(backoffSec(1, 99_999)).toBe(3600);
    expect(isDue({ nextAttemptAt: null }, now)).toBe(true);
    expect(isDue({ nextAttemptAt: now }, now)).toBe(true);
    expect(isDue({ nextAttemptAt: now + 1 }, now)).toBe(false);
  });
});

describe("alert payload", () => {
  it("one alert: its label and detail, same-origin url, collapse tag", () => {
    expect(alertPayload([{ label: "Binance mid above 300", detail: "Mid price 301.00 LKR > 300.00" }])).toEqual({
      title: "Binance mid above 300",
      body: "Mid price 301.00 LKR > 300.00",
      url: "/alerts",
      tag: "alerts",
    });
  });

  it("several alerts are combined and stay small", () => {
    const items = Array.from({ length: 50 }, (_, i) => ({ label: `Rule ${i} `.repeat(30), detail: "d".repeat(2000) }));
    const p = alertPayload(items);
    expect(p.title).toBe("50 P2P.LK alerts");
    expect(p.body.split("\n")).toHaveLength(4);
    expect(p.body).toMatch(/\+47 more$/);
    expect(new TextEncoder().encode(JSON.stringify(p)).length).toBeLessThan(600);
    const one = alertPayload([{ label: "x".repeat(5000), detail: "y".repeat(5000) }]);
    expect(new TextEncoder().encode(JSON.stringify(one)).length).toBeLessThan(MAX_PLAINTEXT / 4);
    expect(minimalPayload(p)).toEqual({ title: "P2P.LK", body: "You have a new alert.", url: "/alerts", tag: "alerts" });
  });
});

describe("failure summary (admin health)", () => {
  it("is null when everything was delivered, else starts with the failure count", () => {
    expect(failureSummary([{ id: "a", action: "ok", status: 201 }])).toBeNull();
    const s = failureSummary([
      { id: "a", action: "ok", status: 201 },
      { id: "b", action: "gone", status: 410 },
      { id: "c", action: "retry", status: 0 },
      { id: "d", action: "auth", status: 403, error: "HTTP 403" },
    ])!;
    expect(s).toMatch(/^3 failed: 410 ×1, network ×1, 403 ×1/);
    expect(s).toMatch(/1 expired device removed/);
    expect(s).toMatch(/VAPID REJECTED/);
    expect(parseInt(s, 10)).toBe(3);
  });
});
