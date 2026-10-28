/*
 * Start-up, routing between screens, and the event handlers.
 * Routes (URL hash): #today  #journey  #day/<n>  #settings
 */
import './days.js';
import './db.js';
import * as R from './reminders.js';
import * as UI from './ui.js';

const D = globalThis.NBDays;
const DB = globalThis.NBDB;
const APP_VERSION = '1.1.0';
const TICK_MS = 30 * 1000;
// Identifies this tab, so it can ignore its own broadcasts.
const TAB_ID = Math.random().toString(36).slice(2);

const $ = (id) => document.getElementById(id);

const state = {
  profile: null,
  reads: new Map(),
  days: null,          // index 1..365 -> entry
  today: null,
  route: { name: 'loading' },
  justRead: null,      // date just marked read (for the one animation)
  notifiedFor: null,   // date the in-tab reminder last fired for
  installEvent: null,
  updateRequested: false,
  onboarding: false,   // on the reminders step after Begin
};

/* ====================================================================== */
/* Data                                                                    */
/* ====================================================================== */

let daysPromise = null;
function loadDays() {
  if (!daysPromise) {
    daysPromise = fetch('./data/days.json')
      .then((res) => {
        if (!res.ok) throw new Error(`days.json: HTTP ${res.status}`);
        return res.json();
      })
      .then((list) => {
        const byDay = [];
        for (const e of list) byDay[e.day] = e;
        if (byDay.length !== D.PLAN_LENGTH + 1) throw new Error('days.json is incomplete');
        return byDay;
      })
      .catch((err) => { daysPromise = null; throw err; });
  }
  return daysPromise;
}

function entryFor(n) {
  return state.days[D.contentIndex(n)];
}

async function loadUserData() {
  const [profile, reads] = await Promise.all([DB.getProfile(), DB.getReads()]);
  state.profile = profile || null;
  state.reads = D.indexReads(reads);
}

/** Work out today, remembering the latest date seen (guards against clocks going backwards). */
async function updateToday() {
  const p = state.profile;
  if (!p) return;
  const today = D.effectiveToday(p.lastSeenDate);
  if (!p.lastSeenDate || today > p.lastSeenDate) {
    state.profile = await DB.updateProfile({ lastSeenDate: today });
  }
  state.today = today;
}

const todayNumber = () => D.dayNumber(state.profile.startDate, state.today);
const isComplete = () => todayNumber() > D.PLAN_LENGTH && !state.profile.continued;
// Profiles from before birthdays were asked: Day 1 was the setup day.
const birthDate = () => state.profile.birthDate || state.profile.startDate;
const joinedDate = () => state.profile.joinedDate || state.profile.startDate;
// True while Day 1 is the birthday (not after "Start again").
const followsBirthday = () => state.profile.startDate === birthDate();
const summary = () => D.summarize(state.profile.startDate, state.today, state.reads, joinedDate());
const stateOf = (date) => D.dayState(date, state.today, state.reads.get(date), joinedDate());
const appTitle = () => (state.profile ? `${D.possessive(state.profile.name)} Daily Blessing` : 'Newborn Daily Blessing');

/** Put the baby's name in the header and the page title. */
function personalise() {
  $('brand-name').textContent = state.profile ? appTitle() : 'Daily Blessing';
}
const todayUnread = () => !state.reads.has(state.today);

/* ====================================================================== */
/* Routing and rendering                                                  */
/* ====================================================================== */

function parseRoute() {
  const hash = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  if (hash === 'journey') return { name: 'journey' };
  if (hash === 'settings') return { name: 'settings' };
  const m = /^day\/(\d{1,5})$/.exec(hash);
  if (m) return { name: 'day', n: Number(m[1]) };
  return { name: 'today' };
}

const TITLES = { today: 'Today', journey: 'Journey', day: 'Past day', settings: 'Settings', welcome: 'Welcome' };

function showScreen(name) {
  document.body.dataset.route = name;
  for (const section of document.querySelectorAll('[data-screen]')) {
    section.hidden = section.dataset.screen !== name;
  }
  for (const tab of document.querySelectorAll('[data-tab]')) {
    if (tab.dataset.tab === name) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  }
}

/**
 * Draw the current route. focus: move focus to the screen heading (on
 * navigation, so screen readers announce the new screen).
 */
function render({ focus = false } = {}) {
  if (state.onboarding) return;
  if (!state.profile) {
    renderWelcome();
    return;
  }
  let route = parseRoute();

  if (route.name === 'day') {
    const n = route.n;
    const current = todayNumber();
    if (n === current) {
      history.replaceState(null, '', '#today');
      route = { name: 'today' };
    } else if (!(n >= 1 && n < current)) {
      history.replaceState(null, '', '#journey');
      route = { name: 'journey' };
    }
  }

  const changed = route.name !== state.route.name || route.n !== state.route.n;
  state.route = route;
  showScreen(route.name === 'day' ? 'day' : route.name);
  personalise();
  document.title = `${TITLES[route.name]} · ${appTitle()}`;

  if (route.name === 'today') renderToday();
  else if (route.name === 'journey') renderJourney();
  else if (route.name === 'day') renderPastDay(route.n);
  else if (route.name === 'settings') renderSettings();

  if (focus && changed) {
    const heading = document.querySelector(`[data-screen="${route.name}"] h1`);
    if (heading) heading.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }
  state.justRead = null;
}

function renderToday() {
  const container = $('screen-today');
  if (isComplete()) {
    UI.renderComplete(container, {
      name: state.profile.name,
      summary: summary(),
      birthday: followsBirthday(),
    }, { onStartAgain: startAgain, onKeepReading: keepReading });
    return;
  }
  const n = todayNumber();
  const totals = summary();
  UI.renderReading(container, {
    mode: 'today',
    n,
    date: state.today,
    entry: entryFor(n),
    name: state.profile.name,
    birthDate: birthDate(),
    status: stateOf(state.today),
    read: state.reads.get(state.today),
    missed: totals.missed,
    earlier: totals.earlier,
    justRead: state.justRead,
  }, { onMarkRead: markRead });
}

function renderPastDay(n) {
  const date = D.dateForDay(state.profile.startDate, n);
  UI.renderReading($('screen-day'), {
    mode: 'past',
    n,
    date,
    entry: entryFor(n),
    name: state.profile.name,
    birthDate: birthDate(),
    status: stateOf(date),
    read: state.reads.get(date),
    justRead: state.justRead,
  }, { onMarkRead: markRead });
}

function renderJourney() {
  UI.renderJourney({
    headingEl: $('journey-heading'),
    summaryEl: $('journey-summary'),
    monthsEl: $('journey-months'),
    legendEarlierEl: $('legend-earlier'),
  }, {
    name: state.profile.name,
    startDate: state.profile.startDate,
    joined: joinedDate(),
    today: state.today,
    reads: state.reads,
    summary: summary(),
  });
}

/* ====================================================================== */
/* Welcome and onboarding                                                 */
/* ====================================================================== */

function renderWelcome() {
  const wasWelcome = document.body.dataset.route === 'welcome';
  showScreen('welcome');
  personalise();
  document.title = 'Welcome · Newborn Daily Blessing';
  if (!wasWelcome) {
    $('welcome-step-name').hidden = false;
    $('welcome-step-reminders').hidden = true;
  }
  // The plan covers the first year: the birthday can be up to 364 days ago.
  const today = D.toDateString();
  $('welcome-birth').max = today;
  $('welcome-birth').min = D.addDays(today, -(D.PLAN_LENGTH - 1));
}

/** Error text for a birthday, or '' when it is fine. */
function birthdayError(value, { firstYearOnly }) {
  const today = D.toDateString();
  if (!D.isDateString(value)) return "Please enter your baby's birthday.";
  if (value > today) return 'The birthday cannot be in the future.';
  if (firstYearOnly && D.dayNumber(value, today) > D.PLAN_LENGTH) {
    return 'The plan covers the first year, so the birthday needs to be within the last 12 months.';
  }
  return '';
}

function setFieldError(input, errorEl, message) {
  errorEl.textContent = message;
  if (message) input.setAttribute('aria-invalid', 'true');
  else input.removeAttribute('aria-invalid');
}

async function onWelcomeSubmit(event) {
  event.preventDefault();
  const input = $('welcome-name');
  const error = $('welcome-name-error');
  const name = D.cleanName(input.value);
  if (!name) {
    error.textContent = "Please enter your baby's name.";
    input.setAttribute('aria-invalid', 'true');
    input.focus();
    return;
  }
  error.textContent = '';
  input.removeAttribute('aria-invalid');
  const birthInput = $('welcome-birth');
  const birthMessage = birthdayError(birthInput.value, { firstYearOnly: true });
  setFieldError(birthInput, $('welcome-birth-error'), birthMessage);
  if (birthMessage) {
    birthInput.focus();
    return;
  }
  const time = D.isTimeString($('welcome-time').value) ? $('welcome-time').value : '07:00';
  const today = D.toDateString();
  const profile = {
    name,
    birthDate: birthInput.value,
    startDate: birthInput.value, // Day 1 is the day the baby was born
    joinedDate: today,           // earlier days are "not yet read", never "missed"
    reminderTime: time,
    createdAt: new Date().toISOString(),
    lastSeenDate: today,
  };
  const button = event.submitter || event.target.querySelector('button[type="submit"]');
  if (button) button.disabled = true;
  try {
    await DB.saveProfile(profile);
  } catch (err) {
    console.error(err);
    error.textContent = 'This browser could not save on this device. Private browsing can block storage.';
    if (button) button.disabled = false;
    return;
  }
  state.profile = profile;
  state.reads = new Map();
  state.today = today;
  state.onboarding = true;
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
  showRemindersStep();
}

function showRemindersStep() {
  $('welcome-step-name').hidden = true;
  $('welcome-step-reminders').hidden = false;
  for (const el of document.querySelectorAll('[data-bind="reminder-time"]')) el.textContent = state.profile.reminderTime;
  personalise();
  const name = state.profile.name;
  const n = D.dayNumber(state.profile.startDate, state.today);
  $('onboard-lede').textContent = `The app can remind you each day until you have read ${D.possessive(name)} blessing.`;
  $('onboard-done').textContent = n === 1 ? 'Go to Day 1' : `Go to Day ${n}`;
  updateOnboardNotify();
  const ios = R.isIOS();
  $('onboard-calendar-pill').hidden = false;
  $('onboard-calendar-text').textContent = ios
    ? `Strongly recommended on iPhone and iPad: a daily event in your own calendar that rings at ${state.profile.reminderTime}, even when the app is closed.`
    : `The most reliable reminder on every device: a daily event in your own calendar that rings at ${state.profile.reminderTime}.`;
  $('welcome-step-reminders').querySelector('h1').focus();
  window.scrollTo(0, 0);
}

function updateOnboardNotify() {
  const perm = R.permissionState();
  const text = $('onboard-notify-text');
  const allow = $('onboard-allow');
  const status = $('onboard-notify-status');
  allow.hidden = perm !== 'default';
  if (perm === 'unsupported') {
    text.textContent = R.isIOS() && !R.isStandalone()
      ? 'On iPhone and iPad, notifications work once the app is on your Home Screen: tap Share, then Add to Home Screen. You can turn them on later in Settings.'
      : 'This browser cannot show notifications. The calendar alarm below will still remind you.';
  } else if (perm === 'denied') {
    text.textContent = 'Notifications are blocked for this site. You can allow them later in your browser settings; the calendar alarm works either way.';
  } else if (perm === 'granted') {
    status.textContent = 'Reminders are on.';
  }
}

async function onboardAllow() {
  const result = await R.requestPermission();
  const status = $('onboard-notify-status');
  if (result === 'granted') {
    status.textContent = 'Reminders are on.';
    R.registerPeriodicCheck();
  } else {
    status.textContent = 'No problem. The calendar alarm will still remind you.';
  }
  updateOnboardNotify();
}

async function finishOnboarding() {
  if (!state.days) {
    try {
      state.days = await loadDays();
    } catch (err) {
      console.error(err);
      showError("The app could not load today's reading. Check your connection and try again.");
      return;
    }
  }
  state.onboarding = false;
  history.replaceState(null, '', '#today');
  state.route = { name: 'welcome' };
  render({ focus: true });
  syncReminderLayers({ notify: true });
}

/* ====================================================================== */
/* Reading actions                                                        */
/* ====================================================================== */

async function markRead(date) {
  const n = D.dayNumber(state.profile.startDate, date);
  try {
    const record = await DB.markRead(date, n);
    state.reads.set(date, record);
  } catch (err) {
    console.error(err);
    toast('Could not save. Please try again.');
    render();
    return;
  }
  // Clear the badge and notification first, so they go within a second.
  if (date === state.today) syncReminderLayers({ notify: false });
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
  state.justRead = date;
  render();
  const status = document.querySelector('[data-screen]:not([hidden]) [data-read-state]');
  if (status) status.focus({ preventScroll: true });
}

async function startAgain() {
  const ok = await confirmDialog({
    title: 'Start again from Day 1?',
    text: `A fresh year starts today. ${D.possessive(state.profile.name)} name and birthday are kept; the reading history is cleared.`,
    confirm: 'Start again',
  });
  if (!ok) return;
  const today = state.today;
  // A fresh plan from today. The name and birthday are kept.
  const profile = { ...state.profile, birthDate: birthDate(), startDate: today, joinedDate: today, lastSeenDate: today };
  delete profile.continued;
  await DB.replaceAll(profile, []);
  state.profile = profile;
  state.reads = new Map();
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
  render({ focus: true });
  syncReminderLayers({ notify: false });
}

async function keepReading() {
  state.profile = await DB.updateProfile({ continued: true });
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
  render({ focus: true });
  syncReminderLayers({ notify: false });
}

/* ====================================================================== */
/* Reminder layers                                                         */
/* ====================================================================== */

/**
 * Badge on while today is unread; notification shown when asked and the
 * reminder time has been reached; both cleared once read.
 */
async function syncReminderLayers({ notify }) {
  if (!state.profile || !state.days || !state.today) return;
  try {
    const active = !isComplete();
    const unread = todayUnread();
    let notification = null;
    if (notify && active && unread && D.isReminderDue(state.profile.reminderTime)) {
      const n = todayNumber();
      notification = { ...D.notificationText(n, entryFor(n).theme, state.profile.name), date: state.today };
      state.notifiedFor = state.today;
    }
    await R.syncReminders({ unread, active, notification });
  } catch (err) {
    console.warn('Reminder sync failed', err);
  }
}

/** Runs every 30 s while the page is open: new day at midnight, in-tab reminder at the set time. */
async function tick() {
  if (!state.profile || !state.days) return;
  const today = D.effectiveToday(state.profile.lastSeenDate);
  if (today !== state.today) {
    await updateToday();
    render();
    syncReminderLayers({ notify: true });
    return;
  }
  if (state.notifiedFor !== state.today && todayUnread() && D.isReminderDue(state.profile.reminderTime)) {
    syncReminderLayers({ notify: true });
  }
}

/** Called when the app opens or comes back to the foreground. */
async function resume() {
  if (!state.days) return;
  try {
    await loadUserData();
    if (state.profile) await updateToday();
  } catch (err) {
    console.error(err);
    return;
  }
  render();
  syncReminderLayers({ notify: true });
  checkForUpdate();
}

/* ====================================================================== */
/* Settings                                                               */
/* ====================================================================== */

function renderSettings() {
  const nameInput = $('settings-name');
  if (document.activeElement !== nameInput) nameInput.value = state.profile.name;
  const birthInput = $('settings-birth');
  if (document.activeElement !== birthInput) birthInput.value = birthDate();
  birthInput.max = state.today || D.toDateString();
  $('settings-birth-hint').textContent = followsBirthday()
    ? 'Day 1 of the plan is the birthday.'
    : 'Your current plan started again on a later day, so changing the birthday does not move Day 1.';
  const timeInput = $('settings-time');
  if (document.activeElement !== timeInput) timeInput.value = state.profile.reminderTime;
  $('app-version').textContent = `Version ${APP_VERSION}.`;
  renderNotificationStatus();
  renderInstallCard();
}

function renderNotificationStatus() {
  const perm = R.permissionState();
  const label = { granted: 'On', denied: 'Blocked', default: 'Off', unsupported: 'Not available' }[perm];
  $('notify-status').textContent = label;
  $('notify-enable').hidden = perm !== 'default';
  $('notify-test').hidden = perm !== 'granted';
  const help = $('notify-help');
  let text = '';
  if (perm === 'denied') {
    text = "Notifications are blocked for this site. To turn them on, open your browser's site settings for this page and allow notifications. The calendar reminder below works either way.";
  } else if (perm === 'unsupported') {
    text = R.isIOS() && !R.isStandalone()
      ? 'On iPhone and iPad, notifications need the app on your Home Screen first (see Install app below). Until then, use the calendar reminder.'
      : 'This browser cannot show notifications. Use the calendar reminder below instead.';
  } else if (perm === 'default') {
    text = 'Turn on notifications to be reminded until each day is read.';
  }
  help.textContent = text;
  help.hidden = !text;
  $('calendar-hint').textContent = perm === 'granted'
    ? 'A daily calendar event with an alarm rings at the exact time on every device. If you change the reminder time, add it again.'
    : 'Recommended: a daily calendar event with an alarm rings at the exact time on every device. If you change the reminder time, add it again.';
}

function renderInstallCard() {
  const standalone = R.isStandalone();
  const ios = R.isIOS();
  const canPrompt = !!state.installEvent;
  $('install-card').hidden = standalone || (!canPrompt && !ios);
  $('install-btn').hidden = !canPrompt;
  $('install-ios').hidden = !(ios && !standalone);
  $('install-text').textContent = ios
    ? 'Add the app to your Home Screen for its own icon, offline use, the reminder badge and notifications.'
    : 'Install the app for its own icon, offline use, the reminder badge and notifications.';
}

async function onBabySubmit(event) {
  event.preventDefault();
  const nameInput = $('settings-name');
  const birthInput = $('settings-birth');
  const status = $('settings-baby-status');
  const name = D.cleanName(nameInput.value);
  if (!name) {
    status.textContent = "Please enter your baby's name.";
    nameInput.setAttribute('aria-invalid', 'true');
    nameInput.focus();
    return;
  }
  nameInput.removeAttribute('aria-invalid');
  const birthMessage = birthdayError(birthInput.value, { firstYearOnly: false });
  if (birthMessage) {
    status.textContent = birthMessage;
    birthInput.setAttribute('aria-invalid', 'true');
    birthInput.focus();
    return;
  }
  birthInput.removeAttribute('aria-invalid');

  const newBirth = birthInput.value;
  const movesDayOne = newBirth !== birthDate() && followsBirthday();
  if (movesDayOne) {
    // Day 1 moves with the birthday. Readings before the new Day 1 would be orphaned.
    const lost = [...state.reads.keys()].filter((d) => d < newBirth).length;
    if (lost > 0) {
      const ok = await confirmDialog({
        title: 'Change the birthday?',
        text: `Day 1 will move to the new birthday. ${lost === 1 ? '1 reading' : `${lost} readings`} from before that date will be removed.`,
        confirm: 'Change',
      });
      if (!ok) return;
    }
    const joined = joinedDate() < newBirth ? newBirth : joinedDate();
    state.profile = await DB.rebaseStart({ name, birthDate: newBirth, startDate: newBirth, joinedDate: joined });
    state.reads = D.indexReads(await DB.getReads());
  } else {
    state.profile = await DB.updateProfile({ name, birthDate: newBirth });
  }
  nameInput.value = name;
  status.textContent = movesDayOne
    ? `Saved. Day 1 is now ${D.possessive(name)} birthday.`
    : `Saved. Every prayer now uses ${name}.`;
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
  render();
}

async function onTimeChange() {
  const input = $('settings-time');
  const status = $('settings-time-status');
  if (!D.isTimeString(input.value)) {
    status.textContent = 'Please choose a time.';
    return;
  }
  state.profile = await DB.updateProfile({ reminderTime: input.value });
  state.notifiedFor = null;
  status.textContent = `Reminder time saved: ${input.value}. If you added the calendar reminder, add it again for the new time.`;
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
}

async function onEnableNotifications() {
  const result = await R.requestPermission();
  if (result === 'granted') {
    toast('Notifications are on.');
    R.registerPeriodicCheck();
    syncReminderLayers({ notify: false });
  }
  renderNotificationStatus();
}

async function onTestNotification() {
  const ok = await R.showTestNotification(state.profile.name).catch(() => false);
  toast(ok ? 'Test notification sent.' : 'Could not show a notification in this browser.');
}

function onCalendar() {
  const ics = R.buildICS({
    name: state.profile.name,
    reminderTime: state.profile.reminderTime,
    startDate: state.today || D.toDateString(),
    appUrl: new URL('./', location.href).href,
    uidSeed: state.profile.createdAt,
  });
  R.downloadICS(ics);
  toast('Calendar file ready. Open it to add the daily reminder.');
}

async function onInstall() {
  const event = state.installEvent;
  if (!event) return;
  state.installEvent = null;
  try {
    await event.prompt();
    await event.userChoice;
  } catch (_) { /* prompt can only be used once */ }
  renderInstallCard();
}

async function onExport() {
  const status = $('backup-status');
  try {
    const data = await DB.exportBackup();
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `newborn-blessing-backup-${D.toDateString()}.json`;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    status.textContent = 'Backup file downloaded.';
  } catch (err) {
    console.error(err);
    status.textContent = 'Could not create the backup.';
  }
}

async function onImportFile(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = '';
  if (!file) return;
  // Import works from Settings and from the Welcome screen (restoring on a new phone).
  const status = state.profile ? $('backup-status') : $('welcome-restore-status');
  let parsed;
  try {
    if (file.size > 2 * 1024 * 1024) throw new Error('too large');
    parsed = JSON.parse(await file.text());
  } catch (_) {
    status.textContent = 'That file could not be read. Choose a backup file exported from this app.';
    return;
  }
  const result = DB.validateBackup(parsed);
  if (!result.ok) {
    status.textContent = result.error;
    return;
  }
  const ok = await confirmDialog(state.profile ? {
    title: 'Replace current data?',
    text: `This replaces the name and reading history on this device with the backup for ${result.profile.name} (${result.reads.length} days read).`,
    confirm: 'Replace',
  } : {
    title: 'Restore this backup?',
    text: `Restore the reading plan for ${result.profile.name} (${result.reads.length} days read) on this device.`,
    confirm: 'Restore',
  });
  if (!ok) return;
  await DB.replaceAll(result.profile, result.reads);
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
  location.replace(`${location.pathname}${location.search}#today`);
  location.reload();
}

async function onReset() {
  const ok = await confirmDialog({
    title: 'Start over?',
    text: 'This removes the name and all reading history from this device. Export a backup first if you might want it back.',
    confirm: 'Start over',
  });
  if (!ok) return;
  await DB.clearAll();
  await R.setBadge(false);
  await R.closeDailyNotification().catch(() => {});
  await R.unregisterPeriodicCheck();
  DB.broadcast({ type: 'data-changed', source: TAB_ID });
  location.replace(`${location.pathname}${location.search}#today`);
  location.reload();
}

/* ====================================================================== */
/* Dialog and toast                                                       */
/* ====================================================================== */

function confirmDialog({ title, text, confirm }) {
  const dialog = $('confirm-dialog');
  if (typeof dialog.showModal !== 'function') return Promise.resolve(window.confirm(`${title}\n\n${text}`));
  $('confirm-title').textContent = title;
  $('confirm-text').textContent = text;
  $('confirm-ok').textContent = confirm;
  const opener = document.activeElement;
  return new Promise((resolve) => {
    const finish = (value) => {
      $('confirm-ok').onclick = null;
      $('confirm-cancel').onclick = null;
      dialog.oncancel = null;
      if (dialog.open) dialog.close();
      if (opener && typeof opener.focus === 'function') opener.focus();
      resolve(value);
    };
    $('confirm-ok').onclick = () => finish(true);
    $('confirm-cancel').onclick = () => finish(false);
    dialog.oncancel = (e) => { e.preventDefault(); finish(false); };
    dialog.showModal();
    $('confirm-cancel').focus();
  });
}

let toastTimer = null;
function toast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 3500);
}

/* ====================================================================== */
/* Service worker and updates                                             */
/* ====================================================================== */

let swRegistration = null;
let lastUpdateCheck = 0;

async function registerServiceWorker() {
  if (!('serviceWorker' in navigator)) return;
  try {
    swRegistration = await navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' });
  } catch (err) {
    console.warn('Service worker registration failed', err);
    return;
  }
  const reg = swRegistration;
  if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting);
  reg.addEventListener('updatefound', () => {
    const worker = reg.installing;
    if (!worker) return;
    worker.addEventListener('statechange', () => {
      if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBar(worker);
    });
  });
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (state.updateRequested) location.reload();
  });
  navigator.serviceWorker.addEventListener('message', (event) => {
    const msg = event.data || {};
    if (msg.type === 'navigate' && typeof msg.hash === 'string' && msg.hash.startsWith('#')) {
      if (location.hash !== msg.hash) location.hash = msg.hash;
    }
    if (msg.type === 'data-changed') resume();
  });
  if (state.profile && R.permissionState() === 'granted') R.registerPeriodicCheck();
}

function showUpdateBar(worker) {
  const bar = $('update-bar');
  bar.hidden = false;
  $('update-btn').onclick = () => {
    state.updateRequested = true;
    $('update-btn').textContent = 'Updating…';
    worker.postMessage({ type: 'SKIP_WAITING' });
  };
}

function checkForUpdate() {
  const now = Date.now();
  if (!swRegistration || now - lastUpdateCheck < 60 * 60 * 1000) return;
  lastUpdateCheck = now;
  swRegistration.update().catch(() => {});
}

/* ====================================================================== */
/* Start-up                                                               */
/* ====================================================================== */

function bindEvents() {
  $('welcome-form').addEventListener('submit', onWelcomeSubmit);
  $('welcome-name').addEventListener('input', () => {
    $('welcome-name-error').textContent = '';
    $('welcome-name').removeAttribute('aria-invalid');
  });
  $('onboard-allow').addEventListener('click', onboardAllow);
  $('onboard-calendar-btn').addEventListener('click', onCalendar);
  $('onboard-done').addEventListener('click', finishOnboarding);
  $('welcome-restore').addEventListener('click', () => $('import-file').click());

  $('baby-form').addEventListener('submit', onBabySubmit);
  $('welcome-birth').addEventListener('input', () => setFieldError($('welcome-birth'), $('welcome-birth-error'), ''));
  $('settings-time').addEventListener('change', onTimeChange);
  $('notify-enable').addEventListener('click', onEnableNotifications);
  $('notify-test').addEventListener('click', onTestNotification);
  $('calendar-btn').addEventListener('click', onCalendar);
  $('install-btn').addEventListener('click', onInstall);
  $('export-btn').addEventListener('click', onExport);
  $('import-btn').addEventListener('click', () => $('import-file').click());
  $('import-file').addEventListener('change', onImportFile);
  $('reset-btn').addEventListener('click', onReset);
  $('error-retry').addEventListener('click', () => location.reload());

  window.addEventListener('hashchange', () => render({ focus: true }));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') resume();
  });
  window.addEventListener('pageshow', (e) => { if (e.persisted) resume(); });

  window.addEventListener('beforeinstallprompt', (event) => {
    // Keep the browser's own install UI; also offer the button in Settings.
    state.installEvent = event;
    if (state.route.name === 'settings') renderInstallCard();
  });
  window.addEventListener('appinstalled', () => {
    state.installEvent = null;
    if (state.route.name === 'settings') renderInstallCard();
  });

  try {
    const channel = new BroadcastChannel(DB.CHANNEL);
    channel.onmessage = (event) => {
      if (!event.data || event.data.source !== TAB_ID) resume();
    };
  } catch (_) { /* older browsers: visibilitychange covers it */ }
}

function showError(message) {
  showScreen('error');
  $('error-message').textContent = message;
}

async function boot() {
  bindEvents();
  const days = loadDays();
  days.catch(() => {}); // handled where awaited
  try {
    await loadUserData();
    if (!state.profile) {
      // First open: the Welcome screen needs no content, so show it straight away.
      render();
      registerServiceWorker();
      state.days = await days;
      setInterval(tick, TICK_MS);
      return;
    }
    state.days = await days;
    await updateToday();
  } catch (err) {
    console.error(err);
    showError(err && /IndexedDB|storage/i.test(String(err.message))
      ? 'This browser is blocking storage on this device (private browsing can do this). Please open the app in a normal window.'
      : "The app could not load today's reading. Check your connection and try again.");
    registerServiceWorker();
    return;
  }
  render();
  registerServiceWorker();
  if (state.profile) syncReminderLayers({ notify: true });
  setInterval(tick, TICK_MS);
}

boot();
