import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { parseCSV, toCSV, rowsToEntries, validate, wordCount } from '../tools/build-days.js';
import { parseRef, tidyQuotes, presentVerse } from '../tools/bible.js';

const root = new URL('..', import.meta.url);

test('CSV round trip handles quotes, commas and newlines', () => {
  const rows = [['day', 'theme', 'ref', 'verse', 'prayer'], ['1', 'A, B', 'Psalm 4:8', 'He said, “Go.”', 'Line "one"\nline two']];
  assert.deepEqual(parseCSV(toCSV(rows)), rows);
});

test('parseRef understands books, chapters and ranges', () => {
  assert.deepEqual(parseRef('Psalm 121:7–8'), { book: 'PSA', chapter: 121, from: 7, to: 8 });
  assert.deepEqual(parseRef('3 John 1:4'), { book: '3JO', chapter: 1, from: 4, to: 4 });
  assert.deepEqual(parseRef('Song of Solomon 2:4'), { book: 'SOL', chapter: 2, from: 4, to: 4 });
  assert.equal(parseRef('Hezekiah 1:1'), null);
  assert.equal(parseRef('Psalm 4:8–2'), null);
});

test('tidyQuotes completes quotation marks cut off by the passage boundary', () => {
  assert.equal(tidyQuotes('‘Yahweh bless you, and keep you.'), '‘Yahweh bless you, and keep you.’');
  assert.equal(tidyQuotes('and give you peace.’'), '‘and give you peace.’');
  assert.equal(tidyQuotes('For I know the thoughts,” says Yahweh, “thoughts of peace.'), '“For I know the thoughts,” says Yahweh, “thoughts of peace.”');
  assert.equal(tidyQuotes('He said, “Come to me! Don’t forbid them.'), 'He said, “Come to me! Don’t forbid them.”');
  assert.equal(tidyQuotes('God’s children’s joy.'), 'God’s children’s joy.');
  assert.equal(tidyQuotes('“Peace I leave with you.”'), '“Peace I leave with you.”');
});

test('presentVerse: capitalise, drop Selah, ellipsis for a cut-off ending', () => {
  assert.equal(presentVerse('¶ The LORD [is] my shepherd; I shall not want.'), 'The LORD is my shepherd; I shall not want.');
  assert.equal(presentVerse('The LORD bless thee, and keep thee:'), 'The LORD bless thee, and keep thee…');
  assert.equal(presentVerse('rejoicing in hope, enduring in troubles,'), 'Rejoicing in hope, enduring in troubles…');
  assert.equal(presentVerse('You are my hiding place. Selah.'), 'You are my hiding place.');
});

test('wordCount counts {name} as a word', () => {
  assert.equal(wordCount('Lord, keep {name} safe tonight. Amen.'), 6);
});

test('validate catches broken entries', () => {
  const good = (day) => ({
    day, theme: 'T', ref: 'Psalm 4:8', verse: 'v',
    prayer: `Father, ${'bless {name} '.repeat(25)}today, day ${day}. Amen.`,
  });
  const entries = Array.from({ length: 365 }, (_, i) => good(i + 1));
  entries.forEach((e, i) => { e.ref = `Psalm ${i + 1}:1`; });
  assert.deepEqual(validate(entries).errors, []);

  const bad = entries.map((e) => ({ ...e }));
  bad[0].prayer = 'Too short {name}. Amen.';
  bad[1].prayer = bad[1].prayer.replace(/\{name\}/g, 'baby');
  bad[2].prayer = bad[2].prayer.replace('Father,', 'Father, keep her safe,');
  bad[3].ref = 'Psalm 9:1'; // day 4 repeats day 9's ref within 30 days
  bad.pop();
  const errors = validate(bad).errors.join('\n');
  assert.match(errors, /Expected 365 entries/);
  assert.match(errors, /Day 365: missing/);
  assert.match(errors, /Day 1: prayer has \d+ words/);
  assert.match(errors, /Day 2: prayer has no \{name\}/);
  assert.match(errors, /Day 3: prayer uses a gendered pronoun/);
  assert.match(errors, /Psalm 9:1: repeats on days 4 and 9/);
});

test('shipped data/days.json is complete and valid', { skip: !existsSync(new URL('data/days.json', root)) }, () => {
  const days = JSON.parse(readFileSync(new URL('data/days.json', root), 'utf8'));
  const { errors } = validate(days);
  assert.deepEqual(errors, []);
});

test('content/days.csv matches data/days.json', { skip: !existsSync(new URL('content/days.csv', root)) }, () => {
  const fromCsv = rowsToEntries(parseCSV(readFileSync(new URL('content/days.csv', root), 'utf8'))).sort((a, b) => a.day - b.day);
  const json = JSON.parse(readFileSync(new URL('data/days.json', root), 'utf8'));
  assert.deepEqual(fromCsv, json);
});
