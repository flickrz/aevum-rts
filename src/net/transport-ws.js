// Aevum - transport over the node server using one WebSocket (GET /mp/ws upgrade) both ways.
// Lowest latency of the node transports: a turn packet is one hop to the relay and one hop on, with no POST per
// message and no long-poll gap. After the first successful connect it never gives up: a closed or silent socket
// (no heartbeat for 40 s) is re-opened with backoff (0.4 s -> 3 s) under the SAME peer id, so the relay rebuilds the
// room and the match goes on.
import { PollTransport, backoff, identMixin } from './transport-poll.js';
import { tr } from '../i18n.js';
function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

function wsUrl(base, path) {
  if (/^wss?:/.test(base)) return base + path;
  if (/^https?:/.test(base)) return base.replace(/^http/, 'ws') + path;
  const loc = typeof location !== 'undefined' ? location : null;
  return (loc && loc.protocol === 'https:' ? 'wss://' : 'ws://') + (loc ? loc.host : 'localhost') + base + path;
}

function wsProbeOnce(base, ms) {
  return new Promise((resolve) => {
    if (typeof WebSocket === 'undefined') { resolve(false); return; }
    let ws, done = false;
    const fin = (ok) => { if (done) return; done = true; clearTimeout(to); try { ws && ws.close(); } catch { /* ignore */ } resolve(ok); };
    const to = setTimeout(() => fin(false), ms);
    try { ws = new WebSocket(wsUrl(base, '/mp/ws?probe=1')); } catch { fin(false); return; }
    ws.onmessage = (ev) => { let m = null; try { m = JSON.parse(ev.data); } catch { /* ignore */ } fin(!!m && m.type === 'probe'); };
    ws.onerror = () => fin(false);
    ws.onclose = () => fin(false);
  });
}

// do WebSockets reach the relay from here (some proxies / tunnels do not pass them)? -> true / false within `ms`
export async function wsProbe(base = '', ms = 5000, retries = 1) {
  for (let i = 0; i <= retries; i++) {
    if (await wsProbeOnce(base, ms)) return true;
    if (i < retries) await new Promise(r => setTimeout(r, 300));
  }
  return false;
}

export class WSTransport {
  constructor(base = '', opts = {}) {
    this.base = base;
    this._ticketFn = typeof opts.ticket === 'function' ? opts.ticket : null;
    this._ticket = ''; this._ids = new Map(); this.dup = false;
    this.id = rid();
    this.room = null;
    this.up = false;
    this.kind = 'ws';
    this.reliable = true;
    this.srvRtt = null;
    this._h = new Map();
    this._peerFns = [];
    this._statusFns = [];
    this._peers = new Set();
    this.ws = null;
    this._run = false;
    this._fails = 0; this._retryT = null; this._wd = null; this._pingT = null; this._lastMsg = 0;
  }

  connect(roomCode) {
    this.room = String(roomCode).toUpperCase();
    this._run = true;
    return new Promise((resolve, reject) => {
      let done = false;
      const to = setTimeout(() => { if (!done) { done = true; this.close(); reject(new Error(tr('Sunucuya bağlanılamadı (oyunu açan kişinin penceresi açık mı?).'))); } }, 9000);
      this._onHello = () => { if (!done) { done = true; clearTimeout(to); resolve(); } };
      this._open();
      this._wd = setInterval(() => {
        // a socket that stopped delivering (even heartbeats) is dead: re-open it
        if (this._run && this.ws && Date.now() - this._lastMsg > 40000) { this._setUp(false); this._open(); }
      }, 5000);
      this._pingT = setInterval(() => this._sendPing(), 2000);
    });
  }

  _sendPing() {
    const ws = this.ws;
    if (!this._run || !ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify({ type: 'ping', t: Date.now() })); } catch { /* ignore */ }
  }

  async _open() {
    if (!this._run) return;
    if (this.ws) { const o = this.ws; this.ws = null; try { o.close(); } catch { /* ignore */ } }
    if (this._ticketFn) { await this._tk(this._fails >= 2 || !this._ticket); if (!this._run) return; }
    const tk = this._ticket ? '&tk=' + encodeURIComponent(this._ticket) : '';
    let ws;
    try { ws = new WebSocket(wsUrl(this.base, `/mp/ws?room=${encodeURIComponent(this.room)}&peer=${encodeURIComponent(this.id)}${tk}`)); } catch { this._retry(); return; }
    this.ws = ws; this._lastMsg = Date.now();
    ws.onmessage = (ev) => {
      if (this.ws !== ws) return;
      this._lastMsg = Date.now();
      let m; try { m = JSON.parse(ev.data); } catch { return; }
      if (!m || typeof m !== 'object') return;
      if (m.type === 'hb') { this._setUp(true); return; }
      if (m.type === 'pong') {
        if (typeof m.t === 'number') {
          const rtt = Date.now() - m.t;
          if (rtt >= 0 && rtt < 30000) this.srvRtt = this.srvRtt == null ? rtt : this.srvRtt * 0.7 + rtt * 0.3;
        }
        return;
      }
      if (m.type === 'err') { if (m.code === 401 || m.code === 403) this._fails = Math.max(this._fails, 2); return; }   // (next open fetches a fresh ticket)
      this._noteIds(m);
      if (m.type === 'dup') { this._dupStop(); this.ws = null; try { ws.close(); } catch { /* ignore */ } return; }
      if (m.type === 'hello') {
        const before = new Set(this._peers);
        this._peers = new Set((m.peers || []).filter(p => p !== this.id));
        const joined = [...this._peers].filter(p => !before.has(p)), left = [...before].filter(p => !this._peers.has(p));
        if (joined.length || left.length) this._emitPeers(joined, left);
        this._fails = 0;
        this._setUp(true);
        this._sendPing();
        if (this._onHello) this._onHello();
      } else if (m.type === 'joined') {
        if (m.peer !== this.id && !this._peers.has(m.peer)) { this._peers.add(m.peer); this._emitPeers([m.peer], []); }
      } else if (m.type === 'left') {
        if (this._peers.delete(m.peer)) this._emitPeers([], [m.peer]);
      } else if (m.type === 'msg') {
        if (m.from === this.id) return;
        for (const fn of this._h.get(m.topic) || []) { try { fn(m.data, m.from, m.id || null); } catch (err) { console.error('[ws]', err); } }
      }
    };
    ws.onclose = () => {
      if (this.ws !== ws) return;
      this.ws = null;
      this._setUp(false);
      this._retry();
    };
    ws.onerror = () => { /* onclose follows */ };
  }

  _retry() {
    if (!this._run || this._retryT || this.dup) return;
    this._fails++;
    this._retryT = setTimeout(() => { this._retryT = null; this._open(); }, backoff(this._fails));
  }

  _setUp(up) {
    if (this.up === up) return;
    this.up = up;
    for (const fn of this._statusFns) { try { fn({ up }); } catch (err) { console.error('[ws]', err); } }
  }
  onStatus(fn) { this._statusFns.push(fn); }
  putBlob(text) { return PollTransport.prototype.putBlob.call(this, text); }
  getBlob(id) { return PollTransport.prototype.getBlob.call(this, id); }

  _emitPeers(joined, left) {
    const ch = { joined, left, peers: [...this._peers] };
    for (const fn of this._peerFns) { try { fn(ch); } catch (err) { console.error('[ws]', err); } }
  }

  // (while the socket is down a message is dropped: the lockstep re-sends / re-requests, the lobby re-broadcasts)
  send(topic, data) {
    if (!this.room) return;
    const ws = this.ws;
    if (!ws || ws.readyState !== 1) return;
    try { ws.send(JSON.stringify({ topic, data })); } catch { /* dropped */ }
  }

  on(topic, fn) { if (!this._h.has(topic)) this._h.set(topic, []); this._h.get(topic).push(fn); }
  peers() { return [...this._peers]; }
  onPeers(fn) { this._peerFns.push(fn); }
  close() {
    this._run = false;
    clearTimeout(this._retryT); this._retryT = null; clearInterval(this._wd); this._wd = null;
    clearInterval(this._pingT); this._pingT = null;
    const ws = this.ws; this.ws = null;
    try { ws && ws.close(); } catch { /* ignore */ }
    this.room = null; this._peers.clear(); this.up = false;
  }
}
identMixin(WSTransport);
