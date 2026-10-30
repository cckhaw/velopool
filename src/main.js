import './style.css';
import { View, CLOTHS } from './view.js';
import { World, predict, powerToSpeed, L, W, R, HL, HW, HEAD_X, FOOT_X } from './physics.js';
import { rackLayout, resolveShot, groupOf } from './rules.js';
import { planShot, planBreak, chooseCuePosition } from './ai.js';
import * as sfx from './audio.js';
import { celebrate } from './confetti.js';

const $ = (id) => document.getElementById(id);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const BALL_CSS = ['', '#f5c518', '#1d4fd8', '#d7261e', '#5b2a9c', '#f2761a', '#13803b', '#8c1d22', '#111'];

const view = new View($('gl'));
const world = new World();

// ---- persisted settings ---------------------------------------------------
const prefs = { mode: 'cpu', level: 'medium', cloth: 'blue', sound: true, music: true };
try {
  Object.assign(prefs, JSON.parse(localStorage.getItem('velopool') || '{}'));
} catch (_) { /* storage unavailable */ }
const savePrefs = () => {
  try { localStorage.setItem('velopool', JSON.stringify(prefs)); } catch (_) { /* ignore */ }
};

// ---- game state -----------------------------------------------------------
const S = {
  phase: 'menu', // menu | placing | aiming | striking | rolling | ai | over
  inGame: false,
  turn: 0,
  players: [],
  breakShot: true,
  aim: 0,
  power: 0,
  lastPower: 0.55,
  spin: { x: 0, y: 0 },
  view: '3d',
  look: false,
  explore: false,
  ex: { tx: 0, tz: 0, yaw: 0, pitch: 0.95, dist: 3 },
  yawOff: 0,
  pitch: 0.42,
  dist: 1.05,
  shot: null,
  strike: null,
  ai: null,
  placeValid: true,
  winner: null,
};

// ---- HUD ------------------------------------------------------------------
let toastTimer = 0;
function toast(msg, bad = false, ms = 2200) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('bad', bad);
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

function renderPills(i) {
  const p = S.players[i];
  const el = $('pl' + i);
  el.innerHTML = '';
  if (!p.group) {
    el.innerHTML = '<span class="pill-open">' + (S.inGame ? 'Open' : '') + '</span>';
    return;
  }
  const ids = p.group === 'solid' ? [1, 2, 3, 4, 5, 6, 7] : [9, 10, 11, 12, 13, 14, 15];
  const all8 = ids.every((id) => !world.balls[id].inPlay);
  for (const id of ids) {
    const d = document.createElement('i');
    d.className = 'pill-ball' + (id > 8 ? ' stripe' : '') + (world.balls[id].inPlay ? '' : ' out');
    d.style.setProperty('--c', BALL_CSS[id > 8 ? id - 8 : id]);
    el.appendChild(d);
  }
  const e = document.createElement('i');
  e.className = 'pill-ball' + (world.balls[8].inPlay ? '' : ' out');
  e.style.setProperty('--c', '#111');
  e.style.marginLeft = '4px';
  e.style.display = all8 ? '' : 'none';
  el.appendChild(e);
}

function renderHud() {
  S.players.forEach((p, i) => {
    $('pn' + i).textContent = p.name;
    const av = $('av' + i);
    av.textContent = p.avatar;
    av.style.setProperty('--a', p.colors[0]);
    av.style.setProperty('--b', p.colors[1]);
    $('p' + i).classList.toggle('active', S.inGame && S.turn === i && S.phase !== 'over');
    renderPills(i);
  });
  const top = $('mid-top');
  const sub = $('mid-sub');
  if (!S.inGame) { top.textContent = '8-Ball'; sub.textContent = ''; return; }
  const cur = S.players[S.turn];
  if (S.phase === 'over') { top.textContent = 'Game over'; sub.textContent = ''; return; }
  top.textContent = S.breakShot ? 'Break' : cur.isAI ? `${cur.name}'s turn` : S.players.length && !S.players[1].isAI ? cur.name : 'Your turn';
  sub.textContent = cur.group ? (cur.group === 'solid' ? 'Solids' : 'Stripes') : 'Open table';
}

function updateControls() {
  const mine = !S.players[S.turn].isAI;
  const ex = S.explore;
  const aiming = S.phase === 'aiming' && mine && !ex;
  const placing = S.phase === 'placing' && mine;
  $('power').classList.toggle('disabled', !aiming);
  $('fine').classList.toggle('disabled', !aiming);
  $('fine').classList.toggle('hidden', ex);
  $('btn-shoot').disabled = !aiming;
  $('btn-shoot').classList.toggle('hidden', placing || ex);
  $('btn-place').classList.toggle('hidden', !placing || ex);
  $('btn-place').disabled = !S.placeValid;
  $('btn-back').classList.toggle('hidden', !ex);
  $('btn-back').textContent = S.phase === 'placing' && mine ? 'Back to placing' : S.phase === 'aiming' && mine ? 'Back to aiming' : 'Done';
  $('btn-spin').style.opacity = aiming ? 1 : 0.5;
  $('btn-explore').setAttribute('aria-pressed', ex);
  $('btn-explore').setAttribute('aria-label', ex ? 'Leave survey mode' : 'Survey the table');
  $('explore-badge').classList.toggle('hidden', !ex);
  $('btn-view').textContent = ex ? (S.ex.pitch > 1.4 ? '3D' : '2D') : S.view === '3d' ? '2D' : '3D';
}

function exploreOverview() {
  const portrait = view.aspect < 1;
  Object.assign(S.ex, { tx: 0, tz: 0, pitch: 0.95, dist: portrait ? 3.8 : 3.1 });
}

function setExplore(on) {
  if (on === S.explore || !S.inGame || S.phase === 'menu') return;
  if (on) {
    powerDrag = false;
    powerEl.classList.remove('drag');
    setPower(0);
    S.ex.yaw = view.rig.yaw;
    exploreOverview();
    S.explore = true;
    toast('Survey mode · drag to look, pinch or scroll to zoom', false, 2600);
  } else {
    S.explore = false;
  }
  sfx.tick();
  updateControls();
}

function setPower(p) {
  S.power = p;
  const el = $('power');
  const h = el.clientHeight;
  const top = 3 + p * (h - 54);
  el.querySelector('.power-knob').style.top = top + 'px';
  el.querySelector('.power-fill').style.height = top + 24 + 'px';
  $('power-val').textContent = Math.round(p * 100);
  el.setAttribute('aria-valuenow', Math.round(p * 100));
  el.querySelector('.power-fill').style.opacity = p > 0 ? 0.85 : 0;
}

function setSpin(x, y) {
  const r = Math.hypot(x, y);
  if (r > 0.85) { x *= 0.85 / r; y *= 0.85 / r; }
  S.spin.x = x;
  S.spin.y = y;
  for (const [id, scale] of [['spin-dot', 0.5], ['spin-dot-big', 0.5]]) {
    const d = $(id);
    d.style.left = 50 + x * 50 * scale * 1.0 * (id === 'spin-dot' ? 1 : 1) + '%';
    d.style.top = 50 - y * 50 * scale * 1.0 + '%';
  }
}

// ---- game flow ----------------------------------------------------------
const BOT_NAMES = ['Maya', 'Leo', 'Sofia', 'Jack', 'Aiko', 'Marco', 'Nina', 'Omar', 'Chloe', 'Ravi', 'Elena', 'Theo', 'Zara', 'Diego', 'Mei', 'Finn', 'Priya', 'Hugo', 'Lena', 'Kai'];
const BOT_FACES = ['😎', '🧑‍🎤', '🦊', '🐯', '🧔', '👩‍🦰', '🧑‍🚀', '🕶️', '🎩', '🐼'];
const pick = (a) => a[(Math.random() * a.length) | 0];
function newGame() {
  const cpu = prefs.mode === 'cpu';
  S.players = [
    { name: cpu ? 'You' : 'Player 1', avatar: cpu ? '🙂' : '1', isAI: false, group: null, colors: ['#5ac8fa', '#0a84ff'] },
    { name: cpu ? pick(BOT_NAMES) : 'Player 2', avatar: cpu ? pick(BOT_FACES) : '2', isAI: cpu, group: null, colors: ['#ff9f0a', '#ff375f'] },
  ];
  S.inGame = true;
  S.explore = false;
  S.turn = 0;
  S.breakShot = true;
  S.winner = null;
  rack();
  S.ai = null;
  setSpin(0, 0);
  setPower(0);
  S.yawOff = 0;
  S.aim = 0;
  beginTurn(true);
  toast('Break shot — place the cue ball behind the line');
}

function rack() {
  for (const b of world.balls) world.place(b.id, 0, 0);
  for (const r of rackLayout()) world.place(r.id, r.x, r.y);
  world.place(0, HEAD_X, 0);
  view.syncBalls(world.balls, 0, 0);
  for (const m of view.ballMeshes) { m.visible = true; m.scale.setScalar(1); }
  view.pocketAnim.clear();
}

function beginTurn(inHand) {
  const p = S.players[S.turn];
  S.shot = null;
  setPower(0);
  if (inHand) {
    if (!world.cue.inPlay) world.place(0, HEAD_X, 0);
    if (p.isAI) {
      S.phase = 'ai';
      S.ai = { stage: 'place', t: 0 };
    } else {
      S.phase = 'placing';
      if (!S.breakShot) world.cue.x = clamp(world.cue.x, -HL + R, HL - R);
      validatePlacement();
    }
  } else if (p.isAI) {
    S.phase = 'ai';
    S.ai = { stage: 'think', t: 0 };
  } else {
    S.phase = 'aiming';
    autoAim();
  }
  renderHud();
  updateControls();
}

// point the cue at the nearest legal ball so the first view is useful
function autoAim() {
  const c = world.cue;
  const p = S.players[S.turn];
  let best = null;
  for (const b of world.balls) {
    if (b.id === 0 || !b.inPlay) continue;
    if (p.group && groupOf(b.id) !== p.group && !(b.id === 8 && allCleared(p.group))) continue;
    if (!p.group && b.id === 8) continue;
    const d = Math.hypot(b.x - c.x, b.y - c.y);
    if (!best || d < best.d) best = { d, b };
  }
  if (best) S.aim = Math.atan2(best.b.y - c.y, best.b.x - c.x);
  S.yawOff = 0;
}

const allCleared = (g) => world.balls.every((b) => b.id === 0 || b.id === 8 || groupOf(b.id) !== g || !b.inPlay);

function validatePlacement() {
  const c = world.cue;
  let ok = true;
  const maxX = S.breakShot ? HEAD_X : HL - R;
  if (c.x > maxX) ok = false;
  for (const b of world.balls) {
    if (b.id !== 0 && b.inPlay && Math.hypot(b.x - c.x, b.y - c.y) < 2 * R + 0.0005) ok = false;
  }
  S.placeValid = ok;
  updateControls();
}

function movePlacement(x, y) {
  const maxX = S.breakShot ? HEAD_X : HL - R;
  const c = world.cue;
  c.x = clamp(x, -HL + R, maxX);
  c.y = clamp(y, -HW + R, HW - R);
  validatePlacement();
}

function confirmPlacement() {
  if (S.phase !== 'placing' || !S.placeValid) return;
  sfx.tick();
  S.phase = 'aiming';
  autoAim();
  updateControls();
}

function fire(power) {
  if (S.phase !== 'aiming' || S.explore) return;
  S.lastPower = power;
  S.phase = 'striking';
  S.strike = { t: 0, power, pull: power };
  updateControls();
}

function launch() {
  const power = S.strike.power;
  const speed = powerToSpeed(power);
  S.shot = {
    first: null,
    pocketed: [],
    cuePocketed: false,
    rail: false,
    before: world.balls.filter((b) => b.id > 0 && b.inPlay).map((b) => b.id),
    isBreak: S.breakShot,
  };
  world.strike(S.aim, speed, S.spin.x, S.spin.y);
  sfx.cue(power);
  view.puff(world.cue.x + Math.cos(S.aim) * R, world.cue.y + Math.sin(S.aim) * R, R, 4, 0.8);
  S.phase = 'rolling';
  setPower(0);
  updateControls();
  if (navigator.vibrate && power > 0.5) navigator.vibrate(12);
}

world.onBallHit = (a, b, speed, x, y) => {
  sfx.clack(speed);
  if (speed > 1.2) view.puff(x, y, R, 2, Math.min(1.5, speed / 3));
  const s = S.shot;
  if (!s) return;
  if (s.first == null && (a.id === 0 || b.id === 0)) s.first = a.id === 0 ? b.id : a.id;
  if (s.first != null && !(a.id === 0 && b.id === s.first)) { /* contact continues */ }
};
world.onCushion = (b, speed, x, y) => {
  sfx.thud(speed);
  if (speed > 1.5) view.puff(x, y, R, 1, 0.6);
  if (S.shot && S.shot.first != null) S.shot.rail = true;
};
world.onPocket = (b) => {
  sfx.pocket();
  if (navigator.vibrate) navigator.vibrate(18);
  if (!S.shot) return;
  if (b.id === 0) S.shot.cuePocketed = true;
  else S.shot.pocketed.push(b.id);
  if (b.id !== 0) S.shot.rail = true; // a potted ball always counts as a legal outcome
};

function endShot() {
  const p = S.players[S.turn];
  const shot = S.shot;
  const res = resolveShot({ group: p.group, isBreak: shot.isBreak, shot, before: shot.before });
  S.breakShot = false;
  if (res.assign) {
    p.group = res.assign;
    S.players[1 - S.turn].group = res.assign === 'solid' ? 'stripe' : 'solid';
    toast(`${p.name}: ${res.assign === 'solid' ? 'Solids' : 'Stripes'}`);
  }
  if (res.respot8) {
    world.place(8, FOOT_X, 0);
    toast('8-ball re-spotted');
  }
  if (res.winner) {
    S.winner = res.winner === 'shooter' ? S.turn : 1 - S.turn;
    S.phase = 'over';
    renderHud();
    updateControls();
    const w = S.players[S.winner];
    const you = !w.isAI;
    celebrate();
    if (you) sfx.fanfare();
    else sfx.chime(false);
    toast(`${w.name} win${w.name === 'You' ? '' : 's'}! ${res.winner === 'opponent' && p.name ? (res.foul ? res.reason : 'Pocketed the 8-ball early') : ''}`, !you, 6000);
    setTimeout(() => openSheet(true, `${w.name} win${w.name === 'You' ? '' : 's'}!`), 1800);
    return;
  }
  let inHand = false;
  if (res.foul) {
    inHand = true;
    S.turn = 1 - S.turn;
    toast(`Foul: ${res.reason} · ball in hand`, true, 3200);
    sfx.chime(false);
  } else if (!res.keep) {
    S.turn = 1 - S.turn;
    toast(S.players[S.turn].isAI ? `${S.players[S.turn].name}'s turn` : S.players.length && !S.players[1].isAI ? `${S.players[S.turn].name}'s turn` : 'Your turn', false, 1400);
  } else {
    toast('Nice shot — shoot again', false, 1400);
  }
  if (!world.cue.inPlay) { world.place(0, HEAD_X, 0); }
  beginTurn(inHand);
}

// ---- AI ----------------------------------------------------------------
function updateAI(dt) {
  const a = S.ai;
  if (!a) return;
  a.t += dt;
  const p = S.players[S.turn];
  if (a.stage === 'place') {
    if (a.t > 0.6) {
      const pos = chooseCuePosition(world, p.group, S.breakShot);
      world.place(0, pos.x, pos.y);
      a.stage = 'think';
      a.t = 0;
    }
  } else if (a.stage === 'think') {
    if (a.t > 0.9) {
      a.plan = S.breakShot ? planBreak(world) : planShot(world, p.group, prefs.level);
      a.stage = 'turn';
      a.t = 0;
      a.from = S.aim;
      let d = a.plan.angle - S.aim;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      a.d = d;
    }
  } else if (a.stage === 'turn') {
    const u = clamp(a.t / 0.8, 0, 1);
    const e = u * u * (3 - 2 * u);
    S.aim = a.from + a.d * e;
    if (u >= 1) { a.stage = 'pull'; a.t = 0; }
  } else if (a.stage === 'pull') {
    const u = clamp(a.t / 0.6, 0, 1);
    setPower(a.plan.power * u);
    if (u >= 1) {
      S.spin.x = a.plan.offX; S.spin.y = a.plan.offY;
      S.phase = 'aiming';
      S.ai = null;
      S.strike = { t: 0, power: a.plan.power, pull: a.plan.power };
      S.phase = 'striking';
    }
  }
}

// ---- camera policy -------------------------------------------------------
function cameraGoal() {
  const c = world.cue;
  if (S.explore) return { tx: S.ex.tx, ty: 0, tz: S.ex.tz, yaw: S.ex.yaw, pitch: S.ex.pitch, dist: S.ex.dist, fov: view.fovFor3D() };
  if (S.view === '2d') return view.fitTable2D();
  const fov = view.fovFor3D();
  const portrait = view.aspect < 1;
  if (S.phase === 'aiming' || S.phase === 'striking' || (S.phase === 'ai' && S.ai && S.ai.stage !== 'place' && S.ai.stage !== 'think')) {
    const d = portrait ? S.dist * 0.8 : S.dist;
    return {
      tx: c.x + Math.cos(S.aim) * 0.35,
      ty: 0,
      tz: -(c.y + Math.sin(S.aim) * 0.35),
      yaw: S.aim + S.yawOff,
      pitch: S.pitch,
      dist: d,
      fov,
    };
  }
  if (S.phase === 'menu') {
    return { tx: 0, ty: 0, tz: 0, yaw: performance.now() / 14000, pitch: 0.62, dist: portrait ? 3.6 : 3.1, fov };
  }
  // rolling / placing / opponent thinking: watch the whole table
  return { tx: 0, ty: 0, tz: 0, yaw: S.aim + S.yawOff, pitch: clamp(S.pitch + 0.55, 0.5, 1.2), dist: portrait ? 3.3 : 2.9, fov };
}

// ---- input ---------------------------------------------------------------
const pointers = new Map();
let pinch = 0;
let dragMode = null;
let draggingBall = false;

const canvas = $('gl');
canvas.addEventListener('contextmenu', (e) => e.preventDefault());
canvas.addEventListener('pointerdown', (e) => {
  sfx.unlock();
  canvas.setPointerCapture(e.pointerId);
  pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
  if (pointers.size === 2) {
    const [a, b] = [...pointers.values()];
    pinch = Math.hypot(a.x - b.x, a.y - b.y);
  }
  dragMode = S.explore ? (e.button === 2 || e.shiftKey ? 'pan' : 'orbit') : e.button === 2 || e.shiftKey || S.look ? 'look' : 'aim';
  draggingBall = false;
  if (S.explore) return;
  if (S.phase === 'placing' && !S.players[S.turn].isAI) {
    const p = view.pick(e.clientX, e.clientY);
    if (p) {
      draggingBall = true;
      movePlacement(p.x, p.y);
    }
  } else if (S.phase === 'aiming' && S.view === '2d' && dragMode === 'aim') {
    aimAtPoint(e.clientX, e.clientY);
  }
});

function aimAtPoint(cx, cy) {
  const p = view.pick(cx, cy);
  if (!p) return;
  const c = world.cue;
  if (Math.hypot(p.x - c.x, p.y - c.y) > 0.05) S.aim = Math.atan2(p.y - c.y, p.x - c.x);
}

canvas.addEventListener('pointermove', (e) => {
  const prev = pointers.get(e.pointerId);
  if (!prev) return;
  const dx = e.clientX - prev.x;
  const dy = e.clientY - prev.y;
  prev.x = e.clientX;
  prev.y = e.clientY;
  if (pointers.size >= 2) {
    const [a, b] = [...pointers.values()];
    const d = Math.hypot(a.x - b.x, a.y - b.y);
    if (pinch > 0) zoom(pinch / d);
    pinch = d;
    if (S.explore) panBy(dx / 2, dy / 2); // two fingers also drag the view
    return;
  }
  if (S.explore) {
    if (dragMode === 'pan') panBy(dx, dy);
    else {
      S.ex.yaw -= dx * 0.006;
      S.ex.pitch = clamp(S.ex.pitch + dy * 0.005, 0.12, Math.PI / 2 - 0.0005);
    }
    return;
  }
  if (draggingBall) {
    const p = view.pick(e.clientX, e.clientY);
    if (p) movePlacement(p.x, p.y);
    return;
  }
  const canAim = S.phase === 'aiming' && !S.players[S.turn].isAI;
  if (dragMode === 'look' || !canAim) {
    S.yawOff -= dx * 0.006;
    S.pitch = clamp(S.pitch + dy * 0.004, 0.12, 1.2);
    return;
  }
  if (S.view === '2d') {
    aimAtPoint(e.clientX, e.clientY);
  } else {
    S.aim -= dx * 0.0035;
    S.pitch = clamp(S.pitch + dy * 0.003, 0.12, 1.2);
  }
});
const up = (e) => {
  pointers.delete(e.pointerId);
  pinch = 0;
  draggingBall = false;
};
canvas.addEventListener('pointerup', up);
canvas.addEventListener('pointercancel', up);
canvas.addEventListener('wheel', (e) => { e.preventDefault(); zoom(1 + e.deltaY * 0.001); }, { passive: false });

function zoom(f) {
  if (S.explore) S.ex.dist = clamp(S.ex.dist * f, 0.6, 6.5);
  else S.dist = clamp(S.dist * f, 0.55, 2.4);
}

// slide the survey camera across the table (drag the cloth under your finger)
function panBy(dx, dy) {
  const e = S.ex;
  const k = e.dist * 0.0014;
  const fx = Math.cos(e.yaw);
  const fz = -Math.sin(e.yaw);
  e.tx = clamp(e.tx - -fz * dx * k + fx * dy * k * 1.3, -HL - 0.6, HL + 0.6);
  e.tz = clamp(e.tz - fx * dx * k + fz * dy * k * 1.3, -HW - 0.6, HW + 0.6);
}

// power slider: pull down and release to shoot
const powerEl = $('power');
let powerDrag = false;
function powerFromEvent(e) {
  const r = powerEl.getBoundingClientRect();
  return clamp((e.clientY - r.top - 27) / (r.height - 54), 0, 1);
}
let lastTick = 0;
powerEl.addEventListener('pointerdown', (e) => {
  if (S.phase !== 'aiming') return;
  sfx.unlock();
  powerDrag = true;
  powerEl.classList.add('drag');
  powerEl.setPointerCapture(e.pointerId);
  setPower(powerFromEvent(e));
});
powerEl.addEventListener('pointermove', (e) => {
  if (!powerDrag) return;
  const p = powerFromEvent(e);
  setPower(p);
  const step = Math.round(p * 10);
  if (step !== lastTick) {
    lastTick = step;
    sfx.tick();
    if (navigator.vibrate) navigator.vibrate(4);
  }
});
const powerEnd = () => {
  if (!powerDrag) return;
  powerDrag = false;
  powerEl.classList.remove('drag');
  if (S.power > 0.04 && S.phase === 'aiming') fire(S.power);
  else setPower(0);
};
powerEl.addEventListener('pointerup', powerEnd);
powerEl.addEventListener('pointercancel', () => { powerDrag = false; powerEl.classList.remove('drag'); setPower(0); });
powerEl.addEventListener('keydown', (e) => {
  if (S.phase !== 'aiming') return;
  if (e.key === 'ArrowDown') { setPower(clamp(S.power + 0.05, 0, 1)); e.preventDefault(); }
  if (e.key === 'ArrowUp') { setPower(clamp(S.power - 0.05, 0, 1)); e.preventDefault(); }
  if (e.key === 'Enter') { if (S.power > 0.04) fire(S.power); }
});

// fine aim: drag the strip, or tap / hold the arrow buttons
const fineEl = $('fine');
const strip = $('fine-strip');
const FINE_PX = 0.001; // rad per dragged pixel (~0.06 deg)
const FINE_STEP = 0.0017; // ~0.1 deg per tap
let fineDrag = null;
const canFine = () => S.phase === 'aiming' && !S.explore && !S.players[S.turn].isAI;
function nudgeAim(rad) {
  S.aim += rad;
  strip.style.setProperty('--off', (parseFloat(strip.style.getPropertyValue('--off')) || 0) - rad / FINE_PX + 'px');
}
strip.addEventListener('pointerdown', (e) => {
  if (!canFine()) return;
  sfx.unlock();
  fineDrag = e.clientX;
  strip.setPointerCapture(e.pointerId);
});
strip.addEventListener('pointermove', (e) => {
  if (fineDrag == null || !canFine()) return;
  const dx = e.clientX - fineDrag;
  fineDrag = e.clientX;
  nudgeAim(-dx * FINE_PX);
});
strip.addEventListener('pointerup', () => (fineDrag = null));
strip.addEventListener('pointercancel', () => (fineDrag = null));
strip.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowLeft') { nudgeAim(FINE_STEP); e.preventDefault(); }
  if (e.key === 'ArrowRight') { nudgeAim(-FINE_STEP); e.preventDefault(); }
});
for (const [id, dir] of [['fine-l', 1], ['fine-r', -1]]) {
  const btn = $(id);
  let hold = 0;
  let rep = 0;
  const stop = () => { clearTimeout(hold); clearInterval(rep); };
  btn.addEventListener('pointerdown', (e) => {
    if (!canFine()) return;
    sfx.unlock();
    btn.setPointerCapture(e.pointerId);
    nudgeAim(dir * FINE_STEP);
    sfx.tick();
    stop();
    hold = setTimeout(() => { rep = setInterval(() => canFine() && nudgeAim(dir * FINE_STEP * 0.6), 40); }, 320);
  });
  for (const t of ['pointerup', 'pointercancel', 'lostpointercapture']) btn.addEventListener(t, stop);
}

$('btn-shoot').addEventListener('click', () => { sfx.unlock(); fire(S.power > 0.04 ? S.power : S.lastPower); });
$('btn-place').addEventListener('click', confirmPlacement);
$('btn-view').addEventListener('click', () => {
  if (S.explore) S.ex.pitch = S.ex.pitch > 1.4 ? 0.95 : Math.PI / 2 - 0.0005;
  else S.view = S.view === '3d' ? '2d' : '3d';
  updateControls();
  sfx.tick();
});
$('btn-recenter').addEventListener('click', () => {
  if (S.explore) exploreOverview();
  else { S.yawOff = 0; S.pitch = 0.42; S.dist = 1.05; }
  sfx.tick();
});
$('btn-explore').addEventListener('click', () => setExplore(!S.explore));
$('btn-back').addEventListener('click', () => setExplore(false));
// spin popover
const spinPop = $('spin-pop');
$('btn-spin').addEventListener('click', () => { sfx.unlock(); spinPop.hidden = !spinPop.hidden; });
document.addEventListener('pointerdown', (e) => {
  if (!spinPop.hidden && !spinPop.contains(e.target) && !$('btn-spin').contains(e.target)) spinPop.hidden = true;
});
const spinBall = $('spin-ball');
const spinFrom = (e) => {
  const r = spinBall.getBoundingClientRect();
  const x = ((e.clientX - r.left) / r.width - 0.5) * 2;
  const y = -((e.clientY - r.top) / r.height - 0.5) * 2;
  setSpin(x * 1.0, y * 1.0);
};
let spinDrag = false;
spinBall.addEventListener('pointerdown', (e) => { spinDrag = true; spinBall.setPointerCapture(e.pointerId); spinFrom(e); });
spinBall.addEventListener('pointermove', (e) => spinDrag && spinFrom(e));
spinBall.addEventListener('pointerup', () => (spinDrag = false));
$('spin-reset').addEventListener('click', () => setSpin(0, 0));

// keyboard
const keys = new Set();
addEventListener('keydown', (e) => {
  if (e.target.closest && e.target.closest('#sheet')) return;
  keys.add(e.key);
  if (e.key === 'v' || e.key === 'V') $('btn-view').click();
  if (e.key === 'e' || e.key === 'E') setExplore(!S.explore);
  if (e.key === 'Escape') openSheet(false);
  if (e.key === 'Enter' && S.phase === 'placing' && !S.explore) confirmPlacement();
  if (e.code === 'Space' && S.phase === 'aiming' && !S.explore && !e.repeat) { sfx.unlock(); S.charge = true; e.preventDefault(); }
});
addEventListener('keyup', (e) => {
  keys.delete(e.key);
  if (e.code === 'Space' && S.charge) {
    S.charge = false;
    if (S.phase === 'aiming' && S.power > 0.04) fire(S.power);
    else setPower(0);
  }
});

// ---- menu --------------------------------------------------------------
const sheet = $('sheet');
function openSheet(over = false, title = 'VeloPool') {
  sheet.classList.remove('off');
  $('sheet-title').textContent = title;
  $('sheet-sub').textContent = over ? 'Play another rack?' : '8-ball billiards';
  $('btn-start').textContent = S.inGame && !over ? 'Restart game' : 'New Game';
  $('btn-resume').classList.toggle('hidden', !(S.inGame && !over));
  S.prevPhase = S.phase;
}
function closeSheet() { sheet.classList.add('off'); }

function bindSeg(id, key, after) {
  const el = $(id);
  el.addEventListener('click', (e) => {
    const b = e.target.closest('button');
    if (!b) return;
    prefs[key] = b.dataset.v;
    el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
    savePrefs();
    sfx.tick();
    if (after) after();
  });
  el.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x.dataset.v === prefs[key]));
}
bindSeg('seg-mode', 'mode', () => $('row-level').classList.toggle('hidden', prefs.mode !== 'cpu'));
bindSeg('seg-level', 'level');
bindSeg('swatches', 'cloth', () => view.setCloth(prefs.cloth));
$('row-level').classList.toggle('hidden', prefs.mode !== 'cpu');
view.setCloth(CLOTHS[prefs.cloth] ? prefs.cloth : 'blue');
$('sw-sound').checked = prefs.sound;
sfx.setEnabled(prefs.sound);
$('sw-sound').addEventListener('change', (e) => {
  prefs.sound = e.target.checked;
  sfx.setEnabled(prefs.sound);
  savePrefs();
  sfx.unlock(); // a toggle is a user gesture: wake the audio engine and confirm with a click
  if (prefs.sound) sfx.clack(4);
});
$('sw-music').checked = prefs.music;
sfx.setMusic(prefs.music);
$('sw-music').addEventListener('change', (e) => {
  prefs.music = e.target.checked;
  savePrefs();
  sfx.unlock();
  sfx.setMusic(prefs.music);
});
$('btn-menu').addEventListener('click', () => openSheet(false));
$('btn-resume').addEventListener('click', closeSheet);
$('btn-start').addEventListener('click', () => { sfx.unlock(); closeSheet(); newGame(); });

// ---- main loop -------------------------------------------------------------
let last = performance.now();
let settleTimer = 0;
const spinDot = () => {};
void spinDot;

function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000);
  last = now;
  requestAnimationFrame(frame);
  const paused = !sheet.classList.contains('off');

  if (!paused) {
    // keyboard aiming
    if (S.explore) {
      if (keys.has('ArrowLeft')) S.ex.yaw += dt * 1.2;
      if (keys.has('ArrowRight')) S.ex.yaw -= dt * 1.2;
      if (keys.has('ArrowUp')) S.ex.pitch = clamp(S.ex.pitch + dt, 0.12, Math.PI / 2 - 0.0005);
      if (keys.has('ArrowDown')) S.ex.pitch = clamp(S.ex.pitch - dt, 0.12, Math.PI / 2 - 0.0005);
      if (keys.has('+') || keys.has('=')) zoom(1 - dt);
      if (keys.has('-')) zoom(1 + dt);
    } else if (S.phase === 'aiming' && !S.players[S.turn].isAI) {
      const fine = keys.has('Alt') ? 0.15 : 1;
      if (keys.has('ArrowLeft')) S.aim += dt * 1.1 * fine * (keys.has('Shift') ? 0.25 : 1);
      if (keys.has('ArrowRight')) S.aim -= dt * 1.1 * fine * (keys.has('Shift') ? 0.25 : 1);
      if (keys.has('+') || keys.has('=')) zoom(1 - dt);
      if (keys.has('-')) zoom(1 + dt);
      if (S.charge) setPower(clamp(S.power + dt * 0.7, 0, 1));
    }
    updateAI(dt);

    if (S.phase === 'striking') {
      const st = S.strike;
      st.t += dt;
      if (st.t < 0.12) st.pull = st.power * (1 - st.t / 0.12);
      else if (!st.hit) { st.hit = true; st.pull = 0; launch(); }
    }
    if (S.phase === 'rolling') {
      world.step(dt);
      if (!world.isMoving()) {
        settleTimer += dt;
        if (settleTimer > 0.5) { settleTimer = 0; endShot(); }
      } else {
        settleTimer = 0;
      }
    } else {
      view.syncBalls(world.balls, 0, now);
    }
  }
  if (S.phase === 'rolling' || S.phase === 'over') view.syncBalls(world.balls, dt, now);
  else view.syncBalls(world.balls, dt, now);

  // cue + guide
  const c = world.cue;
  const showCue = c.inPlay && (S.phase === 'aiming' || S.phase === 'striking' || (S.phase === 'ai' && S.ai && (S.ai.stage === 'turn' || S.ai.stage === 'pull')) || (S.phase === 'rolling' && S.strike && S.strike.t < 0.5));
  if (S.phase === 'striking' || S.phase === 'rolling') S.strike && (S.strike.t += S.phase === 'rolling' ? dt : 0);
  if (showCue && S.phase !== 'rolling') {
    const pull = S.phase === 'striking' ? S.strike.pull : S.power;
    view.poseCue(c.x, c.y, S.aim, 0.02 + pull * 0.24, S.spin.x, S.spin.y, true);
  } else if (S.phase === 'rolling' && S.strike && S.strike.t < 0.25) {
    view.poseCue(c.x, c.y, S.aim, 0.0, S.spin.x, S.spin.y, true);
  } else {
    view.cue.visible = false;
  }
  const guideOn = c.inPlay && (S.phase === 'aiming' || S.phase === 'striking' || (S.phase === 'ai' && S.ai && (S.ai.stage === 'turn' || S.ai.stage === 'pull')));
  if (guideOn) view.showGuide(predict(world, S.aim));
  else view.hideGuide();

  // ball-in-hand highlight
  if (S.phase === 'placing' && !S.players[S.turn].isAI) {
    view.ring.visible = true;
    view.ring.position.set(c.x, R * 0.5 + 0.003, -c.y);
    view.ring.material.color.set(S.placeValid ? '#30d158' : '#ff453a');
    view.ring.scale.setScalar(1.8 + Math.sin(now / 200) * 0.12);
  } else {
    view.ring.scale.setScalar(1);
  }

  view.setCamera(cameraGoal(), view.snapNext);
  view.snapNext = false;
  view.updateCamera(dt);
  view.updatePuffs(dt);
  view.render();
}

// first paint: show the menu over a racked table
S.players = [
  { name: 'You', avatar: '🙂', group: null, colors: ['#5ac8fa', '#0a84ff'] },
  { name: pick(BOT_NAMES), avatar: pick(BOT_FACES), group: null, colors: ['#ff9f0a', '#ff375f'] },
];
rack();
renderHud();
updateControls();
setPower(0);
setSpin(0, 0);
openSheet(false);
requestAnimationFrame(frame);

// debug / test hook
window.__pool = { S, world, view, fire, newGame, prefs, celebrate, sfx };
