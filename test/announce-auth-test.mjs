// Aevum - the signed update announcement (srv/announce-auth.mjs, tools/announce.mjs): a token signed with the service
// account's key is accepted, anything else is refused. Run: node test/announce-auth-test.mjs
import crypto from 'node:crypto';
import { signAnnounce, createAnnounceAuth } from '../srv/announce-auth.mjs';

let failed = 0;
const ok = (c, m) => { if (c) console.log('  ok   ' + m); else { failed++; console.log('  FAIL ' + m); } };

const mk = (email, kid) => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  return { client_email: email, private_key_id: kid, private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), pub: publicKey.export({ type: 'spki', format: 'pem' }) };
};
const sa = mk('game@proj.iam.gserviceaccount.com', 'k1');
const other = mk('evil@proj.iam.gserviceaccount.com', 'k9');
let t = Date.now(), fetches = 0;
const fakeFetch = async (url) => { fetches++; return { ok: url.includes(encodeURIComponent(sa.client_email)), status: 200, json: async () => ({ k1: sa.pub }) }; };
const auth = createAnnounceAuth({ email: sa.client_email, fetch: fakeFetch, now: () => t });

const good = signAnnounce(sa, { inSec: 60 }, t);
ok(JSON.stringify(await auth.verify(good)) === '{"inSec":60}', 'a token signed with the account key is accepted, with its signed body');
ok((await auth.verify(signAnnounce(other, { inSec: 60 }, t))) === null, 'a token from another account is refused');
const forged = { ...other, client_email: sa.client_email, private_key_id: 'k1' };
ok((await auth.verify(signAnnounce(forged, { inSec: 60 }, t))) === null, 'a token claiming the account but signed with another key is refused');
const parts = good.split('.');
const tampered = parts[0] + '.' + Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(parts[1], 'base64').toString()), body: { inSec: 10 } })).toString('base64url') + '.' + parts[2];
ok((await auth.verify(tampered)) === null, 'a token with a changed body is refused');
t += 5 * 60 * 1000;
ok((await auth.verify(good)) === null, 'an expired token is refused');
ok((await auth.verify('x.y.z')) === null && (await auth.verify('')) === null && (await auth.verify(null)) === null, 'garbage is refused');
ok((await createAnnounceAuth({ email: null, fetch: fakeFetch }).verify(good)) === null, 'a server without a service account accepts no token');
ok(fetches <= 3, 'certificates are cached (' + fetches + ' fetches)');
console.log(failed ? 'FAILED ' + failed : 'ALL OK');
process.exit(failed ? 1 : 0);
