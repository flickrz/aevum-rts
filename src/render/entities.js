// Aevum - entity rendering: procedural buildings, units, resources, projectiles, selection.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { BUILDINGS } from '../data.js';
import { updateConstruction, disposeConstruction, updateRepair } from './construction.js';
import { SEA_BUILD, SEA_UNITS, makeSeaUnit, seaAnimUnit, seaAnimBuilding, makeFish, seaAnimFish, seaMask, pastureSheepK, dockY, SEA_K } from './models-sea.js';
import { StaticBatches } from './static-batch.js';
import { loadGlbModels, loadEra, glbVersion, hasGlb, glbPlanned, eraSettled, addGlbBuilding, addGlbPiece, loadCrop, cropGeo, loadSea, hasSea, dockFile, addSeaModel } from './glb-models.js';

const PI = Math.PI;

// ---------- shared geometries (base at y=0 unless noted) ----------
function prismGeo() {
  const p = [
    -.5, 0, .5, .5, 0, .5, 0, 1, .5,
    .5, 0, -.5, -.5, 0, -.5, 0, 1, -.5,
    -.5, 0, -.5, -.5, 0, .5, 0, 1, .5,
    -.5, 0, -.5, 0, 1, .5, 0, 1, -.5,
    .5, 0, .5, .5, 0, -.5, 0, 1, -.5,
    .5, 0, .5, 0, 1, -.5, 0, 1, .5,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(p, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(p.length / 3 * 2), 2));
  g.computeVertexNormals();
  return g;
}
const G = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, .5, 0),
  cbox: new THREE.BoxGeometry(1, 1, 1),
  cyl: new THREE.CylinderGeometry(.5, .5, 1, 10).translate(0, .5, 0),
  cone: new THREE.ConeGeometry(.5, 1, 10).translate(0, .5, 0),
  pyr: new THREE.ConeGeometry(.7071, 1, 4).rotateY(PI / 4).translate(0, .5, 0),
  sph: new THREE.SphereGeometry(.5, 10, 8),
  dome: new THREE.SphereGeometry(.5, 12, 6, 0, PI * 2, 0, PI / 2),
  rock: new THREE.DodecahedronGeometry(.5, 0),
  prism: prismGeo(),
  bow: new THREE.TorusGeometry(.22, .012, 4, 8, PI).rotateY(PI / 2).rotateX(PI),
  ring: new THREE.RingGeometry(.42, .5, 24).rotateX(-PI / 2),
  sq: new THREE.RingGeometry(.66, .7071, 4, 1).rotateZ(PI / 4).rotateX(-PI / 2),
  wheel: new THREE.CylinderGeometry(.5, .5, 1, 12).rotateZ(PI / 2),
  robe: new THREE.CylinderGeometry(.3, .5, 1, 10).translate(0, .5, 0),   // a long skirt: narrow at the waist, wide at the hem
};

// ---------- material cache ----------
const MC = new Map();
function mat(hex, rough = .85, metal = 0, emissive = 0) {
  const k = hex + '|' + rough + '|' + metal + '|' + emissive;
  let m = MC.get(k);
  if (!m) {
    m = new THREE.MeshStandardMaterial({ color: hex, roughness: rough, metalness: metal });
    if (emissive) { m.emissive.setHex(emissive); m.emissiveIntensity = 1; }
    MC.set(k, m);
  }
  return m;
}
const DARK = new Map();
function darkOf(m) {
  let d = DARK.get(m);
  if (!d) { d = m.clone(); d.color.multiplyScalar(.42); DARK.set(m, d); }
  return d;
}
const MT = {
  wood: mat(0x8a6238, .85), dwood: mat(0x4f3620, .9), lwood: mat(0xb08a55, .8),
  stone: mat(0x9a968c, .95), dstone: mat(0x6e6b66, .95), thatch: mat(0xc9a84e, 1),
  plaster: mat(0xe6dcc3, .9), brick: mat(0x9a4c3a, .88), tile: mat(0xb5452e, .7),
  steel: mat(0xb4bac2, .35, .85), iron: mat(0x3a3d42, .45, .8), bronze: mat(0xb8873a, .4, .8),
  gold: mat(0xffc62e, .25, 1), skin: mat(0xe0b08a, .8), soil: mat(0x4a3423, 1), soil2: mat(0x5c4230, 1),
  glass: mat(0x2a3440, .3, .2, 0x332200), glow: mat(0xff7a22, .6, 0, 0xff5a10), hay: mat(0xd9bf62, 1),
  green: mat(0x3f7a2c, .95), dgreen: mat(0x2f5f24, .95), berry: mat(0xc9203a, .5), white: mat(0xf2efe6, .8),
  red: mat(0xc0392b, .8), leather: mat(0x6b4a2e, .9), black: mat(0x1c1c1e, .6, .3), deer: mat(0xa5713f, .9),
  sprout: mat(0x58b03a, .9), wheat: mat(0xe0b93a, .85), stubble: mat(0xa88f55, 1), seed: mat(0xcbb58a, 1),
  canvas: mat(0xd9cfb4, .95),
};
const PAL = [
  // 0 Tas Devri: hide, branches, thatch
  { wall: mat(0x7d5c3a, 1), wall2: mat(0xb0906a, 1), roof: MT.thatch, trim: MT.dwood, base: mat(0x5f574a, 1) },
  // 1 Tunc Devri: mud-brick, reed, timber
  { wall: mat(0xc79a68, .95), wall2: mat(0xe2d2aa, .92), roof: mat(0xb59550, 1), trim: mat(0x6b4a2e, .85), base: mat(0x93795a, .98) },
  // 2 Orta Cag: stone, half-timber, slate
  { wall: MT.stone, wall2: mat(0xd8cdb0, .9), roof: mat(0x47505c, .7, .1), trim: MT.dwood, base: MT.dstone },
  // 3 Barut Cagi: plaster, brick, clay tile
  { wall: MT.plaster, wall2: MT.brick, roof: MT.tile, trim: mat(0x5a4030, .85), base: MT.stone },
  // 4 Sanayi Cagi: red brick, iron, metal roofs
  { wall: mat(0xb65a40, .85), wall2: mat(0xa3a19c, .9), roof: mat(0x8d98a2, .55, .3), trim: mat(0x50545a, .5, .6), base: mat(0x8e8a82, .95) },
];
const XM = {
  bone: mat(0xe8e0cc, .8), hide: mat(0x9a7a52, .97), fur: mat(0x6f5236, 1), copper: mat(0x5fa58c, .6, .4),
  sky: mat(0x9fd0e8, .15, .35, 0x1a3040), water: mat(0x3f6f9f, .3), linen: mat(0xd9cfb4, .95), mail: mat(0x8a9098, .55, .6),
  hose: mat(0x4a4038, .9), capg: mat(0x57524a, .9), hair: mat(0x4a3220, .95),
  // healer (Büyücü): staff orb, her hair, embroidery, the dark robe of the last age
  orb: mat(0x9af7d6, .35, 0, 0x2fd8a4), hairF: mat(0x6a3a22, .95), emb: mat(0xd9c27a, .7, .2), robe4: mat(0x2b2e38, .85),
};
// buildings: a thin outline laid exactly on the footprint (one geometry per size, line width fixed in world units)
const SQG = new Map(), SQ_W = .09;
function sqGeo(size) {
  let g = SQG.get(size); if (g) return g;
  const h = size / 2 + .04;   // (just outside the pad so the line is not hidden under the walls)
  g = new THREE.RingGeometry((h - SQ_W) * Math.SQRT2, h * Math.SQRT2, 4, 1).rotateZ(PI / 4).rotateX(-PI / 2);
  SQG.set(size, g); return g;
}
const SELM = [
  new THREE.MeshBasicMaterial({ color: 0x5cff6a, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }),
  new THREE.MeshBasicMaterial({ color: 0xff5050, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }),
  new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }),
  // [3] ally (same team, not controllable)
  new THREE.MeshBasicMaterial({ color: 0x4aa8ff, transparent: true, opacity: .95, depthWrite: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -4, polygonOffsetUnits: -4, fog: false }),
];
// (owner 2026-11-23: the thin square "sırıtıyor") a selected building gets a soft glow pad instead: a rounded square
// of light under it, brightest along the edge, fading inward and out. One texture (alpha only), tinted per material.
let _glowTex = null;
function glowTex() {
  if (_glowTex) return _glowTex;
  const S = 128, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const u = Math.abs(x / (S - 1) * 2 - 1), v = Math.abs(y / (S - 1) * 2 - 1);
    const r = Math.pow(Math.pow(u, 6) + Math.pow(v, 6), 1 / 6);   // rounded square, 1 at the edge
    const edge = Math.exp(-Math.pow((r - .88) / .05, 2));            // the bright band
    const fill = 0;                                    // a gentle wash inside
    const out = r >= .86 ? Math.max(0, 1 - (r - .86) / .14) : 1;      // fades to nothing at the border
    const a = Math.min(1, Math.max(fill, edge)) * out;
    const k = (y * S + x) * 4; d[k] = d[k + 1] = d[k + 2] = 255; d[k + 3] = a * 255;
  }
  g.putImageData(img, 0, 0);
  _glowTex = new THREE.CanvasTexture(c);
  return _glowTex;
}
const SELB = SELM.map(m => { const c = m.clone(); c.opacity = .6; c.map = glowTex(); return c; });
const GLOW_G = new THREE.PlaneGeometry(1, 1).rotateX(-PI / 2);
const PROXY_M = new THREE.MeshBasicMaterial({ visible: false });
const HPM = {
  bg: new THREE.SpriteMaterial({ color: 0x151515, depthTest: false }),
  g: new THREE.SpriteMaterial({ color: 0x4be05a, depthTest: false }),
  y: new THREE.SpriteMaterial({ color: 0xf0c330, depthTest: false }),
  r: new THREE.SpriteMaterial({ color: 0xe8402e, depthTest: false }),
};
// placement ghosts: lit + tinted so the shape reads, with a bright fresnel rim
function ghostMat(hex, emi) {
  const m = new THREE.MeshStandardMaterial({ color: hex, emissive: emi, roughness: .8, metalness: 0, transparent: true, opacity: .55, depthWrite: false });
  m.onBeforeCompile = (sh) => {
    sh.fragmentShader = sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\n  { float fr = 1.0 - abs(dot(normalize(vViewPosition), normal)); totalEmissiveRadiance += diffuseColor.rgb * (pow(fr, 2.2) * 1.4); }');
  };
  m.customProgramCacheKey = () => 'ghostRim';
  return m;
}
const GHM = [ghostMat(0x7dff95, 0x0f4a1e), ghostMat(0xff6a5a, 0x4a1010)];
// big farm (sim FARM_CELLS ring order) and its crop colours (instance colours on one white material)
const FARM_CELLS_R = [[0, 0], [1, 0], [2, 0], [2, 1], [2, 2], [1, 2], [0, 2], [0, 1]];
const CROP_MAT = mat(0xffffff, .9);
const CROP_MAT_VC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: 0 });   // (the generated wheat clump: grey shading x stage colour)
const TUFT = new THREE.CylinderGeometry(.3, .5, 1, 6, 1).translate(0, .5, 0);   // a bunch of stalks, blunt top
const FROWS = 7, FPER = 14;
const PLOT_W = .95;   // a plot's share of its farm cell (the rest is the path round it)   // crop rows per plot, plants per row
const _cc = new THREE.Color(), _e = new THREE.Euler();
// tilled soil (owner 2026-11-17: the flat brown plots did not read as earth): a painted texture of dark furrows
// between raised rows (FROWS of them, along the ridges), crumbly clods and a few pebbles
function soilTex(rows, light) {
  const N = 256, cv = document.createElement('canvas'); cv.width = cv.height = N;
  const g = cv.getContext('2d'); let sd = light ? 7 : 3; const rnd = () => (sd = (sd * 16807) % 2147483647) / 2147483647;
  g.fillStyle = light ? '#7a5638' : '#6a4a30'; g.fillRect(0, 0, N, N);
  if (!light) for (let r = 0; r < rows; r++) {   // furrow troughs between the rows
    const x = (r + 1) * N / rows, gr = g.createLinearGradient(x - 12, 0, x + 12, 0);
    gr.addColorStop(0, 'rgba(40,24,14,0)'); gr.addColorStop(.5, 'rgba(40,24,14,.75)'); gr.addColorStop(1, 'rgba(40,24,14,0)');
    g.fillStyle = gr; g.fillRect(x - 12, 0, 24, N); g.fillRect(x - 12 - N, 0, 24, N);
  }
  for (let i = 0; i < 2600; i++) {   // clods: dark and light crumbs
    const x = rnd() * N, y = rnd() * N, r = .6 + rnd() * 2.2, d = rnd();
    g.fillStyle = d < .5 ? `rgba(45,28,16,${.25 + rnd() * .4})` : `rgba(150,112,76,${.15 + rnd() * .35})`;
    g.beginPath(); g.ellipse(x, y, r * 1.3, r, rnd() * 3, 0, 7); g.fill();
  }
  for (let i = 0; i < 40; i++) { g.fillStyle = `rgba(170,160,145,${.5 + rnd() * .4})`; g.beginPath(); g.ellipse(rnd() * N, rnd() * N, 1.2 + rnd() * 1.5, 1 + rnd(), rnd() * 3, 0, 7); g.fill(); }
  const t = new THREE.CanvasTexture(cv); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4; return t;
}
const soilMat = (light) => typeof document === 'undefined' ? mat(light ? 0x6e4f35 : 0x5a3f2a, 1)
  : new THREE.MeshStandardMaterial({ map: soilTex(FROWS, light), roughness: 1, metalness: 0 });
const FM = { path: mat(0x8a7a52, 1), yard: mat(0x7d6b47, 1), bank: mat(0x6f7a3c, 1), soil: soilMat(false), ridge: soilMat(true) };
const CROP_COL = { seed: new THREE.Color(0x9a8a5a), shoot: new THREE.Color(0x5fae3a), ripen: new THREE.Color(0xb9b84a), gold: new THREE.Color(0xe2b63e), stubble: new THREE.Color(0xa88f55) };

// ---------- mesh helpers ----------
function mk(geo, p, m, sx, sy, sz, x, y, z) {
  const o = new THREE.Mesh(geo, m);
  o.scale.set(sx, sy, sz); o.position.set(x, y, z);
  o.castShadow = true; o.receiveShadow = true;
  p.add(o); return o;
}
const bx = (p, m, w, h, d, x, y, z) => mk(G.box, p, m, w, h, d, x, y, z);
const cy = (p, m, r, h, x, y, z) => mk(G.cyl, p, m, r * 2, h, r * 2, x, y, z);
const cn = (p, m, r, h, x, y, z) => mk(G.cone, p, m, r * 2, h, r * 2, x, y, z);
const py = (p, m, w, h, d, x, y, z) => mk(G.pyr, p, m, w, h, d, x, y, z);
const sp = (p, m, r, x, y, z) => mk(G.sph, p, m, r * 2, r * 2, r * 2, x, y, z);
function piv(p, x, y, z) { const g = new THREE.Group(); g.position.set(x, y, z); p.add(g); return g; }

function bake(group) {
  const by = new Map(), kept = [];
  group.updateMatrixWorld(true);
  group.traverse(o => {
    if (!o.isMesh) return;
    // a generated model's mesh keeps its shared geometry (2026-11-18: copying ~10k triangles per building made each
    // placement a 7-20 ms hitch and kept the static batches from instancing it); it is re-added below with the same
    // world transform (that of the group's own scale too, e.g. a wall's height stretch)
    if (o.userData.glb) { kept.push([o, o.matrixWorld.clone()]); return; }
    const g = o.geometry.index ? o.geometry.toNonIndexed() : o.geometry.clone();
    g.applyMatrix4(o.matrixWorld);
    let a = by.get(o.material); if (!a) by.set(o.material, a = []);
    a.push(g);
  });
  group.clear();
  for (const [m, a] of by) {
    let geo = null;
    try { geo = mergeGeometries(a, false); } catch (err) { geo = null; }
    if (!geo) geo = a[0]; else for (const g of a) g.dispose();
    const mesh = new THREE.Mesh(geo, m);
    mesh.castShadow = true; mesh.receiveShadow = true; mesh.userData.own = true; mesh.userData.m0 = m;
    group.add(mesh);
  }
  for (const [o, mw] of kept) {
    mw.decompose(o.position, o.quaternion, o.scale);
    o.userData.m0 = o.material;   // (damage tint, see _tint)
    group.add(o);
  }
}
function disposeBaked(root) {
  root.traverse(o => { if (o.isMesh && o.userData.own) o.geometry.dispose(); });
}

// ---------- building parts ----------
function gable(c, w, h, d, x, y, z, alongX, m) {
  const o = mk(G.prism, c.roof, m || c.P.roof, alongX ? d + .22 : w + .22, h, alongX ? w + .22 : d + .22, x, y, z);
  if (alongX) o.rotation.y = PI / 2;
  return o;
}
function cupola(c, x, y, z, r, m) {
  cy(c.roof, MT.white, r * .8, r * .6, x, y, z);
  mk(G.dome, c.roof, m || XM.copper, r * 2, r * 1.3, r * 2, x, y + r * .6, z);
  sp(c.roof, MT.gold, r * .22, x, y + r * 1.95, z);
}
function roofFor(c, w, h, d, x, z, rh, alongX) {
  const P = c.P, e = c.era, L = alongX ? w : d;
  if (e === 1) { // flat mud/reed roof with parapet
    bx(c.roof, P.roof, w + .12, .07, d + .12, x, h, z);
    bx(c.roof, P.wall, w + .14, .12, .08, x, h + .05, z - d / 2); bx(c.roof, P.wall, w + .14, .12, .08, x, h + .05, z + d / 2);
    bx(c.roof, P.wall, .08, .12, d + .14, x - w / 2, h + .05, z); bx(c.roof, P.wall, .08, .12, d + .14, x + w / 2, h + .05, z);
    for (let i = 0; i < 3; i++) { const o = cy(c.roof, P.trim, .03, (alongX ? d : w) + .3, 0, 0, 0); if (alongX) { o.rotation.x = PI / 2; o.position.set(x - w * .3 + i * w * .3, h - .1, z - d / 2 - .15); } else { o.rotation.z = -PI / 2; o.position.set(x - w / 2 - .15, h - .1, z - d * .3 + i * d * .3); } }
    return;
  }
  if (e === 0) { // steep thatch with crossed ridge poles
    gable(c, w, rh * 1.15, d, x, h, z, alongX);
    for (let i = 0; i < 2; i++) for (let j = 0; j < 2; j++) {
      const o = bx(c.roof, P.trim, .04, .45, .04, alongX ? x + (i ? 1 : -1) * L * .5 : x, h + rh * 1.15 - .22, alongX ? z : z + (i ? 1 : -1) * L * .5);
      if (alongX) o.rotation.x = j ? .55 : -.55; else o.rotation.z = j ? .55 : -.55;
    }
    return;
  }
  if (e === 2) { gable(c, w, rh * 1.45, d, x, h, z, alongX); return; }
  if (e === 3) {
    gable(c, w, rh, d, x, h, z, alongX);
    if (w >= 1.8 && d >= 1.2) cupola(c, x, h + rh * .7, z, .22);
    return;
  }
  // industrial: low metal roof, glass skylight, smoking stack
  gable(c, w, rh * .55, d, x, h, z, alongX);
  if (alongX) bx(c.roof, XM.sky, L * .6, .07, .3, x, h + rh * .36, z); else bx(c.roof, XM.sky, .3, .07, L * .6, x, h + rh * .36, z);
  if (w >= 1.4) {
    const cx2 = x - w / 2 + .18, cz2 = z - d / 2 + .18, ch = h + rh + .9;
    cy(c.body, MT.brick, .11, ch, cx2, 0, cz2); cy(c.roof, MT.dstone, .13, .07, cx2, ch, cz2); c.chim.push(cx2, ch + .15, cz2);
  }
}
function hall(c, w, h, d, x, z, rh, alongX, wm) {
  const P = c.P;
  bx(c.body, wm || P.wall, w, h, d, x, 0, z);
  roofFor(c, w, h, d, x, z, rh, alongX);
  const fz = z + d / 2;
  bx(c.body, P.trim, .26, Math.min(.46, h * .6), .1, x, 0, fz);   // (stands out past the plinth and the iron band: equal fronts flickered)
  const wmat = c.t >= 2 ? MT.glass : MT.black;
  if (w > .9) {
    bx(c.body, wmat, .15, .16, .04, x - w * .3, h * .5, fz);
    bx(c.body, wmat, .15, .16, .04, x + w * .3, h * .5, fz);
    if (c.era === 3) { bx(c.body, wmat, .09, .05, .04, x - w * .3, h * .5 + .16, fz); bx(c.body, wmat, .09, .05, .04, x + w * .3, h * .5 + .16, fz); bx(c.body, MT.white, .2, .03, .06, x - w * .3, h * .5 - .03, fz); bx(c.body, MT.white, .2, .03, .06, x + w * .3, h * .5 - .03, fz); }
  }
  if (c.era === 0) sp(c.body, XM.bone, .06, x, Math.min(.46, h * .6) + .08, fz + .02);
  if (c.era === 1) { bx(c.body, c.cm, w + .03, .07, d + .03, x, h * .72, z); bx(c.body, MT.bronze, .3, .04, .06, x, Math.min(.46, h * .6), fz); }
  if (c.era === 4) { bx(c.body, MT.iron, w + .07, .05, d + .07, x, h * .55, z); }
  if (d > .9) {
    bx(c.body, wmat, .04, .16, .15, x + w / 2, h * .5, z);
    bx(c.body, wmat, .04, .16, .15, x - w / 2, h * .5, z);
  }
  if (c.era === 0 || c.era === 2) { // timber frame / corner posts
    for (let i = 0; i < 4; i++) {
      bx(c.body, P.trim, .07, h + .02, .07, x + (i & 1 ? 1 : -1) * w / 2, 0, z + (i & 2 ? 1 : -1) * d / 2);
    }
    bx(c.body, P.trim, w + .04, .05, d + .04, x, h - .05, z);
  } else {
    bx(c.body, P.base, w + .06, .12, d + .06, x, 0, z);
    bx(c.body, P.trim, w + .08, .05, d + .08, x, h - .04, z);
  }
}
function merlons(c, w, d, x, y, z, par) {
  const p = par || c.body, m = c.t === 0 ? c.P.trim : c.P.wall === MT.wood ? MT.stone : c.P.wall;
  const nx = Math.max(2, Math.round(w / .28)), nz = Math.max(2, Math.round(d / .28));
  for (let i = 0; i < nx; i += 1) {
    const px = x - w / 2 + (i + .5) * w / nx;
    if (i % 2 === 0 || nx < 4) { bx(p, m, w / nx * .9, .13, .1, px, y, z - d / 2 + .05); bx(p, m, w / nx * .9, .13, .1, px, y, z + d / 2 - .05); }
  }
  for (let i = 1; i < nz - 1; i += 1) {
    const pz = z - d / 2 + (i + .5) * d / nz;
    if (i % 2 === 0) { bx(p, m, .1, .13, d / nz * .9, x - w / 2 + .05, y, pz); bx(p, m, .1, .13, d / nz * .9, x + w / 2 - .05, y, pz); }
  }
}
function banner(c, x, y, z, h) {
  cy(c.roof, c.P.trim, .025, h, x, y, z);
  bx(c.roof, c.cm, .3, .2, .025, x + .17, y + h - .24, z);
  sp(c.roof, MT.bronze, .04, x, y + h + .02, z);
}
function chimney(c, x, y, z, h, w) {
  w = w || .16;
  bx(c.roof, c.t >= 2 ? MT.brick : MT.dstone, w, h + .4, w, x, y - .4, z);
  bx(c.roof, MT.dstone, w + .05, .05, w + .05, x, y + h, z);
  c.chim.push(x, y + h + .1, z);
}
const TOWER_SCALE = 1.5;
function turret(c, w, h, x, z, roofed) {
  const P = c.P;
  if (c.era === 0) {
    for (let i = 0; i < 4; i++) cy(c.body, P.trim, .045, h, x + (i & 1 ? 1 : -1) * w * .42, 0, z + (i & 2 ? 1 : -1) * w * .42);
    bx(c.body, P.wall, w * .8, h * .45, w * .8, x, 0, z);
    bx(c.body, P.wall, w * 1.1, .07, w * 1.1, x, h * .72, z);
    bx(c.body, P.wall2, w * 1.1, .16, w * 1.1, x, h * .79, z);
    py(c.roof, P.roof, w * 1.4, h * .32, w * 1.4, x, h, z);
    return h + h * .32;
  } else {
    const wm = c.t === 1 ? MT.stone : P.wall;
    bx(c.body, P.base, w + .08, .15, w + .08, x, 0, z);
    bx(c.body, wm, w, h, w, x, 0, z);
    bx(c.body, wm, w + .14, .16, w + .14, x, h - .16, z);
    bx(c.body, MT.black, .07, .2, .03, x, h * .6, z + w / 2);
    bx(c.body, MT.black, .03, .2, .07, x + w / 2, h * .6, z);
    const e = c.era;
    if (e === 1) {
      bx(c.body, c.cm, w + .02, .1, w + .02, x, h * .45, z);
      for (let i = 0; i < 4; i++) bx(c.roof, wm, .16, .16, .16, x + (i & 1 ? 1 : -1) * (w / 2), h, z + (i & 2 ? 1 : -1) * (w / 2));
      cy(c.roof, MT.bronze, .08, .05, x, h, z);
      return h + .16;
    }
    if (e === 2) {
      if (roofed) { py(c.roof, P.roof, w + .3, h * .5, w + .3, x, h, z); return h + h * .5; }
      merlons(c, w + .14, w + .14, x, h, z, c.roof); return h + .13;
    }
    if (e === 3) {
      cy(c.roof, wm, w * .42, .14, x, h, z);
      mk(G.dome, c.roof, roofed ? XM.copper : P.roof, w + .1, w * .7, w + .1, x, h + .14, z);
      sp(c.roof, MT.gold, .05, x, h + .14 + w * .7 + .03, z);
      return h + .14 + w * .7;
    }
    if (roofed) { py(c.roof, P.roof, w + .2, h * .16, w + .2, x, h, z); cy(c.roof, MT.iron, .02, .4, x, h + h * .16, z); return h + h * .16; }
    for (let i = 0; i < 4; i++) cy(c.roof, MT.iron, .025, .2, x + (i & 1 ? 1 : -1) * (w / 2 + .04), h, z + (i & 2 ? 1 : -1) * (w / 2 + .04));
    bx(c.roof, MT.iron, w + .16, .03, w + .16, x, h + .18, z);
    cy(c.roof, MT.steel, .09, .14, x, h, z);
    return h + .2;
  }
}
function crate(c, x, z, s) { bx(c.body, MT.lwood, s, s, s, x, 0, z); bx(c.body, MT.dwood, s + .02, .03, s + .02, x, s * .5, z); }
function barrel(c, x, z) { cy(c.body, MT.wood, .09, .22, x, 0, z); cy(c.body, MT.iron, .095, .03, x, .09, z); }
function posts(c, w, d, x, z, h) {
  for (let i = 0; i < 4; i++) cy(c.body, c.P.trim, .04, h, x + (i & 1 ? 1 : -1) * w / 2, 0, z + (i & 2 ? 1 : -1) * d / 2);
}

const BUILD = {
  towncenter(c) {
    hall(c, 2.3, 1.15, 1.7, -.4, -.1, .85, true);
    hall(c, 1.2, .85, 1.3, .1, 1.05, .55, false, c.P.wall2);
    const ty = turret(c, .75, 2.3, 1.35, -1.1) || 2.45;
    banner(c, 1.35, ty - .04, -1.1, .7);
    if (c.era === 0) { for (let i = 0; i < 7; i++) { const a = -.6 + i * .5; cy(c.body, MT.dwood, .05, .55 + (i % 3) * .08, Math.cos(a) * 1.85 - .1, 0, Math.sin(a) * 1.85 + .1); } bx(c.body, XM.bone, .05, .5, .05, .75, 0, 1.8).rotation.z = .3; bx(c.body, XM.bone, .05, .5, .05, -.55, 0, 1.8).rotation.z = -.3; }
    if (c.era === 1) { mk(G.wheel, c.body, MT.bronze, .04, .36, .36, .1, 1.0, 1.75).rotation.y = PI / 2; }
    if (c.era === 2) { banner(c, -1.5, 1.15, -.9, .7); banner(c, .7, 1.15, .75, .6); }
    banner(c, -1.6, 0, 1.5, 1.5);
    posts(c, 1.0, .5, .1, 1.75, .6);
    bx(c.roof, c.P.roof, 1.18, .06, .7, .1, .6, 1.75);   // (a hair narrower than the hall it leans on: equal ends flickered)
    if (c.t >= 1) merlons(c, 2.3, 1.7, -.4, 1.15, -.1);
    if (c.t >= 2) chimney(c, -1.2, 1.3, -.4, .75);
    cy(c.body, MT.stone, .22, .18, 1.3, 0, .9); cy(c.body, MT.black, .17, .19, 1.3, 0, .9);
  },
  house(c) {
    if (c.era === 0) {
      cy(c.body, c.P.wall2, .68, .55, 0, 0, 0);
      cn(c.roof, c.P.roof, .92, .8, 0, .5, 0);
      bx(c.body, c.P.trim, .24, .42, .06, 0, 0, .67);
      for (let i = 0; i < 6; i++) cy(c.body, c.P.trim, .035, .6, Math.cos(i * 1.047 + .5) * .69, 0, Math.sin(i * 1.047 + .5) * .69);
      c.chim.push(0, 1.35, 0);
    } else {
      hall(c, 1.35, .75, 1.15, 0, -.05, .6, true, c.era === 2 ? c.P.wall2 : c.P.wall);
      chimney(c, .4, .95, -.3, .5);
      if (c.t >= 2) bx(c.body, c.cm, .34, .06, .2, 0, .5, .56);
    }
    bx(c.body, c.cm, .05, .22, .16, .7, .3, .35);
  },
  farm() { },
  barracks(c) {
    hall(c, 2.4, .95, 1.5, 0, -.45, .65, true);
    if (c.t >= 1) merlons(c, 2.4, 1.5, 0, .95, -.45);
    banner(c, -1.25, 0, .5, 1.5); banner(c, 1.05, 0, .5, 1.5);
    // weapon rack + training dummy
    bx(c.body, c.P.trim, .7, .05, .05, -.5, .45, 1.0); cy(c.body, c.P.trim, .03, .5, -.85, 0, 1.0); cy(c.body, c.P.trim, .03, .5, -.15, 0, 1.0);
    for (let i = 0; i < 4; i++) bx(c.body, MT.steel, .03, .5, .03, -.75 + i * .17, .05, 1.03).rotation.x = -.2;
    cy(c.body, MT.wood, .04, .6, .7, 0, 1.0); bx(c.body, MT.hay, .2, .26, .14, .7, .32, 1.0); bx(c.body, MT.wood, .5, .05, .05, .7, .46, 1.0);
    sp(c.body, MT.hay, .09, .7, .68, 1.0);
  },
  archery(c) {
    hall(c, 1.5, .85, 1.4, -.6, -.5, .6, false);
    posts(c, 1.0, 1.2, .75, -.5, .75);
    mk(G.prism, c.roof, c.P.roof, 1.3, .35, 1.5, .75, .75, -.5);
    for (let i = 0; i < 3; i++) {
      const x = -1 + i * .9;
      cy(c.body, c.P.trim, .03, .5, x, 0, 1.15);
      const a = mk(G.wheel, c.body, MT.hay, .08, .44, .44, x, .5, 1.15); a.rotation.y = PI / 2;
      const b = mk(G.wheel, c.body, MT.white, .09, .3, .3, x, .5, 1.16); b.rotation.y = PI / 2;
      const d = mk(G.wheel, c.body, MT.red, .1, .13, .13, x, .5, 1.17); d.rotation.y = PI / 2;
    }
    banner(c, -1.3, 0, .6, 1.4);
    bx(c.body, MT.lwood, .5, .3, .25, .75, 0, -.6);
  },
  stable(c) {
    hall(c, 2.5, .8, 1.0, 0, -.85, .5, true);
    posts(c, 2.4, .9, 0, .1, .7);
    cy(c.body, c.P.trim, .04, .7, 0, 0, .55);
    const r = bx(c.roof, c.P.roof, 2.7, .07, 1.25, 0, .72, .05); r.rotation.x = .16;
    for (let i = 0; i < 3; i++) bx(c.body, c.P.trim, .04, .45, .9, -.8 + i * .8, 0, .1);
    const h1 = mk(G.wheel, c.body, MT.hay, .4, .36, .36, -1.0, .18, 1.1); h1.rotation.y = .4;
    mk(G.wheel, c.body, MT.hay, .4, .36, .36, -.55, .18, 1.2);
    bx(c.body, MT.wood, .7, .16, .22, .8, 0, 1.15); bx(c.body, mat(0x3f6f9f, .3), .62, .02, .16, .8, .15, 1.15);
    for (let i = 0; i < 5; i++) cy(c.body, c.P.trim, .03, .35, 1.35, 0, -.2 + i * .35);
    bx(c.body, c.P.trim, .04, .04, 1.5, 1.35, .25, .5);
    banner(c, -1.3, .79, -.85, .81);   // (pole foot just under the roof slab's underside)
  },
  blacksmith(c) {
    hall(c, 1.6, .85, 1.5, -.45, -.4, .6, false, c.t === 0 ? c.P.wall2 : c.P.wall);
    bx(c.body, MT.dstone, .7, 1.0, .7, .85, 0, -.7);
    chimney(c, .85, 1.0, -.7, .9, .36);
    bx(c.body, MT.glow, .34, .22, .05, .85, .2, -.34);
    posts(c, 1.0, .9, .75, .55, .7);
    bx(c.roof, c.P.roof, 1.25, .07, 1.15, .75, .7, .55);
    bx(c.body, MT.wood, .16, .22, .16, .7, 0, .5); bx(c.body, MT.iron, .32, .1, .14, .7, .22, .5); bx(c.body, MT.iron, .12, .06, .1, .9, .26, .5);
    barrel(c, 1.15, .9); bx(c.body, c.cm, .3, .22, .03, -.45, .9, .37);
  },
  market(c) {
    const cols = [c.cm, MT.canvas, c.cm];
    for (let i = 0; i < 3; i++) {
      const x = -.95 + i * .95, z = i === 1 ? -.75 : .55;
      posts(c, .75, .7, x, z, .7);
      py(c.roof, cols[i], 1.0, .4, .95, x, .68, z);
      bx(c.body, MT.lwood, .7, .28, .3, x, 0, z + .15);
      sp(c.body, i === 0 ? MT.red : i === 1 ? MT.gold : MT.green, .07, x - .15, .33, z + .15);
      sp(c.body, MT.wheat, .07, x + .12, .33, z + .15);
    }
    hall(c, .9, .7, .8, .95, -.85, .45, false);
    crate(c, -1.1, -.7, .26); crate(c, -.8, -.95, .2); barrel(c, -.2, .1); barrel(c, .4, 1.2);
    banner(c, -1.3, 0, -1.3, 1.5);
  },
  storage(c) {
    hall(c, 1.25, .8, 1.5, -.15, -.05, .6, false);
    bx(c.body, c.P.trim, .5, .55, .05, -.15, 0, .71);
    bx(c.body, c.cm, .3, .12, .03, -.15, .62, .72);
    crate(c, .72, .5, .26); crate(c, .72, .15, .22); barrel(c, .72, -.3); barrel(c, .74, -.6);
    bx(c.body, MT.lwood, .2, .2, .2, .72, .27, .48);
  },
  tower(c) {
    // a 1x1 tower (old saves) is built at 1.5x to stand out; a 3x3 one (mask bit 16) is already drawn at 3x by its
    // footprint, so it keeps its design size (owner 2026-11-14: 4.5x dwarfed the walls). Wall stubs bridge to the walls.
    const TS = c.mask & 16 ? .9 : TOWER_SCALE, TY = TS;   // (3x3: a slim tower about twice the wall height)
    const n0 = c.body.children.length, r0 = c.roof.children.length;
    const ty = towerModel(c);
    c.towerH = ty * TY;   // (top of the tower without its banner: a generated tower model is stretched to it)
    banner(c, 0, ty - .04, 0, .5);
    for (const [g, from] of [[c.body, n0], [c.roof, r0]]) for (const o of g.children.slice(from)) { o.position.set(o.position.x * TS, o.position.y * TY, o.position.z * TS); o.scale.set(o.scale.x * TS, o.scale.y * TY, o.scale.z * TS); }
    // short stubs toward adjacent wall segments
    const m = c.mask & 15, big = !!(c.mask & 16), W = (big ? 1 / 3 : 1) * WALL_T, Hm = big ? WALL_H / 3 : WALL_H;
    if (m) {
      const S = wallStyle(c);
      for (let i = 0; i < 4; i++) {
        if (!(m & (1 << i))) continue; const d = WDIR[i];
        if (S.pal) { for (const a of [.34, .42, .5]) { const x = d[0] * a, z = d[1] * a; cy(c.body, S.stake, .09 * W, .82 * Hm, x, 0, z); cn(c.body, MT.lwood, .09 * W, .15 * Hm, x, .82 * Hm, z); } }
        else {   // the same courses, walkway and merlons as the wall arm it meets (owner playtest 2: the plain stub was left over)
          const A = (mt, a0, a1, wd, h, y, off) => wArm(c.body, mt, d, a0, a1, wd * W, h * Hm, y * Hm, (off || 0) * W);
          const H = S.h, u = big ? 1 / 3 : 1, a0 = .24;   // u = one tile in tower units
          A(S.base, a0, .5, .78, .3, 0);
          A(S.body, a0, .5, .6, H - .06, 0);
          for (const y of [.46, .72]) A(S.line, a0, .5, .62, .025, y);
          A(S.cap, a0, .5, .66, .05, H - .11); A(S.cap, a0, .5, .72, .06, H - .06);
          if (S.band) A(S.band, a0, .5, .63, .035, H - .2);
          for (const s of [-.32, .32]) {
            A(S.mer, a0, .5, .08, .06, H, s);
            for (let k = 0; k < 8; k++) {   // merlons on the walls' own .25-tile beat, so they run on without a break
              const a = (.125 + .25 * k) * u; if (a - .065 * u < a0 || a + .065 * u > .5) continue;
              A(S.mer, a - .065 * u, a + .065 * u, .08, .16, H + .05, s);
              if (S.merCap) A(S.merCap, a - .075 * u, a + .075 * u, .1, .03, H + .21, s);
            }
          }
        }
      }
    }
  },
  // one wall segment = an arm toward every linked neighbour (c.mask: 1=-z 2=+x 4=+z 8=-x) + a post where the line
  // turns, branches or ends (owner playtest 2: the old slabs read as cardboard boxes). Palisade: one row of sharpened
  // logs of varying height and lean, lashed by two rails, a walkway on posts and braces behind (-x/-z side).
  // Masonry (stone / brick + plaster / brick + iron): a battered plinth, coursed body with blocks of another shade,
  // corbelled walkway, parapet + merlons on both faces; posts are small crenellated towers. Everything is baked
  // per material (all in U.body, so merlons share the body's meshes): a segment stays a handful of meshes.
  wall(c) {
    const m0 = c.mask & 15; let m = m0; if (!m) m = 10; else if (m === 1 || m === 4) m = 5; else if (m === 2 || m === 8) m = 10; // lone / end piece: full straight run
    const straight = m === 5 || m === 10, post = !straight || (m0 && !(m0 & (m0 - 1))), S = wallStyle(c), T = WALL_T;
    const wArm = (p, mt, d, a0, a1, wd, h, y, off) => wArmBase(p, mt, d, a0, a1, wd * T, h, y, (off || 0) * T);   // (thicker across the line only)
    const rnd = wRand(c.seed * 7 + c.era);
    if (S.pal) {
      const H = .9;
      for (let i = 0; i < 4; i++) {
        if (!(m & (1 << i))) continue; const d = WDIR[i];
        // logs every .125 (seamless across tiles), touching, each its own height / lean / turn
        for (let j = 0; j < 4; j++) {
          const a = .0625 + .125 * j, r = .06 + rnd() * .012;
          wLog(c.body, j % 2 ? S.stake : S.stake2, r, H - .06 + rnd() * .16, d[0] * a, 0, d[1] * a, (rnd() - .5) * .09, (rnd() - .5) * .09, rnd());
        }
        wArm(c.body, MT.dwood, d, 0, .5, .15, .045, .28);   // lashing rails, showing on both faces
        wArm(c.body, MT.dwood, d, 0, .5, .15, .045, .64);
        wArm(c.body, S.plank, d, 0, .5, .2, .04, .56, -.2);   // walkway behind on posts, braced to the ground
        const pa = d[0] ? [d[0] * .25, -.28 * T] : [-.28 * T, d[1] * .25];
        bx(c.body, MT.dwood, .045, .56, .045, pa[0], 0, pa[1]);
        const th = Math.atan2(.3 * T, .58), br = bx(c.body, MT.dwood, .04, Math.hypot(.3 * T, .58), .04, d[0] ? d[0] * .4 : -.42 * T, 0, d[1] ? d[1] * .4 : -.42 * T);
        if (d[0]) br.rotation.x = th; else br.rotation.z = -th;
        if (S.foot) wArm(c.body, S.foot, d, 0, .5, .3, .1, 0);
        if (S.band) wArm(c.body, S.band, d, 0, .5, .155, .04, .46);
      }
      if (post) {   // a thick lashed post where the line turns or ends
        wLog(c.body, S.stake2, .13, H + .22, 0, 0, 0, 0, 0, .3);
        for (let i = 0; i < 4; i++) wLog(c.body, S.stake, .075, H + .05 + rnd() * .08, (i & 1 ? 1 : -1) * .12, 0, (i & 2 ? 1 : -1) * .12, 0, 0, rnd());
        cy(c.body, MT.dwood, .2, .05, 0, .62, 0);
        if (S.band) cy(c.body, S.band, .205, .04, 0, .46, 0);
      }
      return;
    }
    const H = S.h, acc = S.acc;
    for (let i = 0; i < 4; i++) {
      if (!(m & (1 << i))) continue; const d = WDIR[i];
      // a linked end: plinth, courses and walkway run .007 past the body's end, so a joint the neighbour does not
      // cover (a wall meeting a 3x3 tower off its middle row, a step in the ground) shows no equal end faces
      const e1 = m0 & (1 << i) ? .507 : .5;
      wTrap(c.body, S.base, d, .8 * T, .3, e1);             // battered plinth (narrows to the body's width)
      wArm(c.body, S.body, d, 0, m0 & (1 << i) ? .5 : .49, .6, H - .06, 0);   // (an open end: the body stops short of the plinth / course / walkway ends, equal end faces flickered)
      for (const y of [.46, .72]) wArm(c.body, S.line, d, 0, e1, .62, .025, y);   // courses
      [[.1, .34], [.24, .6], [.39, .8], [.36, .38], [.06, .8]].slice(0, S.nAcc || 5).forEach(([a, y], k) => wArm(c.body, acc[(k + i) % acc.length], d, a - .09, a + .09, .615, .07, y));
      wArm(c.body, S.cap, d, 0, e1, .66, .05, H - .11);    // corbel + walkway
      wArm(c.body, S.cap, d, 0, e1, .72, .06, H - .06);
      if (S.band) wArm(c.body, S.band, d, 0, e1, .63, .035, H - .2);
      for (const s of [-.32, .32]) {
        wArm(c.body, S.mer, d, 0, .5, .08, .06, H, s);       // parapet + merlons (seamless every .25)
        for (const a of [.125, .375]) {
          wArm(c.body, S.mer, d, a - .065, a + .065, .08, .16, H + .05, s);
          if (S.merCap) wArm(c.body, S.merCap, d, a - .075, a + .075, .1, .03, H + .21, s);
        }
      }
    }
    if (!post) return;
    // corner / junction / end: a small square tower, a little taller and wider than the wall
    const P = Math.min(.98, .74 * T), TH = H + .3, B = P - .1, k = B / 2;
    mk(FRUS_GEO, c.body, S.base, P + .06, .36, P + .06, 0, 0, 0);
    bx(c.body, S.body, B, TH - .1, B, 0, 0, 0);
    if (S.quoin) for (let i = 0; i < 4; i++) bx(c.body, S.quoin, .07, TH - .16, .07, (i & 1 ? 1 : -1) * k, 0, (i & 2 ? 1 : -1) * k);   // (end under the corbel)
    bx(c.body, S.line, B + .02, .03, B + .02, 0, .55, 0);
    bx(c.body, MT.black, .05, .2, B + .02, 0, .64, 0); bx(c.body, MT.black, B + .02, .2, .05, 0, .64, 0);   // arrow slits
    bx(c.body, S.cap, P - .02, .06, P - .02, 0, TH - .16, 0); bx(c.body, S.cap, P + .04, .07, P + .04, 0, TH - .1, 0);
    if (S.roofT) { py(c.body, S.roofT, P + .1, .42, P + .1, 0, TH - .04, 0); if (S.spire) cy(c.body, S.spire, .012, .2, 0, TH + .34, 0); else sp(c.body, MT.bronze, .035, 0, TH + .4, 0); }
    else {
      const q = (P + .04) / 2 - .07;
      for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
        if (!i && !j) continue;
        bx(c.body, S.mer, .13, .17, .13, i * q, TH - .03, j * q);   // (on the walkway cap, not level with its side faces)
        if (S.merCap) bx(c.body, S.merCap, .15, .03, .15, i * q, TH + .14, j * q);
      }
      cy(c.body, MT.dwood, .014, .34, 0, TH - .04, 0); bx(c.body, c.cm, .17, .1, .015, .085, TH + .18, 0);   // team pennant
    }
  },
  // gate: a gatehouse along the wall line (from c.mask). A gate is opened 3 tiles wide (game.cmdOpenGate): each piece
  // knows from mask bits 32<<dir which neighbours along the line are gate pieces too, so the three draw as one wide
  // opening: a flanking tower and a door leaf only at the two ends, one bridge with battlements across, arch shoulders
  // at the towers. A lone piece (old saves) keeps both (slimmer) towers and two leaves.
  gate(c) {
    const m = c.mask & 15, alongZ = (m & 5) && !(m & 10);
    const gL = !!(c.mask & (alongZ ? 128 : 256)), gR = !!(c.mask & (alongZ ? 32 : 64));
    const b0 = c.body.children.length, r0 = c.roof.children.length;
    const S = wallStyle(c), pal = !!S.pal, wm = pal ? MT.wood : S.body, rnd = wRand(c.seed * 13 + 5);
    const lone = !gL && !gR, tw = lone ? .26 : .38, TH = 1.7, BY = .95, BH = .4, D = .74;
    const ends = []; if (!gL) ends.push(-1); if (!gR) ends.push(1);
    bx(c.body, pal ? MT.dwood : S.base, 1.0, .06, D, 0, 0, 0);
    const x0 = gL ? -.5 : -.5 + tw, x1 = gR ? .5 : .5 - tw;
    // bridge ends: run into the next gate piece, but stop inside a flanking tower (their end faces sat a hair proud of
    // the tower's outer face and flickered)
    const bL = gL ? -.501 : -.49, bR = gR ? .501 : .49;
    bx(c.body, MT.black, x1 - x0 + .002, BY - .05, .02, (x0 + x1) / 2, .05, -.2); // dark passage behind the doors
    // the bridge over the opening
    if (pal) {
      bx(c.body, MT.dwood, 1.002, .14, D - .04, 0, BY, 0);
      bx(c.body, S.plank, 1.002, .05, D + .06, 0, BY + .14, 0);
      for (const z of [-(D / 2 - .02), D / 2 - .02]) for (let j = 0; j < 8; j++) wLog(c.roof, j % 2 ? S.stake : S.stake2, .05, .26 + rnd() * .08, -.4375 + .125 * j, BY + .19, z, 0, 0, rnd());
      if (S.band) bx(c.body, S.band, bR - bL, .04, D - .02, (bL + bR) / 2, BY + .05, 0);
    } else {
      bx(c.body, wm, bR - bL, BH - .05, D, (bL + bR) / 2, BY, 0);   // (stops under the walkway cap: equal tops flickered, owner 2026-11-14)
      bx(c.body, S.cap, x1 - x0 + .002, .05, D + .04, (x0 + x1) / 2, BY - .01, 0);   // lintel
      bx(c.body, S.line, bR - bL, .03, D + .01, (bL + bR) / 2, BY + .12, 0);
      bx(c.body, S.cap, bR - bL, .05, D + .06, (bL + bR) / 2, BY + BH - .05, 0);
      if (S.band) bx(c.body, S.band, bR - bL, .035, D + .02, (bL + bR) / 2, BY + .22, 0);
      for (const z of [-(D / 2 - .01), D / 2 - .01]) {
        bx(c.roof, S.mer, 1.002, .06, .08, 0, BY + BH, z);
        for (const x of [-.375, -.125, .125, .375]) {
          bx(c.roof, S.mer, .13, .16, .08, x, BY + BH + .05, z);
          if (S.merCap) bx(c.roof, S.merCap, .15, .03, .1, x, BY + BH + .21, z);
        }
      }
      if (c.era >= 2) bx(c.body, MT.iron, x1 - x0, .07, .05, (x0 + x1) / 2, BY - .07, -.06);   // raised portcullis
    }
    // flanking towers + arch shoulders (or knee braces) at the ends of the opening
    for (const s of ends) {
      const tx = s * (.5 - tw / 2), fx = s * (.5 - tw);
      if (pal) {
        for (const ox of [-tw / 4, tw / 4]) for (const z of [-.3, -.1, .1, .3]) wLog(c.body, (ox > 0) === (z > 0) ? S.stake : S.stake2, .088, 1.3 + rnd() * .1, tx + ox, 0, z, 0, 0, rnd());
        bx(c.body, MT.dwood, tw + .1, .06, D + .14, tx, 1.12, 0);
        for (let i = 0; i < 4; i++) bx(c.body, MT.dwood, .04, .32, .04, tx + (i & 1 ? 1 : -1) * (tw / 2 + .02), 1.12, (i & 2 ? 1 : -1) * (D / 2 + .04));
        py(c.roof, c.P.roof, tw + .2, .34, D + .24, tx, 1.42, 0);
        const kb = mk(G.cbox, c.body, MT.dwood, .05, .3, D - .1, fx - s * .08, BY - .07, 0); kb.rotation.z = s * PI / 4;
      } else {
        mk(FRUS_GEO, c.body, S.base, tw + .08, .34, D + .34, tx, 0, 0);
        bx(c.body, wm, tw, TH, D + .24, tx, 0, 0);
        if (S.quoin) for (let i = 0; i < 4; i++) bx(c.body, S.quoin, .06, TH, .06, tx + (i & 1 ? 1 : -1) * tw / 2, 0, (i & 2 ? 1 : -1) * (D + .24) / 2);
        bx(c.body, S.line, tw + .02, .03, D + .26, tx, .55, 0);
        bx(c.body, MT.black, .05, .2, D + .25, tx, 1.16, 0);   // arrow slit, both faces
        bx(c.body, S.line, tw + .02, .03, D + .26, tx, 1.0, 0);
        // an overhanging head on corbels (owner playtest 2: the plain posts read as boxes)
        for (const z of [-1, 1]) for (const ox of [-tw / 3, 0, tw / 3]) bx(c.body, S.cap, .07, .12, .08, tx + ox, TH - .46, z * ((D + .24) / 2 + .03));
        for (const xs of [-1, 1]) for (const oz of [-.3, 0, .3]) bx(c.body, S.cap, .08, .12, .07, tx + xs * (tw / 2 + .03), TH - .46, oz);
        bx(c.body, wm, tw + .1, .24, D + .34, tx, TH - .34, 0);
        bx(c.body, MT.black, .06, .12, D + .35, tx, TH - .28, 0);   // a loophole in the head
        bx(c.body, S.cap, tw + .14, .06, D + .38, tx, TH - .1, 0); bx(c.body, S.cap, tw + .18, .06, D + .42, tx, TH - .05, 0);
        if (S.roofT) py(c.roof, S.roofT, tw + .22, .4, D + .46, tx, TH + .01, 0);
        else for (const ox of [-1, 1]) for (const z of [-1, 0, 1]) {
          const mx = tx + ox * (tw / 2 - .02), mz = z * (D / 2 + .12);
          bx(c.roof, S.mer, .1, .17, .11, mx, TH, mz);
          if (S.merCap) bx(c.roof, S.merCap, .12, .03, .13, mx, TH + .17, mz);
        }
        const sh = mk(G.cbox, c.body, S.cap, .26, .26, D + .02, fx, BY, 0); sh.rotation.z = PI / 4;   // arch shoulder
        bx(c.body, S.cap, .06, BY, D + .04, fx + s * .01, 0, 0);   // jamb
      }
    }
    const leaf = (hx, s, len) => {   // a door leaf hinged at (hx, .3), swung open outward (s = +1 opens toward +x)
      const a = .55, cx = hx + s * len / 2 * Math.cos(a), cz = .3 + len / 2 * Math.sin(a);
      const d = bx(c.body, pal ? MT.lwood : MT.dwood, len, .84, .06, cx, .06, cz); d.rotation.y = -s * a;
      for (const y of [.3, .7]) { const ir = bx(c.body, pal ? MT.dwood : MT.iron, len * 1.05, .04, .09, cx, y, cz); ir.rotation.y = -s * a; }   // (straps clear of the leaf's faces and ends)
    };
    if (lone) { leaf(x0, 1, .24); leaf(x1, -1, .24); }
    else { if (!gL) leaf(x0, 1, .72); if (!gR) leaf(x1, -1, .72); }
    if (gL === gR) for (const z of [-1, 1]) bx(c.roof, c.cm, .22, .26, .03, 0, BY + .04, z * (D / 2 + .02));   // the banner plaque: lone gate or the middle piece
    if (alongZ) for (const [g, s] of [[c.body, b0], [c.roof, r0]]) for (const o of g.children.slice(s)) { const x = o.position.x, z = o.position.z; o.position.x = z; o.position.z = -x; o.rotation.y += PI / 2; }
  },
  university(c) {
    bx(c.body, c.P.base, 2.6, .18, 2.3, 0, 0, 0);
    hall(c, 2.2, 1.1, 1.5, 0, -.3, .5, true, c.t <= 1 ? c.P.wall2 : c.P.wall);
    for (let i = 0; i < 5; i++) { cy(c.body, MT.white, .07, .95, -.9 + i * .45, .18, .75); }
    mk(G.prism, c.roof, c.P.wall2, 2.3, .4, .6, 0, 1.13, .7).rotation.y = PI / 2;
    bx(c.body, MT.white, 2.3, .08, .5, 0, 1.08, .72);
    cy(c.body, c.P.wall, .5, 1.5, 0, 0, -.35);
    mk(G.dome, c.roof, c.t >= 3 ? MT.bronze : c.P.roof, 1.15, 1.0, 1.15, 0, 1.5, -.35);
    sp(c.roof, MT.gold, .06, 0, 2.05, -.35);
    banner(c, 1.2, 0, 1.0, 1.4);
  },
  castle(c) {
    const wm = c.era === 0 ? MT.wood : c.P.wall;
    bx(c.body, c.P.base, 3.3, .2, 3.3, 0, 0, 0);
    bx(c.body, wm, 2.9, 1.3, 2.9, 0, 0, 0);
    merlons(c, 2.9, 2.9, 0, 1.3, 0);
    bx(c.body, wm, 1.6, 2.2, 1.6, 0, 0, -.2);
    bx(c.body, wm, 1.8, .18, 1.8, 0, 2.05, -.2);
    merlons(c, 1.8, 1.8, 0, 2.23, -.2, c.roof);
    for (let i = 0; i < 4; i++) turret(c, .7, 1.9, (i & 1 ? 1 : -1) * 1.4, (i & 2 ? 1 : -1) * 1.4, i < 2);
    bx(c.body, MT.dwood, .6, .8, .08, 0, 0, 1.45); bx(c.body, MT.iron, .62, .05, .1, 0, .4, 1.45);
    banner(c, 0, 2.2, -.2, 1.0);
    bx(c.body, c.cm, .4, .7, .03, -.8, .5, 1.46); bx(c.body, c.cm, .4, .7, .03, .8, .5, 1.46);
  },
  siege(c) {
    posts(c, 2.2, 1.6, 0, -.3, 1.0);
    gable(c, 2.3, .6, 1.7, 0, 1.0, -.3, true);
    bx(c.body, c.P.wall, 2.2, 1.0, .1, 0, 0, -1.1);
    hall(c, .8, .7, .8, -.9, .9, .4, false);
    mk(G.wheel, c.body, MT.wood, .08, .7, .7, .3, .35, .75).rotation.y = PI / 2 + .3;
    mk(G.wheel, c.body, MT.wood, .08, .6, .6, .9, .3, .95).rotation.y = PI / 2 - .2;
    for (let i = 0; i < 3; i++) { const l = cy(c.body, MT.wood, .08, 1.3, -.2 + i * .18, .09, -.3); l.rotation.x = PI / 2; l.position.z = -.9; }
    bx(c.body, MT.lwood, 1.0, .12, .5, .5, .3, -.3); bx(c.body, MT.dwood, .1, .7, .1, .5, .3, -.3).rotation.x = .5;
    banner(c, 1.2, 0, 1.2, 1.4);
  },
  factory(c) {
    bx(c.body, c.P.base, 3.7, .15, 3.2, 0, 0, 0);
    bx(c.body, MT.brick, 3.4, 1.25, 2.0, 0, 0, -.5);
    for (let i = 0; i < 4; i++) {
      mk(G.prism, c.roof, c.P.roof, .85, .4, 2.05, -1.275 + i * .85, 1.25, -.5);
      bx(c.body, MT.glass, .5, .35, .04, -1.275 + i * .85, .55, .51);
    }
    bx(c.body, c.P.wall2, 1.6, .8, 1.0, -.8, 0, 1.0);
    bx(c.roof, c.P.roof, 1.7, .08, 1.1, -.8, .8, 1.0);
    bx(c.body, MT.dwood, .5, .55, .05, -.8, 0, 1.51);
    cy(c.body, MT.brick, .2, 2.7, 1.35, 0, -1.1); cy(c.roof, MT.dstone, .23, .1, 1.35, 2.7, -1.1); c.chim.push(1.35, 2.9, -1.1);
    cy(c.body, MT.brick, .16, 2.2, .8, 0, -1.2); cy(c.roof, MT.dstone, .19, .1, .8, 2.2, -1.2); c.chim.push(.8, 2.4, -1.2);
    cy(c.body, MT.steel, .38, .9, 1.1, 0, 1.0); mk(G.dome, c.roof, MT.steel, .76, .4, .76, 1.1, .9, 1.0);
    const pipe = cy(c.body, MT.iron, .05, 1.0, .3, .5, 1.0); pipe.rotation.z = PI / 2; pipe.position.x = .9;
    banner(c, -1.6, .79, 1.4, .91);
    bx(c.body, c.cm, 1.0, .2, .03, 0, .95, .52);
  },
  mill(c) {
    const e = c.era, P = c.P, g = new THREE.Group();
    if (e <= 1) { // grinding hut + big wooden wheel
      hall(c, 1.5, .8, 1.4, -.5, -.3, .6, false);
      bx(c.body, P.trim, .1, .8, .1, .62, 0, -.3); bx(c.body, P.trim, .1, .8, .1, 1.32, 0, -.3);
      if (e === 1) bx(c.body, XM.water, .5, .05, 2.0, .97, 0, -.2);
      else { cy(c.body, MT.stone, .3, .12, .3, 0, .9); cy(c.body, MT.dstone, .24, .1, .3, .12, .9); }
      const r = e === 0 ? .5 : .62;
      mk(G.wheel, g, e === 0 ? MT.dwood : MT.wood, .16, r * 2, r * 2, 0, 0, 0);
      for (let i = 0; i < 8; i++) { const b = piv(g, 0, 0, 0); b.rotation.x = i * PI / 4; bx(b, MT.lwood, .36, .12, .05, 0, r - .04, 0); }
      cy(g, e === 1 ? MT.bronze : MT.dwood, .06, .5, 0, 0, 0).rotation.z = PI / 2; g.children[g.children.length - 1].position.x = .25;
      c.spin = { g, x: .97, y: r + .12, z: -.3, axis: 'x', speed: e === 0 ? .8 : 1.3 };
    } else if (e <= 3) { // tower windmill
      bx(c.body, P.base, 1.5, .14, 1.5, -.2, 0, -.3);
      cy(c.body, e === 2 ? P.wall : MT.plaster, .62, 1.0, -.2, 0, -.3); cy(c.body, e === 2 ? P.wall2 : MT.plaster, .52, .75, -.2, 1.0, -.3);
      if (e === 2) cn(c.roof, P.roof, .62, .7, -.2, 1.75, -.3); else { mk(G.dome, c.roof, P.roof, 1.16, .5, 1.16, -.2, 1.75, -.3); sp(c.roof, MT.gold, .05, -.2, 2.28, -.3); }
      bx(c.body, P.trim, .26, .44, .05, -.2, 0, .31); bx(c.body, e === 3 ? MT.glass : MT.black, .14, .16, .05, -.2, 1.2, .2);
      bx(c.body, P.trim, .08, .08, .5, -.2, 1.55, 0);
      for (let i = 0; i < 4; i++) { const b = piv(g, 0, 0, 0); b.rotation.z = i * PI / 2 + .3; bx(b, MT.dwood, .05, 1.25, .04, 0, 0, 0); bx(b, MT.canvas, .26, .95, .02, .15, .28, 0); }
      sp(g, e === 3 ? MT.bronze : MT.dwood, .09, 0, 0, 0);
      c.spin = { g, x: -.2, y: 1.59, z: .3, axis: 'z', speed: .9 };
      hall(c, .9, .6, .8, .95, .75, .4, false, P.wall2);
    } else { // steam mill
      hall(c, 1.8, 1.25, 1.5, -.4, -.4, .6, true);
      cy(c.body, MT.steel, .34, 1.5, .95, 0, -.75); mk(G.dome, c.roof, MT.steel, .68, .3, .68, .95, 1.5, -.75);
      bx(c.body, MT.iron, .5, .4, .7, .85, 0, .35); cy(c.body, MT.bronze, .08, .5, .85, .4, .5);
      mk(G.wheel, g, MT.iron, .08, 1.0, 1.0, 0, 0, 0); mk(G.wheel, g, MT.steel, .1, .22, .22, 0, 0, 0);
      for (let i = 0; i < 3; i++) { const b = piv(g, 0, 0, 0); b.rotation.x = i * PI / 3; bx(b, MT.steel, .1, .9, .06, 0, -.45, 0); }
      c.spin = { g, x: 1.2, y: .6, z: .35, axis: 'x', speed: 3.2 };
    }
    for (let i = 0; i < 4; i++) mk(G.sph, c.body, MT.canvas, .24, .28, .2, -1.15 + (i % 2) * .26, .13 + (i > 1 ? .2 : 0), 1.0 + (i === 3 ? .05 : 0) + (i % 2) * .05);
    mk(G.sph, c.body, MT.wheat, .2, .1, .2, -.6, .05, 1.1);
    bx(c.body, c.cm, .3, .2, .03, -.5, .95, .42);
    banner(c, 1.3, 0, 1.3, 1.2);
  },
  lumbercamp(c) {
    const e = c.era, P = c.P;
    posts(c, 1.2, .85, -.25, -.4, .8);
    if (e === 0) { const r = bx(c.roof, XM.hide, 1.45, .06, 1.15, -.25, .74, -.4); r.rotation.x = .3; bx(c.roof, XM.bone, .04, .3, .04, -.25, .9, -.9); }
    else if (e === 4) { const r = bx(c.roof, P.roof, 1.45, .05, 1.15, -.25, .8, -.4); r.rotation.x = .18; bx(c.body, P.wall, 1.2, .79, .08, -.25, 0, -.85); mk(G.wheel, c.body, MT.steel, .02, .5, .5, -.25, .42, -.1); bx(c.body, MT.iron, .7, .3, .3, -.25, 0, -.1); cy(c.body, MT.iron, .06, 1.3, .3, 0, -.8); c.chim.push(.3, 1.45, -.8); }
    else { roofFor(c, 1.3, .8, .95, -.25, -.4, .4, true); if (e >= 2) bx(c.body, e === 2 ? P.wall2 : P.wall, 1.2, .8, .08, -.25, 0, -.85); if (e === 1) bx(c.body, c.cm, 1.24, .07, .06, -.25, .68, .03); }
    // stacked logs
    for (let i = 0; i < 6; i++) { const row = i < 3 ? 0 : i < 5 ? 1 : 2, k = i - (row === 0 ? 0 : row === 1 ? 3 : 5); const l = cy(c.body, i % 2 ? MT.wood : MT.dwood, .09, 1.0, 0, 0, 0); l.rotation.z = PI / 2; l.position.set(.2, .09 + row * .16, .45 + k * .19 + row * .095); }
    // saw horse with a log
    for (let i = 0; i < 2; i++) { const zz = .7 + i * 0, xx = .55 + i * .35; bx(c.body, P.trim, .04, .42, .04, xx, 0, .55).rotation.x = .4; bx(c.body, P.trim, .04, .42, .04, xx, 0, .85).rotation.x = -.4; }
    const lg = cy(c.body, MT.wood, .07, .7, 0, 0, 0); lg.rotation.z = PI / 2; lg.position.set(1.08, .36, .7);
    bx(c.body, e === 0 ? MT.stone : e === 1 ? MT.bronze : MT.steel, .3, .12, .015, .72, .36, .7);
    // stump + axe
    cy(c.body, MT.wood, .13, .2, .7, 0, -.55); bx(c.body, MT.lwood, .03, .34, .03, .7, .2, -.55).rotation.z = .5; bx(c.body, e === 0 ? MT.stone : e === 1 ? MT.bronze : MT.steel, .1, .08, .02, .56, .44, -.55);
    bx(c.body, c.cm, .05, .2, .16, -.87, .5, .05);
  },
  minecamp(c) {
    const e = c.era, P = c.P;
    const fm = e === 4 ? MT.iron : e >= 2 ? (e === 2 ? MT.stone : P.wall2) : P.trim;
    // rock mound + dark tunnel
    mk(G.rock, c.body, MT.dstone, 1.5, 1.1, 1.2, -.2, .3, -.45).rotation.set(.3, .6, .1);
    mk(G.rock, c.body, MT.stone, .8, .6, .7, .55, .2, -.6).rotation.set(1, .2, .4);
    bx(c.body, MT.black, .5, .6, .3, -.2, 0, .08);
    bx(c.body, fm, .1, .72, .14, -.5, 0, .22); bx(c.body, fm, .1, .72, .14, .1, 0, .22); bx(c.body, fm, .8, .1, .16, -.2, .7, .22);
    if (e === 0) { sp(c.body, XM.bone, .07, -.2, .88, .24); bx(c.body, XM.bone, .03, .26, .03, -.56, .7, .24).rotation.z = .5; bx(c.body, XM.bone, .03, .26, .03, .16, .7, .24).rotation.z = -.5; }
    else if (e === 1) { bx(c.body, c.cm, .82, .06, .17, -.2, .62, .22); bx(c.body, MT.bronze, .12, .12, .03, -.2, .7, .32); }
    else if (e === 2) { mk(G.prism, c.roof, P.roof, .95, .3, .5, -.2, .8, .2); }
    else if (e === 3) { mk(G.prism, c.roof, P.roof, .95, .25, .5, -.2, .8, .2); bx(c.body, MT.white, .2, .08, .03, -.2, .72, .31); }
    else { // pit-head frame with winding wheel
      for (let i = 0; i < 4; i++) cy(c.body, MT.iron, .03, 1.7, -.2 + (i & 1 ? 1 : -1) * .3, 0, -.4 + (i & 2 ? 1 : -1) * .3);
      bx(c.body, MT.iron, .7, .04, .7, -.2, 1.0, -.4); bx(c.roof, MT.iron, .7, .05, .7, -.2, 1.7, -.4);
      mk(G.wheel, c.roof, MT.steel, .05, .5, .5, -.2, 1.95, -.4);
      bx(c.body, MT.iron, .04, .03, 1.1, .5, 0, .55); bx(c.body, MT.iron, .04, .03, 1.1, .74, 0, .55);
    }
    // ore cart
    bx(c.body, e === 4 ? MT.iron : MT.wood, .34, .2, .46, .62, .1, .55); bx(c.body, e >= 3 ? MT.iron : MT.dwood, .36, .03, .48, .62, .28, .55);
    for (let i = 0; i < 4; i++) mk(G.wheel, c.body, e >= 3 ? MT.iron : MT.dwood, .04, .16, .16, .62 + (i & 1 ? 1 : -1) * .19, .08, .55 + (i & 2 ? 1 : -1) * .15);
    mk(G.rock, c.body, MT.gold, .12, .1, .12, .58, .34, .5); mk(G.rock, c.body, MT.stone, .14, .12, .14, .68, .33, .62); mk(G.rock, c.body, MT.gold, .1, .09, .1, .64, .36, .45);
    // pick rack
    cy(c.body, P.trim, .025, .5, -.9, 0, .6); cy(c.body, P.trim, .025, .5, -.9, 0, .95); bx(c.body, P.trim, .04, .04, .4, -.9, .46, .775);
    const pm = e === 0 ? MT.stone : e === 1 ? MT.bronze : MT.iron;
    for (let i = 0; i < 3; i++) { bx(c.body, MT.lwood, .025, .46, .025, -.86, .04, .66 + i * .11).rotation.z = -.25; bx(c.body, pm, .03, .04, .2, -.76, .44, .66 + i * .11); }
    bx(c.body, c.cm, .05, .2, .16, .9, .5, -.8); cy(c.body, P.trim, .02, .75, .9, 0, -.8);   // (off the slab's edge plane)
  },
  temple(c) {
    const e = c.era, P = c.P;
    if (e === 0) { // standing stones
      for (let i = 0; i < 8; i++) { const a = i * PI / 4 + .2, h = .75 + ((i * 5) % 3) * .2; const o = bx(c.body, i % 2 ? MT.stone : MT.dstone, .3, h, .2, Math.cos(a) * 1.1, 0, Math.sin(a) * 1.1); o.rotation.y = -a + PI / 2; }
      bx(c.roof, MT.stone, 1.0, .16, .26, Math.cos(.2 + PI / 8) * 1.08, .95, Math.sin(.2 + PI / 8) * 1.08).rotation.y = -(.2 + PI / 8) + PI / 2;
      cy(c.body, MT.dstone, .32, .3, 0, 0, 0); bx(c.body, MT.glow, .2, .12, .2, 0, .3, 0); c.chim.push(0, .7, 0);
      sp(c.body, XM.bone, .07, .25, .34, .2); bx(c.body, c.cm, .04, .3, .2, 0, .9, -1.1);
    } else if (e === 1) { // columned shrine
      bx(c.body, P.base, 2.5, .16, 2.3, 0, 0, 0); bx(c.body, P.base, 2.1, .14, 1.9, 0, .16, 0);
      bx(c.body, P.wall, 1.5, .95, 1.2, 0, .3, -.25); bx(c.body, c.cm, 1.52, .08, 1.22, 0, 1.0, -.25);
      bx(c.roof, P.roof, 1.9, .1, 1.9, 0, 1.3, 0); bx(c.roof, P.wall2, 1.7, .08, 1.7, 0, 1.4, 0);
      for (let i = 0; i < 4; i++) { const x = -.75 + i * .5; cy(c.body, P.wall2, .08, 1.0, x, .3, .7); cy(c.body, c.cm, .09, .1, x, .9, .7); cy(c.body, MT.bronze, .095, .05, x, 1.25, .7); }
      bx(c.body, MT.black, .3, .55, .04, 0, .3, .36); mk(G.prism, c.roof, P.wall2, 1.7, .3, .34, 0, 1.48, .78); bx(c.roof, c.cm, .22, .1, .02, 0, 1.53, .955);
      cy(c.body, MT.dstone, .14, .3, 0, .3, 1.0); bx(c.body, MT.glow, .14, .08, .14, 0, .6, 1.0);
    } else if (e === 2) { // chapel with spire
      hall(c, 1.3, 1.0, 2.0, -.3, -.1, .7, false);
      bx(c.body, P.wall, .7, 2.0, .7, .7, 0, .5); bx(c.body, MT.black, .1, .25, .04, .7, 1.5, .86);
      py(c.roof, P.roof, .85, 1.3, .85, .7, 2.0, .5);
      bx(c.roof, MT.gold, .03, .26, .03, .7, 3.3, .5); bx(c.roof, MT.gold, .14, .03, .03, .7, 3.42, .5);
      bx(c.body, MT.glass, .2, .4, .04, -.3, .45, .91); banner(c, -1.25, 0, 1.2, 1.3);
    } else if (e === 3) { // domed
      bx(c.body, P.base, 2.6, .15, 2.6, 0, 0, 0); bx(c.body, P.wall, 2.1, 1.1, 2.1, 0, 0, 0); bx(c.body, P.wall2, 2.16, .08, 2.16, 0, 1.02, 0);
      cy(c.body, P.wall, .8, .35, 0, 1.1, 0); mk(G.dome, c.roof, XM.copper, 1.7, 1.0, 1.7, 0, 1.45, 0); sp(c.roof, MT.gold, .07, 0, 2.5, 0); cy(c.roof, MT.gold, .015, .2, 0, 2.5, 0);
      for (let i = 0; i < 4; i++) { const x = (i & 1 ? 1 : -1) * 1.05, z = (i & 2 ? 1 : -1) * 1.05; cy(c.body, MT.white, .1, 1.9, x, 0, z); mk(G.dome, c.roof, XM.copper, .3, .26, .3, x, 1.9, z); }
      bx(c.body, MT.black, .36, .6, .04, 0, 0, 1.06); bx(c.body, MT.black, .22, .12, .04, 0, .6, 1.06);
      for (let i = 0; i < 2; i++) { bx(c.body, MT.glass, .16, .3, .04, (i ? 1 : -1) * .65, .45, 1.06); bx(c.body, MT.glass, .1, .06, .04, (i ? 1 : -1) * .65, .75, 1.06); }
      bx(c.body, c.cm, .5, .1, .03, 0, .86, 1.07);
    } else { // neoclassical
      bx(c.body, P.base, 2.7, .12, 2.7, 0, 0, 0); bx(c.body, MT.white, 2.4, .12, 2.5, 0, .12, 0);
      bx(c.body, MT.plaster, 1.9, 1.15, 1.6, 0, .24, -.3);
      for (let i = 0; i < 6; i++) cy(c.body, MT.white, .08, 1.15, -1.0 + i * .4, .24, .95);
      bx(c.roof, MT.white, 2.3, .12, 2.4, 0, 1.39, 0);
      mk(G.prism, c.roof, MT.white, 2.3, .5, 2.4, 0, 1.51, 0); mk(G.prism, c.roof, P.roof, 2.36, .5, 2.2, 0, 1.54, -.14);
      sp(c.roof, MT.gold, .09, 0, 2.1, 1.1); bx(c.body, MT.dwood, .36, .7, .04, 0, .24, .51);
      bx(c.body, c.cm, .4, .16, .03, 0, 1.6, 1.21); cy(c.body, MT.iron, .02, .8, 1.25, .12, 1.2); sp(c.body, MT.glow, .06, 1.25, .95, 1.2);
    }
  },
  academy(c) {
    const e = c.era, P = c.P;
    bx(c.body, P.base, 2.7, .1, 2.64, 0, 0, 0);   // (its back sticks out past the hall's back wall)
    hall(c, 2.5, 1.15, 1.3, 0, -.65, .65, true);
    hall(c, .9, 1.35, .7, 0, .2, .5, false, P.wall2);
    if (e === 3) cupola(c, 0, 1.75, .2, .26); else if (e === 4) { bx(c.body, P.wall, .5, 2.3, .5, 0, 0, -.65); mk(G.wheel, c.body, MT.white, .03, .3, .3, 0, 2.0, -.39).rotation.y = PI / 2; py(c.roof, P.roof, .66, .45, .66, 0, 2.3, -.65); }
    else if (e === 2) merlons(c, .9, .7, 0, 1.35, .2);
    cy(c.body, MT.white, .06, 1.0, -.3, .1, .6); cy(c.body, MT.white, .06, 1.0, .3, .1, .6);
    banner(c, -1.2, 0, .35, 1.7); banner(c, 1.0, 0, .35, 1.7);
    // training dummies
    for (let i = 0; i < 2; i++) { const x = -1.0 + i * .45, z = 1.0; cy(c.body, MT.wood, .035, .6, x, 0, z); bx(c.body, MT.hay, .2, .26, .14, x, .3, z); bx(c.body, MT.wood, .46, .05, .05, x, .44, z); sp(c.body, MT.hay, .09, x, .66, z); bx(c.body, c.cm, .12, .14, .15, x, .34, z); }
    // cannon by the door
    const cb = cy(c.body, e >= 4 ? MT.iron : MT.bronze, .07, .7, 0, 0, 0); cb.rotation.x = PI / 2 - .15; cb.position.set(.95, .26, .75);
    mk(G.wheel, c.body, e >= 4 ? MT.iron : MT.wood, .05, .36, .36, .78, .18, .9); mk(G.wheel, c.body, e >= 4 ? MT.iron : MT.wood, .05, .36, .36, 1.12, .18, .9);
    bx(c.body, MT.dwood, .2, .06, .6, .95, .12, .6).rotation.x = -.2;
    for (let i = 0; i < 3; i++) sp(c.body, MT.black, .06, 1.25 - (i === 2 ? .06 : i * .12), i === 2 ? .15 : .06, 1.15);
    bx(c.body, c.cm, .5, .14, .03, 0, 1.05, .56);
  },
  bank(c) {
    const e = c.era, P = c.P, sm = e <= 1 ? P.wall : e === 4 ? MT.stone : P.wall;
    bx(c.body, P.base, 2.7, .14, 2.6, 0, 0, 0); bx(c.body, MT.dstone, 2.45, .14, 2.3, 0, .14, 0);
    bx(c.body, sm, 2.2, 1.3, 1.8, 0, .28, -.2);
    bx(c.body, MT.gold, 2.24, .06, 1.84, 0, 1.3, -.2);
    for (let i = 0; i < 4; i++) { const x = -.9 + i * .6; cy(c.body, e <= 1 ? P.wall2 : MT.white, .1, 1.2, x, .28, .95); bx(c.body, MT.gold, .24, .05, .24, x, 1.43, .95); bx(c.body, MT.dstone, .26, .06, .26, x, .28, .95); }
    bx(c.body, sm, 2.3, .14, 2.3, 0, 1.48, 0);
    if (e === 3) { cy(c.body, sm, .6, .25, 0, 1.62, -.2); mk(G.dome, c.roof, XM.copper, 1.3, .7, 1.3, 0, 1.87, -.2); sp(c.roof, MT.gold, .08, 0, 2.6, -.2); }
    else if (e === 0) { cn(c.roof, P.roof, 1.35, .8, 0, 1.62, 0); sp(c.roof, MT.gold, .08, 0, 2.44, 0); }
    else if (e === 1) { bx(c.roof, P.roof, 2.0, .1, 2.0, 0, 1.62, 0); for (let i = 0; i < 4; i++) bx(c.roof, sm, .3, .2, .3, (i & 1 ? 1 : -1) * 1.0, 1.62, (i & 2 ? 1 : -1) * 1.0); sp(c.roof, MT.gold, .1, 0, 1.82, 0); }
    else { mk(G.prism, c.roof, e === 4 ? MT.white : sm, 2.3, .5, 2.3, 0, 1.62, 0); mk(G.prism, c.roof, P.roof, 2.36, .5, 2.1, 0, 1.65, -.14); sp(c.roof, MT.gold, .08, 0, 2.2, 1.05); if (e === 4) { bx(c.roof, XM.sky, .5, .06, 1.2, 0, 2.02, -.2); } if (e === 2) merlons(c, 2.3, 2.3, 0, 1.62, 0, c.roof); }
    // vault door
    mk(G.wheel, c.body, MT.steel, .08, .7, .7, 0, .68, .72).rotation.y = PI / 2;
    mk(G.wheel, c.body, MT.iron, .1, .5, .5, 0, .68, .73).rotation.y = PI / 2;
    mk(G.wheel, c.body, MT.gold, .14, .16, .16, 0, .68, .74).rotation.y = PI / 2;
    bx(c.body, MT.gold, .34, .03, .04, 0, .665, .8); bx(c.body, MT.gold, .03, .34, .04, 0, .51, .8);
    // gold accents: coin chest + bars
    bx(c.body, MT.dwood, .3, .2, .22, 1.05, .14, 1.0); bx(c.body, MT.gold, .26, .05, .18, 1.05, .34, 1.0);
    for (let i = 0; i < 3; i++) bx(c.body, MT.gold, .16, .06, .08, -1.05, .14 + (i === 2 ? .06 : 0), .95 + (i === 2 ? .05 : i * .1));
    bx(c.body, c.cm, .6, .12, .03, 0, 1.36, .72);
    banner(c, -1.25, .28, 1.1, 1.3);
  },
};

// ---------- joined walls ----------
// neighbour directions, bit i of a link mask: 1=-z 2=+x 4=+z 8=-x
const WDIR = [[0, -1], [1, 0], [0, 1], [-1, 0]];
const LINKS = { wall: 1, gate: 1, tower: 1, castle: 1 };
const MASKED = { wall: 1, gate: 1, tower: 1, rail: 1, dock: 1 };
// a building's own quarter turn (b.rot 0..3, players turn them: view only, footprints are square); pieces whose
// model follows their links / the water / the field layout keep theirs
const NO_TURN = { wall: 1, gate: 1, tower: 1, rail: 1, dock: 1, farm: 1 };
const bYaw = (type, rot) => NO_TURN[type] ? 0 : ((rot | 0) & 3) * PI / 2;
// box from distance a0 to a1 (0 = tile centre, .5 = tile edge) along direction d, width w across it, offset off across it
function wArmBase(p, m, d, a0, a1, w, h, y, off) {
  const L = a1 - a0, ca = (a0 + a1) / 2; off = off || 0;
  return d[0] ? bx(p, m, L + .002, h, w, d[0] * ca, y, off) : bx(p, m, w, h, L + .002, off, y, d[1] * ca);
}
const wArm = wArmBase;
// walls are WALL_T thicker across the line than their design (owner 2026-11-14), stubs and gates follow
const WALL_T = 1.6;   // (2026-11-25: 1.4 -> 1.6 with the taller walls)
// era look: palisade (ages 0-1), stone (2), brick + plaster (3), brick + iron (4).
// pal: stake/stake2 log woods, plank walkway, foot stone footing, band team-colour lashing. Masonry: body/base(plinth)/
// cap(walkway)/line(courses)/acc(blocks of another shade, nAcc of them)/mer(merlons)/merCap/band/quoin(corner strips)/
// roofT(post + gate tower roof)/spire
function wallStyle(c) {
  const e = c.era, P = c.P;
  if (e <= 1) return e === 0
    ? { pal: 1, stake: MT.wood, stake2: WM.log, plank: MT.dwood }
    : { pal: 1, stake: MT.lwood, stake2: MT.wood, plank: MT.wood, foot: P.base, band: c.cm };
  if (e === 2) return { body: MT.stone, base: MT.dstone, cap: MT.dstone, line: MT.dstone, acc: [WM.lstone, WM.mstone], mer: MT.stone, h: .95 };
  if (e === 3) return { body: MT.plaster, base: MT.brick, cap: MT.brick, line: MT.brick, acc: [WM.plaster2], mer: MT.brick, merCap: MT.tile, quoin: MT.brick, roofT: MT.tile, h: 1.0 };
  return { body: P.wall, base: P.base, cap: P.wall2, line: P.wall2, acc: [MT.brick], nAcc: 3, mer: P.wall, merCap: P.wall2, quoin: P.base, roofT: P.roof, spire: MT.iron, h: 1.0 };
}
const WM = { log: mat(0x74512f, .9), lstone: mat(0xaba699, .95), mstone: mat(0x858076, .95), plaster2: mat(0xd6c8a8, .9) };
// faceted wall pieces (flat normals, base at y=0): a sharpened 6-sided log, a prism with a battered (trapezoid)
// cross-section along x, and a square frustum
function flatGeo(tris) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(tris, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(new Float32Array(tris.length / 3 * 2), 2));
  g.computeVertexNormals();
  return g;
}
function frustumGeo(kx, kz) {
  const t = [], b = (sx, sz) => [sx * .5, 0, sz * .5], u = (sx, sz) => [sx * .5 * kx, 1, sz * .5 * kz];
  const q = (a, b2, c2, d) => t.push(...a, ...b2, ...c2, ...a, ...c2, ...d);
  q(u(-1, -1), u(-1, 1), u(1, 1), u(1, -1));            // top
  q(b(-1, 1), b(1, 1), u(1, 1), u(-1, 1));              // +z
  q(b(1, -1), b(-1, -1), u(-1, -1), u(1, -1));          // -z
  q(b(1, 1), b(1, -1), u(1, -1), u(1, 1));              // +x
  q(b(-1, -1), b(-1, 1), u(-1, 1), u(-1, -1));          // -x
  return flatGeo(t);
}
const LOG_GEO = (() => {
  const a = new THREE.CylinderGeometry(.5, .5, .84, 6, 1, true).translate(0, .42, 0).toNonIndexed();
  const b = new THREE.ConeGeometry(.5, .16, 6, 1, true).translate(0, .92, 0).toNonIndexed();
  const p = mergeGeometries([a, b], false).getAttribute('position').array;
  a.dispose(); b.dispose();
  return flatGeo(Array.from(p));
})();
const TRAP_GEO = frustumGeo(1, .78), FRUS_GEO = frustumGeo(.86, .86), SHAFT_GEO = frustumGeo(.9, .9);
// the tower building (owner playtest 2: the old one was a plain box). Design size: about .62 wide, 1.9 to the roof;
// tower() scales it. Palisade ages: a wooden watchtower on four leaning legs, a log parapet, a thatched roof and a
// ladder. Masonry ages: a battered plinth, a slightly tapering shaft with string courses, odd blocks and arrow slits,
// a door, corbels under an overhanging gallery; stone gets merlons, brick + plaster a tiled roof on a drum, brick +
// iron a steep roof and an iron spire. No two faces share a plane (that flickers). Returns the top (banner height).
function towerModel(c) {
  const S = wallStyle(c), rnd = wRand(c.seed * 11 + c.era + 3);
  if (S.pal) {
    const L = .3, top = 1.4, E = L + .15;
    for (let i = 0; i < 4; i++) { const sx = i & 1 ? 1 : -1, sz = i & 2 ? 1 : -1; wLog(c.body, i % 3 ? S.stake : S.stake2, .06, top + .46, sx * L, 0, sz * L, -sz * .06, sx * .06, rnd()); if (S.foot) cy(c.body, S.foot, .11, .1, sx * L, 0, sz * L); }
    for (const s of [-1, 1]) for (const y of [.42, .92]) { bx(c.body, MT.dwood, 2 * L + .06, .05, .05, 0, y, s * (L - .03)); bx(c.body, MT.dwood, .05, .05, 2 * L + .04, s * (L - .03), y + .03, 0); }
    for (const s of [-1, 1]) { const br = bx(c.body, MT.dwood, .04, .62, .04, 0, .4, s * (L - .05)); br.rotation.z = s * .8; const b2 = bx(c.body, MT.dwood, .04, .62, .04, s * (L - .05), .4, 0); b2.rotation.x = s * .8; }
    for (const s of [-1, 1]) bx(c.body, MT.dwood, 2 * E + .04, .06, .08, 0, top - .06, s * (L + .02));   // joists
    bx(c.body, S.plank, 2 * E, .07, 2 * E, 0, top, 0);                                              // platform
    for (let k = 0; k < 4; k++) {                                                                   // log parapet
      const d = WDIR[k];
      for (let j = 0; j < 6; j++) { const a = -E + .1 + j * (2 * E - .2) / 5, x = d[0] ? d[0] * (E - .04) : a, z = d[1] ? d[1] * (E - .04) : a; wLog(c.body, j % 2 ? S.stake : S.stake2, .042, .34 + rnd() * .06, x, top + .07, z, 0, 0, rnd()); }
    }
    if (S.band) for (const s of [-1, 1]) bx(c.body, S.band, 2 * E - .04, .07, .02, 0, top + .2, s * (E - .005));   // team colour lashing
    py(c.roof, c.P.roof, 2 * E + .26, .46, 2 * E + .26, 0, top + .52, 0);                           // thatch
    for (const x of [-.09, .09]) bx(c.body, MT.lwood, .03, top + .05, .03, x, 0, -(L + .1));       // ladder
    for (let y = .18; y < top; y += .2) bx(c.body, MT.lwood, .2, .025, .025, 0, y, -(L + .1));
    return top + .52 + .46;
  }
  const w = .66, H = 1.72, Hb = .3, wb = (y) => w * (1 - .1 * y / H);   // shaft width at height y
  mk(FRUS_GEO, c.body, S.base, w + .24, Hb, w + .24, 0, 0, 0);
  mk(SHAFT_GEO, c.body, S.body, w, H - .02, w, 0, 0, 0);   // (its top stays under the gallery's)
  for (const y of [.62, 1.18]) bx(c.body, S.line, wb(y) + .024, .03, wb(y) + .024, 0, y, 0);   // string courses
  for (let k = 0; k < 7; k++) {   // odd blocks of another shade, on all faces
    const f = WDIR[k % 4], y = .36 + rnd() * 1.1, a = (rnd() - .5) * .36, o = wb(y + .04) / 2 + .002;
    if ((y > .52 && y < .67) || (y > 1.08 && y < 1.23)) continue;   // (clear of the string courses: same plane, flickered)
    if (Math.abs(a) < .12 && ((y > .72 && y < 1.0) || (y > 1.28 && y < 1.56))) continue;   // (and of the arrow slits)
    bx(c.body, S.acc[k % S.acc.length], f[0] ? .02 : .15, .08, f[0] ? .15 : .02, f[0] ? f[0] * o : a, y, f[1] ? f[1] * o : a);
  }
  for (const y of [.8, 1.36]) for (const f of WDIR) {   // arrow slits
    const o = wb(y + .1) / 2 + .004; bx(c.body, MT.black, f[0] ? .02 : .05, .2, f[0] ? .05 : .02, f[0] * o, y, f[1] * o);
  }
  bx(c.body, MT.dwood, .2, .27, .05, 0, 0, (w + .24) / 2 - .02); bx(c.body, S.cap, .28, .05, .06, 0, .27, (w + .24) / 2 - .03);   // door + lintel in the plinth
  const tw = wb(H) / 2;
  for (const f of WDIR) for (const a of [-.21, 0, .21]) bx(c.body, S.cap, f[0] ? .1 : .07, .12, f[0] ? .07 : .1, f[0] ? f[0] * (tw + .04) : a, H - .2, f[1] ? f[1] * (tw + .04) : a);   // corbels
  const G2 = w + .2;
  bx(c.body, S.cap, G2, .08, G2, 0, H - .08, 0);   // gallery floor
  if (S.band) bx(c.body, S.band, G2 + .01, .03, G2 + .01, 0, H - .14, 0);
  // crenellated parapet round the gallery (every masonry age)
  for (let k = 0; k < 4; k++) { const f = WDIR[k], q = G2 / 2 - .04; bx(c.body, S.mer, f[0] ? .08 : G2 - (k & 1 ? .16 : 0), .07, f[0] ? G2 - .002 : .08, f[0] * q, H, f[1] * q); }
  const q = G2 / 2 - .045;
  for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) {
    if (!i && !j) continue;
    const e = !i || !j ? [.13, .1] : [.11, .11];
    bx(c.body, S.mer, i ? .1 : e[0], .17, j ? .1 : e[0], i * q, H + .065, j * q);
    if (S.merCap) bx(c.body, S.merCap, i ? .12 : e[0] + .02, .03, j ? .12 : e[0] + .02, i * q, H + .235, j * q);
  }
  if (!S.roofT) return H + .24;   // stone: an open fighting top
  // brick eras: a narrower drum with windows rises inside the battlements, under a roof
  const dw = wb(H) - .2, dh = .36;
  bx(c.body, S.body, dw, dh, dw, 0, H, 0);
  if (S.quoin) for (let i = 0; i < 4; i++) bx(c.body, S.quoin, .05, dh - .01, .05, (i & 1 ? 1 : -1) * dw / 2, H, (i & 2 ? 1 : -1) * dw / 2);
  for (const f of WDIR) bx(c.body, MT.black, f[0] ? .02 : .09, .13, f[0] ? .09 : .02, f[0] * (dw / 2 + .006), H + .16, f[1] * (dw / 2 + .006));
  bx(c.body, S.cap, dw + .1, .04, dw + .1, 0, H + dh, 0);   // eaves
  const steep = c.era >= 4 ? .56 : .4;
  py(c.roof, S.roofT, dw + .16, steep, dw + .16, 0, H + dh + .04, 0);
  const ry = H + dh + .04 + steep;
  if (S.spire) { cy(c.roof, S.spire, .016, .34, 0, ry - .04, 0); return ry + .3; }
  sp(c.roof, MT.bronze, .04, 0, ry, 0);
  return ry + .04;
}
// small seeded random (segments of one line differ, the same tile always looks the same)
function wRand(seed) { let s = (seed | 0) * 2654435761 + 12345 >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }
// a log standing at (x, y, z): radius r, height h, leaning lx/lz (radians), turned by turn (0..1)
function wLog(p, m, r, h, x, y, z, lx, lz, turn) {
  const o = mk(LOG_GEO, p, m, r * 2, h, r * 2, x, y, z);
  o.rotation.set(lx, turn * PI, lz);
  return o;
}
// battered plinth along direction d from the tile centre to its edge: bottom width w across the line, height h
function wTrap(p, m, d, w, h, a1 = .5) {
  const o = mk(TRAP_GEO, p, m, a1 + .002, h, w, d[0] * a1 / 2, 0, d[1] * a1 / 2);
  if (!d[0]) o.rotation.y = PI / 2;
  return o;
}
// foundation of a wall segment: a row of stakes + scaffold poles, joined along the line
function wallScaf(c, scaf) {
  let m = c.mask & 15; if (!m) m = 10; else if (m === 1 || m === 4) m = 5; else if (m === 2 || m === 8) m = 10;
  cy(scaf, MT.dwood, .05, .3, 0, 0, 0);
  for (let i = 0; i < 4; i++) {
    if (!(m & (1 << i))) continue; const d = WDIR[i];
    for (const a of [.25, .5]) { if (a === .5 && !(d[0] > 0 || d[1] > 0)) continue; cy(scaf, MT.dwood, .05, .3, d[0] * a, 0, d[1] * a); }
    for (const s of [-.48, .48]) { cy(scaf, MT.lwood, .025, 1.3, d[0] ? d[0] * .3 : s, 0, d[1] ? d[1] * .3 : s); wArm(scaf, MT.lwood, d, 0, .5, .03, .03, .7, s); wArm(scaf, MT.lwood, d, 0, .5, .03, .03, 1.15, s); }
    wArm(scaf, MT.lwood, d, 0, .5, .3, .025, .2, 0); // string line
  }
}

// walls and gates: WALL_H x taller on their 1-tile footprint (same thickness everywhere, so straight runs, corners and
// junctions still meet flush); towers grow through their 3x3 footprint instead (data.js BUILDING_SIZES)
const WALL_H = 3.6;   // (owner 2026-11-25: 2.5 -> 3.6, walls had fallen behind the grown buildings)
function bigScale(type, mask) {
  if (type === 'wall') return [1, WALL_H, 1];   // (thickness is built into wall() itself so corners still meet flush)
  if (type !== 'gate') return null;
  const m = mask & 15, alongZ = !!((m & 5) && !(m & 10)), t = WALL_T * .6 / .7;   // the gate's .7 depth -> the wall's thickness
  return alongZ ? [t, WALL_H, 1] : [1, WALL_H, t];
}
// generated wall pieces (see makeBuilding). Sizes are before bigScale stretches walls / gates WALL_H x upward.
const glbKey = (type) => type === 'wall' ? 'wallseg' : type === 'gate' ? 'gatehouse' : type === 'farm' ? 'farmmill' : type;
function glbWall(c, type, era, color) {
  const H = .95, D = .6 * WALL_T;   // the procedural masonry wall's body height and thickness
  if (type === 'gate') {
    const m = c.mask & 15, alongZ = (m & 5) && !(m & 10);
    const gL = !!(c.mask & (alongZ ? 128 : 256)), gR = !!(c.mask & (alongZ ? 32 : 64));
    if (gL !== gR) return;   // an end piece of a 3-wide gate: the middle piece draws the whole gatehouse
    // (depth: bigScale stretches a gate WALL_T * .6 / .7 across the line, so D / that = exactly the wall's thickness)
    // (owner 2026-11-18: the gatehouse sat oddly in its wall. Its towers narrow above their foot, so at their full width
    //  of three tiles they stood a little apart from the walls: it is drawn a bit wider, the towers' sides running into
    //  the wall ends, and a bit deeper, the towers standing proud of the wall faces like a real gatehouse)
    // (the Bronze Age gate keeps its first fit: the owner liked it as it was)
    const k = era >= 2 ? 1 : 0;
    addGlbPiece(c.body, 'gatehouse', era, color, gL ? (k ? 3.22 : 3.02) : (k ? 1.1 : 1.02), 1.5, (k ? 1.2 : 1) * D / (WALL_T * .6 / .7), 0, 0, alongZ ? PI / 2 : 0);
    return;
  }
  const m0 = c.mask & 15; let m = m0; if (!m) m = 10; else if (m === 1 || m === 4) m = 5; else if (m === 2 || m === 8) m = 10;
  const straight = m === 5 || m === 10, post = !straight || (m0 && !(m0 & (m0 - 1)));
  // (pieces overlap their neighbours a little: the models' ends are not perfectly flat, so butted pieces left slits)
  if (!post) { addGlbPiece(c.body, 'wallseg', era, color, 1.08, H, D, 0, 0, m === 5 ? PI / 2 : 0); return; }
  for (let i = 0; i < 4; i++) {
    if (!(m & (1 << i))) continue; const d = WDIR[i];
    addGlbPiece(c.body, 'wallseg', era, color, .58, H, D, d[0] * .25, d[1] * .25, d[0] ? 0 : PI / 2);
  }
  const P = Math.min(.98, .74 * WALL_T);
  addGlbPiece(c.body, 'wallpost', era, color, P, H + .3, P, 0, 0, 0);
}
// a generated tower: scaled evenly to the Bronze Age tower's height (owner 2026-11-17: the Middle and Gunpowder Age
// towers came out huge; a squat model is still stretched up to it), with a wall piece from its foot to the edge of
// its plot toward every linked wall (owner: a tower next to a wall stood apart from it). False if a piece is missing.
const TOWER_FIT = { 1: 1, 4: 1 };   // (owner 2026-11-20: a model fills its plot, no more)
const TOWER_GROW = 1.85;   // (owner 2026-11-25: see glbTower)
function glbTower(c, era, size, color, H) {
  // (.62: about the Bronze Age tower's girth. The Bronze and Industrial models have a wide foot and a shaft under half
  // their width, so they came out toothpick-thin (owner 2026-11-17): they fill the plot instead, squashed to the height)
  // (owner 2026-11-25: towers looked small) every other building grew about 1.4x after 0.9.0 (town center 6 -> 9,
  // barracks 5 -> 7) but the tower kept its 3x3 plot, which walls meet in the middle. The plot stays; the model is drawn
  // 1.4x wider and taller over it
  const T = TOWER_FIT[era], K = TOWER_GROW;
  if (T) addGlbBuilding(c.body, 'tower', era, size * Math.min(K, 1.2), color, T, H * K, 'exact');   // (these fill their plot: wider would cover the walls)
  else addGlbBuilding(c.body, 'tower', era, size * K, color, .62, H * K, true);
  const m = c.mask & 15, u = c.mask & 16 ? 1 / 3 : 1;   // u = one tile in tower units (a 3x3 tower is drawn at 3x)
  let ok = true;
  for (let i = 0; i < 4; i++) {
    if (!(m & (1 << i))) continue; const d = WDIR[i], a0 = .16, a1 = .5 + .02 * u, L = a1 - a0, ca = (a0 + a1) / 2;
    ok = addGlbPiece(c.body, 'wallseg', era, color, L, .95 * WALL_H * u, .6 * WALL_T * u, d[0] * ca, d[1] * ca, d[0] ? 0 : PI / 2) && ok;
  }
  return ok;
}
// generated building models fill their footprint exactly (owner 2026-11-20: the foundation, the selection square and
// the building must match). The models keep the size they had on 2026-11-17 (drawn 1.44x the old footprints, the
// stable 2.16x): the footprints grew to them instead (BUILDING_SIZES, src/data.js), the bank's smaller look is its 5x5.
const glbFit = () => 1;
// height of the procedural 3x3 Bronze Age tower (without its banner), measured once (glb towers take this height)
let TOWER_H1 = 0;
function towerH1() {
  if (!TOWER_H1) {
    const r = makeBuilding('tower', (BUILDINGS.tower && BUILDINGS.tower.baseSize) || 1, 1, 0xffffff, 16, 0, true);
    TOWER_H1 = r.userData.towerH || 2;
    disposeBaked(r);
  }
  return TOWER_H1;
}
// the dock model pushed out along its water side (owner 2026-11-25: on a pond edge and on an open coast alike the
// pier has to stand over the water): stepped out until the tile under the pier tip is water, but never so far that the
// back of the hut leaves the land by more than about a tile
function dockPush(map, e, U, size) {
  // (by the ground height, not the tile type: shallow water down to about -1 still reads as beach on screen)
  const h = (x, z) => { try { return map.heightAt(x, z); } catch (err) { return 0; } };
  // (a pond is shallow all over: then the first shallower depth any side reaches)
  let deep = -1;
  const wet = (x, z) => h(x, z) < deep, dry = (x, z) => h(x, z) > 0;
  let half = size * 1.15 * SEA_K / 2;
  // for one side: the push (in tenths of the size, up to 8) that puts the pier tip over water with the hut's back still
  // on land (-1: none does)
  const need = (ry) => {
    const dx = Math.sin(ry), dz = Math.cos(ry);
    for (let k = 0; k <= 8; k++) {
      const o = size * .1 * k;
      if (k > 0 && !dry(e.x - dx * (half - o - 1), e.z - dz * (half - o - 1))) return -1;   // the hut would float out
      if (wet(e.x + dx * (half - .1 + o), e.z + dz * (half - .1 + o))) return k;
    }
    return -1;
  };
  // the mask's side first; another side only when it needs a shorter push (the pier toward the nearest open water)
  // (SEA_K, owner 2026-11-25: 3x bigger) on a small pond the big model's pier reached over to the far bank and
  // covered the whole pond: there it is drawn smaller, the first size (SEA_K, halfway, 1x) whose pier finds water
  let ry = U.dockRy, best = -1, sk = SEA_K;
  for (const k0 of [SEA_K, (SEA_K + 1) / 2, 1]) {
    sk = k0; half = size * 1.15 * k0 / 2;
    for (const d of [-1, -.5, -.3, -.15]) {
      deep = d; ry = U.dockRy; best = need(ry);
      for (const r of [Math.PI, Math.PI / 2, 0, -Math.PI / 2]) {
        if (r === U.dockRy) continue;
        const k = need(r);
        if (k >= 0 && (best < 0 || k < best)) { best = k; ry = r; }
      }
      if (best >= 0) break;
    }
    if (best >= 0) break;
  }
  if (best < 0) { ry = U.dockRy; sk = SEA_K; }
  if (sk !== SEA_K) U.dockM.scale.multiplyScalar(sk / SEA_K);
  const off = size * .1 * Math.max(0, best);
  U.dockM.rotation.y = ry;
  U.dockM.position.x += Math.sin(ry) * off; U.dockM.position.z += Math.cos(ry) * off;
}
function makeBuilding(type, size, age, color, mask, seed, noGlb) {
  const root = new THREE.Group();
  const era = Math.max(0, Math.min(4, age | 0));
  const t = era <= 1 ? 0 : era - 1;
  const body = new THREE.Group(), roof = new THREE.Group(), slab = new THREE.Group(), scaf = new THREE.Group();
  root.add(slab, body, roof, scaf);
  const c = { body, roof, P: PAL[era], t, era, s: size, cm: mat(color, .8, 0), chim: [], spin: null, mask: mask | 0, seed: seed | 0 };
  const U = root.userData;
  if (type === 'farm' && size >= 9) {
    // the big farm: 3x3 cells, a granary in the middle, 8 plots around it (ring order = sim FARM_CELLS)
    const P = size / 3;
    // everything sits almost flush with the ground: worn dirt paths between the plots, no raised blocks
    bx(slab, FM.path, size * .985, .7, size * .985, 0, -.685, 0);                       // trodden paths (top +.015)
    bx(slab, FM.yard, P * .9, .7, P * .9, 0, -.675, 0);                                 // yard round the granary (top +.025)
    const furs = [], fur = new THREE.Group(); root.add(fur);
    FARM_CELLS_R.forEach(([cx, cz], i) => {
      const ox = (cx - 1) * P, oz = (cz - 1) * P, w = P * PLOT_W;   // (owner 2026-11-17: narrow paths, a field not a garden)
      bx(slab, FM.bank, w + .06, .7, w + .06, ox, -.678, oz);                            // grassy bank round the plot
      bx(slab, FM.soil, w, .7, w, ox, -.675, oz);                                        // tilled soil (top +.025)
      const g = new THREE.Group(); fur.add(g);
      for (let r = 0; r < FROWS; r++) bx(g, FM.ridge, w / FROWS * .55, .035, w * .94, ox - w / 2 + (r + .5) * w / FROWS, .01, oz);   // ridges the crops grow on
      bake(g); furs.push(g);
    });
    // low fence along the outside, a gap in the middle of every side
    for (const s of [-1, 1]) for (const along of [0, 1]) {
      for (const seg of [-1, 1]) {
        const a0 = seg * size * .25, x = along ? a0 : s * size * .495, z = along ? s * size * .495 : a0;
        bx(slab, MT.wood, along ? size * .4 : .05, .04, along ? .05 : size * .4, x, .3, z);
        bx(slab, MT.wood, along ? size * .4 : .05, .04, along ? .05 : size * .4, x, .16, z);
        for (const e of [-1, 0, 1]) cy(slab, MT.dwood, .045, .38, along ? a0 + e * size * .2 : x, 0, along ? z : a0 + e * size * .2);
      }
    }
    // the granary with sacks and barrels by its doors
    // the farm's middle building is the mill (owner 2026-11-14: the mill's upgrades live here; its look too):
    // the same model the mill building has in this era, sails/wheel turning, with sacks and a hay bale by it
    if (!noGlb && hasGlb('farmmill', era)) { addGlbBuilding(c.body, 'farmmill', era, P * .82 * 1.5, color); U.glb = true; }   // (owner 2026-11-20: the mill keeps its big 2026-11-17 look)   // (generated granary / mill, glb-models.js)
    else BUILD.mill(c);
    bx(c.body, MT.hay, .5, .28, .5, 1.35, 0, -1.35); bx(c.body, MT.canvas, .26, .2, .2, -1.4, 0, 1.3); bx(c.body, MT.canvas, .22, .18, .2, -1.15, 0, 1.45);
    const crops = new THREE.InstancedMesh(TUFT, CROP_MAT, FARM_CELLS_R.length * FROWS * FPER);
    crops.castShadow = true; crops.receiveShadow = true; crops.frustumCulled = false; crops.count = 0;
    root.add(crops);
    U.fur = fur; U.furs = furs; U.crops = crops; U.plotted = true; U.plotSize = P;
  } else if (type === 'farm') {
    bx(slab, MT.soil, size * .96, .7, size * .96, 0, -.62, 0);
    for (let i = 0; i < 4; i++) cy(slab, MT.dwood, .04, .3, (i & 1 ? 1 : -1) * size * .47, .05, (i & 2 ? 1 : -1) * size * .47);
    for (let i = 0; i < 2; i++) { bx(slab, MT.wood, size * .94, .03, .03, 0, .25, (i ? 1 : -1) * size * .47); }
    bx(slab, c.cm, .12, .1, .02, -size * .47, .36, size * .47);
    const fur = new THREE.Group(); root.add(fur);
    for (let i = 0; i < 6; i++) bx(fur, MT.soil2, .2, .06, size * .86, -size * .43 + .22 + i * (size * .86 - .44) / 5, .08, 0);
    bake(fur);
    const crops = new THREE.InstancedMesh(G.box, MT.sprout, 72);
    crops.castShadow = true; crops.receiveShadow = true; crops.frustumCulled = false; crops.count = 0;
    root.add(crops);
    U.fur = fur; U.crops = crops;
  } else {
    if (type === 'wall' || type === 'gate') { const pal = type === 'wall' && era <= 1, k = pal ? .14 : .8; bx(slab, pal ? MT.dwood : c.P.base, size * k, .7, size * k, 0, -.66, 0); } // arms carry their own footing: keep the slab hidden under the core (a palisade's log row is thin)
    else if (type === 'tower' && era <= 1) bx(slab, MT.dwood, size * .14, .7, size * .14, 0, -.66, 0);   // a watchtower stands on its legs (no stone plate)
    else bx(slab, c.P.base, size * .94, .7, size * .94, 0, -.64, 0);
    // (a building drawn from a generated model below skips the procedural one: it was built and thrown away)
    const glbNext = !noGlb && !SEA_BUILD[type] && hasGlb((type === 'wall' || type === 'gate') ? glbKey(type) : type, era);
    if (!glbNext) try { if (SEA_BUILD[type]) { SEA_BUILD[type](c); if (c.noSlab) slab.clear(); if (c.live) { root.add(c.live); U.live = c.live; } } else (BUILD[type] || BUILD.house)(c); }
    catch (err) {
      console.warn('[entities] building model failed:', type, era, err);
      body.clear(); roof.clear(); c.chim.length = 0; c.spin = null;
      bx(body, c.P.wall, size * .8, .8, size * .8, 0, 0, 0); py(roof, c.P.roof, size * .9, .5, size * .9, 0, .8, 0);
      bx(body, c.cm, .3, .2, .03, 0, .5, size * .4 + .01);
    }
    // walls and gates from generated pieces (glb-models.js), laid out like the procedural ones: a straight run is one
    // wall piece, a corner / junction / end a small tower with a half piece toward every linked neighbour; a 3-wide
    // gate is one gatehouse drawn by its middle piece (the two end pieces stay empty, a lone gate gets a short one)
    if (!noGlb && (type === 'wall' || type === 'gate') && hasGlb(glbKey(type), era)) {
      body.clear(); roof.clear(); c.chim.length = 0; c.spin = null;
      if (type === 'gate' && era >= 2) slab.clear();   // (its plate showed under the open arch, owner 2026-11-18)
      glbWall(c, type, era, color);
      U.glb = true;
    }
    // the dock's generated model (glb-models.js, sea set), its pier turned to the water like the procedural one
    if (type === 'dock' && !noGlb) {
      try { loadSea(); } catch (err) { /* procedural dock */ }
      if (hasSea(dockFile(era))) {
        body.clear(); roof.clear(); slab.clear(); c.chim.length = 0; c.spin = null;
        let d = 2; for (let i = 0; i < 4; i++) if ((mask & 15) === 1 << i) d = i;
        const ry = [Math.PI, Math.PI / 2, 0, -Math.PI / 2][d], dm = addSeaModel(body, dockFile(era), color, size * 1.15 * SEA_K, -.35, ry);
        // (owner 2026-11-25: "biraz daha suya doğru") the model is pushed out over the water side
        // (owner 2026-11-25, open sea: a dock mostly on water floated out) how far depends on the land in its footprint,
        // set by EntityView (dockPush) once the map is known; U.dockM / U.dockRy carry the mesh and its turn
        if (dm) { U.dockM = dm; U.dockRy = ry; }
        U.glb = true;
      }
    }
    // a generated 3D model for this type and era (glb-models.js): it replaces the procedural body, roof and pad
    // (the model stands on its own grass base); chimney smoke and spinning parts belong to the old model
    else if (!noGlb && hasGlb(type, era)) {
      // towers keep the procedural tower's height in every age (owner 2026-11-17: the models came out short):
      // the model is stretched upward to it
      // (owner 2026-11-17: the Bronze Age tower's height is right; the later procedural towers grow too tall, so every
      // age's tower model takes the Bronze Age one's height)
      const tall = type === 'tower' ? towerH1() : 0;
      body.clear(); roof.clear(); slab.clear(); c.chim.length = 0; c.spin = null;
      if (type === 'tower') U.glb = glbTower(c, era, size, color, tall);
      else { addGlbBuilding(body, type, era, size, color, glbFit(type), tall); U.glb = true; }
    }
    const hs = size * .46;
    if (type === 'wall') { wallScaf(c, scaf); U.wallScaf = true; }
    else if (type === 'rail') { /* light site: the gravel bed and sleepers just rise, no scaffold poles */ }
    else if (type === 'pasture') { // light site: low corner stakes and a marking string, no tall scaffold
      for (let i = 0; i < 4; i++) cy(scaf, MT.lwood, .03, .35, (i & 1 ? 1 : -1) * hs, 0, (i & 2 ? 1 : -1) * hs);
      for (const sg of [-1, 1]) { bx(scaf, MT.lwood, size * .92, .015, .015, 0, .28, sg * hs); bx(scaf, MT.lwood, .015, .015, size * .92, sg * hs, .28, 0); }
    } else {
      for (let i = 0; i < 4; i++) {
        cy(scaf, MT.lwood, .03, 1.5, (i & 1 ? 1 : -1) * hs, 0, (i & 2 ? 1 : -1) * hs);
      }
      bx(scaf, MT.lwood, size * .92, .03, .03, 0, .7, hs); bx(scaf, MT.lwood, size * .92, .03, .03, 0, 1.2, -hs);
      bx(scaf, MT.lwood, .03, .03, size * .92, hs, .9, 0); bx(scaf, MT.lwood, .03, .03, size * .92, -hs, 1.3, 0);
    }
    bake(scaf);
  }
  // walls and gates stand 3x taller (bigScale). Baked into the geometry, so animations that set the
  // group scales (construction rise, finish bounce) are unaffected.
  const big = bigScale(type, mask);
  if (big) for (const g of [body, roof, scaf]) g.scale.set(big[0], big[1], big[2]);
  bake(slab); bake(body); bake(roof); if (big) bake(scaf);   // (scaffold too: it rises with the wall)
  if (big) for (const g of [body, roof, scaf]) g.scale.set(1, 1, 1);
  U.slab = slab; U.body = body; U.roof = roof; U.scaf = scaf; U.chim = c.chim; U.spin = null; U.towerH = c.towerH || 0;
  if (c.spin) {
    try {
      const sg = c.spin.g; bake(sg);
      sg.position.set(c.spin.x, c.spin.y, c.spin.z); root.add(sg);
      U.spin = sg; U.spinAxis = c.spin.axis; U.spinSpeed = c.spin.speed;
    } catch (err) { U.spin = null; }
  }
  return root;
}

// ---------- resources ----------
// Stone and gold deposits (owner 2026-11-14: they read as scattered pebbles): every tile is a chunky clump of
// faceted boulders, so a compact group of tiles reads as one mine. Gold: dark ore rock with veins of bright gold
// nuggets that glint now and then. Cheap: a few variants per type are built once and shared (one vertex-coloured
// rock mesh + one gold mesh per tile, never disposed per entity).
const MINE_VARIANTS = 4;
const MINE_T = { value: 0 };   // glint clock (EntityView.update)
const MINE_ROCK = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .93, metalness: 0, flatShading: true });
const MINE_GOLD = (() => {
  const m = new THREE.MeshStandardMaterial({ color: 0xffc634, roughness: .3, metalness: .75, emissive: 0x7a5208, emissiveIntensity: .55, flatShading: true });
  m.onBeforeCompile = (sh) => {
    sh.uniforms.uMineT = MINE_T;
    sh.vertexShader = 'varying vec3 vMineW;\n' + sh.vertexShader.replace('#include <project_vertex>', '#include <project_vertex>\nvMineW = (modelMatrix * vec4(transformed, 1.0)).xyz;');
    // a short bright glint per nugget, each at its own moment (phase from the world position)
    sh.fragmentShader = 'uniform float uMineT;\nvarying vec3 vMineW;\n' + sh.fragmentShader.replace('#include <emissivemap_fragment>',
      '#include <emissivemap_fragment>\nfloat gl1 = pow(max(sin(uMineT * 1.7 + dot(floor(vMineW * 6.0), vec3(1.31, 2.17, 0.73))), 0.0), 40.0);\ntotalEmissiveRadiance += vec3(1.0, 0.86, 0.45) * gl1 * 1.6;');
  };
  m.customProgramCacheKey = () => 'aevum_mine_gold';
  return m;
})();
const MINE_GEO = new Map();
function mineGeo(type, variant) {
  const key = type + variant;
  let r = MINE_GEO.get(key);
  if (r) return r;
  let s = (variant * 7919 + (type === 'gold' ? 104729 : 31337)) % 233280;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  const gold = type === 'gold';
  const rock = [], ore = [], m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler(), c = new THREE.Color();
  const tones = gold ? [0x766a5a, 0x655b4e, 0x857660, 0x5a5146] : [0x9a9a95, 0x84868a, 0xaba9a1, 0x75777b];
  // one boulder: a faceted dodecahedron, each face its own shade (light from above, darker underneath)
  const stone = (sx, sy, sz, x, y, z, tone) => {
    const g = G.rock.index ? G.rock.toNonIndexed() : G.rock.clone();
    e.set(rnd() * 3, rnd() * 6.28, rnd() * 3); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)); g.applyMatrix4(m);
    g.computeVertexNormals();
    const n = g.attributes.normal.array, cnt = g.attributes.position.count, col = new Float32Array(cnt * 3);
    for (let f = 0; f < cnt; f += 3) {
      c.setHex(tones[tone]);
      const k = .82 + rnd() * .2 + n[f * 3 + 1] * .1;
      for (let v = 0; v < 3; v++) { col[(f + v) * 3] = c.r * k; col[(f + v) * 3 + 1] = c.g * k; col[(f + v) * 3 + 2] = c.b * k; }
    }
    g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    g.deleteAttribute('uv');
    rock.push(g);
  };
  const nugget = (r, x, y, z) => {
    const g = G.rock.index ? G.rock.toNonIndexed() : G.rock.clone();
    e.set(rnd() * 3, rnd() * 3, rnd() * 3); q.setFromEuler(e);
    m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(r * 2, r * 1.6, r * 2)); g.applyMatrix4(m);
    g.deleteAttribute('uv');
    ore.push(g);
  };
  // the main boulder fills most of the tile; two or three more around it; rubble at the foot
  const bw = .92 + rnd() * .18, bh = .62 + rnd() * .22, bd = .82 + rnd() * .16;
  stone(bw, bh, bd, (rnd() - .5) * .1, bh * .3, (rnd() - .5) * .1, 0);
  const side = 2 + (rnd() < .5 ? 1 : 0), a0 = rnd() * 6.28;
  const sides = [];
  for (let i = 0; i < side; i++) {
    const a = a0 + i * 6.28 / side + (rnd() - .5) * .6, d = .36 + rnd() * .1, w = .42 + rnd() * .2, h = .34 + rnd() * .22;
    const x = Math.cos(a) * d, z = Math.sin(a) * d;
    stone(w, h, w * (.8 + rnd() * .3), x, h * .28, z, 1 + (i % 3));
    sides.push([x, h, z, w]);
  }
  for (let i = 0; i < 4; i++) { const a = rnd() * 6.28, d = .42 + rnd() * .1, r = .12 + rnd() * .08; stone(r * 1.3, r, r * 1.2, Math.cos(a) * d, r * .25, Math.sin(a) * d, (i + 1) & 3); }
  if (!gold && variant % 2 === 0) {   // a quarry: a couple of cut blocks next to the rock
    const a = a0 + 3.14 / side, x = Math.cos(a) * .4, z = Math.sin(a) * .4;
    const blk = (w, h, d, bx, by, bz, ry) => {
      const g = G.box.toNonIndexed(); q.setFromEuler(e.set(0, ry, 0));
      m.compose(new THREE.Vector3(bx, by, bz), q, new THREE.Vector3(w, h, d)); g.applyMatrix4(m);
      const cnt = g.attributes.position.count, col = new Float32Array(cnt * 3), n = g.attributes.normal.array;
      for (let v = 0; v < cnt; v++) { c.setHex(0xc9c2b2); const k = .86 + n[v * 3 + 1] * .12; col[v * 3] = c.r * k; col[v * 3 + 1] = c.g * k; col[v * 3 + 2] = c.b * k; }
      g.setAttribute('color', new THREE.BufferAttribute(col, 3)); g.deleteAttribute('uv'); rock.push(g);
    };
    blk(.22, .16, .16, x, 0, z, a); blk(.2, .14, .15, x + .05, .16, z - .02, a + .4);
  }
  if (gold) {
    // veins: rows of nuggets running over the boulder's upper surface (an arc on its ellipsoid), plus a few
    // set in the side rocks and lying at the foot
    const veins = 2 + (rnd() < .5 ? 1 : 0);
    for (let v = 0; v < veins; v++) {
      const az = rnd() * 6.28, tilt = (rnd() - .5) * 1.2, steps = 6 + ((rnd() * 3) | 0);
      for (let i = 0; i < steps; i++) {
        const t = (i / (steps - 1) - .5) * 2.0, th = .35 + Math.abs(t) * .75, ph = az + t * .9 + tilt * t * t;
        const x = Math.cos(ph) * Math.sin(th) * bw * .47, z = Math.sin(ph) * Math.sin(th) * bd * .47, y = bh * .3 + Math.cos(th) * bh * .47;
        nugget(.045 + rnd() * .035, x, y, z);
      }
    }
    for (const [x, h, z, w] of sides) { nugget(.05 + rnd() * .03, x, h * .28 + h * .4, z); nugget(.04 + rnd() * .02, x + w * .25, h * .28 + h * .25, z + w * .1); }
    for (let i = 0; i < 4; i++) { const a = rnd() * 6.28, d = .38 + rnd() * .14; nugget(.04 + rnd() * .03, Math.cos(a) * d, .03, Math.sin(a) * d); }
  }
  r = { rock: mergeGeometries(rock, false), ore: ore.length ? mergeGeometries(ore, false) : null };
  for (const g of rock) g.dispose(); for (const g of ore) g.dispose();
  if (r.ore) r.ore.computeVertexNormals();
  MINE_GEO.set(key, r);
  return r;
}
function makeMine(e, g) {
  const v = mineGeo(e.type, ((e.variant | 0) + e.id) % MINE_VARIANTS);
  const a = new THREE.Mesh(v.rock, MINE_ROCK); a.castShadow = true; a.receiveShadow = true; g.add(a);
  if (v.ore) { const b = new THREE.Mesh(v.ore, MINE_GOLD); b.castShadow = false; b.receiveShadow = true; g.add(b); }
}

function makeResource(e) {
  const root = new THREE.Group(), g = new THREE.Group(); root.add(g);
  let s = (e.id * 9301 + 49297) % 233280;
  const rnd = () => { s = (s * 9301 + 49297) % 233280; return s / 233280; };
  if (e.type === 'fish') { try { return makeFish(e); } catch (err) { /* fall through to a plain marker */ } }
  if (e.type === 'stone' || e.type === 'gold') {
    try { makeMine(e, g); root.userData.g = g; return root; }   // (shared geometry: not baked, not disposed)
    catch (err) { g.clear(); for (let i = 0; i < 3; i++) mk(G.rock, g, MT.stone, .7, .5, .6, (i - 1) * .3, .15, 0); }
  } else if (e.type === 'berries') {
    for (let i = 0; i < 4; i++) { const a = i * 1.57 + rnd(); sp(g, i % 2 ? MT.green : MT.dgreen, .26 + rnd() * .08, Math.cos(a) * .17, .22 + rnd() * .1, Math.sin(a) * .17); }
    for (let i = 0; i < 12; i++) { const a = rnd() * 6.28, d = .2 + rnd() * .22; sp(g, MT.berry, .04, Math.cos(a) * d, .25 + rnd() * .25, Math.sin(a) * d); }
  }
  bake(g);
  root.userData.g = g;
  return root;
}

// ---------- units ----------
const KIT = {
  villager: { villager: 1 },
  spearman: { weapon: 'spear', shield: 1, helm: 'cap' },
  swordsman: { weapon: 'sword', shield: 1, helm: 'bronze' },
  archer: { weapon: 'bow', helm: 'hood' },
  heavyinf: { armor: 1, weapon: 'sword', shield: 1, helm: 'steel', plume: 1 },
  crossbow: { weapon: 'xbow', helm: 'steel' },
  longbow: { weapon: 'bow', helm: 'hood', legs: 0x3d5a2e },
  sharpshooter: { weapon: 'gun', helm: 'hood', legs: 0x4a5236 },
  bayonet: { weapon: 'spear', shield: 1, helm: 'kepi', legs: 0x22324f },
  guardsman: { armor: 1, weapon: 'sword', shield: 1, helm: 'steel', plume: 1, legs: 0x5a1f1f },
  musketeer: { weapon: 'gun', helm: 'hat' },
  rifleman: { weapon: 'gun', helm: 'kepi', legs: 0x2f3540 },
  lightcav: { cav: 1, weapon: 'spear', helm: 'cap', coat: 0x8a5a35 },
  knight: { cav: 1, armor: 1, weapon: 'spear', shield: 1, helm: 'steel', plume: 1, coat: 0x54453a, barding: 1 },
  cuirassier: { cav: 1, armor: 1, weapon: 'sword', helm: 'hat', coat: 0x2a2420 },
  healer: { healer: 1 },
};
const CARRY_M = { wood: MT.wood, food: MT.red, stone: MT.stone, gold: MT.gold };

function makeHuman(g, color, k, P, age) {
  const A = Math.max(0, Math.min(4, age | 0)), V = !!k.villager;
  if (k.healer) return makeHealer(g, color, P, A);
  const cloth = mat(color, .85, 0);
  const legM = A <= 1 ? MT.skin : A === 2 ? XM.hose : mat(k.legs || (A === 4 ? 0x2f3540 : 0x5a4632), .9);
  let torsoM, armM;
  if (V) { torsoM = A === 0 ? XM.fur : A === 1 ? XM.linen : A === 4 ? MT.white : cloth; armM = A <= 1 ? MT.skin : A === 4 ? MT.white : cloth; }
  else if (A === 0) { torsoM = XM.hide; armM = MT.skin; }
  else if (A === 1) { torsoM = k.armor ? MT.bronze : cloth; armM = MT.skin; }
  else if (A === 2) { torsoM = k.armor ? MT.steel : XM.mail; armM = torsoM; }
  else if (A === 3) { torsoM = MT.steel; armM = cloth; }
  else { torsoM = k.armor ? MT.steel : cloth; armM = cloth; }
  P.legL = piv(g, .075, .38, 0); bx(P.legL, legM, .1, .38, .11, 0, -.38, 0);
  P.legR = piv(g, -.075, .38, 0); bx(P.legR, legM, .1, .38, .11, 0, -.38, 0);
  if (A >= 3) { bx(P.legL, MT.black, .11, .14, .12, 0, -.38, 0); bx(P.legR, MT.black, .11, .14, .12, 0, -.38, 0); }
  else if (A === 0) { bx(P.legL, XM.fur, .11, .08, .12, 0, -.38, 0); bx(P.legR, XM.fur, .11, .08, .12, 0, -.38, 0); }
  P.torso = piv(g, 0, .38, 0); bx(P.torso, torsoM, .3, .36, .18, 0, 0, 0);
  bx(P.torso, A === 1 && !V ? MT.bronze : MT.leather, .315, .04, .2, 0, .06, 0);   // belt (no side flush with the torso or a band)
  if (A <= 1) bx(P.torso, A === 0 ? (V ? XM.fur : XM.hide) : (V ? XM.linen : cloth), .32, .13, .2, 0, -.1, 0);
  // owner colour stays readable in every age
  if (A === 0) { const sh = bx(P.torso, cloth, .08, .4, .195, .13, .0, 0); sh.rotation.z = .6; }
  else if (A === 1) { if (V || k.armor) bx(P.torso, cloth, .31, .06, .195, 0, .13, 0); }
  else if (A === 2) { if (!V) bx(P.torso, cloth, .15, .3, .195, 0, .03, 0); }
  else if (A === 3) { if (V) bx(P.torso, MT.white, .2, .04, .2, 0, .33, 0); else { bx(P.torso, cloth, .33, .09, .205, 0, -.02, 0); if (k.armor) bx(P.torso, MT.gold, .04, .2, .19, 0, .12, 0); } }
  else if (V) { bx(P.torso, cloth, .1, .3, .195, .105, .03, 0); bx(P.torso, cloth, .1, .3, .195, -.105, .03, 0); bx(P.torso, cloth, .31, .3, .05, 0, .03, -.07); }
  else { const b1 = bx(P.torso, MT.white, .045, .4, .195, .13, .0, 0); b1.rotation.z = .6; bx(P.torso, MT.gold, .03, .22, .19, 0, .08, 0); bx(P.torso, MT.leather, .2, .18, .07, 0, .12, -.12); }
  P.head = piv(P.torso, 0, .37, 0); bx(P.head, MT.skin, .17, .17, .17, 0, 0, 0);
  let hs;
  if (V) hs = 'v' + A;
  else if (A === 0) hs = 'hide';
  else if (A === 1) hs = 'bronze';
  else if (A === 2) hs = k.armor ? 'great' : k.helm === 'hood' ? 'hood' : 'kettle';
  else if (A === 3) hs = k.helm === 'hat' ? 'hat' : 'morion';
  else hs = k.helm === 'kepi' ? 'kepi' : 'shako';
  if (hs === 'v0') bx(P.head, XM.hair, .18, .05, .18, 0, .15, 0);
  else if (hs === 'v1') { bx(P.head, XM.hair, .18, .04, .18, 0, .15, 0); bx(P.head, cloth, .185, .035, .185, 0, .1, 0); }
  else if (hs === 'v2' || hs === 'hood') { bx(P.head, cloth, .19, .09, .19, 0, .12, -.01); bx(P.head, cloth, .19, .16, .04, 0, 0, -.09); }
  else if (hs === 'v3') { cy(P.head, MT.leather, .17, .02, 0, .16, 0); cy(P.head, MT.leather, .085, .07, 0, .17, 0); bx(P.head, cloth, .175, .02, .175, 0, .18, 0); }
  else if (hs === 'v4') { bx(P.head, XM.capg, .19, .045, .2, 0, .16, .01); bx(P.head, XM.capg, .14, .015, .06, 0, .16, .12); }
  else if (hs === 'hide') { bx(P.head, MT.leather, .18, .06, .18, 0, .14, 0); bx(P.head, XM.bone, .03, .08, .03, .08, .18, 0); bx(P.head, XM.bone, .03, .08, .03, -.08, .18, 0); }
  else if (hs === 'bronze') { mk(G.dome, P.head, MT.bronze, .21, .2, .21, 0, .1, 0); bx(P.head, cloth, .03, .1, .17, 0, .27, -.01); bx(P.head, MT.bronze, .03, .1, .02, 0, .03, .09); }
  else if (hs === 'kettle') { mk(G.dome, P.head, MT.steel, .2, .14, .2, 0, .12, 0); cy(P.head, MT.steel, .145, .015, 0, .115, 0); }
  else if (hs === 'great') { bx(P.head, MT.steel, .2, .22, .2, 0, -.02, 0); bx(P.head, MT.black, .14, .02, .01, 0, .1, .1); bx(P.head, MT.gold, .02, .14, .01, 0, .02, .101); if (k.plume) bx(P.head, cloth, .04, .12, .14, 0, .2, -.02); }
  else if (hs === 'morion') { mk(G.dome, P.head, MT.steel, .2, .16, .2, 0, .11, 0); bx(P.head, MT.steel, .18, .015, .32, 0, .11, 0); bx(P.head, MT.steel, .02, .05, .2, 0, .25, 0); if (k.plume) bx(P.head, cloth, .04, .12, .1, 0, .28, -.06); }
  else if (hs === 'hat') { cy(P.head, MT.black, .16, .02, 0, .16, 0); cy(P.head, MT.black, .085, .08, 0, .17, 0); bx(P.head, cloth, .03, .1, .03, .07, .2, 0); }
  else if (hs === 'kepi') { cy(P.head, cloth, .09, .08, 0, .16, 0); bx(P.head, MT.black, .12, .015, .08, 0, .16, .1); }
  else { cy(P.head, MT.black, .085, .15, 0, .16, 0); bx(P.head, MT.black, .12, .015, .07, 0, .16, .1); sp(P.head, cloth, .035, 0, .34, 0); bx(P.head, MT.gold, .05, .05, .01, 0, .2, .086); }
  P.armL = piv(P.torso, .2, .33, 0); bx(P.armL, armM, .085, .32, .085, 0, -.32, 0); bx(P.armL, MT.skin, .07, .06, .07, 0, -.36, 0);
  P.armR = piv(P.torso, -.2, .33, 0); bx(P.armR, armM, .085, .32, .085, 0, -.32, 0); bx(P.armR, MT.skin, .07, .06, .07, 0, -.36, 0);
  if (!V && A === 1) { bx(P.armL, MT.bronze, .095, .08, .095, 0, -.3, 0); bx(P.armR, MT.bronze, .095, .08, .095, 0, -.3, 0); }
  if (A === 4 && !V) { bx(P.armL, MT.white, .095, .04, .095, 0, -.31, 0); bx(P.armR, MT.white, .095, .04, .095, 0, -.31, 0); }
  const w = k.weapon, wm = A === 0 ? MT.stone : A === 1 ? MT.bronze : MT.steel;
  if (w === 'spear') { cy(P.armR, MT.wood, .014, 1.2, 0, -.9, .03); cn(P.armR, wm, .03, .14, 0, -.9, .03).rotation.x = PI; if (A >= 3) bx(P.armR, cloth, .02, .08, .1, 0, -.72, .08); }
  else if (w === 'sword') { bx(P.armR, wm, A === 0 ? .04 : .025, .05, A === 0 ? .36 : .46, 0, -.36, A === 0 ? .22 : .27); bx(P.armR, A === 0 ? MT.wood : A >= 3 ? MT.gold : MT.bronze, .12, .03, .03, 0, -.35, .05); }
  else if (w === 'bow') { mk(G.bow, P.armL, MT.wood, 1.3, 1.3, 1.3, 0, -.34, 0); P.bow = 1; bx(P.torso, MT.leather, .08, .28, .06, -.06, .08, -.12); }
  else if (w === 'xbow') { bx(P.armR, MT.wood, .04, .42, .05, 0, -.72, 0); bx(P.armR, MT.steel, .34, .03, .03, 0, -.7, 0); P.gun = 1; }
  else if (w === 'gun') { bx(P.armR, MT.wood, .04, .3, .05, 0, -.5, 0); cy(P.armR, MT.iron, .014, .42, 0, -.9, 0); if (A >= 4) cn(P.armR, MT.steel, .012, .12, 0, -.9, 0).rotation.x = PI; P.gun = 1; }
  if (k.shield) {
    if (A === 0) { mk(G.wheel, P.armL, MT.dwood, .03, .3, .3, .07, -.24, .02); bx(P.armL, XM.hide, .035, .14, .14, .072, -.31, .02); }
    else if (A === 1) { mk(G.wheel, P.armL, MT.bronze, .03, .34, .34, .07, -.24, .02); mk(G.wheel, P.armL, cloth, .036, .25, .25, .07, -.24, .02); sp(P.armL, MT.bronze, .035, .09, -.24, .02); }
    else if (A === 2) { bx(P.armL, MT.wood, .035, .3, .26, .065, -.36, .02); bx(P.armL, MT.wood, .035, .08, .15, .065, -.43, .02); bx(P.armL, cloth, .04, .2, .2, .07, -.31, .02); bx(P.armL, MT.white, .05, .2, .04, .07, -.31, .02); }
    else if (A === 3) { mk(G.wheel, P.armL, MT.steel, .03, .22, .22, .07, -.26, .02); sp(P.armL, MT.gold, .03, .085, -.26, .02); }
  }
  if (V) {
    P.tools = {};
    const names = ['axe', 'pick', 'hoe', 'hammer'];
    const hm = A === 0 ? MT.stone : A === 1 ? MT.bronze : null;
    for (let i = 0; i < 4; i++) {
      const tg = piv(P.armR, 0, -.34, 0); tg.visible = false; P.tools[names[i]] = tg;
      bx(tg, A === 0 ? MT.dwood : MT.wood, .028, .028, .42, 0, -.014, .2);
      if (i === 0) bx(tg, hm || MT.steel, .025, .14, .1, 0, -.1, .36);
      else if (i === 1) bx(tg, hm || MT.iron, .03, .32, .04, 0, -.16, .4);
      else if (i === 2) bx(tg, hm || MT.iron, .13, .1, .025, 0, -.1, .41);
      else bx(tg, hm || MT.iron, .09, .09, .15, 0, -.045, .36);
    }
    P.bundle = bx(P.torso, MT.wood, .24, .22, .14, 0, .1, -.16); P.bundle.visible = false; P.bundle.userData.dyn = 1; // material swapped per load
  }
}
// Büyücü (healer): a woman in a long hooded robe in the owner's colour with a staff topped by a glowing orb. Same rig
// as makeHuman (legL/legR/torso/head/armL/armR) so _animHuman drives her; the legs are only feet under the hem.
function makeHealer(g, color, P, A) {
  const cloth = mat(color, .85, 0);
  const robeM = A === 4 ? XM.robe4 : cloth;
  const trimM = [XM.fur, XM.linen, XM.emb, MT.gold, MT.white][A];
  const sashM = [XM.hide, MT.leather, XM.emb, MT.gold, MT.black][A];
  const footM = A >= 3 ? MT.black : MT.leather;
  P.legL = piv(g, .06, .38, 0); bx(P.legL, footM, .07, .06, .11, 0, -.38, .01);
  P.legR = piv(g, -.06, .38, 0); bx(P.legR, footM, .07, .06, .11, 0, -.38, .01);
  // the skirt down to the ground (static: merged into the body), its hem in the age's trim
  mk(G.robe, g, robeM, .44, .44, .32, 0, 0, 0);
  mk(G.cyl, g, trimM, .45, .05, .33, 0, 0, 0);
  if (A === 4) bx(g, cloth, .1, .44, .02, 0, 0, .162).rotation.x = -.144;   // owner-colour stole down the front of the dark robe
  P.torso = piv(g, 0, .38, 0); bx(P.torso, robeM, .26, .34, .16, 0, 0, 0);
  bx(P.torso, sashM, .27, .045, .17, 0, .05, 0);
  bx(P.torso, cloth, .3, .08, .19, 0, .27, 0);   // shoulder mantle (owner colour in every age)
  if (A === 0) { bx(P.torso, XM.fur, .31, .05, .2, 0, .32, 0); bx(P.torso, MT.leather, .015, .1, .01, 0, .17, .085); bx(P.torso, XM.bone, .035, .06, .02, 0, .12, .09); }
  else if (A === 1) sp(P.torso, MT.bronze, .03, 0, .3, .095);
  else if (A === 2) bx(P.torso, XM.emb, .05, .26, .02, 0, 0, .08);
  else if (A === 3) sp(P.torso, MT.gold, .03, 0, .3, .095);
  else { bx(P.torso, cloth, .12, .26, .02, 0, 0, .08); bx(P.torso, MT.white, .025, .26, .022, .06, 0, .08); bx(P.torso, MT.white, .025, .26, .022, -.06, 0, .08); }
  // head with the hood up (face open to the front, +z), fringe and long strands of hair falling over the chest
  P.head = piv(P.torso, 0, .36, 0); bx(P.head, MT.skin, .15, .16, .15, 0, 0, 0);
  bx(P.head, cloth, .2, .06, .2, 0, .15, -.015);
  bx(P.head, cloth, .025, .2, .19, .09, -.04, -.02); bx(P.head, cloth, .025, .2, .19, -.09, -.04, -.02);
  bx(P.head, cloth, .2, .24, .04, 0, -.06, -.1);
  py(P.head, cloth, .14, .1, .14, 0, .2, -.04).rotation.x = -.5;
  bx(P.head, A === 3 ? cloth : trimM, .205, .03, .03, 0, .145, .08);   // hood rim
  bx(P.head, XM.hairF, .15, .03, .02, 0, .125, .076);
  // (the long strands hang from the torso, at the head's rest place (pivot y .36): on the head they cut into the chest
  // when the idle head turns)
  bx(P.torso, XM.hairF, .045, .26, .035, .055, .12, .085); bx(P.torso, XM.hairF, .04, .16, .03, -.055, .22, .085);
  // slim arms in wide sleeves
  const sl = robeM, cuff = A === 3 ? cloth : trimM;
  P.armL = piv(P.torso, .165, .3, 0); bx(P.armL, sl, .08, .3, .08, 0, -.3, 0); bx(P.armL, cuff, .1, .07, .1, 0, -.3, 0); bx(P.armL, MT.skin, .06, .06, .06, 0, -.35, 0);
  P.armR = piv(P.torso, -.165, .3, 0); bx(P.armR, sl, .08, .3, .08, 0, -.3, 0); bx(P.armR, cuff, .1, .07, .1, 0, -.3, 0); bx(P.armR, MT.skin, .06, .06, .06, 0, -.35, 0);
  // the staff in her right hand: tilted against the arm's resting angle (-.3, see _animHuman) so it stands upright
  const st = piv(P.armR, 0, -.33, .03); st.rotation.x = .3;
  cy(st, A === 0 ? MT.dwood : MT.wood, .016, 1.0, 0, -.32, 0);
  const cm = [XM.bone, MT.bronze, MT.dwood, MT.gold, MT.steel][A];
  cy(st, cm, .03, .04, 0, .64, 0);
  bx(st, cm, .018, .12, .018, .035, .66, 0); bx(st, cm, .018, .12, .018, -.035, .66, 0);
  bx(st, cm, .018, .12, .018, 0, .66, .035); bx(st, cm, .018, .12, .018, 0, .66, -.035);
  if (A === 0) bx(st, MT.leather, .04, .07, .04, 0, .5, 0);
  else if (A === 2) bx(st, XM.emb, .038, .05, .038, 0, .52, 0);
  sp(st, XM.orb, .045, 0, .74, 0);
  P.staff = 1;
}
function makeHorse(g, coatHex, P, sc) {
  const m = mat(coatHex, .9), dk = mat(0x241a12, .9);
  P.hbody = piv(g, 0, 0, 0);
  bx(P.hbody, m, .3, .32, .8, 0, .46, 0);
  const neck = bx(P.hbody, m, .16, .42, .2, 0, .62, .38); neck.rotation.x = .5;
  P.hhead = piv(P.hbody, 0, .98, .58); bx(P.hhead, m, .15, .16, .34, 0, -.06, .08);
  bx(P.hhead, dk, .03, .08, .03, .05, .1, 0); bx(P.hhead, dk, .03, .08, .03, -.05, .1, 0);
  bx(P.hbody, dk, .05, .3, .05, 0, .7, .36).rotation.x = .5;
  const tail = bx(P.hbody, dk, .06, .36, .06, 0, .42, -.42); tail.rotation.x = -.3;
  P.hl = [];
  for (let i = 0; i < 4; i++) {
    const l = piv(P.hbody, (i & 1 ? 1 : -1) * .1, .48, (i & 2 ? -1 : 1) * .3);
    bx(l, m, .08, .48, .09, 0, -.48, 0); bx(l, dk, .092, .07, .102, 0, -.48, 0);   // (hoof clear of the leg's faces)
    P.hl.push(l);
  }
  if (sc) P.hbody.scale.setScalar(sc);
}
// (owner 2026-11-23: "ayıyı düzelt", the stretched horse read as a horse) a bear of its own: heavy low body with a
// shoulder hump, no neck, a big head with round ears and a lighter snout, short thick legs. Same pivots as makeHorse
// (hbody / hhead / hl) so _animHorse walks it.
function makeBear(g, P, sc) {
  const m = mat(0x4a3322, .95), dk = mat(0x2a1c12, .95), sn = mat(0x8a6a4a, .9);
  P.hbody = piv(g, 0, 0, 0);
  bx(P.hbody, m, .5, .42, .82, 0, .5, 0);            // body
  bx(P.hbody, m, .46, .16, .3, 0, .76, .18);          // shoulder hump
  bx(P.hbody, m, .44, .36, .24, 0, .48, -.38);        // rump
  P.hhead = piv(P.hbody, 0, .6, .46);
  bx(P.hhead, m, .32, .28, .28, 0, 0, .08);            // head
  bx(P.hhead, sn, .16, .13, .16, 0, -.05, .28);        // snout
  bx(P.hhead, dk, .07, .05, .04, 0, .0, .37);          // nose
  bx(P.hhead, m, .09, .09, .05, .11, .17, .02); bx(P.hhead, m, .09, .09, .05, -.11, .17, .02);   // ears
  bx(P.hbody, m, .1, .1, .08, 0, .58, -.52);           // stubby tail
  P.hl = [];
  for (let i = 0; i < 4; i++) {
    const l = piv(P.hbody, (i & 1 ? 1 : -1) * .16, .4, (i & 2 ? -1 : 1) * .27);
    bx(l, m, .15, .36, .16, 0, -.2, 0); bx(l, dk, .16, .06, .2, 0, -.38, .02);   // leg + paw
    P.hl.push(l);
  }
  if (sc) P.hbody.scale.setScalar(sc);
}
function makeWheels(g, P, r, hw, z1, z2, age) {
  P.wheels = [];
  for (let i = 0; i < 4; i++) {
    if (z2 === null && i > 1) break;
    const w = mk(G.wheel, g, age >= 4 ? MT.iron : MT.wood, .07, r * 2, r * 2, (i & 1 ? 1 : -1) * hw, r, i > 1 ? z2 : z1);
    bx(w, age >= 4 ? MT.steel : MT.dwood, 1.15, .14, .9, 0, -.07, 0);
    if (age === 3) mk(G.wheel, w, MT.iron, .5, 1.07, 1.07, 0, 0, 0);
    P.wheels.push(w);
  }
}
const USCALE = 1.25;
function makeUnit(type, color, age) {
  const A = Math.max(0, Math.min(4, age | 0));
  try {
    const u = makeUnitRaw(type, color, A);
    if (u.P.glb) return u;   // (a generated ship model: its own textured mesh, drawn as it is)
    try { bakeUnit(u, type + '|' + A + '|' + color); return u; }
    catch (err) {
      if (!_ubakeWarned) { _ubakeWarned = true; console.warn('[entities] unit bake failed, drawing unmerged:', type, A, err); }
      return makeUnitRaw(type, color, A);
    }
  }
  catch (err) {
    console.warn('[entities] unit model failed:', type, age, err);
    try { return makeUnitRaw(type, color, -1); }
    catch (err2) {
      const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
      const P = {}; makeHuman(inner, color, KIT.villager, P, 2); inner.scale.setScalar(.72 * USCALE);
      return { root, inner, P, rig: 'human', h: .8 * USCALE, pw: .5 * USCALE, pd: .5 * USCALE };
    }
  }
}
function makeUnitRaw(type, color, age) {
  const legacy = age < 0, A = legacy ? 2 : age;
  const root = new THREE.Group(), inner = new THREE.Group(); root.add(inner);
  const P = {}; let rig = 'human', h = .8, pw = .5, pd = .5;
  const cloth = mat(color, .85, 0);
  const k = KIT[type];
  if (k && !k.cav) { makeHuman(inner, color, k, P, A); inner.scale.setScalar(.72); }
  else if (k && k.cav) {
    rig = 'cav'; h = 1.25; pw = .6; pd = 1.0;
    makeHorse(inner, k.coat, P);
    if (A === 0) { bx(P.hbody, MT.leather, .31, .03, .05, 0, .78, .1); }
    else if (A === 1) { bx(P.hbody, cloth, .32, .05, .36, 0, .78, -.02); bx(P.hbody, MT.bronze, .16, .03, .05, 0, 1.0, .7); }
    else if (A === 2) {
      if (k.barding) { bx(P.hbody, cloth, .33, .3, .6, 0, .44, -.05); bx(P.hbody, MT.steel, .17, .1, .2, 0, .98, .6); bx(P.hbody, MT.steel, .2, .2, .1, 0, .6, .42); }
      else { bx(P.hbody, cloth, .32, .05, .3, 0, .78, -.02); bx(P.hbody, MT.leather, .2, .06, .26, 0, .8, -.02); }
    } else {
      bx(P.hbody, cloth, .33, .04, .44, 0, .775, -.05); bx(P.hbody, MT.leather, .2, .07, .3, 0, .8, -.02);
      bx(P.hbody, MT.black, .05, .15, .07, .17, .62, .2); bx(P.hbody, MT.black, .05, .15, .07, -.17, .62, .2);
      if (k.barding && A === 3) bx(P.hbody, MT.steel, .17, .1, .2, 0, .98, .6);
      if (A === 4) bx(P.hbody, MT.canvas, .3, .09, .1, 0, .82, -.24);
    }
    const r = piv(P.hbody, 0, .42, -.02); makeHuman(r, color, k, P, A);
    P.legL.rotation.set(-1.1, 0, .45); P.legR.rotation.set(-1.1, 0, -.45);
    inner.scale.setScalar(.72);
  } else if (type === 'ram') {
    rig = 'ram'; h = .9; pw = .8; pd = 1.3;
    makeWheels(inner, P, .16, .34, .4, -.4, A);
    bx(inner, A >= 4 ? MT.iron : MT.dwood, .6, .06, 1.2, 0, .2, 0);
    if (A >= 3) { bx(inner, MT.iron, .64, .08, .06, 0, .19, .45); bx(inner, MT.iron, .64, .08, .06, 0, .19, -.45); }
    for (let i = 0; i < 4; i++) cy(inner, MT.wood, .03, .5, (i & 1 ? 1 : -1) * .28, .22, (i & 2 ? 1 : -1) * .5);
    mk(G.prism, inner, A >= 4 ? MT.steel : MT.leather, .78, .3, 1.3, 0, .7, 0);
    if (A === 3) { bx(inner, MT.iron, .8, .03, .06, 0, .71, .5); bx(inner, MT.iron, .8, .03, .06, 0, .71, -.5); }
    bx(inner, cloth, .8, .05, .3, 0, .71, 0);
    P.log = piv(inner, 0, .45, 0);
    const l = cy(P.log, MT.wood, .09, 1.5, 0, 0, -.7); l.rotation.x = PI / 2;
    const cap = cy(P.log, MT.iron, .11, .2, 0, 0, .78); cap.rotation.x = PI / 2;
  } else if (type === 'catapult') {
    rig = 'catapult'; h = 1.0; pw = .8; pd = 1.2;
    makeWheels(inner, P, .17, .36, .38, -.38, A);
    bx(inner, MT.wood, .62, .08, 1.1, 0, .2, 0);
    if (A >= 3) { bx(inner, MT.iron, .66, .1, .06, 0, .19, .5); bx(inner, MT.iron, .66, .1, .06, 0, .19, -.5); }
    const um = A >= 4 ? MT.iron : MT.dwood;
    bx(inner, um, .06, .55, .08, .25, .26, .1); bx(inner, um, .06, .55, .08, -.25, .26, .1);
    bx(inner, MT.dwood, .6, .07, .08, 0, .78, .1);
    bx(inner, cloth, .2, .16, .02, 0, .6, .15);
    P.arm = piv(inner, 0, .5, .1);
    bx(P.arm, MT.lwood, .06, .06, .95, 0, -.03, -.45);
    bx(P.arm, MT.iron, .2, .06, .2, 0, -.02, -.9);
    sp(P.arm, MT.stone, .08, 0, .1, -.9);
    P.arm.rotation.x = -.4;
  } else if (type === 'cannon' || type === 'artillery') {
    rig = 'cannon'; h = .7; pw = .7; pd = 1.1;
    const art = type === 'artillery';
    makeWheels(inner, P, art ? .2 : .22, .28, 0, null, A);
    if (A >= 4 && !art) bx(inner, MT.iron, .32, .04, .5, 0, .2, -.2).rotation.x = -.18;
    bx(inner, art ? MT.iron : MT.wood, .3, .08, .9, 0, .18, -.25).rotation.x = -.18;
    P.barrel = piv(inner, 0, art ? .34 : .36, 0);
    const b = cy(P.barrel, art ? mat(0x4b5a48, .5, .6) : MT.bronze, art ? .055 : .08, art ? 1.0 : .8, 0, 0, -.25); b.rotation.x = PI / 2 - .12;
    const br = cy(P.barrel, MT.iron, art ? .08 : .1, .22, 0, 0, -.3); br.rotation.x = PI / 2 - .12;
    if (art) bx(P.barrel, mat(0x4b5a48, .5, .6), .5, .4, .03, 0, -.12, .1);
    bx(inner, cloth, .1, .12, .1, 0, .22, -.6);
    P.bz = 0;
  } else if (type === 'tradecart') {
    rig = 'cart'; h = .9; pw = .6; pd = 1.4;
    makeHorse(inner, 0x9a7a55, P, .8);
    P.hbody.position.z = .45;
    const cg = piv(inner, 0, 0, -.5);
    makeWheels(cg, P, .2, .3, 0, null, A);
    bx(cg, MT.wood, .5, .25, .7, 0, .22, 0);
    if (A >= 3) { bx(cg, MT.iron, .53, .04, .72, 0, .22, 0); }
    if (A === 0) { bx(cg, XM.hide, .52, .1, .6, 0, .47, 0); }
    mk(G.wheel, cg, MT.canvas, .52, .5, .7, 0, .5, 0);
    bx(cg, cloth, .53, .08, .3, 0, .52, 0);
    bx(cg, MT.dwood, .04, .04, .6, .14, .3, .6); bx(cg, MT.dwood, .04, .04, .6, -.14, .3, .6);
    inner.scale.setScalar(.8);
  } else if (SEA_UNITS[type]) {
    const r = makeSeaUnit(type, color, A, root, inner, P); rig = r.rig; h = r.h; pw = r.pw; pd = r.pd;
  } else if (type === 'deer') {
    rig = 'deer'; h = .6; pw = .4; pd = .7;
    makeHorse(inner, 0xa5713f, P, .5);
  } else if (type === 'wolf') {   // (the wild predators reuse the deer rig: same quadruped, other size and coat)
    rig = 'deer'; h = .5; pw = .35; pd = .6;
    makeHorse(inner, 0x6e6964, P, .4);
  } else if (type === 'bear') {
    rig = 'deer'; h = .8; pw = .6; pd = .9;
    makeBear(inner, P, .75);
  } else { makeHuman(inner, color, KIT.villager, P, A); inner.scale.setScalar(.72); }
  inner.scale.multiplyScalar(USCALE); h *= USCALE; pw *= USCALE; pd *= USCALE;
  P.spear = !!(k && k.weapon === 'spear');
  return { root, inner, P, rig, h, pw, pd };
}

// ---------- unit baking: one mesh per rigid segment ----------
// A unit model is dozens of small meshes under pivots the animation turns (P.legL, P.torso, P.hl[i], wheels...).
// bakeUnit() merges the static meshes of every segment (a kept node and the static nodes under it) into ONE mesh in
// the segment's local space. Colour, roughness, metalness and emissive move into vertex attributes and UMAT reads them
// per vertex, so parts of different materials still merge and look exactly the same. Kept apart: everything referenced
// from P (or from a node's userData arrays: wagon wheels), anything hidden at build time (tools, crew figures),
// and non-standard / transparent materials. Merged geometries are shared per (type, age, colour) and refcounted.
const UMAT = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true });
UMAT.onBeforeCompile = (sh) => {
  sh.vertexShader = sh.vertexShader
    .replace('#include <common>', '#include <common>\nattribute vec2 rm;\nattribute vec3 emi;\nvarying vec2 vRM;\nvarying vec3 vEmi;')
    .replace('#include <begin_vertex>', '#include <begin_vertex>\nvRM = rm; vEmi = emi;');
  sh.fragmentShader = sh.fragmentShader
    .replace('#include <common>', '#include <common>\nvarying vec2 vRM;\nvarying vec3 vEmi;')
    .replace('#include <roughnessmap_fragment>', 'float roughnessFactor = vRM.x;')
    .replace('#include <metalnessmap_fragment>', 'float metalnessFactor = vRM.y;')
    .replace('#include <emissivemap_fragment>', 'totalEmissiveRadiance = vEmi;');
};
UMAT.customProgramCacheKey = () => 'unitRM';
const INSTANCED = true;          // draw merged unit segments through per-geometry InstancedMeshes
const UGEO = new Map();           // key -> { geos, sigs, refs }
const HIDE_M = new THREE.MeshBasicMaterial({ visible: false });
let _ubakeWarned = false;
function canUMat(m) {
  return !!m && m.isMeshStandardMaterial && !m.isMeshPhysicalMaterial && !m.transparent && m.opacity === 1 && !m.map && !m.normalMap
    && !m.roughnessMap && !m.metalnessMap && !m.emissiveMap && !m.alphaMap && !m.envMap && m.side === THREE.FrontSide && m.visible && !m.vertexColors;
}
function unitKeep(u) {
  const keep = new Set([u.root, u.inner]);
  const add = (x) => { if (x && x.isObject3D) keep.add(x); };
  const P = u.P;
  for (const k in P) {
    const v = P[k]; if (!v || typeof v !== 'object') continue;
    if (v.isObject3D) add(v); else if (Array.isArray(v)) v.forEach(add); else for (const q in v) add(v[q]);
  }
  u.root.traverse((o) => {
    if (o.visible === false || !(o.isMesh || o.isGroup || o.type === 'Object3D') || o.isInstancedMesh || o.isSkinnedMesh || Array.isArray(o.material)) keep.add(o);
    const ud = o.userData; for (const q in ud) if (Array.isArray(ud[q])) ud[q].forEach(add);
  });
  return keep;
}
const _bp = new THREE.Vector3(), _bn = new THREE.Vector3(), _bnm = new THREE.Matrix3(), _bc = new THREE.Color();
// parts [{ geo, mat, rel }] -> one non-indexed geometry (position, normal, color, rm, emi) in the segment's space
function segGeo(parts) {
  let n = 0;
  for (const p of parts) n += p.geo.index ? p.geo.index.count : p.geo.attributes.position.count;
  const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3), rm = new Float32Array(n * 2), emi = new Float32Array(n * 3);
  let o = 0;
  for (const p of parts) {
    const g = p.geo, P = g.attributes.position, N = g.attributes.normal, I = g.index, m = p.rel, mt = p.mat;
    const cnt = I ? I.count : P.count, flip = m.determinant() < 0;
    _bnm.getNormalMatrix(m);
    const cr = mt.color ? mt.color.r : 1, cg = mt.color ? mt.color.g : 1, cb = mt.color ? mt.color.b : 1;
    const r = mt.roughness != null ? mt.roughness : 1, me = mt.metalness || 0;
    if (mt.emissive) _bc.copy(mt.emissive).multiplyScalar(mt.emissiveIntensity != null ? mt.emissiveIntensity : 1); else _bc.setRGB(0, 0, 0);
    for (let i = 0; i < cnt; i++) {
      // a mirrored part flips its winding when baked (three flips the front face per object instead)
      const j = flip ? i - (i % 3) + (i % 3 === 1 ? 2 : i % 3 === 2 ? 1 : 0) : i;
      const vi = I ? I.getX(j) : j;
      _bp.fromBufferAttribute(P, vi).applyMatrix4(m);
      if (N) _bn.fromBufferAttribute(N, vi).applyMatrix3(_bnm).normalize(); else _bn.set(0, 1, 0);
      pos[o * 3] = _bp.x; pos[o * 3 + 1] = _bp.y; pos[o * 3 + 2] = _bp.z;
      nor[o * 3] = _bn.x; nor[o * 3 + 1] = _bn.y; nor[o * 3 + 2] = _bn.z;
      col[o * 3] = cr; col[o * 3 + 1] = cg; col[o * 3 + 2] = cb;
      rm[o * 2] = r; rm[o * 2 + 1] = me;
      emi[o * 3] = _bc.r; emi[o * 3 + 1] = _bc.g; emi[o * 3 + 2] = _bc.b;
      o++;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
  geo.setAttribute('rm', new THREE.BufferAttribute(rm, 2));
  geo.setAttribute('emi', new THREE.BufferAttribute(emi, 3));
  geo.computeBoundingSphere();
  return geo;
}
function bakeUnit(u, key) {
  const keep = unitKeep(u);
  const anc = new Set();   // nodes that hold a kept node somewhere below them
  for (const k of keep) for (let p = k.parent; p; p = p.parent) anc.add(p);
  let c = UGEO.get(key);
  const fresh = !c;
  if (fresh) c = { geos: [], sigs: [], refs: 0 };
  let gi = 0;
  const seg = (C) => {
    const parts = [];
    if (C.isMesh && C !== u.root && !C.userData.dyn && canUMat(C.material)) {
      parts.push({ geo: C.geometry, mat: C.material, rel: new THREE.Matrix4(), cast: C.castShadow, recv: C.receiveShadow });
      C.material = HIDE_M;   // keeps its transform / visibility for the animation, draws through the merged child
    }
    const walk = (node, M) => {
      const ch = node.children.slice();
      for (let i = 0; i < ch.length; i++) {
        const o = ch[i];
        if (keep.has(o)) { seg(o); continue; }
        if (!o.isMesh && !o.isGroup && o.type !== 'Object3D') continue;
        o.updateMatrix();
        const rel = M ? new THREE.Matrix4().multiplyMatrices(M, o.matrix) : o.matrix.clone();
        if (o.isMesh) parts.push({ geo: o.geometry, mat: o.material, rel, cast: o.castShadow, recv: o.receiveShadow });
        if (anc.has(o)) {
          // static node carrying an animated part: a bare transform node stays in its place
          let t = o;
          if (o.isMesh) { t = new THREE.Group(); t.position.copy(o.position); t.quaternion.copy(o.quaternion); t.scale.copy(o.scale); node.add(t); for (const q of o.children.slice()) t.add(q); node.remove(o); }
          walk(t, rel);
        } else { walk(o, rel); node.remove(o); }
      }
    };
    walk(C, null);
    const groups = new Map();
    for (const p of parts) {
      const um = canUMat(p.mat);
      const gk = (um ? 'U' : 'm' + p.mat.id) + (p.cast ? 'c' : '') + (p.recv ? 'r' : '');
      let gr = groups.get(gk); if (!gr) groups.set(gk, gr = { um, mat: p.mat, cast: p.cast, recv: p.recv, parts: [] });
      gr.parts.push(p);
    }
    for (const [gk, gr] of groups) {
      const sig = gk + ':' + gr.parts.length;
      let geo;
      if (fresh) { geo = segGeo(gr.parts); geo.userData.cast = gr.cast; geo.userData.recv = gr.recv; c.geos.push(geo); c.sigs.push(sig); }
      else { if (c.sigs[gi] !== sig) throw new Error('unit bake cache mismatch ' + key); geo = c.geos[gi]; }
      gi++;
      const mesh = new THREE.Mesh(geo, gr.um ? UMAT : gr.mat);
      mesh.castShadow = gr.cast; mesh.receiveShadow = gr.recv;
      C.add(mesh);
    }
  };
  try {
    seg(u.root);
    if (!fresh && gi !== c.geos.length) throw new Error('unit bake cache mismatch ' + key);
  } catch (err) { if (fresh) for (const g of c.geos) g.dispose(); throw err; }
  if (fresh) {
    if (UGEO.size > 96) for (const [k2, c2] of UGEO) if (c2.refs <= 0) { for (const g of c2.geos) g.dispose(); UGEO.delete(k2); }
    UGEO.set(key, c);
  }
  c.refs++;
  u.ukey = key;
}
function releaseUnit(key) {
  const c = key && UGEO.get(key);
  if (c) c.refs--;   // unreferenced entries are disposed lazily (a new unit of the same kind often follows soon)
}

const _m4 = new THREE.Matrix4(), _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _s = new THREE.Vector3();
const _hits = [];
const _fm = new THREE.Matrix4(), _fs = new THREE.Sphere(new THREE.Vector3(), 2.5);
const PROJ = {
  arrow: [G.cbox, mat(0xc9a878, .8, 0), .03, .03, .58],     // a pale shaft so a volley reads from the RTS camera
  bolt: [G.cbox, mat(0x9a7a52, .7, .1), .045, .045, .46],   // crossbow bolt: short and stubby, pale enough to read at its speed (sim: projectile.bolt)
  bullet: [G.cbox, mat(0xffe08a, .4, 0, 0xffc040), .025, .025, .55],
  stone: [G.sph, MT.stone, .2, .2, .2],
  cannonball: [G.sph, MT.black, .16, .16, .16],
};

function grpStatic(g) { return !g || (g.visible && g.scale.x === 1 && g.scale.y === 1 && g.scale.z === 1 && g.position.y === 0); }

// growable InstancedMesh refilled every frame: begin() / push(matrix elements[, color]) / flush()
class IBatch {
  constructor(scene, geo, mat, order, cast, recv, colors) {
    this.scene = scene; this.geo = geo; this.mat = mat; this.order = order; this.cast = cast; this.recv = recv; this.colors = !!colors;
    this.cap = 0; this.n = 0; this.idle = 0; this.mesh = null; this.arr = null; this.carr = null;
    this._grow();
  }
  _grow() {
    const cap = Math.max(16, this.cap * 2), m = new THREE.InstancedMesh(this.geo, this.mat, cap);
    m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    if (this.colors) { m.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(cap * 3), 3); m.instanceColor.setUsage(THREE.DynamicDrawUsage); }
    m.frustumCulled = false;   // only on-screen things are pushed
    m.castShadow = this.cast; m.receiveShadow = this.recv; m.renderOrder = this.order;
    if (this.mesh) {
      m.instanceMatrix.array.set(this.arr.subarray(0, this.n * 16));
      if (this.colors) m.instanceColor.array.set(this.carr.subarray(0, this.n * 3));
      this.scene.remove(this.mesh); this.mesh.dispose();
    }
    this.mesh = m; this.arr = m.instanceMatrix.array; this.carr = this.colors ? m.instanceColor.array : null; this.cap = cap; m.count = 0;
    this.scene.add(m);
  }
  push(el, col) {
    if (this.n >= this.cap) this._grow();
    this.arr.set(el, this.n * 16);
    if (col) { const o = this.n * 3; this.carr[o] = col.r; this.carr[o + 1] = col.g; this.carr[o + 2] = col.b; }
    this.n++;
  }
  // returns true once it has been empty long enough to be dropped
  flush() {
    const m = this.mesh; m.count = this.n;
    if (this.n) { this.idle = 0; m.visible = true; m.instanceMatrix.needsUpdate = true; if (this.colors) m.instanceColor.needsUpdate = true; this.n = 0; return false; }
    m.visible = false;
    if (++this.idle > 600 && !this.keep) { this.dispose(); return true; }
    return false;
  }
  dispose() { this.scene.remove(this.mesh); this.mesh.dispose(); }
}
// health bars: camera-facing quads anchored at their left edge (what the sprites with center (0, .5) were)
const HPQ = new THREE.PlaneGeometry(1, 1).translate(.5, 0, 0);
const HPQM = new THREE.MeshBasicMaterial({ color: 0xffffff, depthTest: false, transparent: true });
const HPC = { bg: HPM.bg.color, g: HPM.g.color, y: HPM.y.color, r: HPM.r.color };
const _hq = new THREE.Quaternion(), _hpos = new THREE.Vector3(), _hsc = new THREE.Vector3(), _hm = new THREE.Matrix4();

export class EntityView {
  constructor(scene, game, ctx) {
    this.scene = scene; this.game = game; this.ctx = ctx || {};
    this.fx = this.ctx.fx || (this.ctx.renderer && this.ctx.renderer.fx) || null;
    this.views = new Map(); this.proxies = []; this.selected = new Set();
    this.frame = 0; this.t = 0;
    this.projs = new Map(); this.projPool = { arrow: [], bolt: [], bullet: [], stone: [], cannonball: [] };
    this.ghost = null; this.ghostType = null; this.ghostValid = null;
    this.flag = new THREE.Group();
    cy(this.flag, MT.dwood, .03, 1.3, 0, 0, 0);
    this.flagCloth = bx(this.flag, mat(0xffffff, .8), .4, .26, .03, .22, 1.0, 0);
    this.flag.visible = false; scene.add(this.flag);
    this._dead = [];
    this._waves = new Map();
    this._frustum = new THREE.Frustum();
    this._ib = new Map();   // shared unit segment geometry -> instanced batch
    this._rb = new Map();   // selection ring material -> instanced batch
    this._cb = new Map();   // carried load material -> instanced batch (villagers' bundles)
    this._hpB = new IBatch(scene, HPQ, HPQM, 20, false, false, true);
    this._hpF = new IBatch(scene, HPQ, HPQM, 21, false, false, true);
    this._hpB.keep = this._hpF.keep = true;   // fixed batches: never idle-dispose (nothing would recreate them)
    this._shb = new Map();  // pasture sheep parts: one instanced batch per (geometry, material) for every pasture
    this._sb = new StaticBatches(scene);   // finished, static-looking buildings merged per chunk (static-batch.js)
    this.batching = true;   // debug A/B switch (false: every building and sheep drawn on its own, as before)
    try { loadGlbModels(); loadCrop(); } catch (err) { /* procedural models only */ }
    try {
      const ev = game && game.events;
      if (ev && typeof ev.on === 'function') ev.on('ageUp', (d) => { try { this._onAgeUp(d); } catch (err) { /* visual only */ } });
    } catch (err) { /* no event bus: upgrades are instant */ }
  }

  // age-up ripple: entities upgrade their look in a wave spreading from the town center
  _onAgeUp(d) {
    if (!d || d.owner == null) return;
    const g = this.game, p = g.players[d.owner];
    let x = null, z = null;
    for (const e of g.entities.values()) { if (e.owner === d.owner && e.kind === 'building' && e.type === 'towncenter') { x = e.x; z = e.z; break; } }
    if (x === null) { if (p && p.startX != null) { x = p.startX; z = p.startZ; } else return; }
    this._waves.set(d.owner, { t0: this.t, x, z });
  }
  // the age an entity should LOOK like right now (held back while the wave has not reached it)
  _vage(v, e) {
    const real = this._age(e.owner);
    if (real === v.age) return real;
    const w = this._waves.get(e.owner);
    if (w) {
      const el = this.t - w.t0;
      if (el > 1.7) { this._waves.delete(e.owner); return real; }
      const dx = e.x - w.x, dz = e.z - w.z;
      if (el < Math.min(1.5, Math.sqrt(dx * dx + dz * dz) * .055)) return v.age;
    }
    return real;
  }
  _pop(v, dt) {
    v.pop -= dt;
    const k = v.k || 1;
    if (v.pop <= 0) { v.pop = 0; v.root.scale.setScalar(k); return; }
    v.root.scale.setScalar(k * (1 + .12 * Math.sin((1 - v.pop / .5) * PI)));
  }
  _buildUnitMesh(v, e, age) {
    if (v.root) { this.scene.remove(v.root); releaseUnit(v.ukey); v.ukey = null; const i = this.proxies.indexOf(v.proxy); if (i >= 0) this.proxies.splice(i, 1); v.ring = null; }
    v.age = age; v.utype = e.type;
    const u = makeUnit(e.type, this._color(e.owner), age);
    v.root = u.root; v.inner = u.inner; v.P = u.P; v.rig = u.rig; v.h = u.h; v.ukey = u.ukey || null;
    v.root.userData.id = e.id;
    v.tool = ''; v.carry = ''; v.carryM = null; v.az0 = undefined;
    // instanced drawing: a merged segment mesh sits at its segment's origin, so it is replaced by a slot
    // { p: segment node, g: geometry } and _emit() copies the segment's world matrix into the geometry's batch
    v.slots = null;
    if (INSTANCED && u.ukey) {
      const ms = [];
      u.root.traverse(o => { if (o.isMesh && o.material === UMAT) ms.push(o); });
      v.slots = ms.map(o => { const p = o.parent; p.remove(o); return { p, g: o.geometry }; });
      u.root.matrixWorldAutoUpdate = false;
    }
    this._proxy(v, u.pw, u.h, u.pd);
    v.root.visible = v.vis !== false;
    this.scene.add(v.root);
  }

  _color(owner) {
    const p = this.game.players[owner];
    if (!p) return 0x888888;
    if (p.color != null) return p.color;
    // no color for this slot (e.g. a palette shorter than the player count): derive a stable hue from the id
    return new THREE.Color().setHSL(((owner | 0) * 0.137 + 0.58) % 1, 0.7, 0.5).getHex();
  }
  _age(owner) { const p = this.game.players[owner]; return p ? (p.age | 0) : 0; }
  // local player id (multiplayer: game.me, single-player: 0), read fresh every call
  _me() { const g = this.game; return g && g.me != null ? g.me : 0; }
  // a rival's entity standing in the fog (known, not in sight right now): what happens there is not shown
  _fogged(e) {
    const g = this.game, me = this._me();
    if (!g || g.reveal || !(e.owner >= 0) || e.owner === me || (g.isAlly && g.isAlly(e.owner, me))) return false;
    const N = g.map.size, tx = Math.min(N - 1, Math.max(0, e.x | 0)), tz = Math.min(N - 1, Math.max(0, e.z | 0));
    return g.fog[tz * N + tx] !== 2;
  }
  // another player on the local player's team (not the local player itself)
  _isAlly(owner) {
    const g = this.game, me = this._me();
    if (owner == null || owner < 0 || owner === me) return false;
    try { if (g && typeof g.isAlly === 'function') return !!g.isAlly(me, owner); } catch (err) { /* */ }
    return false;
  }

  _proxy(v, w, h, d) {
    const p = new THREE.Mesh(G.box, PROXY_M);
    p.scale.set(w, h, d); p.userData.id = v.id; p.userData.view = v;
    v.root.add(p); v.proxy = p; this.proxies.push(p);
  }

  _buildBuildingMesh(v, e, age) {
    const had = !!v.root;
    if (v.root) { this.scene.remove(v.root); disposeBaked(v.root); const i = this.proxies.indexOf(v.proxy); if (i >= 0) this.proxies.splice(i, 1); v.ring = null; }
    v.age = age == null ? this._age(e.owner) : age;
    v.glbv = glbVersion();
    if (glbPlanned(e.type, v.age)) loadEra(v.age);   // (no-op once that era's files are on their way)
    // the model is built at its design size and scaled to the footprint (data.js BUILDING_SIZES)
    const bs = (BUILDINGS[e.type] && BUILDINGS[e.type].baseSize) || e.size || 1;
    v.bs = bs; v.k = (e.size || bs) / bs;
    v.root = makeBuilding(e.type, bs, v.age, this._color(e.owner), v.mask | 0, (e.tx | 0) * 92821 + (e.tz | 0) * 68917);   // (seed: wall logs vary per tile)
    if (v.k !== 1) v.root.scale.setScalar(v.k);
    if (v.root.userData.dockM) dockPush(this.game.map, e, v.root.userData, bs);
    if (v.ry == null) v.ry = bYaw(e.type, e.rot);   // (a remade model keeps the turn it is drawn at; _updBuilding eases it)
    v.root.rotation.y = v.ry;
    const quiet = v.quiet; v.quiet = false;
    if (had && e.done && !quiet) {
      v.pop = .5;
      try { if (v.vis !== false && this.fx && this.fx.burst) this.fx.burst('build', e.x, this.game.map.heightAt(e.x, e.z) + .6, e.z); } catch (err) { /* fx optional */ }
    }
    v.root.userData.id = e.id;
    const U = v.root.userData;
    // pasture sheep: the meshes stay in their (animated) groups but are drawn through shared instanced batches (_sheep)
    if (U.live && U.live.userData.sheep) {
      const sl = U.sheepSlots = [];
      // (the 9x9 pasture of 2026-11-20 draws its design 3x: the sheep keep the size they had in the 6x6 one, 2x)
      const shk = pastureSheepK(v.k);
      for (const sh of U.live.userData.sheep) { sh.scale.setScalar(shk); sh.traverse(o => { if (o.isMesh) sl.push({ o, sh, k: o.geometry.uuid + o.material.uuid }); }); }
    }
    if (e.type === 'farm') v.h = .5;
    else { v.root.updateMatrixWorld(true); const b = new THREE.Box3().setFromObject(U.body); const b2 = new THREE.Box3().setFromObject(U.roof); v.h = Math.max(.6, b.max.y, isFinite(b2.max.y) ? b2.max.y : 0); }
    { const k = v.k || 1; this._proxy(v, (e.size || 1) * .85 / k, Math.max(.4, v.h * .6) / k, (e.size || 1) * .85 / k); }   // (child of the k-scaled root; owner 2026-11-25: lower and narrower than the model, so a building standing behind another one can be clicked)
    v.damaged = false; v.farmKey = -1; v.prog = -1;
    v.root.visible = v.vis !== false;
    this.scene.add(v.root);
  }

  _create(e) {
    const v = { e, id: e.id, kind: e.kind, root: null, inner: null, P: null, rig: null, h: 1, x: e.x, z: e.z, rot: e.rot || 0,
      ring: null, proxy: null, age: 0, damaged: false, smokeT: Math.random() * 3, farmKey: -1, prog: -1,
      pop: 0, phase: (e.id * 1.618) % 6.283, seen: 0, vis: true, tool: '', carry: '', lastAmt: -1 };
    if (e.kind === 'building') {
      // (a rival's known town center first drawn while in the fog - a loaded save, a late join - shows the age the
      // match started in, not the one it has reached unseen)
      v.mask = this._maskOf(e); this._buildBuildingMesh(v, e, e.known && this._fogged(e) ? (this.game.cfg.startAge | 0) : undefined);
      // the ground under it as the sim has it (levelled by the foundation): redrawn here too, so a missed or
      // early 'terrain' event, a loaded save or a late join can never leave a building sunk into a slope
      const R = this.ctx.renderer, s = e.size || 1;
      if (R && R._patchTerrain && e.tx != null) R._patchTerrain({ x0: e.tx - 7, z0: e.tz - 7, x1: e.tx + s + 7, z1: e.tz + s + 7 });   // (with the bank around the pad)
    }
    else if (e.kind === 'unit' || e.type === 'deer' || e.type === 'wolf' || e.type === 'bear') {
      this._buildUnitMesh(v, e, e.kind === 'unit' ? this._age(e.owner) : 0);
    } else {
      v.root = makeResource(e); v.root.userData.id = e.id; v.h = .7;
      if (e.type !== 'fish') v.root.userData.body = v.root.userData.g;   // (static batching merges this group, see update)
      v.root.rotation.y = (e.variant || 0) * 1.3 + e.id;
      this._proxy(v, .95, .7, .95);
      this.scene.add(v.root);
    }
    this.views.set(e.id, v);
    return v;
  }

  _remove(v) {
    this._sb.leave(v);
    if (v.cons) { try { disposeConstruction(v); } catch (err) { v.cons = null; } }
    this.scene.remove(v.root);
    if (v.kind !== 'unit' && v.rig == null) disposeBaked(v.root);
    if (v.ukey) { releaseUnit(v.ukey); v.ukey = null; }
    const i = this.proxies.indexOf(v.proxy); if (i >= 0) this.proxies.splice(i, 1);
    this.views.delete(v.id);
  }

  _ring(v, e) {
    if (!v.ring) {
      const b = e.kind === 'building';
      const me = this._me();
      const ML = b ? SELB : SELM, m = e.owner === me ? ML[0] : (e.owner == null || e.owner < 0) ? ML[2] : this._isAlly(e.owner) ? ML[3] : ML[1];
      v.ring = new THREE.Mesh(b ? GLOW_G : G.ring, m);
      if (b) { const sz = (e.size || 1) * 1.35; v.ring.scale.set(sz, 1, sz); v.ringGlow = sz; }
      // (a building's ring is a child of the model root, which is scaled by v.k: undo that so the outline sits on the footprint)
      const s = b ? 1 / (v.k || 1) : v.rig === 'human' ? .75 * USCALE : v.rig ? 1.25 * USCALE : 1.2;
      v.ringS = s; v.ring.position.y = b ? .14 : .1; v.ring.renderOrder = 5;
      if (v.slots) v.ring.layers.set(1);   // instanced unit: drawn by the ring batch (_emit), no camera renders layer 1
      v.root.add(v.ring);
    }
    v.ring.visible = true;
    if (v.P && v.P.ringE) { const q = 1 + Math.sin(this.t * 5.5 + v.phase) * .03; v.ring.scale.set(v.P.ringE[0] * q, 1, v.P.ringE[1] * q); v.ring.rotation.y = 0; return; }
    const pu = e.kind === 'building' ? (v.ringGlow || 1) / (v.k || 1) : v.ringS * (1 + Math.sin(this.t * 5.5 + v.phase) * .05);
    v.ring.scale.set(pu, 1, pu);
    if (e.kind !== 'building') v.ring.rotation.y = -v.root.rotation.y;
  }

  _hp(v, e, show, y) {
    if (!show) return;
    const w = e.kind === 'building' ? Math.min(3.2, Math.max(.8, (e.size || 1) * .6)) : .6;   // (capped: a 12-tile farm drew a 7-tile bar)
    const f = Math.max(0, Math.min(1, e.hp / (e.maxHp || 1)));
    const rx = this._rx * w * .5, ry = this._ry * w * .5, rz = this._rz * w * .5;
    _hpos.set(v.x - rx, y + v.h + .3 - ry, v.z - rz);
    _hm.compose(_hpos, this._camQ, _hsc.set(w, .09, 1)); this._hpB.push(_hm.elements, HPC.bg);
    _hm.compose(_hpos, this._camQ, _hsc.set(Math.max(.001, w * f), .06, 1)); this._hpF.push(_hm.elements, f > .6 ? HPC.g : f > .3 ? HPC.y : HPC.r);
  }

  // the big farm: every plot shows its own stage (furrows, seed, green shoots, yellowing, golden, harvested stubble)
  _farmPlots(v, e) {
    const plots = e.farm.plots, U = v.root.userData, cr = U.crops, P = U.plotSize || 4;
    const cg = cropGeo();   // the generated wheat clump once loaded (glb-models.js)
    if (cg && cr.geometry !== cg) { cr.geometry = cg; cr.material = CROP_MAT_VC; v.farmKey = -1; }
    const key = plots.map((q) => q.s * 10 + Math.floor((q.g || 0) * 10)).join(',');
    if (key === v.farmKey) return;
    v.farmKey = key;
    // the ridges of every tilled plot drawn as one merged mesh (was a mesh per plot: 8 draws, twice with shadows),
    // remade only when a plot is tilled or left fallow
    const fm = plots.reduce((m, q, i) => m | ((q.s | 0) >= 1 ? 1 << i : 0), 0);
    if (U.furMask !== fm) {
      U.furMask = fm;
      if (U.furM) { U.fur.remove(U.furM); U.furM.geometry.dispose(); U.furM = null; }
      const geos = []; let mt = null;
      U.furs.forEach((g, i) => { g.visible = false; if (fm & (1 << i)) for (const o of g.children) if (o.isMesh) { geos.push(o.geometry); mt = o.material; } });
      const mg = geos.length ? mergeGeometries(geos, false) : null;
      if (mg) { const m = new THREE.Mesh(mg, mt); m.castShadow = m.receiveShadow = true; m.userData.own = true; U.fur.add(m); U.furM = m; }
      else U.furs.forEach((g, i) => { g.visible = !!(fm & (1 << i)); });   // (merge failed: the plots on their own)
    }
    let n = 0;
    plots.forEach((q, i) => {
      const st = q.s | 0, gr = q.g || 0;
      if (st < 2) return;
      const [cx, cz] = FARM_CELLS_R[i], ox = (cx - 1) * P, oz = (cz - 1) * P;
      // rows of single plants on the ridges: every plant has its own height, lean, turn and shade (no block grid);
      // a ripe plot is cut row by row from one end, leaving short stubble
      const w = P * PLOT_W, cut = st === 5 ? Math.max(0, (gr - .7) / .3) : 0;
      let ht = .06, wd = .1, c0 = CROP_COL.seed, lean = 0;
      if (st === 3) { const k = Math.max(0, Math.min(1, (gr - .3) / .3)); ht = .1 + k * .24; wd = .2 + k * .14; c0 = CROP_COL.shoot; lean = .06; }
      else if (st === 4) { ht = .4; wd = .4; c0 = CROP_COL.ripen; lean = .1; }
      else if (st === 5) { ht = .44; wd = .44; c0 = CROP_COL.gold; lean = .12; }
      for (let r = 0; r < FROWS; r++) for (let k = 0; k < FPER; k++) {
        const idx = r * FPER + k, hsh = ((idx * 2654435761 + i * 40503) >>> 0) / 4294967296, h2s = ((idx * 1597334677 + i * 9301) >>> 0) / 4294967296;
        const harvested = st === 5 && (k + .5) / FPER < cut;
        const hh = harvested ? .07 : ht * (.78 + hsh * .44), ww = harvested ? .2 : wd * (.8 + h2s * .4);
        _v.set(ox - w / 2 + (r + .5) * w / FROWS + (h2s - .5) * .07, .03, oz - w * .45 + (k + .5) * w * .9 / FPER + (hsh - .5) * .1);
        _e.set((hsh - .5) * lean * 2, h2s * 6.283, (h2s - .5) * lean * 2); _q.setFromEuler(_e);
        _s.set(ww, hh, ww); _m4.compose(_v, _q, _s);
        _cc.copy(harvested ? CROP_COL.stubble : c0).offsetHSL((hsh - .5) * .03, (h2s - .5) * .12, (hsh - .5) * .1);
        cr.setMatrixAt(n, _m4); cr.setColorAt(n, _cc); n++;
      }
    });
    cr.count = n; cr.instanceMatrix.needsUpdate = true; if (cr.instanceColor) cr.instanceColor.needsUpdate = true;
  }

  _farm(v, e) {
    if (e.farm && Array.isArray(e.farm.plots) && v.root.userData.plotted) return this._farmPlots(v, e);
    const f = e.farm || { stage: 0, growth: 0 };
    const key = f.stage * 100 + Math.floor((f.growth || 0) * 20);
    if (key === v.farmKey) return;
    v.farmKey = key;
    const U = v.root.userData, cr = U.crops, s = v.bs || e.size || 3, st = f.stage | 0, gr = f.growth || 0;   // (crops live in the model's own space)
    U.fur.visible = st >= 1;
    if (st < 2) { cr.count = 0; return; }
    let n = 0, w = .05, hh = .04, m = MT.seed;
    if (st === 3) { m = MT.sprout; w = .07; hh = .08 + gr * .3; }
    else if (st === 4) { m = MT.wheat; w = .1; hh = .46; }
    else if (st === 5) { m = MT.wheat; w = .1; hh = .46; }
    cr.material = m;
    const span = s * .86 - .44;
    for (let i = 0; i < 6; i++) for (let j = 0; j < 12; j++) {
      const idx = i * 12 + j;
      let h2 = hh, w2 = w;
      if (st === 5 && (idx / 72) < gr) { h2 = .06; w2 = .08; }
      const jx = ((idx * 37) % 11) / 11 - .5;
      _v.set(-s * .43 + .22 + i * span / 5 + jx * .05, .13, -s * .4 + j * (s * .8) / 11);
      _s.set(w2, h2 * (.85 + (((idx * 53) % 7) / 7) * .3), w2);
      _q.identity();
      _m4.compose(_v, _q, _s);
      cr.setMatrixAt(n++, _m4);
    }
    cr.count = n; cr.instanceMatrix.needsUpdate = true;
  }

  _tint(v, on) {
    v.damaged = on;
    const U = v.root.userData;
    for (let k = 0; k < 2; k++) {
      const grp = k ? U.roof : U.body; if (!grp) continue;
      const ch = grp.children;
      for (let i = 0; i < ch.length; i++) { const m0 = ch[i].userData.m0; if (m0) ch[i].material = on ? darkOf(m0) : m0; }
    }
  }

  _updBuilding(v, e, dt, y, vis) {
    // (owner 2026-11-20: the rival's town center is known from the start, its growth is not - an age-up is seen
    // only once someone goes there)
    const fogd = this._fogged(e);
    const age = v.age != null && fogd ? v.age : this._vage(v, e);
    if (MASKED[e.type]) { const mk = this._maskOf(e); if (mk !== v.mask) { v.mask = mk; if (age === v.age) v.quiet = true; this._buildBuildingMesh(v, e, age); } }
    // an age-up waits for the new era's generated model (owner 2026-11-17: the old look flashed in between):
    // the building keeps its old model until that era's files are in (or failed)
    if (age !== v.age) { if (glbPlanned(e.type, age) && !hasGlb(glbKey(e.type), age) && !eraSettled(age)) loadEra(age); else this._buildBuildingMesh(v, e, age); }
    // a generated model finished loading after this building was drawn: swap it in (quietly, no finish bounce)
    else if (v.glbv !== glbVersion() && !v.root.userData.glb && (hasGlb(glbKey(e.type), age) || (e.type === 'dock' && hasSea(dockFile(age))))) { v.quiet = true; this._buildBuildingMesh(v, e, age); }
    const root = v.root, U = root.userData;
    if (v.pop > 0) this._pop(v, dt);
    root.position.set(e.x, y, e.z);
    v.x = e.x; v.z = e.z;
    // a player's quarter turn: eased over ~0.3 s the short way round (in the fog: the turn last seen)
    if (!fogd) {
      let d = bYaw(e.type, e.rot) - v.ry;
      if (d !== 0) {
        d = Math.atan2(Math.sin(d), Math.cos(d));
        v.ry = Math.abs(d) < .002 ? bYaw(e.type, e.rot) : v.ry + d * Math.min(1, dt * 12);
        root.rotation.y = v.ry;
      }
    }
    if (e.type === 'farm') {
      U.fur.visible = U.fur.visible && true;
      // until it is built the farm is only its marked-out ground: the granary rises with the work (no ready-made
      // building before a farmer ever came), the plots get furrows and crops once it is done
      const done = !!e.done, pr = done ? 1 : Math.max(0, Math.min(1, e.progress || 0));
      if (U.plotted && v._granP !== pr) {
        v._granP = pr;
        for (const grp of [U.body, U.roof]) if (grp) { grp.visible = pr > 0.02; grp.scale.set(1, Math.max(0.02, pr), 1); }
      }
      if (done) this._farm(v, e); else { U.fur.visible = false; U.crops.count = 0; v.farmKey = -1; }
      return;
    }
    const p = e.done ? 1 : Math.max(0, Math.min(1, e.progress || 0));
    let consOn = false;
    try { consOn = updateConstruction(v, e, p, dt, y, vis, { fx: this.fx, color: this._color(e.owner), time: this.t }); }
    catch (err) { if (!v.consErr) { v.consErr = 1; console.warn('[entities] construction rig failed:', e.type, err); } try { disposeConstruction(v); } catch (e2) { v.cons = null; } v.prog = -1; }
    if (!consOn && e.done && !fogd) { try { updateRepair(v, e, dt); } catch (err) { /* visual only */ } }
    if (!consOn && p !== v.prog) {
      v.prog = p;
      const bs = Math.min(1, p / .85);
      U.body.visible = bs > .02; U.body.scale.y = Math.max(.02, bs);
      const rs = (p - .85) / .15;
      U.roof.visible = rs > 0; U.roof.scale.y = Math.max(.02, Math.min(1, rs));
      U.roof.position.y = 0;
      U.scaf.visible = p < 1;
      if (U.wallScaf) U.scaf.scale.y = .3 + .7 * Math.min(1, p * 1.6); // scaffold poles rise with the work
      if (U.spin) U.spin.visible = p >= 1;
    }
    if (U.spin && vis && e.done) U.spin.rotation[U.spinAxis] += dt * U.spinSpeed;
    if (U.live) { try { seaAnimBuilding(this, v, e, dt, this.t, U); } catch (err) { /* visual only */ } }
    const dmg = fogd ? v.damaged : e.done && e.hp < e.maxHp * .5;   // (in the fog: the damage last seen)
    if (dmg !== v.damaged) this._tint(v, dmg);
    if (!vis || fogd || !this.fx || !this.fx.smoke || !e.done) return;
    v.smokeT -= dt;
    if (v.smokeT <= 0) {
      const s = e.size || 1;
      if (dmg) {
        v.smokeT = .5 + Math.random() * .6;
        this.fx.smoke(e.x + (Math.random() - .5) * s * .6, y + v.h * (.5 + Math.random() * .4), e.z + (Math.random() - .5) * s * .6);
      } else if (U.chim.length && (e.type === 'house' || e.type === 'blacksmith' || e.type === 'factory' || e.type === 'temple' || v.age >= 4)) {
        v.smokeT = e.type === 'factory' ? .45 + Math.random() * .4 : 1.2 + Math.random() * 2.2;
        const i = ((Math.random() * (U.chim.length / 3)) | 0) * 3;
        const k = v.k || 1, cr = Math.cos(v.ry || 0), sr = Math.sin(v.ry || 0), cx = U.chim[i], cz = U.chim[i + 2];   // (the chimney turns with the model)
        this.fx.smoke(e.x + (cx * cr + cz * sr) * k, y + U.chim[i + 1] * k, e.z + (cz * cr - cx * sr) * k);
      } else v.smokeT = 5;
    }
  }

  // a finished building that looks exactly like its static model this frame (may be merged into its chunk)
  _static(v, e, vis) {
    if (!vis || !e.done || e.dead || v.cons || v.pop > 0 || v.damaged) return false;
    const r = v.root, U = r.userData, k = v.k || 1;
    if (r.rotation.y !== bYaw(e.type, e.rot) && !this._fogged(e)) return false;   // (still turning)
    if (!r.visible || r.scale.x !== k || r.scale.y !== k || r.scale.z !== k || (U.scaf && U.scaf.visible && U.scaf.children.length)) return false;   // (an empty scaffold group, e.g. a farm's, is no scaffold)
    return grpStatic(U.slab) && grpStatic(U.body) && grpStatic(U.roof);
  }
  // pasture sheep -> shared instanced batches (same matrices the sheep meshes had)
  _sheep(v, vis) {
    const U = v.root.userData, live = U.live, sl = U.sheepSlots, on = !!this.batching;
    if (U.sheepInst !== on) { U.sheepInst = on; for (let i = 0; i < sl.length; i++) sl[i].o.visible = !on; }
    if (!on || !vis || !live.visible) return;
    live.updateWorldMatrix(true, true);
    for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      if (!s.sh.visible) continue;
      let b = this._shb.get(s.k);
      if (!b) { b = new IBatch(this.scene, s.o.geometry, s.o.material, 0, s.o.castShadow, s.o.receiveShadow); this._shb.set(s.k, b); }
      b.push(s.o.matrixWorld.elements);
    }
  }

  _animHuman(v, e, t, gt, riding) {
    const P = v.P, a = e.anim;
    let ll = 0, rl = 0, la = 0, ra = 0, lean = 0, bob = 0, hy = 0, tool = '', thrust = 0;
    if (a === 'walk') {
      const s = Math.sin(t * 10);
      ll = s * .7; rl = -s * .7; la = -s * .5; ra = s * .5; bob = Math.abs(s) * .035;
      if (P.gun) ra = -.7; if (P.bow) la = -.5;
      if (P.staff) { ra = -.3 + s * .12; ll *= .5; rl *= .5; }   /* healer: short steps under the robe, staff held upright */
    } else if (a === 'chop' || a === 'mine' || a === 'build' || a === 'farm' || a === 'forage') {
      const s = Math.sin(t * 7.5);
      if (a === 'forage') { ra = -.9 + s * .4; la = -.9 - s * .4; lean = .75; }
      else if (a === 'farm') { ra = -1.0 + s * .6; la = -.7 + s * .4; lean = .45 + s * .12; tool = 'hoe'; }
      else { ra = -1.6 + s * 1.05; la = -.5 + s * .2; lean = .18 + s * .14; tool = a === 'chop' ? 'axe' : a === 'mine' ? 'pick' : 'hammer'; }
    } else if (a === 'attack') {
      const k = gt - (e.attackT == null ? -9 : e.attackT);
      if (P.bow) { la = -1.5; ra = k >= 0 && k < .25 ? -1.5 : -1.1 - Math.min(.4, Math.max(0, k - .25) * .6); }
      else if (P.gun) { la = -1.25; ra = -1.5; if (k >= 0 && k < .25) { ra -= (.25 - k) * 2; lean = -(.25 - k) * .5; } }
      else if (P.spear) { ra = -1.35; la = -.6; if (k >= 0 && k < .34) { const p = k / .34; thrust = Math.sin(p * PI); ra = -1.5; lean = thrust * .32; la = -.9; } }
      else if (k >= 0 && k < .38) { const p = k / .38; ra = -2.5 + p * 2.3; lean = Math.sin(p * PI) * .3; la = -.5; }
      else { ra = -1.0 + Math.sin(t * 3) * .08; la = -.5; }
    } else {
      bob = Math.sin(t * 2) * .008; hy = Math.sin(t * .55) * .5;
      la = Math.sin(t * 1.3) * .05; ra = P.gun ? -.75 : P.staff ? -.3 + la : -la;
    }
    if (!riding) { P.legL.rotation.x = ll; P.legR.rotation.x = rl; P.torso.position.y = .38 + bob; }
    P.armL.rotation.x = la; P.armR.rotation.x = ra; P.torso.rotation.x = lean; P.head.rotation.y = hy;
    if (P.spear) { if (v.az0 === undefined) v.az0 = P.armR.position.z; P.armR.position.z = v.az0 + thrust * .3; }
    if (P.tools) {
      if (tool !== v.tool) { if (v.tool) P.tools[v.tool].visible = false; if (tool) P.tools[tool].visible = true; v.tool = tool; }
      const c = e.carry && e.carry.amount > 0 ? e.carry.type : '';
      if (c !== v.carry) {
        v.carry = c; P.bundle.visible = !!c;
        // (instanced units: the load is drawn through a shared batch per material in _emit, its own mesh only moves)
        v.carryM = c ? CARRY_M[c] || MT.wood : null;
        if (c) P.bundle.material = v.slots ? HIDE_M : v.carryM;
      }
    }
  }

  // gp / amp (deer): a gait phase and leg swing that follow the drawn speed; others step at a fixed pace
  _animHorse(v, e, t, walking, gp, amp) {
    const hl = v.P.hl;
    if (walking) {
      const ph = gp === undefined ? t * 11 : gp, A = amp === undefined ? .7 : amp;
      const s = Math.sin(ph), c = Math.cos(ph);
      hl[0].rotation.x = s * A; hl[3].rotation.x = s * A; hl[1].rotation.x = -s * A; hl[2].rotation.x = -s * A;
      v.P.hbody.position.y = Math.abs(c) * .04 * A / .7; v.P.hhead.rotation.x = s * .08;
    } else {
      hl[0].rotation.x = hl[1].rotation.x = hl[2].rotation.x = hl[3].rotation.x = 0;
      v.P.hbody.position.y = 0; v.P.hhead.rotation.x = Math.sin(t * .7) * .12 + (v.rig === 'deer' && Math.sin(t * .23) > .3 ? .8 : 0);
    }
  }

  _updUnit(v, e, dt, time, gt) {
    if (e.kind === 'unit' && !e.dead) {
      const age = this._vage(v, e);
      if (age !== v.age || v.utype !== e.type) { this._buildUnitMesh(v, e, age); v.pop = .5; }
      else if (v.rig === 'ship' && !v.P.glb && hasSea(e.type)) this._buildUnitMesh(v, e, age);   // (its generated model arrived)   // (type: a final-form upgrade)
    }
    if (v.pop > 0) this._pop(v, dt);
    const map = this.game.map, k = Math.min(1, dt * 14);
    const dx = e.x - v.x, dz = e.z - v.z, ox = v.x, oz = v.z, snap = dx * dx + dz * dz > 9;
    if (snap) { v.x = e.x; v.z = e.z; } else { v.x += dx * k; v.z += dz * k; }
    let dr = (e.rot || 0) - v.rot;
    while (dr > PI) dr -= PI * 2; while (dr < -PI) dr += PI * 2;
    v.rot += dr * Math.min(1, dt * 12);
    const y = map.heightAt(v.x, v.z);
    const root = v.root, inner = v.inner, P = v.P, t = time + v.phase;
    root.position.set(v.x, y, v.z); root.rotation.y = v.rot;
    if (v.rig === 'ship' || v.rig === 'train') { try { return seaAnimUnit(this, v, e, dt, t, gt, y); } catch (err) { return y; } }
    if (e.kind === 'resource' && e.alive === false && !e.dead) { inner.rotation.z = PI / 2; inner.position.y = .12; return y; }   // a hunted animal's carcass lies on its side
    if (e.dead || e.anim === 'die') {
      const d = Math.max(0, gt - (e.deathTime == null ? gt : e.deathTime)), p = Math.min(1, d / .5);
      if (v.rig === 'human') { inner.rotation.x = -PI / 2 * p; inner.position.y = .08 * p - (d > 2 ? (d - 2) * .22 : 0); }
      else { inner.rotation.z = PI / 2 * p * (v.rig === 'cav' || v.rig === 'deer' || v.rig === 'cart' ? 1 : .35); inner.position.y = .12 * p - (d > 2 && e.kind !== 'resource' ? (d - 2) * .3 : 0); }   // (a predator carcass stays lying until hunted out)
      return y;
    }
    const walking = e.anim === 'walk';
    switch (v.rig) {
      case 'human': this._animHuman(v, e, t, gt, false); break;
      case 'cav': this._animHorse(v, e, t, walking); this._animHuman(v, e, t, gt, true); break;
      case 'deer': {
        // the sim moves deer without an anim state (they are resources, e.anim stays unset): walk while the drawn
        // position moves, with stride rate and swing following the speed (slow wander vs a flight from a hunter)
        const sp = snap || !(dt > 0) ? 0 : Math.hypot(v.x - ox, v.z - oz) / dt;
        v.spd = (v.spd || 0) + (sp - (v.spd || 0)) * Math.min(1, dt * 8);
        const mv = v.spd > .12;
        if (mv) v.gph = (v.gph || 0) + dt * Math.min(16, 5 + v.spd * 5);
        this._animHorse(v, e, t, mv, v.gph, .4 + .3 * Math.min(1, v.spd / 2)); break;
      }
      case 'cart': this._animHorse(v, e, t, walking); break;
      case 'ram': {
        const q = gt - (e.attackT == null ? -9 : e.attackT);
        P.log.position.z = e.anim === 'attack' && q >= 0 && q < .5 ? Math.sin(q / .5 * PI) * .35 - .1 : 0; break;
      }
      case 'catapult': {
        const q = gt - (e.attackT == null ? -9 : e.attackT);
        P.arm.rotation.x = q >= 0 && q < .2 ? -.4 + q / .2 * 1.9 : q >= .2 && q < 1.2 ? 1.5 - (q - .2) * 1.9 : -.4; break;
      }
      case 'cannon': {
        const q = gt - (e.attackT == null ? -9 : e.attackT);
        P.barrel.position.z = q >= 0 && q < .5 ? -.22 * (1 - q / .5) : 0; break;
      }
    }
    const fx = this.fx;
    if (fx) {
      if (walking && v.rig !== 'human' && v.rig !== 'deer' && fx.puff) {
        v.dustT = (v.dustT || 0) - dt;
        if (v.dustT <= 0) { v.dustT = .22 + Math.random() * .12; fx.puff(v.x - Math.sin(v.rot) * .35, y, v.z - Math.cos(v.rot) * .35); }
      }
      if (e.attackT != null && e.attackT !== v.lastAtk) {
        const first = v.lastAtk === undefined; v.lastAtk = e.attackT;
        const big = v.rig === 'cannon';
        if (!first && fx.muzzle && (big || P.gun) && gt - e.attackT < .35) {
          const fxd = Math.sin(v.rot), fzd = Math.cos(v.rot), r = big ? 1.0 : .62;
          fx.muzzle(v.x + fxd * r, y + (big ? .5 : .78) * (big ? 1 : USCALE * .9), v.z + fzd * r, fxd, fzd, big);
        }
      }
    }
    if (P.wheels && walking) { const w = P.wheels; for (let i = 0; i < w.length; i++) w[i].rotation.x += dt * 6; }
    return y;
  }

  // instanced unit segments: one InstancedMesh per shared merged geometry, refilled every frame with the
  // world matrices of the on-screen units (their roots skip the scene's own matrix pass: updated here instead);
  // selection rings go the same way, one batch per ring material
  _emit(v) {
    const root = v.root, sl = v.slots;
    root.updateMatrixWorld(true);
    outer: for (let i = 0; i < sl.length; i++) {
      const s = sl[i];
      for (let o = s.p; o && o !== root; o = o.parent) if (!o.visible) continue outer;
      let b = this._ib.get(s.g);
      if (!b) { b = new IBatch(this.scene, s.g, UMAT, 0, s.g.userData.cast !== false, s.g.userData.recv !== false); this._ib.set(s.g, b); }
      b.push(s.p.matrixWorld.elements);
    }
    const bu = v.carryM && v.P && v.P.bundle;
    if (bu && bu.material === HIDE_M) {
      let on = true; for (let o = bu; o && o !== root; o = o.parent) if (!o.visible) { on = false; break; }
      if (on) {
        let b = this._cb.get(v.carryM);
        if (!b) { b = new IBatch(this.scene, bu.geometry, v.carryM, 0, bu.castShadow, bu.receiveShadow); this._cb.set(v.carryM, b); }
        b.push(bu.matrixWorld.elements);
      }
    }
    const r = v.ring;
    if (r && r.visible) {
      let b = this._rb.get(r.material);
      if (!b) { b = new IBatch(this.scene, G.ring, r.material, 5, false, false); this._rb.set(r.material, b); }
      b.push(r.matrixWorld.elements);
    }
  }
  _flushBatches() {
    for (const M of [this._ib, this._rb, this._shb, this._cb]) for (const [k, b] of M) if (b.flush()) M.delete(k);
    this._hpB.flush(); this._hpF.flush();
  }

  // Arrows and bolts fly a ballistic arc (2026-11-15): drawn from the sim's own flight (sx/sy/sz -> tx/ty/tz, t / dur,
  // arc height), so they land on the tick the damage does, but on a clock that runs on between sim ticks (smooth at any
  // frame rate) and nose along the velocity: up, level at the apex, then diving onto the target. Per arrow (from its
  // id, view only) the lob is up to 20 % higher (never lower: it must clear the wall) and bends a little sideways, so a volley fans out instead of one
  // line. Bullets, stones and cannonballs follow the sim's position as before.
  _updProjectiles(dt = 0) {
    const arr = this.game.projectiles, map = this.game.map, fog = this.game.fog, N = map.size, f = this.frame;
    if (arr) for (let i = 0; i < arr.length; i++) {
      const p = arr[i];
      let r = this.projs.get(p.id);
      if (!r) {
        const type = p.type === 'arrow' && p.bolt ? 'bolt' : PROJ[p.type] ? p.type : 'arrow', pool = this.projPool[type];
        let mesh = pool.pop();
        if (!mesh) { const d = PROJ[type]; mesh = new THREE.Mesh(d[0], d[1]); mesh.scale.set(d[2], d[3], d[4]); mesh.castShadow = true; this.scene.add(mesh); }
        const hs = Math.imul(p.id ^ 0x9e3779b9, 0x85ebca6b) >>> 0, h1 = (hs & 1023) / 1023, h2 = ((hs >>> 10) & 1023) / 1023;
        r = { mesh, type, px: p.x, py: p.y, pz: p.z, seen: f, pt: p.t, off: 0, k: 1 + 0.2 * h1, w: (h2 - 0.5) * (type === 'bolt' ? 0.12 : 0.36) };
        this.projs.set(p.id, r);
        mesh.position.set(p.x, p.y, p.z);
      }
      r.seen = f;
      const m = r.mesh;
      let x = p.x, y = p.y, z = p.z, vx = p.x - r.px, vy = p.y - r.py, vz = p.z - r.pz;
      if (p.type === 'arrow' && p.dur > 0) {
        if (p.t !== r.pt) { r.pt = p.t; r.off = 0; } else r.off = Math.min(r.off + dt, 1 / 30);
        const fr = Math.min(1, (p.t + r.off) / p.dur), dx = p.tx - p.sx, dz = p.tz - p.sz, dy = p.ty - p.sy, L = Math.hypot(dx, dz) || 1;
        const h = p.arc * r.k, nx = -dz / L, nz = dx / L, sw = r.w * Math.sin(fr * Math.PI), sv = r.w * Math.PI * Math.cos(fr * Math.PI);
        x = p.sx + dx * fr + nx * sw; z = p.sz + dz * fr + nz * sw; y = p.sy + dy * fr + 4 * h * fr * (1 - fr);
        vx = dx + nx * sv; vz = dz + nz * sv; vy = dy + 4 * h * (1 - 2 * fr);
      } else if (p.vx !== undefined && p.vz !== undefined) { vx = p.vx; vy = p.vy || 0; vz = p.vz; }
      m.position.set(x, y, z);
      if (vx * vx + vy * vy + vz * vz > 1e-8) m.lookAt(x + vx, y + vy, z + vz);
      r.px = p.x; r.py = p.y; r.pz = p.z;
      const tx = x | 0, tz = z | 0;
      m.visible = !fog || tx < 0 || tz < 0 || tx >= N || tz >= N || fog[tz * N + tx] === 2;
    }
    for (const [id, r] of this.projs) {
      if (r.seen !== f) { r.mesh.visible = false; this.projPool[r.type].push(r.mesh); this.projs.delete(id); }
    }
  }

  update(dt, time) {
    const game = this.game, map = game.map;
    if (!map) return;
    this.frame++; this.t += dt;
    const f = this.frame, gt = game.time || 0, tm = this.t;
    MINE_T.value = tm;
    const cam = this.ctx.renderer && this.ctx.renderer.camera;
    if (cam) { const me = cam.matrixWorld.elements; this._rx = me[0]; this._ry = me[1]; this._rz = me[2]; } else { this._rx = 1; this._ry = 0; this._rz = 0; }
    this._camQ = cam ? cam.quaternion : _hq;
    const fr = cam ? this._frustum.setFromProjectionMatrix(_fm.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse)) : null;
    let flagB = null;
    const meId = this._me();
    this._buildLinks();
    for (const e of game.entities.values()) {
      if (e.kind === 'resource' && e.type === 'tree') continue;
      let v = this.views.get(e.id);
      if (!v) v = this._create(e);
      v.e = e; v.seen = f;
      const vis = !!game.isEntityVisible(e) && !e.aboard;
      if (vis !== v.vis) { v.vis = vis; v.root.visible = vis; }
      const sel = this.selected.has(e.id);
      let y;
      if (e.kind === 'building') {
        y = e.type === 'dock' ? dockY(map, e.x, e.z, e.tx, e.tz, e.size) : map.heightAt(e.x, e.z);   // (the dock's deck above the water, see dockY)
        this._updBuilding(v, e, dt, y, vis);
        this._sb.sync(v, this.batching && this._static(v, e, vis), tm);
        if (v.root.userData.sheepSlots) this._sheep(v, vis);
        if (sel && e.owner === meId && e.rally) flagB = e;
      } else if (v.rig) {
        if (!vis && !e.dead) { v.x = e.x; v.z = e.z; v.rot = e.rot || 0; continue; }
        // off-screen (with a margin for shadows): no animation and no matrix updates; every pose is a function of
        // time, so it snaps to the right one on the first frame back in view (ships / trains keep their trail state)
        if (fr && v.rig !== 'ship' && v.rig !== 'train') {
          _fs.center.set(e.x, map.heightAt(e.x, e.z) + .5, e.z);
          if (!fr.intersectsSphere(_fs)) {
            v.x = e.x; v.z = e.z; v.rot = e.rot || 0;
            if (!v.culled) { v.culled = true; v.root.matrixWorldAutoUpdate = false; }   // (instanced units: always off)
            v.root.visible = false;
            continue;
          }
          if (v.culled) { v.culled = false; v.root.visible = vis; v.root.matrixWorldAutoUpdate = !v.slots; }
        }
        y = this._updUnit(v, e, dt, tm, gt);
      } else {
        y = map.heightAt(e.x, e.z);
        if (e.amount !== v.lastAmt) {
          if (v.lastAmt !== -1) v.amtT = tm;   // (being gathered: drawn on its own for a while, see below)
          v.lastAmt = e.amount;
          const s = (e.scale || 1) * (.55 + .45 * Math.max(0, Math.min(1, e.amount / (e.maxAmount || e.amount || 1))));
          v.root.scale.setScalar(s);
        }
        v.root.position.set(e.x, y, e.z); v.x = e.x; v.z = e.z;
        if (e.type === 'fish') { try { seaAnimFish(v, tm); y = .02; } catch (err) { /* visual only */ } }
        // stone, gold and berry bushes never move: merged per chunk like the finished buildings (static-batch.js),
        // except while being gathered (each trip shrinks them a little; 6 s after the last change they rejoin)
        else this._sb.sync(v, this.batching && vis && tm - (v.amtT == null ? -99 : v.amtT) > 6, tm);
      }
      if (sel && vis && !e.dead) this._ring(v, e); else if (v.ring && v.ring.visible) v.ring.visible = false;
      const showHp = vis && !e.dead && e.maxHp > 0 && !(e.kind === 'building' && this._fogged(e)) && (sel ? e.kind !== 'resource' || e.type === 'deer' || !!e.live : ((e.kind !== 'resource' || e.live) && e.hp < e.maxHp));
      if (showHp) this._hp(v, e, true, y);
      if (v.slots && v.root.visible) this._emit(v);
    }
    this._flushBatches();
    const dead = this._dead; dead.length = 0;
    for (const v of this.views.values()) {
      if (v.seen === f) continue;
      // a rival's known town center that fell in the fog stays drawn (not pickable) until someone sees the spot
      if (v.kind === 'building' && v.e && v.e.known && this._fogged(v.e)) {
        if (!v.ghost) { v.ghost = 1; v.vis = true; v.root.visible = true; const i = this.proxies.indexOf(v.proxy); if (i >= 0) this.proxies.splice(i, 1); }
        continue;
      }
      dead.push(v);
    }
    for (let i = 0; i < dead.length; i++) this._remove(dead[i]);
    this._sb.flush(tm);
    if (flagB) {
      const r = flagB.rally;
      this.flag.visible = true; this.flag.position.set(r.x, map.heightAt(r.x, r.z), r.z);
      this.flagCloth.material = mat(this._color(meId), .8, 0);
      this.flagCloth.scale.y = .26 * (1 + Math.sin(tm * 5) * .06);
    } else if (this.flag.visible) this.flag.visible = false;
    this._updProjectiles(dt);
  }

  pick(raycaster) {
    _hits.length = 0;
    raycaster.intersectObjects(this.proxies, false, _hits);
    for (let i = 0; i < _hits.length; i++) {
      const v = _hits[i].object.userData.view;
      if (v && v.vis && v.e && !v.e.dead) { const id = v.id; _hits.length = 0; return id; }
    }
    _hits.length = 0;
    return null;
  }

  setSelection(ids) {
    this.selected.clear();
    if (ids) for (let i = 0; i < ids.length; i++) this.selected.add(ids[i]);
  }

  // tile -> owner of every wall/gate/tower/castle (finished or foundation), rebuilt each frame
  _buildLinks() {
    const m = this._links || (this._links = new Map()); m.clear();
    const N = this.game.map.size, bs = this.game.buildings;
    if (!bs) return;
    for (const b of bs) {
      if (b.dead || !LINKS[b.type]) continue;
      const s = b.size || 1;
      for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) m.set((b.tz + j) * N + b.tx + i, b.owner);
    }
  }
  // which orthogonal neighbours of a 1-tile wall/gate/tower link to it (same owner); extra = tile set of the same owner (preview line)
  _maskOf(e, extra) {
    if (!MASKED[e.type]) return 0;
    if (e.type === 'rail' || e.type === 'dock') return seaMask(this, e, extra);
    const es = e.size || (BUILDINGS[e.type] && BUILDINGS[e.type].size) || 1;
    if (es > 1) {   // a 3x3 tower: walls that meet the middle of a side (bit 16 = drawn at 3x, see tower())
      const N = this.game.map.size, L = this._links, h = es >> 1; let m = 16;
      const side = [[e.tx + h, e.tz - 1], [e.tx + es, e.tz + h], [e.tx + h, e.tz + es], [e.tx - 1, e.tz + h]];
      for (let i = 0; i < 4; i++) { const k = side[i][1] * N + side[i][0]; if ((L && L.get(k) === e.owner) || (extra && extra.has(k))) m |= 1 << i; }
      return m;
    }
    const N = this.game.map.size, L = this._links; let m = 0;
    for (let i = 0; i < 4; i++) {
      const x = e.tx + WDIR[i][0], z = e.tz + WDIR[i][1], k = z * N + x;
      if ((L && L.get(k) === e.owner) || (extra && extra.has(k))) m |= 1 << i;
      if (e.type === 'gate') { const nb = this.game.buildingAt ? this.game.buildingAt(x, z) : null; if (nb && nb.type === 'gate' && nb.owner === e.owner && !nb.dead) m |= 32 << i; }
    }
    return m;
  }
  // the placement ghost's quarter turn (0..3, key R while placing): kept for every later ghost until changed
  setGhostRot(rot) {
    this._ghostRot = (rot | 0) & 3;
    if (this.ghosts) for (const g of this.ghosts) if (g && g.root.visible) g.root.rotation.y = bYaw(g.type, this._ghostRot);
  }
  // spec {type,tx,tz,valid[,size][,rot]} or an ARRAY of specs (wall line preview); null hides all
  setGhost(spec) {
    const pool = this.ghosts || (this.ghosts = []);
    const specs = !spec ? [] : Array.isArray(spec) ? spec : [spec];
    let extra = null;
    if (specs.length > 1 || (specs[0] && MASKED[specs[0].type])) {
      if (!this._links) this._buildLinks();
      const N = this.game.map.size; extra = new Set();
      for (const s of specs) if (s && MASKED[s.type]) extra.add(s.tz * N + s.tx);
    }
    const meId = this._me(), age = this._age(meId);
    for (let i = 0; i < specs.length; i++) {
      const sp = specs[i]; if (!sp) continue;
      const mask = extra ? this._maskOf({ type: sp.type, tx: sp.tx, tz: sp.tz, owner: meId }, extra) : 0;
      let g = pool[i];
      if (!g || g.type !== sp.type || g.age !== age || g.mask !== mask) {
        if (g) { this.scene.remove(g.root); disposeBaked(g.root); }
        const cur = this._sizes || (this._sizes = { towncenter: 4, house: 2, farm: 3, barracks: 3, archery: 3, stable: 3, blacksmith: 3, market: 3, storage: 2, tower: 1, wall: 1, gate: 1, university: 3, castle: 4, siege: 3, factory: 4 });
        const def = BUILDINGS && BUILDINGS[sp.type];
        Object.assign(cur, { mill: 3, lumbercamp: 2, minecamp: 2, temple: 3, academy: 3, bank: 3, dock: 3, pasture: 3, station: 3, rail: 1 });
        const size = sp.size || (def && def.size) || cur[sp.type] || 2, bs = (def && def.baseSize) || size;
        const root = makeBuilding(sp.type, bs, age, this._color(meId), mask);
        if (size !== bs) root.scale.setScalar(size / bs);   // (the model at its design size, scaled to the footprint)
        // (a pasture's sheep as big as in the placed pen: see pastureSheepK)
        if (root.userData.live && root.userData.live.userData.sheep) { const shk = pastureSheepK(size / bs); for (const sh of root.userData.live.userData.sheep) sh.scale.setScalar(shk); }
        root.userData.size = size; root.userData.scaf.visible = false;
        // the plot it takes: the same square a selected building shows (green / red with the ghost)
        // (the shared cached square: disposeBaked leaves it alone; drawn at the design size, the root scales it to the plot)
        const ol = new THREE.Mesh(sqGeo(size), GHM[0]); ol.scale.setScalar(bs / size); ol.position.y = .14; root.add(ol);
        root.traverse(o => { if (o.isMesh || o.isInstancedMesh) { o.castShadow = false; o.receiveShadow = false; o.renderOrder = 8; } });
        this.scene.add(root);
        g = pool[i] = { root, type: sp.type, age, mask, valid: null };
      }
      const valid = !!sp.valid;
      if (valid !== g.valid) { g.valid = valid; const m = GHM[valid ? 0 : 1]; g.root.traverse(o => { if (o.isMesh) o.material = m; }); }
      const s = g.root.userData.size, x = sp.tx + s / 2, z = sp.tz + s / 2;
      g.root.visible = true;
      g.root.position.set(x, sp.type === 'dock' ? dockY(this.game.map, x, z, sp.tx, sp.tz, s) + .03 : this.game.map.heightAt(x, z) + .03, z);
      g.root.rotation.y = bYaw(sp.type, sp.rot != null ? sp.rot : this._ghostRot);
    }
    for (let i = specs.length; i < pool.length; i++) if (pool[i]) pool[i].root.visible = false;
    // keep the old single-ghost fields meaningful
    this.ghost = pool[0] ? pool[0].root : null; this.ghostType = pool[0] ? pool[0].type : null; this.ghostValid = pool[0] ? pool[0].valid : null; this.ghostAge = age;
  }

  // debug / bench: instanced batches and the shared unit geometry cache
  stats() {
    let inst = 0, refs = 0, live = 0;
    for (const b of this._ib.values()) inst += b.mesh.count;
    for (const c of UGEO.values()) { refs += c.refs; if (c.refs > 0) live++; }
    let held = 0; for (const v of this.views.values()) if (v.ukey) held++;
    return { batches: this._ib.size, ringBatches: this._rb.size, instances: inst, hpBars: this._hpB.mesh.count, geoKeys: UGEO.size, liveKeys: live, refs, held, sheepBatches: this._shb.size, staticBatch: this._sb.stats() };
  }

  dispose() {
    this._sb.dispose();
    for (const v of this.views.values()) {
      this.scene.remove(v.root);
      if (!v.rig) disposeBaked(v.root);
      if (v.ukey) { releaseUnit(v.ukey); v.ukey = null; }
    }
    this.views.clear(); this.proxies.length = 0;
    for (const M of [this._ib, this._rb, this._shb]) { for (const b of M.values()) b.dispose(); M.clear(); }
    this._hpB.dispose(); this._hpF.dispose();
    for (const r of this.projs.values()) this.scene.remove(r.mesh);
    this.projs.clear();
    for (const k in this.projPool) { for (const m of this.projPool[k]) this.scene.remove(m); this.projPool[k].length = 0; }
    if (this.ghosts) { for (const g of this.ghosts) if (g) { this.scene.remove(g.root); disposeBaked(g.root); } this.ghosts.length = 0; }
    this.ghost = null;
    this.scene.remove(this.flag);
  }
}

// the raw (unbaked) unit model, for screens outside the game world (the menu lobby draft: drafts/lobby.html)
export { makeUnitRaw as makeUnitModel };
// the procedural building model (dev tools: tools/zfight-check.js sweeps every type x era x mask for coplanar faces)
export { makeBuilding as makeBuildingModel };
