// Aevum - order lines on the ground (view only, owner playtest 2026-11-14):
//  * rally line: a dashed, semi-transparent ribbon from a selected own building to its rally flag
//  * waypoint line: for selected own units with shift-queued orders, a thin ribbon from the unit through every
//    queued order's point (move spots, build sites, gather and attack targets), with a small marker at each point.
// Both are flat ribbons laid on the terrain (cut into short pieces that follow the height), in preallocated
// buffers that are refilled a few times a second. Nothing here touches the simulation.
//  * range outline (2026-11-17 playtest: "a building that works on its surroundings must show its radius when
//    selected, and a tower how far it shoots"): a selected own / allied tower, castle or town centre gets its shooting
//    reach (measured from the footprint's edge, as the sim does: a rounded square), a temple its healing circle.
//    A selected own / allied healer (Büyücü) shows her healing circle round her.
import * as THREE from 'three';
import { BUILDINGS } from '../data.js';
import { towerAgeBonus, TEMPLE_HEAL_R, HEALER_R } from '../sim/game.js';

const MAX_Q = 1600;          // quads per ribbon mesh (rally / waypoints)
const MAX_MARK = 96;         // waypoint markers
const MAX_UNITS = 16;        // selected units that get a waypoint line (big selections: the first ones only)
const MAX_RALLY = 8;         // selected buildings that get a rally line
const LIFT = 0.16;           // above the ground
const REFRESH = 0.06;        // seconds between rebuilds
const MAX_HEAL = 12;         // selected healers that get their circle

class Ribbon {
  constructor(color, opacity) {
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(MAX_Q * 4 * 3);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    const idx = new Uint16Array(MAX_Q * 6);
    for (let i = 0; i < MAX_Q; i++) { const v = i * 4, k = i * 6; idx[k] = v; idx[k + 1] = v + 2; idx[k + 2] = v + 1; idx[k + 3] = v + 1; idx[k + 4] = v + 2; idx[k + 5] = v + 3; }
    g.setIndex(new THREE.BufferAttribute(idx, 1));
    g.setDrawRange(0, 0);
    this.geo = g;
    this.mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide, fog: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
    this.mesh = new THREE.Mesh(g, this.mat);
    this.mesh.frustumCulled = false; this.mesh.renderOrder = 25; this.mesh.visible = false;
    this.n = 0;
  }
  begin() { this.n = 0; }
  // one flat quad from (x0,z0) to (x1,z1), half width w, each end at its own ground height
  quad(x0, z0, x1, z1, w, hf) {
    if (this.n >= MAX_Q) return;
    const dx = x1 - x0, dz = z1 - z0, l = Math.hypot(dx, dz) || 1, nx = -dz / l * w, nz = dx / l * w;
    const y0 = hf(x0, z0) + LIFT, y1 = hf(x1, z1) + LIFT, p = this.pos, o = this.n * 12;
    p[o] = x0 + nx; p[o + 1] = y0; p[o + 2] = z0 + nz;
    p[o + 3] = x0 - nx; p[o + 4] = y0; p[o + 5] = z0 - nz;
    p[o + 6] = x1 + nx; p[o + 7] = y1; p[o + 8] = z1 + nz;
    p[o + 9] = x1 - nx; p[o + 10] = y1; p[o + 11] = z1 - nz;
    this.n++;
  }
  // a path segment cut into pieces of at most `step` tiles; dash: [on, off] lengths (null = solid)
  seg(x0, z0, x1, z1, w, hf, dash, phase = 0) {
    const L = Math.hypot(x1 - x0, z1 - z0); if (L < 1e-3) return phase;
    const ux = (x1 - x0) / L, uz = (z1 - z0) / L;
    if (!dash) {
      const k = Math.max(1, Math.ceil(L / 1.0));
      for (let i = 0; i < k; i++) { const a = L * i / k, b = L * (i + 1) / k; this.quad(x0 + ux * a, z0 + uz * a, x0 + ux * b, z0 + uz * b, w, hf); }
      return 0;
    }
    const per = dash[0] + dash[1];
    // (the dash state is stepped explicitly: re-deriving it from (phase + t) % per stalled on rounding)
    let t = 0, ph = ((phase % per) + per) % per;
    while (t < L && this.n < MAX_Q) {
      if (ph < dash[0]) { const e = Math.min(L, t + dash[0] - ph); this.quad(x0 + ux * t, z0 + uz * t, x0 + ux * e, z0 + uz * e, w, hf); t = e; ph = dash[0]; }
      else { t += per - ph; ph = 0; }
    }
    return (phase + L) % per;
  }
  end() {
    this.geo.setDrawRange(0, this.n * 6);
    this.geo.attributes.position.needsUpdate = true;
    this.mesh.visible = this.n > 0;
  }
  dispose() { this.geo.dispose(); this.mat.dispose(); }
}

export class OrderLines {
  constructor(scene) {
    this.rally = new Ribbon(0xffffff, 0.55);
    this.way = new Ribbon(0xd8ffd0, 0.5);
    this.rAtk = new Ribbon(0xff8a5c, 0.6);
    this.rHeal = new Ribbon(0x86ec95, 0.6);
    const mg = new THREE.RingGeometry(0.16, 0.3, 16).rotateX(-Math.PI / 2);
    this.markMat = new THREE.MeshBasicMaterial({ color: 0xd8ffd0, transparent: true, opacity: 0.75, depthWrite: false, side: THREE.DoubleSide, fog: false });
    this.marks = new THREE.InstancedMesh(mg, this.markMat, MAX_MARK);
    this.marks.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.marks.count = 0; this.marks.frustumCulled = false; this.marks.renderOrder = 26; this.marks.visible = false;
    this.group = new THREE.Group();
    this.group.add(this.rally.mesh, this.way.mesh, this.marks, this.rAtk.mesh, this.rHeal.mesh);
    scene.add(this.group);
    this._t = 0; this._m = new THREE.Matrix4(); this._seen = new Set();
  }

  clear() { for (const r of [this.rally, this.way, this.rAtk, this.rHeal]) { r.begin(); r.end(); } this.marks.count = 0; this.marks.visible = false; }

  // closed outline through pts [[x, z], ...] as dashes
  _loop(rb, pts, hf) { let ph = 0; for (let i = 0; i < pts.length; i++) { const a = pts[i], b = pts[(i + 1) % pts.length]; ph = rb.seg(a[0], a[1], b[0], b[1], 0.08, hf, [0.9, 0.45], ph); } }
  // the reach / healing outline of a selected building (nothing for other buildings)
  _range(game, e, hf) {
    const d = BUILDINGS[e.type]; if (!d || !e.done) return false;
    if (e.type === 'temple') { const pts = [], R = TEMPLE_HEAL_R; for (let i = 0; i < 72; i++) { const a = i / 72 * Math.PI * 2; pts.push([e.x + Math.cos(a) * R, e.z + Math.sin(a) * R]); } this._loop(this.rHeal, pts, hf); return true; }
    if (!(d.atk > 0)) return false;
    const p = game.players && game.players[e.owner], m = p && p.mods;
    const R = d.range + (m ? m.towerRange || 0 : 0) + towerAgeBonus(e.type, p ? p.age : 0), h = (e.size || 1) / 2, pts = [];
    for (const [cx, cz, a0] of [[h, h, 0], [-h, h, 0.5], [-h, -h, 1], [h, -h, 1.5]]) for (let i = 0; i <= 12; i++) { const a = (a0 + i / 24) * Math.PI; pts.push([e.x + cx + Math.cos(a) * R, e.z + cz + Math.sin(a) * R]); }
    this._loop(this.rAtk, pts, hf); return true;
  }

  // point of an order on the ground, or null (orders without a place: explore, trade, ...)
  _pt(game, o) {
    if (!o) return null;
    if (o.type === 'move') return o.x != null ? [o.x, o.z] : null;
    if (o.type === 'gather' || o.type === 'build' || o.type === 'attack' || o.type === 'repair') {
      const t = o.targetId != null ? game.getEntity(o.targetId) : null;
      if (t && !t.dead && (t.owner === game.me || game.isEntityVisible(t))) return [t.x, t.z];
      return o.x != null ? [o.x, o.z] : null;
    }
    return o.x != null && o.z != null ? [o.x, o.z] : null;
  }

  update(dt, game, selected, hf, colorOf) {
    this._t -= dt;
    if (this._t > 0) return;
    this._t = REFRESH;
    if (!game || !selected || !selected.size) { if (this.rally.mesh.visible || this.way.mesh.visible || this.marks.visible || this.rAtk.mesh.visible || this.rHeal.mesh.visible) this.clear(); return; }
    const me = game.me;
    this.rally.begin(); this.way.begin(); this.rAtk.begin(); this.rHeal.begin();
    let nb = 0, nu = 0, nm = 0, rc = null, nr = 0, nh = 0;
    const seen = this._seen; seen.clear();
    const mark = (x, z) => {
      if (nm >= MAX_MARK) return;
      const k = Math.round(x * 2) * 100003 + Math.round(z * 2); if (seen.has(k)) return; seen.add(k);
      this._m.makeTranslation(x, hf(x, z) + LIFT + 0.01, z); this.marks.setMatrixAt(nm++, this._m);
    };
    for (const id of selected) {
      const e = game.getEntity(id);
      if (!e || e.dead) continue;
      if (e.kind === 'building' && nr < MAX_RALLY && (e.owner === me || (game.isAlly && game.isAlly(e.owner, me))) && this._range(game, e, hf)) nr++;
      if (e.kind === 'unit' && e.type === 'healer' && nh < MAX_HEAL && (e.owner === me || (game.isAlly && game.isAlly(e.owner, me)))) {
        const pts = []; for (let i = 0; i < 48; i++) { const a = i / 48 * Math.PI * 2; pts.push([e.x + Math.cos(a) * HEALER_R, e.z + Math.sin(a) * HEALER_R]); }
        this._loop(this.rHeal, pts, hf); nh++;
      }
      if (e.owner !== me) continue;
      if (e.kind === 'building') {
        const r = e.rally; if (!r || nb >= MAX_RALLY) continue;
        const dx = r.x - e.x, dz = r.z - e.z, m = Math.max(Math.abs(dx), Math.abs(dz));
        if (m < 0.5) continue;
        const k = Math.min(1, (e.size || 1) / 2 / m);   // start at the footprint's edge
        this.rally.seg(e.x + dx * k, e.z + dz * k, r.x, r.z, 0.09, hf, [0.7, 0.45]);
        if (rc == null && colorOf) rc = colorOf(me);
        nb++;
      } else if (e.kind === 'unit' && e.queue && e.queue.length && nu < MAX_UNITS) {
        let px = e.x, pz = e.z;
        const pts = [this._pt(game, e.order)]; for (const q of e.queue) pts.push(this._pt(game, q));
        let any = false;
        for (const p of pts) { if (!p) continue; this.way.seg(px, pz, p[0], p[1], 0.045, hf, null); mark(p[0], p[1]); px = p[0]; pz = p[1]; any = true; }
        if (any) nu++;
      }
    }
    if (rc != null) this.rally.mat.color.setHex(rc).lerp(_white, 0.45);
    this.rally.end(); this.way.end(); this.rAtk.end(); this.rHeal.end();
    this.marks.count = nm; this.marks.visible = nm > 0;
    if (nm) this.marks.instanceMatrix.needsUpdate = true;
  }

  dispose() { this.rally.dispose(); this.way.dispose(); this.rAtk.dispose(); this.rHeal.dispose(); this.marks.geometry.dispose(); this.markMat.dispose(); this.group.removeFromParent(); }
}
const _white = new THREE.Color(0xffffff);
