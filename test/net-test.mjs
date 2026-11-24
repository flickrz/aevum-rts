// Aevum - lockstep network test: in-memory lossy hub, 3 NetSessions (host + 2 joiners), real Game sims.
// Run: node test/net-test.mjs
import { NetSession, STEP, TURN_TICKS, desyncVerdict } from '../src/net/session.js';
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
ok(tot / cnt <= 12 && maxRate <= 16, 'message budget: avg <= 12/s, peak ' + maxRate + ' msgs/s per client (peak = catch-up second after a stall)');
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
console.log(`(${((Date.now() - t0) / 1000).toFixed(1)} s wall time)`);
S.forEach(s => s.close());
console.log(failed ? `\n${failed} check(s) FAILED` : '\nAll net checks passed.');
process.exit(failed ? 1 : 0);
