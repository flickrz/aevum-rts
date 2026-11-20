// Gather work spots: villagers on a stone / gold deposit, a forest or a berry patch spread over the tiles
// instead of stacking on one point. node test/gather-spots-test.mjs
import { Game } from '../src/sim/game.js';

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.log('  FAIL', m); } else console.log('  ok ', m); return !!c; };
const step = (g, sec) => { for (let i = 0, n = Math.round(sec * 30); i < n; i++) g.update(1 / 30); };

// a resource tile of `type` whose same-type cluster (8-connected) has at least `min` tiles, closest to player 0
export function findCluster(g, type, min) {
  const N = g.map.size, p = g.players[0], seen = new Set(), out = [];
  for (const e of g.entities.values()) {
    if (e.kind !== 'resource' || e.type !== type || e.dead || seen.has(e.id)) continue;
    const cl = [], st = [e]; seen.add(e.id);
    while (st.length) { const r = st.pop(); cl.push(r); for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = (r.x | 0) + dx, z = (r.z | 0) + dz; if (x < 0 || z < 0 || x >= N || z >= N) continue; const id = g.resAt[z * N + x]; if (!id || seen.has(id)) continue; const q = g.entities.get(id); if (q && q.type === type) { seen.add(id); st.push(q); } } }
    // enough open ground around it: distinct walkable tiles touching the cluster
    const room = new Set(); for (const r of cl) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = (r.x | 0) + dx, z = (r.z | 0) + dz; if (g._pass(x, z, 0)) room.add(z * N + x); }
    if (cl.length >= min && room.size >= 12) out.push({ cl, d: Math.hypot(e.x - p.startX, e.z - p.startZ) });
  }
  out.sort((a, b) => a.d - b.d || a.cl[0].id - b.cl[0].id);
  return out.length ? out[0].cl.sort((a, b) => a.id - b.id) : null;
}
// a free 2x2 drop-off spot next to the cluster
function campSpot(g, type, cl) {
  const cx = cl.reduce((s, e) => s + e.x, 0) / cl.length, cz = cl.reduce((s, e) => s + e.z, 0) / cl.length;
  for (let r = 3; r < 12; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const tx = Math.floor(cx) + dx, tz = Math.floor(cz) + dz; if (g.canPlace(type, tx, tz, 0) && cl.every(e => Math.max(Math.max(tx - (e.x | 0), (e.x | 0) - tx - 1, 0), Math.max(tz - (e.z | 0), (e.z | 0) - tz - 1, 0)) >= 3)) return [tx, tz]; }
  return null;
}
// n villagers sent to one tile of a `type` cluster next to a finished drop-off; returns the game and the villagers
export function scenario(GameC, { type, n, seed = 11, mapSize = 128, camp }) {
  const g = new GameC({ mapSize, enemies: 1, difficulty: 'easy', seed });
  g.ais.length = 0; // player 0 only
  const cl = findCluster(g, type, type === 'tree' ? 12 : 3); if (!cl) return null;
  const s = campSpot(g, camp, cl); if (!s) return null;
  g._complete(g._addBuilding(camp, 0, s[0], s[1], true));
  const t = cl[0], vs = [];
  for (let i = 0; i < n; i++) { const f = g._freeNear(s[0] + 1 + (i % 4) * 0.4, s[1] + 2.6 + (i >> 2) * 0.4, 0); vs.push(g._addUnit('villager', 0, f.x, f.z)); }
  g.cmdGather(vs.map(v => v.id), t.id);
  return { g, vs, t, cl };
}
export const RES_OF_T = { stone: 'stone', gold: 'gold', tree: 'wood', berries: 'food' };
const minPair = vs => { let m = 1e9; for (let i = 0; i < vs.length; i++) for (let j = i + 1; j < vs.length; j++) m = Math.min(m, Math.hypot(vs[i].x - vs[j].x, vs[i].z - vs[j].z)); return m; };
// minimum pairwise distance among the villagers that are standing at the resource and working
const workers = vs => vs.filter(v => v.state === 'gather' && v.order && v.order.type === 'gather');

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  // ---- spreading
  for (const [type, camp, ns] of [['stone', 'minecamp', [6, 10]], ['gold', 'minecamp', [6, 10]], ['tree', 'lumbercamp', [6, 10]], ['berries', 'mill', [6]]]) {
    for (const n of ns) {
      // (seed 43 since 2026-11-20: 10 workers on one deposit need a second one within reach - MINE_CAP 8 - and the
      // map seed 42 makes with the 9x9 town center has none by its start stone)
      const sc = scenario(Game, { type, n, camp, seed: 43 }); if (!ok(sc, `${type} x${n}: scenario set up`)) continue;
      const { g, vs } = sc; let mp = 1e9, lost = 0; const worked = new Set();
      step(g, 20);
      // sample over 40 s: whoever is working at that moment stands apart from every other worker
      for (let k = 0; k < 40; k++) {
        step(g, 1); const w = workers(vs); if (w.length >= 2) mp = Math.min(mp, minPair(w));
        for (const v of vs) { const o = v.order; if (!o || !(o.type === 'gather' || (o.type === 'return' && o.resume)) || v.dead) lost++; if (v.state === 'gather') worked.add(v.id); }
      }
      ok(mp > 0.45, `${type} x${n}: workers spread (min pairwise distance ${mp.toFixed(2)})`);
      ok(!lost && worked.size === n, `${type} x${n}: all villagers keep gathering (${worked.size}/${n} seen working, ${lost} order losses)`);
    }
  }
  // ---- a deposit wedged into a forest (fewer reachable spots than villagers): the overflow shares spots but nobody freezes
  {
    const { g, vs } = scenario(Game, { type: 'gold', n: 10, camp: 'minecamp', seed: 11 }); step(g, 20); const worked = new Set(); let lost = 0;
    for (let k = 0; k < 60; k++) { step(g, 1); for (const v of vs) { const o = v.order; if (!o || !(o.type === 'gather' || (o.type === 'return' && o.resume))) lost++; if (v.state === 'gather') worked.add(v.id); } }
    ok(!lost && worked.size === 10, `crowded gold x10: everyone keeps working (${worked.size}/10, ${vs.filter(v => v.order && v.order.so).length} sharing a spot)`);
  }
  // ---- same seed, same result; save/load mid-gather continues bit-identically
  for (const type of ['stone', 'tree']) {
    const camp = type === 'tree' ? 'lumbercamp' : 'minecamp';
    const a = scenario(Game, { type, n: 10, camp }), b = scenario(Game, { type, n: 10, camp });
    step(a.g, 25); step(b.g, 25);
    ok(a.g.hash() === b.g.hash(), `${type}: two runs with the same seed give the same hash`);
    const c = Game.deserialize(JSON.stringify(a.g.serialize())); c.ais.length = 0;
    ok(c.units.some(u => u.order && u.order.sp), `${type}: stand spots survive save/load`);
    step(a.g, 40); step(c, 40);
    ok(a.g.hash() === c.hash(), `${type}: save/load mid-gather gives the same hash as an uninterrupted run`);
  }
  // ---- rates: 3 villagers on one tile for 240 s (the AI puts at most 2-4 on a tile), gathered + carried.
  // The spot system was first checked against the pre-spot code (stone 947, gold 969, tree 927, berries 1072 summed over
  // 4 seeds on 128 maps; all within 5%). Map generation keeps moving trees, which moves where this test can put its camp,
  // so the baselines below are re-measured on the current smallest map (2026-11-14, code before the forest balance):
  // median per scenario over 12 seeds, and for trees only scenarios with the camp right next to the trees (3.5..6.5 tiles),
  // because a camp wedged far outside a dense forest measures the walk, not the gathering.
  const SEEDS = [11, 42, 7, 5, 99, 123, 3, 17, 31, 64, 8, 21];
  const MED = { stone: 243, gold: 243, berries: 270 };
  for (const [type, camp] of [['stone', 'minecamp'], ['gold', 'minecamp'], ['berries', 'mill']]) {
    const v = [];
    for (const seed of SEEDS) { const sc = scenario(Game, { type, n: 3, seed, camp, mapSize: 256 }); if (!sc) continue; step(sc.g, 240); v.push(sc.g.players[0].stats.gathered[RES_OF_T[type]] + sc.vs.reduce((a, u) => a + (u.carry ? u.carry.amount : 0), 0)); }
    v.sort((a, b) => a - b); const med = v[v.length >> 1], dev = (med - MED[type]) / MED[type];
    ok(v.length >= 8 && Math.abs(dev) < 0.05, `${type}: gather rate unchanged (median ${med} over ${v.length} vs ${MED[type]}, ${(dev * 100).toFixed(1)}%)`);
  }
  {
    const TREE_BASE = 274.2; let got = 0, n = 0;
    for (const seed of [...SEEDS, 2, 13, 55, 77, 88, 101, 202, 404]) {
      const sc = scenario(Game, { type: 'tree', n: 3, seed, camp: 'lumbercamp', mapSize: 256 }); if (!sc) continue;
      const cb = sc.g.buildings.find(b => b.type === 'lumbercamp'), d = Math.hypot(cb.x - sc.t.x, cb.z - sc.t.z); if (d < 3.5 || d > 6.5) continue;
      step(sc.g, 240); got += sc.g.players[0].stats.gathered.wood + sc.vs.reduce((a, u) => a + (u.carry ? u.carry.amount : 0), 0); n++;
    }
    const per = got / Math.max(1, n), dev = (per - TREE_BASE) / TREE_BASE;
    ok(n >= 4 && Math.abs(dev) < 0.05, `tree: gather rate unchanged (${per.toFixed(1)} per scenario over ${n} vs ${TREE_BASE}, ${(dev * 100).toFixed(1)}%)`);
  }
  if (fails.length) { console.log('FAILED', fails.length); process.exit(1); }
  console.log('ALL OK');
}
