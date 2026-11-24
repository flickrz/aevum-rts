// Transport + AI navy test: node test/naval-transport-test.mjs [--min 30]
//  A) on an islands map, soldiers + villagers board a transport, it crosses the water and unloads on the enemy island
//  B) AI vs AI (normal) on islands: docks, warships and a transport landing within N minutes
import { Game } from '../src/sim/game.js';
import { AIController } from '../src/sim/ai.js';

const args = process.argv.slice(2);
const MIN = +(args[args.indexOf('--min') + 1] || 30) || 30;
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok', m); return !!c; };
const run = (g, sec) => { for (let i = 0; i < sec * 10; i++) g.update(0.1); };

/* land component helpers (unused since every map is ford-connected) (tiles 4 deep water / 5 mountain are not land)
const comp = (g, x, z) => {
  const N = g.map.size, T = g.map.tiles, seen = new Uint8Array(N * N), s0 = Math.floor(z) * N + Math.floor(x), st = [s0]; seen[s0] = 1;
  while (st.length) { const i = st.pop(), cx = i % N, cz = (i / N) | 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = cx + dx, nz = cz + dz; if (nx < 1 || nz < 1 || nx >= N - 1 || nz >= N - 1) continue; const j = nz * N + nx; if (seen[j] || T[j] === 4 || T[j] === 5) continue; seen[j] = 1; st.push(j); } }
  return seen;
};
const near = (seen, N, x, z) => { for (let j = -3; j <= 3; j++) for (let k = -3; k <= 3; k++) if (seen[(Math.floor(z) + j) * N + Math.floor(x) + k]) return true; return false; }; */

// ---- A) manual ferry ----
console.log('A) transport crossing');
// (the generator always leaves a ford between starts, so "the enemy island" = landed nearer the enemy start, by sea)
const g = new Game({ mapSize: 96, enemies: 1, difficulty: 'easy', seed: 1, sandbox: true, mapType: 'islands' });
g.ais.length = 0;
const P0 = g.players[0], P1 = g.players[1], N = g.map.size;
const sh = g._navShore(P0.startX, P0.startZ, 0, 30, true);
ok(sh, 'home shore found');
const tp = g._addUnit('transport', 0, sh.wx, sh.wz);
const sold = [((f) => g._addUnit('spearman', 0, f.x, f.z))(g._freeNear(P0.startX + 5, P0.startZ + 5, 0)), ((f) => g._addUnit('spearman', 0, f.x, f.z))(g._freeNear(P0.startX + 6, P0.startZ + 5, 0))];
const vil = g.unitsOf(0).filter(u => u.type === 'villager').slice(0, 2);
const land = sold.concat(vil);
ok(g.cmdBoard(land.map(u => u.id), tp.id), 'cmdBoard (soldiers + villagers)');
for (let s = 0; s < 120 && (tp.cargo || []).length < land.length; s++) run(g, 1);
if ((tp.cargo || []).length < land.length) land.forEach(u => console.log('   ', u.type, u.x.toFixed(1), u.z.toFixed(1), u.aboard, u.order && u.order.type, u.state, JSON.stringify(u.order)));
ok((tp.cargo || []).length === land.length, 'all boarded (' + (tp.cargo || []).length + '/' + land.length + ')');
const far = g._navShore(P1.startX, P1.startZ, 0, 40, true);
ok(far, 'enemy coast found');
ok(g.cmdUnload(tp.id, far.lx, far.lz), 'cmdUnload to far coast');
for (let s = 0; s < 240 && (tp.cargo || []).length; s++) run(g, 1);
ok(!(tp.cargo || []).length, 'unloaded');
const dd = (u, p) => Math.hypot(u.x - p.startX, u.z - p.startZ);
ok(land.every(u => !u.dead && !u.aboard && g._navLandPass(u.x | 0, u.z | 0, 0) && dd(u, P1) < 40 && dd(u, P1) < dd(u, P0)), 'all landed on the enemy coast: ' + land.map(u => dd(u, P1).toFixed(0)).join(','));
// sink with cargo: cargo dies
const tp2 = g._addUnit('transport', 0, sh.wx, sh.wz), v2 = g._addUnit('spearman', 0, sh.lx, sh.lz);
g.cmdBoard([v2.id], tp2.id); for (let s = 0; s < 40 && !v2.aboard; s++) run(g, 1);
ok(v2.aboard === tp2.id, 'boarded second transport');
g._kill(tp2, null); run(g, 1);
ok(v2.dead, 'cargo dies when the transport sinks');

// ---- B) AI navy on islands ----
console.log('B) AI navy, islands, normal vs normal, up to', MIN, 'min');
const seedB = 1;
const gb = new Game({ mapSize: 96, enemies: 1, difficulty: 'normal', seed: seedB, sandbox: false, mapType: 'islands' });
gb.quests = { list: [], update() {}, serialize() { return null; }, load() {} };
const ais = [new AIController(gb, 0, 'normal'), new AIController(gb, 1, 'normal')];
gb.ais.length = 0; gb.ais.push(...ais);
let landedAt = null, warAt = null, tpAt = null, dockAt = null;
gb.events.on('unload', p => { if (landedAt == null && p.transport && p.units && p.units.length) landedAt = gb.time; });
let tradeAt = null, shellAt = null, shellOn = '';
const ad = gb._applyDamage.bind(gb);
gb._applyDamage = (t, dmg, k, pr) => { if (t && t.kind === 'building' && k && k.naval && process.env.DBG) console.log('   shell', (gb.time/60).toFixed(1), k.type, t.type, dmg); if (shellAt == null && t && !t.dead && t.kind === 'building' && t.type !== 'dock' && k && k.naval && k.owner !== t.owner && t.owner >= 0) { shellAt = gb.time; shellOn = k.type + '->' + t.type; } return ad(t, dmg, k, pr); };
const dt = 1 / 30;
for (let i = 0; i < MIN * 60 * 30 && !gb.over; i++) {
  gb.update(dt);
  if (i % 300) continue;
  for (const p of [0, 1]) {
    if (dockAt == null && gb.buildingsOf(p).some(b => b.type === 'dock' && b.done)) dockAt = gb.time;
    const us = gb.unitsOf(p);
    if (warAt == null && us.some(u => u.type === 'galley' || u.type === 'galleon' || u.type === 'ironclad')) warAt = gb.time;
    if (tpAt == null && us.some(u => u.type === 'transport')) tpAt = gb.time;
    if (tradeAt == null && us.some(u => u.type === 'tradeship')) tradeAt = gb.time;
  }
  if (landedAt != null && warAt != null && tradeAt != null && shellAt != null && gb.time > landedAt + 30) break;
}
const m = t => (t == null ? '-' : (t / 60).toFixed(1) + 'm');
console.log(`  seed ${seedB}: dock ${m(dockAt)} warship ${m(warAt)} transport ${m(tpAt)} first landing ${m(landedAt)} trade ship ${m(tradeAt)} shelled ${m(shellAt)} ${shellOn} | landings ${ais.map(a => a.stats.landings || 0).join('/')} pushes ${ais.map(a => a.stats.pushes).join('/')}`);
ok(dockAt != null, 'AI built a dock');
ok(warAt != null, 'AI built warships');
ok(tpAt != null, 'AI built a transport');
ok(tradeAt != null && tradeAt < 25 * 60, 'AI trained a trade ship within 25 min');
ok(shellAt != null && shellAt < 25 * 60, 'a warship shelled an enemy land building within 25 min');
ok(landedAt != null && ais.some(a => (a.stats.landings || 0) > 0), 'AI landed troops on the enemy island');

if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log('ALL OK');
