import type {
  Asset, Quote, DailyPoint, MacroSeries, MacroPoint, ProviderHealth,
} from '../types.ts';

/**
 * The seam between ingestion and storage.
 *
 * Every method is an upsert keyed the way db/schema.sql is keyed, so replaying a
 * run changes nothing. Implementations must not partially apply a batch on
 * failure any more than their backing store makes possible.
 */
export interface Store {
  upsertAssets(assets: Asset[]): Promise<void>;
  upsertQuotes(quotes: Quote[]): Promise<void>;
  upsertDaily(points: DailyPoint[]): Promise<void>;
  upsertMacroSeries(series: MacroSeries[]): Promise<void>;
  upsertMacroPoints(points: MacroPoint[]): Promise<void>;
  /**
   * Replace a series' points wholesale. Only for providers that return the
   * complete history, and the only way a previously-written bad point is undone.
   */
  replaceMacroPoints(points: MacroPoint[]): Promise<void>;

  getAssets(): Promise<Asset[]>;
  getQuotes(): Promise<Quote[]>;
  /** Most recent `limit` daily points for one asset, oldest first. */
  getDaily(assetId: string, limit: number): Promise<DailyPoint[]>;

  readHealth(): Promise<Record<string, ProviderHealth>>;
  writeHealth(health: ProviderHealth): Promise<void>;

  /** Called once at the end of a run to materialise any derived read models. */
  commit(): Promise<void>;
}

export { JsonStore } from './jsonStore.ts';
