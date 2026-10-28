# Newborn Daily Blessing — PWA Specification

Oct 28, 2026 · @Afayicommerce

## Overview

Newborn Daily Blessing is a static, installable web app that gives a parent one Bible verse and one prayer for their baby every day of the baby's first year. It runs entirely from GitHub Pages: no server, no accounts, no running costs.

**Goals**

- Show today's verse and a prayer that uses the baby's name, in under 2 seconds, online or offline.
- Keep reminding the parent until the day is marked as read.
- Show which days were missed and let the parent catch up.
- Install on Android, iPhone/iPad, Windows, macOS and ChromeOS from the browser.

**Non-goals for v1**

- User accounts, cloud sync or multi-device sync.
- Server-sent push notifications (no backend allowed).
- Multiple babies, languages or Bible translations.
- Audio, sharing to social media, or analytics.

## Key decisions

| Decision | Choice | Why |
| --- | --- | --- |
| Audience | A parent of a newborn | Agreed with the owner |
| Personalisation | Parent enters the baby's name and birthday once, on first open; the name appears in the header, titles, age line and prayers | The app reads as written for this child |
| Day 1 | The baby's birthday (within the last 12 months) | Every day of the first year can be read, including the days before the app was set up |
| Length | 365 days, then a "first year complete" screen | Matches the baby's first year |
| Bible text | King James Version (KJV) | Public domain, the most familiar English translation (changed from the WEB at the owner's request) |
| Language | English only | Agreed with the owner |
| Hosting | GitHub Pages only, no backend | Agreed with the owner |
| Stack | Plain HTML, CSS and JavaScript modules, no build step | Push to `main` and it is live; nothing to compile or maintain |
| Storage | IndexedDB on the device | Readable by both the page and the service worker |

The only consequence worth flagging: without a server, no browser can guarantee a notification at an exact time each day. Section "Reminders and notifications" sets out how the app gets as close as the platforms allow.

## Screens and user flows

The app has five screens and a bottom bar with two tabs: **Today** and **Journey**. Settings opens from a gear icon in the header.

### 1. Welcome (first open only)

- One sentence: "A verse and a prayer for your little one, every day of their first year."
- **Baby's name** (required, 1–30 characters, trimmed).
- **Baby's birthday** (required; not in the future; within the last 12 months, since the plan covers the first year).
- Optional: **Daily reminder time**, default 07:00.
- Button **Begin**. Saves the profile, sets Day 1 to the birthday, then asks for notification permission with a short explanation first (never a cold browser prompt).

### 2. Today

- Header: "Day 12 of 365", today's date and the baby's age ("Amara is 3 weeks old"). The app header reads "Amara's Daily Blessing".
- Theme label for the day, e.g. "Peaceful sleep".
- Verse card: verse text in large serif type, reference underneath ("Psalm 4:8, KJV").
- Prayer card: the prayer with the baby's name filled in, ending in "Amen."
- Primary button **Mark as read**. After tapping it becomes a quiet "Read today ✓" state and the reminder badge and notification are cleared.
- If there are missed days, a small banner: "You have 3 days to catch up" linking to Journey.

### 3. Journey (missed days)

- Summary line: "Read 40 · Missed 3 · Current streak 6 days".
- A month-by-month grid of day circles, Day 1 to today. States: read (filled accent), read late (outlined accent), missed (soft warning tint), not yet read (dashed outline, days before setup), today (ring), future (not shown). Heading: "Amara's journey".
- Tapping any past day opens that day's reading.

### 4. Past day

- Same layout as Today, with the day number and its date.
- Button **Mark as read** on missed days; a read day shows when it was read.

### 5. Settings

- Edit baby's name (prayers update immediately, history stays).
- Reminder time, notification permission status and a **Test notification** button.
- **Add daily reminder to my calendar** (see Reminders section).
- **Install app** button, shown only when the browser offers installation; on iPhone, short "Share → Add to Home Screen" instructions instead.
- Backup: **Export** (downloads a small JSON file) and **Import**.
- **Start over**, with a confirmation step.

### After Day 365

Today shows a "Happy first birthday, Amara!" screen with totals ("First year complete" after a restart), and two choices: **Start again from Day 1** (a fresh plan from today; keeps only the name and birthday) or **Keep reading** (the plan repeats from Day 1, history kept).

## Content: verses and prayers

All 365 days ship inside the app as one file, `data/days.json`, so the app works offline from the first visit and needs no API.

### Entry format

```json
{
  "day": 12,
  "theme": "Peaceful sleep",
  "ref": "Psalm 4:8",
  "verse": "I will both lay me down in peace, and sleep: for thou, LORD, only makest me dwell in safety.",
  "prayer": "Father, tonight I lay {name} down in your care. Quiet every fear, settle every cry, and let {name} sleep in safety, knowing you never sleep. Give me rest too, and patience for the long nights. Amen."
}
```

### Rules for writing the content

- **Verse text** is copied exactly from the King James Version (KJV). Supplied words printed in italics in the KJV are shown as plain text. Each card shows "KJV" after the reference.
- **Prayers** are original writing, 50–90 words, in the parent's voice, addressed to God, ending in "Amen."
- Every prayer uses `{name}` at least once. Prayers avoid he/she so they fit any baby.
- If the name is ever empty, `{name}` falls back to "my little one".
- Verses may repeat across the year, but never within 30 days of each other, and each repeat gets a different prayer.

### Themes through the year

One theme per week, cycling through these areas so the year feels varied:

| Area | Example themes | Example verse |
| --- | --- | --- |
| Gift and gratitude | A gift from God, Wonderfully made | Psalm 127:3, Psalm 139:14 |
| Protection and health | Safe in his care, Healing | Psalm 121:7–8, Psalm 91:11 |
| Rest and peace | Peaceful sleep, Calm in the night | Psalm 4:8, Isaiah 26:3 |
| Growth | Growing in wisdom, Strong and healthy | Luke 2:52, 1 Samuel 2:26 |
| Future and purpose | A plan and a hope, Walking in truth | Jeremiah 29:11, 3 John 1:4 |
| Parenting | Patience, Strength for tired days | Isaiah 40:11, Isaiah 40:31 |
| Family and love | A loving home, Joy | Deuteronomy 6:6–7, Psalm 103:17 |
| Faith | Knowing God early, Blessing | Numbers 6:24–26, Mark 10:16 |

### Authoring workflow

1. Draft all 365 entries in a spreadsheet with the five columns above.
2. Check every verse against a KJV source (ebible.org publishes it free).
3. Convert to `days.json` with a small script, which also checks: 365 entries, days 1–365 with no gaps, every prayer contains `{name}`, no field empty.
4. A second person proofreads before launch.

## Reminders and notifications

The app stacks four reminder layers, all static, so every platform gets at least two and the reminder persists until **Mark as read** is tapped. Without a server no layer alone can fire at an exact time on every device, so the layers cover each other's gaps.

### The four layers

1. **App icon badge.** When today is unread, the app sets a badge of 1 on its icon (`navigator.setAppBadge`). It stays there until the day is marked read, then `clearAppBadge`. This is the "until marked as read" signal that survives everywhere badges are supported.
2. **Sticky notification.** The service worker shows one notification with `tag: "daily-blessing"` (so it replaces, never stacks), `requireInteraction: true`, and an action button **Mark as read**. Tapping the action marks the day read without opening the app; tapping the body opens Today. It is shown whenever the app opens or resumes and today is unread, and again by layer 3.
3. **Background check.** On browsers that support Periodic Background Sync (Chrome and Edge, installed app), the app registers a check every 12 hours. If today is unread, the service worker re-shows the notification and badge, even when the app is closed. The browser decides the exact timing.
4. **Calendar alarm.** Settings offers **Add daily reminder to my calendar**. It generates a `.ics` file in the browser: a daily repeating event at the chosen reminder time, with an alarm and the app's link. This is the only layer that rings at an exact time on every device, including iPhone, and needs nothing beyond a static file.

&#91;embedded content: daily reminder loop · repeats until read\]

Only marking the day read ends the loop; dismissing a notification just waits for the next app open or background check.

### What each platform gets

| Platform | Badge | Notification when app opens | Background re-notify | Calendar alarm |
| --- | --- | --- | --- | --- |
| Android, Chrome (installed) | Yes, launcher-dependent | Yes | Yes, best effort | Yes |
| Windows, macOS, ChromeOS, Chrome or Edge (installed) | Yes | Yes | Yes, best effort | Yes |
| iPhone/iPad, added to Home Screen (iOS 16.4+) | Yes | Yes | No | Yes |
| Any browser, not installed | No | Only while the tab is open | No | Yes |
| Firefox desktop | No | Yes | No | Yes |

In short: on Android and desktop the app nags until read on its own; on iPhone the badge plus the calendar alarm do the job. The onboarding recommends the calendar alarm to every user, and strongly on iPhone.

### Rules

- Ask for notification permission only after the parent taps **Begin**, with one line explaining why.
- If permission is denied, the app still works; Settings shows how to turn it on and promotes the calendar alarm.
- Marking read anywhere (app, past-day screen or notification action) clears the badge and closes the notification.
- At local midnight a new day starts unread; yesterday becomes "missed" if unread.
- Notification text: title "Day 12: Peaceful sleep", body "A verse and a prayer for {name} are waiting."

## Missed days

A day is missed when its date has passed and it was never marked read; reading it later turns it into "read late", not "read".

### Day numbering

- Dates are the device's local calendar dates as `YYYY-MM-DD` strings, never timestamps, so time zones and daylight saving can't shift a day.
- `dayNumber(date) = days between startDate and date + 1`. Day 1 (`startDate`) is the birthday, or the day of "Start again".
- Days between the birthday and the setup date (`joinedDate`) were never due: unread they are "not yet read", not missed, and reading them counts as read, not read late. The streak counts from `joinedDate`.
- Past Day 365 the plan content repeats: content index = `((dayNumber - 1) mod 365) + 1`.

### Day states

| State | Rule | Shown as |
| --- | --- | --- |
| Read | `readAt` is on the same date | Filled accent circle |
| Read late | `readAt` is after that date | Outlined accent circle |
| Missed | Date is before today, no `readAt` | Soft warning tint |
| Today, unread | Date is today, no `readAt` | Ring, badge and notification active |
| Future | After today | Not shown |

### Counts on the Journey screen

- **Read** = read + read late.
- **Missed** = days still missed (catching up lowers this number).
- **Current streak** = consecutive days up to today (or yesterday, if today is still unread) that were read on time.

### Edge cases

- If the device clock goes backwards, the app shows the latest date it has seen as "today" and never marks future days missed.
- If the app isn't opened for weeks, all those days appear as missed on the next open; nothing is lost.
- Unmarking a read day is not offered in v1.

## Data model and storage

Everything the parent creates lives in one IndexedDB database on the device, `newborn-blessing`, with two stores. The service worker reads the same database to decide whether to notify.

| Store | Key | Fields |
| --- | --- | --- |
| `profile` | `"me"` (single record) | `name`, `birthDate`, `startDate` (Day 1), `joinedDate` (setup day), `reminderTime` (HH:MM), `createdAt` (ISO), `lastSeenDate` (dates are YYYY-MM-DD) |
| `reads` | `date` (YYYY-MM-DD) | `date`, `dayNumber`, `readAt` (ISO timestamp) |

Only days that were read get a record; missed days are computed, not stored.

### Backup file

Export downloads `newborn-blessing-backup-YYYY-MM-DD.json`:

```json
{ "version": 1, "profile": { "name": "Amara", "startDate": "2026-11-01", "reminderTime": "07:00" }, "reads": [ { "date": "2026-11-01", "dayNumber": 1, "readAt": "2026-11-01T07:12:00Z" } ] }
```

Import validates `version`, replaces current data after a confirmation, and reloads.

### Privacy

The baby's name and reading history never leave the device. The app makes no network calls except loading its own files from GitHub Pages. No analytics, cookies or third-party scripts.

## PWA, offline and GitHub Pages

The app is installable and fully offline after the first visit; GitHub Pages provides the HTTPS that installation and service workers require.

### Manifest (`manifest.webmanifest`)

- `name`: "Newborn Daily Blessing", `short_name`: "Blessing".
- `start_url`: `"./"` and `scope`: `"./"`. Relative paths so the app works under a project URL like `username.github.io/newborn-blessing/`.
- `display`: `"standalone"`, `orientation`: `"portrait"` (desktop ignores it).
- `background_color` and `theme_color` from the design palette.
- Icons: 192 and 512 px PNG, plus a 512 px `maskable` version.
- iOS extras in `index.html`: `apple-touch-icon` (180 px), `apple-mobile-web-app-capable`, status-bar style, and the title.

### Service worker (`sw.js`)

- **Install:** pre-cache the app shell: HTML, CSS, JS modules, `days.json`, fonts, icons. Cache name carries a version, e.g. `blessing-v1`.
- **Fetch:** cache-first for everything the app owns; fall back to network, then to the cached `index.html` for navigation.
- **Activate:** delete old cache versions, then `clients.claim()`.
- **Updates:** when a new version is waiting, the app shows a small "Update available, tap to refresh" bar.
- **periodicsync:** run the unread check from the Reminders section.
- **notificationclick:** handle **Mark as read** (write to IndexedDB, clear badge) or open/focus the app on Today.

### Hosting

- Repository on GitHub, Pages set to deploy from the `main` branch, root folder. No GitHub Actions needed.
- Optional custom domain via a `CNAME` file; Pages issues the HTTPS certificate.
- Add an empty `.nojekyll` file so Pages serves every file as-is.
- Bump the cache version in `sw.js` on every release so users receive the update.

### Target performance

- Total first download under 400 KB including fonts.
- Lighthouse: PWA installable, Performance 95+, Accessibility 100.

## Design system

The look is calm and soft: warm off-white paper, one sage accent, a readable serif for scripture, and lots of space. One column, centred, never wider than 640 px.

### Colour tokens

| Token | Light | Dark | Use |
| --- | --- | --- | --- |
| `--bg` | #FBF8F3 | #161614 | Page background |
| `--surface` | #FFFFFF | #22211F | Cards |
| `--text` | #2B2A28 | #EEEAE3 | Main text |
| `--muted` | #77736B | #A39E95 | Labels, dates, references |
| `--accent` | #4F7A5C | #8DB497 | Buttons, read days, ring on today |
| `--accent-soft` | #E6EFE8 | #2A3A2E | Read-state backgrounds |
| `--missed` | #F3E3D6 | #43332A | Missed day tint |
| `--border` | #ECE6DC | #34322E | Card borders, dividers |

Dark mode follows the device setting (`prefers-color-scheme`); no toggle in v1. Text on every background meets WCAG AA contrast.

### Type

- Verse: **Lora** (serif), 22 px on phones, 26 px from 768 px wide, line height 1.5.
- Interface and prayer: **Inter**, 17 px body, 14 px labels, line height 1.6.
- Both self-hosted as WOFF2 subsets so they work offline.

### Layout and components

- Spacing scale in steps of 4 px; cards have 24 px padding, 16 px radius, a 1 px border and no heavy shadows.
- Primary button: full width on phones, 52 px tall, accent fill, white text.
- Bottom tab bar on phones; on screens 768 px and wider it moves to the top header.
- Journey grid: 7 columns, circles 36 px on phones, 44 px on wider screens.
- Safe-area padding for notched phones (`env(safe-area-inset-*)`).

### Motion and accessibility

- One gentle fade and checkmark when a day is marked read; nothing else animates. All motion off under `prefers-reduced-motion`.
- Tap targets at least 44 × 44 px, visible focus rings, full keyboard use, semantic headings and labelled buttons.
- Day states never rely on colour alone: read shows a check, missed shows a dot, today shows a ring.

## Build plan and acceptance

### Repository layout

```
newborn-blessing/
├── index.html              # single page, all screens as sections
├── manifest.webmanifest
├── sw.js                   # service worker, at root so its scope is the whole app
├── .nojekyll
├── css/
│   └── app.css             # tokens, layout, components
├── js/
│   ├── app.js              # start-up, routing between screens
│   ├── db.js               # IndexedDB helpers (shared with sw.js)
│   ├── days.js             # date maths, day states, streak
│   ├── reminders.js        # permission, badge, notification, periodic sync, .ics
│   └── ui.js               # rendering Today, Journey, Past day, Settings
├── data/
│   └── days.json           # 365 verses and prayers
├── fonts/                  # Lora and Inter WOFF2 subsets
├── icons/                  # 180, 192, 512, maskable 512
└── tools/
    └── build-days.js       # spreadsheet CSV → days.json, with checks
```

Routing uses the URL hash (`#today`, `#journey`, `#day/12`, `#settings`) so GitHub Pages never needs server rewrites.

### Build checklist

- [ ] Repository, Pages enabled, `.nojekyll`, placeholder page live
- [ ] Design tokens, fonts and icons
- [ ] Welcome screen and profile storage
- [ ] Today screen reading from `days.json` with `{name}` filled in
- [ ] Mark as read, day states and Journey grid
- [ ] Past day screen and catch-up
- [ ] Manifest, service worker, offline cache, update bar
- [ ] Badge, notification with action, periodic sync
- [ ] Calendar `.ics` reminder
- [ ] Settings: rename, reminder time, export, import, start over
- [ ] First-year-complete screen
- [ ] Write and proofread all 365 entries
- [ ] Device testing and Lighthouse pass

### Acceptance criteria

1. On a fresh phone, the parent can open the link, enter a name and birthday, and see today's reading in under 30 seconds.
2. The app installs from Chrome on Android and desktop, and via Add to Home Screen on iPhone, and opens full-screen with its own icon.
3. With the device in airplane mode, an installed app opens and shows today's reading.
4. Every prayer shows the baby's name; renaming updates all prayers.
5. While today is unread, the icon badge shows on supporting devices and the notification appears on each app open; both clear within 1 second of marking read, including from the notification button.
6. On installed Chrome for Android, an unread day produces a notification without opening the app (allowing for browser timing).
7. The calendar file imports into Google Calendar and Apple Calendar as a daily event with an alarm at the chosen time.
8. Leaving the app unopened for 3 days shows exactly 3 missed days; reading one changes it to "read late" and lowers the missed count to 2.
9. Export, Start over, then Import restores the name and history exactly.
10. Layout has no horizontal scroll from 320 px to 1440 px wide, in light and dark mode.

### Test devices

Android phone (Chrome), iPhone on iOS 16.4 or later (Safari, Home Screen), Windows or Mac (Chrome and Edge), and one small 320 px-wide screen.
