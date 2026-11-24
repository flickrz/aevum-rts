// Intact walls hold (owner report 2026-11-24: "enemies pass through walls even when they are intact"): node test/wall-pass-test.mjs
// A closed wall ring (square, diamond with corner joints only, with and without a gate of the owner) and enemy units
// sent behind it by move, attack-move and attack orders (also after a save/load and as a big pushing crowd). The walls
// are made unbreakable, so no enemy may ever stand inside the ring or deep in a wall tile. Own units use the own gate.
import { Game } from '../src/sim/game.js';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? 'ok   ' : 'FAIL ') + m); };
const mk = () => { const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'easy', startRes: 'normal', seed: 11 }); g.ais.length = 0; return g; };
const cx = 85, cz = 80, R = 6, N = 256;
function ring(g, diamond, gate) {
  const tiles = [];
  if (!diamond) for (let i = -R; i <= R; i++) tiles.push([cx + i, cz - R], [cx + i, cz + R], [cx - R, cz + i], [cx + R, cz + i]);
  else for (let i = 0; i < R; i++) tiles.push([cx + i, cz - R + i], [cx + R - i, cz + i], [cx - i, cz + R - i], [cx - R + i, cz - i]);
  for (const [x, z] of tiles) if (!g.buildingAt(x, z)) g._complete(g._addBuilding('wall', 0, x, z, true));
  if (gate) ok(g.cmdOpenGate(g.buildingAt(cx, cz - R).id), 'gate opened');
  for (const b of g.buildings) if (b.type === 'wall' || b.type === 'gate') b.hp = b.maxHp = 1e9;   // (unbreakable: only passing through counts)
}
const inside = (u, diamond) => { const dx = Math.abs(u.x - cx - .5), dz = Math.abs(u.z - cz - .5); return diamond ? dx + dz < R - 1 : Math.max(dx, dz) < R - .5; };
const types = ['spearman', 'archer', 'knight', 'swordsman', 'ram', 'catapult', 'villager', 'lightcav'];
for (const diamond of [false, true]) for (const mode of ['move', 'am', 'attack', 'saveload', 'gate-move', 'gate-am', 'crowd']) {
  let g = mk(); ring(g, diamond, mode.startsWith('gate') && !diamond);
  const tgt = g._addBuilding('house', 0, cx - 1, cz - 1, true); g._complete(tgt);
  let us = []; const n = mode === 'crowd' ? 80 : 32;
  for (let i = 0; i < n; i++) us.push(g._addUnit(types[i % types.length], 1, cx - 5 + i % 10, cz - R - 3 - (i / 10 | 0)));
  if (mode === 'saveload') { g = Game.deserialize(JSON.parse(JSON.stringify(g.serialize()))); g.ais.length = 0; us = us.map(u => g.getEntity(u.id)); }
  const ids = us.map(u => u.id);
  if (mode === 'attack') g.cmdAttack(ids, tgt.id); else if (mode.endsWith('am')) g.cmdAttackMove(ids, cx + .5, cz + .5); else g.cmdMove(ids, cx + .5, cz + .5);
  let bad = null;
  for (let t = 0; t < 30 * 45 && !bad; t++) {
    g.update(1 / 30);
    for (const u of us) {
      if (u.dead) continue;
      const tx = u.x | 0, tz = u.z | 0, fx = u.x - tx, fz = u.z - tz;
      if (inside(u, diamond)) { bad = `${u.type} inside at ${u.x.toFixed(2)},${u.z.toFixed(2)} t${t}`; break; }
      if (!g._pass(tx, tz, u.owner) && Math.min(fx, 1 - fx, fz, 1 - fz) > 0.2) { bad = `${u.type} deep in a blocked tile ${u.x.toFixed(2)},${u.z.toFixed(2)} (${g.map.blocked[tz * N + tx]}) t${t}`; break; }
    }
  }
  ok(!bad, `${diamond ? 'diamond' : 'square'} ${mode}: no enemy got through ${bad || ''}`);
}
{ // own units still use their own gate; an enemy does not
  const g = mk(); ring(g, false, true);
  const me = []; for (let i = 0; i < 6; i++) me.push(g._addUnit('spearman', 0, cx - 3 + i, cz - R - 4));
  g.cmdMove(me.map(u => u.id), cx + .5, cz + .5);
  for (let t = 0; t < 30 * 30; t++) g.update(1 / 30);
  ok(me.filter(u => inside(u, false)).length >= 5, 'own soldiers walk in through their gate (' + me.filter(u => inside(u, false)).length + '/6)');
}
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
