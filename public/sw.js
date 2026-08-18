/**
 * Nimbaa thin-offline service worker (Phase 4).
 *  - Hashed build assets (/_next/static, images, fonts): cache-first.
 *  - Page navigations: network-first, falling back to the last cached copy
 *    of that page (then the home page) so the app still boots offline.
 * Cross-origin requests (Supabase, map tiles) are left untouched.
 */
const STATIC_CACHE = 'nimbaa-static-v2'; // v2: manual screenshots re-shot under the same names
const PAGE_CACHE = 'nimbaa-pages-v1';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keep = [STATIC_CACHE, PAGE_CACHE];
      for (const key of await caches.keys()) {
        if (!keep.includes(key)) await caches.delete(key);
      }
      await self.clients.claim();
    })(),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const isStatic =
    url.pathname.startsWith('/_next/static/') ||
    /\.(png|jpg|jpeg|svg|ico|webp|woff2?)$/.test(url.pathname);

  if (isStatic) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC_CACHE);
        const hit = await cache.match(request);
        if (hit) return hit;
        const res = await fetch(request);
        if (res.ok) cache.put(request, res.clone());
        return res;
      })(),
    );
    return;
  }

  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(request);
          if (res.ok) {
            const cache = await caches.open(PAGE_CACHE);
            cache.put(request, res.clone());
          }
          return res;
        } catch {
          const cached = await caches.match(request, { cacheName: PAGE_CACHE });
          if (cached) return cached;
          const any = await caches.open(PAGE_CACHE).then((c) => c.keys());
          if (any.length > 0) return caches.match(any[0], { cacheName: PAGE_CACHE });
          return new Response(
            '<meta charset="utf-8"><title>Nimbaa</title><p style="font-family:sans-serif;padding:2rem">Hors ligne — cette page n’a pas encore été visitée. Réessayez avec du réseau.</p>',
            { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } },
          );
        }
      })(),
    );
  }
});
