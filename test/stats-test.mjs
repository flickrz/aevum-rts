// Aevum - unit test of srv/stats.mjs (player statistics) and the Firestore value mapping of srv/firestore-sa.mjs.
import assert from 'node:assert/strict';
import { createStats, dayOf, ONLINE_MS, encodeDay, decodeDay } from '../srv/stats.mjs';
import { createSaStore, serviceAccountFromEnv } from '../srv/firestore-sa.mjs';
import crypto from 'node:crypto';

let t = Date.UTC(2026, 10, 19, 12, 0, 0);
const now = () => t;
const docs = new Map();
const store = { get: async (d) => docs.get(d) || null, put: async (d, f) => { docs.set(d, JSON.parse(JSON.stringify(f))); }, list: async (n) => [...docs.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).slice(0, n).map(([day, f]) => Object.assign({ day }, f)) };

// Turkey time: 21:30 UTC is already the next day
assert.equal(dayOf(Date.UTC(2026, 10, 19, 21, 30)), '2026-11-20');
assert.equal(dayOf(Date.UTC(2026, 10, 19, 20, 30)), '2026-11-19');

const S = createStats({ now, store });
assert.equal(S.beat('bad id!', 'menu', null), false);
S.beat('aaaaaaaa1', 'menu', null);
S.beat('aaaaaaaa2', 'sp', 'fbOne');
S.beat('aaaaaaaa3', 'mp', 'fbTwo');
S.beat('aaaaaaaa3', 'mp', 'fbTwo');     // same browser again
await new Promise((r) => setTimeout(r, 0));
assert.deepEqual(S.online(), { total: 3, menu: 1, sp: 1, mp: 1, signedIn: 2 });
assert.deepEqual([...S.fbStates()].sort(), [['fbOne', 'sp'], ['fbTwo', 'mp']]);
S.match('sp', null, 'fbOne');
S.match('mp', 'ROOM1', 'fbTwo');
S.match('mp', 'ROOM1', 'fbThree');    // the other player of the same room
assert.deepEqual(S.today(), { day: '2026-11-19', visitors: 3, players: 3, sp: 1, mp: 1, peak: 3 });
// a browser that stopped beating goes offline
t += ONLINE_MS + 1000;
S.beat('aaaaaaaa1', 'menu', null);
assert.equal(S.online().total, 1);
assert.equal(await S.flush(), true);
assert.equal(await S.flush(), false);   // nothing changed
assert.equal(docs.get('2026-11-19').nv, 3);

// a restart keeps counting: the same visitor is not counted twice, a new one is
const S2 = createStats({ now, store });
S2.beat('aaaaaaaa1', 'menu', null);
S2.beat('aaaaaaaa9', 'menu', null);
await S2.flush();
assert.deepEqual(S2.today(), { day: '2026-11-19', visitors: 4, players: 3, sp: 1, mp: 1, peak: 3 });

// a new day: yesterday is written, today starts at 0
t = Date.UTC(2026, 10, 19, 22, 0);
S2.beat('aaaaaaaa1', 'sp', null);
await S2.flush();
const rep = await S2.report(30);
assert.deepEqual(rep.days.map((d) => [d.day, d.visitors]), [['2026-11-20', 1], ['2026-11-19', 4]]);
assert.equal(rep.persisted, true);

// (2026-11-23) the owner's screen asks every minute: the stored past days are read once a day, not on every report
{
  let lists = 0;
  const cs = Object.assign({}, store, { list: async (n) => { lists++; return store.list(n); } });
  const S3 = createStats({ now, store: cs });
  await S3.report(30); await S3.report(30); t += 60 * 1000; const r3 = await S3.report(30);
  assert.equal(lists, 1);
  assert.deepEqual(r3.days.map((d) => d.day), ['2026-11-20', '2026-11-19']);
  t = Date.UTC(2026, 10, 20, 22, 0);   // a new day: read again
  await S3.report(30);
  assert.equal(lists, 2);
  t = Date.UTC(2026, 10, 19, 22, 0);
}

// round trip of a stored day
const back = decodeDay('x', encodeDay(decodeDay('x', { v: 'a,b', p: 'c', r: '', sp: 2, mp: 1, peak: 5 })));
assert.equal(back.v.size, 2); assert.equal(back.p.size, 1); assert.equal(back.peak, 5);

// the service account store: signs a JWT, maps the values
const { privateKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const sa = { client_email: 'x@p.iam.gserviceaccount.com', private_key: privateKey.export({ type: 'pkcs8', format: 'pem' }), project_id: 'p' };
assert.equal(serviceAccountFromEnv({ AEVUM_SA: Buffer.from(JSON.stringify(sa)).toString('base64') }).client_email, sa.client_email);
assert.equal(serviceAccountFromEnv({ AEVUM_SA: 'nonsense' }), null);
const calls = [];
const fake = async (url, init = {}) => {
  calls.push([url, init]);
  const ok = (j) => ({ ok: true, status: 200, json: async () => j });
  if (url.includes('oauth2')) return ok({ access_token: 'AT', expires_in: 3600 });
  if (url.endsWith(':batchGet')) return ok([{ found: { name: 'projects/p/databases/(default)/documents/stats/2026-11-19', fields: { nv: { integerValue: '7' } } } }, { missing: 'x' }]);
  if (init.method === 'PATCH') return ok({});
  return ok({ fields: { sp: { integerValue: '4' }, v: { stringValue: 'a,b' } } });
};
const fs = createSaStore({ sa, fetch: fake, now });
await fs.put('2026-11-19', { sp: 4, v: 'a,b' });
assert.equal(JSON.parse(calls[1][1].body).fields.sp.integerValue, '4');
assert.equal(calls[1][1].headers.Authorization, 'Bearer AT');
assert.deepEqual(await fs.get('2026-11-19'), { sp: 4, v: 'a,b' });
assert.deepEqual(await fs.list(5), [{ day: '2026-11-19', nv: 7 }]);
assert.equal(calls.filter(([u]) => u.includes('oauth2')).length, 1);   // the token is reused

console.log('stats-test: OK');
