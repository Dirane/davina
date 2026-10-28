// Convert the content spreadsheet to data/days.json, checking every rule.
//
//   node tools/build-days.js [--csv content/days.csv] [--out data/days.json] [--web path/to/eng-web_vpl.txt]
//   node tools/build-days.js --fill-verses --web path/to/eng-web_vpl.txt
//
// --web            also check every verse matches the World English Bible exactly.
// --fill-verses    rewrite the verse column of the CSV from the WEB (authoring helper).
// --check          validate only; don't write days.json.
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const COLUMNS = ['day', 'theme', 'ref', 'verse', 'prayer'];
export const PLAN_LENGTH = 365;
const MIN_WORDS = 50;
const MAX_WORDS = 90;
const REPEAT_GAP = 30;
const GENDERED = /\b(he|she|him|her|his|hers|himself|herself)\b/i;

/* ---------- CSV (RFC 4180) ---------- */

export function parseCSV(text) {
  const rows = [];
  let row = [], field = '', i = 0, quoted = false;
  const src = text.replace(/^﻿/, '');
  while (i < src.length) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') { field += '"'; i += 2; continue; }
        quoted = false; i++; continue;
      }
      field += ch; i++; continue;
    }
    if (ch === '"' && field === '') { quoted = true; i++; continue; }
    if (ch === ',') { row.push(field); field = ''; i++; continue; }
    if (ch === '\r' || ch === '\n') {
      row.push(field); field = '';
      if (row.length > 1 || row[0] !== '') rows.push(row);
      row = [];
      i += ch === '\r' && src[i + 1] === '\n' ? 2 : 1;
      continue;
    }
    field += ch; i++;
  }
  if (quoted) throw new Error('CSV: unterminated quoted field');
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

export function toCSV(rows) {
  const cell = (v) => {
    const s = String(v ?? '');
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

export function rowsToEntries(rows) {
  const [header, ...body] = rows;
  const cols = header.map((h) => h.trim().toLowerCase());
  for (const c of COLUMNS) if (!cols.includes(c)) throw new Error(`CSV: missing column "${c}"`);
  return body.map((r) => {
    const get = (c) => (r[cols.indexOf(c)] ?? '').trim().replace(/\s+/g, ' ');
    return { day: Number(get('day')), theme: get('theme'), ref: get('ref'), verse: get('verse'), prayer: get('prayer') };
  });
}

export const wordCount = (text) => text.split(/\s+/).filter((w) => /[\p{L}\p{N}{]/u.test(w)).length;

/* ---------- Validation ---------- */

/** Returns { errors: [...], warnings: [...] }. */
export function validate(entries, { web, lookup } = {}) {
  const errors = [];
  const warnings = [];
  const err = (day, msg) => errors.push(`Day ${day}: ${msg}`);

  if (entries.length !== PLAN_LENGTH) errors.push(`Expected ${PLAN_LENGTH} entries, found ${entries.length}`);
  const seenDays = new Set();
  for (const e of entries) {
    if (!Number.isInteger(e.day) || e.day < 1 || e.day > PLAN_LENGTH) err(e.day, 'day must be 1–365');
    if (seenDays.has(e.day)) err(e.day, 'duplicate day');
    seenDays.add(e.day);
  }
  for (let d = 1; d <= PLAN_LENGTH; d++) if (!seenDays.has(d)) errors.push(`Day ${d}: missing (gap)`);

  const prayers = new Map();
  const refDays = new Map();
  for (const e of entries) {
    for (const c of COLUMNS) if (e[c] === '' || e[c] == null || Number.isNaN(e[c])) err(e.day, `empty ${c}`);
    const p = e.prayer || '';
    if (!p.includes('{name}')) err(e.day, 'prayer has no {name}');
    if (/\{(?!name\})[^}]*\}/.test(p)) err(e.day, 'prayer has an unknown {placeholder}');
    if (!/Amen\.$/.test(p)) err(e.day, 'prayer must end with "Amen."');
    const words = wordCount(p);
    if (words < MIN_WORDS || words > MAX_WORDS) err(e.day, `prayer has ${words} words (needs ${MIN_WORDS}–${MAX_WORDS})`);
    const g = GENDERED.exec(p);
    if (g) err(e.day, `prayer uses a gendered pronoun ("${g[0]}")`);
    if (/["']/.test(p) || /["']/.test(e.theme)) err(e.day, 'use typographic quotes/apostrophes (’ “ ”) not straight ones');
    if (prayers.has(p)) err(e.day, `prayer duplicates day ${prayers.get(p)}`);
    prayers.set(p, e.day);
    if (e.theme && e.theme.length > 40) err(e.day, 'theme is longer than 40 characters');
    if (!/^(?:[1-3] )?[A-Z][A-Za-z]+(?: of [A-Z][a-z]+)? \d+:\d+(?:–\d+)?$/.test(e.ref)) {
      err(e.day, `reference "${e.ref}" should look like "Psalm 121:7–8" (en dash for ranges)`);
    }
    if (!refDays.has(e.ref)) refDays.set(e.ref, []);
    refDays.get(e.ref).push(e.day);
    if (web && lookup) {
      try {
        const expected = lookup(web, e.ref);
        if (expected !== e.verse) err(e.day, `verse does not match the WEB text for ${e.ref}:\n    expected: ${expected}\n    found:    ${e.verse}`);
      } catch (x) {
        err(e.day, x.message);
      }
    }
  }

  // Repeated verses: at least 30 days apart, including across the
  // year boundary (the plan repeats after Day 365 for "Keep reading").
  for (const [ref, days] of refDays) {
    const sorted = days.slice().sort((a, b) => a - b);
    for (let i = 1; i < sorted.length; i++) {
      if (sorted[i] - sorted[i - 1] < REPEAT_GAP) errors.push(`${ref}: repeats on days ${sorted[i - 1]} and ${sorted[i]} (less than ${REPEAT_GAP} days apart)`);
    }
    if (sorted.length > 1 && sorted[0] + PLAN_LENGTH - sorted[sorted.length - 1] < REPEAT_GAP) {
      warnings.push(`${ref}: days ${sorted[sorted.length - 1]} and ${sorted[0]} are close when the plan repeats`);
    }
  }

  // One theme per week (week 52 runs to day 365).
  const byDay = new Map(entries.map((e) => [e.day, e]));
  for (let w = 0; w < 52; w++) {
    const first = byDay.get(w * 7 + 1);
    const last = w === 51 ? PLAN_LENGTH : w * 7 + 7;
    for (let d = w * 7 + 2; d <= last; d++) {
      const e = byDay.get(d);
      if (first && e && e.theme !== first.theme) warnings.push(`Day ${d}: theme "${e.theme}" differs from its week ("${first.theme}")`);
    }
  }

  return { errors, warnings };
}

/* ---------- CLI ---------- */

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i > -1 ? process.argv[i + 1] : fallback;
}

async function main() {
  const csvPath = resolve(ROOT, arg('--csv', 'content/days.csv'));
  const outPath = resolve(ROOT, arg('--out', 'data/days.json'));
  const webPath = arg('--web', process.env.WEB_VPL);
  let web = null, lookup = null;
  if (webPath) {
    const mod = await import(pathToFileURL(resolve(ROOT, 'tools/web.js')).href);
    web = mod.loadWeb(resolve(webPath));
    lookup = mod.lookup;
  }

  const rows = parseCSV(readFileSync(csvPath, 'utf8'));
  let entries = rowsToEntries(rows);

  if (process.argv.includes('--fill-verses')) {
    if (!web) throw new Error('--fill-verses needs --web <eng-web_vpl.txt>');
    entries = entries.map((e) => ({ ...e, verse: lookup(web, e.ref) }));
    writeFileSync(csvPath, toCSV([COLUMNS, ...entries.map((e) => COLUMNS.map((c) => e[c]))]));
    console.log(`Filled ${entries.length} verses from the WEB into ${csvPath}`);
  }

  entries.sort((a, b) => a.day - b.day);
  const { errors, warnings } = validate(entries, { web, lookup });
  warnings.forEach((w) => console.warn(`warning: ${w}`));
  if (errors.length) {
    errors.forEach((e) => console.error(`error: ${e}`));
    console.error(`\n${errors.length} error(s); days.json not written.`);
    process.exit(1);
  }
  if (!process.argv.includes('--check')) {
    const json = '[\n' + entries.map((e) => JSON.stringify({ day: e.day, theme: e.theme, ref: e.ref, verse: e.verse, prayer: e.prayer })).join(',\n') + '\n]\n';
    writeFileSync(outPath, json);
    console.log(`Wrote ${entries.length} entries to ${outPath} (${(Buffer.byteLength(json) / 1024).toFixed(1)} KB)${web ? ', verses checked against the WEB' : ''}.`);
  } else {
    console.log(`OK: ${entries.length} entries valid${web ? ', verses match the WEB' : ''}.`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || '').href) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
