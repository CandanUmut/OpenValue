import type { Category } from '../config/universe.ts';
import type { ProviderId } from '../config/providers.ts';

export type Asset = {
  id: string;
  symbol: string;
  name: string;
  category: Category;
  unit: string;
  quoteCurrency: string;
  source: ProviderId;
  sourceSymbol: string;
  sortOrder: number;
  retiredAt: string | null;
};

export type Quote = {
  assetId: string;
  price: number;
  changeAbs: number | null;
  changePct24h: number | null;
  currency: string;
  /** ISO-8601 UTC. When the upstream says the value was true — not when we fetched it. */
  asOf: string;
  source: ProviderId;
};

/** One close per asset per day. `date` is YYYY-MM-DD. */
export type DailyPoint = {
  assetId: string;
  date: string;
  close: number;
  changePct: number | null;
  source: ProviderId;
};

export type MacroSeries = {
  seriesId: string;
  name: string;
  unit: string;
  frequency: 'daily' | 'weekly' | 'monthly';
  source: ProviderId;
  sortOrder: number;
};

export type MacroPoint = { seriesId: string; date: string; value: number };

export type ProviderHealth = {
  provider: ProviderId;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
  windowDate: string | null;
  requestsInWindow: number;
};

/**
 * What one provider's ingester hands back. It returns data or it throws; the
 * runner is what decides that a throw must not take down the other providers.
 */
export type IngestResult = {
  provider: ProviderId;
  quotes: Quote[];
  daily: DailyPoint[];
  macroSeries?: MacroSeries[];
  macroPoints?: MacroPoint[];
  /** New assets discovered at run time (crypto). Upserted before quotes. */
  assets?: Asset[];
  requestsUsed: number;
};
