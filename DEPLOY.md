# Deploying P2P.LK to DigitalOcean + Supabase

This is the canonical deploy path: **DigitalOcean App Platform** for the web
service and ingest worker, **Supabase** (Postgres) for the data. End-to-end
the setup takes about 15 minutes; no code changes required.

## 1 · Grab your Supabase connection string

1. Open your Supabase project.
2. **Settings → Database → Connection string**.
3. Pick the **Transaction pooler** tab (port `6543`). Copy the `URI` form —
   it looks like:
   ```
   postgresql://postgres.<project-ref>:<password>@aws-0-<region>.pooler.supabase.com:6543/postgres
   ```
4. Replace `[YOUR-PASSWORD]` with the database password you set when the
   project was created.

> Why transaction pooler? App Platform containers are long-lived but we
> still want the pooler's connection limits and resilience. The client
> is configured with `prepare: false` to work around the pooler's lack of
> prepared-statement support — see `lib/db/client.ts`.

## 2 · (Optional) Smoke-test locally

```bash
cp .env.example .env.local
# paste the Supabase URL into DATABASE_URL
npm install
npm run ingest -- USDT:LKR    # one capture — creates tables on first run
npm run dev                    # http://localhost:3000
```

You should see the LKR market on the homepage and one tick appear in
Historical. If this works, the deploy will too.

## 3 · Provision the App Platform app

Option A — **CLI** (fastest if you already have `doctl`):

```bash
doctl auth init                         # one-time
doctl apps create --spec .do/app.yaml   # creates app, kicks off a build
```

Option B — **Dashboard**:

1. DigitalOcean → Apps → **Create App** → GitHub → pick `ichiro2000/P2P.LK`,
   branch `main`.
2. When the detection screen appears, click **Edit your app spec** and paste
   the contents of `.do/app.yaml`. Save.
3. Continue through to deploy.

Either path creates two components:

| Component | Kind    | What it runs                               | Size        |
|-----------|---------|--------------------------------------------|-------------|
| `web`     | Service | `next start` on port 3000                  | basic-xs    |
| `ingest`  | Worker  | `tsx scripts/ingest.ts --loop --every=300` | basic-xxs   |

## 4 · Add secrets

The app won't finish deploying without `DATABASE_URL`. In the DO dashboard:

1. **Your app → Settings → App-Level Env Vars → Edit**.
2. Add the following (**Encrypt** checked on both):
   - `DATABASE_URL` — the Supabase Transaction pooler URI from step 1.
   - `CRON_SECRET` — a random string, `openssl rand -hex 32`. Optional; only
     needed if you intend to curl `/api/cron/snapshot` manually.
3. **Save** — App Platform redeploys with the new values.

CLI equivalent:

```bash
doctl apps update <APP_ID> --spec .do/app.yaml
# then go to the dashboard to paste the actual secret values, or use:
doctl apps config set <APP_ID> --env DATABASE_URL="postgresql://..." --encrypt
doctl apps config set <APP_ID> --env CRON_SECRET="$(openssl rand -hex 32)" --encrypt
```

## 5 · Verify

1. **Build logs** — both `web` and `ingest` should finish green. The ingest
   log will start printing lines like:
   ```
   [2026-04-16 13:26:35] ingest ok — markets=8/10 rows=10+282 in 3403ms
   ```
2. **App URL** — open it, `/` should render live LKR data within a few
   seconds.
3. **Supabase** — in the SQL editor, run:
   ```sql
   SELECT count(*) FROM market_snapshots;
   SELECT count(*) FROM merchant_snapshots;
   ```
   Both should grow every 5 minutes.
4. **Historical / Risk / Liquidity / Reports → Recap** — these need a few
   ticks of data before they leave the empty state. Ten minutes after
   deploy they'll start filling in.

## 6 · Custom domain (optional)

- **Your app → Settings → Domains → Add Domain**.
- Point your domain's DNS at the `CNAME` DO gives you.
- DO issues a free Let's Encrypt cert automatically.

## Common gotchas

- **Worker crashing with "DATABASE_URL is not set"** — App-level envs weren't
  saved, or they're scoped to the wrong environment. In the dashboard,
  expand the var row and confirm **Scope: Run Time** on both.
- **Build fails on `tsx: command not found`** — `tsx` is intentionally a
  runtime dependency. If you see this, the worker's `build_command` ran
  `npm install --production` somehow; ensure the spec's build command is
  `npm ci` (which installs all deps).
- **Transaction pooler errors about prepared statements** — double-check
  the URL uses port **6543**, not 5432, and that you haven't swapped
  `prepare: false` out of `lib/db/client.ts`.
- **Ingest errors on Binance 429** — public feed throttling. The worker
  swallows per-market errors and retries on the next tick; no action
  needed unless it persists.

## Costs, ballpark

- `basic-xs` web (1GB RAM): **$12/mo**
- `basic-xxs` worker (512MB): **$5/mo**
- Supabase free tier covers the DB until you exceed 500MB or 2 GB egress.

Under $20/mo for a comfortably running production instance.
