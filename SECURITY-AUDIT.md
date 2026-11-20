# P2P.LK security audit — 2026-11-20

Scope: Cloudflare zone `p2p.lk` (SSL/TLS, DNS, security settings), the
`p2p-lk` Worker (bindings, secrets, rate limits, Turnstile, email), the app
source (auth, admin, API routes, input handling, headers), the web-push
system and the Vercel Binance relay. Method: source review by three
independent reviewers (auth/authorization; input handling; push, relay,
secrets, headers, cost abuse), each finding verified against the code
before fixing, plus read-only checks of the live zone configuration. No
attack traffic was sent to the live site.

## Fixed

| # | Area | Issue | Fix |
|---|---|---|---|
| 1 | Zone | `http://p2p.lk` served pages over plain HTTP (no redirect) | Always Use HTTPS on (301 to https) |
| 2 | Zone | TLS 1.0 / 1.1 accepted | Minimum TLS 1.2 (1.3 on) |
| 3 | Zone | DNSSEC off | Enabled in Cloudflare; **owner must add the DS record at the .lk registrar** (below) |
| 4 | Cost abuse | Public QR check could launch the paid headless browser repeatedly (~24 browser-hours/day from one IP) | Browser only for well-formed `/qr/<code>` links; 40 launches/day site-wide; failed lookups cached 1 h (`lib/qr-resolve*.ts`) |
| 5 | Cost abuse / email | "Resend code" endpoint (no captcha) could burn the email allowance and flood a member's inbox | Max 8 code emails per address per day; no codes to already-verified accounts (`lib/auth/config.ts`) |
| 6 | Cost abuse | Every `/api/auth/*` request wrote a D1 row (Better Auth DB rate limiter), 2,000/min per IP allowed on `/get-session` | Cloudflare rate-limit bindings in front of all auth routes (tight on sign-in/up/codes), Better Auth limiter in memory in production (`app/api/auth/[...all]/route.ts`) |
| 7 | Cost abuse | Flagged-taker pages called the Binance relay on every view | Profile lookups cached 6 h (30 min when not found) |
| 8 | Cost abuse | Filtered (live) market queries shared the loose read limit | Live queries limited to 10/min per IP (`app/api/p2p/market`) |
| 9 | XSS (defence in depth) | QR content with a `javascript:` scheme could be stored and rendered as a link on the public registry (React 19 neutralised it, nothing else did) | Only web URLs stored, canonicalised to https; all user/QR links rendered through `safeHttpsUrl` |
| 10 | Headers | No script restrictions in the CSP | Production CSP: scripts, connections and frames only from p2p.lk, Cloudflare Turnstile and Cloudflare Web Analytics; `upgrade-insecure-requests` |
| 11 | Headers | Static files (`/offline.html`, icons…) served without security headers | `/*` block in `public/_headers` |
| 12 | Hardening | Service worker accepted `//host` notification paths | Rejected |
| 13 | Hardening | Relay followed redirects and had no response cap | `redirect: "manual"`, 1 MB cap |
| 14 | Hardening | QR resolver's first hop skipped the scheme/port check | Same check as every redirect hop |
| 15 | Hardening | Email dev-outbox switch keyed on `NODE_ENV !== "production"` | Only `=== "development"` |
| 16 | Hardening | Email subjects could carry newlines from member names | Stripped centrally |
| 17 | Hardening | CSV formula escaping missed leading spaces | `^\s*[=+\-@]` |
| 18 | Hardening | A bad `%` in a taker URL gave a 500 | Safe decode |
| 19 | Hardening | `isMember` allowed a non-approved admin row; `image` accepted on profile update | Approved only; `image` dropped |

Regression tests: `lib/safe-url.test.ts`, `lib/exchanges/binance-http.test.ts`,
`lib/email/deliver.test.ts`.

## Checked and clean

- Admin pages/APIs re-read role and status from D1 on every request; no
  route reachable by non-admins. Member data always scoped to the session
  user (no IDOR). Role/status can't be set by users; email change disabled.
- OTP: 6 digits, 10 min, hashed, 5 attempts; Turnstile on sign-up, sign-in
  and password reset; same response for new and existing emails.
- CSRF: Better Auth origin check; custom mutations require JSON content
  type; no state-changing GETs. Open redirect: `safe-next` blocks `//`,
  `/\`, other origins.
- SQL: all `sql.raw` uses constants or typed numbers; LIKE escaped.
- SSRF: QR resolver and Browser Rendering restricted to Binance hosts at
  every hop; push endpoints allowlisted to known push services;
  `global_fetch_strictly_public` on.
- Secrets: none in the repo or client bundles; dev routes 404 in production.
- Relay: constant-time token check, Binance `/bapi/` allowlist only.

## Remaining / owner actions

1. **DNSSEC** — at the .lk registrar, add this DS record for `p2p.lk`:
   Key tag `2371`, Algorithm `13` (ECDSA P-256), Digest type `2` (SHA-256),
   Digest `6A49683DF92D03E315868D5EC5E384624D68CA22D48709DD9122011EB80FC205`.
2. **Billing alert** — Cloudflare has no hard spend cap; add a $1
   usage-based billing notification (Billing → Notifications).
3. **Certificate Transparency monitoring** (SSL/TLS → Edge Certificates):
   optional email when any CA issues a p2p.lk certificate.
4. **Accepted risk:** `/api/push/rotate` moves a subscription for anyone who
   knows its endpoint URL. Endpoints are secret capability URLs never
   returned by the API; impact is limited to market-alert notifications.
5. **Future:** nonce-based script CSP (drop `'unsafe-inline'`); SSR pages
   with a payment filter rely on the per-isolate 15 s cache rather than a
   per-IP limit.
6. Bot Fight Mode left off on purpose: on the free plan it can't be
   tuned and may challenge the PWA's background requests.
