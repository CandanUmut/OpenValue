import { PROVIDERS } from '../../config/providers.ts';
import { EQUITIES } from '../../config/universe.ts';
import { ProviderClient } from '../lib/http.ts';
import type { DailyPoint, IngestResult, Quote } from '../types.ts';

const PROVIDER = PROVIDERS.finnhub;
const SOURCE = 'finnhub' as const;

/**
 * Equity quotes — the one provider in this app that genuinely needs a key.
 *
 * No keyless source for US equity quotes survived testing: Yahoo's unofficial
 * endpoint returns 429 and Stooq sits behind a JavaScript challenge, and both
 * are unofficial anyway. Finnhub's free tier is 60 requests/minute with no daily
 * cap and takes about thirty seconds to sign up for, with no card.
 *
 * One /quote call per symbol; there is no batch endpoint on the free tier.
 * Nineteen symbols fits comfortably inside the per-minute limit, paced by
 * ProviderClient.
 */
type QuoteResponse = {
  c: number;  // current
  d: number | null;  // change
  dp: number | null;  // change percent
  pc: number;  // previous close
  t: number;  // unix seconds
};

export function hasFinnhubKey(): boolean {
  return Boolean(PROVIDER.apiKeyEnv && process.env[PROVIDER.apiKeyEnv]);
}

export async function ingestFinnhub(
  { carriedOver = 0 }: { carriedOver?: number } = {},
): Promise<IngestResult> {
  const apiKey = PROVIDER.apiKeyEnv ? process.env[PROVIDER.apiKeyEnv] : undefined;
  if (!apiKey) {
    throw new Error(
      `${PROVIDER.apiKeyEnv} is not set. Get a free key at ${PROVIDER.signupUrl}, ` +
      'then add it as a repository secret. Equities are skipped until then.',
    );
  }

  const client = new ProviderClient(SOURCE, carriedOver);
  const quotes: Quote[] = [];
  const daily: DailyPoint[] = [];
  const failures: string[] = [];

  for (const equity of EQUITIES) {
    try {
      const res = await client.getJson<QuoteResponse>(
        // Finnhub takes the key as a query parameter; the header form is
        // equivalent and keeps it out of any logged URL.
        `${PROVIDER.baseUrl}/quote?symbol=${encodeURIComponent(equity.sourceSymbol)}`,
        { headers: { 'X-Finnhub-Token': apiKey } },
      );

      // Finnhub answers an unknown or unentitled symbol with a 200 and zeroes
      // rather than an error, so a zero price is a failure, not a price.
      if (!Number.isFinite(res.c) || res.c <= 0) {
        throw new Error('no price (symbol unknown, or not covered by this plan)');
      }

      const asOf = res.t > 0 ? new Date(res.t * 1000).toISOString() : new Date().toISOString();

      quotes.push({
        assetId: equity.id,
        price: res.c,
        changeAbs: res.d ?? null,
        changePct24h: res.dp ?? null,
        currency: 'USD',
        asOf,
        source: SOURCE,
      });

      daily.push({
        assetId: equity.id,
        date: asOf.slice(0, 10),
        close: res.c,
        changePct: res.dp ?? null,
        source: SOURCE,
      });
    } catch (err) {
      failures.push(`${equity.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (quotes.length === 0) throw new Error(`every symbol failed — ${failures.join('; ')}`);
  if (failures.length > 0) console.warn(`  partial: ${failures.join('; ')}`);

  return { provider: SOURCE, quotes, daily, requestsUsed: client.requestsUsed };
}

/**
 * US regular session, used to pick the cadence. Deliberately ignores exchange
 * holidays: ingesting on a holiday wastes a handful of requests, which is
 * cheaper than maintaining a holiday calendar.
 */
export function isUsMarketOpen(now = new Date()): boolean {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    weekday: 'short', hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(now);
  const get = (t: string) => parts.find((p) => p.type === t)?.value ?? '';

  if (['Sat', 'Sun'].includes(get('weekday'))) return false;
  const minutes = Number(get('hour')) * 60 + Number(get('minute'));
  return minutes >= 9 * 60 + 30 && minutes < 16 * 60;
}
