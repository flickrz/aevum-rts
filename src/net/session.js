import { logChat } from '../chatlog.js';
import { hashParts } from './hashparts.js';
// Aevum - multiplayer session: lobby + deterministic lockstep over an abstract transport.
// Transport: { id, async connect(room), send(topic, data), on(topic, fn(data, from, ident)), peers(), onPeers(fn), close() }
// A transport with `verified` (the node relay with tickets) hands every message the sender's identity as the relay
// verified it ({uid, name, av, tp}, see srv/identity.mjs): the lobby then takes uids and names ONLY from there, never
// from the message body, so nobody can sit in another player's slot or play under a name that is not his account's.

export const STEP = 1 / 30;
export const TURN_TICKS = 3;          // 100 ms per turn
export const DELAY = 3;               // commands of turn T execute at turn T+DELAY (the minimum; see _wantDelay)
export const MAX_DELAY = 12;          // adaptive input delay: at most 1.2 s
const PING_MS = 1000;                 // game: peer round-trip pings (through the relay) and pacing info
const SLOW = 0.95;                    // pacing: a client ahead of the others runs at this speed until they line up
export const REDUNDANCY = 4;          // each packet repeats the previous 4 turns
export const HASH_EVERY = 30;         // turns
export const MAX_CMDS = 40;
export const MAX_MSG = 3500;
export const MAX_PLAYERS = 8;
// map types the lobby may pick ('random' is resolved from the seed inside the simulation, identically on every client)
export const MAP_TYPES = ['random', 'river', 'continent', 'highlands', 'plains', 'inlandsea', 'islands'];
// map climates: view only (the renderer's colours), never read by the simulation
export const CLIMATES = ['random', 'temperate', 'spring', 'autumn', 'winter', 'arid'];
// a human is dropped only after this much silence WHILE the relay is reachable and other traffic flows
// (a relay outage stalls everybody and drops nobody)
export const DROP_SILENT_MS = 60000;
export const DROP_LEFT_MS = 3000;     // after an explicit 'bye'
export const KEEP_TURNS = 600;        // command lists kept for re-sends (~60 s)
// a peer that keeps talking (pings, keep-alives) but holds back his command lists is dropped after this much
// waiting for him alone (net: a short wait now and then is paid back twice as fast while his lists flow)
export const DROP_STALL_MS = 90000;
// ...counted only while his own turns make no progress for this long
export const STALL_NOPROG_MS = 3000;
// an honest list is at most our own scheduled lists (MAX_DELAY) + the sender's delay ahead of our turn; REDUNDANCY on
// top is slack. Lists further ahead are not stored (one dropped by mistake is fetched again through 'need')
export const MAX_AHEAD = 2 * MAX_DELAY + REDUNDANCY;
export const LOBBY_GONE_MS = 8000;    // lobby: a peer the relay reports gone is removed only if it stays gone this long
export const METHODS = ['cmdMove', 'cmdAttack', 'cmdGather', 'cmdBuild', 'cmdStop', 'cmdExplore', 'cmdBoard', 'cmdUnload',
  'cmdReturn', 'placeBuilding', 'placeLine', 'train', 'research', 'ageUp', 'cancelQueue', 'setRally', 'trade', 'deleteEntity', 'cmdOpenGate', 'cmdTribute', 'cmdGroup', 'cmdStance', 'cmdFormation', 'cmdAttackMove', 'cmdPatrol', 'cmdRotateBuilding'];
// session-level commands: travel and execute in lockstep like game commands, but are handled by the session
export const SESSION_CMDS = ['@save', '@pause'];
const METHOD_SET = new Set(METHODS);
const SESSION_SET = new Set(SESSION_CMDS);
const LOCKSTEP_SET = new Set([...METHODS, ...SESSION_CMDS]);
// FNV-1a over a string (save bytes check)
export function strHash32(s) { let h = 2166136261 >>> 0; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } return h >>> 0; }
const CODE_CHARS = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const realClock = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setInterval: (f, ms) => setInterval(f, ms),
  clearInterval: h => clearInterval(h),
};

// profile identity (see src/profile.js): 128-bit lowercase hex. Validated whenever it comes off the wire.
// It is lobby / save metadata only: never part of the Game cfg built by cfgFrom (the simulation never sees it).
const UID_RE = /^[0-9a-f]{32}$/;
export const cleanUid = u => (typeof u === 'string' && UID_RE.test(u) ? u : null);
const cleanAv = a => (typeof a === 'string' && /^[a-z0-9-]{1,24}$/.test(a) ? a : null);
const cleanTp = t => (Number.isInteger(t) && t >= 0 && t < 1e7 ? t : null);

// the build id of this tab (the server's /mp/notice ver, src/net/notice.js): a host refuses joiners on another build
export const VER_TEXT = 'Oyun sürümün farklı. Sayfayı yenileyip tekrar katıl.';
export const HOST_OLD_TEXT = 'Odayı kuranın oyunu eski sürümde: kurucu sayfayı yenileyip odayı yeniden açmalı.';
const cleanVer = v => (typeof v === 'string' && /^[A-Za-z0-9._-]{1,40}$/.test(v) ? v : null);

// the host's lobby state / start message as a guest takes it: slot names short strings, teams 1-8, settings one of the
// lobby's choices (or dropped), numbers integers. In place, and a no-op on what an honest host sends (every client
// builds its Game cfg from the same start message). false: not usable at all (ignored).
const START_RES = ['low', 'normal', 'high'], FOGS = ['explored', 'dark'], DIFFS = ['easy', 'normal', 'hard'], MODES = ['idle', 'play', 'ai'];
const isObj = o => !!o && typeof o === 'object' && !Array.isArray(o);
const SETTING_OK = {
  mapSize: v => Number.isInteger(v) && v >= 32 && v <= 1024, mapType: v => MAP_TYPES.includes(v), climate: v => CLIMATES.includes(v),
  startRes: v => START_RES.includes(v), startAge: v => Number.isInteger(v) && v >= 0 && v <= 4, fog: v => FOGS.includes(v), seed: Number.isInteger,
};
const peerOk = p => p == null || (typeof p === 'string' && p.length <= 64);
function cleanLobby(st) {
  if (!isObj(st) || !isObj(st.settings) || !Array.isArray(st.slots) || !st.slots.length || st.slots.length > MAX_PLAYERS) return false;
  if (!st.slots.every(s => isObj(s) && (s.kind === 'human' || s.kind === 'ai') && peerOk(s.peer))) return false;
  if (st.waiting != null && !(Array.isArray(st.waiting) && st.waiting.length <= MAX_PLAYERS && st.waiting.every(w => isObj(w) && peerOk(w.peer)))) return false;
  if (st.resume != null && typeof st.resume !== 'boolean' && !isObj(st.resume)) return false;   // (true in a start message)
  if (st.listed != null) st.listed = st.listed !== false;
  for (const s of st.slots) {
    if (s.name != null) s.name = String(s.name).slice(0, 20);
    if (!Number.isInteger(s.team) || s.team < 1 || s.team > MAX_PLAYERS) s.team = Math.max(1, Math.min(4, s.team | 0));
    if (s.difficulty != null && !DIFFS.includes(s.difficulty)) delete s.difficulty;
    if (s.mode != null && !MODES.includes(s.mode)) delete s.mode;
    for (const k of ['uid', 'savedUid']) if (s[k] != null) s[k] = cleanUid(s[k]);
    if (s.av != null) s.av = cleanAv(s.av);
    if (s.tp != null) s.tp = cleanTp(s.tp);
  }
  for (const w of st.waiting || []) { if (w.name != null) w.name = String(w.name).slice(0, 20); if (w.uid != null) w.uid = cleanUid(w.uid); }
  for (const k in SETTING_OK) if (st.settings[k] != null && !SETTING_OK[k](st.settings[k])) delete st.settings[k];
  if (isObj(st.resume)) { st.resume.name = String(st.resume.name ?? '').slice(0, 120); st.resume.tick = st.resume.tick | 0; }
  if (st.seed != null && !Number.isInteger(st.seed)) st.seed = st.seed | 0;
  return true;
}

function randCode() { let s = ''; for (let i = 0; i < 5; i++) s += CODE_CHARS[(Math.random() * CODE_CHARS.length) | 0]; return s; }
const jsonLen = o => JSON.stringify(o).length;

export class NetSession {
  constructor(transport, opts = {}) {
    this.t = transport;
    this.clock = opts.clock || realClock;
    this.name = (opts.name || 'Oyuncu').slice(0, 20);
    this.uid = cleanUid(opts.uid);
    this.ver = cleanVer(opts.ver);   // null: no check (an old client, or the server never answered)
    // our own verified identity (from the relay ticket): name and uid come from the account
    this.ident = opts.ident || null;
    if (this.ident) { this.name = String(this.ident.name || this.name).slice(0, 20); this.uid = cleanUid(this.ident.uid) || this.uid; }
    this.isHost = false;
    this.state = null;           // lobby state
    this.phase = 'idle';         // idle | lobby | game | closed
    this._h = {};
    this._timers = [];
    this._log = opts.log ? [] : null;
    this._startAcks = new Set();
    this._wired = false;
    this._lobbyGone = new Map();  // lobby: peer -> time the relay reported it gone
    this._saveSeq = 0; this._saveH = new Map();
    this.resumeData = null;       // continue: the loaded save object, handed to the app with 'start'
  }

  // relay reachable? (transports without a status are assumed up)
  get relayUp() { return this.t.up !== false; }
  // identities come from the relay (not from the messages themselves)
  get verified() { return !!this.t.verified; }
  // the identity of `from` for a lobby message: the relay's stamp (verified transports) or the message body (others)
  _who(d, from, ident) {
    if (this.verified) {
      const id = ident || (typeof this.t.identOf === 'function' ? this.t.identOf(from) : null);
      if (!id || !cleanUid(id.uid)) return null;
      return { uid: cleanUid(id.uid), name: String(id.name || 'Oyuncu').slice(0, 20), av: cleanAv(id.av), tp: cleanTp(id.tp) };
    }
    return { uid: cleanUid(d && d.uid), name: String((d && d.name) || 'Oyuncu').slice(0, 20), av: null, tp: null };
  }
  // a client checks the host's slot list against what the relay verified (uid, avatar, TP of every connected human)
  _verifySlots(slots) {
    if (!this.verified || !Array.isArray(slots) || typeof this.t.identOf !== 'function') return;
    for (const s of slots) {
      if (!s || s.kind !== 'human' || !s.peer) continue;
      const id = s.peer === this.t.id ? this.ident : this.t.identOf(s.peer);
      if (!id) continue;
      s.uid = cleanUid(id.uid); s.av = cleanAv(id.av); s.tp = cleanTp(id.tp);
    }
  }

  static async create(kind = 'auto', opts = {}) {
    let transport = null;
    const tryRoom = async () => {
      const m = await import('./transport-room.js');
      const t = new m.RoomTransport();
      return (await t.available()) ? t : null;
    };
    const topts = opts.ticket ? { ticket: opts.ticket } : {};
    const sse = async () => { const m = await import('./transport-sse.js'); return new m.SSETransport('', topts); };
    const poll = async () => { const m = await import('./transport-poll.js'); return new m.PollTransport('', topts); };
    const ws = async () => { const m = await import('./transport-ws.js'); return new m.WSTransport('', topts); };
    if (kind === 'sse') transport = await sse();
    else if (kind === 'poll') transport = await poll();
    else if (kind === 'ws') transport = await ws();
    else if (kind === 'room') transport = await tryRoom();
    // WebSocket first (one hop each way, the smoothest lockstep); if it does not pass, the HTTP transports below
    else if (typeof location !== 'undefined' && /^https?:/.test(location.protocol) && await import('./transport-ws.js').then(m => m.wsProbe('', 2500)).catch(() => false)) transport = await ws();
    else {
      const loc = typeof location !== 'undefined' ? location : null;
      const h = loc ? loc.hostname : '';
      const lan = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|\[?::1\]?$)/.test(h) || h.endsWith('.local');
      let ok = lan;
      if (!ok && loc && /^https?:/.test(loc.protocol)) {
        try {
          const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
          const to = setTimeout(() => ctl && ctl.abort(), 1500);
          const r = await fetch('/mp/ping', { cache: 'no-store', signal: ctl && ctl.signal });
          clearTimeout(to);
          ok = r.ok && (await r.text()).includes('aevum');
        } catch { ok = false; }
      }
      // local/LAN: SSE. Through a tunnel/proxy (non-LAN host that answers /mp/ping): long-polling, because some tunnels do not pass SSE.
      transport = lan ? await sse() : ok ? await poll() : await tryRoom();
    }
    if (!transport) throw new Error('Çok oyunculu bağlantı kurulamadı: yerel sunucu (node server.js) ya da oda servisi bulunamadı.');
    return new NetSession(transport, opts);
  }

  // ---------- events ----------
  on(name, fn) {
    (this._h[name] || (this._h[name] = [])).push(fn);
    // 'start' may come before the lobby screen subscribed (the host pressed Start while we were still joining):
    // a late listener still gets it, otherwise this player would never enter the match
    if (name === 'start' && this._startEv && this.phase === 'game') {
      const ev = this._startEv;
      Promise.resolve().then(() => { if (this.phase === 'game' && (this._h.start || []).includes(fn)) { try { fn(ev); } catch (err) { console.error('[net] start', err); } } });
    }
    return () => this.off(name, fn);
  }
  off(name, fn) { const a = this._h[name]; if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(name, data) { for (const fn of (this._h[name] || []).slice()) { try { fn(data); } catch (err) { console.error('[net]', name, err); } } }

  get id() { return this.t.id; }
  get code() { return this.state ? this.state.code : null; }

  _every(ms, fn) { const h = this.clock.setInterval(fn, ms); this._timers.push(h); return h; }
  _send(topic, data) { this._lastAnySend = this.clock.now(); try { this.t.send(topic, data); } catch (err) { console.warn('[net] send', err); } }

  _wire() {
    if (this._wired) return; this._wired = true;
    this.t.on('lobby', (d, from, ident) => this._onLobby(d, from, ident));
    this.t.on('turn', (d, from) => this._onTurn(d, from));
    this.t.on('sync', (d, from) => this._onSync(d, from));
    this.t.on('chat', (d, from, ident) => {
      if (!d || typeof d.text !== 'string') return;
      // the name of the sender's seat (or waiting place), else his verified account; the message's own name only
      // on a transport without identities (LAN)
      const s = this._slotOfPeer(from), st = this.start0 || this.state;
      const w = !s && st && Array.isArray(st.waiting) ? st.waiting.find(x => x.peer === from) : null;
      const who = !s && !w && this.verified ? this._who(null, from, ident) : null;
      const name = s ? s.name : w ? w.name : who ? who.name : this.verified ? '?' : String(d.name || '?').slice(0, 20);
      const m = { from, name, text: d.text.slice(0, 200) };
      try { logChat({ room: this.room, name: m.name, text: m.text }); } catch { /* never let logging break the chat */ }
      this.emit('chat', m);
    });
    // map flares (a ping on the map for the team; like chat, never part of the lockstep)
    this.t.on('flare', (d, from) => {
      if (this.phase !== 'game' || !d || !Number.isFinite(d.x) || !Number.isFinite(d.z)) return;
      const pid = this.pidOf.get(from); if (pid == null) return;
      const now = this.clock.now(), last = (this._flareIn || (this._flareIn = new Map())).get(pid) || -1e9;
      if (now - last < 400) return;
      this._flareIn.set(pid, now);
      this.emit('flare', { pid, name: this.start0.slots[pid].name, x: +d.x, z: +d.z });
    });
    this.t.onPeers(ch => this._onPeers(ch));
    if (typeof this.t.onStatus === 'function') this.t.onStatus(st => { if (st && st.dup) { this.emit('notice', { text: 'Bu hesap bu odaya başka bir sekmeden girdi; bu sekmenin bağlantısı kapatıldı.' }); this.close('dup'); return; } this._onStatus(st); });
    this._every(100, () => this._pump());
  }

  // relay went away / came back (a restarted relay starts with empty rooms; the transport re-registers us)
  _onStatus(st) {
    const now = this.clock.now();
    if (!st || !st.up) { if (this._relayDownSince == null) this._relayDownSince = now; this.emit('relay', { up: false }); return; }
    this._relayDownSince = null;
    this.emit('relay', { up: true });
    if (this.phase === 'lobby') {
      if (this.isHost) this._broadcastLobby();
      else if (this._joined) this._send('lobby', this._hello());
    } else if (this.phase === 'game') {
      this._resendWindow(true);
    }
  }

  // re-send our recent turn packets (after a reconnect the others may have missed them)
  _resendWindow(force) {
    if (this.phase !== 'game' || !this.recv) return;
    const now = this.clock.now();
    if (!force && now - (this._lastWindow || -1e9) < 500) return;
    this._lastWindow = now;
    const m = this.recv.get(this.me);
    let t = Math.max(DELAY, this.turn - 2);
    while (t <= this.sentUpTo) {
      const upTo = Math.min(this.sentUpTo, t + REDUNDANCY);
      if (m.has(upTo)) this._send('turn', this._packet(this.me, upTo));
      t = upTo + 1;
    }
  }

  // ---------- lobby ----------
  async host() {
    const code = randCode();
    await this.t.connect(code); this.room = code;
    this.isHost = true; this.phase = 'lobby';
    this.state = {
      code, hostPeer: this.t.id, listed: true,   // listed: shown in the open rooms list (server.js /mp/rooms)
      settings: { mapSize: 320, mapType: 'random', climate: 'random', startRes: 'normal', startAge: 0, fog: 'explored', seed: null },
      slots: [{ kind: 'human', peer: this.t.id, uid: this.uid, name: this.name, av: cleanAv(this.ident && this.ident.av), tp: cleanTp(this.ident && this.ident.tp), team: 1, ready: true }],
    };
    this._wire();
    this._lastLobbyBc = -1e9;
    this._broadcastLobby();
    return code;
  }

  async join(code) {
    code = String(code || '').toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 5);
    if (code.length !== 5) throw new Error('Oda kodu 5 karakter olmalı.');
    await this.t.connect(code); this.room = code;
    this.isHost = false; this.phase = 'lobby';
    this._wire();
    return new Promise((resolve, reject) => {
      const t0 = this.clock.now();
      const hello = () => this._send('lobby', this._hello());
      hello();
      const h = this.clock.setInterval(() => {
        if (this._inLobby()) { this.clock.clearInterval(h); this._joined = true; resolve(this.state.code); return; }
        if (this._rejected) { this.clock.clearInterval(h); const why = this._rejected; this.close('rejected'); reject(new Error(why)); return; }
        if (this.clock.now() - t0 > 12000) { this.clock.clearInterval(h); reject(new Error('Odaya bağlanılamadı: kurucu bulunamadı (kod doğru mu?).')); return; }
        hello();
      }, 400);
      this._timers.push(h);
    });
  }

  _hello() { return { k: 'hello', name: this.name, uid: this.uid, ver: this.ver }; }
  // host, lobby: a joiner on another build is refused (a joiner without a ver - an old client - too, when we have one).
  // The answer is a 'full' with why 'ver': an old client at least stops trying at once.
  _verRefused(d, from) {
    if (!this.ver || cleanVer(d && d.ver) === this.ver) return false;
    this._send('lobby', { k: 'full', to: from, why: 'ver', ver: this.ver });
    return true;
  }
  _slotOfPeer(peer) { const st = this.start0 || this.state; return st ? st.slots.find(s => s.kind === 'human' && s.peer === peer) : null; }
  // are we listed by the host (in a slot, or waiting for a slot of a continued match)?
  _inLobby() {
    const st = this.state, me = this.t.id;
    return !!st && (st.slots.some(s => s.peer === me) || (Array.isArray(st.waiting) && st.waiting.some(w => w.peer === me)));
  }

  _broadcastLobby() {
    if (!this.isHost || this.phase !== 'lobby') return;
    this._lastLobbyBc = this.clock.now();
    this._send('lobby', { k: 'state', state: this.state });
    this.emit('lobby', this.state);
  }

  _onLobby(d, from, ident) {
    if (!d || typeof d !== 'object') return;
    if (this.isHost) {
      this._lobbyGone.delete(from);
      const who = this._who(d, from, ident);
      if (!who && (d.k === 'hello' || d.k === 'req')) return;   // (verified relay: a peer without identity is ignored)
      if (d.k === 'hello' && this.phase === 'lobby' && this._verRefused(d, from)) return;
      if (this.state && this.state.resume && this.phase === 'lobby' && (d.k === 'hello' || d.k === 'req')) { this._onResumeLobby(d, from, who); return; }
      if (d.k === 'hello' && this.phase === 'lobby') {
        let s = this.state.slots.find(x => x.peer === from);
        if (!s) {
          if (this.state.slots.length >= MAX_PLAYERS) { this._send('lobby', { k: 'full', to: from }); return; }
          // one account = one slot (the relay already replaces a second connection of the same account)
          if (this.verified && who.uid && this.state.slots.some(x => x.kind === 'human' && x.uid === who.uid)) return;
          this.state.slots.push({ kind: 'human', peer: from, uid: who.uid, name: who.name, av: who.av, tp: who.tp, team: 1, ready: false });
        } else if (this.verified) Object.assign(s, { uid: who.uid, name: who.name, av: who.av, tp: who.tp });
        else if (!s.uid && who.uid) s.uid = who.uid;
        this._broadcastLobby();
      } else if (d.k === 'req' && this.phase === 'lobby') {
        const s = this.state.slots.find(x => x.peer === from); if (!s) return;
        if (!this.verified && !s.uid && who.uid) s.uid = who.uid;
        if (d.op === 'setName') { if (!this.verified) s.name = String(d.v || '').slice(0, 20) || s.name; }   // (verified: the account's name)
        else if (d.op === 'setTeam') { const t = d.v | 0; if (t >= 1 && t <= 4) s.team = t; }
        else if (d.op === 'setReady') s.ready = !!d.v;
        this._broadcastLobby();
      } else if (d.k === 'ack') {
        this._startAcks.add(from);
      }
      return;
    }
    // client side: only the host's messages. Before the first state, the relay names the room's host when it can
    // (transport hostPeer, from its hello); without it the first state claiming its own sender as host is taken
    const host = this.state ? this.state.hostPeer : (typeof this.t.hostPeer === 'string' ? this.t.hostPeer : from);
    if (from !== host) return;
    this._hostGoneAt = null;
    if (d.k === 'state' && this.phase === 'lobby') {
      if (!cleanLobby(d.state) || d.state.hostPeer !== from) return;
      this._verifySlots(d.state.slots);
      this.state = d.state; this.emit('lobby', this.state);
    } else if (d.k === 'kick' && d.to === this.t.id && this.phase === 'lobby') {
      this.close('kicked');
    } else if (d.k === 'full' && d.to === this.t.id) {
      // (a joiner checked its own build against the server before joining: a different host build means the host is behind)
      this._rejected = d.why === 'ver' ? (this.ver && d.ver && cleanVer(d.ver) !== this.ver ? HOST_OLD_TEXT : VER_TEXT) : 'Oda dolu (en fazla 8 oyuncu).';
    } else if (d.k === 'start' && cleanLobby(d.start)) {
      if (d.start.resume && !(isObj(d.start.blob) && typeof d.start.blob.id === 'string')) return;
      this._verifySlots(d.start.slots);
      if (!this.state) this.state = { code: null, hostPeer: from, settings: d.start.settings, slots: d.start.slots };
      if (d.start.resume) {
        // continue a saved match: only a player who has a slot can come in
        if (!d.start.slots.some(s => s.kind === 'human' && s.peer === this.t.id)) {
          if (this.phase === 'lobby' && !this._loading) { this.emit('notice', { text: 'Maç sensiz başladı: sana bir oyuncu yeri ayrılmadı.' }); this.close('notInMatch'); }
          return;
        }
        this._send('lobby', { k: 'ack' });
        if (this.phase === 'lobby' && !this._loading) this._loadResume(d.start);
        return;
      }
      this._send('lobby', { k: 'ack' });
      if (this.phase === 'lobby') this._beginGame(d.start);
    }
  }

  // ---------- continue a saved match ----------
  // rec: a save record from storage ({mp:true, code, me, players, data: game.serialize()})
  async hostResume(rec) {
    if (!rec || !rec.data || !Array.isArray(rec.data.players)) throw new Error('Kayıt okunamadı.');
    if (typeof this.t.putBlob !== 'function') throw new Error(this.t.noBlob || 'Kayıtlı maça devam etmek bu bağlantı türünde desteklenmiyor.');
    const code = randCode();
    await this.t.connect(code); this.room = code;
    this.isHost = true; this.phase = 'lobby';
    const cfg = rec.data.cfg || {};
    const players = rec.data.players;
    // profile uids come from the save record's metadata (rec.players), never from the simulation data
    const recP = Array.isArray(rec.players) ? rec.players : [];
    const slots = players.map((p, i) => {
      const ai = p.isAI || p.kind === 'ai';
      const s = { kind: ai ? 'ai' : 'human', name: String(p.name || (ai ? 'Yapay Zekâ' : 'Oyuncu ' + (i + 1))).slice(0, 20), team: p.team | 0 || 1, saved: true };
      if (ai) { s.difficulty = p.difficulty || 'normal'; s.ready = true; } else {
        s.peer = null; s.mode = 'idle'; s.ready = false; s.wasLeft = !!p.left;
        // savedUid: who played this slot when it was saved (used for matching); uid: who plays it now
        s.savedUid = cleanUid(recP[i] && recP[i].uid); s.uid = s.savedUid;
      }
      return s;
    });
    // the host takes the human slot with his uid, then his name (fallback: the slot this save was made from, then the first human slot)
    let mine = this.uid ? slots.findIndex(s => s.kind === 'human' && s.savedUid === this.uid) : -1;
    if (mine < 0) mine = this._nameSlot(slots, this.name, this.uid);
    if (mine < 0 && rec.me != null && slots[rec.me] && slots[rec.me].kind === 'human') mine = rec.me;
    if (mine < 0) mine = slots.findIndex(s => s.kind === 'human');
    if (mine < 0) throw new Error('Bu kayıtta insan oyuncu yok.');
    Object.assign(slots[mine], { peer: this.t.id, mode: 'play', ready: true, uid: this.uid || slots[mine].savedUid || null, av: cleanAv(this.ident && this.ident.av), tp: cleanTp(this.ident && this.ident.tp) });
    this.state = {
      code, hostPeer: this.t.id,
      resume: { name: rec.name || 'Kayıt', tick: rec.tick | 0, match: rec.code || code, time: rec.time || 0 },
      settings: { mapSize: cfg.mapSize || 128, mapType: cfg.mapType || 'river', startRes: cfg.startRes || 'normal', startAge: cfg.startAge | 0, fog: cfg.fog, seed: cfg.seed | 0 },
      slots, waiting: [],
    };
    this._resumeRec = rec;
    this._wire();
    this._lastLobbyBc = -1e9;
    this._broadcastLobby();
    return code;
  }

  // a free human slot by name. A joiner with a uid only matches slots saved without one (old saves): that way
  // two players who swapped names do not swap slots, and a renamed player is found by uid instead.
  _nameSlot(slots, name, uid) {
    const n = String(name || '').trim().toLowerCase();
    if (!n) return -1;
    return slots.findIndex(s => s.kind === 'human' && !s.peer && s.mode !== 'ai' && (!uid || !s.savedUid) && s.name.trim().toLowerCase() === n);
  }
  // continue lobby: the slot a joiner gets automatically - by uid first, then by name; -1: he picks one himself.
  // A uid whose slots are all taken (the same profile in a second tab) matches nothing.
  _matchSlot(name, uid) {
    const slots = this.state.slots;
    uid = cleanUid(uid);
    if (uid) {
      // the first free slot saved with this uid (one profile can hold several slots, e.g. two tabs)
      if (slots.some(s => s.kind === 'human' && s.savedUid === uid)) return slots.findIndex(s => s.kind === 'human' && s.savedUid === uid && !s.peer && s.mode !== 'ai');
    }
    return this._nameSlot(slots, name, uid);
  }
  _takeSlot(i, from, uid, who) {
    const st = this.state;
    Object.assign(st.slots[i], { peer: from, mode: 'play', ready: false, uid: cleanUid(uid), av: who ? who.av : null, tp: who ? who.tp : null });
    st.waiting = st.waiting.filter(x => x.peer !== from);
  }

  _onResumeLobby(d, from, who) {
    const st = this.state;
    who = who || this._who(d, from, null) || { uid: null, name: 'Oyuncu', av: null, tp: null };
    let slot = st.slots.find(s => s.kind === 'human' && s.peer === from);
    let w = st.waiting.find(x => x.peer === from);
    if (d.k === 'hello') {
      if (!slot) {
        const nm = who.name, uid = who.uid;
        if (w && !w.uid && uid) w.uid = uid;
        if (w && this.verified) Object.assign(w, { uid, name: nm, av: who.av, tp: who.tp });
        const i = this._matchSlot(nm, uid);
        if (i >= 0) this._takeSlot(i, from, uid, who);
        else if (!w) { if (st.waiting.length >= MAX_PLAYERS) { this._send('lobby', { k: 'full', to: from }); return; } st.waiting.push({ peer: from, name: nm, uid, av: who.av, tp: who.tp }); }
      }
      this._broadcastLobby();
      return;
    }
    // req
    if (d.op === 'setReady' && slot) slot.ready = !!d.v;
    else if (d.op === 'setName') {
      const nm = this.verified ? who.name : String(d.v || '').slice(0, 20);
      if (w && nm) { w.name = nm; const i = this._matchSlot(nm, w.uid); if (i >= 0) this._takeSlot(i, from, w.uid, who); }
    } else if (d.op === 'claim' && w) {
      const i = d.v | 0, s = st.slots[i];
      if (s && s.kind === 'human' && !s.peer) this._takeSlot(i, from, w.uid, who);
    } else if (d.op === 'release' && slot) {
      const uid = cleanUid(slot.uid);
      Object.assign(slot, { peer: null, mode: 'idle', ready: false, uid: slot.savedUid || null, av: null, tp: null });
      st.waiting.push({ peer: from, name: this.verified ? who.name : String(d.name || this.name || 'Oyuncu').slice(0, 20), uid, av: who.av, tp: who.tp });
    }
    this._broadcastLobby();
  }

  // continue lobby, client: take a free human slot / give it back
  claimSlot(i) { if (!this.isHost && this.state && this.state.resume) { this._claim = i | 0; this._lastClaim = this.clock.now(); this._send('lobby', { k: 'req', op: 'claim', v: i | 0, uid: this.uid }); return true; } return false; }
  // continue lobby, host: what happens to a human slot nobody took: 'idle' (stays, marked left) or 'ai' (an AI takes it over)
  setSlotMode(i, mode) {
    this._hostOnly();
    const s = this.state.slots[i];
    if (!this.state.resume || !s || s.kind !== 'human' || s.peer || !['idle', 'ai'].includes(mode)) return false;
    s.mode = mode; if (mode === 'ai' && !s.difficulty) s.difficulty = 'normal';
    this._broadcastLobby(); return true;
  }
  // continue lobby, host: free a slot someone took (he goes back to the waiting list)
  freeSlot(i) {
    this._hostOnly();
    const s = this.state.slots[i];
    if (!this.state.resume || !s || s.kind !== 'human' || !s.peer || s.peer === this.t.id) return false;
    this.state.waiting.push({ peer: s.peer, name: s.name, uid: cleanUid(s.uid), av: s.av || null, tp: s.tp == null ? null : s.tp });
    Object.assign(s, { peer: null, mode: 'idle', ready: false, uid: s.savedUid || null, av: null, tp: null });
    this._broadcastLobby(); return true;
  }

  async _startResume() {
    const rec = this._resumeRec;
    const json = JSON.stringify(rec.data);
    const h = strHash32(json);
    this._resumeStarting = true;
    this.emit('loading', { text: 'Kayıt diğer oyunculara gönderiliyor…' });
    let id;
    try { id = await this.t.putBlob(json); }
    finally { this._resumeStarting = false; }
    if (this.phase !== 'lobby') return;
    const c = this.canStart(); if (!c.ok) throw new Error(c.reason);
    const st = this.state;
    this._startMsg = {
      resume: true, match: st.resume.match, settings: Object.assign({}, st.settings), seed: st.settings.seed | 0,
      slots: st.slots.map(s => Object.assign({}, s)), blob: { id, h, size: json.length, tick: st.resume.tick },
    };
    this._startAcks = new Set([this.t.id]);
    this._send('lobby', { k: 'start', start: this._startMsg });
    this._lastStartSend = this.clock.now();
    this.resumeData = rec.data;
    this._beginGame(this._startMsg);
  }

  async _loadResume(start) {
    this._loading = true;
    this.emit('loading', { text: 'Kayıt indiriliyor…' });
    try {
      if (typeof this.t.getBlob !== 'function') throw new Error(this.t.noBlob || 'Bu bağlantı türü kayıt aktaramıyor.');
      const txt = await this.t.getBlob(start.blob.id);
      if (strHash32(txt) !== (start.blob.h >>> 0)) throw new Error('İndirilen kayıt bozuk (özet tutmadı).');
      const data = JSON.parse(txt);
      // the host could send any save under the match's name: a client that saved this match at that tick itself
      // compares (the app's hook: its own record's state hash against the downloaded one; null = no copy, not checked)
      if (typeof NetSession.checkResume === 'function') {
        const why = await NetSession.checkResume(data, { match: start.match || null, tick: start.blob.tick | 0 });
        if (why) throw new Error(String(why));
      }
      if (this.phase !== 'lobby') return;
      this.resumeData = data;
      this._beginGame(start);
    } catch (err) {
      console.warn('[net] resume load', err);
      if (this.phase === 'lobby') { this.emit('notice', { text: 'Kayıt yüklenemedi: ' + (err && err.message || err) }); this.close('loadFailed'); }
    } finally { this._loading = false; }
  }

  _req(op, v) {
    if (this.isHost) {
      const s = this.state.slots.find(x => x.peer === this.t.id) || this.state.slots[0];
      if (this.state.resume && op !== 'setReady') return;   // names and teams come from the save
      if (op === 'setName') { if (!this.verified) s.name = String(v || '').slice(0, 20) || s.name; }
      else if (op === 'setTeam') { const t = v | 0; if (t >= 1 && t <= 4) s.team = t; }
      else if (op === 'setReady') s.ready = !!v;
      this._broadcastLobby();
    } else {
      // remembered and re-sent until the host's state reflects it (requests can be dropped)
      (this._want || (this._want = {}))[op] = v;
      this._send('lobby', { k: 'req', op, v, uid: this.uid });
    }
  }
  _resendWants() {
    if (this.isHost || this.phase !== 'lobby' || !this._want || !this.state) return;
    if (this.state.resume) { delete this._want.setName; delete this._want.setTeam; }   // fixed by the save
    const s = this.state.slots.find(x => x.peer === this.t.id); if (!s) return;
    const now = this.clock.now();
    if (now - (this._lastWant || -1e9) < 300) return;
    const cur = { setName: s.name, setTeam: s.team, setReady: s.ready };
    for (const op in this._want) {
      const v = this._want[op];
      if (op === 'setReady' ? cur[op] === !!v : op === 'setTeam' ? cur[op] === (v | 0) : cur[op] === String(v).slice(0, 20)) delete this._want[op];
      else { this._lastWant = now; this._send('lobby', { k: 'req', op, v, uid: this.uid }); }
    }
  }
  setName(n) { if (this.verified) return; this.name = String(n || '').slice(0, 20) || this.name; this._req('setName', this.name); }
  setTeam(t) { this._req('setTeam', t); }
  setReady(b) { this._req('setReady', b); }

  _hostOnly() { if (!this.isHost || this.phase !== 'lobby') throw new Error('Bunu sadece oda kurucusu yapabilir.'); }
  _notResume() { if (this.state && this.state.resume) throw new Error('Kayıtlı maçta oyuncu dizilişi kayıttan gelir.'); }
  addAI(team = 2, difficulty = 'normal') {
    this._hostOnly(); this._notResume();
    if (this.state.slots.length >= MAX_PLAYERS) return false;
    const n = this.state.slots.filter(s => s.kind === 'ai').length + 1;
    this.state.slots.push({ kind: 'ai', name: 'Yapay Zekâ ' + n, team: Math.max(1, Math.min(4, team | 0)), difficulty: ['easy', 'normal', 'hard'].includes(difficulty) ? difficulty : 'normal', ready: true });
    this._broadcastLobby(); return true;
  }
  removeSlot(i) {
    this._hostOnly(); this._notResume();
    const s = this.state.slots[i]; if (!s || i === 0) return false;
    this.state.slots.splice(i, 1);
    if (s.kind === 'human') this._send('lobby', { k: 'kick', to: s.peer });
    this._broadcastLobby(); return true;
  }
  setSlot(i, patch = {}) {
    this._hostOnly();
    const s = this.state.slots[i]; if (!s) return false;
    if (this.state.resume) {   // only the difficulty of an AI (or of an AI taking over an absent human) may change
      if (patch.difficulty && ['easy', 'normal', 'hard'].includes(patch.difficulty) && (s.kind === 'ai' || s.mode === 'ai')) { s.difficulty = patch.difficulty; this._broadcastLobby(); return true; }
      return false;
    }
    if (patch.team != null) { const t = patch.team | 0; if (t >= 1 && t <= 4) s.team = t; }
    if (patch.difficulty && s.kind === 'ai' && ['easy', 'normal', 'hard'].includes(patch.difficulty)) s.difficulty = patch.difficulty;
    if (patch.name) s.name = String(patch.name).slice(0, 20);
    this._broadcastLobby(); return true;
  }
  setSettings(patch = {}) {
    this._hostOnly(); this._notResume();
    const st = this.state.settings;
    if ([160, 192, 256, 320, 384, 448, 512].includes(patch.mapSize)) st.mapSize = patch.mapSize;
    if (['low', 'normal', 'high'].includes(patch.startRes)) st.startRes = patch.startRes;
    if (MAP_TYPES.includes(patch.mapType)) st.mapType = patch.mapType;
    if (CLIMATES.includes(patch.climate)) st.climate = patch.climate;
    if (patch.startAge != null) st.startAge = Math.max(0, Math.min(3, patch.startAge | 0));
    if (patch.fog === 'explored' || patch.fog === 'dark') st.fog = patch.fog;
    if (patch.seed != null) st.seed = patch.seed | 0;
    this._broadcastLobby();
  }
  // host: show this room in the public open rooms list (true) or keep it invite / code only (false)
  setListed(on) { this._hostOnly(); this._notResume(); this.state.listed = on !== false; this._broadcastLobby(); }
  canStart() {
    if (!this.isHost || this.phase !== 'lobby') return { ok: false, reason: 'Sadece kurucu başlatabilir.' };
    const sl = this.state.slots;
    if (this.state.resume) {
      if (this._resumeStarting) return { ok: false, reason: 'Kayıt gönderiliyor…' };
      const nr = sl.filter(s => s.kind === 'human' && s.peer && s.peer !== this.t.id && !s.ready);
      if (nr.length) return { ok: false, reason: 'Hazır olmayan: ' + nr.map(s => s.name).join(', ') };
      return { ok: true };
    }
    if (sl.length < 2) return { ok: false, reason: 'En az 2 oyuncu gerekli.' };
    if (new Set(sl.map(s => s.team)).size < 2) return { ok: false, reason: 'En az iki farklı takım olmalı.' };
    const nr = sl.filter((s, i) => i > 0 && s.kind === 'human' && !s.ready);
    if (nr.length) return { ok: false, reason: 'Hazır olmayan: ' + nr.map(s => s.name).join(', ') };
    return { ok: true };
  }
  start() {
    const c = this.canStart(); if (!c.ok) throw new Error(c.reason);
    if (this.state.resume) return this._startResume();   // async: uploads the save first
    const seed = this.state.settings.seed != null ? this.state.settings.seed : ((Math.random() * 1e9) | 0);
    this._startMsg = { settings: Object.assign({}, this.state.settings, { seed }), slots: this.state.slots.map(s => Object.assign({}, s)), seed };
    this._startAcks = new Set([this.t.id]);
    this._send('lobby', { k: 'start', start: this._startMsg });
    this._lastStartSend = this.clock.now();
    this._beginGame(this._startMsg);
  }

  flare(x, z) {
    if (this.phase !== 'game' || !Number.isFinite(x) || !Number.isFinite(z)) return false;
    const now = this.clock.now();
    if (now - (this._flareOut || -1e9) < 500) return false;
    this._flareOut = now;
    this._send('flare', { x: Math.round(x * 10) / 10, z: Math.round(z * 10) / 10 });
    return true;
  }

  chat(text) {
    text = String(text || '').trim().slice(0, 200); if (!text) return;
    this._send('chat', { name: this.name, text });
    try { logChat({ room: this.room, name: this.name, text, mine: true }); } catch { /* never let logging break the chat */ }
    this.emit('chat', { from: this.t.id, name: this.name, text });
  }

  static cfgFrom(start, myPeer) {
    const st = start.settings || {};
    const players = start.slots.map(s => {
      const p = { kind: s.kind === 'ai' || s.mode === 'ai' ? 'ai' : 'human', team: s.team | 0 || 1, name: s.name };
      if (p.kind === 'ai') p.difficulty = s.difficulty || 'normal';
      return p;
    });
    const me = Math.max(0, start.slots.findIndex(s => s.kind === 'human' && s.peer === myPeer));
    const cfg = {
      mp: true, players, me, seed: start.seed | 0,
      mapSize: st.mapSize || 320, mapType: MAP_TYPES.includes(st.mapType) ? st.mapType : 'river', climate: CLIMATES.includes(st.climate) ? st.climate : 'random',
      startRes: st.startRes || 'normal', startAge: st.startAge | 0, fog: st.fog === 'dark' ? 'dark' : (st.fog === 'explored' ? 'explored' : undefined),
      difficulty: 'normal', sandbox: false, enemies: Math.max(1, players.length - 1),
    };
    if (start.resume) {
      // what the app does to the loaded save before the first turn (identical on every client)
      cfg.resume = {
        match: start.match || null, tick: (start.blob && start.blob.tick) | 0,
        humans: start.slots.map((s, i) => (s.kind === 'human' && s.peer ? i : -1)).filter(i => i >= 0),
        idle: start.slots.map((s, i) => (s.kind === 'human' && !s.peer && s.mode !== 'ai' ? i : -1)).filter(i => i >= 0),
        ai: start.slots.map((s, i) => (s.kind === 'human' && !s.peer && s.mode === 'ai' ? [i, s.difficulty || 'normal'] : null)).filter(Boolean),
      };
    }
    return cfg;
  }

  // ---------- lockstep ----------
  _beginGame(start) {
    this.phase = 'game';
    this.start0 = start;
    this.cfg = NetSession.cfgFrom(start, this.t.id);
    this.me = this.cfg.me;
    this.humans = [];                 // pids of humans
    this.peerOf = []; this.pidOf = new Map();
    // (a continued match may have human slots nobody took: they are not part of the lockstep)
    start.slots.forEach((s, i) => { if (s.kind === 'human' && s.peer) { this.humans.push(i); this.peerOf[i] = s.peer; this.pidOf.set(s.peer, i); } });
    this.match = start.match || (this.state && this.state.code) || null;
    this.silentAcc = new Map(); this._lastPumpT = null; this._lastAnySend = this.clock.now();
    this.recv = new Map();            // pid -> Map(turn -> cmds)
    for (const p of this.humans) this.recv.set(p, new Map());
    this.leftAt = new Map();          // pid -> turn (from this turn on, not waited for)
    this.leftApplied = new Set();
    this.tick = 0; this.turn = 0; this._acc = 0;
    this.pending = [];
    this.sentUpTo = DELAY - 1;        // last turn of ours already scheduled
    this.myHashes = new Map(); this.peerHashes = new Map();
    this.lastHeard = new Map(); const now = this.clock.now();
    for (const p of this.humans) this.lastHeard.set(p, now);
    this.goneAt = new Map();          // pid -> time transport reported left
    this.stallSince = null; this._stallEmitted = false; this._lastNeed = 0;
    this._resent = new Map();
    this.desynced = false;
    this.paused = false; this.pausedBy = null;
    this.withheld = new Map();        // pid -> ms we waited for his lists while he kept talking (see DROP_STALL_MS)
    this.turnHeard = new Set();       // pids whose own turn packets reached us (a client still loading sends none)
    this.ownTop = new Map();          // pid -> {t, at}: the highest turn of his own packets and when it last grew
    this._relayAsk = new Map();       // pid -> time we last asked the others to forward his lists
    this._fwd = new Set();            // 'pid:turn' of lists stored from another player's forward
    this.streamHash = 2166136261 >>> 0; this.execCount = 0;
    // adaptive input delay + pacing (real-time only: never part of the simulation; every turn's list is explicit)
    const host = typeof location !== 'undefined' ? location.hostname : '';
    this.delay = /^(localhost|127\.|\[?::1\]?$)/.test(host) || !host ? DELAY : DELAY + 1;
    this._delayDownAt = 0;
    this.rtt = new Map();             // pid -> recent round trips (ms)
    this.lead = new Map();            // pid -> how many turns ahead of our clock its packets arrive (EMA)
    this.wantOf = new Map();          // pid -> the delay that player asks us to use (from his side's measurements)
    this.offset = new Map();          // pid -> how many turns we run ahead of that player (estimate)
    this.stalls = new Map();          // pid -> times we stalled waiting for him
    this._slow = false; this._lastPing = -1e9; this._echo = new Map();
    if (this._preTurn) { for (const [d, f] of this._preTurn) this._onTurn(d, f); this._preTurn = null; }
    const ev = { cfg: Object.assign({}, this.cfg, { players: this.cfg.players.map(p => Object.assign({}, p)) }) };
    this._startEv = (this._h.start || []).length ? null : ev;   // nobody listening yet: kept for the first listener
    this.emit('start', ev);
  }

  // ask every client to save the match at the same turn (a lockstep session command, not a Game command);
  // each client then gets a 'save' event {id, auto, by, turn, hash, game} at the same tick
  // pause / resume the match for everybody (a lockstep session command: every client stops at the same turn)
  requestPause(on) {
    if (this.phase !== 'game') return false;
    this.pending.push(['@pause', [on ? 1 : 0]]);
    return true;
  }
  _execPause(turn, pid, args) {
    const on = !!(args && args[0]);
    if (!!this.paused === on) return;
    this.paused = on;
    const by = this.start0 && this.start0.slots[pid] ? this.start0.slots[pid].name : '?';
    this.pausedBy = on ? by : null;
    this.emit('pause', { paused: on, by, byPid: pid, turn });
  }

  requestSave(auto = false) {
    if (this.phase !== 'game') return null;
    const id = String(this.t.id).slice(0, 8) + '-' + (++this._saveSeq);
    this.pending.push(['@save', [id, auto ? 1 : 0]]);
    return id;
  }

  issue(method, args) {
    if (this.phase !== 'game' || !METHOD_SET.has(method)) return false;
    if (this.paused) return false;   // (no orders while the match is paused)
    let a;
    try { a = JSON.parse(JSON.stringify(Array.isArray(args) ? args : [])); } catch { return false; }
    if (jsonLen(a) > 3000) return false;
    this.pending.push([method, a]);
    return true;
  }

  _isActive(pid, turn) { const l = this.leftAt.get(pid); return l == null || turn < l; }
  _cmdsFor(pid, turn) {
    if (turn < DELAY) return [];
    return this.recv.get(pid).get(turn);
  }
  _missing(turn) {
    const out = [];
    for (const p of this.humans) if (this._isActive(p, turn) && this._cmdsFor(p, turn) === undefined) out.push(p);
    return out;
  }

  _packet(pid, upTo, extra, back = REDUNDANCY) {
    const m = this.recv.get(pid);
    const pk = { p: pid, t: upTo, c: m.get(upTo) || [] };
    if (extra) Object.assign(pk, extra);
    if (this.leftAt.size && this._authority() === this.me) pk.d = [...this.leftAt];
    const r = [];
    for (let k = 1; k <= back; k++) {
      const tt = upTo - k; if (tt < DELAY) break;
      const c = m.get(tt); if (c === undefined) continue;
      r.push([tt, c]);
      pk.r = r;
      if (jsonLen(pk) > MAX_MSG) { r.pop(); if (!r.length) delete pk.r; break; }
    }
    return pk;
  }

  _scheduleOwn(turn) {
    // finalize our command list for `turn` (= current turn + DELAY) and broadcast it
    const list = [];
    let size = 2;
    while (this.pending.length && list.length < MAX_CMDS) {
      const c = this.pending[0], l = jsonLen(c) + 1;
      if (list.length && size + l > 700) break;
      list.push(c); size += l; this.pending.shift();
    }
    this.recv.get(this.me).set(turn, list);
    this.sentUpTo = turn;
    this._unsent = (this._unsent || 0) + 1;
    // normally one packet per turn; while catching up several turns are bundled into one packet
    if (this._unsent >= 12 ||this.clock.now() - (this._lastTurnSend || -1e9) >= 90) this._flushTurn();
  }
  _flushTurn() {
    if (!this._unsent) return;
    this._send('turn', this._packet(this.me, this.sentUpTo, this._hx, this._unsent - 1 + REDUNDANCY));
    this._unsent = 0; this._hx = null; this._lastTurnSend = this.clock.now();
  }

  // fwd: the list came from another player (a forward after our 'need' with relay): kept only until the owner's own
  // packet brings that turn before it runs (honest forwards are the same list; a forged one is then replaced, or
  // shows as a desync instead of passing silently)
  _store(pid, turn, c, fwd) {
    if (!Array.isArray(c)) return;
    const m = this.recv.get(pid), k = pid + ':' + turn;
    if (turn < DELAY || turn > this.turn + MAX_AHEAD) return;
    if (m.has(turn) && (fwd || !this._fwd.has(k) || turn <= this.turn)) return;
    if (turn < this.turn && this._isActive(pid, turn)) return; // already executed without it?? cannot happen; ignore
    m.set(turn, c.filter(x => Array.isArray(x) && LOCKSTEP_SET.has(x[0]) && Array.isArray(x[1])).slice(0, MAX_CMDS));
    if (fwd) { this._fwd.add(k); if (this._fwd.size > 2000) this._fwd.clear(); } else this._fwd.delete(k);
  }

  _onTurn(d, from) {
    if (!d || typeof d !== 'object') return;
    if (this.phase !== 'game') { if (this.phase === 'lobby') { (this._preTurn || (this._preTurn = [])).push([d, from]); if (this._preTurn.length > 200) this._preTurn.shift(); } return; }
    const fromPid = this.pidOf.get(from);
    if (fromPid == null) return;                       // not in roster
    this.lastHeard.set(fromPid, this.clock.now());
    const pid = d.p | 0;
    if (!this.recv.has(pid) || pid === this.me) return;
    // another player's lists in a packet from someone else (the relay stamps who sent it): only a forward we asked for
    const fwd = pid !== fromPid;
    if (fwd && !(this.clock.now() - (this._relayAsk.get(pid) || -1e9) < 10000)) return;
    if (!fwd) {
      this.turnHeard.add(pid);
      // his own progress: a slow but honest client keeps scheduling new turns, one who withholds his lists does not
      if (typeof d.t === 'number') { const top = this.ownTop.get(pid), tt = d.t | 0; if (!top || tt > top.t) this.ownTop.set(pid, { t: tt, at: this.clock.now() }); }
    }
    if (typeof d.t === 'number') {
      this._store(pid, d.t | 0, d.c, fwd);
      // how early his lists arrive, in turns (pacing, see _onPing)
      if (pid === fromPid) { const s = (d.t | 0) - this.tick / TURN_TICKS, l = this.lead.get(pid); this.lead.set(pid, l == null ? s : l * 0.8 + s * 0.2); }
    }
    // (honest packets repeat at most 11 bundled + REDUNDANCY turns, see _flushTurn)
    if (Array.isArray(d.r)) for (const e of d.r.slice(0, MAX_AHEAD)) if (Array.isArray(e)) this._store(pid, e[0] | 0, e[1], fwd);
    if (d.h != null && pid === fromPid) {
      if (!this.peerHashes.has(d.ht)) this.peerHashes.set(d.ht, new Map());
      this.peerHashes.get(d.ht).set(pid, d.h >>> 0);
      this._checkHash(d.ht);
    }
    if (Array.isArray(d.d) && fromPid === this._authority()) this._applyDrops(d.d);
  }

  _checkHash(ht) {
    const mine = this.myHashes.get(ht), ph = this.peerHashes.get(ht);
    if (mine == null || !ph || this.desynced) return;
    for (const [, h] of ph) if (h !== mine) {
      this.desynced = true;
      const nm = (p) => (this.start0 && this.start0.slots[p] ? this.start0.slots[p].name : '?');
      this.emit('desync', { tick: ht * TURN_TICKS, ht, mine, peers: [...ph].map(([pid, hh]) => ({ pid, name: nm(pid), h: hh >>> 0 })), parts: (this.myParts && this.myParts.get(ht)) || null });
      return;
    }
    // keep maps small
    if (this.myHashes.size > 20) { const k = [...this.myHashes.keys()].sort((a, b) => a - b); for (const x of k.slice(0, k.length - 20)) { this.myHashes.delete(x); this.peerHashes.delete(x); } }
  }

  _authority() {
    // lowest-index human that is not dropped and not locally known as gone
    for (const p of this.humans) if (!this.leftAt.has(p) && !this.goneAt.has(p)) return p;
    return this.me;
  }

  _applyDrops(list) {
    for (const e of list) {
      if (!Array.isArray(e)) continue;
      const pid = e[0] | 0, turn = e[1] | 0;
      if (!this.recv.has(pid) || this.leftAt.has(pid)) continue;
      if (pid === this.me) { this.close('dropped'); return; }
      this.leftAt.set(pid, Math.max(turn, DELAY));
    }
  }

  _onSync(d, from) {
    if (!d || typeof d !== 'object' || this.phase !== 'game') return;
    const fromPid = this.pidOf.get(from);
    if (fromPid == null) return;
    this.lastHeard.set(fromPid, this.clock.now());
    if (d.k === 'bye') { this.goneAt.set(fromPid, this.clock.now() - DROP_LEFT_MS + 500); return; }
    if (d.k === 'ka') return;
    if (d.k === 'pi') {
      // no reply message: our next ping echoes his stamp with how long we held it (e), his echoes ours
      if (typeof d.t === 'number') this._echo.set(fromPid, [d.t, this.clock.now()]);
      if (Array.isArray(d.e)) for (const e of d.e) {
        if (!Array.isArray(e) || (e[0] | 0) !== this.me || typeof e[1] !== 'number') continue;
        const ms = this.clock.now() - e[1] - Math.max(0, +e[2] || 0);
        if (ms >= 0 && ms < 30000) { const a = this.rtt.get(fromPid) || []; a.push(ms); if (a.length > 20) a.shift(); this.rtt.set(fromPid, a); }
      }
      this._onPing(fromPid, d);
      return;
    }
    if (d.k === 'saved') { if (typeof d.id === 'string') this._noteSaveHash(d.id.slice(0, 40), fromPid, d.h >>> 0, false); return; }
    if (d.k === 'drop' && fromPid === this._authority()) { this._applyDrops(d.d || []); return; }
    if (Array.isArray(d.need)) {
      const of = Array.isArray(d.of) ? d.of : [this.me];
      const now = this.clock.now();
      for (const pidRaw of of) {
        const pid = pidRaw | 0;
        if (!this.recv.has(pid)) continue;
        if (pid !== this.me && !d.relay) continue;
        if (pid === this.me && now - (this._lastTurnSend || -1e9) < 120 && !d.relay) continue; // a fresh packet is already on its way
        const m = this.recv.get(pid);
        const turns = d.need.map(x => x | 0).filter(t => m.has(t)).sort((a, b) => a - b);
        if (!turns.length) continue;
        const key = pid + ':' + turns[0];
        if (now - (this._resent.get(key) || -1e9) < 150) continue;
        this._resent.set(key, now);
        if (this._resent.size > 200) this._resent.clear();
        // send packets covering the requested turns (each packet covers up to REDUNDANCY+1 turns)
        let i = 0;
        while (i < turns.length) {
          const top = Math.min(turns[i] + REDUNDANCY, pid === this.me ? this.sentUpTo : turns[turns.length - 1]);
          const upTo = m.has(top) ? top : turns[i];
          this._send('turn', this._packet(pid, upTo));
          const before = i;
          while (i < turns.length && turns[i] <= upTo) i++;
          if (i === before) i++;
        }
      }
    }
  }

  // ---------- latency / pacing (real time only; nothing here reaches the simulation) ----------
  // the round trip to `pid` we plan for: a high percentile of the recent pings (jitter included)
  _rttOf(pid) {
    const a = this.rtt.get(pid); if (!a || !a.length) return null;
    const s = [...a].sort((x, y) => x - y);
    return s[Math.min(s.length - 1, Math.floor(s.length * 0.9))];
  }
  _noteStall(turn) {
    const now = this.clock.now();
    for (const p of this._missing(turn)) { const a = (this.stalls.get(p) || []).filter(t => now - t < 20000); a.push(now); this.stalls.set(p, a); }
  }
  // the input delay we ask `pid` to use: his lists must reach us before we need them (one-way trip + margin),
  // one more turn per pair of recent waits for him
  _wantFor(pid) {
    const r = this._rttOf(pid);
    let w = r == null ? DELAY : Math.ceil((r / 2 + 70) / (STEP * TURN_TICKS * 1000));
    const now = this.clock.now();
    const st = (this.stalls.get(pid) || []).filter(t => now - t < 20000).length;
    w += Math.min(3, st >> 1);
    return Math.max(DELAY, Math.min(MAX_DELAY, w));
  }
  _updateDelay() {
    let want = DELAY;
    for (const p of this.humans) {
      if (p === this.me || !this._isActive(p, this.turn)) continue;
      want = Math.max(want, this._wantFor(p), this.wantOf.get(p) || 0);
    }
    want = Math.min(MAX_DELAY, want);
    const now = this.clock.now();
    if (want > this.delay) { this.delay = want; this._delayDownAt = now; }
    else if (want < this.delay && now - this._delayDownAt >= 5000) { this.delay--; this._delayDownAt = now; }   // down slowly
  }
  // a peer's ping carries his view: the delay he wants from us, how early our lists reach him, his own delay
  _onPing(pid, d) {
    if (Array.isArray(d.w)) for (const e of d.w) if (Array.isArray(e) && (e[0] | 0) === this.me) this.wantOf.set(pid, Math.max(DELAY, Math.min(MAX_DELAY, e[1] | 0)));
    const mine = this.lead.get(pid);
    let his = null;
    if (Array.isArray(d.lg)) for (const e of d.lg) if (Array.isArray(e) && (e[0] | 0) === this.me && typeof e[1] === 'number') his = e[1];
    if (mine == null || his == null || typeof d.dl !== 'number') return;
    // mine = his delay - trip - off; his = our delay - trip + off  =>  off = turns we run ahead of him
    this.offset.set(pid, ((d.dl - mine) - (this.delay - his)) / 2);
    let ahead = -1e9;
    for (const p of this.humans) if (p !== this.me && this._isActive(p, this.turn) && this.offset.has(p)) ahead = Math.max(ahead, this.offset.get(p));
    if (!this._slow && ahead > 0.5) this._slow = true;
    else if (this._slow && ahead < 0.15) this._slow = false;
  }
  // for the HUD: {ping ms (worst peer), delay ms}
  netInfo() {
    if (this.phase !== 'game') return null;
    let ping = null;
    for (const p of this.humans) { if (p === this.me) continue; const a = this.rtt.get(p); if (a && a.length) ping = Math.max(ping || 0, a[a.length - 1]); }
    return { ping: ping == null ? null : Math.round(ping), delay: this.delay * TURN_TICKS * STEP * 1000, slow: this._slow };
  }

  _onPeers(ch) {
    if (!ch) return;
    const now = this.clock.now();
    // The relay's "left" is only a hint: after a relay restart everybody looks gone until they re-register.
    // Lobby: a peer is removed only if it stays gone LOBBY_GONE_MS (see _pump). Game: silence decides (DROP_SILENT_MS).
    for (const p of ch.left || []) {
      if (this.phase === 'lobby') {
        if (this.isHost) { if (!this._lobbyGone.has(p)) this._lobbyGone.set(p, now); }
        else if (this.state && p === this.state.hostPeer && this._hostGoneAt == null) this._hostGoneAt = now;
      }
    }
    for (const p of ch.joined || []) {
      if (this.phase === 'game') {
        const pid = this.pidOf.get(p);
        if (pid != null) { this.lastHeard.set(pid, now); this.silentAcc.set(pid, 0); this._resendWindow(false); }
      } else if (this.phase === 'lobby') {
        if (this.isHost) { this._lobbyGone.delete(p); this._broadcastLobby(); }
        else if (this.state && p === this.state.hostPeer) this._hostGoneAt = null;
      }
    }
  }

  _lobbyHousekeeping(now) {
    const peers = new Set(typeof this.t.peers === 'function' ? this.t.peers() : []);
    if (this.isHost) {
      for (const [p, t] of this._lobbyGone) {
        if (peers.has(p)) { this._lobbyGone.delete(p); continue; }
        if (now - t < LOBBY_GONE_MS || !this.relayUp) continue;
        this._lobbyGone.delete(p);
        const st = this.state;
        if (st.resume) {
          const s = st.slots.find(x => x.kind === 'human' && x.peer === p && p !== this.t.id);
          if (s) { this.emit('peerLeft', { name: s.name }); Object.assign(s, { peer: null, mode: 'idle', ready: false, uid: s.savedUid || null }); }
          st.waiting = st.waiting.filter(w => w.peer !== p);
          this._broadcastLobby();
        } else {
          const i = st.slots.findIndex(s => s.kind === 'human' && s.peer === p);
          if (i > 0) { const s = st.slots[i]; st.slots.splice(i, 1); this.emit('peerLeft', { name: s.name }); this._broadcastLobby(); }
        }
      }
    } else if (this.state) {
      if (this._hostGoneAt != null && peers.has(this.state.hostPeer)) this._hostGoneAt = null;
      if (this._hostGoneAt != null && now - this._hostGoneAt >= LOBBY_GONE_MS && this.relayUp && !this._loading) { this.emit('peerLeft', { name: 'Kurucu' }); this.close('hostLeft'); return; }
      // a slot claim (continue lobby) is re-sent until the host shows it, or someone else got that slot
      if (this._claim != null) {
        const s = this.state.slots[this._claim];
        if (!s || s.kind !== 'human' || s.peer) this._claim = null;
        else if (now - (this._lastClaim || -1e9) >= 500) { this._lastClaim = now; this._send('lobby', { k: 'req', op: 'claim', v: this._claim, uid: this.uid }); }
      }
      // the host lost us (e.g. the relay restarted and our "left" reached him): say hello again
      if (this._joined && !this._inLobby() && !this._rejected && now - (this._lastHello || -1e9) >= 1000) { this._lastHello = now; this._send('lobby', this._hello()); }
    }
  }

  // periodic housekeeping (lobby re-broadcast, start resend, drop detection)
  _pump() {
    if (this.phase === 'closed') return;
    const now = this.clock.now();
    if (this.phase === 'lobby' && this.isHost && now - this._lastLobbyBc >= 2000) this._broadcastLobby();
    if (this.phase === 'lobby') { this._resendWants(); this._lobbyHousekeeping(now); }
    if (this.phase !== 'game') return;
    const dt = this._lastPumpT == null ? 0 : Math.max(0, Math.min(1000, now - this._lastPumpT));
    this._lastPumpT = now;
    // silence bookkeeping: count a peer's silence only while the relay is reachable and other traffic flows
    // (if everybody is silent the relay or our own link is down: that stalls the match but drops nobody)
    const up = this.relayUp;
    for (const p of this.humans) {
      if (p === this.me || this.leftAt.has(p)) continue;
      const ago = now - (this.lastHeard.get(p) || now);
      if (ago < 1500) { this.silentAcc.set(p, 0); continue; }
      const others = this.humans.filter(q => q !== this.me && q !== p && !this.leftAt.has(q) && !this.goneAt.has(q));
      const flows = !others.length || others.some(q => now - (this.lastHeard.get(q) || -1e9) < 3000);
      if (up && flows) this.silentAcc.set(p, (this.silentAcc.get(p) || 0) + dt);
    }
    // waiting for the lists of a peer who is heard all along (he sent lists before: not a client still loading) and
    // whose own turns have not grown for STALL_NOPROG_MS (a slow client that keeps sending new turns is not counted)
    const waitFor = this.stallSince != null && up ? this._missing(this.turn) : [];
    for (const p of this.humans) {
      if (p === this.me || this.leftAt.has(p)) continue;
      const heard = now - (this.lastHeard.get(p) || -1e9) < 3000, w = this.withheld.get(p) || 0;
      const top = this.ownTop.get(p), stuck = !top || now - top.at > STALL_NOPROG_MS;
      if (waitFor.length === 1 && waitFor[0] === p && heard && this.turnHeard.has(p) && stuck) this.withheld.set(p, w + dt);
      else if (w) this.withheld.set(p, Math.max(0, w - 2 * dt));
    }
    // round-trip pings + pacing info (also the keep-alive: a peer with nothing to send is not taken for silent)
    if (now - this._lastPing >= PING_MS) {
      this._lastPing = now;
      this._updateDelay();
      const w = [], lg = [], e = [];
      for (const p of this.humans) {
        if (p === this.me || this.leftAt.has(p)) continue;
        w.push([p, this._wantFor(p)]);
        if (this.lead.has(p)) lg.push([p, Math.round(this.lead.get(p) * 100) / 100]);
        const x = this._echo.get(p);
        if (x) { e.push([p, x[0], Math.round(now - x[1])]); this._echo.delete(p); }
      }
      this._send('sync', { k: 'pi', t: now, w, lg, dl: this.delay, e });
    } else if (now - (this._lastAnySend || -1e9) >= 1000) this._send('sync', { k: 'ka' });
    // save hashes: re-send ours a few times (messages can be lost)
    // (also after we verified: the others may still be missing ours)
    for (const [id, e] of this._saveH) if (e.mine != null && e.tries < 5 && now - e.sentAt >= 700) { e.tries++; e.sentAt = now; this._send('sync', { k: 'saved', id, h: e.mine }); }
    if (this.isHost && this._startMsg) {
      // (sent a few times even when all acked: lobby members without a slot learn the match started without them)
      const need = this.humans.some(p => !this._startAcks.has(this.peerOf[p]) && !this.leftAt.has(p)) || (this._startSends || 0) < 4;
      if (need && now - this._lastStartSend >= 500 && this.turn < 3000) { this._lastStartSend = now; this._startSends = (this._startSends || 0) + 1; this._send('lobby', { k: 'start', start: this._startMsg }); }
    }
    // drop detection by the authority
    if (this._authority() === this.me) {
      const drops = [];
      for (const p of this.humans) {
        if (p === this.me || this.leftAt.has(p)) continue;
        const gone = this.goneAt.get(p);
        if ((gone != null && now - gone >= DROP_LEFT_MS) || (this.silentAcc.get(p) || 0) >= DROP_SILENT_MS || (this.withheld.get(p) || 0) >= DROP_STALL_MS) {
          // first turn we still lack from that player (at or after our current turn)
          let t = Math.max(this.turn, DELAY);
          while (this.recv.get(p).has(t)) t++;
          drops.push([p, t]);
        }
      }
      if (drops.length) {
        this._applyDrops(drops);
        this._send('sync', { k: 'drop', d: [...this.leftAt] });
        this._lastDropBc = now;
      } else if (this.leftAt.size && now - (this._lastDropBc || 0) >= 1000) {
        this._lastDropBc = now; this._send('sync', { k: 'drop', d: [...this.leftAt] });
      }
    } else {
      // the authority itself may have vanished: after DROP_SILENT_MS of (relay-up) silence the next human takes over
      const a = this._authority();
      if (a !== this.me && ((this.silentAcc.get(a) || 0) >= DROP_SILENT_MS || (this.withheld.get(a) || 0) >= DROP_STALL_MS)) this.goneAt.set(a, now - DROP_LEFT_MS);
    }
    // stall handling
    if (this.stallSince != null) {
      const miss = this._missing(this.turn);
      // late packets usually still arrive (latency); ask for a re-send only after 200 ms of waiting
      if (miss.length && now - this.stallSince >= 200 && now - this._lastNeed >= 300) {
        this._lastNeed = now;
        const need = []; for (let t = this.turn; t <= this.turn + DELAY; t++) need.push(t);
        const relay = now - this.stallSince > 2000 ? 1 : 0;
        if (relay) for (const p of miss) this._relayAsk.set(p, now);
        this._send('sync', { need, of: miss, relay });
      }
      if (now - this.stallSince >= 1000) {
        const relayDown = !up;
        let text;
        if (relayDown) text = 'Sunucuya yeniden bağlanılıyor…';
        else {
          const names = miss.map(p => this.start0.slots[p].name);
          const left = Math.max(0, Math.ceil((DROP_SILENT_MS - Math.max(0, ...miss.map(p => this.silentAcc.get(p) || 0))) / 1000));
          const quiet = miss.some(p => (this.silentAcc.get(p) || 0) >= 5000);
          const held = !quiet && miss.some(p => (this.withheld.get(p) || 0) >= 15000);
          const hleft = Math.max(0, Math.ceil((DROP_STALL_MS - Math.max(0, ...miss.map(p => this.withheld.get(p) || 0))) / 1000));
          text = 'Bekleniyor: ' + names.join(', ') + (quiet ? ' — bağlantı yok, ' + left + ' sn sonra oyundan çıkarılacak' : held ? ' — hamle göndermiyor, ' + hleft + ' sn sonra oyundan çıkarılacak' : '');
        }
        // one 'stall' per stall period ('resume' ends it); text changes meanwhile come as 'stallUpdate'
        if (!this._stallEmitted || text !== this._stallText) {
          const first = !this._stallEmitted;
          this._stallEmitted = true; this._stallText = text;
          this.emit(first ? 'stall' : 'stallUpdate', { waitingFor: miss.map(p => this.start0.slots[p].name), relay: relayDown, text });
        }
      }
    }
  }

  _execTurn(game, turn) {
    // drops that take effect this turn
    for (const [pid, lt] of this.leftAt) {
      if (lt <= turn && !this.leftApplied.has(pid)) {
        this.leftApplied.add(pid);
        try {
          if (typeof game.markLeft === 'function') game.markLeft(pid);
          else if (game.players && game.players[pid]) game.players[pid].left = true;
        } catch { /* ignore */ }
        this.emit('peerLeft', { name: this.start0.slots[pid].name, pid, turn: lt });
      }
    }
    // session commands first (a save sees the state before this turn's game commands, on every client)
    for (const pid of this.humans) {
      if (!this._isActive(pid, turn)) continue;
      for (const [method, args] of this._cmdsFor(pid, turn) || []) {
        if (!SESSION_SET.has(method)) continue;
        this._mix(turn, pid, method, args);
        if (method === '@save') this._execSave(game, turn, pid, args);
        else if (method === '@pause') this._execPause(turn, pid, args);
      }
    }
    game.__inSim = true;
    try {
      for (const pid of this.humans) {
        if (!this._isActive(pid, turn)) continue;
        const cmds = this._cmdsFor(pid, turn) || [];
        for (const [method, args] of cmds) {
          if (SESSION_SET.has(method)) continue;
          this._mix(turn, pid, method, args);
          try { game.execCommand(pid, method, JSON.parse(JSON.stringify(args))); } catch (err) { console.warn('[net] cmd', method, err); }
        }
      }
    } finally { game.__inSim = false; }
    // forget old command lists (keep a window for resend requests after a reconnect)
    if (turn > KEEP_TURNS) for (const m of this.recv.values()) m.delete(turn - KEEP_TURNS);
  }

  _execSave(game, turn, pid, args) {
    const id = String(args[0] || '').slice(0, 40), auto = !!args[1];
    if (!id || this._saveH.has(id) && this._saveH.get(id).mine != null) return;
    let h = 0; try { h = typeof game.hash === 'function' ? game.hash() >>> 0 : 0; } catch { /* ignore */ }
    if (!this._saveParts) this._saveParts = new Map();
    this._saveParts.set(id, { tick: game.tick | 0, parts: hashParts(game) }); if (this._saveParts.size > 8) this._saveParts.delete(this._saveParts.keys().next().value);
    this._noteSaveHash(id, this.me, h, true);
    const e = this._saveH.get(id); e.h = h; e.sentAt = this.clock.now(); e.tries = 1;
    this._send('sync', { k: 'saved', id, h });
    const by = this.start0 && this.start0.slots[pid] ? this.start0.slots[pid].name : '?';
    this.emit('save', { id, auto, by, byPid: pid, turn, tick: game.tick, hash: h, game });
  }

  // compare the save hashes of all humans (every client serialized the same tick)
  _noteSaveHash(id, pid, h, mine) {
    let e = this._saveH.get(id);
    if (!e) { e = { mine: null, peers: new Map(), done: false }; this._saveH.set(id, e); if (this._saveH.size > 20) this._saveH.delete(this._saveH.keys().next().value); }
    if (mine) e.mine = h >>> 0; else e.peers.set(pid, h >>> 0);
    if (e.mine == null || e.done) return;
    for (const [p, ph] of e.peers) if (ph !== e.mine) {
      e.done = true;
      const nm = (q) => (this.start0 && this.start0.slots[q] ? this.start0.slots[q].name : '?');
      const sp = this._saveParts && this._saveParts.get(id);
      this.emit('saveMismatch', { id, pid: p, name: nm(p), mine: e.mine, peers: [...e.peers].map(([q, hh]) => ({ pid: q, name: nm(q), h: hh >>> 0 })), tick: sp ? sp.tick : null, parts: sp ? sp.parts : null });
      return;
    }
    const others = this.humans.filter(p => p !== this.me && !this.leftAt.has(p));
    if (others.every(p => e.peers.has(p))) { e.done = true; this.emit('saveVerified', { id, players: others.length + 1 }); }
  }

  _mix(turn, pid, method, args) {
    const s = turn + '|' + pid + '|' + method + '|' + JSON.stringify(args);
    let h = this.streamHash;
    for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
    this.streamHash = h; this.execCount++;
    if (this._log) this._log.push([turn * TURN_TICKS, pid, method, JSON.stringify(args)]);
  }

  // called every frame instead of game.update
  advance(game, dt) {
    if (this.phase !== 'game') return 0;
    this._game = game;
    // pacing: a client running ahead of the others slows down a little instead of hitting stalls (see _onPing)
    this._acc += Math.max(0, Math.min(dt, 1)) * (this._slow ? SLOW : 1);
    let steps = 0;
    while (this._acc >= STEP - 1e-9 && steps < 6) {
      if (this.tick % TURN_TICKS === 0) {
        const turn = this.tick / TURN_TICKS;
        // state hash at the start of every HASH_EVERY-th turn (sent with our next turn packet)
        if (turn % HASH_EVERY === 0 && !this.myHashes.has(turn) && typeof game.hash === 'function') {
          const h = game.hash() >>> 0;
          this.myHashes.set(turn, h); this._hx = { h, ht: turn };
          // desync diagnostics: a per-section summary of the same state (read-only), logged if the hashes differ
          if (!this.myParts) this.myParts = new Map();
          this.myParts.set(turn, hashParts(game)); if (this.myParts.size > 24) this.myParts.delete(this.myParts.keys().next().value);
          this._checkHash(turn);
        }
        // our command lists run `delay` turns ahead; a raised delay fills the gap with empty lists
        // (each turn's list is explicit, so the delay may differ between players and change at any time)
        const n0 = this._unsent || 0;
        while (this.sentUpTo < turn + this.delay) this._scheduleOwn(this.sentUpTo + 1);
        if ((this._unsent || 0) - n0 > 1) this._flushTurn();
        if (this._missing(turn).length) {
          if (this.stallSince == null) { this.stallSince = this.clock.now(); this._lastNeed = 0; this._noteStall(turn); }
          this._pump();
          // no catch-up burst after the wait (units would jump): the lost time is simply not replayed
          if (this._acc > STEP) this._acc = STEP;
          break;
        }
        if (this.stallSince != null) {
          if (this._stallEmitted) this.emit('resume', {});
          this.stallSince = null; this._stallEmitted = false;
        }
        this.turn = turn;
        this._execTurn(game, turn);
      }
      // (paused: turns keep flowing so the resume command can arrive, but the simulation stands still - on every client from the same turn)
      if (!this.paused) {
        game.__inSim = true;
        try { game.update(STEP); } finally { game.__inSim = false; }
      }
      this.tick++; this._acc -= STEP; steps++;
      if (this.tick % TURN_TICKS === 0) this.turn = this.tick / TURN_TICKS;
    }
    if (this._unsent && this.clock.now() - (this._lastTurnSend || -1e9) >= 90) this._flushTurn();
    return steps;
  }

  close(reason = 'left') {
    if (this.phase === 'closed') return;
    try { this._send('sync', { k: 'bye' }); } catch { /* ignore */ }
    this.phase = 'closed';
    for (const h of this._timers) { try { this.clock.clearInterval(h); } catch { /* ignore */ } }
    this._timers = [];
    try { this.t.close(); } catch { /* ignore */ }
    this.emit('closed', { reason });
  }
}
// continue a saved match, client: the app's check of the downloaded save, async (data, {match, tick}) -> null when
// fine or not checkable, else the Turkish reason the match is refused (see main.js)
NetSession.checkResume = null;
