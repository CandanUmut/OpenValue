-- Value — canonical schema.
--
-- This is the Postgres definition (Option A: Vercel + Supabase). The shipped
-- default is Option B, a JSON snapshot in the repo, whose files are a faithful
-- mirror of these tables — same keys, same uniqueness rules. The ingestion code
-- writes through a Store interface, so moving to Postgres means implementing one
-- more Store and changing one line in ingest/store/index.ts.
--
-- Design rules encoded here:
--   * Every price carries as_of and source. A number without provenance is not
--     something we are willing to render.
--   * Idempotency comes from unique keys plus ON CONFLICT, so re-running an
--     ingestion for the same window is always safe.
--   * numeric, never float. Rounding drift in money is not acceptable.

begin;

create table if not exists assets (
  id             text primary key,
  symbol         text        not null,
  name           text        not null,
  category       text        not null check (category in ('fx','metal','crypto','equity')),
  unit           text        not null,
  quote_currency text        not null default 'USD',
  source         text        not null,
  source_symbol  text        not null,
  sort_order     integer     not null default 0,
  -- Set when an asset leaves the tracked universe (e.g. a coin drops out of the
  -- top 50). We keep the row and its history rather than deleting it.
  retired_at     timestamptz,
  created_at     timestamptz not null default now()
);

create unique index if not exists assets_category_symbol_key on assets (category, symbol);
create index if not exists assets_category_sort_idx on assets (category, sort_order);

-- One row per asset. The dashboard's hot read.
create table if not exists quotes_latest (
  asset_id       text primary key references assets (id) on delete cascade,
  price          numeric(28,10) not null,
  change_abs     numeric(28,10),
  change_pct_24h numeric(12,6),
  currency       text        not null,
  as_of          timestamptz not null,
  source         text        not null,
  ingested_at    timestamptz not null default now()
);

create index if not exists quotes_latest_as_of_idx on quotes_latest (as_of desc);

-- Our own accumulating series. Backfilled where a provider offers history, and
-- appended to daily regardless — which is how metals get a chart at all, since
-- gold-api serves no history.
create table if not exists daily_snapshots (
  asset_id   text        not null references assets (id) on delete cascade,
  date       date        not null,
  close      numeric(28,10) not null,
  change_pct numeric(12,6),
  source     text        not null,
  primary key (asset_id, date)
);

create index if not exists daily_snapshots_asset_date_idx on daily_snapshots (asset_id, date desc);

create table if not exists macro_series (
  series_id  text primary key,
  name       text        not null,
  unit       text        not null,
  frequency  text        not null check (frequency in ('daily','weekly','monthly')),
  source     text        not null default 'fred',
  sort_order integer     not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists macro_points (
  series_id text        not null references macro_series (series_id) on delete cascade,
  date      date        not null,
  value     numeric(28,10) not null,
  primary key (series_id, date)
);

create index if not exists macro_points_series_date_idx on macro_points (series_id, date desc);

-- Per-provider health. Fault isolation is only meaningful if the failure is
-- visible, so this is what powers the one-line data-health note in the footer.
create table if not exists provider_health (
  provider             text primary key,
  last_attempt_at      timestamptz,
  last_success_at      timestamptz,
  last_error_at        timestamptz,
  last_error           text,
  consecutive_failures integer     not null default 0,
  -- Rolling request accounting for the budget guard.
  window_date          date,
  requests_in_window   integer     not null default 0
);

commit;
