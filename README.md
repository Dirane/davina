# Davina — Newborn Daily Blessing

A verse and a prayer for your little one, every day of their first year, and calming
sounds to help them settle. Installs as **Davina**.

Day 1 is the baby's birthday, so a parent who starts later can still read every day
since the baby was born. The baby's name personalises the header, prayers and screens.

An installable web app (PWA) that runs entirely from GitHub Pages: no server, no
accounts, no tracking, no running costs. Works offline after the first visit.
Full requirements: [`Newborn Daily Blessing — PWA Specification.md`](./Newborn%20Daily%20Blessing%20—%20PWA%20Specification.md).

## Soothe

The Soothe tab plays six calming sounds: white, pink and brown noise, a 70 bpm
heartbeat, shushing, and Brahms’ Lullaby as music-box tones. All are generated on the
device (`js/sounds.js`), so there are no audio files and they work offline. Volume starts
at 30% and is capped at 70%; the sleep timer (15/30/60 min or none) fades out over 10 s.
The night screen dims the display and keeps it awake so sound continues on every phone;
lock-screen controls use the Media Session API.

## Run locally

```sh
npm run serve        # http://localhost:8080 (gzip + cache headers like GitHub Pages)
npm test             # unit and release tests (Node 20+, no dependencies)
```

Service workers need `localhost` or HTTPS. Opening `index.html` as a file will not work.

## Deploy (GitHub Pages)

1. Push this repository to GitHub.
2. **Settings → Pages → Build and deployment → Deploy from a branch → `main` / `(root)`**.
3. The app is live at `https://<user>.github.io/<repo>/`. All paths are relative, so a
   project URL works as is. For a custom domain, add a `CNAME` file.

`.nojekyll` is included so Pages serves every file as is. No GitHub Actions needed.

## Release checklist

1. `npm test` passes (it also checks that every app file is in the offline cache).
2. Bump `CACHE_VERSION` in `sw.js` (`blessing-v1` → `blessing-v2` …). **Without this,
   installed apps keep the old version.**
3. Bump `APP_VERSION` in `js/app.js` (shown in Settings).
4. Push to `main`. Open users see "Update available, tap to refresh".

## Editing the verses and prayers

The source of truth is `content/days.csv` (columns `day, theme, ref, verse, prayer`),
which opens in any spreadsheet app. `data/days.json` is generated from it.

```sh
# Download the King James Version once (public domain) for the verse check:
curl -LO https://ebible.org/Scriptures/eng-kjv_vpl.zip && unzip eng-kjv_vpl.zip eng-kjv_vpl.txt

# After editing refs, refill the verse column from the KJV (never type verses by hand):
node tools/build-days.js --fill-verses --bible eng-kjv_vpl.txt

# Validate and rebuild data/days.json:
node tools/build-days.js --bible eng-kjv_vpl.txt
```

The build refuses to write `days.json` unless: there are exactly 365 days with no gaps;
no field is empty; every prayer has `{name}`, ends with "Amen.", is 50–90 words, uses no
he/she/him/her/his/hers, and is unique; references are well formed; repeated verses are
at least 30 days apart; and (with `--bible`) every verse matches the KJV exactly.

**Verse display rules** (`tools/bible.js`). The wording is never changed, but a verse
lifted out of its chapter is tidied for display: the KJV's supplied words (italic in
print, `[bracketed]` in the source) are shown as plain text, ¶ paragraph marks are
dropped, Psalm titles merged into verse 1 in the source are removed (exact titles in
`tools/psalm-titles.json`), the musical note "Selah" is dropped, the first letter is capitalised, a passage ending mid-sentence ends with "…",
and quotation marks cut off by the passage boundary are completed.

Prayers use British spelling and avoid gendered pronouns, so they fit any baby. The
spec asks for a second person to proofread the content before launch.

## How reminders work

No server means no browser can promise a notification at an exact time. The app
stacks four layers, and only **Mark as read** ends them:

| Layer | Where it works |
| --- | --- |
| App icon badge while today is unread | Installed on Android, Windows, macOS, ChromeOS, iOS 16.4+ |
| Notification with a **Mark as read** button, on app open after the reminder time | Anywhere notifications are allowed (iOS: Home Screen app only) |
| Background check every ~12 h, re-shows the notification | Installed Chrome/Edge only; the browser picks the timing |
| Daily calendar event with an alarm (`.ics`) | Every device; the only layer that rings at an exact time |

## Project layout

```
index.html            all screens; hash routes #today #journey #day/N #settings
sw.js                 offline cache, background check, notification actions
manifest.webmanifest  install metadata
css/app.css           design tokens (light/dark), layout, components
js/app.js             start-up, routing, event handlers
js/ui.js              rendering
js/reminders.js       permission, badge, notifications, periodic sync, .ics
js/sounds.js          Soothe sound synthesis and volume cap (pure, tested in Node)
js/soothe.js          Soothe player: Web Audio, sleep timer, Media Session, night screen
js/days.js            date maths, day states, streak (shared with sw.js)
js/db.js              IndexedDB storage and backup validation (shared with sw.js)
data/days.json        365 entries (generated)
content/days.csv      365 entries (source)
tools/                build-days.js, bible.js, serve.js, make-icons.py
tests/                node:test suites
```

## Status of testing

Verified in Chromium (desktop and mobile emulation): every flow in the spec, acceptance
criteria 3, 4, 5, 8, 9 and 10, offline start-up, the update bar, the background check
(dispatched through DevTools), the notification's Mark as read action, light and dark
mode from 320 to 1440 px, Lighthouse (Performance 99, Accessibility 100, Best Practices
100, SEO 100) and axe (no WCAG 2.2 AA violations on any screen).

Soothe, verified in Chromium: sounds start in about 0.25 s, play offline, the volume
cannot exceed 70%, the timer fades over the last 10 s and stops, settings survive a
reload, and axe finds no violations (light, dark, night screen).

Still to do on real devices (acceptance 1, 2, 6, 7, 11): listening to each sound on a
phone speaker, Soothe with the screen locked on Android and iPhone, install and badge on an Android
phone, Home Screen install and notifications on an iPhone (iOS 16.4+), Edge on Windows,
and importing the `.ics` file into Google Calendar and Apple Calendar.

## Credits and licences

- Scripture: King James Version (KJV), public domain, from [ebible.org](https://ebible.org).
- Fonts: Lora and Inter, SIL Open Font License (see `fonts/`).
- Lullaby melody: Johannes Brahms, Wiegenlied Op. 49 No. 4 (1868), public domain. All
  sounds are synthesised by this app.
- Prayers, code and icons: original to this project.
