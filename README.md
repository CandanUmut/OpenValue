# Value — Markets Overview

A free, installable dashboard for what is going on economically right now:
currencies, precious metals, crypto, equities and a handful of macro indicators.

**Data is delayed.** This is an overview tool, not a trading terminal, and every
number on screen carries the timestamp it was actually true at.

---

## Status

Build steps 1 and 2 are complete: schema, seed, and the Frankfurter FX provider
running end to end through the cache-first pipeline. Nothing else is wired up yet.

| Step | State |
|---|---|
| 1. Schema + seed for the asset universe | done |
| 2. Frankfurter FX end to end | done |
| 3. Overview page from cache | not started |
| 4. PWA shell | not started |
| 5. Remaining providers | not started |
| 6–9. Converter, charts, favourites, design pass | not started |

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

```bash
node ingest/seed.ts              # seed the universe (idempotent)
node ingest/run.ts fx            # incremental FX ingest — 2 requests
node ingest/run.ts fx --backfill # full ECB history to 1999 — also 2 requests
```

No install step. Requires Node 22.18+ for native type-stripping.

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

## Licence

MIT — see [LICENSE](LICENSE).
