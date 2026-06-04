// Pixory Admin Service Worker — v1.0 (Admin v3.3)
// หน้าที่เดียว: รับ web push สำหรับแอดมิน (แชท Inbox · แจ้งเตือนอื่นในอนาคต)
// ⚠️ ไม่มี cache/fetch handler โดยเจตนา — admin ต้องสดเสมอ
// ⚠️ ลงทะเบียนด้วย scope './pixory-admin-push/' (โฟลเดอร์ไม่ต้องมีจริง)
//    เพื่อไม่ชนกับ sw.js (มือถือ) ที่คุม scope './' อยู่

self.addEventListener('install', () => { self.skipWaiting(); });
self.addEventListener('activate', (event) => { event.waitUntil(self.clients.claim()); });

self.addEventListener('push', (event) => {
  let payload = { title: 'Pixory Admin', body: 'มีการแจ้งเตือนใหม่' };
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
    tag: payload.tag || 'pixory-admin-' + Date.now(),
    renotify: true,
    requireInteraction: true,
    data: { url: payload.url || './admin.html' }
  };
  event.waitUntil(self.registration.showNotification(payload.title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  // scope = .../pixory-admin-push/ → admin.html อยู่หนึ่งชั้นเหนือ scope
  let raw = (event.notification.data && event.notification.data.url) || './admin.html';
  if (!raw || raw === './' || raw === '/') raw = './admin.html';
  let target;
  try { target = new URL('../' + String(raw).replace(/^[./]+/, ''), self.registration.scope).href; }
  catch (e) { target = new URL('../admin.html', self.registration.scope).href; }
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
      for (const c of clientList) {
        if (c.url && c.url.indexOf('admin.html') > -1 && 'focus' in c) return c.focus();
      }
      if (self.clients.openWindow) return self.clients.openWindow(target);
    })
  );
});
