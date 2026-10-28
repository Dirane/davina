// Release guards: the service worker must pre-cache every file the app needs
// offline, and the page must not reference anything outside the app.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';

const root = new URL('..', import.meta.url);
const read = (p) => readFileSync(new URL(p, root), 'utf8');
const sw = read('sw.js');
const precache = JSON.parse(
  '[' + /const PRECACHE = \[([\s\S]*?)\];/.exec(sw)[1].replace(/'/g, '"').replace(/,\s*$/, '') + ']',
).map((p) => p.replace(/^\.\//, ''));

test('every pre-cached file exists', () => {
  for (const p of precache) {
    if (p === '') continue; // './' is the app root
    assert.ok(existsSync(new URL(p, root)), `sw.js pre-caches missing file: ${p}`);
  }
});

test('every app file is pre-cached (offline after the first visit)', () => {
  const shipped = [
    'index.html', 'manifest.webmanifest', 'data/days.json',
    ...readdirSync(new URL('js/', root)).filter((f) => f.endsWith('.js')).map((f) => `js/${f}`),
    ...readdirSync(new URL('css/', root)).filter((f) => f.endsWith('.css')).map((f) => `css/${f}`),
    ...readdirSync(new URL('fonts/', root)).filter((f) => f.endsWith('.woff2')).map((f) => `fonts/${f}`),
    ...readdirSync(new URL('icons/', root)).filter((f) => f.endsWith('.png')).map((f) => `icons/${f}`),
  ];
  for (const f of shipped) assert.ok(precache.includes(f), `${f} is not in sw.js PRECACHE`);
});

test('index.html references only local files', () => {
  const html = read('index.html');
  const refs = [...html.matchAll(/(?:href|src)="([^"]+)"/g)].map((m) => m[1]).filter((r) => !r.startsWith('#'));
  for (const r of refs) {
    assert.ok(r.startsWith('./'), `non-relative reference: ${r}`);
    assert.ok(existsSync(new URL(r.slice(2), root)), `missing file: ${r}`);
  }
});

test('manifest icons exist and include a maskable icon', () => {
  const m = JSON.parse(read('manifest.webmanifest'));
  assert.equal(m.start_url, './');
  assert.equal(m.scope, './');
  for (const i of m.icons) assert.ok(existsSync(new URL(i.src, root)), i.src);
  assert.ok(m.icons.some((i) => i.purpose === 'maskable' && i.sizes === '512x512'));
  assert.ok(m.icons.some((i) => i.sizes === '192x192'));
});

test('cache version follows the blessing-vN pattern', () => {
  assert.match(sw, /const CACHE_VERSION = 'blessing-v\d+';/);
});
