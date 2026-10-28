# Newborn Daily Blessing — project guide

Static PWA (GitHub Pages, no backend, no build step). Source of truth for requirements:
`Newborn Daily Blessing — PWA Specification.md`. Progress and decisions: `PROGRESS.md`
(read it first after any context reset, and keep it updated).

## Hard rules
- Plain HTML/CSS/JS. No frameworks, no bundler, no runtime dependencies, no third-party
  requests, no analytics. Everything must work offline after first visit.
- All paths relative (`./`), so the app works under `username.github.io/<repo>/`.
- Dates are local `YYYY-MM-DD` strings, never timestamps. Date maths uses UTC on the
  parsed parts so DST can't shift a day. See `js/days.js`.
- `js/days.js` and `js/db.js` are **dual-mode classic scripts**: no `import`/`export`;
  they attach `globalThis.NBDays` / `globalThis.NBDB`. Pages load them with side-effect
  `import './days.js'`; `sw.js` loads them with `importScripts`. Keep them that way
  (module service workers are not supported everywhere).
- Bump `CACHE_VERSION` in `sw.js` on every release, and add any new file to `PRECACHE`.
- Bible text is the World English Bible (eng-web, uses "Yahweh"), exact wording.
  Verse text in `content/days.csv` is filled from the WEB source by tooling, never typed.
- Prayers: original, 50–90 words, parent's voice, addressed to God, end with "Amen.",
  contain `{name}`, no gendered pronouns for the baby (he/she/him/her/his/hers).

## Layout
- `index.html` all screens as `<section>`s; hash routes `#today #journey #day/N #settings`.
- `js/app.js` start-up + routing; `js/ui.js` rendering; `js/reminders.js` badge,
  notifications, periodic sync, `.ics`; `js/db.js` IndexedDB; `js/days.js` date maths.
- `content/days.csv` → `node tools/build-days.js` → `data/days.json` (validated).
- `tests/` run with `npm test` (node:test, no deps).

## Commands
- `npm test` — unit + release tests (date maths, backup, ics, content, precache list).
- `node tools/build-days.js --web <eng-web_vpl.txt>` — rebuild and validate `data/days.json`
  (see README for the WEB download).
- `npm run serve` — local static server on http://localhost:8080.

## Release
Bump `CACHE_VERSION` in sw.js and `APP_VERSION` in js/app.js; run `npm test`. See README.
