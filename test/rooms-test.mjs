// Aevum - the open rooms list (server.js GET /mp/rooms): a room is listed from its host's lobby broadcasts while it is
// in its lobby, and not once it started, is invite-only, is a continued match, is full or its host left.
// Run: node test/rooms-test.mjs
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log('  ok   ' + msg); } else { fails++; console.log('  FAIL ' + msg); } };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(port), AEVUM_NO_AUTH: '', AEVUM_SECRET: '' }, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const to = setTimeout(() => reject(new Error('server did not start: ' + out)), 8000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('calisiyor')) { clearTimeout(to); resolve(p); } });
    p.stderr.on('data', (d) => { out += d; });
  });
}
const port = 6300 + Math.floor(Math.random() * 300);
const base = 'http://127.0.0.1:' + port;
const srv = await startServer(port, { AEVUM_NO_AUTH: '1', AEVUM_SA: '' });
const ctls = [];
try {
  const auth = async (fb, uid, name) => (await (await fetch(base + '/mp/auth', { method: 'POST', body: JSON.stringify({ dev: { fb, uid, name, av: 'crown' } }) })).json());
  // an SSE connection held open (the peer stays in its room until aborted)
  const join = async (room, peer, tk) => {
    const c = new AbortController(); ctls.push(c);
    const r = await fetch(base + '/mp/events?room=' + room + '&peer=' + peer + '&tk=' + encodeURIComponent(tk), { signal: c.signal });
    r.body.getReader().read().catch(() => {});
    await wait(100);
    return c;
  };
  const send = (room, peer, tk, data) => fetch(base + '/mp/send?room=' + room + '&peer=' + peer, { method: 'POST', headers: { 'X-Aevum-Ticket': tk }, body: JSON.stringify({ topic: 'lobby', data }) });
  const list = async (tk) => (await (await fetch(base + '/mp/rooms', { headers: { 'X-Aevum-Ticket': tk } })).json()).rooms;
  const state = (peer, extra = {}, slots = 1) => ({ k: 'state', state: Object.assign({ code: 'X', hostPeer: peer, settings: { mapSize: 320, mapType: 'islands' }, slots: Array.from({ length: slots }, (_, i) => (i ? { kind: 'ai', team: 2 } : { kind: 'human', peer, name: 'Spoof', team: 1 })) }, extra) });

  const A = await auth('fbA', 'a'.repeat(32), 'Ali'), B = await auth('fbB', 'b'.repeat(32), 'Banu'), C = await auth('fbC', 'c'.repeat(32), 'Can');
  ok((await fetch(base + '/mp/rooms')).status === 401, 'rooms: needs a ticket');
  ok((await list(A.ticket)).length === 0, 'rooms: empty at first');

  await join('AAAAA', 'pa', A.ticket);
  ok((await list(B.ticket)).length === 0, 'rooms: a room is not listed before its host broadcast a lobby state');
  await send('AAAAA', 'pa', A.ticket, state('pa'));
  let l = await list(B.ticket);
  ok(l.length === 1 && l[0].code === 'AAAAA' && l[0].host === 'Ali' && l[0].n === 1 && l[0].max === 8 && l[0].map === 'islands' && l[0].size === 320, 'rooms: an open lobby is listed with the verified host name, players, map (' + JSON.stringify(l[0]) + ')');
  ok(!('t0' in l[0]) && !('peer' in l[0]), 'rooms: no internal fields in the card');

  // a guest cannot fake the card
  await join('AAAAA', 'pb', B.ticket);
  await send('AAAAA', 'pb', B.ticket, state('pb', {}, 8));
  l = await list(C.ticket);
  ok(l.length === 1 && l[0].slots === 1, 'rooms: only the host\'s lobby state counts');

  // invite-only, full and continued rooms
  await join('BBBBB', 'pb2', B.ticket);
  await send('BBBBB', 'pb2', B.ticket, state('pb2', { listed: false }));
  await join('CCCCC', 'pc', C.ticket);
  await send('CCCCC', 'pc', C.ticket, state('pc', {}, 8));
  l = await list(A.ticket);
  ok(l.length === 1 && l[0].code === 'AAAAA', 'rooms: invite-only and full rooms are not listed');
  await send('CCCCC', 'pc', C.ticket, state('pc', {}, 3));
  ok((await list(A.ticket)).some((r) => r.code === 'CCCCC'), 'rooms: a room with a free slot again is listed');
  await send('CCCCC', 'pc', C.ticket, state('pc', { resume: { name: 'x', tick: 1 } }, 3));
  ok(!(await list(A.ticket)).some((r) => r.code === 'CCCCC'), 'rooms: a continued match lobby is not listed');
  await send('BBBBB', 'pb2', B.ticket, state('pb2', { listed: true }));
  ok((await list(A.ticket)).some((r) => r.code === 'BBBBB'), 'rooms: an invite-only room made public is listed');

  // started rooms leave the list (and stay out even if a stale state follows)
  await send('AAAAA', 'pa', A.ticket, { k: 'start', start: { settings: {}, slots: [] } });
  await send('AAAAA', 'pa', A.ticket, state('pa'));
  ok(!(await list(A.ticket)).some((r) => r.code === 'AAAAA'), 'rooms: a started match is not listed');

  // the host left
  const D = await auth('fbD', 'd'.repeat(32), 'Deniz'), E = await auth('fbE', 'e'.repeat(32), 'Ece');
  const hd = await join('DDDDD', 'pd', D.ticket);
  await join('DDDDD', 'pe', E.ticket);
  await send('DDDDD', 'pd', D.ticket, state('pd'));
  ok((await list(A.ticket)).some((r) => r.code === 'DDDDD'), 'rooms: room listed while its host is in');
  hd.abort(); await wait(300);
  ok(!(await list(A.ticket)).some((r) => r.code === 'DDDDD'), 'rooms: not listed once the host left');
} finally { for (const c of ctls) try { c.abort(); } catch { /* ignore */ } srv.kill(); }

console.log(`rooms-test: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
