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
      'One request per metal — no batch endpoint. NO history endpoint, so the metals ' +
      'series can only accumulate from our own daily snapshots going forward.',
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
    baseUrl: 'https://api.coingecko.com/api/v3',
    budget: { perMinute: 30, perDay: null, perMonth: 10_000 },
    cadenceSeconds: 10 * MIN,
    stalenessSeconds: 25 * MIN,
    hasHistory: true,
    notes:
      'Use /coins/markets with per_page=250 — ONE call returns the whole top-50 ' +
      'universe. Never loop per coin. 10k/month against a 10-minute cadence is ' +
      '~4,320 calls/month for quotes, leaving headroom for backfill. The published ' +
      '"100 calls/min" figure is a ceiling; 30/min is the number to design to.',
    verifiedAt: 'unverified',
  },

  finnhub: {
    id: 'finnhub',
    name: 'Finnhub',
    homepage: 'https://finnhub.io',
    attribution: 'Equity quotes: Finnhub',
    apiKeyEnv: 'FINNHUB_API_KEY',
    baseUrl: 'https://finnhub.io/api/v1',
    budget: { perMinute: 60, perDay: null, perMonth: null },
    cadenceSeconds: 15 * MIN,
    stalenessSeconds: 40 * MIN,
    hasHistory: false,
    notes:
      'One call per symbol (/quote) — 19 equity symbols per run sits inside the ' +
      '60/min limit but must be paced. No daily cap documented. Outside US market ' +
      'hours the scheduler drops to hourly (see marketHours below).',
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
    apiKeyEnv: 'FRED_API_KEY',
    baseUrl: 'https://api.stlouisfed.org/fred',
    budget: { perMinute: 120, perDay: null, perMonth: null },
    cadenceSeconds: 24 * HOUR,
    stalenessSeconds: 72 * HOUR,
    hasHistory: true,
    notes:
      'Six series, once daily. Most series are monthly and only change on release ' +
      'days; the ingester upserts and is a no-op when the latest observation is ' +
      'unchanged.',
    verifiedAt: 'unverified',
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
