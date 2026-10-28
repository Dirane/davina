/*
 * Service worker: offline cache, background reminder check, notification actions.
 * Classic worker (not a module) so it runs in every browser that has service workers.
 *
 * RELEASE: bump CACHE_VERSION on every deploy, and list any new file in PRECACHE.
 */
importScripts('./js/days.js', './js/db.js');

const CACHE_VERSION = 'blessing-v2';
const CACHE_PREFIX = 'blessing-';
const NOTIFICATION_TAG = 'daily-blessing';
const PERIODIC_TAG = 'daily-blessing-check';

const PRECACHE = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/ui.js',
  './js/reminders.js',
  './js/days.js',
  './js/db.js',
  './data/days.json',
  './fonts/lora-400.woff2',
  './fonts/inter-400.woff2',
  './fonts/inter-600.woff2',
  './icons/favicon-32.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/maskable-512.png',
  './icons/apple-touch-icon-180.png',
  './icons/badge-96.png',
];

const D = self.NBDays;
const DB = self.NBDB;

/* ---------- Lifecycle ---------- */

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE_VERSION);
    // cache: 'reload' skips the HTTP cache, so a release never stores stale files.
    await cache.addAll(PRECACHE.map((url) => new Request(url, { cache: 'reload' })));
  })());
  // No skipWaiting here: the page shows "Update available" and the parent chooses.
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_VERSION)
      .map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

/* ---------- Fetch: cache first for everything the app owns ---------- */

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      const cache = await caches.open(CACHE_VERSION);
      const cached = (await cache.match(request, { ignoreSearch: true })) || (await cache.match('./index.html'));
      if (cached) return cached;
      try {
        return await fetch(request);
      } catch (_) {
        return new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain' } });
      }
    })());
    return;
  }

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_VERSION);
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    try {
      return await fetch(request);
    } catch (_) {
      return new Response('', { status: 504, statusText: 'Offline' });
    }
  })());
});

/* ---------- Reminder check (periodic background sync) ---------- */

async function themeFor(n) {
  try {
    const res = await caches.match('./data/days.json');
    if (!res) return null;
    const days = await res.json();
    const entry = days.find((d) => d.day === D.contentIndex(n));
    return entry ? entry.theme : null;
  } catch (_) {
    return null;
  }
}

async function setBadge(on) {
  try {
    if (on && 'setAppBadge' in self.navigator) await self.navigator.setAppBadge(1);
    else if (!on && 'clearAppBadge' in self.navigator) await self.navigator.clearAppBadge();
  } catch (_) { /* best effort */ }
}

async function closeDailyNotifications() {
  const open = await self.registration.getNotifications({ tag: NOTIFICATION_TAG });
  open.forEach((n) => n.close());
}

/**
 * If today is unread (and the reminder time has passed), show the badge and
 * the sticky notification. If it is read, clear both.
 */
async function reminderCheck() {
  const profile = await DB.getProfile();
  if (!profile) {
    await setBadge(false);
    return;
  }
  const today = D.effectiveToday(profile.lastSeenDate);
  if (!profile.lastSeenDate || today > profile.lastSeenDate) {
    await DB.updateProfile({ lastSeenDate: today });
  }
  const n = D.dayNumber(profile.startDate, today);
  const complete = n > D.PLAN_LENGTH && !profile.continued;
  const read = await DB.getRead(today);
  if (read || complete) {
    await setBadge(false);
    await closeDailyNotifications();
    return;
  }
  await setBadge(true);
  if (!D.isReminderDue(profile.reminderTime)) return;
  if (self.Notification && self.Notification.permission !== 'granted') return;

  const open = await self.registration.getNotifications({ tag: NOTIFICATION_TAG });
  if (open.some((x) => x.data && x.data.date === today)) return;
  const theme = (await themeFor(n)) || 'Daily blessing';
  const { title, body } = D.notificationText(n, theme, profile.name);
  await self.registration.showNotification(title, {
    body,
    tag: NOTIFICATION_TAG,
    renotify: false,
    requireInteraction: true,
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: { date: today, url: './#today' },
    actions: [{ action: 'mark-read', title: 'Mark as read' }],
  });
}

self.addEventListener('periodicsync', (event) => {
  if (event.tag === PERIODIC_TAG) event.waitUntil(reminderCheck());
});

/* ---------- Notification taps ---------- */

async function markReadFromNotification(data) {
  const profile = await DB.getProfile();
  if (!profile) return;
  const date = (data && D.isDateString(data.date)) ? data.date : D.effectiveToday(profile.lastSeenDate);
  await DB.markRead(date, D.dayNumber(profile.startDate, date));
  const today = D.effectiveToday(profile.lastSeenDate);
  if (date === today) {
    await setBadge(false);
    await closeDailyNotifications();
  }
  DB.broadcast({ type: 'data-changed', source: 'sw' });
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  windows.forEach((client) => client.postMessage({ type: 'data-changed' }));
}

async function openApp(hash) {
  const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
  const scope = self.registration.scope;
  const existing = windows.find((client) => client.url.startsWith(scope));
  if (existing) {
    existing.postMessage({ type: 'navigate', hash });
    return existing.focus();
  }
  return self.clients.openWindow(new URL(hash, scope).href);
}

self.addEventListener('notificationclick', (event) => {
  const { notification } = event;
  notification.close();
  if (event.action === 'mark-read') {
    event.waitUntil(markReadFromNotification(notification.data));
    return;
  }
  const url = notification.data && notification.data.url;
  const hash = typeof url === 'string' && url.includes('#') ? url.slice(url.indexOf('#')) : '#today';
  event.waitUntil(openApp(hash));
});
