// Playtest 3 (2026-11-17, the owner and a friend, chat log T7T7M): node test/playtest3-test.mjs
import { Game, CMD_METHODS, CASTLE_VOLLEY } from '../src/sim/game.js';
import { METHODS } from '../src/net/session.js';
import { BUILDINGS } from '../src/data.js';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); };
const mk = (age = 1, extra = {}) => { const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'easy', startRes: 'normal', startAge: age, sandbox: false, seed: 11, ...extra }); g.ais.length = 0; return g; };
const step = (g, s, fn) => { for (let i = 0; i < s * 30; i++) { g.update(1 / 30); if (fn && fn()) return true; } return false; };

// 1) every network command travels in multiplayer (tribute and stance were missing: "sending resources does not work",
//    "the spearman's stance does not change")
ok(CMD_METHODS.every(m => METHODS.includes(m)), 'the lockstep sends every Game command (' + CMD_METHODS.filter(m => !METHODS.includes(m)).join(', ') + ')');

// 2) a Bronze Age tower outranges an archer with Fletching, also one standing at the tower's corner
{
  const g = mk(1); g.players[1].techs.add('fletching'); g._recalcMods ? g._recalcMods(1) : null;
  const t = g._addBuilding('tower', 0, 88, 60, true); g._complete(t);
  const R = BUILDINGS.tower.range, h = t.size / 2, k = (R - 0.3) / Math.SQRT2;
  const a = g._addUnit('archer', 1, t.x + h + k, t.z + h + k);   // diagonal, just inside the tower's reach
  let hit = false; g.events.on('attack', e => { if (e.attacker === t) hit = true; });
  step(g, 3, () => hit);
  ok(hit, 'the tower shoots an archer at its diagonal corner ' + (R - 0.3).toFixed(1) + ' tiles from its edge');
  ok(R > 5 + 1 + 1, 'tower reach ' + R + ' beats the archer with both range techs (7)');
}

// 3) the castle fires a volley at several targets
{
  const g = mk(2); const c = g._addBuilding('castle', 0, 88, 60, true); g._complete(c);
  for (let i = 0; i < 5; i++) g._addUnit('spearman', 1, c.x - 3 + i * 1.5, c.z + c.size / 2 + 3);
  g.ais.length = 0; let shots = 0;
  const f0 = g._fire.bind(g), tg = new Set(); g._fire = (s, t, d, p) => { if (s === c) { shots++; tg.add(t.id); } return f0(s, t, d, p); };
  step(g, 0.6);
  ok(shots === CASTLE_VOLLEY && tg.size === CASTLE_VOLLEY, 'one castle volley = ' + CASTLE_VOLLEY + ' arrows at as many targets (' + shots + ' / ' + tg.size + ')');
  ok(!/nüfus/i.test(BUILDINGS.castle.desc), 'the castle description no longer promises population');
}

// 4) Selective Breeding moved from the farm to the pasture
ok(BUILDINGS.pasture.researches.includes('breeding') && !BUILDINGS.farm.researches.includes('breeding'), 'breeding is researched at the pasture');
ok(BUILDINGS.pasture.size === 9, 'the pasture is 9x9');   // (6x6 since 2026-11-17, 9x9 since 2026-11-20)

// 5) idle cannons do not sit inside each other
{
  const g = mk(3); const cs = []; for (let i = 0; i < 8; i++) cs.push(g._addUnit('cannon', 0, 88 + (i % 2) * 0.2, 60 + (i >> 1) * 0.2));
  step(g, 8);
  let m = 99; for (let i = 0; i < cs.length; i++) for (let j = i + 1; j < cs.length; j++) m = Math.min(m, Math.hypot(cs[i].x - cs[j].x, cs[i].z - cs[j].z));
  ok(m > 1.3, 'idle cannons spread out (closest pair ' + m.toFixed(2) + ' tiles)');
}

// 6) 30 cannons and 60 spearmen through a one-tile ford
for (const [type, n, lim] of [['cannon', 30, 60], ['spearman', 60, 40]]) {
  const g = new Game({ mapSize: 96, mapType: 'plains', seed: 5, enemies: 1, sandbox: true }); g.ais.length = 0;
  for (const u of [...g.units]) g._kill(u);
  const N = g.map.size;
  for (let z = 20; z < 76; z++) for (let x = 2; x < N - 2; x++) { const k = z * N + x; g.map.tiles[k] = 0; g.map.blocked[k] = 0; g.resAt[k] = 0; }
  for (const e of [...g.entities.values()]) if (e.kind !== 'unit' && e.z > 19 && e.z < 77) { e.dead = true; g.entities.delete(e.id); }
  g.buildings = g.buildings.filter(b => !b.dead);
  for (let z = 44; z < 50; z++) for (let x = 1; x < N - 1; x++) g.map.tiles[z * N + x] = x === 48 ? 3 : 4;
  const us = []; for (let i = 0; i < n; i++) us.push(g._addUnit(type, 0, 38 + (i % 10), 28 + Math.floor(i / 10)));
  g.cmdMove(us.map(u => u.id), 48.5, 62);
  const t0 = g.time; const done = step(g, lim, () => us.every(u => !u.order && u.z > 50));
  ok(done, n + ' ' + type + ' cross a one-tile ford in ' + (g.time - t0).toFixed(1) + ' s (limit ' + lim + ')');
}

// 7) "under attack" once per fight
{
  const g = mk(1); g.me = 0; let n = 0; g.events.on('underAttack', () => n++);
  const tc = g.buildings.find(b => b.owner === 0 && b.type === 'towncenter');
  for (let i = 0; i < 3; i++) { const f = g._addUnit('swordsman', 1, tc.x + 6 + i, tc.z + 6); f.hp = f.maxHp = 5000; g.cmdAttack([f.id], tc.id); }
  step(g, 40);
  ok(n === 1, 'a 40 s fight raises the alarm once (' + n + ')');
}

// 8) a soldier whose foe fell takes the next one at once
{
  const g = mk(1); const s = g._addUnit('swordsman', 0, 88, 60);
  const a = g._addUnit('spearman', 1, 88.8, 60), b = g._addUnit('spearman', 1, 89, 61.2); a.hp = 1;
  g.cmdAttack([s.id], a.id); let gap = -1, tDead = -1;
  step(g, 6, () => { if (a.dead && tDead < 0) tDead = g.time; if (tDead >= 0 && s.order && s.order.targetId === b.id) { gap = g.time - tDead; return true; } });
  ok(gap >= 0 && gap < 0.1, 'next target picked ' + (gap * 1000).toFixed(0) + ' ms after the first fell');
}

console.log(fails.length ? '\n' + fails.length + ' FAILED' : '\nall passed'); process.exit(fails.length ? 1 : 0);
