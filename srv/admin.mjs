// Aevum - the owner's admin page data (server.js /admin, /mp/admin/*; owner 2026-11-23: "bu pcye ihtiyaç duymayacak
// şekilde yap"): every chat line with @claude, read live from Firestore (users/*/chatlog, written by CloudSync.logChat),
// merged with the owner's decision on it (adminFeedback/{id} {status, note, decidedAt}, written only by this server
// and tools/read-admin.mjs with the service account; players can neither read nor write it).
// The id of a line is 'f' + the first 16 hex chars of sha1(its document path): stable, the same one the old
// claude.ai panel used (aevum-admin/sync.mjs), so imported decisions match.
// The store: createSaStore (srv/firestore-sa.mjs) on the server, createMemoryAdminStore in the tests.
import crypto from 'node:crypto';

export const STATUSES = ['new', 'approved', 'rejected', 'done'];
export const NOTE_MAX = 500;
export const ID_RE = /^f[0-9a-f]{16}$/;
export const COLLECTION = 'adminFeedback';
export const feedbackId = (docName) => 'f' + crypto.createHash('sha1').update(String(docName)).digest('hex').slice(0, 16);
// (2026-11-23: reading every chat line on each load used up the free daily Firestore read quota) the @claude lines
// are now also written to users/{uid}/claude/{id} (CloudSync.logChat), and only that small collection is read. A
// copy keeps the id of its chatlog original: the path is hashed as if it were users/{uid}/chatlog/{id}.
export const FEEDBACK_COLLECTION = 'claude';
export const lineId = (docName) => feedbackId(String(docName).replace(/\/claude\/([^/]+)$/, '/chatlog/$1'));

// a Firestore REST value -> plain
export const val = (v) => (!v ? null : 'stringValue' in v ? v.stringValue : 'timestampValue' in v ? v.timestampValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : null);

// raw chatlog documents -> the @claude lines, newest first (exactly what aevum-admin/sync.mjs computed)
export function feedbackRows(docs) {
  return (docs || []).map((d) => {
    const f = d.fields || {};
    return { id: lineId(d.name), at: String(val(f.at) || val(f.t) || ''), room: String(val(f.room) || ''), name: String(val(f.name) || '?'), text: String(val(f.text) || '') };
  }).filter((r) => /@claude/i.test(r.text)).map((r) => ({ ...r, text: r.text.replace(/@claude/ig, '').trim() }))
    .sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
// raw adminFeedback documents -> Map(id -> {status, note, decidedAt})
export function decisionMap(docs) {
  const m = new Map();
  for (const d of docs || []) {
    const id = String(d.name || '').split('/').pop(), f = d.fields || {};
    if (!ID_RE.test(id)) continue;
    const status = val(f.status);
    m.set(id, { status: STATUSES.includes(status) ? status : 'new', note: String(val(f.note) || ''), decidedAt: String(val(f.decidedAt) || '') });
  }
  return m;
}
export function merge(rows, decisions) {
  return rows.map((r) => Object.assign({}, r, decisions.get(r.id) || { status: 'new', note: '', decidedAt: '' }));
}
// a decision request {id, status?, note?} -> {id, status?, note?} | {error}
export function cleanDecision(body) {
  if (!body || typeof body !== 'object') return { error: 'bad json' };
  const id = typeof body.id === 'string' ? body.id : '';
  if (!ID_RE.test(id)) return { error: 'bad id' };
  const out = { id };
  if (body.status !== undefined) {
    if (!STATUSES.includes(body.status)) return { error: 'bad status' };
    out.status = body.status;
  }
  if (body.note !== undefined) {
    if (typeof body.note !== 'string' || body.note.length > NOTE_MAX) return { error: 'bad note' };
    out.note = body.note.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  }
  if (out.status === undefined && out.note === undefined) return { error: 'nothing to change' };
  return out;
}
// the Firestore fields of a decision (decidedAt changes with the status only)
export function decisionFields(d, now = Date.now()) {
  const f = {};
  if (d.status !== undefined) { f.status = { stringValue: d.status }; f.decidedAt = { stringValue: new Date(now).toISOString() }; }
  if (d.note !== undefined) f.note = { stringValue: d.note };
  return f;
}

// store: {query(collectionId, opts), count(collectionId), patch(docPath, fields)}
// ttlMs: how long one Firestore read of the lines and decisions is reused (keeps reads cheap: the page may be
// reloaded often; a decision made here updates the cache at once)
export function createAdmin({ store, now = () => Date.now(), ttlMs = 45000, countTtlMs = 10 * 60000 } = {}) {
  let cache = null, cacheT = 0, loading = null;   // {rows, decisions}
  const recent = new Map();   // id -> {next, t}: decisions made here lately (a read already under way may predate them)
  let accounts = null, accountsT = 0;
  async function load() {
    if (cache && now() - cacheT < ttlMs) return cache;
    if (!loading) {
      loading = (async () => {
        const t0 = now();
        const [chat, dec] = await Promise.all([
          store.query(FEEDBACK_COLLECTION, { allDescendants: true, fields: ['at', 't', 'room', 'name', 'text'] }),
          store.query(COLLECTION),
        ]);
        cache = { rows: feedbackRows(chat), decisions: decisionMap(dec) };
        for (const [id, w] of recent) { if (w.t >= t0) cache.decisions.set(id, w.next); else recent.delete(id); }
        cacheT = now();
        return cache;
      })().finally(() => { loading = null; });
    }
    return loading;
  }
  return {
    // -> {at, items: [{id, at, room, name, text, status, note, decidedAt}]} newest first
    async feedback() {
      const c = await load();
      return { at: new Date(cacheT).toISOString(), items: merge(c.rows, c.decisions) };
    },
    // d: a cleanDecision result -> the merged decision
    async decide(d) {
      const fields = decisionFields(d, now());
      await store.patch(COLLECTION + '/' + d.id, fields);
      const prev = (cache && cache.decisions.get(d.id)) || { status: 'new', note: '', decidedAt: '' };
      const next = { status: d.status !== undefined ? d.status : prev.status, note: d.note !== undefined ? d.note : prev.note, decidedAt: fields.decidedAt ? fields.decidedAt.stringValue : prev.decidedAt };
      if (cache) cache.decisions.set(d.id, next);
      recent.set(d.id, { next, t: now() });
      return Object.assign({ id: d.id }, next);
    },
    // the number of accounts (profiles), counted at most every countTtlMs
    async accounts() {
      if (accounts != null && now() - accountsT < countTtlMs) return accounts;
      accounts = await store.count('profiles'); accountsT = now();
      return accounts;
    },
  };
}

// an in-memory store with raw Firestore documents (tests and local runs without a service account)
// seed: {chat: [{name, fields}], decisions: [{name, fields}], accounts}
export function createMemoryAdminStore(seed = {}) {
  const chat = Array.isArray(seed.chat) ? seed.chat : [];
  const dec = new Map();
  for (const d of Array.isArray(seed.decisions) ? seed.decisions : []) dec.set(String(d.name).split('/').pop(), d.fields || {});
  const calls = { query: 0, patch: 0, count: 0 };
  return {
    calls,
    async query(collectionId) {
      calls.query++;
      if (collectionId === FEEDBACK_COLLECTION || collectionId === 'chatlog') return chat;
      if (collectionId === COLLECTION) return [...dec].map(([id, fields]) => ({ name: 'projects/x/databases/(default)/documents/' + COLLECTION + '/' + id, fields }));
      return [];
    },
    async count() { calls.count++; return Number(seed.accounts) || 0; },
    async patch(docPath, fields) {
      calls.patch++;
      const id = docPath.split('/').pop();
      dec.set(id, Object.assign({}, dec.get(id) || {}, fields));
    },
  };
}
