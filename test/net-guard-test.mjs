// Aevum - what a guest takes from the room: a hostile host state is cleaned, turn packets far ahead are dropped.
// Run: node test/net-guard-test.mjs
import { NetSession, MAX_DELAY, REDUNDANCY } from '../src/net/session.js';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } return !!c; };

const clock = {
  t: 0, timers: [], nextId: 1,
  now() { return this.t; },
  setInterval(fn, ms) { const id = this.nextId++; this.timers.push({ id, fn, ms, at: this.t + ms }); return id; },
  clearInterval(id) { this.timers = this.timers.filter(x => x.id !== id); },
  fire() { for (const x of this.timers.slice()) while (x.at <= this.t && this.timers.includes(x)) { x.at += x.ms; x.fn(); } },
};
const fakeClock = { now: () => clock.now(), setInterval: (f, ms) => clock.setInterval(f, ms), clearInterval: id => clock.clearInterval(id) };
// lossless in-memory relay, 20 ms latency
const relay = { rooms: new Map(), queue: [] };
class MemTransport {
  constructor(id) { this.id = id; this.h = new Map(); this.pf = []; this.room = null; this.closed = false; }
  async connect(room) { this.room = room; let r = relay.rooms.get(room); if (!r) { r = new Set(); relay.rooms.set(room, r); } r.add(this); }
  send(topic, data) {
    if (this.closed) return;
    const s = JSON.stringify(data);
    for (const o of relay.rooms.get(this.room) || []) if (o !== this) relay.queue.push({ at: clock.t + 20, fn: () => { if (!o.closed) for (const f of o.h.get(topic) || []) f(JSON.parse(s), this.id); } });
  }
  on(topic, fn) { if (!this.h.has(topic)) this.h.set(topic, []); this.h.get(topic).push(fn); }
  onPeers(fn) { this.pf.push(fn); }
  peers() { return [...(relay.rooms.get(this.room) || [])].filter(o => o !== this).map(o => o.id); }
  close() { this.closed = true; const r = relay.rooms.get(this.room); if (r) r.delete(this); }
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };
async function runFor(ms) {
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.t += 1000 / 60;
    const due = relay.queue.filter(m => m.at <= clock.t); relay.queue = relay.queue.filter(m => m.at > clock.t);
    for (const m of due) m.fn();
    clock.fire(); await flush();
  }
}
const sess = (id, name) => new NetSession(new MemTransport(id), { clock: fakeClock, name });

console.log('Hostile lobby state from the host');
{
  const H = sess('h1', 'Host'), J = sess('j1', 'Ayse');
  const code = await H.host();
  let joined = false; J.join(code).then(() => { joined = true; });
  await runFor(1000);
  ok(joined, 'joiner in the lobby');
  const evil = '<img src=x onerror=alert(1)>';
  H._send('lobby', { k: 'state', state: {
    code, hostPeer: 'h1',
    settings: { mapSize: evil, mapType: evil, climate: 'winter', startRes: { x: 1 }, startAge: '<b>', fog: 'dark', seed: null },
    slots: [{ kind: 'human', peer: 'h1', name: evil.repeat(3), team: evil, ready: true }, { kind: 'human', peer: 'j1', name: 42, team: 99 }],
  } });
  await runFor(200);
  const st = J.state, s0 = st.slots[0], s1 = st.slots[1];
  ok(s0.name === evil.repeat(3).slice(0, 20) && s1.name === '42', 'names are strings of at most 20 characters');
  ok(s0.team === 1 && s1.team === 4, 'teams clamped to 1-4 (' + s0.team + ', ' + s1.team + ')');
  ok(!('mapSize' in st.settings) && !('mapType' in st.settings) && !('startRes' in st.settings) && !('startAge' in st.settings), 'invalid settings dropped');
  ok(st.settings.climate === 'winter' && st.settings.fog === 'dark' && st.settings.seed === null, 'valid settings kept as they are');
  H._send('lobby', { k: 'state', state: { code, hostPeer: 'h1', settings: {}, slots: 'x' } });
  H._send('lobby', { k: 'state', state: { code, hostPeer: 'h1', settings: {}, slots: [null] } });
  await runFor(200);
  ok(J.state === st, 'a state without a usable slot list is ignored');
  H.close(); J.close();
}

console.log('Turn packets far ahead');
{
  const A = sess('a4', 'A');
  A._beginGame({ settings: {}, seed: 1, slots: [{ kind: 'human', peer: 'b4', name: 'B', team: 1 }, { kind: 'human', peer: 'a4', name: 'A', team: 2 }] });
  const m = A.recv.get(0), lim = 2 * MAX_DELAY + REDUNDANCY;
  A._onTurn({ p: 0, t: lim, c: [] }, 'b4');
  A._onTurn({ p: 0, t: lim + 1, c: [['cmdStop', [[1]]]] }, 'b4');
  A._onTurn({ p: 0, t: 1e9, c: [] }, 'b4');
  ok(m.has(lim) && !m.has(lim + 1) && !m.has(1e9), 'a list ' + lim + ' turns ahead is stored, further ahead dropped');
  const junk = []; for (let i = 0; i < lim; i++) junk.push([0, []]);
  A._onTurn({ p: 0, t: 0, c: [], r: [...junk, [5, []]] }, 'b4');
  ok(!m.has(5), 'repeated turns beyond the first ' + lim + ' entries are not read');
  A._onTurn({ p: 0, t: 0, c: [], r: [[5, []]] }, 'b4');
  ok(m.has(5), 'a short repeat list is read');
  A.close();
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
