/*
 * IndexedDB storage, shared by the page and the service worker.
 *
 * Dual-mode classic script (see days.js): exposes globalThis.NBDB.
 * Database 'newborn-blessing', version 1:
 *   profile  key "me"        { name, startDate, reminderTime, createdAt, lastSeenDate, continued? }
 *   reads    keyPath "date"  { date, dayNumber, readAt }
 */
(function (root) {
  'use strict';

  const DB_NAME = 'newborn-blessing';
  const DB_VERSION = 1;
  const PROFILE_KEY = 'me';
  const BACKUP_VERSION = 1;
  const CHANNEL = 'newborn-blessing';

  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!root.indexedDB) {
        reject(new Error('IndexedDB is not available'));
        return;
      }
      const req = root.indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('profile')) db.createObjectStore('profile');
        if (!db.objectStoreNames.contains('reads')) db.createObjectStore('reads', { keyPath: 'date' });
      };
      req.onsuccess = () => {
        const db = req.result;
        // Let a future version upgrade proceed (e.g. a newer tab or worker).
        db.onversionchange = () => { db.close(); dbPromise = null; };
        db.onclose = () => { dbPromise = null; };
        resolve(db);
      };
      req.onerror = () => { dbPromise = null; reject(req.error); };
      req.onblocked = () => { /* waits for other connections to close */ };
    });
    return dbPromise;
  }

  function done(tx) {
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Transaction aborted'));
    });
  }

  function result(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function getProfile() {
    const db = await open();
    return result(db.transaction('profile').objectStore('profile').get(PROFILE_KEY));
  }

  async function saveProfile(profile) {
    const db = await open();
    const tx = db.transaction('profile', 'readwrite');
    tx.objectStore('profile').put(profile, PROFILE_KEY);
    await done(tx);
    return profile;
  }

  /** Merge fields into the stored profile. */
  async function updateProfile(fields) {
    const db = await open();
    const tx = db.transaction('profile', 'readwrite');
    const store = tx.objectStore('profile');
    const current = await result(store.get(PROFILE_KEY));
    if (!current) throw new Error('No profile');
    const next = Object.assign({}, current, fields);
    store.put(next, PROFILE_KEY);
    await done(tx);
    return next;
  }

  async function getReads() {
    const db = await open();
    return result(db.transaction('reads').objectStore('reads').getAll());
  }

  async function getRead(date) {
    const db = await open();
    return result(db.transaction('reads').objectStore('reads').get(date));
  }

  /**
   * Mark a date read. Idempotent: an existing record keeps its original
   * readAt, so a day read on time can never turn into "read late".
   */
  async function markRead(date, dayNumber, readAt) {
    const db = await open();
    const tx = db.transaction('reads', 'readwrite');
    const store = tx.objectStore('reads');
    const existing = await result(store.get(date));
    const record = existing || { date, dayNumber, readAt: readAt || new Date().toISOString() };
    if (!existing) store.put(record);
    await done(tx);
    return record;
  }

  async function clearAll() {
    const db = await open();
    const tx = db.transaction(['profile', 'reads'], 'readwrite');
    tx.objectStore('profile').clear();
    tx.objectStore('reads').clear();
    await done(tx);
  }

  /** Replace everything in one transaction (used by Import and Start again). */
  async function replaceAll(profile, reads) {
    const db = await open();
    const tx = db.transaction(['profile', 'reads'], 'readwrite');
    const p = tx.objectStore('profile');
    const r = tx.objectStore('reads');
    p.clear();
    r.clear();
    p.put(profile, PROFILE_KEY);
    for (const rec of reads) r.put(rec);
    await done(tx);
  }

  async function exportBackup() {
    const [profile, reads] = await Promise.all([getProfile(), getReads()]);
    if (!profile) throw new Error('Nothing to export yet');
    const out = {
      version: BACKUP_VERSION,
      profile: { name: profile.name, startDate: profile.startDate, reminderTime: profile.reminderTime },
      reads: reads
        .slice()
        .sort((a, b) => (a.date < b.date ? -1 : 1))
        .map((r) => ({ date: r.date, dayNumber: r.dayNumber, readAt: r.readAt })),
    };
    if (profile.continued) out.profile.continued = true;
    if (profile.createdAt) out.profile.createdAt = profile.createdAt;
    if (profile.lastSeenDate) out.profile.lastSeenDate = profile.lastSeenDate;
    return out;
  }

  /**
   * Check a parsed backup file. Returns { ok: true, profile, reads } with
   * clean records ready for replaceAll, or { ok: false, error }.
   */
  function validateBackup(data) {
    const D = root.NBDays;
    const fail = (error) => ({ ok: false, error });
    if (!data || typeof data !== 'object' || Array.isArray(data)) return fail('This is not a backup file.');
    if (data.version !== BACKUP_VERSION) return fail('This backup is from an unsupported version of the app.');
    const p = data.profile;
    if (!p || typeof p !== 'object') return fail('The backup has no profile.');
    const name = D.cleanName(p.name);
    if (!name) return fail('The backup has no baby name.');
    if (!D.isDateString(p.startDate)) return fail('The backup has an invalid start date.');
    const reminderTime = D.isTimeString(p.reminderTime) ? p.reminderTime : '07:00';
    if (!Array.isArray(data.reads)) return fail('The backup has no reading history.');

    const reads = [];
    const seen = new Set();
    for (const r of data.reads) {
      if (!r || !D.isDateString(r.date) || r.date < p.startDate) return fail('The backup has an invalid reading record.');
      if (typeof r.readAt !== 'string' || Number.isNaN(new Date(r.readAt).getTime())) {
        return fail('The backup has an invalid reading time.');
      }
      if (seen.has(r.date)) continue;
      seen.add(r.date);
      reads.push({ date: r.date, dayNumber: D.dayNumber(p.startDate, r.date), readAt: r.readAt });
    }

    const profile = {
      name,
      startDate: p.startDate,
      reminderTime,
      createdAt: typeof p.createdAt === 'string' ? p.createdAt : new Date().toISOString(),
      lastSeenDate: D.isDateString(p.lastSeenDate) ? p.lastSeenDate : p.startDate,
    };
    if (p.continued === true) profile.continued = true;
    return { ok: true, profile, reads };
  }

  /** Tell other tabs and the page (from the worker) that data changed. */
  function broadcast(message) {
    try {
      const ch = new root.BroadcastChannel(CHANNEL);
      ch.postMessage(message);
      ch.close();
    } catch (_) { /* BroadcastChannel unsupported: pages also refresh on focus */ }
  }

  root.NBDB = Object.freeze({
    DB_NAME, CHANNEL, BACKUP_VERSION,
    open, getProfile, saveProfile, updateProfile, getReads, getRead, markRead,
    clearAll, replaceAll, exportBackup, validateBackup, broadcast,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
