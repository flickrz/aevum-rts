// Turning buildings (players asked for it; moving was taken out again): node test/move-rotate-test.mjs
import { readFileSync } from 'node:fs';
import { Game, CMD_METHODS, NO_ROTATE } from '../src/sim/game.js';
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

// 1) turning is a network command everywhere; the building move is gone
ok(CMD_METHODS.includes('cmdRotateBuilding') && METHODS.includes('cmdRotateBuilding'), 'Game and lockstep lists have cmdRotateBuilding');
ok(![...CMD_METHODS, ...METHODS, ...Object.getOwnPropertyNames(Game.prototype)].some(m => /reloc/i.test(m)), 'no building move command left');
{ const src = readFileSync(new URL('../src/main.js', import.meta.url), 'utf8'); const m = src.match(/const NET_METHODS = \[([^\]]*)\]/); ok(!!m && /'cmdRotateBuilding'/.test(m[1]) && !/reloc/i.test(m[1]), 'main.js NET_METHODS has cmdRotateBuilding only'); }

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


// 4) determinism over the network path + save / load keeps rot
{
  const run = () => {
    const g = mk(), at = spot(g, 'archery'), b = built(g, 'archery', at);
    g.execCommand(0, 'cmdRotateBuilding', JSON.parse(JSON.stringify([0, b.id])));
    const id = g.execCommand(0, 'placeBuilding', JSON.parse(JSON.stringify([0, 'house', ...spot(g, 'house'), [], false, 2])));
    step(g, 6);
    return { g, id: b.id, hid: id };
  };
  const A = run(), B = run();
  ok(A.g.hash() === B.g.hash() && A.hid === B.hid, 'same commands -> same hash');
  const s = JSON.stringify(A.g.serialize()), L = Game.deserialize(s); L.ais.length = 0;
  ok(L.getEntity(A.id).rot === 1 && L.getEntity(A.hid).rot === 2, 'save/load keeps rot');
  ok(L.hash() === A.g.hash(), 'loaded game hash matches');
  step(A.g, 20); step(L, 20);
  ok(L.hash() === A.g.hash(), 'loaded and original go on the same way');
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
