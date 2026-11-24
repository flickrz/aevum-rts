import { tr } from '../i18n.js';
// Aevum - transport over the Claude artifact runtime "room" capability.
// Our own peer id travels inside every message ({f, d}), so we never depend on the runtime's id format.
function rid() { return Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4); }

export class RoomTransport {
  constructor() {
    this.id = rid();
    this._h = new Map();
    this._peerFns = [];
    this._peers = new Map();        // our id -> runtime peer id
    this._rt = new Map();           // runtime peer id -> our id
    this.r = null;
    this._room = null;
    this.up = true;                 // no relay status from this runtime: assume reachable
    this.noBlob = tr('Kayıtlı maça devam etmek bu bağlantı türünde desteklenmiyor: oyunu node server.js ile (baslat.bat / baslat-online.bat) açın.');
  }

  async available() {
    try { this._room = await (typeof window !== 'undefined' && window.claude && window.claude.use ? window.claude.use('room') : null); }
    catch { this._room = null; }
    return !!this._room;
  }

  async connect(roomCode) {
    if (!this._room && !(await this.available())) throw new Error(tr('Oda servisi kullanılamıyor.'));
    this.r = await this._room.join('aevum-' + String(roomCode).toLowerCase());
    this.r.onPeers(change => {
      const left = [];
      for (const p of (change && change.left) || []) {
        const rp = p && (p.peer || p);
        const ours = this._rt.get(rp);
        if (ours != null) { this._rt.delete(rp); this._peers.delete(ours); left.push(ours); }
      }
      if (left.length) this._emitPeers([], left);
    });
    for (const topic of ['lobby', 'turn', 'sync', 'chat', 'ping']) {
      this.r.on(topic, msg => {
        if (!msg || msg.sameTab) return;
        const w = msg.data; if (!w || typeof w.f !== 'string' || w.f === this.id) return;
        // our ids are stable; the runtime's may change after a reconnect: keep the mapping current
        const cur = this._peers.get(w.f);
        if (cur !== msg.peer) {
          if (cur != null) this._rt.delete(cur);
          this._peers.set(w.f, msg.peer); this._rt.set(msg.peer, w.f);
          if (cur == null) this._emitPeers([w.f], []);
        }
        if (topic === 'ping') return;
        for (const fn of this._h.get(topic) || []) { try { fn(w.d, w.f); } catch (err) { console.error('[room]', err); } }
      });
    }
    try { this.r.emit('ping', { f: this.id, d: 0 }); } catch { /* ignore */ }
  }

  _emitPeers(joined, left) {
    const ch = { joined, left, peers: [...this._peers.keys()] };
    for (const fn of this._peerFns) { try { fn(ch); } catch (err) { console.error('[room]', err); } }
  }

  send(topic, data) { if (!this.r) return; try { this.r.emit(topic, { f: this.id, d: data }); } catch { /* dropped */ } }
  on(topic, fn) { if (!this._h.has(topic)) this._h.set(topic, []); this._h.get(topic).push(fn); }
  peers() { return [...this._peers.keys()]; }
  onPeers(fn) { this._peerFns.push(fn); }
  close() { try { this.r && this.r.leave && this.r.leave(); } catch { /* ignore */ } try { this.r && this.r.close && this.r.close(); } catch { /* ignore */ } this.r = null; this._peers.clear(); this._rt.clear(); }
}
