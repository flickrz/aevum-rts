// Aevum - the owner's admin queue for Claude: the @claude feedback lines with the owner's decisions (the same data as
// the /admin page, srv/admin.mjs), read straight from Firestore; can mark a line done.
//   node tools/read-admin.mjs [--status approved|new|rejected|done|all] [--json]   (default: approved)
//   node tools/read-admin.mjs --done <id> ["note"]
//   node tools/read-admin.mjs --shot <id> [out.jpg]   (the screenshot attached to that line)
//   node tools/read-admin.mjs --ideas [--json]          (the owner's Fikirler list, pinned first)
//   node tools/read-admin.mjs --idea "title" ["body"]   (adds a pinned idea)
// Needs the Firebase service-account key: $AEVUM_SA (a file path), else ~/.aevum/firebase-sa.json. Never commit it.
import fs from 'fs';
import os from 'os';
import path from 'path';
import { createSaStore } from '../srv/firestore-sa.mjs';
import { createAdmin, cleanDecision, cleanIdea, STATUSES } from '../srv/admin.mjs';

const argv = process.argv.slice(2);
const arg = (k) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : null; };
const saPath = process.env.AEVUM_SA || path.join(os.homedir(), '.aevum', 'firebase-sa.json');
if (!fs.existsSync(saPath)) { console.error('Service-account key not found: ' + saPath); process.exit(2); }
// (PR #5 by anupam-orbisai) refuse a key file other users can read. POSIX only: Windows keeps no such mode bits (it always reports 0o666).
if (process.platform !== 'win32' && (fs.statSync(saPath).mode & 0o077)) { console.error('Refusing to use ' + saPath + ': key file is readable by group/other, chmod 600 it first.'); process.exit(2); }
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
const admin = createAdmin({ store: createSaStore({ sa }) });

if (argv.includes('--idea')) {
  const i = argv.indexOf('--idea'), body = argv[i + 2];
  const d = cleanIdea({ op: 'add', title: argv[i + 1] || '', body: body != null ? body : '', pinned: true });
  if (d.error) { console.error(d.error); process.exit(1); }
  const r = await admin.idea(d);
  console.log(r.id + '  📌 ' + r.title);
} else if (argv.includes('--ideas')) {
  const items = (await admin.ideas()).items;
  if (argv.includes('--json')) process.stdout.write(JSON.stringify(items, null, 1) + '\n');
  else {
    for (const x of items) console.log(`${x.id}  ${x.at}  ${x.pinned ? '📌 ' : ''}${x.status === 'done' ? '[yapıldı] ' : ''}${x.title}${x.from ? '  (from ' + x.from + (x.fromName ? ' ' + x.fromName : '') + ')' : ''}${x.body ? '\n    ' + x.body.replace(/\n/g, '\n    ') : ''}`);
    console.log(items.length + ' ideas');
  }
} else if (argv.includes('--shot')) {
  // the screenshot of one line -> a .jpg file (one Firestore read besides the list)
  const id = arg('--shot'), out = argv[argv.indexOf('--shot') + 2] || (id + '.jpg');
  const img = await admin.shot(id);
  if (!img) { console.error('no screenshot for ' + id); process.exit(1); }
  fs.writeFileSync(out, Buffer.from(img.slice(img.indexOf(',') + 1), 'base64'));
  console.log(out);
} else if (argv.includes('--done')) {
  const id = arg('--done'), note = argv[argv.indexOf('--done') + 2];
  const d = cleanDecision(note != null ? { id, status: 'done', note } : { id, status: 'done' });
  if (d.error) { console.error(d.error); process.exit(1); }
  const r = await admin.decide(d);
  console.log(`${r.id} -> ${r.status}${r.note ? '  (' + r.note + ')' : ''}`);
} else {
  const want = arg('--status') || 'approved';
  if (want !== 'all' && !STATUSES.includes(want)) { console.error('--status: ' + STATUSES.join('|') + '|all'); process.exit(1); }
  const items = (await admin.feedback()).items.filter((x) => want === 'all' || x.status === want);
  if (argv.includes('--json')) process.stdout.write(JSON.stringify(items, null, 1) + '\n');
  else {
    for (const x of items) console.log(`${x.id}  ${x.at}  [${x.room || '-'}]  ${x.name}: ${x.text}${x.shot ? '  [screenshot: --shot ' + x.id + ']' : ''}${x.note ? '\n    note: ' + x.note : ''}${want === 'all' ? '\n    status: ' + x.status : ''}`);
    console.log(items.length + ' ' + want);
  }
}
