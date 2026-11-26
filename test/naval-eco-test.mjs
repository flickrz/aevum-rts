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

// fish margin: no fish shoal spawns hugging the shore (2-tile water margin)
{
  let checked = 0, bad = 0;
  for (const mapType of ['river', 'islands', 'continent', 'inlandsea']) {
    const g = new Game({ mapSize: 256, enemies: 1, difficulty: 'easy', seed: 19, mapType });
    const N = g.map.size, T = g.map.tiles;
    const shoals = g._navShoals();
    ok(shoals.length >= 6, `${mapType}: fish shoals generated (${shoals.length})`);
    for (const s of shoals) {
      checked++;
      const cx = s.x | 0, cz = s.z | 0;
      for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const t = T[(cz + dz) * N + (cx + dx)];
        if (t !== 3 && t !== 4) { bad++; break; }
      }
    }
  }
  ok(checked > 0 && bad === 0, `fish margin: 0/${checked} shoals within 2 tiles of land`);
}

// rally flag on fish -> fishboat starts gathering right away; idle fishboat -> nearest free fish
{
  let tested = false;
  for (let seed = 1; seed < 80 && !tested; seed++) {
    const g = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed, mapType: 'islands', sandbox: true });
    g.ais.length = 0;
    const p = g.players[0];
    let spot = null;
    for (let tz = 4; tz < 124 && !spot; tz += 2) for (let tx = 4; tx < 124 && !spot; tx += 2) {
      if (Math.hypot(tx - p.startX, tz - p.startZ) < 28 && g.canPlace('dock', tx, tz, 0)) spot = [tx, tz];
    }
    if (!spot) continue;
    const shoals = g._navShoals().filter(s => Math.hypot(s.x - spot[0], s.z - spot[1]) < 35).sort((a, b) => Math.hypot(a.x - spot[0], a.z - spot[1]) - Math.hypot(b.x - spot[0], b.z - spot[1]));
    if (shoals.length < 2) continue;
    const dock = g._addBuilding('dock', 0, spot[0], spot[1], true);
    g._complete(dock);
    const targetShoal = shoals[0];
    ok(g.setRally(dock.id, targetShoal.x, targetShoal.z, targetShoal.id), 'dock rally set on fish shoal');
    ok(g.train(dock.id, 'fishboat'), 'train fishboat with fish rally');
    run(g, 20);
    const b1 = g.unitsOf(0).find(u => u.type === 'fishboat');
    ok(b1 && b1.order && b1.order.type === 'fish' && b1.order.targetId === targetShoal.id, 'rally-on-fish: fishboat immediately fishes rally shoal');
    // second boat trained with NO rally: auto-goes to a free shoal (different from targetShoal)
    dock.rally = null;
    ok(g.train(dock.id, 'fishboat'), 'train second fishboat without rally');
    run(g, 20);
    const boats = g.unitsOf(0).filter(u => u.type === 'fishboat');
    const b2 = boats.find(u => u.id !== b1.id);
    ok(b2 && b2.order && b2.order.type === 'fish' && b2.order.targetId !== targetShoal.id, 'no-rally fishboat auto-picks a free shoal');
    // stopped (idle) fishboat auto-resumes fishing on nearest free shoal
    g.cmdStop([b2.id]);
    ok(!b2.order, 'boat stopped');
    run(g, 3);
    ok(b2.order && b2.order.type === 'fish' && b2.order.targetId !== targetShoal.id, 'idle fishboat auto-resumes nearest free shoal');
    const f0 = p.stats.gathered.food;
    run(g, 90);
    ok(p.stats.gathered.food > f0 + 10, 'auto-fishing boats gather food (+' + (p.stats.gathered.food - f0) + ')');
    tested = true;
  }
  ok(tested, 'ran fishboat rally + auto-fish scenario');
}

if (fails.length) { console.log('FAIL', fails); process.exit(1); }
console.log('naval-eco-test passed');
