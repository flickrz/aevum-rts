// Aevum - one-shot migration of the old claude.ai admin panel's decisions into Firestore adminFeedback/{id}
// (what the /admin page and tools/read-admin.mjs read). Lines still 'new' are skipped (no document means new).
//   node tools/admin-import.mjs <file.json> [--dry]
// file.json: an array of {id, status, note?, decidedAt?}, or {feedback: [...]} / {items: [...]} of them.
// Needs the Firebase service-account key: $AEVUM_SA (a file path), else ~/.aevum/firebase-sa.json. Never commit it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSaStore } from '../srv/firestore-sa.mjs';
import { cleanDecision, COLLECTION } from '../srv/admin.mjs';

const file = process.argv[2], dry = process.argv.includes('--dry');
if (!file) { console.error('usage: node tools/admin-import.mjs <file.json> [--dry]'); process.exit(1); }
const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
const list = Array.isArray(raw) ? raw : Array.isArray(raw.feedback) ? raw.feedback : Array.isArray(raw.items) ? raw.items : [];
const todo = [];
let skipped = 0, bad = 0;
for (const x of list) {
  if (!x || x.status === 'new' || x.status == null) { skipped++; continue; }
  const d = cleanDecision({ id: x.id, status: x.status, note: typeof x.note === 'string' ? x.note.slice(0, 500) : undefined });
  if (d.error) { bad++; console.warn('skip ' + JSON.stringify(x.id) + ': ' + d.error); continue; }
  const at = typeof x.decidedAt === 'string' && !isNaN(Date.parse(x.decidedAt)) ? new Date(x.decidedAt).toISOString() : new Date().toISOString();
  const fields = { status: { stringValue: d.status }, decidedAt: { stringValue: at } };
  if (d.note) fields.note = { stringValue: d.note };
  todo.push([d.id, fields]);
}
console.log(`${todo.length} to write, ${skipped} new/skipped, ${bad} invalid${dry ? ' (dry run)' : ''}`);
if (dry || !todo.length) process.exit(0);
const saPath = process.env.AEVUM_SA || path.join(os.homedir(), '.aevum', 'firebase-sa.json');
if (!fs.existsSync(saPath)) { console.error('Service-account key not found: ' + saPath); process.exit(2); }
// (PR #5 by anupam-orbisai) refuse a key file other users can read. POSIX only: Windows keeps no such mode bits (it always reports 0o666).
if (process.platform !== 'win32' && (fs.statSync(saPath).mode & 0o077)) { console.error('Refusing to use ' + saPath + ': key file is readable by group/other, chmod 600 it first.'); process.exit(2); }
const store = createSaStore({ sa: JSON.parse(fs.readFileSync(saPath, 'utf8')) });
let n = 0;
for (const [id, fields] of todo) { await store.patch(COLLECTION + '/' + id, fields); n++; }
console.log(n + ' decisions written to ' + COLLECTION);
