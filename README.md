# Value — Markets Overview

A free, installable dashboard for what is going on economically right now:
currencies, precious metals, crypto, equities and a handful of macro indicators.

**Data is delayed.** This is an overview tool, not a trading terminal, and every
number on screen carries the timestamp it was actually true at.

---

## Status

Complete and deployable to GitHub Pages. **Every category runs with no API keys
at all** — 85 priced assets and 6 macro series, from five keyless sources.

| Step | State |
|---|---|
| 1. Schema + seed for the asset universe | done |
| 2. Frankfurter FX end to end | done |
| 3. Overview page from cache | done |
| 4. PWA shell — manifest, icons, service worker, offline, install hints | done |
| 5. All providers — FX, metals, crypto, equities, macro | done, all keyless |
| 6. Converter | done |
| 7. Charts + detail pages | done |
| 8. Favourites + shareable watchlist link | done |
| 9. Design pass | done for the surfaces that exist |

### What is live

| Category | Count | Source | Key |
|---|---|---|---|
| Currencies | 12 | Frankfurter (ECB) | none |
| Metals | 4 | gold-api | none |
| Crypto | 50 | CoinGecko | none |
| Equities | 19 | Nasdaq | none |
| Macro | 6 series, 32,283 observations | FRED | none |

### The app

- **Overview** — top movers, favourites, then one section per category. Every row
  carries a sparkline, a signed change with an arrow, and a staleness badge.
- **Asset detail** — 7D / 1M / 3M / 1Y / Max, with a hover readout. FX Max is the
  full ECB series back to 1999: 7,083 daily closes.
- **Convert** — any-to-any across everything priced, metals in troy ounces and
  grams, inverse rate and rate date shown.
- **Search** — fuzzy on symbol and name, `/` to focus on desktop.

### Weight

| | raw | gzipped |
|---|---|---|
| JS | 39.4 KB | 14.6 KB |
| CSS | 11.3 KB | 3.1 KB |
| Font (Inter, latin subset, self-hosted) | 48.3 KB | — |
| `latest.json` (85 assets + macro) | 63 KB | 10.1 KB |

Against a 100 KB budget for the overview route. Preact rather than React, and
charts are hand-drawn SVG — a charting library would have cost more than the
whole application does.

## Deploying to GitHub Pages

`.github/workflows/deploy.yml` builds and deploys on every push to `main`,
including the data-only commits the ingest workflow makes. To turn it on:

1. **Settings → Pages → Source: GitHub Actions.**
2. Push to `main`. The site lands at `https://<user>.github.io/<repo>/`.

`VITE_BASE` is derived from the repository name, so a fork or a rename needs no
edit. For a custom domain or a `<user>.github.io` repo, set `VITE_BASE: /`.

`npm run verify` guards the things that break a PWA under a project-page path and
produce no visible error: an asset URL outside the base, a `./`-relative URL that
works at the root and 404s on every deep link, a manifest `start_url` outside its
`scope`, a missing maskable icon, a missing SPA fallback, or a service worker
precaching a path that does not exist. It runs in CI before deploy.

### PWA notes

- `404.html` is a copy of `index.html`. Pages has no rewrite rules, so this is
  what makes a refresh on `/a/fx-eur` load the app instead of a 404 page.
- The service worker precaches the shell and serves `data/*.json`
  stale-while-revalidate. Offline shows the last known values behind an
  "Offline — showing data from …" bar, never a browser error page.
- iOS has no install prompt API, so a dismissible sheet explains Share → Add to
  Home Screen. Android and desktop get a header button driven by
  `beforeinstallprompt`. There is no Background Sync anywhere — iOS does not
  support it — so data refreshes on launch and on `visibilitychange`.
- Verified end to end under a simulated Pages subpath: deep links, service worker
  scope, precache, and offline rendering.

## Favourites without accounts

One `localStorage` key, `value.favorites`. No auth, no database, nothing to breach.

Two consequences of having no server, both solved by the shareable link rather
than by adding accounts:

- On iOS an installed PWA gets a storage partition **entirely separate from
  Safari's**, so a watchlist built while browsing does not follow the user into
  the installed app. This is why the install hint appears early.
- Browsers can evict `localStorage` under pressure or long disuse.

The watchlist encodes into the URL hash (`#w=fx-eur,fx-jpy`), which browsers never
send to a server. Opening one asks before merging or replacing — it never
silently overwrites. Plain JSON export is offered as a fallback.

## Architecture: cache-first, always

The browser never calls a market data API. A scheduled job fetches a fixed
universe, writes a snapshot, and the app reads only that snapshot. Visitor count
is fully decoupled from API usage, and no key ever reaches client code.

```
GitHub Actions (cron)
  └─ ingest/run.ts            fault-isolated, one provider at a time
       ├─ ingest/providers/*  fetch + normalise
       └─ ingest/store/       upsert, keyed exactly as db/schema.sql
            └─ data/          committed snapshot, served as static files
                 └─ latest.json   ← the only file the overview fetches
```

### Deployment: Option B (static + GitHub Actions)

The brief marked Option A (Next.js + Postgres) as recommended. Option B is the
better fit here, and the reasoning is worth recording:

- The app has **no user data and no writes**. Everything the browser reads is a
  precomputed static file. Postgres would be serving one read model that never
  varies by request.
- **Supabase pauses free projects after inactivity.** For a cron-driven ingester
  that is a silent failure mode with no upside.
- Git gives a **free, complete audit trail** of every value ever published, which
  is genuinely useful when a provider revises history underneath us.
- Cost and operational surface are both zero.

Option A remains a real option, not a rewrite: ingestion writes through the
`Store` interface in `ingest/store/index.ts`, so moving to Postgres means adding
a `PostgresStore` and changing which one `ingest/run.ts` constructs.
`db/schema.sql` is already the canonical definition and the JSON layout mirrors it.

### Zero runtime dependencies

Ingestion runs on Node 22's native TypeScript type-stripping. There is no
`npm ci` in the workflow, no lockfile on the path to our published data, and no
supply chain to audit. The constraint this imposes is that ingestion code avoids
TypeScript syntax that needs real transformation — no enums, no namespaces, no
constructor parameter properties — and imports carry explicit `.ts` extensions.

### History is sharded by year

`data/history/<asset>/<year>.json`, not one file per asset. This is load-bearing:
the FX backfill produces 372KB per currency, so a monolithic layout would rewrite
~4.4MB of blobs into git *every single day*. Year shards mean a daily run touches
only the current year (~9KB per asset) and prior years stay byte-identical. It
also matches how the app reads — 1Y is one file, and only the Max range pays for
the whole series.

## Data sources

Limits live in `config/providers.ts` next to each provider, with a `verifiedAt`
date. The scheduler reads cadence from that file; nothing hardcodes intervals.

| Category | Source | Key | Verified |
|---|---|---|---|
| FX | [Frankfurter](https://frankfurter.dev) (ECB reference rates) | none | 2026-09-01 |
| Metals spot | [gold-api.com](https://gold-api.com) | none | 2026-09-01 |
| Crypto | [CoinGecko](https://www.coingecko.com/en/api) | none (a Demo key only raises limits) | 2026-09-01 |
| Equities | [Nasdaq](https://www.nasdaq.com) | none | 2026-09-01 |
| Macro | [FRED](https://fred.stlouisfed.org) | none | 2026-09-01 |
| Equities (optional upgrade) | [Finnhub](https://finnhub.io/register) | free key, no card | not yet |

### How each category avoids needing a key

- **FX** — Frankfurter is keyless by design.
- **Crypto** — CoinGecko's public tier serves `/coins/markets` without a key:
  one request returns all 50 coins with their 24h change. A Demo key raises the
  rate limit but unlocks nothing.
- **Macro** — the documented FRED JSON API needs a key, but `fredgraph.csv?id=…`,
  the download behind every FRED chart, does not, and returns the complete
  observation history. That is 32,283 observations going back to 1947.
- **Equities** — `api.nasdaq.com`, the API nasdaq.com itself calls. First-party
  and unauthenticated, but **not a published contract**, so it can change without
  notice; the parser validates every field rather than trusting the shape. Set
  `FINNHUB_API_KEY` and the equities job switches to Finnhub, which is documented
  and supported. A free Finnhub key takes about thirty seconds and no card.
- **Metals** — gold-api serves spot without a key. No keyless *history* source
  survived testing (below), so the metals series accumulates one close per day.

### Sources evaluated and rejected

Recorded so nobody spends an afternoon rediscovering them:

- **LBMA** (`prices.lbma.org.uk/json/*.json`) — would have been ideal: keyless
  daily gold and silver auction fixes back to **1968**, platinum and palladium to
  1990. It sits behind Imunify360, which serves curl normally but returns a
  JavaScript challenge page to Node's `fetch` from the same IP in the same
  second. That is TLS-fingerprint filtering, and defeating it would be both
  fragile and not something worth building.
- **Yahoo Finance** (`query1.finance.yahoo.com`) — 429 on every attempt, and
  unofficial.
- **Stooq** — behind a JavaScript challenge.
- **FRED's LBMA-derived gold series** (`GOLDPMGBD228NLBM` and friends) — removed
  from FRED; they 404 now.

### Corrections to the brief, from probing the live APIs

- **Frankfurter serves 30 currencies, not 201, and history begins 1999-01-04,
  not 1948.** It republishes ECB euro reference rates, and that is the whole
  series. All 12 currencies in our universe are covered, so nothing is lost —
  but "Max" on an FX chart means 1999, and adding a 13th currency means checking
  it is one of the 30 first.
- **gold-api.com has no history endpoint**, and no keyless replacement worked.
  Metals accumulate one close per day from here.
- **CoinGecko's keyless tier rejects `/coins/market_chart`** (429 on the first
  call), so crypto has no backfill either and accumulates the same way. The
  detail page says so rather than showing a bare "not enough history".
- **FRED writes a missing observation as an empty CSV cell**, not only as its
  documented `.` placeholder — the October 2025 US government shutdown left
  UNRATE and CPIAUCSL empty for that month. `Number('')` is `0`, not `NaN`, so a
  plain `isFinite` check accepts it and the chart shows unemployment falling to
  zero. Both forms are now skipped, and because an upsert can never *remove* a
  point it wrote in error, series that return their complete history replace it
  instead.

## Pricing convention

Every non-macro asset carries a **USD price for one unit of itself**: 1 EUR in
USD, 1 troy ounce of gold in USD, 1 BTC in USD. Quoting the whole universe
against a single numeraire makes the converter a cross-rate lookup instead of a
graph search, and makes top-movers comparable across categories.

Metals are quoted per **troy ounce** (31.1034768 g), not the avoirdupois ounce —
a 9.7% error if confused. The constant lives in exactly one place,
`GRAMS_PER_TROY_OUNCE` in `config/universe.ts`, and per-gram is a derived unit in
the converter rather than a duplicate asset row.

## Running it

Ingestion has no dependencies and needs no install:

```bash
node ingest/seed.ts               # seed the universe (idempotent)
node ingest/run.ts all            # every provider, fault-isolated
node ingest/run.ts fx --backfill  # full ECB history to 1999 — 2 requests
node ingest/run.ts crypto         # one provider at a time
```

Jobs: `fx`, `metals`, `crypto`, `equities`, `macro`, or `all`. No keys required
for any of them. `FINNHUB_API_KEY` is read if present and switches equities from
Nasdaq to Finnhub.

The app does:

```bash
npm install
npm run dev        # vite dev server
npm run build      # static build into dist/, then data + sw + 404 fallback
npm run verify     # deployability checks (also run in CI)
npm run typecheck
npm run icons      # regenerate the icon set from design/icons/
```

Requires Node 22.18+ for native type-stripping.

### Verified behaviour

- **Idempotent** — re-running after a backfill leaves every file byte-identical,
  so the scheduled commit is a genuine no-op when nothing moved.
- **Fault-isolated** — with the provider host unreachable, the previous values
  survive, `data/health.json` records the failure and the failure count, and
  `latest.json` is still rebuilt so the app renders with a staleness badge.
- **Cheap** — 27 years of daily rates across 12 currencies costs 2 HTTP requests
  and ~3 seconds, because the whole basket comes back in one response.

## Layout

```
index.html            app entry; iOS meta tags live here, not in the manifest
src/                  the app — screens, components, and a ~40-line router
public/               manifest, icons, self-hosted font
scripts/              icon generation, build-time SW + Pages steps, verifier
config/providers.ts   rate limits, cadence, attribution, verification dates
config/universe.ts    the fixed asset universe
db/schema.sql         canonical Postgres schema (Option A swap target)
ingest/run.ts         entrypoint; fault isolation and health accounting
ingest/seed.ts        seeds assets and macro series
ingest/lib/http.ts    backoff, pacing, per-provider budget guard
ingest/providers/     one module per provider, each fault-isolated
ingest/store/         Store interface + JSON implementation
data/                 the committed snapshot
design/icons/         icon concepts; open preview.html to compare
```

## Icon

The mark is Concept A, an ascending step line. Concept B (the brief's alternate,
a balance reduced to two dots and a beam) reads as a dumbbell, and B′ with a
fulcrum goes mushy below 48px — `design/icons/preview.html` renders all three at
icon sizes so the comparison is checkable rather than asserted.

Changing the mark means pointing `CONCEPT` in `scripts/build-icons.mjs` at a
different SVG and re-running `npm run icons`. Every raster size derives from that
one file.

## Licences

Inter is used under the SIL Open Font License 1.1 — see `public/fonts/README.txt`.

This project is MIT — see [LICENSE](LICENSE).
