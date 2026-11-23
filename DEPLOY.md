# Deploying P2P.LK v2 to Cloudflare

> **Account:** "Products@ichirox.com's Account" (id `2372ef6475f1b8779e1e42f1e58e713b`),
> the owner's main account that also runs `planseat-io` and `weddingoffers`.
> Never use the invitation.lk Cloudflare account. Everything P2P.LK creates is
> named `p2p-lk…`; don't touch the other workers' resources.

**Status (2026-11-20): LIVE at https://p2p.lk.** Worker `p2p-lk`, D1
`p2p-lk` (`d49e2422-…`), KV `p2p-lk-live` / `p2p-lk-next-cache`, Turnstile
widget "P2P.LK sign-in and sign-up", secrets set, custom domains `p2p.lk` +
`www.p2p.lk` (www → apex 301), Email Sending onboarded for `p2p.lk`,
Binance relay on Vercel, `ADMIN_EMAILS` = hello@p2p.lk (admin since 2026-11-21). Still open:
a billing budget alert.

## Binance relay (required)

Binance's P2P API refuses every request from a Cloudflare Worker (HTTP 403,
any host). The worker therefore sends Binance calls through
`relay/binance-relay.ts`, deployed on Vercel (Hobby, region `sin1`
Singapore; Binance also blocks US addresses) at
`https://p2p-lk-binance-relay-sable.vercel.app`. Worker secrets
`BINANCE_RELAY_URL` + `BINANCE_RELAY_TOKEN`; Vercel env `RELAY_TOKEN` (same
value). Calls are batched (a whole book = one relay request), so it runs at
~150K requests/month, inside Vercel's free limits. Redeploy:
`cd relay && npx vercel@latest deploy --prod`. If the relay is down, Binance
pages show "Binance is not responding" and Bybit keeps working.

Everything below is a one-time setup, then `npm run cf:deploy` for each release.
Plan required: **Workers Paid ($5/mo)** (1-minute cron, Browser Rendering, CPU time).

## 0. What the owner provides

| Item | Used for |
|---|---|
| Cloudflare account access (new account) with `p2p.lk` added as a zone | Worker, D1, KV, DNS, Turnstile |
| Nameservers for `p2p.lk` changed at the .lk registrar | Domain + email sending |
| Admin email address(es) | `ADMIN_EMAILS` — these become admins once verified |
| Support email | Account page / emails |
| Terms + Privacy text | Linked from sign-up |

## 1. Log in and create resources

```bash
npx wrangler login                      # choose the NEW account
npx wrangler d1 create p2p-lk           # → copy database_id
npx wrangler kv namespace create LIVE   # → copy id
npx wrangler kv namespace create NEXT_INC_CACHE_KV
```

Put the IDs into `wrangler.jsonc` (`d1_databases[0].database_id`,
`kv_namespaces[*].id`). The `ratelimits` `namespace_id`s (1001/1002/1003) just
need to be unique integers within the account — keep them.

Set the production var in `wrangler.jsonc`:

```jsonc
"vars": { "NEXT_PUBLIC_SITE_URL": "https://p2p.lk" }
```

## 1a. Nameservers (owner, at the .lk registrar)

Set the nameservers for `p2p.lk` to **`ray.ns.cloudflare.com`** and
**`savanna.ns.cloudflare.com`** (it currently points at another Cloudflare
account's `salvador` / `hera`). Until then the zone is "pending": the custom
domains and Email Sending can't activate.

## 2. Turnstile

Cloudflare dashboard → Turnstile → add widget, hostname `p2p.lk` (managed
mode). Copy the **site key** (public) and **secret key**.

## 3. Secrets and settings

```bash
npx wrangler secret put BETTER_AUTH_SECRET     # openssl rand -base64 32
npx wrangler secret put TURNSTILE_SECRET_KEY
npx wrangler secret put BETTER_AUTH_URL        # https://p2p.lk
npx wrangler secret put EMAIL_FROM             # "P2P.LK <no-reply@p2p.lk>"
npx wrangler secret put ADMIN_EMAILS           # comma-separated
```

Push notification keys (VAPID) — generate **once**, see §9 before ever
changing them:

```bash
npx tsx scripts/gen-vapid.ts                   # prints a new key pair
npx wrangler secret put VAPID_PUBLIC_KEY
npx wrangler secret put VAPID_PRIVATE_KEY
npx wrangler secret put VAPID_SUBJECT          # mailto:alerts@p2p.lk
```

Store the key pair in the owner's password manager too. Losing the private
key is the same as rotating it.

`BETTER_AUTH_URL` **must** be the public origin: sign-in, Turnstile hostname
checks and email links all depend on it.

Build-time public values — create `.env.production` from `.env.example`:

```
NEXT_PUBLIC_SITE_URL=https://p2p.lk
NEXT_PUBLIC_TURNSTILE_SITE_KEY=<site key>
```

## 4. Database

```bash
npm run db:migrate:remote      # applies drizzle/0000…NNNN to the remote D1
```

History starts empty on deploy day (owner decision: no migration of the old
DigitalOcean data). The cron fills live data within a minute; CBSL back-fills
one year of USD/LKR on its first run.

## 5. Build and deploy

```bash
npm ci
npm test && npm run lint && npm run typecheck
npm run cf:deploy
```

Then attach the domain: Workers & Pages → `p2p-lk` → Settings → Domains &
Routes → add custom domain `p2p.lk` (and `www.p2p.lk` → redirect rule to
apex).

## 6. Email (Cloudflare Email Service)

Mail goes out through the `EMAIL` send_email binding (`wrangler.jsonc`) from
`EMAIL_FROM`. Once the zone is active: dashboard → Compute → Email Service →
Email Sending → **Onboard Domain** → `p2p.lk` → Activate (adds SPF, DKIM,
DMARC and `cf-bounce` MX records). Without it, production refuses to send
(sign-up shows an error) — by design.

Limits: 3,000 emails a month per account are included in Workers Paid, then
$0.35 per 1,000; the beta also has an account-wide daily quota (200/day at
setup). `lib/email/deliver.ts` counts our sends per month in KV and stops
alert emails at 1,800 and all email at 2,500, so P2P.LK alone can't cause an
email overage (alerts still arrive in the app and as push).

## 7. Post-deploy checks (10 minutes)

- [ ] `https://p2p.lk/api/auth/ok` → `{"ok":true}`
- [ ] Wait 2 minutes, then Admin → System: `book` runs for both exchanges are ✓,
      `alerts` ✓; at :03/:33 `fx_google` ✓; at :17 (every 3 h) `fx` ✓
- [ ] Home page shows live prices (not "Couldn't reach …")
- [ ] Sign up with an `ADMIN_EMAILS` address → verification email arrives →
      account is admin → `/admin` opens
- [ ] Sign up a test member → admin approves → approval email arrives
- [ ] Create an alert that fires → email arrives (max 1 per 10 min)
- [ ] Admin → System → Push notifications: VAPID "Configured"
- [ ] On an Android phone (Chrome): open p2p.lk → install → Alerts → Enable
      notifications → Send test → notification arrives. On an iPhone (iOS
      16.4+): Share → Add to Home Screen → open the app → Alerts → Enable →
      Send test
- [ ] `https://p2p.lk/sw.js` → `Cache-Control: no-cache`, `Service-Worker-Allowed: /`
- [ ] `/robots.txt`, `/sitemap.xml` load; submit the sitemap in Google Search
      Console (see `SEO.md`)
- [ ] Response headers include HSTS, CSP `frame-ancestors 'none'`
- [ ] Personalised pages (`/app`, `/api/me/*`) send `Cache-Control: private` /
      `no-store`

## 8. Operations

- **Feature flags** (Admin → System): pause sign-ups, alert emails, FX
  collection; site banner for maintenance notices.
- **Retention** runs nightly 02:00 SLT. Sizes are on Admin → Overview (D1 limit
  10 GB).
- **Rollback:** `npx wrangler rollback` (previous Worker version). Migrations
  are additive only, so code rollback is safe.
- **Logs:** `npx wrangler tail p2p-lk`, or Workers → Observability.
- Keep the old DigitalOcean apps running one week as a fallback, then shut down.

## 9. Push notifications (PWA) — why they keep working

P2P.LK is an installable web app (manifest + `public/sw.js`). Members turn on
notifications per device (Alerts or Account page); the alert cron pushes to
every device of a member whose rule fires, alongside the email. Owner rule:
**notifications must not "stop after a few days"**. These are the ways that
happens with web push, and the safeguard for each:

| Cause | Safeguard | Where | Test |
|---|---|---|---|
| A push arrives and no notification is shown ("silent push"). Chrome and Safari then revoke the subscription after a few of them. | The service worker **always** calls `showNotification` in `event.waitUntil`, with a fallback notification if parsing or the options fail. The server never sends data-only pushes. | `public/sw.js` (push handler) | `pwa.spec.ts` live test (notification shown); `deliver.test.ts` payload |
| The browser rotates or expires the subscription. | `pushsubscriptionchange` in the worker re-subscribes with the server's current key and posts old + new endpoint to `/api/push/rotate` (works without a session: the old endpoint is the proof). Chrome rarely fires that event, so the app also **self-heals on every open and focus**: it reads `pushManager.getSubscription()`, re-subscribes if it vanished, and re-registers it with the server. | `public/sw.js`, `lib/push/client.ts` (`syncPush`), `components/pwa/push-sync.tsx` | `client.test.ts` (heal decisions); `pwa.spec.ts` rotation test |
| The server lost the row (DB restore, a 410 cleanup of a stale copy). | The heal's POST is an upsert by endpoint, so the next app open re-creates it; `last_seen_at` is refreshed each time. | `/api/me/push/subscribe`, `lib/push/store.ts` | `pwa.spec.ts` subscribe → list |
| VAPID keys changed. Every subscription is bound to the public key, so all devices go silent. | Don't rotate (§3). If it must happen, the heal compares the subscription's `applicationServerKey` with the server key and re-subscribes, so each device recovers the next time it's opened. Devices never opened again stay silent; that is unavoidable. | `lib/push/client.ts` (`afterSync` → "rekey") | `client.test.ts` |
| The server deletes subscriptions too eagerly. | A subscription is deleted **only** on 404/410 from the push service. 429 and 5xx: kept, `failure_count` + 1, backoff 1, 2, 4… min capped at **1 h** (or the service's `Retry-After`), retried on the next alert. Network errors and timeouts: same. 413: retried once with a minimal payload, kept. 401/403: VAPID problem, kept with no backoff, logged loudly. | `lib/push/send.ts` (`classifyStatus`), `lib/push/deliver.ts` (`changeFor`) | `send.test.ts` (every status), `deliver.test.ts`, `pwa.spec.ts` 410 / 429 / 503 against the dev push sink |
| A broken VAPID config goes unnoticed. | Every send is logged to `ingest_runs` (job `push`); a 401/403 or missing keys writes "VAPID REJECTED / NOT CONFIGURED" there and to the Worker log. Admin → System → Push notifications shows VAPID status, devices, delivered / failed in 24 h, failing devices and the last error. | `lib/push/deliver.ts`, `lib/push/health.ts` | `deliver.test.ts` (summary) |
| Signing out or a session expiring kills push. | Subscriptions belong to the **user**, not the session. Session expiry leaves them alone. An explicit sign-out on a device removes that device only. | `components/auth/sign-out-button.tsx`, `components/account/sessions-list.tsx` | manual |
| A removed device brings itself back. | Removing a device (or turning it off) writes a tombstone (SHA-256 of the endpoint, kept 90 days); the background heal never revives it. Pressing "Enable" does. | `push_tombstones`, `lib/push/store.ts` | `pwa.spec.ts` removed-device test |
| A stale service worker keeps old handlers. | `sw.js` is served `Cache-Control: no-cache` (`next.config.ts` and `public/_headers` for Cloudflare static assets), registered with `updateViaCache: "none"`; it calls `skipWaiting` + `clients.claim`, and the push / click handlers are always in the file. Bump `VERSION` when editing it. | `public/sw.js`, `public/_headers` | `pwa.spec.ts` headers + offline test |
| Old alerts flood in after a phone was off for days. | `TTL: 3600` (alerts older than 1 h are dropped by the push service), `Urgency: high`, `Topic: alerts` so queued alerts collapse into the latest one. | `lib/push/deliver.ts` | `send.test.ts` (headers) |
| Install/permission quirks on iPhone. | iOS (16.4+) only allows push in a Home Screen app, after a tap. The Alerts card explains this and offers "Enable" only in the installed app; in Safari it shows the Add to Home Screen steps. | `components/pwa/*` | manual |

Other notes:

- Payload is small (title, body, a same-origin path, a tag) with no account
  data; the worker only opens same-origin URLs from it.
- The SW never caches pages or `/api/*`: only `offline.html` and icons.
- Members can have up to 10 devices; the list shows the last delivery and
  failures per device, with "Test" and "Remove".
- Endpoints are accepted only from known push services (FCM, Mozilla,
  Windows, Apple); a new browser vendor's host goes in
  `lib/push/subscription.ts`.

## Reference: environment

| Name | Where | Required in prod |
|---|---|---|
| `BETTER_AUTH_SECRET` | secret | yes |
| `BETTER_AUTH_URL` | secret/var | yes (`https://p2p.lk`) |
| `TURNSTILE_SECRET_KEY` | secret | yes (server refuses to start auth without it) |
| `RESEND_API_KEY`, `EMAIL_FROM` | secret | yes for email |
| `ADMIN_EMAILS` | secret/var | yes (at least one) |
| `NEXT_PUBLIC_SITE_URL` | var + `.env.production` | yes |
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | `.env.production` (build) | yes |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | secret | yes for push (generate once; never rotate casually) |

Bindings (`wrangler.jsonc`): `DB` (D1), `LIVE` + `NEXT_INC_CACHE_KV` (KV),
`BROWSER` (Browser Rendering, QR short-links), `RL_READ` / `RL_WRITE` /
`RL_ADMIN` (rate limits), `WORKER_SELF_REFERENCE`, cron `* * * * *`.

## 10. Staying inside the $5 Workers Paid plan

Workers Paid ($5/month) includes, **per account** (shared with planseat-io
and weddingoffers): 10M requests, 30M CPU-ms, D1 25B rows read / 50M rows
written / 5 GB, KV 10M reads / 1M writes, 3,000 emails. Measured P2P.LK load:

| What | Per tick | Per month |
|---|---|---|
| D1 rows written, book tick (every minute) | ~17 | ~0.7M |
| D1 rows written, sweep + rollup (every 10 min) | ~2,000–3,200 | ~9–14M |
| D1 retention deletes (nightly) | | ~4M |
| KV writes (live books, 4 per minute) | 4 | ~175K |
| Cron invocations | 1 | ~43K |

That is roughly 15–19M of the 50M included D1 writes. What keeps it there:
the merchant sweep runs every 10 minutes (not 5), the hourly rollup only
recomputes the open hour, and every write path is bounded. Cloudflare has no
hard spend cap, so also add a budget alert (Billing → Billing notifications /
Email Sending → Add Budget Alert) at $1 of usage-based charges.
