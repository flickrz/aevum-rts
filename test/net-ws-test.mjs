// Aevum - WebSocket transport + adaptive lockstep over the real node relay (server.js, AEVUM_NO_AUTH=1).
// Two NetSessions on real Game sims play 25 s of real time with ~200 ms (+-40 ms jitter) one-way latency added
// on every outgoing message (like Turkey <-> a US relay), the joiner starting late as on the real site.
// Checks: the WebSocket connects, pings measure the latency, the input delay adapts to it, play is smooth
// (few stalls, ~real-time ticks), and both games stay bit-identical.
// Run: node test/net-ws-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { NetSession, STEP, TURN_TICKS } from '../src/net/session.js';
import { WSTransport, wsProbe } from '../src/net/transport-ws.js';
import * as G from '../src/sim/game.js';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
if (typeof WebSocket === 'undefined') { console.log('SKIP: this node has no global WebSocket (needs node 22+)'); process.exit(0); }

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 5600 + Math.floor(Math.random() * 300);
const srv = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(PORT), AEVUM_NO_AUTH: '1' }), stdio: ['ignore', 'pipe', 'pipe'] });
let srvOut = ''; srv.stdout.on('data', d => { srvOut += d; }); srv.stderr.on('data', d => { srvOut += d; });
const BASE = 'http://127.0.0.1:' + PORT;
for (let i = 0; i < 50 && !/calisiyor/.test(srvOut); i++) await sleep(100);

try {
  ok(await wsProbe(BASE, 3000), 'WebSocket probe passes through the relay');

  // ~200 ms one-way with jitter, order kept (a WebSocket is ordered)
  const LAT = 200, JIT = 40;
  let rnd = 7; const rand = () => { rnd = (rnd * 1103515245 + 12345) & 0x7fffffff; return rnd / 0x7fffffff; };
  class SlowWS extends WSTransport {
    send(topic, data) {
      const at = Math.max(this._nextAt || 0, Date.now() + LAT + (rand() * 2 - 1) * JIT);
      this._nextAt = at;
      const copy = JSON.parse(JSON.stringify(data));
      setTimeout(() => super.send(topic, copy), at - Date.now());
    }
  }
  const A = new NetSession(new SlowWS(BASE), { name: 'Ali' }), B = new NetSession(new SlowWS(BASE), { name: 'Veli' });
  let started = [null, null], stalls = [0, 0], desync = 0;
  [A, B].forEach((s, i) => { s.on('start', p => { started[i] = p.cfg; }); s.on('stall', () => stalls[i]++); s.on('desync', () => desync++); });
  const code = await A.host();
  await B.join(code);
  ok(A.state.slots.length === 2, 'joiner reached the host over WebSocket');
  ok(typeof B.t.hostPeer === 'string' && B.t.hostPeer === A.t.id, 'the relay hello names the room creator as host (joiner hostPeer ' + B.t.hostPeer + ', creator ' + A.t.id + ')');
  A.addAI(2, 'easy'); B.setTeam(1); B.setReady(true);
  for (let i = 0; i < 60 && !A.canStart().ok; i++) await sleep(100);
  A.start();
  for (let i = 0; i < 60 && !started[1]; i++) await sleep(50);
  ok(started[0] && started[1], 'both clients started');
  // (the late 'start' listener path: a session that started before anybody listened still delivers it)
  let late = null; B.on('start', p => { late = p; }); await sleep(10);
  ok(late === null, 'start is not replayed to a listener once somebody already handled it');

  const games = started.map(c => new G.Game(Object.assign({}, c)));
  const S = [A, B];
  let issued = 0;
  const t0 = Date.now(), last = [t0, t0];
  const RUN = 25000;
  while (Date.now() - t0 < RUN) {
    for (let i = 0; i < 2; i++) {
      const now = Date.now(), dt = (now - last[i]) / 1000; last[i] = now;
      if (rand() < 0.03) {
        const me = started[i].me, g = games[i];
        const mine = (g.units || []).filter(u => u.owner === me && !u.dead).slice(0, 6).map(u => u.id);
        if (mine.length) { S[i].issue('cmdMove', [mine, 40 + rand() * 30, 40 + rand() * 30, false]); issued++; }
      }
      S[i].advance(games[i], dt);
    }
    await sleep(16);
  }
  const secs = RUN / 1000;
  console.log('  ticks ' + A.tick + ' / ' + B.tick + ' in ' + secs + ' s; stalls ' + stalls.join('/') + '; delay ' + A.delay + '/' + B.delay + ' turns; ping ' + JSON.stringify(A.netInfo()) + ' ' + JSON.stringify(B.netInfo()));
  ok(A.netInfo().ping > 300 && B.netInfo().ping > 300, 'pings measure the ~400 ms round trip between the players');
  { const need = (s, p) => Math.ceil((s._rttOf(p) / 2 + 70) / 100);   // (one-way trip + margin, in 100 ms turns)
    ok(A.delay >= need(A, started[1].me) && B.delay >= need(B, started[0].me), 'input delay covers the measured round trip (' + A.delay + ', ' + B.delay + ' turns)'); }
  ok(Math.min(A.tick, B.tick) > secs * 30 * 0.85, 'both ran close to real time (' + A.tick + ', ' + B.tick + ' of ' + secs * 30 + ' ticks)');
  ok(stalls[0] + stalls[1] <= 3, 'smooth: at most 3 visible stalls in ' + secs + ' s (' + stalls.join('+') + ')');
  ok(Math.abs(A.tick - B.tick) <= 30, 'pacing keeps the two clients within a second of each other (' + Math.abs(A.tick - B.tick) + ' ticks)');

  // bring both to the same tick and compare
  const target = Math.max(A.tick, B.tick) + 30;
  for (let k = 0; k < 3000 && (A.tick < target || B.tick < target); k++) {
    for (let i = 0; i < 2; i++) if (S[i].tick < target) { S[i]._acc = 0; S[i]._slow = false; S[i].advance(games[i], STEP); }
    await sleep(2);
  }
  ok(A.tick === target && B.tick === target, 'both reached tick ' + target);
  ok(games[0].hash() === games[1].hash() && desync === 0, 'identical game state (hash ' + games[0].hash() + ' / ' + games[1].hash() + '), no desync');
  ok(A.execCount === B.execCount && A.execCount >= issued * 0.8, 'every command executed on both (' + A.execCount + ' of ' + issued + ' issued)');
  // pause for everybody: both stop at the same turn, no orders meanwhile, both resume, still identical
  const pauses = [[], []]; A.on('pause', e => pauses[0].push(e)); B.on('pause', e => pauses[1].push(e));
  const runReal = async (ms) => { const t1 = Date.now(), l = [t1, t1]; while (Date.now() - t1 < ms) { for (let i = 0; i < 2; i++) { const n = Date.now(); S[i].advance(games[i], (n - l[i]) / 1000); l[i] = n; } await sleep(16); } };
  B.requestPause(true);
  await runReal(1500);
  const gt = games.map(x => x.tick);
  await runReal(1000);
  ok(A.paused && B.paused && pauses[0][0] && pauses[1][0] && pauses[0][0].turn === pauses[1][0].turn && pauses[0][0].by === 'Veli', 'pause reached both clients at the same turn (by Veli)');
  ok(games[0].tick === gt[0] && games[1].tick === gt[1], 'the simulation stood still while paused (ticks ' + gt.join('/') + ')');
  ok(!A.issue('cmdStop', [[1]]), 'no orders while paused');
  A.requestPause(false);
  await runReal(1500);
  ok(!A.paused && !B.paused && pauses[0][1] && pauses[1][1] && pauses[0][1].turn === pauses[1][1].turn, 'resumed on both at the same turn');
  ok(games[0].tick > gt[0] && games[1].tick > gt[1], 'the simulation runs again after the resume');
  const target3 = Math.max(A.tick, B.tick) + 30;
  for (let k = 0; k < 3000 && (A.tick < target3 || B.tick < target3); k++) {
    for (let i = 0; i < 2; i++) if (S[i].tick < target3) { S[i]._acc = 0; S[i]._slow = false; S[i].advance(games[i], STEP); }
    await sleep(2);
  }
  ok(games[0].hash() === games[1].hash() && games[0].tick === games[1].tick, 'still identical after pause + resume (game tick ' + games[0].tick + ')');

  // map flare: reaches the teammate with the sender's slot and name; a burst is rate limited
  let fl = null; B.on('flare', f => { fl = f; });
  ok(A.flare(33.3, 44.4) && !A.flare(1, 1), 'flare sent; a second one within 0.5 s is dropped');
  for (let i = 0; i < 40 && !fl; i++) await sleep(25);
  ok(fl && fl.pid === started[0].me && fl.name === 'Ali' && fl.x === 33.3 && fl.z === 44.4, 'teammate got the flare from Ali at (33.3, 44.4)');
  A.close(); B.close();
} catch (e) {
  failed++; console.log('  FAIL ' + (e && e.stack || e));
} finally {
  srv.kill();
}
console.log(failed ? '\n' + failed + ' check(s) FAILED' : '\nALL OK');
process.exit(failed ? 1 : 0);
