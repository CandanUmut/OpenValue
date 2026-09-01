import { PROVIDERS } from '../../config/providers.ts';
import { EQUITIES } from '../../config/universe.ts';
import { ProviderClient } from '../lib/http.ts';
import type { DailyPoint, IngestResult, Quote } from '../types.ts';

const PROVIDER = PROVIDERS.nasdaq;
const SOURCE = 'nasdaq' as const;

/**
 * Keyless equity quotes, from the API nasdaq.com itself calls.
 *
 * This is first-party and unauthenticated, but it is not a published contract:
 * it can change shape without notice. Finnhub is the documented alternative and
 * the runner prefers it whenever a key is present. The parsing below is
 * defensive for that reason — every field is validated rather than trusted.
 *
 * It rejects a plain client, so a browser User-Agent is required.
 */
const BROWSER_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 ' +
  '(KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

type InfoResponse = {
  data: {
    symbol: string;
    primaryData?: {
      lastSalePrice: string;      // "$761.63"
      netChange: string;          // "-0.10"
      percentageChange: string;   // "-0.01%"
      lastTradeTimestamp: string; // "Sep 1, 2026 6:45 PM ET"
    };
  } | null;
};

export async function ingestNasdaq(
  { carriedOver = 0 }: { carriedOver?: number } = {},
): Promise<IngestResult> {
  const client = new ProviderClient(SOURCE, carriedOver);
  const quotes: Quote[] = [];
  const daily: DailyPoint[] = [];
  const failures: string[] = [];

  for (const equity of EQUITIES) {
    try {
      const res = await client.getJson<InfoResponse>(
        `${PROVIDER.baseUrl}/quote/${encodeURIComponent(equity.sourceSymbol)}/info` +
        `?assetclass=${equity.instrument === 'stock' ? 'stocks' : 'etf'}`,
        { headers: { 'user-agent': BROWSER_UA } },
      );

      const data = res.data?.primaryData;
      if (!data) throw new Error('no primaryData in response');

      const price = parseMoney(data.lastSalePrice);
      if (price === null || price <= 0) throw new Error(`unparseable price "${data.lastSalePrice}"`);

      const asOf = parseEasternTimestamp(data.lastTradeTimestamp) ?? new Date().toISOString();

      quotes.push({
        assetId: equity.id,
        price,
        changeAbs: parseMoney(data.netChange),
        changePct24h: parseMoney(data.percentageChange),
        currency: 'USD',
        asOf,
        source: SOURCE,
      });

      daily.push({
        assetId: equity.id,
        date: asOf.slice(0, 10),
        close: price,
        changePct: parseMoney(data.percentageChange),
        source: SOURCE,
      });
    } catch (err) {
      // One symbol failing must not cost the other eighteen.
      failures.push(`${equity.symbol}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  if (quotes.length === 0) throw new Error(`every symbol failed — ${failures.join('; ')}`);
  if (failures.length > 0) console.warn(`  partial: ${failures.join('; ')}`);

  return { provider: SOURCE, quotes, daily, requestsUsed: client.requestsUsed };
}

/** "$761.63" / "-0.01%" / "N/A" → number | null. */
export function parseMoney(raw: string | null | undefined): number | null {
  if (typeof raw !== 'string') return null;
  const cleaned = raw.replace(/[$,%\s,]/g, '');
  if (cleaned === '' || cleaned === 'N/A' || cleaned === 'NA') return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? value : null;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/**
 * "Sep 1, 2026 6:45 PM ET" → ISO UTC.
 *
 * "ET" is Eastern, which is EST or EDT depending on the date, so the offset has
 * to be resolved for that specific instant rather than assumed. Recording the
 * fetch time instead would overstate freshness on a market holiday, which is
 * exactly what the staleness badge exists to catch.
 */
export function parseEasternTimestamp(raw: string | null | undefined): string | null {
  if (typeof raw !== 'string') return null;

  const match = /^([A-Za-z]{3})\s+(\d{1,2}),\s*(\d{4})(?:\s+(\d{1,2}):(\d{2})\s*(AM|PM))?/.exec(raw.trim());
  if (!match) return null;

  const month = MONTHS.indexOf(match[1]!);
  if (month < 0) return null;

  const day = Number(match[2]);
  const year = Number(match[3]);
  let hour = match[4] ? Number(match[4]) % 12 : 0;
  if (match[6] === 'PM') hour += 12;
  const minute = match[5] ? Number(match[5]) : 0;

  // We want the instant `utc` whose New York local time equals the parsed parts.
  // Reading the parts as if they were UTC gives `naive`, and by definition
  // naive = utc + offset(utc). Solve it by iterating once: the first guess is
  // only wrong when the guess and the answer straddle a DST change, and the
  // second pass fixes that.
  const naive = Date.UTC(year, month, day, hour, minute);
  const guess = naive - easternOffsetMs(naive);
  const utc = naive - easternOffsetMs(guess);

  return Number.isFinite(utc) ? new Date(utc).toISOString() : null;
}

/** How far ahead of UTC New York is at a given instant, in ms (negative). */
function easternOffsetMs(utcMs: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York', hour12: false,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(utcMs));
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);

  const asIfUtc = Date.UTC(
    get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'),
  );
  return asIfUtc - utcMs;
}
