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
// (2026-11-25) a screenshot attached to a line: users/{uid}/claudeshot/{same id} {img: JPEG data URL}; the line has
// shot: true. Read one at a time, only when asked (shot(id)), never with the list.
export const SHOT_COLLECTION = 'claudeshot';
export const shotPath = (docName) => { const m = /(users\/[^/]+)\/claude\/([^/]+)$/.exec(String(docName)); return m ? m[1] + '/' + SHOT_COLLECTION + '/' + m[2] : null; };
export const lineId = (docName) => feedbackId(String(docName).replace(/\/claude\/([^/]+)$/, '/chatlog/$1'));

// a Firestore REST value -> plain
export const val = (v) => (!v ? null : 'booleanValue' in v ? v.booleanValue : 'stringValue' in v ? v.stringValue : 'timestampValue' in v ? v.timestampValue : 'integerValue' in v ? +v.integerValue : 'doubleValue' in v ? v.doubleValue : null);

// raw chatlog documents -> the @claude lines, newest first (exactly what aevum-admin/sync.mjs computed)
export function feedbackRows(docs) {
  return (docs || []).map((d) => {
    const f = d.fields || {};
    const r = { id: lineId(d.name), at: String(val(f.at) || val(f.t) || ''), room: String(val(f.room) || ''), name: String(val(f.name) || '?'), text: String(val(f.text) || '') };
    if (val(f.shot) === true && shotPath(d.name)) r.shot = true;
    return r;
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

// ---- Fikirler (owner 2026-11-25: "pratik olsun, aynı sayfada"): the owner's own idea list, adminIdeas/{id}
// {title, body, pinned, status: 'open'|'done', at, from?, fromName?}. Written only by this server and
// tools/read-admin.mjs; read with one list query when the page loads (they are few), never polled.
export const IDEAS = 'adminIdeas';
export const IDEA_RE = /^i[0-9a-f]{16}$/;
export const IDEA_STATUSES = ['open', 'done'];
export const TITLE_MAX = 200, BODY_MAX = 4000;
const clean1 = (s) => String(s).replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
const cleanBody = (s) => String(s).replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, ' ').trim();
export function ideaRows(docs) {
  return (docs || []).map((d) => {
    const id = String(d.name || '').split('/').pop(), f = d.fields || {};
    if (!IDEA_RE.test(id)) return null;
    const r = { id, title: String(val(f.title) || ''), body: String(val(f.body) || ''), pinned: val(f.pinned) === true, status: val(f.status) === 'done' ? 'done' : 'open', at: String(val(f.at) || '') };
    if (val(f.from)) r.from = String(val(f.from));
    if (val(f.fromName)) r.fromName = String(val(f.fromName));
    return r;
  }).filter(Boolean).sort((a, b) => (a.pinned !== b.pinned ? (a.pinned ? -1 : 1) : a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}
// an idea request -> {op:'add', title, body, pinned, from?, fromName?} | {op:'update', id, title?, body?, pinned?, status?} | {op:'delete', id} | {error}
export function cleanIdea(b) {
  if (!b || typeof b !== 'object') return { error: 'bad json' };
  const op = b.op;
  const str = (k, max, fn) => { if (b[k] === undefined) return undefined; if (typeof b[k] !== 'string' || b[k].length > max) return null; return fn(b[k]); };
  if (op === 'add') {
    const title = str('title', TITLE_MAX, clean1), body = str('body', BODY_MAX, cleanBody);
    if (!title) return { error: 'bad title' };
    if (body === null) return { error: 'bad body' };
    const out = { op, title, body: body || '', pinned: b.pinned === true };
    if (b.from !== undefined) { if (!ID_RE.test(String(b.from))) return { error: 'bad from' }; out.from = b.from; }
    if (b.fromName !== undefined) { const n = str('fromName', 60, clean1); if (n === null) return { error: 'bad from' }; if (n) out.fromName = n; }
    return out;
  }
  if (op !== 'update' && op !== 'delete') return { error: 'bad op' };
  if (!IDEA_RE.test(String(b.id))) return { error: 'bad id' };
  if (op === 'delete') return { op, id: b.id };
  const out = { op, id: b.id };
  if (b.title !== undefined) { const t = str('title', TITLE_MAX, clean1); if (!t) return { error: 'bad title' }; out.title = t; }
  if (b.body !== undefined) { const t = str('body', BODY_MAX, cleanBody); if (t === null) return { error: 'bad body' }; out.body = t; }
  if (b.pinned !== undefined) { if (typeof b.pinned !== 'boolean') return { error: 'bad pinned' }; out.pinned = b.pinned; }
  if (b.status !== undefined) { if (!IDEA_STATUSES.includes(b.status)) return { error: 'bad status' }; out.status = b.status; }
  if (Object.keys(out).length === 2) return { error: 'nothing to change' };
  return out;
}
const ideaFields = (o) => {
  const f = {};
  for (const k of ['title', 'body', 'status', 'at', 'from', 'fromName']) if (o[k] !== undefined) f[k] = { stringValue: o[k] };
  if (o.pinned !== undefined) f.pinned = { booleanValue: o.pinned };
  return f;
};

// store: {query(collectionId, opts), count(collectionId), patch(docPath, fields), remove(docPath)}
// ttlMs: how long one Firestore read of the lines is reused (keeps reads cheap: the page may be reloaded often; a
// decision made here updates the cache at once). The decisions are read once (they are written here) and again only
// with fresh (the page's Yenile button), which reads the lines again too.
export function createAdmin({ store, now = () => Date.now(), ttlMs = 10 * 60000, countTtlMs = 10 * 60000 } = {}) {
  let cache = null, cacheT = 0, loading = null;   // {rows, decisions}
  const recent = new Map();   // id -> {next, t}: decisions made here lately (a read already under way may predate them)
  let accounts = null, accountsT = 0;
  async function load(fresh = false) {
    if (!fresh && cache && now() - cacheT < ttlMs && now() >= cacheT) return cache;
    if (!loading) {
      const old = !fresh && cache ? cache.decisions : null;
      loading = (async () => {
        const t0 = now();
        const [chat, dec] = await Promise.all([
          store.query(FEEDBACK_COLLECTION, { allDescendants: true, fields: ['at', 't', 'room', 'name', 'text', 'shot'] }),
          old ? null : store.query(COLLECTION),
        ]);
        const shots = new Map();
        for (const d of chat || []) { const p = shotPath(d.name); if (p && val((d.fields || {}).shot) === true) shots.set(lineId(d.name), p); }
        cache = { rows: feedbackRows(chat), decisions: old || decisionMap(dec), shots };
        for (const [id, w] of recent) { if (w.t >= t0) cache.decisions.set(id, w.next); else recent.delete(id); }
        cacheT = now();
        return cache;
      })().finally(() => { loading = null; });
    }
    return loading;
  }
  return {
    // -> {at, items: [{id, at, room, name, text, status, note, decidedAt}]} newest first
    async feedback(opts = {}) {
      const c = await load(!!(opts && opts.fresh));
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
    // the screenshot of a line (one document read) -> a JPEG data URL, or null (no such line / no screenshot)
    async shot(id) {
      if (!ID_RE.test(String(id))) return null;
      const c = await load(false);
      const p = c.shots && c.shots.get(id);
      if (!p) return null;
      const d = await store.doc(p);
      const img = d && d.fields ? val(d.fields.img) : null;
      return typeof img === 'string' && /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(img) ? img : null;
    },
    // Fikirler: one list query per call (the page calls it once per load), pinned first, then newest
    async ideas() { return { items: ideaRows(await store.query(IDEAS)) }; },
    // d: a cleanIdea result -> the idea after it ({id, deleted: true} for a delete)
    async idea(d) {
      if (d.op === 'delete') { await store.remove(IDEAS + '/' + d.id); return { id: d.id, deleted: true }; }
      if (d.op === 'add') {
        const id = 'i' + crypto.randomBytes(8).toString('hex');
        const o = { title: d.title, body: d.body, pinned: d.pinned, status: 'open', at: new Date(now()).toISOString() };
        if (d.from) o.from = d.from;
        if (d.fromName) o.fromName = d.fromName;
        await store.patch(IDEAS + '/' + id, ideaFields(o));
        return Object.assign({ id }, o);
      }
      const ch = {}; for (const k of ['title', 'body', 'pinned', 'status']) if (d[k] !== undefined) ch[k] = d[k];
      await store.patch(IDEAS + '/' + d.id, ideaFields(ch));
      const doc = await store.doc(IDEAS + '/' + d.id);
      return doc ? ideaRows([doc])[0] : Object.assign({ id: d.id }, ch);
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
  const calls = { query: 0, patch: 0, count: 0, doc: 0 };
  const shots = new Map(Object.entries(seed.shots || {}));   // docPath -> img
  const ideas = new Map();   // id -> fields
  for (const d of Array.isArray(seed.ideas) ? seed.ideas : []) ideas.set(String(d.name).split('/').pop(), d.fields || {});
  calls.remove = 0;
  const ideaDoc = (id) => ({ name: 'projects/x/databases/(default)/documents/' + IDEAS + '/' + id, fields: ideas.get(id) });
  return {
    calls,
    async query(collectionId) {
      calls.query++;
      if (collectionId === FEEDBACK_COLLECTION || collectionId === 'chatlog') return chat;
      if (collectionId === IDEAS) return [...ideas.keys()].map(ideaDoc);
      if (collectionId === COLLECTION) return [...dec].map(([id, fields]) => ({ name: 'projects/x/databases/(default)/documents/' + COLLECTION + '/' + id, fields }));
      return [];
    },
    async doc(docPath) { calls.doc++; if (docPath.startsWith(IDEAS + '/')) { const id = docPath.split('/').pop(); return ideas.has(id) ? ideaDoc(id) : null; } return shots.has(docPath) ? { name: docPath, fields: { img: { stringValue: shots.get(docPath) } } } : null; },
    async count() { calls.count++; return Number(seed.accounts) || 0; },
    async patch(docPath, fields) {
      calls.patch++;
      const id = docPath.split('/').pop();
      if (docPath.startsWith(IDEAS + '/')) { ideas.set(id, Object.assign({}, ideas.get(id) || {}, fields)); return; }
      dec.set(id, Object.assign({}, dec.get(id) || {}, fields));
    },
    async remove(docPath) { calls.remove++; ideas.delete(docPath.split('/').pop()); },
  };
}
