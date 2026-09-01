import { PROVIDERS } from '../../config/providers.ts';
import { CRYPTO_TOP_N } from '../../config/universe.ts';
import { ProviderClient } from '../lib/http.ts';
import type { Asset, DailyPoint, IngestResult, Quote } from '../types.ts';

const PROVIDER = PROVIDERS.coingecko;
const SOURCE = 'coingecko' as const;

type MarketRow = {
  id: string;
  symbol: string;
  name: string;
  current_price: number | null;
  price_change_24h: number | null;
  price_change_percentage_24h: number | null;
  market_cap_rank: number | null;
  last_updated: string | null;
};

/**
 * The entire crypto universe in ONE request.
 *
 * /coins/markets with per_page=250 returns price, 24h change and rank for every
 * coin at once. Looping per coin would be 50 requests for the same data and
 * would exhaust the keyless tier in a single run.
 *
 * Crypto is the one dynamic slice of the universe: membership of the top 50
 * changes, so asset rows are discovered here rather than pinned in
 * config/universe.ts. Coins that drop out keep their rows and their history —
 * the seed step retires them instead of deleting them.
 */
export async function ingestCoinGecko(
  { carriedOver = 0 }: { carriedOver?: number } = {},
): Promise<IngestResult> {
  const client = new ProviderClient(SOURCE, carriedOver);

  // A key is optional here: it raises the rate limit, it does not unlock the
  // endpoint. The header is simply omitted when there is no key.
  const apiKey = PROVIDER.apiKeyEnv ? process.env[PROVIDER.apiKeyEnv] : undefined;

  const rows = await client.getJson<MarketRow[]>(
    `${PROVIDER.baseUrl}/coins/markets?vs_currency=usd&order=market_cap_desc` +
    `&per_page=${CRYPTO_TOP_N}&page=1&price_change_percentage=24h`,
    { headers: apiKey ? { 'x-cg-demo-api-key': apiKey } : undefined },
  );

  if (!Array.isArray(rows) || rows.length === 0) {
    throw new Error('CoinGecko returned no market rows');
  }

  const assets: Asset[] = [];
  const quotes: Quote[] = [];
  const daily: DailyPoint[] = [];
  const today = new Date().toISOString().slice(0, 10);

  for (const [index, row] of rows.entries()) {
    const price = row.current_price;
    if (!Number.isFinite(price) || price === null || price <= 0) continue;

    const id = `crypto:${row.id}`;
    assets.push({
      id,
      symbol: row.symbol.toUpperCase(),
      name: row.name,
      category: 'crypto',
      unit: `1 ${row.symbol.toUpperCase()}`,
      quoteCurrency: 'USD',
      source: SOURCE,
      sourceSymbol: row.id,
      // Rank is the natural order for crypto and it moves, so it is stored on
      // the asset rather than assumed from the order of a JSON array.
      sortOrder: row.market_cap_rank ?? index,
      retiredAt: null,
    });

    quotes.push({
      assetId: id,
      price,
      changeAbs: row.price_change_24h ?? null,
      changePct24h: row.price_change_percentage_24h ?? null,
      currency: 'USD',
      asOf: row.last_updated ? new Date(row.last_updated).toISOString() : new Date().toISOString(),
      source: SOURCE,
    });

    // The keyless tier rejects /market_chart, so there is no backfill to do.
    // Today's price becomes today's close and the series accumulates from here.
    daily.push({
      assetId: id,
      date: today,
      close: price,
      changePct: row.price_change_percentage_24h ?? null,
      source: SOURCE,
    });
  }

  if (quotes.length === 0) throw new Error('CoinGecko returned rows but none had a usable price');

  return { provider: SOURCE, assets, quotes, daily, requestsUsed: client.requestsUsed };
}
