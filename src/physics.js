// Top-down rigid-body pool physics with full 3-axis ball spin.
// Coordinates (metres): x along the table length, y across it, origin at table centre.
// Spin vector w = (wx, wy, wz), z up. A ball rolling towards +x has wy = +v / R.

export const L = 2.54; // playfield length (9 ft table)
export const W = 1.27;
export const R = 0.028575; // ball radius
export const HL = L / 2;
export const HW = W / 2;
export const HEAD_X = -L / 4;
export const FOOT_X = L / 4;

const G = 9.81;
const MU_SLIDE = 0.2;
const MU_ROLL = 0.011;
const SPIN_DECAY = 14; // rad/s^2 of english decay
const E_BALL = 0.95;
const E_CUSHION = 0.74;
const MU_CUSHION = 0.2;
const SUBSTEP = 1 / 480;

export const CORNER_GAP = 0.062;
export const SIDE_GAP = 0.066;

export const POCKETS = [
  { x: -HL - 0.025, y: -HW - 0.025, r: 0.08 },
  { x: 0, y: -HW - 0.035, r: 0.068 },
  { x: HL + 0.025, y: -HW - 0.025, r: 0.08 },
  { x: -HL - 0.025, y: HW + 0.025, r: 0.08 },
  { x: 0, y: HW + 0.035, r: 0.068 },
  { x: HL + 0.025, y: HW + 0.025, r: 0.08 },
];

// Cushion segments with inward-facing unit normals.
export const CUSHIONS = [
  { ax: SIDE_GAP, ay: HW, bx: HL - CORNER_GAP, by: HW, nx: 0, ny: -1 },
  { ax: -(HL - CORNER_GAP), ay: HW, bx: -SIDE_GAP, by: HW, nx: 0, ny: -1 },
  { ax: SIDE_GAP, ay: -HW, bx: HL - CORNER_GAP, by: -HW, nx: 0, ny: 1 },
  { ax: -(HL - CORNER_GAP), ay: -HW, bx: -SIDE_GAP, by: -HW, nx: 0, ny: 1 },
  { ax: HL, ay: -(HW - CORNER_GAP), bx: HL, by: HW - CORNER_GAP, nx: -1, ny: 0 },
  { ax: -HL, ay: -(HW - CORNER_GAP), bx: -HL, by: HW - CORNER_GAP, nx: 1, ny: 0 },
];

export function powerToSpeed(p) {
  return 0.25 + 8.25 * Math.pow(p, 1.7);
}

export function speedToPower(v) {
  return Math.pow(Math.max(0, v - 0.25) / 8.25, 1 / 1.7);
}

export function makeBall(id) {
  return {
    id,
    x: 0, y: 0, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0,
    inPlay: true,
    pocket: -1,
    // accumulated rotation (three.js axes) since last render, consumed by the view
    rx: 0, ry: 0, rz: 0,
  };
}

export class World {
  constructor() {
    this.balls = [];
    for (let i = 0; i < 16; i++) this.balls.push(makeBall(i));
    this.acc = 0;
    this.onBallHit = null; // (a, b, speed, x, y)
    this.onCushion = null; // (ball, speed, x, y)
    this.onPocket = null; // (ball, pocketIndex)
  }

  get cue() {
    return this.balls[0];
  }

  place(id, x, y) {
    const b = this.balls[id];
    Object.assign(b, { x, y, vx: 0, vy: 0, wx: 0, wy: 0, wz: 0, inPlay: true, pocket: -1 });
  }

  isMoving() {
    for (const b of this.balls) if (b.inPlay && (b.vx !== 0 || b.vy !== 0)) return true;
    return false;
  }

  strike(angle, speed, offX, offY) {
    const b = this.cue;
    const dx = Math.cos(angle);
    const dy = Math.sin(angle);
    b.vx = dx * speed;
    b.vy = dy * speed;
    const wf = (1.25 * offY * speed) / R; // follow (+) / draw (-)
    // spin axis n = (-dy, dx)
    b.wx = wf * -dy;
    b.wy = wf * dx;
    b.wz = -offX * speed / R;
  }

  step(dt) {
    this.acc += Math.min(dt, 0.05);
    while (this.acc >= SUBSTEP) {
      this.acc -= SUBSTEP;
      this.substep(SUBSTEP);
    }
  }

  substep(h) {
    const balls = this.balls;
    for (const b of balls) if (b.inPlay) this.integrate(b, h);
    for (let it = 0; it < 2; it++) {
      for (let i = 0; i < 16; i++) {
        const a = balls[i];
        if (!a.inPlay) continue;
        for (let j = i + 1; j < 16; j++) {
          const c = balls[j];
          if (c.inPlay) this.collide(a, c);
        }
      }
    }
    for (const b of balls) {
      if (!b.inPlay) continue;
      this.cushions(b);
      this.pockets(b);
    }
  }

  integrate(b, h) {
    const ux = b.vx - R * b.wy;
    const uy = b.vy + R * b.wx;
    const um = Math.hypot(ux, uy);
    if (um > 0.012) {
      // sliding: kinetic friction acts on the contact point
      const fx = ux / um;
      const fy = uy / um;
      const dv = MU_SLIDE * G * h;
      const dw = (5 * MU_SLIDE * G * h) / (2 * R);
      b.vx -= fx * dv;
      b.vy -= fy * dv;
      b.wx -= fy * dw;
      b.wy += fx * dw;
      const nux = b.vx - R * b.wy;
      const nuy = b.vy + R * b.wx;
      if (nux * ux + nuy * uy <= 0) this.lockRolling(b);
    } else {
      this.lockRolling(b);
      const sp = Math.hypot(b.vx, b.vy);
      if (sp > 0) {
        const dec = MU_ROLL * G * h;
        if (sp <= dec || sp < 0.004) {
          b.vx = b.vy = b.wx = b.wy = 0;
        } else {
          const k = (sp - dec) / sp;
          b.vx *= k;
          b.vy *= k;
          b.wy = b.vx / R;
          b.wx = -b.vy / R;
        }
      }
    }
    if (b.wz !== 0) {
      const d = SPIN_DECAY * h;
      b.wz = Math.abs(b.wz) <= d ? 0 : b.wz - Math.sign(b.wz) * d;
    }
    b.x += b.vx * h;
    b.y += b.vy * h;
    // three.js axes: (wx, wz, -wy)
    b.rx += b.wx * h;
    b.ry += b.wz * h;
    b.rz += -b.wy * h;
  }

  lockRolling(b) {
    const vx = (5 * b.vx + 2 * R * b.wy) / 7;
    const vy = (5 * b.vy - 2 * R * b.wx) / 7;
    b.vx = vx;
    b.vy = vy;
    b.wy = vx / R;
    b.wx = -vy / R;
  }

  collide(a, c) {
    const dx = c.x - a.x;
    const dy = c.y - a.y;
    const d2 = dx * dx + dy * dy;
    const min = 2 * R;
    if (d2 >= min * min || d2 === 0) return;
    const d = Math.sqrt(d2);
    const nx = dx / d;
    const ny = dy / d;
    const overlap = (min - d) / 2;
    a.x -= nx * overlap;
    a.y -= ny * overlap;
    c.x += nx * overlap;
    c.y += ny * overlap;
    const vrel = (c.vx - a.vx) * nx + (c.vy - a.vy) * ny;
    if (vrel >= 0) return;
    const j = (-(1 + E_BALL) * vrel) / 2;
    a.vx -= j * nx;
    a.vy -= j * ny;
    c.vx += j * nx;
    c.vy += j * ny;
    if (this.onBallHit) this.onBallHit(a, c, -vrel, a.x + nx * R, a.y + ny * R);
  }

  cushions(b) {
    for (const s of CUSHIONS) {
      const sx = s.bx - s.ax;
      const sy = s.by - s.ay;
      const len2 = sx * sx + sy * sy;
      let t = ((b.x - s.ax) * sx + (b.y - s.ay) * sy) / len2;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const px = s.ax + sx * t;
      const py = s.ay + sy * t;
      let dx = b.x - px;
      let dy = b.y - py;
      const d2 = dx * dx + dy * dy;
      if (d2 >= R * R) continue;
      let nx = s.nx;
      let ny = s.ny;
      if (d2 > 1e-10) {
        const d = Math.sqrt(d2);
        dx /= d;
        dy /= d;
        nx = dx;
        ny = dy;
        b.x = px + nx * R;
        b.y = py + ny * R;
      } else {
        b.x = px + nx * R;
        b.y = py + ny * R;
      }
      const vn = b.vx * nx + b.vy * ny;
      if (vn >= 0) continue;
      const tx = -ny;
      const ty = nx;
      const vt = b.vx * tx + b.vy * ty;
      const e = E_CUSHION - Math.min(0.2, -vn * 0.012);
      const slip = vt - b.wz * R;
      const maxJ = MU_CUSHION * (1 + e) * -vn;
      const jt = Math.max(-maxJ, Math.min(maxJ, -slip / 3.5));
      b.vx += (-(1 + e) * vn) * nx + jt * tx;
      b.vy += (-(1 + e) * vn) * ny + jt * ty;
      b.wz += (-2.5 * jt) / R;
      if (this.onCushion) this.onCushion(b, -vn, b.x - nx * R, b.y - ny * R);
    }
    // safety net: a ball that somehow escaped goes back on the cloth
    const lim = HL + 0.12;
    if (Math.abs(b.x) > lim || Math.abs(b.y) > HW + 0.12) {
      b.x = Math.max(-HL + R, Math.min(HL - R, b.x));
      b.y = Math.max(-HW + R, Math.min(HW - R, b.y));
      b.vx = b.vy = 0;
    }
  }

  pockets(b) {
    for (let i = 0; i < POCKETS.length; i++) {
      const p = POCKETS[i];
      const dx = b.x - p.x;
      const dy = b.y - p.y;
      if (dx * dx + dy * dy < p.r * p.r) {
        b.inPlay = false;
        b.pocket = i;
        b.vx = b.vy = b.wx = b.wy = b.wz = 0;
        if (this.onPocket) this.onPocket(b, i);
        return;
      }
    }
  }
}

// ---- aim prediction -------------------------------------------------------

function rayCircle(ox, oy, dx, dy, cx, cy, r) {
  const fx = ox - cx;
  const fy = oy - cy;
  const b = fx * dx + fy * dy;
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - c;
  if (disc < 0) return Infinity;
  const t = -b - Math.sqrt(disc);
  return t > 1e-6 ? t : Infinity;
}

// Returns the path of the cue ball for the given direction: first hit (ball or
// cushion) plus the follow-up lines used by the aim guide.
export function predict(world, angle) {
  const cue = world.cue;
  const dx = Math.cos(angle);
  const dy = Math.sin(angle);
  let best = Infinity;
  let hitBall = null;
  for (const b of world.balls) {
    if (b.id === 0 || !b.inPlay) continue;
    const t = rayCircle(cue.x, cue.y, dx, dy, b.x, b.y, 2 * R);
    if (t < best) {
      best = t;
      hitBall = b;
    }
  }
  // cushion: ray vs rectangle inset by R
  const hx = HL - R;
  const hy = HW - R;
  let tx = Infinity;
  let ty = Infinity;
  if (dx > 1e-9) tx = (hx - cue.x) / dx;
  else if (dx < -1e-9) tx = (-hx - cue.x) / dx;
  if (dy > 1e-9) ty = (hy - cue.y) / dy;
  else if (dy < -1e-9) ty = (-hy - cue.y) / dy;
  const tw = Math.min(tx, ty);
  const result = { cue: { x: cue.x, y: cue.y }, end: null, ball: null, objDir: null, cueDir: null, bounce: null };
  if (hitBall && best < tw) {
    const gx = cue.x + dx * best;
    const gy = cue.y + dy * best;
    result.end = { x: gx, y: gy };
    result.ball = hitBall;
    let nx = hitBall.x - gx;
    let ny = hitBall.y - gy;
    const nl = Math.hypot(nx, ny) || 1;
    nx /= nl;
    ny /= nl;
    result.objDir = { x: nx, y: ny };
    // equal masses: cue ball leaves along the tangent
    const dot = dx * nx + dy * ny;
    let cx = dx - dot * nx;
    let cy = dy - dot * ny;
    const cl = Math.hypot(cx, cy);
    result.cueDir = cl > 1e-3 ? { x: cx / cl, y: cy / cl, len: cl } : null;
    return result;
  }
  const ex = cue.x + dx * tw;
  const ey = cue.y + dy * tw;
  result.end = { x: ex, y: ey };
  // does the cushion hit land on a real cushion (not a pocket mouth)?
  const onLong = ty < tx;
  const along = onLong ? ex : ey;
  const lim = onLong ? HL - CORNER_GAP : HW - CORNER_GAP;
  const min = onLong ? SIDE_GAP : 0;
  if (Math.abs(along) <= lim && Math.abs(along) >= min) {
    const rdx = onLong ? dx : -dx;
    const rdy = onLong ? -dy : dy;
    result.bounce = { x: rdx, y: rdy };
  }
  return result;
}
