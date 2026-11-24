// Aevum - the end-of-game graph recorder (src/sim/history.js): samples every HIST_STEP s, the same on two runs of
// the same seed (multiplayer clients), not part of hash(), kept through a save.
import assert from 'node:assert/strict';
import { Game } from '../src/sim/game.js';
import { HIST_STEP, HIST_KEYS, playerScore } from '../src/sim/history.js';

const cfg = { mapSize: 256, enemies: 1, difficulty: 'hard', startRes: 'normal', startAge: 0, sandbox: false, seed: 11 };
const run = (sec) => { const g = new Game(cfg); for (let i = 0; i < sec * 20; i++) g.update(0.05); return g; };
const a = run(200), b = run(200);
assert.ok(a.history.length >= Math.floor(190 / HIST_STEP), 'samples: ' + a.history.length);
for (let i = 1; i < a.history.length; i++) assert.ok(a.history[i].t - a.history[i - 1].t >= HIST_STEP - 1);
for (const s of a.history) { assert.equal(s.v.length, 2); for (const v of s.v) assert.equal(v.length, HIST_KEYS.length); }
assert.deepEqual(a.history, b.history, 'same seed, same graph');
const last = a.history[a.history.length - 1];
assert.ok(last.v[1][HIST_KEYS.indexOf('eco')] > 0, 'the AI gathered something');
assert.ok(last.v[0][0] <= playerScore(a.players[0]));
// not in the hash
const h = a.hash(); a.history.push({ t: 9999, v: [] }); assert.equal(a.hash(), h); a.history.pop();
// kept through a save
const c = Game.deserialize(JSON.parse(JSON.stringify(a.serialize())));
assert.deepEqual(c.history, a.history);
console.log('history-test OK', a.history.length, 'samples');
