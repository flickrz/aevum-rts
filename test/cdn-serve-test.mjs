// Aevum - how the page is served (README: How the live site is served): with RENDER_GIT_COMMIT the server fills the
// commit into index.html and the page's loaders take style.css and src/main.js from jsDelivr at that commit, with this
// host as the fallback; without it the page is the file on disk and everything comes from the host. Also: the CSP
// hashes match the served inline scripts, ETag / 304 / gzip of the page, the favicons stay on the host, and the two
// inline loaders run in a fake page (hostnames, ?cdn=0 / ?cdn=1, the fallback when the CDN entry fails).
// Run: node test/cdn-serve-test.mjs
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import net from 'node:net';
import vm from 'node:vm';
import zlib from 'node:zlib';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SHA = 'abcdef0123456789abcdef0123456789abcdef01';
const CDN = 'https://cdn.jsdelivr.net/gh/flickrz/aevum-rts@' + SHA + '/';
let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
function freePort() { return new Promise((res, rej) => { const s = net.createServer(); s.listen(0, '127.0.0.1', () => { const p = s.address().port; s.close(() => res(p)); }); s.on('error', rej); }); }

async function startServer(extra) {
  const port = await freePort();
  const env = Object.assign({}, process.env, { PORT: String(port), AEVUM_NO_AUTH: '1', AEVUM_SA: '' }, extra);
  for (const k of ['RENDER_GIT_COMMIT', 'AEVUM_CDN_COMMIT']) if (!(k in extra)) delete env[k];
  const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env, stdio: ['ignore', 'pipe', 'pipe'] });
  p.stdout.on('data', () => {}); p.stderr.on('data', () => {});
  const base = 'http://127.0.0.1:' + port;
  for (let i = 0; i < 100; i++) { try { const r = await fetch(base + '/mp/ping'); if (r.ok) break; } catch { /* not yet */ } await sleep(100); }
  return { p, base };
}
const inlineScripts = (html) => [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)].map((m) => m[1]);
const hash = (t) => "'sha256-" + crypto.createHash('sha256').update(t.replace(/\r\n?/g, '\n'), 'utf8').digest('base64') + "'";

// runs the page's two inline loaders (not the import map) in a fake document; returns what they would load
function runLoaders(html, { host = 'aevum-8clf.onrender.com', search = '', failCdn = false } = {}) {
  const [, head, body] = inlineScripts(html);
  const meta = /<meta name="aevum-cdn" content="([^"]*)">/.exec(html);
  const written = [], scripts = [], warns = [];
  let cssEl = null;
  const document = {
    querySelector: (q) => (q === 'meta[name="aevum-cdn"]' && meta ? { content: meta[1] } : null),
    write: (s) => { written.push(s); const m = /id="aevum-css" href="([^"]+)"/.exec(s); if (m) cssEl = { href: m[1], onerror: null }; },
    getElementById: (id) => (id === 'aevum-css' ? cssEl : null),
    createElement: () => ({ type: '', src: '', onerror: null }),
    body: { appendChild: (s) => { scripts.push(s.src); if (failCdn && s.src.startsWith('https://') && s.onerror) s.onerror(); } },
  };
  const window = {};
  const ctx = vm.createContext({ window, document, location: { hostname: host, search }, console: { warn: (t) => warns.push(t) } });
  vm.runInContext(head, ctx);
  const cssFirst = cssEl && cssEl.href;
  if (failCdn && cssEl && cssEl.onerror) cssEl.onerror();
  vm.runInContext(body, ctx);
  return { written, css: cssFirst, cssAfter: cssEl && cssEl.href, scripts, warns, code: window.AEVUM_CODE };
}

const disk = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
const live = await startServer({ RENDER_GIT_COMMIT: SHA });
const plain = await startServer({});
try {
  console.log('with RENDER_GIT_COMMIT');
  const r = await fetch(live.base + '/', { headers: { 'accept-encoding': 'identity' } });
  const html = await r.text(), csp = r.headers.get('content-security-policy-report-only') || '', etag = r.headers.get('etag');
  ok(r.status === 200 && html.includes('<meta name="aevum-cdn" content="' + SHA + '">'), 'the commit is filled into index.html');
  ok(html === disk.replace('<meta name="aevum-cdn" content="">', '<meta name="aevum-cdn" content="' + SHA + '">'), 'nothing else of the page changes');
  ok(html.includes("'https://cdn.jsdelivr.net/gh/flickrz/aevum-rts@' + c + '/'") && html.includes("l.href = './style.css'") && html.includes("'./src/main.js'"), 'loaders: CDN base at the commit, host fallbacks for style.css and src/main.js');
  const hs = inlineScripts(html);
  ok(hs.length === 3 && hs.every((t) => csp.includes(hash(t))), 'CSP carries the hash of every inline script (import map + 2 loaders)');
  ok(/style-src [^;]*https:\/\/cdn\.jsdelivr\.net/.test(csp) && /script-src [^;]*https:\/\/cdn\.jsdelivr\.net/.test(csp) && /connect-src [^;]*https:\/\/cdn\.jsdelivr\.net/.test(csp), 'CSP allows jsDelivr for styles, scripts and fetches');
  ok(r.headers.get('cache-control') === 'no-cache' && /^W\/"p[0-9a-f]{16}"$/.test(etag || ''), 'page: no-cache with a content ETag');
  const r304 = await fetch(live.base + '/index.html', { headers: { 'if-none-match': etag } });
  ok(r304.status === 304, 'same ETag -> 304');
  const rgz = await fetch(live.base + '/', { headers: { 'accept-encoding': 'gzip' } });
  ok(rgz.headers.get('content-encoding') === 'gzip' || html.length <= 1024, 'page goes out gzipped');
  const rh = await fetch(live.base + '/', { method: 'HEAD' });
  ok(rh.status === 200 && Number(rh.headers.get('content-length')) > 0, 'HEAD of the page');
  const raw = await new Promise((res) => { import('node:http').then((http) => http.get(live.base + '/', { headers: { 'accept-encoding': 'gzip' } }, (s) => { const b = []; s.on('data', (d) => b.push(d)); s.on('end', () => res(Buffer.concat(b))); })); });
  ok(zlib.gunzipSync(raw).toString('utf8') === html, 'gzipped page = the served page');
  const fav = await fetch(live.base + '/favicon.ico');
  ok(fav.status === 200 && /max-age=86400/.test(fav.headers.get('cache-control') || ''), 'favicon.ico stays on the host, cached a day');
  const fb = await fetch(live.base + '/src/main.js');
  ok(fb.status === 200 && fb.headers.get('cache-control') === 'no-cache', 'the host still serves src/** (the fallback)');
  const fbc = await fetch(live.base + '/style.css');
  ok(fbc.status === 200, 'the host still serves style.css (the fallback)');

  console.log('loaders in a fake page');
  let L = runLoaders(html);
  ok(L.css === CDN + 'style.css' && L.scripts.length === 1 && L.scripts[0] === CDN + 'src/main.js', 'live host: style.css and src/main.js from jsDelivr at the commit');
  ok(L.written.some((w) => w.includes('rel="modulepreload" href="' + CDN + 'src/main.js"')), 'live host: the entry is preloaded');
  L = runLoaders(html, { failCdn: true });
  ok(L.cssAfter === './style.css' && L.scripts.join(' ') === CDN + 'src/main.js ./src/main.js' && L.code === './', 'CDN fails: style.css and src/main.js from the host, once');
  L = runLoaders(html, { search: '?cdn=0' });
  ok(L.css === './style.css' && L.scripts.join(' ') === './src/main.js', '?cdn=0: everything from the host');
  L = runLoaders(html, { host: 'localhost' });
  ok(L.css === './style.css' && L.scripts.join(' ') === './src/main.js', 'localhost: from the host');
  L = runLoaders(html, { host: '127.0.0.1', search: '?x=1&cdn=1' });
  ok(L.css === CDN + 'style.css' && L.scripts[0] === CDN + 'src/main.js', 'localhost + ?cdn=1: from jsDelivr');

  console.log('without a commit');
  const p2 = await fetch(plain.base + '/', { headers: { 'accept-encoding': 'identity' } });
  const html2 = await p2.text();
  ok(p2.status === 200 && html2 === disk, 'index.html is served as it is on disk');
  ok(html2.includes('<meta name="aevum-cdn" content="">') && !html2.includes(SHA), 'no commit in the page');
  ok(p2.headers.get('etag') !== etag, 'a different ETag than the page with a commit');
  L = runLoaders(html2);
  ok(L.css === './style.css' && L.scripts.join(' ') === './src/main.js' && !L.written.some((w) => w.includes('modulepreload')), 'any host: style.css and src/main.js from the host');
  L = runLoaders(html2, { host: 'localhost', search: '?cdn=1' });
  ok(L.css === './style.css' && L.scripts.join(' ') === './src/main.js', '?cdn=1 without a commit: still the host');

  console.log('a bad commit value');
  const bad = await startServer({ RENDER_GIT_COMMIT: 'abc"><script>' });
  try {
    const h3 = await (await fetch(bad.base + '/')).text();
    ok(h3 === disk, 'a RENDER_GIT_COMMIT that is not 40 hex digits is ignored');
  } finally { bad.p.kill(); }
} finally {
  live.p.kill(); plain.p.kill();
}
console.log(failed ? 'FAILED ' + failed : 'ALL OK');
process.exit(failed ? 1 : 0);
