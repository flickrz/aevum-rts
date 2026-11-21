// The healer (Büyücü, owner 2026-11-21) and the Stone Age temple: node test/healer-test.mjs
import { Game, HEALER_R, HEALER_HP, PROD_B } from '../src/sim/game.js';
import { AIController } from '../src/sim/ai.js';
import { UNITS, BUILDINGS } from '../src/data.js';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); };
const step = (g, s, fn) => { for (let i = 0; i < Math.round(s * 30); i++) { g.update(1 / 30); if (fn && fn()) return true; } return false; };
// an AI-less game with an open patch of grass round (CX, CZ) and no starting units there
const CX = 128, CZ = 128;
const mk = (extra = {}) => {
  const g = new Game({ mapSize: 256, mapType: 'plains', enemies: 1, difficulty: 'easy', startAge: 0, sandbox: false, seed: 11, ...extra }); g.ais.length = 0;
  const N = g.map.size;
  for (let z = CZ - 16; z < CZ + 16; z++) for (let x = CX - 16; x < CX + 16; x++) { const k = z * N + x; g.map.tiles[k] = 0; g.map.blocked[k] = 0; g.resAt[k] = 0; }
  for (const e of [...g.entities.values()]) if (e.kind !== 'unit' && Math.abs(e.x - CX) < 18 && Math.abs(e.z - CZ) < 18) { e.dead = true; g.entities.delete(e.id); }
  g.buildings = g.buildings.filter(b => !b.dead);
  return g;
};
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// 1) data: the temple stands from the Stone Age and trains the healer
{
  const h = UNITS.healer;
  ok(BUILDINGS.temple.age === 0 && BUILDINGS.temple.trains.includes('healer'), 'temple: age 0, trains the healer');
  ok(h && h.name === 'Büyücü' && h.age === 0 && h.atk === 0 && h.hp === 40 && h.speed === 2.2 && h.los === 11 && h.pop === 1 && h.time === 28 && h.cost.food === 60 && h.cost.gold === 40, 'healer data (Büyücü, 60 food 40 gold, 28 s, 40 hp, atk 0)');
  const g = mk(); const p = g.players[0]; p.res.wood = p.res.stone = p.res.food = p.res.gold = 1000;
  ok(g.isUnlocked(0, 'building', 'temple') && g.isUnlocked(0, 'unit', 'healer'), 'temple and healer unlocked in the Stone Age');
  let t = null; for (let r = 0; r < 10 && !t; r++) for (let dz = -r; dz <= r && !t; dz++) for (let dx = -r; dx <= r && !t; dx++) if (g.canPlace('temple', CX - 4 + dx, CZ - 4 + dz, 0)) { const id = g.placeBuilding(0, 'temple', CX - 4 + dx, CZ - 4 + dz, []); if (id != null) t = g.getEntity(id); }
  ok(!!t, 'a temple can be placed in the Stone Age');
  if (t) {
    g._complete(t);
    ok(g.train(t.id, 'healer'), 'the temple queues a healer');
    let born = null; g.events.on('trained', e => { if (e.e.type === 'healer') born = e.e; });
    step(g, 40, () => !!born);
    ok(!!born && born.owner === 0, 'a healer comes out of the temple');
  }
}

// 2) a wounded spearman next to a healer gains HEALER_HP a second; an enemy does not; never above max hp
{
  const g = mk(); const h = g._addUnit('healer', 0, CX, CZ), s = g._addUnit('spearman', 0, CX + 2, CZ), foe = g._addUnit('spearman', 1, CX - 3.5, CZ + 3);
  s.hp = 10; foe.hp = 10; foe.stance = 'hold'; s.stance = 'hold';
  g.cmdStop([s.id, foe.id]);
  let pulses = 0; g.events.on('heal', e => { if (e.e === h) pulses++; });
  const fh0 = foe.hp;
  step(g, 5);
  ok(pulses >= 4 && pulses <= 6 && s.hp === 10 + pulses * HEALER_HP, `spearman +${HEALER_HP} hp per second (${pulses} pulses in 5 s: 10 -> ${s.hp})`);
  ok(foe.hp <= fh0, 'the enemy next to her is not healed (' + foe.hp + ')');
  s.hp = s.maxHp - 1; step(g, 2);
  ok(s.hp === s.maxHp, 'never above max hp (' + s.hp + '/' + s.maxHp + ')');
  ok(h.hp === h.maxHp, 'she has nobody wounded to heal herself with');
}

// 3) two healers next to one wounded unit do not heal it twice; the second heals the first one
{
  const g = mk(); const h1 = g._addUnit('healer', 0, CX, CZ), h2 = g._addUnit('healer', 0, CX + 1, CZ), s = g._addUnit('spearman', 0, CX + 2, CZ + 1);
  s.hp = 10; h1.hp = 20;
  let pulses = 0; g.events.on('heal', e => { if (e.e === h1) pulses++; });
  step(g, 5);
  ok(pulses >= 4 && s.hp === 10 + pulses * HEALER_HP, `two healers: still +${HEALER_HP} per second (10 -> ${s.hp} in ${pulses} pulses)`);
  ok(h1.hp === 20 + pulses * HEALER_HP, 'a healer is healed by another one (' + h1.hp + ')');
}

// 4) she never damages anything: no auto attack, a right click on an enemy only walks her there
{
  const g = mk(); const h = g._addUnit('healer', 0, CX, CZ), foe = g._addUnit('villager', 1, CX + 1.5, CZ);
  g.cmdStop([foe.id]); foe.hp = foe.maxHp;
  let attacks = 0; g.events.on('attack', e => { if (e.attacker === h) attacks++; });
  step(g, 6);
  const r = g.cmdAttack([h.id], foe.id);
  ok(r && h.order && h.order.type === 'move', 'attack command on an enemy = walk there (' + (h.order && h.order.type) + ')');
  step(g, 6);
  ok(attacks === 0 && foe.hp === foe.maxHp && !(h.order && h.order.type === 'attack'), 'she never attacks (' + attacks + ' attacks, enemy hp ' + foe.hp + '/' + foe.maxHp + ')');
  ok(!g.cmdBuild([h.id], g.buildings.find(b => b.owner === 0).id), 'she cannot be sent to build');
}

// 5) healing works in combat: the same 1v1 lasts longer for the side with a healer
const duel = (withHealer) => {
  const g = mk(); const s = g._addUnit('spearman', 0, CX, CZ), foe = g._addUnit('spearman', 1, CX + 1.2, CZ);
  if (withHealer) g._addUnit('healer', 0, CX - 3, CZ);
  g.cmdAttack([s.id], foe.id); g.cmdAttack([foe.id], s.id);
  let healedHit = false; g.events.on('heal', e => { if (e.targets.includes(s) && g.time - (s.hitT || -99) < 2) healedHit = true; });
  step(g, 25, () => s.dead || foe.dead);
  return { s, foe, healedHit };
};
{
  const a = duel(false), b = duel(true);
  ok(b.healedHit, 'the healer heals a spearman that was hit less than 2 s ago');
  ok(!b.s.dead && b.foe.dead && (a.s.dead || a.s.hp < b.s.hp), `with a healer the spearman wins the mirror duel (without: ${a.s.dead ? 'dead' : a.s.hp + ' hp'}, with: ${b.s.hp} hp)`);
}

// 6) idle, she walks to a wounded friend she sees (beyond her heal radius) and heals him
{
  const g = mk(); const h = g._addUnit('healer', 0, CX, CZ), s = g._addUnit('spearman', 0, CX + HEALER_R + 2.5, CZ);
  s.hp = 10; s.stance = 'hold';
  const d0 = dist(h, s);
  step(g, 6);
  ok(d0 > HEALER_R && dist(h, s) <= HEALER_R && s.hp > 10, `she walks to a wounded friend ${d0.toFixed(1)} tiles away (now ${dist(h, s).toFixed(1)}, his hp ${s.hp})`);
  ok(dist(h, s) > 1.5, 'and stops short of him');
  const far = g._addUnit('spearman', 0, CX - 12, CZ); far.hp = 10; s.hp = s.maxHp; const hx = h.x;
  step(g, 4);
  ok(Math.abs(h.x - hx) < 0.6, 'a wounded friend out of her sight does not pull her away');
}

// 7) determinism: same script twice gives the same hash, also across a save / load in the middle
const script = (saveAt) => {
  let g = mk({ seed: 23 });
  const hs = []; for (let i = 0; i < 3; i++) hs.push(g._addUnit('healer', 0, CX - 2 + i, CZ - 2));
  const us = []; for (let i = 0; i < 6; i++) { const u = g._addUnit('spearman', 0, CX - 3 + i, CZ); u.hp = 5 + i * 3; us.push(u); }
  const foes = []; for (let i = 0; i < 6; i++) foes.push(g._addUnit('spearman', 1, CX - 3 + i, CZ + 4));
  g.cmdAttack(foes.map(u => u.id), us[0].id);
  for (let t = 0; t < 20; t += 0.5) { if (saveAt != null && Math.abs(t - saveAt) < 1e-9) { g = Game.deserialize(JSON.stringify(g.serialize())); g.ais.length = 0; } step(g, 0.5); }   // (a loaded game makes its AIs again)
  return g.hash();
};
{
  const a = script(null), b = script(null), c = script(7.5);
  ok(a === b, 'two runs give the same hash ' + a);
  ok(a === c, 'a save / load in the middle keeps the hash (' + c + ')');
}

// 8) the AI trains healers at its temple (about 1 per 8 soldiers) and keeps them with its army
{
  const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'normal', startAge: 1, seed: 9 });
  const ai = g.ais.find(a => a.pid === 1), p = g.players[1];
  for (const k in p.res) p.res[k] = 20000;
  const tc = g.buildings.find(b => b.owner === 1 && b.type === 'towncenter');
  let t = null; for (let r = 8; r < 30 && !t; r++) for (let dz = -r; dz <= r && !t; dz++) for (let dx = -r; dx <= r && !t; dx++) { const tx = (tc.x | 0) + dx, tz = (tc.z | 0) + dz; if (g.canPlace('temple', tx, tz, 1)) { const id = g.placeBuilding(1, 'temple', tx, tz, []); if (id != null) t = g.getEntity(id); } }
  if (t) g._complete(t);
  for (let i = 0; i < 16; i++) { const f = g._freeNear(tc.x + 6 + (i % 4), tc.z + 6 + (i >> 2), 1); g._addUnit('spearman', 1, f.x, f.z); }
  step(g, 120);
  const hs = g.units.filter(u => u.owner === 1 && u.type === 'healer' && !u.dead);
  ok(!!t && hs.length >= 1 && hs.length <= 4, 'the AI trained healers at its temple (' + hs.length + ')');
  ok(!Object.keys(ai.errors).length, 'AI without errors ' + JSON.stringify(ai.errors));
}

// 9) victory rule: the temple (it trains only the healer) does not keep a player in the game
{
  ok(!PROD_B.has('temple') && PROD_B.has('towncenter') && PROD_B.has('barracks'), 'PROD_B: town center / barracks count, the temple does not');
  const g = mk(); const p1 = g.players[1];
  const tc = g.buildings.find(b => b.owner === 1 && b.type === 'towncenter');
  let t = null; for (let r = 8; r < 30 && !t; r++) for (let dz = -r; dz <= r && !t; dz++) for (let dx = -r; dx <= r && !t; dx++) { const tx = (tc.x | 0) + dx, tz = (tc.z | 0) + dz; if (g.canPlace('temple', tx, tz, 1)) { const id = g.placeBuilding(1, 'temple', tx, tz, []); if (id) t = g.getEntity(id); } }
  if (t) g._complete(t);
  for (const b of g.buildings) if (b.owner === 1 && b !== t && !b.dead) g._kill(b);
  step(g, 4);
  ok(!!t && !t.dead && p1.defeated, 'a player with only a temple left is defeated (temple ' + (t ? (t.dead ? 'dead' : 'standing') : 'not placed') + ', defeated ' + p1.defeated + ')');
}

// 10) she gives seeking up for 10 s when the wounded friend she walked to cannot be reached (deep water round him)
{
  const g = mk(); const N = g.map.size, TX = CX + 0.3 + HEALER_R + 2.5, TZ = CZ + 0.5, RO = HEALER_R + 1.6;
  for (let z = CZ - 12; z <= CZ + 12; z++) for (let x = CX; x <= CX + 24; x++) { const dx = x + 0.5 - TX, dz = z + 0.5 - TZ, d = dx * dx + dz * dz; if (d >= 2 * 2 && d <= RO * RO) g.map.tiles[z * N + x] = 4; }
  g._blkMark(CX, CZ - 12, 25, 25);
  const h = g._addUnit('healer', 0, CX + 0.3, TZ), s = g._addUnit('spearman', 0, TX, TZ);
  s.hp = 10; s.stance = 'hold'; g.cmdStop([s.id]);
  let seeks = 0, was = false;
  step(g, 12, () => { const now = !!(h.order && h.order.hs); if (now && !was) seeks++; was = now; return false; });
  ok(seeks === 1 && h.hsT > g.time && dist(h, s) > HEALER_R && s.hp === 10, `unreachable friend: one seek, then she waits (seeks ${seeks}, hsT ${h.hsT != null ? (h.hsT - g.time).toFixed(1) + ' s left' : 'unset'}, dist ${dist(h, s).toFixed(1)})`);
  const c = Game.deserialize(JSON.stringify(g.serialize())); const h2 = c.getEntity(h.id);
  ok(h2 && h2.hsT === h.hsT, 'the give-up timer survives a save / load');
}

// 11) a whole AI-vs-AI game: an AI builds a temple on its own and fields a healer within 20 game minutes (~20 s)
{
  const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'normal', startRes: 'normal', startAge: 0, sandbox: false, seed: 7 });
  g.quests = { list: [], update() {}, serialize() { return null; }, load() {} };
  g.ais.length = 0; g.ais.push(new AIController(g, 0, 'normal'), new AIController(g, 1, 'normal'));
  let tAt = null, hAt = null;
  g.events.on('buildComplete', ({ e }) => { if (e && e.type === 'temple' && tAt == null) tAt = g.time / 60; });
  g.events.on('trained', ({ e }) => { if (e && e.type === 'healer' && hAt == null) hAt = g.time / 60; });
  step(g, 20 * 60, () => hAt != null || !!g.over);
  ok(tAt != null && hAt != null, `AI vs AI: a temple (min ${tAt == null ? '-' : tAt.toFixed(1)}) and a healer (min ${hAt == null ? '-' : hAt.toFixed(1)}) within 20 min`);
  ok(g.ais.every(a => !Object.keys(a.errors).length), 'AIs without errors');
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
