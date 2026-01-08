/**
 * spettromiao Mobile Webapp - Service Worker
 * Provides offline caching for PWA functionality
 *
 * Note: When served via the Pi loader (pi-loader/index.html), the loader
 * handles caching. This service worker is for direct GitHub Pages access.
 */

const CACHE_NAME = 'spettromiao-mobile-v3';
const STATIC_ASSETS = [
    './',
    './index.html',
    './css/style.css',
    './js/db.js',
    './js/identifier.js',
    './js/sync.js',
    './js/i18n.js',
    './js/app.js',
    './manifest.json',
    './data/library.json',
    './locales/en.json',
    './locales/it.json',
];

// Install event - cache static assets
self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            console.log('Service Worker: Caching static assets');
            return cache.addAll(STATIC_ASSETS);
        })
    );
    // Activate immediately
    self.skipWaiting();
});

// Activate event - clean up old caches
self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys().then((cacheNames) => {
            return Promise.all(
                cacheNames
                    .filter((name) => name !== CACHE_NAME)
                    .map((name) => {
                        console.log('Service Worker: Deleting old cache:', name);
                        return caches.delete(name);
                    })
            );
        })
    );
    // Take control of all pages immediately
    self.clients.claim();
});

// Fetch event - network first, fallback to cache
self.addEventListener('fetch', (event) => {
    const { request } = event;
    const url = new URL(request.url);

    // Skip non-GET requests
    if (request.method !== 'GET') {
        return;
    }

    // Skip cross-origin requests (Pi API calls)
    if (url.origin !== self.location.origin) {
        return;
    }

    // For static assets and pages: network first, fallback to cache
    event.respondWith(
        fetch(request)
            .then((response) => {
                // Clone response before caching
                const responseClone = response.clone();
                caches.open(CACHE_NAME).then((cache) => {
                    cache.put(request, responseClone);
                });
                return response;
            })
            .catch(() => {
                // Network failed, try cache
                return caches.match(request).then((cachedResponse) => {
                    if (cachedResponse) {
                        return cachedResponse;
                    }
                    // Return offline page for navigation requests
                    if (request.mode === 'navigate') {
                        return caches.match('/');
                    }
                    return new Response('Offline', { status: 503 });
                });
            })
    );
});
