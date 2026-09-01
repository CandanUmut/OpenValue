/**
 * Provider registry — single source of truth for rate limits and cadence.
 *
 * The scheduler reads cadence from this file; nothing hardcodes intervals.
 * `verifiedAt` records when a limit was last confirmed against the provider's
 * live docs/API. Free tiers change often — re-verify before trusting these.
 */

export type ProviderId =
  | 'frankfurter'
  | 'gold-api'
  | 'nasdaq'
  | 'goldprice'
  | 'coingecko'
  | 'finnhub'
  | 'twelvedata'
  | 'fred';

export type Budget = {
  /** Max requests per minute, or null when the provider documents none. */
  perMinute: number | null;
  /** Max requests per rolling day, or null when the provider documents none. */
  perDay: number | null;
  /** Max requests per calendar month, or null when the provider documents none. */
  perMonth: number | null;
};

export type Provider = {
  id: ProviderId;
  name: string;
  homepage: string;
  /** Attribution string rendered in the app footer. Several providers require it. */
  attribution: string;
  /** Env var holding the API key. null = keyless. Never read in client code. */
  apiKeyEnv: string | null;
  /**
   * True when apiKeyEnv is set but the provider also works without it — a key
   * only raises the limits. The runner then attempts the provider either way.
   */
  keyOptional?: boolean;
  /** Where to get a key, shown in the runner's error when one is required. */
  signupUrl?: string;
  baseUrl: string;
  budget: Budget;
  /** Minimum seconds between ingestion runs for this provider. */
  cadenceSeconds: number;
  /**
   * How long a quote from this provider stays "fresh". The UI shows a staleness
   * badge once `now - as_of` exceeds this. Deliberately ~2.5x cadence so a single
   * missed run does not paint the whole dashboard as stale.
   */
  stalenessSeconds: number;
  /** Whether the provider serves historical series we can backfill from. */
  hasHistory: boolean;
  notes: string;
  /** ISO date this entry's limits were last checked against the live provider. */
  verifiedAt: string;
};

const MIN = 60;
const HOUR = 60 * MIN;

export const PROVIDERS: Record<ProviderId, Provider> = {
  frankfurter: {
    id: 'frankfurter',
    name: 'Frankfurter',
    homepage: 'https://frankfurter.dev',
    attribution: 'FX rates: Frankfurter (European Central Bank reference rates)',
    apiKeyEnv: null,
    baseUrl: 'https://api.frankfurter.dev/v1',
    budget: { perMinute: null, perDay: null, perMonth: null },
    cadenceSeconds: 12 * HOUR,
    stalenessSeconds: 36 * HOUR,
    hasHistory: true,
    notes:
      'Keyless, CORS-enabled, free for commercial use. VERIFIED: 30 currencies ' +
      '(not 201) and history from 1999-01-04 (not 1948) — it republishes ECB euro ' +
      'reference rates. All 12 currencies in our universe are covered. ECB publishes ' +
      'once per working day around 16:00 CET, so twice-daily polling is ample. ' +
      'Responses carry cache-control: public, max-age=86400.',
    verifiedAt: '2026-09-01',
  },

  'gold-api': {
    id: 'gold-api',
    name: 'gold-api.com',
    homepage: 'https://gold-api.com',
    attribution: 'Metals spot prices: gold-api.com',
    apiKeyEnv: null,
    baseUrl: 'https://api.gold-api.com',
    budget: { perMinute: null, perDay: null, perMonth: null },
    cadenceSeconds: 15 * MIN,
    stalenessSeconds: 40 * MIN,
    hasHistory: false,
    notes:
      'Keyless, CORS-enabled, no documented rate limit on live prices. VERIFIED: ' +
      'XAU/XAG/XPT/XPD all return USD/troy-oz with an updatedAt timestamp. ' +
      'One request per metal — no batch endpoint. NO history endpoint, and no ' +
      'keyless metals history source survived testing (see README), so the metals ' +
      'series accumulates one close per day from our own snapshots.',
    verifiedAt: '2026-09-01',
  },

  nasdaq: {
    id: 'nasdaq',
    name: 'Nasdaq',
    homepage: 'https://www.nasdaq.com',
    attribution: 'Equity quotes: Nasdaq',
    apiKeyEnv: null,
    baseUrl: 'https://api.nasdaq.com/api',
    budget: { perMinute: 30, perDay: null, perMonth: null },
    cadenceSeconds: 15 * MIN,
    stalenessSeconds: 40 * MIN,
    hasHistory: false,
    notes:
      'VERIFIED keyless for all 19 symbols including BRK.B, via Node fetch. This is ' +
      'the API nasdaq.com itself calls — first-party and unauthenticated, but NOT a ' +
      'published contract, so it can change without notice. Finnhub is the ' +
      'documented, supported alternative and takes precedence whenever ' +
      'FINNHUB_API_KEY is set. One request per symbol; needs assetclass=etf or ' +
      'stocks, which is why the universe records which each symbol is.',
    verifiedAt: '2026-09-01',
  },

  goldprice: {
    id: 'goldprice',
    name: 'goldprice.dev',
    homepage: 'https://goldprice.dev',
    attribution: 'Metals fallback: goldprice.dev',
    apiKeyEnv: 'GOLDPRICE_API_KEY',
    baseUrl: 'https://api.goldprice.dev',
    budget: { perMinute: null, perDay: null, perMonth: 1000 },
    cadenceSeconds: 15 * MIN,
    stalenessSeconds: 40 * MIN,
    hasHistory: false,
    notes:
      'Fallback only — engaged when gold-api fails. A 1,000/month budget cannot ' +
      'sustain 15-minute polling on its own (~2,880/month), so it is strictly a ' +
      'secondary and the budget guard will refuse once exhausted. UNVERIFIED: no key ' +
      'available at build time.',
    verifiedAt: 'unverified',
  },

  coingecko: {
    id: 'coingecko',
    name: 'CoinGecko (Demo tier)',
    homepage: 'https://www.coingecko.com/en/api',
    attribution: 'Crypto data: CoinGecko',
    apiKeyEnv: 'COINGECKO_API_KEY',
    keyOptional: true,
    signupUrl: 'https://www.coingecko.com/en/api/pricing (Demo plan, free)',
    baseUrl: 'https://api.coingecko.com/api/v3',
    budget: { perMinute: 5, perDay: null, perMonth: 10_000 },
    cadenceSeconds: 10 * MIN,
    stalenessSeconds: 25 * MIN,
    hasHistory: false,
    notes:
      'VERIFIED working with NO key: /coins/markets?per_page=250 returns the whole ' +
      'top-50 universe with 24h change in ONE call. A Demo key raises the limits ' +
      'but is not required. The keyless tier is strict — /coins/{id}/market_chart ' +
      'returned 429 immediately — so per-coin history backfill is NOT attempted ' +
      'and crypto series accumulate from our own daily snapshots. hasHistory is ' +
      'false for that reason, not because CoinGecko lacks the endpoint.',
    verifiedAt: '2026-09-01',
  },

  finnhub: {
    id: 'finnhub',
    name: 'Finnhub',
    homepage: 'https://finnhub.io',
    attribution: 'Equity quotes: Finnhub',
    apiKeyEnv: 'FINNHUB_API_KEY',
    signupUrl: 'https://finnhub.io/register (free, no card)',
    baseUrl: 'https://finnhub.io/api/v1',
    budget: { perMinute: 60, perDay: null, perMonth: null },
    cadenceSeconds: 15 * MIN,
    stalenessSeconds: 40 * MIN,
    hasHistory: false,
    notes:
      'One call per symbol (/quote) — 19 equity symbols per run sits inside the ' +
      '60/min limit but must be paced. No daily cap documented. Outside US market ' +
      'hours the scheduler drops to hourly (see MARKET_HOURS below). OPTIONAL: the ' +
      'equities job falls back to Nasdaq when no key is set, so nothing is lost ' +
      'without one. Finnhub is preferred when available because it is a documented, ' +
      'supported API rather than an undocumented first-party endpoint.',
    verifiedAt: 'unverified',
  },

  twelvedata: {
    id: 'twelvedata',
    name: 'Twelve Data',
    homepage: 'https://twelvedata.com',
    attribution: 'Equity history: Twelve Data',
    apiKeyEnv: 'TWELVEDATA_API_KEY',
    baseUrl: 'https://api.twelvedata.com',
    budget: { perMinute: 8, perDay: 800, perMonth: null },
    cadenceSeconds: 24 * HOUR,
    stalenessSeconds: 72 * HOUR,
    hasHistory: true,
    notes:
      'BACKFILL ONLY — never on a per-request path. 800/day is spent by a one-time ' +
      'historical load and then left idle; the daily snapshot table carries the ' +
      'series forward. Supports up to 120 symbols per /time_series call on paid ' +
      'tiers only; assume one symbol per call.',
    verifiedAt: 'unverified',
  },

  fred: {
    id: 'fred',
    name: 'FRED (Federal Reserve Bank of St. Louis)',
    homepage: 'https://fred.stlouisfed.org',
    attribution: 'Macro series: FRED, Federal Reserve Bank of St. Louis',
    apiKeyEnv: null,
    baseUrl: 'https://fred.stlouisfed.org/graph/fredgraph.csv',
    budget: { perMinute: 60, perDay: null, perMonth: null },
    cadenceSeconds: 24 * HOUR,
    stalenessSeconds: 72 * HOUR,
    hasHistory: true,
    notes:
      'VERIFIED keyless. The documented api.stlouisfed.org JSON API needs a key, ' +
      'but fredgraph.csv?id=<SERIES> is a public download that returns the full ' +
      'observation history as CSV and needs none. Six series, one request each, ' +
      'once daily. Missing observations come through as "." and are skipped rather ' +
      'than written as zero.',
    verifiedAt: '2026-09-01',
  },
};

/**
 * US equity regular session, used to pick the equities cadence.
 * Deliberately naive: it ignores exchange holidays. Ingesting on a holiday costs
 * a handful of wasted requests, which is cheaper than maintaining a holiday table.
 */
export const MARKET_HOURS = {
  timeZone: 'America/New_York',
  openMinutes: 9 * 60 + 30,
  closeMinutes: 16 * 60,
  offHoursCadenceSeconds: HOUR,
} as const;

export function providerList(): Provider[] {
  return Object.values(PROVIDERS);
}

/** Providers that need no API key — these can be built and run end-to-end today. */
export function keylessProviders(): Provider[] {
  return providerList().filter((p) => p.apiKeyEnv === null);
}
