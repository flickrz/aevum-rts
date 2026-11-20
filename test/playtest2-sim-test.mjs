// Owner playtest 2 (2026-11-14, sim side): node test/playtest2-sim-test.mjs
//  A) Shift-queued orders do not wait behind an open-ended gather (endless mines, farms, trees)
//  B) balance: cannons weaker against units and wrecked by cavalry, towers hit as hard as cannons
//  C) towers shoot over their own walls at enemies outside
//  D) an AI push hunts the last enemy remains: through a far wall ring to a deep town center, and scattered leftovers
import { Game, TOWER_AGE_ATK } from '../src/sim/game.js';
import { UNITS, BUILDINGS } from '../src/data.js';

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.log('  FAIL', m); } else console.log('  ok  ', m); return !!c; };
const step = (g, sec) => { for (let i = 0, n = Math.round(sec * 30); i < n; i++) g.update(1 / 30); };
const mk = (o = {}) => { const g = new Game(Object.assign({ mapSize: 256, enemies: 1, difficulty: 'easy', seed: 11, mapType: 'plains' }, o)); g.ais.length = 0; g.quests = { list: [], update() {}, serialize() { return null; }, load() {} }; return g; };
const nearest = (g, x, z, f) => { let best = null, bd = Infinity; for (const e of g.entities.values()) { if (e.dead || !f(e)) continue; const d = Math.hypot(e.x - x, e.z - z); if (d < bd) { bd = d; best = e; } } return best; };
const free = (g, type, x0, z0, r0 = 4) => { for (let r = r0; r < 60; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const tx = (x0 | 0) + dx, tz = (z0 | 0) + dz; if (g.canPlace(type, tx, tz, 0)) return [tx, tz]; } return null; };
const only = (A) => { if (process.argv[2] && !process.argv[2].includes(A)) return false; return true; };

if (only('A')) {
  console.log('-- A: Shift-queued orders and open-ended gathering');
  for (const res of ['gold', 'stone', 'tree']) {
    const g = mk(), p = g.players[0];
    const v = g.units.find(u => u.owner === 0 && u.type === 'villager');
    const mine = nearest(g, p.startX, p.startZ, e => e.kind === 'resource' && e.type === res);
    g.cmdGather([v.id], mine.id); step(g, 25);
    ok(v.order && (v.order.type === 'gather' || v.order.type === 'return'), `${res}: the villager works the ${res} (${v.order && v.order.type})`);
    // Shift: walk to a spot, then a second spot
    const a = { x: p.startX + 14.5, z: p.startZ - 14.5 }, b = { x: p.startX - 14.5, z: p.startZ - 14.5 };
    g.cmdMove([v.id], a.x, a.z, true); g.cmdMove([v.id], b.x, b.z, true);
    let atA = false, t = 0;
    for (; t < 60 * 30; t++) { g.update(1 / 30); if (Math.hypot(v.x - a.x, v.z - a.z) < 2) atA = true; if (atA && Math.hypot(v.x - b.x, v.z - b.z) < 2 && !v.order) break; }
    ok(atA && !v.order && Math.hypot(v.x - b.x, v.z - b.z) < 2, `${res}: Shift-queued moves run at once, in order (${(t / 30).toFixed(1)} s, gather dropped)`);
  }
  { // a villager on its way to drop off a load delivers it first, then does the queued order
    const g = mk(), p = g.players[0];
    const v = g.units.find(u => u.owner === 0 && u.type === 'villager');
    const mine = nearest(g, p.startX, p.startZ, e => e.kind === 'resource' && e.type === 'gold');
    g.cmdGather([v.id], mine.id);
    let t = 0; while (!(v.order && v.order.type === 'return') && t++ < 120 * 30) g.update(1 / 30);
    const gold0 = p.res.gold, a = { x: p.startX + 12.5, z: p.startZ + 16.5 };
    g.cmdMove([v.id], a.x, a.z, true);
    ok(v.order && v.order.type === 'return' && v.queue.length === 1, 'a villager carrying a load keeps walking to the drop-off with the move queued');
    step(g, 40);
    ok(p.res.gold > gold0 && Math.hypot(v.x - a.x, v.z - a.z) < 2 && !v.order, `it delivers (+${p.res.gold - gold0} gold) and then walks to the queued spot`);
  }
  { // queued finite orders keep normal queue semantics; a gather queued last stays open-ended and runs at the end
    const g = mk(), p = g.players[0]; p.res.wood = 1000;
    const v = g.units.find(u => u.owner === 0 && u.type === 'villager');
    const a = { x: p.startX + 10.5, z: p.startZ + 16.5 };
    g.cmdMove([v.id], a.x, a.z);
    const [hx, hz] = free(g, 'house', p.startX - 14, p.startZ + 10);
    const hid = g.placeBuilding(0, 'house', hx, hz, [v.id], true);
    const tree = nearest(g, p.startX, p.startZ, e => e.kind === 'resource' && e.type === 'tree');
    g.cmdGather([v.id], tree.id, true);
    ok(v.order.type === 'move' && v.queue.length === 2 && v.queue[0].type === 'build' && v.queue[1].type === 'gather', 'move, then Shift build, then Shift gather: queued in order');
    let atA = false, built = false, t = 0;
    for (; t < 150 * 30; t++) { g.update(1 / 30); if (Math.hypot(v.x - a.x, v.z - a.z) < 2) atA = true; if (g.getEntity(hid).done && !built) { built = true; ok(atA, 'it walked to the spot before building'); } if (built && v.order && (v.order.type === 'gather' || v.order.type === 'return') && v.carry) break; }
    ok(built && v.order && v.carry && v.carry.type === 'wood', `the house is built, then it cuts wood (${(t / 30).toFixed(0)} s)`);
    // a Shift order behind a gather that was itself queued: the gather is dropped
    g.cmdMove([v.id], a.x, a.z, true);
    ok(v.order.type === 'move' && !v.queue.length, 'Shift move onto the woodcutter: it leaves the trees now');
  }
  { // a pasture / farm builder normally stays on as herder / farmer; with orders queued after the build it goes on to them
    const g = mk(), p = g.players[0]; p.res.wood = 1000;
    const [v, w] = g.units.filter(u => u.owner === 0 && u.type === 'villager');
    const [px, pz] = free(g, 'pasture', p.startX + 12, p.startZ - 6);
    const pid = g.placeBuilding(0, 'pasture', px, pz, [v.id, w.id]);
    const a = { x: p.startX - 12.5, z: p.startZ + 14.5 };
    g.cmdMove([v.id], a.x, a.z, true);
    let t = 0; while (!(g.getEntity(pid).done && !v.order) && t++ < 120 * 30) g.update(1 / 30);
    ok(g.getEntity(pid).done && !v.order && Math.hypot(v.x - a.x, v.z - a.z) < 2, 'pasture built, the builder with a queued move walks on');
    ok(w.order && w.order.type === 'gather' && w.order.rt === 'pasture', 'the other builder stays on as herder');
  }
  { // trade carts loop for ever: a Shift move runs at once too
    const g = mk(), p = g.players[0];
    const c = g._addUnit('tradecart', 0, p.startX + 6, p.startZ + 6);
    ok(c.order && c.order.type === 'trade', 'a new trade cart starts its trade run');
    g.cmdMove([c.id], p.startX + 14, p.startZ + 14, true);
    ok(c.order && c.order.type === 'move', 'Shift move onto a trade cart runs at once');
  }
}

if (only('B')) {
  console.log('-- B: cannons, cavalry, towers');
  const g = mk({ startAge: 3 }); const p0 = g.players[0];
  const dmg = (a, t) => { const d = UNITS[a]; return g._dmg(d.atk, d.bonus, d.cls === 'siege', { kind: 'unit', type: t, owner: 1 }); };
  const tower = age => BUILDINGS.tower.atk + age * TOWER_AGE_ATK;
  console.log(`   cannon hit: rifleman ${dmg('cannon', 'rifleman')}, cuirassier ${dmg('cannon', 'cuirassier')}; on a building ${g._dmg(UNITS.cannon.atk, UNITS.cannon.bonus, true, { kind: 'building' })}`);
  console.log(`   cuirassier hit on a cannon ${dmg('cuirassier', 'cannon')} (cannon hp ${UNITS.cannon.hp}), knight ${dmg('knight', 'cannon')}, light cav ${dmg('lightcav', 'cannon')}`);
  console.log(`   tower attack by age: ${[1, 2, 3, 4].map(tower).join(' / ')}`);
  ok(UNITS.cannon.atk < UNITS.rifleman.atk * 1.5, `cannon attack ${UNITS.cannon.atk} is no longer ~2x a rifleman's (${UNITS.rifleman.atk})`);
  ok(Math.ceil(UNITS.cannon.hp / dmg('cuirassier', 'cannon')) <= 2 && Math.ceil(UNITS.cannon.hp / dmg('knight', 'cannon')) <= 3, 'a cuirassier kills a cannon in 2 hits, a knight in 3');
  ok(Math.abs(tower(3) - UNITS.cannon.atk) <= 8, `a Gunpowder Age tower hits about as hard as a cannon (${tower(3)} vs ${UNITS.cannon.atk})`);
  ok(g._dmg(UNITS.cannon.atk, UNITS.cannon.bonus, true, { kind: 'building' }) >= 150, 'cannons still break buildings as before (>= 150 a shot)');
  // a fight: 3 cuirassiers charge 4 cannons from 8 tiles
  const x0 = p0.startX + 20, z0 = p0.startZ + 20;
  const cs = [0, 1, 2, 3].map(i => g._addUnit('cannon', 1, x0 + i * 1.2, z0)), cav = [0, 1, 2].map(i => g._addUnit('cuirassier', 0, x0 + i, z0 - 8));
  for (const c of cs) g.cmdStop([c.id]);
  g.cmdAttack(cav.map(u => u.id), cs[0].id);
  let t = 0; while (cs.some(c => !c.dead) && t++ < 60 * 30) { g.update(1 / 30); for (const u of cav) if (!u.order && !u.dead) { const n = cs.find(c => !c.dead); if (n) g.cmdAttack([u.id], n.id); } }
  ok(cs.every(c => c.dead) && cav.filter(u => !u.dead).length >= 2, `3 cuirassiers wreck 4 cannons (${(t / 30).toFixed(1)} s, ${cav.filter(u => !u.dead).length} riders left)`);
}

if (only('C')) {
  console.log('-- C: towers shoot over their own walls');
  for (const age of [1, 3]) {
    const g = mk({ startAge: age }), p = g.players[0], N = g.map.size;
    // a straight east-west wall 14 tiles south of the start, a tower right behind it (north side)
    let z = (p.startZ | 0) + 16; const row = z => { const t = []; for (let x = (p.startX | 0) - 8; x <= (p.startX | 0) + 8; x++) t.push([x, z]); return t; };
    while (!row(z).every(([x, zz]) => g.canPlace('wall', x, zz, 0) && g.canPlace('wall', x, zz + 3, 0) && g.canPlace('tower', x - 1, zz - 4, 0))) z++;
    const walls = row(z).map(([x, zz]) => g._addBuilding('wall', 0, x, zz, true));
    const tw = g._addBuilding('tower', 0, (p.startX | 0) - 1, z - 4, true);
    ok(walls.every(w => g.map.blocked[w.tz * N + w.tx] === 1) && tw.done, `age ${age}: a finished wall line with a tower ${(z - tw.z).toFixed(1)} tiles behind it`);
    // enemy spearmen on the far side hack at the wall
    const foes = [-2, -1, 0, 1, 2].map(i => g._addUnit('spearman', 1, p.startX + i + 0.5, z + 1.6));
    g.cmdAttack(foes.map(u => u.id), walls[8].id);
    const hp0 = foes.reduce((s, u) => s + u.hp, 0); step(g, 20);
    const hp1 = foes.reduce((s, u) => s + Math.max(0, u.dead ? 0 : u.hp), 0);
    ok(hp1 < hp0 * 0.5, `age ${age}: the tower behind the wall hits the enemies on the far side (their hp ${hp0} -> ${hp1}, ${foes.filter(u => u.dead).length} dead)`);
    // and enemy archers standing off outside the wall
    const ar = [0, 1].map(i => g._addUnit('archer', 1, p.startX + i + 0.5, z + 5.5));
    for (const a of ar) g.cmdStop([a.id]);
    step(g, 30);
    ok(ar.every(a => a.dead || a.hp < a.maxHp), `age ${age}: also archers ${(z + 5.5 - tw.z).toFixed(1)} tiles away beyond the wall`);
  }
}


// D: the human player 0 is cut down to `setup`, the hard AI (player 1) gets an army and pushes at once
function huntGame(seed, setup) {
  const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'hard', seed, mapType: 'plains', startAge: 2 });
  g.quests = { list: [], update() {}, serialize() { return null; }, load() {} };
  const p = g.players[0], ai = g.ais[0];
  for (const u of g.unitsOf(0)) g._kill(u, null);
  for (const b of g.buildingsOf(0)) g._kill(b, null);
  step(g, 0.1);
  const place = (type, x, z) => { for (let r = 0; r < 40; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === r && g.canPlace(type, (x | 0) + dx, (z | 0) + dz, 0)) return g._addBuilding(type, 0, (x | 0) + dx, (z | 0) + dz, true); return null; };
  const info = setup(g, p, place);
  g.players[1].res = { food: 5000, wood: 5000, gold: 5000, stone: 5000 };
  const at = g.buildingsOf(1).find(b => b.type === 'towncenter');
  for (let i = 0; i < 16; i++) g._addUnit(i < 8 ? 'heavyinf' : i < 13 ? 'knight' : i < 15 ? 'crossbow' : 'ram', 1, at.x + 8 + (i % 5), at.z + 8 + (i / 5 | 0));
  ai.nextPush = 0; ai.pushN = 1;
  return { g, p, ai, info };
}
function runHunt(name, seed, setup, limitMin, check) {
  const { g, p, ai, info } = huntGame(seed, setup);
  if (check) check(g, info);
  let A = null, same = true, saved = false, backs = 0, wasBack = false;
  for (let t = 0; t < limitMin * 60 * 30 && !p.defeated; t++) {
    g.update(1 / 30);
    if (t % 30 === 0) { const b = ai.groups.some(gr => gr.kind === 'push' && gr.phase === 'back'); if (b && !wasBack) backs++; wasBack = b; }
    // a save taken while the push hunts goes on exactly like the original
    if (!saved && ai.groups.some(gr => gr.kind === 'push' && gr.hunting && gr.hc != null)) { A = Game.deserialize(JSON.parse(JSON.stringify(g.serialize()))); saved = true; }
    else if (A) { A.update(1 / 30); if (t % 150 === 0 && A.hash() !== g.hash()) same = false; if (A.time !== g.time) same = false; }
  }
  ok(p.defeated, `${name}: the AI push finishes player 0 within ${limitMin} min (${(g.time / 60).toFixed(1)} min, ${g.buildingsOf(0).length} buildings left, ${backs} retreats)`);
  ok(saved && same, `${name}: a save taken mid-hunt continues in step with the original`);
  ok(!Object.keys(ai.errors).length, `${name}: AI without errors ${JSON.stringify(ai.errors).slice(0, 200)}`);
}

if (only('D')) {
  console.log('-- D: AI pushes hunt down the last remains');
  // a far wall ring (radius 24) with the town center deep inside, away from the start; a few buildings by the start
  const ring = (g, p, place) => {
    const tc = place('towncenter', p.startX - 10, p.startZ + 90), cx = tc.x | 0, cz = tc.z | 0, R = 24;
    let n = 0; for (let dz = -R; dz <= R; dz++) for (let dx = -R; dx <= R; dx++) if (Math.max(Math.abs(dx), Math.abs(dz)) === R && g.canPlace('wall', cx + dx, cz + dz, 0)) { g._addBuilding('wall', 0, cx + dx, cz + dz, true); n++; }
    for (let i = 0; i < 3; i++) g._addUnit('villager', 0, tc.x + 5 + i, tc.z + 5);
    place('barracks', p.startX, p.startZ); place('house', p.startX + 8, p.startZ - 4); place('storage', p.startX - 6, p.startZ + 6);
    return { tc, n };
  };
  const shut = (g, { tc, n }) => {
    const N = g.map.size, p = g.players[0], d = g._ffSweep((p.startX | 0) + 12, (p.startZ | 0) + 12, 1, null);
    let reach = false; for (let x = tc.tx - 1; x <= tc.tx + tc.size; x++) for (let z = tc.tz - 1; z <= tc.tz + tc.size; z++) if (d[z * N + x] >= 0) reach = true;
    ok(!reach && n > 100, `the town center sits shut in a ring of ${n} wall pieces, ${Math.round(Math.hypot(tc.x - p.startX, tc.z - p.startZ))} tiles from the start`);
  };
  runHunt('walled town center', 5, ring, 12, shut);
  runHunt('walled town center (seed 9)', 9, ring, 12, shut);
  // scattered remains: a lone town center in a far corner and houses far apart, two villagers (since 2026-11-19 a
  // player with no town center at all loses after 2 minutes, so the remains keep one for the push to hunt down)
  runHunt('scattered remains', 5, (g, p, place) => {
    place('towncenter', 30, 220);
    const hs = [[128, 40], [40, 128], [128, 128]].map(([x, z]) => place('house', x, z));
    for (const h of hs.slice(0, 2)) g._addUnit('villager', 0, h.x + 2.5, h.z + 2.5);
  }, 16);
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
