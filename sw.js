// Service Worker - 体测宝离线缓存
const CACHE = 'tiance-bao-v1';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './scoring_tables.js',
    './manifest.json'
];

self.addEventListener('install', (e) => {
    e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).catch(()=>{}));
    self.skipWaiting();
});

self.addEventListener('activate', (e) => {
    e.waitUntil(
        caches.keys().then(keys => 
            Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
        )
    );
    self.clients.claim();
});

self.addEventListener('fetch', (e) => {
    if (e.request.method !== 'GET') return;
    e.respondWith(
        caches.match(e.request).then(cached => {
            const fetchPromise = fetch(e.request).then(response => {
                if (response && response.status === 200 && response.type === 'basic') {
                    const clone = response.clone();
                    caches.open(CACHE).then(c => c.put(e.request, clone)).catch(()=>{});
                }
                return response;
            }).catch(() => cached);
            return cached || fetchPromise;
        })
    );
});
