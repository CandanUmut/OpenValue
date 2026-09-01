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
import type { IngestResult, ProviderHealth } from './types.ts';
import { ingestFrankfurter, backfillFrankfurter } from './providers/frankfurter.ts';

type Job = {
  name: string;
  provider: ProviderId;
  run: (opts: { backfill: boolean; carriedOver: number }) => Promise<IngestResult>;
};

const JOBS: Record<string, Job> = {
  fx: {
    name: 'FX (Frankfurter)',
    provider: 'frankfurter',
    run: ({ backfill, carriedOver }) =>
      backfill ? backfillFrankfurter() : ingestFrankfurter({ carriedOver }),
  },
  // metals, crypto, equities, macro land here as each is built, one at a time.
};

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const target = args[0] ?? 'all';
  const backfill = args.includes('--backfill');

  const jobs = target === 'all' ? Object.values(JOBS) : [JOBS[target]].filter(Boolean);
  if (jobs.length === 0) {
    console.error(`Unknown job "${target}". Known: ${Object.keys(JOBS).join(', ')}, all`);
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

    try {
      console.log(`→ ${job.name}${backfill ? ' (backfill)' : ''}`);
      const result = await job.run({ backfill, carriedOver });

      if (result.assets?.length) await store.upsertAssets(result.assets);
      await store.upsertDaily(result.daily);
      await store.upsertQuotes(result.quotes);
      if (result.macroSeries?.length) await store.upsertMacroSeries(result.macroSeries);
      if (result.macroPoints?.length) await store.upsertMacroPoints(result.macroPoints);

      await store.writeHealth(
        succeed(job.provider, previous, today, carriedOver + result.requestsUsed),
      );
      anySucceeded = true;
      console.log(
        `  ok — ${result.quotes.length} quotes, ${result.daily.length} daily points, ` +
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
