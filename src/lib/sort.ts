import type { AssetRow } from './types.ts';

/**
 * Table sorting.
 *
 * "default" is not a column — it is the editorial order: favourites first, then
 * the provider's own ranking (market-cap rank for crypto, the order the universe
 * declares for everything else). Clicking a column replaces it with an explicit
 * sort, and clicking the active column flips direction.
 */
export type SortKey = 'default' | 'name' | 'price' | 'change24h' | 'change7d' | 'marketCap';
export type SortDir = 'asc' | 'desc';
export type Sort = { key: SortKey; dir: SortDir };

export const DEFAULT_SORT: Sort = { key: 'default', dir: 'desc' };

/** Numeric columns start descending (biggest first); text starts ascending. */
export function nextSort(current: Sort, key: SortKey): Sort {
  if (current.key !== key) return { key, dir: key === 'name' ? 'asc' : 'desc' };
  return { key, dir: current.dir === 'asc' ? 'desc' : 'asc' };
}

export function sortRows(rows: AssetRow[], sort: Sort, favorites: string[]): AssetRow[] {
  const out = [...rows];

  if (sort.key === 'default') {
    return out.sort((a, b) => {
      const fa = favorites.includes(a.id) ? 0 : 1;
      const fb = favorites.includes(b.id) ? 0 : 1;
      if (fa !== fb) return fa - fb;
      return (a.rank ?? Number.MAX_SAFE_INTEGER) - (b.rank ?? Number.MAX_SAFE_INTEGER);
    });
  }

  const sign = sort.dir === 'asc' ? 1 : -1;
  // Narrowed once here; the early return above already handled 'default'.
  const key = sort.key;

  return out.sort((a, b) => {
    if (key === 'name') return sign * a.symbol.localeCompare(b.symbol);

    const va = value(a, key);
    const vb = value(b, key);
    // Nulls always sink, in both directions. A row with no 7d history is not
    // "the smallest change" — it is unknown, and floating it to the top of an
    // ascending sort would read as a fact.
    if (va === null && vb === null) return 0;
    if (va === null) return 1;
    if (vb === null) return -1;
    return sign * (va - vb);
  });
}

function value(row: AssetRow, key: Exclude<SortKey, 'default' | 'name'>): number | null {
  switch (key) {
    case 'price': return row.price;
    case 'change24h': return row.changePct24h;
    case 'change7d': return row.changePct7d;
    case 'marketCap': return row.marketCap;
  }
}
