// Aevum - network command arguments Game.execCommand must refuse or clean (a hostile client's lockstep commands).
// Run: node test/cmd-guard-test.mjs
import { Game } from '../src/sim/game.js';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } return !!c; };

const g = new Game({ mapSize: 256, mapType: 'plains', enemies: 1, difficulty: 'easy', startAge: 0, sandbox: false, seed: 11 });
g.ais.length = 0;
const tc = g.buildingsOf(0).find(b => b.type === 'towncenter'), v = g.unitsOf(0).find(u => u.type === 'villager');

console.log('Repeated ids');
g.execCommand(0, 'cmdMove', [[v.id], v.x + 3, v.z, false]);
g.execCommand(0, 'cmdMove', [new Array(5000).fill(v.id), v.x + 6, v.z, true]);
ok(v.queue.length === 1, 'a unit id sent 5000 times queues one order (' + v.queue.length + ')');
const t0 = Date.now();
g.execCommand(0, 'cmdBuild', [new Array(100000).fill(v.id), tc.id, true]);
ok(v.queue.length <= 2 && Date.now() - t0 < 500, 'a huge repeated builder list is cheap (' + v.queue.length + ' queued, ' + (Date.now() - t0) + ' ms)');

console.log('Names that only exist on Object.prototype');
const nb = g.buildings.length, nr = { ...g.players[0].res };
for (const name of ['constructor', '__proto__', 'toString', 'hasOwnProperty', 'valueOf']) {
  ok(g.execCommand(0, 'placeBuilding', [0, name, (tc.x | 0) + 12, (tc.z | 0) + 12, [v.id], false]) === false, 'placeBuilding ' + name + ' refused');
  ok(g.execCommand(0, 'placeLine', [0, name, [[(tc.x | 0) + 14, (tc.z | 0) + 14]], [v.id], false]) === false, 'placeLine ' + name + ' refused');
  ok(g.execCommand(0, 'train', [tc.id, name]) === false && g.execCommand(0, 'research', [tc.id, name]) === false, 'train / research ' + name + ' refused');
  ok(g.execCommand(0, 'trade', [0, name, 'gold']) === false && g.execCommand(0, 'trade', [0, 'wood', name]) === false, 'trade ' + name + ' refused');
}
ok(g.execCommand(0, 'placeBuilding', [0, { x: 1 }, 10, 10, [], false]) === false && g.execCommand(0, 'train', [tc.id, ['villager']]) === false, 'non-string type names refused');
ok(g.buildings.length === nb, 'no building was created (' + (g.buildings.length - nb) + ')');
ok(g.buildings.every(b => Number.isFinite(b.x) && Number.isFinite(b.hp)), 'no building with NaN fields');
ok(Object.keys(nr).every(k => g.players[0].res[k] === nr[k]), 'resources untouched');

console.log('Queue indexes');
g.players[0].res.food = 1000;
g.execCommand(0, 'train', [tc.id, 'villager']); g.execCommand(0, 'train', [tc.id, 'villager']);
const q = tc.queue.length, food = g.players[0].res.food;
for (const bad of ['length', 'constructor', '0', 0.5, null, NaN, -1, undefined]) g.execCommand(0, 'cancelQueue', [tc.id, bad]);
ok(q === 2 && tc.queue.length === q && g.players[0].res.food === food, 'a non-integer / negative index cancels nothing (' + tc.queue.length + '/' + q + ')');
ok(g.execCommand(0, 'cancelQueue', [tc.id, q - 1]) && tc.queue.length === q - 1 && g.players[0].res.food > food, 'a real index still cancels and refunds');
g.execCommand(0, 'train', [tc.id, 'villager']);
ok(g.execCommand(0, 'cancelQueue', [tc.id, 9, 'villager']) && tc.queue.length === q - 1, 'cancel by id (index moved) still works');

console.log('Honest commands');
const n0 = g.buildings.length;
let placed = false;
for (let r = 6; r < 16 && !placed; r++) for (let k = 0; k < 16 && !placed; k++) {
  const tx = Math.round(tc.x + Math.cos(k / 16 * 6.283) * r), tz = Math.round(tc.z + Math.sin(k / 16 * 6.283) * r);
  if (g.canPlace('house', tx, tz, 0)) placed = !!g.execCommand(0, 'placeBuilding', [0, 'house', tx, tz, [v.id], false]);
}
ok(placed && g.buildings.length === n0 + 1, 'a house is still placed');
ok(g.isUnlocked(0, 'building', 'house') && g.isUnlocked(0, 'unit', 'villager'), 'real types still unlock');
for (let i = 0; i < 300; i++) g.update(1 / 30);
ok(Number.isFinite(g.hash()), 'the game runs on');

console.log(failed ? failed + ' FAILED' : 'ALL OK');
process.exit(failed ? 1 : 0);
