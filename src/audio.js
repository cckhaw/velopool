// Procedural sound effects (no asset downloads).
let ctx = null;
let master = null;
let noiseBuf = null;
let enabled = true;
let last = {};

function ensure() {
  if (ctx) return ctx;
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  ctx = new AC();
  master = ctx.createGain();
  master.gain.value = 0.7;
  master.connect(ctx.destination);
  noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
  const d = noiseBuf.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return ctx;
}

export function unlock() {
  const c = ensure();
  if (c && c.state === 'suspended') c.resume();
}

export function setEnabled(v) {
  enabled = v;
}

function gate(name, ms) {
  const now = performance.now();
  if (last[name] && now - last[name] < ms) return false;
  last[name] = now;
  return true;
}

function noise(freq, q, dur, gain, type = 'bandpass') {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuf;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  const t = ctx.currentTime;
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(f).connect(g).connect(master);
  src.start(t, Math.random() * 0.3);
  src.stop(t + dur + 0.02);
}

function tone(freq, endFreq, dur, gain, type = 'sine') {
  const o = ctx.createOscillator();
  o.type = type;
  const t = ctx.currentTime;
  o.frequency.setValueAtTime(freq, t);
  o.frequency.exponentialRampToValueAtTime(Math.max(20, endFreq), t + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(gain, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(master);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export function clack(speed) {
  if (!enabled || !ensure() || !gate('clack' + ((Math.random() * 3) | 0), 18)) return;
  const v = Math.min(1, speed / 5);
  const base = 2600 + Math.random() * 700;
  noise(base, 2.5, 0.05, 0.5 * v + 0.06);
  tone(base * 0.7, base * 0.45, 0.04, 0.3 * v + 0.03, 'triangle');
}

export function cue(power) {
  if (!enabled || !ensure()) return;
  noise(1800, 1.5, 0.06, 0.4 + power * 0.4);
  tone(900, 400, 0.05, 0.25 + power * 0.2, 'triangle');
}

export function thud(speed) {
  if (!enabled || !ensure() || !gate('thud', 30)) return;
  const v = Math.min(1, speed / 3);
  noise(380, 0.8, 0.09, 0.45 * v + 0.05, 'lowpass');
  tone(150, 70, 0.07, 0.2 * v, 'sine');
}

export function pocket() {
  if (!enabled || !ensure()) return;
  tone(170, 55, 0.22, 0.5, 'sine');
  noise(900, 0.7, 0.35, 0.22, 'bandpass');
  setTimeout(() => ctx && noise(1200, 1, 0.12, 0.12), 180);
}

export function tick() {
  if (!enabled || !ensure() || !gate('tick', 40)) return;
  tone(1100, 900, 0.025, 0.07, 'sine');
}

export function chime(good = true) {
  if (!enabled || !ensure()) return;
  const notes = good ? [660, 880, 1320] : [330, 262];
  notes.forEach((f, i) => setTimeout(() => ctx && tone(f, f, 0.35, 0.12), i * 110));
}
