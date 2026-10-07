// Shell only: never store API responses, customer images, orders or sessions.
const CACHE_PREFIX = 'taller-ot-v2:';
const CACHE_NAME = `${CACHE_PREFIX}shell-v1`;
const BASE = self.registration.scope;
const ASSETS = [
    'index.html', 'styles.css', 'config.js', 'manifest.json',
    'assets/utilities.css', 'assets/icons.css', 'assets/supabase.js',
    'icons/icon-192.png', 'icons/icon-512.png'
].map(path => new URL(path, BASE).href);

self.addEventListener('install', event => {
    event.waitUntil(caches.open(CACHE_NAME).then(cache => cache.addAll(ASSETS)));
    // No forced activation: an open tab keeps its matching shell version.
});

self.addEventListener('activate', event => {
    event.waitUntil((async () => {
        const names = await caches.keys();
        await Promise.all(names.filter(name => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
            .map(name => caches.delete(name)));
        await self.clients.claim();
    })());
});

self.addEventListener('fetch', event => {
    const request = event.request;
    const url = new URL(request.url);
    if (request.method !== 'GET' || request.headers?.has('authorization') ||
        url.origin !== self.location.origin || !url.href.startsWith(BASE)) return;

    // Only the actual entry routes get a shell fallback; queries are never cache keys.
    const entry = url.pathname === new URL(BASE).pathname ||
        url.pathname === new URL('index.html', BASE).pathname;
    if (request.mode === 'navigate' && entry) {
        event.respondWith(fetch(request).catch(async () =>
            (await caches.open(CACHE_NAME)).match(new URL('index.html', BASE).href)));
        return;
    }
    if (url.search || !ASSETS.includes(url.href)) return;
    // Configuration is network-first so a stale cached setup cannot override an update.
    if (url.href === new URL('config.js', BASE).href) {
        event.respondWith(fetch(request).catch(async () =>
            (await caches.open(CACHE_NAME)).match(url.href)));
        return;
    }
    event.respondWith((async () =>
        (await (await caches.open(CACHE_NAME)).match(url.href)) || fetch(request))());
});
