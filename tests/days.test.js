import { test } from 'node:test';
import assert from 'node:assert/strict';
import '../js/days.js';
import '../js/db.js';

const D = globalThis.NBDays;
const DB = globalThis.NBDB;
const reads = (list) => D.indexReads(list.map(([date, readAt]) => ({ date, readAt })));
// readAt at local noon on a date, as an ISO string.
const noon = (date) => new Date(`${date}T12:00:00`).toISOString();

test('date strings', () => {
  assert.equal(D.isDateString('2026-02-28'), true);
  assert.equal(D.isDateString('2026-02-29'), false);
  assert.equal(D.isDateString('2028-02-29'), true);
  assert.equal(D.isDateString('2026-13-01'), false);
  assert.equal(D.isDateString('2026-1-01'), false);
  assert.equal(D.isDateString(null), false);
  assert.equal(D.toDateString(new Date(2026, 0, 5, 23, 59)), '2026-01-05');
});

test('daysBetween and addDays ignore daylight saving changes', () => {
  // DST transitions in Europe and the US fall inside these ranges.
  assert.equal(D.daysBetween('2026-03-01', '2026-04-01'), 31);
  assert.equal(D.daysBetween('2026-10-20', '2026-11-10'), 21);
  assert.equal(D.addDays('2026-03-28', 2), '2026-03-30');
  assert.equal(D.addDays('2026-12-31', 1), '2027-01-01');
  assert.equal(D.addDays('2028-02-28', 1), '2028-02-29');
  assert.equal(D.addDays('2026-01-01', -1), '2025-12-31');
});

test('dayNumber: Day 1 is the start date', () => {
  assert.equal(D.dayNumber('2026-11-01', '2026-11-01'), 1);
  assert.equal(D.dayNumber('2026-11-01', '2026-11-12'), 12);
  assert.equal(D.dayNumber('2026-11-01', '2027-10-31'), 365);
  assert.equal(D.dateForDay('2026-11-01', 12), '2026-11-12');
});

test('contentIndex repeats after Day 365', () => {
  assert.equal(D.contentIndex(1), 1);
  assert.equal(D.contentIndex(365), 365);
  assert.equal(D.contentIndex(366), 1);
  assert.equal(D.contentIndex(730), 365);
  assert.equal(D.contentIndex(731), 1);
  assert.equal(D.cycleNumber(365), 1);
  assert.equal(D.cycleNumber(366), 2);
});

test('effectiveToday never goes backwards', () => {
  const now = new Date(2026, 10, 5, 9);
  assert.equal(D.effectiveToday('2026-11-03', now), '2026-11-05');
  assert.equal(D.effectiveToday('2026-11-09', now), '2026-11-09');
  assert.equal(D.effectiveToday(undefined, now), '2026-11-05');
});

test('dayState: read, late, missed, today, future', () => {
  const today = '2026-11-10';
  assert.equal(D.dayState('2026-11-11', today, undefined), 'future');
  assert.equal(D.dayState(today, today, undefined), 'today');
  assert.equal(D.dayState(today, today, { readAt: noon(today) }), 'read');
  assert.equal(D.dayState('2026-11-08', today, undefined), 'missed');
  assert.equal(D.dayState('2026-11-08', today, { readAt: noon('2026-11-08') }), 'read');
  assert.equal(D.dayState('2026-11-08', today, { readAt: noon('2026-11-09') }), 'late');
  // Late at night on the same local date still counts as on time.
  assert.equal(D.dayState('2026-11-08', today, { readAt: new Date('2026-11-08T23:59:00').toISOString() }), 'read');
});

test('acceptance 8: three days unopened = three missed; reading one makes it late', () => {
  const start = '2026-11-01';
  const today = '2026-11-08';
  const map = reads([
    ['2026-11-01', noon('2026-11-01')], ['2026-11-02', noon('2026-11-02')],
    ['2026-11-03', noon('2026-11-03')], ['2026-11-04', noon('2026-11-04')],
  ]);
  let s = D.summarize(start, today, map);
  assert.equal(s.missed, 3);
  assert.equal(s.read, 4);
  assert.equal(s.streak, 0);

  map.set('2026-11-06', { date: '2026-11-06', readAt: noon(today) });
  s = D.summarize(start, today, map);
  assert.equal(D.dayState('2026-11-06', today, map.get('2026-11-06')), 'late');
  assert.equal(s.missed, 2);
  assert.equal(s.read, 5);
  assert.equal(s.late, 1);
});

test('streak counts on-time days up to today, or yesterday while today is unread', () => {
  const start = '2026-11-01';
  const map = reads([
    ['2026-11-01', noon('2026-11-01')],
    ['2026-11-03', noon('2026-11-03')], ['2026-11-04', noon('2026-11-04')], ['2026-11-05', noon('2026-11-05')],
  ]);
  assert.equal(D.streak(start, '2026-11-06', map), 3); // today unread: counts to yesterday
  map.set('2026-11-06', { date: '2026-11-06', readAt: noon('2026-11-06') });
  assert.equal(D.streak(start, '2026-11-06', map), 4);
  // A late read breaks the streak.
  map.set('2026-11-02', { date: '2026-11-02', readAt: noon('2026-11-06') });
  assert.equal(D.streak(start, '2026-11-06', map), 4);
  assert.equal(D.streak(start, '2026-11-07', new Map()), 0);
  assert.equal(D.streak(start, start, new Map()), 0);
});

test('monthsForJourney groups by calendar month with weekday offsets', () => {
  const months = D.monthsForJourney('2026-10-30', '2026-11-02');
  assert.equal(months.length, 2);
  assert.deepEqual(months[0], { year: 2026, month: 10, lead: 5, dates: ['2026-10-30', '2026-10-31'] }); // 30 Oct 2026 is a Friday
  assert.equal(months[1].lead, 0); // 1 Nov 2026 is a Sunday
  assert.deepEqual(months[1].dates, ['2026-11-01', '2026-11-02']);
  assert.deepEqual(D.monthsForJourney('2026-11-05', '2026-11-04'), []);
});

test('fillName and fallbacks', () => {
  assert.equal(D.fillName('Bless {name}. {name} is yours.', '  Amara  '), 'Bless Amara. Amara is yours.');
  assert.equal(D.fillName('{name} sleeps. Keep {name} safe.', ''), 'My little one sleeps. Keep my little one safe.');
  assert.equal(D.cleanName('  Ada   Grace '), 'Ada Grace');
  assert.equal(D.cleanName('x'.repeat(40)).length, 30);
});

test('reminder timing and notification text', () => {
  assert.equal(D.isReminderDue('07:00', new Date(2026, 10, 1, 6, 59)), false);
  assert.equal(D.isReminderDue('07:00', new Date(2026, 10, 1, 7, 0)), true);
  assert.deepEqual(D.notificationText(12, 'Peaceful sleep', 'Amara'), {
    title: 'Day 12: Peaceful sleep',
    body: 'A verse and a prayer for Amara are waiting.',
  });
  assert.equal(D.notificationText(377, 'X', '').title, 'Day 12: X');
});

test('validateBackup accepts the spec example and rejects bad files', () => {
  const ok = DB.validateBackup({
    version: 1,
    profile: { name: 'Amara', startDate: '2026-11-01', reminderTime: '07:00' },
    reads: [{ date: '2026-11-01', dayNumber: 1, readAt: '2026-11-01T07:12:00Z' }],
  });
  assert.equal(ok.ok, true);
  assert.equal(ok.profile.name, 'Amara');
  assert.deepEqual(ok.reads, [{ date: '2026-11-01', dayNumber: 1, readAt: '2026-11-01T07:12:00Z' }]);

  assert.equal(DB.validateBackup(null).ok, false);
  assert.equal(DB.validateBackup({ version: 2, profile: {}, reads: [] }).ok, false);
  assert.equal(DB.validateBackup({ version: 1, profile: { name: ' ', startDate: '2026-11-01' }, reads: [] }).ok, false);
  assert.equal(DB.validateBackup({ version: 1, profile: { name: 'A', startDate: '2026-02-30' }, reads: [] }).ok, false);
  assert.equal(DB.validateBackup({ version: 1, profile: { name: 'A', startDate: '2026-11-01' }, reads: [{ date: '2026-10-01', readAt: 'x' }] }).ok, false);
  // Bad reminder time falls back to the default rather than failing.
  assert.equal(DB.validateBackup({ version: 1, profile: { name: 'A', startDate: '2026-11-01', reminderTime: '25:00' }, reads: [] }).profile.reminderTime, '07:00');
});

test('days before joining are "earlier", never "missed", and count as read when read later', () => {
  const birth = '2026-10-01';
  const joined = '2026-10-20';
  const today = '2026-10-25';
  assert.equal(D.dayState('2026-10-05', today, undefined, joined), 'earlier');
  assert.equal(D.dayState('2026-10-05', today, { readAt: noon(today) }, joined), 'read');
  assert.equal(D.dayState('2026-10-22', today, undefined, joined), 'missed');
  assert.equal(D.dayState('2026-10-22', today, { readAt: noon(today) }, joined), 'late');
  assert.equal(D.dayState(today, today, undefined, joined), 'today');

  const map = reads([['2026-10-02', noon(today)], ['2026-10-20', noon('2026-10-20')], ['2026-10-21', noon('2026-10-21')]]);
  const s = D.summarize(birth, today, map, joined);
  assert.equal(s.days, 25);
  assert.equal(s.read, 3);
  assert.equal(s.earlier, 18); // Oct 1–19 is 19 days, one of them read
  assert.equal(s.missed, 3);   // Oct 22, 23, 24
  assert.equal(s.streak, 0);
});

test('streak only counts from the day the parent joined', () => {
  const birth = '2026-10-01';
  const joined = '2026-10-10';
  const map = new Map();
  for (let d = birth; d <= '2026-10-12'; d = D.addDays(d, 1)) map.set(d, { date: d, readAt: noon('2026-10-12') });
  map.set('2026-10-10', { date: '2026-10-10', readAt: noon('2026-10-10') });
  map.set('2026-10-11', { date: '2026-10-11', readAt: noon('2026-10-11') });
  map.set('2026-10-12', { date: '2026-10-12', readAt: noon('2026-10-12') });
  assert.equal(D.streak(birth, '2026-10-12', map, joined), 3);
});

test('age wording', () => {
  assert.equal(D.age('2026-10-01', '2026-10-01').text, 'born today');
  assert.equal(D.age('2026-10-01', '2026-10-02').text, '1 day old');
  assert.equal(D.age('2026-10-01', '2026-10-14').text, '13 days old');
  assert.equal(D.age('2026-10-01', '2026-10-15').text, '2 weeks old');
  assert.equal(D.age('2026-10-01', '2026-10-15').milestone, true);
  assert.equal(D.age('2026-10-01', '2026-12-01').text, '2 months old');
  assert.equal(D.age('2026-10-01', '2026-12-01').milestone, true);
  assert.equal(D.age('2026-10-31', '2026-12-30').text, '8 weeks old'); // not yet 2 calendar months
  assert.equal(D.age('2026-10-01', '2027-10-01').text, '1 year old');
  assert.equal(D.age('2026-10-01', '2027-10-02').text, '12 months old');
  assert.equal(D.age('2026-10-01', '2028-10-01').text, '2 years old');
  assert.equal(D.age('2026-10-02', '2026-10-01'), null);
  assert.equal(D.possessive('  Amara '), 'Amara’s');
});

test('backups keep the birthday; old backups fall back to the start date', () => {
  const r = DB.validateBackup({
    version: 1,
    profile: { name: 'Amara', birthDate: '2026-09-01', startDate: '2026-09-01', joinedDate: '2026-10-01', reminderTime: '07:00' },
    reads: [],
  });
  assert.equal(r.profile.birthDate, '2026-09-01');
  assert.equal(r.profile.joinedDate, '2026-10-01');
  const old = DB.validateBackup({ version: 1, profile: { name: 'Amara', startDate: '2026-11-01', reminderTime: '07:00' }, reads: [] });
  assert.equal(old.profile.birthDate, '2026-11-01');
  assert.equal(old.profile.joinedDate, '2026-11-01');
});
