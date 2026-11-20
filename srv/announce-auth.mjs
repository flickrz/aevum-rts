// Aevum - who may announce an update without a browser: a short JWT signed with the game's Google service account key
// (the same account the server uses for its statistics, AEVUM_SA). tools/announce.mjs signs it on the publisher's
// machine with ~/.aevum/firebase-sa.json; the server checks the signature against Google's public certificates for
// that account, so any key of the account works and no new secret is needed. Pure node, no npm deps.
import crypto from 'node:crypto';

const AUD = 'aevum-announce';
const b64uJson = (s) => JSON.parse(Buffer.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
const b64u = (buf) => Buffer.from(buf).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

// -> a signed token for { inSec, msg, cancel } (lives 2 minutes)
export function signAnnounce(sa, body = {}, now = Date.now()) {
  const iat = Math.floor(now / 1000);
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT', kid: sa.private_key_id }));
  const claim = b64u(JSON.stringify({ iss: sa.client_email, aud: AUD, iat, exp: iat + 120, body }));
  const sig = b64u(crypto.createSign('RSA-SHA256').update(head + '.' + claim).sign(sa.private_key));
  return head + '.' + claim + '.' + sig;
}

// the checker the server keeps: verify(token) -> Promise<body|null>
export function createAnnounceAuth({ email, fetch: fetchFn = globalThis.fetch, now = () => Date.now() }) {
  let certs = null, certsAt = 0;
  async function getCerts(force) {
    if (!force && certs && now() - certsAt < 3600e3) return certs;
    const r = await fetchFn('https://www.googleapis.com/robot/v1/metadata/x509/' + encodeURIComponent(email));
    if (!r.ok) throw new Error('certs ' + r.status);
    certs = await r.json(); certsAt = now();
    return certs;
  }
  return {
    async verify(token) {
      if (!email || typeof token !== 'string' || token.length > 4096) return null;
      const parts = token.split('.');
      if (parts.length !== 3) return null;
      let head, claim;
      try { head = b64uJson(parts[0]); claim = b64uJson(parts[1]); } catch { return null; }
      if (!head || head.alg !== 'RS256' || !claim || claim.iss !== email || claim.aud !== AUD) return null;
      const t = Math.floor(now() / 1000);
      if (!(claim.exp > t) || !(claim.iat <= t + 30) || claim.exp - claim.iat > 300) return null;
      let c = null;
      try { c = (await getCerts(false))[head.kid]; if (!c) c = (await getCerts(true))[head.kid]; } catch { return null; }
      if (!c) return null;
      const sig = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
      let ok = false;
      try { ok = crypto.createVerify('RSA-SHA256').update(parts[0] + '.' + parts[1]).verify(c, sig); } catch { ok = false; }
      return ok ? (claim.body && typeof claim.body === 'object' ? claim.body : {}) : null;
    },
  };
}
