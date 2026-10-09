// Service Worker - 体测宝离线缓存
// v10：网络优先（在线永远拿最新代码），离线才用缓存，彻底解决旧代码不更新问题
const CACHE = 'tiance-bao-v10';
const ASSETS = [
    './',
    './index.html',
    './app.js',
    './scoring_tables.js',
    './advice-knowledge.js',
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
    // 网络优先：在线时一定拿到最新文件，并顺手更新缓存；断网时回退缓存
    e.respondWith(
        fetch(e.request).then(response => {
            if (response && response.status === 200 && response.type === 'basic') {
                const clone = response.clone();
                const u = new URL(e.request.url);
                u.search = '';  // 去掉 ?v=xxx，缓存按干净路径存
                caches.open(CACHE).then(c => c.put(u.toString(), clone)).catch(()=>{});
            }
            return response;
        }).catch(() => caches.match(e.request, { ignoreSearch: true }))
    );
});
