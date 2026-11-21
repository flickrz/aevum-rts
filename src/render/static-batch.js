// Aevum - static batching of finished buildings (view only, 2026-11-15).
// Late in a match most draw calls were buildings: every wall / gate piece drew ~5 baked meshes (one per material),
// twice with the shadow pass. Finished buildings that look exactly like their static model are merged here, per
// 16x16-tile chunk and per material, into one world-space mesh. The view's own meshes stay in place (selection,
// proxies, rings, repair rigs, smoke and every animation keep working) and are only hidden while the chunk's merged
// mesh draws them. A building leaves its chunk on the frame it stops looking static (under construction, finish
// bounce, age-up pop, damaged tint, hidden by fog, a new model for a new mask or age, dead); the chunk then falls back to
// drawing every member on its own until it is rebuilt (after its members have been stable for a moment, at most a
// couple of chunk rebuilds per frame). Merged geometries are disposed on every rebuild.
import * as THREE from 'three';

const CHUNK = 16;            // tiles per chunk side
const SETTLE = .3;           // seconds a chunk's membership must stay unchanged before it is (re)merged
const BUDGET_MS = 2;         // rebuild more than one chunk in a frame only while under this budget
const INST_MIN = 3000;       // vertices: a mesh this big (a generated building) is instanced, not copied into the merge

const _nm = new THREE.Matrix3();
const DEFAULT_OBC = THREE.Material.prototype.onBeforeCompile;

// the meshes of a building model that are drawn as-is and can be merged: slab, body and roof groups only
// (spinning sails, sheep, crops, scaffolds, rigs, rings and the pick proxy are other children of the root)
function modelMeshes(root) {
  const U = root.userData, out = [];
  for (const g of [U.slab, U.body, U.roof]) {
    if (!g || !g.visible) continue;
    g.traverse(o => {
      if (!o.isMesh || o.isInstancedMesh || o.isSkinnedMesh) return;
      const m = o.material;
      if (!m || Array.isArray(m) || m.transparent || m.visible === false || o.renderOrder !== 0) return;
      const geo = o.geometry;
      if (!geo || !geo.attributes.position || geo.morphAttributes.position || geo.groups.length > 1) return;
      for (const k in geo.attributes) if (geo.attributes[k].isInterleavedBufferAttribute) return;
      for (let p = o; p && p !== g; p = p.parent) if (!p.visible) return;
      out.push(o);
    });
  }
  return out;
}
function sig(o) {
  const a = o.geometry.attributes; let s = o.material.id + '|' + (o.castShadow ? 1 : 0) + (o.receiveShadow ? 1 : 0);
  for (const k of Object.keys(a).sort()) s += '|' + k + a[k].itemSize + (a[k].normalized ? 'n' : '') + a[k].array.constructor.name;
  return s;
}

// merge meshes (same material + attribute layout) into one non-indexed world-space geometry
function mergeWorld(list) {
  const first = list[0].geometry, names = Object.keys(first.attributes);
  let total = 0;
  for (const o of list) { const g = o.geometry; total += g.index ? g.index.count : g.attributes.position.count; }
  const out = {};
  for (const k of names) { const a = first.attributes[k]; out[k] = new a.array.constructor(total * a.itemSize); }
  let base = 0;
  for (const o of list) {
    const g = o.geometry, idx = g.index, n = idx ? idx.count : g.attributes.position.count, mw = o.matrixWorld;
    _nm.getNormalMatrix(mw);
    for (const k of names) {
      const a = g.attributes[k], src = a.array, is = a.itemSize, dst = out[k];
      let w = base * is;
      if (k === 'position') {
        const e = mw.elements;
        for (let i = 0; i < n; i++) {
          const j = (idx ? idx.array[i] : i) * is, x = src[j], y = src[j + 1], z = src[j + 2];
          dst[w] = e[0] * x + e[4] * y + e[8] * z + e[12];
          dst[w + 1] = e[1] * x + e[5] * y + e[9] * z + e[13];
          dst[w + 2] = e[2] * x + e[6] * y + e[10] * z + e[14]; w += 3;
        }
      } else if (k === 'normal') {
        const e = _nm.elements;
        for (let i = 0; i < n; i++) {
          const j = (idx ? idx.array[i] : i) * is, x = src[j], y = src[j + 1], z = src[j + 2];
          const nx = e[0] * x + e[3] * y + e[6] * z, ny = e[1] * x + e[4] * y + e[7] * z, nz = e[2] * x + e[5] * y + e[8] * z;
          const l = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1;
          dst[w] = nx / l; dst[w + 1] = ny / l; dst[w + 2] = nz / l; w += 3;
        }
      } else {
        for (let i = 0; i < n; i++) { const j = (idx ? idx.array[i] : i) * is; for (let c = 0; c < is; c++) dst[w++] = src[j + c]; }
      }
    }
    base += n;
  }
  const geo = new THREE.BufferGeometry();
  for (const k of names) { const a = first.attributes[k]; geo.setAttribute(k, new THREE.BufferAttribute(out[k], a.itemSize, a.normalized)); }
  geo.computeBoundingSphere();
  return geo;
}

export class StaticBatches {
  constructor(scene) {
    this.scene = scene; this.chunks = new Map(); this.rebuilds = 0;
  }
  // per building view and frame: want = it looks exactly like its static model this frame
  sync(v, want, now) {
    const m = v.sb;
    if (m && (!want || m.root !== v.root || m.x !== v.root.position.x || m.y !== v.root.position.y || m.z !== v.root.position.z || m.ry !== v.root.rotation.y)) this.leave(v);
    if (want && !v.sb && v.sbSkip !== v.root) this._join(v, now);
  }
  _join(v, now) {
    const root = v.root, meshes = modelMeshes(root);
    if (!meshes.length) { v.sbSkip = root; return; }
    const p = root.position, key = Math.floor(p.x / CHUNK) + ',' + Math.floor(p.z / CHUNK);
    let c = this.chunks.get(key);
    if (!c) this.chunks.set(key, c = { key, members: new Set(), meshes: [], built: false, dirty: true, t: now });
    c.members.add(v); c.t = now; c.dirty = true;
    v.sb = { c, root, meshes, x: p.x, y: p.y, z: p.z, ry: root.rotation.y };   // (drawn on its own until the chunk is merged again)
  }
  // the view stops being static (or is removed): drawn on its own again, the chunk falls back until rebuilt
  leave(v) {
    const m = v.sb; if (!m) return;
    v.sb = null;
    for (const o of m.meshes) o.visible = true;
    const c = m.c; c.members.delete(v);
    this._unbuild(c);
    c.t = this._now || 0; c.dirty = true;
    if (!c.members.size) this.chunks.delete(c.key);
  }
  _unbuild(c) {
    for (const mesh of c.meshes) { this.scene.remove(mesh); if (mesh.userData.inst) mesh.dispose(); else mesh.geometry.dispose(); }   // (also a half-done failed build; an instanced mesh shares its model's geometry)
    c.meshes.length = 0;
    if (!c.built) return;
    c.built = false;
    for (const v of c.members) for (const o of v.sb.meshes) o.visible = true;
  }
  _build(c) {
    this._unbuild(c);
    const groups = new Map();
    for (const v of c.members) {
      v.root.updateWorldMatrix(true, true);
      for (const o of v.sb.meshes) { const k = sig(o); let a = groups.get(k); if (!a) groups.set(k, a = []); a.push(o); }
    }
    for (const all of groups.values()) {
      // big shared models (the generated buildings: one ~10k-triangle geometry per model and colour) are drawn as
      // instances of that geometry instead of being copied into the chunk's merged mesh (2026-11-18: copying them
      // made every chunk rebuild a 10-17 ms hitch); everything else is merged as before
      const byGeo = new Map(), rest = [];
      for (const o of all) {
        const g = o.geometry;
        // (a material with its own shader code may read modelMatrix as the world transform: those stay merged)
        if ((g.index ? g.index.count : g.attributes.position.count) < INST_MIN || o.material.onBeforeCompile !== DEFAULT_OBC) { rest.push(o); continue; }
        let a = byGeo.get(g); if (!a) byGeo.set(g, a = []); a.push(o);
      }
      for (const [geo, list] of byGeo) {
        const o0 = list[0], mesh = new THREE.InstancedMesh(geo, o0.material, list.length);
        list.forEach((o, i) => mesh.setMatrixAt(i, o.matrixWorld));
        mesh.computeBoundingSphere();
        mesh.castShadow = o0.castShadow; mesh.receiveShadow = o0.receiveShadow;
        mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false; mesh.userData.staticBatch = c.key; mesh.userData.inst = true;
        this.scene.add(mesh); c.meshes.push(mesh);
      }
      if (!rest.length) continue;
      const o0 = rest[0], mesh = new THREE.Mesh(mergeWorld(rest), o0.material);
      mesh.castShadow = o0.castShadow; mesh.receiveShadow = o0.receiveShadow;
      mesh.matrixAutoUpdate = false; mesh.matrixWorldAutoUpdate = false; mesh.userData.staticBatch = c.key;
      this.scene.add(mesh); c.meshes.push(mesh);
    }
    for (const v of c.members) for (const o of v.sb.meshes) o.visible = false;
    c.built = true; c.dirty = false; this.rebuilds++;
  }
  // after all views were synced: merge chunks whose membership has settled
  flush(now) {
    this._now = now;
    const t0 = performance.now();
    let n = 0;
    for (const c of this.chunks.values()) {
      if (!c.dirty || now - c.t < SETTLE) continue;
      if (n && performance.now() - t0 > BUDGET_MS) break;
      try { this._build(c); } catch (err) { console.warn('[static-batch]', err); this._unbuild(c); c.t = now + 5; c.dirty = true; }
      n++;
    }
  }
  stats() {
    let built = 0, members = 0, meshes = 0;
    for (const c of this.chunks.values()) { if (c.built) built++; members += c.members.size; meshes += c.meshes.length; }
    return { chunks: this.chunks.size, built, members, meshes, rebuilds: this.rebuilds };
  }
  dispose() {
    for (const c of this.chunks.values()) {
      for (const mesh of c.meshes) { this.scene.remove(mesh); if (mesh.userData.inst) mesh.dispose(); else mesh.geometry.dispose(); }
      for (const v of c.members) { for (const o of v.sb.meshes) o.visible = true; v.sb = null; }
    }
    this.chunks.clear();
  }
}
