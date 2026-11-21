// Aevum - what a client takes from the others: lobby state only from the host (and cleaned), turn packets bounded
// and only from their owner (forwards only when asked), a peer withholding his lists is dropped, pause / save limits,
// chat names from the seat / account, the continue check hook. In-memory relay, fake clock, stub games.
// Run: node test/net-guard-test.mjs
import { NetSession, MAX_AHEAD, DROP_STALL_MS, DROP_SILENT_MS, STEP } from '../src/net/session.js';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } return !!c; };

// ---------- fake clock (timers of a "frozen" owner do not fire) ----------
const clock = {
  t: 0, timers: [], nextId: 1, frozen: new Set(),
  setInterval(fn, ms, owner) { const id = this.nextId++; this.timers.push({ id, fn, ms, at: this.t + ms, owner }); return id; },
  clearInterval(id) { this.timers = this.timers.filter(x => x.id !== id); },
  fire() { for (const x of this.timers.slice()) { if (this.frozen.has(x.owner)) continue; while (x.at <= this.t && this.timers.includes(x)) { x.at += x.ms; x.fn(); } } },
};
const clockOf = owner => ({ now: () => clock.t, setInterval: (f, ms) => clock.setInterval(f, ms, owner), clearInterval: id => clock.clearInterval(id) });

// ---------- lossless in-memory relay, 20 ms; optional verified identities and the relay's host hint ----------
const relay = { rooms: new Map(), queue: [], idents: new Map(), first: new Map() };
class MemTransport {
  constructor(id, opts = {}) { this.id = id; this.h = new Map(); this.pf = []; this.room = null; this.closed = false; this.verified = !!opts.verified; this.hint = !!opts.hint; }
  async connect(room) {
    this.room = room;
    let r = relay.rooms.get(room); if (!r) { r = new Set(); relay.rooms.set(room, r); relay.first.set(room, this.id); }
    for (const o of r) for (const f of o.pf) f({ joined: [this.id], left: [] });
    r.add(this);
    if (this.hint) this.hostPeer = relay.first.get(room);
  }
  send(topic, data) {
    if (this.closed) return;
    const s = JSON.stringify(data), id = relay.idents.get(this.id) || null;
    for (const o of relay.rooms.get(this.room) || []) if (o !== this) relay.queue.push({ at: clock.t + 20, fn: () => { if (!o.closed) for (const f of o.h.get(topic) || []) f(JSON.parse(s), this.id, id); } });
  }
  identOf(peer) { return relay.idents.get(peer) || null; }
  on(topic, fn) { if (!this.h.has(topic)) this.h.set(topic, []); this.h.get(topic).push(fn); }
  onPeers(fn) { this.pf.push(fn); }
  peers() { return [...(relay.rooms.get(this.room) || [])].filter(o => o !== this).map(o => o.id); }
  close() { this.closed = true; const r = relay.rooms.get(this.room); if (r) r.delete(this); }
}
const blobs = new Map();
class BlobTransport extends MemTransport {
  async putBlob(text) { const id = 'b' + blobs.size; blobs.set(id, text); return id; }
  async getBlob(id) { if (!blobs.has(id)) throw new Error('404'); return blobs.get(id); }
}
const flush = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };
// games: session -> stub game advanced every frame (frozen sessions are not advanced, slow ones every 4th frame)
const games = new Map(), slow = new Set();
let frameN = 0;
async function runFor(ms) {
  const end = clock.t + ms;
  while (clock.t < end) {
    clock.t += 1000 / 60; frameN++;
    const due = relay.queue.filter(m => m.at <= clock.t); relay.queue = relay.queue.filter(m => m.at > clock.t);
    for (const m of due) m.fn();
    clock.fire();
    for (const [s, g] of games) if (s.phase === 'game' && !clock.frozen.has(s.id + ':adv') && (!slow.has(s.id) || frameN % 4 === 0)) s.advance(g, 1 / 60);
    await flush();
  }
}
const until = async (f, ms = 5000) => { const end = clock.t + ms; while (clock.t < end) { if (f()) return true; await runFor(50); } return !!f(); };
const sess = (id, name, opts = {}) => new NetSession(new (opts.blob ? BlobTransport : MemTransport)(id, opts), { clock: clockOf(id), name });
const stub = () => ({ tick: 0, update() { this.tick++; }, hash() { return 7; }, execCommand() { return true; }, markLeft() { return true; }, players: [] });
const joinRun = async (s, code) => { let done = false; const p = s.join(code).then(() => { done = true; }); await until(() => done); return p; };
const evil = '<img src=x onerror=alert(1)>';

console.log('Hostile lobby state from the host');
{
  const H = sess('h1', 'Host'), J = sess('j1', 'Ayse');
  const code = await H.host();
  let joined = false; J.join(code).then(() => { joined = true; });
  await runFor(1000);
  ok(joined, 'joiner in the lobby');
  H._send('lobby', { k: 'state', state: {
    code, hostPeer: 'h1',
    settings: { mapSize: evil, mapType: evil, climate: 'winter', startRes: { x: 1 }, startAge: '<b>', fog: 'dark', seed: null },
    slots: [{ kind: 'human', peer: 'h1', name: evil.repeat(3), team: evil, ready: true, av: evil, uid: evil }, { kind: 'human', peer: 'j1', name: 42, team: 99, difficulty: evil }],
  } });
  await runFor(200);
  const st = J.state, s0 = st.slots[0], s1 = st.slots[1];
  ok(s0.name === evil.repeat(3).slice(0, 20) && s1.name === '42', 'names are strings of at most 20 characters');
  ok(s0.team === 1 && s1.team === 4, 'teams made 1-4 (' + s0.team + ', ' + s1.team + ')');
  ok(s0.av === null && s0.uid === null && !('difficulty' in s1), 'bad avatar / uid / difficulty dropped');
  ok(!('mapSize' in st.settings) && !('mapType' in st.settings) && !('startRes' in st.settings) && !('startAge' in st.settings), 'invalid settings dropped');
  ok(st.settings.climate === 'winter' && st.settings.fog === 'dark' && st.settings.seed === null, 'valid settings kept as they are');
  for (const bad of [{ slots: 'x' }, { slots: [null] }, { slots: [] }, { slots: [{ kind: 'god', peer: 'h1' }] }, { settings: 'x', slots: [{ kind: 'human', peer: 'h1' }] }]) H._send('lobby', { k: 'state', state: Object.assign({ code, hostPeer: 'h1', settings: {} }, bad) });
  H._send('lobby', { k: 'state', state: { code, hostPeer: 'zz', settings: {}, slots: [{ kind: 'human', peer: 'zz', name: 'X' }] } });
  await runFor(200);
  ok(J.state === st, 'states without a usable slot list, or naming another host, are ignored');
  H.close(); J.close();
}

console.log('Lobby state only from the host');
{
  // an honest lobby, then a guest in the room sends his own state (claiming to be the host)
  const H = sess('h2', 'Host'), J = sess('j2', 'Ayse'), X = sess('x2', 'Evil');
  const code = await H.host();
  await joinRun(J, code); await joinRun(X, code);
  await runFor(500);
  X._send('lobby', { k: 'state', state: { code, hostPeer: 'x2', settings: {}, slots: [{ kind: 'human', peer: 'x2', name: 'Evil' }, { kind: 'human', peer: 'j2', name: 'Ayse' }] } });
  X._send('lobby', { k: 'kick', to: 'j2' });
  await runFor(300);
  ok(J.state.hostPeer === 'h2' && J.phase === 'lobby', 'a guest\'s state / kick is ignored');
  H.close(); J.close(); X.close();
  // a stranger already in the room answers a new joiner first: with the relay's host hint he is ignored
  const H3 = sess('h3', 'Host'), X3 = sess('x3', 'Evil', { hint: true }), J3 = sess('j3', 'Ayse', { hint: true });
  const code3 = await H3.host(); await joinRun(X3, code3);
  await runFor(300);
  let ok3 = false; J3.join(code3).then(() => { ok3 = true; });
  X3._send('lobby', { k: 'state', state: { code: code3, hostPeer: 'x3', settings: {}, slots: [{ kind: 'human', peer: 'x3', name: 'Evil' }, { kind: 'human', peer: 'j3', name: 'Ayse' }] } });
  await runFor(1500);
  ok(ok3 && J3.state.hostPeer === 'h3', 'a joiner with the relay\'s host hint takes the real host\'s state (' + (J3.state && J3.state.hostPeer) + ')');
  H3.close(); X3.close(); J3.close();
}

console.log('Turn packets: bounds and owners');
{
  const A = sess('a4', 'A');
  A._beginGame({ settings: {}, seed: 1, slots: [{ kind: 'human', peer: 'b4', name: 'B', team: 1 }, { kind: 'human', peer: 'a4', name: 'A', team: 2 }, { kind: 'human', peer: 'c4', name: 'C', team: 2 }] });
  const mb = A.recv.get(0);
  A._onTurn({ p: 0, t: MAX_AHEAD, c: [] }, 'b4');
  A._onTurn({ p: 0, t: MAX_AHEAD + 1, c: [['cmdStop', [[1]]]] }, 'b4');
  A._onTurn({ p: 0, t: 1e9, c: [] }, 'b4');
  ok(mb.has(MAX_AHEAD) && !mb.has(MAX_AHEAD + 1) && !mb.has(1e9), 'a list ' + MAX_AHEAD + ' turns ahead is stored, further ahead dropped');
  const junk = []; for (let i = 0; i < MAX_AHEAD; i++) junk.push([0, []]);
  A._onTurn({ p: 0, t: 0, c: [], r: [...junk, [5, []]] }, 'b4');
  ok(!mb.has(5), 'repeat entries beyond the first ' + MAX_AHEAD + ' are not read');
  A._onTurn({ p: 0, t: 0, c: [], r: [[5, []]] }, 'b4');
  ok(mb.has(5), 'a short repeat list is read');
  // C sends lists under B's number
  A._onTurn({ p: 0, t: 8, c: [['cmdStop', [[66]]]] }, 'c4');
  ok(!mb.has(8), 'B\'s list sent by C (nobody asked for a forward) is ignored');
  A._relayAsk.set(0, A.clock.now());
  A._onTurn({ p: 0, t: 8, c: [['cmdStop', [[66]]]] }, 'c4');
  ok(mb.has(8) && JSON.stringify(mb.get(8)).includes('66'), 'after our relay ask a forward is taken');
  A._onTurn({ p: 0, t: 8, c: [['cmdStop', [[1]]]] }, 'b4');
  ok(JSON.stringify(mb.get(8)) === '[["cmdStop",[[1]]]]', 'B\'s own list for that turn replaces the forward');
  A._onTurn({ p: 0, t: 8, c: [['cmdStop', [[66]]]] }, 'c4');
  ok(JSON.stringify(mb.get(8)) === '[["cmdStop",[[1]]]]', 'a later forward does not replace the owner\'s list');
  A._onTurn({ p: 2, t: 9, c: [] }, 'zz');
  ok(!A.recv.get(2).has(9), 'a peer outside the roster is ignored');
  A.close();
}

// a started 2-player match on stub games; returns [host, joiner]
async function match(tag) {
  const H = sess('h' + tag, 'Ali'), J = sess('j' + tag, 'Veli');
  const code = await H.host(); await joinRun(J, code);
  await runFor(300);
  J.setReady(true); H.setSettings({ seed: 5 }); H.addAI(2);
  await runFor(500);
  H.start();
  await until(() => J.phase === 'game');
  games.set(H, stub()); games.set(J, stub());
  return [H, J];
}

console.log('A peer withholding his lists while he keeps talking');
{
  const [H, J] = await match('5');
  await runFor(3000);
  ok(H.turn > 20 && H.turnHeard.has(1), 'the match runs (turn ' + H.turn + ')');
  clock.frozen.add(J.id + ':adv');   // J stops sending lists; his session timers still send pings / keep-alives
  const t0 = H.turn;
  await runFor(DROP_SILENT_MS + 5000);
  ok(H.turn - t0 < 30 && !H.leftAt.has(1), 'past the silence limit he is waited for, not dropped (heard all along)');
  await runFor(DROP_STALL_MS - DROP_SILENT_MS);
  ok(H.leftAt.has(1), 'after ' + DROP_STALL_MS / 1000 + ' s of waiting for his lists alone he is dropped');
  await runFor(1000);
  ok(H.turn > t0 + 5, 'the match goes on without him (turn ' + t0 + ' -> ' + H.turn + ')');
  H.close(); J.close(); games.clear(); clock.frozen.clear();
}
{
  // a slow but honest client (a weak PC running at a quarter of the speed): we wait for him most of the time, but his
  // own turns keep growing, so it is not counted as withholding
  const [H, J] = await match('5s');
  await runFor(3000);
  slow.add(J.id);
  const t0 = H.turn;
  await runFor(DROP_STALL_MS * 2);
  ok(!H.leftAt.has(1) && H.turn > t0 + 50 && (H.withheld.get(1) || 0) < 10000, 'a slow peer that keeps sending new turns is not dropped (turn ' + t0 + ' -> ' + H.turn + ', withheld ' + Math.round(H.withheld.get(1) || 0) + ' ms)');
  H.close(); J.close(); games.clear(); slow.clear();
}
{
  // a client that never starts its lockstep (still loading the match) is not taken for withholding
  const [H, J] = await match('6');
  clock.frozen.add(J.id + ':adv');
  await runFor(DROP_STALL_MS + 5000);
  ok(!H.leftAt.has(1) && H.phase === 'game', 'a client still loading (no list sent yet) is not dropped');
  H.close(); J.close(); games.clear(); clock.frozen.clear();
}

console.log('Pause and save: no limits (owner 2026-11-22)');
{
  const [H, J] = await match('7');
  await runFor(1000);
  const pausesH = []; H.on('pause', e => pausesH.push(e));
  for (let i = 0; i < 8; i++) { J.requestPause(true); await runFor(1500); H.requestPause(false); await runFor(1500); }
  ok(pausesH.filter(e => e.paused && e.byPid === 1).length === 8, 'one player can pause as often as he likes');
  const savesH = []; H.on('save', e => savesH.push(e));
  J.requestSave(); await runFor(600); J.requestSave(); await runFor(1500);
  ok(savesH.length === 2, 'two saves in a row both run (' + savesH.length + ')');
  H.close(); J.close(); games.clear();
}

console.log('Chat names');
{
  relay.idents.set('h8', { uid: 'a'.repeat(32), name: 'Ali' }); relay.idents.set('j8', { uid: 'b'.repeat(32), name: 'Veli' }); relay.idents.set('x8', { uid: 'c'.repeat(32), name: 'Mallory' });
  const H = sess('h8', 'Ali', { verified: true }), J = sess('j8', 'Veli', { verified: true }), X = sess('x8', 'Mallory', { verified: true });
  const code = await H.host(); await joinRun(J, code);
  await runFor(300);
  await X.t.connect(code); X._wire(); X.phase = 'lobby';   // in the room, never said hello: no seat
  const got = []; J.on('chat', m => got.push(m));
  X._send('chat', { name: 'Ali', text: 'ben kurucuyum' });
  H.chat('merhaba');
  await runFor(300);
  ok(got.some(m => m.text === 'ben kurucuyum' && m.name === 'Mallory'), 'a peer without a seat chats under his account name, not the one he sent (' + (got[0] && got[0].name) + ')');
  ok(got.some(m => m.text === 'merhaba' && m.name === 'Ali'), 'a seated player under his seat\'s name');
  H.close(); J.close(); X.close(); relay.idents.clear();
}

console.log('Continue: the client checks the host\'s save');
for (const verdict of [null, 'Kayıt tutmadı.']) {
  const rec = { code: 'MATCH1', tick: 900, data: { cfg: { mapSize: 128, seed: 3 }, players: [{ name: 'Ali', team: 1 }, { name: 'Veli', team: 2 }] }, players: [{ uid: null }, { uid: null }] };
  const H = sess('hr' + !verdict, 'Ali', { blob: true }), J = sess('jr' + !verdict, 'Veli', { blob: true });
  const seen = []; NetSession.checkResume = async (data, at) => { seen.push(at); return verdict; };
  const code = await H.hostResume(rec); await joinRun(J, code);
  await runFor(500);
  J.setReady(true); await runFor(500);
  let closed = null, notice = null; J.on('closed', e => { closed = e.reason; }); J.on('notice', e => { notice = e.text; });
  await H.start();
  await runFor(1500);
  ok(seen.length === 1 && seen[0].match === 'MATCH1' && seen[0].tick === 900, 'the hook gets the match and tick (' + JSON.stringify(seen[0]) + ')');
  if (!verdict) ok(J.phase === 'game', 'a save the hook accepts starts the match');
  else ok(J.phase === 'closed' && closed === 'loadFailed' && /tutmadı/.test(notice || ''), 'a save the hook refuses is not loaded (' + notice + ')');
  H.close(); J.close(); NetSession.checkResume = null;
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
