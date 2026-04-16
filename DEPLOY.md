# Deploying P2P.LK to DigitalOcean

The canonical deploy: **DigitalOcean App Platform** for the web service and
ingest worker, **DigitalOcean Managed Postgres** for the data. Everything
lives in one DO project — one bill, one dashboard.

## 1 · Prepare your DO Managed Postgres

1. DO dashboard → **Databases → Create Database Cluster → PostgreSQL 16**
   (skip if you already have one).
2. Once the cluster is green, open it and go to **Connection Pools →
   Create Connection Pool** with:

   | Field      | Value                   |
   |------------|-------------------------|
   | Pool name  | `p2p-txn` (or similar)  |
   | Database   | `defaultdb`             |
   | User       | `doadmin`               |
   | Mode       | **Transaction**         |
   | Pool size  | `10`                    |

3. Open the new pool → **Connection Details → Public network → Connection
   String**. It looks like:
   ```
   postgresql://doadmin:<password>@<cluster>-pool-do-user-xxxx-0.db.ondigitalocean.com:25061/defaultdb?sslmode=require
   ```
   Save this string — you'll paste it in step 4.

> Why the transaction pool? The DB cluster has a fixed connection limit
> (25 on the cheapest tier). The pool multiplexes many short-lived app
> requests onto a few real DB connections. `lib/db/client.ts` uses
> `prepare: false` already, which is required for pgBouncer-style poolers.

## 2 · (Optional) Smoke-test locally

```bash
cp .env.example .env.local
# paste the Transaction-pool URL into DATABASE_URL
npm install
npm run ingest -- USDT:LKR    # creates tables and writes one tick
npm run dev                    # http://localhost:3000
```

If the Historical page shows "one snapshot since …", the DB is wired
correctly. If it hangs or errors, re-check the URL (port 25061, not 25060;
`sslmode=require` present).

## 3 · Wire your cluster name into the app spec

Open `.do/app.yaml` and replace the placeholder:

```yaml
databases:
  - name: db
    engine: PG
    version: "16"
    cluster_name: <YOUR_CLUSTER_NAME>   # ← put your cluster's exact name here
```

Commit and push. This tells App Platform to attach the cluster, which
auto-adds the app's outbound IPs to the DB's trusted sources.

## 4 · Create the App

Option A — **CLI** (fastest if you have `doctl`):

```bash
doctl auth init                         # one-time
doctl apps create --spec .do/app.yaml   # creates app, kicks off a build
```

Option B — **Dashboard**:

1. Apps → **Create App** → GitHub → pick `ichiro2000/P2P.LK`, branch `main`.
2. When the detection screen appears, click **Edit your app spec** and paste
   the contents of `.do/app.yaml`. Save.
3. Continue through to the review screen and deploy.

Either path provisions:

| Component | Kind    | What it runs                               | Size        |
|-----------|---------|--------------------------------------------|-------------|
| `web`     | Service | `next start` on port 3000                  | basic-xs    |
| `ingest`  | Worker  | `tsx scripts/ingest.ts --loop --every=300` | basic-xxs   |
| `db`      | Managed | Your existing Postgres cluster (attached)  | —           |

## 5 · Add the secret

The app will fail to start without `DATABASE_URL`. In the DO dashboard:

1. **Your app → Settings → App-Level Environment Variables → Edit**.
2. Add these with **Encrypt** checked:
   - `DATABASE_URL` — the Transaction-pool URL from step 1.
   - `CRON_SECRET` — a random string, `openssl rand -hex 32`. Optional; only
     needed if you intend to curl `/api/cron/snapshot` by hand.
3. Save. App Platform redeploys with the new values.

> Why not use `${db.DATABASE_URL}` from the attached cluster? That variable
> gives the *direct* connection (port 25060), not the pool. Setting
> `DATABASE_URL` explicitly overrides it with the pool URL — the attachment
> still does its job (trusted sources, cert).

## 6 · Verify

1. **Build logs** — `web` and `ingest` both finish green. The ingest log
   prints lines like:
   ```
   [2026-04-16 13:26:35] ingest ok — markets=8/10 rows=10+282 in 3403ms
   ```
2. **App URL** — open it; `/` renders live LKR data within seconds.
3. **Database** — open the DB dashboard → **Query**, run:
   ```sql
   SELECT count(*) FROM market_snapshots;
   SELECT count(*) FROM merchant_snapshots;
   ```
   Both should grow every 5 minutes.
4. Historical / Risk / Liquidity / Reports → Recap need a few ticks of
   data before leaving the empty state. Ten minutes after deploy they'll
   start filling in.

## 7 · Custom domain (optional)

- **Your app → Settings → Domains → Add Domain**.
- Point your domain's DNS at the `CNAME` DO gives you.
- DO issues a free Let's Encrypt cert automatically.

## Common gotchas

- **"DATABASE_URL is not set" in the worker log** — the secret is scoped
  to a different environment. In the dashboard expand the var row and
  confirm **Scope: Run Time** and no environment filter.
- **`tsx: command not found`** during the `ingest` build — the build command
  ran `npm install --production` and skipped dev deps. The spec's
  `build_command: npm ci` installs everything; confirm it hasn't been
  edited in the dashboard to add `--production`.
- **DB errors about prepared statements** — double-check the URL uses the
  pool port (**25061**), not 25060, and that `lib/db/client.ts` still has
  `prepare: false`.
- **SSL / certificate errors** — the pool URL must include `?sslmode=require`.
  `postgres-js` picks that up automatically.
- **Binance 429 / captcha in the ingest log** — public-feed throttling.
  The worker swallows per-market errors and retries; no action needed
  unless it persists.

## Costs, ballpark

- App Platform `basic-xs` web (1 GB): **$12/mo**
- App Platform `basic-xxs` worker (512 MB): **$5/mo**
- Managed Postgres, smallest plan (1 GB RAM, 10 GB SSD): **$15/mo**

About **$32/mo** all-in for a comfortably-running production instance on
DigitalOcean.
