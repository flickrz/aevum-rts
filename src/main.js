// Aevum - application bootstrap and main loop.
import { TEST_MODE, TEST_PROFILE } from './testmode.js';
import { Game } from './sim/game.js';
import { Renderer } from './render/renderer.js';
import { UI } from './ui/ui.js';
import { Input } from './input.js';
import { AudioManager } from './audio.js';
import * as storage from './storage.js';
import * as profile from './profile.js';
import { CloudSync, mergeSaveLists } from './cloud/sync.js';
import { setChatSink } from './chatlog.js';
import { engineFamily } from './net/hashparts.js';
import { LATEST } from './changelog.js';
import { FIREBASE } from './cloud/config.js';
import { AUTH_KEY } from './cloud/auth.js';
import { GoogleSignIn } from './cloud/google.js';
import { createNotice, markInterrupted, clearInterrupted } from './net/notice.js';
import { mountNoticeBanner, hostNameOf } from './ui/notice-ui.js';
import { tr, loc } from './i18n.js';

const STEP = 1 / 30;
const AUTOSAVE_EVERY = 90;
const MP_AUTOSAVE_TICKS = 5 * 60 * 30;
const ABANDON_MIN_S = 30;                 // a game left before the end is recorded as 'abandoned' only after 30 game seconds
// update notices from the server (GET /mp/notice every 20 s, src/net/notice.js): started at once, so the first build id
// it sees (this tab's baseline) is the one these files came from
const notice = createNotice();
try { notice.start(); } catch (err) { console.warn('[notice]', err); }
const LS = (() => { try { return window.localStorage; } catch (err) { return null; } })();
let memProfile = null;
// optional Firebase account (src/cloud/*): null when it could not start; every call site works without it
let cloud = null;
const saveIndex = new Map();   // key -> item of the last merged (local + cloud) save list
const cloudOn = () => !!(cloud && cloud.loggedIn);
const cloudSafe = (fn) => { try { if (cloud) fn(cloud); } catch (err) { console.warn('[cloud]', err); } };
// the id of a match for the cloud upload gate: single player match id / 'mp-' + match code
function gameIdOf(game) { const c = game && histCtx.get(game); return c ? (c.mode === 'mp' ? 'mp-' + c.match : c.matchId) : null; }
// match history context per Game (UI/session metadata, never part of the simulation):
// {mode 'sp'|'mp', matchId (sp) | match (mp code), uids [uid|null per player], done}
const histCtx = new WeakMap();   // multiplayer: the host requests a lockstep autosave every 5 game minutes
// commands that travel over the network in a multiplayer match (same list as Game.execCommand's whitelist)
const NET_METHODS = ['cmdMove', 'cmdAttack', 'cmdGather', 'cmdBuild', 'cmdStop', 'cmdExplore', 'cmdBoard', 'cmdUnload',
  'cmdReturn', 'placeBuilding', 'placeLine', 'train', 'research', 'ageUp', 'cancelQueue', 'setRally', 'trade', 'deleteEntity', 'cmdOpenGate', 'cmdTribute', 'cmdGroup', 'cmdStance', 'cmdFormation', 'cmdAttackMove', 'cmdPatrol', 'cmdRotateBuilding'];

function showError(err) {
  console.error(err);
  let el = document.getElementById('boot-error');
  if (!el) {
    el = document.createElement('div');
    el.id = 'boot-error';
    el.style.cssText = 'position:fixed;left:0;right:0;top:0;z-index:99999;background:#5a1010;color:#fff;' +
      'font:14px/1.5 monospace;padding:12px 16px;white-space:pre-wrap;max-height:50vh;overflow:auto;pointer-events:auto';
    document.body.appendChild(el);
  }
  el.textContent = tr('Aevum bir hatayla karşılaştı:\n') + (err && (err.stack || err.message) || String(err));
}

const app = {
  game: null, renderer: null, ui: null, input: null, audio: null,
  selection: [], paused: false, demo: false, lastAlert: null,
  net: null, me: 0,
  notice,

  select(ids, silent = false) {
    const g = app.game;
    const seen = new Set();
    app.selection = (ids || []).filter(id => {
      if (seen.has(id)) return false;
      seen.add(id);
      const e = g && g.getEntity(id);
      return e && !e.dead;
    });
    try { app.renderer.setSelection(app.selection); } catch (err) { console.warn(err); }
    try { app.ui.onSelectionChanged(app.selection); } catch (err) { console.warn(err); }
    if (!silent && app.selection.length) { app.audio?.ui('select'); app.audio?.voice?.(app.selection, 'select'); }
  },

  startPlacement(type) { if (!app.demo) app.input.startPlacement(type); },
  cancelPlacement() { app.input.cancelPlacement(); },
  commandGround(x, z) { if (!app.demo) app.input.commandGround(x, z, false); },

  focus(x, z) {
    const cam = app.renderer.cam;
    cam.tx = x; cam.tz = z;
  },

  newGame(cfg) {
    const full = Object.assign({
      mapSize: 320, enemies: 1, difficulty: 'normal', startRes: 'normal',
      startAge: 0, sandbox: false, seed: (Math.random() * 1e9) | 0, fog: 'explored',
    }, cfg || {});
    attachGame(new Game(full), false);
    if (!full.sandbox && !full.tutorial) histCtx.set(app.game, { mode: 'sp', matchId: profile.newMatchId(), mt: tpStart('sp') });   // (the tutorial: no match history, no TP)
    return app.game;
  },

  // multiplayer: session is a connected NetSession (after its 'start' event), cfg the Game cfg it produced
  startMultiplayer(session, cfg) {
    if (app.net && app.net !== session) { try { app.net.close(); } catch (err) { /* ignore */ } }
    app.net = null;
    const full = Object.assign({
      mapSize: 320, difficulty: 'normal', startRes: 'normal', startAge: 0, sandbox: false,
    }, cfg || {}, { mp: true });
    let game;
    if (session.resumeData) {
      // continuing a saved match: every client loads the same bytes, with its own `me`
      game = Game.deserialize(session.resumeData, { me: full.me | 0 });
      session.resumeData = null;
      game.mp = true;
      try { game.applyResume(full.resume); } catch (err) { console.warn('[resume]', err); }
    } else game = new Game(full);
    if (game.mp == null) game.mp = true;           // fallbacks in case the sim does not set them itself
    if (game.me == null) game.me = full.me | 0;
    // the whole map shows only when the match opens it (own defeat, match over): a console 'app.game.reveal = true'
    // would show one player everything without anybody noticing (view only: the simulation never reads it)
    Object.defineProperty(game, 'reveal', { configurable: false, get: () => !!(game.over || (game.players[game.me] && game.players[game.me].defeated)), set: () => {} });
    wrapNetCommands(game);
    app.net = session;
    attachGame(game, false);
    histCtx.set(game, {
      mode: 'mp', match: session.match || session.code || 'MP',
      uids: ((session.start0 && session.start0.slots) || []).map(s => (s && s.kind === 'human' ? profile.cleanUid(s.uid) : null)),
      mt: tpStart('mp', session.match || session.code || null, game.players[game.me] ? game.players[game.me].team : null),
    });
    app._mpAutoAt = game.tick + MP_AUTOSAVE_TICKS;
    // the match cut by an update runs again: the main menu's "Kesilen maça devam et" is done
    if (full.resume) clearInterrupted(session.match || null);
    game.events.on('gameOver', () => clearInterrupted(session.match || session.code || null));
    const status = (type, text, extra) => { try { app.ui.netStatus?.(Object.assign({ type, text }, extra || {})); } catch (err) { console.warn(err); } };
    const notify = (text, type) => { try { game.events.emit('notify', { text, type }); } catch (err) { console.warn(err); } };
    const offs = [];
    const on = (n, f) => { const off = session.on(n, f); if (typeof off === 'function') offs.push(off); };
    const stallText = ev => (ev && ev.text) || ('Bekleniyor: ' + ((ev && ev.waitingFor) || []).join(', '));
    on('stall', ev => status('stall', stallText(ev), ev));
    on('stallUpdate', ev => status('stall', stallText(ev), ev));
    on('resume', () => status('resume', ''));
    // lockstep save: every client serializes the same tick and keeps it in its own IndexedDB
    on('save', ev => { if (app.game === game) saveMpRecord(session, game, ev); });
    // desyncs are written to the cloud (each client its own view of it) so the cause can be found: tools/read-desync.mjs
    const logDesync = (kind, ev) => {
      try {
        if (!app.cloud || !app.cloud.loggedIn || typeof app.cloud.logDesync !== 'function') return;
        const d = new Date(), pad = n => String(n).padStart(2, '0');
        app.cloud.logDesync({ kind, t: d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds()),
          room: String(session.room || ''), me: session.me, name: String(session.name || ''), version: LATEST, engine: engineFamily(), players: (session.humans || []).length,
          tick: ev && ev.tick, ht: ev && ev.ht, saveId: ev && ev.id, mine: ev && ev.mine, peers: (ev && ev.peers) || [], parts: (ev && ev.parts) || null, now: game.tick | 0,
          map: { size: game.cfg && game.cfg.mapSize, type: game.cfg && game.cfg.mapType, seed: game.cfg && game.cfg.seed } });
      } catch (err) { console.warn('[desync log]', err); }
    };
    on('saveMismatch', ev => { logDesync('save', ev); notify(tr('⚠ Kayıt {0} ile farklı çıktı (senkron sorunu olabilir).', (ev && ev.name) || tr('diğer oyuncu')), 'warn'); });
    // (2026-11-23, room Q8YQ7: one client split off at minute 1 and played 80 minutes in its own world with only a 6 s
    // toast) the vote says who split off; that player gets a banner that stays, the others are told whose screen is wrong
    on('desync', ev => {
      logDesync('desync', ev);
      const names = (l) => (l || []).map(x => x.name).join(', ');
      if (ev && ev.diverged) status('desync', tr('⚠ Senin oyunun diğerlerinden ayrıldı (tik {0}): gördüğün, gerçek maç değil. Maçı kaydedin; {1} kaydı "Kayıtlı Maça Devam Et" ile açsın.', ev.tick, names(ev.good) || tr('diğer oyuncu')), Object.assign({}, ev, { sticky: true }));
      else if (ev && ev.odd && ev.odd.length) status('desync', tr('Senkron bozuldu (tik {0}): {1} oyunu ayrıldı, onun ekranı gerçek maçı göstermiyor. Maçı kaydedip senin kaydınla yeniden açabilirsiniz.', ev.tick, names(ev.odd)), ev);
      else status('desync', tr('Senkron bozuldu (tik {0}). Oyunlar farklılaştı; durum kayda geçti.', ev && ev.tick), ev);
    });
    on('peerLeft', ev => {
      status('peerLeft', tr('{0} oyundan ayrıldı.', (ev && ev.name) || tr('Bir oyuncu')), ev);   // netStatus toasts it
    });
    on('chat', ev => status('chat', (ev ? ev.name + ': ' + ev.text : ''), ev));
    // the match was paused / resumed for everybody (the menu shows itself while paused)
    on('pause', ev => { try { app.ui.toast?.((ev.paused ? '⏸ ' : '▶ ') + (ev.paused ? tr('{0} oyunu duraklattı', ev.by || tr('Bir oyuncu')) : tr('{0} oyunu devam ettirdi', ev.by || tr('Bir oyuncu'))), 'info'); if (!ev.paused) app.ui.menuOpen = false; app.ui._syncPauseMenu?.(); } catch (err) { console.warn(err); } });
    // a teammate's map flare (enemies' flares are not shown)
    on('flare', ev => { try { if (app.game === game && ev && game.isAlly?.(game.me, ev.pid) !== false) app.ui.showFlare?.(ev); } catch (err) { console.warn(err); } });
    on('closed', ev => {
      offs.forEach(f => { try { f(); } catch (err) { /* ignore */ } });
      if (app.net === session) {
        app.net = null;
        if (app.game === game) app.paused = true;   // the match cannot continue without the lockstep
        status('closed', ev && ev.reason === 'dropped' ? tr('Bağlantı koptu, oyundan düşürüldün.') : tr('Çok oyunculu oturum kapandı.'), ev);
      }
    });
    return game;
  },

  // map flare at (x, z): shown here and sent to the teammates (multiplayer)
  flare(x, z) {
    const game = app.game; if (!game || app.demo) return false;
    const N = game.map ? game.map.size : 0;
    x = Math.max(0, Math.min(N, x)); z = Math.max(0, Math.min(N, z));
    if (app.net && game.mp) { if (!app.net.flare(x, z)) return false; }
    try { app.ui.showFlare?.({ pid: game.me, name: tr('Sen'), x, z, mine: true }); } catch (err) { console.warn(err); }
    return true;
  },

  leaveMultiplayer() {
    const s = app.net; app.net = null;
    if (s) { try { s.close(); } catch (err) { console.warn(err); } }
    app.toMenu();
  },

  // test hook: runs n lockstep / single-player frames of one tick each, without requestAnimationFrame
  debugStep(n = 1) {
    const game = app.game; if (!game) return 0;
    let ran = 0;
    for (let i = 0; i < n; i++) {
      if (app.net && game.mp) ran += app.net.advance(game, STEP) || 0;
      else if (!app.paused && !game.over) { game.update(STEP); ran++; }
    }
    return ran;
  },

  async saveGame(key) {
    // multiplayer: a lockstep save request; every client saves when it executes (see saveMpRecord)
    if (app.game && app.game.mp) return !!(app.net && app.net.phase === 'game' && app.net.requestSave(key === 'auto'));
    if (!app.game || app.demo || app.game.mp) return false;
    // the tutorial is never saved (autosave, F5, hidden tab): closing it starts it again from the menu
    if (app.game.cfg.tutorial) { if (key !== 'auto') app.game.events.emit('notify', { text: tr('Öğretici modunda kayıt kapalı.'), type: 'info' }); return false; }
    const auto = key === 'auto';
    const time = Date.now();
    const k = key || ('manual-' + time);
    const d = new Date(time);
    const stamp = d.toLocaleDateString(loc()) + ' ' + d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
    let ok = false;
    try {
      const hc = histCtx.get(app.game);
      // the autosave slot still holds another match that has not reached the cloud yet: keep it (see keepAutoSlot)
      if (auto && cloudOn()) { try { await cloud.keepAutoSlot(hc && hc.matchId); } catch (err) { console.warn('[save]', err); } }
      ok = await storage.put(k, { name: (auto ? tr('Otomatik Kayıt — ') : tr('Kayıt — ')) + stamp, time, matchId: hc && hc.matchId, owner: ownerUid(), data: app.game.serialize() });
      if (ok) cloudSafe(c => c.onSaved(k, { auto, game: hc && hc.matchId }));
    } catch (err) { console.warn('[save]', err); }
    if (!auto || !ok) {
      app.game.events.emit('notify', ok
        ? { text: tr('Oyun kaydedildi.'), type: 'good' }
        : { text: tr('Oyun kaydedilemedi!'), type: 'warn' });
    }
    return ok;
  },

  async loadGame(key) {
    if (app.net) return false;
    app.lastLoadError = '';
    let rec;
    try { rec = await app.getSave(key); } catch (err) { app.lastLoadError = (err && err.message) || tr('Kayıt indirilemedi.'); return false; }
    try {
      if (!rec || !rec.data || rec.mp) { app.lastLoadError = tr('Kayıt okunamadı.'); return false; }   // multiplayer saves continue through "Kayıtlı Maça Devam Et"
      attachGame(Game.deserialize(rec.data), false);
      // the same match id as before the save: finishing a loaded game updates its one history record
      if (!app.game.cfg.sandbox && !app.game.cfg.tutorial) histCtx.set(app.game, { mode: 'sp', matchId: /^[0-9a-f]{16}$/.test(rec.matchId || '') ? rec.matchId : profile.newMatchId(), mt: tpStart('sp') });
      return true;
    } catch (err) { showError(err); return false; }
  },

  // single-player saves only (multiplayer records live under 'mp-...' and are listed by listMpSaves).
  // Logged in: local and cloud saves together (item.cloud 'none' | 'synced' | 'newer' | 'only', see cloud/sync.js)
  // opts.fresh: the save screens (the cloud list is read again when it is older than 5 minutes; else 30)
  listSaves(opts) { return mergedSaves(false, opts); },
  listMpSaves(opts) { return mergedSaves(true, opts); },
  // a save record; a cloud-only (or newer cloud) copy is downloaded, verified and cached locally first
  async getSave(key) {
    const it = saveIndex.get(key);
    if (cloudOn() && it && (it.cloud === 'only' || it.cloud === 'newer')) {
      try { const rec = await cloud.downloadSave(it.ck, key); saveIndex.set(key, Object.assign({}, it, { cloud: 'synced' })); return rec; } catch (err) {
        const local = it.cloud === 'newer' ? await storage.get(key) : null;
        if (local) { console.warn('[cloud] download failed, using the local copy', err); return local; }
        throw new Error(tr('Buluttaki kayıt indirilemedi: {0}', (err && err.message) || err));
      }
    }
    return storage.get(key);
  },
  // opts.cloud: also delete the cloud copy -> {ok, error}
  async deleteSave(key, opts = {}) {
    const it = saveIndex.get(key);
    if (opts.cloud && it && it.ck && cloudOn()) {
      try { await cloud.deleteCloudSave(it.ck); } catch (err) { return { ok: false, error: tr('Buluttan silinemedi ({0}).', err && err.kind === 'network' ? tr('çevrimdışı') : (err && err.message) || err) }; }
    }
    if (!it || it.cloud !== 'only') await storage.del(key);
    saveIndex.delete(key);
    return { ok: true, error: '' };
  },

  async continueLast() {
    app.lastLoadError = '';
    const saves = await app.listSaves();
    if (!saves.length) return false;
    return app.loadGame(saves[0].key);
  },

  toMenu() {
    if (app.net) { const s = app.net; app.net = null; try { s.close(); } catch (err) { console.warn(err); } }
    app.cancelPlacement();
    startDemo();
    app.ui.showMenu();
  },

  // ---------- profile + match history (local only) ----------
  // memProfile: the profile of this session when localStorage is blocked / full (the game stays playable)
  getProfile() { return memProfile || profile.loadProfile(LS) || (TEST_MODE ? TEST_PROFILE : null); },
  get cloud() { return cloud; },
  profileSaved() { return !memProfile; },
  createProfile(name) { const p = profile.createProfile(LS, name); memProfile = p.saved ? null : p; return p; },
  renameProfile(name) {
    // the account profile's name is unique in the cloud: it is renamed through the Profil screen (cloud.rename)
    if (cloudOn()) return { ok: false, profile: app.getProfile(), error: tr('Hesabına bağlı adını Profil ekranından değiştirebilirsin.'), saved: false };
    const r = profile.renameProfile(LS, name, memProfile);
    if (r.ok && (memProfile || !r.saved)) memProfile = r.saved && profile.loadProfile(LS) ? null : r.profile;
    return r;
  },
  replaceProfile(p) { const ok = profile.saveProfile(LS, p); memProfile = ok ? null : Object.assign({ v: 1, uid: p.uid, name: p.name, created: p.created }, p.avatar ? { avatar: p.avatar } : {}); return ok; },
  clearProfile() { memProfile = null; profile.clearProfile(LS); },
  // a deleted account: its cached history and saves leave this PC too
  async forgetLocalData(uid) {
    const hist = (await storage.historyList()).filter(r => r && r.uid === uid).map(r => r.id);
    if (hist.length) await storage.historyDelete(hist);
    for (const s of await storage.list()) if (s.owner === uid) await storage.del(s.key);
    saveIndex.clear();
  },
  // the records of the current profile (a guest who never logged in: all of them, as before)
  async listHistory() { const all = await storage.historyList(); return cloud ? cloud.visibleHistory(all) : all; },
  async putHistory(recs) { const ok = await storage.historyPut(recs); if (ok) cloudSafe(c => c.onRecords([recs].flat())); return ok; },
  // -> true, or a Turkish error (logged in: the cloud copies go first; nothing is deleted when that fails)
  async clearHistory() {
    if (!cloud || (!cloud.loggedIn && !cloud.accountUids().length)) return storage.historyClear();
    const ids = (await app.listHistory()).map(r => r.id);
    if (cloud.loggedIn) { try { await cloud.deleteHistory(ids); } catch (err) { return tr('Buluttaki geçmiş silinemedi ({0}).', err && err.kind === 'network' ? tr('çevrimdışı') : (err && err.message) || err); } }
    return storage.historyDelete(ids);
  },
  recordGame(game, final) { return recordGame(game || app.game, !!final); },

  setPaused(b) {
    app.paused = !!b && !(app.game && app.game.mp);
    try { app.ui.onPaused?.(app.paused); } catch (err) { /* optional */ }
  },
};
window.app = app;

let acc = 0, autosaveT = 0;

// In a multiplayer match the UI/input keep calling game.cmdMove(...) etc.; those calls are queued on the
// network instead. Calls made from inside the simulation (AI controllers during game.update, nested calls
// while the lockstep executor runs execCommand) set game.__inSim and go straight to the real method.
function wrapNetCommands(game) {
  for (const m of NET_METHODS) {
    const orig = Game.prototype[m];
    if (typeof orig !== 'function') continue;
    game[m] = function (...args) {
      if (game.__inSim || !app.net || app.game !== game) return orig.apply(game, args);
      app.net.issue(m, args);
      return true;
    };
  }
}

// called synchronously from the lockstep (session 'save' event): the state is the same tick on every client
function saveMpRecord(session, game, ev) {
  let rec, key;
  try {
    const time = Date.now(), d = new Date(time);
    const stamp = d.toLocaleDateString(loc()) + ' ' + d.toLocaleTimeString(loc(), { hour: '2-digit', minute: '2-digit' });
    const match = session.match || session.code || 'MP';
    const humans = game.players.filter(p => !p.isAI).map(p => p.name).join(', ');
    const mins = Math.floor(game.tick / 1800);
    rec = {
      name: (ev.auto ? tr('Çok Oyunculu Otomatik — ') : tr('Çok Oyunculu — ')) + stamp + ' · ' + humans + ' · ' + tr('{0}. dk', mins),
      time, mp: true, code: match, tick: game.tick, me: game.me, hash: ev.hash, by: ev.by, owner: ownerUid(),
      // uid: profile identity of the human in that slot (save metadata only; matched first when the match is continued)
      players: game.players.map((p, i) => ({ name: p.name, uid: p.isAI ? null : profile.cleanUid(session.start0 && session.start0.slots && session.start0.slots[i] && session.start0.slots[i].uid), team: p.team, kind: p.isAI ? 'ai' : 'human', difficulty: p.difficulty || null, color: p.color, left: !!p.left, defeated: !!p.defeated })),
      data: game.serialize(),
    };
    key = storage.MP_PREFIX + match + '-' + (ev.auto ? 'auto' : game.tick);
  } catch (err) { console.warn('[mp save]', err); game.events.emit('notify', { text: tr('Oyun kaydedilemedi!'), type: 'warn' }); return; }
  storage.put(key, rec).then(ok => {
    if (!ok) game.events.emit('notify', { text: tr('Oyun kaydedilemedi!'), type: 'warn' });
    else if (!ev.auto) game.events.emit('notify', { text: tr('Oyun kaydedildi (çok oyunculu)') + (ev.by && ev.byPid !== game.me ? tr(' — {0} kaydetti', ev.by) : ''), type: 'good' });
    if (ok) cloudSafe(c => c.onSaved(key, { auto: !!ev.auto, game: 'mp-' + rec.code }));
  }).catch(err => console.warn('[mp save]', err));
}

// one history record per match: on gameOver (final), or when a running game is left / replaced ('abandoned').
// Keyed by match id, so a loaded / continued match that ends replaces its earlier 'abandoned' record.
function recordGame(game, final) {
  const ctx = game && histCtx.get(game);
  if (!ctx || ctx.done || game.cfg.sandbox || game.cfg.demo || game.cfg.tutorial) return Promise.resolve(null);
  const me = game.me | 0, mine = game.players[me];
  if (!final && !game.over && !(mine && mine.defeated) && (game.time || 0) < ABANDON_MIN_S) return Promise.resolve(null);
  const p = app.getProfile();
  if (!p) return Promise.resolve(null);
  let rec;
  try {
    const id = ctx.mode === 'mp' ? profile.mpRecordId(ctx.match, p.uid) : profile.spRecordId(ctx.matchId);
    rec = profile.buildRecord(game, { mode: ctx.mode, id, uids: ctx.uids || [], myUid: p.uid, myName: p.name });
  } catch (err) { console.warn('[history]', err); return Promise.resolve(null); }
  ctx.done = true;
  return (async () => {
    // never turn a finished result back into 'abandoned' (e.g. an older save of a won game was loaded and left)
    if (rec.result === 'abandoned') { const old = await storage.historyGet(rec.id); if (old && old.result !== 'abandoned') return old; }
    if (await storage.historyPut(rec)) cloudSafe(c => c.onRecord(rec));
    if ((rec.result === 'won' || rec.result === 'lost') && ctx.mt && cloud && cloud.loggedIn) {
      // TP: the server turns the match ticket of this match into points on the signed ledger
      const mt = await ctx.mt;
      const r = mt ? await cloud.tpClaim(mt, rec.result) : null;
      if (r && r.gained) notifyTp(game, tr('🏅 +{0} TP (toplam {1} TP)', r.gained, r.tp), 'good');
      else if (r && r.reason) notifyTp(game, '🏅 ' + r.reason, 'info');
    }
    return rec;
  })().catch(err => { console.warn('[history]', err); return null; });
}

// the profile uid that owns new saves (the signed-in account)
function ownerUid() { const p = app.getProfile(); return p ? p.uid : null; }
// a server match ticket for the TP of a match that starts now (a promise; null without account / server)
// player statistics (srv/stats.mjs): every open tab tells the server once a minute that it is here and what it is
// doing. Only a random id of this browser is sent (plus the relay ticket when one is at hand), nothing else.
function startBeat() {
  let vid = null;
  try { vid = LS && LS.getItem('aevum.vid'); } catch (err) { vid = null; }
  if (!/^[A-Za-z0-9]{8,32}$/.test(vid || '')) {
    const a = new Uint8Array(12); crypto.getRandomValues(a);
    vid = Array.from(a, b => (b % 36).toString(36)).join('');
    try { LS && LS.setItem('aevum.vid', vid); } catch (err) { /* private mode: a new id per visit */ }
  }
  const beat = () => {
    try {
      const s = app.net ? 'mp' : (app.game && !app.demo && app.ui && app.ui.mode === 'hud') ? 'sp' : 'menu';
      const tk = cloud && cloud.ticketNow ? cloud.ticketNow() : null;
      fetch('/mp/beat?v=' + vid + '&s=' + s + (tk ? '&tk=' + encodeURIComponent(tk) : ''), { cache: 'no-store', keepalive: true }).catch(() => {});
    } catch (err) { /* never matters */ }
  };
  setTimeout(beat, 3000);
  setInterval(beat, 60 * 1000);
}

function tpStart(mode, room, team) { return cloudOn() ? cloud.tpStart(mode, room, team).catch(() => null) : Promise.resolve(null); }
function notifyTp(game, text, type) {
  try { if (app.game === game) game.events.emit('notify', { text, type }); else app.ui.toast?.(text, type); } catch (err) { console.warn(err); }
}
// the local saves of the signed-in account (+ its cloud saves). Saves of other accounts used on this PC stay hidden;
// saves from before accounts (no owner) are taken over by the first account that lists them.
async function mergedSaves(mp, opts = {}) {
  if (!cloudOn()) return [];
  const me = ownerUid();
  const pick = s => (mp ? !!s.mp : !s.mp && !storage.isMpKey(s.key));
  const all = (await storage.list()).filter(pick);
  for (const s of all) {
    if (s.owner || !me) continue;
    try { const rec = await storage.get(s.key); if (rec && !rec.owner) { rec.owner = me; await storage.put(s.key, rec); } s.owner = me; } catch (err) { console.warn('[saves]', err); }
  }
  const local = all.filter(s => s.owner === me);
  let remote = [];
  try { remote = (await cloud.listCloudSaves({ maxWait: 3000, fresh: !!(opts && opts.fresh) })).filter(pick); } catch (err) { remote = []; }
  const list = mergeSaveLists(local, remote);
  for (const it of list) saveIndex.set(it.key, it);
  return list;
}

function initCloud() {
  try {
    cloud = new CloudSync({
      fetch: (u, init) => fetch(u, init), apiKey: FIREBASE.apiKey, projectId: FIREBASE.projectId, ls: LS, authTimers: true,
      guestless: true,   // signing in is required: signing out leaves no local profile
      // sign in with Google: the Firebase SDK is loaded from gstatic only when the button is used
      google: new GoogleSignIn({ config: FIREBASE, ss: (() => { try { return window.sessionStorage; } catch (err) { return null; } })() }),
      profile: { get: () => app.getProfile(), set: p => app.replaceProfile(p), create: n => app.createProfile(n), clear: () => app.clearProfile() },
      history: { list: () => storage.historyList(), get: id => storage.historyGet(id), put: r => storage.historyPut(r), del: ids => storage.historyDelete(ids) },
      saves: { list: () => storage.list(), get: k => storage.get(k), put: (k, v) => storage.put(k, Object.assign(v, { owner: ownerUid() })), del: k => storage.del(k) },
    });
    setChatSink(e => cloud && cloud.loggedIn ? cloud.logChat(e) : null);   // the chat lines this player sends -> Firestore
    // in a game: a short toast when the cloud stops working (playing goes on; the queue is retried later)
    let lastStatus = cloud.status;
    cloud.onChange(st => {
      if (st === lastStatus) return;
      const prev = lastStatus; lastStatus = st;
      const ui = app.ui; if (!ui || ui.mode !== 'hud') return;
      if (st === 'offline') ui.hint?.('cloud-offline', tr('☁ Bulut bağlantısı yok; kayıtlar ve maç geçmişi sonra gönderilecek.'), 'warn', 120);
      else if (st === 'expired') ui.hint?.('cloud-expired', tr('☁ Hesap oturumu sona erdi; Profil ekranından tekrar giriş yap.'), 'warn', 300);
      else if (st === 'synced' && prev === 'offline') ui.hint?.('cloud-back', tr('☁ Bulut bağlantısı geri geldi.'), 'info', 120);
    });
    window.addEventListener('online', () => cloudSafe(c => c.kick({ pull: 'lazy' })));
    // another tab signed out / into another account: this tab follows (never revives a session signed out there)
    window.addEventListener('storage', ev => {
      if (ev.key !== AUTH_KEY && ev.key !== null) return;
      cloudSafe(c => c.onAuthStorage());
      if (!cloudOn() && app.ui && app.ui.mode === 'menu') { try { app.ui._menuMain(); } catch (err) { console.warn(err); } }
    });
    cloud.start();
  } catch (err) { console.warn('[cloud] disabled', err); cloud = null; }
}

function attachGame(game, demo) {
  if (app.game && app.game !== game && !app.demo) {
    recordGame(app.game, false);
    const gid = gameIdOf(app.game);
    if (gid) cloudSafe(c => c.onLeave(gid));   // the autosave that waited for the cloud's 5 minute gate goes up now
  }
  if (!game.mp && app.net) { const s = app.net; app.net = null; try { s.close(); } catch (err) { console.warn(err); } }
  app.demo = demo;
  if (app.audio) { app.audio.demo = !!demo; app.audio.setMenuMusic?.(!!demo); }   // (menu music with the menu's background battle, no battle music there)
  app.game = game;
  app.me = game.me != null ? game.me : 0;
  app.selection = [];
  app.paused = false;
  app.lastAlert = null;
  acc = 0; autosaveT = 0;
  app.input?.reset();
  if (!demo) try { app.input?.restoreGroups?.(game); } catch (err) { console.warn('[groups]', err); }   // control groups saved with the game
  app.renderer.setGame(game);
  try { app.renderer.setSelection([]); } catch (err) { /* ignore */ }
  const p = game.players[app.me] || game.players[0];
  const cam = app.renderer.cam;
  cam.tx = p.startX; cam.tz = p.startZ;
  if (demo) { cam.dist = 46; } else { cam.dist = 34; }
  try { app.audio.attach(game); } catch (err) { console.warn(err); }
  game.events.on('notify', ev => { if (ev && ev.x != null && ev.z != null) app.lastAlert = { x: ev.x, z: ev.z }; });
  game.events.on('underAttack', ev => { if (ev) app.lastAlert = { x: ev.x, z: ev.z }; });
  if (!demo) {
    game.events.on('gameOver', () => { recordGame(game, true); });
    app.ui.onNewGame(game);
    app.ui.showHUD();
    try { app.ui.onSelectionChanged([]); } catch (err) { /* ignore */ }
  }
}

function startDemo() {
  try {
    attachGame(new Game({
      mapSize: 96, enemies: 1, difficulty: 'normal', startRes: 'high',
      startAge: 1, sandbox: true, seed: (Math.random() * 1e9) | 0, demo: true,
    }), true);
  } catch (err) { showError(err); }
}

// an update comes (the server's notice, ~15 s before its time; src/net/notice.js): save the running match.
// Multiplayer: the host requests a shared lockstep save (every client stores it, as with the 2 minute autosave) and every
// client notes the interrupted match for the main menu's "Kesilen maça devam et". Single player: the normal autosave.
function preUpdateSave() {
  const game = app.game;
  if (!game || app.demo || game.over) return;
  const s = app.net;
  try {
    if (s && game.mp) {
      if (s.phase !== 'game') return;
      const match = s.match || s.code || 'MP';
      if (s.isHost) { s.requestSave(true); app._mpAutoAt = game.tick + MP_AUTOSAVE_TICKS; }
      markInterrupted({ code: match, key: storage.MP_PREFIX + match + '-auto', host: !!s.isHost, hostName: hostNameOf(s), tick: game.tick | 0 });
      game.events.emit('notify', { text: tr('💾 Güncelleme öncesi maç kaydediliyor…'), type: 'info' });
    } else if (!game.mp) {
      autosaveT = 0;
      Promise.resolve(app.saveGame('auto')).then(ok => { if (ok && app.game === game) game.events.emit('notify', { text: tr('💾 Güncelleme öncesi oyun kaydedildi.'), type: 'good' }); });
    }
  } catch (err) { console.warn('[notice] save', err); }
}
notice.onSaveDue(preUpdateSave);

// continue a saved match, joiner: the host could send any save under this match's name. When this client saved the
// match at that tick itself, the state hash every client agreed on then (rec.hash) must match the downloaded save.
// -> null (fine, or no copy here to compare with) or the reason the match is refused (NetSession.checkResume)
async function checkResumeSave(data, at) {
  if (!at || typeof at.match !== 'string' || !at.match) return null;
  const base = storage.MP_PREFIX + at.match + '-';
  let rec = await storage.get(base + at.tick);
  if (!rec || (rec.tick | 0) !== at.tick) { const a = await storage.get(base + 'auto'); rec = a && (a.tick | 0) === at.tick ? a : null; }
  if (!rec || rec.hash == null) return null;
  let h;
  try { h = Game.deserialize(structuredClone(data), { me: 0 }).hash() >>> 0; } catch (err) { console.warn('[resume check]', err); return tr('Kurucunun gönderdiği kayıt açılamadı.'); }
  return h === (rec.hash >>> 0) ? null : tr('Kurucunun gönderdiği kayıt, bu maçın sendeki kaydıyla aynı değil.');
}
import('./net/session.js').then(m => { m.NetSession.checkResume = checkResumeSave; }).catch(err => console.warn('[resume check]', err));

function mpAutosave(game) {
  const s = app.net;
  if (!s || !s.isHost || s.phase !== 'game' || game.over || app.game !== game) return;
  if (app._mpAutoAt == null) app._mpAutoAt = game.tick + MP_AUTOSAVE_TICKS;
  if (game.tick >= app._mpAutoAt) { app._mpAutoAt = game.tick + MP_AUTOSAVE_TICKS; s.requestSave(true); }
}

// ---------------------------------------------------------------- background ticker
// A hidden tab gets no animation frames and its main-thread timers are clamped (1 s; Chrome's intensive
// throttling: once a minute after 5 hidden minutes). Timers inside a dedicated Worker are not throttled, and
// its messages reach the main thread on time, so a tiny inline worker drives the game while document.hidden.
// Only one path owns the clock at a time: frame() while visible (rAF), bgTick() while hidden; each restarts
// its own timestamp on the switch, so no wall-clock interval is counted twice (no double speed on return).
const BG_TICK_MS = 50;          // worker tick
const BG_MAX_STEPS = 15;        // at most 0.5 s of game time per tick ...
const BG_BUDGET_MS = 40;        // ... and at most ~40 ms of main-thread work per tick
const BG_BACKLOG = 5;           // s; longer gaps (machine asleep, worker starved) are not caught up
let bgLast = 0, bgPumpT = 0, mpCarry = 0, bgTimer = null, bgWorker = null;

function bgStart() {
  bgLast = performance.now(); mpCarry = 0;
  if (bgWorker === null) {
    try {
      const src = 'let h=0;onmessage=e=>{clearInterval(h);h=0;if(e.data>0)h=setInterval(()=>postMessage(0),e.data);};';
      const url = URL.createObjectURL(new Blob([src], { type: 'text/javascript' }));
      bgWorker = new Worker(url);
      URL.revokeObjectURL(url);
      bgWorker.onmessage = bgTick;
      bgWorker.onerror = () => { try { bgWorker.terminate(); } catch (err) { /* ignore */ } bgWorker = false; if (document.hidden) bgStart(); };
    } catch (err) { console.warn('[bg] worker unavailable, using setInterval', err); bgWorker = false; }
  }
  if (bgWorker) bgWorker.postMessage(BG_TICK_MS);
  else if (bgTimer == null) bgTimer = setInterval(bgTick, BG_TICK_MS);   // fallback: throttled, but better than nothing
}
function bgStop() {
  if (bgWorker) bgWorker.postMessage(0);
  if (bgTimer != null) { clearInterval(bgTimer); bgTimer = null; }
}

// runs the game by real elapsed time while the tab is hidden (no rendering, no HUD; the sim, saves and the lockstep only)
function bgTick() {
  const t = performance.now(), d = Math.min((t - bgLast) / 1000, BG_BACKLOG);
  bgLast = t;
  if (!document.hidden) return;
  notice.check();   // (the countdown's timer is throttled in a hidden tab)
  // waiting in a multiplayer lobby: keep its housekeeping (lobby broadcasts, resends) going too
  const ls = app.ui && app.ui.lobbySession;
  if (ls && ls !== app.net && ls.phase === 'lobby' && t - bgPumpT >= 100 && typeof ls._pump === 'function') { bgPumpT = t; try { ls._pump(); } catch (err) { console.warn('[bg]', err); } }
  const game = app.game;
  if (!game || app.demo || !(d > 0)) return;   // the menu demo does not run in the background
  try {
    const s = app.net;
    if (s && game.mp) {   // same test as frame(): an mp match continued alone after the session closed runs as single-player
      if (s.phase !== 'game') return;
      // the session's own 100 ms housekeeping timer (resend requests, keep-alive, drop detection) is throttled too
      if (t - bgPumpT >= 100 && typeof s._pump === 'function') { bgPumpT = t; s._pump(); }
      // NetSession.advance takes at most 1 s per call and runs at most 6 ticks per call: feed it in chunks and call
      // again while it keeps running full batches; what does not fit this tick is carried to the next one
      let rem = Math.min(mpCarry + d, BG_BACKLOG), n = 0, ran;
      do {
        const c = Math.min(rem, 1); rem -= c;
        ran = s.advance(game, c) || 0; n += ran;
      } while ((ran >= 6 || rem > 0) && n < BG_MAX_STEPS && performance.now() - t < BG_BUDGET_MS && app.net === s && app.game === game);
      mpCarry = rem;
      mpAutosave(game);
    } else if (!app.paused && !game.over) {
      acc = Math.min(acc + d, BG_BACKLOG);   // the leftover stays in the accumulator for the next tick
      let n = 0;
      while (acc >= STEP && n < BG_MAX_STEPS && performance.now() - t < BG_BUDGET_MS && !game.over && !app.paused && app.game === game) {
        game.update(STEP); acc -= STEP; n++;
      }
      autosaveT += n * STEP;
      if (autosaveT >= AUTOSAVE_EVERY) { autosaveT = 0; app.saveGame('auto'); }
    }
  } catch (err) { console.warn('[bg]', err); }
}

let last = 0, failCount = 0;
function frame(now) {
  requestAnimationFrame(frame);
  if (document.hidden) { last = now; return; }   // (a stray frame while hidden: the background ticker owns the game)
  let dt = (now - last) / 1000;
  if (!(dt > 0)) return;
  last = now;
  const rawDt = Math.min(dt, 0.5);
  if (dt > 0.05) dt = 0.05;
  const cpu0 = performance.now();
  try {
    const game = app.game;
    if (game) {
      if (app.net && game.mp) {
        // lockstep: the session runs the due ticks (and catches up up to 6 ticks per frame)
        app.net.advance(game, rawDt);
        mpAutosave(game);
      } else if (!app.paused && !game.over) {
        acc += dt;
        let steps = 0;
        while (acc >= STEP && steps < 4) { game.update(STEP); acc -= STEP; steps++; }
        if (acc > STEP) acc = 0;
        if (!app.demo) {
          autosaveT += dt;
          if (autosaveT >= AUTOSAVE_EVERY) { autosaveT = 0; app.saveGame('auto'); }
        }
      }
      // drop dead / removed ids from the selection
      if (app.selection.length) {
        const alive = app.selection.filter(id => { const e = game.getEntity(id); return e && !e.dead; });
        if (alive.length !== app.selection.length) app.select(alive, true);
      }
      if (app.demo) app.renderer.cam.yaw += dt * 0.04;
    }
    app.input.update(dt);
    app.renderer.render(dt);
    app.ui.update(dt);
    const cam = app.renderer.cam;
    app.audio.setListener(cam.tx, cam.tz, cam.dist);
    // main-thread time of this frame (the FPS label's detail view: is a low frame rate the CPU, the GPU or a browser cap?)
    const cpu = performance.now() - cpu0;
    app.cpuMs = app.cpuMs == null ? cpu : app.cpuMs * 0.9 + cpu * 0.1;
    failCount = 0;
  } catch (err) {
    if (++failCount === 1 || failCount === 60) showError(err);
  }
}

function boot() {
  const canvas = document.getElementById('game');
  app.renderer = new Renderer(canvas);
  app.audio = new AudioManager();
  try { Promise.resolve(app.audio.init()).catch(() => {}); } catch (err) { console.warn(err); }
  initCloud();   // before the menu: the main menu shows the account line
  app.ui = new UI(app);
  app.input = new Input(app);
  // an older Aevum tab keeps the save database on the previous version: saves / history wait until it closes
  storage.onBlocked((on) => {
    let n = document.getElementById('storage-blocked');
    if (!on) { if (n) n.remove(); return; }
    if (n) return;
    n = document.createElement('div'); n.id = 'storage-blocked'; n.className = 'storage-blocked';
    n.textContent = tr('Aevum başka bir sekmede (eski sürüm) açık. Kayıtlar ve maç geçmişi için o sekmeyi kapat.');
    document.body.append(n);
  });

  startDemo();
  app.ui.showMenu();
  startBeat();
  try { mountNoticeBanner(app.ui, notice); } catch (err) { console.warn('[notice]', err); }
  if (cloud) {
    // invites from friends (and being shown online to them) while signed in
    cloud.startInbox(m => { if (m && m.type === 'invite') app.ui.showInvite(m); });
    // sync runs by itself: every 4 minutes too (new matches from other PCs, renames, TP), never by a button
    // (2026-11-23) 'lazy': a pull (3+ reads) at most every 20 minutes per browser; the kicks still send what is queued
    setInterval(() => { if (!document.hidden) cloudSafe(c => c.kick({ pull: 'lazy' })); }, 4 * 60 * 1000);
    document.addEventListener('visibilitychange', () => { if (!document.hidden) cloudSafe(c => c.kick({ pull: 'lazy' })); });
  }
  // back from a Google sign in by redirect (the popup was blocked): finish it (the SDK loads only in this case)
  if (cloud && cloud.google && cloud.google.redirectPending()) import('./ui/cloud-ui.js').then(m => m.resumeGoogleRedirect(app.ui)).catch(err => console.warn('[cloud]', err));

  window.addEventListener('resize', () => { try { app.renderer.resize(); } catch (err) { console.warn(err); } });
  // hidden tab: the background ticker keeps single-player and the lockstep running (see bgTick)
  const onVisibility = () => {
    last = performance.now();
    try { app.audio.setBackground(document.hidden); } catch (err) { /* ignore */ }
    if (!document.hidden) notice.wake();
    if (document.hidden) {
      bgStart();
      if (app.game && !app.demo && !app.game.over && !app.game.mp) app.saveGame('auto');
    } else bgStop();
  };
  document.addEventListener('visibilitychange', onVisibility);
  if (document.hidden) onVisibility();   // (opened in a background tab)
  // closing / reloading the page: tell the others right away ('bye'), so they drop us in 3 s instead of 60 s
  window.addEventListener('pagehide', () => {
    // best effort: the IndexedDB write may not finish before the page is gone
    if (app.game && !app.demo) { try { recordGame(app.game, false); } catch (err) { /* ignore */ } }
    if (app.net) { try { app.net.close('unload'); } catch (err) { /* ignore */ } }
  });
  const resume = () => { try { app.audio.resume(); } catch (err) { /* ignore */ } };
  window.addEventListener('pointerdown', resume);
  window.addEventListener('keydown', resume);
  window.addEventListener('error', ev => { if (!app.game) showError(ev.error || ev.message); });
  window.addEventListener('unhandledrejection', ev => console.warn('[unhandled]', ev.reason));

  last = performance.now();
  requestAnimationFrame(frame);
}

try { boot(); } catch (err) { showError(err); }
