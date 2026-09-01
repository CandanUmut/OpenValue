import { useEffect, useState } from 'preact/hooks';
import type { HistoryIndex, HistoryShard, Snapshot } from './types.ts';

/** Vite rewrites this to the deploy base, so the same code works at / and /OpenValue/. */
export const BASE = import.meta.env.BASE_URL;

export const dataUrl = (p: string) => `${BASE}data/${p}`;

export type Load<T> =
  | { state: 'loading'; data: null; error: null }
  | { state: 'ready'; data: T; error: null }
  | { state: 'error'; data: T | null; error: Error };

/**
 * Load the snapshot.
 *
 * The service worker serves data/latest.json stale-while-revalidate, so the
 * cached numbers paint immediately and a fresh copy lands moments later. That
 * means this hook can be a plain fetch — the caching policy lives in one place
 * (the SW) rather than being half-implemented here as well.
 */
export function useSnapshot(): Load<Snapshot> & { refresh: () => void } {
  const [load, setLoad] = useState<Load<Snapshot>>({ state: 'loading', data: null, error: null });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetch(dataUrl('latest.json'), { cache: 'no-cache' })
      .then((r) => {
        if (!r.ok) throw new Error(`Could not load market data (HTTP ${r.status})`);
        return r.json() as Promise<Snapshot>;
      })
      .then((data) => { if (!cancelled) setLoad({ state: 'ready', data, error: null }); })
      .catch((error: Error) => {
        // Keep whatever we already showed. Going blank on a refresh failure is
        // strictly worse than showing yesterday's numbers with a stale badge.
        if (!cancelled) setLoad((prev) => ({ state: 'error', data: prev.data, error }));
      });
    return () => { cancelled = true; };
  }, [nonce]);

  // iOS has no Background Sync, so refresh is driven by the two events we do get.
  useEffect(() => {
    const refresh = () => { if (document.visibilityState === 'visible') setNonce((n) => n + 1); };
    document.addEventListener('visibilitychange', refresh);
    window.addEventListener('online', refresh);
    return () => {
      document.removeEventListener('visibilitychange', refresh);
      window.removeEventListener('online', refresh);
    };
  }, []);

  return { ...load, refresh: () => setNonce((n) => n + 1) };
}

export const historySlug = (assetId: string) => assetId.replace(/:/g, '-');

export type Range = '7D' | '1M' | '3M' | '1Y' | 'Max';

export const RANGES: Range[] = ['7D', '1M', '3M', '1Y', 'Max'];

const RANGE_DAYS: Record<Range, number> = {
  '7D': 7, '1M': 31, '3M': 92, '1Y': 366, Max: Infinity,
};

export type Series = { points: [string, number][]; firstDate: string | null; total: number };

/**
 * Load only the year shards a range actually needs.
 *
 * This is why history is sharded by year: 1Y is one ~9KB file, while Max on a
 * currency is 28 files and 372KB. Making the reader pay only for the range it
 * asked for is the whole return on that layout.
 */
export async function loadSeries(assetId: string, range: Range): Promise<Series> {
  const slug = historySlug(assetId);
  const index = await fetchJson<HistoryIndex>(dataUrl(`history/${slug}/index.json`));
  if (!index || index.years.length === 0) return { points: [], firstDate: null, total: 0 };

  const days = RANGE_DAYS[range];
  const cutoff = days === Infinity
    ? null
    : new Date(Date.now() - days * 86_400_000).toISOString().slice(0, 10);

  const wanted = cutoff === null
    ? index.years
    // A range can straddle a year boundary, so keep every year at or after the
    // cutoff's year — never just the current one.
    : index.years.filter((y) => y >= cutoff.slice(0, 4));

  const shards = await Promise.all(
    wanted.map((y) => fetchJson<HistoryShard>(dataUrl(`history/${slug}/${y}.json`))),
  );

  const points: [string, number][] = [];
  for (const shard of shards) {
    for (const [date, close] of shard?.points ?? []) {
      if (cutoff === null || date >= cutoff) points.push([date, close]);
    }
  }
  points.sort((a, b) => a[0].localeCompare(b[0]));

  return { points, firstDate: index.firstDate, total: index.count };
}

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    return res.ok ? ((await res.json()) as T) : null;
  } catch {
    // Offline, or a series that does not exist yet. Both render as "no chart".
    return null;
  }
}
