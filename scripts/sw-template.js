/**
 * Value service worker.
 *
 * Two policies, and no more than that:
 *
 *   App shell (HTML, JS, CSS, fonts, icons) — cache-first against a versioned
 *   cache, precached on install and swapped atomically on activate.
 *
 *   Data JSON — stale-while-revalidate. The cached numbers paint instantly and
 *   a fresh copy replaces them in the background, which is exactly the shape of
 *   a dashboard where every value already carries its own as_of.
 *
 * There is no Background Sync: iOS does not support it, and pretending otherwise
 * would mean two refresh paths where one of them never runs.
 */

const VERSION = '__VERSION__';
const BASE = '__BASE__';
const SHELL = __SHELL__;

const SHELL_CACHE = `value-shell-${VERSION}`;
const DATA_CACHE = 'value-data';

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      // Individually, so one 404 does not fail the whole install and leave the
      // app with no offline support at all.
      .then((cache) => Promise.all(SHELL.map((url) => cache.add(url).catch(() => {}))))
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((n) => n.startsWith('value-shell-') && n !== SHELL_CACHE)
        .map((n) => caches.delete(n))
    );
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  // Sent by the "New version available" toast.
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (url.pathname.startsWith(`${BASE}data/`)) {
    event.respondWith(staleWhileRevalidate(request));
    return;
  }

  // Any in-app route resolves to the app shell. This is what stops a deep link
  // like /a/fx-eur from showing a browser error page while offline.
  if (request.mode === 'navigate') {
    event.respondWith(
      caches.match(`${BASE}index.html`).then((hit) => hit || fetch(request))
    );
    return;
  }

  event.respondWith(cacheFirst(request));
});

async function cacheFirst(request) {
  const hit = await caches.match(request);
  if (hit) return hit;
  try {
    const response = await fetch(request);
    if (response.ok) (await caches.open(SHELL_CACHE)).put(request, response.clone());
    return response;
  } catch (err) {
    // Offline and never cached. Let the browser render its own failure rather
    // than inventing a fake response.
    throw err;
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(DATA_CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => null);

  // Serve the cached copy immediately when we have one; the fetch above still
  // runs and updates the cache for the next read.
  if (cached) return cached;

  const fresh = await network;
  if (fresh) return fresh;
  return new Response(JSON.stringify({ error: 'offline', assets: [] }), {
    status: 503,
    headers: { 'content-type': 'application/json' },
  });
}
