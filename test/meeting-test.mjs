// Owner meeting 2026-11-14 (sim side): passable foundations, age-up first in the queue, the mill's techs on the farm,
// pasture income without herders, farms from the Bronze Age, 5 start villagers, combat sight, no sight from foundations.
// node test/meeting-test.mjs
import { Game, BUILD_TIME_MUL, QUEUE_TIME_MUL, START_VILLAGERS, MAX_WEAPON_RANGE, COMBAT_LOS, unitLos, PASTURE_IDLE_RATE } from '../src/sim/game.js';
import { BUILDINGS, UNITS, AGES } from '../src/data.js';

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.log('  FAIL', m); } else console.log('  ok  ', m); return !!c; };
const step = (g, sec) => { for (let i = 0, n = Math.round(sec * 30); i < n; i++) g.update(1 / 30); };
const mk = (o = {}) => { const g = new Game(Object.assign({ mapSize: 256, enemies: 1, difficulty: 'easy', seed: 11, mapType: 'plains' }, o)); g.ais.length = 0; g.quests = { list: [], update() {}, serialize() { return null; }, load() {} }; return g; };
// a free spot for a building of `type` near player 0's town center
const spot = (g, type, r0 = 8) => { const p = g.players[0]; for (let r = r0; r < 60; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const tx = (p.startX | 0) + dx, tz = (p.startZ | 0) + dz; if (g.canPlace(type, tx, tz, 0)) return [tx, tz]; } return null; };
const inside = (u, b) => (u.x | 0) >= b.tx && (u.x | 0) < b.tx + b.size && (u.z | 0) >= b.tz && (u.z | 0) < b.tz + b.size;

console.log('-- 3: foundations are passable until finished');
{
  // (24 out: the walker keeps out of reach of the 9x9 town center's arrows and the starting spearman beside it)
  const g = mk(), N = g.map.size, [tx, tz] = spot(g, 'barracks', 24);
  const v0 = g._blkV;
  const b = g._addBuilding('barracks', 0, tx, tz, false), s = b.size;
  let all2 = true; for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (g.map.blocked[(tz + j) * N + tx + i] !== 2) all2 = false;
  ok(all2, 'an unfinished foundation marks its tiles 2 (taken, passable)');
  ok(g._blkV === v0, 'placing it on free ground does not make flow fields stale');
  ok(g._pass(tx + 1, tz + 1, 0) && g._pass(tx + 1, tz + 1, 1) && g.map.isWalkable(tx + 1, tz + 1), 'own and enemy units may walk on it');
  // no overlap: another building / a farm / a wall on any of its tiles is refused
  ok(!g.canPlace('barracks', tx + 2, tz + 2, 0) && !g.canPlace('wall', tx + s - 1, tz, 0) && !g.canPlace('pasture', tx - 2, tz - 2, 1) && !g.canPlace('house', tx + s - 1, tz + s - 1, 1), 'nothing may be placed overlapping a foundation (any owner)');
  // an enemy walks straight across the foundation (a villager: a soldier would turn to fight the town)
  const u = g._addUnit('villager', 1, tx - 4 + 0.5, tz + s / 2), goal = { x: tx + s + 4 + 0.5, z: tz + s / 2 };
  g.cmdMove([u.id], goal.x, goal.z); let crossed = false, best = 1e9, t = 0;
  for (let i = 0; i < 30 * 10 && best > 0.1; i++) { g.update(1 / 30); if (inside(u, b)) crossed = true; best = Math.min(best, Math.hypot(u.x - goal.x, u.z - goal.z)); t = i / 30; }
  // (6.5 s for the 14 tiles round a 5x5 foundation: the same pace for a bigger one)
  ok(crossed && best < 0.1 && t < 6.5 * (9 + s) / 14, `an enemy unit walks straight across the foundation (${t.toFixed(1)} s for ${(9 + s)} tiles)`);
  // finished: solid, the units standing on it step out, flow fields go stale
  const w = g._addUnit('spearman', 0, tx + s / 2, tz + s / 2), e = g._addUnit('archer', 1, tx + 0.6, tz + 0.6);
  const v1 = g._blkV; g._complete(b);
  let all1 = true; for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (g.map.blocked[(tz + j) * N + tx + i] !== 1) all1 = false;
  ok(all1 && g._blkV > v1, 'on completion the footprint blocks (1) and the blocking version moves on');
  ok(!inside(w, b) && !inside(e, b) && g._pass(w.x | 0, w.z | 0, 0) && g._pass(e.x | 0, e.z | 0, 1), `units inside a finished ${s}x${s} building are pushed out (to ${w.x.toFixed(1)},${w.z.toFixed(1)} and ${e.x.toFixed(1)},${e.z.toFixed(1)})`);
}
{ // villagers really build it: they reach the footprint, finish it and nobody is left inside
  const g = mk(), p = g.players[0], [tx, tz] = spot(g, 'barracks', 10);
  p.res.wood = 1000;
  const vs = g.units.filter(u => u.owner === 0 && u.type === 'villager');
  const id = g.placeBuilding(0, 'barracks', tx, tz, vs.map(v => v.id)), b = g.getEntity(id);
  // two of them stand on the foundation when it is placed (no push-out at placement any more)
  vs[0].x = tx + 1.5; vs[0].z = tz + 1.5; vs[1].x = tx + 3.5; vs[1].z = tz + 2.5;
  let t = 0; while (!b.done && t < 300) { step(g, 1); t++; }
  ok(b.done, `${vs.length} villagers build the barracks (${t} s)`);
  ok(vs.every(v => !inside(v, b)), 'no villager stays inside the finished building');
}
{ // walls: a wall foundation line lets its own side through (not enemies) until a piece is finished; the AI's flood counts it as a wall
  const g = mk(), N = g.map.size, p = g.players[0]; p.res.stone = 1000; p.age = 1;
  let z = (p.startZ | 0) + 14; const row = z => { const t = []; for (let x = (p.startX | 0) - 4; x <= (p.startX | 0) + 4; x++) t.push([x, z]); return t; };
  while (!row(z).every(([x, zz]) => g.canPlace('wall', x, zz, 0))) z++;
  const tiles = row(z);
  const ids = g.placeLine(0, 'wall', tiles, []);
  // (a template nobody has started is walked over; it turns solid when the first builder starts on it, 2026-11-15)
  ok(ids.length === tiles.length && ids.every(id => g.map.blocked[z * N + g.getEntity(id).tx] === 2), 'wall templates are passable (2) until work starts');
  const w = g.getEntity(ids[4]), u = g._addUnit('spearman', 1, w.tx + 0.5, w.tz + 0.5);
  g._complete(w);
  ok(g.map.blocked[z * N + w.tx] === 1 && !(u.x | 0 === w.tx && (u.z | 0) === w.tz) && g._pass(u.x | 0, u.z | 0, 1), 'a finished wall piece blocks and pushes the unit on it out');
}
{ // a save with an old solid foundation loads it passable; save/load keeps the passable foundation
  const g = mk(), N = g.map.size, [tx, tz] = spot(g, 'house', 10), b = g._addBuilding('house', 0, tx, tz, false);
  const s = g.serialize(); const k = (tz + 1) * N + tx + 1;
  const g2 = Game.deserialize(JSON.parse(JSON.stringify(s))); g2.ais.length = 0;
  ok(g2.map.blocked[k] === 2 && g2.hash() === g.hash(), 'save/load keeps the foundation passable, same hash');
  // simulate a save made before the change: the foundation's tiles were 1
  const old = JSON.parse(JSON.stringify(s)); const bl = g.map.blocked.slice(); for (let j = 0; j < b.size; j++) for (let i = 0; i < b.size; i++) bl[(tz + j) * N + tx + i] = 1;
  const rle = []; for (let i = 0; i < bl.length;) { let n = 1; while (i + n < bl.length && bl[i + n] === bl[i]) n++; rle.push(bl[i], n); i += n; }
  old.map.blockedR = rle;
  const g3 = Game.deserialize(old);
  ok(g3.map.blocked[k] === 2, 'an old save: the solid foundation becomes passable on load');
}

console.log('-- 4: unfinished buildings give no sight');
{
  const g = mk(), N = g.map.size, team = g.players[0].team;
  const tx = N - 40, tz = 30;   // far from player 0, unexplored
  g._updateFog();
  const grid = g._tv.get(team), k = (tz + 1) * N + tx + 1;
  ok(grid[k] === 0, 'the spot is unexplored');
  const b = g._addBuilding('barracks', 0, tx, tz, false); g._updateFog();
  ok(g._tv.get(team)[k] === 0, 'a foundation placed in the dark reveals nothing');
  g._complete(b); g._updateFog();
  ok(g._tv.get(team)[k] === 2, 'the finished building sees');
}

console.log('-- 5: the age-up goes to the front of the town center queue');
{
  const g = mk(), p = g.players[0], tc = g.buildings.find(b => b.owner === 0 && b.type === 'towncenter');
  p.res.food = 2000; p.res.wood = 2000;
  // the age-up needs 3 building types incl. a barracks, and the minimum stay in the age to be over
  p.ageAt = -1e4;
  for (const t of ['barracks', 'storage', 'pasture']) { const s = spot(g, t, 10); g._complete(g._addBuilding(t, 0, s[0], s[1], false)); }
  ok(g.train(tc.id, 'villager') && g.train(tc.id, 'villager'), 'two villagers queued');
  step(g, 5);
  const t0 = tc.queue[0].t;
  ok(t0 > 0 && g.ageUp(tc.id), 'age-up clicked while the first villager is in training');
  ok(tc.queue[0].kind === 'age' && tc.queue[1].kind === 'unit' && Math.abs(tc.queue[1].t - t0) < 1e-9 && tc.queue.length === 3, 'the age-up is first, the villager keeps its progress');
  const vil0 = g.units.filter(u => u.owner === 0 && u.type === 'villager').length;
  step(g, 2);
  ok(Math.abs(tc.queue[1].t - t0) < 1e-9, 'the villager waits while the age-up runs');
  let s = 0; while (p.age === 0 && s < 200) { step(g, 1); s++; }
  ok(p.age === 1 && Math.abs(s - AGES[1].time * QUEUE_TIME_MUL) < 3, `age 1 reached after ${s} s`);
  step(g, Math.ceil(UNITS.villager.time * QUEUE_TIME_MUL - t0) + 1);
  ok(g.units.filter(u => u.owner === 0 && u.type === 'villager').length === vil0 + 1, 'then the villager finishes from where it was');
}

console.log('-- 6 / 10: farms from the Bronze Age, the mill techs on the farm, no mill');
{
  const g = mk(), p = g.players[0]; p.res.wood = 5000; p.res.food = 5000; p.res.gold = 5000; p.res.stone = 5000;
  ok(BUILDINGS.farm.age === 1 && !g.isUnlocked(0, 'building', 'farm'), 'farm is locked in the first age');
  const fs = spot(g, 'farm', 12);
  ok(g.placeBuilding(0, 'farm', fs[0], fs[1], []) == null, 'a farm cannot be placed in age 0');
  ok(g.isUnlocked(0, 'building', 'pasture') && g.isUnlocked(0, 'building', 'lumbercamp'), 'pasture and camps stay in age 0');
  const ms = spot(g, 'mill', 8);
  ok(!g.isUnlocked(0, 'building', 'mill') && g.placeBuilding(0, 'mill', ms[0], ms[1], []) == null, 'the mill cannot be built any more');
  p.age = 1;
  const fid = g.placeBuilding(0, 'farm', fs[0], fs[1], []), farm = g.getEntity(fid);
  ok(!!farm, 'a farm can be placed in age 1');
  ok(!g.research(fid, 'plow'), 'an unfinished farm offers no research');
  g._complete(farm);
  // (2026-11-20) the pasture has its own line (Seçici Islah, Yonca Otlağı, Kış Ağılı, Yem Ambarı, Mandıra); the farm keeps the tillage techs
  ok(['plow', 'crop', 'irrigation'].every(t => BUILDINGS.farm.researches.includes(t)) && !BUILDINGS.farm.researches.includes('breeding') && BUILDINGS.pasture.researches.includes('breeding') && !BUILDINGS.mill.researches.length, 'plow / crop / irrigation moved to the farm, breeding at the pasture');
  ok(g.research(fid, 'plow') && farm.queue.length === 1, 'a finished farm researches Saban');
  step(g, 25 * QUEUE_TIME_MUL + 1);
  ok(p.techs.has('plow') && p.mods.farm === 0.5, 'Saban done at the farm (+50 %)');
  // farm yield no longer depends on a mill: an old save's mill flag is ignored
  farm.mill = true;
  const f0 = p.stats.gathered.food, vs = g.units.filter(u => u.owner === 0 && u.type === 'villager').slice(0, 3);
  g.cmdGather(vs.map(v => v.id), fid); step(g, 90);
  const withFlag = p.stats.gathered.food - f0;
  const g2 = mk(); const p2 = g2.players[0]; p2.res.wood = 5000; p2.res.food = 5000; p2.res.gold = 5000; p2.age = 1;
  const fid2 = g2.placeBuilding(0, 'farm', fs[0], fs[1], []); const farm2 = g2.getEntity(fid2); g2._complete(farm2); g2.research(fid2, 'plow'); step(g2, 25 * QUEUE_TIME_MUL + 1);
  const f2 = p2.stats.gathered.food, vs2 = g2.units.filter(u => u.owner === 0 && u.type === 'villager').slice(0, 3);
  g2.cmdGather(vs2.map(v => v.id), fid2); step(g2, 90);
  ok(Math.abs(withFlag - (p2.stats.gathered.food - f2)) <= 2, `no mill bonus (${withFlag} food with an old mill flag vs ${p2.stats.gathered.food - f2} without)`);
  // berries still go to the town center
  const bush = [...g.entities.values()].filter(e => e.kind === 'resource' && e.type === 'berries').sort((a, b) => Math.hypot(a.x - p.startX, a.z - p.startZ) - Math.hypot(b.x - p.startX, b.z - p.startZ))[0];
  const v = g.units.filter(u => u.owner === 0 && u.type === 'villager')[4], fb = p.stats.gathered.food;
  g.cmdGather([v.id], bush.id); step(g, 60);
  ok(p.stats.gathered.food > fb && v.order && (v.order.type === 'gather' || v.order.type === 'return'), 'berries are dropped at the town center without a mill');
}

console.log('-- 8: a pasture gives a little food with nobody working there');
{
  const g = mk(), p = g.players[0]; p.res.wood = 1000;
  const [tx, tz] = spot(g, 'pasture', 10), b = g._addBuilding('pasture', 0, tx, tz, false); g._complete(b);
  const f0 = p.stats.gathered.food; step(g, 120);
  const got = p.stats.gathered.food - f0;
  ok(got >= 3 * PASTURE_IDLE_RATE * 120 * 0.9 && b.pasture.sheep > 3, `120 s without herders: ${got} food, ${b.pasture.sheep} sheep`);
  step(g, 400);
  ok(b.pasture.sheep === 8, 'the sheep multiply up to 8');
  const f1 = p.stats.gathered.food; step(g, 100); const rate = (p.stats.gathered.food - f1) / 100;
  ok(rate > 0.26 && rate < 0.4, `8 sheep: ${rate.toFixed(2)} food/s (a fully worked big farm makes ~3.1)`);
  // herders still gather on top of it
  const vs = g.units.filter(u => u.owner === 0 && u.type === 'villager').slice(0, 2), f2 = p.stats.gathered.food;
  g.cmdGather(vs.map(v => v.id), b.id); step(g, 100);
  ok((p.stats.gathered.food - f2) / 100 > rate + 0.8, `2 herders add to it (${((p.stats.gathered.food - f2) / 100).toFixed(2)} food/s)`);
  // deterministic and saved
  const c = Game.deserialize(JSON.stringify(g.serialize())); c.ais.length = 0; c.quests = g.quests;
  step(g, 30); step(c, 30);
  ok(c.hash() === g.hash() && c.getEntity(b.id).pasture.acc === b.pasture.acc, 'save/load mid-way continues with the same hash');
}

console.log('-- 12 / 17 / 18: production speed, start villagers, sight');
{
  ok(Math.abs(BUILD_TIME_MUL - 1.6 / 1.2) < 1e-12 && Math.abs(QUEUE_TIME_MUL - 1.5 / 1.2) < 1e-12, 'production 20 % faster (build x1.333, queues x1.25)');
  const g = mk(), cnt = (g, p) => g.units.filter(u => u.owner === p && u.type === 'villager').length;
  ok(START_VILLAGERS === 20 && cnt(g, 0) === 20 && cnt(g, 1) === 20, 'single player: 20 villagers each');
  const m = new Game({ mapSize: 256, seed: 3, mp: true, me: 0, players: [{ kind: 'human', team: 1 }, { kind: 'human', team: 2 }, { kind: 'ai', team: 2, difficulty: 'hard' }] });
  ok([0, 1, 2].every(p => cnt(m, p) === START_VILLAGERS), 'multiplayer: ' + START_VILLAGERS + ' villagers each (humans and AI)');
  let mr = 0; for (const u of Object.values(UNITS)) if (u.atk > 0) mr = Math.max(mr, u.range);
  ok(MAX_WEAPON_RANGE >= mr && COMBAT_LOS >= MAX_WEAPON_RANGE * 1.2, `combat sight ${COMBAT_LOS} >= 1.2 x the longest weapon range ${MAX_WEAPON_RANGE}`);
  ok(['spearman', 'archer', 'knight', 'ram', 'galley', 'artillery'].every(t => unitLos(t) >= COMBAT_LOS) && unitLos('villager') === UNITS.villager.los && unitLos('tradecart') === UNITS.tradecart.los, 'soldiers and warships see that far, villagers and carts keep their sight');
  // an enemy artillery piece at its full range from a spearman is in the spearman's team's sight
  const team = g.players[0].team, p = g.players[0];
  const sp = g._addUnit('spearman', 0, p.startX + 30, p.startZ), N = g.map.size;
  g._updateFog();
  const at = (x, z) => g._tv.get(team)[(z | 0) * N + (x | 0)];
  ok(at(sp.x + 12, sp.z) === 2 && at(sp.x, sp.z + 13.5) === 2, 'a soldier sees 12-13.5 tiles away (artillery range with its tech)');
  const tw = g._addBuilding('tower', 0, (p.startX | 0) - 30, p.startZ | 0, true); g._updateFog();
  ok(at(tw.x - 1.5 - 13, tw.z) === 2, 'a tower sees past the longest range from its edge');
}

console.log('-- 14 / 15: woods in groves, compact mines');
{
  let maxComp = 0, lone = 0, small = 0, maps = 0, minGroves = 1e9, isoMine = 0, mineTiles = 0, woodFar = 0;
  for (const mapType of ['river', 'highlands', 'plains', 'islands']) for (const seed of [1, 42]) {
    const g = new Game({ mapSize: 320, seed, mapType, mp: true, me: 0, players: Array.from({ length: 4 }, (_, i) => ({ kind: 'ai', team: i + 1 }) ) }), N = g.map.size; maps++;
    const T = new Uint8Array(N * N), M = new Map();
    for (const e of g.entities.values()) if (e.kind === 'resource') { const k = (e.z | 0) * N + (e.x | 0); if (e.type === 'tree') T[k] = 1; else if (e.type === 'stone' || e.type === 'gold') M.set(k, e.type); }
    const seen = new Uint8Array(N * N); let groves = 0;
    for (let k0 = 0; k0 < N * N; k0++) {
      if (!T[k0] || seen[k0]) continue; const q = [k0]; seen[k0] = 1;
      for (let h = 0; h < q.length; h++) { const c = q[h], x = c % N, z = (c / N) | 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const j = (z + dz) * N + x + dx; if ((dx || dz) && T[j] && !seen[j]) { seen[j] = 1; q.push(j); } } }
      maxComp = Math.max(maxComp, q.length); if (q.length === 1) lone++; else if (q.length < 8) small++; else groves++;
    }
    minGroves = Math.min(minGroves, groves);
    for (const p of g.players) { let n = 0; for (let k = 0; k < N * N; k++) if (T[k] && Math.hypot(k % N + 0.5 - p.startX, ((k / N) | 0) + 0.5 - p.startZ) < 40) n++; if (n < 60) woodFar++; }
    for (const [k, t] of M) { mineTiles++; const x = k % N, z = (k / N) | 0; if (![[1, 0], [-1, 0], [0, 1], [0, -1]].some(([dx, dz]) => M.get((z + dz) * N + x + dx) === t)) isoMine++; }
  }
  ok(maxComp <= 400, `no forest mass: the largest grove has ${maxComp} trees (8 maps, 320, 4 players)`);
  ok(minGroves >= 30, `the wood is spread in many groves (at least ${minGroves} per map)`);
  ok(!lone, `no lone trees on open grass (${lone}; ${small} tree bits under 8)`);
  ok(!woodFar, 'every start has 60+ trees within 40 tiles');
  ok(isoMine / mineTiles < 0.05, `stone / gold tiles touch their deposit (${isoMine} of ${mineTiles} alone)`);
}

console.log('-- 1 / 2 / 10: the AI (pastures before farms, few camps, no rebuild on a fresh ruin)');
{
  const g = new Game({ mapSize: 256, seed: 4, mapType: 'plains', mp: true, me: 0, players: [{ kind: 'ai', team: 1, difficulty: 'normal' }, { kind: 'ai', team: 2, difficulty: 'normal' }] });
  const placed = []; g.events.on('buildStart', (p) => placed.push({ t: g.time, b: p.e }));
  let farmsAge0 = 0; g.events.on('buildStart', (p) => { if (p.e.type === 'farm' && g.players[p.e.owner].age < 1) farmsAge0++; });
  let maxL = 0, maxM = 0;
  for (let i = 0; i < 30 * 60 * 10; i++) { g.update(1 / 30); if (i % 300 === 0) for (const pl of g.players) { const bl = g.buildingsOf(pl.id); maxL = Math.max(maxL, bl.filter(b => b.type === 'lumbercamp').length); maxM = Math.max(maxM, bl.filter(b => b.type === 'minecamp').length); } }
  const ps = g.players;
  ok(ps.every(p => p.age >= 1) && !farmsAge0, `both AIs reach the Bronze Age by minute 10 (ages ${ps.map(p => p.age)}) with no farm before it`);
  ok(ps.every(p => g.buildingsOf(p.id).some(b => b.type === 'pasture')) && !g.buildings.some(b => b.type === 'mill'), 'they build pastures and no mill');
  ok(maxL <= 3 && maxM <= 3, `camps capped (max lumber ${maxL}, mine ${maxM})`);
}
{ // a building the enemy razed: the AI puts no foundation within 8 tiles of it for 75 s, nor while it sees enemy soldiers there
  const g = new Game({ mapSize: 256, seed: 4, mapType: 'plains', mp: true, me: 0, players: [{ kind: 'ai', team: 1, difficulty: 'normal' }, { kind: 'ai', team: 2, difficulty: 'normal' }] });
  step(g, 3);
  const ai = g.ais.find(x => x.pid === 1), p = g.players[1];
  const pick = () => { for (let r = 9; r < 20; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const tx = (p.startX | 0) + dx, tz = (p.startZ | 0) + dz; if (g.canPlace('house', tx, tz, 1) && ai.explored(tx + 1.5, tz + 1.5)) return [tx, tz]; } return null; };
  const [hx, hz] = pick(), h = g._addBuilding('house', 1, hx, hz, true);
  const dist = sp => sp ? Math.hypot(sp.tx + 1.5 - h.x, sp.tz + 1.5 - h.z) : 99;
  const foe = g._addUnit('spearman', 0, h.x + 2.6, h.z); foe.hp = foe.maxHp = 1e6;
  g._kill(h, foe);
  ok(ai.lost.length === 1 && dist(ai.findSpot('house', hx, hz, 0, 14)) >= 8, 'right after the loss: the nearest spot the AI finds is 8+ tiles from the ruin (' + dist(ai.findSpot('house', hx, hz, 0, 14)).toFixed(1) + ')');
  // 80 s later, the enemy soldier still standing there (and seen): still no
  foe.order = null; let t = 0; while (t < 80) { step(g, 1); t++; foe.x = h.x + 2.6; foe.z = h.z; foe.hp = foe.maxHp; }
  ai._vision(ai._ctx());
  ok(dist(ai.findSpot('house', hx, hz, 0, 14)) >= 8, '80 s later with an enemy soldier there: still kept free');
  g._kill(foe, null); foe.x = -50; step(g, 12); ai._vision(ai._ctx());
  ok(dist(ai.findSpot('house', hx, hz, 0, 14)) < 8 && !ai.lost.length, 'once the enemy is gone (and 75 s passed) the spot may be used again');
}

if (fails.length) { console.log('FAILED', fails.length); process.exit(1); }
console.log('ALL OK');
