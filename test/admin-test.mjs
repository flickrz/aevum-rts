// Aevum - the owner's admin page (srv/admin.mjs, server.js /admin and /mp/admin/*): the @claude lines from the chat
// logs merged with the decisions on them, owner only. Firestore is faked (a fake fetch for the REST store, an
// in-memory store seeded from AEVUM_ADMIN_FAKE for the server); the real one is never called.
// Run: node test/admin-test.mjs
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createAdmin, createMemoryAdminStore, feedbackRows, feedbackId, cleanDecision, decisionMap, cleanIdea } from '../srv/admin.mjs';
import { createSaStore } from '../srv/firestore-sa.mjs';

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) { passes++; console.log('  ok   ' + msg); } else { fails++; console.log('  FAIL ' + msg); } };
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const DOCS = 'projects/p/databases/(default)/documents';
const chatDoc = (uid, id, at, name, room, text) => ({ name: `${DOCS}/users/${uid}/chatlog/${id}`, fields: { at: { timestampValue: at }, name: { stringValue: name }, room: { stringValue: room }, text: { stringValue: text } } });
const CHAT = [
  chatDoc('u1', 'c1', '2026-11-20T10:00:00Z', 'Ali', 'ABCDE', '@claude add <b>boats</b>'),
  chatDoc('u1', 'c2', '2026-11-21T10:00:00Z', 'Ali', 'ABCDE', 'gg no feedback'),
  chatDoc('u2', 'c3', '2026-11-22T10:00:00Z', '<img src=x onerror=alert(1)>', 'TEK', 'more fps @Claude please'),
];
const ID1 = feedbackId(CHAT[0].name), ID3 = feedbackId(CHAT[2].name);

// ---- screenshots of @claude lines (2026-11-25): listed as shot: true, read one at a time only on request ----
{
  const IMG = 'data:image/jpeg;base64,/9j/AAAA';
  const lineDoc = (uid, id, text, shot) => ({ name: `${DOCS}/users/${uid}/claude/${id}`, fields: Object.assign({ at: { timestampValue: '2026-11-25T10:00:00Z' }, name: { stringValue: 'A' }, room: { stringValue: 'TEK' }, text: { stringValue: text } }, shot ? { shot: { booleanValue: true } } : {}) });
  const docs = [lineDoc('u9', 's1', '@claude look ' + 'x'.repeat(990), true), lineDoc('u9', 's2', '@claude no image', false)];
  const store = createMemoryAdminStore({ chat: docs, shots: { 'users/u9/claudeshot/s1': IMG, 'users/u9/claudeshot/s2': IMG } });
  const adm = createAdmin({ store });
  const items = (await adm.feedback()).items, a = items.find((x) => x.text.startsWith('look')), b = items.find((x) => x.text === 'no image');
  ok(a && a.shot === true && !('img' in a) && b && !b.shot, 'shot: the list flags lines with a screenshot and carries no image');
  ok(a.text.length > 900, 'shot: a long (1000 char) feedback line is listed whole');
  ok(store.calls.doc === 0, 'shot: listing reads no screenshot documents');
  ok((await adm.shot(a.id)) === IMG && store.calls.doc === 1, 'shot: one document read returns the image');
  ok((await adm.shot(b.id)) === null && (await adm.shot('nope')) === null && store.calls.doc === 1, 'shot: a line without one / a bad id reads nothing');
}

// ---- Fikirler (adminIdeas): add, pin, done, delete, from feedback; one query per list ----
{
  ok(cleanIdea({ op: 'add', title: '  ' }).error === 'bad title' && cleanIdea({ op: 'add', title: 'x'.repeat(201) }).error === 'bad title', 'ideas: a title is required, at most 200 chars');
  ok(cleanIdea({ op: 'add', title: 'a', from: 'nope' }).error === 'bad from' && cleanIdea({ op: 'zap' }).error === 'bad op' && cleanIdea({ op: 'update', id: 'x', pinned: true }).error === 'bad id', 'ideas: bad from / op / id refused');
  ok(cleanIdea({ op: 'update', id: 'i0123456789abcdef' }).error === 'nothing to change' && cleanIdea({ op: 'update', id: 'i0123456789abcdef', status: 'x' }).error === 'bad status', 'ideas: an update must change something valid');
  let t = 1000;
  const store = createMemoryAdminStore({}), adm = createAdmin({ store, now: () => (t += 1000) });
  const a = await adm.idea(cleanIdea({ op: 'add', title: ' Boats \n', body: 'line1\nline2' }));
  ok(/^i[0-9a-f]{16}$/.test(a.id) && a.title === 'Boats' && a.body === 'line1\nline2' && a.status === 'open' && a.pinned === false, 'ideas: add -> open, unpinned, newlines kept in the body only');
  const b = await adm.idea(cleanIdea({ op: 'add', title: 'From fb', pinned: true, from: ID1, fromName: 'Ali' }));
  const c = await adm.idea(cleanIdea({ op: 'add', title: 'Newest' }));
  let l = (await adm.ideas()).items;
  ok(l.length === 3 && l[0].id === b.id && l[0].from === ID1 && l[0].fromName === 'Ali' && l[1].id === c.id, 'ideas: pinned first (with its feedback link), then newest');
  const q0 = store.calls.query; await adm.ideas(); ok(store.calls.query === q0 + 1, 'ideas: one query per list');
  const p = await adm.idea(cleanIdea({ op: 'update', id: a.id, pinned: true }));
  ok(p.pinned === true && p.title === 'Boats', 'ideas: pin');
  const dn = await adm.idea(cleanIdea({ op: 'update', id: c.id, status: 'done' }));
  ok(dn.status === 'done', 'ideas: done');
  ok((await adm.idea(cleanIdea({ op: 'delete', id: b.id }))).deleted === true, 'ideas: delete');
  l = (await adm.ideas()).items;
  ok(l.length === 2 && l[0].id === a.id && l[0].pinned && l[1].status === 'done', 'ideas: the list after pin/done/delete');
}

// ---- pure helpers ----
{
  ok(/^f[0-9a-f]{16}$/.test(ID1) && ID1 === 'f' + crypto.createHash('sha1').update(CHAT[0].name).digest('hex').slice(0, 16), 'id: f + 16 hex of sha1(document path), like aevum-admin/sync.mjs');
  const rows = feedbackRows(CHAT);
  ok(rows.length === 2 && rows[0].id === ID3 && rows[1].id === ID1, 'rows: only @claude lines, newest first');
  ok(rows[0].text === 'more fps  please' && rows[1].text === 'add <b>boats</b>', 'rows: @claude removed from the text (any case)');
  ok(cleanDecision({ id: 'nope', status: 'done' }).error === 'bad id', 'decision: a bad id is refused');
  ok(cleanDecision({ id: ID1, status: 'maybe' }).error === 'bad status', 'decision: an unknown status is refused');
  ok(cleanDecision({ id: ID1, note: 'x'.repeat(501) }).error === 'bad note', 'decision: a note over 500 chars is refused');
  ok(cleanDecision({ id: ID1, note: 5 }).error === 'bad note', 'decision: a note must be text');
  ok(cleanDecision({ id: ID1 }).error === 'nothing to change', 'decision: something must change');
  ok(cleanDecision(null).error === 'bad json' && cleanDecision('x').error === 'bad json', 'decision: the body must be an object');
  assert.deepEqual(cleanDecision({ id: ID1, status: 'approved', note: ' a\nb ', extra: 1 }), { id: ID1, status: 'approved', note: 'a b' });
  ok(decisionMap([{ name: DOCS + '/adminFeedback/' + ID1, fields: { status: { stringValue: 'weird' } } }]).get(ID1).status === 'new', 'decisions: an unknown stored status reads as new');
}

// ---- the REST store helpers against a fake Firestore (paging, count, patch with an update mask) ----
{
  const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const sa = { client_email: 'x@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'p' };
  const calls = [];
  const many = Array.from({ length: 3 }, (_, i) => chatDoc('u' + i, 'c' + i, '2026-11-2' + i + 'T00:00:00Z', 'N' + i, 'ROOMA', '@claude ' + i));
  const fake = async (url, init = {}) => {
    calls.push([url, init]);
    const res = (j) => ({ ok: true, status: 200, json: async () => j });
    if (url.includes('oauth2')) return res({ access_token: 'AT', expires_in: 3600 });
    if (url.endsWith(':runQuery')) {
      const q = JSON.parse(init.body).structuredQuery;
      const start = q.startAt ? many.findIndex((d) => d.name === q.startAt.values[0].referenceValue) + 1 : 0;
      return res([{ readTime: 'x' }, ...many.slice(start, start + q.limit).map((document) => ({ document }))]);
    }
    if (url.endsWith(':runAggregationQuery')) return res([{ result: { aggregateFields: { n: { integerValue: '1004' } } } }]);
    if (init.method === 'PATCH') return res({});
    return { ok: false, status: 500, text: async () => 'unexpected' };
  };
  const st = createSaStore({ sa, fetch: fake });
  const got = await st.query('chatlog', { allDescendants: true, fields: ['text'], pageSize: 2 });
  ok(got.length === 3 && calls.filter(([u]) => u.endsWith(':runQuery')).length === 2, 'store: a collection group is read page by page (' + got.length + ' docs)');
  const q1 = JSON.parse(calls.find(([u]) => u.endsWith(':runQuery'))[1].body).structuredQuery;
  ok(q1.from[0].allDescendants === true && q1.select.fields[0].fieldPath === 'text', 'store: the query is a collection group with a field mask');
  ok((await st.count('profiles')) === 1004, 'store: count is one aggregation query');
  await st.patch('adminFeedback/' + ID1, { status: { stringValue: 'done' }, note: { stringValue: 'x' } });
  const p = calls.find(([, i]) => i.method === 'PATCH');
  ok(p[0].endsWith('/adminFeedback/' + ID1 + '?updateMask.fieldPaths=status&updateMask.fieldPaths=note') && p[1].headers.Authorization === 'Bearer AT', 'store: patch merges only the given fields (update mask)');
}

// ---- createAdmin: merge, cache, decisions update the cache ----
{
  let t = 1000000;
  const store = createMemoryAdminStore({ chat: CHAT, decisions: [{ name: DOCS + '/adminFeedback/' + ID1, fields: { status: { stringValue: 'approved' }, note: { stringValue: 'yes' }, decidedAt: { stringValue: '2026-11-21T00:00:00.000Z' } } }], accounts: 7 });
  const A = createAdmin({ store, now: () => t, ttlMs: 45000 });
  const f = await A.feedback();
  ok(f.items.length === 2 && f.items[1].status === 'approved' && f.items[1].note === 'yes' && f.items[0].status === 'new', 'admin: lines merged with their decisions (default new)');
  await A.feedback(); t += 10000; await A.feedback();
  ok(store.calls.query === 2, 'admin: reads are cached (' + store.calls.query + ' queries for 3 calls)');
  const d = await A.decide({ id: ID3, status: 'rejected' });
  ok(d.status === 'rejected' && d.note === '' && /^2026|^19/.test(d.decidedAt), 'admin: a decision returns the merged state');
  await A.decide({ id: ID3, note: 'not now' });
  const f2 = await A.feedback();
  ok(f2.items[0].status === 'rejected' && f2.items[0].note === 'not now' && store.calls.query === 2, 'admin: a decision shows at once (cache updated, no new read)');
  t += 50000; await A.feedback();
  ok(store.calls.query === 3, 'admin: the cache expires (the lines are read again; the decisions are kept, they are written here)');
  const f3 = await A.feedback({ fresh: true });
  ok(store.calls.query === 5 && f3.items[0].status === 'rejected', 'admin: fresh (Yenile) reads the lines and the decisions again');
  ok((await A.accounts()) === 7 && (await A.accounts()) === 7 && store.calls.count === 1, 'admin: the account count is cached');
}
// a decision made while a read is under way (the read saw the old state) is not lost when that read lands
{
  let t = 1000000, release = null;
  const base = createMemoryAdminStore({ chat: CHAT });
  const old = await base.query('adminFeedback');
  const slow = Object.assign({}, base, { async query(c) { if (c === 'claude') { await new Promise((r) => { release = r; }); return CHAT; } return old; } });
  const A = createAdmin({ store: slow, now: () => t });
  const p = A.feedback();
  await new Promise((r) => setImmediate(r));
  t += 5; await A.decide({ id: ID1, status: 'approved' });
  release();
  const f = await p;
  ok(f.items.find((x) => x.id === ID1).status === 'approved', 'admin: a decision during a read survives it');
}

// ---- the server: /admin page, owner checks, validation, merge ----
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
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'aevum-admin-'));
const seedFile = path.join(tmp, 'seed.json');
fs.writeFileSync(seedFile, JSON.stringify({ chat: CHAT, decisions: [], accounts: 42 }));
const port = 6600 + Math.floor(Math.random() * 300);
const base = 'http://127.0.0.1:' + port;
const srv = await startServer(port, { AEVUM_NO_AUTH: '1', AEVUM_SA: '', AEVUM_OWNERS: 'devowner1', AEVUM_ADMIN_FAKE: seedFile });
try {
  const auth = async (fb, uid, name) => (await (await fetch(base + '/mp/auth', { method: 'POST', body: JSON.stringify({ dev: { fb, uid, name, av: 'crown' } }) })).json());
  const OWN = (await auth('devowner1', 'a'.repeat(32), 'Owner')).ticket, PL = (await auth('player1', 'b'.repeat(32), 'Player')).ticket;
  const get = (p, tk) => fetch(base + p, { headers: tk ? { 'X-Aevum-Ticket': tk } : {} });
  const post = (p, tk, body, raw) => fetch(base + p, { method: 'POST', headers: Object.assign({ 'Content-Type': 'application/json' }, tk ? { 'X-Aevum-Ticket': tk } : {}), body: raw != null ? raw : JSON.stringify(body) });

  // the page
  const pg = await fetch(base + '/admin');
  const html = await pg.text();
  const csp = pg.headers.get('content-security-policy') || '';
  ok(pg.status === 200 && /text\/html/.test(pg.headers.get('content-type')) && html.includes('YÖNETİM'), 'page: GET /admin serves the admin page');
  ok(/default-src 'none'/.test(csp) && /script-src 'sha256-/.test(csp) && /frame-ancestors 'none'/.test(csp) && pg.headers.get('x-frame-options') === 'DENY', 'page: an enforced strict CSP, no framing');
  ok(!html.includes('__API_KEY__') && !/AEVUM_SA|private_key/.test(html), 'page: the public web key filled in, no secrets');
  ok(!/innerHTML/.test(html), 'page: never sets innerHTML (player text only as textContent)');
  ok((await fetch(base + '/admin/')).status === 200 && (await fetch(base + '/admin', { headers: { 'If-None-Match': pg.headers.get('etag') } })).status === 304, 'page: /admin/ too, and a 304 with its ETag');

  // owner checks
  ok((await get('/mp/admin/feedback')).status === 401, 'feedback: 401 without a ticket');
  ok((await get('/mp/admin/feedback?tk=' + encodeURIComponent(OWN))).status === 401, 'feedback: a ticket in the query does not count (header only)');
  ok((await get('/mp/admin/feedback', PL)).status === 403, 'feedback: 403 for a player who is not the owner');
  ok((await get('/mp/admin/feedback', 'garbage')).status === 401, 'feedback: 401 for a bad ticket');
  ok((await post('/mp/admin/feedback', PL, { id: ID1, status: 'done' })).status === 403, 'decide: 403 for a player');
  ok((await post('/mp/admin/feedback', null, { id: ID1, status: 'done' })).status === 401, 'decide: 401 without a ticket');
  ok((await get('/mp/admin/stats', PL)).status === 403 && (await get('/mp/admin/stats')).status === 401, 'stats: owner only');

  let r = await get('/mp/admin/feedback', OWN);
  let j = await r.json();
  ok(r.status === 200 && j.items.length === 2 && j.items[0].id === ID3 && j.items.every((x) => x.status === 'new'), 'feedback: 200 for the owner, @claude lines newest first, all new');
  ok(j.items[0].name === '<img src=x onerror=alert(1)>', 'feedback: names come back as plain data');

  // validation
  ok((await post('/mp/admin/feedback', OWN, null, '{bad')).status === 400, 'decide: bad JSON -> 400');
  ok((await post('/mp/admin/feedback', OWN, { id: 'x', status: 'done' })).status === 400, 'decide: bad id -> 400');
  ok((await post('/mp/admin/feedback', OWN, { id: ID1, status: 'nope' })).status === 400, 'decide: bad status -> 400');
  ok((await post('/mp/admin/feedback', OWN, { id: ID1, note: 'n'.repeat(501) })).status === 400, 'decide: long note -> 400');
  ok((await post('/mp/admin/feedback', OWN, null, JSON.stringify({ id: ID1, note: 'x'.repeat(5000) }))).status === 413, 'decide: a body over 4 KB -> 413');

  // decisions merge into the list
  r = await post('/mp/admin/feedback', OWN, { id: ID1, status: 'approved' });
  j = await r.json();
  ok(r.status === 200 && j.ok === true && j.status === 'approved' && j.decidedAt, 'decide: approve -> 200');
  r = await post('/mp/admin/feedback', OWN, { id: ID1, note: 'boats in 0.9.6' });
  j = await r.json();
  ok(j.status === 'approved' && j.note === 'boats in 0.9.6', 'decide: a note keeps the status');
  await post('/mp/admin/feedback', OWN, { id: ID3, status: 'done' });
  j = await (await get('/mp/admin/feedback', OWN)).json();
  const by = Object.fromEntries(j.items.map((x) => [x.id, x]));
  ok(by[ID1].status === 'approved' && by[ID1].note === 'boats in 0.9.6' && by[ID3].status === 'done', 'feedback: the list shows the decisions');
  await post('/mp/admin/feedback', OWN, { id: ID3, status: 'new' });
  j = await (await get('/mp/admin/feedback', OWN)).json();
  ok(j.items.find((x) => x.id === ID3).status === 'new', 'decide: Geri al (back to new)');

  // stats
  r = await get('/mp/admin/stats', OWN);
  j = await r.json();
  ok(r.status === 200 && j.accounts === 42 && j.live && typeof j.live.peers === 'number' && Array.isArray(j.daily) && j.daily.length >= 1 && 'visitors' in j.daily[0], 'stats: accounts, live rooms/peers and the days');
  ok(!JSON.stringify(j).includes('private_key'), 'stats: no secrets');
  // Fikirler over the server
  ok((await get('/mp/admin/ideas', PL)).status === 403 && (await post('/mp/admin/ideas', PL, { op: 'add', title: 'x' })).status === 403 && (await get('/mp/admin/ideas')).status === 401, 'ideas: owner only');
  ok((await post('/mp/admin/ideas', OWN, { op: 'add', title: '' })).status === 400, 'ideas: a bad idea -> 400');
  r = await post('/mp/admin/ideas', OWN, { op: 'add', title: 'boats', pinned: true, from: ID1, fromName: 'Ali' });
  j = await r.json();
  ok(r.status === 200 && j.ok && j.pinned && j.from === ID1, 'ideas: Fikre al (from a feedback line, pinned)');
  await post('/mp/admin/ideas', OWN, { op: 'add', title: 'plain' });
  let il = (await (await get('/mp/admin/ideas', OWN)).json()).items;
  ok(il.length === 2 && il[0].title === 'boats', 'ideas: GET lists them, pinned first');
  ok((await (await post('/mp/admin/ideas', OWN, { op: 'update', id: il[1].id, status: 'done' })).json()).status === 'done', 'ideas: done over POST');
  ok((await post('/mp/admin/ideas', OWN, { op: 'delete', id: il[0].id })).status === 200 && (await (await get('/mp/admin/ideas', OWN)).json()).items.length === 1, 'ideas: delete over POST');
  ok((await fetch(base + '/mp/admin/ideas', { method: 'PUT', headers: { 'X-Aevum-Ticket': OWN } })).status === 405, 'ideas: other methods -> 405');
  ok(html.includes('Fikirler') && html.includes('Fikre al'), 'page: has the Fikirler block and the Fikre al button');
  ok((await get('/mp/admin/other', OWN)).status === 404, 'admin: unknown path -> 404');
  ok((await fetch(base + '/mp/admin/feedback', { method: 'DELETE', headers: { 'X-Aevum-Ticket': OWN } })).status === 405, 'admin: other methods -> 405');
} finally {
  srv.kill();
  await wait(100);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch { /* ignore */ }
}
console.log(`admin-test: ${passes} ok, ${fails} failed`);
process.exit(fails ? 1 : 0);
