/*
 * Soothing sounds, synthesised in JavaScript as seamless loops (no audio files).
 * Pure functions, no browser APIs, so they are unit-tested in Node.
 *
 * Each sound is a mono Float32Array whose end runs straight into its start:
 * noises are cross-faded over the loop point, and timed sounds (heartbeat,
 * shush, lullabies) are a whole number of periods rendered circularly.
 */

export const DEFAULT_VOLUME = 0.3;  // start at 30%
export const MAX_GAIN = 0.7;        // the output gain is never above 70%
export const FADE_OUT_SECONDS = 10; // sleep-timer fade
export const TIMER_CHOICES = [15, 30, 60, 0]; // minutes; 0 = continuous

/** Volume as an output gain, always within 0..MAX_GAIN. */
export function clampVolume(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return 0;
  return Math.min(n, MAX_GAIN);
}

export const SOUNDS = [
  { id: 'white', title: 'White noise', blurb: 'Even, steady hiss', icon: 'i-wave', group: 'sounds' },
  { id: 'pink', title: 'Pink noise', blurb: 'Softer, like steady rain', icon: 'i-rain', group: 'sounds' },
  { id: 'brown', title: 'Brown noise', blurb: 'Deep, low rumble', icon: 'i-wave-low', group: 'sounds' },
  { id: 'heartbeat', title: 'Heartbeat', blurb: 'Slow, 70 beats a minute', icon: 'i-heart', group: 'sounds' },
  { id: 'shush', title: 'Shush', blurb: 'Gentle, rhythmic shushing', icon: 'i-wind', group: 'sounds' },
  { id: 'lullaby', title: 'Brahms’ Lullaby', blurb: 'Lullaby and goodnight', icon: 'i-note', group: 'lullabies' },
  { id: 'twinkle', title: 'Twinkle, Twinkle', blurb: 'Little star, softly', icon: 'i-star', group: 'lullabies' },
  { id: 'sleeping', title: 'Are You Sleeping', blurb: 'Frère Jacques, slow', icon: 'i-note', group: 'lullabies' },
  { id: 'grace', title: 'Amazing Grace', blurb: 'The gentle hymn', icon: 'i-note', group: 'lullabies' },
  { id: 'greensleeves', title: 'Greensleeves', blurb: 'Old English tune', icon: 'i-note', group: 'lullabies' },
];

export const GROUPS = [
  { id: 'sounds', title: 'Sounds' },
  { id: 'lullabies', title: 'Lullabies', note: 'Music-box melodies, all in the public domain.' },
];

export const soundById = (id) => SOUNDS.find((s) => s.id === id) || null;

/* ---------- Building blocks ---------- */

/** Small seeded PRNG (mulberry32), so every loop is the same each time. */
function random(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** RBJ biquad, applied in place. type: 'lowpass' | 'bandpass' | 'highpass'. */
function biquad(x, sr, type, f0, q) {
  const w0 = (2 * Math.PI * f0) / sr;
  const cos = Math.cos(w0);
  const alpha = Math.sin(w0) / (2 * q);
  let b0, b1, b2;
  if (type === 'lowpass') { b0 = (1 - cos) / 2; b1 = 1 - cos; b2 = b0; }
  else if (type === 'highpass') { b0 = (1 + cos) / 2; b1 = -(1 + cos); b2 = b0; }
  else { b0 = alpha; b1 = 0; b2 = -alpha; }
  const a0 = 1 + alpha;
  const a1 = -2 * cos;
  const a2 = 1 - alpha;
  b0 /= a0; b1 /= a0; b2 /= a0;
  const c1 = a1 / a0;
  const c2 = a2 / a0;
  let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
  for (let i = 0; i < x.length; i++) {
    const xi = x[i];
    const y = b0 * xi + b1 * x1 + b2 * x2 - c1 * y1 - c2 * y2;
    x2 = x1; x1 = xi; y2 = y1; y1 = y;
    x[i] = y;
  }
  return x;
}

/**
 * Turn a stream of length+fade samples into a seamless loop of `length`:
 * the extra tail is faded into the head with equal power, so the last
 * sample runs on into the first exactly as the stream did.
 */
function crossfadeLoop(stream, length, fade) {
  const out = stream.slice(0, length);
  for (let i = 0; i < fade; i++) {
    const a = i / fade;
    out[i] = stream[i] * Math.sqrt(a) + stream[length + i] * Math.sqrt(1 - a);
  }
  return out;
}

/** Scale to a target loudness (RMS), never letting a peak pass `peakMax`. */
function normalise(x, { rms, peak: peakMax = 0.95 }) {
  let sum = 0, peak = 0;
  for (let i = 0; i < x.length; i++) {
    sum += x[i] * x[i];
    const a = Math.abs(x[i]);
    if (a > peak) peak = a;
  }
  const current = Math.sqrt(sum / x.length) || 1;
  let scale = rms ? rms / current : peakMax / (peak || 1);
  if (peak * scale > peakMax) scale = peakMax / peak;
  for (let i = 0; i < x.length; i++) x[i] *= scale;
  return x;
}

/** Noise stream of n samples after a settling period; `shape` filters it. */
function noiseStream(n, sr, seed, shape) {
  const rand = random(seed);
  const warm = Math.round(sr * 0.5);
  const x = new Float32Array(n + warm);
  for (let i = 0; i < x.length; i++) x[i] = rand() * 2 - 1;
  shape(x);
  return x.subarray(warm).slice();
}

/* ---------- Noises ---------- */

function pinkFilter(x) {
  // Paul Kellet's refined pink-noise filter (−3 dB per octave).
  let b0 = 0, b1 = 0, b2 = 0, b3 = 0, b4 = 0, b5 = 0, b6 = 0;
  for (let i = 0; i < x.length; i++) {
    const w = x[i];
    b0 = 0.99886 * b0 + w * 0.0555179;
    b1 = 0.99332 * b1 + w * 0.0750759;
    b2 = 0.96900 * b2 + w * 0.1538520;
    b3 = 0.86650 * b3 + w * 0.3104856;
    b4 = 0.55000 * b4 + w * 0.5329522;
    b5 = -0.7616 * b5 - w * 0.0168980;
    x[i] = b0 + b1 + b2 + b3 + b4 + b5 + b6 + w * 0.5362;
    b6 = w * 0.115926;
  }
  return x;
}

function brownFilter(x) {
  // Leaky integrator (−6 dB per octave), then remove the slow drift.
  let last = 0;
  for (let i = 0; i < x.length; i++) {
    last = (last + 0.02 * x[i]) / 1.02;
    x[i] = last;
  }
  return x;
}

function loopedNoise(sr, seconds, seed, shape) {
  const length = Math.round(sr * seconds);
  const fade = Math.round(sr * 1);
  return crossfadeLoop(noiseStream(length + fade, sr, seed, shape), length, fade);
}

const white = (sr) => normalise(loopedNoise(sr, 20, 11, (x) => x), { rms: 0.11 });
const pink = (sr) => normalise(loopedNoise(sr, 20, 23, pinkFilter), { rms: 0.15 });
const brown = (sr) => normalise(
  loopedNoise(sr, 20, 37, (x) => biquad(brownFilter(x), sr, 'highpass', 25, 0.7)),
  { rms: 0.2 },
);

/* ---------- Shush: band-limited noise that swells and settles ---------- */

function shush(sr) {
  const period = Math.round(sr * 2.4);
  const length = period * 8;
  const fade = Math.round(sr * 0.5);
  const stream = noiseStream(length + fade, sr, 41, (x) => {
    biquad(x, sr, 'bandpass', 3200, 0.6);
    return biquad(x, sr, 'lowpass', 7000, 0.7);
  });
  const x = crossfadeLoop(stream, length, fade);
  // "Shhh … shhh …": rise, hold, fall, rest. Periodic, so the loop stays seamless.
  const smooth = (t) => 0.5 - 0.5 * Math.cos(Math.PI * Math.min(Math.max(t, 0), 1));
  for (let i = 0; i < length; i++) {
    const p = (i % period) / period;
    let env;
    if (p < 0.18) env = smooth(p / 0.18);
    else if (p < 0.55) env = 1;
    else if (p < 0.85) env = 1 - smooth((p - 0.55) / 0.3);
    else env = 0;
    x[i] *= 0.3 + 0.7 * env;
  }
  return normalise(x, { rms: 0.13 });
}

/* ---------- Heartbeat: "lub-dub" at 70 bpm over a soft womb-like bed ---------- */

/** Add `src` into `out` starting at `at`, wrapping around the end. */
function addCircular(out, src, at, gain = 1) {
  const n = out.length;
  for (let i = 0; i < src.length; i++) out[(at + i) % n] += src[i] * gain;
}

function thump(sr, seed) {
  const n = Math.round(sr * 0.35);
  const x = new Float32Array(n);
  const rand = random(seed);
  const noise = new Float32Array(n);
  for (let i = 0; i < n; i++) noise[i] = rand() * 2 - 1;
  biquad(noise, sr, 'lowpass', 220, 0.8);
  let phase = 0;
  for (let i = 0; i < n; i++) {
    const t = i / sr;
    const f = 45 + 30 * Math.exp(-t / 0.05); // pitch falls 75 → 45 Hz
    phase += (2 * Math.PI * f) / sr;
    const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.07);
    // A second harmonic and filtered noise keep it audible on phone speakers.
    x[i] = env * (Math.sin(phase) + 0.45 * Math.sin(2 * phase)) + 3 * noise[i] * Math.exp(-t / 0.035);
  }
  return x;
}

function heartbeat(sr) {
  const beat = Math.round((sr * 60) / 70);
  const length = beat * 12;
  const out = new Float32Array(length);
  const lub = thump(sr, 51);
  const dub = thump(sr, 53);
  const gap = Math.round(sr * 0.28);
  for (let k = 0; k < 12; k++) {
    addCircular(out, lub, k * beat, 1);
    addCircular(out, dub, k * beat + gap, 0.6);
  }
  normalise(out, { peak: 0.85 });
  const bed = normalise(loopedNoise(sr, length / sr, 59, brownFilter).subarray(0, length), { rms: 0.03 });
  for (let i = 0; i < length; i++) out[i] += bed[i];
  return normalise(out, { peak: 0.9 });
}

/* ---------- Lullabies: public-domain melodies as music-box tones ---------- */

// Melodies are [MIDI note, length] pairs; null is a rest. Each tune has a `unit` (seconds per length step), a bar length in steps (for
// the tests: every tune must fill whole bars, pickup included), and an octave shift.
export const TUNES = {
  // Brahms' Lullaby (Wiegenlied, Op. 49 No. 4, 1868). 3/4, in eighth notes.
  lullaby: {
    unit: 0.42, bar: 6, octave: 1,
    notes: [
      [64, 1], [64, 1],
      [67, 4], [64, 1], [64, 1],
      [67, 4], [64, 1], [67, 1],
      [72, 2], [71, 2], [69, 2],
      [69, 2], [67, 2], [62, 1], [64, 1],
      [65, 2], [62, 2], [62, 1], [64, 1],
      [65, 4], [62, 1], [65, 1],
      [71, 1], [69, 1], [67, 2], [71, 2],
      [72, 4], [60, 1], [60, 1],
      [72, 4], [69, 1], [65, 1],
      [67, 4], [64, 1], [60, 1],
      [65, 2], [67, 2], [69, 2],
      [67, 4], [60, 1], [60, 1],
      [72, 4], [69, 1], [65, 1],
      [67, 4], [64, 1], [60, 1],
      [65, 2], [64, 2], [62, 2],
      [60, 6],
      [null, 4],
    ],
  },
  // Twinkle, Twinkle, Little Star ("Ah ! vous dirai-je, maman", France, 1761). 4/4, in eighths.
  twinkle: {
    unit: 0.34, bar: 8, octave: 1,
    notes: [
      [60, 2], [60, 2], [67, 2], [67, 2], [69, 2], [69, 2], [67, 4],
      [65, 2], [65, 2], [64, 2], [64, 2], [62, 2], [62, 2], [60, 4],
      [67, 2], [67, 2], [65, 2], [65, 2], [64, 2], [64, 2], [62, 4],
      [67, 2], [67, 2], [65, 2], [65, 2], [64, 2], [64, 2], [62, 4],
      [60, 2], [60, 2], [67, 2], [67, 2], [69, 2], [69, 2], [67, 4],
      [65, 2], [65, 2], [64, 2], [64, 2], [62, 2], [62, 2], [60, 4],
      [null, 8],
    ],
  },
  // Are You Sleeping (Frère Jacques, France, 18th century). 4/4, in eighths, slow.
  sleeping: {
    unit: 0.36, bar: 8, octave: 1,
    notes: [
      [60, 2], [62, 2], [64, 2], [60, 2],
      [60, 2], [62, 2], [64, 2], [60, 2],
      [64, 2], [65, 2], [67, 4],
      [64, 2], [65, 2], [67, 4],
      [67, 1], [69, 1], [67, 1], [65, 1], [64, 2], [60, 2],
      [67, 1], [69, 1], [67, 1], [65, 1], [64, 2], [60, 2],
      [60, 2], [55, 2], [60, 4],
      [60, 2], [55, 2], [60, 4],
      [null, 8],
    ],
  },
  // Amazing Grace (hymn tune "New Britain", USA, 1829). 3/4, in eighths.
  grace: {
    unit: 0.4, bar: 6, octave: 1,
    notes: [
      [62, 2],
      [67, 4], [71, 1], [67, 1],
      [71, 4], [69, 2],
      [67, 4], [64, 2],
      [62, 4], [62, 2],
      [67, 4], [71, 1], [67, 1],
      [71, 4], [69, 2],
      [74, 4], [71, 2],
      [74, 4], [71, 1], [67, 1],
      [71, 4], [69, 2],
      [67, 4], [64, 2],
      [62, 4], [62, 2],
      [67, 4], [71, 1], [67, 1],
      [71, 4], [69, 2],
      [67, 6],
      [null, 4],
    ],
  },
  // Greensleeves (English, 16th century). 3/4, in sixteenths; already in a music-box register.
  greensleeves: {
    unit: 0.15, bar: 12, octave: 0,
    notes: [
      [69, 4],
      [72, 8], [74, 4],
      [76, 6], [77, 2], [76, 4],
      [74, 8], [71, 4],
      [67, 6], [69, 2], [71, 4],
      [72, 8], [69, 4],
      [69, 6], [68, 2], [69, 4],
      [71, 8], [68, 4],
      [64, 8], [69, 4],
      [72, 8], [74, 4],
      [76, 6], [77, 2], [76, 4],
      [74, 8], [71, 4],
      [67, 6], [69, 2], [71, 4],
      [72, 6], [71, 2], [69, 4],
      [68, 6], [66, 2], [68, 4],
      [69, 12],
      [69, 12],
      [79, 12],
      [79, 6], [78, 2], [76, 4],
      [74, 8], [71, 4],
      [67, 6], [69, 2], [71, 4],
      [72, 8], [69, 4],
      [69, 6], [68, 2], [69, 4],
      [71, 8], [68, 4],
      [64, 12],
      [79, 12],
      [79, 6], [78, 2], [76, 4],
      [74, 8], [71, 4],
      [67, 6], [69, 2], [71, 4],
      [72, 6], [71, 2], [69, 4],
      [68, 6], [66, 2], [68, 4],
      [69, 12],
      [69, 8],
      [null, 12],
    ],
  },
};

/** One music-box note: a few decaying partials, the top one slightly inharmonic like a tine. */
function musicBoxNote(sr, midi) {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const n = Math.round(sr * 2.2);
  const x = new Float32Array(n);
  const partials = [[1, 1, 1.4], [2, 0.22, 0.5], [3, 0.08, 0.3], [4.2, 0.05, 0.18]];
  for (const [ratio, amp, tau] of partials) {
    if (f * ratio > sr / 2.2) continue;
    // Rotating phasor: cheaper than Math.sin per sample.
    const w = (2 * Math.PI * f * ratio) / sr;
    const c = Math.cos(w), s = Math.sin(w);
    let re = 1, im = 0;
    let a = amp;
    const decay = Math.exp(-1 / (tau * sr));
    for (let i = 0; i < n; i++) {
      const attack = i < 0.004 * sr ? i / (0.004 * sr) : 1;
      x[i] += a * attack * im;
      const nr = re * c - im * s;
      im = re * s + im * c;
      re = nr;
      a *= decay;
    }
  }
  return x;
}

function musicBox(sr, { notes, unit, octave }) {
  const step = Math.round(sr * unit);
  const total = notes.reduce((sum, [, len]) => sum + len, 0);
  const out = new Float32Array(step * total);
  const made = new Map();
  let at = 0;
  for (const [midi, len] of notes) {
    if (midi != null) {
      const pitch = midi + 12 * octave;
      if (!made.has(pitch)) made.set(pitch, musicBoxNote(sr, pitch));
      addCircular(out, made.get(pitch), at, 1);
    }
    at += len * step;
  }
  // A soft echo, as in a small room. Circular, so the loop stays seamless.
  const dry = out.slice();
  const delay = Math.round(sr * 0.3);
  addCircular(out, dry, delay, 0.22);
  addCircular(out, dry, delay * 2, 0.08);
  return normalise(out, { peak: 0.6 });
}

/* ---------- Public ---------- */

const MAKERS = { white, pink, brown, heartbeat, shush };
for (const [id, tune] of Object.entries(TUNES)) MAKERS[id] = (sr) => musicBox(sr, tune);

/** The loop for a sound at a sample rate, as a mono Float32Array (peaks within ±1). */
export function synthesize(id, sampleRate) {
  const make = MAKERS[id];
  if (!make) throw new Error(`Unknown sound "${id}"`);
  return make(sampleRate);
}

/** A 16-bit mono WAV file of silence: keeps a media session alive beside Web Audio. */
export function silentWav(seconds = 10, sampleRate = 8000) {
  const samples = Math.round(seconds * sampleRate);
  const buffer = new ArrayBuffer(44 + samples * 2);
  const v = new DataView(buffer);
  const text = (offset, s) => { for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i)); };
  text(0, 'RIFF'); v.setUint32(4, 36 + samples * 2, true); text(8, 'WAVE');
  text(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  text(36, 'data'); v.setUint32(40, samples * 2, true);
  return buffer;
}

/** "28 min left", "45 s left". */
export function formatRemaining(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  if (s < 60) return `${s} s left`;
  return `${Math.ceil(s / 60)} min left`;
}
