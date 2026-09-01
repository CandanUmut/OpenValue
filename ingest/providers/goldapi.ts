import { PROVIDERS } from '../../config/providers.ts';
import { METALS } from '../../config/universe.ts';
import { ProviderClient } from '../lib/http.ts';
import type { DailyPoint, IngestResult, Quote } from '../types.ts';

const PROVIDER = PROVIDERS['gold-api'];
const SOURCE = 'gold-api' as const;

type PriceResponse = {
  symbol: string;
  name: string;
  price: number;
  currency: string;
  updatedAt: string;
};

/**
 * Live metals spot, one request per metal — there is no batch endpoint.
 *
 * This provider supplies ONLY the current price. The daily series comes from
 * LBMA, and the two are deliberately never merged: the LBMA fix is a once-daily
 * auction published with a lag, and it can sit several percent away from spot.
 * Appending a spot tick to a series of auction fixes would put a step in the
 * chart that represents a change of source, not a change of price.
 */
export async function ingestGoldApi(
  { carriedOver = 0 }: { carriedOver?: number } = {},
): Promise<IngestResult> {
  const client = new ProviderClient(SOURCE, carriedOver);
  const quotes: Quote[] = [];
  const daily: DailyPoint[] = [];
  const failures: string[] = [];

  for (const metal of METALS) {
    try {
      const res = await client.getJson<PriceResponse>(
        `${PROVIDER.baseUrl}/price/${metal.sourceSymbol}`,
      );
      if (!Number.isFinite(res.price) || res.price <= 0) {
        throw new Error(`nonsensical price ${res.price}`);
      }
      const asOf = new Date(res.updatedAt).toISOString();

      // No keyless metals history source survived testing, so the chart is built
      // one close per day from here. Later runs on the same date overwrite the
      // point, which makes the last run of the day the day's close.
      daily.push({
        assetId: metal.id,
        date: asOf.slice(0, 10),
        close: res.price,
        changePct: null,
        source: SOURCE,
      });

      quotes.push({
        assetId: metal.id,
        price: res.price,
        // gold-api serves no previous close, so a 24h change would have to be
        // invented. The runner fills it in from our own stored history instead.
        changeAbs: null,
        changePct24h: null,
        currency: res.currency ?? 'USD',
        asOf,
        source: SOURCE,
      });
    } catch (err) {
      // One metal failing must not cost us the other three.
      failures.push(`${metal.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (quotes.length === 0) {
    throw new Error(`every metal failed — ${failures.join('; ')}`);
  }
  if (failures.length > 0) {
    console.warn(`  partial: ${failures.join('; ')}`);
  }

  return { provider: SOURCE, quotes, daily, requestsUsed: client.requestsUsed };
}
