/*
 * Reminder layers (see spec "Reminders and notifications"):
 *   1. app icon badge   2. sticky notification   3. periodic background check
 *   4. calendar alarm (.ics)
 * Only marking the day read ends the loop.
 */

export const NOTIFICATION_TAG = 'daily-blessing';
export const PERIODIC_TAG = 'daily-blessing-check';
const TWELVE_HOURS = 12 * 60 * 60 * 1000;

/* ---------- Capabilities ---------- */

export function notificationsSupported() {
  return typeof window !== 'undefined' && 'Notification' in window && 'serviceWorker' in navigator;
}

/** 'granted' | 'denied' | 'default' | 'unsupported' */
export function permissionState() {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

export function isIOS() {
  const ua = navigator.userAgent || '';
  // iPadOS reports itself as a Mac; touch support tells them apart.
  return /iPad|iPhone|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  return (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
    navigator.standalone === true;
}

/* ---------- Permission ---------- */

export async function requestPermission() {
  if (!notificationsSupported()) return 'unsupported';
  if (Notification.permission !== 'default') return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch (_) {
    // Very old Safari only supports the callback form.
    return new Promise((resolve) => Notification.requestPermission(resolve));
  }
}

/* ---------- Badge (layer 1) ---------- */

export async function setBadge(on) {
  try {
    if (on && 'setAppBadge' in navigator) await navigator.setAppBadge(1);
    else if (!on && 'clearAppBadge' in navigator) await navigator.clearAppBadge();
  } catch (_) { /* not installed or not allowed: badges are best effort */ }
}

/* ---------- Notification (layer 2) ---------- */

async function registration() {
  if (!('serviceWorker' in navigator)) return null;
  try {
    return await navigator.serviceWorker.ready;
  } catch (_) {
    return null;
  }
}

export async function showDailyNotification({ title, body, date }, { force = false } = {}) {
  if (permissionState() !== 'granted') return false;
  const reg = await registration();
  if (!reg) return false;
  if (!force) {
    // Already showing today's notification: leave it in place, don't re-alert.
    const open = await reg.getNotifications({ tag: NOTIFICATION_TAG });
    if (open.some((n) => n.data && n.data.date === date)) return true;
  }
  await reg.showNotification(title, {
    body,
    tag: NOTIFICATION_TAG,
    renotify: false,
    requireInteraction: true,
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: { date, url: './#today' },
    actions: [{ action: 'mark-read', title: 'Mark as read' }],
  });
  return true;
}

export async function closeDailyNotification() {
  const reg = await registration();
  if (!reg) return;
  const open = await reg.getNotifications({ tag: NOTIFICATION_TAG });
  open.forEach((n) => n.close());
}

export async function showTestNotification(name) {
  if (permissionState() !== 'granted') return false;
  const reg = await registration();
  if (!reg) return false;
  await reg.showNotification('Test reminder', {
    body: `Reminders for ${name || 'your little one'} are working.`,
    tag: 'daily-blessing-test',
    icon: './icons/icon-192.png',
    badge: './icons/badge-96.png',
    data: { url: './#settings' },
  });
  return true;
}

/* ---------- Periodic background check (layer 3) ---------- */

export async function registerPeriodicCheck() {
  const reg = await registration();
  if (!reg || !('periodicSync' in reg)) return 'unsupported';
  try {
    if (navigator.permissions) {
      const status = await navigator.permissions.query({ name: 'periodic-background-sync' });
      if (status.state !== 'granted') return status.state;
    }
    await reg.periodicSync.register(PERIODIC_TAG, { minInterval: TWELVE_HOURS });
    return 'registered';
  } catch (_) {
    return 'unavailable';
  }
}

export async function unregisterPeriodicCheck() {
  const reg = await registration();
  if (reg && 'periodicSync' in reg) {
    try { await reg.periodicSync.unregister(PERIODIC_TAG); } catch (_) { /* ignore */ }
  }
}

/* ---------- Bring the reminder layers in line with today's state ---------- */

/**
 * unread: today has not been read; active: the plan is running today.
 * Shows the badge and notification while unread, clears them once read.
 */
export async function syncReminders({ unread, active, notification }) {
  if (active && unread) {
    await setBadge(true);
    if (notification) await showDailyNotification(notification);
  } else {
    await setBadge(false);
    await closeDailyNotification();
  }
}

/* ---------- Calendar alarm (layer 4) ---------- */

/** Escape text for an iCalendar TEXT value (RFC 5545 §3.3.11). */
export function icsEscape(text) {
  return String(text).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold lines longer than 75 octets (RFC 5545 §3.1), never splitting a UTF-8 character. */
export function icsFold(line) {
  const enc = new TextEncoder();
  if (enc.encode(line).length <= 75) return line;
  const parts = [];
  let current = '';
  let bytes = 0;
  for (const ch of line) {
    const size = enc.encode(ch).length;
    const limit = parts.length === 0 ? 75 : 74; // continuation lines start with a space
    if (bytes + size > limit) {
      parts.push(current);
      current = '';
      bytes = 0;
    }
    current += ch;
    bytes += size;
  }
  parts.push(current);
  return parts.join('\r\n ');
}

function utcStamp(d) {
  return d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

/**
 * A daily repeating event at the reminder time (floating local time, so it
 * rings at that clock time wherever the parent is), with a display alarm.
 */
export function buildICS({ name, reminderTime, startDate, appUrl, uidSeed = startDate, now = new Date() }) {
  const [hh, mm] = reminderTime.split(':');
  const start = `${startDate.replace(/-/g, '')}T${hh}${mm}00`;
  const who = name || 'your little one';
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Newborn Daily Blessing//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    // Stable per profile, so re-adding after a time change updates the event.
    `UID:daily-blessing-${String(uidSeed).replace(/[^0-9A-Za-z]/g, '')}@newborn-daily-blessing`,
    `DTSTAMP:${utcStamp(now)}`,
    `DTSTART:${start}`,
    'DURATION:PT10M',
    'RRULE:FREQ=DAILY',
    `SUMMARY:${icsEscape(`Daily blessing for ${who}`)}`,
    `DESCRIPTION:${icsEscape(`Today's verse and prayer for ${who}. Open the app: ${appUrl}`)}`,
    `URL:${icsEscape(appUrl)}`,
    'TRANSP:TRANSPARENT',
    'BEGIN:VALARM',
    'ACTION:DISPLAY',
    `DESCRIPTION:${icsEscape(`A verse and a prayer for ${who} are waiting.`)}`,
    'TRIGGER:PT0M',
    'END:VALARM',
    'END:VEVENT',
    'END:VCALENDAR',
  ];
  return lines.map(icsFold).join('\r\n') + '\r\n';
}

/** Hand the .ics to the browser; the OS offers to add it to a calendar. */
export function downloadICS(ics, filename = 'daily-blessing-reminder.ics') {
  const blob = new Blob([ics], { type: 'text/calendar;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}
