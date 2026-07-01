// Pixory Desktop Service Worker — v1.1.5
// Mirrors mobile sw.js but with separate cache so the two apps don't collide.
// Strategy:
//   - HTML (navigation): network-first, fall back to cache when offline
//   - Other assets: cache-first, update in background ("stale-while-revalidate")
//   - Supabase API calls: never cache (live data only)
// NOTE: bump CACHE_NAME on every release so old caches are evicted on activate

const CACHE_NAME = 'pixory-desktop-v1.1.51';
const PRECACHE_URLS = [
  './desktop.html',
  './pixory-helpers.js',
  './manifest-desktop.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('precache miss:', url, err.message))
        )
      );
    })
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        // Only delete our OWN old desktop caches · never touch mobile's pixory-vX.Y.Z caches
        keys
          .filter((k) => k.startsWith('pixory-desktop-') && k !== CACHE_NAME)
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase API calls (live cloud data)
  if (url.hostname.includes('supabase.co')) return;

  // Never cache CDN scripts dynamically (browser HTTP cache handles)
  if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cdn.jsdelivr.net')) return;

  // Never cache fonts CDN (Google Fonts)
  if (url.hostname.includes('fonts.googleapis.com') || url.hostname.includes('fonts.gstatic.com')) return;

  const isHTML =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first for HTML → ensures users see latest version when online
    event.respondWith(
      fetch(request)
        .then((response) => {
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          return caches.match(request).then((cached) => cached || caches.match('./desktop.html'));
        })
    );
    return;
  }

  // Cache-first for everything else (images, etc.)
  event.respondWith(
    caches.match(request).then((cached) => {
      const fetchPromise = fetch(request)
        .then((response) => {
          if (response && response.status === 200 && response.type !== 'opaque') {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => cached);
      return cached || fetchPromise;
    })
  );
});

// Listen for "skipWaiting" messages from the app (forced updates)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ========== Web Push Notifications (same contract as mobile) ==========
self.addEventListener('push', (event) => {
  let payload = { title: 'Pixory Desktop', body: 'มีการแจ้งเตือนใหม่' };
  try {
    if (event.data) {
      const text = event.data.text();
      try { payload = Object.assign(payload, JSON.parse(text)); }
      catch (e) { payload.body = text; }
    }
  } catch (e) { /* swallow */ }

  const options = {
    body: payload.body,
    icon: payload.icon || './icon-192.png',
    badge: './icon-192.png',
    tag: payload.tag || 'pixory-desktop-' + Date.now(),
    renotify: true,
    requireInteraction: true, // v1.0.45 · ไม่ปัดทิ้งเอง · ผู้ใช้ต้องกดเอง (ประกาศจะไม่หายก่อนอ่าน)
    data: { url: payload.url || './desktop.html' }
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // v1.0.45 · ฝั่ง desktop · ถ้า url เป็น home กลางๆ ('./' หรือ '/') → เปิด desktop.html (ไม่ใช่ index.html มือถือ)
  let raw = (event.notification.data && event.notification.data.url) || '';
  if (!raw || raw === './' || raw === '/') raw = './desktop.html';
  // resolve against the app's real base · กัน absolute '/' ที่ชี้ origin root → 404 (host แบบ subpath)
  let target;
  try { target = new URL(String(raw).replace(/^\/+/, './'), self.registration.scope).href; }
  catch (e) { target = self.registration.scope; }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if ('focus' in c) {
          if (target) {
            try { c.navigate(target); } catch (e) { /* ignore */ }
          }
          return c.focus();
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('pushsubscriptionchange', (event) => {
  console.warn('[sw-desktop] push subscription changed · client will re-subscribe on next launch');
});
