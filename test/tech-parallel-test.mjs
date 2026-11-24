// Research spreads over buildings of the same type (player report 2026-11-24: "3 banks, all upgrades queue on one
// bank"). A busy building hands a new tech to the idle / least busy one of its type (lowest id on a tie); the same
// tech cannot be researched twice. node test/tech-parallel-test.mjs
import { Game } from '../src/sim/game.js';

const fails = [];
const ok = (c, m) => { if (!c) { fails.push(m); console.log('  FAIL', m); } else console.log('  ok ', m); return !!c; };

const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed: 11 }); g.ais.length = 0;
const p = g.players[0];
p.age = 3; for (const k of Object.keys(p.res)) p.res[k] = 1e6;
const banks = [];
for (let r = 8; r < 60 && banks.length < 3; r++) for (let dz = -r; dz <= r && banks.length < 3; dz += 6) for (let dx = -r; dx <= r && banks.length < 3; dx += 6) {
  const tx = Math.floor(p.startX) + dx, tz = Math.floor(p.startZ) + dz;
  if (g.canPlace('bank', tx, tz, 0)) { const b = g._addBuilding('bank', 0, tx, tz, true); g._complete(b); banks.push(b); }
}
ok(banks.length === 3, 'three banks built');
const techs = ['banking', 'guilds', 'centralbank'].filter(t => g.isUnlocked(0, 'tech', t));
ok(techs.length >= 2, 'at least two bank techs unlocked (' + techs.join(',') + ')');
const first = banks[0];
for (const t of techs) ok(g.research(first.id, t), 'research ' + t + ' via the first bank');
ok(banks.every((b, i) => b.queue.length === (i < techs.length ? 1 : 0)), 'each tech on its own bank (' + banks.map(b => b.queue.length).join(',') + ')');
ok(!g.research(first.id, techs[0]) && !g.research(banks[2].id, techs[0]), 'the same tech is not started twice');
const n = banks.reduce((s, b) => s + b.queue.filter(q => q.id === techs[0]).length, 0);
ok(n === 1, 'tech queued exactly once (' + n + ')');

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
