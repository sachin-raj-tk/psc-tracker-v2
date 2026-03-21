/* PSC Tracker Service Worker v1.2 */
const CACHE_NAME = 'psc-tracker-v3';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/static/js/main.chunk.js',
  '/static/js/bundle.js',
  '/static/js/vendors~main.chunk.js',
  '/manifest.json',
  '/icons/icon-72x72.png',
  '/icons/icon-96x96.png',
  '/icons/icon-128x128.png',
  '/icons/icon-144x144.png',
  '/icons/icon-152x152.png',
  '/icons/icon-192x192.png',
  '/icons/icon-384x384.png',
  '/icons/icon-512x512.png',
];

// ── Module-level alarm state (posted from app on every open / alarm change) ──
let _alarms     = [];  // [{ id, time, enabled, label }]
let _firedToday = {};  // { "YYYY-MM-DD_HH:MM": true }
let _userName   = "Sachin";

// ── Install ──────────────────────────────────────────────────────────────────
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE_ASSETS).catch(() => {})
    ).then(() => self.skipWaiting())
  );
});

// ── Activate — delete old caches ─────────────────────────────────────────────
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE_NAME).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

// ── Message handler — app posts alarm data to SW ──────────────────────────────
self.addEventListener('message', event => {
  const { type, alarms, userName, firedToday } = event.data || {};
  if (type === 'SET_ALARMS') {
    _alarms     = alarms     || [];
    _firedToday = firedToday || {};
    if (userName) _userName = userName;
  }
  if (type === 'MARK_FIRED') {
    _firedToday[event.data.key] = true;
  }
});

// ── Local date/time helpers (SW has no access to app localStorage) ────────────
function localDateStr() {
  const d = new Date();
  return d.getFullYear() + "-" +
    String(d.getMonth() + 1).padStart(2,"0") + "-" +
    String(d.getDate()).padStart(2,"0");
}
function localTimeStr() {
  const d = new Date();
  return String(d.getHours()).padStart(2,"0") + ":" +
    String(d.getMinutes()).padStart(2,"0");
}

// ── Check and fire reminders ──────────────────────────────────────────────────
function checkReminders() {
  if (!_alarms.length) return;
  const dateStr = localDateStr();
  const timeStr = localTimeStr();

  for (const alarm of _alarms) {
    if (!alarm.enabled) continue;
    if (alarm.time !== timeStr) continue;
    const days  = alarm.days || [0,1,2,3,4,5,6];
    const jsDay = new Date().getDay();
    if (!days.includes(jsDay)) continue;
    const key = dateStr + "_" + alarm.time;
    if (_firedToday[key]) continue;

    // Mark fired immediately to prevent double-fire
    _firedToday[key] = true;

    // Prune old keys (keep only today + yesterday)
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);
    const ydStr = yesterday.getFullYear() + "-" +
      String(yesterday.getMonth() + 1).padStart(2,"0") + "-" +
      String(yesterday.getDate()).padStart(2,"0");
    const pruned = {};
    for (const k of Object.keys(_firedToday)) {
      if (k.startsWith(dateStr) || k.startsWith(ydStr)) pruned[k] = true;
    }
    _firedToday = pruned;

    // Broadcast updated firedToday back to app clients
    self.clients.matchAll({ type: "window" }).then(clients => {
      clients.forEach(c => c.postMessage({ type: "FIRED_UPDATE", firedToday: _firedToday }));
    });

    const ts = Date.now();
    const _notifTitle = alarm.label ? alarm.label : "📚 PSC Tracker";
    self.registration.showNotification(_notifTitle, {
      body:             "Are you studying, " + _userName + "?",
      icon:             "/icons/icon-192x192.png",
      badge:            "/icons/icon-72x72.png",
      tag:              "study-reminder-" + alarm.id,
      requireInteraction: true,
      actions: [
        { action: "yes", title: "✓ Yes, studying!" },
        { action: "no",  title: "✗ No" },
      ],
      data: { alarmId: alarm.id, timestamp: ts, key },
    });
  }
}

// ── Notification click handler ────────────────────────────────────────────────
self.addEventListener('notificationclick', event => {
  event.notification.close();
  const { action } = event;
  const { timestamp } = event.notification.data || {};

  if (action === "yes") {
    // Just dismiss — user is studying
    return;
  }

  // action === "no" or notification body tapped — open app to reason input
  const url = self.registration.scope + "?skipReason=1&ts=" + (timestamp || Date.now());
  event.waitUntil(
    self.clients.matchAll({ type: "window", includeUncontrolled: true }).then(clients => {
      // If app is already open, focus it and send message
      for (const client of clients) {
        if (client.url.includes(self.registration.scope)) {
          client.focus();
          client.postMessage({ type: "SHOW_SKIP_REASON", timestamp: timestamp || Date.now() });
          return;
        }
      }
      // App not open — open it with URL param
      return self.clients.openWindow(url);
    })
  );
});

// ── Fetch — Cache First + reminder check on every fetch ───────────────────────
self.addEventListener('fetch', event => {
  // Check reminders on every network activity (best effort timing)
  checkReminders();

  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET') return;
  if (url.origin !== location.origin && !url.hostname.includes('fonts.g')) return;

  if (request.headers.get('accept')?.includes('text/html')) {
    event.respondWith(
      fetch(request)
        .then(response => {
          const clone = response.clone();
          caches.open(CACHE_NAME).then(c => c.put(request, clone));
          return response;
        })
        .catch(() => caches.match(request).then(r => r || caches.match('/index.html')))
    );
    return;
  }

  event.respondWith(
    caches.match(request).then(cached => {
      if (cached) return cached;
      return fetch(request).then(response => {
        if (!response || response.status !== 200 || response.type === 'opaque') return response;
        const clone = response.clone();
        caches.open(CACHE_NAME).then(c => c.put(request, clone));
        return response;
      }).catch(() => new Response('Offline', { status: 503 }));
    })
  );
});
