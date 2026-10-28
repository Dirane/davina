import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildICS, icsEscape, icsFold } from '../js/reminders.js';

test('icsEscape escapes TEXT special characters', () => {
  assert.equal(icsEscape('a,b;c\\d\ne'), 'a\\,b\\;c\\\\d\\ne');
});

test('icsFold keeps lines within 75 octets without splitting characters', () => {
  const long = 'DESCRIPTION:' + 'é'.repeat(80);
  const folded = icsFold(long);
  for (const line of folded.split('\r\n')) assert.ok(Buffer.byteLength(line) <= 75, line);
  assert.equal(folded.split('\r\n').map((l, i) => (i ? l.slice(1) : l)).join(''), long);
});

test('buildICS makes a daily event with an alarm at the reminder time', () => {
  const ics = buildICS({
    name: 'Amara',
    reminderTime: '07:30',
    startDate: '2026-11-01',
    appUrl: 'https://example.github.io/newborn-blessing/',
    uidSeed: '2026-11-01T10:00:00.000Z',
    now: new Date('2026-11-01T10:00:00Z'),
  });
  const lines = ics.trimEnd().split('\r\n');
  assert.equal(lines[0], 'BEGIN:VCALENDAR');
  assert.ok(lines.includes('DTSTART:20261101T073000'), 'floating local start time');
  assert.ok(lines.includes('RRULE:FREQ=DAILY'));
  assert.ok(lines.includes('BEGIN:VALARM'));
  assert.ok(lines.includes('TRIGGER:PT0M'));
  assert.ok(lines.includes('DTSTAMP:20261101T100000Z'));
  assert.ok(lines.some((l) => l.startsWith('UID:daily-blessing-20261101T100000000Z@')));
  assert.ok(ics.endsWith('\r\n'));
  assert.ok(!/\r?\n(?!\s)[^A-Z]/.test(ics.replace(/\r\n /g, '')), 'every logical line starts with a property name');
  for (const line of lines) assert.ok(Buffer.byteLength(line) <= 75);
});
