// Aevum - particle effects (pooled THREE.Points, soft round sprite)
import * as THREE from 'three';

function makeSprite() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)');
  gr.addColorStop(0.35, 'rgba(255,255,255,0.85)');
  gr.addColorStop(0.7, 'rgba(255,255,255,0.3)');
  gr.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = gr;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.needsUpdate = true;
  return t;
}

const VERT = `
attribute vec4 aColor;
attribute float aSize;
uniform float uScale;
varying vec4 vColor;
void main(){
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * uScale / max(-mv.z, 0.1);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = `
uniform sampler2D uMap;
varying vec4 vColor;
void main(){
  vec4 t = texture2D(uMap, gl_PointCoord);
  if (t.a * vColor.a < 0.01) discard;
  gl_FragColor = vec4(vColor.rgb, vColor.a * t.a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

class Pool {
  constructor(scene, tex, max, additive) {
    this.max = max;
    this.next = 0;
    this.hi = 0;
    this.alive = 0;
    this.pos = new Float32Array(max * 3);
    this.col = new Float32Array(max * 4);
    this.size = new Float32Array(max);
    this.vel = new Float32Array(max * 3);
    this.life = new Float32Array(max);
    this.maxLife = new Float32Array(max);
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max);
    this.alpha0 = new Float32Array(max);
    const geo = new THREE.BufferGeometry();
    this.aPos = new THREE.BufferAttribute(this.pos, 3);
    this.aCol = new THREE.BufferAttribute(this.col, 4);
    this.aSize = new THREE.BufferAttribute(this.size, 1);
    this.aPos.setUsage(THREE.DynamicDrawUsage);
    this.aCol.setUsage(THREE.DynamicDrawUsage);
    this.aSize.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute('position', this.aPos);
    geo.setAttribute('aColor', this.aCol);
    geo.setAttribute('aSize', this.aSize);
    geo.setDrawRange(0, 0);
    this.uScale = { value: 900 };
    const mat = new THREE.ShaderMaterial({
      uniforms: { uMap: { value: tex }, uScale: this.uScale },
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.geo = geo;
    this.mat = mat;
    this.points = new THREE.Points(geo, mat);
    this.points.frustumCulled = false;
    this.points.renderOrder = 20;
    scene.add(this.points);
  }

  spawn(x, y, z, vx, vy, vz, r, g, b, a, size, life, grav, drag, grow) {
    const i = this.next;
    this.next = (this.next + 1) % this.max;
    if (i + 1 > this.hi) this.hi = i + 1;
    if (this.life[i] <= 0) this.alive++;
    const i3 = i * 3, i4 = i * 4;
    this.pos[i3] = x; this.pos[i3 + 1] = y; this.pos[i3 + 2] = z;
    this.vel[i3] = vx; this.vel[i3 + 1] = vy; this.vel[i3 + 2] = vz;
    this.col[i4] = r; this.col[i4 + 1] = g; this.col[i4 + 2] = b; this.col[i4 + 3] = a;
    this.alpha0[i] = a;
    this.size[i] = size; this.size0[i] = size;
    this.life[i] = life; this.maxLife[i] = life;
    this.grav[i] = grav; this.drag[i] = drag; this.grow[i] = grow;
  }

  update(dt) {
    if (this.alive <= 0) {
      if (this.hi > 0) { this.hi = 0; this.next = 0; this.geo.setDrawRange(0, 0); }
      return;
    }
    const { pos, vel, life, maxLife, grav, drag, size, size0, grow, col, alpha0 } = this;
    for (let i = 0; i < this.hi; i++) {
      if (life[i] <= 0) continue;
      life[i] -= dt;
      const i3 = i * 3;
      if (life[i] <= 0) {
        size[i] = 0; col[i * 4 + 3] = 0; this.alive--;
        continue;
      }
      const d = Math.max(0, 1 - drag[i] * dt);
      vel[i3] *= d; vel[i3 + 2] *= d;
      vel[i3 + 1] = vel[i3 + 1] * d - grav[i] * dt;
      pos[i3] += vel[i3] * dt;
      pos[i3 + 1] += vel[i3 + 1] * dt;
      pos[i3 + 2] += vel[i3 + 2] * dt;
      const k = life[i] / maxLife[i];
      col[i * 4 + 3] = alpha0[i] * Math.min(1, k * 2.2);
      size[i] = size0[i] * (1 + grow[i] * (1 - k));
    }
    this.aPos.needsUpdate = true;
    this.aCol.needsUpdate = true;
    this.aSize.needsUpdate = true;
    this.geo.setDrawRange(0, this.hi);
  }

  dispose() {
    this.points.parent && this.points.parent.remove(this.points);
    this.geo.dispose();
    this.mat.dispose();
  }
}

// n: count, c: colors, sp: speed, up: upward bias, g: gravity, life:[min,max], size:[min,max],
// drag, grow, add: additive, a: alpha, spread: spawn radius
const KINDS = {
  hit:       { n: 8,  c: [0xfff1c0, 0xffffff, 0xffc060], sp: 2.6, up: 1.6, g: 8,   life: [0.2, 0.45], size: [0.10, 0.2],  drag: 1.5, grow: 0,   add: true,  a: 1,    spread: 0.05 },
  blood:     { n: 10, c: [0xb01515, 0x8a0c0c, 0xd42a2a], sp: 2.0, up: 2.2, g: 10,  life: [0.35, 0.7], size: [0.08, 0.16], drag: 1,   grow: 0,   add: false, a: 0.95, spread: 0.08 },
  dust:      { n: 12, c: [0xc9b48a, 0xb09a72, 0xddd0b0], sp: 1.4, up: 0.8, g: -0.3, life: [0.6, 1.3], size: [0.3, 0.6],   drag: 2,   grow: 1.6, add: false, a: 0.45, spread: 0.3 },
  wood:      { n: 6,  c: [0xc89858, 0x9a6a36, 0xe2bd80], sp: 2.2, up: 2.4, g: 10,  life: [0.4, 0.8],  size: [0.07, 0.13], drag: 0.8, grow: 0,   add: false, a: 1,    spread: 0.1 },
  stone:     { n: 6,  c: [0xa8a8a8, 0x7f7f86, 0xd0d0d0], sp: 2.4, up: 2.4, g: 11,  life: [0.4, 0.8],  size: [0.07, 0.14], drag: 0.8, grow: 0,   add: false, a: 1,    spread: 0.1 },
  gold:      { n: 7,  c: [0xffd84a, 0xffb820, 0xfff2a0], sp: 2.3, up: 2.6, g: 10,  life: [0.4, 0.85], size: [0.07, 0.13], drag: 0.8, grow: 0,   add: true,  a: 1,    spread: 0.1 },
  spark:     { n: 12, c: [0xffe070, 0xff9a30, 0xffffff], sp: 4.0, up: 2.5, g: 9,   life: [0.2, 0.5],  size: [0.06, 0.12], drag: 1,   grow: 0,   add: true,  a: 1,    spread: 0.05 },
  explosion: { n: 26, c: [0xffb040, 0xff6a20, 0xfff0a0, 0xff3a10], sp: 4.5, up: 2.5, g: 2, life: [0.35, 0.9], size: [0.4, 0.9], drag: 3, grow: 1.4, add: true, a: 0.9, spread: 0.3 },
  smoke:     { n: 10, c: [0x55524e, 0x777370, 0x3c3a38], sp: 0.8, up: 1.6, g: -0.6, life: [1.2, 2.6], size: [0.5, 0.9],   drag: 1.2, grow: 2.2, add: false, a: 0.5,  spread: 0.4 },
  build:     { n: 26, c: [0xe6d6b0, 0xc9b48a, 0xffffff], sp: 2.6, up: 1.2, g: -0.2, life: [0.7, 1.5], size: [0.35, 0.7],  drag: 2.2, grow: 1.5, add: false, a: 0.5,  spread: 1.2 },
  ageup:     { n: 110, c: [0xffd84a, 0xfff2a0, 0xffb820, 0xffffff], sp: 5.5, up: 5.0, g: 3.5, life: [1.0, 2.4], size: [0.18, 0.45], drag: 1.2, grow: 0.3, add: true, a: 1, spread: 1.5 },
  debris:    { n: 14, c: [0x8a6238, 0x9a968c, 0x6e6b66, 0x4f3620], sp: 3.4, up: 4.2, g: 12, life: [0.6, 1.2], size: [0.10, 0.22], drag: 0.6, grow: 0, add: false, a: 1, spread: 0.5 },
  flash:     { n: 5,  c: [0xfff4c0, 0xffd070, 0xffffff], sp: 0.6, up: 0.3, g: 0, life: [0.06, 0.14], size: [0.35, 0.6], drag: 4, grow: 2, add: true, a: 1, spread: 0.05 },
  leaf:      { n: 16, c: [0x5fa038, 0x7cc04a, 0x3f7a2a, 0xa6c84a], sp: 1.8, up: 1.8, g: 2.2, life: [0.9, 1.8], size: [0.10, 0.2], drag: 1.6, grow: 0, add: false, a: 1, spread: 0.6 },
  // construction site: small hammering bursts + finish sparkle
  chips:     { n: 4,  c: [0xd8a868, 0xa8783e, 0xf0d098], sp: 1.6, up: 2.2, g: 10,  life: [0.3, 0.6],  size: [0.05, 0.09], drag: 0.8, grow: 0,   add: false, a: 1,    spread: 0.05 },
  sdust:     { n: 4,  c: [0xc8c0b0, 0xa8a094, 0xe0d8c8], sp: 0.9, up: 0.9, g: -0.2, life: [0.4, 0.8],  size: [0.12, 0.24], drag: 2,   grow: 1.4, add: false, a: 0.45, spread: 0.08 },
  bspark:    { n: 4,  c: [0xffe070, 0xffb040, 0xffffff], sp: 2.4, up: 2.0, g: 9,   life: [0.15, 0.35], size: [0.04, 0.08], drag: 1,  grow: 0,   add: true,  a: 1,    spread: 0.03 },
  // fishing boat: small water splashes where the net dips
  splash:    { n: 7,  c: [0xdcf4ff, 0x9ed8f2, 0xffffff], sp: 1.4, up: 2.2, g: 9,   life: [0.25, 0.55], size: [0.09, 0.18], drag: 1.4, grow: 0.4, add: false, a: 0.85, spread: 0.18 },
  // healer: a few soft green motes rising off a healed unit
  heal:      { n: 5,  c: [0x7dffb0, 0xb8ffd8, 0x4fe39a], sp: 0.5, up: 1.3, g: -0.4, life: [0.6, 1.1], size: [0.07, 0.14], drag: 1.6, grow: 0.3, add: true, a: 0.9, spread: 0.25 },
  sparkle:   { n: 40, c: [0xffd84a, 0xfff2a0, 0xffe680, 0xffffff], sp: 2.8, up: 3.2, g: 1.2, life: [0.6, 1.4], size: [0.08, 0.2], drag: 1.4, grow: 0.2, add: true, a: 1, spread: 0.9 },
};

const _c = new THREE.Color();

export class Fx {
  constructor(scene) {
    this.scene = scene;
    this.tex = makeSprite();
    this.normal = new Pool(scene, this.tex, 3000, false);
    this.additive = new Pool(scene, this.tex, 2500, true);
    this.scale = 900; // px per world unit at distance 1 (set by Renderer)
    this.enabled = true;
    // pre-convert colors to linear
    this._cols = {};
    for (const k in KINDS) {
      this._cols[k] = KINDS[k].c.map((h) => { _c.setHex(h); return [_c.r, _c.g, _c.b]; });
    }
  }

  update(dt) {
    this.normal.uScale.value = this.scale;
    this.additive.uScale.value = this.scale;
    this.normal.update(dt);
    this.additive.update(dt);
  }

  burst(kind, x, y, z) {
    if (!this.enabled) return;
    const k = KINDS[kind] ? kind : 'hit';
    const cfg = KINDS[k];
    const cols = this._cols[k];
    const pool = cfg.add ? this.additive : this.normal;
    for (let i = 0; i < cfg.n; i++) {
      const ang = Math.random() * Math.PI * 2;
      const sp = cfg.sp * (0.35 + Math.random() * 0.65);
      const r = Math.random() * cfg.spread;
      const c = cols[(Math.random() * cols.length) | 0];
      const life = cfg.life[0] + Math.random() * (cfg.life[1] - cfg.life[0]);
      const size = cfg.size[0] + Math.random() * (cfg.size[1] - cfg.size[0]);
      pool.spawn(
        x + Math.cos(ang) * r, y + Math.random() * 0.2, z + Math.sin(ang) * r,
        Math.cos(ang) * sp, cfg.up * (0.4 + Math.random() * 0.8), Math.sin(ang) * sp,
        c[0], c[1], c[2], cfg.a, size, life, cfg.g, cfg.drag, cfg.grow
      );
    }
    if (k === 'explosion') this.burst('smoke', x, y + 0.3, z);
    if (k === 'ageup') {
      // rising golden column
      const cc = this._cols.ageup;
      for (let i = 0; i < 60; i++) {
        const ang = Math.random() * Math.PI * 2, r = 1.2 + Math.random() * 1.8;
        const c = cc[(Math.random() * cc.length) | 0];
        this.additive.spawn(x + Math.cos(ang) * r, y + Math.random() * 0.5, z + Math.sin(ang) * r,
          -Math.sin(ang) * 1.5, 2.5 + Math.random() * 3.5, Math.cos(ang) * 1.5,
          c[0], c[1], c[2], 1, 0.15 + Math.random() * 0.25, 1.5 + Math.random() * 1.5, -0.5, 0.4, 0.2);
      }
    }
  }

  /** ring of dust around a w x d footprint at height y (a wall course landing) */
  courseDust(x, y, z, w, d, n) {
    if (!this.enabled) return;
    const cnt = n || 14, hw = w * 0.5, hd = d * 0.5;
    for (let i = 0; i < cnt; i++) {
      const t = Math.random() * 4, s = (t % 1) * 2 - 1, side = t | 0;
      const px = side === 0 ? s * hw : side === 1 ? hw : side === 2 ? -s * hw : -hw;
      const pz = side === 0 ? hd : side === 1 ? s * hd : side === 2 ? -hd : -s * hd;
      const ox = px === 0 ? 0 : px / Math.abs(px), oz = pz === 0 ? 0 : pz / Math.abs(pz);
      const g = 0.7 + Math.random() * 0.15;
      this.normal.spawn(x + px, y, z + pz, ox * (0.3 + Math.random() * 0.4), 0.1 + Math.random() * 0.25, oz * (0.3 + Math.random() * 0.4),
        g, g * 0.94, g * 0.82, 0.38, 0.22 + Math.random() * 0.16, 0.6 + Math.random() * 0.5, -0.1, 2.2, 1.6);
    }
  }

  /** single low dust puff (hooves / wheels) */
  puff(x, y, z) {
    if (!this.enabled) return;
    this.normal.spawn(x + (Math.random() - 0.5) * 0.2, y + 0.05, z + (Math.random() - 0.5) * 0.2,
      (Math.random() - 0.5) * 0.4, 0.25 + Math.random() * 0.2, (Math.random() - 0.5) * 0.4,
      0.58, 0.5, 0.36, 0.32, 0.22 + Math.random() * 0.12, 0.6 + Math.random() * 0.4, -0.1, 2, 1.8);
  }

  /** muzzle flash + powder smoke pushed along (dx,dz) */
  muzzle(x, y, z, dx, dz, big) {
    if (!this.enabled) return;
    const s = big ? 1.9 : 1;
    for (let i = 0; i < (big ? 6 : 3); i++) {
      const v = (1.5 + Math.random() * 2.5) * s;
      this.additive.spawn(x, y, z, dx * v, (Math.random() - 0.3) * 0.6, dz * v,
        1, 0.75 + Math.random() * 0.2, 0.3, 1, (0.16 + Math.random() * 0.14) * s, 0.07 + Math.random() * 0.08, 0, 3, 2);
    }
    for (let i = 0; i < (big ? 7 : 3); i++) {
      const v = (0.5 + Math.random() * 1.3) * s, g = 0.55 + Math.random() * 0.25;
      this.normal.spawn(x + dx * 0.1, y, z + dz * 0.1, dx * v + (Math.random() - 0.5) * 0.3, 0.3 + Math.random() * 0.4, dz * v + (Math.random() - 0.5) * 0.3,
        g, g, g, 0.4, (0.2 + Math.random() * 0.15) * s, 0.8 + Math.random() * 0.8, -0.2, 1.8, 2.2);
    }
  }

  smoke(x, y, z) {
    if (!this.enabled) return;
    const g = 0.12 + Math.random() * 0.1;
    this.normal.spawn(
      x + (Math.random() - 0.5) * 0.1, y, z + (Math.random() - 0.5) * 0.1,
      0.25 + (Math.random() - 0.5) * 0.2, 0.7 + Math.random() * 0.3, 0.12 + (Math.random() - 0.5) * 0.2,
      g, g, g, 0.42, 0.35 + Math.random() * 0.15, 2.2 + Math.random() * 0.8, -0.15, 0.3, 2.6
    );
  }

  dispose() {
    this.normal.dispose();
    this.additive.dispose();
    this.tex.dispose();
  }
}
