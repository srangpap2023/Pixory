// Pixory Service Worker — v2.9.24
// Strategy:
//   - HTML (navigation): network-first, fall back to cache when offline
//   - Other assets: cache-first, update in background ("stale-while-revalidate")
//   - Supabase API calls: never cache (live data only)
// NOTE: bump CACHE_NAME on every release so old caches are evicted on activate

const CACHE_NAME = 'pixory-v2.9.30';
const PRECACHE_URLS = [
  './',
  './index.html',
  './pixory-helpers.js',
  './manifest.json',
  './icon-192.png',
  './icon-512.png',
];

self.addEventListener('install', (event) => {
  // Pre-cache the essentials so the app boots offline
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch((err) => console.warn('precache miss:', url, err.message))
        )
      );
    })
  );
  // Activate immediately on next reload after this SW installs
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  // Clean up old caches
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys.filter((k) => k.startsWith('pixory-v') && k !== CACHE_NAME).map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const request = event.request;

  // Only handle GET
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Never cache Supabase API calls (live cloud data)
  if (url.hostname.includes('supabase.co')) return;

  // Never cache CDN scripts dynamically (let browser handle)
  // (they are already cached by HTTP cache headers)
  if (url.hostname.includes('cdnjs.cloudflare.com') || url.hostname.includes('cdn.jsdelivr.net')) return;

  // Detect navigation/HTML requests
  const isHTML =
    request.mode === 'navigate' ||
    (request.headers.get('accept') || '').includes('text/html');

  if (isHTML) {
    // Network-first for HTML → ensures users see latest version when online
    event.respondWith(
      fetch(request)
        .then((response) => {
          // Stash the fresh copy
          if (response && response.status === 200) {
            const clone = response.clone();
            caches.open(CACHE_NAME).then((cache) => cache.put(request, clone));
          }
          return response;
        })
        .catch(() => {
          // Offline → use cache
          return caches.match(request).then((cached) => cached || caches.match('./'));
        })
    );
    return;
  }

  // Cache-first for everything else (images, fonts, etc.)
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

// Listen for "skipWaiting" messages from the app (for forced updates)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

// ========== v2.1 · Web Push Notifications ==========
// Payload contract (sent by Supabase Edge Function):
//   { title: string, body: string, tag?: string, url?: string, icon?: string }

self.addEventListener('push', (event) => {
  let payload = { title: 'Pixory', body: 'มีการแจ้งเตือนใหม่' };
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
    tag: payload.tag || 'pixory-' + Date.now(),
    renotify: true,
    requireInteraction: true, // v2.5.68 · ไม่ปัดทิ้งเอง · ผู้ใช้ต้องกดเอง (ประกาศจะไม่หายก่อนอ่าน)
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // v2.5.68 · resolve against the app's real base · กัน absolute '/' ที่ชี้ origin root → 404 (host แบบ subpath)
  let target = (event.notification.data && event.notification.data.url) || './';
  try { target = new URL(String(target).replace(/^\/+/, './'), self.registration.scope).href; }
  catch (e) { target = self.registration.scope; }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      // Focus existing window if already open
      for (const c of clientList) {
        if ('focus' in c) {
          if (target && target !== './') {
            try { c.navigate(target); } catch (e) { /* some browsers disallow */ }
          }
          return c.focus();
        }
      }
      // Otherwise open new
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});

// When subscription expires (rare · happens on browser/device changes) · re-subscribe silently
self.addEventListener('pushsubscriptionchange', (event) => {
  // Just log · client will resubscribe on next app open via ensurePushSubscription()
  console.warn('[sw] push subscription changed · client will re-subscribe on next launch');
});
