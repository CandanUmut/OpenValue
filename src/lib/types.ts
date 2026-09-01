/** The shape of data/latest.json — the only file the app fetches. */

export type Category = 'fx' | 'metal' | 'crypto' | 'equity';

export type AssetRow = {
  id: string;
  symbol: string;
  name: string;
  category: Category;
  unit: string;
  source: string;
  retired: boolean;
  price: number | null;
  changeAbs: number | null;
  changePct24h: number | null;
  currency: string;
  asOf: string | null;
  /** Precomputed by the ingester so the client needs no provider table. */
  stale: boolean;
  /** Last ~30 daily closes, oldest first. Empty until the series has data. */
  spark: number[];
};

export type MacroSeries = {
  seriesId: string;
  name: string;
  unit: string;
  frequency: string;
};

export type ProviderHealth = {
  provider: string;
  lastSuccessAt: string | null;
  lastErrorAt: string | null;
  lastError: string | null;
  consecutiveFailures: number;
};

export type Snapshot = {
  generatedAt: string;
  schemaVersion: number;
  assets: AssetRow[];
  macro: {
    series: MacroSeries[];
    latest: Record<string, { points: [string, number][]; last: [string, number] | null }>;
  };
  health: Record<string, ProviderHealth>;
  attribution: { id: string; name: string; homepage: string; text: string }[];
};

/** data/history/<slug>/index.json */
export type HistoryIndex = {
  assetId: string;
  source: string;
  years: string[];
  count: number;
  firstDate: string | null;
  lastDate: string | null;
};

/** data/history/<slug>/<year>.json — [date, close, changePct] */
export type HistoryShard = {
  assetId: string;
  year: string;
  source: string;
  points: [string, number, number | null][];
};

export const CATEGORY_LABELS: Record<Category, string> = {
  fx: 'Currencies',
  metal: 'Metals',
  crypto: 'Crypto',
  equity: 'Equities',
};

export const CATEGORY_ORDER: Category[] = ['fx', 'metal', 'crypto', 'equity'];
