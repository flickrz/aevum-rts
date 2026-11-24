// AI town walls are one connected ring (owner 2026-11-24: "the enemy AI doesn't know how to connect walls"):
// node test/ai-wall-ring-test.mjs [minutes]. A hard AI (seed 3, 256 map) fences its town; stretches next to mines,
// berries and own buildings (and pieces that would shut something in) are closed with gate pieces instead of being
// left open, so by the end an enemy can no longer walk from outside the ring to the town center.
import { Game } from '../src/sim/game.js';
const MIN = +(process.argv[2] || 40);
const fails = []; const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); };
const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'normal', startRes: 'normal', startAge: 0, sandbox: false, seed: 3, mp: true });
g.convertToAI(0, 'hard');
const N = g.map.size;
function enemyReachesTC(pid) {
  const W = g.ais[pid].wall, foe = 1 - pid, x0 = W.cx - W.R - 4, x1 = W.cx + W.R + 4, z0 = W.cz - W.R - 4, z1 = W.cz + W.R + 4;
  const seen = new Uint8Array(N * N), q = [], P = (x, z) => x >= x0 && x <= x1 && z >= z0 && z <= z1 && g._pass(x, z, foe);
  for (let x = x0; x <= x1; x++) for (let z = z0; z <= z1; z++) if ((x === x0 || x === x1 || z === z0 || z === z1) && P(x, z)) { seen[z * N + x] = 1; q.push(x, z); }
  for (let i = 0; i < q.length; i += 2) for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) {
    const nx = q[i] + dx, nz = q[i + 1] + dz; if (!P(nx, nz) || seen[nz * N + nx]) continue;
    if (dx && dz && !P(nx, q[i + 1]) && !P(q[i], nz)) continue; seen[nz * N + nx] = 1; q.push(nx, nz);
  }
  const tc = g.buildingsOf(pid).find(b => b.type === 'towncenter');
  for (let x = tc.tx - 1; x <= tc.tx + tc.size; x++) for (let z = tc.tz - 1; z <= tc.tz + tc.size; z++) if (seen[z * N + x]) return true;
  return false;
}
for (let t = 1; t <= MIN * 1800; t++) g.update(1 / 30);
const W = g.ais[0].wall, bs = g.buildingsOf(0);
ok(!!W && !!bs.find(b => b.type === 'towncenter'), 'P0 planned a ring and still has its town center');
console.log(`  ring R ${W.R}, ${bs.filter(b => b.type === 'wall').length} wall, ${bs.filter(b => b.type === 'gate').length} gate pieces`);
ok(!enemyReachesTC(0), 'the ring is closed: an enemy cannot walk to the town center');
const vills = g.unitsOf(0).filter(u => u.type === 'villager'), idle = vills.filter(u => !u.order).length;
ok(vills.length >= 20 && idle <= 4, `villagers keep working (${vills.length}, ${idle} idle)`);
ok(!Object.keys(g.ais[0].errors).length, 'AI without errors');
console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
