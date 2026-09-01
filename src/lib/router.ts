import { useEffect, useState } from 'preact/hooks';
import { BASE } from './data.ts';

/**
 * A ~40-line history router.
 *
 * Real paths rather than hash routes, for two reasons: the hash is reserved for
 * the watchlist link (#w=...), and a shared /a/fx-eur URL should be a real URL.
 * GitHub Pages has no server-side rewrite, so scripts/build-pages.mjs copies
 * index.html to 404.html — Pages serves that for any unknown path, and the app
 * then reads the real location and renders the right screen.
 */

export type Route =
  | { name: 'overview' }
  | { name: 'convert' }
  | { name: 'search' }
  | { name: 'asset'; slug: string };

export function parseRoute(pathname: string): Route {
  const path = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname.replace(/^\//, '');
  const segments = path.split('/').filter(Boolean);
  if (segments[0] === 'convert') return { name: 'convert' };
  if (segments[0] === 'search') return { name: 'search' };
  if (segments[0] === 'a' && segments[1]) return { name: 'asset', slug: segments[1] };
  return { name: 'overview' };
}

export function href(route: Route): string {
  switch (route.name) {
    case 'convert': return `${BASE}convert`;
    case 'search': return `${BASE}search`;
    case 'asset': return `${BASE}a/${route.slug}`;
    default: return BASE;
  }
}

export function navigate(route: Route): void {
  history.pushState(null, '', href(route));
  dispatchEvent(new PopStateEvent('popstate'));
  // A route change is a new screen; the browser does not reset scroll for
  // pushState the way it does for a real navigation.
  scrollTo(0, 0);
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(location.pathname));
  useEffect(() => {
    const update = () => setRoute(parseRoute(location.pathname));
    addEventListener('popstate', update);
    return () => removeEventListener('popstate', update);
  }, []);
  return route;
}

/** Intercept plain left-clicks so in-app links do not trigger a full page load. */
export function linkProps(route: Route) {
  return {
    href: href(route),
    onClick: (e: MouseEvent) => {
      if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
      e.preventDefault();
      navigate(route);
    },
  };
}
