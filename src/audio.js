// Aevum audio manager. Web Audio API, real recorded samples only (see assets/sfx/LICENSES.md).
// Never throws: missing files / missing AudioContext simply result in silence.

import { fetchAsset, assetUrls, cdnFailed } from './cdn.js';
import { tr, LANG } from './i18n.js';
import { VO_GROUPS, VO_COUNTS } from './voice-lines.js';

const BASE = 'sfx/';   // (under assets/: from jsDelivr on the live site, src/cdn.js)

// Logical sound -> { files, vol, cat, minGap (s), pitch (+- fraction), range (world tiles, 0 = non positional) }
const SOUNDS = {
  // gathering
  // (chop2 / chop3 were dropped 2026-11-13: hissy recordings, most of their energy above 4 kHz - the owner's "gırç gırç")
  chop:      { files: ['chop1'], vol: 0.34, minGap: 0.3, range: 34, pitch: 0.1 },
  pick:      { files: ['thud1', 'thud2', 'thud3'], vol: 0.2, minGap: 0.5, range: 30, rate: 0.85 },
  rustle:    { files: ['rustle1', 'rustle2', 'rustle3'], vol: 0.3, minGap: 0.3, range: 28 },
  deposit:   { files: ['coins1', 'coins2'], vol: 0.05, minGap: 1.5, range: 26 },
  // building
  // (2026-11-13: solid wooden knocks; hammer1-3 were creaky door-close recordings, the owner's "gırç" while building)
  hammer:    { files: ['tool_hit1', 'arrow_wood1', 'arrow_wood2', 'bld_hit2'], vol: 0.66, minGap: 0.12, range: 36, pitch: 0.08 },
  buildDone: { files: ['hammer4', 'bld_hit2'], vol: 0.72, minGap: 0.3, range: 60 },   // (latch: a hissy metal latch, dropped)
  treeFall:  { files: ['creak1', 'creak2'], vol: 0.6, minGap: 0.3, range: 40 },
  // combat (real recordings, see LICENSES.md). combat: 1 = shares the MAX_COMBAT voice cap, 2 = big one-shot (counted, never dropped by the cap)
  // melee contact, picked by attacker / target in attach()
  swordClash:  { files: ['sword_clash1', 'sword_clash2', 'sword_clash3', 'sword_clash4', 'sword_clash5', 'sword_clash6'], vol: 0.6, minGap: 0.09, range: 40, pitch: 0.05, combat: 1 },
  heavyClang:  { files: ['heavy_clang1', 'heavy_clang2', 'heavy_clang3'], vol: 0.62, minGap: 0.09, range: 42, pitch: 0.05, combat: 1 },
  spearHit:    { files: ['spear_hit1', 'spear_hit2', 'spear_hit3'], vol: 0.58, minGap: 0.09, range: 40, pitch: 0.05, combat: 1 },
  armorHit:    { files: ['armor_hit1', 'armor_hit2', 'armor_hit3'], vol: 0.45, minGap: 0.09, range: 40, pitch: 0.05, combat: 1 },
  fleshHit:    { files: ['flesh_hit1', 'flesh_hit2', 'flesh_hit3'], vol: 0.55, minGap: 0.09, range: 38, pitch: 0.05, combat: 1 },
  cavHit:      { files: ['cav_hit1', 'cav_hit2'], vol: 0.6, minGap: 0.09, range: 42, pitch: 0.05, combat: 1 },
  toolHit:     { files: ['tool_hit1', 'tool_hit2', 'tool_hit3'], vol: 0.5, minGap: 0.09, range: 36, pitch: 0.05, combat: 1 },
  bldHit:      { files: ['bld_hit1', 'bld_hit2'], vol: 0.5, minGap: 0.09, range: 40, pitch: 0.05, combat: 1 },
  ram:         { files: ['ram_hit1', 'ram_hit2'], vol: 0.75, minGap: 0.15, range: 48, pitch: 0.05, rate: 0.92, combat: 1 },
  // ranged release
  bow:         { files: ['bow_shot1', 'bow_shot2', 'bow_shot3'], vol: 0.42, minGap: 0.06, range: 38, pitch: 0.05, combat: 1 },
  crossbow:    { files: ['xbow_shot1'], vol: 0.45, minGap: 0.06, range: 40, pitch: 0.05, combat: 1 },
  musket:      { files: ['musket1', 'musket2', 'musket3'], vol: 0.5, minGap: 0.08, range: 58, pitch: 0.05, combat: 1 },
  rifle:       { files: ['rifle1', 'rifle2', 'rifle3'], vol: 0.45, minGap: 0.08, range: 58, pitch: 0.05, combat: 1 },
  cannon:      { files: ['cannon_shot1', 'cannon_shot2', 'cannon_shot3'], vol: 0.75, minGap: 0.15, range: 75, pitch: 0.05, combat: 2 },
  catapult:    { files: ['catapult1', 'catapult2'], vol: 0.6, minGap: 0.15, range: 50, pitch: 0.05, combat: 1 },
  // projectile impacts
  arrowWood:   { files: ['arrow_wood1', 'arrow_wood2'], vol: 0.4, minGap: 0.06, range: 34, pitch: 0.05, combat: 1 },
  arrowFlesh:  { files: ['arrow_flesh1', 'arrow_flesh2'], vol: 0.45, minGap: 0.06, range: 34, pitch: 0.05, combat: 1 },
  stoneCrash:  { files: ['stone_crash1', 'stone_crash2'], vol: 0.65, minGap: 0.12, range: 60, pitch: 0.05, combat: 2 },
  explosion:   { files: ['explode1', 'explode2', 'explode3'], vol: 0.75, minGap: 0.15, range: 75, pitch: 0.05, combat: 2 },
  // deaths
  death:       { files: ['death_grunt1', 'death_grunt2', 'death_grunt3', 'death_grunt4'], vol: 0.45, minGap: 0.15, range: 36, pitch: 0.05, combat: 1 },
  shipSink:    { files: ['ship_sink1', 'ship_sink2'], vol: 0.7, minGap: 0.5, range: 70, pitch: 0.05, combat: 2 },
  collapseSmall: { files: ['collapse_small'], vol: 0.7, minGap: 0.3, range: 65, pitch: 0.05, combat: 2 },
  collapseLarge: { files: ['collapse_large'], vol: 0.8, minGap: 0.4, range: 75, pitch: 0.05, combat: 2 },
  fire:      { files: ['fire1'], vol: 0.4, minGap: 1.0, range: 40 },
  // production / progress
  trained:   { files: ['equip1', 'equip2'], vol: 0.45, minGap: 0.3, range: 50 },
  researched:{ files: ['k_bell'], vol: 0.5, minGap: 0.5, range: 0 },
  quest:     { files: ['k_cash'], vol: 0.55, minGap: 0.5, range: 0 },
  questBell: { files: ['bells'], vol: 0.4, minGap: 0.5, range: 0 },
  ageHorn:   { files: ['horn_age'], vol: 0.9, minGap: 2, range: 0, pitch: 0 },
  ageRiser:  { files: ['k_riser'], vol: 0.5, minGap: 2, range: 0, pitch: 0 },
  ageBoom:   { files: ['impact_big', 'k_boom'], vol: 0.8, minGap: 2, range: 0, pitch: 0 },
  enemyAge:  { files: ['horn_alarm'], vol: 0.3, minGap: 5, range: 0, rate: 0.85 },
  // under attack (owner 2026-11-14: not noticed): the low horn blown twice at full level over a deep drum boom
  alarm:     { files: ['horn_alarm'], vol: 1.0, minGap: 8, range: 0, pitch: 0 },
  alarm2:    { files: ['horn_alarm'], vol: 0.85, minGap: 8, range: 0, pitch: 0, rate: 0.94 },
  alarmDrum: { files: ['k_boom'], vol: 0.6, minGap: 8, range: 0, pitch: 0 },
  gameWon:   { files: ['horn_end'], vol: 0.9, minGap: 5, range: 0, pitch: 0 },
  gameLost:  { files: ['horn_end'], vol: 0.9, minGap: 5, range: 0, pitch: 0, rate: 0.8 },
  notify:    { files: ['k_hud'], vol: 0.3, minGap: 0.6, range: 0 },
  trade:     { files: ['k_coin', 'coins1'], vol: 0.5, minGap: 0.15, range: 0 },
  birds:     { files: ['birds_takeoff'], vol: 0.25, minGap: 8, range: 0 },
  step:      { files: ['step1', 'step2', 'step3'], vol: 0.2, minGap: 0.12, range: 22 },
  // ships / railway (existing files only, quiet and rate limited)
  board:     { files: ['step1', 'step2', 'step3'], vol: 0.14, minGap: 0.35, range: 24 },
  trainCoin: { files: ['coins2'], vol: 0.12, minGap: 5, range: 40 },
  // interface
  ui_click:  { files: ['click_a', 'click_b'], vol: 0.5, minGap: 0.04, range: 0, cat: 'ui', rotate: true, pitch: 0.02 },
  ui_select: { files: ['k_tick'], vol: 0.2, minGap: 0.15, range: 0, cat: 'ui' },
  ui_command:{ files: ['click_a', 'click_b'], vol: 0.2, minGap: 0.18, rotate: true, pitch: 0.02, range: 0, cat: 'ui' },
  ui_error:  { files: ['mclick'], vol: 0.6, minGap: 0.15, range: 0, cat: 'ui', rate: 0.75 },
  // laying a foundation (owner 2026-11-13: "güzel bir ses"): a deep thud, then earth and gravel settling (see ui())
  ui_place:  { files: ['k_hit'], vol: 0.62, minGap: 0.1, range: 0, cat: 'ui', pitch: 0.04 },
  ui_placeGravel: { files: ['stone_crash2'], vol: 0.3, minGap: 0.1, range: 0, cat: 'ui', rate: 0.82, pitch: 0.05 },
  ui_chat:   { files: ['dclick7'], vol: 0.8, minGap: 0.25, range: 0, cat: 'ui', rate: 1.12 },   // incoming chat line
};

// (wind removed 2026-11-13: the owner did not want the constant wind bed - its crackle was the "gırç" too)
// (owner 2026-11-23: "oyunu daha canlı hissettir", very quiet, like soft white noise) the world's beds: they follow what
// the camera looks at: woods, your own village, open grass, water. AMB_MAX: each bed's top level under the ambient volume.
const AMBIENT = { water: 'amb_water', forest: 'amb_forest', village: 'amb_village', meadow: 'amb_meadow' };
// (owner 2026-11-23: the meadow's wind got tiring after a while) meadow halved
const AMB_MAX = { forest: 0.16, village: 0.13, meadow: 0.05 };
const CATS = ['master', 'sfx', 'ambient', 'ui', 'music'];
const DEFAULT_VOL = { master: 0.8, sfx: 0.9, ambient: 0.5, ui: 0.7, music: 0.7 };
// battle music (owner 2026-11-23): starts when an enemy attacks you, stays under the game, fades out a while after the
// fighting stops. MUSIC_LEVEL is the track's own level under the 'music' volume; the file streams (no 60 MB decode).
const BATTLE_TRACK = 'music/empires-at-war.m4a';
const MUSIC_LEVEL = 0.32, MUSIC_IN = 2.0, MUSIC_OUT = 3.5, MUSIC_HOLD = 25;
// main menu music (owner 2026-11-23): plays while the menu (its background battle) is up, fades out when a game starts
const MENU_TRACK = 'music/echoes-of-legend.m4a', MENU_LEVEL = 0.45;
const LS_KEY = 'aevum.volume';
const MAX_VOICES = 14;
const MAX_COMBAT = 6;   // simultaneous small combat voices (combat: 1); a big fight reads as a battle, not noise

const CANNON_UNITS = { cannon: 1, artillery: 1, galleon: 1, ironclad: 1 };
const CAV_UNITS = { lightcav: 1, knight: 1, cuirassier: 1 };
const SIEGE_UNITS = { ram: 1, catapult: 1, cannon: 1, artillery: 1, train: 1 };
// unarmoured / lightly armoured targets: melee on them sounds like a body hit, not steel on steel
const SOFT_UNITS = { villager: 1, archer: 1, crossbow: 1, tradecart: 1, musketeer: 1 };
// the only sounds played while the tab is hidden (the game keeps running there): alerts, not the battle itself
const BACKGROUND_SOUNDS = { alarm: 1, alarm2: 1, alarmDrum: 1, notify: 1, gameWon: 1, gameLost: 1 };

export class AudioManager {
  constructor() {
    this.ctx = null;
    this.buffers = new Map();
    this.gains = {};
    this.volumes = Object.assign({}, DEFAULT_VOL);
    this.listener = { x: 0, z: 0, dist: 40 };
    this.lastPlay = {};
    this.rot = {};
    this.voices = 0;
    this.cVoices = 0;
    this.lastFile = {};
    this.game = null;
    this._subs = [];
    this._amb = {};
    this._ambStarted = false;
    this._ambTimer = null;
    this._ready = false;
    this.background = false;
    try {
      const raw = (typeof localStorage !== 'undefined') && localStorage.getItem(LS_KEY);
      if (raw) {
        const o = JSON.parse(raw);
        for (const c of CATS) if (typeof o[c] === 'number') this.volumes[c] = Math.min(1, Math.max(0, o[c]));
      }
    } catch (e) { /* ignore */ }
  }

  async init() {
    try {
      const AC = (typeof window !== 'undefined') && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return;
      this.ctx = new AC();
      const ctx = this.ctx;
      this.gains.master = ctx.createGain();
      // Gentle limiter so big moments (age up, explosions) do not clip.
      let out = ctx.destination;
      try {
        const comp = ctx.createDynamicsCompressor();
        comp.threshold.value = -10; comp.knee.value = 12; comp.ratio.value = 6;
        comp.attack.value = 0.003; comp.release.value = 0.2;
        comp.connect(ctx.destination);
        out = comp;
      } catch (e) { /* ignore */ }
      this.gains.master.connect(out);
      for (const c of ['sfx', 'ambient', 'ui', 'music']) {
        this.gains[c] = ctx.createGain();
        this.gains[c].connect(this.gains.master);
      }
      for (const c of CATS) this.gains[c].gain.value = this.volumes[c];

      const names = new Set();
      for (const k in SOUNDS) for (const f of SOUNDS[k].files) names.add(f);
      for (const k in AMBIENT) names.add(AMBIENT[k]);
      await Promise.all([...names].map((n) => this._load(n)));
      this._ready = true;
      this._voPreload();
      if (this._wantAmbient) this._startAmbient();
    } catch (e) {
      // never throw
    }
  }

  async _load(name) {
    try {
      const res = await fetchAsset(BASE + name + '.mp3');
      if (!res.ok) return;
      const arr = await res.arrayBuffer();
      const buf = await new Promise((ok, fail) => {
        try {
          const p = this.ctx.decodeAudioData(arr, ok, fail);
          if (p && p.then) p.then(ok, fail);
        } catch (e) { fail(e); }
      });
      if (buf) this.buffers.set(name, buf);
    } catch (e) { /* missing file: silent */ }
  }

  resume() {
    try {
      if (!this.ctx) return;
      if (this.ctx.state === 'suspended') { const p = this.ctx.resume(); if (p && p.then) p.then(() => this._menuApply(), () => {}); }
      this._wantAmbient = true;
      if (this._ready) this._startAmbient();
      this._menuApply();   // (the browser lets music start only after the first click or key)
    } catch (e) { /* ignore */ }
  }

  setVolume(cat, v) {
    try {
      if (!CATS.includes(cat)) return;
      v = Math.min(1, Math.max(0, +v || 0));
      this.volumes[cat] = v;
      if (this.gains[cat] && this.ctx) this.gains[cat].gain.setTargetAtTime(v, this.ctx.currentTime, 0.03);
      try { localStorage.setItem(LS_KEY, JSON.stringify(this.volumes)); } catch (e) { /* ignore */ }
    } catch (e) { /* ignore */ }
  }

  getVolume(cat) { return CATS.includes(cat) ? this.volumes[cat] : 0; }

  setListener(x, z, dist) {
    this.listener.x = +x || 0;
    this.listener.z = +z || 0;
    if (dist > 0) this.listener.dist = dist;
    this._updateAmbient();
    this._updateMusic();
  }

  // ---------- battle music ----------
  _streamTrack(rel) {
    const urls = assetUrls(rel);
    const el = new Audio(); el.crossOrigin = 'anonymous'; el.loop = true; el.preload = 'auto';
    let i = 0;
    el.addEventListener('error', () => { if (i + 1 < urls.length) { if (i === 0 && urls.length > 1) cdnFailed(); el.src = urls[++i]; } });
    el.src = urls[0];
    const g = this.ctx.createGain(); g.gain.value = 0;
    this.ctx.createMediaElementSource(el).connect(g); g.connect(this.gains.music);
    return { el, g, on: false, stopT: 0 };
  }
  // the menu track on (the menu is up) or off (a game started); waits for the audio to be allowed
  setMenuMusic(on) { this._menuWanted = !!on; this._menuApply(); }
  _menuApply() {
    try {
      if (!this.ctx || this.ctx.state !== 'running' || typeof Audio === 'undefined') return;
      if (!this._menuMus) { if (!this._menuWanted) return; this._menuMus = this._streamTrack(MENU_TRACK); }
      const m = this._menuMus, now = this.ctx.currentTime;
      m.g.gain.cancelScheduledValues(now);
      if (this._menuWanted) {
        m.on = true; m.stopT = 0;
        if (m.el.paused) { const p = m.el.play(); if (p && p.catch) p.catch(() => {}); }
        m.g.gain.setTargetAtTime(MENU_LEVEL, now, 1.2);
      } else if (m.on) {
        m.on = false; m.stopT = now + 6;
        m.g.gain.setTargetAtTime(0, now, 1.0);
      }
    } catch (e) { /* never break the game for music */ }
  }
  _musicEnsure() {
    if (this._mus || !this.ctx || typeof Audio === 'undefined') return this._mus || null;
    try { this._mus = this._streamTrack(BATTLE_TRACK); } catch (e) { this._mus = null; }
    return this._mus;
  }
  // a fight between you (or an ally) and an enemy player: start the music if this is the start of one, keep it going
  _fight(start) {
    try {
      if (!this.ctx || !this.game || this.game.over) return;
      this._lastFight = this.ctx.currentTime;
      if (!start) return;
      const m = this._musicEnsure(); if (!m) return;
      if (!m.on) {
        m.on = true; m.stopT = 0;
        if (m.el.paused) { try { m.el.currentTime = 0; } catch (e) { /* */ } const p = m.el.play(); if (p && p.catch) p.catch(() => { m.on = false; }); }
      }
      m.g.gain.cancelScheduledValues(this.ctx.currentTime);
      m.g.gain.setTargetAtTime(MUSIC_LEVEL, this.ctx.currentTime, MUSIC_IN / 3);
    } catch (e) { /* never break the game for music */ }
  }
  _musicStop(fast) {
    const m = this._mus; if (!m || !this.ctx) return;
    m.on = false; m.stopT = this.ctx.currentTime + (fast ? 1.5 : MUSIC_OUT * 3);
    m.g.gain.cancelScheduledValues(this.ctx.currentTime);
    m.g.gain.setTargetAtTime(0, this.ctx.currentTime, fast ? 0.4 : MUSIC_OUT);
  }
  _updateMusic() {
    try {
      const mm = this._menuMus;
      if (mm && !mm.on && mm.stopT && this.ctx && this.ctx.currentTime > mm.stopT) { mm.stopT = 0; try { mm.el.pause(); mm.el.currentTime = 0; } catch (e) { /* */ } }
      const m = this._mus; if (!m || !this.ctx) return;
      const now = this.ctx.currentTime;
      if (m.on && (!this.game || this.game.over || now - (this._lastFight || 0) > MUSIC_HOLD)) this._musicStop(!this.game || this.game.over);
      if (!m.on && m.stopT && now > m.stopT) { m.stopT = 0; try { m.el.pause(); } catch (e) { /* */ } }
    } catch (e) { /* ignore */ }
  }


  ui(name) {
    this.play('ui_' + name);
    if (name === 'place') setTimeout(() => this.play('ui_placeGravel'), 70);   // (the gravel layer of the foundation sound)
  }

  // tab hidden: only BACKGROUND_SOUNDS play (a battle running in a background tab must not spam the speakers)
  setBackground(b) { this.background = !!b; }

  // play(name, {x, z, vol, rate}) ; positional when x/z given and the sound has a range.
  play(name, opts) {
    try {
      const ctx = this.ctx;
      if (!ctx || ctx.state !== 'running') return false;
      const def = SOUNDS[name];
      if (!def) return false;
      if (this.background && !BACKGROUND_SOUNDS[name]) return false;
      const now = ctx.currentTime;
      const last = this.lastPlay[name];
      if (last !== undefined && now - last < (def.minGap || 0.08)) return false;

      let vol = def.vol * (opts && opts.vol !== undefined ? opts.vol : 1);
      let pan = 0;
      const cat = def.cat || 'sfx';
      const positional = def.range > 0 && opts && typeof opts.x === 'number' && typeof opts.z === 'number';
      if (positional) {
        const L = this.listener;
        const dx = opts.x - L.x, dz = opts.z - L.z;
        const d = Math.sqrt(dx * dx + dz * dz);
        // Zoomed out -> the audible radius grows a little but everything gets quieter.
        const range = def.range + L.dist * 0.5;
        if (d > range) return false;
        const fall = 1 - d / range;
        const zoom = Math.min(1.15, Math.max(0.3, 34 / (L.dist + 10)));
        vol *= fall * fall * zoom;
        pan = Math.max(-0.85, Math.min(0.85, dx / Math.max(12, L.dist * 0.9)));
        if (vol < 0.012) return false;
      }
      if (cat === 'sfx' && this.voices >= MAX_VOICES && vol < 0.5) return false;
      if (def.combat === 1 && this.cVoices >= MAX_COMBAT) return false;

      let file;
      if (def.rotate) {
        const i = this.rot[name] || 0;
        file = def.files[i % def.files.length];
        this.rot[name] = i + 1;
      } else {
        // random pick among the loaded variants (combat: never the same variant twice in a row)
        let avail = def.files.filter((f) => this.buffers.has(f));
        if (!avail.length) return false;
        if (def.combat && avail.length > 1) avail = avail.filter((f) => f !== this.lastFile[name]);
        file = avail[(Math.random() * avail.length) | 0];
        this.lastFile[name] = file;
      }
      const buf = this.buffers.get(file);
      if (!buf) return false;

      const src = ctx.createBufferSource();
      src.buffer = buf;
      const p = def.pitch !== undefined ? def.pitch : 0.06;
      src.playbackRate.value = (def.rate || 1) * (opts && opts.rate ? opts.rate : 1) * (1 + (Math.random() * 2 - 1) * p);
      const g = ctx.createGain();
      g.gain.value = vol;
      src.connect(g);
      let tail = g;
      if (pan !== 0 && ctx.createStereoPanner) {
        const pn = ctx.createStereoPanner();
        pn.pan.value = pan;
        g.connect(pn);
        tail = pn;
      }
      tail.connect(this.gains[cat]);
      this.voices++;
      const cv = !!def.combat;
      if (cv) this.cVoices++;
      src.onended = () => { this.voices = Math.max(0, this.voices - 1); if (cv) this.cVoices = Math.max(0, this.cVoices - 1); try { tail.disconnect(); } catch (e) { /* */ } };
      src.start(opts && opts.delay ? now + opts.delay : now);
      this.lastPlay[name] = now;
      return true;
    } catch (e) { return false; }
  }

  // ---------- unit voices (owner 2026-11-25: "Emrin olur", "Saldırın!") ----------
  // assets/sfx/vo/<voice>_<lang>_<kind><n>.mp3, made by tools/gen-voices.mjs. One voice talks at a time; a new order cuts the
  // last line, a re-select never does; a line is not repeated until the others of its set were heard.
  _voPreload() {
    const lang = LANG === 'en' ? 'en' : 'tr';
    const names = [];
    for (const k in VO_COUNTS) if (k.split('_')[1] === lang) for (let i = 1; i <= VO_COUNTS[k]; i++) names.push('vo/' + k + i);
    // (a few at a time, after the game's own sounds, so the start is not slowed down)
    let i = 0;
    const next = () => { if (i < names.length) this._load(names[i++]).then(next, next); };
    for (let k = 0; k < 4; k++) next();
  }
  _voFor(u) {
    let grp = u.type === 'villager' ? (u.id & 1 ? 'vf' : 'vm') : u.naval ? 'sh' : 'sd';
    const list = VO_GROUPS[grp];
    if (!list || !list.length) return null;
    return list[((u.id >> 1) * 7919 >>> 0) % list.length];
  }
  // ids: the selection; kind: select | move | attack | build | gather:<res>
  voice(ids, kind) {
    try {
      const ctx = this.ctx, g = this.game;
      if (!ctx || ctx.state !== 'running' || this.background || this.demo || !g || !ids || !ids.length) return;
      let u = null;
      for (const id of ids) { const e = g.getEntity(id); if (e && e.kind === 'unit' && !e.dead && this._isMine(e.owner)) { u = e; break; } }
      if (!u) return;
      const vid = this._voFor(u);
      if (!vid) return;
      const grp = vid.slice(0, 2), isV = grp === 'vm' || grp === 'vf';
      let k = kind || 'move';
      if (k.startsWith('gather:')) k = isV ? k.slice(7) : 'move';
      if (k === 'build' && !isV) k = 'move';
      if (k === 'attack' && isV) k = 'move';
      const now = ctx.currentTime, sel = k === 'select';
      const v = this._vo || (this._vo = { end: 0, src: null, at: 0, hist: {} });
      if (sel ? now < v.end || now - v.at < 1.2 : now - v.at < 0.6) return;
      const lang = LANG === 'en' ? 'en' : 'tr';
      const set = vid + '_' + lang + '_' + k;
      const n = VO_COUNTS[set];
      if (!n) return;
      const h = v.hist[set] || (v.hist[set] = []);
      let pool = [];
      for (let i = 1; i <= n; i++) if (!h.includes(i) && this.buffers.has('vo/' + set + i)) pool.push(i);
      if (!pool.length) { h.length = 0; for (let i = 1; i <= n; i++) if (this.buffers.has('vo/' + set + i)) pool.push(i); }
      if (!pool.length) return;
      const pick = pool[(Math.random() * pool.length) | 0];
      h.push(pick); if (h.length >= n) h.splice(0, h.length - 1);
      const buf = this.buffers.get('vo/' + set + pick);
      if (v.src) { try { v.src.stop(); } catch (e) { /* */ } }
      const src = ctx.createBufferSource(), gn = ctx.createGain();
      src.buffer = buf; gn.gain.value = 0.85;
      src.connect(gn); gn.connect(this.gains.sfx);
      src.onended = () => { try { gn.disconnect(); } catch (e) { /* */ } if (v.src === src) v.src = null; };
      src.start(now);
      v.src = src; v.at = now; v.end = now + buf.duration;
    } catch (e) { /* never throw */ }
  }

  // ---------- ambient bed ----------
  _startAmbient() {
    try {
      if (this._ambStarted || !this.ctx) return;
      this._ambStarted = true;
      const mk = (key, vol) => {
        const buf = this.buffers.get(AMBIENT[key]);
        if (!buf) return;
        const g = this.ctx.createGain();
        g.gain.value = 0;
        g.gain.setTargetAtTime(vol, this.ctx.currentTime, 1.5);
        g.connect(this.gains.ambient);
        const bed = { g, vol, buf, next: 0, off: -99 };
        this._amb[key] = bed;
        this._bedFill(bed);
      };
      // (no wind bed: owner decision 2026-11-13)
      mk('water', 0); mk('forest', 0); mk('village', 0); mk('meadow', 0);
      // occasional real bird recording
      const birdLoop = () => {
        try {
          if (this.game && !this.game.over && this._waterFrac < 0.6) this.play('birds', { vol: 0.6 + Math.random() * 0.4 });
        } catch (e) { /* */ }
        this._ambTimer = setTimeout(birdLoop, 14000 + Math.random() * 22000);
      };
      this._ambTimer = setTimeout(birdLoop, 6000);
    } catch (e) { /* ignore */ }
  }

  // (owner 2026-11-23: "a short loop, you can tell it repeats") a bed is not looped as one file: it is played as
  // overlapping chunks of 7-13 s from random places in it, each slightly faster or slower, with equal-power
  // crossfades, so the 17 s recording never comes round in the same order. Scheduled ~4 s ahead.
  _bedFill(bed) {
    const ctx = this.ctx, d = bed.buf.duration, X = 1.6;
    if (!this._xIn) {
      const n = 64; this._xIn = new Float32Array(n); this._xOut = new Float32Array(n);
      for (let i = 0; i < n; i++) { const p = i / (n - 1); this._xIn[i] = Math.sin(p * Math.PI / 2); this._xOut[i] = Math.cos(p * Math.PI / 2); }
    }
    let guard = 0;
    while (bed.next < ctx.currentTime + 4 && guard++ < 4) {
      const len = Math.min(d - 0.05, 7 + Math.random() * 6);
      let off = Math.random() * Math.max(0, d - len);
      if (Math.abs(off - bed.off) < 3 && d - len > 6) off = (off + (d - len) / 2) % (d - len);   // not the same stretch twice in a row
      bed.off = off;
      const rate = 0.95 + Math.random() * 0.1, dur = len / rate;
      const t0 = Math.max(bed.next, ctx.currentTime + 0.02);
      const s = ctx.createBufferSource(); s.buffer = bed.buf; s.playbackRate.value = rate;
      const cg = ctx.createGain(); cg.gain.value = 0;
      cg.gain.setValueCurveAtTime(this._xIn, t0, X);
      cg.gain.setValueCurveAtTime(this._xOut, t0 + dur - X, X);
      s.connect(cg); cg.connect(bed.g);
      s.start(t0, off, len);
      s.onended = () => { try { s.disconnect(); cg.disconnect(); } catch (e) { /* */ } };
      bed.next = t0 + dur - X;
    }
  }

  _updateAmbient() {
    try {
      if (!this.ctx || !this._ambStarted) return;
      for (const k in this._amb) { const b = this._amb[k]; if (b && b.buf) this._bedFill(b); }
      const now = this.ctx.currentTime;
      if (this._ambT !== undefined && now - this._ambT < 0.4) return;
      this._ambT = now;
      let frac = 0;
      const map = this.game && this.game.map;
      if (map && map.tiles) {
        const N = map.size, L = this.listener;
        let n = 0, w = 0;
        const r = 8;
        for (let dz = -r; dz <= r; dz += 2) for (let dx = -r; dx <= r; dx += 2) {
          const tx = Math.floor(L.x) + dx, tz = Math.floor(L.z) + dz;
          if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
          n++;
          const t = map.tiles[tz * N + tx];
          if (t === 3 || t === 4) w++;
        }
        frac = n ? w / n : 0;
      }
      this._waterFrac = frac;
      const zoom = Math.min(1, Math.max(0.25, 40 / (this.listener.dist + 10)));
      const wa = this._amb.water, wi = this._amb.wind;
      if (wa) wa.g.gain.setTargetAtTime(Math.min(0.8, frac * 1.6) * zoom, now, 0.6);
      // woods / own village / open grass around the camera (trees and buildings within ~12 tiles)
      const g = this.game, L2 = this.listener;
      let trees = 0, homes = 0;
      if (g && !this.demo) {
        // trees: a coarse 8-tile density grid, rebuilt every 15 s (the trees are thousands of entities); own buildings: a direct count
        const N = g.map && g.map.size;
        if (N && (!this._treeG || this._treeG.g !== g || now - this._treeG.t > 15)) {
          const C = Math.ceil(N / 8), a = new Uint16Array(C * C);
          if (g.entities) for (const e of g.entities.values()) if (e && e.type === 'tree' && !e.dead) { const i = ((e.z / 8) | 0) * C + ((e.x / 8) | 0); if (i >= 0 && i < a.length) a[i]++; }
          this._treeG = { g, t: now, C, a };
        }
        const T = this._treeG;
        if (T) { const cx = (L2.x / 8) | 0, cz = (L2.z / 8) | 0; for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) { const x = cx + dx, z = cz + dz; if (x >= 0 && z >= 0 && x < T.C && z < T.C) trees += T.a[z * T.C + x]; } }
        const me = this._me();
        for (const b of g.buildings || []) if (b && !b.dead && b.owner === me && (b.x - L2.x) ** 2 + (b.z - L2.z) ** 2 < 144) homes++;
      }
      const fo = Math.min(1, trees / 40), vi = Math.min(1, homes / 5), me2 = Math.max(0, 1 - fo - frac) * (1 - vi * 0.5);
      const near = Math.min(1, Math.max(0.35, 30 / (L2.dist + 6)));   // (a little quieter when zoomed far out)
      const set = (k, v) => { const b = this._amb[k]; if (b) b.g.gain.setTargetAtTime(v * near, now, 1.2); };
      set('forest', fo * AMB_MAX.forest); set('village', vi * AMB_MAX.village); set('meadow', (this.demo ? 0 : me2) * AMB_MAX.meadow);
      // more wind when zoomed far out
      if (wi) wi.g.gain.setTargetAtTime(0.3 + 0.4 * (1 - zoom), now, 0.8);
    } catch (e) { /* ignore */ }
  }

  // ---------- game binding ----------
  _audible(x, z, e) {
    try {
      const g = this.game;
      if (!g) return false;
      if (e && this._isAllyOwner(e.owner)) return true;
      if (e && e.kind === 'unit' && typeof g.isEntityVisible === 'function') return !!g.isEntityVisible(e);
      const map = g.map, fog = g.fog;
      if (!map || !fog) return true;
      const N = map.size;
      const tx = Math.floor(x), tz = Math.floor(z);
      if (tx < 0 || tz < 0 || tx >= N || tz >= N) return false;
      return fog[tz * N + tx] >= 1;
    } catch (err) { return true; }
  }

  // local player id (multiplayer: game.me; single-player: 0)
  _me() { const g = this.game; return g && g.me != null ? g.me : 0; }
  _isMine(owner) { return owner === this._me(); }
  // own or allied (same team) owner; falls back to own-only when the game has no team API
  _isAllyOwner(owner) {
    const g = this.game, me = this._me();
    if (owner === me) return true;
    if (owner == null || owner < 0) return false;
    try { if (g && typeof g.isAlly === 'function') return !!g.isAlly(me, owner); } catch (err) { /* */ }
    return false;
  }

  _at(name, e, vol) {
    if (!e || typeof e.x !== 'number') return;
    if (!this._audible(e.x, e.z, e)) return;
    this.play(name, { x: e.x, z: e.z, vol: vol === undefined ? 1 : vol });
  }

  // melee contact sound group for attacker -> target
  _meleeGroup(attacker, target) {
    const at = attacker.type;
    if (target && target.kind === 'building') return 'bldHit';
    const soft = !target || SOFT_UNITS[target.type];
    const r = Math.random();
    if (CAV_UNITS[at]) {
      if (soft || r < 0.45) return 'cavHit';
      return at === 'lightcav' ? 'swordClash' : 'heavyClang';
    }
    if (soft && r < 0.7) return 'fleshHit';
    if (!soft && r < 0.2) return 'armorHit';   // shield / armour block
    if (at === 'spearman') return 'spearHit';
    if (at === 'heavyinf') return 'heavyClang';
    return 'swordClash';
  }

  attach(game) {
    try {
      // unsubscribe from the previous game
      if (this.game && this.game.events && this.game.events.off) {
        for (const [n, fn] of this._subs) { try { this.game.events.off(n, fn); } catch (e) { /* */ } }
      }
      this._subs = [];
      if (this._mus && this._mus.on) this._musicStop(true);
      this.game = game;
      if (!game || !game.events || !game.events.on) return;
      const on = (name, fn) => {
        const safe = (p) => { try { fn(p || {}); } catch (e) { /* never break the sim */ } };
        game.events.on(name, safe);
        this._subs.push([name, safe]);
      };

      on('gatherTick', ({ unit, res }) => {
        if (res === 'fish' || unit?.type === 'fishboat' || unit?.naval) return; // no short water sound in assets/sfx
        // food (farms, berries, hunting) is silent: the 'rustle' cloth swish on every farmer's tick was the endless "gırç gırç" (2026-11-13)
        if (res !== 'wood' && res !== 'stone' && res !== 'gold') return;
        const n = res === 'wood' ? 'chop' : 'pick';
        this._at(n, unit);
      });
      on('deposit', ({ unit, owner, res }) => {
        if (!this._isMine(owner)) return;
        this._at('deposit', unit, res === 'gold' ? 1.3 : 1);
      });
      on('board', ({ unit, transport }) => { this._at('board', unit || transport); });
      on('unload', ({ transport }) => { if (transport) this._at('board', transport, 0.9); });
      on('trainArrive', ({ e, station }) => { if (this._isMine((e || station)?.owner)) this._at('trainCoin', station || e); });
      on('buildStart', ({ e }) => { this._at('hammer', e, 1.2); });
      on('buildTick', ({ unit }) => { this._at('hammer', unit); }); // every second per working builder (construction and repair)
      on('buildComplete', ({ e }) => { this._at('buildDone', e); });
      on('treeFelled', ({ e }) => { this._at('treeFall', e); });
      // (farm harvest: silent too, see gatherTick)

      on('attack', ({ attacker, target, ranged }) => {
        if (!attacker) return;
        // battle music: an enemy player attacking you or an ally starts it; your side fighting back keeps it going
        if (target && !this.game?.cfg?.tutorial && !this.demo) {
          const pl = this.game?.players || [], a = attacker.owner, b = target.owner;
          const side = (o) => (o == null || !pl[o] ? 0 : this._isMine(o) || this._isAllyOwner(o) ? 1 : 2);
          const sa = side(a), sb = side(b);
          if (sa === 2 && sb === 1) this._fight(true); else if (sa === 1 && sb === 2) this._fight(false);
        }
        if (attacker.kind === 'unit' && attacker.anim === 'build') { this._at('hammer', attacker); return; }
        const t = attacker.type;
        if (ranged) {
          let n = 'bow';
          if (attacker.kind === 'building') {   // castles shoot bolts; towers arrows, cannonballs from the Gunpowder Age on
            const age = this.game && this.game.players && this.game.players[attacker.owner] ? this.game.players[attacker.owner].age | 0 : 0;
            n = t === 'castle' ? 'crossbow' : t === 'tower' && age >= 3 ? 'cannon' : 'bow';
          }
          else if (CANNON_UNITS[t]) n = 'cannon';
          else if (t === 'musketeer') n = 'musket';
          else if (t === 'rifleman') n = 'rifle';
          else if (t === 'catapult') n = 'catapult';
          else if (t === 'crossbow') n = 'crossbow';
          this._at(n, attacker);
        } else if (t === 'ram') {
          this._at('ram', target || attacker);
        } else if (t === 'villager') {
          this._at('toolHit', target || attacker, 0.85);
        } else {
          // melee weapon contact: the sim applies the damage right after this event, so play it here (attacker type is known)
          this._at(this._meleeGroup(attacker, target), target || attacker);
        }
      });
      on('hit', ({ target, x, z, proj }) => {
        if (!proj) return;   // melee contact already played on 'attack'
        const px = typeof x === 'number' ? x : target && target.x;
        const pz = typeof z === 'number' ? z : target && target.z;
        if (typeof px !== 'number' || typeof pz !== 'number') return;
        if (!this._audible(px, pz, target && target.kind === 'unit' ? target : null)) return;
        const unitHit = target && target.kind === 'unit' && !target.naval;
        let n, vol = 1;
        if (proj === 'arrow') { n = unitHit ? 'arrowFlesh' : 'arrowWood'; if (!target) vol = 0.6; }
        else if (proj === 'bullet') { n = unitHit ? 'arrowFlesh' : 'arrowWood'; vol = 0.6; }
        else if (proj === 'stone') n = 'stoneCrash';
        else if (proj === 'cannonball') n = 'explosion';
        else return;
        this.play(n, { x: px, z: pz, vol });
      });
      on('death', ({ e }) => {
        if (!e) return;
        if (e.kind === 'building') { this._at((e.size || 2) >= 3 ? 'collapseLarge' : 'collapseSmall', e); return; }
        if (e.kind === 'unit') {
          if (e.naval) this._at('shipSink', e);
          else if (SIEGE_UNITS[e.type]) this._at('collapseSmall', e, 0.7);
          else this._at('death', e);   // no CC0 horse recording: cavalry riders use the human grunts
        }
      });

      on('trained', ({ e, building }) => { if (e && this._isMine(e.owner)) this._at('trained', building || e); });
      on('researched', ({ owner }) => { if (this._isMine(owner)) this.play('researched'); });
      on('ageUpStart', ({ owner }) => { if (this._isMine(owner)) this.play('ageRiser', { vol: 0.7 }); });
      on('ageUp', ({ owner, dev }) => {
        if (this._isMine(owner) && !dev) {
          this.play('ageRiser');
          this.play('ageHorn', { delay: 0.5 });
          this.play('ageBoom', { delay: 1.9 });
        } else if (this._isAllyOwner(owner)) {
          // ally aged up: soft positive cue (existing 'bells' mapping, quiet)
          this.play('questBell', { vol: 0.5 });
        } else {
          this.play('enemyAge');
        }
      });
      on('questDone', () => { this.play('quest'); this.play('questBell', { delay: 0.25 }); });
      on('underAttack', () => { this.play('alarm'); });   // (one horn, 2026-11-17: the three-part alarm was too much)
      on('notify', ({ type, text }) => { if (type === 'warn' && text !== 'Saldırı altındasın!' && text !== tr('Saldırı altındasın!')) this.play('notify'); });   // (the attack has its own alarm)
      on('gameOver', ({ won }) => { this._musicStop(true); this.play(won ? 'gameWon' : 'gameLost'); });
    } catch (e) { /* never throw */ }
  }
}
