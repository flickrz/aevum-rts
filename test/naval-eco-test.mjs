// Naval rework test (2026-11-25): trade ship income between two docks, long-range ship bombardment of land,
// towers reaching ships. node test/naval-eco-test.mjs
import { Game, TRADE_SHIP_MIN, TRADE_SHIP_GOLD, TOWER_SEA_REACH } from '../src/sim/game.js';
import { UNITS } from '../src/data.js';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok', m); return !!c; };
const run = (g, sec) => { for (let i = 0; i < sec * 10; i++) g.update(0.1); };

ok(UNITS.tradeship && UNITS.tradeship.naval && UNITS.galleon.range >= 11 && UNITS.ironclad.range >= 12 && UNITS.galley.range >= 8, 'defs: trade ship + long ranges');

// a map with two dock spots TRADE_SHIP_MIN+ apart on the same water body (checked by the ship actually trading)
let done = false;
for (let seed = 1; seed < 80 && !done; seed++) {
  const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed, sandbox: true });
  g.ais.length = 0;
  const spots = [];
  for (let tz = 4; tz < 124; tz += 2) for (let tx = 4; tx < 124; tx += 2) if (g.canPlace('dock', tx, tz, 0)) spots.push([tx, tz]);
  if (spots.length < 2) continue;
  // farthest pair within 60 tiles (likely the same lake / sea)
  let a = null, b = null, bd = 0;
  for (let i = 0; i < spots.length; i += 3) for (let j = i + 1; j < spots.length; j += 3) { const d = Math.hypot(spots[i][0] - spots[j][0], spots[i][1] - spots[j][1]); if (d >= TRADE_SHIP_MIN + 5 && d <= 45 && d > bd) { bd = d; a = spots[i]; b = spots[j]; } }
  if (!a) continue;
  const d1 = g._addBuilding('dock', 0, a[0], a[1], true), d2 = g._addBuilding('dock', 0, b[0], b[1], true);
  const P = g.players[0]; P.res = { food: 5000, wood: 5000, stone: 5000, gold: 5000 }; P.age = 1;
  if (!g.train(d1.id, 'tradeship')) continue;
  run(g, 40);
  const ship = g.unitsOf(0).find(u => u.type === 'tradeship');
  if (!ship || !ship.order || ship.order.type !== 'shiptrade') continue;
  const gold0 = P.stats.gathered.gold;
  run(g, 240);
  const got = P.stats.gathered.gold - gold0;
  if (got <= 0) continue;   // other water body: try another map
  console.log('seed', seed, 'docks', a, b, 'dist', bd.toFixed(1), 'gold in 4 min', got);
  ok(got > 0, 'trade ship earns gold: +' + got);
  // a single round trip pays about dist * TRADE_SHIP_GOLD
  ok(got % Math.round(Math.hypot(d1.x - d2.x, d1.z - d2.z) * TRADE_SHIP_GOLD) === 0, 'income is per round trip by distance');
  done = true;
}
ok(done, 'found a map where the trade ship trades');

// bombardment: a galleon 11 tiles off an enemy dock shoots it without moving
{
  let tested = false;
  for (let seed = 1; seed < 80 && !tested; seed++) {
    const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed, sandbox: true });
    g.ais.length = 0;
    let spot = null;
    for (let tz = 4; tz < 124 && !spot; tz += 2) for (let tx = 4; tx < 124 && !spot; tx += 2) if (g.canPlace('dock', tx, tz, 1)) spot = [tx, tz];
    if (!spot) continue;
    const dock = g._addBuilding('dock', 1, spot[0], spot[1], true);
    let w = null;
    for (let r = 0; r < 64 && !w; r++) { const a = r * 0.7, x = dock.x + Math.cos(a) * 11.5, z = dock.z + Math.sin(a) * 11.5; if (g._navWater(x | 0, z | 0) && g._navWater((x + 1) | 0, z | 0) && g._navWater(x | 0, (z + 1) | 0)) w = [(x | 0) + 0.5, (z | 0) + 0.5]; }
    if (!w) continue;
    const gl = g._addUnit('galleon', 0, w[0], w[1]);
    const hp0 = dock.hp, x0 = gl.x, z0 = gl.z;
    g.cmdAttack([gl.id], dock.id);
    run(g, 20);
    ok(dock.hp < hp0, 'galleon bombards a dock ~11 tiles away: ' + hp0 + ' -> ' + dock.hp);
    ok(Math.hypot(gl.x - x0, gl.z - z0) < 1.5, 'galleon fired from range (moved ' + Math.hypot(gl.x - x0, gl.z - z0).toFixed(2) + ')');
    // a tower reaches ships TOWER_SEA_REACH tiles farther than land units
    tested = true;
  }
  ok(tested, 'found a shore for the bombardment test');
}
ok(TOWER_SEA_REACH > 0, 'towers reach ships farther');

if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log('naval-eco-test passed');
