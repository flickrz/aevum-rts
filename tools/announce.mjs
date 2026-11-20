// Aevum - announce an update to everyone online before publishing (part of the publish flow; no browser needed).
//   node tools/announce.mjs [--in 60] [--msg "text"] [--cancel] [--url https://aevum-8clf.onrender.com]
// Signs a short token with the Firebase service-account key ($AEVUM_SA, else ~/.aevum/firebase-sa.json; never commit it)
// and POSTs it to /mp/announce. Players see a countdown, multiplayer matches are saved ~15 s before it ends; push after
// the countdown (the server also warns everyone itself when the host stops it for the deploy).
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { signAnnounce } from '../srv/announce-auth.mjs';

const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
const saPath = process.env.AEVUM_SA || path.join(os.homedir(), '.aevum', 'firebase-sa.json');
if (!fs.existsSync(saPath)) { console.error('Service-account key not found: ' + saPath); process.exit(2); }
const sa = JSON.parse(fs.readFileSync(saPath, 'utf8'));
const url = (arg('--url') || 'https://aevum-8clf.onrender.com').replace(/\/+$/, '') + '/mp/announce';
const body = process.argv.includes('--cancel') ? { cancel: true } : { inSec: Number(arg('--in') || 60), msg: arg('--msg') || undefined };
const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + signAnnounce(sa, body) }, body: JSON.stringify(body) });
const txt = await r.text();
console.log(r.status + ' ' + txt);
process.exit(r.ok ? 0 : 1);
