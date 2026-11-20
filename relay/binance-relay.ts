/**
 * P2P.LK Binance relay.
 *
 * Binance's P2P API sits behind Cloudflare and refuses every request that
 * comes from a Cloudflare Worker (HTTP 403, any host, any headers). This tiny
 * relay runs OUTSIDE Cloudflare, in an Asian region (Binance also blocks US
 * addresses), and forwards the worker's Binance calls. Nothing else.
 *
 * Standard web handler (`fetch(Request) → Response`), so the same file runs
 * on Deno Deploy (`Deno.serve`), and wraps easily for AWS Lambda / Cloud Run.
 *
 * Protocol — POST / with `Authorization: Bearer <RELAY_TOKEN>`:
 *   { "calls": [ { "url": "https://p2p.binance.com/bapi/…", "method": "POST", "body": "{…}" } ] }
 * → { "results": [ { "status": 200, "body": "{…}" } ] }   (same order)
 * Up to 40 calls per request (the worker batches a whole book into one), run
 * 8 at a time. Only Binance /bapi/ URLs are allowed.
 *
 * Env: RELAY_TOKEN (required; long random string, same as the worker's
 * BINANCE_RELAY_TOKEN secret).
 */

const ALLOWED_HOSTS = new Set(["p2p.binance.com", "c2c.binance.com", "www.binance.com"]);
const MAX_CALLS = 40;
const CONCURRENCY = 8;
const TIMEOUT_MS = 12_000;
/** Largest Binance response passed back (a 20-ad page is ~60 KB). */
const MAX_BODY = 1_000_000;
const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Safari/537.36";

type Call = { url: string; method?: "GET" | "POST"; body?: string };
type Result = { status: number; body: string };

function allowed(raw: string): boolean {
  try {
    const u = new URL(raw);
    return u.protocol === "https:" && ALLOWED_HOSTS.has(u.hostname) && u.pathname.startsWith("/bapi/");
  } catch {
    return false;
  }
}

async function forward(call: Call): Promise<Result> {
  if (!allowed(call.url)) return { status: 400, body: "url not allowed" };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), TIMEOUT_MS);
  try {
    const r = await fetch(call.url, {
      method: call.method === "POST" ? "POST" : "GET",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "User-Agent": UA,
        clienttype: "web",
      },
      body: call.method === "POST" ? (call.body ?? "{}") : undefined,
      signal: ac.signal,
      // Never follow a redirect off the allowlisted hosts.
      redirect: "manual",
    });
    const body = await r.text();
    if (body.length > MAX_BODY) return { status: 502, body: "response too large" };
    return { status: r.status, body };
  } catch (err) {
    return { status: 599, body: `relay fetch failed: ${(err as Error).message}` };
  } finally {
    clearTimeout(t);
  }
}

/** Constant-time compare for the bearer token. */
function sameToken(a: string, b: string): boolean {
  if (!a || a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

export async function handle(req: Request, token: string | undefined): Promise<Response> {
  const json = (data: unknown, status = 200) =>
    new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

  if (req.method === "GET" && new URL(req.url).pathname === "/health") return json({ ok: true });
  if (req.method !== "POST") return json({ error: "POST only" }, 405);
  if (!token) return json({ error: "relay not configured" }, 500);
  const auth = req.headers.get("authorization") ?? "";
  if (!sameToken(auth.replace(/^Bearer\s+/i, ""), token)) return json({ error: "unauthorized" }, 401);

  let calls: Call[];
  try {
    calls = ((await req.json()) as { calls?: Call[] }).calls ?? [];
  } catch {
    return json({ error: "bad json" }, 400);
  }
  if (!Array.isArray(calls) || calls.length === 0 || calls.length > MAX_CALLS) {
    return json({ error: `1–${MAX_CALLS} calls per request` }, 400);
  }

  const results: Result[] = new Array(calls.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, calls.length) }, async () => {
      while (next < calls.length) {
        const i = next++;
        results[i] = await forward(calls[i]);
      }
    }),
  );
  return json({ results });
}

// Deno Deploy entry point. (Other platforms import `handle` instead.)
declare const Deno: { serve?: (h: (r: Request) => Response | Promise<Response>) => unknown; env: { get(k: string): string | undefined } } | undefined;
if (typeof Deno !== "undefined" && Deno?.serve) {
  Deno.serve((req) => handle(req, Deno!.env.get("RELAY_TOKEN")));
}
