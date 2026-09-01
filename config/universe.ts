/**
 * The asset universe. Fixed and not user-editable — this is what the ingestion
 * job fetches, and therefore the entire ceiling on our API usage.
 *
 * Pricing convention: every non-macro asset carries a USD price for ONE unit of
 * itself (1 EUR = 1.159 USD, 1 XAU = 4329.70 USD, 1 BTC = ... USD). Quoting the
 * whole universe against a single numeraire makes the converter a cross-rate
 * lookup instead of a graph search, and makes "top movers" comparable across
 * categories.
 */

import type { ProviderId } from './providers.ts';

export type Category = 'fx' | 'metal' | 'crypto' | 'equity' | 'macro';

export type AssetSeed = {
  /** Stable primary key, e.g. "fx:eur". Never changes once published. */
  id: string;
  symbol: string;
  name: string;
  category: Category;
  /** What one unit is, in words. Shown on the detail page. */
  unit: string;
  /** Currency the price is expressed in. */
  quoteCurrency: string;
  source: ProviderId;
  /** The identifier this provider knows the asset by. */
  sourceSymbol: string;
  sortOrder: number;
  /**
   * Equities only. Nasdaq's quote endpoint requires assetclass=etf or stocks and
   * 404s on the wrong one, so which it is has to be recorded rather than guessed.
   */
  instrument?: 'etf' | 'stock';
};

const fx = (symbol: string, name: string, i: number): AssetSeed => ({
  id: `fx:${symbol.toLowerCase()}`,
  symbol,
  name,
  category: 'fx',
  unit: `1 ${symbol}`,
  quoteCurrency: 'USD',
  source: 'frankfurter',
  sourceSymbol: symbol,
  sortOrder: i,
});

/**
 * All 12 are confirmed present in Frankfurter's 30-currency set.
 * USD is included as the numeraire and is always exactly 1.0 — it is a real row
 * so the converter and search treat it like any other currency.
 */
export const FX: AssetSeed[] = [
  ['USD', 'US Dollar'],
  ['EUR', 'Euro'],
  ['GBP', 'British Pound'],
  ['JPY', 'Japanese Yen'],
  ['CHF', 'Swiss Franc'],
  ['CNY', 'Chinese Yuan'],
  ['TRY', 'Turkish Lira'],
  ['CAD', 'Canadian Dollar'],
  ['AUD', 'Australian Dollar'],
  ['INR', 'Indian Rupee'],
  ['BRL', 'Brazilian Real'],
  ['MXN', 'Mexican Peso'],
].map(([s, n], i) => fx(s as string, n as string, i));

/**
 * Metals are quoted per TROY ounce (31.1034768 g), which is not the avoirdupois
 * ounce (28.349523125 g). Getting this wrong is a 9.7% error, so the constant
 * lives in exactly one place: GRAMS_PER_TROY_OUNCE below.
 *
 * Per-gram is a derived unit in the converter, not a duplicate asset row —
 * duplicating rows would double the surface area for the two to drift apart.
 */
export const METALS: AssetSeed[] = [
  ['XAU', 'Gold'],
  ['XAG', 'Silver'],
  ['XPT', 'Platinum'],
  ['XPD', 'Palladium'],
].map(([s, n], i) => ({
  id: `metal:${(s as string).toLowerCase()}`,
  symbol: s as string,
  name: n as string,
  category: 'metal' as const,
  unit: '1 troy ounce',
  quoteCurrency: 'USD',
  source: 'gold-api' as ProviderId,
  sourceSymbol: s as string,
  sortOrder: i,
}));

export const GRAMS_PER_TROY_OUNCE = 31.1034768;

/**
 * Equities: 11 broad ETFs covering US size/style, developed and emerging
 * international, duration, credit, gold and oil — plus 8 large caps. One
 * Finnhub call each.
 */
export const EQUITIES: AssetSeed[] = ([
  ['SPY', 'SPDR S&P 500 ETF', 'etf'],
  ['QQQ', 'Invesco QQQ Trust', 'etf'],
  ['DIA', 'SPDR Dow Jones Industrial Average ETF', 'etf'],
  ['IWM', 'iShares Russell 2000 ETF', 'etf'],
  ['VT', 'Vanguard Total World Stock ETF', 'etf'],
  ['EFA', 'iShares MSCI EAFE ETF', 'etf'],
  ['EEM', 'iShares MSCI Emerging Markets ETF', 'etf'],
  ['TLT', 'iShares 20+ Year Treasury Bond ETF', 'etf'],
  ['HYG', 'iShares iBoxx High Yield Corporate Bond ETF', 'etf'],
  ['GLD', 'SPDR Gold Shares', 'etf'],
  ['USO', 'United States Oil Fund', 'etf'],
  ['AAPL', 'Apple', 'stock'],
  ['MSFT', 'Microsoft', 'stock'],
  ['NVDA', 'NVIDIA', 'stock'],
  ['AMZN', 'Amazon', 'stock'],
  ['GOOGL', 'Alphabet', 'stock'],
  ['META', 'Meta Platforms', 'stock'],
  ['TSLA', 'Tesla', 'stock'],
  ['BRK.B', 'Berkshire Hathaway', 'stock'],
] as const).map(([s, n, instrument], i) => ({
  id: `equity:${s.toLowerCase().replace('.', '-')}`,
  symbol: s,
  name: n,
  category: 'equity' as const,
  unit: '1 share',
  quoteCurrency: 'USD',
  // Overridden per run by whichever equity provider actually answered.
  source: 'nasdaq' as ProviderId,
  sourceSymbol: s,
  sortOrder: i,
  instrument,
}));

export type MacroSeed = {
  seriesId: string;
  name: string;
  unit: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  /** Higher is generally reported as worse for this series. Drives icon choice, not color. */
  sortOrder: number;
};

export const MACRO: MacroSeed[] = [
  { seriesId: 'FEDFUNDS', name: 'Federal Funds Rate', unit: 'percent', frequency: 'monthly', sortOrder: 0 },
  { seriesId: 'CPIAUCSL', name: 'CPI, All Urban Consumers', unit: 'index 1982-84=100', frequency: 'monthly', sortOrder: 1 },
  { seriesId: 'UNRATE', name: 'Unemployment Rate', unit: 'percent', frequency: 'monthly', sortOrder: 2 },
  { seriesId: 'DGS10', name: '10-Year Treasury Yield', unit: 'percent', frequency: 'daily', sortOrder: 3 },
  { seriesId: 'DGS2', name: '2-Year Treasury Yield', unit: 'percent', frequency: 'daily', sortOrder: 4 },
  { seriesId: 'M2SL', name: 'M2 Money Stock', unit: 'billions of USD', frequency: 'monthly', sortOrder: 5 },
];

/**
 * Crypto is the one dynamic slice: a single CoinGecko /coins/markets call returns
 * the top N by market cap, so the exact membership changes over time. We seed the
 * asset rows from whatever that call returns rather than pinning a list, and keep
 * rows for coins that fall out of the top 50 so their history is not orphaned.
 */
export const CRYPTO_TOP_N = 50;

export const STATIC_ASSETS: AssetSeed[] = [...FX, ...METALS, ...EQUITIES];

/** 12 FX + 4 metals + 19 equities + 50 crypto + 6 macro = 91 tracked series. */
export function universeSize(): number {
  return STATIC_ASSETS.length + CRYPTO_TOP_N + MACRO.length;
}
