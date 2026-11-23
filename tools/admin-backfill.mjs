// Aevum - one-shot: copy the existing @claude chat lines (users/{uid}/chatlog/{id}) to users/{uid}/claude/{id}, the
// small collection the admin page reads (srv/admin.mjs; new lines are written there by CloudSync.logChat). The copy
// keeps the line's admin id (srv/admin.mjs lineId), so decisions already made still match.
// This reads EVERY chat line once (one read per document): run it once, never on a schedule.
//   node tools/admin-backfill.mjs [--dry]
// Needs the Firebase service-account key: $AEVUM_SA (a file path), else ~/.aevum/firebase-sa.json. Never commit it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSaStore } from '../srv/firestore-sa.mjs';

const dry = process.argv.includes('--dry');
const saPath = process.env.AEVUM_SA || path.join(os.homedir(), '.aevum', 'firebase-sa.json');
if (!fs.existsSync(saPath)) { console.error('Service-account key not found: ' + saPath); process.exit(2); }
// (PR #5 by anupam-orbisai) refuse a key file other users can read. POSIX only: Windows keeps no such mode bits (it always reports 0o666).
if (process.platform !== 'win32' && (fs.statSync(saPath).mode & 0o077)) { console.error('Refusing to use ' + saPath + ': key file is readable by group/other, chmod 600 it first.'); process.exit(2); }
const store = createSaStore({ sa: JSON.parse(fs.readFileSync(saPath, 'utf8')) });

const docs = await store.query('chatlog', { allDescendants: true, fields: ['at', 't', 'room', 'name', 'text', 'uid'] });
const lines = docs.filter((d) => /@claude/i.test((d.fields && d.fields.text && d.fields.text.stringValue) || ''));
console.log(`${docs.length} chat lines read, ${lines.length} to @claude`);
let n = 0;
for (const d of lines) {
  const rel = String(d.name).split('/documents/')[1];
  if (!rel || !/\/chatlog\/[^/]+$/.test(rel)) continue;
  const to = rel.replace(/\/chatlog\/([^/]+)$/, '/claude/$1');
  if (!dry) await store.patch(to, d.fields);
  n++;
}
console.log(`${n} copied${dry ? ' (dry run)' : ''}`);
