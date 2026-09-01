import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { AssetRow } from '../components/AssetRow.tsx';
import type { Snapshot } from '../lib/types.ts';

export function Search({ snapshot, favorites, onToggleFavorite }: {
  snapshot: Snapshot;
  favorites: string[];
  onToggleFavorite: (id: string) => void;
}) {
  const [query, setQuery] = useState('');
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => { input.current?.focus(); }, []);

  const results = useMemo(() => {
    const rows = snapshot.assets.filter((a) => a.price !== null && !a.retired);
    if (!query.trim()) return rows;
    return rows
      .map((row) => ({ row, score: score(query.trim().toLowerCase(), row.symbol, row.name) }))
      .filter((r) => r.score > 0)
      .sort((a, b) => b.score - a.score)
      .map((r) => r.row);
  }, [snapshot, query]);

  return (
    <div class="search">
      <h1 class="screen-title">Search</h1>
      <input
        ref={input} class="search-input" type="search"
        placeholder="Symbol or name — try “gold” or “eur”"
        aria-label="Search assets"
        value={query} onInput={(e) => setQuery((e.target as HTMLInputElement).value)}
      />
      {results.length === 0
        ? <p class="section-empty">Nothing matches “{query}”.</p>
        : (
          <ul class="rows">
            {results.map((row) => (
              <AssetRow
                key={row.id} row={row}
                isFavorite={favorites.includes(row.id)} onToggleFavorite={onToggleFavorite}
              />
            ))}
          </ul>
        )}
    </div>
  );
}

/**
 * Fuzzy match on symbol and name.
 *
 * Deliberately not a fuzzy-search library: with fewer than a hundred assets, a
 * scoring function that prefers prefix matches over substring matches over
 * subsequence matches gives better results than trigram similarity, and costs
 * nothing to ship.
 */
function score(query: string, symbol: string, name: string): number {
  const sym = symbol.toLowerCase();
  const nm = name.toLowerCase();
  if (sym === query) return 100;
  if (sym.startsWith(query)) return 90;
  if (nm.startsWith(query)) return 80;
  if (nm.includes(query)) return 60;
  if (sym.includes(query)) return 50;
  return isSubsequence(query, nm) ? 20 : 0;
}

function isSubsequence(needle: string, haystack: string): boolean {
  let i = 0;
  for (const ch of haystack) if (ch === needle[i]) i++;
  return i === needle.length;
}
