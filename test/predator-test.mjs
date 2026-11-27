// Wild predators (wolf packs, lone bears; player feedback 2026-11-23): node test/predator-test.mjs
import { Game, PRED, PREY, PRED_START, PRED_START_K } from '../src/sim/game.js';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); };
const step = (g, s, fn) => { for (let i = 0; i < Math.round(s * 30); i++) { g.update(1 / 30); if (fn && fn()) return true; } return false; };
const CX = 128, CZ = 128;
const mk = (extra = {}) => {
  const g = new Game({ mapSize: 256, mapType: 'plains', enemies: 1, difficulty: 'easy', startAge: 0, sandbox: false, seed: 11, ...extra }); g.ais.length = 0;
  const N = g.map.size;
  for (let z = CZ - 16; z < CZ + 16; z++) for (let x = CX - 16; x < CX + 16; x++) { const k = z * N + x; g.map.tiles[k] = 0; g.map.blocked[k] = 0; g.resAt[k] = 0; }
  for (const e of [...g.entities.values()]) if (e.kind !== 'unit' && Math.abs(e.x - CX) < 18 && Math.abs(e.z - CZ) < 18) { e.dead = true; g.entities.delete(e.id); if (PREY[e.type]) g.deer.splice(g.deer.indexOf(e), 1); }
  g.buildings = g.buildings.filter(b => !b.dead);
  return g;
};

// 1) map generation: a few of each, live, far from the starts; none in the tutorial
for (const [mapSize, seed] of [[256, 3], [384, 9]]) {
  const g = new Game({ mapSize, enemies: 1, difficulty: 'easy', startAge: 0, seed });
  const w = g.deer.filter(e => e.type === 'wolf'), b = g.deer.filter(e => e.type === 'bear');
  ok(w.length >= 2 && w.length <= Math.round(mapSize / 64) * 3 && b.length >= 1 && b.length <= Math.round(mapSize / 96), `map ${mapSize}: ${w.length} wolves, ${b.length} bears`);
  ok([...w, ...b].every(e => e.live && e.hp === PRED[e.type].hp && e.amount === PRED[e.type].food && e.owner === -1), 'predators start live, food > a deer');
  const tc = g.buildings.filter(x => x.type === 'towncenter');
  ok([...w, ...b].every(e => tc.every(t => Math.hypot(t.x - e.x, t.z - e.z) > 20)), 'none near a town centre');
}
// 2) a wolf bites a villager that walks close, a lone villager far away is left alone
{
  const g = mk(); const wolf = g._addRes('wolf', CX, CZ, PRED.wolf.food);
  const v = g._addUnit('villager', 0, CX + 2, CZ), far = g._addUnit('villager', 1, CX + 10, CZ);
  step(g, 6);
  ok(v.hp < v.maxHp || v.dead, `the wolf bit the close villager (hp ${v.hp}/${v.maxHp})`);
  ok(far.hp === far.maxHp, 'the far villager is untouched');
  // a villager told to gather a live wolf fights it instead
  g.cmdGather([v.id], wolf.id);
  ok(v.order && v.order.type === 'attack', 'gather on a live wolf = attack');
}
// 3) soldiers kill a bear, then villagers hunt the carcass for its food
{
  const g = mk(); const bear = g._addRes('bear', CX, CZ, PRED.bear.food);
  const sp = [0, 1, 2, 3].map(i => g._addUnit('spearman', 0, CX + 4, CZ + i - 1.5));
  ok(g.cmdAttack(sp.map(u => u.id), bear.id), 'spearmen can be ordered to attack a bear');
  step(g, 40, () => !bear.live);
  ok(!bear.live && !bear.dead && g.entities.has(bear.id), 'the bear is down and lies there as a carcass');
  const pos = [bear.x, bear.z]; step(g, 3); ok(bear.x === pos[0] && bear.z === pos[1], 'a carcass does not move');
  const tc = g.buildings.find(b => b.type === 'towncenter' && b.owner === 0);
  const vs = [0, 1, 2].map(i => g._addUnit('villager', 0, CX + 1, CZ + i - 1));
  const food0 = g.players[0].res.food;
  ok(g.cmdGather(vs.map(u => u.id), bear.id) && vs.every(u => u.order && u.order.type === 'gather'), 'villagers gather the carcass');
  step(g, 30);
  ok(bear.amount < PRED.bear.food && vs.some(u => (u.carry && u.carry.amount > 0) || g.players[0].res.food > food0), `food taken from the carcass (left ${bear.amount}), tc ${!!tc}`);
}
// 4) auto defense: idle soldiers fight a wolf that attacks next to them
{
  const g = mk(); const wolf = g._addRes('wolf', CX, CZ, PRED.wolf.food);
  const s = g._addUnit('spearman', 0, CX + 1.5, CZ), v = g._addUnit('villager', 0, CX + 1.2, CZ + 0.8);
  step(g, 60, () => !wolf.live);
  ok(!wolf.live, 'an idle spearman next to it killed the attacking wolf');
}
// 5) determinism with predators: same seed, same state; a save keeps them
{
  const run = () => { const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'hard', startAge: 0, seed: 5 }); step(g, 120); return g; };
  const a = run(), b = run();
  const sig = g => g.deer.map(e => `${e.type}${e.id}:${e.x.toFixed(4)},${e.z.toFixed(4)},${e.hp},${e.live ? 1 : 0}`).join('|');
  ok(sig(a) === sig(b), 'two runs of the same seed match (animals)');
  const c = Game.deserialize(a.serialize());
  ok(c.deer.length === a.deer.length && c.deer.filter(e => e.live).length === a.deer.filter(e => e.live).length, 'save/load keeps the predators');
}
// 9) (owner 2026-11-24) far from every start; a bear aggroes within its radius; a hit bear / wolf always fights back
for (const [mapSize, seed] of [[256, 3], [384, 9], [192, 5]]) {
  const g = new Game({ mapSize, enemies: 1, difficulty: 'easy', startAge: 0, seed });
  const pr = g.deer.filter(e => e.live), tc = g.buildings.filter(x => x.type === 'towncenter'), min = Math.min(PRED_START, Math.max(18, mapSize * PRED_START_K)) - 1;
  const md = Math.min(...pr.map(e => Math.min(...tc.map(t => Math.hypot(t.x - e.x, t.z - e.z)))));
  ok(pr.length >= 2 && md >= min, `map ${mapSize}: ${pr.length} predators, nearest ${md.toFixed(1)} tiles from a start (>= ${min})`);
}
{
  const g = mk(); const bear = g._addRes('bear', CX, CZ, PRED.bear.food); const v = g._addUnit('villager', 0, CX + 4, CZ);
  step(g, 6); ok(v.hp < v.maxHp || v.dead, `a bear attacks a villager 4 tiles off (hp ${v.hp}/${v.maxHp})`);
}
for (const type of ['bear', 'wolf']) {
  const g = mk(); const a = g._addRes(type, CX, CZ, PRED[type].food); const ar = g._addUnit('archer', 0, CX + 6, CZ); ar.stance = 'hold';
  g.cmdAttack([ar.id], a.id); const h0 = ar.hp; step(g, 2.5);
  ok(a.hp < a.maxHp && a.foe === ar.id, `${type}: hit by an archer outside its aggro radius, marks it as foe`);
  step(g, 6); ok(ar.hp < h0 || ar.dead || !a.live, `${type}: fights back (archer hp ${ar.hp}/${h0}, ${type} hp ${a.hp})`);
}
// 10) false "under attack" alerts: predators / non-enemies must not emit underAttack, real enemies must
{
  const g = mk(); g.me = 0; let alerts = 0; g.events.on('underAttack', () => alerts++);
  const wolf = g._addRes('wolf', CX, CZ, PRED.wolf.food);
  const v = g._addUnit('villager', 0, CX + 1.5, CZ);
  step(g, 5);
  ok(v.hp < v.maxHp || v.dead, 'wolf bit player 0 villager');
  ok(alerts === 0, 'wild predator bite does not raise underAttack (' + alerts + ')');
  const own = g._addUnit('spearman', 0, CX + 5, CZ);
  g._applyDamage(own, 5, null, null);
  g._applyDamage(own, 5, own, null);
  ok(alerts === 0, 'null / self damage does not raise underAttack (' + alerts + ')');
  const foe = g._addUnit('spearman', 1, CX + 6, CZ);
  g._applyDamage(own, 5, foe, null);
  ok(alerts === 1, 'real enemy attack raises underAttack (' + alerts + ')');
}
console.log(fails.length ? `\n${fails.length} FAIL` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
