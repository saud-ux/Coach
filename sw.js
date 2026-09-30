// offline support: cache the app shell and images; the coach needs the network
const CACHE = 'referee-coach-v10';
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

// reminders pushed from the server
self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'جدول الحكم', {
    body: d.body || '',
    icon: '/icon-192.png',
    badge: '/icon-192.png',
    tag: d.tag || 'coach',
    lang: 'ar',
    dir: 'rtl',
    data: { url: d.url || '/' }
  }));
});
// tapping one opens the app on the right tab instead of a second copy
self.addEventListener('notificationclick', e => {
  e.notification.close();
  const target = (e.notification.data && e.notification.data.url) || '/';
  e.waitUntil(clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    for (const c of list) if (c.url.startsWith(self.location.origin) && 'focus' in c) { c.navigate(target); return c.focus(); }
    return clients.openWindow(target);
  }));
});
