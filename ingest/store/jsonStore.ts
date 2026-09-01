import { promises as fs } from 'node:fs';
import path from 'node:path';
import type { Store } from './index.ts';
import type {
  Asset, Quote, DailyPoint, MacroSeries, MacroPoint, ProviderHealth,
} from '../types.ts';
import { PROVIDERS } from '../../config/providers.ts';

/**
 * Option B storage: the snapshot lives in the repo as JSON and is served as
 * static files. No database, no server, no cost, and git gives us a free audit
 * trail of every value we have ever published.
 *
 * Layout:
 *   data/assets.json                 the universe
 *   data/quotes.json                 canonical latest quote per asset
 *   data/macro.json                  macro series + points
 *   data/health.json                 per-provider health
 *   data/history/<id>/<year>.json    daily closes, compact [date, close, changePct]
 *   data/history/<id>/index.json     which years exist, and the series bounds
 *   data/latest.json                 DERIVED read model — the app's only fetch
 *
 * History is sharded BY YEAR, and that shape is load-bearing rather than tidy.
 * With one file per asset, the FX backfill produces 372KB per currency, so a
 * daily append rewrites ~4.4MB of blobs — every day, forever, into git history.
 * Year shards mean a daily run touches only the current year (~20KB/asset) and
 * every prior year stays byte-identical, so git never re-stores it.
 *
 * It also matches how the app reads: 1Y is one file, and only the Max range
 * pays for the whole series.
 *
 * latest.json is what makes the overview a single request. It is rebuilt from
 * the canonical files on commit(), never edited directly.
 */

const SPARK_POINTS = 30;

/** Asset ids contain ':' which is illegal in filenames on Windows and awkward in URLs. */
function historySlug(assetId: string): string {
  return assetId.replace(/:/g, '-');
}

function yearOf(date: string): string {
  return date.slice(0, 4);
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try {
    return JSON.parse(await fs.readFile(file, 'utf8')) as T;
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return fallback;
    throw err;
  }
}

/** Write via temp file + rename so a crash mid-write cannot leave truncated JSON. */
async function writeJson(file: string, value: unknown, pretty = true): Promise<void> {
  await fs.mkdir(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  await fs.writeFile(tmp, JSON.stringify(value, null, pretty ? 2 : 0) + '\n', 'utf8');
  await fs.rename(tmp, file);
}

/** Compact on-disk history row: [date, close, changePct]. */
type HistoryRow = [string, number, number | null];
type HistoryShard = { assetId: string; year: string; source: string; points: HistoryRow[] };
type HistoryIndex = {
  assetId: string;
  source: string;
  years: string[];
  count: number;
  firstDate: string | null;
  lastDate: string | null;
};

const EMPTY_INDEX = (assetId: string): HistoryIndex => ({
  assetId, source: '', years: [], count: 0, firstDate: null, lastDate: null,
});

export class JsonStore implements Store {
  private readonly root: string;
  /** Assets touched this run, so commit() only rewrites history files that changed. */
  private readonly dirtyHistory = new Set<string>();

  constructor(root = 'data') {
    this.root = path.resolve(root);
  }

  private file(...parts: string[]): string {
    return path.join(this.root, ...parts);
  }

  async upsertAssets(assets: Asset[]): Promise<void> {
    if (assets.length === 0) return;
    const existing = await this.getAssets();
    const byId = new Map(existing.map((a) => [a.id, a]));
    for (const a of assets) byId.set(a.id, { ...byId.get(a.id), ...a });
    const merged = [...byId.values()].sort(
      (x, y) => x.category.localeCompare(y.category) || x.sortOrder - y.sortOrder,
    );
    await writeJson(this.file('assets.json'), merged);
  }

  async upsertQuotes(quotes: Quote[]): Promise<void> {
    if (quotes.length === 0) return;
    const existing = await this.getQuotes();
    const byId = new Map(existing.map((q) => [q.assetId, q]));
    for (const q of quotes) {
      const prev = byId.get(q.assetId);
      // Never let a re-run or an out-of-order provider response move a quote
      // backwards in time.
      if (prev && Date.parse(prev.asOf) > Date.parse(q.asOf)) continue;
      byId.set(q.assetId, q);
    }
    await writeJson(this.file('quotes.json'), [...byId.values()].sort(
      (x, y) => x.assetId.localeCompare(y.assetId),
    ));
  }

  async upsertDaily(points: DailyPoint[]): Promise<void> {
    if (points.length === 0) return;

    // Group by asset, then by year — one file write per (asset, year) touched,
    // however many points arrived.
    const byAsset = new Map<string, Map<string, DailyPoint[]>>();
    for (const p of points) {
      const years = byAsset.get(p.assetId) ?? new Map<string, DailyPoint[]>();
      const bucket = years.get(yearOf(p.date)) ?? [];
      bucket.push(p);
      years.set(yearOf(p.date), bucket);
      byAsset.set(p.assetId, years);
    }

    for (const [assetId, years] of byAsset) {
      const dir = this.file('history', historySlug(assetId));
      // Every point in a batch comes from the same provider run, so any of them
      // carries the source. Falling back keeps a hypothetical empty bucket safe.
      const source = points.find((p) => p.assetId === assetId)?.source ?? 'frankfurter';

      for (const [year, incoming] of years) {
        const shardFile = path.join(dir, `${year}.json`);
        const shard = await readJson<HistoryShard>(shardFile, {
          assetId, year, source, points: [],
        });

        // (asset_id, date) is the primary key in db/schema.sql; a Map on date is
        // the same guarantee here.
        const byDate = new Map<string, HistoryRow>(shard.points.map((r) => [r[0], r]));
        let changed = false;
        for (const p of incoming) {
          const prev = byDate.get(p.date);
          // A null changePct means "unknown", not "zero" — it is what the first
          // point of any fetch window looks like, since nothing precedes it. An
          // incremental run must not blank the change we already computed during
          // backfill for that same date.
          const changePct = p.changePct ?? prev?.[2] ?? null;
          const next: HistoryRow = [p.date, p.close, changePct];
          if (prev && prev[1] === next[1] && prev[2] === next[2]) continue;
          byDate.set(p.date, next);
          changed = true;
        }
        // Skip the write entirely when nothing moved, so a re-run leaves the
        // working tree clean and the scheduled commit is a genuine no-op.
        if (!changed) continue;

        const sorted = [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
        await writeJson(
          shardFile,
          { assetId, year, source, points: sorted } satisfies HistoryShard,
          false, // history shards are machine-read; indentation would double them
        );
      }

      await this.rebuildHistoryIndex(assetId, source);
      this.dirtyHistory.add(assetId);
    }
  }

  /** Cheap: reads only each shard's length, never the whole series into memory at once. */
  private async rebuildHistoryIndex(assetId: string, source: string): Promise<void> {
    const dir = this.file('history', historySlug(assetId));
    const years = (await fs.readdir(dir).catch((): string[] => []))
      .filter((f) => /^\d{4}\.json$/.test(f))
      .map((f) => f.slice(0, 4))
      .sort();

    let count = 0;
    let firstDate: string | null = null;
    let lastDate: string | null = null;

    for (const year of years) {
      const shard = await readJson<HistoryShard>(
        path.join(dir, `${year}.json`), { assetId, year, source, points: [] },
      );
      if (shard.points.length === 0) continue;
      count += shard.points.length;
      firstDate ??= shard.points[0]![0];
      lastDate = shard.points.at(-1)![0];
    }

    await writeJson(
      path.join(dir, 'index.json'),
      { assetId, source, years, count, firstDate, lastDate } satisfies HistoryIndex,
    );
  }

  async upsertMacroSeries(series: MacroSeries[]): Promise<void> {
    if (series.length === 0) return;
    const macro = await this.readMacro();
    const bySeries = new Map(macro.series.map((s) => [s.seriesId, s]));
    for (const s of series) bySeries.set(s.seriesId, s);
    macro.series = [...bySeries.values()].sort((a, b) => a.sortOrder - b.sortOrder);
    await writeJson(this.file('macro.json'), macro);
  }

  async upsertMacroPoints(points: MacroPoint[]): Promise<void> {
    if (points.length === 0) return;
    const macro = await this.readMacro();
    for (const p of points) {
      const existing = macro.points[p.seriesId] ?? [];
      const byDate = new Map<string, [string, number]>(
        existing.map((r) => [r[0], r] as [string, [string, number]]),
      );
      byDate.set(p.date, [p.date, p.value]);
      macro.points[p.seriesId] = [...byDate.values()].sort((a, b) => a[0].localeCompare(b[0]));
    }
    await writeJson(this.file('macro.json'), macro);
  }

  async replaceMacroPoints(points: MacroPoint[]): Promise<void> {
    if (points.length === 0) return;
    const macro = await this.readMacro();

    const bySeries = new Map<string, [string, number][]>();
    for (const p of points) {
      const list = bySeries.get(p.seriesId) ?? [];
      list.push([p.date, p.value]);
      bySeries.set(p.seriesId, list);
    }

    // Only the series present in this batch are replaced; a series whose fetch
    // failed keeps whatever it had rather than being emptied.
    for (const [seriesId, list] of bySeries) {
      macro.points[seriesId] = list.sort((a, b) => a[0].localeCompare(b[0]));
    }

    await writeJson(this.file('macro.json'), macro);
  }

  private async readMacro(): Promise<{
    series: MacroSeries[];
    points: Record<string, [string, number][]>;
  }> {
    return readJson(this.file('macro.json'), { series: [], points: {} });
  }

  getAssets(): Promise<Asset[]> {
    return readJson<Asset[]>(this.file('assets.json'), []);
  }

  getQuotes(): Promise<Quote[]> {
    return readJson<Quote[]>(this.file('quotes.json'), []);
  }

  /** Most recent `limit` points, oldest first. Reads year shards newest-first and stops early. */
  async getDaily(assetId: string, limit: number): Promise<DailyPoint[]> {
    const dir = this.file('history', historySlug(assetId));
    const index = await readJson<HistoryIndex>(
      path.join(dir, 'index.json'), EMPTY_INDEX(assetId),
    );

    const rows: HistoryRow[] = [];
    for (const year of [...index.years].reverse()) {
      const shard = await readJson<HistoryShard>(
        path.join(dir, `${year}.json`), { assetId, year, source: '', points: [] },
      );
      rows.unshift(...shard.points);
      if (rows.length >= limit) break;
    }

    return rows.slice(-limit).map(([date, close, changePct]) => ({
      assetId, date, close, changePct, source: index.source as DailyPoint['source'],
    }));
  }

  async readHealth(): Promise<Record<string, ProviderHealth>> {
    return readJson<Record<string, ProviderHealth>>(this.file('health.json'), {});
  }

  async writeHealth(health: ProviderHealth): Promise<void> {
    const all = await this.readHealth();
    all[health.provider] = health;
    await writeJson(this.file('health.json'), all);
  }

  /**
   * Rebuild data/latest.json — the single file the app fetches for the overview.
   * Inlining a short sparkline per asset costs a few KB and saves ~90 requests.
   */
  async commit(): Promise<void> {
    const [assets, quotes, health, macro] = await Promise.all([
      this.getAssets(),
      this.getQuotes(),
      this.readHealth(),
      this.readMacro(),
    ]);

    const quoteById = new Map(quotes.map((q) => [q.assetId, q]));
    const now = new Date().toISOString();

    const rows = await Promise.all(
      assets.map(async (asset) => {
        const q = quoteById.get(asset.id);
        const spark = (await this.getDaily(asset.id, SPARK_POINTS)).map((p) => p.close);
        const provider = PROVIDERS[asset.source];
        return {
          id: asset.id,
          symbol: asset.symbol,
          name: asset.name,
          category: asset.category,
          unit: asset.unit,
          source: asset.source,
          retired: asset.retiredAt !== null,
          price: q?.price ?? null,
          changeAbs: q?.changeAbs ?? null,
          changePct24h: q?.changePct24h ?? null,
          currency: q?.currency ?? asset.quoteCurrency,
          asOf: q?.asOf ?? null,
          // Precomputed so the client does not need the provider table to decide
          // whether to draw a staleness badge.
          stale: q ? Date.parse(now) - Date.parse(q.asOf) > provider.stalenessSeconds * 1000 : true,
          spark,
        };
      }),
    );

    await writeJson(this.file('latest.json'), {
      generatedAt: now,
      schemaVersion: 1,
      assets: rows,
      macro: {
        series: macro.series,
        // The macro strip only ever shows the latest reading plus a short trend.
        latest: Object.fromEntries(
          macro.series.map((s) => {
            const pts = macro.points[s.seriesId] ?? [];
            return [s.seriesId, { points: pts.slice(-SPARK_POINTS), last: pts.at(-1) ?? null }];
          }),
        ),
      },
      health,
      attribution: Object.values(PROVIDERS).map((p) => ({
        // The id lets the app credit only the providers that actually supplied
        // a value, rather than every provider we intend to use one day.
        id: p.id,
        name: p.name,
        homepage: p.homepage,
        text: p.attribution,
      })),
    });
  }
}
