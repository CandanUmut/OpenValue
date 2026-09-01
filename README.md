# Value — Markets Overview

A free, installable dashboard for what is going on economically right now:
currencies, precious metals, crypto, equities and a handful of macro indicators.

**Data is delayed.** This is an overview tool, not a trading terminal, and every
number on screen carries the timestamp it was actually true at.

---

## Status

The app is built and deployable to GitHub Pages. Frankfurter FX is the only
provider wired up, so currencies are live and the other categories render an
explicit "not ingested yet" notice rather than pretending to be empty.

| Step | State |
|---|---|
| 1. Schema + seed for the asset universe | done |
| 2. Frankfurter FX end to end | done |
| 3. Overview page from cache | done |
| 4. PWA shell — manifest, icons, service worker, offline, install hints | done |
| 5. Remaining providers | **not started** — each needs an API key |
| 6. Converter | done |
| 7. Charts + detail pages | done |
| 8. Favourites + shareable watchlist link | done |
| 9. Design pass | done for the surfaces that exist |

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
| JS | 38.5 KB | 14.3 KB |
| CSS | 11.2 KB | 3.1 KB |
| Font (Inter, latin subset, self-hosted) | 48.3 KB | — |
| `latest.json` (35 assets) | 26 KB | 5.6 KB |

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
| FX | [Frankfurter](https://frankfurter.dev) (ECB reference rates) | no | 2026-09-01 |
| Metals | [gold-api.com](https://gold-api.com) | no | 2026-09-01 |
| Metals fallback | goldprice.dev | yes | not yet |
| Crypto | CoinGecko Demo | yes | not yet |
| Equity quotes | Finnhub | yes | not yet |
| Equity history | Twelve Data | yes | not yet |
| Macro | FRED | yes | not yet |

### Corrections to the brief, from probing the live APIs

- **Frankfurter serves 30 currencies, not 201, and history begins 1999-01-04,
  not 1948.** It republishes ECB euro reference rates, and that is the whole
  series. All 12 currencies in our universe are covered, so nothing is lost —
  but "Max" on an FX chart means 1999, and adding a 13th currency means checking
  it is one of the 30 first.
- **gold-api.com has no history endpoint.** Metals charts can only accumulate
  from our own daily snapshots going forward. If deeper metals history matters,
  that needs a different provider and is worth deciding early.

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
node ingest/seed.ts              # seed the universe (idempotent)
node ingest/run.ts fx            # incremental FX ingest — 2 requests
node ingest/run.ts fx --backfill # full ECB history to 1999 — also 2 requests
```

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
ingest/providers/     one module per provider
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
