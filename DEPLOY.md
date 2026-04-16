# Deploying P2P.LK

This guide walks you from a local dev checkout to a publicly accessible
instance with a scheduled ingest worker. The recommended stack is
**Vercel + Turso**; alternatives are noted at the end.

## 1 · Provision a Turso database

Turso speaks libSQL (SQLite-compatible) and is what `lib/db/client.ts`
already uses. Sign up at [turso.tech](https://turso.tech) and:

```bash
# Install the CLI once
brew install turso  # or: curl -sSfL https://get.tur.so/install.sh | bash

# Authenticate
turso auth signup   # or: turso auth login

# Create the database (name can be anything)
turso db create p2p-lk

# Copy the URL (looks like libsql://p2p-lk-<you>.turso.io)
turso db show p2p-lk --url

# Mint an auth token — save this, you won't see it again
turso db tokens create p2p-lk
```

Schema bootstraps itself on first connection — no migration command needed.

## 2 · Push the repo to Vercel

```bash
# From the repo root
vercel link      # link to a new or existing Vercel project
```

Add the env vars in the Vercel dashboard (or via CLI):

| Key                   | Value                                                  | Scope     |
|-----------------------|--------------------------------------------------------|-----------|
| `DATABASE_URL`        | `libsql://p2p-lk-<you>.turso.io`                       | All       |
| `DATABASE_AUTH_TOKEN` | Token from `turso db tokens create p2p-lk`             | All       |
| `CRON_SECRET`         | A long random string (`openssl rand -hex 32`)          | Production|

```bash
# CLI equivalents (pick one path):
vercel env add DATABASE_URL production
vercel env add DATABASE_AUTH_TOKEN production
vercel env add CRON_SECRET production
```

Deploy:

```bash
vercel --prod
```

## 3 · Cron turns itself on

`vercel.json` is already configured:

```json
{
  "crons": [
    { "path": "/api/cron/snapshot", "schedule": "*/5 * * * *" }
  ]
}
```

Vercel auto-attaches `Authorization: Bearer $CRON_SECRET` when hitting cron
endpoints, which is what `/api/cron/snapshot` checks for. As soon as the
deployment is live, snapshots start landing in Turso every five minutes.

You can verify manually:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" \
  https://<your-app>.vercel.app/api/cron/snapshot
```

## 4 · First data

The first render of **Historical**, **Risk**, **Reports → Recap** and the
depth heatmap on **Liquidity** will show the "no history yet" empty state
until a few cron ticks have run. Either wait ~15 minutes or hit the cron
endpoint manually to seed the DB.

## 5 · Local development is unchanged

If you don't set `DATABASE_URL`, `lib/db/client.ts` falls back to a local
libSQL file at `data/p2p.db`. All scripts still work:

```bash
npm run dev              # the app
npm run ingest           # one capture
npm run ingest:loop      # continuous capture (replaces cron locally)
```

You can even mix modes — set `DATABASE_URL` locally to point at Turso and
develop against the production DB.

## Alternative hosts

- **Railway / Render / Fly** — long-running Node runtimes are a great fit.
  Skip Turso and use a persistent volume: set `DATABASE_URL=file:/data/p2p.db`
  mounted to your volume. No schema changes required.
- **Cloudflare Workers** — not currently supported. `@libsql/client` has a
  web build, but Workers can't run our Node-based ingest script and we use
  Node-only APIs in a few spots.

## Troubleshooting

- **Cron returns 401** — `CRON_SECRET` doesn't match or isn't set for the
  production environment.
- **Historical page empty after deploy** — first cron hasn't fired. Check
  the Vercel "Cron" tab to confirm the job is scheduled, then trigger it
  once manually to seed.
- **429 / captcha from Binance** — the public feed occasionally throttles.
  `fetchBothSides` already swallows errors per-market so the whole ingest
  tick doesn't fail; missed markets retry on the next tick.
