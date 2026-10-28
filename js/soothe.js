/*
 * Soothe: calming sounds with a sleep timer.
 *
 * Web Audio plays the loops: gapless, gain-capped, and the timer's fade is
 * scheduled on the audio clock, so it happens on time even when the page's
 * timers are throttled. A silent looping <audio> element runs alongside it to
 * give the lock screen its title and controls (Media Session) and to keep the
 * audio session alive while the screen is off, where the platform allows it.
 */
import './db.js';
import {
  SOUNDS, soundById, synthesize, clampVolume, silentWav, formatRemaining,
  DEFAULT_VOLUME, MAX_GAIN, FADE_OUT_SECONDS, TIMER_CHOICES,
} from './sounds.js';

const DB = globalThis.NBDB;
const $ = (id) => document.getElementById(id);
const DEFAULT_TIMER = 30;

const prefs = { sound: null, volume: DEFAULT_VOLUME, timer: DEFAULT_TIMER, tipSeen: false };
const audio = { ctx: null, volume: null, fade: null, source: null, sourceGain: null, buffers: new Map(), keepAlive: null };
const player = {
  playing: false,
  endAt: null,       // audio-clock time the timer ends, while playing
  remaining: null,   // seconds left on the timer, while paused
  finished: false,   // the timer ended the last playback
  finishTimer: null,
  uiTimer: null,
  route: null,
  name: '',
};
let toast = () => {};
let wakeLock = null;
let ownPause = false; // the keep-alive element is being paused by us, not the system

/* ====================================================================== */
/* Settings                                                               */
/* ====================================================================== */

async function loadPrefs() {
  try {
    const saved = await DB.getSoothe();
    if (!saved) return;
    if (soundById(saved.sound)) prefs.sound = saved.sound;
    if (Number.isFinite(saved.volume)) prefs.volume = clampVolume(saved.volume);
    if (TIMER_CHOICES.includes(saved.timer)) prefs.timer = saved.timer;
    prefs.tipSeen = saved.tipSeen === true;
  } catch (err) {
    console.warn('Could not load Soothe settings', err);
  }
}

let saveTimer = null;
function savePrefs() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    DB.saveSoothe({ ...prefs }).catch((err) => console.warn('Could not save Soothe settings', err));
  }, 300);
}

/* ====================================================================== */
/* Audio engine                                                           */
/* ====================================================================== */

function ensureAudio() {
  if (audio.ctx) return audio.ctx;
  const Ctx = window.AudioContext || window.webkitAudioContext;
  if (!Ctx) return null;
  // iOS: play through the silent switch, like a music app.
  try { if (navigator.audioSession) navigator.audioSession.type = 'playback'; } catch (_) { /* older iOS */ }
  let ctx;
  try { ctx = new Ctx({ latencyHint: 'playback' }); } catch (_) { ctx = new Ctx(); }
  audio.ctx = ctx;
  audio.volume = ctx.createGain();
  audio.fade = ctx.createGain();
  audio.volume.gain.value = clampVolume(prefs.volume);
  audio.volume.connect(audio.fade);
  audio.fade.connect(ctx.destination);
  ctx.onstatechange = () => {
    // The system stopped audio (a phone call, or the screen locked where
    // background audio is not allowed): show it as paused.
    if (player.playing && ctx.state !== 'running' && !player.starting) pause({ immediate: true });
  };
  return ctx;
}

function getBuffer(id) {
  let buffer = audio.buffers.get(id);
  if (!buffer) {
    const ctx = audio.ctx;
    const data = synthesize(id, ctx.sampleRate);
    buffer = ctx.createBuffer(1, data.length, ctx.sampleRate);
    if (buffer.copyToChannel) buffer.copyToChannel(data, 0);
    else buffer.getChannelData(0).set(data);
    audio.buffers.set(id, buffer);
  }
  return buffer;
}

function startSource(id) {
  const ctx = audio.ctx;
  const now = ctx.currentTime;
  stopSource(0.4); // a short cross-fade when switching sounds
  const source = ctx.createBufferSource();
  source.buffer = getBuffer(id);
  source.loop = true;
  const gain = ctx.createGain();
  gain.gain.setValueAtTime(0, now);
  gain.gain.linearRampToValueAtTime(1, now + 0.6);
  source.connect(gain);
  gain.connect(audio.volume);
  source.start(now);
  audio.source = source;
  audio.sourceGain = gain;
}

function stopSource(fade = 0.15) {
  const { source, sourceGain, ctx } = audio;
  if (!source) return;
  audio.source = null;
  audio.sourceGain = null;
  try {
    const now = ctx.currentTime;
    if (fade > 0) {
      sourceGain.gain.cancelScheduledValues(now);
      sourceGain.gain.setValueAtTime(sourceGain.gain.value, now);
      sourceGain.gain.linearRampToValueAtTime(0, now + fade);
      source.stop(now + fade + 0.02);
    } else {
      source.stop();
    }
  } catch (_) { /* already stopped */ }
  setTimeout(() => { try { sourceGain.disconnect(); } catch (_) { /* gone */ } }, (fade + 0.2) * 1000);
}

/** Hold the fade gain where it is and return it to full volume smoothly. */
function resetFade() {
  const ctx = audio.ctx;
  const g = audio.fade.gain;
  const now = ctx.currentTime;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
  else g.cancelScheduledValues(now);
  g.setTargetAtTime(1, now, 0.1);
}

/** Schedule the sleep timer's fade-out on the audio clock. */
function scheduleTimer() {
  const ctx = audio.ctx;
  clearTimeout(player.finishTimer);
  resetFade();
  if (!prefs.timer) {
    player.endAt = null;
    return;
  }
  const remaining = player.remaining != null ? player.remaining : prefs.timer * 60;
  const now = ctx.currentTime;
  const end = now + remaining;
  const fade = Math.min(FADE_OUT_SECONDS, remaining);
  const g = audio.fade.gain;
  g.setValueAtTime(1, Math.max(now, end - fade));
  g.linearRampToValueAtTime(0, end);
  player.endAt = end;
  player.remaining = null;
  // Clean-up only: the fade above has already silenced the sound by then.
  player.finishTimer = setTimeout(checkFinished, remaining * 1000 + 250);
}

function secondsLeft() {
  if (player.playing && player.endAt != null && audio.ctx) return Math.max(0, player.endAt - audio.ctx.currentTime);
  if (!player.playing && player.remaining != null) return player.remaining;
  return null;
}

function checkFinished() {
  if (!player.playing || player.endAt == null || !audio.ctx) return;
  if (audio.ctx.currentTime < player.endAt) {
    // Woken early (timers drift): look again when it should be done.
    clearTimeout(player.finishTimer);
    player.finishTimer = setTimeout(checkFinished, (player.endAt - audio.ctx.currentTime) * 1000 + 250);
    return;
  }
  finish();
}

/** The timer ran out: the fade has finished, so stop everything. */
function finish() {
  stopSource(0);
  player.playing = false;
  player.endAt = null;
  player.remaining = null;
  player.finished = true;
  clearTimeout(player.finishTimer);
  stopKeepAlive();
  const ctx = audio.ctx;
  const g = audio.fade.gain;
  g.cancelScheduledValues(0);
  g.setValueAtTime(1, ctx.currentTime + 0.05);
  suspendSoon();
  releaseWakeLock();
  updateMediaSession();
  announce('The sleep timer ended and the sound has stopped.');
  render();
}

function suspendSoon() {
  const ctx = audio.ctx;
  setTimeout(() => {
    if (!player.playing && ctx.state === 'running') ctx.suspend().catch(() => {});
  }, 600);
}

/** Start (or switch to) a sound. Called from a tap, so audio may start. */
function play(id = prefs.sound) {
  const sound = soundById(id);
  if (!sound) return;
  const ctx = ensureAudio();
  if (!ctx) {
    toast('This browser cannot play sounds.');
    return;
  }
  startKeepAlive(); // inside the tap: iOS only starts media from a user gesture
  player.starting = true;
  if (ctx.state !== 'running') {
    ctx.resume().catch(() => toast('Sound could not start. Please try again.'));
  }
  if (id !== prefs.sound) {
    prefs.sound = id;
    savePrefs();
  }
  startSource(id);
  if (!player.playing) {
    player.playing = true;
    if (player.finished) player.remaining = null;
    player.finished = false;
    scheduleTimer();
  }
  setTimeout(() => { player.starting = false; }, 1000);
  updateMediaSession();
  announce(`Playing ${sound.title}.`);
  render();
}

function pause({ immediate = false } = {}) {
  if (!player.playing) return;
  const ctx = audio.ctx;
  if (player.endAt != null) player.remaining = Math.max(0, player.endAt - ctx.currentTime);
  player.endAt = null;
  player.playing = false;
  clearTimeout(player.finishTimer);
  stopSource(immediate ? 0 : 0.2);
  // Hold the timer fade where it is until the sound has faded out, then reset it.
  const g = audio.fade.gain;
  const now = ctx.currentTime;
  if (g.cancelAndHoldAtTime) g.cancelAndHoldAtTime(now);
  else g.cancelScheduledValues(now);
  g.setValueAtTime(1, now + (immediate ? 0.05 : 0.3));
  stopKeepAlive();
  suspendSoon();
  updateMediaSession();
  announce('Paused.');
  render();
}

function toggle() {
  if (player.playing) pause();
  else play();
}

function setVolume(value) {
  prefs.volume = clampVolume(value);
  if (audio.ctx) audio.volume.gain.setTargetAtTime(prefs.volume, audio.ctx.currentTime, 0.05);
  savePrefs();
  renderVolume();
}

function setTimer(minutes) {
  if (!TIMER_CHOICES.includes(minutes)) return;
  prefs.timer = minutes;
  player.remaining = null;
  player.finished = false;
  if (player.playing) scheduleTimer();
  savePrefs();
  render();
}

/* ---------- Lock screen ---------- */

function startKeepAlive() {
  if (!audio.keepAlive) {
    const el = new Audio();
    el.loop = true;
    el.preload = 'auto';
    el.setAttribute('playsinline', '');
    el.src = URL.createObjectURL(new Blob([silentWav()], { type: 'audio/wav' }));
    // If the system pauses media (a call, another app), pause the sound too.
    el.addEventListener('pause', () => {
      if (!ownPause && player.playing) pause({ immediate: true });
    });
    audio.keepAlive = el;
  }
  const started = audio.keepAlive.play();
  if (started && started.catch) started.catch(() => { /* sound still plays; no lock-screen controls */ });
}

function stopKeepAlive() {
  if (!audio.keepAlive) return;
  ownPause = true;
  audio.keepAlive.pause();
  ownPause = false;
}

function updateMediaSession() {
  const session = navigator.mediaSession;
  if (!session) return;
  const sound = soundById(prefs.sound);
  try {
    if (sound && 'MediaMetadata' in window) {
      const icon = (size) => ({ src: new URL(`./icons/icon-${size}.png`, location.href).href, sizes: `${size}x${size}`, type: 'image/png' });
      session.metadata = new MediaMetadata({
        title: sound.title,
        artist: player.name ? `Soothe for ${player.name}` : 'Soothe',
        album: 'Davina',
        artwork: [icon(192), icon(512)],
      });
    }
    session.playbackState = player.playing ? 'playing' : 'paused';
  } catch (_) { /* best effort */ }
}

function bindMediaSession() {
  const session = navigator.mediaSession;
  if (!session) return;
  const handlers = { play: () => play(), pause: () => pause(), stop: () => pause() };
  for (const [action, handler] of Object.entries(handlers)) {
    try { session.setActionHandler(action, handler); } catch (_) { /* action not supported */ }
  }
}

/* ---------- Night screen ---------- */

async function requestWakeLock() {
  if (!('wakeLock' in navigator) || wakeLock || document.visibilityState !== 'visible') return;
  try {
    wakeLock = await navigator.wakeLock.request('screen');
    wakeLock.addEventListener('release', () => { wakeLock = null; });
  } catch (_) { wakeLock = null; }
}

function releaseWakeLock() {
  if (wakeLock) wakeLock.release().catch(() => {});
  wakeLock = null;
}

let nightControlsTimer = null;
function showNightControls(show) {
  clearTimeout(nightControlsTimer);
  $('night-controls').hidden = !show;
  $('night-hint').hidden = show;
  if (show) nightControlsTimer = setTimeout(() => showNightControls(false), 8000);
}

function openNight() {
  const dialog = $('night');
  if (dialog.open) return;
  showNightControls(false);
  if (typeof dialog.showModal === 'function') dialog.showModal();
  else dialog.setAttribute('open', '');
  document.body.classList.add('night-open');
  $('night-surface').focus();
  if (player.playing) requestWakeLock();
  render();
}

function closeNight() {
  const dialog = $('night');
  if (dialog.open && typeof dialog.close === 'function') dialog.close();
  else dialog.removeAttribute('open');
}

/* ====================================================================== */
/* Rendering                                                              */
/* ====================================================================== */

function announce(text) {
  const el = $('soothe-status');
  if (el) el.textContent = text;
}

function statusText() {
  const left = secondsLeft();
  if (player.playing) return left == null ? 'Playing, no timer' : formatRemaining(left * 1000);
  if (player.finished) return 'Timer ended';
  if (left != null) return `Paused, ${formatRemaining(left * 1000)}`;
  return prefs.timer ? `Timer: ${prefs.timer} min` : 'No timer';
}

function renderVolume() {
  const input = $('player-volume');
  const pct = Math.round(prefs.volume * 100);
  if (document.activeElement !== input) input.value = String(pct);
  input.setAttribute('aria-valuetext', `${pct}%`);
  $('player-volume-value').textContent = `${pct}%`;
}

function setIcon(useEl, id) {
  useEl.setAttribute('href', `#${id}`);
}

function renderPlayerMode() {
  const route = player.route;
  let mode = '';
  if (route === 'soothe' && prefs.sound) mode = 'full';
  else if (player.playing && route && !['welcome', 'loading', 'error'].includes(route)) mode = 'mini';
  document.body.dataset.player = mode;
  $('player').hidden = !mode;
}

function render() {
  const sound = soundById(prefs.sound);
  renderPlayerMode();

  // Cards
  for (const card of document.querySelectorAll('.sound-card')) {
    const current = card.dataset.sound === prefs.sound;
    const playing = current && player.playing;
    card.setAttribute('aria-pressed', String(playing));
    card.classList.toggle('is-current', current);
    card.querySelector('.sound-state').textContent = playing ? 'Playing' : (current ? 'Paused' : '');
  }

  // Player bar
  if (sound) {
    $('player-title').textContent = sound.title;
    const label = player.playing ? `Pause ${sound.title}` : `Play ${sound.title}`;
    $('player-toggle').setAttribute('aria-label', label);
    setIcon($('player-toggle-icon'), player.playing ? 'i-pause' : 'i-play');
    $('night-toggle').textContent = player.playing ? 'Pause' : 'Play';
    $('night-title').textContent = sound.title;
  }
  const status = statusText();
  $('player-status').textContent = status;
  $('night-time').textContent = status;
  const timer = $('player-timer');
  if (document.activeElement !== timer) timer.value = String(prefs.timer);
  renderVolume();

  $('soothe-tip').hidden = prefs.tipSeen;
  $('soothe-lede').textContent = player.name
    ? `Calming sounds to help ${player.name} settle. Sounds keep playing while you use the rest of the app.`
    : 'Calming sounds to help your baby settle.';

  // Countdown while playing.
  clearInterval(player.uiTimer);
  player.uiTimer = null;
  if (player.playing) {
    player.uiTimer = setInterval(() => {
      const text = statusText();
      $('player-status').textContent = text;
      $('night-time').textContent = text;
      if (player.endAt != null && audio.ctx && audio.ctx.currentTime >= player.endAt) checkFinished();
    }, 1000);
  }
}

/* ====================================================================== */
/* Public                                                                 */
/* ====================================================================== */

function buildGrid() {
  const grid = $('sound-grid');
  grid.textContent = '';
  for (const sound of SOUNDS) {
    const li = document.createElement('li');
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'sound-card';
    button.dataset.sound = sound.id;
    button.setAttribute('aria-pressed', 'false');
    const svgNS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(svgNS, 'svg');
    svg.setAttribute('class', 'icon sound-icon');
    svg.setAttribute('aria-hidden', 'true');
    const use = document.createElementNS(svgNS, 'use');
    use.setAttribute('href', `#${sound.icon}`);
    svg.append(use);
    const title = document.createElement('span');
    title.className = 'sound-title';
    title.textContent = sound.title;
    const blurb = document.createElement('span');
    blurb.className = 'sound-blurb';
    blurb.textContent = sound.blurb;
    const state = document.createElement('span');
    state.className = 'sound-state';
    button.append(svg, title, blurb, state);
    button.addEventListener('click', () => {
      if (sound.id === prefs.sound && player.playing) pause();
      else play(sound.id);
    });
    li.append(button);
    grid.append(li);
  }
}

export async function initSoothe(options = {}) {
  if (options.toast) toast = options.toast;
  buildGrid();
  const volume = $('player-volume');
  volume.max = String(Math.round(MAX_GAIN * 100));
  volume.addEventListener('input', () => setVolume(Number(volume.value) / 100));
  $('player-timer').addEventListener('change', (e) => setTimer(Number(e.target.value)));
  $('player-toggle').addEventListener('click', toggle);
  $('player-night').addEventListener('click', openNight);
  $('soothe-tip-ok').addEventListener('click', () => {
    prefs.tipSeen = true;
    savePrefs();
    render();
    $('soothe-heading').focus();
  });

  const night = $('night');
  $('night-surface').addEventListener('click', () => showNightControls($('night-controls').hidden));
  $('night-toggle').addEventListener('click', () => {
    toggle();
    if (player.playing) requestWakeLock();
    showNightControls(true);
  });
  $('night-exit').addEventListener('click', closeNight);
  night.addEventListener('close', () => {
    clearTimeout(nightControlsTimer);
    document.body.classList.remove('night-open');
    releaseWakeLock();
    $('player-night').focus();
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') return;
    if (night.open && player.playing) requestWakeLock();
    checkFinished();
    render();
  });

  new ResizeObserver(() => {
    document.documentElement.style.setProperty('--player-h', `${$('player').offsetHeight}px`);
  }).observe($('player'));

  bindMediaSession();
  await loadPrefs();
  render();
}

/** Called on every route change, with the baby's name for the wording. */
export function renderSoothe({ route, name }) {
  player.route = route;
  player.name = name || '';
  render();
}

export const sootheState = () => ({ ...prefs, playing: player.playing, secondsLeft: secondsLeft() });
