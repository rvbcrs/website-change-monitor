// DeltaWatch Service Worker
const CACHE_NAME = 'deltawatch-v4';
const STATIC_ASSETS = [
    '/',
    '/manifest.json',
    '/favicon.svg',
    '/logo_128.png',
    '/logo_192.png',
    '/logo_512.png',
    '/apple-touch-icon.png'
];

// Install: Cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(STATIC_ASSETS);
        })
    );
    self.skipWaiting();
});

// Activate: Clean old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => caches.delete(name))
            );
        })
    );
    self.clients.claim();
});

// Fetch: Network-first strategy for API, cache-first for static
self.addEventListener('fetch', (event) => {
    const url = new URL(event.request.url);

    // Skip non-GET requests
    if (event.request.method !== 'GET') return;

    // API and dynamic requests: Network only (no caching)
    if (url.pathname.startsWith('/api') ||
        url.pathname.startsWith('/monitors') ||
        url.pathname.startsWith('/settings') ||
        url.pathname.startsWith('/static') ||
        url.pathname.startsWith('/proxy') ||
        url.pathname.startsWith('/preview-scenario') ||
        url.pathname.startsWith('/run-scenario-live')) {
        return;
    }

    // Static assets: Cache-first
    event.respondWith(
        caches.match(event.request).then((cachedResponse) => {
            if (cachedResponse) {
                return cachedResponse;
            }
            return fetch(event.request).then((response) => {
                // Don't cache non-successful responses
                if (!response || response.status !== 200) {
                    return response;
                }
                // Clone and cache
                const responseToCache = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(event.request, responseToCache);
                });
                return response;
            });
        })
    );
});
