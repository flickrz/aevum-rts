// Aevum - models for the sea / pasture / railway content: dock, pasture, station, rail,
// fish shoal, ships (fishboat, transport, galley, galleon, ironclad) and the train.
// Builders follow entities.js conventions: buildings add meshes to c.body / c.roof (baked later),
// animated parts go to c.live (left unbaked, attached to the root as userData.live).
import * as THREE from 'three';

const PI = Math.PI;
const G = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0),
  cyl: new THREE.CylinderGeometry(.5, .5, 1, 10).translate(0, .5, 0),
  cone: new THREE.ConeGeometry(.5, 1, 10).translate(0, .5, 0),
  sph: new THREE.SphereGeometry(.5, 10, 8),
  wheel: new THREE.CylinderGeometry(.5, .5, 1, 12).rotateZ(PI / 2),
  ring: new THREE.RingGeometry(.36, .5, 20).rotateX(-PI / 2),
  tri: (() => { // thin triangular sail, base along z at y=0, apex up at z=0 (local +x thickness)
    const g = new THREE.BufferGeometry();
    const p = [0, 0, -.5, 0, 0, .5, 0, 1, -.5, 0, 1, -.5, 0, 0, .5, 0, 0, -.5, 0, 1, -.5, 0, 0, .5, 0, 0, -.5];
    g.setAttribute('position', new THREE.Float32BufferAttribute(p.slice(0, 18), 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(12), 2));
    g.computeVertexNormals(); return g;
  })(),
};
const MC = new Map();
function mat(hex, rough = .85, metal = 0, emissive = 0) {
  const k = 's' + hex + '|' + rough + '|' + metal + '|' + emissive;
  let m = MC.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
    if (emissive) { m.emissive.setHex(emissive); m.emissiveIntensity = 1; }
    MC.set(k, m);
  }
  return m;
}
const M = {
  wood: mat(0x8a6238, .85), dwood: mat(0x4f3620, .9), lwood: mat(0xb08a55, .8), log: mat(0x6e4c2c, .95),
  stone: mat(0x9a968c, .95), dstone: mat(0x6e6b66, .95), brick: mat(0x9a4c3a, .88), plaster: mat(0xe6dcc3, .9),
  steel: mat(0xb4bac2, .35, .85), iron: mat(0x3a3d42, .45, .8), black: mat(0x1c1c1e, .6, .3), gravel: mat(0x7c776e, 1),
  canvas: mat(0xe8e0c8, .95), net: mat(0x5a5040, 1), skin: mat(0xe0b08a, .8), fish: mat(0xc8d2dc, .3, .6),
  wool: mat(0xf0ece0, 1), shead: mat(0x2a2522, .9), hay: mat(0xd9bf62, 1), water: mat(0x3f6f9f, .3),
  thatch: mat(0xc9a84e, 1), white: mat(0xf2efe6, .8), red: mat(0xc0392b, .8), roofm: mat(0x4a5560, .4, .75),
  gold: mat(0xffc62e, .25, 1), glass: mat(0x2a3440, .3, .2, 0x332200), rust: mat(0x6a4a3a, .8, .4),
};
const FOAM = new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: .45, depthWrite: false });
const RIPPLE = new THREE.MeshBasicMaterial({ color: 0xdff2ff, transparent: true, opacity: .35, depthWrite: false });

function mk(geo, p, m, sx, sy, sz, x, y, z) {
  const o = new THREE.Mesh(geo, m);
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  p.add(o); return o;
}
const bx = (p, m, w, h, d, x, y, z) => mk(G.box, p, m, w, h, d, x, y, z);
const cy = (p, m, r, h, x, y, z) => mk(G.cyl, p, m, r * 2, h, r * 2, x, y, z);
const cn = (p, m, r, h, x, y, z) => mk(G.cone, p, m, r * 2, h, r * 2, x, y, z);
const sp = (p, m, r, x, y, z) => mk(G.sph, p, m, r * 2, r * 2, r * 2, x, y, z);
function piv(p, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; }
// cylinder lying along z
function cyz(p, m, r, len, x, y, z) { const o = mk(G.cyl, p, m, r * 2, len, r * 2, x, y, z - len / 2); o.rotation.x = PI / 2; o.position.set(x, y, z - len / 2); return o; }
function cyzC(p, m, r, len, x, y, z) { // centred on z
  const g = piv(p, x, y, z - len / 2); const o = mk(G.cyl, g, m, r * 2, len, r * 2, 0, 0, 0); g.rotation.x = PI / 2; return o;
}

// ---------- direction helpers ----------
// bit i of a link mask: 1=-z 2=+x 4=+z 8=-x (same as walls)
export const SEA_DIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const DIR_ROT = [PI, PI / 2, 0, -PI / 2]; // rotation.y that turns local +z into SEA_DIR[i]
const isWaterT = (t) => t === 3 || t === 4;
// which side (0..3, see SEA_DIR) of a footprint faces the water most
export function dockWaterDir(map, tx, tz, size) {
  try {
    const N = map.size, T = map.tiles, s = size || 3, c = (s - 1) / 2;
    const sc = [0, 0, 0, 0];
    for (let j = -2; j <= s + 1; j++) for (let i = -2; i <= s + 1; i++) {
      const x = tx + i, z = tz + j; if (x < 0 || z < 0 || x >= N || z >= N) continue;
      if (!isWaterT(T[z * N + x])) continue;
      const ox = i - c, oz = j - c;
      for (let d = 0; d < 4; d++) sc[d] += ox * SEA_DIR[d][0] + oz * SEA_DIR[d][1];
    }
    let best = 2, bv = -1e9;
    for (let d = 0; d < 4; d++) if (sc[d] > bv) { bv = sc[d]; best = d; }
    return bv > 0 ? best : 2;
  } catch (err) { return 2; }
}
function maskDir(mask) { const m = mask & 15; for (let d = 0; d < 4; d++) if (m === 1 << d) return d; return 2; }
// height the dock model stands at: the ground under its land platform (the half away from the water), never below
// the water surface (y 0) - the footprint's centre often lies on the waterline or in the water and sank the deck -
// and capped so a dock on a high bank still reaches down to the water with its piles
export function dockY(map, x, z, tx, tz, size) {
  try {
    const s = size || 3, d = SEA_DIR[dockWaterDir(map, tx, tz, s)];
    const h = map.heightAt(x - d[0] * s * .3, z - d[1] * s * .3);
    return Math.max(.06, Math.min(.6, h));
  } catch (err) { return .06; }
}

// link mask for rail (rail + station tiles of the same owner) and dock (water side), cached per frame
const RAIL_LINK = { rail: 1, station: 1 };
export function seaMask(view, e, extra) {
  try {
    const game = view.game, map = game.map, N = map.size;
    if (e.type === 'dock') return 1 << dockWaterDir(map, e.tx, e.tz, e.size || 3);
    if (view._seaFrame !== view.frame || !view._seaLinks) {
      const L = view._seaLinks || (view._seaLinks = new Map()); L.clear(); view._seaFrame = view.frame;
      const bs = game.buildings;
      if (bs) for (const b of bs) {
        if (b.dead || !RAIL_LINK[b.type]) continue;
        const s = b.size || 1;
        for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) L.set((b.tz + j) * N + b.tx + i, b.owner);
      }
    }
    const L = view._seaLinks; let m = 0;
    for (let i = 0; i < 4; i++) {
      const x = e.tx + SEA_DIR[i][0], z = e.tz + SEA_DIR[i][1], k = z * N + x;
      if (L.get(k) === e.owner || (extra && extra.has(k))) m |= 1 << i;
    }
    return m;
  } catch (err) { return 0; }
}

// ---------- buildings ----------
function hut(p, wm, rm, w, h, d, x, z) {
  bx(p, wm, w, h, d, x, 0, z);
  const r = mk(G.cone, p, rm, w * 1.25, h * .7, d * 1.25, x, h, z); r.rotation.y = PI / 4; r.geometry = r.geometry; // pyramid-ish cone
  return r;
}
function fishRack(p, x, z) {
  for (const s of [-.3, .3]) cy(p, M.dwood, .03, .6, x + s, 0, z);
  bx(p, M.dwood, .7, .03, .03, x, .58, z);
  for (let i = 0; i < 4; i++) bx(p, M.fish, .05, .16, .03, x - .22 + i * .15, .4, z);
}
function crane(p, m, x, z, h, boomL, rot) {
  const g = piv(p, x, 0, z); g.rotation.y = rot || 0;
  bx(g, m, .14, h, .14, 0, 0, 0);
  const b = bx(g, m, .08, .08, boomL, 0, h - .1, boomL / 2 - .1); b.rotation.x = -.15;
  bx(g, M.black, .015, h * .5, .015, 0, h * .45, boomL - .2);
  bx(g, M.wood, .14, .1, .14, 0, h * .42, boomL - .2);
}
const SEA_BUILD = {
  dock(c) {
    c.noSlab = true;
    const e = c.era, dir = maskDir(c.mask), P = c.P;
    const g = piv(c.body, 0, 0, 0), gr = piv(c.roof, 0, 0, 0);
    g.rotation.y = gr.rotation.y = DIR_ROT[dir];
    const plank = e === 0 ? M.log : e === 4 ? M.dwood : M.wood;
    // land platform (back half), pier toward +z into the water
    if (e >= 2) { bx(g, e === 4 ? M.dstone : M.stone, 2.9, .5, 1.5, 0, -.38, -.75); bx(g, M.dstone, 2.95, .06, .1, 0, .1, 0); }
    else bx(g, plank, 2.8, .1, 1.3, 0, .02, -.8);
    bx(g, plank, 1.0, .08, 2.4, .5, .1, .9);
    if (e === 0) for (let i = 0; i < 6; i++) bx(g, M.dwood, 1.02, .02, .03, .5, .18, -.2 + i * .42);
    for (let i = 0; i < 5; i++) for (const s of [-.45, .45]) cy(g, M.dwood, e === 0 ? .07 : .06, 1.6, .5 + s, -1.45, -.1 + i * .5);
    for (const s of [-.48, .48]) cy(g, M.dwood, .05, .35, .5 + s, .1, 2.0); // end bollards
    // banner in owner colour
    cy(g, M.dwood, .03, 1.3, -1.25, 0, -1.3); bx(g, c.cm, .03, .25, .4, -1.25, 1.0, -1.1);
    if (e <= 1) {
      hut(gr, e === 0 ? P.wall : P.wall2, M.thatch, .9, .55, .8, -.7, -.9);
      fishRack(g, .6, -1.0);
      bx(g, M.net, .5, .04, .4, -.9, .12, .25);
      if (e === 0) { const cn0 = bx(g, M.log, .22, .14, .9, 1.25, .05, .4); cn0.rotation.y = .2; }
      else { for (let i = 0; i < 2; i++) { cy(g, M.wood, .09, .22, 1.2, .1, -.4 - i * .3); } }
    } else if (e <= 3) {
      bx(g, e === 2 ? P.wall2 : M.plaster, 1.2, .8, .9, -.75, .1, -.95);
      const r = mk(G.box, gr, P.roof, 1.35, .12, 1.05, -.75, .95, -.95); r.rotation.x = .1;
      crane(g, M.wood, .95, -.5, 1.5, 1.1, 0);
      for (let i = 0; i < 2; i++) bx(g, M.lwood, .25, .25, .25, .2 + i * .3, .14, -.9);
      fishRack(g, -.1, -.35);
    } else {
      bx(g, M.brick, 1.5, .95, 1.0, -.6, .1, -.9);
      bx(g, M.glass, .02, .25, .5, .16, .55, -.9);
      const r = mk(G.box, gr, M.roofm, 1.65, .1, 1.15, -.6, 1.08, -.9); r.rotation.x = .08;
      crane(g, M.iron, 1.0, -.45, 1.9, 1.3, 0);
      bx(g, M.iron, .3, .02, .3, 1.0, .14, -.45);
      for (let i = 0; i < 3; i++) cy(g, M.rust, .1, .26, .2 + i * .25, .14, -1.05);
    }
  },
  pasture(c) {
    const e = c.era, s = 1.4, P = c.P;
    const posts = e === 4 ? M.iron : e === 3 ? M.white : M.dwood;
    const ph = e === 0 ? .32 : .38, pr = e === 4 ? .02 : .035;
    for (let side = 0; side < 4; side++) {
      const along = side & 1 ? 'z' : 'x', fix = side < 2 ? -s : s;
      for (let i = 0; i <= 7; i++) {
        const a = -s + i * (2 * s / 7);
        if (side === 2 && (i === 3 || i === 4)) continue; // gate gap at +z... keep posts sparse there
        const x = along === 'x' ? a : fix, z = along === 'x' ? fix : a;
        cy(c.body, posts, pr, ph, x, 0, z);
      }
      const len = 2 * s, X = along === 'x' ? 0 : fix, Z = along === 'x' ? fix : 0;
      const W = along === 'x' ? len : .03, D = along === 'x' ? .03 : len;
      const gate = side === 2;
      const seg = (y, h, m, th) => {
        if (!gate) bx(c.body, m, along === 'x' ? W : th, h, along === 'x' ? th : D, X, y, Z);
        else for (const sg of [-1, 1]) bx(c.body, m, len * .38, h, th, sg * len * .31, y, Z);
      };
      if (e === 0) { // branches, slanted
        for (let i = 0; i < 6; i++) { const a = -s + .2 + i * .48; const b = bx(c.body, M.dwood, along === 'x' ? .5 : .025, .025, along === 'x' ? .025 : .5, along === 'x' ? a : fix, .18 + (i & 1) * .08, along === 'x' ? fix : a); b.rotation[along === 'x' ? 'z' : 'x'] = (i & 1 ? .25 : -.25); if (gate && Math.abs(a) < .5) b.visible = false; }
      } else if (e === 1) seg(.06, .24, M.lwood, .05); // wattle panels
      else if (e === 2) { seg(.14, .04, M.wood, .04); seg(.28, .04, M.wood, .04); }
      else if (e === 3) { seg(.06, .26, M.white, .03); seg(.33, .04, M.red, .04); }
      else { for (const y of [.12, .22, .32]) seg(y, .008, M.steel, .008); }
    }
    // shelter + trough + hay
    const sm = e <= 1 ? P.wall : e === 4 ? M.brick : P.wall2;
    bx(c.body, sm, .9, .5, .6, -.85, 0, -.95);
    const r = bx(c.roof, e <= 1 ? M.thatch : P.roof, 1.05, .08, .78, -.85, .55, -.95); r.rotation.x = -.2;
    bx(c.body, e === 4 ? M.iron : M.wood, .7, .14, .22, .8, 0, -1.05);
    bx(c.body, M.water, .62, .02, .15, .8, .13, -1.05);
    cy(c.body, M.hay, .2, .26, -.2, 0, -1.1);
    bx(c.body, c.cm, .02, .12, .2, -s, .3, s - .2);
    // sheep (pooled 8)
    const live = new THREE.Group(); c.live = live; live.userData.sheep = [];
    for (let i = 0; i < 8; i++) {
      const sh = new THREE.Group(); live.add(sh);
      mk(G.sph, sh, M.wool, .28, .22, .38, 0, .2, 0);
      for (let l = 0; l < 4; l++) cy(sh, M.shead, .025, .12, (l & 1 ? .07 : -.07), 0, (l & 2 ? .1 : -.1));
      const hd = piv(sh, 0, .26, .17); bx(hd, M.shead, .1, .1, .14, 0, -.05, .05);
      sh.userData.head = hd;
      const a = i * 2.4, rr = .35 + (i % 3) * .3;
      sh.position.set(Math.cos(a) * rr, 0, Math.sin(a) * rr * .8 + .2);
      sh.userData.tx = sh.position.x; sh.userData.tz = sh.position.z; sh.userData.w = i * .7;
      sh.visible = i < 3;
      live.userData.sheep.push(sh);
    }
  },
  station(c) {
    const P = c.P;
    bx(c.body, M.stone, 2.9, .22, 1.1, 0, 0, .85); // platform (+z)
    bx(c.body, M.white, 2.9, .02, .06, 0, .22, 1.37);
    for (let i = 0; i < 4; i++) { cy(c.body, M.iron, .035, 1.0, -1.2 + i * .8, .22, 1.15); }
    const cnp = bx(c.roof, M.roofm, 2.95, .06, .9, 0, 1.22, .95); cnp.rotation.x = .1;
    bx(c.roof, c.cm, 2.93, .06, .03, 0, 1.17, 1.4);
    // brick house (-z) with gable and clock
    bx(c.body, M.brick, 2.3, 1.15, 1.1, 0, 0, -.65);
    bx(c.body, M.stone, 2.34, .1, 1.14, 0, 1.1, -.65);
    for (let i = 0; i < 4; i++) bx(c.body, M.glass, .22, .4, .02, -.8 + i * .53, .45, -.09);
    bx(c.body, M.dwood, .3, .6, .02, 0, .22, -.08);
    const r = mk(G.box, c.roof, M.roofm, 2.5, .5, .1, 0, 1.2, -.65); r.scale.z = 1.25; r.rotation.x = 0;
    bx(c.body, M.brick, .55, .55, .5, 0, 1.2, -.45);
    mk(G.wheel, c.body, M.white, .03, .36, .36, 0, 1.47, -.19).rotation.y = PI / 2;
    bx(c.body, M.black, .015, .14, .01, 0, 1.5, -.165); bx(c.body, M.black, .1, .015, .01, .03, 1.47, -.165);
    c.chim.push(.85, 1.6, -.9); bx(c.body, M.brick, .18, .5, .18, .85, 1.1, -.9);
    // signal post
    cy(c.body, M.iron, .03, 1.4, 1.35, 0, 1.35); bx(c.body, M.red, .3, .06, .03, 1.48, 1.25, 1.35);
    sp(c.body, mat(0x60ff60, .4, 0, 0x30a030), .04, 1.35, 1.1, 1.38);
  },
  rail(c) {
    c.noSlab = true;
    let m = c.mask & 15; if (!m) m = 10; else if (m === 1 || m === 4) m = 5; else if (m === 2 || m === 8) m = 10;
    bx(c.body, M.gravel, .5, .06, .5, 0, 0, 0);
    for (let d = 0; d < 4; d++) {
      if (!(m & (1 << d))) continue;
      const g = piv(c.body, 0, 0, 0); g.rotation.y = DIR_ROT[d]; // local +z toward neighbour
      bx(g, M.gravel, .62, .06, .5, 0, 0, .25);
      for (let i = 0; i < 3; i++) bx(g, M.dwood, .56, .04, .08, 0, .05, .06 + i * .17);
      for (const s of [-.16, .16]) bx(g, M.steel, .035, .045, .54, s, .08, .24);
    }
    bx(c.body, M.dwood, .48, .04, .48, 0, .045, 0);   // (inside the gravel's edges)
  },
};
export { SEA_BUILD };

// the pasture's sheep keep the size (and walking speed) they had in the 6x6 pen, which drew its 3x3 design 2x: a
// bigger pen (the 9x9 of 2026-11-20 draws it 3x, k = 3) scales them back by 2 / k. Placed pastures and the
// placement ghost both use it (entities.js)
export const pastureSheepK = k => Math.min(1, 2 / (k || 1));
// per-frame building hook: sheep in the pasture
const _sv = new THREE.Vector3();
export function seaAnimBuilding(view, v, e, dt, t, U) {
  const live = U.live; if (!live) return;
  live.visible = !!e.done;
  if (!e.done) return;
  const sh = live.userData.sheep; if (!sh) return;
  const n = Math.max(0, Math.min(8, ((e.pasture && e.pasture.sheep) != null ? e.pasture.sheep : 3) | 0));
  const sp = .22 * pastureSheepK(v.k);   // (model units a second under the k-scaled root: the same world speed in any pen)
  for (let i = 0; i < sh.length; i++) {
    const s = sh[i], u = s.userData;
    s.visible = i < n; if (!s.visible) continue;
    const dx = u.tx - s.position.x, dz = u.tz - s.position.z, d = Math.sqrt(dx * dx + dz * dz);
    if (d > .03) {
      const st = Math.min(d, dt * sp);
      s.position.x += dx / d * st; s.position.z += dz / d * st;
      let dr = Math.atan2(dx, dz) - s.rotation.y; while (dr > PI) dr -= PI * 2; while (dr < -PI) dr += PI * 2;
      s.rotation.y += dr * Math.min(1, dt * 4);
      u.head.rotation.x = 0;
    } else {
      u.w -= dt;
      u.head.rotation.x = Math.sin(t * 1.5 + i) > -.2 ? .7 : 0; // graze
      if (u.w <= 0) {
        u.w = 2 + ((i * 7 + (t * 10) | 0) % 5);
        const a = (t * 1.7 + i * 2.1) % 6.283, r = .2 + ((i * 13 + (t | 0)) % 9) / 9 * .9;
        u.tx = Math.max(-1.15, Math.min(1.15, Math.cos(a) * r)); u.tz = Math.max(-.5, Math.min(1.15, Math.sin(a) * r + .3));
      }
    }
  }
}

// ---------- fish shoal resource ----------
export function makeFish(e) {
  const root = new THREE.Group(), g = new THREE.Group(); root.add(g);
  const rings = [];
  for (let i = 0; i < 3; i++) { const r = mk(G.ring, g, RIPPLE, 1, 1, 1, (i - 1) * .25, .02, (i & 1) * .2 - .1); r.castShadow = false; r.receiveShadow = false; rings.push(r); }
  const fish = [], n = 3 + (e.id % 3);
  for (let i = 0; i < n; i++) {
    const f = new THREE.Group(); g.add(f);
    mk(G.sph, f, M.fish, .06, .07, .2, 0, 0, 0);
    const tl = bx(f, M.fish, .01, .08, .06, 0, -.04, -.11); tl.castShadow = false;
    f.visible = false; f.userData.ph = i * 1.37 + e.id * .31; f.userData.a = i * 2.1;
    fish.push(f);
  }
  root.userData.g = g; root.userData.rings = rings; root.userData.fish = fish; root.userData.fishShoal = true;
  return root;
}
export function seaAnimFish(v, t) {
  const U = v.root.userData; if (!U.fishShoal) return;
  v.root.position.y = .02;
  const rings = U.rings;
  for (let i = 0; i < rings.length; i++) { const k = ((t * .35 + i / rings.length) % 1); const s = .5 + k * 1.1; rings[i].scale.set(s, 1, s); }
  const fish = U.fish;
  for (let i = 0; i < fish.length; i++) {
    const f = fish[i], per = 3.5 + (i % 3), q = ((t + f.userData.ph) % per) / .7;
    if (q >= 1) { f.visible = false; continue; }
    f.visible = true;
    const a = f.userData.a + Math.floor((t + f.userData.ph) / per) * 1.9, r = .25 + (i % 2) * .15;
    f.position.set(Math.cos(a) * r + (q - .5) * .3 * Math.sin(a), Math.sin(q * PI) * .35 - .04, Math.sin(a) * r - (q - .5) * .3 * Math.cos(a));
    f.rotation.set(-(q - .5) * 2.2, a + PI / 2, 0);
  }
}

// ---------- ships & train ----------
function sailor(p, color, x, y, z, s) {
  const g = piv(p, x, y, z); g.scale.setScalar(s || 1);
  bx(g, mat(color, .85), .12, .18, .09, 0, 0, 0); bx(g, M.skin, .08, .08, .08, 0, .18, 0);
  return g;
}
export const SEA_UNITS = { fishboat: 1, transport: 1, galley: 1, galleon: 1, ironclad: 1, train: 1 };
// builds into `inner` (already in root); returns dims pre-USCALE (entities.js multiplies by USCALE)
export function makeSeaUnit(type, color, A, root, inner, P) {
  const US = 1.25, cloth = mat(color, .85);
  inner.scale.setScalar(1 / US);
  if (type === 'train') return makeTrain(color, A, root, inner, P, cloth, US);
  const hull = P.hull = piv(inner, 0, 0, 0);
  P.ship = type;
  let h = 1, pw = .5, pd = 1.2;
  const hw = A >= 4 ? M.iron : A === 0 ? M.log : M.wood;
  if (type === 'fishboat') {
    if (A === 0) { const b = cyzC(hull, M.log, .16, 1.1, 0, .05, 0); b.scale.x = 1.3; bx(hull, M.dwood, .22, .04, .9, 0, .14, 0); }
    else { bx(hull, hw, .38, .18, 1.0, 0, -.06, 0); bx(hull, M.dwood, .42, .04, 1.02, 0, .12, 0); const bw = bx(hull, hw, .26, .16, .26, 0, -.05, .56); bw.rotation.y = PI / 4; }
    P.fisher = sailor(hull, color, 0, .2, -.15, 1);
    P.net = piv(hull, .22, .18, .15); bx(P.net, M.net, .02, .02, .5, 0, 0, .25); bx(P.net, M.net, .25, .02, .2, .12, -.02, .45);
    if (A >= 1) { cy(hull, M.dwood, .025, 1.0, 0, .1, .15); const s = mk(G.tri, hull, A >= 3 ? M.canvas : cloth, 1, .8, .6, 0, .25, .15 + .3); s.material = cloth; }
    h = .9; pw = .45; pd = 1.1; P.ringE = [.8, 1.5];
  } else if (type === 'transport') {
    bx(hull, hw, .9, .32, 1.8, 0, -.12, 0); bx(hull, M.dwood, .94, .05, 1.82, 0, .2, 0);
    const bw = bx(hull, hw, .64, .3, .64, 0, -.12, .9); bw.rotation.y = PI / 4;
    bx(hull, cloth, .92, .06, 1.6, 0, .1, 0);
    P.figs = [];
    for (let i = 0; i < 10; i++) { const f = sailor(hull, color, (i & 1 ? .2 : -.2), .24, -.6 + (i >> 1) * .3, .9); f.visible = false; P.figs.push(f); }
    P.nfig = 0;
    if (A >= 4) { P.funnel = piv(hull, 0, .2, -.75); cy(P.funnel, M.black, .1, .6, 0, 0, 0); bx(P.funnel, cloth, .21, .06, .21, 0, .45, 0); P.funTop = .65; }
    else { cy(hull, M.dwood, .035, 1.6, 0, .2, .2); bx(hull, A >= 2 ? M.canvas : cloth, .9, .7, .03, 0, .8, .22); bx(hull, cloth, .92, .12, .035, 0, 1.38, .22); }
    h = 1.6; pw = .9; pd = 2.0; P.ringE = [1.4, 2.4];
  } else if (type === 'galley') {
    bx(hull, hw, .55, .28, 2.0, 0, -.1, 0); bx(hull, M.dwood, .6, .05, 2.02, 0, .18, 0);
    const ram = cn(hull, M.iron.color ? mat(0xb8873a, .4, .8) : M.iron, .08, .5, 0, -.02, 1.05); ram.rotation.x = PI / 2; ram.position.set(0, -.02, 1.0);
    bx(hull, cloth, .57, .06, 1.9, 0, .08, 0);
    P.oars = [];
    for (let i = 0; i < 6; i++) for (const sd of [-1, 1]) {
      const o = piv(hull, sd * .3, .1, -.65 + i * .26); const b = bx(o, M.lwood, .7, .025, .04, sd * .35, 0, 0); b.position.y = -.01;
      o.userData.sd = sd; P.oars.push(o);
    }
    cy(hull, M.dwood, .035, 1.5, 0, .2, .1); bx(hull, M.canvas, .9, .65, .03, 0, .85, .12); bx(hull, cloth, .92, .18, .035, 0, 1.15, .12);
    sailor(hull, color, 0, .25, -.8, 1);
    h = 1.8; pw = .7; pd = 2.2; P.ringE = [1.3, 2.6];
  } else if (type === 'galleon') {
    bx(hull, hw, 1.0, .55, 2.4, 0, -.25, 0); bx(hull, M.dwood, 1.04, .06, 2.42, 0, .3, 0);
    bx(hull, hw, 1.0, .35, .6, 0, .3, -.9); bx(hull, M.gold, 1.02, .04, .62, 0, .62, -.9);
    const bw = bx(hull, hw, .7, .45, .7, 0, -.2, 1.15); bw.rotation.y = PI / 4;
    cyzC(hull, M.dwood, .03, .8, 0, .35, 1.75).rotation.x = PI / 2 - .35;
    for (let i = 0; i < 4; i++) for (const sd of [-1, 1]) bx(hull, M.black, .02, .1, .12, sd * .51, .05, -.6 + i * .4);
    const masts = [[.6, 2.0], [-.1, 2.4], [-.75, 1.7]];
    P.flags = [];
    for (const [z, mh] of masts) {
      cy(hull, M.dwood, .04, mh, 0, .3, z);
      bx(hull, M.canvas, 1.0, mh * .28, .03, 0, .3 + mh * .38, z + .03); bx(hull, M.canvas, .8, mh * .22, .03, 0, .3 + mh * .7, z + .03);
      const f = piv(hull, 0, .3 + mh, z); bx(f, cloth, .02, .14, .3, 0, -.14, -.15); P.flags.push(f);
    }
    h = 2.8; pw = 1.0; pd = 2.6; P.ringE = [1.7, 3.0]; P.guns = 'side';
  } else { // ironclad
    bx(hull, M.iron, .9, .32, 2.2, 0, -.2, 0); bx(hull, M.dstone, .94, .05, 2.22, 0, .1, 0);
    const bw = bx(hull, M.iron, .63, .3, .63, 0, -.2, 1.05); bw.rotation.y = PI / 4;
    bx(hull, cloth, .92, .05, 2.0, 0, .02, 0);
    bx(hull, M.iron, .7, .3, .8, 0, .12, -.35);
    P.funnel = piv(hull, 0, .42, -.4); cy(P.funnel, M.black, .11, .55, 0, 0, 0); bx(P.funnel, cloth, .23, .07, .23, 0, .38, 0); P.funTop = .6;
    P.turret = piv(hull, 0, .14, .5); cy(P.turret, M.iron, .25, .25, 0, 0, 0);
    P.barrel = piv(P.turret, 0, .14, .1); cyzC(P.barrel, M.black, .045, .6, 0, 0, .3);
    cy(hull, M.iron, .02, .9, 0, .4, -1.0); const f = piv(hull, 0, 1.3, -1.0); bx(f, cloth, .02, .12, .25, 0, -.12, -.12); P.flags = [f];
    h = 1.6; pw = .9; pd = 2.3; P.ringE = [1.4, 2.7]; P.guns = 'turret';
  }
  // wake (root-level, unscaled): two foam rings behind the stern
  const wake = P.wake = piv(root, 0, .02, 0); wake.visible = false;
  P.wakeR = [];
  for (let i = 0; i < 3; i++) { const r = mk(G.ring, wake, FOAM, 1, 1, 1, 0, 0, -pd * .45); r.castShadow = false; r.receiveShadow = false; P.wakeR.push(r); }
  P.pd = pd;
  return { rig: 'ship', h: h / US, pw: pw / US, pd: pd / US };
}

function wagonModel(p, color, cloth, A) {
  const g = new THREE.Group(); p.add(g);
  bx(g, M.rust, .62, .5, 1.25, 0, .22, 0); bx(g, cloth, .64, .06, 1.27, 0, .55, 0);
  bx(g, M.iron, .5, .1, 1.3, 0, .13, 0);
  g.userData.wheels = [];
  for (const z of [-.4, .4]) for (const s of [-1, 1]) { const w = mk(G.wheel, g, M.iron, .06, .26, .26, s * .27, .13, z); g.userData.wheels.push(w); }
  return g;
}
function makeTrain(color, A, root, inner, P, cloth, US) {
  P.ship = null; P.train = true;
  const loco = P.hull = piv(inner, 0, 0, 0);
  bx(loco, M.iron, .6, .12, 1.7, 0, .16, 0);
  cyzC(loco, M.black, .26, 1.1, 0, .55, .3);
  bx(loco, cloth, .54, .05, 1.1, 0, .3, .3);
  bx(loco, M.black, .66, .7, .5, 0, .28, -.5); bx(loco, M.roofm, .72, .06, .58, 0, .98, -.5);
  bx(loco, M.glass, .67, .18, .3, 0, .7, -.5);
  bx(loco, cloth, .68, .06, .52, 0, .5, -.5);
  P.funnel = piv(loco, 0, .7, .7); cy(P.funnel, M.black, .07, .32, 0, 0, 0); cn(P.funnel, M.black, .12, .1, 0, .3, 0).rotation.x = PI;
  P.funTop = .45;
  sp(loco, M.gold, .08, 0, .82, .2);
  bx(loco, M.iron, .5, .2, .1, 0, .12, .88);
  P.wheels = [];
  for (const z of [-.3, .1, .5]) for (const s of [-1, 1]) { const w = mk(G.wheel, loco, M.red, .06, .34, .34, s * .32, .17, z); bx(w, M.steel, 1.1, .12, .12, 0, .2, 0); P.wheels.push(w); }
  P.rods = [];
  for (const s of [-1, 1]) { const r = bx(loco, M.steel, .02, .03, .82, s * .36, .2, .1); P.rods.push(r); }
  P.wagons = [wagonModel(root, color, cloth, A), wagonModel(root, color, cloth, A)];
  for (const w of P.wagons) w.visible = false;
  P.hist = []; P.dist = 0; P.lx = null;
  P.ringE = [1.0, 2.0];
  return { rig: 'train', h: 1.1 / US, pw: .7 / US, pd: 1.8 / US };
}

// per-frame unit hook for rig 'ship' / 'train'; returns the y used for the root
const _wv = new THREE.Vector3(), _iv = new THREE.Vector3();
export function seaAnimUnit(view, v, e, dt, t, gt, y) {
  const P = v.P, root = v.root, inner = v.inner, fx = view.fx;
  const mx = P.lx == null ? 0 : v.x - P.lx, mz = P.lz == null ? 0 : v.z - P.lz;
  const moved = Math.sqrt(mx * mx + mz * mz); P.lx = v.x; P.lz = v.z;
  const speed = dt > 0 ? moved / dt : 0;
  if (v.rig === 'train') return animTrain(view, v, e, dt, t, y, moved, mx, mz);
  // float at y=0; on shallow tiles where the shore terrain rises above the water, ride up so the hull is not buried
  const gy = Math.max(0, (+y || 0) - .2); P.sy = P.sy == null ? gy : P.sy + (gy - P.sy) * Math.min(1, dt * 4);
  y = P.sy; root.position.y = y;
  if (e.dead || e.anim === 'die') {
    const d = Math.max(0, gt - (e.deathTime == null ? gt : e.deathTime)), p = Math.min(1, d / 4);
    P.hull.rotation.z = p * .7; P.hull.rotation.x = -p * .35; inner.position.y = -p * p * (v.h + .6);
    if (P.wake) P.wake.visible = false;
    return y;
  }
  inner.position.y = Math.sin(t * 1.6) * .03;
  P.hull.rotation.z = Math.sin(t * 1.1) * .04; P.hull.rotation.x = Math.sin(t * 1.4 + 1) * .02;
  const moving = speed > .25 || e.anim === 'walk';
  if (P.wake) {
    P.wake.visible = moving && v.vis !== false;
    if (P.wake.visible) for (let i = 0; i < P.wakeR.length; i++) {
      const k = (t * .9 + i / P.wakeR.length) % 1, s = .4 + k * 1.3;
      const r = P.wakeR[i]; r.scale.set(s, 1, s * 1.4); r.position.z = -P.pd * .45 - k * .8;
    }
  }
  if (P.oars) { const a = moving || e.anim === 'attack' ? Math.sin(t * 4) : 0; for (const o of P.oars) { o.rotation.y = a * .45 * o.userData.sd; o.rotation.z = (Math.cos(t * 4) * .15 - .1) * o.userData.sd * (moving ? 1 : 0); } }
  if (P.flags) for (let i = 0; i < P.flags.length; i++) P.flags[i].rotation.y = Math.sin(t * 3 + i) * .25;
  if (P.net) P.net.rotation.z = e.anim && e.anim !== 'walk' && e.anim !== 'idle' && e.anim !== 'attack' ? -.4 + Math.sin(t * 2) * .3 : 0;
  if (P.figs) {
    const n = Math.min(10, e.cargo ? e.cargo.length : 0);
    if (n !== P.nfig) { P.nfig = n; for (let i = 0; i < P.figs.length; i++) P.figs[i].visible = i < n; }
  }
  const k = gt - (e.attackT == null ? -9 : e.attackT);
  if (P.barrel) P.barrel.position.z = k >= 0 && k < .5 ? .1 - .18 * (1 - k / .5) : .1;
  if (P.turret) {
    const tg = targetOf(view, e);
    if (tg) { let a = Math.atan2(tg.x - v.x, tg.z - v.z) - v.rot; while (a > PI) a -= PI * 2; while (a < -PI) a += PI * 2; P.turret.rotation.y += (a - P.turret.rotation.y) * Math.min(1, dt * 4); }
  }
  if (fx && e.attackT != null && e.attackT !== v.lastAtk) {
    const first = v.lastAtk === undefined; v.lastAtk = e.attackT;
    if (!first && fx.muzzle && P.guns && k < .35) {
      try {
        const tg = targetOf(view, e);
        let dx = Math.sin(v.rot + PI / 2), dz = Math.cos(v.rot + PI / 2);
        if (tg) { const l = Math.hypot(tg.x - v.x, tg.z - v.z) || 1; dx = (tg.x - v.x) / l; dz = (tg.z - v.z) / l; }
        const r = P.guns === 'side' ? .55 : .8;
        fx.muzzle(v.x + dx * r, .55, v.z + dz * r, dx, dz, true);
        if (P.guns === 'side') fx.muzzle(v.x + dx * r + Math.sin(v.rot) * .5, .5, v.z + dz * r + Math.cos(v.rot) * .5, dx, dz, true);
      } catch (err) { /* fx optional */ }
    }
  }
  if (P.funnel && fx && fx.smoke && v.vis !== false) {
    P.smT = (P.smT || 0) - dt;
    if (P.smT <= 0) { P.smT = moving ? .3 : .9; funnelPos(root, P); fx.smoke(_wv.x, _wv.y, _wv.z); }
  }
  return y;
}
function funnelPos(root, P) { root.updateMatrixWorld(true); P.funnel.getWorldPosition(_wv); _wv.y += P.funTop * .8; }
function targetOf(view, e) {
  try {
    const id = e.target != null ? e.target : e.order && e.order.target != null ? e.order.target : null;
    if (id == null) return null;
    const ents = view.game.entities, tg = typeof id === 'object' ? id : ents.get ? ents.get(id) : null;
    return tg && tg.x != null ? tg : null;
  } catch (err) { return null; }
}
function animTrain(view, v, e, dt, t, y, moved, mx, mz) {
  const P = v.P, root = v.root, fx = view.fx;
  if (moved > 1e-4) { const a = Math.atan2(mx, mz); v.rot = a; root.rotation.y = a; }
  else if (P.hist.length < 1) root.rotation.y = v.rot;
  else root.rotation.y = P.hrot != null ? P.hrot : root.rotation.y;
  P.hrot = root.rotation.y;
  P.dist += moved;
  const H = P.hist;
  if (!H.length || moved > 2) { H.length = 0; H.push([v.x, v.z]); }
  else { const l = H[0]; if (Math.hypot(v.x - l[0], v.z - l[1]) > .08) { H.unshift([v.x, v.z]); if (H.length > 80) H.length = 80; } }
  for (const w of P.wheels) w.rotation.x = -P.dist / .17;
  const ang = -P.dist / .17;
  for (let i = 0; i < P.rods.length; i++) { const r = P.rods[i]; r.position.y = .2 + Math.cos(ang) * .06; r.position.z = .1 + Math.sin(ang) * .06; }
  // wagons at a lag behind along the locomotive's past positions
  root.updateMatrixWorld(true);
  const lags = [1.55, 2.9];
  for (let wi = 0; wi < P.wagons.length; wi++) {
    const wg = P.wagons[wi], lag = lags[wi];
    let acc = 0, px = v.x, pz = v.z, found = null, prev = null;
    for (let i = 0; i < H.length; i++) {
      const q = H[i], d = Math.hypot(q[0] - px, q[1] - pz);
      if (acc + d >= lag) { const f = (lag - acc) / (d || 1); found = [px + (q[0] - px) * f, pz + (q[1] - pz) * f]; prev = [px, pz]; break; }
      acc += d; px = q[0]; pz = q[1];
    }
    if (!found) { // not enough history: straight behind
      const bx_ = Math.sin(root.rotation.y), bz_ = Math.cos(root.rotation.y);
      found = [v.x - bx_ * lag, v.z - bz_ * lag]; prev = [found[0] + bx_, found[1] + bz_];
    }
    _iv.set(found[0], y, found[1]); root.worldToLocal(_iv);
    wg.position.copy(_iv);
    wg.rotation.y = Math.atan2(prev[0] - found[0], prev[1] - found[1]) - root.rotation.y;
    wg.visible = true;
    for (const w of wg.userData.wheels) w.rotation.x = -P.dist / .13;
  }
  if (fx && fx.smoke && v.vis !== false && P.funnel) {
    P.smT = (P.smT || 0) - dt;
    if (P.smT <= 0) { P.smT = moved > 1e-3 ? .18 : .8; funnelPos(root, P); fx.smoke(_wv.x, _wv.y, _wv.z); }
  }
  return y;
}
