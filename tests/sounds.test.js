import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  SOUNDS, synthesize, clampVolume, silentWav, formatRemaining, LULLABY,
  DEFAULT_VOLUME, MAX_GAIN, FADE_OUT_SECONDS, TIMER_CHOICES,
} from '../js/sounds.js';

test('safety limits: start at 30%, never above 70%, 10 s fade', () => {
  assert.equal(DEFAULT_VOLUME, 0.3);
  assert.equal(MAX_GAIN, 0.7);
  assert.equal(FADE_OUT_SECONDS, 10);
  assert.deepEqual(TIMER_CHOICES, [15, 30, 60, 0]);
  assert.equal(clampVolume(0.3), 0.3);
  assert.equal(clampVolume(1), 0.7);
  assert.equal(clampVolume(70), 0.7);
  assert.equal(clampVolume(-1), 0);
  assert.equal(clampVolume('loud'), 0);
  assert.equal(clampVolume(Infinity), 0);
});

test('six sounds, including one public-domain lullaby', () => {
  assert.deepEqual(SOUNDS.map((s) => s.id), ['white', 'pink', 'brown', 'heartbeat', 'shush', 'lullaby']);
  // 3/4 time: after the two-eighth pickup, the melody fills whole bars.
  const eighths = LULLABY.reduce((sum, [, len]) => sum + len, 0);
  assert.equal(eighths % 6, 0);
});

for (const sampleRate of [44100, 48000]) {
  test(`every sound at ${sampleRate} Hz is quick to make, finite, within ±1 and loops seamlessly`, () => {
    for (const { id } of SOUNDS) {
      const start = performance.now();
      const x = synthesize(id, sampleRate);
      const ms = performance.now() - start;
      assert.ok(ms < 500, `${id} took ${ms.toFixed(0)} ms`);
      assert.ok(x.length > sampleRate * 5, `${id} loop is long enough`);
      let peak = 0, sum = 0, step = 0;
      for (let i = 0; i < x.length; i++) {
        assert.ok(Number.isFinite(x[i]), `${id} has a bad sample at ${i}`);
        peak = Math.max(peak, Math.abs(x[i]));
        sum += x[i] * x[i];
        if (i) step += Math.abs(x[i] - x[i - 1]);
      }
      assert.ok(peak <= 0.95, `${id} peak ${peak}`);
      assert.ok(Math.sqrt(sum / x.length) > 0.02, `${id} is audible`);
      // The jump from the last sample back to the first is like any other step.
      const seam = Math.abs(x[0] - x[x.length - 1]);
      assert.ok(seam < (step / (x.length - 1)) * 6 + 1e-3, `${id} clicks at the loop point (${seam})`);
    }
  });
}

test('heartbeat loop is a whole number of beats at 70 bpm', () => {
  const sr = 48000;
  const x = synthesize('heartbeat', sr);
  const beat = Math.round((sr * 60) / 70);
  assert.equal(x.length % beat, 0);
  assert.ok(Math.abs(60 / (beat / sr) - 70) < 0.01);
});

test('silent keep-alive file is a valid WAV of silence', () => {
  const buf = silentWav(10, 8000);
  const v = new DataView(buf);
  const tag = (o) => String.fromCharCode(v.getUint8(o), v.getUint8(o + 1), v.getUint8(o + 2), v.getUint8(o + 3));
  assert.equal(tag(0), 'RIFF');
  assert.equal(tag(8), 'WAVE');
  assert.equal(tag(36), 'data');
  assert.equal(v.getUint32(40, true), 160000);
  assert.equal(buf.byteLength, 44 + 160000);
  assert.ok(new Int16Array(buf, 44).every((s) => s === 0));
});

test('time left wording', () => {
  assert.equal(formatRemaining(30 * 60 * 1000), '30 min left');
  assert.equal(formatRemaining(29 * 60 * 1000 + 1), '30 min left');
  assert.equal(formatRemaining(59 * 1000), '59 s left');
  assert.equal(formatRemaining(-5), '0 s left');
});

test('app name is Davina when installed', () => {
  const manifest = JSON.parse(readFileSync(new URL('../manifest.webmanifest', import.meta.url), 'utf8'));
  assert.equal(manifest.name, 'Davina');
  assert.equal(manifest.short_name, 'Davina');
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(html, /<meta name="apple-mobile-web-app-title" content="Davina">/);
  assert.match(html, /media-src 'self' blob:/, 'CSP allows the generated keep-alive audio');
});
