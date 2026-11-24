// Naval rework test (2026-11-25): long-range ship bombardment of land,
// towers reaching ships. node test/naval-eco-test.mjs
import { Game, TOWER_SEA_REACH } from '../src/sim/game.js';
import { UNITS } from '../src/data.js';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok', m); return !!c; };
const run = (g, sec) => { for (let i = 0; i < sec * 10; i++) g.update(0.1); };

ok(UNITS.galleon.range >= 11 && UNITS.ironclad.range >= 12 && UNITS.galley.range >= 8, 'defs: long ranges');

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
