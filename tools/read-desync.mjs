// Aevum - read the multiplayer desync records from Firestore (users/{uid}/desync/*, written by CloudSync.logDesync
// when the lockstep state hashes of the players differ, or a shared autosave came out different) and line up the
// records of one match side by side, so the part of the game state that split shows.
//   node tools/read-desync.mjs [--since 2026-11-20] [--room ABCDE] [--json]
// Needs the same Firebase service-account key as tools/read-chatlog.mjs ($AEVUM_SA, else ~/.aevum/firebase-sa.json).
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const saPath = process.env.AEVUM_SA || path.join(os.homedir(), '.aevum', 'firebase-sa.json');
if (!fs.existsSync(saPath)) { console.error('Service-account key not found: ' + saPath); process.exit(2); }
if (fs.statSync(saPath).mode & 0o077) { console.error('Refusing to use ' + saPath + ': key file is readable by group/other, chmod 600 it first.'); process.exit(2); }
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

async function accessToken() {
  const now = Math.floor(Date.now() / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/datastore', aud: sa.token_uri || 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 }));
  const sig = b64u(crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key));
  const r = await fetch(sa.token_uri || 'https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: head + '.' + claim + '.' + sig }) });
  const j = await r.json(); if (!j.access_token) throw new Error('token: ' + JSON.stringify(j));
  return j.access_token;
}
// Firestore REST value -> plain JS
function dec(v) {
  if (!v) return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return +v.integerValue;
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  if ('timestampValue' in v) return v.timestampValue;
  if ('nullValue' in v) return null;
  if ('arrayValue' in v) return ((v.arrayValue && v.arrayValue.values) || []).map(dec);
  if ('mapValue' in v) { const o = {}; for (const [k, x] of Object.entries((v.mapValue && v.mapValue.fields) || {})) o[k] = dec(x); return o; }
  return null;
}

const tok = await accessToken();
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const rows = [];
let last = null;
for (;;) {   // a collection-group query over every users/*/desync, 300 at a time
  const q = { structuredQuery: { from: [{ collectionId: 'desync', allDescendants: true }], orderBy: [{ field: { fieldPath: '__name__' } }], limit: 300 } };
  if (last) q.structuredQuery.startAt = { values: [{ referenceValue: last }], before: false };
  const r = await fetch(base + ':runQuery', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
  const out = await r.json(); if (!Array.isArray(out)) throw new Error(JSON.stringify(out));
  const docs = out.filter((x) => x.document).map((x) => x.document);
  for (const d of docs) { const o = {}; for (const [k, x] of Object.entries(d.fields || {})) o[k] = dec(x); rows.push(o); }
  if (docs.length < 300) break;
  last = docs[docs.length - 1].name;
}
const since = arg('--since'), room = arg('--room');
const recs = rows.filter((r) => (!since || (r.t || r.at || '') >= since) && (!room || r.room === room.toUpperCase()))
  .sort((a, b) => String(a.at || a.t).localeCompare(String(b.at || b.t)));
if (process.argv.includes('--json')) { process.stdout.write(JSON.stringify(recs, null, 1) + '\n'); process.exit(0); }
if (!recs.length) { console.log('No desync records' + (since ? ' since ' + since : '') + '.'); process.exit(0); }

// one group per match event: room + kind + the turn (or save id) that split
const groups = new Map();
for (const r of recs) { const k = `${r.room}|${r.kind}|${r.kind === 'save' ? r.saveId : r.ht}`; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(r); }
const hex = (h) => (h == null ? '-' : (h >>> 0).toString(16).padStart(8, '0'));
for (const [, g] of groups) {
  const r0 = g[0];
  console.log(`\n=== ${r0.t}  room ${r0.room}  ${r0.kind === 'save' ? 'autosave ' + r0.saveId + ' differed' : 'state hash differed'}  tick ${r0.tick ?? '-'}  v${r0.version}  ${r0.players} players  map ${r0.map ? `${r0.map.type}/${r0.map.size}/seed ${r0.map.seed}` : '-'}`);
  for (const r of g) console.log(`  ${String(r.name).padEnd(20)} slot ${r.me}  ${String(r.engine).padEnd(16)} hash ${hex(r.mine)}  seen: ${(r.peers || []).map((p) => p.name + '=' + hex(p.h)).join(', ')}`);
  // which sections differ between the records that came in (each client logs its own summary)
  const P = g.filter((r) => r.parts && !r.parts.error);
  if (P.length < 2) { console.log('  (only one record with a state summary: the other players did not log in, or are on an older version)'); continue; }
  const diff = [];
  const cmp = (label, get) => { const vals = P.map((r) => JSON.stringify(get(r.parts))); if (new Set(vals).size > 1) diff.push(`  ${label}: ` + P.map((r, i) => `${r.name}=${vals[i]}`).join('  ')); };
  for (const k of ['tick', 'ents', 'units', 'blds', 'proj', 'deer', 'rs', 'nextId', 'res', 'ai']) cmp(k, (p) => p[k]);
  const owners = new Set(P.flatMap((r) => (r.parts.owners || []).map((o) => o.o)));
  for (const o of [...owners].sort((a, b) => a - b)) for (const f of ['u', 'b', 'pos', 'hp', 'ord']) cmp(`owner ${o} ${({ u: 'units', b: 'buildings', pos: 'positions', hp: 'hit points', ord: 'orders/queues' })[f]}`, (p) => ((p.owners || []).find((x) => x.o === o) || {})[f]);
  const pids = new Set(P.flatMap((r) => (r.parts.players || []).map((x) => x.id)));
  for (const id of [...pids].sort((a, b) => a - b)) for (const f of ['age', 'pop', 'left', 'def', 'techs', 'res']) cmp(`player ${id} ${f}`, (p) => ((p.players || []).find((x) => x.id === id) || {})[f]);
  console.log(diff.length ? '  differs:\n' + diff.join('\n') : '  the section summaries match (the split is in something the summary does not cover)');
}
