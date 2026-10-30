// Full-screen confetti: cannons from the bottom corners plus a ribbon shower.
const COLORS = ['#ff453a', '#ff9f0a', '#ffd60a', '#30d158', '#0a84ff', '#bf5af2', '#ff375f', '#ffffff'];
const canvas = document.getElementById('confetti');
const g = canvas.getContext('2d');
let parts = [];
let raf = 0;
let w = 0;
let h = 0;
let dpr = 1;
let last = 0;
let spawnUntil = 0;
let nextRain = 0;

function size() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  w = window.innerWidth;
  h = window.innerHeight;
  canvas.width = w * dpr;
  canvas.height = h * dpr;
}
addEventListener('resize', size);

function make(x, y, vx, vy) {
  return {
    x, y, vx, vy,
    s: 6 + Math.random() * 7,
    r: Math.random() * 6.28,
    vr: (Math.random() - 0.5) * 14,
    c: COLORS[(Math.random() * COLORS.length) | 0],
    round: Math.random() < 0.25,
    flip: Math.random() * 6.28,
    life: 0,
  };
}

function cannon(fromLeft, n) {
  const x = fromLeft ? -10 : w + 10;
  for (let i = 0; i < n; i++) {
    const a = (fromLeft ? -1 : -1) * (Math.PI / 2 - (fromLeft ? 1 : -1) * (0.35 + Math.random() * 0.55));
    const sp = (0.9 + Math.random() * 0.8) * Math.min(h * 1.25, 1100);
    parts.push(make(x, h + 10, Math.cos(a) * sp, Math.sin(a) * sp));
  }
}

function frame(now) {
  const dt = Math.min(0.1, (now - last) / 1000 || 0.016);
  last = now;
  if (now < spawnUntil && now > nextRain) {
    nextRain = now + 45;
    for (let i = 0; i < 3; i++) parts.push(make(Math.random() * w, -12, (Math.random() - 0.5) * 120, 80 + Math.random() * 120));
  }
  g.setTransform(dpr, 0, 0, dpr, 0, 0);
  g.clearRect(0, 0, w, h);
  for (const p of parts) {
    p.life += dt;
    p.vy += 900 * dt;
    const drag = Math.exp(-1.6 * dt);
    p.vx *= drag;
    p.vy = Math.min(p.vy * drag, 520 + p.s * 10);
    p.x += p.vx * dt + Math.sin(p.life * 4 + p.flip) * 40 * dt;
    p.y += p.vy * dt;
    p.r += p.vr * dt;
    p.flip += 8 * dt;
    g.save();
    g.translate(p.x, p.y);
    g.rotate(p.r);
    g.fillStyle = p.c;
    g.globalAlpha = Math.min(1, (h + 40 - p.y) / 120);
    if (p.round) {
      g.beginPath();
      g.arc(0, 0, p.s / 2, 0, 6.28);
      g.fill();
    } else {
      g.scale(1, Math.cos(p.flip));
      g.fillRect(-p.s / 2, -p.s / 4, p.s, p.s / 2);
    }
    g.restore();
  }
  parts = parts.filter((p) => p.y < h + 40);
  if (parts.length || now < spawnUntil) raf = requestAnimationFrame(frame);
  else {
    raf = 0;
    g.clearRect(0, 0, w, h);
  }
}

export function celebrate() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  size();
  const k = reduced ? 0.25 : 1;
  cannon(true, Math.round(90 * k));
  cannon(false, Math.round(90 * k));
  setTimeout(() => { cannon(true, Math.round(60 * k)); cannon(false, Math.round(60 * k)); }, 450);
  spawnUntil = performance.now() + (reduced ? 0 : 3500);
  if (!raf) {
    last = performance.now();
    raf = requestAnimationFrame(frame);
  }
}
