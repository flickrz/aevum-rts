// Aevum - generated 3D building models (2026-11-17). Buildings of every age drawn from GLB files (Seedream concept ->
// Meshy 3D -> shrunk offline to ~7k triangles with a small 256px texture, see aevum-3d-deneme/kucult-doku.mjs)
// instead of the procedural models. View only: nothing here touches the simulation.
// An era's files load in the background the first time a building of that era is drawn; until a model is ready (or if
// it fails) the procedural model is drawn, and EntityView rebuilds the building once it arrives (glbVersion()).
// Team colour: the models carry a blue banner / roof cloth; texture pixels of that saturated blue are repainted per
// player colour (one texture copy per model and colour). Off switch for A/B: ?glb=0 in the URL.
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/addons/libs/meshopt_decoder.module.js';
import { assetUrls, cdnFailed } from '../cdn.js';

// the types that have a model, per era (files: assets/models/<era>/<type>.glb). Each age's buildings evolve from the
// previous age's model. Pasture (live sheep), farm, rails and the station stay procedural; ships and the dock: see loadSea.
const BASE = ['towncenter', 'house', 'barracks', 'storage', 'lumbercamp', 'minecamp'];
const B1 = BASE.concat(['archery', 'stable', 'blacksmith', 'market', 'tower', 'temple']);
const B2 = B1.concat(['university', 'castle', 'siege']);
const B3 = B2.concat(['academy', 'bank']);
// walls and gates (from the Bronze Age): a one-tile wall piece, a small tower for corners / junctions / ends and the
// gatehouse of a 3-wide gate; each is stretched to the game's wall dimensions (addGlbPiece)
const WALLS = ['wallseg', 'wallpost', 'gatehouse'];
// the pasture (an empty pen: the game's own sheep walk in it) in every age, the farm's middle building from the Bronze Age
const FILES = { 0: BASE.concat(['pasture', 'temple']),   /* (2026-11-21: the temple opens in the Stone Age) */ 1: B1.concat(WALLS, ['pasture', 'farmmill']), 2: B2.concat(WALLS, ['pasture', 'farmmill']),
  3: B3.concat(WALLS, ['pasture', 'farmmill']), 4: B3.concat(['factory'], WALLS, ['pasture', 'farmmill']) };
const PIECE = { wallseg: 1, wallpost: 1, gatehouse: 1 };
// which horizontal axis of a piece's file runs along the wall line ('z': turned a quarter round on load);
// default: the longer one (a gatehouse); per-file overrides where the piece is about as long as it is thick
const RUN_Z = {};
// (2026-11-20: the host's free monthly bandwidth ran out, the models were most of it) on the live site the models come
// from jsDelivr, pinned to the asset commit (src/cdn.js ASSET_PIN); a file the CDN cannot give comes from the host.
function loadGlb(rel, ok, fail) {
  const urls = assetUrls('models/' + rel);
  if (urls.length < 2) { loader.load(urls[0], ok, undefined, fail); return; }
  loader.load(urls[0], ok, undefined, () => { cdnFailed(); loader.load(urls[1], ok, undefined, fail); });
}
const ERA_STARTED = new Set(), ERA_DONE = new Set(), WANTED = new Set();   // (WANTED: eras a building asked for)
let loader = null;

const GEO = new Map();        // 'era|type' -> { geo, img (texture source) | null, blue (team-colour mask) }
const MATS = new Map();       // 'era|type|color' -> material (texture repainted in that player's colour)
const VC_MAT = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .92, metalness: 0 });   // untextured files
let version = 0;
let started = false;

function enabled() {
  try { return !(typeof location !== 'undefined' && /[?&]glb=0\b/.test(location.search)); } catch (err) { return true; }
}

// the banner blue: saturated, fairly bright, hue 200-245 (sRGB 0..1); the dull blue-grey slate roofs stay as they are
function isTeamBlue(r, g, b) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), sat = mx > 0 ? (mx - mn) / mx : 0;
  if (sat <= .55 || mx <= .45 || b !== mx) return false;
  const d = mx - mn; let h = (r - g) / d + 4; h *= 60; if (h < 0) h += 360;
  return h > 200 && h < 245;
}

// plain float, non-indexed copy of a (possibly quantized / meshopt) primitive, with the node transform applied
// an attribute read straight from its array through the index (what toNonIndexed() + getX() return, the same
// denormalized values as doubles, without the copy and a call per value); null for an interleaved one
function flat(A, idx, n) {
  if (!A) return null;
  const il = !!A.isInterleavedBufferAttribute, a = il ? A.data.array : A.array, s = A.itemSize, out = new Float64Array(n * s);
  const st = il ? A.data.stride : s, off = il ? A.offset : 0;
  let k = 1, lo = -Infinity;
  if (A.normalized) {
    if (a instanceof Uint32Array) k = 4294967295; else if (a instanceof Uint16Array) k = 65535; else if (a instanceof Uint8Array) k = 255;
    else if (a instanceof Int32Array) { k = 2147483647; lo = -1; } else if (a instanceof Int16Array) { k = 32767; lo = -1; } else if (a instanceof Int8Array) { k = 127; lo = -1; }
  }
  for (let i = 0; i < n; i++) {
    const v = (idx ? idx[i] : i) * st + off, o = i * s;
    for (let c = 0; c < s; c++) out[o + c] = k === 1 ? a[v + c] : Math.max(a[v + c] / k, lo);
  }
  return out;
}
function plainGeo(mesh) {
  mesh.updateWorldMatrix(true, false);
  const G = mesh.geometry, ix = G.index ? G.index.array : null, n0 = ix ? G.index.count : G.attributes.position.count;
  const fp = flat(G.attributes.position, ix, n0), fc = flat(G.attributes.color, ix, n0), fu = flat(G.attributes.uv, ix, n0);
  if (fp !== undefined && fc !== undefined && fu !== undefined) {
    const e = mesh.matrixWorld.elements, cs = G.attributes.color ? G.attributes.color.itemSize : 0;
    const pos = new Float32Array(n0 * 3), col = fc ? new Float32Array(n0 * 3) : null, uv = fu ? new Float32Array(n0 * 2) : null;
    for (let i = 0; i < n0; i++) {
      const x = fp[i * 3], y = fp[i * 3 + 1], z = fp[i * 3 + 2], w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
      pos[i * 3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
      pos[i * 3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
      pos[i * 3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
      if (col) { col[i * 3] = fc[i * cs]; col[i * 3 + 1] = fc[i * cs + 1]; col[i * 3 + 2] = fc[i * cs + 2]; }
      if (uv) { uv[i * 2] = fu[i * 2]; uv[i * 2 + 1] = fu[i * 2 + 1]; }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    return g;
  }
  // (interleaved attributes: the general path)
  const src = mesh.geometry.index ? mesh.geometry.toNonIndexed() : mesh.geometry;
  const n = src.attributes.position.count, pos = new Float32Array(n * 3);
  const P = src.attributes.position, C = src.attributes.color, UV = src.attributes.uv, e = mesh.matrixWorld.elements;
  const col = C ? new Float32Array(n * 3) : null, uv = UV ? new Float32Array(n * 2) : null;
  for (let i = 0; i < n; i++) {
    // (Vector3.applyMatrix4 inlined: the same arithmetic, without a call per vertex)
    const x = P.getX(i), y = P.getY(i), z = P.getZ(i), w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    pos[i * 3] = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    pos[i * 3 + 1] = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    pos[i * 3 + 2] = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    if (col) { col[i * 3] = C.getX(i); col[i * 3 + 1] = C.getY(i); col[i * 3 + 2] = C.getZ(i); }
    if (uv) { uv[i * 2] = UV.getX(i); uv[i * 2 + 1] = UV.getY(i); }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  if (col) g.setAttribute('color', new THREE.BufferAttribute(col, 3));
  if (uv) g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

// one geometry per file: footprint centred on the origin, base on y = 0, longest side 1 (scaled at use);
// wall pieces become a unit box with the wall line along x
// (in three steps, each its own task through prepLater: copy, shape, team mask; done(result or null))
function prepare(scene, piece, key, done) {
  let mesh = null; scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });   // (the shrunk files hold one primitive)
  if (!mesh) return done(null);
  const geo = plainGeo(mesh), map = mesh.material && mesh.material.map;
  prepLater(() => {
    try { prepShape(geo, piece, key); } catch (err) { console.warn('[glb] prepare failed', key, err); return done(null); }
    prepLater(() => {
      try { done(prepMask(geo, map)); } catch (err) { console.warn('[glb] prepare failed', key, err); done(null); }
    }, true);
  }, true);
}
// a wall piece's file can stand a few degrees turned (the Middle Age gatehouse: its left tower sat a fifth of a tile in
// front of the wall line and its right one behind it, owner 2026-11-18): turn it so its footprint's bounding box is the
// smallest (its sides then run along the axes) before it is stretched to the wall's box
function footArea(p, a) {
  const c = Math.cos(a), s = Math.sin(a);
  let x0 = Infinity, x1 = -Infinity, z0 = Infinity, z1 = -Infinity;
  for (let i = 0; i < p.length; i += 3) {
    const x = p[i] * c + p[i + 2] * s, z = -p[i] * s + p[i + 2] * c;
    if (x < x0) x0 = x; if (x > x1) x1 = x; if (z < z0) z0 = z; if (z > z1) z1 = z;
  }
  return (x1 - x0) * (z1 - z0);
}
function deskew(geo) {
  const p = geo.attributes.position.array, D = Math.PI / 180;
  let best = 0, bestA = footArea(p, 0);
  for (let d = -15; d <= 15; d++) { const A = footArea(p, d * D); if (A < bestA - 1e-9) { bestA = A; best = d * D; } }
  const c0 = best;
  for (let d = -10; d <= 10; d++) { const a = c0 + d * .1 * D, A = footArea(p, a); if (A < bestA - 1e-9) { bestA = A; best = a; } }
  if (Math.abs(best) > .3 * D) geo.rotateY(best);   // (a fraction of a degree: left as it is)
  return best;
}
// shear a unit-box piece along axis a (by axis b) so its extent along a is the smallest, then fit it to the unit box again
function unshear(geo, a, b) {
  const p = geo.attributes.position.array;
  const ext = (k) => { let lo = Infinity, hi = -Infinity; for (let i = 0; i < p.length; i += 3) { const v = p[i + a] - k * p[i + b]; if (v < lo) lo = v; if (v > hi) hi = v; } return hi - lo; };
  let best = 0, bestE = ext(0);
  for (let k = -.4; k <= .4001; k += .02) { const e = ext(k); if (e < bestE - 1e-9) { bestE = e; best = k; } }
  const c0 = best;
  for (let k = c0 - .02; k <= c0 + .0201; k += .002) { const e = ext(k); if (e < bestE - 1e-9) { bestE = e; best = k; } }
  if (Math.abs(best) < .01) return;   // (square enough: left as it is)
  let lo = Infinity, hi = -Infinity;
  for (let i = 0; i < p.length; i += 3) { const v = p[i + a] - best * p[i + b]; p[i + a] = v; if (v < lo) lo = v; if (v > hi) hi = v; }
  const s = 1 / (hi - lo || 1), m = (lo + hi) / 2;
  for (let i = 0; i < p.length; i += 3) p[i + a] = (p[i + a] - m) * s;
  geo.attributes.position.needsUpdate = true;
}
// a unit-box piece whose front (or back) edge runs at a slant along the line: fit a line to the edge of its feet
// (lowest third, outer parts only: a gatehouse's towers, a wall's ends) and stretch the depth so that edge is straight
function untaper(geo) {
  const p = geo.attributes.position.array, NB = 20;
  for (const sg of [1, -1]) {
    const edge = new Array(NB).fill(-Infinity);
    for (let i = 0; i < p.length; i += 3) {
      if (p[i + 1] > .33 || Math.abs(p[i]) < .2) continue;
      const b = Math.min(NB - 1, Math.max(0, Math.floor((p[i] + .5) * NB))), z = sg * p[i + 2];
      if (z > edge[b]) edge[b] = z;
    }
    // least squares edge(x) = a + b x over the filled bins
    let n = 0, sx = 0, sz = 0, sxx = 0, sxz = 0;
    for (let b = 0; b < NB; b++) { if (!(edge[b] > .1)) continue; const x = (b + .5) / NB - .5, z = edge[b]; n++; sx += x; sz += z; sxx += x * x; sxz += x * z; }
    if (n < 4) continue;
    const den = n * sxx - sx * sx; if (Math.abs(den) < 1e-9) continue;
    const bb = (n * sxz - sx * sz) / den, aa = (sz - bb * sx) / n;
    if (Math.abs(bb) * .5 < .015) continue;   // (the edge is level within ~1.5 %: left as it is)
    for (let i = 0; i < p.length; i += 3) {
      const z = sg * p[i + 2]; if (z <= 0) continue;
      const L = aa + bb * p[i], f = Math.min(1.4, Math.max(.7, .5 / (L > .05 ? L : .05)));
      p[i + 2] = sg * z * f;
    }
  }
  // fit the box again
  let lo = Infinity, hi = -Infinity;
  for (let i = 2; i < p.length; i += 3) { if (p[i] < lo) lo = p[i]; if (p[i] > hi) hi = p[i]; }
  const s = 1 / (hi - lo || 1), m = (lo + hi) / 2;
  for (let i = 2; i < p.length; i += 3) p[i] = (p[i] - m) * s;
  geo.attributes.position.needsUpdate = true;
}
function prepShape(geo, piece, key) {
  // (gatehouses from the Middle Age on only: the Bronze Age gate and every wall piece were fine as they were, owner)
  const square = piece && /^[2-9]\|gatehouse$/.test(key);
  if (square) deskew(geo);
  geo.computeBoundingBox();
  const b = geo.boundingBox, side = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) || 1;
  geo.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  geo.scale(1 / side, 1 / side, 1 / side);
  if (piece) {
    geo.computeBoundingBox();
    const bb = geo.boundingBox, runZ = key in RUN_Z ? RUN_Z[key] : (bb.max.z - bb.min.z) > (bb.max.x - bb.min.x);
    if (runZ) geo.rotateY(Math.PI / 2);
    geo.computeBoundingBox();
    const q = geo.boundingBox;
    geo.scale(1 / (q.max.x - q.min.x || 1), 1 / (q.max.y - q.min.y || 1), 1 / (q.max.z - q.min.z || 1));
    // (and slanted: the Middle Age gatehouse's front stood ~.2 tiles to the side of its back, a parallelogram no turn
    //  straightens, owner 2026-11-18: one tower stood proud of the wall, the other left a gap. Shear it square)
    if (square) { unshear(geo, 0, 2); unshear(geo, 2, 0); }
    // (and tapered: the Gunpowder Age gatehouse's right tower is shallower than its left one, so it sat behind the
    //  wall face while the left one stood proud. Its feet's front and back edges are each stretched to a straight line)
    if (square) untaper(geo);
  }
  geo.computeVertexNormals();   // non-indexed: flat normals per face
  geo.computeBoundingBox();
}
function prepMask(geo, map) {
  const r = { geo, img: null, blue: null, map: null };
  if (map && map.image) {
    // texture: keep its pixels on a canvas so each player can get a repainted copy
    const im = map.image, w = im.width, h = im.height;
    const cv = document.createElement('canvas'); cv.width = w; cv.height = h;
    const cx = cv.getContext('2d', { willReadFrequently: true }); cx.drawImage(im, 0, 0);
    const data = cx.getImageData(0, 0, w, h), px = data.data, idx = [];
    // (the exact test runs only where blue is the brightest channel and bright enough: most pixels skip it)
    for (let i = 0, j = 0; i < w * h; i++, j += 4) {
      const R = px[j], G = px[j + 1], B = px[j + 2];
      if (B < R || B < G || B <= 114) continue;
      if (isTeamBlue(R / 255, G / 255, B / 255)) idx.push(i);
    }
    r.img = data; r.blue = idx.length ? Int32Array.from(idx) : null; r.map = map; r.flipY = map.flipY;
  } else if (geo.attributes.color) {
    // untextured (vertex-coloured) file: mark the team-colour vertices
    const c = geo.attributes.color.array, n = c.length / 3, idx = [], s = new THREE.Color();
    for (let i = 0; i < n; i++) {
      s.setRGB(c[i * 3], c[i * 3 + 1], c[i * 3 + 2], THREE.LinearSRGBColorSpace);
      const f = (x) => x <= .0031308 ? x * 12.92 : 1.055 * Math.pow(x, 1 / 2.4) - .055;
      if (isTeamBlue(f(s.r), f(s.g), f(s.b))) idx.push(i);
    }
    r.blue = idx.length ? Int32Array.from(idx) : null;
  }
  return r;
}

// Files that arrive together are prepared one per task (2026-11-18: an era loading in the background made
// 50-230 ms main-thread stalls mid-match when several models were prepared back to back in one task)
const PREP_Q = [];
let prepBusy = false;
function prepLater(job, next) {   // (next: right after the running job, so a started model finishes first)
  if (next) PREP_Q.unshift(job); else PREP_Q.push(job);
  if (!prepBusy) { prepBusy = true; setTimeout(prepPump, 0); }
}
function prepPump() {
  const job = PREP_Q.shift();
  if (job) job();
  if (PREP_Q.length) setTimeout(prepPump, 0); else prepBusy = false;
}

// A prepared model is drawn once into a 1x1 target on a later frame (one model a frame), so its geometry, texture
// and shader are on the GPU before a building first uses it (2026-11-18: an age-up's first frame was 75 ms, half of
// it these first uploads). Nothing on screen changes.
// (drawn to the canvas through a 1x1 viewport right before the frame's own render, which clears it: the same light
// set-up as the game scene, so the same shader program is compiled; one shared material, never disposed, keeps it)
const WARM_Q = [];
const WARMED = new Set();
let warmCols = [];
let warmScene = null, warmCam = null, warmStd = null;
const _vp = new THREE.Vector4();
function queueWarm(key, r) {
  if (!r) return;
  if (warmCols.length) {
    if (r.blue) {
      for (let i = 0; i < warmCols.length; i++) {
        const col = warmCols[i], wk = key + '|' + col;
        if (!WARMED.has(wk)) { WARMED.add(wk); WARM_Q.push({ key, r, col }); }
      }
    } else {
      const col = warmCols[0], wk = key + '|n';
      if (!WARMED.has(wk)) { WARMED.add(wk); WARM_Q.push({ key, r, col }); }
    }
  } else {
    const wk = key + '|raw';
    if (!WARMED.has(wk)) { WARMED.add(wk); WARM_Q.push({ key, r, col: null }); }
  }
}
export function glbWarmColors(cols) {
  warmCols = [...new Set((cols || []).map(c => c & 0xffffff))];
  for (const [key, r] of GEO) queueWarm(key, r);
}
export function glbWarm(renderer) {
  const it = WARM_Q.shift();
  if (!it || !renderer) return;
  const r = it.r;
  if (!warmScene) {
    warmScene = new THREE.Scene(); warmCam = new THREE.OrthographicCamera(-1, 1, 1, -1, -10, 10);
    const sun = new THREE.DirectionalLight(0xffffff, 1); sun.castShadow = true;
    warmScene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1), sun, sun.target);
    warmStd = new THREE.MeshStandardMaterial({ roughness: .9, metalness: 0 });
  }
  let geo = r.geo, mat = VC_MAT;
  if (it.col != null && GEO.has(it.key)) {
    const L = look(it.key, it.col);
    geo = L.geo; mat = L.mat;
  } else if (r.img) {
    mat = warmStd; if (mat.map !== r.map) { mat.map = r.map; mat.needsUpdate = !mat.userData.mapped; mat.userData.mapped = true; }
  }
  const m = new THREE.Mesh(geo, mat); m.frustumCulled = false; m.receiveShadow = true;
  warmScene.add(m);
  const sh = renderer.shadowMap.autoUpdate;
  renderer.getViewport(_vp); renderer.shadowMap.autoUpdate = false;
  renderer.setViewport(0, 0, 1, 1);
  try { renderer.render(warmScene, warmCam); }
  finally { renderer.setViewport(_vp); renderer.shadowMap.autoUpdate = sh; warmScene.remove(m); }
}

// start loading one era's models (once); the Stone Age loads with the game
export function loadEra(era, pre) {
  era = era | 0;
  if (!FILES[era] || !enabled()) return;
  if (!pre && !WANTED.has(era)) { WANTED.add(era); if (ERA_DONE.has(era)) loadEra(era + 1, true); }
  if (ERA_STARTED.has(era)) return;
  ERA_STARTED.add(era);
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  let left = FILES[era].length;
  // once an era a building asked for is in (or failed), the next one (only that one) starts loading in the background, so an age-up finds its models ready
  const settle = () => { if (--left > 0) return; ERA_DONE.add(era); version++; if (WANTED.has(era)) setTimeout(() => loadEra(era + 1, true), 1500); };
  for (const type of FILES[era]) {
    loadGlb(era + '/' + type + '.glb', (gltf) => prepLater(() => {
      const fin = (r) => { if (r) { const key = era + '|' + type; GEO.set(key, r); version++; queueWarm(key, r); } settle(); };
      try { prepare(gltf.scene, PIECE[type], era + '|' + type, fin); }
      catch (err) { console.warn('[glb] prepare failed', era, type, err); settle(); }
    }), (err) => { console.warn('[glb] load failed', era, type, err && err.message); settle(); });
  }
}
// an era's files have all arrived (or failed): a building can be drawn in it without waiting any longer
export function eraSettled(era) { return ERA_DONE.has(era | 0) || !enabled(); }
export function loadGlbModels() {
  if (started) return;
  started = true;
  loadEra(0);
}
export function glbVersion() { return version; }
export function hasGlb(type, era) { return GEO.has((era | 0) + '|' + type); }
// this type has (or will have) a model in this era
export function glbPlanned(type, era) {
  const f = FILES[era | 0];
  if (type === 'wall' || type === 'gate') type = 'wallseg';
  else if (type === 'farm') type = 'farmmill';
  return !!f && f.includes(type) && enabled();
}

// geometry + material for one model in one player's colour (cached per model and colour)
const VC_GEO = new Map();
function look(key, color) {
  const base = GEO.get(key), k = key + '|' + color;
  if (base.img) {
    let m = MATS.get(k);
    if (!m) {
      let tex = base.map;
      if (base.blue) {
        const { width: w, height: h } = base.img, out = new ImageData(new Uint8ClampedArray(base.img.data), w, h), px = out.data;
        const tc = new THREE.Color(color).convertLinearToSRGB(), bi = base.blue;
        for (let idx = 0; idx < bi.length; idx++) {
          const o = bi[idx] << 2;
          const l = Math.max(.55, Math.min(1.3, (px[o] + px[o + 1] + px[o + 2]) / 3 / 140));   // keep the cloth's shading
          px[o] = Math.min(255, tc.r * 255 * l); px[o + 1] = Math.min(255, tc.g * 255 * l); px[o + 2] = Math.min(255, tc.b * 255 * l);
        }
        const cv = document.createElement('canvas'); cv.width = w; cv.height = h; cv.getContext('2d').putImageData(out, 0, 0);
        tex = new THREE.CanvasTexture(cv);
        tex.flipY = base.flipY; tex.colorSpace = THREE.SRGBColorSpace; tex.anisotropy = 4;
      }
      m = new THREE.MeshStandardMaterial({ map: tex, roughness: .9, metalness: 0 });
      MATS.set(k, m);
    }
    return { geo: base.geo, mat: m };
  }
  let g = VC_GEO.get(k);
  if (!g) {
    g = base.geo.clone();
    if (base.blue && g.attributes.color) {
      const col = g.attributes.color.array, tc = new THREE.Color(color), bi = base.blue;
      for (let idx = 0; idx < bi.length; idx++) {
        const o = bi[idx] * 3;
        const s = Math.max(.55, Math.min(1.3, (col[o] + col[o + 1] + col[o + 2]) / 3 / .25));
        col[o] = tc.r * s; col[o + 1] = tc.g * s; col[o + 2] = tc.b * s;
      }
    }
    VC_GEO.set(k, g);
  }
  return { geo: g, mat: VC_MAT };
}

// add the model to a building's body group: fills `fit` (0..1) of the footprint `size`; returns its height (0: no model)
// (height > 0: stretched upward to that height, footprint unchanged)
export function addGlbBuilding(body, type, era, size, color, fit = .96, height = 0, even = false) {
  const key = (era | 0) + '|' + type;
  if (!GEO.has(key)) return 0;
  const L = look(key, color), m = new THREE.Mesh(L.geo, L.mat);
  let k = size * fit, mh = GEO.get(key).geo.boundingBox.max.y * k, m0y = 0;
  if (even === 'exact' && height) { m0y = height / mh; mh = height; }   // (exact: stretched or squashed to the height, width kept)
  else if (even && height && mh > height) { k *= height / mh; mh = height; }   // (even: a taller model shrinks whole to the height)
  m.scale.set(k, m0y ? k * m0y : height > mh ? k * height / mh : k, k);
  m.position.y = -.02;   // (the model's grass base sinks a hair into the pad)
  m.castShadow = true; m.receiveShadow = true; m.userData.glb = true;   // (shared geometry: bake() keeps it as is)
  body.add(m);
  return Math.max(mh, height);
}

// one wall piece (unit box from prepare) stretched to w (along the line) x h x d, centred at (x, z), turned by rot
export function addGlbPiece(body, type, era, color, w, h, d, x, z, rot) {
  const key = (era | 0) + '|' + type;
  if (!GEO.has(key)) return false;
  const L = look(key, color), m = new THREE.Mesh(L.geo, L.mat);
  m.scale.set(w, h, d); m.position.set(x, 0, z); m.rotation.y = rot || 0;
  m.castShadow = true; m.receiveShadow = true; m.userData.glb = true;
  body.add(m);
  return true;
}

// ---------- trees ----------
// Two generated trees (assets/models/trees/broad.glb, pine.glb) replace the renderer's procedural broadleaf / pine.
// Textured files (the painted building style, ~800 triangles and one small texture each) are drawn whole by the
// renderer's crown mesh with their texture (trunk mesh emptied); untextured ones are split by colour into a trunk and
// a grey-shaded crown the climate tints. Height as the procedural trees, crown squeezed to their width so forests
// read as separate trees. The renderer swaps its tree chunks' geometry once a file has loaded (treeGeo / treeVersion).
const TREES = { pine: [2.6, 1.0] };   // [height, max crown width] (owner 2026-11-18: the broadleaf keeps the old low-poly tree)
const TREE_GEO = {};
let treeVer = 0, treesStarted = false;
function prepTree(scene, height, width) {
  let mesh = null; scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) return null;
  const g = plainGeo(mesh), map = mesh.material && mesh.material.map;
  g.computeBoundingBox();
  const b = g.boundingBox, k = height / ((b.max.y - b.min.y) || 1);
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(k, k, k);
  g.computeBoundingBox();
  const q = g.boundingBox, sq = Math.min(1, width / (Math.max(q.max.x - q.min.x, q.max.z - q.min.z) || 1));
  g.scale(sq, 1, sq);
  if (map) { g.computeVertexNormals(); g.computeBoundingSphere(); return { whole: g, map }; }
  const P = g.attributes.position.array, C = g.attributes.color ? g.attributes.color.array : null;
  if (!C) return null;
  const tr = [], lf = [], lc = [];
  for (let t = 0; t < P.length / 9; t++) {
    let r = 0, gg = 0, bb = 0;
    for (let v = 0; v < 3; v++) { r += C[t * 9 + v * 3]; gg += C[t * 9 + v * 3 + 1]; bb += C[t * 9 + v * 3 + 2]; }
    const leafy = gg > r * 1.05 && gg > bb;
    const dst = leafy ? lf : tr;
    for (let i = 0; i < 9; i++) dst.push(P[t * 9 + i]);
    if (leafy) { const l = (r + gg + bb) / 9; for (let v = 0; v < 3; v++) lc.push(l, l, l); }
  }
  if (!lf.length) return null;
  let avg = 0; for (let i = 0; i < lc.length; i += 3) avg += lc[i]; avg = avg / (lc.length / 3) || 1;
  for (let i = 0; i < lc.length; i++) lc[i] = Math.min(1.25, Math.max(.45, lc[i] / avg * .85));
  const mk = (arr, col) => {
    const geo = new THREE.BufferGeometry(); geo.setAttribute('position', new THREE.Float32BufferAttribute(arr, 3));
    if (col) geo.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    geo.computeVertexNormals(); geo.computeBoundingSphere(); return geo;
  };
  return { trunk: tr.length ? mk(tr) : null, leaf: mk(lf, lc) };
}
export function loadTrees() {
  if (treesStarted || !enabled()) return;
  treesStarted = true;
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  for (const kind of Object.keys(TREES)) {
    loadGlb('trees/' + kind + '.glb', (gltf) => {
      try { const r = prepTree(gltf.scene, TREES[kind][0], TREES[kind][1]); if (r) { TREE_GEO[kind] = r; treeVer++; } }
      catch (err) { console.warn('[glb] tree failed', kind, err); }
    }, (err) => console.warn('[glb] tree load failed', kind, err && err.message));
  }
}
export function treeVersion() { return treeVer; }
// kind 0 = broadleaf, 1 = pine (the renderer's tree kinds): { whole, map } (textured) or { trunk, leaf }, null while
// not loaded
export function treeGeo(kind) { return TREE_GEO[kind ? 'pine' : 'broad'] || null; }

// ---------- farm crops ----------
// One generated wheat clump (assets/models/trees/crop.glb, ~100 flat-coloured triangles) replaces the farm's tuft
// shape for every age. Normalised to a 1 x 1 x 1 box standing on y = 0 like the tuft; its colours become a grey
// shading so the crop stage colours (instance colours: seed, shoot, ripe, gold, stubble) still tint it.
let CROP = null;
function prepCrop(scene) {
  let mesh = null; scene.traverse(o => { if (o.isMesh && !mesh) mesh = o; });
  if (!mesh) return null;
  const g = plainGeo(mesh);
  g.computeBoundingBox();
  const b = g.boundingBox;
  g.translate(-(b.min.x + b.max.x) / 2, -b.min.y, -(b.min.z + b.max.z) / 2);
  g.scale(1 / ((b.max.x - b.min.x) || 1), 1 / ((b.max.y - b.min.y) || 1), 1 / ((b.max.z - b.min.z) || 1));
  const C = g.attributes.color && g.attributes.color.array;
  if (C) {
    let avg = 0; const n = C.length / 3;
    for (let i = 0; i < n; i++) avg += (C[i * 3] + C[i * 3 + 1] + C[i * 3 + 2]) / 3;
    avg = avg / n || 1;
    for (let i = 0; i < n; i++) { const l = Math.min(1.3, Math.max(.4, (C[i * 3] + C[i * 3 + 1] + C[i * 3 + 2]) / 3 / avg * .9)); C[i * 3] = C[i * 3 + 1] = C[i * 3 + 2] = l; }
  }
  g.computeVertexNormals(); g.computeBoundingSphere();
  return g;
}
export function loadCrop() {
  if (CROP !== null || !enabled()) return;
  CROP = false;   // (loading)
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  loadGlb('trees/crop.glb', (gltf) => { try { CROP = prepCrop(gltf.scene) || false; } catch (err) { CROP = false; } },
    (err) => console.warn('[glb] crop load failed', err && err.message));
}
// the wheat clump geometry, or null while it is not loaded
export function cropGeo() { return CROP || null; }

// ---------- ships and docks ----------
// (2026-11-25, owner: the procedural dock and ships were "düz ve sade, 3d değil") generated models in
// assets/models/sea/: one per ship type (every age draws the same ship) and two docks (wooden: Stone / Bronze Age,
// stone quay: later ages). Loaded the first time a ship or dock is drawn; until then the procedural model is drawn and
// the view rebuilds it once the file is in (glbVersion()). Each file's longest side is turned onto z and, per file,
// flipped so the bow / the pier points to +z (SEA_FLIP), the way the procedural models face.
const SEA_FILES = ['fishboat', 'transport', 'galley', 'galleon', 'ironclad', 'dock0', 'dock2'];
const SEA_FLIP = { dock0: Math.PI };          // name -> extra turn (radians) after the long side is on z
let seaStarted = false;
export function loadSea() {
  if (seaStarted || !enabled()) return;
  seaStarted = true;
  if (!loader) { loader = new GLTFLoader(); loader.setMeshoptDecoder(MeshoptDecoder); }
  for (const name of SEA_FILES) {
    loadGlb('sea/' + name + '.glb', (gltf) => prepLater(() => {
      try {
        prepare(gltf.scene, false, 's|' + name, (r) => {
          if (!r) return;
          const g = r.geo; g.computeBoundingBox();
          const b = g.boundingBox;
          if (b.max.x - b.min.x > b.max.z - b.min.z) g.rotateY(Math.PI / 2);
          if (SEA_FLIP[name]) g.rotateY(SEA_FLIP[name]);
          g.computeVertexNormals(); g.computeBoundingBox();
          const skey = 's|' + name; GEO.set(skey, r); version++; queueWarm(skey, r);
        });
      } catch (err) { console.warn('[glb] sea prepare failed', name, err); }
    }), (err) => console.warn('[glb] sea load failed', name, err && err.message));
  }
}
export const dockFile = (era) => (era | 0) >= 2 ? 'dock2' : 'dock0';
export function hasSea(name) { return GEO.has('s|' + name); }
// the model with its long side (z) `len` long, base at y, turned by rotY; returns the mesh (null: not loaded)
export function addSeaModel(parent, name, color, len, y = 0, rotY = 0) {
  const key = 's|' + name;
  if (!GEO.has(key)) return null;
  const L = look(key, color), m = new THREE.Mesh(L.geo, L.mat), b = L.geo.boundingBox;
  const k = len / ((b.max.z - b.min.z) || 1);
  m.scale.setScalar(k); m.position.y = y; m.rotation.y = rotY;
  m.castShadow = true; m.receiveShadow = true; m.userData.glb = true;
  parent.add(m);
  return m;
}
export function seaHeight(name) { const r = GEO.get('s|' + name); if (!r) return 0; const b = r.geo.boundingBox; return (b.max.y) / ((b.max.z - b.min.z) || 1); }
