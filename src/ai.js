import { HL, HW, HEAD_X, R, POCKETS, L, speedToPower } from './physics.js';
import { groupOf } from './rules.js';

const LEVELS = {
  easy: { noise: 2.4, slop: 0.35 },
  medium: { noise: 1.0, slop: 0.12 },
  hard: { noise: 0.3, slop: 0 },
};

function segDist(px, py, ax, ay, bx, by) {
  const sx = bx - ax;
  const sy = by - ay;
  const l2 = sx * sx + sy * sy || 1;
  let t = ((px - ax) * sx + (py - ay) * sy) / l2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + sx * t), py - (ay + sy * t));
}

function clear(balls, ax, ay, bx, by, skip, clearance) {
  for (const b of balls) {
    if (!b.inPlay || skip.includes(b.id)) continue;
    if (segDist(b.x, b.y, ax, ay, bx, by) < clearance) return false;
  }
  return true;
}

const aimPoints = POCKETS.map((p) => {
  // pull the target slightly into the table so the ball drops cleanly
  const k = p.x === 0 ? 0.035 : 0.05;
  const mx = p.x === 0 ? 0 : -Math.sign(p.x) * k;
  const my = -Math.sign(p.y) * k;
  return { x: p.x + mx, y: p.y + my };
});

// Best direct pot from (cx, cy) at any of the target ball ids.
export function bestShot(world, cx, cy, targets) {
  const balls = world.balls;
  let best = null;
  for (const id of targets) {
    const t = balls[id];
    if (!t.inPlay) continue;
    for (const p of aimPoints) {
      let wx = p.x - t.x;
      let wy = p.y - t.y;
      const d2 = Math.hypot(wx, wy);
      wx /= d2;
      wy /= d2;
      const gx = t.x - wx * 2 * R;
      const gy = t.y - wy * 2 * R;
      let ux = gx - cx;
      let uy = gy - cy;
      const d1 = Math.hypot(ux, uy);
      if (d1 < 0.02) continue;
      ux /= d1;
      uy /= d1;
      const cos = ux * wx + uy * wy;
      if (cos < 0.3) continue;
      if (!clear(balls, cx, cy, gx, gy, [0, id], 2 * R * 0.97)) continue;
      if (!clear(balls, t.x, t.y, p.x, p.y, [0, id], 2 * R * 0.97)) continue;
      const score = cos * 1.2 - 0.32 * (d1 + d2) - (Math.abs(p.x) < 0.01 ? 0.12 : 0);
      if (!best || score > best.score) {
        best = { score, id, angle: Math.atan2(gy - cy, gx - cx), d1, d2, cos };
      }
    }
  }
  return best;
}

function speedFor(shot) {
  const vObj = Math.sqrt(2 * 0.1 * shot.d2) + 0.55;
  const v0 = Math.sqrt((vObj / Math.max(shot.cos, 0.35)) ** 2 + 2 * 0.12 * shot.d1) * 1.12 + 0.25;
  return Math.max(0.9, Math.min(6.2, v0));
}

export function targetsFor(world, group) {
  const inPlay = world.balls.filter((b) => b.id > 0 && b.inPlay).map((b) => b.id);
  if (!group) return inPlay.filter((id) => id !== 8);
  const mine = inPlay.filter((id) => groupOf(id) === group);
  return mine.length ? mine : [8];
}

export function planShot(world, group, level = 'medium') {
  const cfg = LEVELS[level] || LEVELS.medium;
  const cue = world.cue;
  const targets = targetsFor(world, group);
  let shot = bestShot(world, cue.x, cue.y, targets);
  let power;
  let angle;
  if (shot) {
    angle = shot.angle;
    power = speedToPower(speedFor(shot));
  } else {
    // no clean pot: tap the nearest legal ball
    let near = null;
    for (const id of targets) {
      const b = world.balls[id];
      const d = Math.hypot(b.x - cue.x, b.y - cue.y);
      if (!near || d < near.d) near = { d, b };
    }
    angle = Math.atan2(near.b.y - cue.y, near.b.x - cue.x);
    power = speedToPower(1.4 + near.d * 0.9);
  }
  const rnd = () => (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
  angle += ((rnd() * cfg.noise) * Math.PI) / 180;
  power = Math.max(0.12, Math.min(1, power * (1 + rnd() * 0.08 + (Math.random() < cfg.slop ? 0.2 * rnd() : 0))));
  return { angle, power, offX: 0, offY: 0 };
}

export function planBreak(world) {
  const rack = world.balls[1];
  const apex = world.balls.filter((b) => b.id > 0).reduce((m, b) => (b.x < m.x ? b : m));
  const cue = world.cue;
  return { angle: Math.atan2(apex.y - cue.y, apex.x - cue.x) + (Math.random() - 0.5) * 0.01, power: 0.95, offX: 0, offY: 0.1, rack };
}

// Ball in hand: evaluate a grid of spots and keep the one with the best pot.
export function chooseCuePosition(world, group, isBreak) {
  if (isBreak) return { x: HEAD_X, y: (Math.random() - 0.5) * 0.3 };
  const targets = targetsFor(world, group);
  const others = world.balls.filter((b) => b.id > 0 && b.inPlay);
  let best = { x: -L / 4, y: 0, score: -Infinity };
  for (let x = -HL + 0.15; x < HL - 0.1; x += 0.12) {
    for (let y = -HW + 0.1; y < HW - 0.05; y += 0.12) {
      if (others.some((b) => Math.hypot(b.x - x, b.y - y) < 2 * R + 0.02)) continue;
      const s = bestShot(world, x, y, targets);
      const score = s ? s.score : -5;
      if (score > best.score) best = { x, y, score };
    }
  }
  return best;
}
