// Aevum - lockstep network test: in-memory lossy hub, 3 NetSessions (host + 2 joiners), real Game sims.
// Run: node test/net-test.mjs
import { NetSession, STEP, TURN_TICKS, DELAY, desyncVerdict } from '../src/net/session.js';
import * as G from '../src/sim/game.js';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } };

// ---------- deterministic test RNG ----------
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const netRnd = mulberry(4242);

// ---------- fake clock ----------
const clock = {
  t: 0, timers: [], nextId: 1, paused: new Set(),
  now() { return this.t; },
  setInterval(fn, ms) { const id = this.nextId++; this.timers.push({ id, fn, ms, at: this.t + ms, owner: clock._owner }); return id; },
  clearInterval(id) { this.timers = this.timers.filter(x => x.id !== id); },
  fire() {
    for (const x of this.timers.slice()) {
      if (x.owner && this.paused.has(x.owner)) continue;
      while (x.at <= this.t && this.timers.includes(x)) { x.at += x.ms; x.fn(); }
    }
  },
};
const makeClock = owner => ({
  now: () => clock.now(),
  setInterval: (fn, ms) => { clock._owner = owner; const id = clock.setInterval(fn, ms); clock._owner = null; return id; },
  clearInterval: id => clock.clearInterval(id),
});

// ---------- in-memory hub with latency, 15 % loss and reordering ----------
const LOSS = 0.15, LAT_MAX = 250;
const hub = {
  rooms: new Map(), queue: [], sent: new Map(), maxSize: 0,
  deliver() {
    const due = this.queue.filter(m => m.at <= clock.t);
    if (!due.length) return;
    this.queue = this.queue.filter(m => m.at > clock.t);
    for (const m of due) { if (!m.to.closed && !clock.paused.has(m.to.id)) m.to._recv(m.topic, m.data, m.from); else if (!m.to.closed) { m.at = clock.t + 10; this.queue.push(m); } }
  },
};
class MemTransport {
  constructor(id) { this.id = id; this.h = new Map(); this.pf = []; this.room = null; this.closed = false; }
  async connect(room) {
    this.room = room;
    let r = hub.rooms.get(room); if (!r) { r = new Set(); hub.rooms.set(room, r); }
    for (const o of r) { o._peers({ joined: [this.id], left: [] }); }
    r.add(this);
  }
  _peers(ch) { const r = hub.rooms.get(this.room); ch.peers = [...r].filter(o => o !== this).map(o => o.id); for (const f of this.pf) f(ch); }
  send(topic, data) {
    if (this.closed || !this.room) return;
    const s = JSON.stringify(data);
    hub.maxSize = Math.max(hub.maxSize, s.length);
    const k = this.id + ':' + Math.floor(clock.t / 1000);
    hub.sent.set(k, (hub.sent.get(k) || 0) + 1);
    const kt = k + ':' + topic; hub.byTopic = hub.byTopic || new Map(); hub.byTopic.set(kt, (hub.byTopic.get(kt) || 0) + 1);
    for (const o of hub.rooms.get(this.room)) {
      if (o === this) continue;
      if (netRnd() < LOSS) continue;
      hub.queue.push({ to: o, from: this.id, topic, data: JSON.parse(s), at: clock.t + netRnd() * LAT_MAX });
    }
  }
  _recv(topic, data, from) { for (const f of this.h.get(topic) || []) f(data, from); }
  on(topic, fn) { if (!this.h.has(topic)) this.h.set(topic, []); this.h.get(topic).push(fn); }
  peers() { return [...hub.rooms.get(this.room)].filter(o => o !== this).map(o => o.id); }
  onPeers(fn) { this.pf.push(fn); }
  close() {
    if (this.closed) return; this.closed = true;
    const r = hub.rooms.get(this.room); if (!r) return;
    r.delete(this);
    for (const o of r) o._peers({ joined: [], left: [this.id] });
  }
}

// ---------- game factory (real sim, stub fallback) ----------
const realSim = typeof G.Game?.prototype?.execCommand === 'function' && typeof G.Game?.prototype?.hash === 'function';
class StubGame {
  constructor(cfg) { this.cfg = cfg; this.tick = 0; this.s = cfg.seed | 0; this.players = cfg.players.map((p, i) => Object.assign({ id: i }, p)); this.me = cfg.me; this.mp = true; this.units = []; }
  update() { this.tick++; this.s = Math.imul(this.s ^ this.tick, 2654435761) >>> 0; }
  execCommand(pid, m, a) { this.s = Math.imul(this.s ^ (pid * 31 + m.length + JSON.stringify(a).length), 16777619) >>> 0; return true; }
  hash() { return (this.s ^ this.tick) >>> 0; }
  markLeft(pid) { this.players[pid].left = true; }
}
const makeGame = cfg => realSim ? new G.Game(Object.assign({}, cfg)) : new StubGame(cfg);
console.log(realSim ? 'Using the real Game sim (execCommand + hash present).' : 'NOTE: Game.execCommand/hash missing -> using a stub game.');

// ---------- sessions ----------
const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
async function runFor(ms, step = 1000 / 60, onFrame) {
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.t += step;
    hub.deliver(); clock.fire();
    if (onFrame) onFrame(step / 1000);
    await flush();
  }
}

const names = ['Host', 'Ayse', 'Mehmet'];
const S = names.map((n, i) => new NetSession(new MemTransport('peer' + i), { clock: makeClock('peer' + i), name: n, log: true }));
const ev = S.map(() => ({ stall: 0, resume: 0, desync: 0, peerLeft: [], start: null, lobby: 0 }));
S.forEach((s, i) => {
  s.on('stall', () => ev[i].stall++); s.on('resume', () => ev[i].resume++);
  s.on('desync', d => { ev[i].desync++; console.log('  desync on', names[i], d); });
  s.on('peerLeft', d => ev[i].peerLeft.push(d)); s.on('start', d => { ev[i].start = d; });
  s.on('lobby', () => ev[i].lobby++);
});

console.log('Lobby');
const code = await S[0].host();
ok(/^[A-Z0-9]{5}$/.test(code), 'host() returns a 5-char code: ' + code);
const joins = [S[1].join(code), S[2].join(code)];
let joined = false; Promise.all(joins).then(() => { joined = true; });
for (let i = 0; i < 400 && !joined; i++) await runFor(25);
ok(joined, 'both joiners got into the lobby');
S[1].setTeam(1); S[2].setTeam(2); S[2].setName('Mehmet2');
S[0].addAI(2, 'normal'); S[0].addAI(1, 'easy');
ok(S[0].state.settings.mapType === 'random', 'new lobby defaults to mapType random');
S[0].setSettings({ mapSize: 96, startRes: 'normal', mapType: 'islands' });
S[0].setSettings({ mapType: 'volcano' });
ok(S[0].state.settings.mapType === 'islands', 'setSettings accepts a valid mapType and rejects an invalid one');
await runFor(3000);
ok(S[1].state.settings.mapType === 'islands' && S[2].state.settings.mapType === 'islands', 'joiners see mapType islands in the lobby state');
S[1].setReady(true); S[2].setReady(true);
await runFor(3000);
const st = S[0].state;
ok(st.slots.length === 5, 'host lobby has 5 slots (3 humans + 2 AI)');
ok(S[1].state.slots.length === 5 && S[2].state.slots.length === 5, 'joiners see the same roster (re-broadcast)');
const sl1 = st.slots.find(x => x.peer === 'peer1'), sl2 = st.slots.find(x => x.peer === 'peer2');
ok(sl2.name === 'Mehmet2' && sl2.team === 2 && sl1.ready && sl2.ready, 'setName/setTeam/setReady reached the host');
ok(S[0].canStart().ok, 'host can start');
S[0].start();
for (let i = 0; i < 200 && !(ev[1].start && ev[2].start); i++) await runFor(25);
ok(ev.every(e => e.start), 'every client received start (re-sent until acked)');
const cfgs = ev.map(e => e.start.cfg);
ok(cfgs.every((c, i) => S[0].start0.slots[c.me].peer === 'peer' + i) && new Set(cfgs.map(c => c.me)).size === 3, 'each client derived its own me (' + cfgs.map(c => c.me).join(',') + ')');
const P2 = cfgs[2].me;
const strip = c => JSON.stringify(Object.assign({}, c, { me: 0 }));
ok(strip(cfgs[0]) === strip(cfgs[1]) && strip(cfgs[0]) === strip(cfgs[2]), 'all cfgs identical except me');
ok(cfgs.every(c => c.mapType === 'islands'), 'every client built its Game cfg with mapType islands');
ok(NetSession.cfgFrom({ settings: { mapSize: 128 }, slots: [{ kind: 'human', peer: 'x', team: 1 }], seed: 1 }, 'x').mapType === 'river', 'settings without mapType (old host/record) fall back to river');

const games = cfgs.map(makeGame);
const rnds = [mulberry(11), mulberry(22), mulberry(33)];
const active = [true, true, true], frozen = [false, false, false];
let scripted = true, issued = [0, 0, 0];
function script(i) {
  if (!scripted || rnds[i]() > 0.02) return;
  const g = games[i], me = cfgs[i].me;
  const mine = (g.units || []).filter(u => u.owner === me && !u.dead);
  const r = rnds[i]();
  if (mine.length && r < 0.7) {
    const ids = mine.filter(() => rnds[i]() < 0.5).map(u => u.id).slice(0, 12);
    if (!ids.length) ids.push(mine[0].id);
    const p = g.players[me];
    S[i].issue('cmdMove', [ids, (p.startX || 40) + (rnds[i]() - 0.5) * 20, (p.startZ || 40) + (rnds[i]() - 0.5) * 20, false]);
  } else if (r < 0.85) {
    const tc = (g.buildings || []).find(b => b.owner === me && !b.dead);
    S[i].issue('train', [tc ? tc.id : 0, 'villager']);
  } else {
    S[i].issue('cmdStop', [mine.slice(0, 3).map(u => u.id)]);
  }
  issued[i]++;
}
const frame = dt => {
  for (let i = 0; i < 3; i++) {
    if (!active[i] || frozen[i]) continue;
    script(i);
    S[i].advance(games[i], dt);
  }
};

console.log('Match (3 simulated minutes, 15% loss, 0-250 ms latency)');
const t0 = Date.now();
await runFor(60000, 1000 / 60, frame);
// pause client 2 for 2 s (no frames, no timers, no incoming deliveries)
const stallBefore = ev[0].stall + ev[1].stall;
frozen[2] = true; clock.paused.add('peer2');
await runFor(2000, 1000 / 60, frame);
frozen[2] = false; clock.paused.delete('peer2');
await runFor(118000, 1000 / 60, frame);
ok(ev[0].stall + ev[1].stall > stallBefore, 'pausing a client for 2 s stalls the others (stall events: ' + (ev[0].stall + ev[1].stall) + ')');
ok(ev[0].resume >= ev[0].stall && ev[1].resume >= ev[1].stall, 'every stall was followed by resume');

let maxRate = 0; for (const v of hub.sent.values()) maxRate = Math.max(maxRate, v);
// bring everyone to the same tick, then compare
scripted = false;
const target = Math.max(...S.map(s => s.tick)) + 30 * TURN_TICKS;
for (let k = 0; k < 20000 && S.some(s => s.tick < target); k++) {
  clock.t += 5; hub.deliver(); clock.fire();
  for (let i = 0; i < 3; i++) if (S[i].tick < target) { S[i]._acc = 0; S[i]._slow = false; S[i].advance(games[i], STEP); }
  await flush();
}
ok(S.every(s => s.tick === target), 'all clients reached tick ' + target + ' (' + S.map(s => s.tick).join('/') + ')');
ok(S[0].tick > 3 * 60 * 30 * 0.9, 'simulation advanced ~real time (' + S[0].tick + ' ticks)');
const L = S.map(s => JSON.stringify(s._log));
ok(L[0] === L[1] && L[0] === L[2], 'identical command streams in identical order at identical ticks (' + S[0]._log.length + ' commands, issued ' + issued.join('+') + ')');
ok(S[0].execCount === issued.reduce((a, b) => a + b, 0), 'every issued command executed exactly once');
const H = games.map(g => g.hash());
ok(H[0] === H[1] && H[0] === H[2], 'equal game.hash() at the end: ' + H.join(' / '));
ok(ev.every(e => e.desync === 0), 'no desync reported');
let worst = null; for (const [k, v] of hub.sent) if (v === maxRate) worst = k;
let tot = 0, cnt = 0; for (const v of hub.sent.values()) { tot += v; cnt++; }
console.log('  average ' + (tot / cnt).toFixed(1) + ' msgs/s per client; worst second', worst, [...hub.byTopic].filter(([k]) => k.startsWith(worst + ':')).map(([k, v]) => k.split(':').pop() + '=' + v).join(' '));
if (false) console.log('  worst second', worst, [...hub.byTopic].filter(([k]) => k.startsWith(worst + ':')).map(([k, v]) => k.split(':').pop() + '=' + v).join(' '));
ok(tot / cnt <= 18 && maxRate <= 26, 'message budget: avg <= 18/s, peak ' + maxRate + ' msgs/s per client (peak = catch-up second after a stall)');
ok(hub.maxSize <= 3500, 'largest message ' + hub.maxSize + ' bytes (<= 3500)');

console.log('Disconnect');
scripted = true;
await runFor(5000, 1000 / 60, frame);
// the client vanishes without a 'bye' (crash): dropped after DROP_SILENT_MS (60 s) of silence while the others talk
active[2] = false; S[2].t.close(); clock.paused.add('peer2');
await runFor(30000, 1000 / 60, frame);
ok(!S[0].leftAt.has(P2) && !S[1].leftAt.has(P2), 'a silent client is NOT dropped after 30 s (limit 60 s)');
await runFor(40000, 1000 / 60, frame);
ok(S[0].leftAt.has(P2) && S[1].leftAt.has(P2), 'vanished client dropped on host and joiner');
ok(S[0].leftAt.get(P2) === S[1].leftAt.get(P2), 'dropped at the same turn (' + S[0].leftAt.get(P2) + ' / ' + S[1].leftAt.get(P2) + ')');
ok(games[0].players[P2].left && games[1].players[P2].left, 'game.players[P2].left set on both');
ok(ev[0].peerLeft.length === 1 && ev[1].peerLeft.length === 1, 'peerLeft emitted once on each');
// (the lockstep waits for the silent player until the drop, then runs on)
const tDrop = S[0].tick;
await runFor(5000, 1000 / 60, frame);
ok(S[0].tick > tDrop + 4 * 30 && S[1].tick > tDrop + 4 * 30, 'game keeps running after the drop (' + S[0].tick + ' / ' + S[1].tick + ')');
scripted = false;
const target2 = Math.max(S[0].tick, S[1].tick) + 30;
for (let k = 0; k < 20000 && (S[0].tick < target2 || S[1].tick < target2); k++) {
  clock.t += 5; hub.deliver(); clock.fire();
  for (let i = 0; i < 2; i++) if (S[i].tick < target2) { S[i]._acc = 0; S[i]._slow = false; S[i].advance(games[i], STEP); }
  await flush();
}
ok(JSON.stringify(S[0]._log) === JSON.stringify(S[1]._log) && games[0].hash() === games[1].hash(), 'host and joiner still identical after the drop');
// desync vote (room Q8YQ7: the host split off from 3 others): the odd one out learns it is the one off the match
{
  const v0 = desyncVerdict(0, 0xaa, new Map([[1, 0xbb], [2, 0xbb], [3, 0xbb]]), 0);
  ok(v0.diverged && v0.odd.join() === '0' && v0.good.join() === '1,2,3', 'vote: the host alone with another hash is the one that split off');
  const v2 = desyncVerdict(2, 0xbb, new Map([[0, 0xaa], [1, 0xbb], [3, 0xbb]]), 0);
  ok(!v2.diverged && v2.odd.join() === '0', 'vote: a majority player is told who split off');
  const t1 = desyncVerdict(1, 0xbb, new Map([[0, 0xaa]]), 0), t0v = desyncVerdict(0, 0xaa, new Map([[1, 0xbb]]), 0);
  ok(t1.diverged && !t0v.diverged && t1.odd.join() === '1' && t0v.odd.join() === '1', 'vote: a 1-1 tie goes to the authority, both sides agree');
}

console.log('Protocol optimizations (reliable no-redundancy, micro-stall, no 90ms brake, RTT need-wait, 2-client lossy)');
{
  const mkCapTransport = (id, reliable) => {
    const sent = [];
    const t = {
      id, reliable, up: true, kind: reliable ? 'ws' : 'poll',
      async connect() {}, send(topic, data) { sent.push({ topic, data: JSON.parse(JSON.stringify(data)), at: cNow }); },
      on() {}, peers() { return []; }, onPeers() {}, onStatus() {}, close() {},
    };
    return { t, sent };
  };
  let cNow = 1000;
  const miniClock = { now: () => cNow, setInterval: () => 1, clearInterval: () => {} };
  const stubGame = { tick: 0, update() { this.tick++; }, execCommand() {}, hash: () => 1 };
  const start2 = { settings: { seed: 7 }, seed: 7, slots: [{ kind: 'human', peer: 'p0', name: 'A', team: 1 }, { kind: 'human', peer: 'p1', name: 'B', team: 2 }] };

  // 1. Reliable transport sends no redundancy (`r` omitted on single-turn flush); unreliable keeps `r`
  {
    cNow = 1000;
    const rel = mkCapTransport('p0', true), unrel = mkCapTransport('p0', false);
    const sr = new NetSession(rel.t, { clock: miniClock, name: 'A' });
    const su = new NetSession(unrel.t, { clock: miniClock, name: 'A' });
    sr._beginGame(start2); su._beginGame(start2);
    // pre-fill peer 1 turns so neither stalls
    for (let t = 0; t < 20; t++) { sr.recv.get(1).set(t, []); su.recv.get(1).set(t, []); }
    for (let k = 0; k < 6; k++) {
      cNow += 67;
      sr.advance(stubGame, STEP * TURN_TICKS);
      su.advance(stubGame, STEP * TURN_TICKS);
    }
    const rTurns = rel.sent.filter(m => m.topic === 'turn').slice(1);   // skip turn-0 initial multi-turn fill
    const uTurns = unrel.sent.filter(m => m.topic === 'turn').slice(1);
    ok(rTurns.length >= 4 && rTurns.every(m => m.data.r === undefined), 'reliable transport sends no turn repeat window (r omitted on ' + rTurns.length + ' steady turns)');
    ok(uTurns.length >= 4 && uTurns.every(m => Array.isArray(m.data.r) && m.data.r.length > 0), 'unreliable transport keeps turn repeat window (r present)');
    sr.close(); su.close();
  }

  // 2. No micro-stall delay inflation (< 60 ms waits are ignored; >= 60 ms waits count once per stall)
  {
    cNow = 10000;
    const { t } = mkCapTransport('p0', true);
    const s = new NetSession(t, { clock: miniClock, name: 'A' });
    s._beginGame(start2);
    s.rtt.set(1, [120, 120, 120, 120, 120]);
    s._updateDelay();
    const d0 = s.delay;
    // advance through DELAY-1 so turn === DELAY needs peer 1's list
    for (let k = 0; k < DELAY; k++) { cNow += 67; s.advance(stubGame, STEP * TURN_TICKS); }
    // simulate 8 short micro-stalls of 30 ms (< 60 ms)
    for (let i = 0; i < 8; i++) {
      const needT = s.turn;
      s.advance(stubGame, STEP * TURN_TICKS);      // enters stall at cNow
      cNow += 30;
      s.advance(stubGame, 0.03);                   // still < 60 ms
      s.recv.get(1).set(needT, []);                // peer's packet arrives at +30 ms
      cNow += 5;
      s.advance(stubGame, STEP * TURN_TICKS);      // resumes and advances
      s._updateDelay();
    }
    const microStalls = (s.stalls.get(1) || []).length;
    ok(microStalls === 0 && s.delay === d0, 'micro-stalls (< 60 ms) do not inflate delay (counted ' + microStalls + ', delay ' + d0 + ' -> ' + s.delay + ')');
    // now a real 80 ms stall (>= 60 ms) must count exactly once across multiple ticks/pumps
    s.advance(stubGame, STEP * TURN_TICKS);
    cNow += 80;
    s.advance(stubGame, 0.04);
    s._pump();
    cNow += 40;
    s.advance(stubGame, 0.04);
    const realStalls = (s.stalls.get(1) || []).length;
    ok(realStalls === 1, 'a real stall (>= 60 ms) is counted once per stall period (' + realStalls + ')');
    s.close();
  }

  // 3. The 90 ms send brake is gone: a turn scheduled 67 ms after the previous send flushes immediately
  {
    cNow = 20000;
    const { t, sent } = mkCapTransport('p0', true);
    const s = new NetSession(t, { clock: miniClock, name: 'A' });
    s._beginGame(start2);
    for (let tt = 0; tt < 15; tt++) s.recv.get(1).set(tt, []);
    s.advance(stubGame, STEP * TURN_TICKS);   // flushes initial turns at t=20000
    const before = sent.filter(m => m.topic === 'turn').length;
    cNow += 67;                               // 67 ms < old 90 ms brake
    s.advance(stubGame, STEP * TURN_TICKS);
    const after = sent.filter(m => m.topic === 'turn').length;
    ok(after === before + 1 && s._unsent === 0, '90 ms send brake is gone: turn flushed immediately after 67 ms (sent ' + before + ' -> ' + after + ')');
    s.close();
  }

  // 4. need-wait scales with RTT on reliable transport and requests up to turn + delay
  {
    cNow = 30000;
    const rel = mkCapTransport('p0', true);
    const s = new NetSession(rel.t, { clock: miniClock, name: 'A' });
    s._beginGame(start2);
    s.rtt.set(1, [600, 600, 600, 600, 600]);   // 600 ms RTT -> needWait = 750 ms
    s._updateDelay();
    for (let k = 0; k < DELAY; k++) { cNow += 67; s.advance(stubGame, STEP * TURN_TICKS); }
    s.advance(stubGame, STEP * TURN_TICKS);    // stalls on turn DELAY at cNow
    const stallAt = cNow;
    const needs = () => rel.sent.filter(m => m.topic === 'sync' && Array.isArray(m.data.need));
    cNow = stallAt + 250; s._pump();           // past old 200 ms, below 750 ms
    const at250 = needs().length;
    cNow = stallAt + 700; s._pump();           // still below 750 ms
    const at700 = needs().length;
    cNow = stallAt + 760; s._pump();           // past 750 ms -> must send need
    const sentNeeds = needs();
    const maxReq = sentNeeds.length ? Math.max(...sentNeeds[0].data.need) : -1;
    ok(at250 === 0 && at700 === 0 && sentNeeds.length === 1, 'need-wait scales with RTT on reliable transport (600 ms RTT -> 0 at 250/700 ms, 1 at 760 ms)');
    ok(maxReq === s.turn + s.delay && s.delay > DELAY, 'need request covers full adaptive delay window (' + s.turn + '..' + maxReq + ', delay=' + s.delay + ')');
    s.close();
  }

  // 5. Two clients over a lossy MemTransport (15% loss, 0-250 ms latency) stay in sync with identical hashes
  {
    const waitFor = async (fn, ms = 8000) => { const end = clock.t + ms; while (clock.t < end && !fn()) { clock.t += 20; hub.deliver(); clock.fire(); await flush(); } };
    const T2 = ['lossy0', 'lossy1'].map(id => new MemTransport(id));
    const S2 = T2.map((t, i) => new NetSession(t, { clock: makeClock(t.id), name: ['Derya', 'Eren'][i] }));
    const cfgs2 = [null, null], desync2 = [0, 0];
    S2.forEach((s, i) => { s.on('start', d => { cfgs2[i] = d.cfg; }); s.on('desync', () => { desync2[i]++; }); });
    const code2 = await S2[0].host();
    let j2 = false; S2[1].join(code2).then(() => { j2 = true; });
    await waitFor(() => j2 && S2[0].state.slots.filter(s => s.kind === 'human').length === 2);
    S2[1].setTeam(2); S2[1].setReady(true);
    S2[0].setSettings({ mapSize: 160, seed: 91919, fog: 'explored' });
    await waitFor(() => S2[0].canStart().ok);
    await S2[0].start();
    await waitFor(() => cfgs2.every(Boolean));
    const G2 = cfgs2.map(c => new G.Game(Object.assign({}, c)));
    const sr2 = mulberry(9191);
    let iss2 = 0;
    await runFor(30000, 1000 / 60, dt => {
      for (let i = 0; i < 2; i++) {
        if (sr2() < 0.04) {
          const me = cfgs2[i].me, mine = G2[i].units.filter(u => u.owner === me && !u.dead);
          if (mine.length) { S2[i].issue('cmdMove', [mine.slice(0, 4).map(u => u.id), 30 + sr2() * 90, 30 + sr2() * 90, false]); iss2++; }
        }
        S2[i].advance(G2[i], dt);
      }
    });
    const tgt2 = Math.max(S2[0].tick, S2[1].tick) + 20 * TURN_TICKS;
    for (let k = 0; k < 10000 && (S2[0].tick < tgt2 || S2[1].tick < tgt2); k++) {
      clock.t += 5; hub.deliver(); clock.fire();
      for (let i = 0; i < 2; i++) if (S2[i].tick < tgt2) { S2[i]._acc = 0; S2[i]._slow = false; S2[i].advance(G2[i], STEP); }
      await flush();
    }
    ok(S2[0].tick === tgt2 && S2[1].tick === tgt2 && G2[0].hash() === G2[1].hash() && desync2[0] === 0 && desync2[1] === 0 && S2[0].execCount === iss2 && S2[1].execCount === iss2,
      '2-client lossy MemTransport stays in sync with identical hashes (' + G2[0].hash() + ' / ' + G2[1].hash() + ', ' + iss2 + ' cmds, tick ' + tgt2 + ')');
    S2.forEach(s => s.close());
  }

  // 6. Lobby spectator slot ("İzle"): 2 active players + 1 spectator over lossy MemTransport stay in sync
  {
    const waitFor = async (fn, ms = 8000) => { const end = clock.t + ms; while (clock.t < end && !fn()) { clock.t += 20; hub.deliver(); clock.fire(); await flush(); } };
    const T3 = ['spec0', 'spec1', 'spec2'].map(id => new MemTransport(id));
    const S3 = T3.map((t, i) => new NetSession(t, { clock: makeClock(t.id), name: ['Ali', 'Veli', 'Izleyici'][i] }));
    const cfgs3 = [null, null, null], desync3 = [0, 0, 0];
    S3.forEach((s, i) => { s.on('start', d => { cfgs3[i] = d.cfg; }); s.on('desync', () => { desync3[i]++; }); });
    const code3 = await S3[0].host();
    let j1 = false, j2 = false;
    S3[1].join(code3).then(() => { j1 = true; });
    S3[2].join(code3).then(() => { j2 = true; });
    await waitFor(() => j1 && j2 && S3[0].state.slots.length === 3);
    // 1 active + 2 spectators cannot start; 2 active on same team + 1 spectator cannot start
    S3[1].setTeam(0); S3[2].setTeam(0); S3[1].setReady(true); S3[2].setReady(true);
    await waitFor(() => S3[0].state.slots.filter(s => s.spectator).length === 2 && S3[0].state.slots.every(s => s.ready));
    ok(!S3[0].canStart().ok, 'cannot start with only 1 active player + 2 spectators');
    // move peer 1 to team 2, keep peer 2 as spectator -> canStart ok
    S3[1].setTeam(2);
    S3[0].setSettings({ mapSize: 160, seed: 51515, fog: 'dark' });
    await waitFor(() => S3[0].canStart().ok);
    const spSlot = S3[0].state.slots.find(s => s.peer === 'spec2');
    ok(spSlot && spSlot.spectator === true && S3[0].state.slots.filter(s => s.spectator).length === 1, 'lobby setTeam(0) marks human spectator and setTeam(2) clears it');
    await S3[0].start();
    await waitFor(() => cfgs3.every(Boolean));
    const G3 = cfgs3.map(c => new G.Game(Object.assign({}, c)));
    const specIdx = cfgs3.findIndex(c => c.players[c.me].spectator);
    ok(specIdx === 2 && G3[specIdx].fog.every(v => v === 2) && G3[specIdx].unitsOf(cfgs3[specIdx].me).length === 0, 'spectator client starts with full map vision and 0 units');
    ok(S3[specIdx].issue('cmdTownBell', [cfgs3[specIdx].me]) === false && S3[specIdx].flare(50, 50) === false && S3[specIdx].requestPause(true) === false && S3[specIdx].requestSave(false) === null, 'spectator session refuses commands/flare/pause/save');
    const sr3 = mulberry(5151);
    let iss3 = 0;
    await runFor(25000, 1000 / 60, dt => {
      for (let i = 0; i < 3; i++) {
        if (i !== specIdx && sr3() < 0.04) {
          const me = cfgs3[i].me, mine = G3[i].units.filter(u => u.owner === me && !u.dead);
          if (mine.length) { S3[i].issue('cmdMove', [mine.slice(0, 4).map(u => u.id), 30 + sr3() * 90, 30 + sr3() * 90, false]); iss3++; }
        }
        S3[i].advance(G3[i], dt);
      }
    });
    const tgt3 = Math.max(...S3.map(s => s.tick)) + 20 * TURN_TICKS;
    for (let k = 0; k < 10000 && S3.some(s => s.tick < tgt3); k++) {
      clock.t += 5; hub.deliver(); clock.fire();
      for (let i = 0; i < 3; i++) if (S3[i].tick < tgt3) { S3[i]._acc = 0; S3[i]._slow = false; S3[i].advance(G3[i], STEP); }
      await flush();
    }
    const H3 = G3.map(g => g.hash());
    ok(S3.every(s => s.tick === tgt3) && H3[0] === H3[1] && H3[0] === H3[2] && desync3.every(d => d === 0) && S3.every(s => s.execCount === iss3),
      '3-client match (2 active + 1 spectator) stays in lockstep sync (' + H3.join(' / ') + ', ' + iss3 + ' cmds, tick ' + tgt3 + ')');
    S3.forEach(s => s.close());
  }
}

console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s wall time)`);
S.forEach(s => s.close());
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll net checks passed.');
process.exit(failed ? 1 : 0);
