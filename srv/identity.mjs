// Aevum - server-side identity for the multiplayer relay and the TP (points) ledger.
// Pure node (crypto + an injected fetch), no npm deps; loaded by server.js and unit-tested by test/identity-test.mjs.
//
// 1. A Firebase ID token (RS256, Google's securetoken certs) is verified here: aud/iss = the project, exp/iat checked.
//    Only Google sign-ins are accepted (plus aevum-test-*@example.com password accounts, only with AEVUM_TEST_ACCOUNTS=1).
// 2. The server then reads the account's own profile (users/{fb}/meta/profile: the 32-hex profile uid, name, avatar)
//    and its signed TP ledger (users/{fb}/meta/tp) from Firestore WITH THE USER'S TOKEN (owner-only rules allow it).
//    The player writes that profile himself, so it is not trusted blindly: the name must be the account's own claim
//    (names/{key}.uid == fb), and a profile uid belongs to the first account that showed it (uidStore); another account
//    showing the same uid gets a uid derived from its own Firebase id instead.
// 3. It hands back a relay ticket: HMAC-signed {fb, uid, name, av, tp, exp}. The relay stamps that verified identity
//    on every message, so no client can play under another player's uid or name.
// 4. TP: the server issues a signed match ticket when a match starts and turns a finished match into points on the
//    signed ledger (win 3, loss 1). The client stores the ledger, but cannot change it: the signature would break.
//    The result itself comes from the client, and the server cannot see who really won. What it does guarantee: a
//    match counts only after TP_MIN_MS of real time, at most TP_WIN_CAP wins an hour and account (the main limit), and
//    in multiplayer the ticket is bound to the relay room; each account's team is the one it named when it asked for
//    its ticket (not the one in its claim), two accounts on different teams never both get a win for one match, and
//    with players on different teams a win waits for a loss report (or MP_WAIT_MS). Two colluding accounts can still
//    trade wins (one reports a loss or stays silent): that is what the hourly cap is for.
//
// Nothing here touches the simulation.
import crypto from 'node:crypto';

export const CERTS_URL = 'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';
export const TICKET_TTL = 12 * 3600 * 1000;
export const MATCH_TTL = 48 * 3600 * 1000;
export const TP_WIN = 3, TP_LOSS = 1;
export const TP_MIN_MS = 5 * 60 * 1000;      // a match shorter than this (wall clock since its ticket) gives no TP
export const LEDGER_MIDS = 300;              // match tickets remembered per ledger (no match counts twice)
export const TP_WIN_CAP = 6, TP_WIN_CAP_MS = 3600 * 1000;   // at most 6 wins credited per hour and account
export const MP_JOIN_MS = 3 * 60 * 1000;     // the tickets of one multiplayer match are asked for within this time
export const MP_WAIT_MS = 45 * 1000;         // a multiplayer win waits this long for the other players' reports
const MP_GROUPS_MAX = 20000;
const UID_RE = /^[0-9a-f]{32}$/;
const FB_RE = /^[A-Za-z0-9]{1,128}$/;
const AVATAR_RE = /^[a-z0-9-]{1,24}$/;
const TEST_EMAIL_RE = /^aevum-test-[a-z0-9._+-]*@example\.com$/i;

const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
const unb64u = (s) => Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64');
const cleanName = (s) => (typeof s === 'string' ? s.replace(/\s+/g, ' ').trim().slice(0, 20) : '');
const cleanAv = (s) => (typeof s === 'string' && AVATAR_RE.test(s) ? s : '');
// names/{key} of a user name: the same folding as src/cloud/sync.js nameKey (test/identity-test.mjs compares them)
export function nameKey(name) {
  const n = String(name).replace(/\s+/g, ' ').trim().normalize('NFC').replace(/[İIı]/g, 'i').toLowerCase().replace(/i̇/g, 'i').normalize('NFC');
  const k = n.replace(/[%/]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase());
  return k === '.' || k === '..' || /^__.*__$/.test(k) ? encodeURIComponent(k).replace(/\./g, '%2E').replace(/_/g, '%5F') : k;
}

export class IdentityError extends Error {
  constructor(code, message, status = 401) { super(message || code); this.code = code; this.status = status; }
}

// keys: [primary, ...older] (an older key still verifies, everything new is signed with the primary)
export function keysFromEnv(env = process.env) {
  const keys = [], src = [];
  if (env.AEVUM_SECRET && env.AEVUM_SECRET.length >= 16) { keys.push(Buffer.from(env.AEVUM_SECRET, 'utf8')); src.push('env'); }
  // Render: stable across deploys, but not a secret (the service id is no password), so it is used ONLY while
  // AEVUM_SECRET is not set; with AEVUM_SECRET set, nothing signed with it verifies any more
  else if (env.RENDER_SERVICE_ID) { keys.push(crypto.createHash('sha256').update('aevum-tp|' + env.RENDER_SERVICE_ID).digest()); src.push('service'); }
  if (!keys.length) { keys.push(crypto.randomBytes(32)); src.push('ephemeral'); }
  return { keys, source: src[0] };
}

function sign(keys, obj) {
  const p = b64u(JSON.stringify(obj));
  return p + '.' + b64u(crypto.createHmac('sha256', keys[0]).update(p).digest());
}
function unsign(keys, s) {
  if (typeof s !== 'string' || s.length > 20000) return null;
  const i = s.indexOf('.'); if (i <= 0) return null;
  const p = s.slice(0, i), sig = unb64u(s.slice(i + 1));
  const ok = keys.some((k) => { const m = crypto.createHmac('sha256', k).update(p).digest(); return m.length === sig.length && crypto.timingSafeEqual(m, sig); });
  if (!ok) return null;
  try { return JSON.parse(unb64u(p).toString('utf8')); } catch { return null; }
}

// Firestore REST value decoding (only what the two docs use)
function dv(v) {
  if (!v || typeof v !== 'object') return null;
  if ('stringValue' in v) return v.stringValue;
  if ('integerValue' in v) return Number(v.integerValue);
  if ('doubleValue' in v) return v.doubleValue;
  if ('booleanValue' in v) return v.booleanValue;
  return null;
}
const fields = (doc) => { const o = {}; for (const [k, v] of Object.entries((doc && doc.fields) || {})) o[k] = dv(v); return o; };

// opts: {projectId, fetch, now, keys, noAuth, certsUrl, tpMinMs, testAccounts, uidStore, log}
// uidStore: {claimUid(uid, fb) -> Promise<the fb that owns uid>} that outlives a restart (srv/firestore-sa.mjs), or none:
// the owners are then remembered in memory only
export function createIdentity(opts = {}) {
  const projectId = opts.projectId || 'aevum-a081f';
  const fetchFn = opts.fetch || globalThis.fetch;
  const now = opts.now || (() => Date.now());
  const keys = opts.keys || keysFromEnv().keys;
  const noAuth = !!opts.noAuth;
  const certsUrl = opts.certsUrl || CERTS_URL;
  const tpMinMs = opts.tpMinMs != null ? opts.tpMinMs : TP_MIN_MS;
  const testAccounts = !!opts.testAccounts;
  const uidStore = opts.uidStore || null;
  const log = opts.log || (() => {});
  let certs = null, certsExp = 0, certsP = null;

  async function getCerts(force) {
    if (!force && certs && now() < certsExp) return certs;
    if (!certsP) {
      certsP = (async () => {
        const r = await fetchFn(certsUrl);
        if (!r.ok) throw new IdentityError('CERTS', 'Google sertifikaları alınamadı.', 503);
        const j = await r.json();
        const cc = String((r.headers && r.headers.get && r.headers.get('cache-control')) || '');
        const m = /max-age=(\d+)/.exec(cc);
        certs = j; certsExp = now() + Math.min(24 * 3600, m ? Number(m[1]) : 3600) * 1000;
        return certs;
      })().finally(() => { certsP = null; });
    }
    return certsP;
  }

  // -> {fb, email, provider}; throws IdentityError
  async function verifyIdToken(token) {
    if (typeof token !== 'string' || token.length > 8000) throw new IdentityError('BAD_TOKEN', 'Geçersiz oturum.');
    const parts = token.split('.');
    if (parts.length !== 3) throw new IdentityError('BAD_TOKEN', 'Geçersiz oturum.');
    let head, pl;
    try { head = JSON.parse(unb64u(parts[0]).toString('utf8')); pl = JSON.parse(unb64u(parts[1]).toString('utf8')); } catch { throw new IdentityError('BAD_TOKEN', 'Geçersiz oturum.'); }
    if (!head || head.alg !== 'RS256' || typeof head.kid !== 'string') throw new IdentityError('BAD_TOKEN', 'Geçersiz oturum.');
    let c = await getCerts(false);
    if (!c[head.kid]) c = await getCerts(true);   // Google rotates the keys
    const pem = c[head.kid];
    if (!pem) throw new IdentityError('BAD_KID', 'Oturum doğrulanamadı.');
    const ok = crypto.verify('RSA-SHA256', Buffer.from(parts[0] + '.' + parts[1]), crypto.createPublicKey(pem), unb64u(parts[2]));
    if (!ok) throw new IdentityError('BAD_SIG', 'Oturum doğrulanamadı.');
    const t = Math.floor(now() / 1000);
    if (pl.aud !== projectId || pl.iss !== 'https://securetoken.google.com/' + projectId) throw new IdentityError('BAD_AUD', 'Oturum bu oyuna ait değil.');
    if (!(pl.exp > t)) throw new IdentityError('EXPIRED', 'Oturumun süresi doldu.');
    if (!(pl.iat <= t + 300) || !(pl.auth_time <= t + 300)) throw new IdentityError('BAD_TIME', 'Oturum doğrulanamadı.');
    if (typeof pl.sub !== 'string' || !FB_RE.test(pl.sub)) throw new IdentityError('BAD_SUB', 'Oturum doğrulanamadı.');
    const provider = (pl.firebase && pl.firebase.sign_in_provider) || '';
    const email = typeof pl.email === 'string' ? pl.email : '';
    if (provider !== 'google.com' && !(testAccounts && provider === 'password' && TEST_EMAIL_RE.test(email))) throw new IdentityError('PROVIDER', 'Yalnızca Google ile giriş kabul edilir.', 403);
    return { fb: pl.sub, email, provider };
  }

  // the account's profile + ledger, read with the user's own token (2 document reads)
  async function readAccount(fb, idToken) {
    const root = `projects/${projectId}/databases/(default)/documents`;
    const r = await fetchFn(`https://firestore.googleapis.com/v1/${root}:batchGet`, {
      method: 'POST', headers: { Authorization: 'Bearer ' + idToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ documents: [`${root}/users/${fb}/meta/profile`, `${root}/users/${fb}/meta/tp`] }),
    });
    if (!r.ok) throw new IdentityError('FIRESTORE', 'Profil okunamadı.', r.status === 403 ? 403 : 503);
    const arr = await r.json();
    let prof = null, tp = null;
    for (const x of Array.isArray(arr) ? arr : []) {
      if (!x.found) continue;
      if (x.found.name.endsWith('/meta/profile')) prof = fields(x.found);
      else if (x.found.name.endsWith('/meta/tp')) tp = fields(x.found);
    }
    return { prof, ledger: tp && typeof tp.s === 'string' ? tp.s : null };
  }
  // the account that claimed a user name (names/{key}.uid) -> fb | '' (nobody) | null (could not be read: not checked)
  async function nameOwner(name, idToken) {
    try {
      const root = `projects/${projectId}/databases/(default)/documents`;
      const r = await fetchFn(`https://firestore.googleapis.com/v1/${root}/names/${encodeURIComponent(nameKey(name))}`, { headers: { Authorization: 'Bearer ' + idToken } });
      if (r.status === 404) return '';
      if (!r.ok) return null;
      const o = fields(await r.json());
      return typeof o.uid === 'string' ? o.uid : '';
    } catch (e) { log('name owner', e); return null; }
  }

  // ---------- profile uid owners ----------
  // uid -> fb. The first account that shows a profile uid owns it; one that copied it gets its own derived uid.
  const uidOwners = new Map();
  const derivedUid = (fb) => crypto.createHmac('sha256', keys[0]).update('aevum-uid|' + fb).digest('hex').slice(0, 32);
  async function shownUid(uid, fb) {
    let owner = uidOwners.get(uid) || null;
    if (!owner && uidStore) {
      try { owner = (await uidStore.claimUid(uid, fb)) || null; } catch (e) { log('uid owner', e); owner = null; }
      if (!owner) return uid;   // (the store could not be asked: let the player in, ask again next time)
    }
    if (!owner) owner = fb;
    if (uidOwners.size > 200000) uidOwners.clear();
    if (!uidOwners.has(uid)) uidOwners.set(uid, owner);
    return uidOwners.get(uid) === fb ? uid : derivedUid(fb);
  }

  // ---------- ledger ----------
  const emptyLedger = (fb) => ({ v: 1, fb, tp: 0, w: 0, l: 0, n: 0, last: 0, mids: [], wt: [] });
  // -> the ledger payload of fb (invalid / someone else's -> null)
  function openLedger(s, fb) {
    if (s == null || s === '') return emptyLedger(fb);
    const o = unsign(keys, s);
    if (!o || o.v !== 1 || o.fb !== fb || !Array.isArray(o.mids) || !Number.isInteger(o.tp) || o.tp < 0) return null;
    if (!Array.isArray(o.wt)) o.wt = [];   // (times of the credited wins of the last hour; older ledgers have none)
    return o;
  }

  // ---------- public API ----------
  // body: {token} (or {dev: {fb, uid, name, av, tp}} with noAuth) -> {ticket, ident, exp}
  async function auth(body) {
    let fb, prof, ledgerS = null;
    if (noAuth && body && body.dev) {
      const d = body.dev;
      fb = String(d.fb || ''); prof = { uid: d.uid, name: d.name, avatar: d.av };
      if (!FB_RE.test(fb)) throw new IdentityError('BAD_DEV', 'dev kimliği geçersiz.', 400);
      ledgerS = typeof d.ledger === 'string' ? d.ledger : null;
    } else {
      const tok = body && body.token;
      const v = await verifyIdToken(tok);
      fb = v.fb;
      const a = await readAccount(fb, tok);
      prof = a.prof; ledgerS = a.ledger;
      if (prof && UID_RE.test(prof.uid || '') && cleanName(prof.name)) {
        // the name must be this account's claim (names/ is first come, first served); the uid its own (see shownUid)
        const owner = await nameOwner(cleanName(prof.name), tok);
        if (owner && owner !== fb) throw new IdentityError('NAME_TAKEN', 'Bu kullanıcı adı başka bir hesaba ait.', 409);
        prof = Object.assign({}, prof, { uid: await shownUid(prof.uid, fb) });
      }
    }
    if (!prof || !UID_RE.test(prof.uid || '') || !cleanName(prof.name)) throw new IdentityError('NO_PROFILE', 'Hesap profili henüz hazır değil.', 409);
    const L = openLedger(ledgerS, fb);
    const ident = { fb, uid: prof.uid, name: cleanName(prof.name), av: cleanAv(prof.avatar), tp: L ? L.tp : 0 };
    const exp = now() + TICKET_TTL;
    return { ticket: sign(keys, Object.assign({ k: 't', exp }, ident)), ident, exp };
  }
  // relay ticket -> ident | null
  function checkTicket(s) {
    const o = unsign(keys, s);
    if (!o || o.k !== 't' || !(o.exp > now()) || !FB_RE.test(o.fb || '') || !UID_RE.test(o.uid || '')) return null;
    return { fb: o.fb, uid: o.uid, name: cleanName(o.name), av: cleanAv(o.av), tp: o.tp | 0 };
  }
  // ---------- multiplayer matches (memory only: the server is a single instance) ----------
  // gid -> {id, room, t0, humans: Set(fb) (the room's accounts), holders: Map(fb -> team | null) (the accounts that
  // asked for a ticket of this match, with the team they named then), reports: Map(fb -> {result, t}), conflict}
  const groups = new Map(), roomGroup = new Map();
  let sweptAt = 0;
  function sweepGroups(t) {
    if (t - sweptAt < 60000 && groups.size < MP_GROUPS_MAX) return;
    sweptAt = t;
    for (const [id, g] of groups) if (t - g.t0 > MATCH_TTL || groups.size > MP_GROUPS_MAX) { groups.delete(id); if (roomGroup.get(g.room) === id) roomGroup.delete(g.room); }
  }
  // an account's team in a group: the one it named at /mp/tp/start (none: a team of its own)
  const teamKey = (g, fb) => { const tm = g.holders.get(fb); return tm != null ? 't' + tm : 'f' + fb; };
  const okTeam = (x) => (Number.isInteger(x) && x >= 0 && x < 64 ? x : null);
  // the winners' start teams: more than one -> the reports contradict
  function checkConflict(g) {
    const teams = new Set();
    for (const [fb, r] of g.reports) if (r.result === 'won') teams.add(teamKey(g, fb));
    if (teams.size > 1) g.conflict = true;
  }

  // a match starts: {mode 'sp'|'mp', room?, team?} -> signed match ticket. ctx (multiplayer, from the relay):
  // {room, humans: [fb]} = the relay room this account is in and the verified accounts in it
  function matchStart(ident, body = {}, ctx = null) {
    if (!body || typeof body !== 'object') body = {};
    const t = now();
    const mode = body.mode === 'mp' ? 'mp' : 'sp';
    const room = mode === 'mp' && typeof body.room === 'string' ? body.room.slice(0, 16) : null;
    let gid = null;
    if (mode === 'mp' && ctx && typeof ctx.room === 'string') {
      sweepGroups(t);
      // every player of one match asks within a few seconds: they share one group (a new one once results came in)
      let g = groups.get(roomGroup.get(ctx.room));
      if (!g || t - g.t0 > MP_JOIN_MS || g.reports.size) {
        g = { id: crypto.randomBytes(9).toString('hex'), room: ctx.room, t0: t, humans: new Set(), holders: new Map(), reports: new Map(), conflict: false };
        groups.set(g.id, g); roomGroup.set(ctx.room, g.id);
      }
      for (const fb of ctx.humans || []) if (typeof fb === 'string' && g.humans.size < 16) g.humans.add(fb);
      g.humans.add(ident.fb);
      // the first team an account names for this match is its team (asking again cannot change it)
      if (!g.holders.has(ident.fb) && g.holders.size < 16) g.holders.set(ident.fb, okTeam(body.team));
      gid = g.id;
    }
    return { mt: sign(keys, { k: 'm', fb: ident.fb, mid: crypto.randomBytes(9).toString('hex'), t0: t, mode, room, g: gid }) };
  }
  // a finished match: {mt, result 'won'|'lost', ledger} -> {ok, ledger, tp, gained, reason, pending?, retryIn?}
  // (a team in the claim is ignored: the team named at the match start counts)
  // pending: a multiplayer win waits for the other players' reports; the client asks again after retryIn ms
  function matchClaim(ident, body = {}) {
    if (!body || typeof body !== 'object') body = {};
    const m = unsign(keys, body.mt);
    if (!m || m.k !== 'm' || m.fb !== ident.fb) return { ok: false, reason: 'Maç bileti geçersiz.' };
    const t = now();
    if (t - m.t0 > MATCH_TTL) return { ok: false, reason: 'Maç bileti eskidi.' };
    const L = openLedger(body.ledger, ident.fb);
    if (!L) return { ok: false, reason: 'TP kaydı doğrulanamadı.' };
    const keep = (reason, extra) => Object.assign({ ok: true, ledger: body.ledger || sign(keys, L), tp: L.tp, gained: 0, reason }, extra || null);
    if (L.mids.includes(m.mid)) return keep('Bu maç zaten sayıldı.');
    const result = body.result;
    if (result !== 'won' && result !== 'lost') return { ok: false, reason: 'Sonuç geçersiz.' };
    if (t - m.t0 < tpMinMs) return keep('Maç ' + Math.round(tpMinMs / 60000) + ' dakikadan kısa sürdü: TP verilmez.');
    // matches of one account do not overlap: one that started before the last counted match ended is not counted
    if (m.t0 < L.last - 60000) return keep('Aynı anda oynanan ikinci maç: TP verilmez.');
    if (m.mode === 'mp') {
      const g = m.g ? groups.get(m.g) : null;
      if (!g && result === 'won') return keep('Maçın sonucu sunucuda doğrulanamadı: galibiyet TP vermez.');
      if (g) {
        let rep = g.reports.get(ident.fb);
        if (!rep) {
          rep = { result, t };
          g.reports.set(ident.fb, rep);
          checkConflict(g);
        }
        if (rep.result !== result) return keep('Bu maç için başka bir sonuç bildirildi.');
        if (result === 'won') {
          if (g.conflict) return keep('Oyuncuların bildirdiği sonuçlar çelişiyor: galibiyet TP vermez.');
          // wait for every account that asked for a ticket of this match (not every account in the room); with
          // players on different start teams, also for at least one loss. MP_WAIT_MS at most: a player who left
          // never reports (an all-win of two teams is a conflict, above)
          const holders = [...g.holders.keys()];
          const missing = holders.some((fb) => !g.reports.has(fb));
          const multiTeam = new Set(holders.map((fb) => teamKey(g, fb))).size > 1;
          const aLoss = [...g.reports.values()].some((x) => x.result === 'lost');
          if ((missing || (multiTeam && !aLoss)) && t - rep.t < MP_WAIT_MS) return keep('Diğer oyuncuların sonucu bekleniyor.', { pending: true, retryIn: 5000 });
        }
      }
    }
    const wt = L.wt.filter((x) => t - x < TP_WIN_CAP_MS);
    if (result === 'won' && wt.length >= TP_WIN_CAP) return keep('Bir saatte en çok ' + TP_WIN_CAP + ' galibiyet TP verir.');
    const gained = result === 'won' ? TP_WIN : TP_LOSS;
    const N = { v: 1, fb: L.fb, tp: L.tp + gained, w: L.w + (result === 'won' ? 1 : 0), l: L.l + (result === 'lost' ? 1 : 0), n: L.n + 1, last: t, mids: L.mids.concat([m.mid]).slice(-LEDGER_MIDS), wt: result === 'won' ? wt.concat([t]) : wt };
    return { ok: true, ledger: sign(keys, N), tp: N.tp, gained, reason: '' };
  }
  // the client asks what its stored ledger is worth
  function ledgerInfo(ident, s) {
    const L = openLedger(s, ident.fb);
    return L ? { ok: true, tp: L.tp, w: L.w, l: L.l, n: L.n } : { ok: false, tp: 0 };
  }

  return { verifyIdToken, readAccount, auth, checkTicket, matchStart, matchClaim, ledgerInfo, openLedger, _sign: (o) => sign(keys, o) };
}
