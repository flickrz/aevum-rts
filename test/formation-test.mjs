// Formation, engage-on-the-move, shooter reveal and spawn spreading: node test/formation-test.mjs
import { Game } from '../src/sim/game.js';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); else console.log('ok  ', m); };
const mk = () => { const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'easy', startRes: 'normal', startAge: 0, sandbox: false, seed: 11 }); g.ais.length = 0; return g; };
const step = (g, s) => { for (let i = 0; i < s * 30; i++) g.update(1 / 30); };
// open field east of player 0's start on seed 11 (the start itself is ringed by forest)
const tc = () => ({ x: 82, z: 58 });

// 1) formation: 12 mixed units end up in a wide line, not one pile
{
  const g = mk(), b = tc(g), ids = [];
  for (let i = 0; i < 12; i++) { const f = g._freeNear(b.x + 6, b.z + 6, 0); ids.push(g._addUnit(i < 6 ? 'spearman' : 'archer', 0, f.x, f.z).id); }
  const tx = b.x + 6, tz = b.z + 24;
  g.cmdMove(ids, tx, tz); step(g, 25);
  const us = ids.map(id => g.getEntity(id));
  let minD = 1e9; for (let i = 0; i < us.length; i++) for (let j = i + 1; j < us.length; j++) minD = Math.min(minD, Math.hypot(us[i].x - us[j].x, us[i].z - us[j].z));
  const xs = us.map(u => u.x), zs = us.map(u => u.z), w = Math.max(...xs) - Math.min(...xs), dep = Math.max(...zs) - Math.min(...zs);
  ok(minD > 0.5, 'units spaced out (min gap ' + minD.toFixed(2) + ')');
  ok(w > dep * 1.5, 'line is wider than deep (w ' + w.toFixed(1) + ', depth ' + dep.toFixed(1) + ')');
  const sp = us.slice(0, 6).reduce((a, u) => a + u.z, 0) / 6, ar = us.slice(6).reduce((a, u) => a + u.z, 0) / 6;
  ok(sp > ar, 'melee in front of archers (moving +z: ' + sp.toFixed(1) + ' vs ' + ar.toFixed(1) + ')');
}
// 2) an attack-moving soldier fights an enemy on the way, then resumes the trip (a human's plain move ignores it:
// test/amove-test.mjs)
{
  const g = mk(), b = tc(g);
  const f0 = g._freeNear(b.x + 6, b.z + 6, 0), me = g._addUnit('swordsman', 0, f0.x, f0.z);
  const f1 = g._freeNear(b.x + 6, b.z + 14, 1), foe = g._addUnit('spearman', 1, f1.x, f1.z); foe.hp = 5;
  g.cmdAttackMove([me.id], b.x + 6, b.z + 30);
  let engaged = false; for (let i = 0; i < 30 * 20; i++) { g.update(1 / 30); if (me.order && me.order.type === 'attack' && me.order.targetId === foe.id) engaged = true; }
  ok(engaged, 'soldier engaged the enemy on its way');
  ok(foe.dead, 'enemy killed');
  step(g, 20);
  ok(Math.hypot(me.x - (b.x + 6), me.z - (b.z + 30)) < 3, 'soldier resumed and reached its target');
}
// 3) a long-range shooter becomes visible to the victim, and the victim charges it
{
  const g = mk(), b = tc(g);
  const f0 = g._freeNear(b.x + 6, b.z + 8, 0), me = g._addUnit('spearman', 0, f0.x, f0.z); me.hp = me.maxHp = 2000;
  const f1 = g._freeNear(b.x + 6, b.z + 18, 1), cn = g._addUnit('cannon', 1, f1.x, f1.z);
  g.cmdAttack([cn.id], me.id);
  let seen = false, chased = false;
  for (let i = 0; i < 30 * 12 && !me.dead; i++) { g.update(1 / 30); if (g.isEntityVisible(cn)) seen = true; if (me.order && me.order.type === 'attack' && me.order.targetId === cn.id) chased = true; }
  ok(seen, 'cannon revealed after it fired');
  ok(chased, 'victim charges the shooter');
}
// 4) units trained to a rally point do not stack
{
  const g = mk(), p = g.players[0]; p.res.food = p.res.wood = p.res.gold = p.res.stone = 9999;
    const br = g._addBuilding('barracks', 0, 86, 62, true);
  if (!br) ok(false, 'barracks placed'); else {
    br.rally = { x: br.x, z: br.z + 12 };
    for (let i = 0; i < 6; i++) g.train(br.id, 'spearman');
    step(g, 160);
    const sp = g.units.filter(u => u.owner === 0 && u.type === 'spearman' && Math.hypot(u.x - br.x, u.z - br.z - 12) < 6);
    let minD = 1e9; for (let i = 0; i < sp.length; i++) for (let j = i + 1; j < sp.length; j++) minD = Math.min(minD, Math.hypot(sp[i].x - sp[j].x, sp[i].z - sp[j].z));
    ok(sp.length >= 4, 'trained units at rally (' + sp.length + ')');
    ok(minD > 0.5, 'rally units spread (min gap ' + minD.toFixed(2) + ')');
  }
}
// 5) idle soldiers out of sight of the fight come to help a friend under attack
{
  const g = mk(), b = tc(g);
  const fv = g._freeNear(b.x + 6, b.z + 6, 0), victim = g._addUnit('lightcav', 0, fv.x, fv.z); victim.hp = victim.maxHp = 5000;
  const fe = g._freeNear(b.x + 6, b.z + 7.5, 1), foe = g._addUnit('spearman', 1, fe.x, fe.z); foe.hp = foe.maxHp = 5000;
  const helpers = []; for (let i = 0; i < 3; i++) { const fh = g._freeNear(b.x + 6 + i, b.z + 6 + 13, 0); helpers.push(g._addUnit('lightcav', 0, fh.x, fh.z)); }
  const d0 = Math.min(...helpers.map(h => Math.hypot(h.x - foe.x, h.z - foe.z)));
  g.cmdAttack([foe.id], victim.id);
  let joined = 0; for (let i = 0; i < 30 * 8; i++) { g.update(1 / 30); joined = helpers.filter(h => h.order && h.order.type === 'attack' && h.order.targetId === foe.id).length; if (joined === 3) break; }
  ok(d0 > 10, 'helpers start out of their sight of the attacker (' + d0.toFixed(1) + ' tiles)');
  ok(joined === 3, 'idle soldiers nearby come to help (' + joined + '/3)');
  step(g, 6);
  ok(helpers.some(h => Math.hypot(h.x - foe.x, h.z - foe.z) < 2.5), 'helpers reach the attacker');
}
if (fails.length) { console.log('FAIL', fails); process.exit(1); } else console.log('ALL OK');
