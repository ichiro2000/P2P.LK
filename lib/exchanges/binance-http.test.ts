import { afterEach, describe, expect, it, vi } from "vitest";
import { binanceFetchMany } from "./binance-http";
import { handle } from "../../relay/binance-relay";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("binanceFetchMany", () => {
  it("goes direct when no relay is configured", async () => {
    const f = vi.fn(async () => new Response("{}", { status: 200 }));
    vi.stubGlobal("fetch", f);
    await binanceFetchMany([{ url: "https://p2p.binance.com/bapi/a" }, { url: "https://p2p.binance.com/bapi/b" }]);
    expect(f).toHaveBeenCalledTimes(2);
  });

  it("sends a whole batch as one relay request and keeps order", async () => {
    vi.stubEnv("BINANCE_RELAY_URL", "https://relay.example");
    vi.stubEnv("BINANCE_RELAY_TOKEN", "t0k");
    const f = vi.fn(async (_u: string, init: RequestInit) => {
      const { calls } = JSON.parse(String(init.body)) as { calls: { url: string }[] };
      return Response.json({ results: calls.map((c, i) => ({ status: 200, body: JSON.stringify({ i, url: c.url }) })) });
    });
    vi.stubGlobal("fetch", f);
    const rs = await binanceFetchMany([{ url: "https://p2p.binance.com/bapi/a" }, { url: "https://p2p.binance.com/bapi/b", method: "POST", body: "{}" }]);
    expect(f).toHaveBeenCalledTimes(1);
    expect((f.mock.calls[0][1] as RequestInit).headers).toMatchObject({ Authorization: "Bearer t0k" });
    expect(await Promise.all(rs.map((r) => r.json()))).toEqual([
      { i: 0, url: "https://p2p.binance.com/bapi/a" },
      { i: 1, url: "https://p2p.binance.com/bapi/b" },
    ]);
  });

  it("passes Binance error statuses through and turns relay network failures into errors", async () => {
    vi.stubEnv("BINANCE_RELAY_URL", "https://relay.example");
    vi.stubEnv("BINANCE_RELAY_TOKEN", "t0k");
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [{ status: 403, body: "no" }] })));
    expect((await binanceFetchMany([{ url: "https://p2p.binance.com/bapi/a" }]))[0].status).toBe(403);
    vi.stubGlobal("fetch", vi.fn(async () => Response.json({ results: [{ status: 599, body: "relay fetch failed: x" }] })));
    await expect(binanceFetchMany([{ url: "https://p2p.binance.com/bapi/a" }])).rejects.toThrow(/relay fetch failed/);
    vi.stubGlobal("fetch", vi.fn(async () => new Response("", { status: 401 })));
    await expect(binanceFetchMany([{ url: "https://p2p.binance.com/bapi/a" }])).rejects.toThrow(/relay HTTP 401/);
  });
});

describe("relay handler", () => {
  const req = (body: unknown, token = "secret") =>
    new Request("https://relay/", { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: JSON.stringify(body) });

  it("rejects a wrong token", async () => {
    expect((await handle(req({ calls: [{ url: "https://p2p.binance.com/bapi/x" }] }, "nope"), "secret")).status).toBe(401);
  });

  it("only forwards Binance /bapi/ URLs", async () => {
    const f = vi.fn(async () => new Response('{"ok":1}', { status: 200 }));
    vi.stubGlobal("fetch", f);
    const res = await handle(
      req({ calls: [{ url: "https://p2p.binance.com/bapi/c2c/x", method: "POST", body: "{}" }, { url: "https://evil.example/bapi/x" }, { url: "https://p2p.binance.com/en/x" }] }),
      "secret",
    );
    const { results } = (await res.json()) as { results: { status: number }[] };
    expect(results.map((r) => r.status)).toEqual([200, 400, 400]);
    expect(f).toHaveBeenCalledTimes(1);
  });

  it("caps the batch size", async () => {
    const calls = Array.from({ length: 41 }, () => ({ url: "https://p2p.binance.com/bapi/x" }));
    expect((await handle(req({ calls }), "secret")).status).toBe(400);
  });
});
