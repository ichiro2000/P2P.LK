# P2P.LK Binance relay

Binance refuses requests from Cloudflare Workers, so the worker sends its
Binance calls here (Vercel, Singapore). See `binance-relay.ts` for the
protocol. Deploy from this folder:

    npx vercel@latest deploy --prod

Env (Vercel → Settings → Environment Variables): `RELAY_TOKEN`, the same
value as the worker's `BINANCE_RELAY_TOKEN` secret.
