// offline support: cache the app shell and images; the coach needs the network
const CACHE = 'referee-coach-v8';
self.addEventListener('install', e => { e.waitUntil(caches.open(CACHE).then(c => c.addAll(['/', '/index.html', '/manifest.webmanifest', '/icon-192.png']))); self.skipWaiting(); });
self.addEventListener('activate', e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== CACHE).map(k => caches.delete(k))))); self.clients.claim(); });
self.addEventListener('fetch', e => {
  const u = new URL(e.request.url);
  if (e.request.method !== 'GET' || u.pathname.startsWith('/api/')) return;
  if (u.origin === location.origin && (u.pathname === '/' || u.pathname.endsWith('.html'))) {
    e.respondWith(fetch(e.request).then(r => { const c = r.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); return r; }).catch(() => caches.match(e.request).then(r => r || caches.match('/index.html'))));
    return;
  }
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => { if (res.ok && (u.origin === location.origin || u.hostname.includes('fonts.g'))) { const c = res.clone(); caches.open(CACHE).then(x => x.put(e.request, c)); } return res; })));
});
