// Aevum - profile uid in the multiplayer lobby and in "continue a saved match" slot matching.
// In-memory relay (small loss + latency), fake clock, real Game for the save data. Run: node test/net-uid-test.mjs
//  - lobby hello/req carry the uid, slots / start message keep it, the Game cfg never contains it
//  - continue: a joiner lands in his slot by uid first (renamed players too; swapped names do not swap slots),
//    then by name only for slots saved without a uid (old saves); the host takes his own slot by uid;
//    the same profile in a second tab does not take an already taken slot; invalid uids off the wire are ignored
import { NetSession, cleanUid, LOBBY_GONE_MS } from '../src/net/session.js';
import { Game } from '../src/sim/game.js';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } return !!c; };
function mulberry(a) { return () => { a |= 0; a = (a + 0x6D2B79F5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const rnd = mulberry(99);

const clock = {
  t: 0, timers: [], nextId: 1,
  now() { return this.t; },
  setInterval(fn, ms) { const id = this.nextId++; this.timers.push({ id, fn, ms, at: this.t + ms }); return id; },
  clearInterval(id) { this.timers = this.timers.filter(x => x.id !== id); },
  fire() { for (const x of this.timers.slice()) while (x.at <= this.t && this.timers.includes(x)) { x.at += x.ms; x.fn(); } },
};
const fakeClock = { now: () => clock.now(), setInterval: (f, ms) => clock.setInterval(f, ms), clearInterval: id => clock.clearInterval(id) };
const relay = { rooms: new Map(), queue: [], blobs: new Map(), wire: [] };
class MemTransport {
  constructor(id) { this.id = id; this.h = new Map(); this.pf = []; this.room = null; this.closed = false; }
  async connect(room) {
    this.room = room; let r = relay.rooms.get(room); if (!r) { r = new Set(); relay.rooms.set(room, r); }
    for (const o of r) o._emit({ joined: [this.id], left: [] }); r.add(this);
  }
  _emit(ch) { ch.peers = this.peers(); for (const f of this.pf) f(ch); }
  send(topic, data) {
    if (this.closed) return;
    const s = JSON.stringify(data); relay.wire.push(s);
    for (const o of relay.rooms.get(this.room) || []) {
      if (o === this || rnd() < 0.05) continue;
      relay.queue.push({ at: clock.t + rnd() * 80, fn: () => { if (!o.closed) for (const f of o.h.get(topic) || []) f(JSON.parse(s), this.id); } });
    }
  }
  on(topic, fn) { if (!this.h.has(topic)) this.h.set(topic, []); this.h.get(topic).push(fn); }
  onPeers(fn) { this.pf.push(fn); }
  peers() { return [...(relay.rooms.get(this.room) || [])].filter(o => o !== this).map(o => o.id); }
  async putBlob(text) { const id = 'b' + relay.blobs.size; relay.blobs.set(this.room + ':' + id, text); return id; }
  async getBlob(id) { const t = relay.blobs.get(this.room + ':' + id); if (t == null) throw new Error('404'); return t; }
  close() { if (this.closed) return; this.closed = true; const r = relay.rooms.get(this.room); if (r) { r.delete(this); for (const o of r) o._emit({ joined: [], left: [this.id] }); } }
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
async function until(cond, maxMs = 15000) { for (let t = 0; t < maxMs && !cond(); t += 25) await runFor(25); return cond(); }

const U = c => c.repeat(32);
const UH = U('1'), UA = U('a'), UM = U('b'), US = U('c');
let peerN = 0;
const sess = (name, uid) => new NetSession(new MemTransport('p' + (peerN++)), { clock: fakeClock, name, uid });

// a real mp game as the save data: Host, Ayse, Mehmet (humans), one AI
const players = [{ kind: 'human', team: 1, name: 'Host' }, { kind: 'human', team: 1, name: 'Ayse' }, { kind: 'human', team: 2, name: 'Mehmet' }, { kind: 'ai', team: 2, difficulty: 'easy' }];
const G = new Game({ mapSize: 96, seed: 3, mp: true, me: 0, players });
for (let i = 0; i < 60; i++) G.update(1 / 30);
const data = JSON.parse(JSON.stringify(G.serialize()));
const recPlayers = (uids) => G.players.map((p, i) => Object.assign({ name: p.name, team: p.team, kind: p.isAI ? 'ai' : 'human' }, uids ? { uid: uids[i] } : {}));
const recWith = (uids, me = 0) => ({ name: 'test', time: 0, mp: true, code: 'MATCH', tick: G.tick, me, players: recPlayers(uids), data });
const REC = recWith([UH, UA, UM, null]);
const slotOf = (H, s) => H.state.slots.findIndex(x => x.peer === s.id);
const closeAll = (...a) => a.forEach(s => s.close());

console.log('cleanUid');
ok(cleanUid(UA) === UA && cleanUid('ZZ') === null && cleanUid(U('a') + 'a') === null && cleanUid(U('A')) === null && cleanUid(42) === null && cleanUid(null) === null, 'only 32 lowercase hex chars pass');
ok(sess('x', 'bogus').uid === null && sess('x', UA).uid === UA, 'session opts.uid validated');

console.log('Normal lobby carries the uid');
{
  const H = sess('Host', UH), J = sess('Ayse', UA), X = sess('Bad', '<script>' + 'a'.repeat(24));
  const code = await H.host();
  let j = false; Promise.all([J.join(code), X.join(code)]).then(() => { j = true; });
  ok(await until(() => j), 'joiners in the lobby');
  ok(H.state.slots[0].uid === UH, 'host slot has the host uid');
  const sj = H.state.slots.find(s => s.peer === J.id), sx = H.state.slots.find(s => s.peer === X.id);
  ok(sj && sj.uid === UA, 'joiner slot has its uid (from hello)');
  ok(sx && sx.uid === null, 'invalid uid off the wire stored as null');
  ok(relay.wire.some(w => w.includes('"k":"hello"') && w.includes(UA)), 'hello message carries the uid');
  J.setReady(true); X.setReady(true); X.setTeam(2);
  ok(relay.wire.some(w => w.includes('"k":"req"') && w.includes(UA)), 'req messages carry the uid');
  ok(await until(() => H.canStart().ok), 'can start');
  let started = 0; [H, J, X].forEach(s => s.on('start', () => started++));
  H.start();
  ok(await until(() => started === 3), 'all started');
  ok(J.start0.slots.find(s => s.peer === J.id).uid === UA && J.start0.slots[0].uid === UH, 'start message slots keep the uid on the joiner');
  ok(JSON.stringify(J.start0) === JSON.stringify(H.start0) && JSON.stringify(X.start0) === JSON.stringify(H.start0), 'the joiners\' start message (cleaned on receipt) equals the host\'s');
  const cfg = J.cfg, cj = JSON.stringify(cfg);
  ok(!cj.includes(UA) && !cj.includes(UH) && !('uid' in cfg.players[0]), 'Game cfg built from the start message has no uid');
  closeAll(H, J, X);
}

async function resumeLobby(rec, host, joiners) {
  const code = await host.hostResume(rec);
  for (const s of joiners) { s._j = false; s.join(code).then(() => { s._j = true; }); await until(() => s._j); }
  await runFor(1500);
  return code;
}

console.log('Continue: renamed players keep their slots (uid)');
{
  const H = sess('HostYeni', UH), A = sess('Ayşegül', UA), M = sess('Memo', UM);
  await resumeLobby(REC, H, [A, M]);
  ok(slotOf(H, H) === 0, 'renamed host took his own slot 0 by uid');
  ok(slotOf(H, A) === 1 && slotOf(H, M) === 2, 'renamed joiners landed in their slots (1, 2): ' + slotOf(H, A) + ', ' + slotOf(H, M));
  ok(H.state.slots[1].name === 'Ayse', 'slot keeps the saved name (names come from the save)');
  ok(!H.state.waiting.length, 'nobody waiting');
  closeAll(H, A, M);
}

console.log('Continue: swapped names do not swap slots');
{
  const H = sess('Host', UH), A = sess('Mehmet', UA), M = sess('Ayse', UM);
  await resumeLobby(REC, H, [A, M]);
  ok(slotOf(H, A) === 1 && slotOf(H, M) === 2, 'uid A (now "Mehmet") in slot 1, uid M (now "Ayse") in slot 2');
  closeAll(H, A, M);
}

console.log('Continue: host by uid even when the save was made on another seat');
{
  const H = sess('Mehmet', UM), A = sess('Ayse', UA);
  await resumeLobby(recWith([UH, UA, UM, null], 0), H, [A]);
  ok(slotOf(H, H) === 2, 'host with uid M took slot 2 (not rec.me 0, not by name)');
  ok(slotOf(H, A) === 1, 'Ayse in slot 1');
  closeAll(H, A);
}

console.log('Continue: same profile in a second tab, stranger with a matching name');
{
  const H = sess('Host', UH), A1 = sess('Ayse', UA), A2 = sess('Mehmet', UA), S = sess('Mehmet', US);
  await resumeLobby(REC, H, [A1, A2, S]);
  ok(slotOf(H, A1) === 1, 'first tab of profile A in slot 1');
  ok(slotOf(H, A2) === -1 && H.state.waiting.some(w => w.peer === A2.id), 'second tab of profile A waits (does not take slot 1 or Mehmet\'s slot by name)');
  ok(slotOf(H, S) === -1 && H.state.waiting.some(w => w.peer === S.id), 'stranger named "Mehmet" with another uid does not take the uid-saved slot "Mehmet"');
  ok(H.state.slots[2].peer == null, 'slot 2 still free');
  S.claimSlot(2);
  ok(await until(() => H.state.slots[2].peer === S.id), 'stranger can still claim the free slot manually');
  ok(H.state.slots[2].uid === US && H.state.slots[2].savedUid === UM, 'claimed slot plays with the stranger uid, keeps the saved uid for matching');
  H.freeSlot(2);
  ok(H.state.slots[2].peer == null && H.state.slots[2].uid === UM && H.state.waiting.some(w => w.peer === S.id && w.uid === US), 'freed slot gets its saved uid back, stranger waits with his uid');
  // the real Mehmet arrives later (renamed): matched by uid
  const M = sess('Memo', UM);
  M._j = false; M.join(H.state.code).then(() => { M._j = true; });
  ok(await until(() => M._j && slotOf(H, M) === 2), 'the real Mehmet (renamed) joins later and gets slot 2 by uid');
  M.setReady(true); A1.setReady(true);
  ok(await until(() => H.canStart().ok), 'host can start');
  const st = [H, A1, M].map(() => null);
  [H, A1, M].forEach((s, i) => s.on('start', d => { st[i] = d; }));
  await H.start();
  ok(await until(() => st.every(Boolean)), 'host, A and M started the continued match');
  const sl = A1.start0.slots;
  ok(sl[0].uid === UH && sl[1].uid === UA && sl[2].uid === UM && sl[3].uid == null, 'start message stores the uid per human slot (for the next save record)');
  ok(JSON.stringify(A1.start0) === JSON.stringify(H.start0) && JSON.stringify(M.start0) === JSON.stringify(H.start0), 'continued match: the joiners\' start message (cleaned on receipt) equals the host\'s');
  ok(st.every(d => !JSON.stringify(d.cfg).includes(UA)), 'continued Game cfg has no uid');
  ok(st[0].cfg.me === 0 && st[1].cfg.me === 1 && st[2].cfg.me === 2, 'each client got its own me (0,1,2)');
  closeAll(H, A1, A2, S, M);
}

console.log('Continue: invalid uid off the wire falls back to the name');
{
  const H = sess('Host', UH), A = sess('Ayse', null);
  const code = await H.hostResume(recWith([UH, null, UM, null]));
  // a hand-made hello with a broken uid (bypassing the session's own validation)
  A._j = false; A.uid = 'NOT-A-UID'; A.join(code).then(() => { A._j = true; });
  ok(await until(() => A._j), 'joined');
  await runFor(500);
  ok(slotOf(H, A) === 1 && H.state.slots[1].uid === null, 'broken uid ignored: matched by name to the slot saved without uid');
  closeAll(H, A);
}

console.log('Continue: legacy save without any uid');
{
  const H = sess('host', UH), A = sess('ayse', UA), M = sess('Zeynep', UM);
  await resumeLobby(recWith(null, 0), H, [A, M]);
  ok(H.state.slots.every(s => s.kind === 'ai' || s.savedUid === null), 'legacy save: no saved uids');
  ok(slotOf(H, H) === 0, 'host matched by name (case-insensitive)');
  ok(slotOf(H, A) === 1, 'joiner with a uid matched by name to a legacy slot');
  ok(slotOf(H, M) === -1 && H.state.waiting.some(w => w.peer === M.id), 'unknown name waits (existing fallback flow)');
  ok(H.state.slots[1].uid === UA, 'legacy slot now carries the joiner uid (so the next save has it)');
  closeAll(H, A, M);
}

console.log('Continue: old client without uid on a uid save');
{
  const H = sess('Host', UH), A = sess('Ayse', null);
  await resumeLobby(REC, H, [A]);
  ok(slotOf(H, A) === 1, 'no-uid joiner still matched by name');
  closeAll(H, A);
}

console.log('Continue: a claimer who drops out gives the slot its saved uid back');
{
  const H = sess('Host', UH), A = sess('Ayse', UA), S = sess('Mehmet', US);
  await resumeLobby(REC, H, [A, S]);
  S.claimSlot(2);
  ok(await until(() => H.state.slots[2].peer === S.id && H.state.slots[2].uid === US), 'stranger claimed slot 2 (saved for uid M)');
  S.close();
  ok(await until(() => H.state.slots[2].peer == null, LOBBY_GONE_MS + 6000), 'slot 2 freed after the stranger is gone');
  ok(H.state.slots[2].uid === UM, 'freed slot carries its saved uid again, not the stranger uid');
  A.setReady(true);
  ok(await until(() => H.canStart().ok), 'host can start without slot 2');
  const st = [null, null];
  [H, A].forEach((s, i) => s.on('start', d => { st[i] = d; }));
  await H.start();
  ok(await until(() => st.every(Boolean)), 'started');
  ok(H.start0.slots[2].uid === UM && A.start0.slots[2].uid === UM, 'start message keeps the saved uid for the idle slot');
  closeAll(H, A, S);
}

console.log('Continue: one profile saved in two slots (two tabs)');
{
  const H = sess('Host', UH), T2 = sess('Host', UH), M = sess('Mehmet', UM);
  await resumeLobby(recWith([UH, UH, UM, null]), H, [T2, M]);
  ok(slotOf(H, H) === 0, 'host tab in slot 0');
  ok(slotOf(H, T2) === 1, 'second tab of the same profile lands in the other slot saved with that uid');
  ok(slotOf(H, M) === 2, 'Mehmet in slot 2');
  const T3 = sess('Host', UH);
  T3._j = false; T3.join(H.state.code).then(() => { T3._j = true; });
  ok(await until(() => T3._j), 'third tab joined');
  await runFor(1000);
  ok(slotOf(H, T3) === -1 && H.state.waiting.some(w => w.peer === T3.id), 'third tab waits: every slot of that uid is taken');
  closeAll(H, T2, M, T3);
}

console.log('Verified identities (relay-stamped): names and uids come from the relay, not from the messages');
{
  // a "verified" transport: like the node relay with tickets, every message carries the sender's identity
  const IDS = new Map();
  class VerTransport extends MemTransport {
    get verified() { return true; }
    identOf(p) { return IDS.get(p) || null; }
    on(topic, fn) { super.on(topic, (d, from) => fn(d, from, IDS.get(from) || null)); }
  }
  const mk = (id, ident) => { if (ident) IDS.set(id, ident); return new NetSession(new VerTransport(id), { clock: fakeClock, ident: ident || undefined, name: 'Typed', uid: U('9') }); };
  const H = mk('vh', { uid: UH, name: 'Kerem', av: 'crown', tp: 12 });
  const A = mk('va', { uid: UA, name: 'Ayşe', av: 'wolf', tp: 4 });
  const X = mk('vx', null);   // no identity (a client that skipped the relay check)
  A._hello = () => ({ k: 'hello', name: 'Kerem', uid: UH });   // lies about who it is
  await H.host();
  A._j = false; A.join(H.state.code).then(() => { A._j = true; }).catch(() => {});
  X.join(H.state.code).catch(() => {});
  ok(await until(() => A._j), 'verified joiner in the lobby');
  await runFor(1500);
  const sa = H.state.slots.find(s => s.peer === 'va');
  ok(sa && sa.name === 'Ayşe' && sa.uid === UA && sa.av === 'wolf' && sa.tp === 4, 'the slot shows the relay-verified name, uid, avatar, TP (not what the message claimed)');
  ok(H.state.slots[0].name === 'Kerem' && H.state.slots[0].uid === UH && H.state.slots[0].tp === 12, 'the host slot is his verified identity');
  ok(!H.state.slots.some(s => s.peer === 'vx'), 'a peer without a verified identity never gets a slot');
  A.setName('Kerem'); A._req('setName', 'Kerem');
  await runFor(1500);
  ok(H.state.slots.find(s => s.peer === 'va').name === 'Ayşe', 'renaming in the lobby is ignored (the account name stays)');
  const a2 = A.state.slots.find(s => s.peer === 'vh');
  ok(a2 && a2.uid === UH && a2.av === 'crown', 'the joiner sees the host with his verified uid / avatar');
  closeAll(H, A, X);
}

console.log(failed ? `\n${failed} check(s) FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
