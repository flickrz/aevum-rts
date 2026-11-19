// Network command arguments that must be refused or cleaned by Game.execCommand. node test/cmd-guard-test.mjs
import { Game } from '../src/sim/game.js';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } return !!c; };

const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed: 11 });
g.ais.length = 0;
const tc = g.buildingsOf(0).find(b => b.type === 'towncenter'), v = g.unitsOf(0).find(u => u.type === 'villager');

// one id repeated: the order is queued once, not once per copy
g.execCommand(0, 'cmdMove', [[v.id], v.x + 3, v.z, false]);
g.execCommand(0, 'cmdMove', [new Array(5000).fill(v.id), v.x + 6, v.z, true]);
ok(v.queue.length === 1, 'a repeated unit id queues one order (' + v.queue.length + ')');
const t0 = Date.now();
g.execCommand(0, 'cmdBuild', [new Array(8000).fill(v.id), tc.id, true]);
ok(v.queue.length <= 2 && Date.now() - t0 < 500, 'a repeated builder id is cheap (' + v.queue.length + ' queued, ' + (Date.now() - t0) + ' ms)');

// names that only exist on Object.prototype are not buildings / units / techs
const nb = g.buildings.length;
for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
  g.execCommand(0, 'placeBuilding', [0, name, (tc.x | 0) + 12, (tc.z | 0) + 12, [v.id], false]);
  g.execCommand(0, 'placeLine', [0, name, [[(tc.x | 0) + 14, (tc.z | 0) + 14]], [v.id], false]);
  ok(!g.isUnlocked(0, 'building', name) && !g.isUnlocked(0, 'unit', name) && !g.isUnlocked(0, 'tech', name) && !g.canPlace(name, 5, 5, 0), name + ' is not a type');
}
ok(g.buildings.length === nb, 'no building was created (' + (g.buildings.length - nb) + ')');
ok(g.buildings.every(b => Number.isFinite(b.x) && Number.isFinite(b.hp)), 'no building with NaN fields');
ok(g.isUnlocked(0, 'building', 'house') && g.isUnlocked(0, 'unit', 'villager'), 'real types still unlock');

// cancelQueue takes a queue index only
g.players[0].res.food = 1000;
g.execCommand(0, 'train', [tc.id, 'villager']); g.execCommand(0, 'train', [tc.id, 'villager']);
const q = tc.queue.length;
for (const bad of ['length', 'constructor', '0', 0.5, null, NaN]) g.execCommand(0, 'cancelQueue', [tc.id, bad]);
ok(q > 0 && tc.queue.length === q, 'a non-integer queue index cancels nothing (' + tc.queue.length + '/' + q + ')');
g.execCommand(0, 'cancelQueue', [tc.id, q - 1]);
ok(tc.queue.length === q - 1, 'a real index still cancels');

for (let i = 0; i < 300; i++) g.update(1 / 30);
ok(true, 'the game runs on');
console.log(failed ? failed + ' FAILED' : 'ALL OK');
process.exit(failed ? 1 : 0);
