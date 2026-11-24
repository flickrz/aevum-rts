// Aevum - transport over the local node server (Server-Sent Events down, POST up).
// After the first successful connect it never gives up: EventSource reconnects by itself, and when the stream is
// closed for good (server restarted, HTTP error) or goes silent (no heartbeat for 40 s) it is re-opened with backoff
// (0.4 s -> 3 s) under the SAME peer id, so the relay rebuilds the room and the match goes on.
import { PollTransport, backoff, identMixin } from './transport-poll.js';
import { tr } from '../i18n.js';
function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

export class SSETransport {
  constructor(base = '', opts = {}) {
    this.base = base;
    this._ticketFn = typeof opts.ticket === 'function' ? opts.ticket : null;
    this._ticket = ''; this._ids = new Map(); this.dup = false;
    this.id = rid();
    this.room = null;
    this.up = false;
    this._h = new Map();
    this._peerFns = [];
    this._statusFns = [];
    this._peers = new Set();
    this.es = null;
    this._run = false;
    this._fails = 0; this._retryT = null; this._wd = null; this._lastMsg = 0;
  }

  connect(roomCode) {
    this.room = String(roomCode).toUpperCase();
    this._run = true;
    return new Promise((resolve, reject) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; this.close(); reject(new Error(tr('Sunucuya bağlanılamadı (node server.js çalışıyor mu?).'))); } }, 6000);
      this._onHello = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
      this._open();
      this._wd = setInterval(() => {
        // a stream that stopped delivering (even heartbeats) is dead: re-open it
        if (this._run && this.es && Date.now() - this._lastMsg > 40000) { this._setUp(false); this._open(); }
      }, 5000);
    });
  }

  // (async with a ticket: a stream that keeps failing gets a fresh ticket first - the relay restarted / it expired)
  async _open() {
    if (!this._run) return;
    if (this.es) { try { this.es.close(); } catch { /* ignore */ } this.es = null; }
    if (this._ticketFn) { await this._tk(this._fails >= 2 || !this._ticket); if (!this._run) return; }
    const tk = this._ticket ? '&tk=' + encodeURIComponent(this._ticket) : '';
    const url = `${this.base}/mp/events?room=${encodeURIComponent(this.room)}&peer=${encodeURIComponent(this.id)}${tk}`;
    let es;
    try { es = new EventSource(url); } catch { this._retry(); return; }
    this.es = es; this._lastMsg = Date.now();
    es.onmessage = ev => {
      if (this.es !== es) return;
      this._lastMsg = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'hb') { this._setUp(true); return; }
      this._noteIds(m);
      if (m.type === 'dup') { this._dupStop(); try { es.close(); } catch { /* ignore */ } this.es = null; return; }
      if (m.type === 'hello') {
        const before = new Set(this._peers);
        this._peers = new Set((m.peers || []).filter(p => p !== this.id));
        const joined = [...this._peers].filter(p => !before.has(p)), left = [...before].filter(p => !this._peers.has(p));
        if (joined.length || left.length) this._emitPeers(joined, left);
        this._fails = 0;
        this._setUp(true);
        if (this._onHello) this._onHello();
      } else if (m.type === 'joined') {
        if (m.peer !== this.id && !this._peers.has(m.peer)) { this._peers.add(m.peer); this._emitPeers([m.peer], []); }
      } else if (m.type === 'left') {
        if (this._peers.delete(m.peer)) this._emitPeers([], [m.peer]);
      } else if (m.type === 'msg') {
        if (m.from === this.id) return;
        for (const fn of this._h.get(m.topic) || []) { try { fn(m.data, m.from, m.id || null); } catch (err) { console.error('[sse]', err); } }
      }
    };
    es.onerror = () => {
      if (this.es !== es) return;
      this._setUp(false);
      // CONNECTING (0): the browser retries by itself; CLOSED (2): it gave up (an HTTP error such as 401/409), we re-open
      if (es.readyState === 2) this._retry();
      else if (this._ticketFn) { this._fails++; if (this._fails >= 3) { try { es.close(); } catch { /* ignore */ } this._retry(); } }
    };
  }

  _retry() {
    if (!this._run || this._retryT) return;
    this._fails++;
    this._retryT = setTimeout(() => { this._retryT = null; this._open(); }, backoff(this._fails));
  }

  _setUp(up) {
    if (this.up === up) return;
    this.up = up;
    for (const fn of this._statusFns) { try { fn({ up }); } catch (err) { console.error('[sse]', err); } }
  }
  onStatus(fn) { this._statusFns.push(fn); }
  putBlob(text) { return PollTransport.prototype.putBlob.call(this, text); }
  getBlob(id) { return PollTransport.prototype.getBlob.call(this, id); }

  _emitPeers(joined, left) {
    const ch = { joined, left, peers: [...this._peers] };
    for (const fn of this._peerFns) { try { fn(ch); } catch (err) { console.error('[sse]', err); } }
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
  close() {
    this._run = false;
    clearTimeout(this._retryT); this._retryT = null; clearInterval(this._wd); this._wd = null;
    try { this.es && this.es.close(); } catch { /* ignore */ }
    this.es = null; this.room = null; this._peers.clear(); this.up = false;
  }
}
identMixin(SSETransport);
