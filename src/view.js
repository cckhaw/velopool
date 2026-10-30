import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { L, W, R, HL, HW, POCKETS, CUSHIONS, CORNER_GAP, SIDE_GAP } from './physics.js';

// physical (x, y) -> three.js world (x, h, -y)
export const w3 = (x, y, h = R) => new THREE.Vector3(x, h, -y);

export const CLOTHS = {
  blue: { felt: '#1b78bd', cushion: '#176aa8', name: 'Blue' },
  green: { felt: '#1f8a49', cushion: '#1a7640', name: 'Green' },
  red: { felt: '#b52d33', cushion: '#9c2429', name: 'Red' },
};

const BALL_COLORS = ['#f4f1ea', '#f5c518', '#1d4fd8', '#d7261e', '#5b2a9c', '#f2761a', '#13803b', '#8c1d22', '#111111'];
const CW = 0.05; // cushion width
const RAIL_H = 0.05;
const CUSHION_H = 0.034;

function canvas(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return c;
}

function feltTexture() {
  const c = canvas(256, 256);
  const g = c.getContext('2d');
  g.fillStyle = '#c8c8c8';
  g.fillRect(0, 0, 256, 256);
  const img = g.getImageData(0, 0, 256, 256);
  for (let i = 0; i < img.data.length; i += 4) {
    const n = 205 + Math.random() * 50;
    img.data[i] = img.data[i + 1] = img.data[i + 2] = n;
  }
  g.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(14, 14);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function woodTexture(base = '#5a3220') {
  const c = canvas(512, 512);
  const g = c.getContext('2d');
  g.fillStyle = base;
  g.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 260; i++) {
    const y = Math.random() * 512;
    g.strokeStyle = `rgba(${Math.random() < 0.5 ? '20,8,2' : '140,80,40'},${0.04 + Math.random() * 0.08})`;
    g.lineWidth = 1 + Math.random() * 3;
    g.beginPath();
    g.moveTo(0, y);
    g.bezierCurveTo(170, y + (Math.random() - 0.5) * 24, 340, y + (Math.random() - 0.5) * 24, 512, y + (Math.random() - 0.5) * 10);
    g.stroke();
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function ballTexture(id) {
  const c = canvas(1024, 512);
  const g = c.getContext('2d');
  const solid = id < 9;
  const color = BALL_COLORS[id <= 8 ? id : id - 8];
  g.fillStyle = id === 0 ? BALL_COLORS[0] : solid ? color : '#f4f1ea';
  g.fillRect(0, 0, 1024, 512);
  if (id > 8) {
    g.fillStyle = color;
    g.fillRect(0, 128, 1024, 256);
  }
  if (id === 0) {
    g.fillStyle = '#d7261e';
    for (const u of [256, 768]) {
      g.beginPath();
      g.arc(u, 256, 8, 0, Math.PI * 2);
      g.fill();
    }
  } else {
    for (const u of [256, 768]) {
      g.fillStyle = '#fbfaf6';
      g.beginPath();
      g.arc(u, 256, 62, 0, Math.PI * 2);
      g.fill();
      g.fillStyle = '#151515';
      g.font = '700 74px -apple-system, "SF Pro Rounded", Helvetica, Arial, sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.fillText(String(id), u, 262);
    }
  }
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

function puffTexture() {
  const c = canvas(64, 64);
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,0.9)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  return new THREE.CanvasTexture(c);
}

// Star-shaped outline from a radial distance function.
function radialShape(fn, n = 1440) {
  const pts = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const c = Math.cos(a);
    const s = Math.sin(a);
    const r = fn(c, s);
    pts.push(new THREE.Vector2(r * c, r * s));
  }
  return new THREE.Shape(pts);
}

function rectRadius(c, s, hx, hy) {
  return Math.min(Math.abs(c) > 1e-9 ? hx / Math.abs(c) : Infinity, Math.abs(s) > 1e-9 ? hy / Math.abs(s) : Infinity);
}

function circleHits(c, s, p) {
  const b = c * p.x + s * p.y;
  const disc = b * b - (p.x * p.x + p.y * p.y - p.r * p.r);
  if (disc < 0) return null;
  const q = Math.sqrt(disc);
  if (b + q <= 0) return null;
  return [b - q, b + q];
}

export class View {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    const renderer = new THREE.WebGLRenderer({ canvas: canvasEl, antialias: true, powerPreference: 'high-performance' });
    this.renderer = renderer;
    this.mobile = matchMedia('(pointer: coarse)').matches;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, this.mobile ? 2 : 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 0.9;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color('#0c0d12');
    this.scene.fog = new THREE.Fog('#0c0d12', 6, 16);
    const pm = new THREE.PMREMGenerator(renderer);
    this.scene.environment = pm.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.3;

    this.camera = new THREE.PerspectiveCamera(42, 1, 0.05, 40);
    this.rig = { tx: 0, ty: 0, tz: 0, yaw: Math.PI / 2, pitch: 0.7, dist: 3, fov: 42 };
    this.goal = { ...this.rig };
    this.snapNext = true;

    this.pocketAnim = new Map();
    this.puffs = [];
    this.ballMeshes = [];

    this.buildLights();
    this.buildRoom();
    this.buildTable();
    this.buildBalls();
    this.buildCue();
    this.buildGuide();
    this.buildPuffs();
    this.setCloth('blue');
    this.resize();
    addEventListener('resize', () => this.resize());
  }

  buildLights() {
    const s = this.scene;
    s.add(new THREE.HemisphereLight('#cfd8ff', '#201810', 0.3));
    const spot = new THREE.SpotLight('#fff4e0', 70, 0, 0.8, 0.6, 1.4);
    spot.position.set(0, 3.1, 0);
    spot.target.position.set(0, 0, 0);
    spot.castShadow = true;
    const sm = this.mobile ? 1024 : 2048;
    spot.shadow.mapSize.set(sm, sm);
    spot.shadow.bias = -0.0004;
    spot.shadow.normalBias = 0.01;
    spot.shadow.camera.near = 1;
    spot.shadow.camera.far = 6;
    s.add(spot, spot.target);
    const fill = new THREE.DirectionalLight('#9fb6ff', 0.35);
    fill.position.set(-3, 2, 3);
    s.add(fill);
  }

  buildRoom() {
    const floor = new THREE.Mesh(
      new THREE.PlaneGeometry(40, 40),
      new THREE.MeshStandardMaterial({ color: '#1a1511', roughness: 0.85, map: woodTexture('#3b281b') }),
    );
    floor.material.map.repeat.set(10, 10);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.85;
    floor.receiveShadow = true;
    this.scene.add(floor);
    // hanging lamp
    const lamp = new THREE.Mesh(
      new THREE.BoxGeometry(2.2, 0.06, 0.34),
      new THREE.MeshStandardMaterial({ color: '#fff7e6', emissive: '#fff1d0', emissiveIntensity: 3 }),
    );
    lamp.position.set(0, 3.1, 0);
    this.lamp = lamp;
    this.scene.add(lamp);
    const wall = new THREE.Mesh(
      new THREE.CylinderGeometry(9, 9, 6, 48, 1, true),
      new THREE.MeshStandardMaterial({ color: '#15171f', roughness: 1, side: THREE.BackSide }),
    );
    wall.position.y = 2;
    this.scene.add(wall);
  }

  buildTable() {
    const g = new THREE.Group();
    this.scene.add(g);
    this.tableGroup = g;
    const wood = woodTexture();
    wood.repeat.set(0.9, 0.9);
    this.woodMat = new THREE.MeshPhysicalMaterial({ map: wood, roughness: 0.4, clearcoat: 0.6, clearcoatRoughness: 0.25 });

    const feltMap = feltTexture();
    this.feltMat = new THREE.MeshStandardMaterial({ map: feltMap, roughness: 0.97, bumpMap: feltMap, bumpScale: 0.4 });
    this.cushionMat = new THREE.MeshStandardMaterial({ map: feltMap, roughness: 0.95 });

    // felt with pocket cut-outs
    const feltShape = radialShape((c, s) => {
      let r = rectRadius(c, s, HL + CW, HW + CW);
      for (const p of POCKETS) {
        const h = circleHits(c, s, p);
        if (h && h[0] > 0 && h[0] < r) r = h[0];
      }
      return r;
    });
    const felt = new THREE.Mesh(new THREE.ShapeGeometry(feltShape), this.feltMat);
    felt.rotation.x = -Math.PI / 2;
    felt.receiveShadow = true;
    g.add(felt);

    // wooden frame with pocket openings
    const hole = radialShape((c, s) => {
      let r = rectRadius(c, s, HL + CW, HW + CW);
      for (const p of POCKETS) {
        const h = circleHits(c, s, p);
        if (h && h[1] > r) r = h[1];
      }
      return r;
    });
    const ow = HL + CW + 0.17;
    const oh = HW + CW + 0.17;
    const outer = new THREE.Shape();
    const rr = 0.07;
    outer.moveTo(-ow + rr, -oh);
    outer.lineTo(ow - rr, -oh);
    outer.quadraticCurveTo(ow, -oh, ow, -oh + rr);
    outer.lineTo(ow, oh - rr);
    outer.quadraticCurveTo(ow, oh, ow - rr, oh);
    outer.lineTo(-ow + rr, oh);
    outer.quadraticCurveTo(-ow, oh, -ow, oh - rr);
    outer.lineTo(-ow, -oh + rr);
    outer.quadraticCurveTo(-ow, -oh, -ow + rr, -oh);
    outer.holes.push(new THREE.Path(hole.getPoints()));
    const frameGeo = new THREE.ExtrudeGeometry(outer, { depth: RAIL_H, bevelEnabled: true, bevelSize: 0.008, bevelThickness: 0.008, bevelSegments: 3, curveSegments: 12 });
    frameGeo.rotateX(-Math.PI / 2);
    const frame = new THREE.Mesh(frameGeo, this.woodMat);
    frame.castShadow = frame.receiveShadow = true;
    g.add(frame);

    // dark pocket floor and table body
    const pit = new THREE.Mesh(new THREE.PlaneGeometry(2 * ow, 2 * oh), new THREE.MeshBasicMaterial({ color: '#030304' }));
    pit.rotation.x = -Math.PI / 2;
    pit.position.y = -0.04;
    g.add(pit);
    const skirt = new THREE.Mesh(new THREE.BoxGeometry(2 * ow - 0.05, 0.3, 2 * oh - 0.05), this.woodMat);
    skirt.position.y = -0.21;
    skirt.castShadow = true;
    g.add(skirt);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.7, 0.22), this.woodMat);
        leg.position.set(sx * (ow - 0.25), -0.5, sz * (oh - 0.25));
        leg.castShadow = true;
        g.add(leg);
      }
    }

    // cushions
    const cushionShape = (c) => {
      const horizontal = c.ay === c.by;
      const nx = -c.nx;
      const ny = -c.ny; // outward
      const ins = 0.045;
      let pts;
      if (horizontal) {
        const x1 = c.ax;
        const x2 = c.bx;
        const y0 = c.ay;
        const y1 = c.ay + ny * CW;
        pts = [[x1, y0], [x2, y0], [x2 - ins * Math.sign(x2 - x1), y1], [x1 + ins * Math.sign(x2 - x1), y1]];
      } else {
        const y1 = c.ay;
        const y2 = c.by;
        const x0 = c.ax;
        const x1 = c.ax + nx * CW;
        pts = [[x0, y1], [x0, y2], [x1, y2 - ins * Math.sign(y2 - y1)], [x1, y1 + ins * Math.sign(y2 - y1)]];
      }
      const sh = new THREE.Shape();
      pts.forEach((p, i) => (i ? sh.lineTo(p[0], p[1]) : sh.moveTo(p[0], p[1])));
      sh.closePath();
      return sh;
    };
    for (const c of CUSHIONS) {
      const geo = new THREE.ExtrudeGeometry(cushionShape(c), { depth: CUSHION_H - 0.006, bevelEnabled: true, bevelSize: 0.004, bevelThickness: 0.006, bevelSegments: 2 });
      geo.rotateX(-Math.PI / 2);
      const m = new THREE.Mesh(geo, this.cushionMat);
      m.castShadow = m.receiveShadow = true;
      g.add(m);
    }

    // diamonds
    const dia = new THREE.MeshPhysicalMaterial({ color: '#f1ead8', roughness: 0.25, metalness: 0.2 });
    const dgeo = new THREE.CylinderGeometry(0.0085, 0.0085, 0.004, 14);
    const addDia = (x, y) => {
      const d = new THREE.Mesh(dgeo, dia);
      d.position.set(x, RAIL_H + 0.011, -y);
      g.add(d);
    };
    const railY = HW + CW + 0.085;
    const railX = HL + CW + 0.085;
    for (const sy of [-1, 1]) {
      for (const x of [-HL * 0.75, -HL * 0.5, -HL * 0.25, HL * 0.25, HL * 0.5, HL * 0.75]) addDia(x, sy * railY);
      for (const y of [-HW * 0.5, 0, HW * 0.5]) addDia(sy * railX, y);
    }
  }

  buildBalls() {
    const geo = new THREE.SphereGeometry(R, 48, 32);
    for (let i = 0; i < 16; i++) {
      const mat = new THREE.MeshPhysicalMaterial({ map: ballTexture(i), roughness: 0.16, clearcoat: 1, clearcoatRoughness: 0.04, envMapIntensity: 1.1 });
      const m = new THREE.Mesh(geo, mat);
      m.castShadow = true;
      m.receiveShadow = false;
      m.rotation.set(Math.random() * 6, Math.random() * 6, Math.random() * 6);
      this.scene.add(m);
      this.ballMeshes.push(m);
    }
    this.ghost = new THREE.Mesh(
      new THREE.SphereGeometry(R, 32, 16),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.0, depthWrite: false }),
    );
    this.scene.add(this.ghost);
  }

  buildCue() {
    const g = new THREE.Group();
    const seg = (r0, r1, len, x0, mat) => {
      const m = new THREE.Mesh(new THREE.CylinderGeometry(r1, r0, len, 20), mat);
      m.rotation.z = Math.PI / 2;
      m.position.x = x0 - len / 2;
      m.castShadow = true;
      g.add(m);
    };
    const mk = (c, r = 0.35, m = 0) => new THREE.MeshPhysicalMaterial({ color: c, roughness: r, metalness: m, clearcoat: 0.5 });
    seg(0.0052, 0.0054, 0.008, 0, mk('#3a6ea8', 0.9));
    seg(0.0054, 0.0058, 0.025, -0.008, mk('#f4f1ea'));
    seg(0.0058, 0.0105, 0.75, -0.033, mk('#d9b77f'));
    seg(0.0105, 0.0118, 0.012, -0.783, mk('#c9a14a', 0.25, 0.8));
    seg(0.0118, 0.0155, 0.62, -0.795, mk('#2b1a12'));
    seg(0.0155, 0.0156, 0.02, -1.0, mk('#c9a14a', 0.25, 0.8));
    seg(0.0155, 0.0155, 0.01, -1.415, mk('#111111'));
    this.cue = g;
    this.cueLen = 1.42;
    g.visible = false;
    this.scene.add(g);
  }

  buildGuide() {
    const mk = (opacity, color = '#ffffff') =>
      new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }));
    this.guide = { main: mk(0.85), obj: mk(0.9, '#ffe27a'), cue: mk(0.55), bounce: mk(0.4) };
    for (const k in this.guide) {
      this.guide[k].rotation.x = -Math.PI / 2;
      this.guide[k].visible = false;
      this.guide[k].renderOrder = 5;
      this.scene.add(this.guide[k]);
    }
    this.ring = new THREE.Mesh(
      new THREE.RingGeometry(R * 0.92, R * 1.08, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, depthWrite: false, side: THREE.DoubleSide }),
    );
    this.ring.rotation.x = -Math.PI / 2;
    this.ring.visible = false;
    this.ring.renderOrder = 6;
    this.scene.add(this.ring);
  }

  buildPuffs() {
    const tex = puffTexture();
    for (let i = 0; i < 40; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthWrite: false, opacity: 0, color: '#f2f6ff' }));
      s.visible = false;
      this.scene.add(s);
      this.puffs.push({ s, life: 0, max: 1, vx: 0, vy: 0, vz: 0, size: 0.05 });
    }
    this.puffIdx = 0;
  }

  puff(x, y, h, n = 3, strength = 1) {
    for (let i = 0; i < n; i++) {
      const p = this.puffs[this.puffIdx++ % this.puffs.length];
      p.life = p.max = 0.5 + Math.random() * 0.4;
      p.s.position.set(x, h, -y);
      p.vx = (Math.random() - 0.5) * 0.12 * strength;
      p.vz = (Math.random() - 0.5) * 0.12 * strength;
      p.vy = 0.05 + Math.random() * 0.09;
      p.size = 0.035 + Math.random() * 0.03 * strength;
      p.s.visible = true;
    }
  }

  setCloth(name) {
    const c = CLOTHS[name] || CLOTHS.blue;
    this.feltMat.color.set(c.felt);
    this.cushionMat.color.set(c.cushion);
    this.cloth = name;
  }

  resize() {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.aspect = w / h;
    this.camera.aspect = this.aspect;
    this.camera.updateProjectionMatrix();
  }

  // ---- camera ----------------------------------------------------------

  // Goal describes the camera as an orbit around a target.
  setCamera(goal, snap = false) {
    Object.assign(this.goal, goal);
    if (snap) Object.assign(this.rig, this.goal);
  }

  fitTable2D() {
    const portrait = this.aspect < 1;
    const fov = 36;
    const t = Math.tan((fov * Math.PI) / 360);
    const long = L + 0.5;
    const short = W + 0.5;
    // leave room for the HUD (top) and controls (bottom/right)
    const needV = portrait ? long * 1.28 : short * 1.55;
    const needH = portrait ? short * 1.25 : long * 1.22;
    const dist = Math.max(needV / 2 / t, needH / 2 / (t * this.aspect));
    return { tx: 0, ty: 0, tz: 0, yaw: portrait ? 0 : Math.PI / 2, pitch: Math.PI / 2 - 0.0005, dist, fov };
  }

  fovFor3D() {
    if (this.aspect >= 1.2) return 42;
    const half = Math.tan((26 * Math.PI) / 180);
    return Math.min(78, (2 * Math.atan(half / this.aspect) * 180) / Math.PI);
  }

  updateCamera(dt) {
    const k = 1 - Math.exp(-dt * 5.5);
    const r = this.rig;
    const g = this.goal;
    r.tx += (g.tx - r.tx) * k;
    r.ty += (g.ty - r.ty) * k;
    r.tz += (g.tz - r.tz) * k;
    let dy = g.yaw - r.yaw;
    dy = Math.atan2(Math.sin(dy), Math.cos(dy));
    r.yaw += dy * k;
    r.pitch += (g.pitch - r.pitch) * k;
    r.dist += (g.dist - r.dist) * k;
    r.fov += (g.fov - r.fov) * k;
    const cp = Math.cos(r.pitch);
    const fx = Math.cos(r.yaw);
    const fz = -Math.sin(r.yaw);
    this.camera.position.set(r.tx - fx * r.dist * cp, r.ty + Math.sin(r.pitch) * r.dist, r.tz - fz * r.dist * cp);
    this.camera.lookAt(r.tx, r.ty, r.tz);
    this.lamp.visible = this.camera.position.y < 2.9;
    if (Math.abs(this.camera.fov - r.fov) > 0.01) {
      this.camera.fov = r.fov;
      this.camera.updateProjectionMatrix();
    }
  }

  // Intersect a screen point with the table plane (physical coordinates).
  pick(clientX, clientY) {
    const v = new THREE.Vector2((clientX / window.innerWidth) * 2 - 1, -(clientY / window.innerHeight) * 2 + 1);
    const ray = new THREE.Raycaster();
    ray.setFromCamera(v, this.camera);
    const t = -(ray.ray.origin.y - R) / ray.ray.direction.y;
    if (!(t > 0)) return null;
    const p = ray.ray.origin.clone().addScaledVector(ray.ray.direction, t);
    return { x: p.x, y: -p.z };
  }

  // ---- per-frame sync --------------------------------------------------

  syncBalls(balls, dt, now) {
    const q = new THREE.Quaternion();
    const axis = new THREE.Vector3();
    for (const b of balls) {
      const m = this.ballMeshes[b.id];
      if (b.inPlay) {
        this.pocketAnim.delete(b.id);
        m.visible = true;
        m.scale.setScalar(1);
        m.position.set(b.x, R, -b.y);
        axis.set(b.rx, b.ry, b.rz);
        const ang = axis.length();
        if (ang > 1e-6) {
          m.quaternion.premultiply(q.setFromAxisAngle(axis.divideScalar(ang), ang));
        }
        b.rx = b.ry = b.rz = 0;
      } else {
        let a = this.pocketAnim.get(b.id);
        if (!a) {
          const p = POCKETS[b.pocket];
          a = { t: 0, x0: m.position.x, z0: m.position.z, px: p.x, pz: -p.y };
          this.pocketAnim.set(b.id, a);
        }
        a.t += dt;
        const u = Math.min(1, a.t / 0.35);
        const e = u * u;
        m.position.set(a.x0 + (a.px - a.x0) * Math.min(1, u * 1.4), R - e * 0.12, a.z0 + (a.pz - a.z0) * Math.min(1, u * 1.4));
        m.scale.setScalar(1 - e * 0.15);
        m.visible = a.t < 0.5;
      }
    }
  }

  updatePuffs(dt) {
    for (const p of this.puffs) {
      if (p.life <= 0) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.s.visible = false;
        continue;
      }
      const u = 1 - p.life / p.max;
      p.s.position.x += p.vx * dt;
      p.s.position.y += p.vy * dt;
      p.s.position.z += p.vz * dt;
      p.s.scale.setScalar(p.size * (1 + u * 2.5));
      p.s.material.opacity = 0.4 * (1 - u) * (1 - u);
    }
  }

  setGhostCue(x, y, valid) {
    this.ghost.position.set(x, R, -y);
    this.ghost.material.opacity = 0.0;
    this.ghostValid = valid;
  }

  // Place a flat ribbon on the cloth between two physical points.
  ribbon(mesh, ax, ay, bx, by, width) {
    const len = Math.hypot(bx - ax, by - ay);
    if (len < 1e-4) {
      mesh.visible = false;
      return;
    }
    mesh.visible = true;
    mesh.position.set((ax + bx) / 2, R * 0.5 + 0.002, -(ay + by) / 2);
    mesh.scale.set(len, width, 1);
    mesh.quaternion.setFromEuler(new THREE.Euler(-Math.PI / 2, Math.atan2(by - ay, bx - ax), 0, 'YXZ'));
  }

  hideGuide() {
    for (const k in this.guide) this.guide[k].visible = false;
    this.ring.visible = false;
  }

  showGuide(pred, w = 0.0035) {
    const g = this.guide;
    this.ribbon(g.main, pred.cue.x, pred.cue.y, pred.end.x, pred.end.y, w);
    this.ring.visible = true;
    this.ring.position.set(pred.end.x, R * 0.5 + 0.003, -pred.end.y);
    this.ring.material.color.set(pred.ball ? '#ffe27a' : '#ffffff');
    g.obj.visible = g.cue.visible = g.bounce.visible = false;
    if (pred.ball) {
      const o = pred.objDir;
      this.ribbon(g.obj, pred.ball.x, pred.ball.y, pred.ball.x + o.x * 0.32, pred.ball.y + o.y * 0.32, w * 1.2);
      if (pred.cueDir) {
        const len = 0.1 + 0.2 * pred.cueDir.len;
        this.ribbon(g.cue, pred.end.x, pred.end.y, pred.end.x + pred.cueDir.x * len, pred.end.y + pred.cueDir.y * len, w * 0.8);
      }
    } else if (pred.bounce) {
      this.ribbon(g.bounce, pred.end.x, pred.end.y, pred.end.x + pred.bounce.x * 0.45, pred.end.y + pred.bounce.y * 0.45, w * 0.8);
    }
  }

  // Cue stick: tip sits `gap` behind the cue ball's surface, shifted by the english offset.
  poseCue(cx, cy, angle, gap, offX, offY, visible = true) {
    this.cue.visible = visible;
    if (!visible) return;
    const dx = Math.cos(angle);
    const dz = -Math.sin(angle);
    const tilt = 0.07;
    const side = offX * R * 0.6;
    const up = offY * R * 0.6;
    const back = R + 0.003 + gap;
    // right-hand perpendicular of the aim direction on the table
    this.cue.position.set(cx - dx * back - dz * side, R + up, -cy - dz * back + dx * side);
    this.cue.quaternion.setFromEuler(new THREE.Euler(0, angle, -tilt, 'YXZ'));
  }

  render() {
    this.renderer.render(this.scene, this.camera);
  }
}
