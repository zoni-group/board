/* ZONI Board service worker template. `build/offline-plugin.js` fills in the
 * version and URL list and emits the result as /sw.js. It is not active in dev. */
/// <reference lib="webworker" />

/** @type {ServiceWorkerGlobalScope} */
const sw = /** @type {any} */ (self);

const VERSION = '__CACHE_VERSION__';
/** @type {string[]} */
const PRECACHE_URLS = ['__PRECACHE_URLS__'];
const PREFIX = 'zoni-board-';
const CACHE = PREFIX + VERSION;
const PRECACHED = new Set(PRECACHE_URLS);
const APP_SHELL = '/index.html';
// Precached files don't depend on request headers; servers may still send `Vary: Origin`.
const MATCH = { ignoreSearch: true, ignoreVary: true };

sw.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) =>
        cache.addAll(PRECACHE_URLS.map((url) => new Request(url, { cache: 'reload' })))
      )
      .then(() => sw.skipWaiting())
  );
});

sw.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      // Keep the previous version too: a page opened before this update may still
      // lazy-load its own hashed chunks (text editor, tables, board files).
      const older = (await caches.keys()).filter((key) => key.startsWith(PREFIX) && key !== CACHE);
      await Promise.all(older.slice(0, -1).map((key) => caches.delete(key)));
      await sw.clients.claim();
    })()
  );
});

/** @param {Request} request @param {string} [url] */
async function cacheFirst(request, url) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(url ?? request, MATCH);
  if (cached) return cached;
  // A page from the previous version may ask for its own older chunks.
  return (await caches.match(request, MATCH)) ?? fetch(request);
}

sw.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== sw.location.origin) return;
  if (request.mode === 'navigate') {
    if (url.pathname === '/' || url.pathname === APP_SHELL)
      event.respondWith(cacheFirst(request, APP_SHELL));
    return;
  }
  if (PRECACHED.has(url.pathname)) event.respondWith(cacheFirst(request));
});
