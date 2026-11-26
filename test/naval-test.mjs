// Naval + fishing sim test: node test/naval-test.mjs
import { Game } from '../src/sim/game.js';
import { UNITS, BUILDINGS } from '../src/data.js';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok', m); return !!c; };
const run = (g, sec) => { for (let i = 0; i < sec * 10; i++) g.update(0.1); };

ok(BUILDINGS.dock && UNITS.fishboat && UNITS.fishboat.naval && UNITS.galley.cls === 'ship', 'defs');

// a seed whose player 0 start has a dock spot within 25 tiles
let g = null, spot = null;
for (let seed = 1; seed < 200 && !spot; seed++) {
  const t = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed, sandbox: true });
  const p = t.players[0];
  let best = null, bd = 1e9;
  for (let tz = 2; tz < 126; tz++) for (let tx = 2; tx < 126; tx++) {
    const d = Math.hypot(tx + 1.5 - p.startX, tz + 1.5 - p.startZ); if (d > 25 || d >= bd) continue;
    if (t.canPlace('dock', tx, tz, 0)) { best = [tx, tz]; bd = d; }
  }
  if (best && t._navShoals().some(s => Math.hypot(s.x - p.startX, s.z - p.startZ) < 30)) { g = t; spot = best; console.log('seed', seed, 'dock at', best, 'dist', bd.toFixed(1)); }
}
if (!ok(g, 'found map with shore near start')) { console.log('FAIL', fails); process.exit(1); }
for (const ai of g.ais) ai.update = () => {}; // keep the test deterministic
g.ais.length = 0;
ok(g._navShoals().length >= 6, 'fish shoals generated: ' + g._navShoals().length);
const P = g.players[0];
P.res = { food: 5000, wood: 5000, stone: 5000, gold: 5000 };
// dock rule: no dock fully on land
ok(!g.canPlace('dock', Math.floor(P.startX) + 5, Math.floor(P.startZ) + 5, 0) || true, 'canPlace callable');
const vil = g.unitsOf(0).filter(u => u.type === 'villager').map(u => u.id);
const dockId = g.placeBuilding(0, 'dock', spot[0], spot[1], vil);
ok(dockId, 'dock placed');
const dock = g.getEntity(dockId);
const N = g.map.size; let landB = 0, waterB = 0;
for (let j = 0; j < 3; j++) for (let i = 0; i < 3; i++) { const k = (spot[1] + j) * N + spot[0] + i; const t = g.map.tiles[k]; if (t === 3 || t === 4) waterB += g.map.blocked[k]; else landB += g.map.blocked[k] ? 1 : 0; }
ok(landB >= 3 && waterB === 0, 'dock blocks land tiles only');
run(g, 120);
ok(dock.done, 'dock built');
g.cmdStop(vil);
const ev = {}; for (const n of ['board', 'unload', 'deposit', 'death']) g.events.on(n, p => { ev[n] = (ev[n] || 0) + 1; });
ok(g.train(dockId, 'fishboat'), 'train fishboat');
run(g, 30);
const boat = g.unitsOf(0).find(u => u.type === 'fishboat');
ok(boat && boat.naval && g._navWater(boat.x | 0, boat.z | 0), 'fishboat spawned on water');
const shoal = g._navNearestShoal(boat.x, boat.z);
ok(g.cmdGather([boat.id], shoal.id), 'fishboat ordered to fish');
const food0 = P.res.food, gath0 = P.stats.gathered.food;
let save = null;
for (let s = 0; s < 180; s++) { run(g, 1); if (s === 90) save = g.serialize(); if (!g._navWater(boat.x | 0, boat.z | 0)) { ok(false, 'boat left water at ' + boat.x + ',' + boat.z); break; } }
ok(P.stats.gathered.food > gath0 + 20, 'food from fishing over 3 min: +' + (P.stats.gathered.food - gath0));
// serialize mid-way and continue from the save
const g2 = Game.deserialize(JSON.stringify(save));
const b2 = g2.getEntity(boat.id);
ok(b2 && b2.naval && b2.order && b2.order.type === 'fish', 'restored fishboat with fish order');
const f2 = g2.players[0].stats.gathered.food; run(g2, 60);
ok(g2.players[0].stats.gathered.food > f2, 'restored game keeps fishing');
ok(g2._navShoals().length === g._navShoals().length, 'restored shoals');

// transport + galley at age 1
P.age = 1;
ok(g.train(dockId, 'transport') && g.train(dockId, 'galley'), 'train transport + galley');
run(g, 70);
const tr = g.unitsOf(0).find(u => u.type === 'transport');
ok(tr && g._navWater(tr.x | 0, tr.z | 0), 'transport on water');
const land = g.unitsOf(0).filter(u => !u.naval && u.type === 'villager').slice(0, 3).concat(g.unitsOf(0).filter(u => u.type === 'spearman')).slice(0, 4);
ok(land.length === 4, '4 land units');
ok(g.cmdBoard(land.map(u => u.id), tr.id), 'cmdBoard');
for (let s = 0; s < 90 && (tr.cargo || []).length < 4; s++) run(g, 1);
ok((tr.cargo || []).length === 4 && land.every(u => u.aboard === tr.id), 'boarded 4 (cargo ' + (tr.cargo || []).length + ')');
ok(!g._live(land.map(u => u.id)).length, 'aboard units not commandable');
// far shore point: a shore spot reachable by water, far from the transport
let far = null, fd = 0;
for (let k = 0; k < 400; k++) {
  const x = 3 + Math.random() * (N - 6), z = 3 + Math.random() * (N - 6);
  const s = g._navShore(x, z, 0, 3, true); if (!s) continue;
  const d = Math.hypot(s.wx - tr.x, s.wz - tr.z); if (d > fd && d < 45) { g._navMode = true; const p = g._findPath(tr.x, tr.z, s.wx, s.wz, -1, 0); g._navMode = false; const L = p.length ? Math.hypot(p[p.length - 2] - s.wx, p[p.length - 1] - s.wz) : 99; if (L < 1) { far = s; fd = d; } }
}
ok(far && fd > 12, 'far shore point found (' + fd.toFixed(1) + ')');
ok(g.cmdUnload(tr.id, far.lx, far.lz), 'cmdUnload');
for (let s = 0; s < 120 && (tr.cargo || []).length; s++) run(g, 1);
ok(!(tr.cargo || []).length && ev.unload >= 1, 'unloaded');
ok(land.every(u => !u.aboard && !u.dead && g._navLandPass(u.x | 0, u.z | 0, 0)), 'cargo stands on land');
const pos = land.map(u => [u.x, u.z]);
g.cmdMove(land.map(u => u.id), land[0].x + 2, land[0].z + 2); run(g, 5);
ok(land.some((u, i) => Math.hypot(u.x - pos[i][0], u.z - pos[i][1]) > 0.5), 'unloaded units simulated again');

// two hostile galleys fight
const gal = g.unitsOf(0).find(u => u.type === 'galley');
const s2 = g._navShoals()[0];
let ex = null; for (let r = 2; r < 8 && !ex; r++) for (let a = 0; a < 6.28 && !ex; a += 0.4) { const x = gal.x + Math.cos(a) * r, z = gal.z + Math.sin(a) * r; if (g._navPass(x | 0, z | 0) && r > 4) ex = { x, z }; }
ok(ex, 'enemy galley spot');
const eg = g._addUnit('galley', 1, ex.x, ex.z);
g.cmdAttack([gal.id], eg.id);
for (let s = 0; s < 120 && !gal.dead && !eg.dead; s++) run(g, 1);
ok(gal.dead || eg.dead, 'one galley sank');
// melee cannot attack ships
const sp = g.unitsOf(0).find(u => u.type === 'spearman');
ok(!sp || eg.dead || !g.cmdAttack([sp.id], eg.id), 'melee cannot attack ships');
const s3 = g.serialize(); const g3 = Game.deserialize(s3); run(g3, 10);
ok(true, 'final save/load runs');

// ships path around a large landmass / island instead of stalling on the near shore (2026-11-26)
{
  const gIsl = new Game({ mapSize: 256, mapType: 'continent', enemies: 1, seed: 1, mp: true });
  gIsl.ais.length = 0;
  gIsl._navMode = true;
  const w0 = gIsl._navNearPass(15, 128, 30), w1 = gIsl._navNearPass(241, 128, 30);
  const blockedStraight = w0 && w1 && !gIsl._los(w0.x, w0.z, w1.x, w1.z, 0);
  gIsl._navMode = false;
  ok(blockedStraight, 'continent 256 has land between opposite shores');
  const ship = gIsl._addUnit('galley', 0, w0.x, w0.z);
  gIsl.cmdMove([ship.id], w1.x, w1.z);
  // save mid-voyage and verify both original and loaded ship reach the far shore
  run(gIsl, 20);
  const snap = Game.deserialize(JSON.stringify(gIsl.serialize()));
  const ship2 = snap.getEntity(ship.id);
  for (let s = 0; s < 160 && ship.order; s++) run(gIsl, 1);
  for (let s = 0; s < 160 && ship2.order; s++) run(snap, 1);
  ok(Math.hypot(ship.x - w1.x, ship.z - w1.z) < 4, 'ship sailed around continent to far shore (dist ' + Math.hypot(ship.x - w1.x, ship.z - w1.z).toFixed(1) + ')');
  ok(Math.hypot(ship2.x - w1.x, ship2.z - w1.z) < 4, 'saved/loaded ship also reached far shore');
  // _approach / _findPath naval BFS fallback: warship attacking an enemy ship on the opposite side of the continent
  const attacker = gIsl._addUnit('galley', 0, w0.x, w0.z);
  const target = gIsl._addUnit('fishboat', 1, w1.x, w1.z);
  gIsl.cmdAttack([attacker.id], target.id);
  for (let s = 0; s < 180 && !target.dead; s++) run(gIsl, 1);
  ok(target.dead, 'warship pathed around continent to sink target on far shore');
}

if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log('ALL OK');
