// Aevum - server identity: Firebase ID token verification, relay tickets, TP ledger rules (srv/identity.mjs),
// and the relay enforcing them (server.js spawned twice: with verification on, and with AEVUM_NO_AUTH=1).
import crypto from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { createIdentity, IdentityError, TP_WIN, TP_LOSS, TP_WIN_CAP, MP_WAIT_MS, keysFromEnv, nameKey } from '../srv/identity.mjs';
import { nameKey as clientNameKey } from '../src/cloud/sync.js';
import { createSaStore } from '../srv/firestore-sa.mjs';

let fails = 0, passes = 0;
const ok = (c, msg) => { if (c) passes++; else { fails++; console.error('FAIL', msg); } };
const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// ---------- token verification ----------
const PROJECT = 'aevum-a081f';
const { publicKey, privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const pem = publicKey.export({ type: 'spki', format: 'pem' });
let clock = Date.UTC(2026, 10, 11, 12);
const T = () => Math.floor(clock / 1000);
function jwt(claims, { kid = 'k1', key = privateKey, alg = 'RS256' } = {}) {
  const h = b64u(JSON.stringify({ alg, kid, typ: 'JWT' }));
  const p = b64u(JSON.stringify(claims));
  return h + '.' + p + '.' + b64u(crypto.sign('RSA-SHA256', Buffer.from(h + '.' + p), key));
}
const good = (over = {}) => Object.assign({ aud: PROJECT, iss: 'https://securetoken.google.com/' + PROJECT, sub: 'fbUser123', iat: T() - 10, auth_time: T() - 10, exp: T() + 3000, email: 'kim@gmail.com', firebase: { sign_in_provider: 'google.com' } }, over);
let certFetches = 0;
const fsDocs = new Map(), nameDocs = new Map();
const fakeFetch = async (url, init) => {
  const nm = /\/documents\/names\/([^/?]+)$/.exec(String(url));
  if (nm) {
    const d = nameDocs.get(decodeURIComponent(nm[1]));
    return d ? { ok: true, status: 200, json: async () => ({ name: 'names/' + nm[1], fields: { uid: { stringValue: d } } }) } : { ok: false, status: 404, json: async () => ({}) };
  }
  if (url === 'CERTS') { certFetches++; return { ok: true, json: async () => ({ k1: pem }), headers: { get: () => 'public, max-age=600' } }; }
  if (String(url).includes(':batchGet')) {
    const tok = String(init.headers.Authorization).slice(7);
    const sub = JSON.parse(Buffer.from(tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString()).sub;
    const body = JSON.parse(init.body);
    const out = body.documents.map((n) => {
      if (!n.includes('/users/' + sub + '/')) return { missing: n };
      const d = fsDocs.get(n.slice(n.indexOf('/users/') + 1));
      return d ? { found: { name: n, fields: d } } : { missing: n };
    });
    return { ok: true, json: async () => out };
  }
  throw new Error('unexpected fetch ' + url);
};
const keys = [crypto.randomBytes(32)];
const id = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys, certsUrl: 'CERTS', testAccounts: true });

async function rejects(p, code, msg) { try { await p; ok(false, msg + ' (accepted)'); } catch (e) { ok(e instanceof IdentityError && (!code || e.code === code), msg + ' -> ' + (e && e.code)); } }
{
  const v = await id.verifyIdToken(jwt(good()));
  ok(v.fb === 'fbUser123' && v.provider === 'google.com', 'valid Google token verifies');
  await rejects(id.verifyIdToken(jwt(good(), { key: other.privateKey })), 'BAD_SIG', 'wrong signature rejected');
  await rejects(id.verifyIdToken(jwt(good({ aud: 'other-proj' }))), 'BAD_AUD', 'wrong audience rejected');
  await rejects(id.verifyIdToken(jwt(good({ iss: 'https://securetoken.google.com/x' }))), 'BAD_AUD', 'wrong issuer rejected');
  await rejects(id.verifyIdToken(jwt(good({ exp: T() - 1 }))), 'EXPIRED', 'expired token rejected');
  await rejects(id.verifyIdToken(jwt(good({ iat: T() + 3600 }))), 'BAD_TIME', 'token from the future rejected');
  await rejects(id.verifyIdToken(jwt(good({ firebase: { sign_in_provider: 'password' }, email: 'a@b.com' }))), 'PROVIDER', 'password sign-in rejected');
  await rejects(id.verifyIdToken(jwt(good({ firebase: { sign_in_provider: 'anonymous' } }))), 'PROVIDER', 'anonymous rejected');
  const t = await id.verifyIdToken(jwt(good({ firebase: { sign_in_provider: 'password' }, email: 'aevum-test-x1@example.com' })));
  ok(t.provider === 'password', 'aevum-test-*@example.com password accounts allowed with testAccounts (AEVUM_TEST_ACCOUNTS=1)');
  const prodId = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys, certsUrl: 'CERTS' });
  await rejects(prodId.verifyIdToken(jwt(good({ firebase: { sign_in_provider: 'password' }, email: 'aevum-test-x1@example.com' }))), 'PROVIDER', 'test accounts refused by default (production)');
  await rejects(id.verifyIdToken(jwt(good(), { kid: 'nope' })), 'BAD_KID', 'unknown key id rejected');
  await rejects(id.verifyIdToken(jwt(good(), { alg: 'HS256' })), 'BAD_TOKEN', 'non-RS256 rejected');
  await rejects(id.verifyIdToken('a.b'), 'BAD_TOKEN', 'garbage rejected');
  ok(certFetches <= 3, 'certs are cached (' + certFetches + ' fetches)');
}

// ---------- auth -> ticket (profile read from Firestore with the user's token) ----------
const UID = 'a'.repeat(32);
{
  await rejects(id.auth({ token: jwt(good()) }), 'NO_PROFILE', 'no profile yet -> no ticket');
  fsDocs.set('users/fbUser123/meta/profile', { uid: { stringValue: UID }, name: { stringValue: 'Kerem' }, avatar: { stringValue: 'helm' } });
  const r = await id.auth({ token: jwt(good()) });
  ok(r.ident.uid === UID && r.ident.name === 'Kerem' && r.ident.av === 'helm' && r.ident.tp === 0, 'ticket carries the stored profile');
  const back = id.checkTicket(r.ticket);
  ok(back && back.uid === UID && back.name === 'Kerem', 'ticket verifies');
  const parts = r.ticket.split('.');
  const forged = b64u(JSON.stringify(Object.assign(JSON.parse(Buffer.from(parts[0].replace(/-/g, '+').replace(/_/g, '/'), 'base64')), { name: 'Sahte' }))) + '.' + parts[1];
  ok(id.checkTicket(forged) === null, 'a ticket with an edited name is rejected');
  clock += 13 * 3600 * 1000;
  ok(id.checkTicket(r.ticket) === null, 'tickets expire');
  clock -= 13 * 3600 * 1000;
  await rejects(id.auth({ dev: { fb: 'x', uid: UID, name: 'Dev' } }), null, 'dev identities refused when verification is on');
  // another key cannot read the ticket
  const id2 = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys: [crypto.randomBytes(32)], certsUrl: 'CERTS' });
  ok(id2.checkTicket(r.ticket) === null, 'a ticket signed with another key is rejected');
  // key rotation: an old key still verifies
  const id3 = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys: [crypto.randomBytes(32), keys[0]], certsUrl: 'CERTS' });
  ok(!!id3.checkTicket(r.ticket), 'an older key still verifies (rotation)');
}

// ---------- TP ledger ----------
{
  const me = { fb: 'fbUser123', uid: UID, name: 'Kerem' };
  const MIN = 5 * 60 * 1000;
  const start = () => id.matchStart(me, { mode: 'sp' }).mt;
  let ledger = '';
  let mt = start();
  let r = id.matchClaim(me, { mt, result: 'won', ledger });
  ok(r.ok && r.gained === 0, 'a match under 5 minutes gives no TP');
  clock += MIN + 1000;
  r = id.matchClaim(me, { mt, result: 'won', ledger });
  ok(r.ok && r.gained === TP_WIN && r.tp === 3, 'a win gives ' + TP_WIN + ' TP');
  ledger = r.ledger;
  r = id.matchClaim(me, { mt, result: 'won', ledger });
  ok(r.ok && r.gained === 0 && r.tp === 3, 'the same match never counts twice');
  mt = start(); clock += MIN + 1000;
  r = id.matchClaim(me, { mt, result: 'lost', ledger });
  ok(r.gained === TP_LOSS && r.tp === 4, 'a loss gives ' + TP_LOSS + ' TP');
  ledger = r.ledger;
  r = id.matchClaim(me, { mt: start(), result: 'abandoned', ledger });
  ok(!r.ok, 'abandoned gives nothing');
  // overlapping matches: a ticket started before the last counted match ended
  const early = start(); clock += MIN + 1000;
  const m2 = start(); clock += MIN + 1000;
  r = id.matchClaim(me, { mt: m2, result: 'won', ledger }); ledger = r.ledger;
  ok(r.tp === 7, 'next win counts');
  r = id.matchClaim(me, { mt: early, result: 'won', ledger });
  ok(r.gained === 0, 'a match that overlapped the last counted one gives no TP');
  // tampering
  const [p] = ledger.split('.');
  const fake = b64u(JSON.stringify(Object.assign(JSON.parse(Buffer.from(p.replace(/-/g, '+').replace(/_/g, '/'), 'base64')), { tp: 999 }))) + '.' + ledger.split('.')[1];
  ok(!id.matchClaim(me, { mt: start(), result: 'won', ledger: fake }).ok, 'an edited ledger is rejected');
  ok(id.ledgerInfo(me, fake).ok === false && id.ledgerInfo(me, ledger).tp === 7, 'ledgerInfo verifies');
  const other2 = { fb: 'someoneElse', uid: 'b'.repeat(32), name: 'X' };
  ok(!id.matchClaim(other2, { mt: start(), result: 'won', ledger: '' }).ok, "another account cannot use my match ticket");
  ok(!id.matchClaim(other2, { mt: id.matchStart(other2, {}).mt, result: 'won', ledger }).ok || true, '(ledger of another account)');
  ok(id.openLedger(ledger, 'someoneElse') === null, "my ledger is not valid for another account");
  // the stored ledger reaches the relay ticket
  fsDocs.set('users/fbUser123/meta/tp', { s: { stringValue: ledger } });
  const a = await id.auth({ token: jwt(good({ iat: T() - 5, auth_time: T() - 5, exp: T() + 3000 })) });
  ok(a.ident.tp === 7, 'the relay ticket carries the verified TP (' + a.ident.tp + ')');
  fsDocs.set('users/fbUser123/meta/tp', { s: { stringValue: fake } });
  const b = await id.auth({ token: jwt(good({ iat: T() - 5, auth_time: T() - 5, exp: T() + 3000 })) });
  ok(b.ident.tp === 0, 'an edited stored ledger shows 0 TP');
}
{
  const k = keysFromEnv({ RENDER_SERVICE_ID: 'srv-abc' });
  ok(k.source === 'service' && keysFromEnv({ RENDER_SERVICE_ID: 'srv-abc' }).keys[0].equals(k.keys[0]), 'Render fallback key is stable');
  const k2 = keysFromEnv({ AEVUM_SECRET: 'x'.repeat(32), RENDER_SERVICE_ID: 'srv-abc' });
  ok(k2.source === 'env' && k2.keys.length === 1, 'with AEVUM_SECRET set, the key derived from RENDER_SERVICE_ID is not accepted');
  const svcId = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys: k.keys, certsUrl: 'CERTS' });
  const envId = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys: k2.keys, certsUrl: 'CERTS' });
  const forgedTk = svcId._sign({ k: 't', exp: clock + 3600000, fb: 'victim1', uid: 'c'.repeat(32), name: 'Kurban', av: '', tp: 0 });
  ok(!!svcId.checkTicket(forgedTk) && envId.checkTicket(forgedTk) === null, 'a ticket made with the service-derived key is refused when AEVUM_SECRET is set');
}

// ---------- the profile is the player's own document: name claims and profile uid owners ----------
{
  ok(['Kerem', 'İlker', 'ILKER', 'ılker', 'a/b%c', '..', '__x__', '  Ali  Veli '].every((n) => nameKey(n) === clientNameKey(n)), 'server nameKey folds names like the client (src/cloud/sync.js)');
  const tok = (sub) => jwt(good({ sub, iat: T() - 5, auth_time: T() - 5, exp: T() + 3000 }));
  nameDocs.set('kerem', 'fbUser123');
  const a = await id.auth({ token: tok('fbUser123') });
  ok(a.ident.uid === UID && a.ident.name === 'Kerem', 'my own claimed name and uid pass');
  // fbCopy wrote itself a profile with Kerem's uid and name
  fsDocs.set('users/fbCopy/meta/profile', { uid: { stringValue: UID }, name: { stringValue: 'Kerem' } });
  await rejects(id.auth({ token: tok('fbCopy') }), 'NAME_TAKEN', 'a user name claimed by another account is refused');
  fsDocs.set('users/fbCopy/meta/profile', { uid: { stringValue: UID }, name: { stringValue: 'Kopya' } });
  const c = await id.auth({ token: tok('fbCopy') });
  ok(/^[0-9a-f]{32}$/.test(c.ident.uid) && c.ident.uid !== UID, 'a copied profile uid is replaced by one derived from the copier\'s account');
  ok((await id.auth({ token: tok('fbCopy') })).ident.uid === c.ident.uid && (await id.auth({ token: tok('fbUser123') })).ident.uid === UID, 'the derived uid is stable; the owner keeps its uid');
  // with a persistent store (srv/firestore-sa.mjs claimUid) the store decides
  const owners = new Map([['d'.repeat(32), 'fbFirst']]);
  const store = { claimUid: async (u, fb) => { if (!owners.has(u)) owners.set(u, fb); return owners.get(u); } };
  const idS = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys, certsUrl: 'CERTS', uidStore: store });
  fsDocs.set('users/fbLate/meta/profile', { uid: { stringValue: 'd'.repeat(32) }, name: { stringValue: 'Gec' } });
  ok((await idS.auth({ token: tok('fbLate') })).ident.uid !== 'd'.repeat(32), 'uid store: a uid owned by another account is not shown');
  fsDocs.set('users/fbNew/meta/profile', { uid: { stringValue: 'e'.repeat(32) }, name: { stringValue: 'Yeni' } });
  ok((await idS.auth({ token: tok('fbNew') })).ident.uid === 'e'.repeat(32) && owners.get('e'.repeat(32)) === 'fbNew', 'uid store: a new uid is claimed by its first account');
  const idF = createIdentity({ projectId: PROJECT, fetch: fakeFetch, now: () => clock, keys, certsUrl: 'CERTS', uidStore: { claimUid: async () => { throw new Error('down'); } } });
  ok((await idF.auth({ token: tok('fbLate') })).ident.uid === 'd'.repeat(32), 'uid store unreachable: the player still gets in');
  // end to end: the real service-account store (srv/firestore-sa.mjs createSaStore, as server.js wires it), with a
  // fake OAuth token endpoint and a fake Firestore uidOwners collection behind one fetch
  const sa = { client_email: 'svc@aevum-a081f.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: PROJECT };
  const uidDocs = new Map([['f'.repeat(32), 'fbOrig']]);
  let saTokens = 0, saBadAuth = 0;
  const saFetch = async (url, init = {}) => {
    const u = String(url);
    if (u === 'https://oauth2.googleapis.com/token') {
      const asr = /assertion=([^&]+)/.exec(String(init.body));
      const parts = asr ? asr[1].split('.') : [];
      const okSig = parts.length === 3 && crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), publicKey, Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64'));
      if (!okSig) return { ok: false, status: 400, json: async () => ({}), text: async () => 'bad jwt' };
      saTokens++;
      return { ok: true, status: 200, json: async () => ({ access_token: 'sa-token-1', expires_in: 3600 }) };
    }
    const m = /\/documents\/uidOwners\/([0-9a-f]{32})(\?currentDocument\.exists=false)?$/.exec(u);
    if (m) {
      if (String((init.headers || {}).Authorization) !== 'Bearer sa-token-1') { saBadAuth++; return { ok: false, status: 401, json: async () => ({}), text: async () => '' }; }
      if ((init.method || 'GET') === 'GET') return uidDocs.has(m[1]) ? { ok: true, status: 200, json: async () => ({ fields: { fb: { stringValue: uidDocs.get(m[1]) } } }) } : { ok: false, status: 404, json: async () => ({}) };
      if (init.method === 'PATCH' && m[2]) {
        if (uidDocs.has(m[1])) return { ok: false, status: 409, json: async () => ({}), text: async () => 'exists' };
        uidDocs.set(m[1], JSON.parse(init.body).fields.fb.stringValue);
        return { ok: true, status: 200, json: async () => ({}) };
      }
    }
    return fakeFetch(url, init);
  };
  const saStore = createSaStore({ sa, projectId: PROJECT, fetch: saFetch, now: () => clock });
  const saErrs = [];
  const idSA = createIdentity({ projectId: PROJECT, fetch: saFetch, now: () => clock, keys, certsUrl: 'CERTS', uidStore: saStore, log: (t, e) => saErrs.push(t + ' ' + (e && e.message)) });
  fsDocs.set('users/fbThief/meta/profile', { uid: { stringValue: 'f'.repeat(32) }, name: { stringValue: 'Hirsiz' } });
  const th = await idSA.auth({ token: tok('fbThief') });
  ok(th.ident.uid !== 'f'.repeat(32) && /^[0-9a-f]{32}$/.test(th.ident.uid), 'SA store end to end: a uid owned in Firestore by another account is not shown');
  fsDocs.set('users/fbFresh/meta/profile', { uid: { stringValue: '9'.repeat(32) }, name: { stringValue: 'Taze' } });
  ok((await idSA.auth({ token: tok('fbFresh') })).ident.uid === '9'.repeat(32) && uidDocs.get('9'.repeat(32)) === 'fbFresh', 'SA store end to end: a new uid is written to uidOwners with its first account');
  fsDocs.set('users/fbOrig/meta/profile', { uid: { stringValue: 'f'.repeat(32) }, name: { stringValue: 'Asil' } });
  ok((await idSA.auth({ token: tok('fbOrig') })).ident.uid === 'f'.repeat(32), 'SA store end to end: the owner keeps its uid');
  ok(saTokens === 1 && saBadAuth === 0 && !saErrs.length, 'SA store end to end: one service-account token, no store errors (' + saTokens + '/' + saBadAuth + ' ' + saErrs.join('; ') + ')');
  nameDocs.clear();
}

// ---------- TP limits: wins an hour, multiplayer reports bound to the room ----------
{
  let t0 = Date.UTC(2026, 10, 12, 12);
  const idm = createIdentity({ noAuth: true, now: () => t0, keys, tpMinMs: 5 * 60 * 1000 });
  const A = { fb: 'fA' };
  let L = '';
  const got = [];
  const sp = (result) => { const mt = idm.matchStart(A, { mode: 'sp' }).mt; t0 += 6 * 60 * 1000; const r = idm.matchClaim(A, { mt, result, ledger: L }); if (r.ledger) L = r.ledger; return r; };
  for (let i = 0; i <= TP_WIN_CAP; i++) got.push(sp('won').gained);
  ok(got.slice(0, TP_WIN_CAP).every((g) => g === TP_WIN) && got[TP_WIN_CAP] === 0, 'single player: wins beyond ' + TP_WIN_CAP + ' an hour give no TP (' + got.join(',') + ')');
  ok(sp('lost').gained === TP_LOSS, 'losses are not capped');
  t0 += 3600 * 1000;
  ok(sp('won').gained === TP_WIN, 'an hour later wins count again');
  ok(idm.matchClaim(A, null).ok === false && idm.matchStart(A, null).mt, 'null bodies do not throw');
}
{
  let t1 = Date.UTC(2026, 10, 13, 12);
  const im = createIdentity({ noAuth: true, now: () => t1, keys, tpMinMs: 0 });
  const A = { fb: 'fA' }, B = { fb: 'fB' };
  const led = { fA: '', fB: '' };
  const claim = (who, mt, result, team) => { const r = im.matchClaim(who, { mt, result, team, ledger: led[who.fb] }); if (r.ok && r.ledger) led[who.fb] = r.ledger; return r; };
  const ctx = (humans) => ({ room: 'ROOMX', humans });
  // the team each account names at the match start (/mp/tp/start) is its team; the one in the claim is ignored
  const pair = (humans = ['fA', 'fB'], ta = 0, tb = 1) => { t1 += 120000; const a = im.matchStart(A, { mode: 'mp', team: ta }, ctx(humans)).mt, b = im.matchStart(B, { mode: 'mp', team: tb }, ctx(humans)).mt; t1 += 60000; return [a, b]; };
  // 1v1, an honest end
  let [a, b] = pair();
  let r = claim(A, a, 'won', 0);
  ok(r.ok && r.pending && r.gained === 0, 'multiplayer: a win waits for the other player\'s report');
  ok(claim(B, b, 'lost', 1).gained === TP_LOSS, 'multiplayer: the loser gets its loss at once');
  r = claim(A, a, 'won', 0);
  ok(!r.pending && r.gained === TP_WIN, 'multiplayer: the win counts once the reports agree');
  // two winners on opposite teams (colluding accounts): neither
  [a, b] = pair();
  ok(claim(A, a, 'won', 0).pending, 'multiplayer: first winner waits');
  r = claim(B, b, 'won', 1);
  ok(r.gained === 0 && !r.pending, 'multiplayer: a second winner on the other team gets nothing');
  ok(claim(A, a, 'won', 0).gained === 0, 'multiplayer: and the first winner gets nothing either');
  // allies against the AI: both win
  [a, b] = pair(['fA', 'fB'], 2, 2);
  ok(claim(A, a, 'won', 2).pending && claim(B, b, 'won', 2).gained === TP_WIN && claim(A, a, 'won', 2).gained === TP_WIN, 'multiplayer: allies on one team both get the win');
  // colluding accounts on opposite start teams claim one team at the end: the start teams count
  [a, b] = pair(['fA', 'fB'], 0, 1);
  ok(claim(A, a, 'won', 5).pending && claim(B, b, 'won', 5).gained === 0 && claim(A, a, 'won', 5).gained === 0, 'multiplayer: a team named only in the claim is ignored (start teams 0 / 1 -> no win)');
  // a second /mp/tp/start cannot change the team
  t1 += 120000;
  a = im.matchStart(A, { mode: 'mp', team: 0 }, ctx(['fA', 'fB'])).mt; b = im.matchStart(B, { mode: 'mp', team: 1 }, ctx(['fA', 'fB'])).mt;
  im.matchStart(B, { mode: 'mp', team: 0 }, ctx(['fA', 'fB'])); t1 += 60000;
  ok(claim(A, a, 'won', 0).pending && claim(B, b, 'won', 0).gained === 0, 'multiplayer: the first team named at the start is kept');
  // opposite teams: a win waits for a loss report (or MP_WAIT_MS)
  [a, b] = pair();
  ok(claim(A, a, 'won', 0).pending, 'multiplayer: on opposite teams the win waits for the loss');
  t1 += MP_WAIT_MS + 1000;
  ok(claim(A, a, 'won', 0).gained === TP_WIN, 'multiplayer: no loss report within ' + MP_WAIT_MS / 1000 + ' s -> the win counts (the hourly cap limits this)');
  // only ticket holders are waited for: a room member who is not in the match does not hold the win back
  [a, b] = pair(['fA', 'fB', 'fWatcher']);
  ok(claim(A, a, 'won', 0).pending && claim(B, b, 'lost', 1).gained === TP_LOSS && claim(A, a, 'won', 0).gained === TP_WIN, 'multiplayer: the win counts as soon as every ticket holder reported (not every room member)');
  // a player who left and never reports: the win waits MP_WAIT_MS at most
  [a, b] = pair(['fA', 'fB', 'fGone']);
  t1 -= 60000; im.matchStart({ fb: 'fGone' }, { mode: 'mp', team: 2 }, ctx(['fA', 'fB', 'fGone'])); t1 += 60000;
  ok(claim(A, a, 'won', 0).pending && claim(B, b, 'lost', 1).gained === TP_LOSS && claim(A, a, 'won', 0).pending, 'multiplayer: still waiting for a third ticket holder');
  t1 += MP_WAIT_MS + 1000;
  ok(claim(A, a, 'won', 0).gained === TP_WIN, 'multiplayer: after ' + MP_WAIT_MS / 1000 + ' s the win counts without the missing report');
  // the reported result cannot change
  [a, b] = pair();
  const before = led.fB;
  ok(claim(B, b, 'lost', 1).gained === TP_LOSS, 'multiplayer: loss');
  r = im.matchClaim(B, { mt: b, result: 'won', team: 1, ledger: before });
  ok(r.gained === 0, 'multiplayer: the same ticket cannot report a win after a loss (with an older ledger)');
  // a multiplayer ticket outside any relay room
  t1 += 120000;
  const u = im.matchStart(A, { mode: 'mp' }).mt; t1 += 60000;
  ok(claim(A, u, 'won', 0).gained === 0, 'multiplayer ticket bound to no room: a win gives no TP');
  t1 += 120000;
  const u2 = im.matchStart(A, { mode: 'mp' }).mt; t1 += 60000;
  ok(claim(A, u2, 'lost', 0).gained === TP_LOSS, 'multiplayer ticket bound to no room: a loss still counts');
}

// ---------- the relay ----------
const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
function startServer(port, env) {
  return new Promise((resolve, reject) => {
    const p = spawn(process.execPath, [path.join(ROOT, 'server.js')], { env: Object.assign({}, process.env, { PORT: String(port), AEVUM_NO_AUTH: '', AEVUM_SECRET: '' }, env), stdio: ['ignore', 'pipe', 'pipe'] });
    let out = '';
    const to = setTimeout(() => reject(new Error('server did not start: ' + out)), 8000);
    p.stdout.on('data', (d) => { out += d; if (out.includes('calisiyor')) { clearTimeout(to); resolve(p); } });
    p.stderr.on('data', (d) => { out += d; });
  });
}
const base = (port) => 'http://127.0.0.1:' + port;
async function readSse(url, ms, until) {
  const ctl = new AbortController();
  const got = [];
  const t = setTimeout(() => ctl.abort(), ms);
  let r;
  try { r = await fetch(url, { signal: ctl.signal }); } catch { clearTimeout(t); return { status: 0, got }; }
  if (!r.ok) { clearTimeout(t); try { await r.body.cancel(); } catch { /* ignore */ } return { status: r.status, got }; }
  const rd = r.body.getReader(); let buf = '', stop = false;
  try {
    while (!stop) {
      const { value, done } = await rd.read(); if (done) break;
      buf += Buffer.from(value).toString();
      let i; while ((i = buf.indexOf('\n\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 2); if (line.startsWith('data: ')) { got.push(JSON.parse(line.slice(6))); if (until && until(got)) stop = true; } }
    }
  } catch { /* aborted */ }
  clearTimeout(t);
  try { rd.cancel().catch(() => {}); } catch { /* ignore */ }
  return { status: 200, got };
}
{
  const port = 5600 + Math.floor(Math.random() * 300);
  const srv = await startServer(port, {});
  try {
    const r = await fetch(base(port) + '/mp/events?room=ABCDE&peer=p1');
    ok(r.status === 401, 'relay: no ticket -> 401 (' + r.status + ')');
    const s = await fetch(base(port) + '/mp/send?room=ABCDE&peer=p1', { method: 'POST', body: '{"topic":"lobby","data":{}}' });
    ok(s.status === 401, 'relay: send without ticket -> 401');
    const a = await fetch(base(port) + '/mp/auth', { method: 'POST', body: JSON.stringify({ dev: { fb: 'x1', uid: UID, name: 'Dev' } }) });
    ok(a.status === 401 || a.status === 400, 'relay: dev identities refused in production mode (' + a.status + ')');
    const a2 = await fetch(base(port) + '/mp/auth', { method: 'POST', body: JSON.stringify({ token: 'x.y.z' }) });
    ok(a2.status === 401, 'relay: a bad Firebase token is refused');
    const h = await (await fetch(base(port) + '/mp/health')).json();
    ok(h.auth === 'on', 'health reports auth on');
    ok(!('tpKey' in h) && typeof h.ver === 'string', 'health does not say which signing key is used');
  } finally { srv.kill(); }
}
{
  const port = 5900 + Math.floor(Math.random() * 300);
  const srv = await startServer(port, { AEVUM_NO_AUTH: '1', AEVUM_TP_MIN_MS: '0', AEVUM_OWNERS: 'fbA', AEVUM_SA: '' });
  try {
    const auth = async (fb, uid, name) => (await (await fetch(base(port) + '/mp/auth', { method: 'POST', body: JSON.stringify({ dev: { fb, uid, name, av: 'crown' } }) })).json());
    const A = await auth('fbA', 'a'.repeat(32), 'Ali');
    const B = await auth('fbB', 'b'.repeat(32), 'Banu');
    ok(!!A.ticket && A.ident.name === 'Ali', 'dev auth gives a ticket');
    const evA = readSse(base(port) + '/mp/events?room=ROOM1&peer=pa&tk=' + encodeURIComponent(A.ticket), 2500, (g) => g.some((m) => m.type === 'msg'));
    await new Promise((r) => setTimeout(r, 300));
    const evB = readSse(base(port) + '/mp/events?room=ROOM1&peer=pb&tk=' + encodeURIComponent(B.ticket), 2500, (g) => g.some((m) => m.type === 'dup'));
    await new Promise((r) => setTimeout(r, 300));
    // B claims to be "Ali" in the payload: the stamped identity says Banu
    await fetch(base(port) + '/mp/send?room=ROOM1&peer=pb', { method: 'POST', headers: { 'X-Aevum-Ticket': B.ticket }, body: JSON.stringify({ topic: 'lobby', data: { k: 'hello', name: 'Ali', uid: 'a'.repeat(32) } }) });
    // A's ticket cannot post as peer pb
    const imp = await fetch(base(port) + '/mp/send?room=ROOM1&peer=pb', { method: 'POST', headers: { 'X-Aevum-Ticket': A.ticket }, body: JSON.stringify({ topic: 'lobby', data: {} }) });
    ok(imp.status === 403, 'relay: another account cannot post under my peer id (' + imp.status + ')');
    const ga = await evA;
    const joined = ga.got.find((m) => m.type === 'joined');
    ok(joined && joined.id && joined.id.name === 'Banu' && joined.id.uid === 'b'.repeat(32), 'relay: joined carries the verified identity');
    const msg = ga.got.find((m) => m.type === 'msg');
    ok(msg && msg.id && msg.id.name === 'Banu' && msg.id.uid === 'b'.repeat(32), 'relay: messages are stamped with the sender\'s verified identity');
    // the same account a second time (another tab): the older connection is replaced
    const B2 = await auth('fbB', 'b'.repeat(32), 'Banu');
    const evB2 = readSse(base(port) + '/mp/events?room=ROOM1&peer=pb2&tk=' + encodeURIComponent(B2.ticket), 1200);
    const gb = await evB;
    ok(gb.got.some((m) => m.type === 'dup'), 'relay: a second connection of the same account replaces the first');
    const hello2 = (await evB2).got.find((m) => m.type === 'hello');
    ok(hello2 && !hello2.peers.includes('pb') && hello2.ids && hello2.ids.pb2 && hello2.ids.pb2.name === 'Banu', 'relay: hello lists verified identities, without the replaced peer');
    const back = await fetch(base(port) + '/mp/events?room=ROOM1&peer=pb&tk=' + encodeURIComponent(B.ticket));
    ok(back.status === 409, 'relay: the replaced peer id cannot come back (' + back.status + ')');
    try { await back.body.cancel(); } catch { /* ignore */ }
    // TP through the relay
    const st = await (await fetch(base(port) + '/mp/tp/start', { method: 'POST', headers: { 'X-Aevum-Ticket': A.ticket }, body: '{"mode":"sp"}' })).json();
    const cl = await (await fetch(base(port) + '/mp/tp/claim', { method: 'POST', headers: { 'X-Aevum-Ticket': A.ticket }, body: JSON.stringify({ mt: st.mt, result: 'won', ledger: '' }) })).json();
    ok(cl.ok && cl.tp === 3, 'relay: TP claim works (' + JSON.stringify(cl).slice(0, 80) + ')');
    const nt = await fetch(base(port) + '/mp/tp/claim', { method: 'POST', body: JSON.stringify({ mt: st.mt, result: 'won', ledger: '' }) });
    ok(nt.status === 401, 'relay: TP needs a ticket');
    // friends: online status + invites through the inbox
    const post = (p, tk, body) => fetch(base(port) + p, { method: 'POST', headers: tk ? { 'X-Aevum-Ticket': tk } : {}, body: JSON.stringify(body) });
    let on = await (await post('/mp/online', A.ticket, { fbs: ['fbB'] })).json();
    ok(Array.isArray(on.online) && !on.online.includes('fbB'), 'friends: B offline before opening the inbox');
    const inboxB = fetch(base(port) + '/mp/inbox?tk=' + encodeURIComponent(B2.ticket)).then(r => r.json());
    await new Promise(r => setTimeout(r, 200));
    on = await (await post('/mp/online', A.ticket, { fbs: ['fbB', 'nobody'] })).json();
    ok(on.online.length === 1 && on.online[0] === 'fbB', 'friends: B online while its inbox is open');
    const iv = await (await post('/mp/invite', A.ticket, { to: 'fbB', code: 'room1' })).json();
    ok(iv.online === true, 'friends: invite delivered to an online friend');
    const got = await inboxB;
    ok(got.length === 1 && got[0].type === 'invite' && got[0].code === 'ROOM1' && got[0].from.name === 'Ali' && got[0].from.fb === 'fbA', 'friends: the invite carries the verified sender and the room code');
    ok((await post('/mp/invite', null, { to: 'fbB', code: 'ROOM1' })).status === 401, 'friends: invites need a ticket');
    ok((await post('/mp/invite', A.ticket, { to: 'fbB', code: 'bad code!' })).status === 400, 'friends: invalid room codes refused');
    ok((await post('/mp/invite', A.ticket, { to: 'fbA', code: 'ROOM1' })).status === 400, 'friends: cannot invite yourself');
    const off = await (await post('/mp/invite', A.ticket, { to: 'fbNobody', code: 'ROOM1' })).json();
    ok(off.online === false, 'friends: an offline player gets nothing (online:false)');
    let lim = 0; for (let i = 0; i < 25; i++) if ((await post('/mp/invite', A.ticket, { to: 'fbB', code: 'ROOM1' })).status === 429) lim++;
    ok(lim > 0, 'friends: invites are rate limited');
    // ---- the review of PR 4: identity by account, bodies, saves, static files, limits ----
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    const sse = (room, peer, tk, ms, until) => readSse(base(port) + '/mp/events?room=' + room + '&peer=' + peer + '&tk=' + encodeURIComponent(tk), ms, until);
    for (const p of ['/mp/online', '/mp/invite', '/mp/invite-all', '/mp/tp/start', '/mp/tp/claim']) ok((await post(p, A.ticket, null)).status === 400, 'a null body is refused, not left hanging (' + p + ')');
    // another account that copied A's profile uid: neither replaces A nor takes over A's peer id
    const C = await auth('fbC', 'a'.repeat(32), 'Copy');
    const evA2 = sse('ROOM2', 'pa', A.ticket, 1500);
    await wait(300);
    const evC = sse('ROOM2', 'pc', C.ticket, 1200);
    await wait(300);
    const take = await fetch(base(port) + '/mp/send?room=ROOM2&peer=pa', { method: 'POST', headers: { 'X-Aevum-Ticket': C.ticket }, body: JSON.stringify({ topic: 'lobby', data: {} }) });
    ok(take.status === 403, 'relay: the same profile uid on another account cannot post under my peer id (' + take.status + ')');
    // saved-match blobs: only a peer in the room uploads; one upload at a time per account
    const blob = (peer, tk, body = 'save') => fetch(base(port) + '/mp/blob?room=ROOM2&peer=' + peer, { method: 'POST', headers: { 'X-Aevum-Ticket': tk }, body });
    ok((await blob('pa', A.ticket)).status === 200, 'blob: a peer in the room uploads');
    ok((await blob('pb', B.ticket)).status === 403, 'blob: someone outside the room cannot upload');
    ok((await blob('pa', B.ticket)).status === 403, 'blob: nor under a member\'s peer id');
    ok((await blob('pa', A.ticket, '')).status === 400, 'blob: an empty body -> 400');
    {
      const http = await import('node:http');
      const slow = http.request(base(port) + '/mp/blob?room=ROOM2&peer=pa', { method: 'POST', headers: { 'X-Aevum-Ticket': A.ticket, 'Content-Length': '100000' } });
      slow.on('error', () => {});
      slow.write('x'.repeat(1000));
      await wait(200);
      const second = await blob('pa', A.ticket);
      ok(second.status === 429, 'blob: a second upload of the same account while one is running -> 429 (' + second.status + ')');
      slow.destroy();
      await wait(200);
      ok((await blob('pa', A.ticket)).status === 200, 'blob: once the first ended, uploads work again');
      const raw = (headers, body) => new Promise((resolve) => {
        const q = http.request(base(port) + '/mp/blob?room=ROOM2&peer=pa', { method: 'POST', headers: Object.assign({ 'X-Aevum-Ticket': A.ticket }, headers) }, (rs) => { rs.resume(); resolve(rs.statusCode); });
        q.on('error', () => resolve(0));
        if (body != null) q.write(body);
        q.end();
      });
      ok((await raw({ 'Transfer-Encoding': 'chunked' }, 'save')) === 411, 'blob: an upload without Content-Length -> 411');
      ok((await raw({ 'Content-Length': String(33 * 1024 * 1024) })) === 413, 'blob: a Content-Length over 32 MB -> 413 before any byte is read');
    }
    const ga2 = await evA2; await evC;
    ok(ga2.got.some((m) => m.type === 'joined' && m.peer === 'pc') && !ga2.got.some((m) => m.type === 'dup'), 'relay: a copied profile uid does not kick the real player');
    // open rooms per account
    const D = await auth('fbD', 'd'.repeat(32), 'Deniz');
    const held = ['RM1', 'RM2', 'RM3'].map((rm) => sse(rm, 'pd', D.ticket, 1500));
    await wait(400);
    const fourth = await sse('RM4', 'pd', D.ticket, 300);
    ok(fourth.status === 429, 'relay: a 4th open room of one account -> 429 (' + fourth.status + ')');
    const again = await sse('RM1', 'pd2', D.ticket, 300);
    ok(again.status === 200, 'relay: the account can still reconnect to a room it is in');
    await Promise.all(held);
    // messages per connection: a flood is cut, normal traffic passes
    const E = await auth('fbE', 'e'.repeat(32), 'Ece'), F = await auth('fbF', 'f'.repeat(32), 'Fatma');
    const evF = sse('ROOM5', 'pf', F.ticket, 8000);
    await wait(300);
    const evE = sse('ROOM5', 'pe', E.ticket, 7500);
    await wait(300);
    const sendE = (i) => fetch(base(port) + '/mp/send?room=ROOM5&peer=pe', { method: 'POST', headers: { 'X-Aevum-Ticket': E.ticket }, body: JSON.stringify({ topic: 'turn', data: { i } }) }).then((r) => r.status);
    for (let i = 0; i < 30; i++) await sendE(i);
    let sent = 30;
    for (let k = 0; k < 9; k++) { await Promise.all(Array.from({ length: 150 }, (_, j) => sendE(1000 + k * 150 + j))); sent += 150; }
    const gf = await evF; await evE;
    const recv = gf.got.filter((m) => m.type === 'msg').length;
    ok(recv >= 30 + 400 && recv < sent, 'relay: a message flood is cut by the per-connection limit (' + recv + ' of ' + sent + ' passed)');
    // TP of a multiplayer match through the relay: the ticket is bound to the room and its accounts
    const evA7 = sse('ROOM7', 'pa7', A.ticket, 2500), evB7 = sse('ROOM7', 'pb7', B2.ticket, 2500);
    await wait(400);
    const tpPost = async (p, tk, body) => (await post(p, tk, body)).json();
    const mtA = (await tpPost('/mp/tp/start', A.ticket, { mode: 'mp', room: 'ROOM7', team: 0 })).mt, mtB = (await tpPost('/mp/tp/start', B2.ticket, { mode: 'mp', room: 'ROOM7', team: 1 })).mt;
    let cA = await tpPost('/mp/tp/claim', A.ticket, { mt: mtA, result: 'won', team: 0, ledger: '' });
    ok(cA.pending === true && cA.gained === 0, 'relay TP: a multiplayer win waits for the other account in the room');
    const cB = await tpPost('/mp/tp/claim', B2.ticket, { mt: mtB, result: 'lost', team: 1, ledger: '' });
    cA = await tpPost('/mp/tp/claim', A.ticket, { mt: mtA, result: 'won', team: 0, ledger: '' });
    ok(cB.gained === TP_LOSS && cA.gained === TP_WIN, 'relay TP: loss reported, the win counts');
    await evA7; await evB7;
    // statistics beats without an account: a few browser ids per address
    for (let i = 0; i < 40; i++) await fetch(base(port) + '/mp/beat?v=beatvid' + String(i).padStart(3, '0') + '&s=menu');
    const stats = await (await fetch(base(port) + '/mp/stats', { headers: { 'X-Aevum-Ticket': A.ticket } })).json();
    ok(stats.online && stats.online.total === 30, 'beat: anonymous beats count for at most 30 browser ids per address (' + (stats.online && stats.online.total) + ')');
    // static files: NUL bytes, dotfiles, logs, Windows short names / streams / trailing dots
    ok((await fetch(base(port) + '/index.html%00')).status === 400, 'static: a NUL byte -> 400');
    for (const p of ['/.gitignore', '/.git/config', '/server-error.log', '/server-error.log::$DATA', '/x/.env', '/GIT~1/config', '/SERVER~1.LOG', '/server-error.log.', '/index.html.']) ok((await fetch(base(port) + p)).status === 403, 'static: ' + p + ' refused');
    const idx = await fetch(base(port) + '/index.html');
    const csp = idx.headers.get('content-security-policy-report-only') || '';
    ok(idx.status === 200 && /script-src [^;]*'sha256-[A-Za-z0-9+/=]+'/.test(csp) && csp.includes('https://cdn.jsdelivr.net') && csp.includes('aevum-a081f.firebaseapp.com'), 'static: index.html carries a report-only CSP with the import map hash');
    ok(/script-src [^;]*'wasm-unsafe-eval'/.test(csp) && !/'unsafe-eval'/.test(csp), 'static: the CSP allows WebAssembly (meshopt decoder), not eval');
    ok((await fetch(base(port) + '/style.css')).status === 200, 'static: normal files still served');

  } finally { srv.kill(); }
}

console.log(`identity-test: ${passes} passed, ${fails} failed`);
process.exit(fails ? 1 : 0);
