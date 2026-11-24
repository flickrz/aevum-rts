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
// 1b) right-drag facing (BFME-style): moving +z but facing +x through the command path, the line runs along z
// with the melee ranks on the +x side; a bad facing arg is dropped (plain move)
{
  const g = mk(), b = tc(g), ids = [];
  for (let i = 0; i < 12; i++) { const f = g._freeNear(b.x + 6, b.z + 6, 0); ids.push(g._addUnit(i < 6 ? 'spearman' : 'archer', 0, f.x, f.z).id); }
  const tx = b.x + 6, tz = b.z + 24;
  ok(g.execCommand(0, 'cmdMove', [ids, tx, tz, false, 'pat', [5, 0]]), 'facing move accepted');
  ok(ids.every(id => !g.getEntity(id).order.am), 'mode arg stays internal');
  step(g, 25);
  const us = ids.map(id => g.getEntity(id));
  const xs = us.map(u => u.x), zs = us.map(u => u.z), w = Math.max(...zs) - Math.min(...zs), dep = Math.max(...xs) - Math.min(...xs);
  ok(w > dep * 1.5, 'faced line runs across the drag (along z ' + w.toFixed(1) + ', depth ' + dep.toFixed(1) + ')');
  const sp = us.slice(0, 6).reduce((a, u) => a + u.x, 0) / 6, ar = us.slice(6).reduce((a, u) => a + u.x, 0) / 6;
  ok(sp > ar, 'melee in front along the facing (+x: ' + sp.toFixed(1) + ' vs ' + ar.toFixed(1) + ')');
  ok(g.execCommand(0, 'cmdMove', [ids, tx, tz, false, null, ['x', 0]]), 'bad facing dropped, plain move');
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
// 6) a rally flag on a resource, a drop-off camp or a farm puts the new villager straight to work
{
  const g = mk(), p = g.players[0]; p.res.food = p.res.wood = p.res.gold = p.res.stone = 9999;
  const tcB = g.buildings.find(b => b.owner === 0 && b.type === 'towncenter');
  const near = (pred) => { let best = null, bd = 1e9; for (const e of g.entities.values()) if (e.kind === 'resource' && !e.dead && pred(e)) { const d = Math.hypot(e.x - tcB.x, e.z - tcB.z); if (d < bd) { bd = d; best = e; } } return best; };
  // place a building on free ground as close as possible to a spot
  const placeNear = (type, x, z) => { for (let r = 1; r < 14; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) { if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue; const tx = (x | 0) + dx, tz = (z | 0) + dz; if (g.canPlace(type, tx, tz, 0)) return g._addBuilding(type, 0, tx, tz, true); } return null; };
  const trainOne = () => { const n0 = g.units.length; g.train(tcB.id, 'villager'); for (let i = 0; i < 30 * 60 && g.units.length === n0; i++) g.update(1 / 30); g.update(1 / 30); return g.units[g.units.length - 1]; };
  const tree = near(e => e.type === 'tree'), mine = near(e => e.type === 'gold' || e.type === 'stone');
  const cases = [['tree', tree.id, 'wood']];
  const lc = placeNear('lumbercamp', tree.x, tree.z); if (lc) cases.push(['lumber camp', lc.id, 'wood']); else ok(false, 'lumber camp placed');
  const mc = placeNear('minecamp', mine.x, mine.z); if (mc) cases.push(['mining camp', mc.id, mine.type]); else ok(false, 'mining camp placed');
  const fm = placeNear('farm', tcB.x + 10, tcB.z + 10); if (fm) cases.push(['farm', fm.id, 'food']); else ok(false, 'farm placed');
  for (const [name, tid, res] of cases) {
    const t = g.getEntity(tid); g.setRally(tcB.id, t.x, t.z, tid);
    const v = trainOne(), o = v && v.order;
    ok(v && v.type === 'villager' && o && o.type === 'gather' && o.res === res,
      'rally on ' + name + ' -> new villager gathers ' + res + ' (' + (o ? o.type + '/' + o.res : 'no order') + ')');
  }
}
if (fails.length) { console.log('FAIL', fails); process.exit(1); } else console.log('ALL OK');
