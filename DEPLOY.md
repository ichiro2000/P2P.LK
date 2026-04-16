# Deploying P2P.LK to DigitalOcean

One command, one bill, one dashboard. The spec at `.do/app.yaml`
provisions a Managed Postgres cluster **and** the web + ingest components
together. You don't have to set anything up beforehand.

## 1 · Deploy

Option A — **CLI** (fastest):

```bash
doctl auth init                         # one-time, if you haven't
doctl apps create --spec .do/app.yaml
```

Option B — **Dashboard**:

1. Apps → **Create App** → GitHub → pick `ichiro2000/P2P.LK`, branch `main`.
2. When the detection screen appears, click **Edit your app spec** and
   paste the contents of `.do/app.yaml`. Save.
3. Review and deploy.

Either path provisions:

| Component | Kind    | What it runs                               | Size              |
|-----------|---------|--------------------------------------------|-------------------|
| `db`      | Managed | DigitalOcean Postgres 16, single node      | db-s-1vcpu-1gb    |
| `web`     | Service | `next start` on port 3000                  | basic-xs          |
| `ingest`  | Worker  | `tsx scripts/ingest.ts --loop --every=300` | basic-xxs         |

The database takes 3–5 minutes to come online; App Platform waits for it
before starting the web/ingest components. `DATABASE_URL` is auto-wired
from the attached cluster so no secret needs to be pasted.

## 2 · Verify

1. **Build logs** — `web` and `ingest` finish green. Within a couple
   minutes the ingest log prints lines like:
   ```
   [2026-04-16 13:26:35] ingest ok — markets=8/10 rows=10+282 in 3403ms
   ```
2. **App URL** — open it; `/` renders live LKR data within seconds.
3. **DB** — DB dashboard → **Query**:
   ```sql
   SELECT count(*) FROM market_snapshots;
   SELECT count(*) FROM merchant_snapshots;
   ```
   Both should grow every 5 minutes.
4. Historical / Risk / Liquidity / Reports → Recap need a few ticks before
   leaving the empty state. Ten minutes after deploy they start filling in.

## 3 · Custom domain (optional)

- **Your app → Settings → Domains → Add Domain**.
- Point your domain's DNS at the `CNAME` DO gives you.
- DO issues a free Let's Encrypt cert automatically.

## 4 · Local development (optional)

Developing against the new cluster:

1. DB dashboard → **Trusted Sources → Add** → pick your IP (DO can detect
   it for you).
2. DB dashboard → **Connection Details → Public network → Connection String**.
   Copy the URI.
3. `cp .env.example .env.local`, paste the URL into `DATABASE_URL`.
4. `npm install && npm run dev` — you're hitting the same DB the production
   app uses.

If you'd rather not share a DB between dev and prod, install Postgres
locally (`brew install postgresql@16`, `createdb p2p`, use
`postgresql://localhost/p2p`) and the schema bootstraps itself on first
connection.

## 5 · Upgrade to a Transaction pool (optional, later)

The default deploy uses the direct connection (port 25060). This is fine
for a few hundred concurrent DB hits. If traffic grows and you want
pgBouncer-style connection multiplexing:

1. DB dashboard → **Connection Pools → Create Pool** with Mode **Transaction**,
   Database `defaultdb`, User `doadmin`, Pool size `10`.
2. Copy the pool's connection string (port 25061).
3. App → Settings → App-Level Env Vars → **Edit `DATABASE_URL`** → paste
   the pool URL, mark **Encrypt**, Save.

The `postgres-js` client already runs with `prepare: false`, so it works
against the pool without code changes. App redeploys automatically.

## Common gotchas

- **`tsx: command not found`** during the `ingest` build — the build
  command ran `npm install --production` and skipped dev deps. Confirm the
  spec's `build_command: npm ci` hasn't been edited.
- **DB is still `online-creating` when app deploys** — App Platform will
  retry. If the worker crashes with a connection error, re-deploy the app
  once the DB badge turns green.
- **Binance 429 / captcha in the ingest log** — public-feed throttling.
  The worker swallows per-market errors and retries on the next tick.
- **Historical page empty after 30 min** — check the ingest worker runtime
  log. Usually means the DB connection failed (rare) or Binance is
  consistently rate-limiting the egress IP (rarer).

## Costs, ballpark

- App Platform `basic-xs` web (1 GB): **$12/mo**
- App Platform `basic-xxs` worker (512 MB): **$5/mo**
- Managed Postgres `db-s-1vcpu-1gb`: **$15/mo**

About **$32/mo** all-in on DigitalOcean.
