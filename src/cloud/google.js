import { tr } from '../i18n.js';
// Aevum - "Google ile Giriş Yap": the official Firebase JS SDK is used ONLY for the Google popup / redirect (OAuth
// needs the Firebase auth handler on authDomain as its redirect_uri, which plain REST cannot provide from our own
// origin). It is lazy-loaded from gstatic on first use (never on page load, except to finish a pending redirect).
// As soon as the SDK has signed the player in, the uid, e-mail and refresh token are handed to our REST session
// (auth.js, which fetches its own id token through securetoken) and the SDK is signed out again: there is never a
// second live session. The loader is injected so test/cloud-test.mjs runs the whole flow with a stubbed SDK.

export const SDK_VERSION = '10.14.1';
export const SDK_BASE = `https://www.gstatic.com/firebasejs/${SDK_VERSION}/`;
export const REDIRECT_KEY = 'aevum.googleRedirect';   // sessionStorage: a signInWithRedirect is on its way back
const REDIRECT_TTL = 15 * 60 * 1000;
const APP_NAME = 'aevum-google';

// -> {app: firebase-app module, auth: firebase-auth module}
export async function loadFirebaseSdk() {
  const [app, auth] = await Promise.all([import(SDK_BASE + 'firebase-app.js'), import(SDK_BASE + 'firebase-auth.js')]);
  return { app, auth };
}

// an SDK / loader error -> {code, message (Turkish; '' = say nothing: the player closed the popup)}
const SILENT = new Set(['auth/popup-closed-by-user', 'auth/cancelled-popup-request', 'auth/user-cancelled', 'auth/redirect-cancelled-by-user']);
const GMSG = {
  'auth/popup-blocked': tr('Google giriş penceresi engellendi. Tarayıcının bu site için açılır pencerelere izin vermesini sağlayıp tekrar dene.'),
  'auth/operation-not-allowed': tr('Google ile giriş henüz açılmamış.'),
  'auth/unauthorized-domain': tr('Bu site adresi Google ile giriş için yetkilendirilmemiş.'),
  'auth/network-request-failed': tr('Sunucuya ulaşılamadı. İnternet bağlantını kontrol et.'),
  'auth/timeout': tr('Google yanıt vermedi. Tekrar dene.'),
  'auth/user-disabled': tr('Bu hesap devre dışı bırakılmış.'),
  'auth/too-many-requests': tr('Çok fazla deneme yapıldı. Biraz bekleyip tekrar dene.'),
  'auth/web-storage-unsupported': tr('Tarayıcın Google ile giriş için gereken depolamayı engelliyor (gizli mod ya da çerez ayarları).'),
  'auth/operation-not-supported-in-this-environment': tr('Bu tarayıcıda Google ile giriş desteklenmiyor.'),
  'auth/account-exists-with-different-credential': tr('Bu e-posta başka bir giriş yöntemine bağlı.'),
  'auth/internal-error': tr('Google ile giriş sırasında bir hata oluştu. Tekrar dene.'),
  'sdk-load': tr('Google ile giriş yüklenemedi. İnternet bağlantını kontrol edip tekrar dene.'),
  'no-refresh-token': tr('Google ile giriş tamamlanamadı. Tekrar dene.'),
};
export function googleCode(e) {
  if (!e) return '';
  const c = String(e.code || '');
  if (c) return /OPERATION_NOT_ALLOWED/.test(c) ? 'auth/operation-not-allowed' : c;
  const m = String(e.message || '');
  if (/OPERATION_NOT_ALLOWED|operation-not-allowed/.test(m)) return 'auth/operation-not-allowed';
  return '';
}
export function googleMessage(e) {
  const c = googleCode(e);
  if (SILENT.has(c)) return '';
  if (Object.hasOwn(GMSG, c)) return GMSG[c];
  if (e && e.kind === 'network') return GMSG['auth/network-request-failed'];
  return c ? tr('Google ile giriş başarısız ({0}).', c.replace(/^auth\//, '')) : tr('Google ile giriş başarısız.');
}
const gErr = (code, cause) => Object.assign(new Error(code), { code, cause });

export class GoogleSignIn {
  // opts: {config (FIREBASE web config), loader() -> {app, auth}, ss: sessionStorage | null, now()}
  constructor(opts) {
    this.config = opts.config;
    this.loader = opts.loader || loadFirebaseSdk;
    this.ss = opts.ss || null;
    this.now = opts.now || (() => Date.now());
    this._sdk = null;     // Promise<{mod, auth}>
  }
  get loaded() { return !!this._sdk; }
  // start loading the SDK (on hover / focus of the button: the popup must open soon after the click, while the
  // browser still counts it as user initiated)
  warm() { this._load().catch(() => { /* reported on click */ }); }
  _load() {
    if (!this._sdk) {
      this._sdk = (async () => {
        let m;
        try { m = await this.loader(); } catch (e) { throw gErr('sdk-load', e); }
        const A = m.auth;
        const apps = typeof m.app.getApps === 'function' ? m.app.getApps() : [];
        const fa = apps.find((a) => a.name === APP_NAME) || m.app.initializeApp(this.config, APP_NAME);
        // session storage only (needed by the redirect flow), cleared by signOut right after the hand-off
        let auth;
        try { auth = A.initializeAuth(fa, { persistence: A.browserSessionPersistence, popupRedirectResolver: A.browserPopupRedirectResolver }); } catch (e) { auth = A.getAuth(fa); }
        try { auth.languageCode = 'tr'; } catch (e) { /* ignore */ }
        return { A, auth };
      })();
      this._sdk.catch(() => { this._sdk = null; });   // a failed load can be retried
    }
    return this._sdk;
  }
  _provider(A) { const p = new A.GoogleAuthProvider(); try { p.setCustomParameters({ prompt: 'select_account' }); } catch (e) { /* ignore */ } return p; }
  // the credentials our REST session needs; the SDK session is dropped at once
  async _handoff(sdk, cred) {
    const u = cred && cred.user;
    const out = u ? {
      uid: String(u.uid || ''), refreshToken: String(u.refreshToken || ''),
      email: String(u.email || ((u.providerData || []).find((p) => p && p.email) || {}).email || ''),
      displayName: String(u.displayName || ''),
    } : null;
    try { await sdk.A.signOut(sdk.auth); } catch (e) { /* in memory / session storage only */ }
    if (!out || !out.uid || !out.refreshToken) throw gErr('no-refresh-token');
    return out;
  }
  // -> {uid, email, refreshToken, displayName} | {redirecting: true} (popup blocked: the page goes to Google)
  async signIn({ allowRedirect = true } = {}) {
    const sdk = await this._load();
    try {
      return await this._handoff(sdk, await sdk.A.signInWithPopup(sdk.auth, this._provider(sdk.A)));
    } catch (e) {
      if (googleCode(e) !== 'auth/popup-blocked' || !allowRedirect) throw e;
      this._ssSet(JSON.stringify({ t: this.now() }));
      try { await sdk.A.signInWithRedirect(sdk.auth, this._provider(sdk.A)); } catch (x) { this._ssDel(); throw x; }
      return { redirecting: true };
    }
  }
  // a signInWithRedirect left this tab and came back (flag in sessionStorage)
  redirectPending() {
    try { const o = JSON.parse(this._ssGet() || 'null'); return !!(o && this.now() - (Number(o.t) || 0) < REDIRECT_TTL); } catch { return false; }
  }
  // -> the hand-off credentials | null (nothing came back)
  async finishRedirect() {
    if (!this.redirectPending()) { this._ssDel(); return null; }
    this._ssDel();
    const sdk = await this._load();
    const cred = await sdk.A.getRedirectResult(sdk.auth);
    if (!cred || !cred.user) return null;
    return this._handoff(sdk, cred);
  }
  // sign out: no SDK state may survive (normally there is none: it is signed out right after every hand-off)
  async clear() {
    this._ssDel();
    if (this._sdk) { try { const sdk = await this._sdk; await sdk.A.signOut(sdk.auth); } catch (e) { /* not loaded / nothing to do */ } }
    try {
      if (this.ss) {
        const ks = [];
        for (let i = 0; i < this.ss.length; i++) { const k = this.ss.key(i); if (k && k.startsWith('firebase:') && k.includes(this.config.apiKey)) ks.push(k); }
        for (const k of ks) this.ss.removeItem(k);
      }
    } catch (e) { /* blocked storage */ }
  }
  _ssGet() { try { return this.ss ? this.ss.getItem(REDIRECT_KEY) : null; } catch { return null; } }
  _ssSet(v) { try { if (this.ss) this.ss.setItem(REDIRECT_KEY, v); } catch { /* ignore */ } }
  _ssDel() { try { if (this.ss) this.ss.removeItem(REDIRECT_KEY); } catch { /* ignore */ } }
}
