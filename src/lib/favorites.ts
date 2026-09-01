import { useCallback, useEffect, useState } from 'preact/hooks';

/**
 * Favourites, with no accounts and nothing to breach: one localStorage key
 * holding an array of asset ids.
 *
 * Two consequences of having no server, both handled by the shareable link
 * rather than by adding accounts:
 *
 *  1. On iOS an installed PWA gets a storage partition entirely separate from
 *     Safari's, so a watchlist built while browsing does NOT appear after Add to
 *     Home Screen. This is why the install hint appears early, before anyone has
 *     invested in a list.
 *  2. Browsers can evict localStorage under storage pressure or long disuse.
 *
 * The link encodes the list in the URL hash, which never reaches a server.
 */

const KEY = 'value.favorites';

function read(): string[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    // Private mode, disabled storage, or corrupt JSON. An empty watchlist is a
    // fine outcome; a crashed app is not.
    return [];
  }
}

function write(ids: string[]): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(ids));
  } catch {
    // Quota or a blocked store. The list still works for this session.
  }
}

/** Assets are stored as "fx:eur"; the link uses "fx-eur" to stay URL-clean. */
const encodeId = (id: string) => id.replace(/:/g, '-');
const decodeId = (token: string) => token.replace('-', ':');

export function watchlistHash(ids: string[]): string {
  return ids.length ? `#w=${ids.map(encodeId).join(',')}` : '';
}

export function parseWatchlistHash(hash: string): string[] | null {
  const match = /^#w=(.+)$/.exec(hash);
  if (!match) return null;
  return match[1]!.split(',').map(decodeId).filter(Boolean);
}

export function useFavorites() {
  const [ids, setIds] = useState<string[]>(read);

  // Keep tabs in sync. Also the only way a change made in another tab reaches
  // this one, since there is no server to push it.
  useEffect(() => {
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) setIds(read()); };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const toggle = useCallback((id: string) => {
    setIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      write(next);
      return next;
    });
  }, []);

  const replaceAll = useCallback((next: string[]) => {
    // De-duplicate: an imported link merged with an existing list will overlap.
    const unique = [...new Set(next)];
    write(unique);
    setIds(unique);
  }, []);

  return { ids, toggle, replaceAll, has: (id: string) => ids.includes(id) };
}

export function exportJson(ids: string[]): string {
  return JSON.stringify({ app: 'value', version: 1, favorites: ids }, null, 2);
}

export function importJson(text: string): string[] | null {
  try {
    const parsed: unknown = JSON.parse(text);
    const list = (parsed as { favorites?: unknown })?.favorites;
    if (!Array.isArray(list)) return null;
    return list.filter((x): x is string => typeof x === 'string');
  } catch {
    return null;
  }
}
