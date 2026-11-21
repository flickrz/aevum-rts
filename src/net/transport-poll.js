// Aevum - transport over the node server using HTTP long-polling (GET /mp/poll down, POST /mp/send up).
// Used when the page is reached through a tunnel/proxy that does not pass Server-Sent Events.
// After the first successful connect it never gives up: when the relay goes away (restart, tunnel hiccup) it keeps
// polling with backoff (0.4 s -> 3 s) under the SAME peer id, so the relay rebuilds the room and the match goes on.
function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }
const sleep = ms => new Promise(r => setTimeout(r, ms));
export const backoff = n => Math.min(3000, Math.round(400 * Math.pow(1.6, Math.max(0, n - 1))));

// verified identity (shared with transport-sse.js): opts.ticket(fresh) -> Promise<relay ticket> (see server.js /mp/auth).
// The relay stamps the sender's verified identity {uid, name, av, tp} on every message; handlers get it as 3rd arg.
export function identMixin(T) {
  Object.assign(T.prototype, {
    async _tk(fresh) {
      if (!this._ticketFn) return '';
      try { this._ticket = (await this._ticketFn(!!fresh)) || ''; } catch (err) { console.warn('[net] ticket', err); }
      return this._ticket || '';
    },
    _hdr(extra) { return Object.assign({}, extra || {}, this._ticket ? { 'X-Aevum-Ticket': this._ticket } : {}); },
    _noteIds(m) {
      if (m.ids && typeof m.ids === 'object') for (const [p, id] of Object.entries(m.ids)) if (id) this._ids.set(p, id);
      if (m.type === 'joined' && m.id) this._ids.set(m.peer, m.id);
      // the room's host as the relay knows it (the peer that opened the room): a joiner takes lobby state only from him
      if (m.type === 'hello' && typeof m.host === 'string' && m.host) this.hostPeer = m.host;
      if (m.type === 'msg' && m.id && m.from) this._ids.set(m.from, m.id);
    },
    identOf(peer) { return this._ids.get(peer) || null; },
    _dupStop() {
      // the same account opened this room in another tab: that connection wins, this one stops for good
      if (this.dup) return;
      this.dup = true; this._run = false;
      for (const fn of this._statusFns) { try { fn({ up: false, dup: true }); } catch (err) { console.error('[net]', err); } }
    },
  });
  Object.defineProperty(T.prototype, 'verified', { get() { return !!this._ticketFn; } });
}


async function fetchT(url, opts, ms) {
  const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
  const to = ctl ? setTimeout(() => { try { ctl.abort(); } catch { /* ignore */ } }, ms) : null;
  try { return await fetch(url, Object.assign({}, opts, ctl ? { signal: ctl.signal } : {})); } finally { if (to) clearTimeout(to); }
}

export class PollTransport {
  constructor(base = '', opts = {}) {
    this.base = base;
    this._ticketFn = typeof opts.ticket === 'function' ? opts.ticket : null;
    this._ticket = ''; this._ids = new Map(); this.dup = false;
    this.id = rid();
    this.room = null;
    this.up = false;              // relay reachable (last poll answered)
    this._h = new Map();
    this._peerFns = [];
    this._statusFns = [];
    this._peers = new Set();
    this._run = false;
    this._onHello = null;
  }

  connect(roomCode) {
    this.room = String(roomCode).toUpperCase();
    this._run = true;
    return new Promise((resolve, reject) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; this._run = false; this.room = null; reject(new Error('Sunucuya bağlanılamadı (oyunu açan kişinin penceresi açık mı?).')); } }, 9000);
      this._onHello = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
      this._loopStart();
    });
  }

  async _loopStart() { if (this._ticketFn) await this._tk(false); this._loop(); }
  async _loop() {
    const room = this.room;
    let fails = 0;
    while (this._run && this.room === room) {
      try {
        const tk = this._ticket ? '&tk=' + encodeURIComponent(this._ticket) : '';
        const r = await fetchT(`${this.base}/mp/poll?room=${encodeURIComponent(room)}&peer=${encodeURIComponent(this.id)}${tk}&t=${Date.now()}`, { cache: 'no-store' }, 32000);
        if (r.status === 409) { this._dupStop(); break; }
        if (r.status === 401 || r.status === 403) { await this._tk(true); throw new Error('poll ' + r.status); }
        if (!r.ok) throw new Error('poll ' + r.status);
        const arr = await r.json();
        if (!this._run || this.room !== room) break;
        fails = 0;
        if (Array.isArray(arr)) for (const m of arr) this._handle(m);
        this._setUp(true);
      } catch {
        if (!this._run || this.room !== room) break;
        fails++;
        this._setUp(false);
        await sleep(backoff(fails));
      }
    }
  }

  _setUp(up) {
    if (this.up === up) return;
    this.up = up;
    for (const fn of this._statusFns) { try { fn({ up }); } catch (err) { console.error('[poll]', err); } }
  }
  onStatus(fn) { this._statusFns.push(fn); }

  async putBlob(text) {
    let last = null;
    for (let i = 1; i <= 5; i++) {
      try {
        const r = await fetchT(`${this.base}/mp/blob?room=${encodeURIComponent(this.room)}&peer=${encodeURIComponent(this.id)}`, { method: 'POST', headers: this._hdr({ 'Content-Type': 'application/octet-stream' }), body: text }, 60000);
        if (r.status === 413) throw Object.assign(new Error('Kayıt çok büyük (en fazla 32 MB).'), { fatal: true });
        if (!r.ok) throw new Error('blob ' + r.status);
        const j = await r.json(); if (j && j.id) return j.id;
        throw new Error('blob: no id');
      } catch (err) { last = err; if (err.fatal) throw err; await sleep(backoff(i)); }
    }
    throw new Error('Kayıt sunucuya yüklenemedi: ' + (last && last.message || last));
  }
  async getBlob(id) {
    let last = null;
    for (let i = 1; i <= 6; i++) {
      try {
        const r = await fetchT(`${this.base}/mp/blob?room=${encodeURIComponent(this.room)}&peer=${encodeURIComponent(this.id)}&id=${encodeURIComponent(id)}&t=${Date.now()}`, { cache: 'no-store', headers: this._hdr() }, 60000);
        if (r.status === 404) throw Object.assign(new Error('Kayıt sunucuda bulunamadı (süresi dolmuş olabilir).'), { fatal: i >= 3 });
        if (!r.ok) throw new Error('blob ' + r.status);
        return await r.text();
      } catch (err) { last = err; if (err.fatal) throw err; await sleep(backoff(i)); }
    }
    throw new Error('Kayıt indirilemedi: ' + (last && last.message || last));
  }

  _handle(m) {
    if (!m || typeof m !== 'object') return;
    this._noteIds(m);
    if (m.type === 'dup') { this._dupStop(); return; }
    if (m.type === 'hello') {
      const before = new Set(this._peers);
      this._peers = new Set((m.peers || []).filter(p => p !== this.id));
      const joined = [...this._peers].filter(p => !before.has(p)), left = [...before].filter(p => !this._peers.has(p));
      if (joined.length || left.length) this._emitPeers(joined, left);
      if (this._onHello) this._onHello();
    } else if (m.type === 'joined') {
      if (m.peer !== this.id && !this._peers.has(m.peer)) { this._peers.add(m.peer); this._emitPeers([m.peer], []); }
    } else if (m.type === 'left') {
      if (this._peers.delete(m.peer)) this._emitPeers([], [m.peer]);
    } else if (m.type === 'msg') {
      if (m.from === this.id) return;
      for (const fn of this._h.get(m.topic) || []) { try { fn(m.data, m.from, m.id || null); } catch (err) { console.error('[poll]', err); } }
    }
  }

  _emitPeers(joined, left) {
    const ch = { joined, left, peers: [...this._peers] };
    for (const fn of this._peerFns) { try { fn(ch); } catch (err) { console.error('[poll]', err); } }
  }

  send(topic, data) {
    if (!this.room) return;
    const body = JSON.stringify({ topic, data });
    fetch(`${this.base}/mp/send?room=${encodeURIComponent(this.room)}&peer=${encodeURIComponent(this.id)}`, {
      method: 'POST', headers: this._hdr({ 'Content-Type': 'application/json' }), body, keepalive: body.length < 60000,
    }).then(r => { if (r && r.status === 401 && this._ticketFn) this._tk(true); }).catch(() => { /* dropped; lockstep re-requests */ });
  }

  on(topic, fn) { if (!this._h.has(topic)) this._h.set(topic, []); this._h.get(topic).push(fn); }
  peers() { return [...this._peers]; }
  onPeers(fn) { this._peerFns.push(fn); }
  close() { this._run = false; this.room = null; this._peers.clear(); this.up = false; }
}
identMixin(PollTransport);
