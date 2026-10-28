/*
 * Date maths, day states, streaks and small shared helpers.
 *
 * Dual-mode classic script: no import/export. Pages load it with
 * `import './days.js'`, the service worker with `importScripts`, and tests
 * with `await import()`. Everything is exposed on globalThis.NBDays.
 *
 * Dates are local calendar dates as 'YYYY-MM-DD' strings. Arithmetic is done
 * on UTC midnights built from the parts, so time zones and daylight saving
 * can never shift a day.
 */
(function (root) {
  'use strict';

  const PLAN_LENGTH = 365;
  const MS_PER_DAY = 86400000;
  const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/;
  const TIME_RE = /^([01]\d|2[0-3]):([0-5]\d)$/;
  const NAME_FALLBACK = 'my little one';
  const NAME_MAX = 30;

  const pad = (n) => String(n).padStart(2, '0');

  /** Local calendar date of a Date (default: now) as YYYY-MM-DD. */
  function toDateString(d) {
    const date = d || new Date();
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  }

  function isDateString(s) {
    if (typeof s !== 'string') return false;
    const m = DATE_RE.exec(s);
    if (!m) return false;
    const y = +m[1], mo = +m[2], d = +m[3];
    const t = new Date(Date.UTC(y, mo - 1, d));
    return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
  }

  function isTimeString(s) {
    return typeof s === 'string' && TIME_RE.test(s);
  }

  function toUTC(s) {
    const m = DATE_RE.exec(s);
    if (!m) throw new TypeError(`Invalid date string: ${s}`);
    return Date.UTC(+m[1], +m[2] - 1, +m[3]);
  }

  function fromUTC(ms) {
    const d = new Date(ms);
    return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
  }

  /** Whole days from a to b (positive when b is later). */
  function daysBetween(a, b) {
    return Math.round((toUTC(b) - toUTC(a)) / MS_PER_DAY);
  }

  function addDays(s, n) {
    return fromUTC(toUTC(s) + n * MS_PER_DAY);
  }

  /** 0 = Sunday … 6 = Saturday. */
  function weekday(s) {
    return new Date(toUTC(s)).getUTCDay();
  }

  /** Day 1 is the start date. */
  function dayNumber(startDate, date) {
    return daysBetween(startDate, date) + 1;
  }

  function dateForDay(startDate, n) {
    return addDays(startDate, n - 1);
  }

  /** Which of the 365 entries to show; the plan repeats after Day 365. */
  function contentIndex(n) {
    return ((((n - 1) % PLAN_LENGTH) + PLAN_LENGTH) % PLAN_LENGTH) + 1;
  }

  /** 1 for the first 365 days, 2 for the next 365, and so on. */
  function cycleNumber(n) {
    return Math.floor((n - 1) / PLAN_LENGTH) + 1;
  }

  /**
   * "Today" for the app: the device's date, unless the clock has gone
   * backwards, in which case the latest date already seen wins.
   */
  function effectiveToday(lastSeenDate, now) {
    const device = toDateString(now);
    if (isDateString(lastSeenDate) && lastSeenDate > device) return lastSeenDate;
    return device;
  }

  /** Local calendar date on which an ISO timestamp happened. */
  function localDateOf(iso) {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return null;
    return toDateString(d);
  }

  /**
   * State of one date: 'future' | 'today' (unread) | 'read' | 'late' | 'missed'.
   * `read` is the reads-store record for that date, or undefined.
   * A read counts as on time when it happened on (or, with a clock that went
   * backwards, before) the date itself.
   */
  function dayState(date, today, read) {
    if (date > today) return 'future';
    if (read && read.readAt) {
      const readDate = localDateOf(read.readAt);
      return readDate && readDate > date ? 'late' : 'read';
    }
    return date === today ? 'today' : 'missed';
  }

  /** Build a Map date -> read record from an array of records. */
  function indexReads(reads) {
    const map = new Map();
    for (const r of reads || []) if (r && r.date) map.set(r.date, r);
    return map;
  }

  /**
   * Totals from Day 1 to today.
   * read: on time + late. missed: past days still unread. streak: consecutive
   * on-time days ending today (or yesterday if today is still unread).
   */
  function summarize(startDate, today, readsMap) {
    let read = 0, late = 0, missed = 0;
    const total = Math.max(0, dayNumber(startDate, today));
    for (let i = 0; i < total; i++) {
      const date = addDays(startDate, i);
      const s = dayState(date, today, readsMap.get(date));
      if (s === 'read') read++;
      else if (s === 'late') late++;
      else if (s === 'missed') missed++;
    }
    return { read: read + late, onTime: read, late, missed, streak: streak(startDate, today, readsMap), days: total };
  }

  function streak(startDate, today, readsMap) {
    let d = today;
    const todayState = dayState(today, today, readsMap.get(today));
    if (todayState !== 'read') d = addDays(today, -1);
    let count = 0;
    while (d >= startDate && dayState(d, today, readsMap.get(d)) === 'read') {
      count++;
      d = addDays(d, -1);
    }
    return count;
  }

  /**
   * Group dates from startDate to today into calendar months for the
   * Journey grid. Each month: { year, month (1-12), lead (blank cells before
   * the first shown date, Sunday-first week), dates: [...] }.
   */
  function monthsForJourney(startDate, today) {
    const months = [];
    if (today < startDate) return months;
    let current = null;
    for (let d = startDate; d <= today; d = addDays(d, 1)) {
      const y = +d.slice(0, 4), m = +d.slice(5, 7);
      if (!current || current.year !== y || current.month !== m) {
        current = { year: y, month: m, lead: weekday(d), dates: [] };
        months.push(current);
      }
      current.dates.push(d);
    }
    return months;
  }

  /** Minutes past local midnight for 'HH:MM'. */
  function minutesOf(time) {
    const m = TIME_RE.exec(time || '');
    return m ? +m[1] * 60 + +m[2] : 0;
  }

  /** True once the local clock has reached the reminder time today. */
  function isReminderDue(reminderTime, now) {
    const d = now || new Date();
    return d.getHours() * 60 + d.getMinutes() >= minutesOf(reminderTime);
  }

  function cleanName(name) {
    return typeof name === 'string' ? name.trim().replace(/\s+/g, ' ').slice(0, NAME_MAX) : '';
  }

  /** Replace {name}; falls back to "my little one", capitalised at sentence start. */
  function fillName(text, name) {
    const n = cleanName(name);
    if (n) return String(text).replace(/\{name\}/g, n);
    return String(text).replace(/([.!?]\s+)?\{name\}/g, (_, lead, offset) =>
      (offset === 0 || lead) ? (lead || '') + 'My little one' : NAME_FALLBACK);
  }

  /** Text for the daily reminder notification (shared by page and worker). */
  function notificationText(n, theme, name) {
    const who = cleanName(name) || NAME_FALLBACK;
    return {
      title: `Day ${contentIndex(n)}: ${theme}`,
      body: `A verse and a prayer for ${who} are waiting.`,
    };
  }

  root.NBDays = Object.freeze({
    PLAN_LENGTH, NAME_MAX, NAME_FALLBACK,
    toDateString, isDateString, isTimeString, daysBetween, addDays, weekday,
    dayNumber, dateForDay, contentIndex, cycleNumber, effectiveToday,
    localDateOf, dayState, indexReads, summarize, streak, monthsForJourney,
    minutesOf, isReminderDue, cleanName, fillName, notificationText,
  });
})(typeof globalThis !== 'undefined' ? globalThis : self);
