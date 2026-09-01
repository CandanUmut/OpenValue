import { useEffect, useState } from 'preact/hooks';
import { Overview } from './screens/Overview.tsx';
import { AssetDetail } from './screens/AssetDetail.tsx';
import { Convert } from './screens/Convert.tsx';
import { Search } from './screens/Search.tsx';
import { IosInstallSheet, useInstallPrompt } from './components/InstallHint.tsx';
import { useSnapshot } from './lib/data.ts';
import { useFavorites, parseWatchlistHash, watchlistHash } from './lib/favorites.ts';
import { linkProps, navigate, useRoute } from './lib/router.ts';
import { timeAgo } from './lib/format.ts';
import type { Snapshot } from './lib/types.ts';

export function App() {
  const route = useRoute();
  const { state, data, error, refresh } = useSnapshot();
  const favorites = useFavorites();
  const { canInstall, install } = useInstallPrompt();
  const [online, setOnline] = useState(navigator.onLine);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    addEventListener('online', update);
    addEventListener('offline', update);
    return () => { removeEventListener('online', update); removeEventListener('offline', update); };
  }, []);

  // "/" focuses search from anywhere on desktop, the way every list-heavy app does.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.key !== '/' || target?.matches('input, textarea, select')) return;
      e.preventDefault();
      navigate({ name: 'search' });
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  const pendingImport = useWatchlistImport();

  if (state === 'loading' && !data) {
    return <main class="shell"><p class="section-empty">Loading market data…</p></main>;
  }
  if (!data) {
    return (
      <main class="shell">
        <p class="section-empty">
          Could not load market data. {error?.message}
        </p>
        <button class="button" type="button" onClick={refresh}>Try again</button>
      </main>
    );
  }

  return (
    <>
      <header class="app-header">
        <a class="wordmark" {...linkProps({ name: 'overview' })}>
          <Mark />
          <span>Value</span>
        </a>
        <div class="header-actions">
          {canInstall && (
            <button class="button button-quiet" type="button" onClick={install}>Install</button>
          )}
          <span class="header-age">{timeAgo(data.generatedAt)}</span>
        </div>
      </header>

      {!online && (
        <p class="offline-bar" role="status">
          Offline — showing data from {timeAgo(data.generatedAt)}
        </p>
      )}

      {pendingImport && (
        <WatchlistImport
          ids={pendingImport.ids} snapshot={data}
          onConfirm={() => { favorites.replaceAll([...favorites.ids, ...pendingImport.ids]); pendingImport.clear(); }}
          onReplace={() => { favorites.replaceAll(pendingImport.ids); pendingImport.clear(); }}
          onCancel={pendingImport.clear}
        />
      )}

      <nav class="tabbar" aria-label="Main">
        <Tab route={{ name: 'overview' }} active={route.name === 'overview' || route.name === 'asset'} label="Overview" />
        <Tab route={{ name: 'convert' }} active={route.name === 'convert'} label="Convert" />
        <Tab route={{ name: 'search' }} active={route.name === 'search'} label="Search" />
      </nav>

      <main class="shell">
        {route.name === 'overview' && (
          <Overview snapshot={data} favorites={favorites.ids} onToggleFavorite={favorites.toggle} />
        )}
        {route.name === 'convert' && <Convert snapshot={data} />}
        {route.name === 'search' && (
          <Search snapshot={data} favorites={favorites.ids} onToggleFavorite={favorites.toggle} />
        )}
        {route.name === 'asset' && (
          <AssetDetail
            slug={route.slug} snapshot={data}
            isFavorite={favorites.ids.includes(route.slug.replace('-', ':'))}
            onToggleFavorite={favorites.toggle}
          />
        )}

        {route.name === 'overview' && favorites.ids.length > 0 && (
          <WatchlistLink ids={favorites.ids} />
        )}

        <Footer snapshot={data} />
      </main>

      <IosInstallSheet />

    </>
  );
}

function Tab({ route, active, label }: {
  route: Parameters<typeof linkProps>[0]; active: boolean; label: string;
}) {
  return (
    <a class="tab" aria-current={active ? 'page' : undefined} {...linkProps(route)}>{label}</a>
  );
}

/**
 * The watchlist link is the entire answer to "no accounts, but I have two
 * devices". The list rides in the URL hash, which browsers never send to a
 * server, so sharing one leaks nothing to us or to a host.
 */
function WatchlistLink({ ids }: { ids: string[] }) {
  const [copied, setCopied] = useState(false);
  const url = `${location.origin}${location.pathname}${watchlistHash(ids)}`;

  return (
    <section class="section watchlist-share">
      <h2 class="section-heading">Your watchlist</h2>
      <p class="section-note">
        Favourites live on this device only. Copy this link to move them to another
        browser, another device, or the installed app — nothing is sent to a server.
      </p>
      <div class="watchlist-actions">
        <button
          class="button" type="button"
          onClick={() => {
            navigator.clipboard.writeText(url).then(
              () => { setCopied(true); setTimeout(() => setCopied(false), 2000); },
              () => { prompt('Copy your watchlist link:', url); },
            );
          }}
        >
          {copied ? 'Copied' : 'Copy watchlist link'}
        </button>
        <a
          class="button button-quiet"
          download="value-watchlist.json"
          href={`data:application/json,${encodeURIComponent(
            JSON.stringify({ app: 'value', version: 1, favorites: ids }, null, 2),
          )}`}
        >
          Export JSON
        </a>
      </div>
      <code class="watchlist-url">{url}</code>
    </section>
  );
}

function useWatchlistImport() {
  const [ids, setIds] = useState<string[] | null>(() => parseWatchlistHash(location.hash));

  useEffect(() => {
    const onHash = () => setIds(parseWatchlistHash(location.hash));
    addEventListener('hashchange', onHash);
    return () => removeEventListener('hashchange', onHash);
  }, []);

  if (!ids) return null;
  return {
    ids,
    clear: () => {
      history.replaceState(null, '', location.pathname + location.search);
      setIds(null);
    },
  };
}

/** Importing always asks first — silently overwriting a watchlist would be unforgivable. */
function WatchlistImport({ ids, snapshot, onConfirm, onReplace, onCancel }: {
  ids: string[]; snapshot: Snapshot;
  onConfirm: () => void; onReplace: () => void; onCancel: () => void;
}) {
  const known = ids
    .map((id) => snapshot.assets.find((a) => a.id === id)?.symbol)
    .filter(Boolean);

  return (
    <aside class="import-bar" role="alertdialog" aria-label="Import watchlist">
      <p>
        This link carries a watchlist of {ids.length}:{' '}
        <b>{known.join(', ') || 'nothing recognisable'}</b>
      </p>
      <div class="import-actions">
        <button class="button" type="button" onClick={onConfirm}>Merge into mine</button>
        <button class="button button-quiet" type="button" onClick={onReplace}>Replace mine</button>
        <button class="button button-quiet" type="button" onClick={onCancel}>Ignore</button>
      </div>
    </aside>
  );
}

/**
 * Several providers require attribution, but crediting one we have not called
 * would be a false claim about where the numbers came from. Only sources that
 * actually contributed a priced asset are listed.
 */
function contributing(snapshot: Snapshot) {
  const used = new Set(snapshot.assets.filter((a) => a.price !== null).map((a) => a.source));
  return snapshot.attribution.filter((a) => used.has(a.id));
}

function Footer({ snapshot }: { snapshot: Snapshot }) {
  const health = Object.values(snapshot.health);
  const unhealthy = health.filter((h) => h.consecutiveFailures > 0);
  const healthy = health.length - unhealthy.length;

  return (
    <footer class="footer">
      <p class="disclaimer">
        Delayed data, for information only. Not investment advice, and not suitable
        for trading decisions.
      </p>

      <p class="data-health">
        {unhealthy.length === 0
          ? `${healthy} of ${healthy} ${healthy === 1 ? 'provider' : 'providers'} reporting normally.`
          : `${unhealthy.map((h) => h.provider).join(', ')} failing — those values are held at their last good reading.`}
      </p>

      <ul class="attribution">
        {contributing(snapshot).map((a) => (
          <li key={a.name}>
            <a href={a.homepage} rel="noopener noreferrer" target="_blank">{a.text}</a>
          </li>
        ))}
      </ul>
    </footer>
  );
}

function Mark() {
  return (
    <svg class="mark" viewBox="0 0 512 512" width="20" height="20" aria-hidden="true">
      <path d="M120 352 H216 V256 H312 V160 H392" fill="none" stroke="currentColor"
            stroke-width="56" stroke-linecap="round" stroke-linejoin="round" />
    </svg>
  );
}
