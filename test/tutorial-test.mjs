// Tutorial mode: node test/tutorial-test.mjs
// Plays "Kartal Obası'nın İlk Kışı" headless through every chapter with the public Game API, as a player would
// (the UI's three acks - "Devam", camera, selection - are sent directly), and checks that each chapter completes and
// the match ends in victory. Also: the run is deterministic, a save mid-way loads back, and a normal game (no
// tutorial flag) still has its AI, quests and the same state hash as before the tutorial code existed.
import { Game } from '../src/sim/game.js';
import { TutorialSystem, TUT_CFG, TUT_CHAPTERS } from '../src/sim/tutorial.js';
import { UNITS } from '../src/data.js';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); return !!c; };
const DT = 1 / 30;

// ---- a normal game is untouched (golden hash taken from glb-stone-age 0.9.1 without the tutorial)
{
  const g = new Game({ mapSize: 96, enemies: 1, difficulty: 'normal', seed: 5, mapType: 'plains', fog: 'explored' });
  ok(g.ais.length === 1 && !(g.quests instanceof TutorialSystem) && g.quests.list.length === 0, 'normal game: AI, no quests');
  ok(g.hash() === 2308781096, 'normal game: initial hash unchanged ' + g.hash());   // (re-pinned 2026-11-23: hunting (deer alive + hp) and predators; again 2026-11-24: predators spawn >= 36 tiles from the starts, more tries)
  for (let i = 0; i < 3600; i++) g.update(DT);
  ok(g.hash() === 1240070603, 'normal game: hash after 2 min unchanged ' + g.hash());
  const m = new Game({ mapSize: 96, seed: 3, mp: true, me: 0, tutorial: true, players: [{ kind: 'human', team: 1 }, { kind: 'ai', team: 2 }] });
  ok(!('tutorial' in m.cfg) && m.ais.length === 1 && m.quests.list.length === 0, 'multiplayer forces the tutorial off');
}

const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);
const isMil = (u) => { const d = UNITS[u.type]; return d && d.cls !== 'civil' && d.atk > 0; };

// land path between the two Town Centers (BFS over passable tiles)
function landPath(g, a, b) {
  const N = g.map.size, seen = new Uint8Array(N * N);
  const s = g._freeNear(a.x, a.z + a.size / 2 + 1, 0), t = g._freeNear(b.x, b.z + b.size / 2 + 1, 0);
  const q = [(s.z | 0) * N + (s.x | 0)]; seen[q[0]] = 1; const goal = (t.z | 0) * N + (t.x | 0);
  for (let h = 0; h < q.length; h++) {
    const i = q[h]; if (i === goal) return true;
    const x = i % N, z = (i / N) | 0;
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) { const nx = x + dx, nz = z + dz, j = nz * N + nx; if (nx < 0 || nz < 0 || nx >= N || nz >= N || seen[j] || !g._pass(nx, nz, 0)) continue; seen[j] = 1; q.push(j); }
  }
  return false;
}
function spotNear(g, type, x, z, r0 = 3, r1 = 20) {
  for (let r = r0; r < r1; r++) for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, tx = Math.round(x + Math.cos(a) * r), tz = Math.round(z + Math.sin(a) * r); if (g.canPlace(type, tx, tz, 0)) return [tx, tz]; }
  return null;
}

// one full playthrough; returns a report
function play(opts = {}) {
  const g = new Game({ ...TUT_CFG });
  const tq = g.quests, S = tq.s, rep = { g, doneAt: [], raidTick: null, saveOk: null, steps: 0 };
  const done = new Set();
  g.events.on('questDone', (p) => { const id = p.quest && p.quest.id; if (id && !done.has(id)) { done.add(id); rep.doneAt.push([id, Math.round(g.time)]); } });
  let act = 0, lastStep = -1, did = {};
  const vil = () => g.unitsOf(0).filter(u => u.type === 'villager');
  const tc = () => g.buildingsOf(0).find(b => b.type === 'towncenter');
  for (let t = 0; t < 30 * 60 * 30 && !g.over; t++) {
    g.update(DT); rep.steps++;
    if (S.ids.raid && rep.raidTick == null) rep.raidTick = g.tick;
    if (g.time < act) continue;
    act = g.time + 0.5;
    if (S.step !== lastStep) { lastStep = S.step; did = {}; }
    if ((S.phase === 'story' || S.phase === 'end') && g.time - S.enteredAt > 1.5) { tq.ack('go'); continue; }
    if (S.phase === 'end') { if (!did.endGo) { did.endGo = true; tq.ack('go'); } continue; }
    if (S.phase !== 'play') continue;
    const T = tc(), ids = (a) => a.map(u => u.id);
    switch (S.step) {
      case 0: tq.ack('cam'); if (g.time - S.playAt > 2) tq.ack('sel'); break;
      case 1: if (!did.mv) { did.mv = true; g.cmdMove([S.ids.spear], S.ids.marker.x, S.ids.marker.z); } break;
      case 2: if (!did.g) {
        did.g = true; const v = vil(), c = { x: T.x, z: T.z };
        const tree = g.resourceNear(c.x, c.z, 25, 'tree'), ber = g.resourceNear(c.x, c.z, 25, 'berries'), st = g.resourceNear(c.x, c.z, 25, 'stone') || g.resourceNear(c.x, c.z, 25, 'gold');
        g.cmdGather(ids(v.slice(0, 8)), tree.id); g.cmdGather(ids(v.slice(8, 16)), ber.id); g.cmdGather(ids(v.slice(16)), st.id);
      } break;
      case 3: if (!did.b) {
        did.b = true; const v = vil(), tree = g.resourceNear(T.x, T.z, 25, 'tree');
        const a = spotNear(g, 'lumbercamp', tree.x, tree.z, 2), b = spotNear(g, 'pasture', T.x, T.z, 6);
        ok(!!a && !!b, 'chapter 4: building spots found');
        g.placeBuilding(0, 'lumbercamp', a[0], a[1], ids(v.slice(0, 3))); g.placeBuilding(0, 'pasture', b[0], b[1], ids(v.slice(3, 6)));
      } break;
      case 4: {
        const br = g.buildingsOf(0).find(b => b.type === 'barracks');
        if (!br && !did.b) { did.b = true; const s = spotNear(g, 'barracks', T.x + 4, T.z - 4, 5); g.placeBuilding(0, 'barracks', s[0], s[1], ids(vil().slice(6, 10))); }
        if (br && br.done && !did.t) { did.t = true; for (let i = 0; i < 3; i++) g.train(br.id, 'spearman'); }
      } break;
      case 5: if (!did.w) { const m = ids(g.unitsOf(0).filter(isMil)); did.w = true; g.cmdGroup(0, 1, m); g.cmdFormation(m, 'box'); g.cmdStance(m, 'defensive'); } break;
      case 6: if (!did.a) { did.a = g.ageUp(T.id); if (!did.a) ok(false, 'chapter 7: age-up refused: ' + g.canAgeUp(0).reason); } break;
      case 7: {
        const ar = g.buildingsOf(0).find(b => b.type === 'archery');
        if (!ar && !did.b) { did.b = true; const s = spotNear(g, 'archery', T.x - 4, T.z + 4, 6); ok(g.placeBuilding(0, 'archery', s[0], s[1], ids(vil().slice(10, 14))), 'chapter 8: archery range placed'); }
        if (ar && ar.done && !did.t) { did.t = true; for (let i = 0; i < 3; i++) g.train(ar.id, 'archer'); }
        if (S.ids.raid && !did.save && opts.save) { did.save = true; rep.saveOk = saveRoundTrip(g); }
        if (S.ids.raid && g.time >= (did.atk || 0)) {
          did.atk = g.time + 2;
          const foe = S.ids.raid.map(id => g.getEntity(id)).filter(e => e && !e.dead).sort((a, b) => dist(a, T) - dist(b, T))[0];
          if (foe) g.cmdAttack(ids(g.unitsOf(0).filter(isMil)), foe.id);
        }
      } break;
      case 8: if (g.time >= (did.atk || 0)) {
        did.atk = g.time + 3;
        const etc = g.getEntity(S.ids.enemyTc), m = g.unitsOf(0).filter(isMil), guard = (S.ids.guards || []).map(id => g.getEntity(id)).filter(e => e && !e.dead)[0];
        const tgt = guard || etc; if (tgt && m.length) g.cmdAttack(ids(m), tgt.id);
      } break;
    }
  }
  return rep;
}
function saveRoundTrip(g) {
  const o = JSON.parse(JSON.stringify(g.serialize())), h = Game.deserialize(o);
  return h.hash() === g.hash() && h.quests instanceof TutorialSystem && h.quests.s.step === g.quests.s.step && JSON.stringify(h.quests.s.ids) === JSON.stringify(g.quests.s.ids) && h.ais.length === 0;
}

// ---- setup
{
  const g = new Game({ ...TUT_CFG });
  const tq = g.quests, tc0 = g.buildingsOf(0).find(b => b.type === 'towncenter'), tc1 = g.buildingsOf(1).find(b => b.type === 'towncenter');
  ok(tq instanceof TutorialSystem && g.ais.length === 0, 'tutorial: TutorialSystem in the quests slot, no AI');
  ok(g.unitsOf(1).length === 3 && g.unitsOf(1).every(u => u.type === 'spearman' && u.stance === 'defensive') && g.players[1].pop === 3, 'rival: villagers removed, 3 guards (pop 3)');
  ok(g.units.filter(u => u.owner === 1).length === 3 && [...g.entities.values()].filter(e => e.kind === 'unit' && e.owner === 1).length === 3, 'rival: removed units gone from units and entities');
  ok(g.buildingsOf(1).some(b => b.type === 'barracks' && b.done), 'rival: finished barracks');
  ok(g.unitsOf(0).length === 21 && g.players[0].pop === 21, 'player: normal start (20 villagers + 1 spearman)');
  ok(!!tc0 && !!tc1 && landPath(g, tc0, tc1), 'land path between the two Town Centers (seed ' + TUT_CFG.seed + ')');
  ok(tq.list.length === 1 && tq.s.msg && tq.s.msg.kind === 'intro', 'chapter 1 open with its story lines');
  // no trigger before "Devam", and the game does not end on its own
  for (let i = 0; i < 30 * 120; i++) g.update(DT);
  ok(tq.s.step === 0 && tq.s.phase === 'story' && !g.over, 'nothing advances without "Devam"; no early end');
  ok(g.ageWait(0) === 0, 'tutorial: no minimum stay before the Bronze Age');
}

// ---- a player who does nothing: stuck hints, the raid on its timeout, the Town Center clamp and help spawns
{
  const g = new Game({ ...TUT_CFG }), tq = g.quests, run = (s) => { for (let i = 0; i < Math.round(s * 30); i++) g.update(DT); };
  tq.ack('go'); run(130);
  ok(tq.s.step === 0 && tq.s.phase === 'play' && tq.s.hint && tq.s.hint.seq === 3, 'idle in chapter 1: a stuck hint every 40 s (' + (tq.s.hint && tq.s.hint.seq) + ')');
  tq._enter(7); run(1); tq.ack('go'); run(89);
  ok(!tq.s.ids.raid, 'chapter 8: no raid before its timeout');
  run(2);
  ok(Array.isArray(tq.s.ids.raid) && tq.s.ids.raid.length === 6 && g.unitsOf(1).length === 9, 'chapter 8: 6 raiders 90 s after "Devam"');
  const tc = g.buildingsOf(0).find(b => b.type === 'towncenter'), mil0 = g.unitsOf(0).filter(isMil).length;
  const hp0 = tc.hp; tc.hp = 50; run(DT); ok(tc.hp >= Math.ceil(tc.maxHp * 0.3), 'chapter 8: the hp clamp lifts a battered Town Center back to 30 %'); tc.hp = hp0;
  run(240);
  ok(!!tc && !tc.dead && tc.hp >= Math.ceil(tc.maxHp * 0.3) - 1, 'chapter 8: the Town Center holds at 30 % (' + (tc && Math.round(tc.hp)) + '/' + (tc && tc.maxHp) + ')');
  ok(g.unitsOf(0).filter(isMil).length > mil0 || tq.s.helpAt > 0, 'chapter 8: help arrives when the player has under 2 soldiers');
  ok(!g.over, 'chapter 8: no defeat');
}

// ---- full run
const t0 = Date.now();
const A = play({ save: true });
console.log('  chapters done at (s): ' + A.doneAt.map(([id, t]) => id.replace('tut-', '') + ' ' + t).join(', '));
ok(A.doneAt.length === TUT_CHAPTERS, 'every chapter completes (' + A.doneAt.length + '/' + TUT_CHAPTERS + ')');
ok(!!A.g.over && A.g.over.won === true, 'the match ends in victory');
ok(A.g.quests.s.phase === 'over' && A.g.quests.s.won === true, 'tutorial finished');
ok(A.raidTick != null, 'the raid spawned (tick ' + A.raidTick + ')');
ok(A.saveOk === true, 'a save during the raid loads back (same hash and tutorial state)');
ok(A.g.time < 30 * 60, 'played in ' + Math.round(A.g.time) + ' s of game time');
ok(A.g.players.every(p => !p.defeated), 'nobody was "defeated" by the normal win check');
const B = play();
ok(B.raidTick === A.raidTick && B.g.hash() === A.g.hash(), 'deterministic: a second run gives the same raid tick and hash ' + A.g.hash());
console.log('  ' + ((Date.now() - t0) / 1000).toFixed(1) + ' s wall');

console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL OK');
process.exit(fails.length ? 1 : 0);
