// Smaller map sizes (players: "daha da küçük harita seçenekleri olabilir"): node test/small-map-test.mjs [aiMinutes]
// 160 and 192 next to the 256 "small": generation, start spacing and resources for up to 8 players, AI smoke, lobby
import { Game, MAP_TYPES } from '../src/sim/game.js';
import { NetSession as Session } from '../src/net/session.js';

const AIMIN = +(process.argv[2] || 5);
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); return !!c; };
const SIZES = [160, 192], SEEDS = [1, 7, 42], LAYOUTS = ['e1', 'e3', 2, 4, 8];
const players = n => Array.from({ length: n }, (_, i) => ({ kind: i === 0 ? 'human' : 'ai', team: 1 + (i % 2), name: 'P' + i, difficulty: 'normal' }));
const mk = (mapType, mapSize, seed, lay) => new Game(typeof lay === 'number' ? { mapSize, seed, mapType, mp: true, me: 0, players: players(lay) } : { mapSize, seed, mapType, enemies: lay === 'e1' ? 1 : 3 });
function reach(g) {
  const N = g.map.size, t = g.map.tiles, seen = new Uint8Array(N * N), q = [], at = p => (p.startZ | 0) * N + (p.startX | 0);
  seen[at(g.players[0])] = 1; q.push(at(g.players[0]));
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % N, z = (c / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz; if (X < 1 || Z < 1 || X >= N - 1 || Z >= N - 1) continue; const j = Z * N + X, b = g.map.blocked[j]; if (!seen[j] && t[j] !== 4 && t[j] !== 5 && (b === 0 || b === 3 || b >= 10 || (b === 1 && !g.resAt[j]))) { seen[j] = 1; q.push(j); } }
  }
  return g.players.every(p => seen[at(p)]);
}
const near = (g, p, type, r) => { for (const e of g.entities.values()) if (e.kind === 'resource' && e.type === type && Math.hypot(e.x - p.startX, e.z - p.startZ) <= r) return true; return false; };

for (const size of SIZES) {
  let maps = 0, conn = 0, resOk = 0, tcOk = 0, minGap = 1e9; const miss = [];
  for (const mt of MAP_TYPES) for (const seed of SEEDS) for (const lay of LAYOUTS) {
    const g = mk(mt, size, seed, lay); maps++;
    if (g.map.size !== size) miss.push(`${mt}/${seed}/${lay} size became ${g.map.size}`);
    if (reach(g)) conn++; else miss.push(`${mt}/${seed}/${lay} unreachable start`);
    const R = mt === 'river' ? 18 : 16, lack = [];
    for (const p of g.players) for (const r of ['stone', 'gold', 'berries', 'tree']) if (!near(g, p, r, R)) lack.push('p' + p.id + ' ' + r);
    if (!lack.length) resOk++; else miss.push(`${mt}/${seed}/${lay} ${lack.join(',')}`);
    if (g.players.every(p => g.buildings.some(b => b.owner === p.id && b.type === 'towncenter'))) tcOk++; else miss.push(`${mt}/${seed}/${lay} missing town center`);
    for (let i = 0; i < g.players.length; i++) for (let j = i + 1; j < g.players.length; j++) minGap = Math.min(minGap, Math.hypot(g.players[i].startX - g.players[j].startX, g.players[i].startZ - g.players[j].startZ));
  }
  ok(conn === maps, `${size}: all starts reachable on ${conn}/${maps} maps`);
  ok(resOk === maps, `${size}: stone/gold/berries/trees near every start on ${resOk}/${maps} maps`);
  ok(tcOk === maps, `${size}: every player has a town center on ${tcOk}/${maps} maps`);
  ok(minGap >= 40, `${size}: closest two starts ${minGap.toFixed(0)} tiles apart (8 players, >= 40)`);
  if (miss.length) console.log('    ' + miss.slice(0, 6).join('\n    '));
  const a = mk('plains', size, 5, 4), b = mk('plains', size, 5, 4);
  ok(a.hash() === b.hash(), `${size}: same seed twice -> same hash`);
}

// AI vs AI on the smallest size: no errors, everybody alive and working; save / load round trip
for (const [size, n] of [[160, 4], [192, 8]]) {
  const g = new Game({ mapSize: size, seed: 3, mapType: 'random', mp: true, me: 0, players: players(n).map(p => ({ ...p, kind: 'ai', difficulty: 'easy' })) });
  let err = null; const ce = console.error; console.error = (...x) => { err = err || x.join(' '); };
  try { for (let i = 0; i < AIMIN * 60 * 30; i++) g.update(1 / 30); } catch (e) { err = String(e); } finally { console.error = ce; }
  ok(!err, `${size}: ${n} AIs play ${AIMIN} min without errors${err ? ' (' + err.slice(0, 80) + ')' : ''}`);
  ok(g.players.every(p => g.unitsOf(p.id).filter(u => u.type === 'villager').length >= 6), `${size}: every AI grew its economy`);
  const L = Game.deserialize(JSON.stringify(g.serialize()));
  ok(L.cfg.mapSize === size && L.hash() === g.hash(), `${size}: save / load keeps the size and hash`);
}

// the lobby accepts the new sizes (host settings filter)
{
  const s = Object.create(Session.prototype); s.state = { settings: { mapSize: 320 }, resume: null }; s._hostOnly = () => {}; s._notResume = () => {}; s._broadcastLobby = () => {}; s.isHost = true;
  let threw = null;
  for (const v of [160, 192]) { try { s.setSettings({ mapSize: v }); } catch (e) { threw = e; } ok(!threw && s.state.settings.mapSize === v, 'lobby takes mapSize ' + v + (threw ? ' (' + threw.message + ')' : '')); }
  try { s.setSettings({ mapSize: 100 }); } catch (e) { /* filter only */ }
  ok(s.state.settings.mapSize === 192, 'lobby still refuses an unknown size');
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nall ok');
process.exit(fails.length ? 1 : 0);
