# Progress

Update this file as work completes. After a context reset, read CLAUDE.md, then this.

## Checklist
- [x] Scaffolding: CLAUDE.md, .gitignore, package.json, .nojekyll
- [x] Assets: fonts (fontsource 5.3.0 latin WOFF2: Lora 400, Inter 400/600), icons (tools/make-icons.py)
- [x] days.js (date maths, states, streak)
- [x] unit tests (tests/*.test.js)
- [x] db.js (IndexedDB, shared with SW, backup validation)
- [x] index.html + app.css
- [x] ui.js + app.js
- [x] reminders.js (permission, badge, notification, periodic sync, .ics)
- [x] sw.js
- [x] manifest.webmanifest
- [x] tools: serve.js, bible.js (KJV lookup; was web.js), build-days.js (CSV→JSON + checks)
- [x] Content: 365 entries authored → content/days.csv → data/days.json
- [x] Browser verification (Playwright): flows, offline, widths 320–1440, dark mode, update bar, periodicsync, SW mark-read
- [x] Lighthouse (Perf 99, A11y 100, BP 100, SEO 100) and axe (0 violations, all screens, both themes)
- [x] README (deploy + release steps)
- [ ] Real-device checks (owner): Android install/badge, iPhone Home Screen, Edge/Windows, .ics in Google/Apple Calendar
- [ ] Second-person proofread of content (spec authoring step 4)

## Decisions (beyond the spec)
- WEB source: ebible.org eng-web_vpl.txt, downloaded to the session scratchpad
  (`.../scratchpad/web/eng-web_vpl.txt`). Re-download from
  https://ebible.org/Scriptures/eng-web_vpl.zip if missing. Psalm titles are merged
  into verse 1 there; tools/web.js strips them. The spec's sample Psalm 4:8 wording
  is not the real WEB text — verses are always filled by tooling.
- `--muted` light changed #77736B → #6F6B63 (spec value is 4.46:1 on --bg, fails AA).
- Dark mode primary button uses dark text (`--on-accent: #161614`); white on #8DB497
  is 2.3:1 and fails AA.
- days.js/db.js are classic dual-mode scripts (module service workers aren't universal).
- Notification on app open is only shown once the reminder time has passed (badge is
  set all day while unread). Avoids a 6am ping for a 7am reminder.
- Journey shows newest month first (less scrolling late in the year).
- Install: we don't preventDefault `beforeinstallprompt`, so the browser's own install
  UI still appears; Settings also has the button.
- `.ics`: floating local time, DURATION 10 min, stable UID from profile.createdAt.
- Backup export adds createdAt/lastSeenDate/continued to the spec format (superset).
- Profile has an extra `continued: true` after "Keep reading" past Day 365.
- `--control-border` (#938D81 / #76716A) for inputs: spec --border is 1.2:1, fails 3:1.
- `--accent-text` (#426A4E light) for accent text on --accent-soft (spec pair is 4.18:1).
- Welcome has "Restore from a backup file" (spec only had Import in Settings, which a
  new phone can't reach without entering a dummy name).
- Welcome renders before days.json loads; modulepreload hints for all JS modules.
- SW registered with updateViaCache: 'none' (Pages' 10-min HTTP cache can't delay updates).
- Programmatically focused headings ([tabindex=-1]) show no focus ring.

## Notes for resuming
SCRATCH=/private/tmp/claude-501/-Users-apple-Documents-general-ngalas-Davina/4d882b05-d678-4a29-99a7-9e3b59f7154c/scratchpad
- Verse plan: $SCRATCH/content-src/plan.txt (52 weeks, theme | refs). `node $SCRATCH/content-src/verses.mjs`
  → verses.json/verses.txt (WEB text via tools/web.js). Plan is FINAL and reviewed.
- Prayers: $SCRATCH/content-src/prayers-NN.txt, lines `day | prayer`. British spelling
  (favour, honour, nappies). Batches DONE: 01 (1–56), 02 (57–112), 03 (113–168), 04 (169–224), 05 (225–280), 06 (281–336), 07 (337–365). ALL 365 DONE; data/days.json built and validated.
- Assemble: `node $SCRATCH/content-src/assemble.mjs` → content/days.csv; then
  `node tools/build-days.js --web $SCRATCH/web/eng-web_vpl.txt` → data/days.json.
- Verse display rules (tools/web.js): Psalm titles stripped exactly (tools/psalm-titles.json
  from WEB USFM), "Selah" dropped, first letter capitalised, trailing , ; : → "…",
  quotation marks cut by the passage boundary are completed. Wording never changed.

## Change 2 (2026-10-28): Day 1 = baby's birthday + personalisation  [DONE, verified in browser]
Branch: build-pwa (pushed; not merged to main yet).
Plan:
- [x] Profile gets `birthDate` and `joinedDate` (setup date). Day 1 = startDate = birthDate.
      Old profiles/backups: birthDate ← startDate, joinedDate ← startDate.
- [x] New day state 'earlier': unread day before joinedDate (neutral, not "missed").
      Reading an earlier day counts as 'read'. Streak only counts from joinedDate.
- [x] Welcome asks birthday (max today, min today−364). Settings can edit birthday;
      if startDate === birthDate the plan moves with it (reads before new start removed after confirm).
      "Start again" keeps name + birthDate, startDate = joinedDate = today.
- [x] Personalise: header "<name>’s Daily Blessing", titles, age line on Today/Past day,
      "<name>’s journey", onboarding copy, complete screen "Happy first birthday, <name>"
      when startDate === birthDate.
- [x] Update spec doc + README; tests; browser check; bump CACHE_VERSION v2, APP_VERSION 1.1.0.
Notes: first birthday shows "1 year old today"; banner for earlier-only days is the calm
green style (warm tint stays for real missed days). Old profiles without birthDate work
(fallback to startDate). CACHE_VERSION blessing-v2, APP_VERSION 1.1.0.

## Change 3 (2026-10-28): KJV instead of WEB  [DONE]
- Owner asked for the ESV; declined for now (Crossway licence: verses would be ~27% of
  the app text, over their 25% free-quotation limit, and the text needs an ESV API key).
  Owner chose the KJV (public domain).
- Source: https://ebible.org/Scriptures/eng-kjv_vpl.zip (+ eng-kjv_usfm.zip for Psalm
  titles), downloaded to $SCRATCH/kjv/. tools/web.js → tools/bible.js (loadBible),
  build-days `--web` → `--bible`. tools/psalm-titles.json regenerated from KJV USFM \d
  lines by $SCRATCH/kjv-titles.mjs (116 titles, all match the vpl exactly).
- Display: [supplied words] shown without brackets, ¶ dropped, rest as before.
- Day 8 prayer "Yahweh, my keeper" → "Lord, my keeper". Card label "…, KJV".
- Rebuild: `node tools/build-days.js --bible $SCRATCH/kjv/vpl/eng-kjv_vpl.txt`.
- Released as APP_VERSION 1.2.0, CACHE_VERSION blessing-v3.
- Older notes above that mention WEB/web.js/--web describe the original build.

## Change 4 (2026-10-28): App name Davina + Soothe tab  [DONE, verified in Chromium]
- Name: manifest name/short_name, apple-mobile-web-app-title, application-name, page
  titles ("Today · Davina"), Welcome h1 "Davina" with kicker "Newborn Daily Blessing".
  Header keeps "Amara’s Daily Blessing" (owner: keep the "Daily Blessing" text). Backup
  file is davina-backup-DATE.json. IndexedDB name and .ics UID unchanged (stability).
- Soothe: js/sounds.js (pure synthesis, seeded, seamless loops; tested in Node) +
  js/soothe.js (Web Audio graph source→sourceGain→volume(≤0.7)→fade→destination;
  timer fade scheduled on the audio clock; silent looping <audio> blob for Media
  Session/lock screen; navigator.audioSession='playback'; night <dialog> + wake lock).
- Prefs in profile store key "soothe" {sound, volume, timer, tipSeen}; replaceAll no
  longer clears the profile store (put overwrites "me"), so Import/Start again keep them.
- CSP gained `media-src 'self' blob:` (keep-alive WAV is a blob URL).
- Verified: start ~0.25 s, offline play, volume cap, 15 s test timer fades from 5–15 s and
  stops (test-only patch via Playwright route), prefs survive reload, axe clean light/dark/
  night, no overflow 320–1440. Owner to check on devices: lock screen Android/iPhone, sound
  quality on phone speakers.
- Released as APP_VERSION 1.3.0, CACHE_VERSION blessing-v4.

## Change 5 (2026-10-28): More lullabies  [DONE]
- TUNES in js/sounds.js: lullaby (Brahms, id kept for saved prefs), twinkle, sleeping
  (Frère Jacques), grace (Amazing Grace), greensleeves. Shared musicBox() synth; each tune
  has unit (s per step), bar (steps, tested: whole bars), octave shift.
- Soothe grid split into GROUPS "Sounds" and "Lullabies" (h2 per group). New icon i-star.
- Released as APP_VERSION 1.4.0, CACHE_VERSION blessing-v5.
