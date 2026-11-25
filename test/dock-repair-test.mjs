// Ships near an own dock are repaired (player request 2026-11-25): node test/dock-repair-test.mjs
import { Game } from '../src/sim/game.js';
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); else console.log('  ok', m); return !!c; };
let g = null, spot = null;
for (let seed = 1; seed < 200 && !spot; seed++) {
  const t = new Game({ mapSize: 128, enemies: 1, difficulty: 'easy', seed, sandbox: true });
  const p = t.players[0];
  for (let tz = 2; tz < 126 && !spot; tz++) for (let tx = 2; tx < 126 && !spot; tx++) if (Math.hypot(tx - p.startX, tz - p.startZ) < 30 && t._navCanPlaceDock(tx, tz)) { g = t; spot = [tx, tz]; }
}
for (const ai of g.ais) ai.update = () => {}; g.ais.length = 0;
const d = g._addBuilding('dock', 0, spot[0], spot[1], true); g._navBlockDock(d, 1);
g._navMode = true; const f = g._navSpawn(d); g._navMode = false;
const s = g._addUnit('galley', 0, f.x, f.z); s.hp = Math.round(s.maxHp * 0.4); const h0 = s.hp;
for (let i = 0; i < 100; i++) g.update(0.1);
ok(s.hp > h0 + 5, 'a damaged galley next to its dock is repaired (' + h0 + ' -> ' + s.hp + ' / ' + s.maxHp + ')');
const far = g._addUnit('galley', 0, f.x, f.z); far.hp = 50; far.x += 0; s.hitT = g.time; far.hitT = g.time;   // just hit: no repair yet
const h1 = far.hp; for (let i = 0; i < 20; i++) g.update(0.1);
ok(far.hp === h1, 'no repair within 5 s of a hit');
if (fails.length) { console.log('FAIL', fails); process.exit(1); } else console.log('ALL OK');
