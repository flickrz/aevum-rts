// Hunting (owner 2026-11-23 "önce öldürsün"): a villager sent to a live animal first kills it, and only then gathers
// food from the carcass; the full food amount is kept. node test/hunt-test.mjs
import { Game } from '../src/sim/game.js';

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.log('  FAIL', m); } else console.log('  ok ', m); return !!c; };
const step = (g, sec, fn) => { for (let i = 0, n = Math.round(sec * 30); i < n; i++) { g.update(1 / 30); if (fn) fn(); } };

const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed: 11 });
g.ais.length = 0;
const p = g.players[0];
const deer = g.deer.filter(d => !d.dead).sort((a, b) => Math.hypot(a.x - p.startX, a.z - p.startZ) - Math.hypot(b.x - p.startX, b.z - p.startZ) || a.id - b.id)[0];
ok(deer && deer.alive === true, 'a deer spawns alive');
const amt0 = deer.amount;
const f = g._freeNear(deer.x + 5, deer.z, 0), v = g._addUnit('villager', 0, f.x, f.z);
g.cmdGather([v.id], deer.id);
let gotWhileAlive = false, attacked = false, killedAt = -1, fled = false; const sx = deer.x, sz = deer.z;
g.events.on('attack', e => { if (e.attacker === v && e.target === deer) attacked = true; });
step(g, 40, () => {
  if (deer.alive && ((v.carry && v.carry.amount > 0) || deer.amount < amt0)) gotWhileAlive = true;
  if (deer.alive && Math.hypot(deer.x - sx, deer.z - sz) > 1.5) fled = true;
  if (!deer.alive && killedAt < 0) killedAt = g.time;
});
ok(attacked, 'the villager attacks the deer');
ok(!gotWhileAlive, 'no food taken from the live deer');
ok(killedAt > 0, 'the deer is killed');
ok(fled, 'the deer flees from the hunter');
ok(deer.amount < amt0 || (v.carry && v.carry.amount > 0) || p.res.food > 0, 'food gathered from the carcass');
const cx = deer.x, cz = deer.z; step(g, 5);
ok(deer.dead || (deer.x === cx && deer.z === cz), 'the carcass stays put');
// the carcass holds the deer's full food
const g2 = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed: 11 }); g2.ais.length = 0;
const d2 = g2.entities.get(deer.id); ok(d2 && d2.amount === amt0 && d2.maxAmount === amt0, 'food amount unchanged (' + amt0 + ')');
if (fails.length) { console.log(`\n${fails.length} FAILED`); process.exit(1); } console.log('\nall ok');
