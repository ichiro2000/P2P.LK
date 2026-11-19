# FX rate sources (`/rates`)

All numbers on `/rates` come from the institutions' own public pages, fetched by
`lib/fx/collect.ts`. Nothing is taken from aggregators (numbers.lk or similar).

Collector rules:
- One request per source per run. Runs every 3 hours (UTC minute 17 of hours divisible by 3).
- User-Agent: `Mozilla/5.0 (compatible; P2P.LK rates collector)`. It names no person or email. Some bank WAFs reject UAs that don't start with `Mozilla/5.0`; the plain `P2P.LK rates collector` got a 403 from CBSL.
- Requests to the same host are spaced 11 s apart, which honours CBSL's `Crawl-delay: 10`.
- Strict parsing. Every source checks its table header. Every value must fall inside a per-currency plausibility band (USD 150 to 600 LKR, other currencies 0.5x to 2x a reference). A buy above its sell, or a spread over 20 %, is rejected. A run that yields no USD row fails.
- Each source logs to `ingest_runs` (job `fx`, exchange = source id).

Reviewed 2026-11-19.

| Source | URL fetched | Format | Allowed? | Reason | Parser |
|---|---|---|---|---|---|
| CBSL indicative | `POST https://www.cbsl.gov.lk/cbsl_custom/exrates/exrates_results.php` (the public "Indicative Exchange Rates Search" form) | HTML tables, one per currency, date range | **Yes** | Official public statistics. robots.txt allows `/cbsl_custom/` (`Crawl-delay: 10`). The site has a privacy policy only, with no terms restricting reuse. Attributed on the page. | ✅ `cbsl`: 25 currencies. The first run backfills 1 year; later runs fetch the last 7 days. |
| CBSL average TT buy/sell | `POST https://www.cbsl.gov.lk/cbsl_custom/exratestt/exrates_resultstt.php` | HTML tables (9 currencies) | **Yes** | Same as above | ✅ `cbsl_tt` |
| CBSL quick charts | `/cbsl_custom/charts/<cur>/oneweek.php` | TSV | Yes | Same as above | Not used. The search forms above cover more currencies in a single request. |
| Commercial Bank | `https://www.combank.lk/rates-tariff` | HTML table (`#exchange-rates` tab) | **Unclear, public** | robots.txt returns 403 to every client, so no rules are published. The legal notice is a liability disclaimer only, with no ban on automated access or reuse. | ✅ `combank`: notes and TT, page date |
| Sampath Bank | `https://www.sampath.lk/api/exchange-rates` (the JSON their rates page loads) | JSON | **Unclear, public** | robots.txt is 404. The terms pages cover banking products only. | ✅ `sampath`: TT, `RateWEF` date |
| HNB | `https://venus.hnb.lk/api/get_rates_contents_web` (the JSON hnb.lk loads) | JSON | **Unclear, public** | www.hnb.lk robots allows all. The venus host has no robots file. No website terms found. hnb.lk labels these columns as "Telegraphic Transfer Buying/Selling Rate". | ✅ `hnb`: TT, `updated_on` date |
| People's Bank | `https://www.peoplesbank.lk/exchange-rates/` | HTML table | **Unclear, public** | robots disallows `/wp-admin/` only. The terms page covers account and card T&Cs, with no website-use clause. | ✅ `peoples`: notes and TT |
| NDB Bank | `https://www.ndbbank.com/rates/exchange-rates` | HTML table | **Unclear, public** | robots.txt is 404. A privacy notice exists, but no website terms. | ✅ `ndb`: notes and TT, "Last Updated On" date |
| Nations Trust Bank | `https://www.nationstrust.com/exchange-rates` | HTML table | **Yes** | robots.txt is explicitly `Allow: /` for all agents, AI crawlers included. The terms page has no website-use restrictions. | ✅ `ntb`: notes and TT, "as at" date |
| DFCC Bank | `https://www.dfcc.lk/rates-and-tariff/exchange-rates` | HTML table (server-rendered) | **Unclear, public** | robots allows all except `/public/assets/`. No website-use restrictions found. | ✅ `dfcc`: notes and TT. "DD / TT Selling" is stored as TT selling. |
| Amãna Bank | `https://www.amanabank.lk/business/treasury/exchange-rates.html` | HTML table | **Unclear, public** | robots disallows `*.php` only, and this page is `.html`. No website terms page (404). | ✅ `amana`. The page has one "Bank Buying/Selling" pair, which we file as TT (approximate), plus notes selling. |
| Bank of Ceylon | `https://www.boc.lk/rates-tariff` | HTML table | **No** | The BOC Terms of Use say: "you will not access the Web Site through automated or non-human means, whether through a bot, script, or otherwise". Content may not be "stored for subsequent use" without written consent. | ⛔ skipped |
| Seylan Bank | `https://www.seylan.lk/exchange-rates` | HTML table | **No** | The disclaimer says no content "may be used other than as part of this Website, reproduced, transmitted, distributed". | ⛔ skipped |
| Pan Asia Bank | `https://www.pabcbank.com/rates/exchange-rates/` | Behind a Sucuri JS challenge | **No (bot wall)** | The challenge is not ours to bypass | ⛔ skipped |
| Union Bank | `https://www.unionb.com/` | Behind an Incapsula challenge | **No (bot wall)** | Same as above | ⛔ skipped |
| NSB | `https://www.nsb.lk/rates-tarriffs/exchange-rates/` | 403 to non-browser clients | **No (blocked)** | The server refuses automated clients | ⛔ skipped |
| Sanasa Development Bank | `https://www.sdb.lk/` | robots.txt 403 | Unclear | Blocked at the WAF. No FX page found. | ⛔ skipped |
| Cargills Bank | `https://www.cargillsbank.com/rates-and-charges/exchange-rates/` | WordPress admin-ajax JSON, needs a page nonce | Unclear, public | Needs 2 requests per run (page, then ajax), which breaks the one-request rule | ⏸ not built |
| HSBC Sri Lanka | `https://www.business.hsbc.lk/en-gb/regulations/daily-exchange-rates` | Daily PDF ("board rates") | Yes (robots `Allow: /`) | PDF only. It needs 2 requests (index, then PDF) and a PDF parser on Workers. | ⏸ not built |
| Standard Chartered LK | `https://www.sc.com/lk/` | — | — | No retail rates page. SC's retail clients are moving to DFCC. | ⛔ n/a |
| HDFC Bank (SL) | `https://www.hdfc.lk/` | — | — | Housing bank. It publishes no FX rates. | ⛔ n/a |

## Rate types stored (`fx_rates.rate_type`)
- `indicative`: CBSL only. This is the weighted average of interbank spot deals (USD), or a cross rate for other currencies.
- `tt_buy` / `tt_sell`: telegraphic transfer buying and selling (remittances, FCY account transfers). For `cbsl_tt` it is the average of the selected banks' 9:30 AM quotes.
- `cash_buy` / `cash_sell`: currency notes.
- Draft and cheque rates are published by most banks but **not stored**, to keep the table small.

## Approximations
- Offshore yuan (CNH, quoted by NDB) is stored as CNY.
- Amãna's "Bank Buying/Selling" is filed as TT.
- When a bank page has no machine-readable date, `as_of` is the Sri Lanka date at fetch time.
- The P2P premium uses daily averages from `market_hourly` and carries the CBSL rate forward over weekends.

## Google Finance — USD/LKR mid-market (added 2026-11-20)

| Field | Value |
|---|---|
| Page | https://www.google.com/finance/quote/USD-LKR |
| What | Interbank mid-market USD→LKR (the rate Google Search shows) |
| Cadence | Every 30 min (cron at :03 and :33 UTC), one request per run |
| Format | HTML; we read only the embedded data entry labelled `"USD / LKR"` (price + previous close). The visible price spans are *not* used — the page also lists related instruments with the same markup. |
| robots.txt | `User-agent: *` disallows `/search` but has no rule for `/finance/quote/*` (checked 2026-11-19), so this page is allowed; Google Search results are **not** used. |
| Stored | `fx_intraday` (every reading, 180 days) + `fx_rates` source `google`, type `mid` (daily close) |
| Code | `lib/fx/google.ts` (parser + collector), `lib/fx/google-view.ts` (premium vs USDT), job `fx_google` in `ingest_runs` |
| Sanity | value must be 150–600; multiple labelled entries must agree within 0.5 % |
