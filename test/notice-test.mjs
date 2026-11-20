// Aevum - update notices: the client poller (src/net/notice.js), the server's /mp/notice + /mp/announce + the restart
// notice on SIGTERM (server.js spawned with AEVUM_NO_AUTH=1), and the lobby's build id check (src/net/session.js).
// Run: node test/notice-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import net from 'node:net';
import { fileURLToPath } from 'node:url';
import { createNotice, markInterrupted, getInterrupted, clearInterrupted, INT_TTL, POLL_MS } from '../src/net/notice.js';
import { NetSession, VER_TEXT, HOST_OLD_TEXT } from '../src/net/session.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// ---------------------------------------------------------------- 1. the poller (fake server, fake clock)
console.log('poller');
{
  let t = 1000, answer = { ver: 'A', notice: null }, up = true, calls = 0;
  const fakeFetch = async () => { calls++; if (!up) throw new Error('down'); return { ok: true, json: async () => JSON.parse(JSON.stringify(answer)) }; };
  const n = createNotice({ fetch: fakeFetch, now: () => t, setTimeout: () => 0, clearTimeout: () => {} });
  const saves = [];
  n.onSaveDue((x) => saves.push(x.id));
  await n.poll();
  ok(n.base === 'A' && n.status() === 'none' && !n.stale(), 'first answer = baseline, no notice');
  answer = { ver: 'A', notice: { id: 'u1', kind: 'update', at: 0, in: 60000, msg: '' } };
  await n.poll();
  ok(n.status() === 'soon' && Math.abs(n.remaining() - 60000) < 1, 'update notice -> countdown 60 s');
  ok(saves.length === 0, 'no save 60 s before');
  t += 44000; n.check();
  ok(saves.length === 0, 'no save at 16 s left');
  t += 2000; n.check(); n.check();
  ok(saves.length === 1 && saves[0] === 'u1', 'save due once at <= 15 s left');
  await n.poll();   // (the server still says 'in: 60000' in this fake: the same id never saves twice)
  t += 20000; n.check();
  ok(saves.length === 1, 'still one save for the same notice');
  up = false; await n.poll();
  ok(n.status() === 'soon', 'server unreachable before the time: the countdown goes on');
  t += 45000;
  ok(n.down && n.status() === 'loading', 'server gone after a notice -> loading, not an error');
  up = true; answer = { ver: 'B', notice: null }; await n.poll();
  ok(n.stale() && n.status() === 'ready' && n.base === 'A' && n.ver === 'B', 'new ver -> ready (Yeni sürüm hazır)');
  // cancelled notice: back to none
  const m = createNotice({ fetch: fakeFetch, now: () => t, setTimeout: () => 0, clearTimeout: () => {} });
  answer = { ver: 'C', notice: { id: 'u2', kind: 'update', at: 0, in: 30000, msg: 'x' } }; await m.poll();
  ok(m.status() === 'soon' && m.notice.msg === 'x', 'server message kept');
  answer = { ver: 'C', notice: null }; await m.poll();
  ok(m.status() === 'none', 'cancelled notice -> nothing shown');
  // a notice that comes with less than 15 s left saves at once
  const q = createNotice({ fetch: fakeFetch, now: () => t, setTimeout: () => 0, clearTimeout: () => {} });
  let qs = 0; q.onSaveDue(() => qs++);
  answer = { ver: 'C', notice: { id: 'r1', kind: 'restart', at: 0, in: 8000, msg: '' } }; await q.poll();
  ok(qs === 1 && q.status() === 'soon', 'restart notice with 8 s left: saved right away');
  // a stale tab does not save (the new version is already live)
  const st = createNotice({ fetch: fakeFetch, now: () => t, setTimeout: () => 0, clearTimeout: () => {} });
  let ss = 0; st.onSaveDue(() => ss++);
  answer = { ver: 'C', notice: null }; await st.poll();
  answer = { ver: 'D', notice: { id: 'u3', kind: 'update', at: 0, in: 1000, msg: '' } }; await st.poll();
  ok(ss === 0 && st.status() === 'ready', 'stale tab: ready, no save');
  ok(POLL_MS >= 20000, 'poll interval >= 20 s');
  // baseVer waits for the first answer
  const w = createNotice({ fetch: fakeFetch, now: () => t });
  ok((await w.baseVer(2000)) === 'D', 'baseVer() waits for the first answer');
  const dead = createNotice({ fetch: async () => { throw new Error('x'); }, now: () => t });
  ok((await dead.baseVer(200)) === null, 'baseVer() -> null when the server never answers');
  void calls;
}

// ---------------------------------------------------------------- 2. the interrupted match note
console.log('interrupted note');
{
  const mem = new Map();
  const ls = { getItem: (k) => (mem.has(k) ? mem.get(k) : null), setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
  ok(getInterrupted(ls) === null, 'nothing noted');
  markInterrupted({ code: 'ABCDE', key: 'mp-ABCDE-auto', host: true }, ls, 1000);
  const g = getInterrupted(ls, 2000);
  ok(g && g.code === 'ABCDE' && g.key === 'mp-ABCDE-auto' && g.host === true, 'noted and read back');
  ok(getInterrupted(ls, 1000 + INT_TTL + 1) === null, 'gone after 30 minutes');
  clearInterrupted('ZZZZZ', ls);
  ok(getInterrupted(ls, 2000) !== null, 'another match code does not clear it');
  clearInterrupted('ABCDE', ls);
  ok(getInterrupted(ls, 2000) === null, 'cleared for its match');
}

// ---------------------------------------------------------------- 3. the lobby's build id check
console.log('lobby build id');
{
  const clock = { t: 0, timers: [], id: 1, now() { return this.t; }, setInterval(fn, ms) { const id = this.id++; this.timers.push({ id, fn, ms, at: this.t + ms }); return id; }, clearInterval(id) { this.timers = this.timers.filter((x) => x.id !== id); } };
  const rooms = new Map(), queue = [];
  class Mem {
    constructor(id) { this.id = id; this.h = new Map(); this.pf = []; this.room = null; this.closed = false; }
    async connect(room) { this.room = room; let r = rooms.get(room); if (!r) rooms.set(room, r = new Set()); for (const o of r) o._peers({ joined: [this.id], left: [] }); r.add(this); }
    _peers(ch) { ch.peers = [...rooms.get(this.room)].filter((o) => o !== this).map((o) => o.id); for (const f of this.pf) f(ch); }
    send(topic, data) { if (this.closed || !this.room) return; for (const o of rooms.get(this.room)) if (o !== this) queue.push({ to: o, from: this.id, topic, data: JSON.parse(JSON.stringify(data)) }); }
    on(topic, fn) { if (!this.h.has(topic)) this.h.set(topic, []); this.h.get(topic).push(fn); }
    peers() { return [...rooms.get(this.room)].filter((o) => o !== this).map((o) => o.id); }
    onPeers(fn) { this.pf.push(fn); }
    putBlob() { return Promise.resolve(true); }
    close() { if (this.closed) return; this.closed = true; const r = rooms.get(this.room); if (r) { r.delete(this); for (const o of r) o._peers({ joined: [], left: [this.id] }); } }
  }
  const step = async (ms) => {
    const end = clock.t + ms;
    while (clock.t < end) {
      clock.t += 20;
      for (const m of queue.splice(0)) if (!m.to.closed) for (const f of m.to.h.get(m.topic) || []) f(m.data, m.from);
      for (const x of clock.timers.slice()) while (x.at <= clock.t && clock.timers.includes(x)) { x.at += x.ms; x.fn(); }
      for (let i = 0; i < 4; i++) await Promise.resolve();
    }
  };
  let pid = 0;
  const sess = (name, ver) => new NetSession(new Mem('p' + (++pid)), { clock, name, ver });
  const tryJoin = async (host, j) => {
    let res = null;
    j.join(host.code).then(() => { res = 'joined'; }, (e) => { res = e.message; });
    await step(3000);
    return res;
  };

  const host = sess('Host', '0.9.1-aaaa');
  await host.host();
  const same = sess('Ayse', '0.9.1-aaaa');
  ok((await tryJoin(host, same)) === 'joined', 'same build id: joins');
  ok(host.state.slots.some((s) => s.name === 'Ayse'), 'same build id: gets a slot');
  const other = sess('Mehmet', '0.9.1-bbbb');
  const r1 = await tryJoin(host, other);
  ok(r1 === HOST_OLD_TEXT, 'other build id: refused, the joiner (checked against the server) is told the host is behind: "' + r1 + '"');
  ok(!host.state.slots.some((s) => s.name === 'Mehmet'), 'other build id: no slot');
  ok(other.phase === 'closed', 'the refused session is closed');
  const old = sess('Eski', null);
  ok((await tryJoin(host, old)) === VER_TEXT, 'joiner without a build id (old client) refused by a host that has one');
  // an old host (no build id) lets everyone in, as before
  const oldHost = sess('EskiKurucu', null);
  await oldHost.host();
  ok((await tryJoin(oldHost, sess('Yeni', '0.9.1-aaaa'))) === 'joined', 'host without a build id: no check');
  // the continue lobby of a saved match checks it too
  const rh = sess('Host', '0.9.1-aaaa');
  const rec = { name: 'Kayıt', tick: 3600, code: 'MATCH', me: 0, players: [{ uid: null }, { uid: null }], data: { cfg: { mapSize: 128 }, players: [{ name: 'Host', team: 1 }, { name: 'Ayse', team: 2 }] } };
  await rh.hostResume(rec);
  ok((await tryJoin(rh, sess('Ayse', '0.9.1-bbbb'))) === HOST_OLD_TEXT, 'continue lobby: other build id refused');
  ok((await tryJoin(rh, sess('Ayse', '0.9.1-aaaa'))) === 'joined', 'continue lobby: same build id joins');
  ok(rh.state.slots[1].peer != null, 'continue lobby: the joiner took his saved seat');
  for (const s of [host, same, oldHost, rh]) s.close();
}

// ---------------------------------------------------------------- 4. the server
console.log('server');
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }
{
  let port = await freePort();
  if (port < 5320) port = 5320 + (port % 600);
  const env = Object.assign({}, process.env, { PORT: String(port), AEVUM_NO_AUTH: '1', AEVUM_OWNERS: 'devowner1', AEVUM_DRAIN_MS: '2500', AEVUM_SA: '' });
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let out = '', exited = null;
  p.stdout.on('data', (d) => { out += d; }); p.stderr.on('data', (d) => { out += d; });
  p.on('exit', (c) => { exited = { code: c, t: Date.now() }; });
  const base = 'http://127.0.0.1:' + port;
  const get = async (u, o) => { const r = await fetch(base + u, o); let j = null; try { j = await r.json(); } catch { j = null; } return { status: r.status, j, headers: r.headers }; };
  const post = (u, body, tk, method = 'POST') => get(u, { method, headers: Object.assign({ 'Content-Type': 'application/json' }, tk ? { 'X-Aevum-Ticket': tk } : {}), body: method === 'POST' ? JSON.stringify(body || {}) : undefined });
  try {
    let up = false;
    for (let i = 0; i < 60 && !up; i++) { try { up = (await fetch(base + '/mp/ping')).ok; } catch { await sleep(150); } }
    ok(up, 'server started on port ' + port);
    const n0 = await get('/mp/notice');
    ok(n0.status === 200 && typeof n0.j.ver === 'string' && /^[\w.]+-[0-9a-z]+$/.test(n0.j.ver) && n0.j.notice === null, 'GET /mp/notice -> {ver: "' + (n0.j && n0.j.ver) + '", notice: null}');
    ok(/no-store/.test(n0.headers.get('cache-control') || ''), 'no-store');
    const len = JSON.stringify(n0.j).length;
    ok(len < 120, 'tiny answer (' + len + ' bytes)');
    const auth = async (fb) => (await post('/mp/auth', { dev: { fb, uid: (fb + '0'.repeat(32)).replace(/[^0-9a-f]/g, 'a').slice(0, 32), name: fb } })).j;
    const own = await auth('devowner1'), other = await auth('someone2');
    ok(own && own.owner === true && other && !other.owner, 'dev tickets (owner flag only for AEVUM_OWNERS)');
    ok((await post('/mp/announce', { inSec: 60 })).status === 401, 'announce without a ticket: 401');
    ok((await post('/mp/announce', { inSec: 60 }, other.ticket)).status === 403, 'announce as a non-owner: 403');
    ok((await get('/mp/notice')).j.notice === null, 'still no notice');
    const a = await post('/mp/announce', { inSec: 60 }, own.ticket);
    ok(a.status === 200 && a.j.notice && a.j.notice.kind === 'update' && a.j.notice.in > 58000 && a.j.notice.in <= 60000, 'owner announce: update in 60 s');
    const n1 = (await get('/mp/notice')).j;
    ok(n1.notice && n1.notice.id === a.j.notice.id && n1.ver === n0.j.ver, 'GET /mp/notice shows it to everyone');
    const c = await post('/mp/announce', { cancel: true }, own.ticket);
    ok(c.status === 200 && c.j.notice === null && (await get('/mp/notice')).j.notice === null, 'cancel clears it');
    const a2 = await post('/mp/announce', { inSec: 3 }, own.ticket);
    ok(a2.j.notice.in > 9000 && a2.j.notice.in <= 10000, 'inSec clamped to >= 10');
    const a3 = await post('/mp/announce', {}, own.ticket);
    ok(a3.j.notice.in > 59000, 'default 60 s');
    ok((await post('/mp/announce', null, own.ticket, 'DELETE')).j.notice === null, 'DELETE clears it too');
    await post('/mp/announce', { inSec: 60 }, own.ticket);
    // the restart: SIGTERM (over IPC on Windows, where a child gets no real signal)
    const t0 = Date.now();
    if (process.platform === 'win32') p.send('SIGTERM'); else p.kill('SIGTERM');
    await sleep(300);
    const r = await get('/mp/notice');
    ok(r.status === 200 && r.j.notice && r.j.notice.kind === 'restart' && r.j.notice.in > 0 && r.j.notice.in <= 2500, 'after SIGTERM: restart notice (' + (r.j.notice && r.j.notice.in) + ' ms left)');
    ok(exited === null, 'still serving during the drain');
    ok((await post('/mp/announce', { inSec: 60 }, own.ticket)).status === 409, 'no new announce while restarting');
    for (let i = 0; i < 80 && !exited; i++) await sleep(100);
    ok(exited && exited.code === 0 && exited.t - t0 >= 2400, 'exited cleanly after the drain (' + (exited ? exited.t - t0 : '-') + ' ms, code ' + (exited && exited.code) + ')');
  } finally {
    if (!exited) { try { p.kill(); } catch { /* ignore */ } }
  }
  if (failed) console.log(out.slice(-2000));
}

console.log(failed ? '\n' + failed + ' FAILED' : '\nall passed');
process.exit(failed ? 1 : 0);
