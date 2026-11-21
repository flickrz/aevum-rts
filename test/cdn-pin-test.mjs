// Aevum - the live site loads the models from jsDelivr, pinned to one commit of this (public) repository
// (src/render/glb-models.js CDN_SHA). Before a release: every model here must be byte-identical to that snapshot,
// else the pin has to move: push the commit that has them, then set CDN_SHA to it. Run: node test/cdn-pin-test.mjs
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUB = ROOT;   /* (one repository since 2026-11-22: the pinned commit is in this history) */
const src = fs.readFileSync(path.join(ROOT, 'src/render/glb-models.js'), 'utf8');
const sha = (src.match(/CDN_SHA = '([0-9a-f]{40})'/) || [])[1];
if (!sha) { console.log('FAIL no CDN_SHA in glb-models.js'); process.exit(1); }
const files = [];
(function walk(d) {
  for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    const p = path.join(d, e.name);
    if (e.isDirectory()) walk(p); else if (e.name.endsWith('.glb')) files.push(p);
  }
})(path.join(ROOT, 'assets/models'));
let bad = 0;
for (const f of files) {
  const rel = path.relative(ROOT, f).split(path.sep).join('/');
  let pub = null;
  try { pub = execFileSync('git', ['-c', 'safe.directory=*', '-C', PUB, 'show', sha + ':' + rel], { maxBuffer: 1 << 28 }); } catch { pub = null; }
  if (!pub || !pub.equals(fs.readFileSync(f))) { bad++; console.log('  FAIL ' + rel + (pub ? ' differs from' : ' is missing in') + ' the pinned snapshot'); }
}
console.log(files.length + ' models checked against ' + sha.slice(0, 7));
console.log(bad ? 'FAILED ' + bad + ' (move CDN_SHA to a pushed commit that has them)' : 'ALL OK');
process.exit(bad ? 1 : 0);
