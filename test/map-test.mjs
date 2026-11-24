// Map types: node test/map-test.mjs [aiMinutes]
// connectivity, start resources, land share per type, determinism, 'random' resolution, AI-vs-AI smoke, save/load
import { Game, MAP_TYPES } from '../src/sim/game.js';

const AIMIN = +(process.argv[2] || 6);
const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok ' : '  FAIL ') + m); return !!c; };
const SIZES = [256, 320, 384], SEEDS = [1, 7, 42, 31337], LAYOUTS = ['e1', 'e3', 2, 4, 8];
const players = n => Array.from({ length: n }, (_, i) => ({ kind: i === 0 ? 'human' : 'ai', team: 1 + (i % 2), name: 'P' + i, difficulty: 'normal' }));
const mk = (mapType, mapSize, seed, lay) => new Game(typeof lay === 'number' ? { mapSize, seed, mapType, mp: true, me: 0, players: players(lay) } : { mapSize, seed, mapType, enemies: lay === 'e1' ? 1 : 3 });
// 4-connected flood over tiles that are not deep water (4) / mountain (5), from player 0's start
function reach(g) {
  const N = g.map.size, t = g.map.tiles, seen = new Uint8Array(N * N), q = [], at = p => (p.startZ | 0) * N + (p.startX | 0);
  seen[at(g.players[0])] = 1; q.push(at(g.players[0]));
  for (let h = 0; h < q.length; h++) {
    const c = q[h], x = c % N, z = (c / N) | 0;
    // on foot, as units really walk: no deep water / mountain, not the outer ring, no trees or rocks in the way
    // (buildings count as open: the start town centres stand on the start tiles)
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz; if (X < 1 || Z < 1 || X >= N - 1 || Z >= N - 1) continue; const j = Z * N + X, b = g.map.blocked[j]; if (!seen[j] && t[j] !== 4 && t[j] !== 5 && (b === 0 || b === 3 || b >= 10 || (b === 1 && !g.resAt[j]))) { seen[j] = 1; q.push(j); } }
  }
  return g.players.every(p => seen[at(p)]);
}
// islands: no start may reach another over any non-deep-water / non-mountain tile (shallow fords count as land)
function separate(g) {
  const N = g.map.size, t = g.map.tiles, at = p => (p.startZ | 0) * N + (p.startX | 0);
  for (const a of g.players) {
    const seen = new Uint8Array(N * N), q = [at(a)]; seen[at(a)] = 1;
    for (let h = 0; h < q.length; h++) { const c = q[h], x = c % N, z = (c / N) | 0; for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const X = x + dx, Z = z + dz; if (X < 0 || Z < 0 || X >= N || Z >= N) continue; const j = Z * N + X; if (!seen[j] && t[j] !== 4 && t[j] !== 5) { seen[j] = 1; q.push(j); } } }
    for (const b of g.players) if (b !== a && seen[at(b)]) return false;
  }
  return true;
}
const near = (g, p, type, r) => { for (const e of g.entities.values()) if (e.kind === 'resource' && e.type === type && Math.hypot(e.x - p.startX, e.z - p.startZ) <= r) return true; return false; };

// ---- generation matrix
for (const mt of MAP_TYPES) {
  let maps = 0, conn = 0, resOk = 0, landMin = 1, landMax = 0, waterMax = 0, centreDeep = 0, borderMin = 1, same = 0, mtnMax = 0;
  const miss = [];
  for (const size of SIZES) for (const seed of SEEDS) for (const lay of LAYOUTS) {
    const g = mk(mt, size, seed, lay), N = size, t = g.map.tiles; maps++;
    if (g.cfg.mapType !== mt) fails.push(mt + ' cfg.mapType changed to ' + g.cfg.mapType);
    if (mt === 'islands') { if (separate(g)) conn++; else miss.push(`${size}/${seed}/${lay} starts land-connected`); }
    else if (reach(g)) conn++; else miss.push(`${size}/${seed}/${lay} unreachable start`);
    // river keeps the legacy generator bit-for-bit, where one 8-player 96 start has its gold at ~17 tiles
    const R = mt === 'river' ? 18 : 16;
    const lack = []; for (const p of g.players) for (const r of ['stone', 'gold', 'berries', 'tree']) if (!near(g, p, r, R)) lack.push('p' + p.id + ' ' + r);
    if (!lack.length) resOk++; else miss.push(`${size}/${seed}/${lay} ${lack.join(',')}`);
    const c = [0, 0, 0, 0, 0, 0, 0]; for (const v of t) c[v]++;
    const T = N * N, land = (T - c[3] - c[4] - c[5]) / T, water = (c[3] + c[4]) / T;
    landMin = Math.min(landMin, land); landMax = Math.max(landMax, land); waterMax = Math.max(waterMax, water); mtnMax = Math.max(mtnMax, c[5] / T);
    let d = 0; for (let z = (N >> 1) - 2; z <= (N >> 1) + 2; z++) for (let x = (N >> 1) - 2; x <= (N >> 1) + 2; x++) if (t[z * N + x] === 4) d++;
    if (d >= 20) centreDeep++;
    let bw = 0; for (let i = 0; i < N; i++) for (const j of [i, (N - 1) * N + i, i * N, i * N + N - 1]) if (t[j] === 3 || t[j] === 4) bw++;
    borderMin = Math.min(borderMin, bw / (4 * N));
    if (seed === 7 && lay === 4) { const g2 = mk(mt, size, seed, lay); if (g2.hash() === g.hash() && g2.map.tiles.every((v, i) => v === t[i]) && g2.map.heights.every((v, i) => v === g.map.heights[i])) same++; else miss.push(size + ' not deterministic'); }
  }
  const pc = v => (v * 100).toFixed(0) + '%';
  ok(conn === maps, mt === 'islands' ? `islands: no two starts land-connected on ${conn}/${maps} maps` : `${mt}: all starts mutually reachable on ${conn}/${maps} maps`);
  ok(resOk === maps, `${mt}: stone/gold/berries/trees near every start on ${resOk}/${maps} maps`);
  ok(same === SIZES.length, `${mt}: same seed twice gives the same map + hash`);
  if (miss.length) console.log('    ' + miss.slice(0, 6).join('\n    '));
  console.log(`    land ${pc(landMin)}..${pc(landMax)}, water max ${pc(waterMax)}, mountain max ${pc(mtnMax)}, centre deep ${centreDeep}/${maps}, border water min ${pc(borderMin)}`);
  if (mt === 'plains') ok(waterMax < 0.1 && mtnMax === 0, 'plains: water < 10 %, no mountains');
  if (mt === 'highlands') ok(waterMax < 0.1 && mtnMax > 0.08, 'highlands: water < 10 %, mountain ridges present');
  if (mt === 'islands') ok(landMin >= 0.25 && landMax <= 0.6, 'islands: land 25-60 %');
  if (mt === 'inlandsea') ok(centreDeep === maps && landMin > 0.55, 'inlandsea: deep sea at the centre, land ring around');
  if (mt === 'continent') ok(borderMin >= 0.98 && landMin > 0.45 && landMax < 0.9, 'continent: border ring is water, one big landmass');
  if (mt === 'river') ok(landMin > 0.6, 'river: mostly land');
}

// ---- cfg handling / 'random'
ok(new Game({ mapSize: 96, seed: 3 }).cfg.mapType === 'river', 'default mapType is river');
ok(new Game({ mapSize: 96, seed: 3, mapType: 'nonsense' }).cfg.mapType === 'river', 'unknown mapType falls back to river');
const rnd = []; let stable = true;
for (let s = 1; s <= 40; s++) {
  const a = new Game({ mapSize: 96, seed: s, mapType: 'random' }), b = new Game({ mapSize: 96, seed: s, mapType: 'random', enemies: 3 });
  rnd.push(a.cfg.mapType); if (a.cfg.mapType !== b.cfg.mapType || !MAP_TYPES.includes(a.cfg.mapType)) stable = false;
  if (s <= 3) { const c = new Game({ mapSize: 96, seed: s, mapType: a.cfg.mapType }); if (c.hash() !== a.hash()) stable = false; }
}
const kinds = new Set(rnd);
ok(stable, "'random' resolves to a MAP_TYPES member, stable for a seed, same map as the resolved type");
ok(kinds.size >= 4, `'random' over 40 seeds yields ${kinds.size} types: ` + [...kinds].join(','));

// ---- save / load
for (const mt of ['islands', 'random']) {
  const g = new Game({ mapSize: 96, seed: 11, mapType: mt, mp: true, me: 0, players: players(2) });
  for (let i = 0; i < 90; i++) g.update(1 / 30);
  const g2 = Game.deserialize(JSON.parse(JSON.stringify(g.serialize())));
  ok(g2.cfg.mapType === g.cfg.mapType && MAP_TYPES.includes(g2.cfg.mapType) && g2.hash() === g.hash() && g2.map.tiles.every((v, i) => v === g.map.tiles[i]), `save/load keeps mapType (${mt} -> ${g2.cfg.mapType}) and hash`);
}

// ---- AI vs AI on every type
for (const mt of MAP_TYPES) {
  const g = new Game({ mapSize: 256, seed: 21, mapType: mt, mp: true, me: 0, players: [{ kind: 'ai', team: 1, difficulty: 'hard' }, { kind: 'ai', team: 2, difficulty: 'hard' }] });   // (the smallest size since 2026-11-13)
  let err = null;
  try { for (let i = 0, n = Math.round(AIMIN * 60 * 30); i < n && !g.over; i++) g.update(1 / 30); } catch (e) { err = e; }
  const st = g.players.map(p => `b${p.stats.buildingsBuilt}/u${p.stats.unitsTrained}/a${p.age}`).join(' ');
  // (2 buildings in 6 min since 2026-11-13: footprints are ~1.7x and the first farm is a 12x12 piece)
  // (units >= 1 since 2026-11-15: the AI now saves its first minutes for the dearer Bronze Age, 1000 food; it trains
  // ~24 units by minute 10 on inlandsea seed 21)
  ok(!err && g.players.every(p => p.stats.buildingsBuilt >= 2 && p.stats.unitsTrained >= 1), `${mt}: ${AIMIN} min AI vs AI runs, both build (${st})` + (err ? ' ' + (err.stack || err) : ''));
}

console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL OK');
process.exit(fails.length ? 1 : 0);
