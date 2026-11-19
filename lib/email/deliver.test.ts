import { afterEach, describe, expect, it, vi } from "vitest";
import { deliverEmail, EMAIL_ALERT_CAP, EMAIL_MONTHLY_CAP, EmailCapError, monthKey } from "./deliver";

function kv(initial: Record<string, string> = {}) {
  const store = new Map(Object.entries(initial));
  return {
    store,
    get: vi.fn(async (k: string) => store.get(k) ?? null),
    put: vi.fn(async (k: string, v: string) => void store.set(k, v)),
  } as unknown as KVNamespace & { store: Map<string, string> };
}
const mail = { to: "a@b.lk", subject: "S", html: "<p>h</p>", text: "h" };

describe("deliverEmail (production)", () => {
  afterEach(() => vi.unstubAllEnvs());

  it("sends through the EMAIL binding and counts the send", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const send = vi.fn(async () => ({ messageId: "1" }));
    const LIVE = kv();
    await deliverEmail(mail, { EMAIL: { send } as unknown as SendEmail, EMAIL_FROM: "P2P.LK <no-reply@p2p.lk>", LIVE });
    expect(send).toHaveBeenCalledWith({ from: { name: "P2P.LK", email: "no-reply@p2p.lk" }, to: "a@b.lk", subject: "S", html: "<p>h</p>", text: "h" });
    expect(LIVE.store.get(monthKey())).toBe("1");
  });

  it("stops alert mail at the alert cap but still sends account mail", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const send = vi.fn(async () => ({ messageId: "1" }));
    const LIVE = kv({ [monthKey()]: String(EMAIL_ALERT_CAP) });
    const env = { EMAIL: { send } as unknown as SendEmail, EMAIL_FROM: "no-reply@p2p.lk", LIVE };
    await expect(deliverEmail({ ...mail, kind: "alert" }, env)).rejects.toBeInstanceOf(EmailCapError);
    await deliverEmail(mail, env);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("stops everything at the monthly cap", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const send = vi.fn();
    const LIVE = kv({ [monthKey()]: String(EMAIL_MONTHLY_CAP) });
    await expect(deliverEmail(mail, { EMAIL: { send } as unknown as SendEmail, EMAIL_FROM: "no-reply@p2p.lk", LIVE })).rejects.toBeInstanceOf(EmailCapError);
    expect(send).not.toHaveBeenCalled();
  });

  it("refuses when the binding or sender is missing", async () => {
    vi.stubEnv("NODE_ENV", "production");
    await expect(deliverEmail(mail, { LIVE: kv() })).rejects.toThrow(/not configured/);
  });
});
