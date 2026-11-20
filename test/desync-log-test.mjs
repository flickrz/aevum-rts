// Aevum - desync diagnostics test: two clients, one of them is made to diverge; both must report the desync with
// the other player's hash and a state summary that shows the part that split (src/net/hashparts.js).
// Run: node test/desync-log-test.mjs
import { NetSession, STEP, TURN_TICKS } from '../src/net/session.js';
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
const LOSS = 0, LAT_MAX = 60;
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

const names = ['Host', 'Ayse'];
const S = names.map((n, i) => new NetSession(new MemTransport('peer' + i), { clock: makeClock('peer' + i), name: n }));
const got = [[], []], saves = [[], []];
S.forEach((s, i) => { s.on('desync', (d) => got[i].push(d)); s.on('saveMismatch', (d) => saves[i].push(d)); });
let start = [null, null]; S.forEach((s, i) => s.on('start', (d) => { start[i] = d; }));
const code = await S[0].host();
let joined = false; S[1].join(code).then(() => { joined = true; });
for (let i = 0; i < 400 && !joined; i++) await runFor(25);
S[1].setTeam(2); S[0].setSettings({ mapSize: 96 });
await runFor(1500); S[1].setReady(true); await runFor(1500);
S[0].start();
for (let i = 0; i < 200 && !(start[0] && start[1]); i++) await runFor(25);
ok(start[0] && start[1], 'both clients started');
const games = start.map((d) => makeGame(d.cfg));
const tick = () => runFor(25, 25, (dt) => { for (let i = 0; i < 2; i++) S[i].advance(games[i], dt); });
for (let i = 0; i < 200; i++) await tick();
ok(!got[0].length && !got[1].length, 'no desync while both run the same game');
// client 1 diverges: player 0's food changes on its side only
games[1].players[0].res.food += 50;
for (let i = 0; i < 400 && !(got[0].length && got[1].length); i++) await tick();
ok(got[0].length === 1 && got[1].length === 1, 'both clients report the desync once');
const d0 = got[0][0], d1 = got[1][0];
ok(d0 && d1 && d0.ht === d1.ht && d0.mine !== d1.mine, 'same turn, different own hashes');
ok(d0 && d0.peers.length === 1 && d0.peers[0].h === d1.mine && d0.peers[0].name === 'Ayse', 'the record names the other player and carries their hash');
ok(d0 && d0.parts && d1.parts && d0.parts.tick === d1.parts.tick, 'both carry a state summary of the same tick');
const p0 = d0 && d0.parts.players.find((p) => p.id === 0), p1 = d1 && d1.parts.players.find((p) => p.id === 0);
ok(p0 && p1 && p0.res[0] !== p1.res[0] && JSON.stringify(d0.parts.owners) === JSON.stringify(d1.parts.owners), 'the summaries differ exactly in player 0 food, nothing else');
console.log(failed ? 'FAILED ' + failed : 'ALL OK');
process.exit(failed ? 1 : 0);
