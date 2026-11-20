import { describe, expect, it } from "vitest";
import type { NormalizedAd as Ad } from "@/lib/types";
import { withReleaseTimes } from "./jobs";

const ad = (id: string, avgReleaseSec?: number) =>
  ({ merchant: { id, name: id, isMerchant: true, orders30d: 1, completionRate: 1, avgReleaseSec } }) as unknown as Ad;

describe("withReleaseTimes", () => {
  it("fills missing release times from profiles", () => {
    const out = withReleaseTimes({ buy: [ad("a")], sell: [ad("b")] }, new Map([["a", 90], ["b", 30]]));
    expect(out.buy[0].merchant.avgReleaseSec).toBe(90);
    expect(out.sell[0].merchant.avgReleaseSec).toBe(30);
  });

  it("keeps a release time the exchange already sent", () => {
    const out = withReleaseTimes({ buy: [ad("a", 12)], sell: [] }, new Map([["a", 90]]));
    expect(out.buy[0].merchant.avgReleaseSec).toBe(12);
  });

  it("leaves merchants without a profile untouched", () => {
    const a = ad("z");
    const out = withReleaseTimes({ buy: [a], sell: [] }, new Map([["a", 90]]));
    expect(out.buy[0]).toBe(a);
  });
});
