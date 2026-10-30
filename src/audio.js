// Procedural sound effects and background music (WebAudio, no asset downloads).
// The music is an original generated loop, so there is nothing to license.
let ctx = null;
let master = null;
let sfxBus = null;
let musicBus = null;
let noiseBuf = null;
let sfxOn = true;
let musicOn = true;
let musicTimer = 0;
let wasRunning = false;
const last = {};

const IOS = /iP(hone|ad|od)/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.9;
  sfxBus = ctx.createGain();
  sfxBus.gain.value = 0.75;
  musicBus = ctx.createGain();
  musicBus.gain.value = 0;
  sfxBus.connect(master);
  musicBus.connect(master);
  if (IOS && ctx.createMediaStreamDestination) {
    // Web Audio alone is muted by the iPhone silent switch; a media element is not.
    const dest = ctx.createMediaStreamDestination();
    master.connect(dest);
    const el = new Audio();
    el.srcObject = dest.stream;
    el.setAttribute('playsinline', '');
    el.play().catch(() => {});
    ctx._el = el;
  } else {
    master.connect(ctx.destination);
  }
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

// Must be called from inside a user gesture the first time.
export function unlock() {
  const c = ensure();
  if (!c) return;
  if (c.state !== 'running') c.resume().catch(() => {});
  if (c._el && c._el.paused) c._el.play().catch(() => {});
  if (musicOn) startMusic();
}

// Browsers only allow audio after a real gesture; retry on the first few of them.
for (const t of ['pointerdown', 'pointerup', 'touchend', 'click', 'keydown']) {
  addEventListener(t, () => unlock(), { passive: true });
}
document.addEventListener('visibilitychange', () => {
  if (!ctx) return;
  if (document.hidden) {
    wasRunning = ctx.state === 'running';
    ctx.suspend().catch(() => {});
  } else if (wasRunning) {
    ctx.resume().catch(() => {});
  }
});

export function setEnabled(v) {
  sfxOn = v;
}

export function setMusic(v) {
  musicOn = v;
  if (v) {
    if (ctx) startMusic();
  } else {
    stopMusic();
  }
}

const live = () => sfxOn && ensure() && ctx.state !== 'closed';

function gate(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return false;
  last[name] = now;
  return true;
}

function noise(freq, q, dur, gain, type = 'bandpass', bus = sfxBus, when = 0) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime + when;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(bus);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

function tone(freq, endFreq, dur, gain, type = 'sine', bus = sfxBus, when = 0) {
  const o = ctx.createOscillator();
  o.type = type;
  const t = ctx.currentTime + when;
  o.frequency.setValueAtTime(freq, t);
  if (endFreq !== freq) o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(bus);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function clack(speed) {
  if (!live() || !gate('clack' + ((Math.random() * 3) | 0), 18)) return;
  const v = Math.min(1, speed / 5);
  const base = 2600 + Math.random() * 700;
  noise(base, 2.5, 0.05, 0.5 * v + 0.06);
  tone(base * 0.7, base * 0.45, 0.04, 0.3 * v + 0.03, 'triangle');
}

export function cue(power) {
  if (!live()) return;
  noise(1800, 1.5, 0.06, 0.4 + power * 0.4);
  tone(900, 400, 0.05, 0.25 + power * 0.2, 'triangle');
}

export function thud(speed) {
  if (!live() || !gate('thud', 30)) return;
  const v = Math.min(1, speed / 3);
  noise(380, 0.8, 0.09, 0.45 * v + 0.05, 'lowpass');
  tone(150, 70, 0.07, 0.2 * v, 'sine');
}

export function pocket() {
  if (!live()) return;
  tone(170, 55, 0.22, 0.5, 'sine');
  noise(900, 0.7, 0.35, 0.22, 'bandpass');
  noise(1200, 1, 0.12, 0.12, 'bandpass', sfxBus, 0.18);
}

export function tick() {
  if (!live() || !gate('tick', 40)) return;
  tone(1100, 900, 0.025, 0.07, 'sine');
}

export function chime(good = true) {
  if (!live()) return;
  const notes = good ? [523, 659, 784, 1047, 1319] : [330, 262];
  notes.forEach((f, i) => {
    tone(f, f, 0.45, 0.14, 'sine', sfxBus, i * 0.11);
    if (good) tone(f * 2, f * 2, 0.3, 0.04, 'triangle', sfxBus, i * 0.11);
  });
}

export function fanfare() {
  if (!live()) return;
  [[523, 0], [523, 0.14], [523, 0.28], [659, 0.42], [784, 0.7], [1047, 0.98]].forEach(([f, t]) => {
    tone(f, f, 0.5, 0.13, 'triangle', sfxBus, t);
    tone(f / 2, f / 2, 0.5, 0.08, 'sine', sfxBus, t);
  });
  for (let i = 0; i < 10; i++) noise(5000 + Math.random() * 3000, 1, 0.12, 0.12, 'highpass', sfxBus, 0.95 + i * 0.05);
}

// ---- background music: relaxed lounge loop -----------------------------------
const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
const BPM = 76;
const STEP = 60 / BPM / 2; // eighth note
const SWING = 0.14;
// Cmaj7 Am7 Dm7 G7 | Fmaj7 Em7 Dm7 G7sus
const CHORDS = [
  { root: 36, tones: [60, 64, 67, 71] },
  { root: 33, tones: [57, 60, 64, 67] },
  { root: 38, tones: [62, 65, 69, 72] },
  { root: 31, tones: [59, 62, 65, 69] },
  { root: 41, tones: [60, 64, 69, 72] },
  { root: 40, tones: [59, 62, 67, 71] },
  { root: 38, tones: [62, 65, 69, 72] },
  { root: 31, tones: [60, 62, 65, 69] },
];
const SCALE = [72, 74, 76, 79, 81, 84, 79, 76];
let nextTime = 0;
let step = 0;
let delay = null;

function keys(freq, t, dur, gain) {
  for (const [mul, g, type] of [[1, 1, 'sine'], [2, 0.28, 'sine'], [4, 0.06, 'sine']]) {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = freq * mul;
    const e = ctx.createGain();
    e.gain.setValueAtTime(0.0001, t);
    e.gain.exponentialRampToValueAtTime(gain * g, t + 0.012);
    e.gain.exponentialRampToValueAtTime(0.0001, t + dur / mul ** 0.35);
    o.connect(e).connect(musicBus);
    o.start(t);
    o.stop(t + dur + 0.05);
    if (mul === 1 && delay) e.connect(delay);
  }
}

function scheduleStep(i, t) {
  const bar = Math.floor(i / 8) % CHORDS.length;
  const beat = i % 8; // eighth within bar
  const ch = CHORDS[bar];
  // electric-piano comping: broken chord on eighths
  const order = [0, 2, 1, 3, 2, 1, 3, 2];
  if (beat === 0 || beat === 3 || beat === 5 || beat === 6) {
    const n = ch.tones[order[beat]];
    keys(midi(n), t, 1.1, beat === 0 ? 0.11 : 0.07);
  }
  if (beat === 0) for (const n of ch.tones) keys(midi(n - 12), t + 0.01, 1.8, 0.035);
  // bass
  if (beat === 0 || beat === 4 || beat === 7) {
    const n = beat === 7 ? ch.root + 7 : ch.root;
    tone(midi(n), midi(n), beat === 0 ? 0.9 : 0.5, 0.22, 'triangle', musicBus, t - ctx.currentTime);
  }
  // soft brush kit
  if (beat === 0 || beat === 4) {
    tone(110, 45, 0.18, 0.28, 'sine', musicBus, t - ctx.currentTime);
  }
  if (beat === 2 || beat === 6) noise(2200, 0.6, 0.16, 0.07, 'bandpass', musicBus, t - ctx.currentTime);
  noise(7500, 0.8, 0.05, beat % 2 ? 0.025 : 0.04, 'highpass', musicBus, t - ctx.currentTime);
  // sparse pentatonic melody
  if ((beat === 1 || beat === 3 || beat === 6) && Math.random() < 0.55) {
    const n = SCALE[(Math.random() * SCALE.length) | 0];
    keys(midi(n), t, 1.4, 0.05);
  }
}

function pump() {
  if (!ctx || !musicOn) return;
  if (ctx.state !== 'running') {
    nextTime = ctx.currentTime + 0.1;
    return;
  }
  while (nextTime < ctx.currentTime + 0.5) {
    scheduleStep(step, nextTime);
    step++;
    nextTime += STEP * (step % 2 ? 1 + SWING : 1 - SWING);
  }
}

function startMusic() {
  if (!ensure() || musicTimer) return;
  delay = ctx.createDelay(1);
  delay.delayTime.value = STEP * 3;
  const fb = ctx.createGain();
  fb.gain.value = 0.32;
  const lp = ctx.createBiquadFilter();
  lp.type = 'lowpass';
  lp.frequency.value = 2400;
  const send = ctx.createGain();
  send.gain.value = 0.35;
  delay.connect(lp).connect(fb).connect(delay);
  lp.connect(send).connect(musicBus);
  nextTime = ctx.currentTime + 0.15;
  musicBus.gain.cancelScheduledValues(ctx.currentTime);
  musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
  musicBus.gain.linearRampToValueAtTime(0.4, ctx.currentTime + 2);
  musicTimer = setInterval(pump, 120);
  pump();
}

function stopMusic() {
  if (musicTimer) clearInterval(musicTimer);
  musicTimer = 0;
  if (ctx && musicBus) {
    musicBus.gain.cancelScheduledValues(ctx.currentTime);
    musicBus.gain.setValueAtTime(musicBus.gain.value, ctx.currentTime);
    musicBus.gain.linearRampToValueAtTime(0, ctx.currentTime + 0.4);
  }
}

// Lets tests / diagnostics see whether audio is actually running.
export const status = () => ({ state: ctx ? ctx.state : 'none', sfx: sfxOn, music: musicOn, playing: !!musicTimer, ios: IOS });
