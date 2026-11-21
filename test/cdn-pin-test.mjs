// Aevum - the live site loads everything under assets/ (models, sounds, icons, licences) from jsDelivr, pinned to one
// pushed commit of this repository (src/cdn.js ASSET_PIN). Before a release: every file under assets/ must be
// byte-identical to that commit, else the pin has to move: push the commit that has them, then set ASSET_PIN to it.
// Also checked: the pin is on a remote branch (jsDelivr reads GitHub) and no code loads assets/ around src/cdn.js.
// Run: node test/cdn-pin-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const git = (args, opts) => execFileSync('git', ['-c', 'safe.directory=*', '-C', ROOT, ...args], Object.assign({ maxBuffer: 1 << 28 }, opts));
const cdnSrc = fs.readFileSync(path.join(ROOT, 'src/cdn.js'), 'utf8');
const sha = (cdnSrc.match(/ASSET_PIN = '([0-9a-f]{40})'/) || [])[1];
if (!sha) { console.log('FAIL no ASSET_PIN in src/cdn.js'); process.exit(1); }
let bad = 0;
const fail = (t) => { bad++; console.log('  FAIL ' + t); };

// the pin must be pushed (a commit only on this machine is a 404 on jsDelivr)
let remote = '';
try { remote = String(git(['branch', '-r', '--contains', sha], { stdio: ['ignore', 'pipe', 'ignore'] })).trim(); } catch { remote = ''; }
if (!remote) fail('the pin ' + sha.slice(0, 7) + ' is not on any remote branch (push it first)');

const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.isFile()) files.push(p);
  }
})(path.join(ROOT, 'assets'));
// compared as git blobs: jsDelivr serves the committed blob, and `git hash-object` gives the blob the local file would
// commit as (the same line-end conversion as `git add`, so a CRLF checkout of an LF text file still matches)
const pinned = new Map();
for (const ln of String(git(['ls-tree', '-r', sha, '--', 'assets'])).split('\n')) {
  const m = /^\d+ blob ([0-9a-f]{40})\t(.+)$/.exec(ln);
  if (m) pinned.set(m[2], m[1]);
}
const rels = files.map((f) => path.relative(ROOT, f).split(path.sep).join('/'));
const local = String(git(['hash-object', '--stdin-paths'], { input: rels.join('\n') + '\n' })).trim().split('\n');
rels.forEach((rel, i) => {
  const pub = pinned.get(rel);
  if (pub !== local[i]) fail(rel + (pub ? ' differs from' : ' is missing in') + ' the pinned commit');
});

// every load of an assets/ file goes through src/cdn.js (a plain fetch('assets/...') would cost the host's bandwidth)
(function scan(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) { scan(p); continue; }
    if (!e.name.endsWith('.js') || p === path.join(ROOT, 'src', 'cdn.js')) continue;
    const lines = fs.readFileSync(p, 'utf8').split(/\r?\n/);
    lines.forEach((ln, i) => {
      const code = ln.replace(/\/\/.*$/, '');
      if (/['"`]\.?\/?assets\//.test(code)) fail(path.relative(ROOT, p).split(path.sep).join('/') + ':' + (i + 1) + ' names an assets/ path; load it through src/cdn.js');
    });
  }
})(path.join(ROOT, 'src'));

console.log(files.length + ' files under assets/ checked against ' + sha.slice(0, 7) + (remote ? ' (on ' + remote.split(/\s+/)[0] + ')' : ''));
console.log(bad ? 'FAILED ' + bad + ' (move ASSET_PIN in src/cdn.js to a pushed commit that has them)' : 'ALL OK');
process.exit(bad ? 1 : 0);
