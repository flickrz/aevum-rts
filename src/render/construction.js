// Aevum - layered construction sites for buildings (render only).
// Stages by progress: 0-.15 staked plot + foundation, .15-.35 scaffolding + material piles,
// .35-.75 walls rise in courses (clipping plane), .75-.95 rafters then roof + details,
// .95-1 scaffolding drops, banner hoisted, settle bounce + golden sparkle, then the rig is disposed.
import * as THREE from 'three';

const PI = Math.PI;
const GEO = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0),
  cbox: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(.5, .5, 1, 7).translate(0, .5, 0),
  ccyl: new THREE.CylinderGeometry(.5, .5, 1, 7).rotateZ(PI / 2),
  lump: new THREE.DodecahedronGeometry(.5, 0),
};
const MC = new Map();
function m(hex, r = .9, mt = 0) {
  const k = hex + '|' + r + '|' + mt; let o = MC.get(k);
  if (!o) { o = new THREE.MeshStandardMaterial({ color: hex, roughness: r, metalness: mt }); MC.set(k, o); }
  return o;
}
const M = {
  soil: m(0x6b4a30, 1), peg: m(0x5a3d22), string: m(0xf2e8c8, .8), branch: m(0x6e5232), timber: m(0xa98352, .85),
  iron: m(0x5a5e66, .5, .6), log: m(0x8a6238), hide: m(0x9a7a52, .97), mud: m(0x7a5a3a, 1), mudbrick: m(0xc9a070, .95),
  stone: m(0xa7a399, .95), brick: m(0xa6503a, .88), plaster: m(0xe8e0cc, .9), rope: m(0xd8c89a, .9), concrete: m(0x9c9a94, .95),
};
// era -> [foundation, pile A item, pile B item, scaffold pole]
const ERA = [
  { found: 'log', a: 'branch', b: 'hide', pole: M.branch },
  { found: 'mudbrick', a: 'mudbrick', b: 'log', pole: M.timber },
  { found: 'stone', a: 'stone', b: 'log', pole: M.timber },
  { found: 'stone', a: 'brick', b: 'plaster', pole: M.timber },
  { found: 'concrete', a: 'brick', b: 'beam', pole: M.timber },
];
// light sites keep their own simple look (entities.js): farm plot, wall/gate scaffold, rail bed, pasture stakes
const SKIP = { wall: 1, gate: 1, rail: 1, farm: 1, pasture: 1 };
const _box = new THREE.Box3();
const _up = new THREE.Vector3(0, -1, 0);

function add(rig, parent, geo, mat, sx, sy, sz, x, y, z, th, opt) {
  const o = new THREE.Mesh(geo, mat);
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  o.castShadow = !!(opt && opt.shadow); o.receiveShadow = true; o.visible = false;
  parent.add(o);
  const pc = { o, th, hide: opt && opt.hide != null ? opt.hide : null, fall: opt && opt.fall != null ? opt.fall : null, shrink: !!(opt && opt.shrink),
    sx, sy, sz, x, y, z, rx: 0, rz: 0, a: -1, f: null, dir: opt && opt.dir || 1 };
  rig.pieces.push(pc);
  return pc;
}
function addGroup(rig, parent, x, z, th, opt) {
  const g = new THREE.Group(); g.position.set(x, 0, z); g.visible = false; parent.add(g);
  const pc = { o: g, th, hide: opt.hide, fall: null, shrink: !!opt.shrink, sx: 1, sy: 1, sz: 1, x, y: 0, z, rx: 0, rz: 0, a: -1, f: null, dir: 1 };
  rig.pieces.push(pc);
  return g;
}
function item(g, kind, i) {
  const k = i | 0, row = k < 3 ? 0 : k < 5 ? 1 : 2, col = k - (row === 0 ? 0 : row === 1 ? 3 : 5);
  const mesh = (geo, mat, sx, sy, sz, x, y, z) => { const o = new THREE.Mesh(geo, mat); o.scale.set(sx, sy, sz); o.position.set(x, y, z); o.castShadow = true; o.receiveShadow = true; g.add(o); return o; };
  if (kind === 'branch' || kind === 'log') {
    const r = kind === 'log' ? .075 : .045;
    mesh(GEO.ccyl, kind === 'log' ? M.log : M.branch, .7, r * 2, r * 2, 0, r + row * r * 1.8, (col - 1 + row * .5) * r * 2.1);
  } else if (kind === 'hide') {
    mesh(GEO.lump, k % 2 ? M.hide : M.mud, .3, .16, .26, (col - 1) * .2, .07 + row * .12, 0);
  } else if (kind === 'beam') {
    mesh(GEO.cbox, M.iron, .9, .06, .08, 0, .03 + row * .065, (col - 1) * .1);
  } else {
    const mat = kind === 'mudbrick' ? M.mudbrick : kind === 'stone' ? M.stone : kind === 'plaster' ? M.plaster : M.brick;
    const w = kind === 'stone' ? .26 : kind === 'plaster' ? .22 : .2, h = kind === 'stone' ? .15 : kind === 'plaster' ? .13 : .085, d = kind === 'stone' ? .2 : kind === 'plaster' ? .16 : .1;
    mesh(GEO.box, mat, w, h, d, (col - 1) * (w + .02) + row * w * .5, row * h, 0);
  }
}

// A generated model's mesh (userData.glb) is not baked into root space: it keeps its shared geometry and carries its
// placement in its own transform, so its positions / box are read through that transform (the groups themselves
// sit at the root's origin). Root-space positions of such a mesh, cached per geometry and placement.
const _rootPos = new WeakMap();
function rootPos(o) {
  const pa = o.geometry.attributes.position;
  if (!o.userData.glb) return { getX: (i) => pa.getX(i), getY: (i) => pa.getY(i), getZ: (i) => pa.getZ(i) };
  o.updateMatrix();
  const key = o.matrix.elements.join(',');
  let per = _rootPos.get(o.geometry); if (!per) _rootPos.set(o.geometry, per = new Map());
  let a = per.get(key);
  if (!a) {
    a = new Float32Array(pa.count * 3); const v = new THREE.Vector3();
    for (let i = 0; i < pa.count; i++) { v.fromBufferAttribute(pa, i).applyMatrix4(o.matrix); a[i * 3] = v.x; a[i * 3 + 1] = v.y; a[i * 3 + 2] = v.z; }
    per.set(key, a);
  }
  return { getX: (i) => a[i * 3], getY: (i) => a[i * 3 + 1], getZ: (i) => a[i * 3 + 2] };
}
function rootBox(o) {
  if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
  _box.copy(o.geometry.boundingBox);
  if (o.userData.glb) { o.updateMatrix(); _box.applyMatrix4(o.matrix); }
  return _box;
}
// highest surface of a baked group (root-space triangles) above each sample point (x,z pairs); -1e9 = no hit
function topsAt(grp, pts) {
  const n = pts.length >> 1, out = new Float32Array(n).fill(-1e9);
  grp.traverse(o => {
    if (!o.isMesh || !o.geometry || !o.geometry.attributes.position) return;
    const pa = rootPos(o), ix = o.geometry.index, cnt = ix ? ix.count : o.geometry.attributes.position.count;
    for (let t = 0; t + 2 < cnt; t += 3) {
      const a = ix ? ix.getX(t) : t, b = ix ? ix.getX(t + 1) : t + 1, c = ix ? ix.getX(t + 2) : t + 2;
      const x0 = pa.getX(a), z0 = pa.getZ(a), x1 = pa.getX(b), z1 = pa.getZ(b), x2 = pa.getX(c), z2 = pa.getZ(c);
      const d = (z1 - z2) * (x0 - x2) + (x2 - x1) * (z0 - z2); if (Math.abs(d) < 1e-7) continue;
      const mnx = Math.min(x0, x1, x2), mxx = Math.max(x0, x1, x2), mnz = Math.min(z0, z1, z2), mxz = Math.max(z0, z1, z2);
      for (let k = 0; k < n; k++) {
        const px = pts[k * 2], pz = pts[k * 2 + 1]; if (px < mnx || px > mxx || pz < mnz || pz > mxz) continue;
        const l0 = ((z1 - z2) * (px - x2) + (x2 - x1) * (pz - z2)) / d, l1 = ((z2 - z0) * (px - x2) + (x0 - x2) * (pz - z2)) / d, l2 = 1 - l0 - l1;
        if (l0 < -1e-4 || l1 < -1e-4 || l2 < -1e-4) continue;
        const y = l0 * pa.getY(a) + l1 * pa.getY(b) + l2 * pa.getY(c); if (y > out[k]) out[k] = y;
      }
    }
  });
  return out;
}
const pct = (arr, q) => { if (!arr.length) return null; const s = arr.slice().sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.max(0, Math.round((s.length - 1) * q)))]; };
// eave + ridge height of the main roof: the body height that covers most of the footprint (not a tower or
// chimney top), and the roof surface above it
const _roofMemo = new Map();   // the same generated model in the same place -> the same eave / ridge (no 10k-triangle scan per site)
function mainRoof(U, hs, bTop, rMax) {
  let key = null;
  {
    const parts = []; let all = true;
    for (const g of [U.body, U.roof]) g.traverse(o => { if (!o.isMesh) return; if (!o.userData.glb) { all = false; return; } o.updateMatrix(); parts.push(o.geometry.uuid + ':' + o.matrix.elements.join(',')); });
    if (all && parts.length) { key = parts.join('|') + '|' + hs + '|' + bTop + '|' + rMax; const hit = _roofMemo.get(key); if (hit) return hit; }
  }
  const r = mainRoofScan(U, hs, bTop, rMax);
  if (key) { if (_roofMemo.size > 500) _roofMemo.clear(); _roofMemo.set(key, r); }
  return r;
}
function mainRoofScan(U, hs, bTop, rMax) {
  try {
    const pts = []; const N = 9;
    for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) pts.push(-hs + (i + .5) * hs * 2 / N, -hs + (j + .5) * hs * 2 / N);
    const bt = topsAt(U.body, pts), rt = topsAt(U.roof, pts), bh = [], rhs = [];
    for (let k = 0; k < bt.length; k++) { if (bt[k] > .1) bh.push(bt[k]); }
    let base = pct(bh, .5); if (base == null || base > bTop) base = bTop;
    for (let k = 0; k < rt.length; k++) if (rt[k] > base - .05) rhs.push(rt[k]);
    let top = pct(rhs, .7); if (top == null) top = Math.min(rMax, base + .6);
    return { base, top: Math.max(top, base + .25) };
  } catch (err) { return { base: bTop, top: rMax }; }
}

function buildRig(v, e, color) {
  const root = v.root, U = root.userData, s = v.bs || e.size || 1, hs = s * .46, era = Math.max(0, Math.min(4, v.age | 0)), E = ERA[era];
  const rig = { root, g: new THREE.Group(), pieces: [], clones: [], details: [], planeB: new THREE.Plane(_up.clone(), 1e4), planeR: new THREE.Plane(_up.clone(), 1e4),
    s, hs, era, course: -1, prevCut: 0, cut: 0, landT: 9, chipT: 0, lastP: -1, doneT: -1, banner: null, cloth: null, jib: null };
  root.add(rig.g);
  // measure the real model (baked meshes are in root space)
  let bTop = 0, rMin = 1e9, rMax = -1e9;
  U.body.traverse(o => { if (o.isMesh) bTop = Math.max(bTop, rootBox(o).max.y); });
  U.roof.traverse(o => { if (o.isMesh) { rootBox(o); rMin = Math.min(rMin, _box.min.y); rMax = Math.max(rMax, _box.max.y); } });
  if (bTop < .3) bTop = .8;
  if (rMax < rMin) { rMin = bTop; rMax = bTop + .01; }
  rig.bTop = bTop; rig.rMin = rMin; rig.rMax = rMax;
  rig.nC = Math.max(3, Math.min(12, Math.round(bTop / .22)));
  // clone materials with clipping planes; owner-colour / glowing meshes are details that pop in later
  const ch = color == null ? -1 : (color & 0xffffff);
  for (let k = 0; k < 2; k++) {
    const grp = k ? U.roof : U.body, pl = k ? rig.planeR : rig.planeB;
    grp.traverse(o => {
      if (!o.isMesh) return;
      const m0 = o.material, cl = m0.clone(); cl.clippingPlanes = [pl]; cl.clipShadows = true;
      // cap the cut: back faces seen through the open top are lit as an upward-facing surface (no black hole)
      if (cl.isMeshStandardMaterial || cl.isMeshLambertMaterial || cl.isMeshPhongMaterial) {
        const ob = m0.onBeforeCompile; cl.side = THREE.DoubleSide;
        cl.onBeforeCompile = (sh, r) => { if (ob && ob !== THREE.Material.prototype.onBeforeCompile) ob.call(cl, sh, r);
          sh.fragmentShader = sh.fragmentShader
            .replace('#include <normal_fragment_maps>', '#include <normal_fragment_maps>\nif (!gl_FrontFacing) normal = normalize((viewMatrix * vec4(0.0, 1.0, 0.0, 0.0)).xyz);')
            .replace('#include <color_fragment>', '#include <color_fragment>\nif (!gl_FrontFacing) diffuseColor.rgb *= 0.8;')
            .replace('#include <emissivemap_fragment>', '#include <emissivemap_fragment>\nif (!gl_FrontFacing) totalEmissiveRadiance += diffuseColor.rgb * 0.45;'); };
        cl.customProgramCacheKey = () => 'conscap' + (m0.customProgramCacheKey ? m0.customProgramCacheKey() : '');
      }
      o.material = cl; rig.clones.push(o, m0, cl);
      if (!k && ((m0.emissive && m0.emissive.getHex() !== 0) || (m0.color && m0.color.getHex() === ch))) rig.details.push(o);
    });
  }
  U.scaf.visible = false;
  // site frame: everything below is built in a local frame F (half extents ht along x, hf along z).
  // Normal buildings: F = root, ht = hf = hs. Dock: F covers only the land half (local +z points away from the
  // water), so no plot, scaffold or rafters stand over the pier / water.
  const F = new THREE.Group(); rig.g.add(F);
  let ht = hs, hf = hs; rig.dock = false;
  if (e.type === 'dock') {
    let d = 2; const mk = (v.mask | 0) & 15; for (let i = 0; i < 4; i++) if (mk === 1 << i) d = i;
    const W = [[0, -1], [1, 0], [0, 1], [-1, 0]][d], YAW = [PI, PI / 2, 0, -PI / 2];
    hf = hs * .5; F.position.set(-W[0] * hs * .5, 0, -W[1] * hs * .5); F.rotation.y = YAW[(d + 2) % 4];
    rig.dock = true;
  }
  rig.F = F; rig.ht = ht; rig.hf = hf;
  const G = F, sx2 = ht * 2 / .92, sz2 = hf * 2 / .92; // footprint widths in the frame (s for a normal site)
  // ---- stage 1: plot ----
  add(rig, G, GEO.box, M.soil, sx2 * .98, .025, sz2 * .98, 0, .005, 0, 0, { hide: 1.01 });
  for (let i = 0; i < 4; i++) {
    const cx = (i & 1 ? 1 : -1) * (ht + .04), cz = (i & 2 ? 1 : -1) * (hf + .04);
    add(rig, G, GEO.cyl, M.peg, .04, .32, .04, cx, 0, cz, i * .005, { hide: .4 });
  }
  add(rig, G, GEO.cbox, M.string, sx2 * .94, .012, .012, 0, .26, hf + .04, .025, { hide: .4 });
  add(rig, G, GEO.cbox, M.string, .012, .012, sz2 * .94, ht + .04, .26, 0, .03, { hide: .4 });
  add(rig, G, GEO.cbox, M.string, sx2 * .94, .012, .012, 0, .26, -hf - .04, .035, { hide: .4 });
  add(rig, G, GEO.cbox, M.string, .012, .012, sz2 * .94, -ht - .04, .26, 0, .04, { hide: .4 });
  const perX = Math.max(2, Math.round(sx2 * 1.6)), perZ = Math.max(2, Math.round(sz2 * 1.6)), segX = sx2 * .9 / perX, segZ = sz2 * .9 / perZ, nF = (perX + perZ) * 2;
  const fm = E.found === 'log' ? M.log : E.found === 'mudbrick' ? M.mudbrick : E.found === 'concrete' ? M.concrete : M.stone;
  for (let i = 0, side = 0, j = 0; i < nF; i++, j++) {
    const per = side & 1 ? perZ : perX; if (j >= per) { side++; j = 0; }
    const along = side === 0 || side === 2, seg = along ? segX : segZ, t = (along ? -sx2 : -sz2) * .45 + seg * (j + .5), th = .045 + (i / nF) * .1;
    const x = side === 0 ? t : side === 1 ? ht - .06 : side === 2 ? -t : -ht + .06;
    const z = side === 0 ? hf - .06 : side === 1 ? -t : side === 2 ? -hf + .06 : t;
    if (E.found === 'log') add(rig, G, GEO.ccyl, fm, seg * .96, .12, .12, x, .06, z, th, { hide: .5 }).o.rotation.y = along ? 0 : PI / 2;
    else add(rig, G, GEO.box, fm, along ? seg * .94 : .2, .12, along ? .2 : seg * .94, x, 0, z, th, { hide: .5 });
  }
  // ---- stage 2: scaffold + piles ----
  const H = Math.max(1.2, bTop + .45), P = E.pole, pr = s >= 3 ? .05 : .04;
  const poles = [];
  for (let i = 0; i < 4; i++) poles.push([(i & 1 ? 1 : -1) * (ht + .14), (i & 2 ? 1 : -1) * (hf + .14)]);
  if (s >= 3) { if (sx2 >= 2.5) poles.push([0, hf + .14], [0, -hf - .14]); if (sz2 >= 2.5) poles.push([ht + .14, 0], [-ht - .14, 0]); }
  let nS = 0; const scafPieces = [];
  for (let i = 0; i < poles.length; i++) scafPieces.push(add(rig, G, GEO.cyl, P, pr, H, pr, poles[i][0], 0, poles[i][1], .15 + i * .01, { shadow: true }));
  const lv = H > 1.6 ? [.55, 1.1, H - .1] : [.6, H - .1];
  for (let k = 0; k < lv.length; k++) for (let sd = 0; sd < 4; sd++) {
    const zx = sd < 2, sg = sd & 1 ? 1 : -1, th = .2 + k * .04 + sd * .006;
    scafPieces.push(add(rig, G, GEO.cbox, P, zx ? sx2 + .3 : .035, .035, zx ? .035 : sz2 + .3, zx ? 0 : sg * (ht + .14), lv[k], zx ? sg * (hf + .14) : 0, th, { shadow: true }));
  }
  // cross braces (one diagonal per side)
  const top = lv[lv.length - 1] - .1;
  for (let sd = 0; sd < 4; sd++) {
    const zx = sd < 2, sg = sd & 1 ? 1 : -1, w = (zx ? sx2 : sz2) + .28, L = Math.sqrt(w * w + top * top), da = Math.atan2(top, w);
    const pc = add(rig, G, GEO.cbox, P, zx ? L : .03, .03, zx ? .03 : L, zx ? 0 : sg * (ht + .16), (lv[lv.length - 1] + .1) * .5, zx ? sg * (hf + .16) : 0, .27 + sd * .01, { shadow: true });
    if (zx) pc.o.rotation.z = da * sg; else pc.o.rotation.x = -da * sg;
    scafPieces.push(pc);
  }
  // ladder leaning on the front
  const lad = new THREE.Group(); lad.position.set(ht * .4, 0, hf + .5); lad.rotation.x = -.32; lad.visible = false; G.add(lad);
  const lm = (sx, sy, sz, x, y) => { const o = new THREE.Mesh(GEO.box, P, undefined); o.scale.set(sx, sy, sz); o.position.set(x, y, 0); lad.add(o); };
  lm(.03, H * .95, .03, -.13, 0); lm(.03, H * .95, .03, .13, 0);
  for (let r = 0; r < 5; r++) lm(.26, .025, .025, 0, .18 + r * H * .17);
  scafPieces.push({ o: lad, th: .3, hide: null, fall: null, shrink: false, sx: 1, sy: 1, sz: 1, x: lad.position.x, y: 0, z: lad.position.z, rx: -.32, rz: 0, a: -1, f: null, dir: 1 });
  rig.pieces.push(scafPieces[scafPieces.length - 1]);
  nS = scafPieces.length;
  for (let i = 0; i < nS; i++) { const pc = scafPieces[i]; pc.fall = .952 + (i / nS) * .044; pc.rx = pc.o.rotation.x; pc.rz = pc.o.rotation.z; pc.dir = (i * 7) % 2 ? 1 : -1; }
  rig.scaf = scafPieces;
  // material piles beside the site
  const pA = addGroup(rig, G, ht + .5, -hf * .35, .18, { hide: .965, shrink: true });
  const pB = addGroup(rig, G, -ht * .35, hf + .55, .24, { hide: .965, shrink: true });
  const na = E.a === 'brick' ? 6 : 6;
  for (let i = 0; i < na; i++) item(pA, E.a, i);
  if (E.a === 'brick') { const pA2 = new THREE.Group(); pA2.position.set(0, 0, .16); pA.add(pA2); for (let i = 0; i < 6; i++) item(pA2, 'brick', i); }
  for (let i = 0; i < 5; i++) item(pB, E.b, i);
  if (E.b === 'plaster' || E.b === 'hide') pB.rotation.y = .4;
  // age 4: small crane on big sites
  if (era >= 4 && s >= 3 && !rig.dock) { // the dock model has its own crane
    const cg = new THREE.Group(); cg.position.set(-hs - .45, 0, -hs - .45); cg.visible = false; G.add(cg);
    const CH = bTop + 1.6;
    const mast = new THREE.Mesh(GEO.box, M.iron); mast.scale.set(.12, CH, .12); mast.castShadow = true; cg.add(mast);
    const jib = new THREE.Group(); jib.position.y = CH; cg.add(jib);
    const arm = new THREE.Mesh(GEO.cbox, M.iron); arm.scale.set(.07, .08, s * .95); arm.position.set(0, 0, s * .35); arm.castShadow = true; jib.add(arm);
    const cw = new THREE.Mesh(GEO.cbox, M.concrete); cw.scale.set(.2, .16, .22); cw.position.set(0, -.04, -.32); jib.add(cw);
    const cab = new THREE.Mesh(GEO.box, M.rope); cab.scale.set(.012, 1, .012); cab.position.set(0, -1.05, s * .62); jib.add(cab);
    const hook = new THREE.Mesh(GEO.cbox, M.iron); hook.scale.set(.08, .08, .08); hook.position.set(0, -1.08, s * .62); jib.add(hook);
    jib.rotation.y = PI * .25; rig.jib = jib;
    rig.pieces.push({ o: cg, th: .2, hide: .975, fall: null, shrink: false, sx: 1, sy: 1, sz: 1, x: cg.position.x, y: 0, z: cg.position.z, rx: 0, rz: 0, a: -1, f: null, dir: 1 });
  }
  // ---- stage 4: roof skeleton ----
  // anchored to the MAIN roof: towers / chimneys / turrets make bTop taller than the eaves of the main hall
  const mr = mainRoof(U, hs, bTop, rMax), rb = mr.base;
  const rh = Math.max(.25, Math.min(1.2, mr.top - rb)), n = Math.max(2, Math.round(sx2 * 1.3)), L = Math.sqrt(hf * hf + rh * rh), an = Math.atan2(rh, hf);
  rig.rBase = rb;
  const rm = era >= 4 ? M.iron : M.timber;
  for (let i = 0; i < n; i++) {
    const x = -ht * .85 + (ht * 1.7) * (n > 1 ? i / (n - 1) : .5), th = .75 + (i / n) * .06;
    add(rig, G, GEO.cbox, rm, .05, .05, L, x, rb + rh * .5, hf * .5, th, { hide: .95 }).o.rotation.x = an;
    add(rig, G, GEO.cbox, rm, .05, .05, L, x, rb + rh * .5, -hf * .5, th + .004, { hide: .95 }).o.rotation.x = -an;
  }
  add(rig, G, GEO.cbox, rm, sx2 * .9, .06, .06, 0, rb + rh, 0, .745, { hide: .95 });
  add(rig, G, GEO.box, rm, sx2 * .92, .05, .05, 0, rb, hf, .74, { hide: .95 });
  add(rig, G, GEO.box, rm, sx2 * .92, .05, .05, 0, rb, -hf, .74, { hide: .95 });
  // ---- stage 5: banner pole in owner colour ----
  const bp = new THREE.Group(); bp.position.set(ht + .3, 0, hf + .3); bp.visible = false; G.add(bp);
  const BH = Math.max(1.4, bTop * .6 + .9);
  const pole = new THREE.Mesh(GEO.cyl, M.peg); pole.scale.set(.035, BH, .035); pole.castShadow = true; bp.add(pole);
  const cloth = new THREE.Mesh(GEO.cbox, m(color == null ? 0xcccccc : color, .8)); cloth.scale.set(.32, .2, .02); cloth.position.set(.17, .3, 0); bp.add(cloth);
  rig.banner = bp; rig.cloth = cloth; rig.BH = BH;
  return rig;
}

function popScale(a) { return a < .22 ? (a / .22) * 1.15 : a < .4 ? 1.15 - (a - .22) / .18 * .15 : 1; }

/** restore the finished model and free the rig */
export function disposeConstruction(v) {
  const rig = v && v.cons; if (!rig) return;
  const c = rig.clones;
  for (let i = 0; i < c.length; i += 3) { if (c[i].material === c[i + 2]) c[i].material = c[i + 1]; c[i + 2].dispose(); }
  for (const o of rig.details) o.visible = true;
  if (rig.root) { rig.root.remove(rig.g); if (rig.root === v.root) { const U = v.root.userData; U.body.visible = true; U.roof.visible = true; U.body.scale.y = 1; U.roof.scale.y = 1; v.root.scale.setScalar(v.k || 1); } }
  // rig meshes share cached geometries/materials except the per-site cloth colour (cached too): nothing else to free
  v.cons = null; v.prog = -1;
}

/**
 * Drive the construction rig of building view v. Returns true when it handled the body/roof/scaffold
 * this frame (the caller then skips its simple rising-block code).
 * ctx: { fx, color, time }
 */
export function updateConstruction(v, e, p, dt, y, vis, ctx) {
  if (SKIP[e.type]) return false;
  let rig = v.cons;
  if (rig && rig.root !== v.root) { disposeConstruction(v); rig = null; }
  if (!rig) {
    if (p >= 1 || e.done) return false;
    rig = v.cons = buildRig(v, e, ctx.color);
  }
  // (rig sizes - s, bTop, rMax, the frame offsets - are model units under v.root, which is scaled by v.k; particles
  //  and the clipping planes live in world space, so their offsets are scaled by vk)
  const U = v.root.userData, fx = vis ? ctx.fx : null, s = rig.s, hs = rig.hs, vk = v.k || 1;
  const done = !!e.done || p >= 1;
  if (done && rig.doneT < 0) {
    rig.doneT = 0;
    for (let i = 0; i < rig.scaf.length; i++) { const pc = rig.scaf[i]; if (pc.f == null) pc.f = -i * .025; }
    if (fx && fx.burst) { try { fx.burst('sparkle', e.x, y + rig.bTop * .7 * vk, e.z); fx.burst('build', e.x, y + .4 * vk, e.z); } catch (err) { /* fx optional */ } }
  }
  if (rig.doneT >= 0) {
    rig.doneT += dt;
    const k = rig.doneT;
    // settle bounce
    const b = k < .5 ? Math.sin(k / .5 * PI * 2) * .045 * (1 - k / .5) : 0;
    v.root.scale.set(vk * (1 - b * .5), vk * (1 + b), vk * (1 - b * .5));
    if (k > 1.3) { disposeConstruction(v); return false; }
  }
  const pe = done ? 1 : p;
  // ---- walls: rise in courses ----
  let cut;
  if (pe < .35) cut = 0;
  else if (pe < .75) {
    const f = (pe - .35) / .4, c = Math.min(rig.nC, Math.ceil(f * rig.nC - 1e-6));
    if (c !== rig.course) {
      const was = rig.course; rig.course = c; rig.prevCut = rig.cut; rig.landT = 0;
      if (was >= 0 && fx && fx.courseDust) { try { const sw = s * vk; fx.courseDust(e.x, y + c / rig.nC * rig.bTop * vk, e.z, sw * .9, sw * .9, 8 + (sw * 2 | 0)); /* (rig.s: model units; the dust: world units) */ } catch (err) { /* */ } }
    }
    cut = c / rig.nC * rig.bTop;
  } else cut = rig.bTop + 50;
  rig.landT += dt;
  let disp = cut;
  if (cut < 40 && rig.landT < .6) { const t = rig.landT; disp = cut - (cut - rig.prevCut) * Math.exp(-t * 11) * Math.cos(t * 17); }
  rig.cut = cut;
  rig.planeB.constant = y + disp * vk;
  U.body.visible = pe >= .35; U.body.scale.y = 1;
  // details (owner colour, windows, glow) pop in during stage 4
  const nd = rig.details.length;
  for (let i = 0; i < nd; i++) { const on = pe >= Math.min(.93, .78 + i * .035); if (rig.details[i].visible !== on) { rig.details[i].visible = on; if (on && fx && fx.burst && rig.doneT < 0) { try { fx.burst('sdust', e.x, y + rig.bTop * .5 * vk, e.z); } catch (err) { /* */ } } } }
  // roof covering
  const rf = Math.max(0, Math.min(1, (pe - .82) / .13));
  U.roof.visible = pe >= .82; U.roof.scale.y = 1; U.roof.position.y = 0;
  rig.planeR.constant = rf >= 1 ? y + 1e4 : y + (rig.rMin + (rig.rMax - rig.rMin) * rf) * vk;
  if (U.spin) U.spin.visible = done;
  U.scaf.visible = false;
  // ---- rig pieces ----
  const shrink = 1 - .8 * Math.max(0, Math.min(1, (pe - .35) / .6));
  const P = rig.pieces;
  for (let i = 0; i < P.length; i++) {
    const pc = P[i], o = pc.o;
    if (pc.f == null && pc.fall != null && pe >= pc.fall) pc.f = 0;
    if (pc.f != null) {
      pc.f += dt;
      if (pc.f <= 0) continue;
      const f = pc.f;
      if (f >= 1) { if (o.visible) o.visible = false; continue; }
      const ang = Math.min(PI * .5, f * f * 5) * pc.dir, sc = f > .5 ? Math.max(.01, 1 - (f - .5) * 2) : 1;
      o.rotation.x = pc.rx + ang * .6; o.rotation.z = pc.rz + ang;
      o.position.y = Math.max(0, pc.y - 2.5 * f * f);
      o.scale.set(pc.sx * sc, pc.sy * sc, pc.sz * sc);
      continue;
    }
    const on = pe >= pc.th && (pc.hide == null || pe < pc.hide);
    if (!on) { if (o.visible) { o.visible = false; pc.a = -1; } continue; }
    if (!o.visible) { o.visible = true; pc.a = 0; }
    let k = 1;
    if (pc.a >= 0 && pc.a < .45) { pc.a += dt; k = popScale(pc.a); }
    if (pc.shrink) { const q = k * shrink; o.scale.set(q, q, q); }
    else if (k !== 1 || pc.a >= 0) { o.scale.set(pc.sx * k, pc.sy * k, pc.sz * k); if (pc.a >= .45) pc.a = -1; }
  }
  if (rig.jib) rig.jib.rotation.y += dt * .25;
  // banner hoist
  const bh = Math.max(0, Math.min(1, (pe - .95) / .05 * .6 + Math.max(0, rig.doneT) / .6));
  rig.banner.visible = pe >= .95;
  if (rig.banner.visible) { rig.cloth.position.y = .25 + (rig.BH - .38) * bh; rig.cloth.scale.x = .32 * (1 + Math.sin((ctx.time || 0) * 6 + e.id) * .06); }
  // ---- hammering bursts on the current top course ----
  if (!done && p > rig.lastP && rig.lastP >= 0 && fx && fx.burst) {
    rig.chipT -= dt;
    if (rig.chipT <= 0) {
      rig.chipT = .22 + Math.random() * .3;
      const top = pe < .35 ? .12 : pe < .75 ? Math.max(.1, cut) : rig.bTop + (rig.rMax - rig.bTop) * rf * .8;
      const t = Math.random() * 4, sv = (t % 1) * 2 - 1, sd = t | 0;
      const ht = rig.ht, hf = rig.hf, F = rig.F;
      const lx = sd === 0 ? sv * ht : sd === 1 ? ht : sd === 2 ? -sv * ht : -ht;
      const lz = sd === 0 ? hf : sd === 1 ? sv * hf : sd === 2 ? -hf : -sv * hf;
      const cr = Math.cos(F.rotation.y), sr = Math.sin(F.rotation.y);
      const px = F.position.x + lx * cr + lz * sr, pz = F.position.z - lx * sr + lz * cr;
      const era = rig.era;
      const kind = era <= 1 ? 'chips' : era === 2 ? (Math.random() < .5 ? 'sdust' : 'chips') : era === 3 ? 'sdust' : (Math.random() < .5 ? 'bspark' : 'sdust');
      try { fx.burst(kind, e.x + px * vk, y + top * vk, e.z + pz * vk); } catch (err) { /* fx optional */ }
    }
  }
  rig.lastP = p;
  v.prog = p;
  return true;
}

/** small repair scaffold on one side of a damaged finished building while it is being repaired */
export function updateRepair(v, e, dt) {
  const hp = e.hp || 0;
  if (v.lastHp != null && e.done && hp > v.lastHp && hp < e.maxHp) v.repT = 1.2;
  v.lastHp = hp;
  if (v.repT > 0) v.repT -= dt;
  const on = v.repT > 0 && !!e.done;
  let r = v.repRig;
  if (r && r.parent !== v.root) { if (r.parent) r.parent.remove(r); r = v.repRig = null; }
  if (!on) { if (r) r.visible = false; return; }
  if (!r) {
    const s = v.bs || e.size || 1, hs = s * .46, H = Math.max(1, (v.h || 1) / (v.k || 1) * .8);
    r = v.repRig = new THREE.Group();
    const w = Math.min(1.6, s * .6);
    for (let i = 0; i < 2; i++) { const o = new THREE.Mesh(GEO.cyl, M.timber); o.scale.set(.04, H, .04); o.position.set((i ? 1 : -1) * w * .5, 0, hs + .16); o.castShadow = true; r.add(o); }
    for (let k = 0; k < 2; k++) { const o = new THREE.Mesh(GEO.cbox, M.timber); o.scale.set(w + .1, .035, .035); o.position.set(0, H * (.45 + k * .45), hs + .16); r.add(o); }
    const pl = new THREE.Mesh(GEO.cbox, M.timber); pl.scale.set(w, .03, .2); pl.position.set(0, H * .45, hs + .1); r.add(pl);
    r.position.x = s * .12; v.root.add(r);
  }
  r.visible = true;
}

export const CONSTRUCTION_SKIP = SKIP;
