/**
 * Ingestion entrypoint.
 *
 *   node ingest/run.ts fx          one provider
 *   node ingest/run.ts fx --backfill
 *   node ingest/run.ts all         every provider that is wired up and has a key
 *
 * Fault isolation is the whole point of this file: one provider throwing must
 * leave every other provider's data, and the previous run's data, untouched.
 */

import { PROVIDERS, type ProviderId } from '../config/providers.ts';
import { JsonStore } from './store/index.ts';
import type { Store } from './store/index.ts';
import type { IngestResult, ProviderHealth, Quote } from './types.ts';
import { ingestFrankfurter, backfillFrankfurter } from './providers/frankfurter.ts';
import { ingestGoldApi } from './providers/goldapi.ts';
import { ingestCoinGecko } from './providers/coingecko.ts';
import { ingestFred } from './providers/fred.ts';
import { ingestFinnhub, hasFinnhubKey } from './providers/finnhub.ts';
import { ingestNasdaq } from './providers/nasdaq.ts';

type Job = {
  name: string;
  provider: ProviderId;
  run: (opts: { backfill: boolean; carriedOver: number }) => Promise<IngestResult>;
  /**
   * When present and false, the job is SKIPPED rather than run and failed.
   * A missing API key is a configuration state, not a provider outage, and
   * recording it as a failure would put a permanent red mark in the health
   * footer for something nobody has gone wrong at.
   */
  enabled?: () => boolean;
  /** Why it is skipped, shown once in the log. */
  skipReason?: string;
};

const JOBS: Record<string, Job> = {
  fx: {
    name: 'FX (Frankfurter)',
    provider: 'frankfurter',
    run: ({ backfill, carriedOver }) =>
      backfill ? backfillFrankfurter() : ingestFrankfurter({ carriedOver }),
  },

  metals: {
    name: 'Metals spot (gold-api)',
    provider: 'gold-api',
    run: ({ carriedOver }) => ingestGoldApi({ carriedOver }),
  },

  crypto: {
    name: 'Crypto (CoinGecko)',
    provider: 'coingecko',
    run: ({ carriedOver }) => ingestCoinGecko({ carriedOver }),
  },

  macro: {
    name: 'Macro (FRED)',
    provider: 'fred',
    run: ({ carriedOver }) => ingestFred({ carriedOver }),
  },

  equities: {
    // Finnhub is a documented, supported API and wins whenever a key is present.
    // Nasdaq's own endpoint is keyless and covers every symbol, so the absence
    // of a key costs nothing — it is a fallback, not a degraded mode.
    name: hasFinnhubKey() ? 'Equities (Finnhub)' : 'Equities (Nasdaq, keyless)',
    provider: hasFinnhubKey() ? 'finnhub' : 'nasdaq',
    run: ({ carriedOver }) =>
      hasFinnhubKey() ? ingestFinnhub({ carriedOver }) : ingestNasdaq({ carriedOver }),
  },
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args[0] ?? 'all';
  const backfill = args.includes('--backfill');

  const selected = JOBS[target];
  // "fast" is the hourly set: everything that actually moves intraday. FX and
  // macro publish once a working day, so polling them hourly would spend
  // requests to rewrite identical files.
  const GROUPS: Record<string, string[]> = {
    all: Object.keys(JOBS),
    fast: ['metals', 'crypto', 'equities'],
  };

  const group = GROUPS[target];
  const jobs: Job[] = group
    ? group.map((name) => JOBS[name]).filter((j): j is Job => Boolean(j))
    : selected ? [selected] : [];

  if (jobs.length === 0) {
    console.error(
      `Unknown job "${target}". Known: ${Object.keys(JOBS).join(', ')}, ` +
      `${Object.keys(GROUPS).join(', ')}`,
    );
    process.exit(2);
  }

  const store: Store = new JsonStore(process.env.DATA_DIR ?? 'data');
  const health = await store.readHealth();
  let anySucceeded = false;
  let anyFailed = false;

  for (const job of jobs) {
    const started = Date.now();
    const previous = health[job.provider];
    const today = new Date().toISOString().slice(0, 10);
    // Request budgets reset daily; carry the count over only within the same day.
    const carriedOver = previous?.windowDate === today ? previous.requestsInWindow : 0;

    if (job.enabled && !job.enabled()) {
      console.log(`↷ ${job.name} — skipped. ${job.skipReason ?? ''}`);
      continue;
    }

    try {
      console.log(`→ ${job.name}${backfill ? ' (backfill)' : ''}`);
      const result = await job.run({ backfill, carriedOver });

      if (result.assets?.length) await store.upsertAssets(result.assets);
      await store.upsertDaily(result.daily);
      await store.upsertQuotes(await fillMissingChange(store, result.quotes));
      if (result.macroSeries?.length) await store.upsertMacroSeries(result.macroSeries);
      if (result.macroPoints?.length) {
        await (result.macroPointsComplete
          ? store.replaceMacroPoints(result.macroPoints)
          : store.upsertMacroPoints(result.macroPoints));
      }

      await store.writeHealth(
        succeed(job.provider, previous, today, carriedOver + result.requestsUsed),
      );
      anySucceeded = true;
      const wrote = [
        result.quotes.length ? `${result.quotes.length} quotes` : null,
        result.daily.length ? `${result.daily.length} daily points` : null,
        result.macroPoints?.length ? `${result.macroPoints.length} macro points` : null,
        result.assets?.length ? `${result.assets.length} assets` : null,
      ].filter(Boolean).join(', ');
      console.log(
        `  ok — ${wrote || 'nothing new'}, ` +
        `${result.requestsUsed} requests, ${Date.now() - started}ms`,
      );
    } catch (err) {
      // Deliberately swallowed. The dashboard keeps the last good values for this
      // provider and renders them with a staleness badge; the footer shows why.
      anyFailed = true;
      const message = err instanceof Error ? err.message : String(err);
      await store.writeHealth(fail(job.provider, previous, today, carriedOver, message));
      console.error(`  FAILED — ${message}`);
    }
  }

  // Always rebuild the read model, even on total failure: the app must still get
  // a well-formed latest.json carrying the previous values and the new health.
  await store.commit();

  console.log(anyFailed ? 'done with failures (data preserved)' : 'done');
  // A partial failure is not a workflow failure — the snapshot is still valid and
  // must still be committed. Only a total wipe-out is worth failing CI over.
  process.exit(anySucceeded || !anyFailed ? 0 : 1);
}

/**
 * Some providers serve a price with no previous close — gold-api is one. Rather
 * than leave the change column blank forever, derive it from the most recent
 * stored daily point that is not today's.
 *
 * The comparison stays within one source: a gold-api spot price against an LBMA
 * auction fix would produce a "24h change" that is mostly the gap between two
 * different measurements. When the series comes from elsewhere, the change stays
 * null and the UI shows an em dash, which is honest.
 */
async function fillMissingChange(store: Store, quotes: Quote[]): Promise<Quote[]> {
  const filled: Quote[] = [];

  for (const quote of quotes) {
    if (quote.changePct24h !== null || quote.price <= 0) {
      filled.push(quote);
      continue;
    }

    const recent = await store.getDaily(quote.assetId, 2);
    const today = quote.asOf.slice(0, 10);
    const previous = [...recent].reverse().find((p) => p.date < today && p.source === quote.source);

    filled.push(previous
      ? {
        ...quote,
        changeAbs: quote.price - previous.close,
        changePct24h: ((quote.price - previous.close) / previous.close) * 100,
      }
      : quote);
  }

  return filled;
}

function succeed(
  provider: ProviderId, previous: ProviderHealth | undefined, day: string, requests: number,
): ProviderHealth {
  const now = new Date().toISOString();
  return {
    provider,
    lastAttemptAt: now,
    lastSuccessAt: now,
    lastErrorAt: previous?.lastErrorAt ?? null,
    lastError: previous?.lastError ?? null,
    consecutiveFailures: 0,
    windowDate: day,
    requestsInWindow: requests,
  };
}

function fail(
  provider: ProviderId, previous: ProviderHealth | undefined, day: string,
  requests: number, message: string,
): ProviderHealth {
  const now = new Date().toISOString();
  return {
    provider,
    lastAttemptAt: now,
    lastSuccessAt: previous?.lastSuccessAt ?? null,
    lastErrorAt: now,
    lastError: message.slice(0, 500),
    consecutiveFailures: (previous?.consecutiveFailures ?? 0) + 1,
    windowDate: day,
    requestsInWindow: requests,
  };
}

void main();

export { PROVIDERS };
