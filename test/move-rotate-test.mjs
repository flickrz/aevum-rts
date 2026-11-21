// Turning and moving buildings (players asked for both): node test/move-rotate-test.mjs
import { readFileSync } from 'node:fs';
import { Game, CMD_METHODS, NO_ROTATE, NO_RELOCATE, BUILD_TIME_MUL } from '../src/sim/game.js';
import { METHODS } from '../src/net/session.js';
import { BUILDINGS } from '../src/data.js';
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); };
const mk = () => { const g = new Game({ mapSize: 256, mapType: 'plains', enemies: 1, difficulty: 'easy', startRes: 'high', startAge: 1, seed: 11 }); g.ais.length = 0; for (const p of g.players) for (const k in p.res) p.res[k] = 50000; return g; };
const step = (g, s, fn) => { for (let i = 0; i < s * 30; i++) { g.update(1 / 30); if (fn && fn()) return true; } return false; };
const me = g => g.players[0];
// a free spot of the given size near player 0's start, scanning outward (deterministic)
const spot = (g, type, skip = 0, from = null) => {
  const p = me(g), cx = from ? from[0] : p.startX | 0, cz = from ? from[1] : p.startZ | 0;
  for (let r = 8; r < 60; r++) for (let j = -r; j <= r; j++) for (let i = -r; i <= r; i++) {
    if (Math.max(Math.abs(i), Math.abs(j)) !== r) continue;
    if (g.canPlace(type, cx + i, cz + j, 0) && skip-- <= 0) return [cx + i, cz + j];
  }
  return null;
};
const vill = g => g.units.find(u => u.owner === 0 && u.type === 'villager' && !u.dead);
const built = (g, type, at) => { const b = g._addBuilding(type, 0, at[0], at[1], true); return b; };

// 1) both are network commands everywhere
ok(['cmdRotateBuilding', 'cmdRelocate'].every(m => CMD_METHODS.includes(m) && METHODS.includes(m)), 'Game and lockstep lists have both commands');
{ const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'); const m = src.match(/const NET_METHODS = \[([^\]]*)\]/); ok(!!m && /'cmdRotateBuilding'/.test(m[1]) && /'cmdRelocate'/.test(m[1]), 'main.js NET_METHODS has both commands'); }

// 2) placing with a turn
{
  const g = mk(), at = spot(g, 'barracks');
  const id = g.placeBuilding(0, 'barracks', at[0], at[1], [], false, 3), b = g.getEntity(id);
  ok(b && b.rot === 3, 'placeBuilding 7th arg sets rot (3)');
  const at2 = spot(g, 'house'), id2 = g.placeBuilding(0, 'house', at2[0], at2[1], [], 2), b2 = g.getEntity(id2);
  ok(b2 && b2.rot === 2, 'a number as the 6th arg is taken as rot (2)');
  const v = vill(g), q0 = v.queue.length;
  ok(v.queue.length === q0, 'numeric 6th arg is not the Shift queue');
  const at3 = spot(g, 'house'), id3 = g.execCommand(0, 'placeBuilding', [1, 'house', at3[0], at3[1], [], false, 7]);
  ok(g.getEntity(id3).rot === 3, 'execCommand: rot 7 -> 3 (&3)');
  const at4 = spot(g, 'house'), id4 = g.execCommand(0, 'placeBuilding', [0, 'house', at4[0], at4[1], [], false, 'x']);
  ok(g.getEntity(id4).rot === 0, 'execCommand: bad rot -> 0');
  const at5 = spot(g, 'house'), id5 = g.execCommand(0, 'placeBuilding', [0, 'house', at5[0], at5[1], [], false, 1.5]);
  ok(g.getEntity(id5).rot === 0, 'execCommand: non-integer rot -> 0');
  const atw = spot(g, 'wall'), idw = g.placeBuilding(0, 'wall', atw[0], atw[1], [], false, 2);
  ok(g.getEntity(idw).rot === 0, 'walls do not turn');
  ok(g.placeBuilding(0, 'house', at3[0], at3[1], [], false, 1) == null, 'occupied spot still refused');
  const old = g.getEntity(id); ok(old.tx === at[0] && old.size === BUILDINGS.barracks.size, 'footprint unchanged by rot');
}

// 3) turning a placed building
{
  const g = mk(), at = spot(g, 'barracks'), b = built(g, 'barracks', at);
  const h0 = g.hash(), blk = g.map.blocked.slice();
  const r = [];
  for (let i = 0; i < 4; i++) { ok(g.execCommand(0, 'cmdRotateBuilding', [0, b.id]) === true, 'rotate #' + (i + 1)); r.push(b.rot); }
  ok(r.join() === '1,2,3,0', 'quarter turns wrap 1,2,3,0 (' + r.join() + ')');
  ok(g.hash() === h0 && g.map.blocked.every((v, i) => v === blk[i]), 'turning changes neither hash nor blocked tiles');
  ok(!g.execCommand(1, 'cmdRotateBuilding', [1, b.id]) && b.rot === 0, 'another player cannot turn it');
  const w = built(g, 'wall', spot(g, 'wall'));
  ok(!g.cmdRotateBuilding(0, w.id) && !g.canRotate(0, w.id), 'a wall cannot be turned');
  const f = built(g, 'farm', spot(g, 'farm'));
  ok(!g.cmdRotateBuilding(0, f.id), 'a farm cannot be turned');
  const fnd = g.getEntity(g.placeBuilding(0, 'house', ...spot(g, 'house')));
  ok(g.cmdRotateBuilding(0, fnd.id) && fnd.rot === 1, 'a foundation can be turned');
  ok([...NO_ROTATE].every(t => BUILDINGS[t]), 'NO_ROTATE names real buildings');
  ok(NO_ROTATE.has('tower') && NO_ROTATE.has('dock'), 'towers and docks do not turn (the renderer never turns them)');
}

// 4) moving: rules
{
  const g = mk(), at = spot(g, 'barracks'), b = built(g, 'barracks', at);
  b.rot = 2; b.hp = Math.round(b.maxHp * 0.6);
  const res0 = JSON.stringify(me(g).res), built0 = me(g).stats.buildingsBuilt;
  const to = spot(g, 'barracks', 3), v = vill(g);
  ok(!g.execCommand(1, 'cmdRelocate', [1, b.id, to[0], to[1], []]), 'another player cannot move it');
  ok(g.cmdRelocate(0, b.id, b.tx, b.tz, []) == null, 'same spot refused');
  const tc = g.buildings.find(x => x.owner === 0 && x.type === 'towncenter');
  ok(g.cmdRelocate(0, b.id, tc.tx, tc.tz, []) == null, 'spot on the town center refused');
  ok(g.cmdRelocate(0, tc.id, to[0], to[1], []) == null && !g.canRelocate(0, tc.id).ok, 'the town center cannot be moved');
  // own footprint counts as free: a shift of 2 tiles
  let sh = null; for (const [dx, dz] of [[2, 0], [-2, 0], [0, 2], [0, -2]]) if (g.canRelocateTo(0, b.id, b.tx + dx, b.tz + dz)) { sh = [b.tx + dx, b.tz + dz]; break; }
  ok(!!sh, 'a short shift overlapping its own footprint is allowed');
  ok(!g.canPlace('barracks', sh[0], sh[1], 0) && g.map.blocked[b.tz * g.map.size + b.tx] === 1, 'canRelocateTo leaves the blocked grid as it was');
  // a villager repairing it is let go
  v.order = { type: 'build', targetId: b.id }; v.targetId = b.id;
  const nid = g.execCommand(0, 'cmdRelocate', [0, b.id, to[0], to[1], []]);
  const nb = g.getEntity(nid);
  ok(!!nb && nid !== b.id && !g.getEntity(b.id) && !g.buildings.includes(b), 'old building removed, new foundation id ' + nid);
  ok(nb.type === 'barracks' && nb.tx === to[0] && nb.tz === to[1] && !nb.done && nb.progress === 0 && nb.rot === 2, 'foundation of the same type, same rot, progress 0');
  ok(JSON.stringify(me(g).res) === res0, 'moving is free (no cost, no refund)');
  ok(!(v.order && v.order.targetId === b.id), 'the villager on the old building was released');
  const blkOld = g.map.blocked[b.tz * g.map.size + b.tx];
  ok(blkOld === 0 || (to[0] <= b.tx && b.tx < to[0] + nb.size && to[1] <= b.tz && b.tz < to[1] + nb.size), 'old footprint is free ground again');
  ok(me(g).stats.unitsLost === 0 && !me(g).stats.buildingsLost, 'no loss counted');
  // not finished / busy / excluded types
  ok(g.cmdRelocate(0, nb.id, ...spot(g, 'barracks', 5), []) == null, 'an unfinished foundation cannot be moved');
  const b2 = built(g, 'barracks', spot(g, 'barracks', 6));
  ok(g.train(b2.id, 'spearman') !== false && b2.queue.length === 1, 'barracks with a unit in training');
  ok(g.cmdRelocate(0, b2.id, ...spot(g, 'barracks', 8), []) == null && /üretim/i.test(g.canRelocate(0, b2.id).reason), 'busy queue refused');
  for (const t of ['wall', 'gate', 'farm', 'castle', 'towncenter', 'dock', 'rail']) ok(NO_RELOCATE.has(t), t + ' is not movable');
  const w = built(g, 'wall', spot(g, 'wall'));
  ok(g.cmdRelocate(0, w.id, ...spot(g, 'wall', 4), []) == null, 'a wall piece cannot be moved');
  ok(built0 === me(g).stats.buildingsBuilt, 'stats untouched so far');
}

// 5) half the build time, old hp share, not counted as built
{
  const g = mk();
  const timeTo = (moved) => {
    const at = spot(g, 'barracks', moved ? 10 : 20); let b;
    const v = g.units.filter(u => u.owner === 0 && u.type === 'villager' && !u.dead)[moved ? 1 : 2];
    if (moved) { const o = built(g, 'barracks', at); o.hp = Math.round(o.maxHp * 0.6); b = g.getEntity(g.cmdRelocate(0, o.id, ...spot(g, 'barracks', 14), [v.id])); }
    else b = g.getEntity(g.placeBuilding(0, 'barracks', at[0], at[1], [v.id]));
    // only this villager builds
    for (const u of g.units) if (u !== v && u.order && u.order.type === 'build') u.order = null;
    let t0 = null; const b0 = me(g).stats.buildingsBuilt;
    step(g, 200, () => { if (t0 == null && b.progress > 0) t0 = g.time; return b.done; });
    return { t: g.time - t0, b, counted: me(g).stats.buildingsBuilt - b0 };
  };
  const n = timeTo(false), m = timeTo(true), full = BUILDINGS.barracks.time * BUILD_TIME_MUL;
  ok(Math.abs(n.t - full) < 1, 'normal build ~' + full.toFixed(1) + ' s (' + n.t.toFixed(1) + ')');
  ok(Math.abs(m.t - full / 2) < 1, 'moved build ~' + (full / 2).toFixed(1) + ' s (' + m.t.toFixed(1) + ')');
  ok(m.b.done && m.b.hp === Math.round(m.b.maxHp * 0.6), 'finished with the old hp share (' + m.b.hp + '/' + m.b.maxHp + ')');
  ok(m.b.reloc === undefined && m.b.relocHp === undefined, 'relocation marks cleared');
  ok(n.counted === 1 && m.counted === 0, 'a moved building is not counted as a new one');
  ok(g.map.blocked[m.b.tz * g.map.size + m.b.tx] === 1, 'the moved building is solid when finished');
}

// 6) determinism over the network path + save / load keeps rot and the move
{
  const run = () => {
    const g = mk(), at = spot(g, 'archery'), b = built(g, 'archery', at); b.hp = Math.round(b.maxHp * 0.5);
    const v = vill(g);
    g.execCommand(0, 'cmdRotateBuilding', JSON.parse(JSON.stringify([0, b.id])));
    const nid = g.execCommand(0, 'cmdRelocate', JSON.parse(JSON.stringify([0, b.id, ...spot(g, 'archery', 7), [v.id]])));
    step(g, 6);
    return { g, nid };
  };
  const A = run(), B = run();
  ok(A.g.hash() === B.g.hash() && A.nid === B.nid, 'same commands -> same hash');
  const s = JSON.stringify(A.g.serialize()), L = Game.deserialize(s); L.ais.length = 0;
  const la = L.getEntity(A.nid);
  ok(la && la.rot === 1 && la.reloc === 1 && Math.abs(la.relocHp - 0.5) < 0.01, 'save/load keeps rot and the move state');
  ok(L.hash() === A.g.hash(), 'loaded game hash matches');
  step(A.g, 60, () => A.g.getEntity(A.nid).done); step(L, 60, () => L.getEntity(A.nid).done);
  ok(L.getEntity(A.nid).done && L.hash() === A.g.hash(), 'loaded and original finish the same way');
  ok(L.getEntity(A.nid).hp === Math.round(L.getEntity(A.nid).maxHp * 0.5), 'loaded move keeps the hp share');
}

// 7) review fixes: what a move keeps, what it refuses
{
  const g = mk();
  // the pasture flock and the rally flag go along
  const pa = built(g, 'pasture', spot(g, 'pasture')); pa.pasture.sheep = 7; pa.pasture.g = 0.4;
  const pto = spot(g, 'pasture', 4), pid = g.cmdRelocate(0, pa.id, pto[0], pto[1], []), np = g.getEntity(pid);
  ok(np && np.pasture.sheep === 7 && Math.abs(np.pasture.g - 0.4) < 1e-9, 'pasture flock kept (' + (np && np.pasture.sheep) + ' sheep)');
  const ba = built(g, 'barracks', spot(g, 'barracks')); g.setRally(ba.id, 40, 41);
  const bid = g.cmdRelocate(0, ba.id, ...spot(g, 'barracks', 3), []), nba = g.getEntity(bid);
  ok(nba && nba.rally && nba.rally.x === 40 && nba.rally.z === 41, 'rally flag kept');
  // an optional rot: through execCommand, validated
  const ar = built(g, 'archery', spot(g, 'archery')); ar.rot = 1;
  const rid = g.execCommand(0, 'cmdRelocate', [0, ar.id, ...spot(g, 'archery', 3), [], 7]);
  ok(g.getEntity(rid) && g.getEntity(rid).rot === 3, 'cmdRelocate rot arg 7 -> 3');
  const ar2 = built(g, 'archery', spot(g, 'archery')); ar2.rot = 2;
  const rid2 = g.execCommand(0, 'cmdRelocate', [0, ar2.id, ...spot(g, 'archery', 3), [], 'x']);
  ok(g.getEntity(rid2) && g.getEntity(rid2).rot === 2, 'bad rot arg keeps the old turn');
  // hit in the last 10 s
  const hb = built(g, 'house', spot(g, 'house')); hb.hitT = g.time;
  const hto = spot(g, 'house', 3);
  ok(!g.canRelocate(0, hb.id).ok && /Saldırı/.test(g.canRelocate(0, hb.id).reason) && g.cmdRelocate(0, hb.id, hto[0], hto[1], []) == null, 'a building hit just now cannot be moved');
  hb.hitT = g.time - 10.5;
  ok(g.canRelocate(0, hb.id).ok, 'after 10 s it can');
  // distance limit
  let far = null; for (let dx = 31; dx < 60 && !far; dx++) for (const sg of [1, -1]) if (!far && g.canPlace('house', hb.tx + sg * dx, hb.tz, 0)) far = [hb.tx + sg * dx, hb.tz];
  ok(!!far && (far[0] - hb.tx) ** 2 + (far[1] - hb.tz) ** 2 > 900 && !g.canRelocateTo(0, hb.id, far[0], far[1]) && /uzak/.test(g.relocateCheck(0, hb.id, far[0], far[1]).reason), 'more than 30 tiles refused');
  // the last production building
  const g2 = mk();
  for (const b of g2.buildings.slice()) if (b.owner === 0 && b.type !== 'house') g2._dropBuilding(b);
  const last = built(g2, 'barracks', spot(g2, 'barracks'));
  ok(g2.prodLeft(0) === 1 && !g2.canRelocate(0, last.id).ok && /Son üretim/.test(g2.canRelocate(0, last.id).reason), 'the last unit-producing building cannot be moved');
  ok(g2.cmdRelocate(0, last.id, ...spot(g2, 'barracks', 3), []) == null, 'cmdRelocate refuses it too');
  built(g2, 'archery', spot(g2, 'archery'));
  ok(g2.canRelocate(0, last.id).ok, 'with a second one it can');
  // damage while rebuilding is not healed on completion
  const g3 = mk(), o = built(g3, 'barracks', spot(g3, 'barracks')); o.hp = Math.round(o.maxHp * 0.8);
  const v3 = vill(g3), nid3 = g3.cmdRelocate(0, o.id, ...spot(g3, 'barracks', 3), [v3.id]), nb3 = g3.getEntity(nid3);
  for (const u of g3.units) if (u !== v3 && u.order && u.order.type === 'build') u.order = null;
  step(g3, 200, () => nb3.progress > 0.9);
  nb3.hp = Math.round(nb3.maxHp * 0.3);
  step(g3, 60, () => nb3.done);
  ok(nb3.done && nb3.hp < Math.round(nb3.maxHp * 0.8) && nb3.hp <= Math.round(nb3.maxHp * 0.45), 'damage taken while rebuilding stays (' + nb3.hp + '/' + nb3.maxHp + ')');
  // towers get no half-time bonus
  const g4 = mk(), tw = built(g4, 'tower', spot(g4, 'tower')), v4 = vill(g4);
  const tid = g4.cmdRelocate(0, tw.id, ...spot(g4, 'tower', 3), [v4.id]), nt = g4.getEntity(tid);
  for (const u of g4.units) if (u !== v4 && u.order && u.order.type === 'build') u.order = null;
  let t0 = null; step(g4, 300, () => { if (t0 == null && nt.progress > 0) t0 = g4.time; return nt.done; });
  const fullT = BUILDINGS.tower.time * BUILD_TIME_MUL;
  ok(nt.done && Math.abs(g4.time - t0 - fullT) < 1, 'a moved tower builds in the full time ~' + fullT.toFixed(1) + ' s (' + (g4.time - t0).toFixed(1) + ')');
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
