// Aevum - Firebase session over REST: persisted in localStorage ('aevum.auth': uid, e-mail, refresh token and the
// id token's expiry; never the id token), the id token is refreshed a few minutes before it expires (lazily on use,
// plus a timer in the browser). Sign in happens with Google (google.js: the SDK popup hands its refresh token over
// to adopt()); everything after that is plain REST. Storage, fetch and the clock are injected (test/cloud-test.mjs
// runs it against a fake server).
import { authApi, CloudError } from './rest.js';
import { tr } from '../i18n.js';

export const AUTH_KEY = 'aevum.auth';
export const REFRESH_EARLY_MS = 5 * 60 * 1000;

const MSG = {
  TOO_MANY_ATTEMPTS_TRY_LATER: tr('Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.'),
  USER_DISABLED: tr('Bu hesap devre dışı bırakılmış.'),
  OPERATION_NOT_ALLOWED: tr('Google ile giriş henüz açılmamış.'),
  TOKEN_EXPIRED: tr('Oturumun sona erdi, tekrar giriş yap.'),
  INVALID_REFRESH_TOKEN: tr('Oturumun sona erdi, tekrar giriş yap.'),
  INVALID_ID_TOKEN: tr('Oturumun sona erdi, tekrar giriş yap.'),
  USER_NOT_FOUND: tr('Hesap bulunamadı, tekrar giriş yap.'),
  CREDENTIAL_TOO_OLD_LOGIN_AGAIN: tr('Güvenlik için tekrar giriş yapman gerekiyor.'),
};
// any error -> a short Turkish message
export function authMessage(e) {
  if (!e) return tr('Bilinmeyen hata.');
  if (e.kind === 'network') return tr('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.');
  if (e.kind === 'quota') return tr('Sunucu şu an yoğun (kota). Daha sonra tekrar dene.');
  if (e.kind === 'server') return tr('Sunucu hatası. Daha sonra tekrar dene.');
  if (e.code && Object.hasOwn(MSG, e.code)) return MSG[e.code];
  return (e.message && !/^[A-Z_]+$/.test(e.message) ? e.message : (e.code ? tr('Bir hata oluştu ({0})', e.code) : tr('Bir hata oluştu'))) + '';
}

const lsGet = (ls, k) => { try { return ls ? ls.getItem(k) : null; } catch { return null; } };
const lsSet = (ls, k, v) => { try { if (ls) ls.setItem(k, v); } catch { /* blocked / full: memory only */ } };
const lsDel = (ls, k) => { try { if (ls) ls.removeItem(k); } catch { /* ignore */ } };

export class Auth {
  // opts: {fetch, apiKey, ls, now(), setTimer(fn, ms) -> handle, clearTimer(handle)}
  constructor(opts) {
    this.api = authApi({ fetch: opts.fetch, apiKey: opts.apiKey, timeoutMs: opts.timeoutMs || 20000 });
    this.ls = opts.ls || null;
    this.now = opts.now || (() => Date.now());
    this.setTimer = opts.setTimer || null; this.clearTimer = opts.clearTimer || null;
    this.s = null;              // {uid, email, refreshToken, idToken, exp}
    this.dead = false;          // the refresh token was rejected: log in again
    this._ref = null; this._timer = null;
    this._gen = 0;              // bumped by every sign in / sign out / reload: a refresh started before is discarded
    this._hold = false;         // adopt({hold}): not persisted yet
    this.onChange = null;
    this.load();
  }
  load() {
    this._gen++; this._ref = null; this.dead = false;
    this.s = null;
    try {
      const o = JSON.parse(lsGet(this.ls, AUTH_KEY) || 'null');
      if (o && typeof o.uid === 'string' && typeof o.refreshToken === 'string' && o.refreshToken) {
        // the id token itself is never persisted (memory only): a reload costs one refresh
        this.s = { uid: o.uid, email: String(o.email || ''), refreshToken: o.refreshToken, idToken: '', exp: 0 };
      }
    } catch { this.s = null; }
    this._arm();
    return this.s;
  }
  get user() { return this.s ? { uid: this.s.uid, email: this.s.email } : null; }
  // the stored session: uid, email, refresh token and the id token's expiry (not the id token: a bearer token)
  _persist() {
    if (this._hold) return;
    if (this.s) lsSet(this.ls, AUTH_KEY, JSON.stringify({ uid: this.s.uid, email: this.s.email, refreshToken: this.s.refreshToken, exp: this.s.exp }));
    else lsDel(this.ls, AUTH_KEY);
  }
  // the stored session as another tab left it: null | {uid, refreshToken}
  stored() {
    try { const o = JSON.parse(lsGet(this.ls, AUTH_KEY) || 'null'); return o && typeof o.uid === 'string' && typeof o.refreshToken === 'string' ? { uid: o.uid, refreshToken: o.refreshToken } : null; } catch { return null; }
  }
  // forget the session in memory only (another tab signed out: localStorage is already clean)
  forget() {
    this._gen++; this._ref = null; this.s = null; this.dead = false;
    if (this._timer != null && this.clearTimer) { this.clearTimer(this._timer); this._timer = null; }
    if (this.onChange) { try { this.onChange(); } catch (e) { /* ignore */ } }
  }
  _set(r) {
    const ttl = Math.max(60, Number(r.expiresIn || r.expires_in) || 3600) * 1000;
    this.s = {
      uid: r.localId || r.user_id || (this.s && this.s.uid),
      email: r.email || (this.s && this.s.email) || '',
      refreshToken: r.refreshToken || r.refresh_token || (this.s && this.s.refreshToken),
      idToken: r.idToken || r.id_token, exp: this.now() + ttl,
    };
    this.dead = false;
    this._persist(); this._arm();
    if (this.onChange) { try { this.onChange(); } catch (e) { /* ignore */ } }
  }
  // background refresh a few minutes before the id token expires (browser only; the tests call token())
  _arm() {
    if (this._timer != null && this.clearTimer) { this.clearTimer(this._timer); this._timer = null; }
    if (!this.s || !this.setTimer || this.dead) return;
    const wait = Math.max(5000, this.s.exp - REFRESH_EARLY_MS - this.now());
    this._timer = this.setTimer(() => { this._timer = null; this.token(true).catch(() => { /* retried on next use */ }); }, Math.min(wait, 0x7fffffff));
  }
  // take over a session signed in elsewhere (the Google popup of the Firebase SDK): uid, e-mail, refresh token.
  // Our own id token comes from one securetoken refresh. hold: keep it out of localStorage until commit() (a new
  // account choosing its user name must not come back half set up after a reload).
  async adopt({ uid, email, refreshToken }, { hold = false } = {}) {
    if (typeof uid !== 'string' || !uid || typeof refreshToken !== 'string' || !refreshToken) throw new CloudError('auth', 'NO_SESSION', tr('Giriş tamamlanamadı.'));
    this._gen++; this._ref = null; this.dead = false;
    if (this._timer != null && this.clearTimer) { this.clearTimer(this._timer); this._timer = null; }
    this._hold = !!hold;
    const gen = this._gen;
    this.s = { uid, email: String(email || ''), refreshToken, idToken: '', exp: 0 };
    try {
      await this.token(true);
      if (!this.s || this.s.uid !== uid) throw new CloudError('auth', 'USER_MISMATCH', tr('Giriş tamamlanamadı.'));
    } catch (e) {
      if (this._gen === gen) this.signOut();   // (unless another sign in / sign out came meanwhile)
      throw e;
    }
    return this.user;
  }
  // a held session (adopt hold) goes to localStorage now
  commit() { if (this._hold) { this._hold = false; this._persist(); } }
  // a valid id token; refreshes when it expires within REFRESH_EARLY_MS (or force). Concurrent callers share one refresh.
  // A refresh that lands after a sign out / another sign in is discarded (kind 'stale'): it never revives a session.
  async token(force = false) {
    if (!this.s) throw new CloudError('auth', 'NO_SESSION', tr('Giriş yapılmadı.'));
    if (this.dead && !force) throw new CloudError('auth', 'TOKEN_EXPIRED', MSG.TOKEN_EXPIRED);
    if (!force && this.s.idToken && this.s.exp - this.now() > REFRESH_EARLY_MS) return this.s.idToken;
    if (!this._ref) {
      const gen = this._gen, rt = this.s.refreshToken, uid = this.s.uid;
      const cur = () => this._gen === gen && !!this.s && this.s.uid === uid && this.s.refreshToken === rt;
      const p = (async () => {
        try {
          const r = await this.api.refresh(rt);
          if (!cur()) throw new CloudError('stale', 'SESSION_CHANGED', tr('Oturum değişti.'));
          this._set(r); return this.s.idToken;
        } catch (e) {
          if (cur() && (e.kind === 'auth' || (e.kind === 'bad' && /TOKEN|GRANT/.test(e.code)))) { e.kind = 'auth'; this.dead = true; if (this.onChange) { try { this.onChange(); } catch (x) { /* ignore */ } } }
          throw e;
        } finally { if (this._ref === p) this._ref = null; }
      })();
      this._ref = p;
    }
    return this._ref;
  }
  async deleteAccount() {
    const t = await this.token(false);
    await this.api.remove(t);
    this.signOut();
  }
  signOut() {
    this._gen++; this._ref = null; this._hold = false;
    this.s = null; this.dead = false;
    if (this._timer != null && this.clearTimer) { this.clearTimer(this._timer); this._timer = null; }
    this._persist();
    if (this.onChange) { try { this.onChange(); } catch (e) { /* ignore */ } }
  }
}
