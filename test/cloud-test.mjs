// Aevum - cloud accounts (src/cloud/*) against an in-memory fake Firebase that enforces the deployed rules.
// Run: node test/cloud-test.mjs
import { createHash } from 'node:crypto';
import * as P from '../src/profile.js';
import { CloudSync, nameKey, nameFromGoogle, cloudKeyOf, mergeSaveLists, pruneList, visibleHistory, reownRecord, betterRecord, isAutoKey, GUEST_KEY, ACCOUNT_UIDS_KEY, STATE_PREFIX, MAX_CLOUD_SAVES, MAX_CLOUD_AUTOS, PULL_EVERY } from '../src/cloud/sync.js';
import { Auth, AUTH_KEY, authMessage } from '../src/cloud/auth.js';
import { GoogleSignIn, googleMessage, REDIRECT_KEY } from '../src/cloud/google.js';
import { sha256Js, sha256Hex, packSave, unpackSave, utf8 } from '../src/cloud/codec.js';
import { fakeFirebase, fakeGoogleSdk } from './fake-firebase.mjs';

let failed = 0;
const ok = (c, msg) => { if (c) console.log('  ok   ' + msg); else { failed++; console.log('  FAIL ' + msg); } return !!c; };
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

// ---------- environment ----------
let T = Date.UTC(2026, 10, 11, 10, 0, 0);
const now = () => T;
const timers = [];
const setTimer = (fn, ms) => { const h = { fn, at: T + ms }; timers.push(h); return h; };
const clearTimer = (h) => { const i = timers.indexOf(h); if (i >= 0) timers.splice(i, 1); };
const runTimers = async () => { const due = timers.filter((t) => t.at <= T); for (const t of due) { clearTimer(t); t.fn(); } await settle(); };
const settle = () => new Promise((r) => setTimeout(r, 5));
const memLS = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k), key: (i) => [...m.keys()][i] ?? null, get length() { return m.size; }, m }; };
let seed = 7;
const fakeCrypto = { getRandomValues(a) { for (let i = 0; i < a.length; i++) { seed = (seed * 1103515245 + 12345) >>> 0; a[i] = seed >>> 24; } return a; } };

function memHistory() {
  const m = new Map();
  return {
    m,
    list: async () => [...m.values()].sort((a, b) => b.endedAt - a.endedAt),
    get: async (id) => m.get(id) || null,
    put: async (recs) => { for (const r of [recs].flat()) m.set(r.id, JSON.parse(JSON.stringify(r))); return true; },
    del: async (ids) => { for (const id of ids) m.delete(id); return true; },
  };
}
function memSaves() {
  const m = new Map();
  return {
    m,
    list: async () => [...m.entries()].map(([key, v]) => Object.assign({ key, name: v.name, time: v.time, matchId: v.matchId || null }, v.mp ? { mp: true, code: v.code, tick: v.tick, me: v.me, players: v.players } : {})).sort((a, b) => b.time - a.time),
    get: async (k) => (m.has(k) ? JSON.parse(JSON.stringify(m.get(k))) : null),
    put: async (k, v) => { m.set(k, JSON.parse(JSON.stringify(v))); return true; },
    del: async (k) => { m.delete(k); return true; },
  };
}
// one "PC": its own localStorage, sessionStorage, IndexedDB stores and cloud client; the Google SDK of its fake Firebase
const SDKS = new WeakMap();
const sdkOf = (ff) => { if (!SDKS.has(ff)) SDKS.set(ff, fakeGoogleSdk(ff)); return SDKS.get(ff); };
const mkGoogle = (ff, ss) => new GoogleSignIn({ config: { apiKey: 'test-key', authDomain: 'test-proj.firebaseapp.com', projectId: 'test-proj' }, loader: sdkOf(ff).loader, ss, now });
function pc(ff, name) {
  const ls = memLS(), ss = memLS(), history = memHistory(), saves = memSaves();
  if (name) P.createProfile(ls, name, { cryptoObj: fakeCrypto, now: T });
  const profile = { get: () => P.loadProfile(ls), set: (p) => P.saveProfile(ls, p), create: (n) => P.createProfile(ls, n, { cryptoObj: fakeCrypto, now: T }) };
  const mk = () => new CloudSync({ fetch: ff.fetch, apiKey: 'test-key', projectId: 'test-proj', ls, now, setTimer, clearTimer, profile, history, saves, packOpts: { chunkChars: 4096 }, google: mkGoogle(ff, ss) });
  return { ff, ls, ss, history, saves, profile, cloud: mk(), reload() { this.cloud = mk(); return this.cloud; } };
}
// "Google ile Giriş Yap" on PC X as `email`: the stub SDK popup signs in; askName answers from `names` in order
// (then cancels). -> the loginGoogle result + .asked (the askName questions)
async function gLogin(X, email, o = {}) {
  sdkOf(X.ff).next = o.error ? { error: o.error } : { email, displayName: o.displayName || '' };
  const q = (o.names || []).slice(), asked = [];
  const r = await X.cloud.loginGoogle({ allowRedirect: !!o.allowRedirect, askMerge: o.askMerge, askName: async (x) => { asked.push(x); if (o.onAsk) await o.onAsk(x); return q.length ? q.shift() : null; } });
  r.asked = asked;
  return r;
}
// a bare REST session of an account (cleanup / a second client), signed in the same way
async function session(ff, email, ls) { const a = new Auth({ fetch: ff.fetch, apiKey: 'test-key', ls: ls || memLS(), now }); await a.adopt(ff.googleSignIn(email)); return a; }
let rid = 0;
function mkRec(uid, o = {}) {
  const id = o.id || 'sp-' + (++rid).toString(16).padStart(16, '0');
  return {
    v: 1, id, uid, me: 0, endedAt: o.endedAt || (T - 1000 * rid), mode: o.mode || 'sp', mapType: 'river', mapSize: 128, difficulty: o.mode === 'mp' ? null : 'normal',
    gameTime: 300, result: o.result || 'won', myAge: 1, stats: { gathered: { food: 1, wood: 2, stone: 3, gold: 4 }, unitsTrained: 1, unitsLost: 0, kills: 2, buildingsBuilt: 3, buildingsLost: 0, razed: 0, techs: 1 },
    players: [{ name: 'Ben', uid, team: 1, ai: false, difficulty: null, won: true }, { name: 'YZ', uid: null, team: 2, ai: true, difficulty: 'normal', won: false }],
  };
}
const cloudIds = (ff, fb) => ff.paths(`users/${fb}/matches/`).map((p) => p.split('/').pop());

const ff = fakeFirebase({ projectId: 'test-proj', apiKey: 'test-key', now });

// ---------------------------------------------------------------- codec
console.log('Codec');
for (const n of [0, 1, 55, 56, 63, 64, 65, 1000, 100000]) {
  const b = new Uint8Array(n).map((_, i) => (i * 31 + 7) & 255);
  if (!ok(sha256Js(b) === createHash('sha256').update(b).digest('hex'), 'pure-JS sha256 matches node crypto (' + n + ' bytes)')) break;
}
ok(await sha256Hex(utf8('abc')) === 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'sha256Hex("abc")');
{
  const obj = { name: 'Kayıt — çğıöşü', data: { arr: Array.from({ length: 3000 }, (_, i) => ({ i, s: 'x' + (i % 97) })) } };
  const pk = await packSave(obj, { chunkChars: 1000 });
  ok(pk.enc === 'gzip' && pk.parts.length > 1 && pk.parts.every((p) => p.length <= 1000), 'gzip + base64, split into ' + pk.parts.length + ' chunks');
  ok(eq(await unpackSave(pk.parts, pk), obj), 'round trip');
  const bad = pk.parts.slice(); bad[1] = bad[1].slice(0, -4) + (bad[1].slice(-4) === 'AAAA' ? 'BBBB' : 'AAAA');
  let err = null; try { await unpackSave(bad, pk); } catch (e) { err = e; }
  ok(err && /bozuk|bütünlük|incorrect|invalid|header|zlib|Decompression/i.test(String(err.message)), 'corrupted chunk rejected: ' + (err && err.message));
  const raw = await packSave(obj, { chunkChars: 1000, noGzip: true });
  ok(raw.enc === 'none' && eq(await unpackSave(raw.parts, raw), obj), 'uncompressed fallback round trip');
}

// ---------------------------------------------------------------- pure helpers
console.log('Helpers');
ok(nameKey('Kerem') === 'kerem' && nameKey('  KEREM ') === 'kerem', 'name key: lowercased + trimmed');
ok(nameKey('a/b') === 'a%2Fb' && nameKey('..') !== '..' && !nameKey('__x__').startsWith('__'), 'name key: no "/" and no reserved ids');
ok(cloudKeyOf('auto', { matchId: '0123456789abcdef' }) === 'auto-0123456789abcdef' && cloudKeyOf('auto', {}) === 'auto' && cloudKeyOf('mp-ABCDE-auto', {}) === 'mp-ABCDE-auto', 'cloud key: one autosave per match');
ok(betterRecord({ result: 'won', endedAt: 1 }, { result: 'abandoned', endedAt: 9 }) && !betterRecord({ result: 'abandoned', endedAt: 9 }, { result: 'lost', endedAt: 1 }), 'finished beats abandoned');
{
  const m = mergeSaveLists([{ key: 'a', time: 5 }, { key: 'auto', matchId: '0123456789abcdef', time: 3 }, { key: 'c', time: 9 }],
    [{ key: 'a', time: 5 }, { key: 'auto-0123456789abcdef', time: 4 }, { key: 'z', time: 1 }]);
  const by = Object.fromEntries(m.map((x) => [x.key, x.cloud]));
  ok(eq(by, { c: 'none', a: 'synced', auto: 'newer', z: 'only' }) && m[0].key === 'c', 'merged save list: none / synced / newer / only');
  ok(m.find((x) => x.key === 'auto').ck === 'auto-0123456789abcdef', 'newer item keeps its local key and knows its cloud key');
}
{
  const l = Array.from({ length: 33 }, (_, i) => ({ key: i % 3 === 0 ? 'auto-' + i : 'manual-' + i, time: i }));
  const d = pruneList(l, 30, 'auto-0');
  ok(d.length === 3 && d.every((k) => k.startsWith('auto-')) && !d.includes('auto-0') && eq(d, ['auto-3', 'auto-6', 'auto-9']), 'prune: oldest autosaves first, never the one just uploaded');
  ok(pruneList(l.slice(0, 30)).length === 0, 'prune: nothing at the limit');
}
{
  const r = mkRec('a'.repeat(32), { id: 'mp-ABCDE-' + 'a'.repeat(32), mode: 'mp' });
  const c = reownRecord(r, 'a'.repeat(32), 'b'.repeat(32));
  ok(c.uid === 'b'.repeat(32) && c.players[0].uid === 'b'.repeat(32) && c.id === 'mp-ABCDE-' + 'b'.repeat(32) && r.uid === 'a'.repeat(32), 're-own: owner, my slot and the mp record id; original untouched');
  const recs = [{ uid: 'g' }, { uid: 'acc' }, { uid: null }, { uid: 'x' }];
  ok(eq(visibleHistory(recs, { profileUid: 'acc', loggedIn: true, accountUids: ['acc'] }).map((x) => x.uid), ['acc', null]), 'logged in: only the account profile (and owner-less) records');
  ok(eq(visibleHistory(recs, { profileUid: 'g', loggedIn: false, accountUids: ['acc'] }).map((x) => x.uid), ['g', null, 'x']), 'guest: everything except accounts used on this PC');
  ok(visibleHistory(recs, { profileUid: 'g', loggedIn: false, accountUids: [] }).length === 4, 'guest who never logged in: unchanged');
}

// ---------------------------------------------------------------- Google sign in: a new account
console.log('Google: new account');
const SDK = sdkOf(ff);
const A = pc(ff, 'Kerem');
const aUid = A.profile.get().uid;
const aRecs = [mkRec(aUid), mkRec(aUid, { result: 'lost' }), mkRec(aUid, { id: 'mp-QWERT-' + aUid, mode: 'mp' })];
await A.history.put(aRecs);
ok(!A.cloud.google.loaded && SDK.loads === 0, 'the SDK is not loaded before the button is used');
let held = null;
let r = await gLogin(A, 'a@example.com', { displayName: 'Kerem Yılmaz', names: ['K', 'Kerem'], onAsk: () => { held = { ls: A.ls.getItem(AUTH_KEY), setup: A.cloud._setup, logged: A.cloud.loggedIn }; A.cloud.kick({ pull: true }); } });
ok(SDK.loads === 1 && SDK.popups === 1 && SDK.persistence && SDK.persistence.type === 'SESSION', 'button: SDK lazy-loaded once, signInWithPopup called (session persistence)');
ok(r.asked.length === 2 && r.asked[0].suggest === 'Kerem' && !r.asked[0].error && r.asked[0].email === 'a@example.com', 'new account: asked for a user name, prefilled with the guest name');
ok(/en az/.test(r.asked[1].error), 'an invalid name is asked again with the reason: ' + r.asked[1].error);
ok(held && held.ls == null && held.setup && held.logged, 'while the name is chosen: the session is not in localStorage and background sync is held');
ok(r.ok && r.created && r.newAccount, 'account set up');
const aFb = A.cloud.user.uid;
ok(SDK.auths.every((x) => x.currentUser == null) && SDK.signOuts >= 1, 'the SDK was signed out right after the hand-off (no second session)');
ok(eq(ff.data('names/kerem'), { uid: aFb }), 'names/kerem claimed');
ok(ff.data(`users/${aFb}/meta/profile`).uid === aUid && ff.data(`users/${aFb}/meta/profile`).name === 'Kerem', 'cloud profile = the local profile uid (multiplayer identity unchanged)');
ok(A.profile.get().uid === aUid, 'local uid unchanged');
ok(eq(cloudIds(ff, aFb).sort(), aRecs.map((x) => x.id).sort()), 'local history uploaded (3 records)');
ok(eq(ff.data('profiles/' + aFb), Object.assign({ name: 'Kerem', games: 3, wins: 2, avatar: ff.data('users/' + aFb + '/meta/profile').avatar }, { updated: ff.data('profiles/' + aFb).updated })) && !!ff.data('profiles/' + aFb).updated && !!ff.data('profiles/' + aFb).avatar, 'public card {name, games, wins, avatar, updated}');
ok(A.cloud.status === 'synced' && A.cloud.statusText === 'Senkronize', 'status Senkronize');
const sess = JSON.parse(A.ls.getItem(AUTH_KEY));
ok(sess.uid === aFb && sess.email === 'a@example.com' && sess.refreshToken && sess.exp > T && !('idToken' in sess), "session persisted in 'aevum.auth' (our REST session, no id token)");
ok(JSON.parse(A.ls.getItem(ACCOUNT_UIDS_KEY)).includes(aUid), 'account uid remembered on this PC');

const B = pc(ff, 'Zeynep');
r = await gLogin(B, 'b@example.com', { names: ['KEREM', 'Zeynep'] });
ok(r.ok && r.asked.length === 2 && r.asked[1].error === 'Bu ad alınmış. Başka bir ad seç.' && r.asked[1].suggest === 'KEREM', 'name taken case-insensitively -> asked again: ' + r.asked[1].error);
const bFb = B.cloud.user.uid;
ok(eq(ff.data('names/zeynep'), { uid: bFb }) && eq(ff.data('names/kerem'), { uid: aFb }), 'B got Zeynep; Kerem stays A\'s');
{
  const X = pc(ff, 'Deneme');
  r = await gLogin(X, 'x@example.com', { names: [] });
  ok(!r.ok && r.cancelled && r.silent && !X.cloud.loggedIn && X.ls.getItem(AUTH_KEY) == null, 'name dialog cancelled -> signed out, nothing stored');
  ok(X.profile.get().name === 'Deneme' && !ff.paths('names/').some((p) => ff.data(p).uid === ff.userByEmail('x@example.com').uid), 'guest profile untouched, no name claimed');
  const N = pc(ff, null);
  r = await gLogin(N, 'n@example.com', { displayName: 'Nur Selin Çelik Öztürkmenoğlu', names: [] });
  ok(r.asked[0].suggest === 'Nur', 'no guest profile: prefilled from the Google display name: ' + r.asked[0].suggest);
  ok(nameFromGoogle('Ayşe Kaya', 'x@y.z') === 'Ayşe Kaya' && nameFromGoogle('', 'can.demir@x.com') === 'candemir' && nameFromGoogle('A', '@') === 'Komutan', 'name suggestions');
}

console.log('Google: errors');
{
  const X = pc(ff, 'Deneme');
  const cases = [
    ['auth/popup-closed-by-user', (e, rr) => e === '' && rr.silent],
    ['auth/cancelled-popup-request', (e, rr) => e === '' && rr.silent],
    ['auth/popup-blocked', (e) => /engellendi/.test(e)],
    ['auth/operation-not-allowed', (e) => e === 'Google ile giriş henüz açılmamış.'],
    ['auth/network-request-failed', (e) => e.startsWith('Sunucuya ulaşılamadı')],
    ['auth/unauthorized-domain', (e) => /yetkilendirilmemiş/.test(e)],
    ['auth/something-else', (e) => e === 'Google ile giriş başarısız (something-else).'],
  ];
  for (const [code, test] of cases) {
    const rr = await gLogin(X, 'x@example.com', { error: code });
    ok(!rr.ok && test(rr.error, rr) && !X.cloud.loggedIn, code + ' -> ' + JSON.stringify(rr.error));
  }
  ok(googleMessage({ code: 'OPERATION_NOT_ALLOWED' }) === 'Google ile giriş henüz açılmamış.' && googleMessage({ message: 'OPERATION_NOT_ALLOWED : The identity provider configuration is disabled.' }) === 'Google ile giriş henüz açılmamış.', 'REST style OPERATION_NOT_ALLOWED -> henüz açılmamış');
  ff.googleOff = true;
  let rr = await gLogin(X, 'x@example.com', {});
  ok(!rr.ok && rr.error === 'Google ile giriş henüz açılmamış.', 'provider disabled in the project -> ' + rr.error);
  ff.googleOff = false;
  SDK.loadFail = true;
  const Y = pc(ff, 'Yeni');
  rr = await gLogin(Y, 'x@example.com', {});
  ok(!rr.ok && /yüklenemedi/.test(rr.error) && !Y.cloud.google.loaded, 'SDK download fails (gstatic blocked / offline) -> ' + rr.error);
  SDK.loadFail = false;
  rr = await gLogin(Y, 'x@example.com', { names: [] });
  ok(rr.cancelled && SDK.popups > 0, 'a failed SDK load can be retried');
  // the popup worked but our own token refresh fails (offline right then)
  let n = 0;
  const realFetch = ff.fetch;
  ff.fetch = async (u, i) => { if (/securetoken/.test(u) && n++ === 0) throw new TypeError('fetch failed'); return realFetch(u, i); };
  const Z = pc(ff, 'Zafer');
  rr = await gLogin(Z, 'a@example.com', {});
  ff.fetch = realFetch;
  ok(!rr.ok && rr.error.startsWith('Sunucuya ulaşılamadı') && !Z.cloud.loggedIn && Z.ls.getItem(AUTH_KEY) == null && Z.profile.get().name === 'Zafer', 'hand-off refresh offline -> Turkish error, nothing stored');
}

console.log('Google: popup blocked -> redirect');
{
  const R = pc(ff, 'Rıza');
  const loads0 = SDK.loads;
  SDK.next = { error: 'auth/popup-blocked' };
  const blocked = await R.cloud.loginGoogle({ allowRedirect: true, askName: async () => 'Rıza' });
  ok(!blocked.ok && blocked.redirecting && blocked.silent && SDK.redirects === 1 && R.cloud.google.redirectPending(), 'popup blocked -> signInWithRedirect, flag in sessionStorage');
  ok(!(await gLogin(R, 'r@example.com', { error: 'auth/popup-blocked', allowRedirect: false })).redirecting, 'with a game running (allowRedirect false) it only reports the blocked popup');
  SDK.pendingRedirect = { email: 'r@example.com', displayName: 'Rıza' };   // Google sends the page back
  R.ss.setItem(REDIRECT_KEY, JSON.stringify({ t: T }));
  // page load without a pending redirect: the SDK stays unloaded
  const Q = pc(ff, 'Quiet');
  ok(!Q.cloud.google.redirectPending() && (await Q.cloud.finishGoogleRedirect()) === null && SDK.loads === loads0 + 1 && !Q.cloud.google.loaded, 'no pending redirect: nothing loaded on page load');
  const c = R.reload();
  const names = [];
  const rr = await c.finishGoogleRedirect({ askName: async (q) => { names.push(q.suggest); return 'Rıza'; } });
  ok(rr && rr.ok && rr.newAccount && names[0] === 'Rıza' && c.user.email === 'r@example.com' && !R.ss.getItem(REDIRECT_KEY), 'after the redirect: the result is handed over, the name asked, the flag cleared');
  ok(SDK.auths.every((x) => x.currentUser == null), 'and the SDK signed out again');
  R.ss.setItem('firebase:authUser:test-key:aevum-google', '{"x":1}');
  R.ss.setItem('other', '1');
  c.logout(); await settle();
  ok(!c.loggedIn && R.ss.getItem('firebase:authUser:test-key:aevum-google') == null && R.ss.getItem('other') === '1' && R.ls.getItem(AUTH_KEY) == null, 'sign out clears the SDK session storage (and only that)');
  const so = SDK.signOuts;
  await gLogin(R, 'r@example.com', {}); c.logout(); await settle();
  ok(SDK.signOuts >= so + 2, 'sign out also signs the loaded SDK out');
}

// ---------------------------------------------------------------- refresh
console.log('Session refresh');
{
  const before = ff.stats.refreshes;
  const t0 = await A.cloud.auth.token();
  ok(ff.stats.refreshes === before, 'fresh id token used as is');
  T += 56 * 60 * 1000;   // 4 minutes before expiry
  const t1 = await A.cloud.auth.token();
  ok(t1 !== t0 && ff.stats.refreshes === before + 1, 'refreshed 5 minutes before expiry');
  const [x, y] = await Promise.all([A.cloud.auth.token(true), A.cloud.auth.token(true)]);
  ok(x === y && ff.stats.refreshes === before + 2, 'concurrent refreshes share one request');
  ff.expireAllTokens();   // the server stops accepting the id token early (revoked / clock skew)
  const res = await A.cloud.flush({ pull: true });
  ok(res.ok && ff.stats.refreshes === before + 3, 'Firestore 401 -> refresh once and retry');
  const reloaded = new Auth({ fetch: ff.fetch, apiKey: 'test-key', ls: A.ls, now });
  ok(reloaded.user && reloaded.user.uid === aFb, 'session restored from localStorage (page reload)');
  T += 2 * 3600 * 1000;
  ok((await reloaded.token()) && ff.stats.refreshes === before + 4, 'expired session refreshed on first use');
}

// ---------------------------------------------------------------- rename
console.log('Rename');
r = await A.cloud.rename('Kerem2');
ok(r.ok && A.profile.get().name === 'Kerem2' && A.profile.get().uid === aUid, 'renamed (uid kept)');
ok(eq(ff.data('names/kerem2'), { uid: aFb }) && !ff.data('names/kerem'), 'new name claimed, old one released');
ok(ff.data(`users/${aFb}/meta/profile`).name === 'Kerem2', 'cloud profile renamed');
await A.cloud.flush(); ok(ff.data('profiles/' + aFb).name === 'Kerem2', 'public card renamed');
r = await B.cloud.rename('kerem2');
ok(!r.ok && r.error === 'Bu ad alınmış.' && B.profile.get().name === 'Zeynep', 'rename to a taken name refused');
r = await B.cloud.rename('Kerem');
ok(r.ok && eq(ff.data('names/kerem'), { uid: bFb }), 'a released name can be claimed by someone else');
r = await B.cloud.rename('KEREM');
ok(r.ok && B.profile.get().name === 'KEREM' && eq(ff.data('names/kerem'), { uid: bFb }), 'case-only rename keeps the same claim');
ff.offline = true;
r = await B.cloud.rename('Zeynep');
ok(!r.ok && /Çevrimdışı/.test(r.error) && B.profile.get().name === 'KEREM', 'offline rename refused with a Turkish message');
ff.offline = false;
{
  // a foreign client cannot steal a name doc or delete someone else's claim (the fake enforces the rules)
  let e = null; try { await B.cloud.fs.commit([{ del: 'names/kerem2' }]); } catch (x) { e = x; }
  ok(e && e.kind === 'denied' && eq(ff.data('names/kerem2'), { uid: aFb }), "rules: deleting someone else's name is denied");
  e = null; try { await B.cloud.fs.get(`users/${aFb}/meta/profile`); } catch (x) { e = x; }
  ok(e && e.kind === 'denied', "rules: reading another account's data is denied");
}

// ---------------------------------------------------------------- first login on another PC
console.log('First login on another PC');
const A2 = pc(ff, 'Misafir');
const gUid = A2.profile.get().uid;
const gRecs = [mkRec(gUid), mkRec(gUid, { id: 'mp-ZXCVB-' + gUid, mode: 'mp', result: 'lost' })];
const foreign = mkRec('f'.repeat(32));   // an imported record of another player: never taken over
await A2.history.put(gRecs.concat([foreign]));
let asked = null;
r = await gLogin(A2, 'a@example.com', { askMerge: async (n) => { asked = n; return true; } });
ok(r.asked.length === 0 && !r.newAccount, 'existing account: straight in (no user name question, no new name claim)');
ok(r.ok && r.switched, 'logged in; the local profile switched to the account');
ok(A2.profile.get().uid === aUid && A2.profile.get().name === 'Kerem2', 'multiplayer identity follows the account (uid + name)');
ok(asked === 2, 'asked about the 2 guest records (owned by the old local uid only)');
ok(JSON.parse(A2.ls.getItem(GUEST_KEY)).uid === gUid, 'guest profile kept for sign out');
const ids2 = [...A2.history.m.keys()];
ok(aRecs.every((x) => ids2.includes(x.id)), "the account's history was downloaded");
ok(ids2.includes('mp-ZXCVB-' + aUid) && !ids2.includes('mp-ZXCVB-' + gUid) && A2.history.m.get(gRecs[0].id).uid === aUid, 'guest records re-owned (mp record id follows the uid)');
ok(cloudIds(ff, aFb).length === 5 && cloudIds(ff, aFb).includes('mp-ZXCVB-' + aUid) && !cloudIds(ff, aFb).includes(foreign.id), 'merged guest records uploaded; the foreign record stays local');
ok(eq(A2.cloud.visibleHistory(await A2.history.list()).map((x) => x.id).sort(), cloudIds(ff, aFb).sort()), 'Profil shows the account history');
ok(ff.data('profiles/' + aFb).games === 5, 'public card counts the merged games');

const A3 = pc(ff, 'Konuk');
const kUid = A3.profile.get().uid;
await A3.history.put([mkRec(kUid)]);
r = await gLogin(A3, 'a@example.com', { askMerge: async () => false });
ok(r.ok && r.switched && r.merged === 0 && A3.profile.get().uid === aUid, 'third PC: declined the merge');
ok(cloudIds(ff, aFb).length === 5, 'declined guest history not uploaded');
const vis3 = A3.cloud.visibleHistory(await A3.history.list());
ok(vis3.length === 5 && vis3.every((x) => x.uid === aUid), "the guest's records are hidden while logged in");
A3.cloud.logout();
ok(!A3.cloud.loggedIn && A3.profile.get().uid === kUid && A3.profile.get().name === 'Konuk', 'sign out: back to the guest profile of this PC');
ok(!A3.ls.getItem(AUTH_KEY) && !A3.ls.getItem(GUEST_KEY), 'session cleared');
const visG = A3.cloud.visibleHistory(await A3.history.list());
ok(visG.length === 1 && visG[0].uid === kUid, "guest sees only his own records again (the account's cache is hidden)");
ok(A3.cloud.status === 'guest', 'status guest');

// the account was created from this PC's guest profile: sign out starts a fresh guest
A.cloud.logout();
ok(A.profile.get().uid !== aUid && A.profile.get().name === 'Kerem2' && P.isUid(A.profile.get().uid), 'sign out on the registering PC: a fresh guest uid');
r = await gLogin(A, 'a@example.com', { askMerge: async () => true });
ok(r.ok && A.profile.get().uid === aUid && r.merged === 0, 'logging back in restores the account profile (no guest records to ask about)');
ok([...A.history.m.keys()].length === 5, 'and pulls the records merged on the other PC');

// a new account logging in on a PC that has no profile yet (first launch -> "Hesabın var mı? Giriş yap")
{
  const N = pc(ff, null);
  const rr = await gLogin(N, 'b@example.com', {});
  ok(rr.ok && N.profile.get() && N.profile.get().name === 'KEREM' && N.profile.get().uid === B.profile.get().uid, 'login without a local profile adopts the account profile');
}

// ---------------------------------------------------------------- history sync
console.log('History sync');
{
  const rec = mkRec(aUid, { endedAt: T });
  await A.history.put(rec);
  const w0 = ff.stats.writes;
  A.cloud.onRecord(rec); await A.cloud.flush();
  A.cloud.onRecord(rec); await A.cloud.flush();
  ok(cloudIds(ff, aFb).filter((x) => x === rec.id).length === 1, 'same record id twice -> one cloud doc (idempotent)');
  ok(ff.stats.writes - w0 <= 4, 'writes stay small: ' + (ff.stats.writes - w0));
  const r0 = ff.stats.reads;
  const res = await A2.cloud.flush({ pull: true });
  ok(res.ok && A2.history.m.has(rec.id), 'other PC: new record pulled incrementally');
  ok(ff.stats.reads - r0 <= 4, 'incremental pull reads only the new docs: ' + (ff.stats.reads - r0) + ' reads');
  const r1 = ff.stats.reads;
  await A2.cloud.flush({ pull: true });
  ok(ff.stats.reads - r1 === 3, 'nothing new -> three reads (account profile + TP ledger + empty query): ' + (ff.stats.reads - r1));
  // (2026-11-22) this PC's local history is emptied (site data cleared): the next pull brings the account's records back
  { const pu = A2.cloud.o.profile.get().uid, mine = () => [...A2.history.m.values()].filter((r) => r.uid === pu).length;
    const before = mine(); A2.history.m.clear(); await A2.cloud.flush({ pull: true });
    ok(before > 0 && mine() === before, 'emptied local history is pulled back in full (' + mine() + '/' + before + ')'); }
  // the same match: PC2 has it finished, PC1 then writes an older 'abandoned' (left a loaded older save)
  const won = mkRec(aUid, { id: 'sp-00000000000000aa', endedAt: T, result: 'won' });
  await A2.history.put(won); A2.cloud.onRecord(won); await A2.cloud.flush();
  T += 1000;
  const ab = Object.assign({}, won, { result: 'abandoned', endedAt: T });
  await A.history.put(ab); A.cloud.onRecord(ab); await A.cloud.flush();
  ok(JSON.parse(ff.data(`users/${aFb}/matches/sp-00000000000000aa`).j).result === 'won' && A.history.m.get('sp-00000000000000aa').result === 'won', "a finished result is never replaced by a later 'abandoned'");
}
console.log('Read savings (2026-11-23: the free daily read quota ran out)');
{
  T += PULL_EVERY + 1000;
  let r0 = ff.stats.reads;
  await A2.cloud.flush({ pull: 'lazy' });
  ok(ff.stats.reads - r0 === 3, 'a lazy pull runs when the last one is PULL_EVERY old: ' + (ff.stats.reads - r0) + ' reads');
  r0 = ff.stats.reads;
  await A2.cloud.flush({ pull: 'lazy' }); A2.cloud.kick({ pull: 'lazy' }); await A2.cloud._busy;
  ok(ff.stats.reads - r0 === 0, 'lazy pulls right after it read nothing: ' + (ff.stats.reads - r0));
  // the local history shrank: the re-pull of everything never loses the cursor when it fails, and is capped per day
  const st = A2.cloud._st(), cur = JSON.stringify(st.cursor), persisted = () => JSON.stringify(JSON.parse(A2.ls.getItem(STATE_PREFIX + aFb)).cursor);
  ok(cur && cur !== 'null', 'a cursor is held');
  st.fullAt = [];   // (the emptied-history test above used one of today's re-pulls)
  st.known = (st.known | 0) + 5; A2.cloud._save();
  ff.failNext(503, 1, ':runQuery');
  await A2.cloud.flush({ pull: true });
  A2.cloud._queue('h', []); A2.cloud._save();   // (any later state write)
  ok(JSON.stringify(A2.cloud._st().cursor) === cur && persisted() === cur, 'a failed re-pull leaves the cursor as it was (memory and stored)');
  if (A2.cloud._retry != null) { A2.cloud.clearTimer(A2.cloud._retry); A2.cloud._retry = null; }
  r0 = ff.stats.reads;
  await A2.cloud.flush({ pull: true });
  const full = ff.stats.reads - r0;
  ok(full > 3 && A2.cloud._st().known === [...A2.history.m.values()].filter((r) => r.uid === aUid).length, 'the next try re-pulls everything once: ' + full + ' reads');
  st.known = (st.known | 0) + 5; A2.cloud._save();
  r0 = ff.stats.reads;
  await A2.cloud.flush({ pull: true });
  ok(ff.stats.reads - r0 === 3, 'a third re-pull the same day does not run: ' + (ff.stats.reads - r0) + ' reads');
  T += 25 * 3600 * 1000;
  r0 = ff.stats.reads;
  await A2.cloud.flush({ pull: true });
  ok(ff.stats.reads - r0 > 3, 'the next day it may run again');
}
console.log('Offline queue');
{
  ff.offline = true;
  const rec = mkRec(aUid, { endedAt: T });
  await A.history.put(rec); A.cloud.onRecord(rec); await A.cloud.flush();
  ok(A.cloud.status === 'offline' && A.cloud.statusText === 'Çevrimdışı', 'offline -> status Çevrimdışı');
  ok(JSON.parse(A.ls.getItem(STATE_PREFIX + aFb)).queue.h.includes(rec.id), 'write queued in localStorage');
  ok(timers.length > 0, 'retry scheduled');
  const c2 = A.reload();     // page reload while offline: the queue survives
  ok(c2.status === 'offline' || c2.status === 'pending', 'after reload the queue is still pending: ' + c2.status);
  ff.offline = false;
  T += 60 * 1000; await runTimers(); await A.cloud.flush();
  ok(cloudIds(ff, aFb).includes(rec.id) && A.cloud.status === 'synced', 'flushed when back online -> Senkronize');
  ff.failNext(503, 1, ':commit');
  const rec2 = mkRec(aUid, { endedAt: T });
  await A.history.put(rec2); A.cloud.onRecord(rec2); await A.cloud.flush();
  ok(A.cloud.status === 'offline' && !cloudIds(ff, aFb).includes(rec2.id), '503 -> retried later');
  T += 5 * 60 * 1000; await runTimers(); await A.cloud.flush();
  ok(cloudIds(ff, aFb).includes(rec2.id) && A.cloud.status === 'synced', 'retry succeeded');
  ff.failNext(429, 1, ':commit');
  const rec3 = mkRec(aUid, { endedAt: T });
  await A.history.put(rec3); A.cloud.onRecord(rec3); await A.cloud.flush();
  ok(A.cloud.status === 'offline' && /kota/.test(A.cloud.lastError), 'quota -> ' + A.cloud.lastError);
  { const q0 = ff.stats.requests;
    A.cloud.kick({ pull: true }); await A.cloud._busy; await A.cloud.flush({ pull: true }); await A.cloud.listCloudSaves({ force: true });
    const A3 = A.reload(); await A3.flush({ pull: true });
    ok(ff.stats.requests === q0, 'during the quota pause nothing reaches Firestore (kicks, flushes, lists, a reload): ' + (ff.stats.requests - q0) + ' requests'); }
  T += 41 * 60 * 1000; await runTimers(); await A.cloud.flush();   // (the quota pause: 30-40 minutes)
  ok(cloudIds(ff, aFb).includes(rec3.id), 'quota retry succeeded');
  ff.revokeRefresh(); ff.expireAllTokens();
  const rec4 = mkRec(aUid, { endedAt: T });
  await A.history.put(rec4); A.cloud.onRecord(rec4); await A.cloud.flush();
  ok(A.cloud.status === 'expired' && A.cloud.statusText === 'Oturum süresi doldu', 'refresh token rejected -> Oturum süresi doldu (playing goes on)');
  r = await gLogin(A, 'a@example.com', {});
  ok(r.ok && A.cloud.status === 'synced' && cloudIds(ff, aFb).includes(rec4.id), 'log in again -> the queued record is uploaded');
  await gLogin(A2, 'a@example.com', {});   // (A2's session was revoked as well)
}

// ---------------------------------------------------------------- saves
console.log('Cloud saves');
const bigData = (n) => ({ players: [{ name: 'Kerem', team: 1 }, { name: 'YZ', team: 2, isAI: true }], cfg: { mapSize: 128 }, ents: Array.from({ length: n }, (_, i) => ({ id: i, x: (i * 7919) % 1000, h: ((i * 2654435761) >>> 0).toString(36) })) });
{
  const mid = '00112233445566ff';
  const rec = { name: 'Kayıt — 11.11.2026 10:00', time: T, matchId: mid, data: bigData(3000) };
  await A.saves.put('manual-1', rec);
  A.cloud.onSaved('manual-1', { game: mid });
  await A.cloud.flush();
  const meta = ff.data(`users/${aFb}/saves/manual-1`);
  const chunks = ff.paths(`users/${aFb}/saves/manual-1/chunks/`);
  ok(meta && meta.chunks > 1 && chunks.length === meta.chunks && meta.enc === 'gzip' && meta.sha.length === 64 && meta.name === rec.name, `manual save uploaded: ${meta && meta.chunks} chunks, ${meta && meta.size} bytes, sha ok`);
  ok(chunks.every((p) => ff.data(p).d.length <= 4096 && ff.data(p).sha === meta.sha), 'every chunk well under the doc limit and tagged with the save sha');
  const w0 = ff.stats.writes;
  A.cloud.onSaved('manual-1', { game: mid }); await A.cloud.flush();
  ok(ff.stats.writes === w0, 'unchanged save is not uploaded again');
  // other PC: listed as cloud-only, downloaded on use
  const cl = await A2.cloud.listCloudSaves({ force: true });
  const merged = mergeSaveLists(await A2.saves.list(), cl);
  const it = merged.find((x) => x.key === 'manual-1');
  ok(it && it.cloud === 'only', 'other PC lists it as ☁ cloud-only');
  const got = await A2.cloud.downloadSave(it.ck, it.key);
  ok(eq(got, rec) && eq(await A2.saves.get('manual-1'), rec), 'download round trip (stored locally)');
  ok(mergeSaveLists(await A2.saves.list(), await A2.cloud.listCloudSaves()).find((x) => x.key === 'manual-1').cloud === 'synced', 'after download: synced');
  // integrity: a corrupted chunk / a chunk of another upload
  const cpath = (i) => `users/${aFb}/saves/manual-1/chunks/${meta.gen}-${i}`;
  ok(/^[0-9a-f]{12}$/.test(meta.gen) && chunks.every((p) => p.split('/').pop().startsWith(meta.gen + '-')), 'chunk docs carry the version prefix');
  const c1 = cpath(1);
  const orig = JSON.parse(JSON.stringify(ff.docs.get(c1).fields));
  const d = ff.data(c1).d;
  ff.setField(c1, 'd', { stringValue: d.slice(0, 100) + (d[100] === 'A' ? 'B' : 'A') + d.slice(101) });
  let e = null; try { await A2.cloud.downloadSave('manual-1', 'x-1'); } catch (x) { e = x; }
  ok(e && !(await A2.saves.get('x-1')), 'corrupted chunk -> download refused: ' + (e && e.message));
  ff.docs.get(c1).fields = orig;
  ff.setField(c1, 'sha', { stringValue: '0'.repeat(64) });
  e = null; try { await A2.cloud.downloadSave('manual-1', 'x-1'); } catch (x) { e = x; }
  ok(e && /bütünlük/.test(e.message), 'chunk of another upload -> ' + (e && e.message));
  ff.docs.get(c1).fields = orig;
  ff.docs.delete(cpath(2));
  e = null; try { await A2.cloud.downloadSave('manual-1', 'x-1'); } catch (x) { e = x; }
  ok(e && /bütünlük/.test(e.message), 'missing chunk -> ' + (e && e.message));
  // re-upload smaller: stale chunks removed
  const small = Object.assign({}, rec, { time: T + 1, data: bigData(10) });
  await A.saves.put('manual-1', small); A.cloud.onSaved('manual-1', { game: mid }); await A.cloud.flush();
  const m2 = ff.data(`users/${aFb}/saves/manual-1`);
  ok(m2.chunks === 1 && ff.paths(`users/${aFb}/saves/manual-1/chunks/`).length === 1, 'smaller re-upload deletes the stale chunks');
  ok(eq(await A2.cloud.downloadSave('manual-1'), small), 'and downloads correctly');
}
console.log('Autosave gate');
{
  const mid = 'aabbccddeeff0011';
  const w = () => ff.paths(`users/${aFb}/saves/auto-${mid}`).length;
  await A.saves.put('auto', { name: 'Otomatik Kayıt', time: T, matchId: mid, data: bigData(5) });
  A.cloud.onSaved('auto', { auto: true, game: mid }); await A.cloud.flush();
  ok(!!ff.data(`users/${aFb}/saves/auto-${mid}`), 'first autosave of a game uploaded (as auto-<match id>)');
  ok(ff.data(`users/${aFb}/saves/auto-${mid}`).auto === true, 'marked auto');
  T += 90 * 1000;
  await A.saves.put('auto', { name: 'Otomatik Kayıt', time: T, matchId: mid, data: bigData(6) });
  A.cloud.onSaved('auto', { auto: true, game: mid }); await A.cloud.flush();
  ok(ff.data(`users/${aFb}/saves/auto-${mid}`).time === T - 90 * 1000, '90 s later: not uploaded (5 minute gate)');
  A.cloud.onLeave(mid); await A.cloud.flush();
  ok(ff.data(`users/${aFb}/saves/auto-${mid}`).time === T, 'leaving the game uploads the waiting autosave');
  T += 5 * 60 * 1000 + 1;
  await A.saves.put('auto', { name: 'Otomatik Kayıt', time: T, matchId: mid, data: bigData(7) });
  const sr0 = ff.stats.reads;
  A.cloud.onSaved('auto', { auto: true, game: mid }); await A.cloud.flush();
  ok(ff.stats.reads === sr0, 'a re-upload does not list the cloud saves again: ' + (ff.stats.reads - sr0) + ' reads');
  ok(ff.data(`users/${aFb}/saves/auto-${mid}`).time === T && w() >= 1, 'after 5 minutes: uploaded again');
  // the autosave of a different match on this PC keeps the other one in the cloud
  const mid2 = '1111111111111111';
  await A.saves.put('auto', { name: 'Otomatik Kayıt', time: T + 5, matchId: mid2, data: bigData(5) });
  A.cloud.onSaved('auto', { auto: true, game: mid2 }); await A.cloud.flush();
  ok(!!ff.data(`users/${aFb}/saves/auto-${mid2}`) && !!ff.data(`users/${aFb}/saves/auto-${mid}`), 'one cloud autosave per match');
  // (2026-11-23 player report) the autosave of a match queued during a quota pause, then a new match overwrites the
  // local 'auto' slot: the old match must still reach the cloud (it was lost: the queue uploaded the new match only)
  const mid3 = '3333333333333333', mid4 = '4444444444444444';
  T += 6 * 60 * 1000;
  await A.saves.put('auto', { name: 'Otomatik Kayıt', time: T, matchId: mid3, data: bigData(5) });
  ff.failNext(429, 1, ':commit');
  A.cloud.onSaved('auto', { auto: true, game: mid3 }); await A.cloud.flush();
  ok(!ff.data(`users/${aFb}/saves/auto-${mid3}`) && A.cloud.quotaWait() > 0, 'quota: the autosave of match 3 waits');
  ok(await A.cloud.keepAutoSlot(mid4) === 'auto-' + mid3 && !!(await A.saves.get('auto-' + mid3)), 'a new match: the waiting autosave slot is kept as auto-<match id>');
  await A.saves.put('auto', { name: 'Otomatik Kayıt', time: T + 60000, matchId: mid4, data: bigData(6) });
  A.cloud.onSaved('auto', { auto: true, game: mid4 });
  T += 41 * 60 * 1000; await runTimers(); await A.cloud.flush();
  ok(!!ff.data(`users/${aFb}/saves/auto-${mid3}`) && !!ff.data(`users/${aFb}/saves/auto-${mid4}`), 'after the quota pause both matches are in the cloud');
  ok(!(await A.saves.get('auto-' + mid3)) && (await A.saves.get('auto')).matchId === mid4, 'the kept local copy is removed once uploaded');
  ok(await A.cloud.keepAutoSlot('5555555555555555') === null, 'nothing waiting: the slot is not copied');
}
console.log('Multiplayer save across PCs');
{
  const players = [{ name: 'Kerem2', uid: aUid, team: 1, kind: 'human', difficulty: null, color: 1, left: false, defeated: false }, { name: 'Ali', uid: 'c'.repeat(32), team: 2, kind: 'human', difficulty: null, color: 2, left: false, defeated: false }];
  const rec = { name: 'Çok Oyunculu — x', time: T, mp: true, code: 'ABCDE', tick: 3600, me: 0, hash: 12345, by: 'Kerem2', players, data: bigData(50) };
  await A.saves.put('mp-ABCDE-3600', rec);
  A.cloud.onSaved('mp-ABCDE-3600', { game: 'mp-ABCDE' }); await A.cloud.flush();
  const cl = await A2.cloud.listCloudSaves({ force: true });
  const it = cl.find((x) => x.key === 'mp-ABCDE-3600');
  ok(it && it.mp && it.code === 'ABCDE' && it.tick === 3600 && it.hash === 12345 && eq(it.players.map((p) => p.uid), [aUid, 'c'.repeat(32)]), 'meta lists mp, code, tick, hash and the players with their uids');
  const got = await A2.cloud.downloadSave('mp-ABCDE-3600');
  ok(eq(got, rec) && got.players[0].uid === A2.profile.get().uid, 'downloaded on PC 2: the host slot uid is this PC\'s (account) profile uid');
}
console.log('Pruning + delete');
{
  const before = (await A.cloud.listCloudSaves({ force: true })).length;
  for (let i = 0; i < 34; i++) {
    T += 1000;
    const k = i % 2 ? 'manual-p' + i : 'auto-p' + i;
    await A.saves.put(k, { name: 'p' + i, time: T, matchId: null, data: bigData(3) });
    A.cloud.onSaved(k, {}); await A.cloud.flush();
  }
  const metas = ff.paths(`users/${aFb}/saves/`).filter((p) => !p.includes('/chunks/'));
  const keys = metas.map((p) => p.split('/').pop());
  const autos = keys.filter((k) => isAutoKey(k)).length;
  ok(metas.length <= MAX_CLOUD_SAVES && autos === MAX_CLOUD_AUTOS, `at most ${MAX_CLOUD_SAVES} cloud saves, ${MAX_CLOUD_AUTOS} of them autosaves (had ${before}, uploaded 34): ${metas.length}, ${autos} auto`);
  ok(keys.includes('manual-1') && keys.includes('mp-ABCDE-3600') && keys.filter((k) => k.startsWith('manual-p')).length === 17, 'manual / multiplayer saves kept, autosaves pruned');
  const orphan = ff.paths(`users/${aFb}/saves/`).filter((p) => p.includes('/chunks/') && !keys.includes(p.split('/')[3]));
  ok(orphan.length === 0, 'pruned saves leave no orphan chunks');
  await A.cloud.deleteCloudSave('mp-ABCDE-3600');
  ok(ff.paths(`users/${aFb}/saves/mp-ABCDE-3600`).length === 0, 'delete removes the meta doc and its chunks');
}
console.log('History delete');
{
  const ids = [...A.history.m.keys()];
  await A.cloud.deleteHistory(ids);
  ok(cloudIds(ff, aFb).length === 0, 'account history deleted from the cloud');
}

// ---------------------------------------------------------------- review fixes (separate fake project)
console.log('Turkish name folding');
{
  const k = (...ns) => new Set(ns.map(nameKey)).size === 1;
  ok(k('İsa', 'ISA', 'isa', 'Isa', 'İsa'), 'İsa / ISA / isa / Isa collide');
  ok(k('ışık', 'IŞIK', 'Işık', 'işik'), 'ışık / IŞIK / Işık collide');
  ok(k('İLKER', 'ILKER', 'ılker', 'ilker'), 'İLKER / ILKER / ılker / ilker collide');
  ok(nameKey('Çağrı') === nameKey('ÇAĞRI') && nameKey('Öz') !== nameKey('Oz'), 'other Turkish letters fold by case only');
}
{
  const fx = fakeFirebase({ projectId: 'test-proj', apiKey: 'test-key', now });
  const realFetch = fx.fetch;
  let hook = null;
  fx.fetch = (u, i) => (hook ? hook(u, i, realFetch) : realFetch(u, i));
  const later = () => { let go; const p = new Promise((r) => { go = r; }); return { p, go }; };
  const isSts = (u) => /securetoken/.test(u);

  console.log('Refresh race (sign out / another sign in during a refresh)');
  const X = pc(fx, 'Xavier');
  ok((await gLogin(X, 'x@example.com', { names: ['Xavier'] })).ok, 'register X');
  ok(!/idToken|"id\./.test(X.ls.getItem(AUTH_KEY)) && /refreshToken/.test(X.ls.getItem(AUTH_KEY)), 'localStorage session holds no id token');
  {
    const gate = later();
    hook = async (u, i, f) => { if (isSts(u)) { await gate.p; } return f(u, i); };
    const tp = X.cloud.auth.token(true).catch((e) => e);
    await settle();
    X.cloud.logout();
    gate.go(); const r = await tp; hook = null; await settle();
    ok(r && r.kind === 'stale' && !X.cloud.loggedIn && X.ls.getItem(AUTH_KEY) == null, 'refresh landing after sign out is discarded (stays signed out, nothing stored)');
  }
  const Y = pc(fx, 'Yusuf');
  ok((await gLogin(Y, 'y@example.com', { names: ['Yusuf'] })).ok, 'register Y');
  const yFb = Y.cloud.user.uid;
  ok((await gLogin(X, 'x@example.com')).ok, 'X logs in again');
  {
    const gate = later();
    hook = async (u, i, f) => { if (isSts(u)) { await gate.p; } return f(u, i); };
    const tp = X.cloud.auth.token(true).catch((e) => e);
    await settle();
    hook = async (u, i, f) => { if (isSts(u)) { await gate.p; } return f(u, i); };
    const lp = gLogin(X, 'y@example.com', { askMerge: async () => false });
    await settle(); gate.go(); await tp; const lr = await lp; hook = null; await settle();
    ok(lr.ok && X.cloud.user.uid === yFb && X.cloud.user.email === 'y@example.com' && JSON.parse(X.ls.getItem(AUTH_KEY)).uid === yFb, 'a refresh of X landing after login(Y) leaves the session Y');
    X.cloud.logout();
  }
  {
    const before = fx.stats.refreshes;
    Y.cloud.auth.dead = true;
    let e = null; try { await Y.cloud.auth.token(false); } catch (x) { e = x; }
    ok(e && e.kind === 'auth' && fx.stats.refreshes === before, 'dead session: token() fails without another refresh request');
    Y.cloud.auth.dead = false;
  }

  console.log('Cross-tab sign out');
  {
    const tab2 = new CloudSync({ fetch: fx.fetch, apiKey: 'test-key', projectId: 'test-proj', ls: Y.ls, now, setTimer, clearTimer, profile: Y.profile, history: Y.history, saves: Y.saves });
    ok(tab2.loggedIn, 'second tab shares the session');
    Y.cloud.logout();
    const gate = later();
    hook = async (u, i, f) => { if (isSts(u)) { await gate.p; } return f(u, i); };
    const tp = tab2.auth.token(true).catch((e) => e);
    await settle();
    tab2.onAuthStorage();   // the 'storage' event of the first tab's sign out
    gate.go(); await tp; hook = null; await settle();
    ok(!tab2.loggedIn && Y.ls.getItem(AUTH_KEY) == null, 'the other tab follows the sign out; its refresh does not bring the session back');
    ok((await gLogin(Y, 'y@example.com', { askMerge: async () => false })).ok, 'Y logs in again in tab 1');
    tab2.onAuthStorage();
    ok(tab2.loggedIn && tab2.user.uid === yFb, 'tab 2 adopts the new sign in');
  }

  console.log('Rename failures');
  {
    // the profile write fails after the new name was claimed: the new name is given back
    hook = async (u, i, f) => { if (/:commit/.test(u) && /meta%2Fprofile|meta\/profile/.test(i.body || '')) throw new TypeError('Failed to fetch'); return f(u, i); };
    const r = await Y.cloud.rename('Yeniad');
    hook = null;
    ok(!r.ok && !fx.data('names/' + nameKey('Yeniad')) && !!fx.data('names/' + nameKey('Yusuf')), 'failed profile write releases the freshly claimed name');
    // releasing the old name fails (offline): queued and released by the next flush
    let n = 0;
    hook = async (u, i, f) => { if (/:commit/.test(u) && /names\/yusuf"/.test(i.body || '') && /"delete"/.test(i.body || '') && n++ === 0) throw new TypeError('Failed to fetch'); return f(u, i); };
    const r2 = await Y.cloud.rename('Yağız');
    ok(r2.ok && !!fx.data('names/' + nameKey('Yusuf')) && Y.cloud._st().release.includes(nameKey('Yusuf')), 'offline old-name release is queued');
    await Y.cloud.flush(); hook = null;
    ok(!fx.data('names/' + nameKey('Yusuf')) && !Y.cloud._st().release.length, 'next flush releases the old name');
  }

  console.log('New account: name claim committed but the answer lost');
  {
    let n = 0;
    hook = async (u, i, f) => { if (/:commit/.test(u) && /names\//.test(i.body || '') && n++ === 0) { await f(u, i); throw new TypeError('Failed to fetch'); } return f(u, i); };
    const Z = pc(fx, 'Zeki');
    const r = await gLogin(Z, 'z@example.com', { names: ['Zeynep'] });
    hook = null;
    ok(r.ok && Z.cloud.loggedIn && fx.data('names/' + nameKey('Zeynep')).uid === Z.cloud.user.uid, 'the account is kept (the name doc is ours)');
    Z.cloud.logout();
    await (await session(fx, 'z@example.com')).deleteAccount();
  }

  console.log('Account whose profile was never written (asked for a name, taken one refused)');
  {
    const W = pc(fx, 'Yağız');   // a guest named like Y's account
    const rr = await gLogin(W, 'w@example.com', { names: ['Wolf'] });
    ok(rr.ok, 'W signs up as Wolf');
    const wFb = W.cloud.user.uid;
    fx.docs.delete(`users/${wFb}/meta/profile`);
    W.cloud.logout();
    W.profile.set({ v: 1, uid: W.profile.get().uid, name: 'Yağız', created: T });
    W.ls.removeItem(ACCOUNT_UIDS_KEY);
    const r = await gLogin(W, 'w@example.com', { names: ['Yağız', 'Wolf'] });
    const meta = fx.data(`users/${wFb}/meta/profile`);
    ok(r.ok && r.asked.length === 2 && r.asked[0].suggest === 'Yağız' && /alınmış/.test(r.asked[1].error) && meta.name === 'Wolf' && fx.data('names/wolf').uid === wFb && W.profile.get().name === 'Wolf', 'asked again for the taken name; its own earlier name is accepted');
    W.cloud.logout();
    { const a = await session(fx, 'w@example.com'); const { firestoreApi } = await import('../src/cloud/rest.js'); await firestoreApi({ fetch: fx.fetch, projectId: 'test-proj', token: (f) => a.token(f) }).commit([{ del: 'names/wolf' }]); await a.deleteAccount(); }
  }

  console.log('Rename reaches the other PC');
  {
    const Y2 = pc(fx, 'Başka');
    ok((await gLogin(Y2, 'y@example.com', { askMerge: async () => false })).ok && Y2.profile.get().name === 'Yağız', 'PC 2 logged in as Yağız');
    ok((await Y.cloud.rename('Kartal')).ok, 'PC 1 renames to Kartal');
    T += PULL_EVERY + 1000;   // (a restart pulls again once this browser's last pull is PULL_EVERY old)
    Y2.reload();   // restarted with its stored session
    Y2.cloud.start(); await Y2.cloud._busy; await settle();
    ok(Y2.profile.get().name === 'Kartal' && fx.data('profiles/' + yFb).name === 'Kartal', 'PC 2 takes the new name; the public card keeps it');
    const rec = mkRec(Y2.profile.get().uid); await Y2.history.put(rec); Y2.cloud.onRecord(rec); await Y2.cloud._busy; await settle();
    ok(fx.data('profiles/' + yFb).name === 'Kartal', 'a game on PC 2 does not put the old name back');
  }

  console.log('History batch with one bad record');
  {
    const p = Y.profile.get();
    const recs = [mkRec(p.uid), mkRec(p.uid), mkRec(p.uid)];
    await Y.history.put(recs);
    const bad = recs[1].id;
    hook = async (u, i, f) => { if (/:commit/.test(u) && (i.body || '').includes('/matches/' + bad)) return { ok: false, status: 400, text: async () => JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'bad doc' } }) }; return f(u, i); };
    Y.cloud._queue('h', recs.map((r) => r.id));
    await Y.cloud.flush(); hook = null;
    const ids = cloudIds(fx, yFb);
    ok(ids.includes(recs[0].id) && ids.includes(recs[2].id) && !ids.includes(bad) && !Y.cloud._st().queue.h.length, 'only the refused record is dropped; the others are uploaded');
  }

  console.log('Save re-upload interrupted');
  for (const atomic of [true, false]) {
    const key = atomic ? 'manual-a' : 'manual-b';
    const PCx = pc(fx, null);
    const mkc = () => new CloudSync({ fetch: fx.fetch, apiKey: 'test-key', projectId: 'test-proj', ls: Y.ls, now, setTimer, clearTimer, profile: Y.profile, history: Y.history, saves: Y.saves, packOpts: { chunkChars: 4096 }, atomicChars: atomic ? 0 : 1 });
    const c = mkc();   // atomicChars 1: every save takes the multi-commit path
    const v1 = { name: 'v1', time: T, matchId: null, data: bigData(2000) };
    await Y.saves.put(key, v1); c.onSaved(key, {}); await c.flush();
    const g1 = fx.data(`users/${yFb}/saves/${key}`).gen;
    const v2 = { name: 'v2', time: T + 1, matchId: null, data: bigData(2500) };
    await Y.saves.put(key, v2);
    // the commit that switches the meta doc fails (the chunk commits before it went through)
    hook = async (u, i, f) => { if (/:commit/.test(u) && (i.body || '').includes(`/saves/${key}"`)) throw new TypeError('Failed to fetch'); return f(u, i); };
    c.onSaved(key, {}); await c.flush(); hook = null;
    const Pb = new CloudSync({ fetch: fx.fetch, apiKey: 'test-key', projectId: 'test-proj', ls: memLS(), now, setTimer, clearTimer, profile: PCx.profile, history: PCx.history, saves: PCx.saves });
    await Pb.auth.adopt(fx.googleSignIn('y@example.com'));
    let got = null; try { got = await Pb.downloadSave(key); } catch (e) { got = e; }
    ok(got && got.name === 'v1', (atomic ? 'atomic' : 'chunked') + ' upload cut off: the previous version still downloads on another PC');
    await c.flush();
    const m = fx.data(`users/${yFb}/saves/${key}`);
    got = await Pb.downloadSave(key);
    ok(m.name === 'v2' && got.name === 'v2' && m.gen !== g1 && !fx.paths(`users/${yFb}/saves/${key}/chunks/${g1}-`).length && fx.paths(`users/${yFb}/saves/${key}/chunks/`).length === m.chunks, 'retry: new version up, the old version\'s chunks deleted');
    Pb.auth.signOut();
  }

  console.log('Account switch during a running sync');
  {
    const B2 = pc(fx, 'Bora');
    ok((await gLogin(B2, 'y@example.com', { askMerge: async () => false })).ok, 'PC B: Y');
    B2.cloud.logout();
    const Q = pc(fx, 'Qadir'); ok((await gLogin(Q, 'q@example.com', { names: ['Qadir'] })).ok, 'register Q');
    const qFb = Q.cloud.user.uid;
    for (let i = 0; i < 3; i++) { const r = mkRec(Q.profile.get().uid); await Q.history.put(r); Q.cloud.onRecord(r); }
    await Q.cloud.flush(); Q.cloud.logout();
    ok((await gLogin(B2, 'y@example.com', { askMerge: async () => false })).ok, 'PC B: Y again');
    const gate = later();
    hook = async (u, i, f) => { if (/:runQuery/.test(u)) await gate.p; return f(u, i); };
    const slow = B2.cloud.flush({ pull: true });
    await settle();
    hook = null;
    const lp = gLogin(B2, 'q@example.com', { askMerge: async () => false });
    await settle(); gate.go(); await slow; const lr = await lp;
    const vis = B2.cloud.visibleHistory(await B2.history.list());
    ok(lr.ok && B2.cloud.user.uid === qFb && vis.length === 3, 'the new account\'s first sync is not swallowed by the old loop: ' + vis.length + ' records');
    B2.cloud.logout();
    await (await session(fx, 'q@example.com')).deleteAccount();
  }
  for (const em of ['x@example.com', 'y@example.com']) await (await session(fx, em)).deleteAccount();
  ok(fx.users.size === 0, 'review-fix test accounts deleted');
}
console.log('History cap per profile');
{
  const { historyTrimIds } = await import('../src/storage.js');
  const all = [];
  for (let i = 0; i < 600; i++) all.push({ id: 'a' + i, uid: 'a'.repeat(32), endedAt: 10000 - i });
  for (let i = 0; i < 100; i++) all.push({ id: 'g' + i, uid: 'b'.repeat(32), endedAt: 100 - i });
  all.sort((x, y) => y.endedAt - x.endedAt);
  const drop = historyTrimIds(all, 500);
  ok(drop.length === 100 && drop.every((id) => id.startsWith('a')), 'an account\'s pulled history never evicts the guest\'s records');
}

console.log('Mandatory accounts: automatic user name, avatar, TP ledger, sign out, delete');
{
  const { createIdentity } = await import('../srv/identity.mjs');
  const { isAvatar } = await import('../src/avatars.js');
  const { ledgerInfo } = await import('../src/cloud/sync.js');
  const fz = fakeFirebase({ now });
  let clockMs = T;   // (the server clock: tickets expire on the same time line as the client)
  const idm = createIdentity({ noAuth: true, now: () => clockMs, tpMinMs: 5 * 60 * 1000 });
  const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
  const mkPc = () => {
    const X = pc(fz);
    X.profile.clear = () => X.ls.removeItem(P.PROFILE_KEY);
    X.cloud.guestless = true;
    X.cloud.relayFetch = async (url, init) => {
      const body = JSON.parse(init.body || '{}');
      if (url === '/mp/auth') {
        const p = X.profile.get();
        return json(await idm.auth({ dev: { fb: X.cloud.user.uid, uid: p.uid, name: p.name, av: p.avatar, ledger: X.cloud._st().tp || null } }));
      }
      const me = idm.checkTicket(init.headers['X-Aevum-Ticket']);
      if (!me) return json({ error: 'ticket' }, 401);
      if (url === '/mp/tp/start') return json(idm.matchStart(me, body));
      if (url === '/mp/tp/claim') return json(idm.matchClaim(me, body));
      return json({}, 404);
    };
    return X;
  };
  const login = async (X, email) => { sdkOf(fz).next = { email }; return X.cloud.loginGoogle({ askMerge: async () => false }); };
  const A1 = mkPc();
  let r = await login(A1, 'ali.veli@gmail.com');
  ok(r.ok && r.newAccount && A1.profile.get().name === 'aliveli', 'new account: user name from the e-mail without a question (' + (A1.profile.get() || {}).name + ')');
  ok(isAvatar(A1.profile.get().avatar) && fz.data('users/' + A1.cloud.user.uid + '/meta/profile').avatar === A1.profile.get().avatar, 'new account gets an automatic avatar, stored in the cloud profile');
  const B1 = mkPc();
  r = await login(B1, 'ali.veli@yahoo.com');
  ok(r.ok && B1.profile.get().name === 'aliveli2', 'a taken name gets a number: ' + B1.profile.get().name);
  ok((await A1.cloud.setAvatar('crown')).ok && A1.profile.get().avatar === 'crown' && fz.data('users/' + A1.cloud.user.uid + '/meta/profile').avatar === 'crown', 'avatar change reaches the cloud profile');
  ok(!(await A1.cloud.setAvatar('../evil')).ok, 'unknown avatar ids are refused');
  await A1.cloud.flush();
  ok(fz.data('profiles/' + A1.cloud.user.uid).avatar === 'crown', 'the public card shows the avatar');
  // TP
  const mt = await A1.cloud.tpStart('sp');
  ok(typeof mt === 'string', 'match ticket from the server');
  let c = await A1.cloud.tpClaim(mt, 'won');
  ok(c.ok && c.gained === 0, 'a match under 5 minutes: no TP');
  const mt2 = await A1.cloud.tpStart('sp');
  clockMs += 6 * 60 * 1000;
  c = await A1.cloud.tpClaim(mt2, 'won');
  ok(c.gained === 3 && A1.cloud.tp.tp === 3, 'win: +3 TP');
  const mt3 = await A1.cloud.tpStart('sp');
  clockMs += 6 * 60 * 1000;
  c = await A1.cloud.tpClaim(mt3, 'lost');
  ok(c.gained === 1 && A1.cloud.tp.tp === 4, 'loss: +1 TP');
  ok((await A1.cloud.tpClaim(mt3, 'lost')).gained === 0, 'the same match never counts twice');
  { let auths = 0; const rf = A1.cloud.relayFetch; A1.cloud.relayFetch = async (u, i) => { if (u === '/mp/auth') auths++; return rf(u, i); };
    await A1.cloud.relayTicket(); auths = 0;
    A1.cloud._tkt = null;   // a reload: memory gone, localStorage kept
    const t2 = await A1.cloud.relayTicket(); await A1.cloud.isOwner(); const mty = await A1.cloud.tpStart('sp');
    ok(auths === 0 && t2 && t2.ident.fb === A1.cloud.user.uid && typeof mty === 'string' && A1.cloud.ticketNow() === t2.ticket, 'the relay ticket is reused from localStorage after a reload (no /mp/auth): ' + auths);
    A1.cloud._setTicket(Object.assign({}, t2, { ticket: t2.ticket.slice(0, -3) + 'xyz' }));
    const mtx = await A1.cloud.tpStart('sp');
    ok(typeof mtx === 'string' && auths === 1, 'a stored ticket the server refuses is replaced once (TP still works): ' + auths);
    A1.cloud.relayFetch = rf; }
  ok((await A1.cloud.tpClaim(await A1.cloud.tpStart('sp'), 'abandoned')).gained === 0, 'abandoned: 0 TP');
  await A1.cloud.flush();
  const stored = fz.data('users/' + A1.cloud.user.uid + '/meta/tp');
  ok(stored && ledgerInfo(stored.s).tp === 4, 'the signed ledger is stored in the account');
  // the same account on another PC gets its TP from the cloud
  const A2 = mkPc();
  await login(A2, 'ali.veli@gmail.com');
  ok(A2.cloud.tp.tp === 4 && A2.profile.get().avatar === 'crown' && A2.profile.get().name === 'aliveli', 'another PC: TP, avatar and name follow the account');
  // TP won on PC 1 while PC 2 has not pulled since (lazy pulls): PC 2's next claim builds on it, nothing is lost
  { const mta = await A1.cloud.tpStart('sp'); clockMs += 6 * 60 * 1000;
    ok((await A1.cloud.tpClaim(mta, 'won')).gained === 3, 'PC 1 wins: +3'); await A1.cloud.flush();
    const mtb = await A2.cloud.tpStart('sp'); clockMs += 6 * 60 * 1000;
    const cb = await A2.cloud.tpClaim(mtb, 'lost');
    ok(cb.gained === 1 && A2.cloud.tp.tp === 8, 'PC 2 claims on the ledger PC 1 raised (4 + 3 + 1 = ' + A2.cloud.tp.tp + ')');
    await A2.cloud.flush();
    ok(ledgerInfo(fz.data('users/' + A2.cloud.user.uid + '/meta/tp').s).tp === 8, 'and the cloud ledger holds both'); }
  // editing the local state does not give TP: the relay ticket reads the stored ledger through the server
  const st = A2.cloud._st(); const parts = st.tp.split('.');
  const forged = Buffer.from(JSON.stringify(Object.assign(JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()), { tp: 999 }))).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_') + '.' + parts[1];
  st.tp = forged; A2.cloud._tkt = null;
  const tk = await A2.cloud.relayTicket(true);
  ok(tk.ident.tp === 0, 'a hand-edited ledger is worth 0 TP on the server (' + tk.ident.tp + ')');
  ok(!(await A2.cloud.tpClaim(await A2.cloud.tpStart('sp'), 'won')).ok, 'and cannot be built on');
  // friends: registered players, search by name, my list (owner only)
  await B1.cloud.flush();
  const pl = await A2.cloud.players();
  ok(pl.some((c) => c.fb === B1.cloud.user.uid && c.name === 'aliveli2') && !pl.some((c) => c.fb === A2.cloud.user.uid), 'players: other registered players listed, not me');
  const f1 = await A2.cloud.findPlayer('ALİVELİ2');
  ok(f1 && f1.fb === B1.cloud.user.uid, 'find a player by user name (case-insensitive)');
  ok((await A2.cloud.findPlayer('nobody-here')) === null, 'unknown name -> null');
  ok((await A2.cloud.addFriend(f1)).ok, 'add friend');
  ok(!(await A2.cloud.addFriend({ fb: A2.cloud.user.uid, name: 'me' })).ok, 'cannot add yourself');
  let fl = await A2.cloud.friends();
  { const r0 = fz.stats.reads; await A2.cloud.friends(); await A2.cloud.players();
    ok(fz.stats.reads === r0, 'friends and the players list are not read again on the next open: ' + (fz.stats.reads - r0) + ' reads'); }
  ok(fl.length === 1 && fl[0].fb === B1.cloud.user.uid && fl[0].name === 'aliveli2', 'friends list read back');
  ok(fz.paths('users/' + A1.cloud.user.uid + '/friends/').length === 1, 'the list lives under my account (owner-only rules)');
  ok((await A2.cloud.removeFriend(f1.fb)).ok && (await A2.cloud.friends()).length === 0, 'remove friend');
  await A2.cloud.addFriend(f1);
  // sign out: no profile is left on the PC
  A2.cloud.logout();
  ok(!A2.cloud.loggedIn && A2.profile.get() === null, 'sign out leaves no local profile (sign-in required)');
  // delete
  const fbA = A1.cloud.user.uid;
  sdkOf(fz).next = { email: 'ali.veli@gmail.com' };
  const forgot = [];
  const d = await A1.cloud.deleteAccount({ local: async (uid) => forgot.push(uid) });
  ok(d.ok && fz.paths('users/' + fbA).length === 0 && !fz.data('profiles/' + fbA) && !fz.data('names/aliveli') && !fz.userByEmail('ali.veli@gmail.com'), 'delete account: every document, the name and the Firebase account are gone');
  ok(forgot.length === 1 && A1.profile.get() === null && !A1.cloud.loggedIn, 'delete account: local data cleanup ran, signed out');
  sdkOf(fz).next = { email: 'ali.veli@yahoo.com' };
  const wrong = await B1.cloud.deleteAccount({});
  ok(wrong.ok, 'second account deleted too');
  sdkOf(fz).next = { email: 'someone.else@gmail.com' };
  const B3 = mkPc(); await login(B3, 'third.one@gmail.com');
  sdkOf(fz).next = { email: 'someone.else@gmail.com' };
  ok(!(await B3.cloud.deleteAccount({})).ok && B3.cloud.loggedIn, 'delete refuses a different Google account in the confirmation');
  sdkOf(fz).next = { email: 'third.one@gmail.com' };
  await B3.cloud.deleteAccount({});
  ok(fz.users.size === 0 || [...fz.users.keys()].every((e) => e === 'someone.else@gmail.com'), 'test accounts deleted (mandatory accounts block)');
}

// ---------------------------------------------------------------- cleanup accounts (fake)
for (const em of ['a@example.com', 'b@example.com']) await (await session(ff, em)).deleteAccount();
ok(ff.users.size === 0 || [...ff.users.keys()].every((e) => !['a@example.com', 'b@example.com'].includes(e)), 'test accounts deleted');

console.log(failed ? `\n${failed} FAILED` : '\nALL OK');
process.exit(failed ? 1 : 0);
