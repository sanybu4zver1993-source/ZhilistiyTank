const CACHE_NAME = 'veinytank-v5';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './cyberpunk.js',
    './cyberpunk_ai.js',
    './manifest.json',
    './icon.png'
];

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_NAME).then((cache) => {
            return cache.addAll(ASSETS);
        })
    );
});

self.addEventListener('fetch', (event) => {
    event.respondWith(
        caches.match(event.request).then((response) => {
            return response || fetch(event.request);
        })
    );
});
