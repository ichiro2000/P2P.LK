/**
 * Every Binance API call goes through here.
 *
 * Binance refuses requests from Cloudflare Workers (HTTP 403), so production
 * sends them through a small relay outside Cloudflare (relay/binance-relay.ts)
 * when BINANCE_RELAY_URL + BINANCE_RELAY_TOKEN are set. Without them (local
 * dev, tests) calls go straight to Binance.
 *
 * `binanceFetchMany` sends a whole set of calls as ONE relay request — the
 * relay's free tier counts inbound requests, so a 10-page book costs 1.
 */

export type BinanceCall = { url: string; method?: "GET" | "POST"; body?: string };

const DIRECT_HEADERS = {
  Accept: "application/json",
  "Content-Type": "application/json",
  "User-Agent":
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36",
  clienttype: "web",
};

/** Max calls the relay takes per request. */
export const RELAY_MAX_CALLS = 40;

function relayConfig(): { url: string; token: string } | null {
  const url = process.env.BINANCE_RELAY_URL;
  const token = process.env.BINANCE_RELAY_TOKEN;
  return url && token ? { url, token } : null;
}

export const usingRelay = () => relayConfig() != null;

function direct(call: BinanceCall, signal?: AbortSignal): Promise<Response> {
  return fetch(call.url, {
    method: call.method ?? "GET",
    headers: DIRECT_HEADERS,
    body: call.method === "POST" ? (call.body ?? "{}") : undefined,
    signal,
    cache: "no-store",
  });
}

/** Run calls (in order). Each result is a real Response, so callers keep
 *  using `res.ok`, `res.status` and `res.json()`. Relay/network failures
 *  reject, like `fetch` does. */
export async function binanceFetchMany(calls: BinanceCall[], signal?: AbortSignal): Promise<Response[]> {
  if (calls.length === 0) return [];
  const relay = relayConfig();
  if (!relay) return Promise.all(calls.map((c) => direct(c, signal)));

  const out: Response[] = [];
  for (let i = 0; i < calls.length; i += RELAY_MAX_CALLS) {
    const chunk = calls.slice(i, i + RELAY_MAX_CALLS);
    const r = await fetch(relay.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${relay.token}` },
      body: JSON.stringify({ calls: chunk }),
      signal,
      cache: "no-store",
    });
    if (!r.ok) throw new Error(`Binance relay HTTP ${r.status}`);
    const { results } = (await r.json()) as { results?: { status: number; body: string }[] };
    if (!Array.isArray(results) || results.length !== chunk.length) throw new Error("Binance relay: bad response");
    for (const res of results) {
      // 599 = the relay couldn't reach Binance: surface as a network error.
      if (res.status === 599) throw new Error(res.body);
      out.push(new Response(res.body, { status: res.status, headers: { "Content-Type": "application/json" } }));
    }
  }
  return out;
}

export async function binanceFetch(call: BinanceCall, signal?: AbortSignal): Promise<Response> {
  return (await binanceFetchMany([call], signal))[0];
}
