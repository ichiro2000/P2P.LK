# P2P.LK security review (Phase 8)

Date: 2026-11-19. Scope: the whole server side of `p2p.lk/` (Next 16 App Router on Cloudflare Workers through OpenNext, D1/drizzle, KV, Workers Rate Limiting, Better Auth 1.7.17, Resend, the cron in `worker.ts`).

How it was tested:
- I read the code: auth, guards, every `app/api/**` route, the admin pages, outbound fetches, email, the cron, flags, headers and config.
- I tested live with curl against the local dev server (`http://localhost:3000`), using throwaway `@sec.test` accounts. Those accounts, their sessions, rules, items and `audit_log` rows, the test report and the removal request were all deleted from local D1 afterwards.
- Nothing remote was touched.

## Summary

| Severity | Count | Fixed | Proposed |
|---|---|---|---|
| Critical | 1 | 1 | 0 |
| High | 0 | 0 | 0 |
| Medium | 6 | 6 | 0 |
| Low | 9 | 6 | 3 |
| Info | 10 | – | some notes |

Every fix is server-side and minimal. `npx tsc --noEmit` is clean for every file I edited. The only errors left are in `lib/guard.test.ts` (TS18046, `body` is `unknown`), which belongs to the unit-test agent. `npx eslint` passes on every file I edited.

---

## Critical

### C1. An unauthenticated RSC request could read the admin pages (audit log, registry queue). Fixed

- **Where:** `app/(app)/admin/audit/page.tsx:20`, `app/(app)/admin/registry/page.tsx:18`, `app/(app)/admin/removals/page.tsx:13`. These three pages had no check of their own and relied on `app/(app)/admin/layout.tsx`.
- **Why it happens:** With the App Router, a client navigation renders only the segments below the deepest layout the client says it already has. The client says this in the `Next-Router-State-Tree` header, and that header is attacker-controlled. If the client claims to already have the `/admin` layout (for example, by claiming it is on `/admin/members`), Next renders only the page segment. `requireAdminPage()` in the layout never runs.
- **Exploit (reproduced):** With no cookies at all, the attacker sends:

  ```
  GET /admin/audit
  RSC: 1
  Next-Router-State-Tree: ["",{"children":["(app)",{"children":["admin",{"children":["members",{"children":["__PAGE__",{}]}]}]}]}]
  ```

  They follow the `_rsc` redirect and get HTTP 200 with the full audit-log page as an RSC payload: every `member.*` and `registry.*` action and every member email. `/admin/registry` leaks the moderation queue in the same way (pending reports, submitter name and email). `/admin/removals` leaks its page shell.
- **Fix:** Each of the three pages now calls `await requireAdminPage()` itself. `members`, `system` and `/admin` already did this. Re-tested the same request:
  - Guest: `NEXT_REDIRECT → /sign-in`.
  - Member: `404`.
  - Admin: unchanged.
- **Rule going forward:** Never rely on a layout for authorisation. Every page, route handler and server action that reads private data must check access itself.

---

## Medium

### M1. Password-reset Turnstile bypass, reset-email flooding, and a password-less OTP sign-in endpoint. Fixed

- **Where:** `lib/auth/config.ts:72` (`DISABLED_PATHS`) and `:115` (`hooks.before`).
- **Problem:** The `emailOTP` plugin exposes more endpoints than the app uses, and none of the extras had Turnstile. The app uses only `/forget-password/email-otp`, which does have Turnstile.
  - `POST /api/auth/email-otp/request-password-reset {"email":…}` returned 200 and sent a reset code. No captcha, default limit of 60/min.
  - `POST /api/auth/email-otp/send-verification-otp {"type":"forget-password"}` did the same.
  - `POST /api/auth/sign-in/email-otp` was live. It is a password-less sign-in that skips Turnstile and the password, and it also auto-creates accounts. The OTPs are never mailed, so brute force is impractical, but the endpoint had no reason to exist.
  - `/send-verification-email` was also open, at 60/min.
  - **Exploit:** Flood any member's inbox with reset codes from many IPs, bypassing the human check.
- **Fix:**
  - Unused endpoints now return 404 through `disabledPaths`: `/sign-in/email-otp`, `/email-otp/request-password-reset`, `/email-otp/check-verification-otp`, `/email-otp/request-email-change`, `/email-otp/change-email`, `/send-verification-email`, `/verify-email`, `/request-password-reset`, `/reset-password`, `/change-email`, `/delete-user`.
  - `/email-otp/send-verification-otp` now accepts only `type: "email-verification"`. Any other type gets 400.
  - Re-tested: all of the above return 404 or 400. Sign-up, verify, sign-in and forgot-password with captcha all still work.

### M2. Sign-up revealed whether an email is registered. Fixed

- **Where:** `lib/auth/config.ts:48` (`checkSignUpFields`) and `:115`.
- **Problem:** For an existing email, Better Auth returns a fake success without running `databaseHooks.user.create.before`. So:
  - An invalid WhatsApp number gave **400 for a new email** but **200 for an existing one**.
  - The fake response echoed the raw input (`"whatsapp":"0771234567"`), while a real sign-up returned it normalised (`+94771234567`).
  - Both differences are enumeration oracles, one request each.
- **Fix:**
  - Field validation (and the "sign-ups paused" check) now also runs in a `/sign-up/email` before-hook, so new and existing emails get the same errors.
  - An after-hook replaces the success body with `{token:null,user:null}`. The client only checks for `error`.
  - The create hook also forces `image: null`, so sign-up can't set it.
  - Re-tested: bad WhatsApp gives 400 for both. Valid input gives an identical `{"token":null,"user":null}` for both.
- **Other paths checked:**
  - Sign-in gives the same `INVALID_EMAIL_OR_PASSWORD` for an unknown email and a wrong password.
  - Forgot-password returns `success` for unknown emails.

### M3. The public registry exposed account IDs and moderators' internal notes. Fixed

- **Where:** `lib/db/suspicious.ts:15` (`publicColumns`). The leak reached readers through `GET /api/suspicious`, `GET /api/suspicious/check`, and the RSC payloads of `/suspicious` and `/suspicious/[id]`.
- **Problem:** `listSuspicious` and `reportsForUser` used `select()`, which returns every column:
  - `submittedBy`: the member's user ID.
  - `reviewedBy`: the admin's user ID.
  - `reviewedTs`.
  - `reviewNote`: the moderator's internal note.

  Anyone could link all reports to the same submitting account and read moderation notes. This was reproduced: the note "internal: …" showed up in the public JSON and in the page HTML.
- **Fix:** Both queries now select only public columns: `id, exchange, ts, userId, profileUrl, displayName, reason, notes, reporter, status`. The `SuspiciousReport` type is narrowed to match, and `addReport` still returns the full row to the submitter. Re-tested: none of these fields appear in the API or the page payload.
- **Privacy check:** Members' WhatsApp numbers and emails are not exposed anywhere outside admin pages (and those pages are now properly guarded, see C1).

### M4. IP rate limits could be bypassed by rotating IPv6 addresses, and `x-forwarded-for` was trusted. Fixed

- **Where:** `lib/guard.ts:25` (`rawClientIp`) and `:38` (`ipKey`).
- **Problem 1, IPv6:** The Workers Rate Limiting key was the full client address. Any IPv6 user controls at least a /64 (2^64 addresses).
  - Reproduced: 12 QR checks from `2001:db8:1:2::1…12` all returned 200, where the limit is 10 per minute.
  - The exposed endpoints are public: the QR check and lookup (outbound Binance calls and Browser Rendering), removal requests, and the read APIs.
- **Problem 2, `x-forwarded-for`:** It was used as a fallback. On Cloudflare `cf-connecting-ip` is always set by the edge, so this wasn't exploitable in production, but it was trusted everywhere.
- **Fix:**
  - IPv6 is now keyed by its /64 (IPv4-mapped addresses become IPv4). This is the same rule Better Auth's own limiter uses.
  - `x-forwarded-for` is read only under `next dev`.
  - Turnstile still receives the real address as `remoteip`.
  - Re-tested: 12 requests from one /64 now give `200×10, 429×2`.
- **Note:** Better Auth's limiter already keys on `cf-connecting-ip` with a /64 IPv6 subnet.

### M5. The 16 KB JSON body cap could be bypassed with a chunked request. Fixed

- **Where:** `lib/guard.ts:110` (`readBodyText`), used by `readJson`. The same fix is applied in `app/api/me/import/route.ts:72`.
- **Problem:** The cap only looked at `Content-Length`, and a `Transfer-Encoding: chunked` request has none. `req.json()` then buffered and parsed the whole body.
  - Reproduced: a 2 MB chunked body was fully parsed by the public `POST /api/suspicious/removal-requests` (the response was a zod 400, not a 413).
  - At Cloudflare's 100 MB request limit, this is a cheap way to push the isolate past its 128 MB memory limit.
  - `/api/me/import` had the same problem with `req.text()`.
- **Fix:** The body is now read from the stream and the read stops past the limit (413). Re-tested: the chunked 2 MB request now gets 413, and normal bodies are unaffected.
- **Not changed:** Better Auth parses its own bodies. Cloudflare's request-size limit applies there.

### M6. Filtered market queries were an unthrottled amplifier against the Binance and Bybit APIs. Fixed (mitigated)

- **Where:** `lib/market-data.ts:57` (`liveBook`) and `lib/api.ts:29`.
- **Problem:** Any query that isn't one of the two unfiltered variants is fetched live from the exchange. That includes a pay-type filter, `transAmount`, or both.
  - With a different `transAmount` on every request, each of the 240 req/min per IP allowed by `RL_READ` became an upstream call. Pages that render filters on the server don't go through any limiter at all.
  - **Impact:** Binance or Bybit throttle or block Cloudflare's egress addresses, and the cron's data feed (and the site) goes dark.
- **Fix:**
  - Live books are now shared per query for 15 s, including while a request is in flight. This is a per-isolate map capped at 200 entries, and failures are not cached.
  - `transAmount` is rounded to 2 significant figures, which bounds the number of distinct keys. No UI sends it; only the raw API accepts it.
  - Re-tested: three requests with amounts 123457, 124999 and 119500 now share one upstream fetch.
- **Remaining (proposal):** The cache is per isolate. For a hard cap, add a global KV token bucket for upstream calls.

---

## Low

### L1. A revoked session kept working for up to 60 s. Fixed

- **Where:** `lib/auth/session.ts:57` (`withLiveStatus`).
- **Problem:** `cookieCache.maxAge = 60` means `getSession` trusts the signed `session_data` cookie without checking D1. Status and role were already re-read live, so a suspension took effect at once, but the session row itself wasn't checked.
  - Reproduced: after "sign out other devices" (or a password change with revoke), the revoked cookie still got 200 from `/api/me/rules`.
- **Fix:** The live re-read is now one indexed join on `session.token`, `user.id` and `expires_at > now`. It costs no extra query: the existing lookup was replaced. This covers pages (`getViewer`), member APIs and admin APIs.
  - Re-tested: the revoked cookie now gets 401 on the API and a redirect to sign-in on pages, at once.
  - Better Auth's own endpoints (`/api/auth/get-session`) still use the cache for up to 60 s. That is harmless.

### L2. Development fallbacks were used whenever `NODE_ENV` wasn't exactly "production". Fixed

- **Where:** `lib/auth/config.ts:98`.
- **Problem:** `DEV_SECRET` (in the repo) and the always-pass Turnstile secret were used whenever `NODE_ENV !== "production"`, for example if it was unset or set to "test" in some runtime. With a known secret, `session_data` and `session_token` cookies could be forged for any user ID, including an admin's.
- **Reality check:** OpenNext and Next inline `NODE_ENV="production"` at build time, so production is not affected today.
- **Fix:** The fallbacks now apply only when `NODE_ENV === "development"`. This matches `verifyTurnstile` and the `/api/dev/*` routes, which already used `!== "development"`.

### L3. Turnstile tokens weren't bound to our hostname. Fixed

- **Where:** `lib/auth/config.ts:331` (`allowedHostnames`) and `lib/guard.ts:204`.
- **Problem:** Neither the Better Auth captcha plugin nor `verifyTurnstile` checked `hostname` in the siteverify response.
- **Fix:** Outside development, the hostname must equal the hostname of `BETTER_AUTH_URL`. Cloudflare's test secret reports `example.com`, so development is exempt. If `BETTER_AUTH_URL` is unset, the check fails closed.
- **Not added:** An `action` check. The widget's `action` isn't set in the UI; that is a UI change, so it is proposed only.

### L4. The QR short-link resolver followed redirects blindly. Fixed

- **Where:** `lib/qr-resolve.ts:75` and `lib/qr-resolve-browser.ts:58`.
- **Problem 1:** `fetch(…, {redirect:"follow"})` checked only the first and final host. Any open redirect on a Binance host would make the Worker request arbitrary public URLs. `global_fetch_strictly_public` already blocks internal targets.
- **Problem 2:** The Browser Rendering allowlist used `endsWith("bnbstatic.com")` and `endsWith("awswaf.com")`, so `evilbnbstatic.com` passed.
- **Fix:** Redirects are now followed manually (up to 5 hops), and every hop must be http(s) on a Binance host. The CDN check now needs an exact domain or `.suffix` match. A smoke test with one request still resolves normally.

### L5. Marking 99 or more alert events as read failed with a 500. Fixed (live re-test pending)

- **Where:** `lib/member-data.ts:167`.
- **Problem:** `POST /api/me/events {ids:[…]}` accepts up to 500 IDs, but D1 allows only 100 bound parameters per statement. Reproduced: 99 IDs gave a 500.
- **Fix:** The update now runs in chunks of 90.
- **Not re-tested live:** The running dev server kept serving the old module even after the file changed. Its log still shows the single-statement query, while the compiled chunk on disk has the new code. Re-test after the next dev-server restart.

### L6. Member-API 401/403 responses had no `Cache-Control`. Fixed

- **Where:** `lib/auth/session.ts` (`memberFromRequest`).
- **Fix:** These responses are now `private, no-store`. Every success and error response from `/api/me/*` and the admin APIs now carries `no-store`.

### L7. A password reset before email verification leaves the account stuck. Fixed (coordinator)

- **Problem:** Better Auth's `/email-otp/reset-password` sets `emailVerified=true` (`better-auth/dist/plugins/email-otp/routes.mjs:584`). It doesn't call `afterEmailVerification`, so `status` stays `pending_email`. The user can no longer verify, and admins never see them.
- **Proposed fix:** Add a `hooks.after` on `/email-otp/reset-password` that runs the same `pending_email → pending_review` transition, or reject resets for `pending_email` accounts. Not changed because it is a product flow decision.

### L8. No script CSP. Proposed (see the CSP section)

- **Where:** `next.config.ts:14`.
- **Current state:** The CSP has only `frame-ancestors`, `object-src`, `base-uri` and `form-action`.
- **Mitigation today:** No XSS sink was found. React escapes output, the only `dangerouslySetInnerHTML` is `ChartStyle` and it takes no attacker input, and the banner is rendered as text. A script CSP would be defence in depth.

### L9. Reports publicly show the member's merchant name by default. Proposed (product decision)

- **Where:** `app/api/suspicious/route.ts:74`.
- **Problem:** `reporter: body.data.reporter ?? viewer.merchantName`. A member who leaves "Reporter" blank is publicly named as "by <their merchant name>" once the report is published. The person they reported can see that, which is a retaliation risk.
- **Proposal:** Default to no reporter (anonymous), or show a clear "shown publicly" hint in the form (`components/suspicious/add-report-form.tsx`, a UI change). Free-text `reporter` also lets one member post under another merchant's name. Moderation is the current control.

---

**Fix (follow-up):** a `user.update.after` hook in `lib/auth/config.ts` moves a verified `pending_email` account to `pending_review`; `afterEmailVerification` accepts either status so the normal verify path still sends the review emails and promotes `ADMIN_EMAILS`. Re-tested: normal sign-up, admin email, and reset-before-verify all end in the right status.

### L10. CSV formula injection in report exports. Fixed (coordinator)

Found by the unit-test pass. `lib/csv.ts#escapeCell` now prefixes text cells starting with `= + - @ tab CR` with an apostrophe (numbers untouched), so a merchant name like `=HYPERLINK(…)` can't run in a spreadsheet. Covered by `lib/csv.test.ts`.

## Info / verified OK

1. **Mass assignment:** OK. Tested at sign-up and through `update-user`.
   - `update-user` rejects `role`, `status` and `reviewNote` with `FIELD_NOT_ALLOWED`. `emailVerified` is ignored and email changes are refused.
   - At sign-up, `role` and `status` are forced by the create hook, and `reviewNote` is refused. `__proto__` and `constructor` have no effect.
2. **IDOR:** OK. Every `/api/me/*` query is scoped by `userId`, and member B can't patch or delete member A's rule (404 or no-op). Server action `revokeDeviceSession` looks tokens up by (session ID, user ID).
3. **Admin authorisation:** OK. Every admin API returns 403 for members.
   - Races: state transitions use a conditional `WHERE` (and a D1 batch for removal approvals), and the last admin can't be removed.
   - Suspension deletes sessions, and the session-create hook blocks sign-in.
4. **CSRF:** OK.
   - Better Auth refuses a bad or missing `Origin` and non-JSON bodies.
   - Our routes require `application/json`, which forces a CORS preflight, and DELETE/PATCH always preflight. With no CORS headers, cross-site calls fail.
   - Cookies are `HttpOnly; SameSite=Lax`, and `Secure` in production. Server actions get Next's origin check.
5. **SQL:** OK. There is no `sql.raw`. Every `sql` template binds parameters, and `LIKE` input is escaped.
6. **XSS:**
   - Email templates escape every interpolation. The banner and registry text render as React text.
   - `ChartStyle` keys and colours are static constants. No caller passes user data.
   - Subjects go through Resend's JSON API, so header injection isn't possible.
7. **`/api/dev/*`:** Dead in production. They check `NODE_ENV !== "development"`, which fails closed, and Next and OpenNext inline `"production"`. `readDevOutbox` and the KV outbox are also gated.
8. **Cache headers:** In dev, every page is `no-store`. Personalised pages read cookies, so Next marks them dynamic (`private, no-store`), and member ranges send `private, no-store`. **Check once after `cf:build`:** `curl -I` on `/app`, `/account` and `/admin` must not show `s-maxage`.
9. **Configuration:**
   - `BETTER_AUTH_URL` must be set to the public origin in production. Trusted origins, captcha hostnames and email links all depend on it, and without it they fail closed or point to localhost.
   - `wrangler.jsonc` `vars.NEXT_PUBLIC_SITE_URL` is still localhost.
   - `.dev.vars` is git-ignored and untracked, and `.dev.vars.example` holds no secrets.
   - `ADMIN_TOKEN` in `cloudflare-env.d.ts` is unused and can be deleted.
10. **Audit-log gaps (proposals):**
    - Not logged: admin creation through `ADMIN_EMAILS` in `afterEmailVerification`, password change and reset, session revocation, failed admin access, and public removal-request creation.
    - Admin-route audit writes are best-effort (`.catch`). Acceptable, but a failed write is only visible in logs.
    - Other notes:
      - The Browser Rendering KV lock (`lib/qr-resolve-browser.ts:43`) is eventually consistent, so two browsers can occasionally start at once. Cost only.
      - `errorResponse` returns the upstream error message as `detail`. Minor information.
      - The `session_data` cookie holds the user's email and WhatsApp number as signed, unencrypted base64. It is HttpOnly. Consider `session.cookieCache.strategy: "jwe"`.

---

## CSP: is a strict `script-src` feasible?

**Yes, with nonces, at the cost of making every HTML response dynamic.** Most pages already are (`force-dynamic` or cookie reads).

How it would work:
1. Add `proxy.ts` (Next 16's name for middleware; OpenNext Cloudflare supports it). It would generate a nonce per request and set it on the request (`x-nonce`) and on the response, with:

   ```
   default-src 'self'; script-src 'self' 'nonce-<n>' 'strict-dynamic' https://challenges.cloudflare.com;
   style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; font-src 'self';
   connect-src 'self'; frame-src https://challenges.cloudflare.com;
   frame-ancestors 'none'; object-src 'none'; base-uri 'self'; form-action 'self'
   ```

2. Next 16 reads the nonce from the request's CSP header and adds it to its own inline bootstrap and RSC scripts automatically.

What would break, or needs changing:
- **Static or ISR pages:** A nonce can't be baked in, so any prerendered page must become dynamic. That costs CPU per request and loses the KV incremental cache for those pages.
- **`next-themes`:** Its inline theme script needs the nonce (`<ThemeProvider nonce={nonce}>`), otherwise the dark-mode flash returns.
- **Turnstile:** Needs `challenges.cloudflare.com` in `script-src` and `frame-src`. `'strict-dynamic'` covers the scripts it loads.
- **Styles:** `ChartStyle` `<style>` tags and Recharts or Base UI inline `style=` attributes need `style-src 'unsafe-inline'`. Style nonces don't cover attributes. That is an acceptable residual risk.
- **QR decode:** Uses `blob:`/`data:` images (`img-src`). No workers or `eval` (jsQR), so no `'unsafe-eval'`. Dev mode needs `'unsafe-eval'` for React refresh, so set the CSP only in production.
- **Hash-based CSP** (`experimental.sri`) works only for fully static output, so it is not a fit.

Recommendation: ship it as `Content-Security-Policy-Report-Only` first, watch the reports, then enforce. This is proposed and not implemented, because it is a cross-cutting change that touches `app/layout.tsx` and the theme provider (UI) and would need a full `cf:build` test.

---

## Dependencies (`npm audit --omit=dev`)

Totals: 33 advisories (1 critical, 17 high, 14 moderate, 1 low). **None is reachable in the deployed Worker.**

| Package (severity) | Pulled in by | Reachable at runtime? |
|---|---|---|
| `proxy-addr` (critical), `body-parser`, `qs` | `@opennextjs/cloudflare` → `@opennextjs/aws` → `express` | No. The Express/Node adapter isn't used by the Workers runtime. |
| `zod <4.6.6` (high) | `shadcn` (CLI) → nested copy | No. The app uses `zod@4.6.7`. |
| `@modelcontextprotocol/sdk`, `hono`, `@hono/node-server`, `express-rate-limit`, `ip-address`, `ts-morph`, `minimatch`, `fast-uri` | `shadcn` CLI | No. Codegen tool only. |
| `@puppeteer/browsers`, `extract-zip`, `proxy-agent`, `pac-proxy-agent`, `get-uri`, `basic-ftp` | `@cloudflare/puppeteer` | No. The browser download and proxy code isn't used; `puppeteer.launch(env.BROWSER)` uses Browser Rendering. |
| `glob`, `brace-expansion`, `js-yaml`, `browserslist`, `postcss-selector-parser`, `baseline-browser-mapping`, `@babel/core`, `esbuild` (via `drizzle-kit`) | Build tooling | No. Build and dev only. |

Recommendations:
- Move `shadcn` (and `tsx`) from `dependencies` to `devDependencies`. This removes most of the noise from `--omit=dev`.
- Bump `@opennextjs/cloudflare` and `@cloudflare/puppeteer` when fixed versions ship.
- Not installed here, per instructions.

---

## Files changed by this review

- `app/(app)/admin/audit/page.tsx`, `app/(app)/admin/registry/page.tsx`, `app/(app)/admin/removals/page.tsx`: page-level `requireAdminPage()` (C1).
- `lib/auth/config.ts`: disabled paths, OTP type restriction, sign-up validation and response scrub, dev-only fallbacks, captcha hostname (M1, M2, L2, L3).
- `lib/auth/session.ts`: live session check, no-store on 401/403 (L1, L6).
- `lib/guard.ts`: IPv6 /64 keys, XFF only in dev, bounded body reader, Turnstile hostname (M4, M5, L3).
- `app/api/me/import/route.ts`: bounded body reader (M5).
- `lib/db/suspicious.ts`: public column projection (M3).
- `lib/market-data.ts`, `lib/api.ts`: live-book sharing, `transAmount` rounding (M6).
- `lib/qr-resolve.ts`, `lib/qr-resolve-browser.ts`: per-hop redirect checks, CDN suffix match (L4).
- `lib/member-data.ts`: chunked mark-read (L5).
