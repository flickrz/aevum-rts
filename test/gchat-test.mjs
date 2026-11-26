// Aevum - the general chat of the menus (server.js /mp/gchat): history, send, rate limits, cleaning, push through the
// inbox, refused without a ticket.   node test/gchat-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let passes = 0, fails = 0;
const ok = (c, msg) => { if (c) { passes++; console.log('  ok   ' + msg); } else { fails++; console.log('  FAIL ' + msg); } };
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(port), AEVUM_SECRET: '' }, env), stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
    let out = '';
    const to = setTimeout(() => reject(new Error('server did not start: ' + out)), 8000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('calisiyor')) { clearTimeout(to); resolve(p); } });
    p.stderr.on('data', (d) => { out += d; });
  });
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aevum-gchat-'));
const gchatFile = path.join(tmp, 'gchat.json');
const port = 6900 + Math.floor(Math.random() * 300);
const base = 'http://127.0.0.1:' + port;
const env = { AEVUM_NO_AUTH: '1', AEVUM_SA: '', AEVUM_OWNERS: 'devowner1', AEVUM_DRAIN_MS: '200', AEVUM_GCHAT_FAKE: gchatFile };
let srv = await startServer(port, env);
try {
  const auth = async (fb, uid, name) => (await (await fetch(base + '/mp/auth', { method: 'POST', body: JSON.stringify({ dev: { fb, uid, name, av: 'crown' } }) })).json()).ticket;
  const ta = await auth('playeraaaa1', 'a'.repeat(32), 'Ayse'), tb = await auth('playerbbbb1', 'b'.repeat(32), 'Burak'), to = await auth('devowner1', 'e'.repeat(32), 'Sahip');
  ok(ta && tb && to, 'dev tickets');
  const send = (tk, text) => fetch(base + '/mp/gchat', { method: 'POST', headers: { 'X-Aevum-Ticket': tk, 'Content-Type': 'application/json' }, body: JSON.stringify({ text }) });
  const lines = async (tk, after = 0) => (await (await fetch(base + '/mp/gchat?after=' + after, { headers: { 'X-Aevum-Ticket': tk } })).json()).lines;
  ok((await fetch(base + '/mp/gchat')).status === 401, 'no ticket: refused');
  ok((await send('', 'x')).status === 401, 'send without a ticket: refused');
  // Burak waits on his inbox (he is in the menus): Ayse's line reaches him through it
  await fetch(base + '/mp/inbox?tk=' + encodeURIComponent(tb) + '&t=1');   // (marks him online; returns at once or after the wait)
  const inbox = fetch(base + '/mp/inbox?tk=' + encodeURIComponent(tb) + '&t=2').then((r) => r.json());
  await wait(150);
  const r1 = await send(ta, '  merhaba\u0000  ​ herkes  ');
  ok(r1.status === 200, 'send ok');
  const m1 = (await r1.json()).m;
  ok(m1 && m1.text === 'merhaba herkes' && m1.name === 'Ayse' && m1.id > 0, 'line cleaned (control, invisible, spaces) and stamped with the ticket name');
  const got = await inbox;
  ok(Array.isArray(got) && got.some((x) => x.type === 'gchat' && x.m && x.m.text === 'merhaba herkes'), 'pushed to an online player through the inbox');
  ok((await send(ta, 'ikinci')).status === 429, 'two lines within 2 s: refused');
  await wait(2100);
  ok((await send(ta, 'merhaba herkes')).status === 429, 'the same line again within a minute: refused');
  ok((await send(ta, '   ')).status === 400, 'empty line: refused');
  const long = await (await send(tb, 'x'.repeat(500))).json();
  ok(long.m && long.m.text.length === 200, 'long line cut to 200');
  const o = await (await send(to, 'hos geldiniz')).json();
  ok(o.m && o.m.own === 1, 'the owner line is marked');
  const all = await lines(tb);
  ok(all.length === 3 && all[0].text === 'merhaba herkes', 'history: every line in order');
  ok((await lines(tb, all[1].id)).length === 1, 'history after an id');
  // burst limit: at most 8 lines in 30 s
  let n429 = 0;
  for (let i = 0; i < 9; i++) { await wait(2050); if ((await send(tb, 'satir ' + i)).status === 429) n429++; }
  ok(n429 >= 1, 'more than 8 lines in 30 s: refused');
  // persistence across a clean restart (SIGTERM flushes to store; new server reloads and keeps ids monotonic)
  const before = await lines(tb);
  const lastBefore = before[before.length - 1];
  const exited = new Promise((res) => srv.once('exit', (code) => res(code)));
  if (process.platform === 'win32') srv.send('SIGTERM'); else srv.kill('SIGTERM');
  ok((await exited) === 0, 'server stopped cleanly on SIGTERM');
  srv = await startServer(port, env);
  const ta2 = await auth('playeraaaa1', 'a'.repeat(32), 'Ayse');
  const after = await lines(ta2);
  ok(after.length === before.length && after[0].id === before[0].id && after[after.length - 1].id === lastBefore.id && after[0].text === 'merhaba herkes', 'history survived restart');
  const rAfter = await send(ta2, 'yeniden basladi');
  const mAfter = (await rAfter.json()).m;
  ok(rAfter.status === 200 && mAfter && mAfter.id > lastBefore.id, 'new line after restart has strictly higher id');
} catch (e) { fails++; console.log('  FAIL ' + (e && e.stack || e)); }
try { srv.kill(); } catch { /* ignore */ }
await wait(100);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
console.log(`\ngchat-test: ${passes} ok, ${fails} failed`);
process.exit(fails ? 1 : 0);
