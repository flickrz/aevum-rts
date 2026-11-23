// Aevum - read every player's multiplayer chat log from Firestore (users/{uid}/chatlog/*, written by
// CloudSync.logChat for each line a player sends) and print it in time order.
//   node tools/read-chatlog.mjs --all [--since 2026-11-15] [--room ABCDE] [--out file.txt]
//   node tools/read-chatlog.mjs --claude [--since 2026-11-15] [--out file.txt]
// --claude: only the feedback lines (players write @claude in the chat, multiplayer or single player = room TEK). They
// are read from the small copy users/*/claude (CloudSync.logChat writes it), not from the whole chat log.
// --all: every chat line. (2026-11-23) That costs one Firestore read per line ever written (thousands, from the
// free plan's 50k a day), so it is refused without --all.
// Needs a Firebase service-account key (Firebase console -> Project settings -> Service accounts -> Generate new
// private key). Looked up in $AEVUM_SA, else ~/.aevum/firebase-sa.json. Never commit that file.
import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const saPath = process.env.AEVUM_SA || path.join(os.homedir(), '.aevum', 'firebase-sa.json');
if (!fs.existsSync(saPath)) { console.error('Service-account key not found: ' + saPath); process.exit(2); }
// (PR #5 by anupam-orbisai) refuse a key file other users can read. POSIX only: Windows keeps no such mode bits (it always reports 0o666).
if (process.platform !== 'win32' && (fs.statSync(saPath).mode & 0o077)) { console.error('Refusing to use ' + saPath + ': key file is readable by group/other, chmod 600 it first.'); process.exit(2); }
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
const val = (v) => (!v ? null : 'stringValue' in v ? v.stringValue : 'timestampValue' in v ? v.timestampValue : 'integerValue' in v ? +v.integerValue : null);

const onlyClaude = process.argv.includes('--claude');
if (!onlyClaude && !process.argv.includes('--all')) { console.error('Reading the whole chat log costs one Firestore read per line ever written. Use --claude (the @claude lines only), or --all to read everything.'); process.exit(2); }
const tok = await accessToken();
const base = `https://firestore.googleapis.com/v1/projects/${sa.project_id}/databases/(default)/documents`;
const rows = [];
let last = null;
for (;;) {   // a collection-group query over every users/*/chatlog (or users/*/claude), 300 at a time (ordered by document name)
  const q = { structuredQuery: { from: [{ collectionId: onlyClaude ? 'claude' : 'chatlog', allDescendants: true }], orderBy: [{ field: { fieldPath: '__name__' } }], limit: 300 } };
  if (last) q.structuredQuery.startAt = { values: [{ referenceValue: last }], before: false };
  const r = await fetch(base + ':runQuery', { method: 'POST', headers: { Authorization: 'Bearer ' + tok, 'Content-Type': 'application/json' }, body: JSON.stringify(q) });
  const out = await r.json(); if (!Array.isArray(out)) throw new Error(JSON.stringify(out));
  const docs = out.filter((x) => x.document).map((x) => x.document);
  for (const d of docs) { const f = d.fields || {}; rows.push({ at: val(f.at) || '', t: val(f.t) || '', room: val(f.room) || '', name: val(f.name) || '?', text: val(f.text) || '' }); }
  if (docs.length < 300) break;
  last = docs[docs.length - 1].name;
}
const since = arg('--since'), room = arg('--room');
const lines = rows.filter((r) => (!since || (r.t || r.at) >= since) && (!room || r.room === room.toUpperCase()) && (!onlyClaude || /@claude/i.test(r.text)))
  .sort((a, b) => (a.at || a.t).localeCompare(b.at || b.t))
  .map((r) => `${r.t || r.at}  [${r.room || '-'}]  ${r.name}: ${r.text}`);
const txt = lines.join('\n') + '\n';
if (arg('--out')) { fs.writeFileSync(arg('--out'), txt); console.log(lines.length + ' lines -> ' + arg('--out')); } else process.stdout.write(txt);
