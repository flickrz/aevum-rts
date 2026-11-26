// Worker places on a pasture / farm (player report 2026-11-23: "villagers sent to the pen and called back on the way
// still count as its workers"). Only villagers really there make food and count as workers (b.wk); a cancelled
// assignment (stop, a new order, death) frees its place at once. node test/worker-slot-test.mjs
import { Game } from '../src/sim/game.js';

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.log('  FAIL', m); } else console.log('  ok ', m); return !!c; };
const step = (g, sec) => { for (let i = 0, n = Math.round(sec * 30); i < n; i++) g.update(1 / 30); };

// player 0 alone with a finished `type` building and `n` villagers `dist` tiles away; the start villagers stay idle
function setup(type, n, dist) {
  const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed: 11 }); g.ais.length = 0;
  const p = g.players[0];
  let spot = null;
  for (let r = 8; r < 40 && !spot; r++) for (let dz = -r; dz <= r && !spot; dz++) for (let dx = -r; dx <= r; dx++) { const tx = Math.floor(p.startX) + dx, tz = Math.floor(p.startZ) + dz; if (g.canPlace(type, tx, tz, 0)) { spot = [tx, tz]; break; } }
  const b = g._addBuilding(type, 0, spot[0], spot[1], true); g._complete(b);
  g.cmdStop(g.unitsOf(0).map(u => u.id));
  const vs = []; for (let i = 0; i < n; i++) { const f = g._freeNear(b.x + dist, b.z + dist, 0); vs.push(g._addUnit('villager', 0, f.x, f.z)); }
  return { g, p, b, vs, ids: vs.map(v => v.id) };
}

console.log('pasture: called back on the way');
{
  const base = setup('pasture', 4, 30); const f0 = base.p.res.food; step(base.g, 31); const idle = base.p.res.food - f0;
  const { g, p, b, ids } = setup('pasture', 4, 30);
  const f1 = p.res.food;
  g.cmdGather(ids, b.id); step(g, 1);
  ok((b.wk | 0) === 0, 'walking herders are not working yet (wk ' + b.wk + ')');
  g.cmdMove(ids, b.x + 20, b.z - 20); step(g, 30);
  ok(p.res.food - f1 === idle, 'after the recall only the idle flock gives food (' + (p.res.food - f1) + ' vs ' + idle + ')');
  ok((b.wk | 0) === 0, 'no workers counted after the recall');
}

console.log('pasture: herders working, then stopped');
{
  const { g, b, ids } = setup('pasture', 3, 5);
  g.cmdGather(ids, b.id); step(g, 20);
  ok(b.wk === 3, 'three herders working (wk ' + b.wk + ')');
  g.cmdStop(ids.slice(0, 2)); step(g, 1 / 30);
  ok(b.wk === 1, 'stop frees their places at once (wk ' + b.wk + ')');
}

console.log('farm: plots freed when the farmer leaves or dies');
{
  const { g, b, vs, ids } = setup('farm', 3, 4);
  g.cmdGather(ids, b.id); step(g, 20);
  const w = b.farm.w;
  ok(w.filter(Boolean).length === 3 && b.wk === 3, 'three farmers on plots (w ' + w.join(',') + ', wk ' + b.wk + ')');
  const tree = g.resourceNear(b.x, b.z, 40, 'tree');
  g.cmdGather([ids[0]], tree.id); g._kill(vs[1], null); step(g, 1 / 30);
  ok(!w.includes(ids[0]) && !w.includes(ids[1]) && w.includes(ids[2]), 'reassigned and dead farmers lose their plots at once (w ' + w.join(',') + ')');
  ok(b.wk === 1, 'one farmer left working (wk ' + b.wk + ')');
  g.cmdStop([ids[2]]); step(g, 1 / 30);
  ok(w.every(x => !x) && (b.wk | 0) === 0, 'stopped: every plot free, no workers');
}

console.log('farm: called back on the way');
{
  const { g, p, b, ids } = setup('farm', 4, 30);
  const f1 = p.res.food;
  g.cmdGather(ids, b.id); step(g, 1); g.cmdStop(ids); step(g, 30);
  ok(p.res.food === f1 && b.farm.w.every(x => !x) && (b.wk | 0) === 0, 'no food, no plots, no workers');
}

console.log('rally flag on full mine / tree redirects to nearest same-type resource');
{
  const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed: 43, sandbox: true }); g.ais.length = 0;
  const p = g.players[0];
  const tc = g.buildingsOf(0).find(b => b.type === 'towncenter');
  g.cmdStop(g.unitsOf(0).map(u => u.id));
  // fill a gold deposit to MINE_CAP (8)
  const gold = g.resourceNear(tc.x, tc.z, 30, 'gold');
  const dep1 = g._depOf(gold);
  const vils = g.unitsOf(0).filter(u => u.type === 'villager');
  g.cmdGather(vils.slice(0, 8).map(u => u.id), gold.id);
  step(g, 1);
  ok(g.mineLoad(dep1, 0) === 8, 'gold deposit filled to 8');
  g.setRally(tc.id, gold.x, gold.z, gold.id);
  const beforeIds = new Set(g.unitsOf(0).map(u => u.id));
  ok(g.train(tc.id, 'villager'), 'train villager with rally on full gold');
  step(g, 20);
  const nv = g.unitsOf(0).find(u => u.type === 'villager' && !beforeIds.has(u.id));
  const nt = nv && nv.order && g.getEntity(nv.order.targetId);
  ok(nv && nv.order && nv.order.type === 'gather' && nt && nt.type === 'gold' && g._depOf(nt) !== dep1, 'full mine rally -> new villager gathers another gold deposit instead of idling');

  // fill a single tree tile to its slot capacity (3)
  const tree = g.resourceNear(tc.x, tc.z, 30, 'tree');
  g.cmdGather(vils.slice(8, 11).map(u => u.id), tree.id);
  step(g, 0.2);
  g.setRally(tc.id, tree.x, tree.z, tree.id);
  const before2 = new Set(g.unitsOf(0).map(u => u.id));
  ok(g.train(tc.id, 'villager'), 'train villager with rally on full tree');
  step(g, 20);
  const nv2 = g.unitsOf(0).find(u => u.type === 'villager' && !before2.has(u.id));
  const nt2 = nv2 && nv2.order && g.getEntity(nv2.order.targetId);
  ok(nv2 && nv2.order && nv2.order.type === 'gather' && nt2 && nt2.type === 'tree' && nt2.id !== tree.id, 'full tree rally -> new villager gathers another tree instead of idling');
}

console.log('determinism');
{
  const run = () => { const { g, b, ids } = setup('pasture', 4, 12); g.cmdGather(ids, b.id); step(g, 6); g.cmdMove(ids.slice(0, 2), b.x - 10, b.z); step(g, 10); return g.hash(); };
  ok(run() === run(), 'same hash on two runs');
}

if (fails.length) { console.log('\n' + fails.length + ' FAILED'); process.exit(1); }
console.log('\nall ok');
