import { PROVIDERS } from '../../config/providers.ts';
import { FX } from '../../config/universe.ts';
import { ProviderClient } from '../lib/http.ts';
import type { DailyPoint, IngestResult, Quote } from '../types.ts';

const PROVIDER = PROVIDERS.frankfurter;
const SOURCE = 'frankfurter' as const;

/** Every currency we track except the numeraire itself. */
const SYMBOLS = FX.filter((a) => a.symbol !== 'USD').map((a) => a.symbol);
const SYMBOL_PARAM = SYMBOLS.join(',');

/** Frankfurter republishes ECB reference rates; the series starts here. */
export const EARLIEST_DATE = '1999-01-04';

type LatestResponse = { amount: number; base: string; date: string; rates: Record<string, number> };
type SeriesResponse = {
  amount: number;
  base: string;
  start_date: string;
  end_date: string;
  rates: Record<string, Record<string, number>>;
};

/**
 * Frankfurter quotes "units of X per 1 USD". Our universe quotes "USD per 1 unit
 * of X", so every rate is inverted on the way in. Doing it here, once, keeps the
 * inversion out of the converter and the charts.
 */
function toUsdPrice(ratePerUsd: number): number {
  return 1 / ratePerUsd;
}

/**
 * ECB publishes once per working day, so "as of" is the publication date at
 * 16:00 CET — not the moment we fetched. Claiming fetch-time freshness for a
 * daily number would be a lie the staleness badge is built to prevent.
 */
function asOfFromDate(date: string): string {
  return new Date(`${date}T14:00:00Z`).toISOString();
}

function idFor(symbol: string): string {
  return `fx:${symbol.toLowerCase()}`;
}

/**
 * Fetch the latest rates plus enough recent history to compute a day-over-day
 * change and keep the daily series current.
 *
 * Cost: 2 requests total, regardless of how many currencies we track — the
 * whole basket comes back in one response. Frankfurter documents no rate limit
 * and serves cache-control: max-age=86400.
 */
export async function ingestFrankfurter(
  { historyDays = 40, carriedOver = 0 }: { historyDays?: number; carriedOver?: number } = {},
): Promise<IngestResult> {
  const client = new ProviderClient(SOURCE, carriedOver);

  const [latest, series] = await Promise.all([
    client.getJson<LatestResponse>(
      `${PROVIDER.baseUrl}/latest?base=USD&symbols=${SYMBOL_PARAM}`,
    ),
    client.getJson<SeriesResponse>(
      `${PROVIDER.baseUrl}/${isoDaysAgo(historyDays)}..?base=USD&symbols=${SYMBOL_PARAM}`,
    ),
  ]);

  assertRates(latest.rates, 'latest');

  // Ascending by date; the last entry is the most recent published day.
  const dates = Object.keys(series.rates).sort();
  const daily: DailyPoint[] = [];

  for (const symbol of SYMBOLS) {
    let previousClose: number | null = null;
    for (const date of dates) {
      const rate = series.rates[date]?.[symbol];
      // A currency can be missing on a given day (ECB suspended TRY-style
      // publication before). Skip the day rather than writing a hole as zero.
      if (!isUsableRate(rate)) continue;

      const close = toUsdPrice(rate);
      daily.push({
        assetId: idFor(symbol),
        date,
        close,
        changePct: previousClose === null ? null : ((close - previousClose) / previousClose) * 100,
        source: SOURCE,
      });
      previousClose = close;
    }
  }

  // USD is a real asset row and is always exactly 1. Writing it explicitly means
  // the converter has no special case for the numeraire.
  daily.push(
    ...dates.map((date) => ({
      assetId: idFor('USD'), date, close: 1, changePct: 0, source: SOURCE,
    })),
  );

  // Prior published close per asset: the most recent point strictly before the
  // latest publication date. Not "yesterday" — over a weekend it is three days
  // back, and over Christmas it can be more.
  const previousByAsset = new Map<string, number>();
  for (const point of daily) {
    if (point.date < latest.date) previousByAsset.set(point.assetId, point.close);
  }

  const asOf = asOfFromDate(latest.date);
  const quotes: Quote[] = [
    { symbol: 'USD', price: 1 },
    ...SYMBOLS.flatMap((s) => {
      const rate = latest.rates[s];
      // A currency missing from the latest response keeps its previous quote
      // rather than being written as a hole.
      return isUsableRate(rate) ? [{ symbol: s, price: toUsdPrice(rate) }] : [];
    }),
  ].map(({ symbol, price }) => {
    const previous = previousByAsset.get(idFor(symbol)) ?? null;
    return {
      assetId: idFor(symbol),
      price,
      changeAbs: previous === null ? null : price - previous,
      // Named "24h" across the schema, but for FX this is genuinely
      // day-over-day against the prior ECB publication, which may be 3 days
      // back over a weekend. The detail page states the rate date for this reason.
      changePct24h: previous === null ? null : ((price - previous) / previous) * 100,
      currency: 'USD',
      asOf,
      source: SOURCE,
    };
  });

  return { provider: SOURCE, quotes, daily, requestsUsed: client.requestsUsed };
}

/** Full backfill from the start of the ECB series. Run once, then never again. */
export async function backfillFrankfurter(
  { from = EARLIEST_DATE }: { from?: string } = {},
): Promise<IngestResult> {
  const days = Math.ceil((Date.now() - Date.parse(from)) / 86_400_000);
  return ingestFrankfurter({ historyDays: days });
}

function isUsableRate(rate: number | undefined): rate is number {
  return typeof rate === 'number' && Number.isFinite(rate) && rate > 0;
}

function assertRates(rates: Record<string, number>, label: string): void {
  const missing = SYMBOLS.filter((s) => !isUsableRate(rates[s]));
  // A partial response is a provider problem, not a reason to write nulls over
  // good data. The runner will keep the last known values and mark them stale.
  if (missing.length > SYMBOLS.length / 2) {
    throw new Error(
      `Frankfurter ${label} response is missing ${missing.length}/${SYMBOLS.length} ` +
      `currencies (${missing.join(',')}) — treating as a provider failure.`,
    );
  }
}

function isoDaysAgo(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);
}
