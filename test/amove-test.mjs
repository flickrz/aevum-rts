// Attack-move and patrol: node test/amove-test.mjs
// (a plain move already fights enemy UNITS on the way, see formation-test 2; what attack-move adds is the idle
// soldier's scan, so the enemy on the route here is a building, which a plain move walks past)
import { Game, CMD_METHODS } from '../src/sim/game.js';
import { METHODS } from '../src/net/session.js';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('ok  ', m); };
const mk = () => { const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'easy', startRes: 'normal', startAge: 0, sandbox: false, seed: 11 }); g.ais.length = 0; return g; };
const step = (g, s) => { for (let i = 0; i < s * 30; i++) g.update(1 / 30); };
// open field east of player 0's start on seed 11 (same as formation-test); the route runs +z along x 88
const A = { x: 88, z: 64 }, B = { x: 88, z: 88 };
const house = (g) => { const h = g._addBuilding('house', 1, 90, 74, true); if (h) h.hp = 20; return h; };
const unit = (g, type, x, z) => { const f = g._freeNear(x, z, 0); return g._addUnit(type, 0, f.x, f.z); };
const near = (u, p, r) => Math.hypot(u.x - p.x, u.z - p.z) < r;
// a patrol's turns: the leg's goal changes while the order stays the same patrol
const turns = (g, us, s) => { const n = us.map(() => []), last = us.map(u => u.order && u.order.z); for (let i = 0; i < s * 30; i++) { g.update(1 / 30); us.forEach((u, k) => { const o = u.order; if (o && o.pat && o.z !== last[k]) { if (last[k] != null) n[k].push({ x: u.x, z: u.z }); last[k] = o.z; } }); } return n; };

ok(['cmdAttackMove', 'cmdPatrol'].every(m => CMD_METHODS.includes(m) && METHODS.includes(m)), 'both are network commands (Game and lockstep lists)');
// 1) plain move walks past an enemy building; attack-move fights it, then reaches its goal
{
  const g = mk(), h = house(g), me = unit(g, 'swordsman', A.x, A.z);
  ok(!!h, 'enemy house placed beside the route');
  g.cmdMove([me.id], B.x, B.z);
  let hit = false; for (let i = 0; i < 30 * 25; i++) { g.update(1 / 30); if (me.order && me.order.type === 'attack' && me.order.targetId === h.id) hit = true; }
  ok(!hit && !h.dead && h.hp === 20, 'plain move leaves the house alone');
  ok(near(me, B, 3), 'plain move reached its goal');
}
{
  const g = mk(), h = house(g), me = unit(g, 'swordsman', A.x, A.z);
  ok(g.cmdAttackMove([me.id], B.x, B.z) && me.order.am === 1 && !me.order.pat, 'attack-move order set');
  let hit = false; for (let i = 0; i < 30 * 25; i++) { g.update(1 / 30); if (me.order && me.order.type === 'attack' && me.order.auto && me.order.targetId === h.id) hit = true; }
  ok(hit, 'attack-move engaged the house on its way');
  ok(h.dead, 'house destroyed');
  step(g, 15);
  ok(near(me, B, 3) && !me.order, 'attack-move resumed and reached its goal');
}
// 2) a group (flow-field move, shared group order) attack-moves past the house: it is razed, all arrive
{
  const g = mk(), h = house(g), us = []; for (let i = 0; i < 8; i++) us.push(unit(g, i < 4 ? 'spearman' : 'archer', A.x - 2 + (i % 4), A.z - (i >> 2)));
  g.cmdAttackMove(us.map(u => u.id), B.x, B.z);
  ok(us.every(u => u.order.am === 1 && u.order.grp && u.order.grp === us[0].order.grp), 'group attack-move shares one group order');
  step(g, 45);
  ok(h.dead, 'group razed the house');
  ok(us.every(u => near(u, B, 6)), 'group reached its goal (' + us.filter(u => near(u, B, 6)).length + '/8)');
}
// 3) stances: a holding soldier only fights what is in its reach, so it walks past the house
{
  const g = mk(), h = house(g), me = unit(g, 'swordsman', A.x, A.z);
  g.cmdStance([me.id], 'hold'); g.cmdAttackMove([me.id], B.x, B.z); step(g, 25);
  ok(!h.dead && h.hp === 20 && near(me, B, 3), 'hold stance: attack-move walks past a building out of reach');
}
// 4) civilians just move
{
  const g = mk(), h = house(g), v = unit(g, 'villager', A.x, A.z);
  ok(g.cmdAttackMove([v.id], B.x, B.z) && v.order.type === 'move' && !v.order.am, 'villager gets a plain move');
  step(g, 30);
  ok(near(v, B, 3) && !h.dead && h.hp === 20, 'villager walked to the goal without fighting');
  const c = unit(g, 'villager', A.x, A.z);
  ok(g.cmdPatrol([c.id], B.x, B.z) && !c.order.pat, 'villager given patrol gets a plain move');
  // (marks only: ships are not on water here)
  const ts = ['tradecart', 'fishboat', 'transport', 'galley'].map(t => unit(g, t, A.x + 4, A.z));
  g.cmdAttackMove(ts.map(u => u.id), B.x, B.z);
  ok(ts.every(u => u.order && u.order.type === 'move' && !!u.order.am === (u.type === 'galley')), 'cart, fishing boat and transport get a plain move, a warship attack-moves');
}
// 4b) a ram attack-moving hits the building on its way (a plain move never does)
{
  const g = mk(), h = house(g), r = unit(g, 'ram', A.x, A.z);
  g.cmdAttackMove([r.id], B.x, B.z);
  let hit = false; for (let i = 0; i < 30 * 30; i++) { g.update(1 / 30); if (r.order && r.order.type === 'attack' && r.order.targetId === h.id) hit = true; }
  ok(hit && h.dead, 'ram attack-move razed the house');
}
// 4c) a building given up as out of reach is passed by instead of being tried again and again
{
  const g = mk(), h = house(g), me = unit(g, 'swordsman', A.x, A.z);
  h.nh0 = 1e9; g.cmdAttackMove([me.id], B.x, B.z); step(g, 25);
  ok(!h.dead && h.hp === 20 && near(me, B, 3), 'attack-move walks past a building marked out of reach');
}
// 5) patrol: turns round at both ends, again and again
{
  const g = mk(), me = unit(g, 'spearman', A.x, A.z), start = { x: me.x, z: me.z };
  ok(g.cmdPatrol([me.id], B.x, B.z) && me.order.pat === 1 && me.order.am === 1, 'patrol order set');
  const t = turns(g, [me], 70)[0];
  ok(t.length >= 3, 'patrol turned ' + t.length + ' times in 70 s');
  ok(t.length >= 2 && near(t[0], B, 2) && near(t[1], start, 2), 'first turn at the target, second where it started');
  ok(me.order && me.order.pat && !me.queue.length, 'still patrolling');
  const z = unit(g, 'spearman', A.x + 6, A.z); g.cmdPatrol([z.id], z.x, z.z); step(g, 1);
  ok(!z.order, 'a patrol to where the unit stands ends at once');
}
// 5b) a fight on the way does not end the patrol
{
  const g = mk(), me = unit(g, 'swordsman', A.x, A.z), f = g._freeNear(A.x, A.z + 10, 1), foe = g._addUnit('spearman', 1, f.x, f.z); foe.hp = 5;
  g.cmdPatrol([me.id], B.x, B.z);
  let fought = false; for (let i = 0; i < 30 * 15; i++) { g.update(1 / 30); if (me.order && me.order.type === 'attack' && me.order.targetId === foe.id) fought = true; }
  ok(fought && foe.dead, 'patrolling soldier fought the enemy on its route');
  ok(turns(g, [me], 40)[0].length >= 2 && me.order && me.order.pat, 'and went on patrolling');
}
// 6) a patrol is open-ended: a shift-queued order ends it now (like gathering)
{
  const g = mk(), me = unit(g, 'spearman', A.x, A.z);
  g.cmdPatrol([me.id], B.x, B.z); step(g, 2);
  g.cmdMove([me.id], A.x + 6, A.z, true);
  ok(me.order && me.order.type === 'move' && !me.order.pat && me.order.x > A.x + 4 && !me.queue.length, 'shift-queued move replaces the patrol at once');
  const q = unit(g, 'spearman', A.x, A.z + 2);
  g.cmdMove([q.id], B.x, B.z); g.cmdPatrol([q.id], A.x, A.z + 2, true); g.cmdMove([q.id], A.x + 6, A.z, true);
  ok(q.order && !q.order.pat && q.queue.length === 1 && !q.queue[0].pat, 'a queued patrol is dropped when more is queued behind it');
}
// 7) the lockstep path: own units only
{
  const g = mk(), me = unit(g, 'spearman', A.x, A.z);
  ok(!g.execCommand(1, 'cmdPatrol', [[me.id], B.x, B.z, false]) && !me.order, 'another player cannot order my units');
  ok(g.execCommand(0, 'cmdPatrol', [[me.id], B.x, B.z, false]) && me.order.pat === 1, 'cmdPatrol through execCommand');
  ok(!g.execCommand(0, 'cmdAttackMove', [[me.id], 'x', B.z, false]), 'bad coordinates refused');
}
// 8) save / load mid-leg (group patrol: the shared group order is saved and joined again) keeps the patrol going
{
  const g = mk(), us = []; for (let i = 0; i < 6; i++) us.push(unit(g, 'spearman', A.x - 2 + (i % 3), A.z - (i / 3 | 0)));
  g.cmdPatrol(us.map(u => u.id), B.x, B.z); step(g, 4);
  const g2 = Game.deserialize(JSON.parse(JSON.stringify(g.serialize()))); g2.ais.length = 0;
  const vs = us.map(u => g2.getEntity(u.id));
  ok(vs.every(v => v && v.order && v.order.pat === 1 && v.order.px != null), 'patrol orders loaded');
  ok(vs.every(v => v.order.grp && v.order.grp === vs[0].order.grp), 'loaded group order is shared again');
  const t = turns(g2, vs, 70);
  ok(t.every(x => x.length >= 2), 'loaded units turn at both ends (' + t.map(x => x.length).join(',') + ')');
  step(g, 70);
  ok(g.hash() === g2.hash(), 'loaded game runs on exactly like the original');
}
if (fails.length) { console.log('FAIL', fails); process.exit(1); } else console.log('ALL OK');
