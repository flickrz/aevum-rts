// Aevum UI: main menu, HUD, minimap, tooltips, overlays. DOM only, no three.js.
import { TEST_MODE } from '../testmode.js';
import { AGES, UNITS, BUILDINGS, TECHS, PLAYER_COLORS } from '../data.js';
import { BUILD_TIME_MUL, QUEUE_TIME_MUL, TOWER_AGE_ATK, towerAgeBonus, FORMATIONS, MINE_CAP, healerStats, healerRate, healerBolt, PROD_B, PASTURE_IDLE_RATE, NO_ROTATE } from '../sim/game.js';
import { firstLaunch, menuProfile } from './profile-ui.js';
import { levelOf } from '../rank.js';
import { menuHud, saveBadge, saveBadgeTitle, confirmDeleteSave, loginScreen, avatarEl, tpText } from './cloud-ui.js';
import { logChat } from '../chatlog.js';
import { withMention } from './mention.js';
import { menuUpdates, hasUnseen } from './updates-ui.js';
import { mapPreview, previewClimate } from './map-preview.js';
import { TutorialUI } from './tutorial-ui.js';
import { TUT_CFG } from '../sim/tutorial.js';
import { ico, applyIcons, keepIcons, stripIcons, RES_ICONS, CAT_ICONS, NATURE_ICONS } from '../icons.js';
import { ask, askOpen } from './ask.js';
import { interruptedEntry } from './notice-ui.js';
import { tr, LANG, setLang, loc, pn } from '../i18n.js';
import { graphPanel } from './graphs-ui.js';
import { playerScore } from '../sim/history.js';
// a tab on the previous build (the server runs a new one): no rooms until it reloads
const STALE_TEXT = tr('Oyunun yeni sürümü yayında. Sayfayı yenileyip tekrar dene.');

// developer mode (a sandbox game: no TP, no match history): offered on a local dev server, or with ?dev=1 in the URL
function devModeOffered() {
  try {
    const h = location.hostname;
    if (h === 'localhost' || h === '127.0.0.1' || h === '[::1]' || h.endsWith('.localhost')) return true;
    if (/[?&]dev=1/.test(location.search)) { try { localStorage.setItem('aevum.dev', '1'); } catch { /* no storage */ } return true; }
    if (/[?&]dev=0/.test(location.search)) { try { localStorage.removeItem('aevum.dev'); } catch { /* no storage */ } return false; }
    return localStorage.getItem('aevum.dev') === '1';
  } catch { return false; }
}
applyIcons();

const RES_LIST = ['food', 'wood', 'stone', 'gold'];
const RES_ICON = RES_ICONS;
const RES_NAME = { food: tr('Yiyecek'), wood: tr('Odun'), stone: tr('Taş'), gold: tr('Altın') };
const BARTER_RES = ['food', 'wood', 'stone'];   // (gold has the Sat / Al buttons)
const STATE_TR = { idle: tr('Boşta'), move: tr('Yürüyor'), gather: tr('Topluyor'), return: tr('Taşıyor'), build: tr('İnşa ediyor'), attack: tr('Saldırıyor'), dead: tr('Öldü') };
const CLS_TR = { civil: tr('Sivil'), infantry: tr('Piyade'), ranged: tr('Menzilli'), cavalry: tr('Süvari'), siege: tr('Kuşatma'), ship: tr('Gemi'), train: tr('Tren') };
const NATURE = {
  tree: { name: tr('Ağaç'), icon: NATURE_ICONS.tree, res: 'wood' }, stone: { name: tr('Taş Ocağı'), icon: NATURE_ICONS.stone, res: 'stone' },
  gold: { name: tr('Altın Madeni'), icon: NATURE_ICONS.gold, res: 'gold' }, berries: { name: tr('Böğürtlen Çalısı'), icon: NATURE_ICONS.berries, res: 'food' },
  deer: { name: tr('Geyik'), icon: NATURE_ICONS.deer, res: 'food' },
  wolf: { name: tr('Kurt'), icon: NATURE_ICONS.wolf, res: 'food' }, bear: { name: tr('Ayı'), icon: NATURE_ICONS.bear, res: 'food' },
  fish: { name: tr('Balık Sürüsü'), icon: NATURE_ICONS.fish, res: 'food' },
};
const HOTKEYS = 'QERTYFGHJKZXCVB'; // W/A/S/D are camera-only (never a card slot)
const BUILD_CATS = {
  eco: { name: tr('Ekonomi'), icon: CAT_ICONS.eco, desc: tr('Ekonomi binaları: tarla, depo, pazar...'), list: ['towncenter', 'farm', 'lumbercamp', 'minecamp', 'storage', 'market', 'temple', 'university', 'bank', 'factory', 'dock', 'pasture'] },
  mil: { name: tr('Askeri'), icon: CAT_ICONS.mil, desc: tr('Askeri binalar: kışla, okçuluk, ahır...'), list: ['barracks', 'archery', 'stable', 'blacksmith', 'siege', 'castle', 'academy'] },
  def: { name: tr('Savunma'), icon: CAT_ICONS.def, desc: tr('Savunma yapıları: kule ve sur (kapı: bitmiş suru seç → Kapı Aç).'), list: ['tower', 'wall'] },
  tra: { name: tr('Ulaşım'), icon: CAT_ICONS.tra, desc: tr('Ulaşım: istasyon ve demir yolu (Sanayi Çağı).'), list: ['station', 'rail'] },
};
// (players 2026-11-22: "I can't put a gate in my walls, couldn't find it") the build page's own words for the wall;
// (owner 2026-11-23) no separate gate card: a gate is opened from a selected wall piece only
const BUILD_DESC = {
  wall: tr(BUILDINGS.wall.desc) + tr(' Kapı için: bitmiş bir sur parçasını seç → Kapı Aç (Q).'),
};
// Döndür on the building card (no sprite icon for it: Material Design rotate, Apache 2.0)
const ROT_ICON = '<svg class="gi" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor"><path d="M12 4a8 8 0 1 0 7.75 10h-2.1A6 6 0 1 1 12 6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35A7.96 7.96 0 0 0 12 4z"/></svg>';
const CAT_TR = { eco: tr('Ekonomi'), mil: tr('Askeri'), def: tr('Savunma'), tra: tr('Ulaşım') };
const CAT_ICON = CAT_ICONS;
const TILE_COL = [[79, 125, 58], [91, 74, 46], [201, 183, 122], [74, 163, 199], [31, 95, 150], [119, 115, 108], [47, 90, 44]];
const MM = 220;
// map climates (view only, src/render/renderer.js CLIMATES); 'random' is picked from the map seed
const CLIMATE_OPTS = [['random', tr('Rastgele')], ['temperate', tr('Ilıman')], ['spring', tr('İlkbahar')], ['autumn', tr('Sonbahar')], ['winter', tr('Kış')], ['arid', tr('Kurak')]];
const FLARE_MS = 7000;
const CARD_GUARD_MS = 350;   // after the command card switches page, clicks / hover on it wait this long
const ATTACK_TEXT = 'Saldırı altındasın!';   // the sim's notify text for underAttack (the attack banner shows it instead of a toast)
// food rates the selection panel shows (mirror src/sim/game.js): a farmer's food / s while his plot is ripe (FARM_RATE),
// the ripe share of a plot's 30 s cycle less the walks to the granary (measured 2026-11-22: 8 farmers ~160 food/min),
// and the herders' shares in a pasture (_pasGather)
const FARM_RATE_UI = 16 / 9 * 0.85, FARM_RIPE_SHARE = 0.22, PASTURE_HERD_C = [1, 0.7, 0.5, 0.4, 0.3, 0.25];
const ATTACK_MS = 4000;  // how long the attack banner stays
const DIR_TR = [tr('doğusunda'), tr('güneydoğusunda'), tr('güneyinde'), tr('güneybatısında'), tr('batısında'), tr('kuzeybatısında'), tr('kuzeyinde'), tr('kuzeydoğusunda')];   // how long a map flare stays on the minimap
// map types (must match the generator's cfg.mapType values; 'random' is resolved by the simulation)
const MAP_TYPES = [['random', tr('Rastgele')], ['river', tr('Nehir Vadisi')], ['continent', tr('Kıta')], ['highlands', tr('Yaylalar')], ['plains', tr('Ovalar')], ['inlandsea', tr('İç Deniz')], ['islands', tr('Adalar')]];
const MAP_TYPE_TR = Object.fromEntries(MAP_TYPES);
// what each map type plays like (the "Yeni Oyun" screen)
const MAP_DESC = {
  random: tr('Her oyunda türlerden biri rastgele seçilir; ne çıkacağını oyun başlayınca görürsün.'),
  river: tr('Haritayı ortadan kıvrılarak ikiye bölen bir nehir; geçitler ve sığ yerler savaşın düğüm noktası olur.'),
  continent: tr('Denizle çevrili tek büyük kara parçası. Herkes karadan ulaşılabilir; kıyılarda balık var.'),
  highlands: tr('Sırt sırt uzanan dağlar ve aralarında dar geçitler. Savunması kolay, saldırması zor bir harita.'),
  plains: tr('Dağsız, açık ve düz araziler. Ordular her yönden gelebilir; hızlı akınlara uygun.'),
  inlandsea: tr('Haritanın ortasında büyük bir iç deniz; yerleşimler kıyı boyunca, deniz yolları da önemli.'),
  islands: tr('Her oyuncu kendi adasında başlar. Rakibe ulaşmak için gemi ve deniz gücü şart.'),
};
const MAP_FACTS = {
  random: tr('Nehir · Kıta · Yaylalar · Ovalar · İç Deniz · Adalar'),
  river: tr('Su: nehir · Dağ: orta · Orman: orta'),
  continent: tr('Su: çevrede deniz · Dağ: orta · Orman: orta'),
  highlands: tr('Su: az · Dağ: çok · Orman: bol'),
  plains: tr('Su: göller · Dağ: yok · Orman: az'),
  inlandsea: tr('Su: ortada deniz · Dağ: orta · Orman: orta'),
  islands: tr('Su: her yerde · Dağ: az · Orman: orta · Gemi gerekir'),
};

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
// an escaped chat line with @claude (feedback to the developer) highlighted
const mention = (h) => h.replace(/@claude/gi, '<span class="cmention">@claude</span>');
const el = (tag, cls, html) => { const e = document.createElement(tag); if (cls) e.className = cls; if (html != null) e.innerHTML = html; return e; };
const safe = (fn, def) => { try { return fn(); } catch (err) { return def; } };
const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + String(s % 60).padStart(2, '0'); };
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');

export class UI {
  constructor(app) {
    this.app = app;
    this.root = document.getElementById('ui');
    this.sel = [];
    this.page = 'root';
    this.cardSig = null;
    this.selSig = null;
    this.questSig = null;
    this.buttons = [];
    this.acc = 0; this.mmAcc = 0;
    this.frames = 0; this.fpsT = 0;
    this.lastRes = {};
    this.pings = [];
    this.questDoneAt = new Map();
    this.qdir = new WeakMap();
    this.lastAttackToast = -99;
    this.mode = 'menu';
    this.gameOverShown = false;
    this.settings = this._loadSettings();
    this.setup = { mapSize: 320, mapType: 'random', climate: 'random', enemies: 1, difficulty: 'normal', startRes: 'normal', startAge: 0, fog: 'explored' };
    this._build();
    this._applySettings();
  }

  get game() { return this.app.game; }
  _me() { return this.app.game?.me ?? 0; }
  // a rival's entity in the fog: known to stand there, but what goes on there is not shown (owner 2026-11-20)
  _fogged(e) {
    const g = this.app.game, me = this._me();
    if (!g?.map || !g.fog || g.reveal || !(e.owner >= 0) || e.owner === me || this._ally(me, e.owner)) return false;
    const N = g.map.size, tx = Math.min(N - 1, Math.max(0, e.x | 0)), tz = Math.min(N - 1, Math.max(0, e.z | 0));
    return g.fog[tz * N + tx] !== 2;
  }
  _ally(a, b) { const g = this.app.game; if (a == null || b == null || a < 0 || b < 0) return false; const r = safe(() => g?.isAlly?.(a, b), undefined); return r === undefined ? a === b : !!r; }
  _pname(pid) { const g = this.app.game, p = g?.players?.[pid]; if (!p) return tr('Oyuncu ') + pid; if (p.name) return pn(p.name); if (pid === this._me()) return tr('Sen'); return (p.kind === 'human' ? tr('Oyuncu ') : tr('Yapay Zekâ ')) + (pid + 1); }
  _teamOf(pid) { const g = this.app.game; return safe(() => g?.teamOf?.(pid), undefined) ?? g?.players?.[pid]?.team ?? (pid === 0 ? 1 : 2); }

  // ------------------------------------------------------------------ DOM
  _build() {
    this.root.innerHTML = '';
    this.menuEl = el('div', 'menu hidden');
    this.hudEl = el('div', 'hud hidden');
    this.root.append(this.hudEl, this.menuEl);

    // top bar
    // (owner 2026-11-22) one slim row: current age / clock / buttons; the developer age buttons hang under it as a tab.
    // The resources, population, idle villagers and the next age live in the bottom-left block (minimap + panels).
    this.topPanel = el('div', 'topbar panel');
    const top = el('div', 'tbrow');
    this.topPanel.append(top);
    this.ageEl = el('div', 'agebox', '<span class="n"></span><div class="agebar"><i></i></div>');
    this.clockEl = el('div', 'clock', '00:00');
    top.append(this.ageEl, el('div', 'sep'), this.clockEl, el('div', 'sep'));
    const tb = (icon, name, desc, fn) => {
      const b = el('button', 'tbtn', icon);
      b.onclick = () => { this._click(); fn(); };
      this._tip(b, () => ({ name, desc }));
      top.append(b); return b;
    };
    tb(ico('x-tech'), tr('Teknoloji'), tr('Teknoloji ağacı: tüm çağların araştırmaları. Uygun olanı tıklayıp araştır.'), () => this.showTech());
    tb(ico('x-stats'), tr('İstatistik'), tr('Oyun istatistikleri ve skor.'), () => this.showStats());
    this.flareBtn = tb(ico('x-flare'), tr('İşaret Ver'), tr('Haritaya işaret bırak: takım arkadaşın mini haritada ve oyunda görür. Butona bas, sonra haritaya ya da mini haritaya tıkla. Kısayol: Alt + tık'), () => this.app.input?.armFlare());
    this.tribBtn = tb(ico('x-ally'), tr('Müttefike Kaynak Gönder'), tr('Takım arkadaşına yiyecek, odun, taş ya da altın gönder (kesinti yok).'), () => this.showTribute());
    this.tribBtn.style.display = 'none';
    this.chatBtn = tb(ico('x-chat'), tr('Sohbet'), tr('Takım arkadaşlarına mesaj yaz. Kısayol: Enter'), () => this.openChat());
    this.saveBtn = tb(ico('x-save'), tr('Kaydet'), tr('Oyunu kaydet.'), () => this._save());
    this.pauseBtn = tb(ico('x-pause'), tr('Menü / Duraklat'), tr('Oyun menüsünü aç (Esc). Tek oyunculuda oyun durur; çok oyunculuda menüden herkes için duraklatabilirsin (P).'), () => this.toggleGameMenu(true));
    this._buildFullscreenBtn(top);
    this.hudTop = el('div', 'hudtop'); this.hudTop.append(this.topPanel); this.hudEl.append(this.hudTop);
    // (owner 2026-11-22) the Stone Age objective steps hang under the top bar as an attached tab, not in the age box
    this.stepsEl = el('div', 'tbsteps panel hidden'); this.hudTop.append(this.stepsEl);
    this.hintAt = {}; this.rateSamples = []; this.rateT = -99; this.slowT = -99; this.orphanSince = new Map(); this.objSig = null;

    this.fpsEl = el('div', 'fps', '');
    this.hudEl.append(this.fpsEl);
    this.fpsEl.onclick = () => { this.fpsMore = !this.fpsMore; };

    // bottom-left block (owner 2026-11-22, the layout of the medeniyet-rts fork): the next age box on top, spanning
    // the minimap and the resource panel to its right (the panel is as tall as the minimap)
    this.blEl = el('div', 'hudbl');
    // next age: objective steps (Stone Age only), cost, missing requirements and the age-up button on the right
    this.objEl = el('div', 'agepanel panel hidden', '<div class="ainfo"><div class="osteps"></div><div class="ahead"><span class="ot"></span><span class="acost"></span></div><div class="obar"><i></i></div><span class="om"></span></div>');
    this.ageBtn = el('button', 'agebtn', ico('x-ageup'));
    this.ageBtn.onclick = () => { this._press({ spec: this._ageSpec() }); this.slowT = -99; };
    this._tip(this.ageBtn, () => this._ageSpec());
    this.objEl.append(this.ageBtn);
    this._tip(this.objEl.querySelector('.ahead'), () => {
      const p = this.game?.players?.[this._me()], na = p && AGES[p.age + 1];
      return this.tut || !na ? null : { name: tr('Sonraki çağ: {0}', tr(na.name)), desc: tr('Bedeli (kırmızı: henüz yetmiyor) ve gereken farklı bina türü sayısı (ev, sur ve Şehir Merkezi sayılmaz). Hazır olunca sağdaki düğme çağ atlamayı Şehir Merkezi\'nde başlatır.') };
    });
    const blRow = el('div', 'blrow');
    // minimap
    const mmWrap = el('div', 'minimap panel');
    this.mm = el('canvas');
    this.mm.width = MM; this.mm.height = MM;
    mmWrap.append(this.mm);
    // resources: idle villagers + population on top, then one row per resource (amount, income / min, workers)
    this.resPanel = el('div', 'respanel panel');
    const rtop = el('div', 'rtop');
    this.idleEl = el('button', 'tbtn idlebtn', ico('u-villager') + '<b>0</b>');
    this.idleEl.onclick = (ev) => { this._click(); safe(() => this.app.input?.nextIdleVillager(!!ev?.shiftKey)); };
    this._tip(this.idleEl, () => ({ name: tr('Boşta köylüler'), desc: tr('Sıradaki boşta köylüyü seç ve ona git. Kısayol: Tab veya nokta (.). Shift ile: tüm boştaki köylüleri seç.') }));
    this.popEl = el('div', 'res pop', `<span class="i">${ico('x-pop')}</span><b>0/0</b>`);
    this._tip(this.popEl, () => ({ name: tr('Nüfus'), desc: tr('Mevcut / azami nüfus. Sınır sabit: 1000.') }));
    rtop.append(this.idleEl, this.popEl);
    this.resPanel.append(rtop);
    this.resEls = {};
    for (const r of RES_LIST) {
      const d = el('div', 'res', `<span class="i">${RES_ICON[r]}</span><b>0</b><small class="rate"></small><small class="wk"></small>`);
      this._tip(d, () => ({ name: RES_NAME[r], desc: tr('Mevcut ') + RES_NAME[r].toLowerCase() + tr(' stoğu. Yeşil sayı: son 30 saniyeye göre dakikalık gelir. ') + ico('u-villager') + tr(' sayısı: bu kaynağı toplayan işçin.') }));
      this.resEls[r] = d; this.resPanel.append(d);
    }
    blRow.append(mmWrap, this.resPanel);
    this.blEl.append(this.objEl, blRow);
    this.hudEl.append(this.blEl);
    this._bindMinimap();

    // bottom
    const bottom = el('div', 'bottom');
    this.selEl = el('div', 'selpanel panel empty');
    this.cardEl = el('div', 'card panel');
    bottom.append(this.selEl, this.cardEl);
    this.hudEl.append(bottom);
    // shortcut bar: control groups 1-9 (same as Ctrl+1..9 / 1..9)
    this.grpEl = el('div', 'groupbar');
    this.hudEl.append(this.grpEl);
    this._grpBtns = null; this._grpState = [];

    this.placeEl = el('div', 'placehint panel hidden');
    this.toastsEl = el('div', 'toasts');
    this.questsEl = el('div', 'quests panel hidden');   // (no quests since 2026-11-20; kept empty so the layout code stays simple)
    this.tipEl = el('div', 'tooltip panel hidden');
    this.pauseEl = el('div', 'overlay hidden');
    this.modalEl = el('div', 'overlay hidden');
    this.hudEl.append(this.placeEl, this.toastsEl, this.questsEl, this.pauseEl, this.modalEl);
    this.root.append(this.tipEl);
    this.modalEl.addEventListener('mousedown', (e) => { if (e.target === this.modalEl && !this.modalLocked) this._closeModal(); });
    this._buildPause();
    this._renderCard();
    this._bindPressSound();
  }

  // the game's own confirmation dialog (instead of window.confirm): ask({title, text, ok, cancel, danger}) -> Promise<boolean>
  ask(opts) { return ask(opts); }
  askOpen() { return askOpen(); }
  // the click sound plays on PRESS, not on the 'click' event (which fires on release and felt late, owner 2026-11-23);
  // _click() from an onclick handler is then a no-op for that same press.
  _click() { if (performance.now() - (this._pressT || -1e9) < 600) return; safe(() => this.app.audio?.ui('click')); }
  _clickable(t) {
    for (let el = t, i = 0; el && el !== document.body && i < 6; el = el.parentElement, i++) {
      if (el.disabled) return false;
      if (el.tagName === 'BUTTON' || typeof el.onclick === 'function' || el.getAttribute?.('role') === 'button') return true;
    }
    return false;
  }
  _bindPressSound() {
    if (this._pressBound || typeof document === 'undefined') return;
    this._pressBound = true;
    document.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !this._clickable(e.target)) return;
      this._pressT = performance.now();
      safe(() => { this.app.audio?.resume?.(); this.app.audio?.ui('click'); });
    }, true);
  }
  _error() { safe(() => this.app.audio?.ui('error')); }

  // ------------------------------------------------------------------ tooltip
  // (players 2026-11-22: "the card tooltip stays a second and goes, I can't read it") a selection change hid it and a
  // re-render replaced the hovered button (a selected unit dying in a fight does both every few moments). The hovered
  // node is remembered; _tipKeep finds the button now under the mouse and shows its tooltip again.
  _tip(node, specFn) {
    node._tipSpec = specFn;
    node.addEventListener('mouseenter', () => { this._tipNode = node; if (performance.now() < (this._cardGuardT || 0) && this.cardEl.contains(node)) return; this._showTip(node, specFn()); });
    node.addEventListener('mouseleave', () => { if (this._tipNode === node) this._tipNode = null; this.tipEl.classList.add('hidden'); });
  }
  // the age box's cost chips: name, what you have and what the next age needs (a tap shows it on touch screens)
  _chipTip(node, r) {
    this._tip(node, () => {
      const p = this.game?.players?.[this._me()], na = p && AGES[p.age + 1];
      if (!na) return null;
      if (r === 'bld') {
        const n = new Set((safe(() => this.game.buildingsOf(this._me()), []) || []).filter((b) => b.done && !b.dead && !['house', 'wall', 'gate', 'towncenter'].includes(b.type)).map((b) => b.type)).size;
        return { name: ico('x-buildings') + tr(' Farklı bina türü'), desc: tr('{0} / {1} — {2} için bu kadar farklı türde bitmiş bina gerekli (ev, sur, kapı ve Şehir Merkezi sayılmaz).', Math.min(n, na.reqBuildings), na.reqBuildings, tr(na.name)) };
      }
      const have = Math.floor(p.res[r] || 0), need = na.cost?.[r] || 0;
      return { name: RES_ICON[r] + ' ' + RES_NAME[r], desc: tr('{0} / {1} — {2} için gereken {3}.', Math.min(have, need), need, tr(na.name), RES_NAME[r].toLowerCase()) + (have < need ? tr(' {0} eksik.', need - have) : tr(' Yeterli.')) };
    });
    node.addEventListener('pointerup', (e) => { if (e.pointerType === 'touch') { this._tipNode = node; this._showTip(node, safe(node._tipSpec, null)); } });
  }
  // a tooltip hidden on purpose (a click, a page switch): it comes back only on the next mouseenter
  _hideTip() { this._tipNode = null; this.tipEl.classList.add('hidden'); }
  _tipKeep() {
    const n = this._tipNode, m = this.app.input?.mouse;
    if (!n || !m || (n.isConnected && !this.tipEl.classList.contains('hidden'))) return;
    let c = typeof document.elementFromPoint === 'function' ? document.elementFromPoint(m.x, m.y) : null;
    while (c && !c._tipSpec) c = c.parentElement;
    if (!c) { this._hideTip(); return; }
    this._tipNode = c;
    if (performance.now() < (this._cardGuardT || 0) && this.cardEl.contains(c)) return;
    this._showTip(c, safe(c._tipSpec, null));
  }
  _costHtml(cost) {
    if (!cost) return '';
    const p = this.game?.players?.[this._me()];
    let h = '';
    for (const r of RES_LIST) {
      const v = cost[r]; if (!v) continue;
      const no = p && (p.res[r] || 0) < v;
      h += `<span class="${no ? 'no' : ''}" data-r="${r}">${RES_ICON[r]} ${v}</span>`;
    }
    return h;
  }
  _showTip(node, s) {
    if (!s) return;
    let h = `<div class="tn"><span>${keepIcons(esc(s.name))}</span>${s.hotkey ? `<kbd>${s.hotkey}</kbd>` : ''}</div>`;
    const c = this._costHtml(s.cost);
    if (c || s.time) h += `<div class="tc">${c}${s.time ? `<span>⏱ ${tr('{0}sn', Math.round(s.time))}</span>` : ''}</div>`;
    if (s.desc) h += `<div class="td">${keepIcons(esc(s.desc))}</div>`;
    const chk = s.check ? safe(s.check, { ok: true }) : null;
    if (chk && !chk.ok && chk.reason) h += `<div class="tr">${esc(tr(chk.reason))}</div>`;
    const t = this.tipEl;
    t.innerHTML = h; t.classList.remove('hidden');
    const r = node.getBoundingClientRect(), trR = t.getBoundingClientRect();
    let x = r.left + r.width / 2 - trR.width / 2, y = r.top - trR.height - 8;
    if (y < 6) y = r.bottom + 8;
    x = Math.max(6, Math.min(window.innerWidth - trR.width - 6, x));
    t.style.left = x + 'px'; t.style.top = y + 'px';
  }

  // ------------------------------------------------------------------ menu
  showMenu() {
    this.mode = 'menu';
    this.menuEl.classList.remove('hidden');
    this.hudEl.classList.add('hidden');
    this._hideTip();
    this._menuMain();
  }
  showHUD() {
    this.mode = 'hud';
    this.menuOpen = false; this._pauseKey = null;
    this.menuEl.classList.add('hidden');
    this.hudEl.classList.remove('hidden');
    this.cardSig = null; this.selSig = null; this.questSig = null;
  }
  _menuBox(html) {
    this.menuEl.innerHTML = ''; this.menuEl.classList.remove('with-hud', 'm-left');
    const box = el('div', 'menu-box panel', html);
    this.menuEl.append(box);
    return box;
  }
  _mbtn(parent, text, fn, cls = '') {
    const b = el('button', 'mbtn ' + cls, text);
    b.onclick = () => { this._click(); safe(() => this.app.audio?.resume()); fn(); };
    parent.append(b); return b;
  }
  // signed in with Google (required to play) and the account's profile is here
  _signedIn() { if (TEST_MODE) return true; return !!safe(() => this.app.cloud && this.app.cloud.loggedIn && this.app.getProfile(), false); }
  _menuMain(note) {
    // nothing is playable before signing in with Google (one account = one player)
    if (!this._signedIn()) { loginScreen(this); if (note) this._menuNote(note); return; }
    // (owner 2026-11-20: the layout of the draft he liked - one column on the left over the live demo, the big
    //  "Yeni Oyun" first, the rest as a list, three small buttons in a row, the feedback note bottom left, the
    //  player plate top right - in the game's own look: the same panel and gold buttons as before)
    const box = this._menuBox(tr('<div class="logo">AEVUM</div><div class="tagline">Çağları aş · Uygarlığını kur</div>'));
    box.classList.add('main');
    this.menuEl.classList.add('m-left');
    if (note) this._menuNote(note);
    const item = (icon, text, meta, fn, cls = '') => {
      const btn = this._mbtn(box, `<span class="mi">${ico(icon)}</span><span class="mt">${text}</span>${meta != null ? `<span class="mm">${meta}</span>` : ''}`, fn, 'mitem ' + cls);
      return btn;
    };
    item('b-towncenter', tr('Yeni Oyun'), tr('harita ve ayarlar'), () => this._menuSetup(), 'primary');
    if (this.game && !this.game.over && !this.app.demo && !this.app.net) item('x-speed', tr('Oyuna Dön'), tr('kaldığın yer'), () => { this.showHUD(); this.app.setPaused?.(false); });
    const multi = item('x-ally', tr('Çok Oyunculu'), tr('davet et, birlikte oyna'), () => this._menuMulti());
    // a multiplayer match an update cut (within 30 minutes): "Kesilen maça devam et" right under it (src/ui/notice-ui.js)
    safe(() => interruptedEntry(this, box, multi));
    item('u-villager', tr('Arkadaşlar'), null, () => import('./friends-ui.js').then((m) => m.menuFriends(this)));
    item('x-build', tr('Sandbox'), tr('serbest kur'), () => this.app.newGame({ mapSize: 256, enemies: 1, difficulty: 'normal', startRes: 'high', startAge: 0, sandbox: true, seed: (Math.random() * 1e9) | 0 }));
    const cont = item('x-explore', tr('Devam Et'), '', () => Promise.resolve(safe(() => this.app.continueLast(), false)).then((ok) => { if (!ok && this.app.lastLoadError && this.mode === 'menu') this._menuSaves(this.app.lastLoadError); }).catch(() => {}));
    const saves = item('x-save', tr('Kayıtlı Oyunlar'), '', () => this._menuSaves());
    cont.disabled = true;
    Promise.resolve(safe(() => this.app.listSaves(), [])).then((l) => {
      const n = (l && l.length) | 0; cont.disabled = !n;
      const c = cont.querySelector('.mm'); if (c) c.textContent = n ? tr('son kayıttan') : tr('kayıt yok');
      const v = saves.querySelector('.mm'); if (v) v.textContent = n ? n + tr(' kayıt') : '';
    }).catch(() => {});
    // three small ones in a row
    const row = el('div', 'mrow'); box.append(row);
    const small = (icon, text, fn, badge) => this._mbtn(row, `${badge ? '<span class="up-badge">' + badge + '</span>' : ''}${ico(icon)}<span>${text}</span>`, fn, 'small msq');
    small('x-quests', tr('Nasıl Oynanır'), () => this._menuHowto());
    small('x-tech', tr('Güncellemeler'), () => menuUpdates(this), hasUnseen() ? tr('Yeni') : '');
    small('x-stance-def', tr('Ayarlar'), () => this._menuSettings());
    // the game's owner: player statistics (the server says who that is)
    Promise.resolve(safe(() => this.app.cloud.isOwner(), false)).then((own) => {
      if (!own || !box.isConnected) return;
      const st = item('x-stats', tr('İstatistikler'), tr('oyuncu sayıları'), () => import('./stats-ui.js').then((m) => m.menuStats(this)));
      box.insertBefore(st, row);   // (a list row: four small buttons did not fit their names)
    }).catch(() => {});
    // feedback: anything written to @claude in the game's chat reaches the developer (tools/read-chatlog.mjs --claude)
    this.menuEl.append(el('div', 'menu-fb panel', `<span class="mi">${ico('x-chat')}</span><span>${tr('Hata mı buldun, önerin mi var? Oyunda <kbd>Enter</kbd> ile sohbeti aç, <b class="cmention">@claude</b> yaz; doğrudan geliştiriciye gider.')}</span>`));
    safe(() => menuHud(this));   // the player plate (avatar, name, level, TP) and account chips around the menu
    // (owner 2026-11-20, drawn on a screenshot) the account unit (player plate, and the status pill and Profil / Çıkış
    // right under it) at the top left over the menu's column; the menu, and the feedback note right under it
    safe(() => {
      const hud = this.menuEl.querySelector('.menu-hud');
      const plate = hud && hud.querySelector('.mh-plate'), right = hud && hud.querySelector('.mh-right');
      if (!plate) return;
      const acct = el('div', 'mh-acct');
      hud.insertBefore(acct, plate);
      acct.append(plate);
      if (right) acct.append(right);
      // the card's last line: the TP numbers on the left, the sync status small on the right
      const txt = plate.querySelector('.mh-txt'), nums = plate.querySelector('.mh-nums'), pill = right && right.querySelector('.acc-status');
      if (txt) { const meta = el('span', 'mh-meta'); if (nums) meta.append(nums); if (pill) meta.append(pill); txt.append(meta); }
      const fb = this.menuEl.querySelector('.menu-fb'), stack = el('div', 'm-stack');
      this.menuEl.insertBefore(stack, box); stack.append(box); if (fb) stack.append(fb);
    });
    void saves; void firstLaunch;
  }
  // a short message at the top of the current menu box (green)
  _menuNote(text) {
    const box = this.menuEl.querySelector('.menu-box'); if (!box || !text) return;
    const n = el('div', 'mperr prof-ok menu-note'); n.textContent = String(text); n.setAttribute('role', 'status');
    const logo = box.querySelector('.tagline') || box.querySelector('.logo');
    if (logo) logo.after(n); else box.prepend(n);
  }
  _seg(parent, label, key, opts, cls = '') {
    const row = el('div', 'frow', `<label>${label}</label>`);
    const seg = el('div', 'seg' + (cls ? ' ' + cls : ''));
    for (const [val, text] of opts) {
      const b = el('button', this.setup[key] === val ? 'on' : '', text);
      b.onclick = () => { this._click(); this.setup[key] = val; seg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); };
      seg.append(b);
    }
    row.append(seg); parent.append(row);
  }
  // "Yeni Oyun" (owner 2026-11-20: "buttons jump around while picking a map, and you can't tell what map you get"):
  // the map types as cards with a real picture each (src/ui/map-preview.js), the chosen one large with a line on what
  // it plays like, and every other setting in fixed-width rows on the right, so nothing moves when something is picked
  _menuSetup() {
    const box = this._menuBox('<h2>' + tr('Yeni Oyun') + '</h2>');
    box.classList.add('setup');
    const S = this.setup;
    const grid = el('div', 'su-grid'); box.append(grid);
    // ---- left: the map ----
    const left = el('section', 'su-left'); grid.append(left);
    const big = el('div', 'su-big');
    const bigPic = el('div', 'su-bigpic'), bigTxt = el('div', 'su-bigtxt');
    big.append(bigPic, bigTxt); left.append(big);
    left.append(el('div', 'su-h', tr('Harita Türü')));
    const cards = el('div', 'su-types'); left.append(cards);
    const pic = (type, holder, px) => {
      holder.innerHTML = '';
      holder.dataset.t = type;
      if (type === 'random') { holder.append(el('div', 'su-rand', '?')); return; }
      const put = (c) => {
        if (!c || holder.dataset.t !== type) return;
        holder.innerHTML = '';
        const k = document.createElement('canvas'); k.width = px; k.height = px;
        const x = k.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(c, 0, 0, px, px);
        holder.append(k);
      };
      const c = mapPreview(type, S.enemies | 0, previewClimate(S.climate), put);
      if (c) put(c); else holder.append(el('div', 'su-wait', ''));
    };
    const drawBig = () => {
      const t = S.mapType || 'random';
      pic(t, bigPic, 236);
      bigTxt.innerHTML = '';
      const nm = el('b', 'su-name'); nm.textContent = MAP_TYPE_TR[t] || t;
      const ds = el('p', 'su-desc'); ds.textContent = MAP_DESC[t] || '';
      const fx = el('div', 'su-facts'); fx.textContent = MAP_FACTS[t] || '';
      bigTxt.append(nm, ds, fx);
    };
    const drawCards = () => {
      cards.innerHTML = '';
      for (const [t, name] of MAP_TYPES) {
        const b = el('button', 'su-card' + ((S.mapType || 'random') === t ? ' on' : ''));
        b.type = 'button'; b.title = MAP_DESC[t] || '';
        const ph = el('div', 'su-thumb'); b.append(ph); pic(t, ph, 84);
        const n = el('span', 'su-cname'); n.textContent = name; b.append(n);
        b.onclick = () => { this._click(); S.mapType = t; cards.querySelectorAll('.su-card').forEach((x) => x.classList.toggle('on', x === b)); drawBig(); };
        cards.append(b);
      }
    };
    // ---- right: the other settings ----
    const right = el('section', 'su-right'); grid.append(right);
    const row = (label, key, opts, after) => {
      const r = el('div', 'su-row'); r.append(el('label', '', label));
      const g = el('div', 'su-seg'); g.style.setProperty('--n', String(Math.min(opts.length, 6)));
      for (const [v, t] of opts) {
        const b = el('button', S[key] === v ? 'on' : ''); b.type = 'button'; b.textContent = t;
        b.onclick = () => { this._click(); S[key] = v; g.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b)); if (after) after(); };
        g.append(b);
      }
      r.append(g); right.append(r);
    };
    const redraw = () => { drawBig(); drawCards(); };
    row(tr('Harita Boyutu'), 'mapSize', [[192, tr('Minik')], [256, tr('Küçük')], [320, tr('Orta')], [384, tr('Büyük')], [448, tr('Çok Büyük')], [512, tr('Dev')]]);
    row(tr('İklim'), 'climate', CLIMATE_OPTS, redraw);
    row(tr('Düşman Sayısı'), 'enemies', [[1, '1'], [2, '2'], [3, '3']], redraw);
    row(tr('Zorluk'), 'difficulty', [['easy', tr('Kolay')], ['normal', tr('Normal')], ['hard', tr('Zor')]]);
    row(tr('Başlangıç Kaynakları'), 'startRes', [['low', tr('Düşük')], ['normal', tr('Normal')], ['high', tr('Yüksek')]]);
    row(tr('Başlangıç Çağı'), 'startAge', AGES.map((a, i) => [i, tr(a.name).split(' ')[0]]));
    row(tr('Harita Görünürlüğü'), 'fog', [['explored', tr('Keşfedilmiş')], ['dark', tr('Karanlık')]]);   // (explored: land shaded, nothing seen until scouted)
    // developer mode (devModeOffered): a sandbox game (no TP, no match history) with the map open and endless resources
    const dev = el('label', 'frow devrow hidden', tr('<input type="checkbox"> <span>Geliştirici modu</span> <small>tüm harita açık, sınırsız kaynak, çağ değiştirme</small>'));
    const devBox = dev.querySelector('input'); devBox.checked = !!this.devOn;
    devBox.onchange = () => { this._click(); this.devOn = devBox.checked; };
    right.append(dev);
    // (owner 2026-11-20: his developer mode was gone on the live site) also offered to the game's owner, as the server
    // says (the same check as his statistics; no address in the source)
    if (devModeOffered()) dev.classList.remove('hidden');
    else { this.devOn = false; Promise.resolve(safe(() => this.app.cloud.isOwner(), false)).then((own) => { if (own && dev.isConnected) dev.classList.remove('hidden'); }).catch(() => {}); }
    const acts = el('div', 'su-acts'); right.append(acts);
    this._mbtn(acts, tr('Geri'), () => this._menuMain());
    this._mbtn(acts, tr('Başla'), () => {
      const d = !!this.devOn && !dev.classList.contains('hidden');
      this.app.newGame({ ...this.setup, sandbox: d, dev: d, seed: (Math.random() * 1e9) | 0 });
    }, 'primary');
    redraw();
  }
  // (owner 2026-11-20: "oda kur kısmında da harita görselleri olsun") the seven map cards of the Yeni Oyun screen, no big
  // picture (the cards show it); the host picks, the others see the chosen one marked
  _lobbyMap(sets, players, onPick) {
    const cur = sets.mapType || 'random', climate = previewClimate(sets.climate), enemies = Math.max(1, Math.min(7, (players | 0) - 1));
    const pic = (type, holder, px) => {
      holder.innerHTML = ''; holder.dataset.t = type;
      if (type === 'random') { holder.append(el('div', 'su-rand', '?')); return; }
      const put = (c) => {
        if (!c || holder.dataset.t !== type) return;
        holder.innerHTML = '';
        const k = document.createElement('canvas'); k.width = px; k.height = px;
        const x = k.getContext('2d'); x.imageSmoothingEnabled = true; x.drawImage(c, 0, 0, px, px);
        holder.append(k);
      };
      const c = mapPreview(type, enemies, climate, put);
      if (c) put(c); else holder.append(el('div', 'su-wait', ''));
    };
    const box = el('div', 'lb-map' + (onPick ? '' : ' ro'));
    box.append(el('div', 'lb-maph', tr('Harita Türü')));
    const cards = el('div', 'su-types lb-types');
    for (const [t, name] of MAP_TYPES) {
      const b = el('button', 'su-card' + (cur === t ? ' on' : ''));
      b.type = 'button'; b.title = (MAP_TYPE_TR[t] || name) + ': ' + (MAP_DESC[t] || '') + (MAP_FACTS[t] ? ' · ' + MAP_FACTS[t] : '');
      const ph = el('div', 'su-thumb'); b.append(ph); pic(t, ph, 72);
      const n = el('span', 'su-cname'); n.textContent = name; b.append(n);
      if (onPick) b.onclick = () => { this._click(); cards.querySelectorAll('.su-card').forEach((x) => x.classList.toggle('on', x === b)); onPick(t); };
      else b.tabIndex = -1;
      cards.append(b);
    }
    box.append(cards);
    return box;
  }
  _menuSaves(errText) {
    const box = this._menuBox(tr('<h2>Kayıtlı Oyunlar</h2><div class="mperr hidden"></div><div class="savelist">Yükleniyor...</div>'));
    const list = box.querySelector('.savelist'), err = box.querySelector('.mperr');
    const fail = (t) => { err.textContent = t; err.classList.remove('hidden'); };
    if (errText) fail(errText);
    const cloudOn = !!safe(() => this.app.cloud?.loggedIn, false);
    let busy = false;
    Promise.resolve(safe(() => this.app.listSaves({ fresh: true }), [])).then((l) => {
      list.innerHTML = '';
      if (!l || !l.length) { list.innerHTML = tr('<div style="color:var(--dim);text-align:center;padding:20px">Kayıt bulunamadı.</div>'); return; }
      for (const s of l) {
        // (cloud: ☁ = only in the cloud / ☁↓ = newer in the cloud; downloaded when opened)
        const d = el('div', 'saveitem', `<span>${esc(saveBadge(s) + (s.name || s.key))}</span><small>${s.time ? new Date(s.time).toLocaleString(loc()) : ''}</small>`);
        if (s.cloud) d.title = saveBadgeTitle(s);
        if (s.cloud === 'only' || s.cloud === 'newer') d.classList.add('cloud-only');
        d.onclick = async () => {
          if (busy) return; busy = true; this._click();
          err.classList.add('hidden');
          if (s.cloud === 'only' || s.cloud === 'newer') { d.style.opacity = '0.6'; d.querySelector('small').textContent = tr('☁ İndiriliyor...'); }
          const ok = await Promise.resolve(safe(() => this.app.loadGame(s.key), false)).catch(() => false);
          busy = false;
          if (!ok && this.mode === 'menu') this._menuSaves(this.app.lastLoadError || tr('Kayıt açılamadı.'));
        };
        if (cloudOn) {
          // (guests keep the old list without a delete button)
          const del = el('button', 'lb-x', '✕'); del.title = tr('Kaydı sil');
          del.onclick = async (ev) => {
            ev.stopPropagation();
            const c = await confirmDeleteSave(s); if (!c || this.mode !== 'menu') return;
            Promise.resolve(safe(() => this.app.deleteSave(s.key, c), null)).then((r) => this._menuSaves(r && r.ok === false ? r.error : '')).catch(() => this._menuSaves(tr('Kayıt silinemedi.')));
          };
          d.append(del);
        }
        list.append(d);
      }
    }).catch(() => { list.textContent = tr('Kayıtlar okunamadı.'); });
    this._mbtn(box, tr('Geri'), () => this._menuMain());
  }
  _menuHowto() {
    const box = this._menuBox(`<h2>${tr('Nasıl Oynanır')}</h2><div class="howto">` + [
      tr('<b>Seçim:</b> Sol tık ile seç, sürükleyerek çoklu seç. Çoklu seçimde alt paneldeki tür düğmeleri: tık = yalnızca o türü seç, <kbd>Shift</kbd>+tık = o türü çıkar, <kbd>Ctrl</kbd>+tık = ekrandaki o türün hepsini seç.'),
      tr('<b>Komut:</b> Sağ tık — yürü, topla, saldır, inşa et / onar. <kbd>Shift</kbd> basılıyken verilen emirler sıraya eklenir (köylü önce mevcut işini bitirir). Düz sağ tıkla yürüyen birlikler yoldaki düşmanlara aldırmaz; yolda savaşmaları için <kbd>K</kbd> (Saldırarak Yürü) ya da <kbd>V</kbd> (Devriye) tuşuna basıp yere sol tıkla. Kendi oduncu ya da maden kampına sağ tık, köylüleri en yakın kaynağa gönderir.'),
      tr('<b>Kamera:</b> <kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd> / ok tuşları veya ekran kenarı ile kaydır (WASD yalnızca kamerayı oynatır), tekerlek ile yakınlaş, orta tuş ya da <kbd>Boşluk</kbd> basılıyken fareyle döndür, <kbd>Home</kbd> / <kbd>Backspace</kbd> Şehir Merkezine dön. Touchpad ile mi oynuyorsun? Ayarlar → <b>Touchpad modu</b>: iki parmakla kaydır, parmakları açıp kapatarak yakınlaş.'),
      tr('<b>Komut kartı:</b> Sağ alttaki düğmeler; kısayollar {0} ızgara sırasıyla.', '<kbd>Q</kbd><kbd>E</kbd><kbd>R</kbd><kbd>T</kbd><kbd>Y</kbd> / <kbd>F</kbd><kbd>G</kbd><kbd>H</kbd><kbd>J</kbd><kbd>K</kbd> / <kbd>Z</kbd><kbd>X</kbd><kbd>C</kbd><kbd>V</kbd><kbd>B</kbd>'),
      tr('<b>Binalar:</b> <kbd>Shift</kbd>+tık ile aynı türden birden çok bina seç, çift tık ekrandaki tümünü seçer; üretim her binada aynı anda başlar. <kbd>Shift</kbd>+üret: 5 adet sıraya ekler. <kbd>Shift</kbd> basılıyken bina yerleştirmek araç açık kalır, birden çok temel atarsın. Yerleştirirken <kbd>R</kbd> binayı çevirir. Kendi binanı seçince <b>Döndür</b> düğmesi de çıkar.'),
      tr('<b>Sur kapısı:</b> Bitmiş bir sur parçasını seç, <b>Kapı Aç</b> (<kbd>Q</kbd>) ile 3 kare genişliğinde kapı yap. Kapıdan yalnızca sen ve müttefiklerin geçer.'),
      tr("<b>Ekonomi:</b> Köylülerle yiyecek, odun, taş ve altın topla; Taş Devri'nde ağıl, Tunç Devri'nden itibaren tarla kur (nüfus sınırı sabit 1000, ev gerekmez)."),
      tr("<b>Büyücü:</b> Tapınakta (Taş Devri'nden itibaren) üretilir. Saldırmaz; yaralı dost birlikleri savaş sırasında da iyileştirir. Taş Devri'nde yalnızca en yaralı tek birliği (6 kare), Tunç Devri'nden itibaren çevresindeki herkesi iyileştirir; alanı (6 → 8 kare) ve hızı (2 → 6 can/sn) her çağda artar, tapınak araştırmaları hızı ayrıca artırır. Bir birliği aynı anda yalnızca bir büyücü iyileştirir."),
      tr('<b>Çağ atlama:</b> Şehir Merkezinden yeterli kaynak ve bina ile sonraki çağa geç; yeni birimler ve binalar açılır.'),
      tr('<b>Zafer:</b> Rakiplerin birim üreten bütün binalarını yık: şehir merkezi, kışla, okçuluk alanı, ahır, kuşatma atölyesi, fabrika ve liman (inşaatına başlanmış temeller de sayılır). Geriye kalan askerler ve köylüler oyunu sürdürmez. Daha fazla binası olan bir rakibin elinde bunlardan 1-2 tane kalınca mini haritada yanıp söner.'),
      tr('<b>Diğer:</b> <kbd>Esc</kbd> iptal / duraklat, mini haritaya tıklayarak kamerayı taşı, sağ tıkla birimleri gönder.'),
    ].join('<br>\n') + '</div>');
    // the tutorial battle (sim/tutorial.js): a story with Bilge Ayaz that teaches the mechanics step by step
    this._mbtn(box, tr('Öğretici Savaşı Başlat'), () => { try { this.app.newGame({ ...TUT_CFG }); } catch (err) { console.error(err); } }, 'primary');
    this._mbtn(box, tr('Geri'), () => this._menuMain());
  }
  _settingsBody(parent) {
    const vols = [['master', tr('Ana Ses')], ['sfx', tr('Efektler')], ['ambient', tr('Ortam')], ['music', tr('Müzik')], ['ui', tr('Arayüz')]];
    for (const [cat, label] of vols) {
      const cur = Math.round((this.settings.vol[cat] ?? 0.8) * 100);
      const row = el('div', 'frow', `<label>${label}</label><input type="range" min="0" max="100" value="${cur}"><span class="val">${cur}</span>`);
      const inp = row.querySelector('input'), val = row.querySelector('.val');
      inp.oninput = () => {
        val.textContent = inp.value; this.settings.vol[cat] = inp.value / 100;
        safe(() => this.app.audio?.setVolume(cat, inp.value / 100)); this._saveSettings();
      };
      inp.onchange = () => { if (cat === 'ui') this._click(); };
      parent.append(row);
    }
    const row = el('div', 'frow', `<label>${tr('Grafik Kalitesi')}</label>`);
    const seg = el('div', 'seg');
    for (const [v, t] of [['low', tr('Düşük')], ['high', tr('Yüksek')]]) {
      const b = el('button', this.settings.quality === v ? 'on' : '', t);
      b.onclick = () => {
        this._click(); this.settings.quality = v; seg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on');
        safe(() => this.app.renderer?.setQuality(v)); this._saveSettings();
      };
      seg.append(b);
    }
    row.append(seg); parent.append(row);
    // (players 2026-11-22: "make it playable with a touchpad") two-finger scroll pans the camera, a pinch zooms (src/input.js onWheel)
    const trow = el('div', 'frow', `<label>${tr('Touchpad modu')}</label>`);
    const tseg = el('div', 'seg');
    for (const [v, t] of [[false, tr('Kapalı')], [true, tr('Açık')]]) {
      const b = el('button', !!this.settings.touchpad === v ? 'on' : '', t);
      b.title = tr('Açık: iki parmakla kaydırınca kamera kayar, parmakları açıp kapatınca yakınlaşır.');
      b.onclick = () => { this._click(); this.settings.touchpad = v; tseg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); this._saveSettings(); };
      tseg.append(b);
    }
    trow.append(tseg); parent.append(trow);
    const lrow = el('div', 'frow', `<label>${tr('Dil')}</label>`);
    const lseg = el('div', 'seg');
    for (const [v, t] of [['tr', 'Türkçe'], ['en', 'English']]) {
      const b = el('button', LANG === v ? 'on' : '', t);
      b.onclick = () => { this._click(); lseg.querySelectorAll('button').forEach((x) => x.classList.remove('on')); b.classList.add('on'); setLang(v); };
      lseg.append(b);
    }
    lrow.append(lseg); parent.append(lrow);
  }
  _menuSettings() {
    const box = this._menuBox('<h2>' + tr('Ayarlar') + '</h2>');
    this._settingsBody(box);
    this._mbtn(box, tr('Geri'), () => this._menuMain());
  }
  _loadSettings() {
    const def = { vol: { master: 0.8, sfx: 0.8, ambient: 0.5, music: 0.7, ui: 0.6 }, quality: 'high', touchpad: false };
    try { const o = JSON.parse(localStorage.getItem('aevum.settings')); if (o && o.vol) return { ...def, ...o, vol: { ...def.vol, ...o.vol } }; } catch (e) { /* ignore */ }
    return def;
  }
  _saveSettings() { try { localStorage.setItem('aevum.settings', JSON.stringify(this.settings)); } catch (e) { /* ignore */ } }
  _applySettings() {
    for (const k in this.settings.vol) safe(() => this.app.audio?.setVolume(k, this.settings.vol[k]));
    safe(() => this.app.renderer?.setQuality(this.settings.quality));
  }

  // ------------------------------------------------------------------ game binding
  onNewGame(game) {
    this.sel = []; this.page = 'root'; this.cardSig = null; this.selSig = null; this.questSig = null;
    this._ageCls = null;
    this.lastRes = {}; this.pings = []; this.questDoneAt = new Map(); this.gameOverShown = false;
    this.hintAt = {}; this.rateSamples = []; this.slowT = -99; this.orphanSince = new Map(); this.objSig = null;
    this.mmTerrain = null; this.mmFog = null; this.mmFogVer = -1;
    this.toastsEl.innerHTML = ''; this._closeModal(true);
    this._applySettings();
    const ev = game?.events; if (!ev) return;
    const on = (n, fn) => safe(() => ev.on(n, (p) => { if (this.app.game === game) safe(() => fn(p || {})); }));
    const railNm = () => BUILDINGS.rail?.name || 'Ray', isRailDone = (t) => t === railNm() + ' tamamlandı' || t === tr('{0} tamamlandı', railNm());
    on('notify', (p) => { if (isRailDone(p.text) || p.text === ATTACK_TEXT || p.text === tr(ATTACK_TEXT)) return; this.toast(p.text, p.type || 'info', p.x, p.z); });
    this._trainsSeen = new Set(); this._unloadT = -99;
    on('trainArrive', (p) => {
      const trn = p.e; if (!trn || trn.owner !== this._me() || this._trainsSeen.has(trn.id)) return;
      this._trainsSeen.add(trn.id); this.toast(ico('u-train') + tr(' Demir yolu bağlandı!'), 'good', trn.x, trn.z); this.cardSig = null; this.selSig = null;
    });
    on('board', (p) => { if (p.transport?.owner === this._me()) { this.cardSig = null; this.selSig = null; } });
    on('unload', (p) => {
      if (p.transport?.owner === this._me()) { this.cardSig = null; this.selSig = null; }
      const t = p.transport; if (!t || t.owner !== this._me() || game.time - this._unloadT < 3) return;
      this._unloadT = game.time; this.toast(`${ico('x-unload')} ${tr('{0} birim karaya çıktı', (p.units || []).length || '')}`.replace('  ', ' '), 'info', t.x, t.z);
    });
    on('trained', (p) => { if (p.e?.owner === this._me()) this.toast(`${UNITS[p.e.type]?.icon || ''} ${tr('{0} hazır', tr(UNITS[p.e.type]?.name) || p.e.type)}`, 'info', p.e.x, p.e.z); });
    on('researched', (p) => { if (p.owner === this._me()) { const t = typeof p.tech === 'string' ? TECHS[p.tech] : p.tech; this.toast(`${t?.icon || ico('x-tech')} ${tr('Araştırma tamamlandı: {0}', tr(t?.name) || p.tech)}`, 'good'); this.cardSig = null; } });
    on('buildComplete', (p) => { if (p.e?.owner === this._me() && p.e.type !== 'rail') this.toast(`${BUILDINGS[p.e.type]?.icon || ico('b-house')} ${tr('{0} tamamlandı', tr(BUILDINGS[p.e.type]?.name) || p.e.type)}`, 'good', p.e.x, p.e.z); });
    on('questDone', (p) => {
      const q = p.quest || {}; this.questDoneAt.set(q.id, performance.now()); this.questSig = null;
      this.toast(`✔ ${tr('Görev tamamlandı: {0}', tr(q.title || ''))}${q.reward ? ' (' + this._rewardText(q.reward) + ')' : ''}`, 'good');
    });
    on('underAttack', (p) => {
      this.pings.push({ x: p.x, z: p.z, t: performance.now(), big: true });
      if (game.time - this.lastAttackToast > 8) { this.lastAttackToast = game.time; this._attackAlert(p.x, p.z); }
    });
    on('ageUp', (p) => {
      if (p.owner === this._me()) { if (!p.dev) this.showAgeUp(p.age); }   // (developer mode switches skip the cinematic)
      else if (this.game?.mp && this._ally(this._me(), p.owner)) this.toast(`${ico('x-ally')} ${tr("{0} {1}'na ulaştı", this._pname(p.owner), tr(AGES[p.age]?.name) || tr('yeni çağ'))}`, 'info');
      else this.toast(tr("Bir rakip {0}'na ulaştı", tr(AGES[p.age]?.name) || tr('yeni çağ')), 'warn');
      this.cardSig = null;
    });
    on('gameOver', (p) => this.showGameOver(!!p.won));
    on('tribute', (p) => {
      const me = this._me(), t = `${p.amount} ${RES_ICON[p.res] || ''} ${RES_NAME[p.res] || p.res}`;
      if (p.to === me) this.toast(`${ico('x-ally')} ${tr('{0} sana {1} gönderdi', esc(this._pname(p.from)), t)}`, 'good');
      else if (p.from === me) this.toast(`${ico('x-ally')} ${tr('{0} oyuncusuna {1} gönderildi', esc(this._pname(p.to)), t)}`, 'info');
      if (this._tribOpen && this.modalEl.querySelector('.tribute')) safe(() => this._renderTribute());
    });
    if (this.tribBtn) this.tribBtn.style.display = this._allies().length ? '' : 'none';
    const mp = !!this.app.net;
    for (const b of [this.pauseBtn]) if (b) b.style.display = mp ? 'none' : '';
    if (this.saveBtn) { this.saveBtn.style.display = ''; this.saveBtn.title = mp ? tr('Maçı kaydet: herkes aynı anda kaydeder (Çok Oyunculu → Kayıtlı Maça Devam Et)') : this.saveBtn.title; }
    if (this.chatBtn) this.chatBtn.style.display = mp ? '' : 'none';
    // tutorial mode: the guide's panel and highlights; no saving there (main.js saveGame)
    if (this.tut) { safe(() => this.tut.destroy()); this.tut = null; }
    if (game.cfg?.tutorial && game.quests?.tutorial) {
      this.tut = safe(() => new TutorialUI(this, game), null);
      if (this.tut && this.saveBtn) this.saveBtn.style.display = 'none';
    }
    if (this.netEl) { this.netEl.remove(); this.netEl = null; }
    this.scoreSig = null;
    if (this.mode !== 'hud') this.showHUD();
  }
  // Under attack (owner 2026-11-14: nobody noticed it): red edge flash + a banner that says what and where (click /
  // Space: go there) + a big minimap ping. The sim throttles 'underAttack' to once per 10 s; the alarm is in audio.js.
  _attackAlert(x, z) {
    const g = this.game, me = this._me();
    let what = null, best = 9;
    for (const e of g.entities.values()) {   // (once per 10 s at most)
      if (e.owner !== me || e.dead) continue;
      const d = Math.hypot(e.x - x, e.z - z) - (e.kind === 'building' ? (e.size || 1) / 2 : 0);
      if (d < best) { best = d; what = e; }
    }
    const nm = what ? stripIcons(this._def(what)?.name || '') : '';
    const tc = safe(() => g.buildingsOf(me).find((b) => b.type === 'towncenter' && b.done), null);
    let where = '';
    if (tc && tc !== what) {
      const dx = x - tc.x, dz = z - tc.z, d = Math.hypot(dx, dz);
      where = d < 12 ? tr('Şehir Merkezi yakınında') : tr("Şehir Merkezi'nin {0} ({1} kare)", DIR_TR[((Math.round(Math.atan2(dz, dx) / (Math.PI / 4)) % 8) + 8) % 8], Math.round(d));
    }
    if (!this.attackEl) {
      this.attackEl = el('div', 'attackbanner hidden');
      this.attackEl.onclick = () => { const a = this.attackEl._at; if (a) { this._click(); this.app.focus?.(a.x, a.z); } };
      this.flashEl = el('div', 'attackflash');
      this.hudEl.append(this.flashEl, this.attackEl);
    }
    const b = this.attackEl;
    b._at = { x, z };
    b.innerHTML = `<b>${ico('x-atk')} ${tr('Saldırı altındasın!')}</b><span>${esc([nm, where].filter(Boolean).join(' · ') || tr('Mini haritadaki kırmızı işarete bak.'))}</span><small>${tr('Tıkla ya da Boşluk: oraya git')}</small>`;
    b.classList.remove('hidden', 'show'); void b.offsetWidth; b.classList.add('show');
    // (no red screen-edge flash any more, 2026-11-17: "make it plainer" - the banner, the minimap ping and one horn)
    clearTimeout(this._attackT);
    this._attackT = setTimeout(() => { b.classList.remove('show'); b.classList.add('hidden'); this.flashEl.classList.remove('on'); }, ATTACK_MS);
  }

  // Fullscreen (Fullscreen API, with the webkit prefix for Safari)
  _buildFullscreenBtn(top) {
    const d = document, r = d.documentElement;
    const can = !!(d.fullscreenEnabled || d.webkitFullscreenEnabled || r.requestFullscreen || r.webkitRequestFullscreen);
    const fsEl = () => d.fullscreenElement || d.webkitFullscreenElement || null;
    const b = el('button', 'tbtn fsbtn', ico('x-fullscreen'));
    if (!can) b.style.display = 'none';
    const fail = () => this.hint('fs', tr('Tam ekran açılamadı.'), 'warn', 3);
    b.onclick = () => {
      this._click();
      this._hideTip();
      try {
        if (fsEl()) { const ex = d.exitFullscreen || d.webkitExitFullscreen; if (ex) { const p = ex.call(d); if (p && p.catch) p.catch(() => {}); } }
        else if (r.requestFullscreen) { const p = r.requestFullscreen({ navigationUI: 'hide' }); if (p && p.catch) p.catch(fail); }
        else if (r.webkitRequestFullscreen) r.webkitRequestFullscreen();
      } catch (err) { fail(); }
    };
    // (owner 2026-11-24) Esc in fullscreen should only deselect in-game: Keyboard Lock (Chromium) keeps Esc for the page;
    // the button, F11 and holding Esc still leave fullscreen. Other browsers: no lock, Esc exits as before.
    const kb = navigator.keyboard;
    const lockEsc = (on) => { try { if (!kb || !kb.lock) return; if (on) { const p = kb.lock(['Escape']); if (p && p.catch) p.catch(() => {}); } else kb.unlock(); } catch (err) { /* unsupported */ } };
    const sync = () => { const on = !!fsEl(); lockEsc(on); b.innerHTML = ico(on ? 'x-fullscreen-exit' : 'x-fullscreen'); b.classList.toggle('on', on); };
    d.addEventListener('fullscreenchange', sync); d.addEventListener('webkitfullscreenchange', sync);
    this._tip(b, () => (fsEl() ? { name: tr('Tam Ekrandan Çık'), desc: tr('Pencere görünümüne dön. Esc tuşunu basılı tutmak da çıkarır.') } : { name: tr('Tam Ekran'), desc: tr('Oyunu tam ekranda oyna. Çıkmak için tekrar tıkla ya da Esc tuşunu basılı tut.') }));
    top.append(b); this.fsBtn = b;
    return b;
  }

  _rewardText(rw) { return RES_LIST.filter((r) => rw[r]).map((r) => `${RES_ICON[r]}+${rw[r]}`).join(' '); }

  onSelectionChanged(ids) {
    this.sel = (ids || []).slice();
    this.page = 'root';
    this.cardSig = null; this.selSig = null;
    this.tipEl.classList.add('hidden');
    if (this.mode === 'hud' && this.game) { this._refreshSel(); this._refreshCard(); }
  }

  setPlacement(type) {
    if (!type) { this.placeEl.classList.add('hidden'); return; }
    const b = BUILDINGS[type]; if (!b) return;
    const turn = !NO_ROTATE.has(type) && !['wall', 'gate', 'rail'].includes(type);   // (R turns it, src/input.js)
    this.placeEl.innerHTML = `<span>${b.icon || ico('x-build')} ${tr('<b>{0}</b> yerleştir', esc(tr(b.name)))}</span><span class="tooltip-inline tc" style="display:flex;gap:8px">${this._costHtml(b.cost)}</span><span style="color:var(--dim)">${type === 'wall' ? tr('Basılı tutup sürükle: sur hattı · Bırak: yerleştir') : type === 'gate' ? tr('Bitmiş bir sur parçasına tıkla: kapı olur') : type === 'rail' ? tr('Basılı tutup sürükle: ray hattı · Bırak: yerleştir') : type === 'dock' ? tr('Kıyıya yerleştir: bir kısmı suda olmalı · Sol tık: yerleştir') : tr('Sol tık: yerleştir · Shift+tık: birden çok, köylüler sırayla yapar')}${turn ? tr(' · R: döndür') : ''}${tr(' · Sağ tık / Esc: iptal')}</span>`;
    this.placeEl.classList.remove('hidden');
  }

  // ------------------------------------------------------------------ toasts
  toast(text, type = 'info', x, z) {
    if (!text) return;
    // dedupe: the same message (ignoring leading icons / a trailing reward) within 1.5 s shows once
    const now = performance.now(), key = String(text).replace(/^[^\p{L}\p{N}]+/u, '').replace(/\s*\([^)]*\)\s*$/, '').trim();
    this._recentToasts = (this._recentToasts || []).filter((r) => now - r.t < 1500);
    if (this._recentToasts.some((r) => r.key === key)) return;
    this._recentToasts.push({ key, t: now });
    if (this.app.net && /kaydedildi|Senkron bozuldu|ayrıldı|düştü|koptu|saved|out of sync|left the game|host left|dropped|connection lost/i.test(text)) this._chatSys(String(text));   // system line in the chat feed
    const t = el('div', 'toast ' + type, keepIcons(esc(text)));
    if (x != null && z != null) t.onclick = () => this.app.focus?.(x, z);
    this.toastsEl.prepend(t);
    while (this.toastsEl.children.length > 6) this.toastsEl.lastChild.remove();
    setTimeout(() => t.classList.add('out'), 5200);
    setTimeout(() => t.remove(), 5700);
  }

  // Rate limited toast: the same key is shown at most once per `gap` seconds.
  hint(key, text, type = 'warn', gap = 6, x, z) {
    const now = performance.now(), last = this.hintAt[key];
    if (last !== undefined && now - last < gap * 1000) return false;
    this.hintAt[key] = now;
    this.toast(text, type, x, z);
    return true;
  }

  // Income per minute from players[this._me()].stats.gathered over the last 30 s of game time.
  _refreshRates(g, p) {
    const ga = p.stats?.gathered; if (!ga) return;
    const t = g.time || 0, S = this.rateSamples;
    if (S.length && t < S[S.length - 1].t) S.length = 0;
    if (S.length && t - S[S.length - 1].t < 1) return;
    S.push({ t, food: ga.food || 0, wood: ga.wood || 0, stone: ga.stone || 0, gold: ga.gold || 0 });
    while (S.length > 2 && t - S[1].t >= 30) S.shift();
    const a = S[0], span = t - a.t;
    for (const r of RES_LIST) {
      const n = this.resEls[r].querySelector('.rate'); if (!n) continue;
      const v = span >= 3 ? Math.round(((ga[r] || 0) - a[r]) / span * 60) : 0;
      const s = v > 0 ? '+' + v : '';
      if (n.textContent !== s) n.textContent = s;
    }
  }

  // Idle villager button, population / orphan foundation hints, objective line. Runs about once a second.
  _refreshSlow(g, p) {
    const now = performance.now();
    if (now - this.slowT < 900) return;
    this.slowT = now;
    const units = safe(() => g.unitsOf(this._me()), []) || [], blds = safe(() => g.buildingsOf(this._me()), []) || [];
    let idle = 0; const building = new Set();
    for (const u of units) {
      if (u.dead || u.type !== 'villager') continue;
      if (u.state === 'idle') idle++;
      if (u.order && u.order.type === 'build') building.add(u.order.targetId);
      if (u.state === 'build' && u.order && u.order.targetId != null) building.add(u.order.targetId);
    }
    const ib = this.idleEl.querySelector('b'); if (ib.textContent !== String(idle)) ib.textContent = idle;
    // (players 2026-11-22) how many workers gather each resource (villagers and fishing boats; one walking a load home counts too)
    const wk = { food: 0, wood: 0, stone: 0, gold: 0 };
    for (const u of units) {
      if (u.dead || (u.type !== 'villager' && u.type !== 'fishboat')) continue;
      let o = u.order; if (o && o.type === 'return') o = o.resume;
      if (o && (o.type === 'gather' || o.type === 'fish') && wk[o.res] !== undefined) wk[o.res]++;
      else if (u.type === 'fishboat' && o && o.type === 'fish') wk.food++;
    }
    for (const r of RES_LIST) {
      const n = this.resEls[r].querySelector('.wk'); if (!n) continue;
      const h = wk[r] ? ico('u-villager') + wk[r] : '';
      if (n._h !== h) { n._h = h; n.innerHTML = h; }
    }
    this.idleEl.classList.toggle('has', idle > 0);
    const demo = !!this.app.demo;
    // hints
    if (!demo && !g.over) {
      if (p.pop >= p.popCap && p.popCap > 0) this.hint('popcap', ico('x-pop') + tr(' Nüfus sınırına ulaştın (1000)'), 'warn', 60);
      const seen = new Set();
      for (const b of blds) {
        if (b.dead || b.done || b.type === 'wall' || b.type === 'gate') continue;
        seen.add(b.id);
        if (building.has(b.id)) { this.orphanSince.delete(b.id); continue; }
        const t0 = this.orphanSince.get(b.id);
        if (t0 === undefined) { this.orphanSince.set(b.id, now); continue; }
        if (now - t0 > 6000) this.hint('orphan', `${ico('x-build')} ${tr('{0} temelinde işçi yok — köylü seçip temele sağ tıkla', tr(BUILDINGS[b.type]?.name) || tr('İnşaat'))}`, 'warn', 30, b.x, b.z);
      }
      for (const id of this.orphanSince.keys()) if (!seen.has(id)) this.orphanSince.delete(id);
    }
    // objective line (tutorial: the chapter's objective)
    if (this.tut && !demo) { this.stepsEl.classList.add('hidden'); this.tut.objective(this.objEl); return; }
    const next = AGES[p.age + 1];
    if (demo || !next) { this.objEl.classList.add('hidden'); this.stepsEl.classList.add('hidden'); return; }
    this.objEl.classList.remove('hidden');
    const has = (t) => blds.some((b) => b.type === t && !b.dead);
    const ga = p.stats?.gathered || {};
    // (players 2026-11-22: it asked for a farm in the Stone Age, the farm opens in the Bronze Age) a step that names a
    // building shows only once that building is open in the player's age
    const steps = [
      [tr('Yiyecek ve odun topla'), (ga.food || 0) + (ga.wood || 0) >= 150],
      [tr('Ağıl kur'), has('pasture'), 'pasture'],
      [tr('Kışla kur'), has('barracks'), 'barracks'],
      [tr("{0}'ne geç", tr(next.name)), false],
    ].filter((s) => !s[2] || (BUILDINGS[s[2]]?.age | 0) <= (p.age | 0));
    if (p.age > 0) steps.length = 0;
    let cur = steps.findIndex((s) => !s[1]);
    if (p.age === 0 && cur === steps.length - 1 && (g.time || 0) > 600) steps.length = 0;
    const types = new Set();
    for (const b of blds) if (b.done && !b.dead && !['house', 'wall', 'gate', 'towncenter'].includes(b.type)) types.add(b.type);
    let aging = null;
    for (const b of blds) { const q = b.queue?.[0]; if (q && q.kind === 'age') { aging = q; break; } }
    const parts = [], miss = [];
    for (const r in next.cost) {
      const need = next.cost[r], have = Math.floor(p.res[r] || 0);
      parts.push(Math.min(1, have / need));
      if (have < need) miss.push(`${RES_ICON[r] || r} ${need - have}`);
    }
    if (next.reqBuildings > 0) {
      parts.push(Math.min(1, types.size / next.reqBuildings));
      if (types.size < next.reqBuildings) miss.push(`${ico('x-buildings')} ${tr('{0} farklı bina türü', next.reqBuildings - types.size)}`);
    }
    // named buildings the next age needs, and the minimum stay in this age (game.ageMissingTypes / ageWait)
    const needT = (next.reqTypes || []).filter((t) => !blds.some((b) => b.type === t && b.done && !b.dead));
    if (next.reqTypes) parts.push(1 - needT.length / next.reqTypes.length);
    for (const t of needT) miss.push(`${ico('x-buildings')} ${BUILDINGS[t] ? tr(BUILDINGS[t].name) : t}`);
    const wait = g.ageWait ? g.ageWait(p.id) : 0;
    if (wait > 0) miss.push(`⏳ ${Math.floor(wait / 60)}:${String(Math.floor(wait % 60)).padStart(2, '0')}`);
    const frac = aging ? this._qprog(aging) : (parts.length ? parts.reduce((a, b) => a + b, 0) / parts.length : 1);
    // the cost as chips (red: not enough yet) and the building types count
    let cost = this._costHtml(next.cost);
    if (next.reqBuildings > 0) cost += `<span class="${types.size < next.reqBuildings ? 'no' : ''}" data-r="bld">${ico('x-buildings')} ${Math.min(types.size, next.reqBuildings)}/${next.reqBuildings}</span>`;
    const hasTc = blds.some((b) => b.type === 'towncenter' && b.done && !b.dead);
    const mtxt = aging ? tr('Çağ atlanıyor…') : miss.length ? tr('Eksik: ') + miss.join(' · ') : !hasTc ? tr('Çağ atlamak için bir Şehir Merkezi gerekli') : tr('Hazır! Sağdaki düğmeyle çağ atla');
    const sig = steps.map((s) => (s[1] ? 1 : 0)).join('') + '|' + p.age + '|' + mtxt + '|' + cost;
    this.objEl.querySelector('.obar i').style.width = (frac * 100).toFixed(1) + '%';
    if (sig === this.objSig) return;
    this.objSig = sig;
    this.objEl.querySelector('.osteps').innerHTML = '';
    this.stepsEl.innerHTML = steps.map((s, i) => `<span class="${s[1] ? 'done' : i === cur ? 'cur' : ''}">${s[1] ? '✔ ' : ''}${esc(s[0])}</span>`).join('<em>→</em>');
    this.stepsEl.classList.toggle('hidden', !steps.length);
    this.objEl.querySelector('.ot').textContent = tr(next.name);
    const acost = this.objEl.querySelector('.acost'); acost.innerHTML = cost;
    // (player 2026-11-23: "the materials in the age bar have no names") each chip names itself on hover / tap
    for (const ch of acost.querySelectorAll('[data-r]')) this._chipTip(ch, ch.dataset.r);
    /* (owner 2026-11-22) no 'Eksik: …' line: the cost chips show what is short and the age button's tooltip lists the rest */
    const om = this.objEl.querySelector('.om'); om.innerHTML = ''; om.classList.remove('ready'); void mtxt;
    // what is missing besides resources (building types, named buildings, the minimum stay) for the age button's tooltip
    const resIc = Object.values(RES_ICON);
    this._ageMiss = miss.filter((m) => !resIc.some((ic) => m.startsWith(ic))).map((m) => stripIcons(m).trim()).filter(Boolean).join(' · ');
  }

  // the age-up button of the next age box: the town center's own age-up action (same check / run as the card button)
  _ageSpec() {
    const g = this.game, me = this._me(), p = g?.players?.[me], na = p && AGES[p.age + 1];
    if (!na) return { icon: ico('x-ageup'), name: tr('Son çağdasın'), check: () => ({ ok: false, reason: tr('Zaten son çağdasın') }), run: () => false };
    const tcs = () => (safe(() => g.buildingsOf(me), []) || []).filter((b) => b.type === 'towncenter' && b.done && !b.dead);
    const sb = g.cfg?.sandbox ? 2 : 1;
    return {
      icon: ico('x-ageup'), name: tr('Çağ Atla: ') + tr(na.name), cost: na.cost, time: na.time * QUEUE_TIME_MUL / sb / (g.cfg?.tutorial ? 4 : 1),
      desc: ((na.unlockText || []).map((x) => tr(x)).join(' · ') || tr('Sonraki çağa geç.')) + tr(' (Şehir Merkezi\'nde başlar.)'),
      check: () => {
        if (!tcs().length) return { ok: false, reason: tr('Şehir Merkezi yok') };
        const r = safe(() => g.canAgeUp(me), { ok: false, reason: '' }) || { ok: false };
        return { ok: !!r.ok, reason: !r.ok && this._ageMiss ? tr('Gerekli: ') + this._ageMiss : r.reason };
      },
      run: () => tcs().some((b) => safe(() => g.ageUp(b.id), false)),
    };
  }
  // ready / aging / not yet: the look of the age-up button (about 8 times a second, so a click shows at once)
  _refreshAgeBtn(g, p) {
    const b = this.ageBtn; if (!b || this.objEl.classList.contains('hidden')) return;
    const aging = (safe(() => g.buildingsOf(this._me()), []) || []).some((x) => x.queue?.[0]?.kind === 'age');
    const ok = !aging && !!AGES[p.age + 1] && !!(safe(() => this._ageSpec().check(), null) || {}).ok;
    b.classList.toggle('ready', ok); b.classList.toggle('aging', aging); b.classList.toggle('off', !ok && !aging);
  }

  // ------------------------------------------------------------------ update loop
  // shortcut bar: 9 slots. Empty slot: click = put the selection there. Filled slot: click = select, double
  // click = select + go there, Ctrl+click = replace with the selection, right click = empty it.
  _refreshGroups() {
    const inp = this.app.input; if (!inp || !this.grpEl) return;
    const sel = this.app.selection || [];
    const slots = [];
    for (let n = 1; n <= 9; n++) {
      const ids = inp.groupIds(n);
      const by = new Map();
      for (const id of ids) { const x = this.game.getEntity(id); if (x) by.set(x.type, (by.get(x.type) || 0) + 1); }
      let top = null, best = 0; for (const [t, c] of by) if (c > best) { best = c; top = t; }
      const active = ids.length > 0 && ids.length === sel.length && ids.every((id) => sel.includes(id));
      slots.push({ n, count: ids.length, top, kinds: by.size, active });
    }
    this._grpState = slots;
    // the 9 buttons are made once (a rebuilt button would lose its double click); only their content changes
    if (!this._grpBtns || !this._grpBtns[0].isConnected) {
      this.grpEl.innerHTML = '';
      this._grpBtns = [];
      for (let i = 0; i < 9; i++) {
        const b = el('button', 'grp');
        const cur = () => this._grpState[i];
        b.onclick = (ev) => {
          const s = cur(); this._click();
          if (!s.count || ev.ctrlKey) { if (!inp.setGroup(s.n)) this.toast(tr('Önce birlik ya da bina seç, sonra buraya tıkla.'), 'info'); }
          else inp.recallGroup(s.n, false);
          this._refreshGroups();
        };
        b.ondblclick = () => { const s = cur(); if (s.count) inp.recallGroup(s.n, true); };
        b.oncontextmenu = (ev) => { ev.preventDefault(); const s = cur(); if (s.count) { this._click(); inp.clearGroup(s.n); this._refreshGroups(); } };
        this._tip(b, () => {
          const s = cur(), d = UNITS[s.top] || BUILDINGS[s.top];
          return s.count
            ? { name: tr('Grup ') + s.n + ' · ' + s.count + ' ' + (s.kinds > 1 ? tr('seçili') : (tr(d?.name) || '')), desc: tr('Tıkla: seç · Çift tıkla: oraya git · Ctrl+tık: seçimle değiştir · Sağ tık: boşalt. Kısayol: ') + s.n + ' (Ctrl+' + s.n + ' kaydeder)' }
            : { name: tr('Boş grup ') + s.n, desc: tr('Birlik ya da bina seç, sonra buraya tıkla (ya da Ctrl+') + s.n + '). Sonra ' + s.n + tr(' tuşu ile hep geri seçersin.') };
        });
        this.grpEl.append(b); this._grpBtns.push(b);
      }
    }
    slots.forEach((s, i) => {
      const b = this._grpBtns[i], d = UNITS[s.top] || BUILDINGS[s.top];
      const html = `<i>${s.n}</i>` + (s.count ? `<span class="gic">${d?.icon || ico('x-unknown')}</span><b>${s.count}</b>` : '<span class="gplus">+</span>');
      if (b._h !== html) { b._h = html; b.innerHTML = html; }
      b.className = 'grp' + (s.count ? ' on' : '') + (s.active ? ' act' : '');
    });
  }

  // developer mode panel: jump between ages (only in a dev game)
  _devPanel() {
    const g = this.game, on = !!(g && g.cfg && g.cfg.dev && this.mode === 'hud');
    if (!on) { if (this.devEl) this.devEl.classList.add('hidden'); return; }
    if (!this.devEl) {
      this.devEl = el('div', 'devpanel', tr('<b>Geliştirici</b>'));
      for (let i = 0; i < AGES.length; i++) {
        const b = el('button', '', tr(AGES[i].name).split(' ')[0]); b.dataset.age = i;
        b.onclick = () => { this._click(); safe(() => this.game.devSetAge(i)); };
        this.devEl.append(b);
      }
      (this.hudTop || this.hudEl).append(this.devEl);
    }
    this.devEl.classList.remove('hidden');
    const age = g.players[this._me()]?.age | 0;
    this.devEl.querySelectorAll('button').forEach((b) => b.classList.toggle('on', +b.dataset.age === age));
  }
  // the quests / scoreboard (top-left) and the toasts (top-right) start below the top block wherever it reaches over them
  _clearTop() {
    if (!this.hudTop || !this.topPanel) return;
    const tb = this.topPanel.getBoundingClientRect(), all = this.hudTop.getBoundingClientRect(), vw = window.innerWidth || 0;
    if (!tb.width) return;
    const q = tb.left < 266 ? Math.ceil(tb.bottom + 8) : 56, t = all.right > vw - 326 ? Math.ceil(all.bottom + 8) : 60;
    // the chat dock (left edge) ends above the bottom-left block, whose height changes with the next age box
    const bl = this.blEl?.getBoundingClientRect(), vh = window.innerHeight || 0;
    const b = bl && bl.height ? Math.ceil(vh - bl.top + 10) : 262;
    const sig = q + ',' + t + ',' + b;
    if (sig === this._clearSig) return;
    this._clearSig = sig;
    this.hudEl.style.setProperty('--quests-top', q + 'px'); this.hudEl.style.setProperty('--toasts-top', t + 'px'); this.hudEl.style.setProperty('--bl-top', b + 'px');
    safe(() => this._chatTick());   // the chat dock starts below the quests: follow them at once
  }
  update(dt) {
    this.frames++; this.fpsT += dt;
    if (this.fpsT + dt >= 0.5) { this._devPanel(); this._clearTop(); }
    if (this.fpsT >= 0.5) {
      // multiplayer: the worst peer's round trip next to the FPS (is a hitch the network or the screen?)
      const ni = this.app.net && typeof this.app.net.netInfo === 'function' ? safe(() => this.app.net.netInfo(), null) : null;
      let more = '';
      if (this.fpsMore) {   // clicked: frame cost details (CPU time per frame, render resolution, triangles drawn)
        const R = this.app.renderer, rr = R && R.renderer;
        if (rr) more = ' · CPU ' + (this.app.cpuMs || 0).toFixed(1) + ' ms · ' + rr.getPixelRatio().toFixed(2) + 'x ' +
          Math.round(R._w * rr.getPixelRatio()) + '×' + Math.round(R._h * rr.getPixelRatio()) + ' · ' + Math.round(rr.info.render.triangles / 1000) + tr('k üçgen · {0} çizim', rr.info.render.calls);
      }
      this.fpsEl.textContent = Math.round(this.frames / this.fpsT) + ' FPS' + (ni && ni.ping != null ? ' · Ping ' + ni.ping + ' ms' : '') + more;
      this.frames = 0; this.fpsT = 0;
    }
    if (this.mode !== 'hud' || !this.game) return;
    if (this.tut) safe(() => this.tut.frame(dt));
    this.acc += dt; this.mmAcc += dt;
    if (this.acc >= 0.125) {
      this.acc = 0;
      safe(() => this._refreshTop());
      safe(() => this._refreshSel());
      safe(() => this._refreshCard());
      safe(() => this._refreshGroups());
      safe(() => this._tipKeep());
      if (this.tut) safe(() => this.tut.tick());
      if (this.techTiles && (this.techT = (this.techT || 0) + 1) % 2 === 0) safe(() => this._refreshTech());
      const paused = this.gameMenuVisible();
      safe(() => this._refreshScore());
      safe(() => this._chatTick());
      if (paused && this.pauseInfoEl) { const mt = this.game.cfg?.mapType; this.pauseInfoEl.textContent = (mt && MAP_TYPE_TR[mt] ? tr('Harita: ') + MAP_TYPE_TR[mt] : '') + (this.app.renderer?.climate ? tr(' · İklim: ') + tr(this.app.renderer.climate.name) : ''); }
      safe(() => this._syncPauseMenu());
      if (this.game.over && !this.gameOverShown) this.showGameOver(!!this.game.over.won);
    }
    if (this.mmAcc >= 0.1) { this.mmAcc = 0; safe(() => this._drawMinimap()); }
  }

  _qprog(q) {
    if (!q || !q.total) return 0;
    let d = this.qdir.get(q);
    if (!d) { d = { t0: q.t, up: q.t <= q.total / 2 }; this.qdir.set(q, d); }
    else if (q.t > d.t0 + 1e-6) d.up = true; else if (q.t < d.t0 - 1e-6) d.up = false;
    const f = d.up ? q.t / q.total : 1 - q.t / q.total;
    return Math.max(0, Math.min(1, f));
  }

  _refreshTop() {
    const g = this.game, p = g.players[this._me()]; if (!p) return;
    for (const r of RES_LIST) {
      const v = Math.floor(p.res[r] || 0), d = this.resEls[r];
      if (this.lastRes[r] !== v) {
        d.querySelector('b').textContent = v;
        /* (owner 2026-11-22: the rows 'göz kırpıyor') no flash when a resource comes in: the number moving is enough */
        this.lastRes[r] = v;
      }
    }
    const ps = `${p.pop | 0}/${p.popCap | 0}`;
    if (this.lastPop !== ps) { this.lastPop = ps; this.popEl.querySelector('b').textContent = ps; this.popEl.classList.toggle('capped', p.pop >= p.popCap); }
    if (this._ageCls !== p.age) {
      const had = this._ageCls != null;
      for (const n of [this.hudEl, this.tipEl]) { for (let i = 0; i < AGES.length; i++) n.classList.remove('age-' + i); n.classList.add('age-' + (p.age | 0)); }
      this._ageCls = p.age;
      if (had) { const tbEl = this.hudEl.querySelector('.topbar'); if (tbEl) { tbEl.classList.remove('ageflash'); void tbEl.offsetWidth; tbEl.classList.add('ageflash'); } }
    }
    const an = tr(AGES[p.age]?.name) || '';
    const n = this.ageEl.querySelector('.n'); if (n.textContent !== an) n.textContent = an;
    let prog = 0;
    for (const b of safe(() => g.buildingsOf(this._me()), [])) { const q = b.queue?.[0]; if (q && q.kind === 'age') { prog = this._qprog(q); break; } }
    this.ageEl.querySelector('i').style.width = (prog * 100).toFixed(1) + '%';
    this.clockEl.textContent = fmtTime(g.time || 0);
    safe(() => this._refreshAgeBtn(g, p));
    safe(() => this._refreshRates(g, p));
    safe(() => this._refreshSlow(g, p));
  }

  // ------------------------------------------------------------------ selection panel
  _ents() {
    const g = this.game, out = [];
    for (const id of this.sel) { const e = safe(() => g.getEntity(id), null); if (e && !e.dead) out.push(e); }
    return out;
  }
  _def(e) {
    if (e.kind === 'unit') return UNITS[e.type] || { name: e.type, icon: ico('x-unknown') };
    if (e.kind === 'building') return BUILDINGS[e.type] || { name: e.type, icon: ico('b-house') };
    return NATURE[e.type] || { name: e.type, icon: ico('x-unknown') };
  }
  _refreshSel() {
    const ents = this._ents();
    const sig = ents.map((e) => e.id).join(',') + '|' + (ents.length === 1 ? (ents[0].queue?.map((q) => q.kind + q.id).join(';') ?? '') + (ents[0].done ? 'd' : 'u') : ents.map((x) => (x.kind === 'building' ? (x.queue?.map((q) => q.kind + q.id).join(';') ?? '') + (x.done ? 'd' : 'u') : '')).join(','));
    if (sig !== this.selSig) { this.selSig = sig; this._buildSel(ents); }
    if (!ents.length) return;
    if (ents.length === 1) {
      const e = ents[0], fog = e.kind === 'building' && this._fogged(e), f = fog ? 1 : Math.max(0, Math.min(1, e.kind === 'resource' ? (e.amount / (e.maxAmount || 1)) : e.hp / (e.maxHp || 1)));
      const bar = this.selEl.querySelector('.hpbar');
      if (bar) { bar.firstChild.style.width = f * 100 + '%'; bar.className = 'hpbar' + (fog ? ' fog' : e.kind !== 'resource' && f < 0.3 ? ' low' : e.kind !== 'resource' && f < 0.6 ? ' mid' : ''); }
      const ht = this.selEl.querySelector('.hptxt');
      // stone and gold mines never run out (src/sim/game.js): no misleading "350 / 350"
      const endless = e.kind === 'resource' && (e.type === 'stone' || e.type === 'gold');
      if (ht) ht.textContent = fog ? tr('Sisin içinde') : endless ? `∞ ${tr('Sınırsız {0}', RES_NAME[NATURE[e.type]?.res] || '')}` : e.kind === 'resource' ? `${Math.ceil(e.amount)} /${Math.ceil(e.maxAmount || e.amount)} ${RES_NAME[NATURE[e.type]?.res] || ''}` : tr('{0} / {1} can', Math.ceil(e.hp), Math.ceil(e.maxHp));
      const st = this.selEl.querySelector('.stats');
      if (st) { const h = this._statsHtml(e); if (st._h !== h) { st._h = h; st.innerHTML = h; } }
      const qs = this.selEl.querySelectorAll('.qi i');
      qs.forEach((bar2, i) => { const q = e.queue?.[i]; bar2.style.width = (i === 0 && q ? this._qprog(q) * 100 : 0) + '%'; });
    } else {
      const bars = this.selEl.querySelectorAll('.mu i');
      bars.forEach((b, i) => { const e = ents[i]; if (e) b.style.transform = `scaleX(${Math.max(0, e.hp / (e.maxHp || 1))})`; });
      const qb = this.selEl.querySelector('.mbqbar');
      if (qb) { // multi-building: progress of the nearest completion
        let best = 0; for (const e of ents) { const q = e.queue?.[0]; if (q) best = Math.max(best, this._qprog(q)); }
        qb.firstChild.style.width = (best * 100).toFixed(1) + '%';
        const t = this.selEl.querySelector('.mbq b'); if (t) t.textContent = '%' + Math.floor(best * 100);
      }
    }
  }
  _statsHtml(e) {
    const d = this._def(e), s = [];
    if (e.kind === 'unit') {
      s.push(`<span>${ico('x-atk')} <b>${d.atk ?? 0}</b></span>`, `<span>${ico('x-armor')} <b>${d.armor ?? 0}</b></span>`);
      if (d.range) s.push(`<span>${ico('x-range')} <b>${d.range}</b></span>`);
      if (e.type === 'healer') { const hp = this.game?.players?.[e.owner], st = healerStats(hp ? hp.age : 0); s.push(`<span>${tr('İyileştirme: <b>{0} can/sn · {1}{2} kare</b>', healerRate(hp), st.one ? tr('tek birlik, ') : '', st.r)}</span>`); const hb = healerBolt(hp ? hp.age : 0); if (hb) s.push(`<span>${hb.spl ? tr('Büyü oku: <b>{0} hasar · {1} kare menzil · {2} kare alan</b>', hb.atk, hb.r, hb.spl) : tr('Büyü oku: <b>{0} hasar · {1} kare menzil</b>', hb.atk, hb.r)}</span>`); }
      s.push(`<span>${ico('x-speed')} <b>${d.speed ?? '-'}</b></span>`);
      if (e.type === 'transport' || Array.isArray(e.cargo)) s.push(`<span>${ico('u-transport')} <b>${(e.cargo || []).length}/10</b></span>`);
      if (e.carry && e.carry.amount > 0) s.push(`<span>${RES_ICON[e.carry.type] || ico('x-cargo')} <b>${Math.floor(e.carry.amount)}</b></span>`);
      s.push(`<span>${tr('Durum')}: <b>${STATE_TR[e.state] || e.state || '-'}</b></span>`);
    } else if (e.kind === 'building' && this._fogged(e)) {
      if (d.popCap) s.push(`<span>${ico('x-pop')} <b>+${d.popCap}</b></span>`);
      s.push(tr('<span style="color:var(--dim)">Ne olup bittiğini görmek için oraya git.</span>'));
    } else if (e.kind === 'building') {
      if (!e.done) s.push(`<span>${tr('İnşaat: <b>%{0}</b>', Math.floor((e.progress || 0) * 100))}</span>`);
      if (d.atk) {
        // what it really hits for (the same formula as Game._updateBuilding: research + age)
        const op = this.game?.players?.[e.owner], m = op?.mods || {};
        const atk = d.atk + (m.towerAtk || 0) + (op?.age | 0) * (e.type === 'tower' ? TOWER_AGE_ATK : 1);
        s.push(`<span>${ico('x-atk')} <b>${atk}</b></span>`, `<span>${ico('x-range')} <b>${(d.range || 0) + (m.towerRange || 0) + towerAgeBonus(e.type, op?.age)}</b></span>`);
      }
      if (d.popCap) s.push(`<span>${ico('x-pop')} <b>+${d.popCap}</b></span>`);
      if (e.type === 'farm' && e.farm && Array.isArray(e.farm.plots)) s.push(`<span>Ekili parsel: <b>${e.farm.plots.filter((q) => q.s > 0).length}/8</b></span>`, `<span>Olgun: <b>${e.farm.plots.filter((q) => q.s === 5).length}</b></span>`);
      else if (e.type === 'farm' && e.farm) s.push(`<span>${tr('Tarla:')} <b>${[tr('Boş'), tr('Sürülü'), tr('Ekili'), tr('Büyüyor'), tr('Olgun'), tr('Hasat')][e.farm.stage] || '-'}</b></span>`);
      if (e.done) s.push(...safe(() => this._extraStats(e), []));
      if (e.queue?.length) s.push(`<span>Kuyruk: <b>${e.queue.length}</b></span>`);
    } else if (e.kind === 'resource' && (e.type === 'stone' || e.type === 'gold') && this.game?.mineLoad) {
      // (owner 2026-11-20) at most MINE_CAP villagers on one deposit
      const n = safe(() => this.game.mineLoad(this.game._depOf(e), this._me()), 0);
      s.push(`<span>${ico('u-villager')} ${tr('<b>{0}/{1}</b> işçin bu maden öbeğinde', n, MINE_CAP)}</span>`);
    }
    return s.join('');
  }
  // new-content lines for the selection panel (pasture, farm workers, station, dock)
  _extraStats(e) {
    const g = this.game, out = [];
    if (!g?.entities) return out;
    const all = [...g.entities.values()];
    // assigned: villagers whose work order is this building (also the ones still walking there); working: the ones
    // the sim counted on it this tick (Game._updateBuilding, b.wk). Only the working ones make food.
    const assigned = () => all.filter((u) => u.kind === 'unit' && !u.dead && u.owner === e.owner && u.order && u.order.type === 'gather' && u.order.targetId === e.id).length;
    const workers = (cap) => { const a = Math.min(cap, assigned()), n = Math.min(a, e.wk | 0); return { n, way: a - n }; };
    const way = (k) => k > 0 ? ` · <b>${k}</b> yolda` : '';
    // (players 2026-11-22: "how much food a minute do the pasture and the farm give") the sim's own rates, see
    // Game._farmGather / _pasGather and the pasture's idle flock in _updateBuilding
    const mods = g.players?.[e.owner]?.mods || {};
    if (e.type === 'farm') {
      const { n, way: k } = workers(8), per = Math.round(FARM_RATE_UI * FARM_RIPE_SHARE * (1 + (mods.farm || 0)) * 60);
      out.push(`<span>${ico('u-villager')} ${tr('<b>{0}/8</b> işçi', n)}${way(k)}</span>`, `<span>${RES_ICON.food} ${tr('<b>~{0}</b>/dk · işçi başına ~{1}/dk', per * n, per)}</span>`);
    }
    if (e.type === 'pasture') {
      const { n, way: k } = workers(6), sh = e.pasture?.sheep ?? 3, pm = mods.pasture || 0;
      const idle = PASTURE_IDLE_RATE * sh * (1 + pm * 0.5) * 60;
      let herd = 0; for (let i = 0; i < n; i++) herd += PASTURE_HERD_C[i] * 0.5 * (sh / 5) * (1 + pm) * 60;
      out.push(`<span>${ico('b-pasture')} ${tr('<b>{0}</b> koyun · <b>{1}/6</b> işçi', sh, n)}${way(k)}</span>`, `<span>${RES_ICON.food} ${tr('<b>~{0}</b>/dk', Math.round(idle + herd))}${n ? tr(' · işçisiz ~{0}/dk', Math.round(idle)) : ''}</span>`);
    }
    if (e.type === 'station') {
      const trn = all.find((t) => t.train && !t.dead && (t.train.a === e.id || t.train.b === e.id));
      if (trn) out.push(`<span style="color:var(--good,#9be37a)">${tr('Bağlı: tren çalışıyor (+{0} altın/sefer)', Math.round(25 + (trn.train.path?.length || 0) * 1.2))}</span>`);
      else out.push(`<span style="color:var(--dim)">${tr('Bağlı değil: başka bir istasyona ray döşe')}</span>`);
    }
    if (e.type === 'dock') out.push(`<span>${ico('u-fishboat')} <b>${all.filter((u) => u.kind === 'unit' && !u.dead && u.owner === e.owner && u.type === 'fishboat').length}</b> ${tr('balıkçı teknesi')}</span>`);
    return out;
  }
  _buildSel(ents) {
    const p = this.selEl;
    p.innerHTML = '';
    p.classList.toggle('empty', !ents.length);
    if (!ents.length) return;
    if (ents.length === 1) {
      const e = ents[0], d = this._def(e);
      const owner = e.owner === this._me() ? '' : e.owner >= 0 && this._ally(this._me(), e.owner) ? `<small class="allytag" style="color:${hex(PLAYER_COLORS[e.owner] ?? 0xffffff)}">${tr('Müttefik: {0}', esc(this._pname(e.owner)))}</small>` : e.owner >= 0 ? `<small style="color:${hex(PLAYER_COLORS[e.owner] ?? 0xffffff)}">${tr('Düşman')}${this.game?.mp ? ': ' + esc(this._pname(e.owner)) : ''}</small>` : tr('<small>Doğa</small>');
      const sub = e.kind === 'unit' ? CLS_TR[d.cls] || '' : e.kind === 'building' ? tr('Bina') : tr('Kaynak');
      p.append(el('div', 'portrait', d.icon || ico('x-unknown')));
      const info = el('div', 'selinfo', `<div class="selname">${esc(tr(d.name))}<small>${sub}</small>${owner}</div><div class="hpbar"><i></i></div><div class="hptxt"></div><div class="stats"></div><div class="seldesc${e.kind === 'building' && tr(d.desc) ? ' bfx' : ''}">${esc(tr(d.desc) || '')}</div>`);
      if (e.kind === 'building' && e.owner === this._me() && e.queue?.length) {
        const q = el('div', 'queue');
        e.queue.slice(0, 8).forEach((it, i) => {
          const qd = it.kind === 'unit' ? UNITS[it.id] : it.kind === 'tech' ? TECHS[it.id] : { icon: ico('x-ageup'), name: tr('Çağ Atlama') };
          const b = el('div', 'qi', `${qd?.icon || ico('x-unknown')}<i></i>`);
          this._tip(b, () => ({ name: tr(qd?.name) || it.id, desc: tr('İptal etmek için tıkla (iade edilir). Shift: 5 tanesini iptal et.') }));
          b.onclick = (ev) => {
            // Shift: up to 5 entries of the same kind, from the back of the queue (so the earlier indices stay valid);
            // each one is its own cancelQueue call (a lockstep command in multiplayer)
            let idx = [i];
            if (ev.shiftKey) {
              idx = [];
              for (let j = e.queue.length - 1; j >= 0 && idx.length < 5; j--) { const q2 = e.queue[j]; if (q2 && q2.kind === it.kind && q2.id === it.id) idx.push(j); }
            }
            let ok = false;
            for (const j of idx) if (safe(() => this.game.cancelQueue(e.id, j, it.id), false)) ok = true;
            if (ok) this._click(); else this._error();
            this.selSig = null; this.cardSig = null; this._hideTip();
          };
          q.append(b);
        });
        if (e.queue.length > 8) q.append(el('div', 'qi qmore', `+${e.queue.length - 8}`));   // (the rest of a long queue)
        info.append(q);
      }
      p.append(info);
    } else {
      let host = p;
      if (ents.every((x) => x.kind === 'building')) {
        // several buildings: "N × name" (same type) or "N bina seçili" (mixed) + combined queue summary
        const same = ents.every((x) => x.type === ents[0].type), d0 = this._def(ents[0]);
        const cnt = {}; let tot = 0;
        for (const x of ents) for (const q of x.queue || []) { const k = q.kind === 'unit' ? q.id : q.kind === 'tech' ? 't:' + q.id : 'age'; cnt[k] = (cnt[k] || 0) + 1; tot++; }
        const parts = Object.keys(cnt).map((k) => { const qd = k === 'age' ? { icon: ico('x-ageup') } : k.startsWith('t:') ? TECHS[k.slice(2)] : UNITS[k]; return `<span>${qd?.icon || '❔'} <b>${cnt[k]}</b></span>`; });
        host = el('div', 'selinfo', `<div class="selname">${same ? `${ents.length} × ${esc(tr(d0.name))}` : tr('{0} bina seçili', ents.length)}</div>` +
          (same && tot ? `<div class="stats">${tr('Kuyruk:')} ${parts.join(' ')} <span class="mbq">· ${tr('sıradaki:')} <b>%0</b></span></div><div class="hpbar mbqbar"><i></i></div>` : ''));
        p.append(host);
      } else {
        // (players 2026-11-22: "how many archers / spearmen do I have", "select only the riders") one chip per type
        // with its count: click = only that type, Shift+click = drop that type, Ctrl+click = that type on the whole screen
        host = el('div', 'selinfo msel');
        const by = new Map(); for (const x of ents) by.set(x.type, (by.get(x.type) || 0) + 1);
        const row = el('div', 'mgrp', `<b>${ents.length} birim</b>`);
        for (const [t, n] of [...by].sort((a, b) => b[1] - a[1])) {
          const d = this._def({ kind: ents.find((x) => x.type === t).kind, type: t });
          const c = el('button', 'mg', `${d.icon || ico('x-unknown')}<b>×${n}</b>`);
          this._tip(c, () => ({ name: `${n} × ${tr(d.name)}`, desc: tr('Tıkla: yalnızca bunları seç. Shift + tık: seçimden çıkar. Ctrl + tık: ekrandaki bütün {0} birimlerini seç.', tr(d.name)) }));
          c.onclick = (ev) => {
            this._click(); this._hideTip();
            const cur = this.app.selection || this.sel, typeOf = (id) => safe(() => this.game.getEntity(id)?.type, null);
            if (ev.shiftKey) { this.app.select?.(cur.filter((id) => typeOf(id) !== t)); return; }
            if (ev.ctrlKey || ev.metaKey) {
              const me = this._me(), R = this.app.renderer;
              const on = (safe(() => R.unitsInRect(0, 0, window.innerWidth, window.innerHeight), []) || []).filter((id) => { const u = safe(() => this.game.getEntity(id), null); return u && !u.dead && u.owner === me && u.type === t; });
              if (on.length) { this.app.select?.(on); return; }
            }
            this.app.select?.(cur.filter((id) => typeOf(id) === t));
          };
          row.append(c);
        }
        host.append(row);
        p.append(host);
      }
      const grid = el('div', 'multi');
      ents.slice(0, 40).forEach((e) => {
        const d = this._def(e);
        const m = el('div', 'mu', `${d.icon || ico('x-unknown')}<i></i>`);
        this._tip(m, () => ({ name: tr(d.name), desc: tr('Tıkla: yalnızca bunu seç. Shift + tık ya da sağ tık: seçimden çıkar.') }));
        const drop = () => { this._click(); this._hideTip(); this.app.select?.((this.app.selection || this.sel).filter((id) => id !== e.id)); };
        m.onclick = (ev) => { if (ev.shiftKey) { drop(); return; } this._click(); this.app.select?.([e.id]); };
        m.oncontextmenu = (ev) => { ev.preventDefault(); drop(); };
        grid.append(m);
      });
      host.append(grid);
    }
  }

  // ------------------------------------------------------------------ command card
  _refreshCard() {
    const g = this.game, p = g.players[this._me()], ents = this._ents();
    let sig = this.page + '|' + (p?.age ?? 0) + '|' + (p?.techs?.size ?? 0) + '|' + ents.length + '|';
    if (ents.length) {
      const e = ents[0];
      sig += e.id + e.type + (e.done ? 'd' : 'u') + (e.queue ? e.queue.map((q) => q.kind + q.id).join(';') : '') + ents.some((x) => x.type === 'villager') + (ents.length > 1 ? ents.map((x) => x.type + (x.done ? 'd' : 'u')).join(',') : '') + ents.map((x) => x.form || '').join('');
    }
    if (sig !== this.cardSig) { this.cardSig = sig; this._renderCard(ents); if (this.tut) safe(() => this.tut.applyHl()); }
    for (const b of this.buttons) {
      if (!b) continue;
      const c = b.spec.check ? safe(b.spec.check, { ok: true }) : { ok: true };
      b.ok = !!c.ok;
      b.node.classList.toggle('off', !c.ok);
      b.node.classList.toggle('locked', !!c.locked);
      if (b.spec.active) b.node.classList.toggle('active', !!safe(b.spec.active, false));   // (the stance in use, owner 2026-11-15)
    }
  }
  _specs(ents) {
    const g = this.game, slots = new Array(15).fill(null);
    const put = (spec, slot) => { if (slot == null) slot = slots.indexOf(null); if (slot >= 0 && slot < 15) slots[slot] = spec; };
    // not reached yet by age: hidden until the player gets there, but its slot stays reserved (hotkeys do not move)
    const later = (age) => (age | 0) > (g.players[this._me()]?.age | 0);
    if (!g || !ents || !ents.length) return slots;
    const first = ents[0];
    if (first.owner !== this._me()) return slots;
    const p = g.players[this._me()], ids = ents.map((e) => e.id);
    const afford = (cost) => safe(() => g.canAfford(this._me(), cost), true);
    const sb = g.cfg?.sandbox ? 2 : 1; // sandbox: player 0 builds/trains/researches 2x faster (sim)
    const del = {
      icon: ico('x-delete'), name: tr('Sil'), desc: tr('Seçili birimleri / binayı yok et.'),
      run: () => { for (const id of ids) safe(() => g.deleteEntity(id)); return true; },
    };
    if (ents.every((e) => e.kind === 'unit')) {
      const hasVil = ents.some((e) => e.type === 'villager');
      if (this.page !== 'root' && hasVil && BUILD_CATS[this.page]) {
        for (const bid of BUILD_CATS[this.page].list) {
          const b = BUILDINGS[bid]; if (!b) continue;
          if (later(b.age)) { put(false); continue; }
          put({
            icon: b.icon || ico('b-house'), name: tr(b.name), cost: b.cost, time: b.time * BUILD_TIME_MUL / sb, desc: BUILD_DESC[bid] || tr(b.desc),
            check: () => {
              if (!safe(() => g.isUnlocked(this._me(), 'building', bid), true)) return { ok: false, locked: true, reason: tr('Gerekli çağ: ') + (tr(AGES[b.age]?.name) || b.age) };
              if (!afford(b.cost)) return { ok: false, reason: tr('Yetersiz kaynak') };
              return { ok: true };
            },
            run: () => { this.app.startPlacement?.(bid); this.page = 'root'; return true; },
          });
        }
        put({ icon: ico('x-back'), name: tr('Geri'), desc: tr('Önceki menüye dön. (Sağ tık ya da Esc de döner.)'), run: () => { this.page = 'root'; return true; } }, 14);
        return slots;
      }
      if (hasVil) {
        for (const k of Object.keys(BUILD_CATS)) {
          const c = BUILD_CATS[k];
          if (!c.list.some((bid) => BUILDINGS[bid])) continue; // page whose buildings are not defined yet
          if (!c.list.some((bid) => BUILDINGS[bid] && !later(BUILDINGS[bid].age))) { put(false); continue; }   // (a later age's page)
          put({ icon: c.icon, name: tr('İnşa: ') + c.name, desc: c.desc, run: () => { this.page = k; return true; } });
        }
      }
      // stances for soldiers (owner 2026-11-15): aggressive / defensive / hold ground; the active one is marked
      const fighters = ents.filter((e) => e.kind === 'unit' && UNITS[e.type] && UNITS[e.type].cls !== 'civil' && UNITS[e.type].atk > 0);
      if (fighters.length) {
        const cur = (st) => fighters.every((e) => (e.stance || 'aggressive') === st);
        const ST = [
          ['aggressive', 'x-stance-aggr', tr('Saldırgan'), tr('Gördüğü düşmanı kovalar (varsayılan).')],
          ['defensive', 'x-stance-def', tr('Savunma'), tr('Yakına gelen düşmanla dövüşür, en fazla birkaç kare kovalar, sonra yerine döner.')],
          ['hold', 'x-stance-hold', tr('Mevzi Koru'), tr('Hiç yerinden ayrılmaz; yalnızca menziline gireni vurur. Duvar arkasındaki okçu ve mancınıklar için.')],
        ];
        ST.forEach(([st, em, nm, ds], i) => put({ icon: ico(em), name: nm, desc: ds + tr(' Seçili mod altın çerçeveyle gösterilir.'), active: () => cur(st), run: () => safe(() => g.cmdStance(fighters.map((e) => e.id), st), false) !== false }, 5 + i));
        // formation of the group on a move (players 2026-11-19): one button cycling line -> box -> V
        const FM = { line: [tr('Hat'), tr('Geniş ve sığ saf: yakın dövüşçüler önde, okçular arkada (varsayılan).')], box: [tr('Kare'), tr('Sıkı bir kare blok: her yöne karşı toplu durur.')], wedge: ['V', tr('Ok ucu gibi V dizilişi: öndeki birim yolu açar, diğerleri iki kanatta ilerler.')] };
        const fNow = () => { const n = { line: 0, box: 0, wedge: 0 }; for (const e of fighters) n[e.form || 'line']++; return Object.keys(n).sort((p, q) => n[q] - n[p])[0]; };
        const fIcon = (f) => '<svg class="gi" viewBox="0 0 24 24" aria-hidden="true" fill="currentColor">' + (f === 'box' ? [5, 12, 19].flatMap((y) => [5, 12, 19].map((x) => `<circle cx="${x}" cy="${y}" r="2.6"/>`)).join('') : f === 'wedge' ? [[12, 5], [8, 10], [16, 10], [4, 15], [20, 15], [1.8, 20], [22.2, 20]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="2.4"/>`).join('') : [3, 9, 15, 21].flatMap((x) => [9, 15].map((y) => `<circle cx="${x}" cy="${y}" r="2.5"/>`)).join('')) + '</svg>';
        const f0 = fNow(), fNext = FORMATIONS[(FORMATIONS.indexOf(f0) + 1) % FORMATIONS.length];
        put({ icon: fIcon(f0), name: tr('Diziliş: ') + FM[f0][0], desc: FM[f0][1] + tr(' Tıklayınca sıradakine geçer (') + FM[fNext][0] + tr('). Bir sonraki hareket emrinde bu dizilişe girerler.'), run: () => safe(() => g.cmdFormation(fighters.map((e) => e.id), fNext), false) !== false }, slots[8] == null ? 8 : 9);
        // attack-move (K) and patrol (V): the order is given by the next left click on the ground
        put({ icon: ico('x-amove'), name: tr('Saldırarak Yürü'), desc: tr('Seçili askerler hedef noktaya yürür, yolda gördüğü düşman birim ve binalarla dövüşür, sonra yoluna devam eder: ardından haritada bir noktaya sol tıkla (Shift: sıraya ekle, Esc: iptal). Normal yürüyüş (sağ tık) düşmana aldırmadan gider.'), run: () => !!safe(() => this.app.input?.startGroundCmd?.('amove'), false) }, 9);
        put({ icon: ico('x-patrol'), name: tr('Devriye'), desc: tr('Seçili askerler bulundukları yerle hedef nokta arasında gidip gelir, yolda gördüğü düşmanla dövüşür. Başka bir emir verene kadar sürer: ardından haritada bir noktaya sol tıkla (Shift: sıraya ekle, Esc: iptal).'), run: () => !!safe(() => this.app.input?.startGroundCmd?.('patrol'), false) }, 13);
      }
      put({ icon: ico('x-stop'), name: tr('Dur'), desc: tr('Seçili birimler mevcut işini bırakır.'), run: () => safe(() => g.cmdStop(ids), false) !== false }, 10);
      put({ icon: ico('x-explore'), name: tr('Keşfet'), desc: tr('Seçili birimler haritada kendi kendine dolaşıp keşfedilmemiş bölgeleri açar. Başka bir emir verene kadar sürer.'), run: () => safe(() => g.cmdExplore(ids), false) !== false }, 11);
      const tp = ents.find((u) => u.type === 'transport');
      if (tp) {
        put({
          icon: ico('x-unload'), name: tr('Boşalt'), desc: tr('Nakliye gemisindeki birimleri kıyıya indir: ardından kıyıda bir noktaya sol tıkla (Esc: iptal).'),
          check: () => ((tp.cargo || []).length ? { ok: true } : { ok: false, reason: tr('Gemi boş') }),
          run: () => !!safe(() => this.app.input?.startUnload?.(tp.id), false),
        }, 12);
      }
      put(del, 14);
      return slots;
    }
    if (first.kind !== 'building') return slots;
    // several own buildings: same type -> one shared card (train runs in EACH), mixed types -> no train buttons
    if (ents.length > 1 && !ents.every((x) => x.kind === 'building' && x.owner === this._me() && x.type === first.type)) { put(del, 14); return slots; }
    const pool = ents.length > 1 ? ents.filter((x) => x.done) : [first];
    const e = pool[0] || first, bd = BUILDINGS[e.type] || {};
    const many = () => (this.app.input?.shift ? 5 : 1); // Shift+click / Shift+hotkey: 5 per building
    // (players 2026-11-22: "let us turn buildings") Döndür on slot 12 of one own building
    const turnBtn = () => {
      if (ents.length !== 1 || e.owner !== this._me()) return;
      if (!NO_ROTATE.has(e.type) && slots[12] == null) put({ icon: ROT_ICON, name: tr('Döndür'), desc: tr('Binayı çeyrek tur çevirir. Sadece görünüşü değişir. Yerleştirirken R tuşu da çevirir.'), run: () => safe(() => g.cmdRotateBuilding(this._me(), e.id), false) !== false }, 12);
    };
    if (!e.done) { turnBtn(); put({ ...del, name: tr('İnşaatı İptal Et'), desc: tr('Temeli kaldır.') }, 14); return slots; }
    if (e.type === 'market' && this.page === 'barter') {
      // one row per resource given: food, wood, stone -> the other two (Shift: 5 times)
      for (const a of BARTER_RES) {
        for (const b of BARTER_RES) {
          if (a === b) continue;
          put({
            icon: `<span class="bart"><span class="b1">${RES_ICON[a]}</span><em>➜</em><span class="b2">${RES_ICON[b]}</span></span>`, lbl: tr('{0} al', RES_NAME[b]),
            name: `${RES_NAME[a]} ver, ${RES_NAME[b]} al`,
            get desc() { return tr('100 {0} karşılığında {1} {2} al. Shift: 5 kez (500).', RES_NAME[a], Math.floor(safe(() => g.tradeRate(a, b, p.id ?? 0), 0)), RES_NAME[b]); },
            check: () => ((p.res[a] || 0) >= 100 ? { ok: true } : { ok: false, reason: tr('Yetersiz ') + RES_NAME[a].toLowerCase() }),
            run: () => { let ok = false; for (let i = many(); i > 0; i--) if (safe(() => g.trade(this._me(), a, b), false)) ok = true; return ok; },
          });
        }
        put(false);   // (one row per resource given: two pairs, then gaps)
        put(false);
        put(false);
      }
      put({ icon: ico('x-back'), name: tr('Geri'), desc: tr('Pazar menüsüne dön. (Sağ tık ya da Esc de döner.)'), run: () => { this.page = 'root'; return true; } }, 14);
      return slots;
    }
    if (e.type === 'wall' && ents.length === 1) {
      const gd = BUILDINGS.gate;
      put({
        icon: gd.icon || ico('b-gate'), name: tr('Kapı Aç'), cost: gd.cost,
        desc: tr('Bu sur parçasını ve iki yanını 3 kare genişliğinde bir kapıya çevirir, hemen açılır. Kapıdan yalnızca senin ve müttefiklerinin birlikleri geçer.'),
        check: () => { const c = safe(() => g.canOpenGate(this._me(), e.id), { ok: true }); return c.ok ? { ok: true } : { ok: false, reason: c.reason }; },
        run: () => !!safe(() => g.cmdOpenGate(e.id), false),
      }, 0);
    }
    for (const uid of bd.trains || []) {
      const u = UNITS[uid]; if (!u) continue;
      if (later(u.age)) { put(false); continue; }
      if ((u.reqTech && !p.techs?.has(u.reqTech)) || (u.upgradedBy && p.techs?.has(u.upgradedBy))) { put(false); continue; }   // (final-form lines: the upgraded unit replaces the old one)
      put({
        icon: u.icon || ico('x-unknown'), name: tr(u.name), cost: u.cost, time: u.time * QUEUE_TIME_MUL / (sb * (1 + (p.mods?.train || 0) + (e.type === 'factory' ? (p.mods?.factory || 0) : 0))),
        desc: (tr(u.desc) || '') + ` — ${ico('x-atk')}${u.atk} ${ico('x-armor')}${u.armor} ${ico('x-hp')}${u.hp}${u.range ? ' ' + ico('x-range') + u.range : ''} ${ico('x-pop')}${u.pop ?? 1}` + (pool.length > 1 ? tr(' · {0} binada aynı anda', pool.length) : '') + tr(' · Shift: 5 adet'),
        check: () => {
          if (!safe(() => g.isUnlocked(this._me(), 'unit', uid), true)) return { ok: false, locked: true, reason: tr('Gerekli çağ: ') + (tr(AGES[u.age]?.name) || u.age) };
          if (!afford(u.cost)) return { ok: false, reason: tr('Yetersiz kaynak') };
          if (p.pop + (u.pop ?? 1) > p.popCap) return { ok: false, reason: tr('Nüfus sınırı dolu (1000)') };
          return { ok: true };
        },
        run: () => { let ok = false; for (let i = many(); i > 0; i--) for (const b of pool) if (safe(() => g.train(b.id, uid), false)) ok = true; return ok; },
      });
    }
    const queuedTech = new Set();
    for (const b of safe(() => g.buildingsOf(this._me()), [])) for (const q of b.queue || []) if (q.kind === 'tech') queuedTech.add(q.id);
    for (const tid of bd.researches || []) {
      // a researched / queued tech leaves its slot empty, so the others keep their place and hotkey (2026-11-17
      // playtest: "the blacksmith's upgrades shift when one disappears")
      const t = TECHS[tid]; if (!t) continue;
      if (p.techs?.has(tid) || queuedTech.has(tid)) { put(false); continue; }
      if (later(t.age)) { put(false); continue; }
      put({
        icon: t.icon || ico('x-tech'), name: tr(t.name), cost: t.cost, time: t.time * QUEUE_TIME_MUL / sb, desc: tr(t.desc),
        check: () => {
          if (!safe(() => g.isUnlocked(this._me(), 'tech', tid), true)) return { ok: false, locked: true, reason: tr('Gerekli çağ: ') + (tr(AGES[t.age]?.name) || t.age) };
          if (!afford(t.cost)) return { ok: false, reason: tr('Yetersiz kaynak') };
          return { ok: true };
        },
        run: () => pool.some((b) => safe(() => g.research(b.id, tid), false)),
      });
    }
    if (e.type === 'towncenter' && p.age < AGES.length - 1 && !pool.some((b) => (b.queue || []).some((q) => q.kind === 'age'))) {
      const na = AGES[p.age + 1];
      put({
        icon: ico('x-ageup'), name: tr('Çağ Atla: ') + tr(na.name), cost: na.cost, time: na.time * QUEUE_TIME_MUL / sb / (g.cfg?.tutorial ? 4 : 1),
        desc: (na.unlockText || []).map((x) => tr(x)).join(' · ') || tr('Sonraki çağa geç.'),
        check: () => { const r = safe(() => g.canAgeUp(this._me()), { ok: false, reason: '' }) || { ok: false }; return { ok: !!r.ok, reason: r.reason }; },
        run: () => pool.some((b) => safe(() => g.ageUp(b.id), false)),
      }, 9);
    }
    if (e.type === 'market') {
      for (const r of ['food', 'wood', 'stone']) {
        put({
          icon: RES_ICON[r], lbl: tr('Sat'), name: `${RES_NAME[r]} Sat`,
          get desc() { return tr('100 {0} karşılığında {1} Altın al. Shift: 5 kez (500).', RES_NAME[r], Math.floor(safe(() => g.tradeRate(r, 'gold', p.id ?? 0), 0))); },
          check: () => ((p.res[r] || 0) >= 100 ? { ok: true } : { ok: false, reason: tr('Yetersiz ') + RES_NAME[r].toLowerCase() }),
          run: () => { let ok = false; for (let i = many(); i > 0; i--) if (safe(() => g.trade(this._me(), r, 'gold'), false)) ok = true; return ok; },
        });
      }
      for (const r of ['food', 'wood', 'stone']) {
        put({
          icon: RES_ICON[r], lbl: tr('Al'), name: `${RES_NAME[r]} Al`,
          get desc() { return tr('100 Altın karşılığında {0} {1} al. Shift: 5 kez (500 Altın).', Math.floor(safe(() => g.tradeRate('gold', r, p.id ?? 0), 0)), RES_NAME[r]); },
          check: () => ((p.res.gold || 0) >= 100 ? { ok: true } : { ok: false, reason: tr('Yetersiz altın') }),
          run: () => { let ok = false; for (let i = many(); i > 0; i--) if (safe(() => g.trade(this._me(), 'gold', r), false)) ok = true; return ok; },
        });
      }
      // barter (owner playtest 2026-11-14): resource for resource on its own page
      put({
        icon: ico('x-trade'), lbl: tr('Takas'), name: tr('Takas: Kaynak ver, kaynak al'),
        desc: tr('Altına çevirmeden doğrudan takas: örneğin odun verip yiyecek al. Tek adımda, sat-al yapmaktan biraz daha kârlı.'),
        run: () => { this.page = 'barter'; return true; },
      });
    }
    turnBtn();
    put(del, 14);
    return slots;
  }
  // (Geri / a build page swaps the whole card under the cursor: Geri sits in slot 14, where the root card has "Sil".
  // A double click or a second quick press used to hit "Sil" and delete the villagers, and the tooltip jumped to
  // "Sil". After a page switch the card ignores clicks and hover for a moment.)
  _renderCard(ents) {
    if (this._cardPage !== this.page) { if (this._cardPage != null) this._cardGuardT = performance.now() + CARD_GUARD_MS; this._cardPage = this.page; }
    const specs = this._specs(ents);
    this.cardEl.classList.toggle('empty', !specs.some(Boolean)); // no commands -> hide the whole card
    this.cardEl.innerHTML = '';
    this.buttons = [];
    specs.forEach((s, i) => {
      if (!s) { this.cardEl.append(el('div', 'cmd-empty')); this.buttons.push(null); return; }
      s.hotkey = HOTKEYS[i];
      const node = el('button', 'cmd', `<span>${s.icon}</span><span class="hk">${s.hotkey}</span>${s.lbl ? `<span class="lbl">${s.lbl}</span>` : ''}`);
      const b = { node, spec: s, ok: true };
      node.onclick = () => { if (performance.now() < (this._cardGuardT || 0)) return; this._press(b); };
      node.oncontextmenu = (ev) => { ev.preventDefault(); if (this.page !== 'root') this.cardBack(); };   // right click: back to the main card
      this._tip(node, () => s);
      this.cardEl.append(node); this.buttons.push(b);
    });
  }
  _press(b) {
    const c = b.spec.check ? safe(b.spec.check, { ok: true }) : { ok: true };
    if (!c.ok) {
      this._error();
      let why = tr(c.reason || '');
      if (why === tr('Yetersiz kaynak') && b.spec.cost) {
        const res = this.game?.players?.[this._me()]?.res || {};
        const miss = RES_LIST.filter((r) => (b.spec.cost[r] || 0) > (res[r] || 0)).map((r) => `${RES_ICON[r]} ${Math.ceil(b.spec.cost[r] - (res[r] || 0))}`);
        if (miss.length) why = tr('Yetersiz kaynak — eksik: ') + miss.join(' · ');
      }
      if (why) this.hint('press:' + (c.reason || ''), '⛔ ' + why, 'warn', 2.5);
      return;
    }
    const r = safe(() => b.spec.run(), false);
    if (r === false || r == null) this._error(); else this._click();
    this.cardSig = null; this.selSig = null;
    this._hideTip();
    safe(() => { this._refreshSel(); this._refreshCard(); });
  }
  // Called by input: triggers the visible command button bound to the key. Returns true if handled.
  hotkey(key) {
    if (this.mode !== 'hud' || !this.game || this.app.paused) return false;
    const i = HOTKEYS.indexOf(String(key || '').toUpperCase());
    if (i < 0) return false;
    const b = this.buttons[i];
    if (!b) return false;
    if (performance.now() < (this._cardGuardT || 0)) return true;   // (B twice: Geri, then not "Sil")
    this._press(b);
    return true;
  }
  // a build page is open: back to the main card (Geri, right click on the card, Esc). Returns true if it went back.
  cardBack() {
    if (this.page === 'root') return false;
    this.page = 'root'; this.cardSig = null;
    this._hideTip();
    safe(() => this._refreshCard());
    return true;
  }

  // ------------------------------------------------------------------ quests
  _refreshQuests() {
    const list = this.game.quests?.list || [], now = performance.now();
    const show = list.filter((q) => !q.done || (this.questDoneAt.has(q.id) && now - this.questDoneAt.get(q.id) < 4500)).slice(0, 4);
    const sig = show.map((q) => q.id + (q.done ? 1 : 0) + (q.progress || '')).join('|');
    if (sig === this.questSig) return;
    this.questSig = sig;
    let h = tr('<h4>Görevler</h4>');
    if (!show.length) h += tr('<div class="quest"><div class="qd">Tüm görevler tamamlandı.</div></div>');
    for (const q of show) {
      h += `<div class="quest${q.done ? ' done' : ''}"><div class="qt">${esc(tr(q.title))}</div><div class="qd">${esc(tr(q.desc || ''))}</div>${q.progress ? `<div class="qp">${esc(tr(q.progress))}</div>` : ''}${q.reward ? `<div class="qr">${tr('Ödül: {0}', this._rewardText(q.reward))}</div>` : ''}</div>`;
    }
    this.questsEl.innerHTML = h;
  }

  // ------------------------------------------------------------------ minimap
  _bindMinimap() {
    const pos = (ev) => {
      const r = this.mm.getBoundingClientRect(), N = this.game?.map?.size || 1;
      return { x: Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width)) * N, z: Math.max(0, Math.min(1, (ev.clientY - r.top) / r.height)) * N };
    };
    let drag = false;
    this.mm.addEventListener('mousedown', (ev) => {
      if (!this.game) return;
      const p = pos(ev);
      // flare: Alt + click, or the 📍 button armed
      if (ev.button === 0 && (ev.altKey || this.app.input?.flareArmed)) { this.app.input?.disarmFlare(); this.app.flare?.(p.x, p.z); ev.preventDefault(); return; }
      if (ev.button === 0) { drag = true; this.app.focus?.(p.x, p.z); }
      else if (ev.button === 2) this.app.commandGround?.(p.x, p.z);
      ev.preventDefault();
    });
    window.addEventListener('mousemove', (ev) => { if (drag && this.game) { const p = pos(ev); this.app.focus?.(p.x, p.z); } });
    window.addEventListener('mouseup', () => { drag = false; });
    this.mm.addEventListener('contextmenu', (ev) => ev.preventDefault());
  }
  // (players 2026-11-22) the 4 screen corners cast onto the ground plane at the camera target's height; a corner above
  // the horizon is taken far out along its direction. Only the camera's matrices (no three.js here).
  _camQuad(N) {
    const R = this.app.renderer, c = R?.camera, cam = R?.cam;
    if (!c || !c.matrixWorld || !c.projectionMatrixInverse || !cam) return null;
    const pi = c.projectionMatrixInverse.elements, mw = c.matrixWorld.elements, ox = mw[12], oy = mw[13], oz = mw[14];
    const gy = safe(() => R.groundY(cam.tx, cam.tz), 0) || 0, far = N * 1.5;
    const corner = (nx, ny) => {
      const w = pi[3] * nx + pi[7] * ny + pi[11] * 0.5 + pi[15];
      const vx = (pi[0] * nx + pi[4] * ny + pi[8] * 0.5 + pi[12]) / w, vy = (pi[1] * nx + pi[5] * ny + pi[9] * 0.5 + pi[13]) / w, vz = (pi[2] * nx + pi[6] * ny + pi[10] * 0.5 + pi[14]) / w;
      const dx = mw[0] * vx + mw[4] * vy + mw[8] * vz, dy = mw[1] * vx + mw[5] * vy + mw[9] * vz, dz = mw[2] * vx + mw[6] * vy + mw[10] * vz;
      const hl = Math.hypot(dx, dz) || 1;
      let t = dy < -1e-6 ? (oy - gy) / -dy : Infinity;
      if (!(t * hl <= far)) t = far / hl;
      return [ox + dx * t, oz + dz * t];
    };
    const q = [corner(-1, 1), corner(1, 1), corner(1, -1), corner(-1, -1)];
    return q.every(([x, z]) => Number.isFinite(x) && Number.isFinite(z)) ? q : null;
  }
  _drawMinimap() {
    const g = this.game, map = g.map; if (!map) return;
    const N = map.size, ctx = this.mm.getContext('2d'), k = MM / N;
    const clim = this.app.renderer && this.app.renderer.climate, ckey = (this.app.renderer && this.app.renderer.climateKey) || '';
    if (!this.mmTerrain || this.mmTerrain.width !== N || this._mmClimate !== ckey || this._mmGame !== g) {
      this._mmClimate = ckey; this._mmGame = g;
      const tcol = TILE_COL.slice(); if (clim && clim.mm) { tcol[0] = clim.mm[0]; tcol[6] = clim.mm[1]; }   // (grass and forest floor in the climate's colours)
      const c = document.createElement('canvas'); c.width = N; c.height = N;
      const cx = c.getContext('2d'), img = cx.createImageData(N, N);
      for (let i = 0; i < N * N; i++) {
        const col = tcol[map.tiles[i]] || tcol[0];
        const sh = 0.9 + ((i * 2654435761 >>> 0) % 100) / 500;
        img.data[i * 4] = col[0] * sh; img.data[i * 4 + 1] = col[1] * sh; img.data[i * 4 + 2] = col[2] * sh; img.data[i * 4 + 3] = 255;
      }
      cx.putImageData(img, 0, 0);
      this.mmTerrain = c;
      this.mmFog = document.createElement('canvas'); this.mmFog.width = N; this.mmFog.height = N; this.mmFogVer = -1; this._mmFogImg = null;
    }
    if (g.fog && this.mmFogVer !== g.fogVersion) {
      this.mmFogVer = g.fogVersion;
      // (speed 2026-11-15: one pixel buffer kept for the game, only changed cells rewritten; it was a fresh 4*N*N
      //  buffer four times a second)
      const fx = this.mmFog.getContext('2d');
      if (!this._mmFogImg || this._mmFogImg.width !== N) { this._mmFogImg = fx.createImageData(N, N); this._mmFogPrev = new Uint8Array(N * N).fill(255); }
      const img = this._mmFogImg, d = img.data, prev = this._mmFogPrev, fog = g.fog;
      for (let i = 0; i < N * N; i++) { const f = fog[i]; if (f === prev[i]) continue; prev[i] = f; d[i * 4 + 3] = f === 0 ? 255 : f === 1 ? 120 : 0; }
      fx.putImageData(img, 0, 0);
    }
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(this.mmTerrain, 0, 0, MM, MM);
    // resources (drawn under fog so unexplored ones stay hidden)
    if (!this._mmRes || this._mmResG !== g || g.time - this._mmResT > 2 || g.time < this._mmResT) { this._mmResG = g; this._mmResT = g.time; this._mmRes = []; for (const e of g.entities.values()) if (e.kind === 'resource' && e.type !== 'tree' && e.type !== 'deer' && e.type !== 'wolf' && e.type !== 'bear') this._mmRes.push(e); }
    for (const e of this._mmRes) {
      if (e.dead || e.kind !== 'resource' || e.type === 'tree' || e.type === 'deer' || e.type === 'wolf' || e.type === 'bear') continue;
      if (e.type === 'fish') { ctx.fillStyle = '#9fe4ff'; ctx.beginPath(); ctx.arc(e.x * k, e.z * k, 1.6, 0, Math.PI * 2); ctx.fill(); continue; }
      ctx.fillStyle = e.type === 'gold' ? '#ffd84a' : e.type === 'stone' ? '#c9cdd4' : '#d86aa0';
      ctx.fillRect(e.x * k - 1.5, e.z * k - 1.5, 3, 3);
    }
    if (g.fog) { ctx.imageSmoothingEnabled = true; ctx.drawImage(this.mmFog, 0, 0, MM, MM); }
    // rail: thin dark lines between neighbouring rail tiles
    const rails = new Map();
    for (const e of g.buildings) if (!e.dead && e.kind === 'building' && e.type === 'rail' && (e.owner === this._me() || safe(() => g.isEntityVisible(e), true))) rails.set(Math.floor(e.x) + ',' + Math.floor(e.z), e);
    if (rails.size) {
      ctx.strokeStyle = 'rgba(30,24,20,.95)'; ctx.lineWidth = 1.2; ctx.beginPath();
      for (const e of rails.values()) {
        const tx = Math.floor(e.x), tz = Math.floor(e.z), cx = (tx + 0.5) * k, cz = (tz + 0.5) * k;
        let lone = true;
        if (rails.has((tx + 1) + ',' + tz)) { ctx.moveTo(cx, cz); ctx.lineTo(cx + k, cz); lone = false; }
        if (rails.has(tx + ',' + (tz + 1))) { ctx.moveTo(cx, cz); ctx.lineTo(cx, cz + k); lone = false; }
        if (lone && !rails.has((tx - 1) + ',' + tz) && !rails.has(tx + ',' + (tz - 1))) { ctx.moveTo(cx - 0.8, cz); ctx.lineTo(cx + 0.8, cz); }
      }
      ctx.stroke();
    }
    // units and buildings in the same (id) order the entity map gives, without walking the map's trees
    const mmE = g.units.concat(g.buildings).sort((x, y) => x.id - y.id);
    // a rival's known town center that fell in the fog stays on the map until someone sees the spot
    const known = this._mmKnown && this._mmKnown.g === g ? this._mmKnown : (this._mmKnown = { g, m: new Map() });
    for (const [id, e] of known.m) {
      if (!e.dead && g.entities.get(id) === e) continue;
      if (!safe(() => this._fogged(e), false)) { known.m.delete(id); continue; }
      const s = Math.max(3, (e.size || 1) * k); ctx.fillStyle = hex(PLAYER_COLORS[e.owner] ?? 0xffffff); ctx.fillRect(e.x * k - s / 2, e.z * k - s / 2, s, s);
    }
    for (const e of mmE) {
      if (e.known && e.owner !== this._me() && !e.dead) known.m.set(e.id, e);
      if (e.dead || e.kind === 'resource' || e.aboard != null || (e.kind === 'building' && e.type === 'rail')) continue;
      if (e.owner !== this._me() && !safe(() => g.isEntityVisible(e), true)) continue;
      ctx.fillStyle = hex(PLAYER_COLORS[e.owner] ?? 0xffffff);
      if (e.train) { ctx.fillStyle = '#fff6a8'; ctx.beginPath(); ctx.arc(e.x * k, e.z * k, 2.2, 0, Math.PI * 2); ctx.fill(); continue; }
      if (e.naval || UNITS[e.type]?.naval) { const r = 2.4; ctx.beginPath(); ctx.moveTo(e.x * k, e.z * k - r); ctx.lineTo(e.x * k + r, e.z * k); ctx.lineTo(e.x * k, e.z * k + r); ctx.lineTo(e.x * k - r, e.z * k); ctx.closePath(); ctx.fill(); continue; }
      if (e.kind === 'building') { const s = Math.max(3, (e.size || 1) * k); ctx.fillRect(e.x * k - s / 2, e.z * k - s / 2, s, s); if (g.mp && e.owner !== this._me() && this._ally(this._me(), e.owner)) { ctx.strokeStyle = 'rgba(140,200,255,.95)'; ctx.lineWidth = 1; ctx.strokeRect(e.x * k - s / 2 - 0.5, e.z * k - s / 2 - 0.5, s + 1, s + 1); } }
      else ctx.fillRect(e.x * k - 1.25, e.z * k - 1.25, 2.5, 2.5);
    }
    // (owner 2026-11-20) a rival down to its last one or two buildings that train units: they blink on the minimap, also
    // in the fog, so the match does not drag on with a building nobody can find
    {
      const blink = 0.5 + 0.5 * Math.sin(performance.now() / 260);
      for (const p of g.players || []) {
        if (p.defeated || p.id === this._me() || this._ally(this._me(), p.id)) continue;
        const last = g.buildings.filter((b) => b.owner === p.id && !b.dead && PROD_B.has(b.type) && (b.done || b.progress > 0));   // (same set as the victory rule: no temple)
        /* (owner 2026-11-22) only a rival that once had 3+ of them and lost them: at the start every rival has one town
           center, and the blink gave its place away from the first second */
        if (!this._prodPeak || this._prodPeak.g !== g) this._prodPeak = { g, m: new Map() };
        const peak = Math.max(this._prodPeak.m.get(p.id) || 0, last.length); this._prodPeak.m.set(p.id, peak);
        if (!last.length || last.length > 2 || peak < 3) continue;
        for (const b of last) {
          const r = Math.max(5, (b.size || 3) * k * 0.9) + blink * 3;
          ctx.strokeStyle = 'rgba(255,90,70,' + (0.45 + 0.5 * blink).toFixed(2) + ')'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.arc(b.x * k, b.z * k, r, 0, Math.PI * 2); ctx.stroke();
          ctx.fillStyle = hex(PLAYER_COLORS[p.id] ?? 0xffffff); const s = Math.max(3, (b.size || 1) * k); ctx.fillRect(b.x * k - s / 2, b.z * k - s / 2, s, s);
        }
      }
    }
    // selection highlight
    ctx.fillStyle = '#fff';
    for (const e of this._ents()) if (e.owner === this._me() && e.kind === 'unit') ctx.fillRect(e.x * k - 1, e.z * k - 1, 2, 2);
    // camera marker: the ground the screen really shows (a trapezoid under the tilted camera), the canvas clips it to the map
    const cam = this.app.renderer?.cam, quad = safe(() => this._camQuad(N), null);
    if (quad) {
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.3; ctx.beginPath();
      quad.forEach(([x, z], i) => (i ? ctx.lineTo(x * k, z * k) : ctx.moveTo(x * k, z * k)));
      ctx.closePath(); ctx.stroke();
    } else if (cam) {
      const w = Math.max(6, (cam.dist || 30) * 1.5 * k), h = w * 0.62;
      ctx.save(); ctx.translate(cam.tx * k, cam.tz * k); ctx.rotate(-(cam.yaw || 0));
      ctx.strokeStyle = 'rgba(255,255,255,.95)'; ctx.lineWidth = 1.3; ctx.strokeRect(-w / 2, -h / 2, w, h);
      ctx.restore();
    }
    // pings
    const now = performance.now();
    this.pings = this.pings.filter((p) => now - p.t < 5000);
    for (const p of this.pings) {
      const rings = p.big ? 3 : 1, R = p.big ? 30 : 14;
      for (let i = 0; i < rings; i++) {
        const a = Math.max(0, (now - p.t + i * 300) % 900) / 900;
        ctx.strokeStyle = `rgba(255,70,70,${1 - a})`; ctx.lineWidth = p.big ? 2.6 : 2;
        ctx.beginPath(); ctx.arc(p.x * k, p.z * k, 3 + a * R, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = '#ff4646'; ctx.fillRect(p.x * k - 3, p.z * k - 3, 6, 6);
    }
    // map flares (ours and our teammates'): the player's colour, three expanding rings and a pin
    this.flares = (this.flares || []).filter((f) => now - f.t < FLARE_MS);
    for (const f of this.flares) {
      const age = now - f.t, col = f.col;
      for (let i = 0; i < 3; i++) {
        const a = ((age + i * 400) % 1200) / 1200;
        ctx.strokeStyle = col; ctx.globalAlpha = (1 - a) * (age > FLARE_MS - 1000 ? (FLARE_MS - age) / 1000 : 1); ctx.lineWidth = 2.2;
        ctx.beginPath(); ctx.arc(f.x * k, f.z * k, 4 + a * 22, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(f.x * k, f.z * k, 4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col; ctx.beginPath(); ctx.arc(f.x * k, f.z * k, 2.6, 0, Math.PI * 2); ctx.fill();
    }
  }

  // a map flare {pid, name, x, z, mine}: minimap rings, markers on the ground, a sound and a clickable toast
  showFlare(f) {
    if (!f || !this.game) return;
    const col = hex(PLAYER_COLORS[f.pid] ?? 0xffd84a);
    (this.flares || (this.flares = [])).push({ x: f.x, z: f.z, t: performance.now(), col });
    const r = this.app.renderer, c = PLAYER_COLORS[f.pid] ?? 0xffd84a;
    // a few pulses on the ground where it points
    for (let i = 0; i < 4; i++) setTimeout(() => safe(() => r.addMarker(f.x, f.z, c)), i * 700);
    safe(() => this.app.audio?.ui('chat'));
    if (!f.mine) this.toast(ico('x-flare') + ' ' + (f.name || tr('Takım arkadaşın')) + tr(' haritada işaret verdi (git: tıkla)'), 'info', f.x, f.z);
  }

  // ------------------------------------------------------------------ overlays
  // The in-game menu (Esc / the ⏸ button). Single player: it pauses the game. Multiplayer: the match goes on
  // while it is open; "Oyunu Duraklat" pauses it for everybody (a lockstep command, see NetSession.requestPause).
  _buildPause() {
    this.pauseEl.innerHTML = '';
    const net = this.app.net, mpPaused = !!(net && net.paused);
    const title = !net ? tr('Duraklatıldı') : mpPaused ? tr('Oyun Duraklatıldı') : tr('Menü');
    const m = el('div', 'modal panel', `<h2>${title}</h2>`);
    m.style.width = 'min(420px, 92vw)';
    if (net) m.append(el('div', 'pause-info', esc(mpPaused ? (net.pausedBy || tr('Bir oyuncu')) + tr(' oyunu herkes için duraklattı.') : tr('Çok oyunculu maç sürüyor; duraklatırsan herkes için durur.'))));
    this.pauseInfoEl = el('div', 'pause-info'); m.append(this.pauseInfoEl);
    const btn = (t, fn, cls = '') => { const b = el('button', 'mbtn ' + cls, t); b.onclick = () => { this._click(); fn(); }; m.append(b); };
    if (!net) btn(tr('Devam Et'), () => this.app.setPaused?.(false), 'primary');
    else if (mpPaused) btn(tr('Oyunu Devam Ettir (herkes için)'), () => { net.requestPause(false); }, 'primary');
    else {
      btn(tr('Oyuna Dön'), () => this.toggleGameMenu(false), 'primary');
      btn(tr('Oyunu Duraklat (herkes için)'), () => { net.requestPause(true); });
    }
    btn(tr('Kaydet'), () => this._save());
    btn(tr('İstatistik'), () => this.showStats());
    const sbox = el('div'); sbox.style.margin = '14px 0';
    this._settingsBody(sbox); m.append(sbox);
    if (net) btn(tr('Maçtan Ayrıl'), async () => {
      if (!(await ask({ title: tr('Maçtan Ayrıl'), text: tr('Maçtan ayrılmak istediğine emin misin?\nMaç diğerleri için sürer.'), ok: tr('Ayrıl'), danger: true }))) return;
      if (this.app.net !== net) return;   // (the match ended / was left while the dialog was open)
      this.menuOpen = false; safe(() => this.app.leaveMultiplayer?.());
    });
    // (toMenu does not save: only the periodic autosave and Kaydet do, so unsaved progress is lost here)
    else btn(tr('Ana Menü'), async () => {
      const g = this.app.game;
      if (g && !g.over && !(await ask({ title: tr('Ana Menü'), text: tr('Ana menüye dönmek istediğine emin misin?\nKaydetmediğin ilerleme kaybolur.'), ok: tr('Ana Menü'), danger: true }))) return;
      if (this.app.game !== g || this.app.net) return;
      safe(() => this.app.toMenu?.()); this.showMenu();
    });
    this.pauseEl.append(m);
  }
  // is the in-game menu showing? (single player: paused; multiplayer: opened, or the match is paused)
  gameMenuVisible() {
    // (after the match: hidden only while the result window is up; "Haritayı İzle" closes it and Esc works again)
    if (this.mode !== 'hud' || !this.game || (this.gameOverShown && !this.modalEl.classList.contains('hidden'))) return false;
    const net = this.app.net;
    return net ? !!(this.menuOpen || net.paused) : !!this.app.paused;
  }
  toggleGameMenu(open) {
    if (this.mode !== 'hud' || !this.game || this.app.demo) return;
    const net = this.app.net;
    if (!net) { this.app.setPaused?.(open == null ? !this.app.paused : !!open); return; }
    this.menuOpen = open == null ? !this.menuOpen : !!open;
    this._pauseKey = null;
    this._syncPauseMenu();
  }
  _syncPauseMenu() {
    const show = this.gameMenuVisible(), net = this.app.net;
    const key = show ? [!!net, !!(net && net.paused), net && net.pausedBy].join('|') : null;
    if (show && key !== this._pauseKey) { this._pauseKey = key; this._buildPause(); }
    if (!show) this._pauseKey = null;
    this.pauseEl.classList.toggle('hidden', !show);
  }
  _save() {
    // multiplayer: a lockstep save request; "Oyun kaydedildi (çok oyunculu)" comes when every client has saved
    if (this.app.game?.mp) { Promise.resolve(safe(() => this.app.saveGame(), false)).then((ok) => { if (!ok) this.toast(tr('Kayıt başarısız'), 'warn'); }).catch(() => this.toast(tr('Kayıt başarısız'), 'warn')); return; }
    // (saveGame itself reports "Oyun kaydedildi." / "Oyun kaydedilemedi!" through the game's notify toast: one message)
    Promise.resolve(safe(() => this.app.saveGame(), null)).catch(() => this.toast(tr('Kayıt başarısız'), 'warn'));
  }
  _closeModal(force) { if (this.modalLocked && !force) return; this._tribOpen = false; this.modalLocked = false; this.techTiles = null; this.modalEl.classList.add('hidden'); this.modalEl.innerHTML = ''; }
  _score(p) {
    return playerScore(p);
  }
  _statsPlayers(showAll) { const g = this.game; return g.players.filter((p) => showAll || p.id === this._me() || this._ally(this._me(), p.id) || g.over || this._enemyKnown(p)); }
  _statsName(p) { return p.id === this._me() ? tr('Sen') : this.game?.mp ? this._pname(p.id) : tr('Rakip ') + p.id; }
  _graphs(m, showAll) { safe(() => m.append(graphPanel(this.game, this._statsPlayers(showAll).map((p) => ({ id: p.id, name: this._statsName(p) })))), null); }
  _statsTable(showAll) {
    const g = this.game, ps = this._statsPlayers(showAll);
    const row = (label, fn) => `<tr><td>${label}</td>${ps.map((p) => `<td>${fn(p)}</td>`).join('')}</tr>`;
    const st = (p) => p.stats || {};
    let h = '<table class="st"><tr><th></th>' + ps.map((p) => `<th><span class="dot" style="background:${hex(PLAYER_COLORS[p.id] ?? 0xffffff)}"></span>${p.id === this._me() ? tr('Sen') : this.game?.mp ? esc(this._pname(p.id)) + ` <small>T${this._teamOf(p.id)}</small>` : tr('Rakip ') + p.id}${p.defeated ? ' ☠' : ''}</th>`).join('') + '</tr>';
    h += row(tr('Skor'), (p) => `<b style="color:var(--gold)">${this._score(p)}</b>`);
    h += row(tr('Çağ'), (p) => tr(AGES[p.age]?.name) || p.age);
    // (players 2026-11-22) what each side has right now: soldiers (ships included) and villagers
    const now = this._armyNow();
    h += row(tr('Ordu (şu an)'), (p) => now.army[p.id] || 0);
    h += row(tr('Köylü (şu an)'), (p) => now.vil[p.id] || 0);
    for (const r of RES_LIST) h += row(`${RES_ICON[r]} ${tr('Toplanan {0}', RES_NAME[r])}`, (p) => Math.floor(st(p).gathered?.[r] || 0));
    h += row(tr('Eğitilen Birim'), (p) => st(p).unitsTrained || 0);
    h += row(tr('Kaybedilen Birim'), (p) => st(p).unitsLost || 0);
    h += row(tr('Öldürülen Düşman'), (p) => st(p).kills || 0);
    h += row(tr('İnşa Edilen Bina'), (p) => st(p).buildingsBuilt || 0);
    h += row(tr('Kaybedilen Bina'), (p) => st(p).buildingsLost || 0);
    h += row(tr('Yıkılan Düşman Binası'), (p) => st(p).razed || 0);
    h += row(tr('Araştırma'), (p) => (typeof st(p).techs === 'number' ? st(p).techs : p.techs?.size || 0));
    return h + '</table>';
  }
  _armyNow() {
    const army = {}, vil = {};
    for (const u of this.game.units || []) {
      if (u.dead || u.train || !(u.owner >= 0)) continue;
      const d = UNITS[u.type]; if (!d) continue;
      if (u.type === 'villager') vil[u.owner] = (vil[u.owner] || 0) + 1;
      else if (d.cls !== 'civil' && d.atk > 0) army[u.owner] = (army[u.owner] || 0) + 1;
    }
    return { army, vil };
  }
  _enemyKnown(p) {
    const g = this.game;
    // (a starting town center known from the start is not "met": only something really seen counts, and once met
    // a rival stays listed)
    const met = this._met && this._met.g === g ? this._met : (this._met = { g, s: new Set() });
    if (met.s.has(p.id)) return true;
    for (const e of g.entities.values()) if (e.owner === p.id && !e.dead && !(e.known && this._fogged(e)) && safe(() => g.isEntityVisible(e), false)) { met.s.add(p.id); return true; }
    return false;
  }
  // ------------------------------------------------------------------ tribute: send resources to an ally
  _allies() {
    const g = this.game, me = this._me(); if (!g || !g.players) return [];
    return g.players.filter((p) => p.id !== me && this._ally(me, p.id) && !p.defeated && !p.left).map((p) => p.id);
  }
  showTribute() {
    if (!this.game || !this._allies().length) return;
    this.modalLocked = false; this.techTiles = null;
    this._tribOpen = true;
    if (!this._trib || !this._allies().includes(this._trib.to)) this._trib = { to: this._allies()[0], res: (this._trib && this._trib.res) || 'wood' };
    this._renderTribute();
    this.modalEl.classList.remove('hidden');
  }
  _renderTribute() {
    const g = this.game, me = this._me(), p = g?.players?.[me], st = this._trib;
    if (!p || !st || this.modalEl.classList.contains('hidden') && !this._tribOpen) return;
    const allies = this._allies();
    if (!allies.includes(st.to)) st.to = allies[0];
    this.modalEl.innerHTML = '';
    const m = el('div', 'modal panel tribute');
    m.append(el('h2', '', tr('Müttefike Kaynak Gönder')), el('div', 'tsub', tr('Gönderdiğin kaynak kesintisiz takım arkadaşına geçer.')));
    const row = (label) => { const r = el('div', 'trow'); r.append(el('div', 'tlbl', label)); m.append(r); return r; };
    const ar = row(tr('Kime'));
    for (const id of allies) {
      const q = g.players[id];
      const b = el('button', 'tchip' + (id === st.to ? ' on' : ''), `<span class="dot" style="background:${hex(PLAYER_COLORS[id] ?? 0xffffff)}"></span>${esc(this._pname(id))}<small>${RES_LIST.map((r) => `${RES_ICON[r]}${Math.floor(q.res?.[r] || 0)}`).join(' ')}</small>`);
      b.onclick = () => { this._click(); st.to = id; this._renderTribute(); };
      ar.append(b);
    }
    const rr = row(tr('Kaynak'));
    for (const r of RES_LIST) {
      const b = el('button', 'tchip' + (r === st.res ? ' on' : ''), `${RES_ICON[r]} ${RES_NAME[r]} <small>${Math.floor(p.res[r] || 0)}</small>`);
      b.onclick = () => { this._click(); st.res = r; this._renderTribute(); };
      rr.append(b);
    }
    const nr = row(tr('Gönder'));
    const have = Math.floor(p.res[st.res] || 0);
    for (const [label, amt] of [['100', 100], ['500', 500], ['Tümü', have]]) {
      const b = el('button', 'mbtn small' + (label === '500' ? ' primary' : ''), `${label === 'Tümü' ? tr('Tümü ({0})', have) : label} ${RES_ICON[st.res]}`);
      b.disabled = have < 1 || (amt !== have && have < amt);
      b.onclick = () => {
        const c = safe(() => g.canTribute(me, st.to, st.res, amt), { ok: false, reason: '' });
        if (!c.ok) { this._error(); if (c.reason) this.toast('⛔ ' + tr(c.reason), 'warn'); return; }
        this._click();
        safe(() => g.cmdTribute(me, st.to, st.res, amt));   // (multiplayer: through the lockstep; the toast comes when it runs)
        setTimeout(() => { if (this._tribOpen && this.modalEl.querySelector('.tribute')) safe(() => this._renderTribute()); }, 60);
      };
      nr.append(b);
    }
    const close = el('button', 'mbtn small', tr('Kapat')); close.onclick = () => { this._click(); this._tribOpen = false; this._closeModal(); };
    m.append(close);
    this.modalEl.append(m);
  }
  showStats() {
    if (!this.game) return;
    this.modalLocked = false; this.techTiles = null;
    this.modalEl.innerHTML = '';
    const m = el('div', 'modal panel', `<h2>${tr('İstatistikler')}</h2><div style="color:var(--dim)">${tr('Süre: {0} · Rakipler yalnızca keşfedildiğinde listelenir', fmtTime(this.game.time || 0))}</div>${this._statsTable(false)}`);
    this._graphs(m, false);
    const b = el('button', 'mbtn small', tr('Kapat')); b.onclick = () => { this._click(); this._closeModal(); };
    m.append(b); this.modalEl.append(m); this.modalEl.classList.remove('hidden');
  }
  showGameOver(won) {
    if (this.gameOverShown || !this.game) return;
    this.gameOverShown = true; this.modalLocked = true; this.techTiles = null;
    this.pauseEl.classList.add('hidden');
    this.modalEl.innerHTML = '';
    if (this.tut && this.game.cfg?.tutorial) { const tm = safe(() => this.tut.gameOver(won), null); if (tm) { this.modalEl.append(tm); this.modalEl.classList.remove('hidden'); return; } }
    if (this.game.mp) won = this._mpWon(won);
    const wt = this.game.mp ? this._winTeam() : null, wtxt = wt != null ? tr('Takım {0} kazandı! ', wt) : '';
    const m = el('div', 'modal panel', `<h1 class="${won ? 'win' : 'lose'}">${won ? tr('ZAFER') : tr('YENİLGİ')}</h1><div style="color:var(--dim)">${wtxt}${won ? (this.game.mp ? tr('Takımın tüm rakipleri alt etti.') : tr('Tüm rakiplerini alt ettin. Uygarlığın çağlara damga vurdu.')) : tr('Uygarlığın tarihe karıştı.')} · ${tr('Süre: {0}', fmtTime(this.game.time || 0))}</div>${this._statsTable(true)}`);
    this._graphs(m, true);
    const btn = (t, fn, cls = '') => { const b = el('button', 'mbtn small ' + cls, t); b.onclick = () => { this._click(); fn(); }; m.append(b); };
    const cfg = this.game.cfg;
    if (!this.app.net) btn(tr('Yeniden Oyna'), () => { this._closeModal(true); this.app.newGame({ ...cfg, seed: (Math.random() * 1e9) | 0 }); }, 'primary');
    btn(tr('Haritayı İzle'), () => { this._closeModal(true); if (!this.app.net) { this.game.spectate = true; safe(() => this.app.setPaused?.(false)); } this.toast?.(tr('👁 Tüm harita açıldı — izleme modu'), 'info'); });
    btn(tr('Ana Menü'), () => { this._closeModal(true); if (this.app.net) safe(() => this.app.leaveMultiplayer ? this.app.leaveMultiplayer() : this.app.net.close?.()); safe(() => this.app.toMenu?.()); this.showMenu(); });
    this.modalEl.append(m); this.modalEl.classList.remove('hidden');
  }
  // ------------------------------------------------------------------ technology tree
  _techBuildings() {
    const m = {};
    for (const bid of Object.keys(BUILDINGS)) for (const tid of BUILDINGS[bid].researches || []) (m[tid] = m[tid] || []).push(bid);
    return m;
  }
  // state of one tech for player 0: done | prog | lockAge | noBld | orphan | ok
  _techState(tid, owners) {
    const g = this.game, p = g.players[this._me()], t = TECHS[tid];
    if (p.techs?.has(tid)) return { k: 'done', txt: tr('✓ Araştırıldı') };
    const mine = safe(() => g.buildingsOf(this._me()), []);
    for (const b of mine) {
      const qi = (b.queue || []).findIndex((q) => q.kind === 'tech' && q.id === tid);
      if (qi === 0) return { k: 'prog', txt: tr('Araştırılıyor %') + Math.floor(this._qprog(b.queue[0]) * 100) };
      if (qi > 0) return { k: 'prog', txt: tr('Sırada') };
    }
    if (!safe(() => g.isUnlocked(this._me(), 'tech', tid), (p.age ?? 0) >= (t.age ?? 0))) return { k: 'lockAge', txt: ico('x-lock') + ' ' + (tr(AGES[t.age]?.name) || tr('Çağ ') + t.age) };
    if (!owners || !owners.length) return { k: 'orphan', txt: '—' };
    if (!mine.some((b) => b.done && owners.includes(b.type))) return { k: 'noBld', txt: ico('x-lock') + ' ' + owners.map((o) => tr(BUILDINGS[o]?.name) || o).join(' / ') + ' gerekli' };
    return { k: 'ok', txt: safe(() => g.canAfford(this._me(), t.cost), true) ? tr('Araştırılabilir') : tr('Yetersiz kaynak') };
  }
  _techClick(tid, owners) {
    const g = this.game, t = TECHS[tid], st = this._techState(tid, owners);
    if (st.k === 'done' || st.k === 'prog') { this._error(); return; }
    if (st.k === 'lockAge') { this._error(); this.toast(tr('⛔ Gerekli çağ: ') + (tr(AGES[t.age]?.name) || t.age), 'warn'); return; }
    if (st.k !== 'ok') { this._error(); this.toast(tr('⛔ Önce inşa et: ') + ((owners || []).map((o) => tr(BUILDINGS[o]?.name) || o).join(' / ') || tr('araştıran bina yok')), 'warn'); return; }
    if (!safe(() => g.canAfford(this._me(), t.cost), true)) { this._error(); this.toast(tr('⛔ Yetersiz kaynak: ') + tr(t.name), 'warn'); return; }
    const cands = safe(() => g.buildingsOf(this._me()), []).filter((b) => b.done && owners.includes(b.type)).sort((a, b) => (a.queue?.length || 0) - (b.queue?.length || 0));
    let ok = false;
    for (const b of cands) { const r = safe(() => g.research(b.id, tid), false); if (r !== false && r != null) { ok = true; break; } }
    if (ok) { this._click(); this.toast(`${t.icon || ico('x-tech')} ${tr('Araştırma başladı: {0}', tr(t.name))}`, 'info'); this.cardSig = null; this.selSig = null; }
    else { this._error(); this.toast(tr('⛔ Araştırma başlatılamadı: ') + tr(t.name), 'warn'); }
    this._refreshTech();
  }
  showTech() {
    if (!this.game || this.modalLocked) return;
    this.modalEl.innerHTML = '';
    const owners = this._techBuildings();
    const m = el('div', 'modal panel techmodal', `<h2>${ico('x-tech')} ${tr('Teknoloji Ağacı')}</h2><div class="techhead"></div>`);
    const ids = Object.keys(TECHS).filter((id) => !TECHS[id].legacy);   // (legacy: old saves only, e.g. Kervan)
    const cats = []; for (const id of ids) { const c = TECHS[id].cat || 'other'; if (!cats.includes(c)) cats.push(c); }
    cats.sort((a, b) => { const o = ['eco', 'mil', 'def']; const ia = o.indexOf(a), ib = o.indexOf(b); return (ia < 0 ? 9 : ia) - (ib < 0 ? 9 : ib); });
    const grid = el('div', 'techgrid');
    grid.style.gridTemplateColumns = `84px repeat(${AGES.length}, minmax(0, 1fr))`;
    grid.append(el('div', 'tgc'));
    this.techAgeEls = AGES.map((a, i) => { const h = el('div', 'tga', `<small>${tr('{0}. Çağ', i + 1)}</small>${esc(tr(a.name))}`); grid.append(h); return h; });
    this.techTiles = [];
    for (const c of cats) {
      grid.append(el('div', 'tgl', `<span>${CAT_ICON[c] || ico('x-tech')}</span>${esc(CAT_TR[c] || (c === 'other' ? tr('Diğer') : c))}`));
      for (let a = 0; a < AGES.length; a++) {
        const cell = el('div', 'tgcell');
        for (const id of ids) {
          const t = TECHS[id]; if ((t.cat || 'other') !== c || Math.max(0, Math.min(AGES.length - 1, t.age ?? 0)) !== a) continue;
          const ow = owners[id] || [];
          const node = el('button', 'tech', `<span class="ti">${t.icon || ico('x-tech')}</span><span class="tb"><span class="tnm">${esc(tr(t.name))}</span><span class="tcs"></span><span class="tst"></span></span>`);
          this._tip(node, () => ({ name: tr(t.name), cost: t.cost, time: t.time * QUEUE_TIME_MUL / (this.game?.cfg?.sandbox ? 2 : 1), desc: (tr(t.desc) || '') + (ow.length ? tr(' — Araştıran: ') + ow.map((o) => (BUILDINGS[o]?.icon || '') + ' ' + (tr(BUILDINGS[o]?.name) || o)).join(', ') : ''), check: () => { const s2 = this._techState(id, ow); return s2.k === 'ok' || s2.k === 'done' || s2.k === 'prog' ? { ok: true } : { ok: false, reason: tr('Gerekli: ') + stripIcons(s2.txt).replace(' gerekli', '') }; } }));
          node.onclick = () => this._techClick(id, ow);
          cell.append(node);
          this.techTiles.push({ id, ow, node, cs: node.querySelector('.tcs'), st: node.querySelector('.tst') });
        }
        grid.append(cell);
      }
    }
    m.append(grid);
    m.append(el('div', 'techlegend', `<span class="lg done">${tr('✓ Araştırıldı')}</span><span class="lg ok">${tr('Araştırılabilir')}</span><span class="lg prog">${tr('Araştırılıyor')}</span><span class="lg lock">${ico('x-lock')} ${tr('Önce binası gerekli')}</span><span class="lg">${tr('Sonraki çağların teknolojileri çağ atlayınca görünür')}</span>`));
    const b = el('button', 'mbtn small', tr('Kapat')); b.onclick = () => { this._click(); this._closeModal(); };
    m.append(b); this.modalEl.append(m); this.modalEl.classList.remove('hidden');
    this.techHeadEl = m.querySelector('.techhead');
    this._refreshTech();
  }
  _refreshTech() {
    const tiles = this.techTiles; if (!tiles || !this.game) return;
    if (!tiles.length || !tiles[0].node.isConnected) { this.techTiles = null; return; }
    const p = this.game.players[this._me()]; let done = 0, prog = 0, shown = 0;
    const age = p.age | 0;
    // techs of later ages are not shown at all: each age up reveals its column
    (this.techAgeEls || []).forEach((h, i) => { const fut = i > age; if (h._fut !== fut) { h._fut = fut; h.innerHTML = fut ? `<small>${tr('{0}. Çağ', i + 1)}</small>${ico('x-lock')} ?` : `<small>${tr('{0}. Çağ', i + 1)}</small>${esc(tr(AGES[i].name))}`; } });
    for (const t of tiles) {
      const later = (TECHS[t.id].age | 0) > age;
      if (t.node.hidden !== later) t.node.hidden = later;
      if (later) continue;
      shown++;
      const s2 = this._techState(t.id, t.ow);
      if (s2.k === 'done') done++; else if (s2.k === 'prog') prog++;
      const cls = 'tech ' + s2.k + (s2.k === 'ok' && s2.txt !== tr('Araştırılabilir') ? ' poor' : '');
      if (t.node.className !== cls) t.node.className = cls;
      if (t.st._txt !== s2.txt) { t.st._txt = s2.txt; t.st.innerHTML = keepIcons(esc(s2.txt)); }
      const ch = s2.k === 'done' ? '' : this._costHtml(TECHS[t.id].cost);
      if (t._ch !== ch) { t._ch = ch; t.cs.innerHTML = ch; }
    }
    const hd = tr('<b>{0} / {1}</b> araştırıldı', done, shown) + (prog ? tr(' · {0} sürüyor', prog) : '') + tr(' · Çağın: <b>{0}</b>', esc(tr(AGES[p.age]?.name) || ''));
    if (this.techHeadEl && this.techHeadEl._h !== hd) { this.techHeadEl._h = hd; this.techHeadEl.innerHTML = hd; }
    (this.techAgeEls || []).forEach((h, i) => { const c = 'tga' + (i === p.age ? ' cur' : i > p.age ? ' fut' : ''); if (h.className !== c) h.className = c; });
  }

  // ------------------------------------------------------------------ age up cinematic
  showAgeUp(age) {
    const a = AGES[age]; if (!a) return;
    this.ageUpEl?.remove();
    const offered = new Set(); for (const k of Object.keys(BUILD_CATS)) for (const id of BUILD_CATS[k].list) offered.add(id);
    const pick = (defs, flt) => Object.keys(defs).filter((id) => (defs[id].age ?? 0) === age && (!flt || flt(id))).map((id) => defs[id]);
    const rows = [[tr('Yeni Binalar'), pick(BUILDINGS, (id) => offered.has(id))], [tr('Yeni Birlikler'), pick(UNITS)], [tr('Yeni Teknolojiler'), pick(TECHS)]].filter((r) => r[1].length);
    let body = '';
    if (rows.length) {
      body = '<div class="aurows">' + rows.map(([lab, list], ri) => `<div class="aurow" style="animation-delay:${(1.0 + ri * 0.35).toFixed(2)}s"><div class="aul">${lab}</div><div class="aui">${list.slice(0, 14).map((d, di) => `<span class="auit" style="animation-delay:${(1.15 + ri * 0.35 + di * 0.05).toFixed(2)}s"><i>${d.icon || '✦'}</i><em>${esc(tr(d.name))}</em></span>`).join('')}${list.length > 14 ? `<span class="aumore">+${list.length - 14}</span>` : ''}</div></div>`).join('') + '</div>';
    } else {
      body = `<ul>${(a.unlockText || []).map((x) => tr(x)).map((t, i) => `<li style="animation-delay:${1.1 + i * 0.25}s">${esc(t)}</li>`).join('')}</ul>`;
    }
    const o = el('div', 'ageup long age-' + age, `<div class="rays"></div><div class="lab">${tr('Yeni bir çağ başlıyor')}</div><div class="big">${esc(tr(a.name).toLocaleUpperCase(loc()))}</div>${body}<div class="auskip">${tr('Geçmek için tıkla')}</div>`);
    for (let i = 0; i < 36; i++) {
      const s = el('span', 'spark');
      s.style.left = Math.random() * 100 + '%';
      s.style.animationDuration = 2 + Math.random() * 2.5 + 's';
      s.style.animationDelay = Math.random() * 3.5 + 's';
      o.append(s);
    }
    const close = () => { if (o._gone) return; o._gone = true; o.classList.add('out'); setTimeout(() => { o.remove(); if (this.ageUpEl === o) this.ageUpEl = null; }, 320); };
    o.addEventListener('mousedown', (ev) => { ev.stopPropagation(); close(); });
    this.root.append(o); this.ageUpEl = o;
    setTimeout(close, 6400);
  }

  // ------------------------------------------------------------------ multiplayer
  _myTeamPlayers() { const g = this.game, me = this._me(); return (g?.players || []).map((p, i) => (p.id ?? i)).filter((id) => this._ally(me, id)); }
  _winTeam() {
    const g = this.game; if (!g) return null;
    const ov = g.over || {}; const t = ov.winnerTeam ?? ov.winningTeam ?? ov.team;
    if (t != null) return t;
    const alive = new Set((g.players || []).map((p, i) => (p.defeated || p.left ? null : this._teamOf(p.id ?? i))).filter((x) => x != null));
    return alive.size === 1 ? [...alive][0] : null;
  }
  _mpWon(fallback) {
    const wt = this._winTeam();
    if (wt != null) return wt === this._teamOf(this._me());
    return !!fallback;
  }
  // the multiplayer name IS the profile name (src/profile.js keeps 'aevum.mpName' in sync)
  _mpName() { return safe(() => this.app.getProfile()?.name, '') || safe(() => localStorage.getItem('aevum.mpName'), '') || ''; }
  _mpUid() { return safe(() => this.app.getProfile()?.uid, null) || null; }
  // -> the stored name, or null (invalid: toasts why and keeps the old one)
  _setMpName(v) {
    const r = safe(() => this.app.renameProfile(v), null);
    if (r && r.ok) return r.profile.name;
    this.toast((r && r.error) || tr('Ad kaydedilemedi'), 'warn');
    return null;
  }
  // a NetSession under this account's verified identity (the relay checks the Google session: srv/identity.mjs)
  async _mpSession() {
    const cloud = this.app.cloud;
    if (!cloud || !cloud.loggedIn) throw new Error(tr('Çok oyunculu için Google ile giriş gerekli.'));
    let t;
    try { t = await cloud.relayTicket(); } catch (e) { throw new Error(tr('Kimliğin oyun sunucusunda doğrulanamadı: ') + (e?.message || e)); }
    // the build id (src/net/notice.js): a tab on old files must not play with new ones (that desyncs); the host
    // refuses joiners with another one (src/net/session.js)
    const notice = this.app.notice;
    if (notice) await notice.baseVer(3000);
    if (notice && (notice.stale() || (await notice.poll(), notice.stale()))) throw new Error(STALE_TEXT);
    const ver = notice ? notice.base : null;
    const { NetSession } = await import('../net/session.js');
    return NetSession.create('auto', { name: t.ident.name, uid: t.ident.uid, ident: t.ident, ver, ticket: (fresh) => cloud.relayTicket(fresh).then((x) => x.ticket) });
  }
  _menuMulti(errText) {
    if (!this._signedIn()) { this._menuMain(); return; }
    const box = this._menuBox(tr('<h2>Çok Oyunculu</h2><div class="mpnote">Bir oda kur, sağdaki listeden çevrimiçi oyuncuları davet et; daveti kabul eden lobine girer. Aynı takımda ya da karşı takımlarda oynayın, yapay zekâ rakipleri istediğin takıma ekle.</div>'));
    const p = safe(() => this.app.getProfile(), null);
    const who = el('div', 'mp-who');
    who.append(avatarEl(p?.avatar, p?.uid, 'av-sm'));
    const wn = el('span', 'mp-who-name'); wn.textContent = p?.name || ''; who.append(wn);
    const wt = el('span', 'acc-tp'); wt.textContent = tpText(safe(() => this.app.cloud.tp.tp, 0)); who.append(wt);
    const wh = el('small', 'prof-dim'); wh.textContent = tr('Lobide bu adla görünürsün (Profil ekranından değiştirilir).'); who.append(wh);
    box.append(who);
    const err = el('div', 'mperr' + (errText ? '' : ' hidden'), esc(errText || '')); box.append(err);
    const fail = (e) => { err.textContent = tr('Bağlantı hatası: ') + (e?.message || e || 'bilinmiyor'); err.classList.remove('hidden'); busy(false); };
    const btns = [];
    const busy = (b) => btns.forEach((x) => { x.disabled = b; });
    const go = async (code) => {
      err.classList.add('hidden'); busy(true);
      try {
        const s = await this._mpSession();
        if (code) await s.join(code); else await s.host();
        this.showLobby(s);
      } catch (e) { fail(e); }
    };
    btns.push(this._mbtn(box, tr('Oda Kur'), () => go(null), 'primary'));
    this._mbtn(box, tr('Arkadaşlar · Davet Et'), () => import('./friends-ui.js').then((m) => m.menuFriends(this)));
    // continue a saved multiplayer match (src/ui/mp-resume.js)
    btns.push(this._mbtn(box, tr('Kayıtlı Maça Devam Et'), () => {
      import('./mp-resume.js').then((m) => m.menuResume(this)).catch((e) => fail(e));
    }));
    this._mpRooms(box, go, btns);
    this._mbtn(box, tr('Geri'), () => this._menuMain());
    this._onlinePanel(box);
  }
  // the open rooms (server.js /mp/rooms: still in their lobby, not full), each with Katıl (the join-by-code flow);
  // refreshed every few seconds while this menu is on screen
  _mpRooms(box, go, btns) {
    const cloud = this.app.cloud;
    if (!cloud?.openRooms) return;
    const wrap = el('div', 'mp-rooms');
    const head = el('div', 'op-head'), count = el('span', 'op-count', '…');
    head.append(el('span', 'op-title', tr('Açık Odalar')), count);
    const list = el('div', 'op-list');
    list.textContent = tr('Yükleniyor...');
    list.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });
    wrap.append(head, list); box.append(wrap);
    const SIZE_TR = { 192: tr('Minik'), 256: tr('Küçük'), 320: tr('Orta'), 384: tr('Büyük'), 448: tr('Çok Büyük'), 512: tr('Dev') };
    let rooms = null;
    const draw = () => {
      count.textContent = String(rooms.length);
      list.textContent = '';
      if (!rooms.length) { list.append(el('div', 'prof-dim op-empty', tr('Şu an açık oda yok. Bir oda kur, burada herkese görünsün.'))); return; }
      for (const rm of rooms) {
        const r = el('div', 'op-row');
        const av = el('span', 'fr-av'); av.append(avatarEl(rm.av, rm.uid, 'av-sm'));
        const t = el('span', 'fr-txt'), nm = el('b', 'fr-name'), sub = el('small', 'fr-sub');
        nm.textContent = (rm.host || tr('Oyuncu')) + ' · ' + rm.code;
        sub.textContent = (rm.n | 0) + ' oyuncu · ' + (rm.slots | 0) + '/' + (rm.max | 0) + ' yer' + (rm.map ? ' · ' + (MAP_TYPE_TR[rm.map] || rm.map) : '') + (SIZE_TR[rm.size] ? ' · ' + SIZE_TR[rm.size] : '');
        t.append(nm, sub); r.append(av, t);
        const b = el('button', 'mbtn small op-inv', tr('Katıl')); b.type = 'button';
        b.disabled = !!btns[0]?.disabled;
        b.title = rm.code + tr(' odasına katıl');
        b.onclick = () => { this._click(); go(rm.code); };
        btns.push(b); r.append(b); list.append(r);
      }
    };
    const load = async () => {
      let got;
      try { got = (await cloud.openRooms()).rooms; } catch (e) { if (!rooms) { list.textContent = String(e?.message || e); count.textContent = '-'; } return; }
      if (!wrap.isConnected) return;
      for (let i = btns.length - 1; i >= 0; i--) if (!btns[i].isConnected || btns[i].closest('.mp-rooms') === wrap) btns.splice(i, 1);
      rooms = got; draw();
    };
    load();
    const timer = setInterval(() => { if (!wrap.isConnected) { clearInterval(timer); return; } load(); }, 4000);
  }
  // the online players list on the right (src/ui/online-ui.js), next to this menu box while it is shown
  _onlinePanel(box) {
    // (owner 2026-11-20: one block, not two panels far apart) the box and the list side by side, same height
    import('./online-ui.js').then((m) => {
      if (!box.isConnected || this.menuEl.querySelector('.online-panel')) return;
      const wrap = el('div', 'mp-wrap'); box.replaceWith(wrap); wrap.append(box, m.onlinePanel(this));
    }).catch((e) => console.warn(e));
  }
  showLobby(session) {
    // a continued (saved) match has its own lobby
    if (session?.state?.resume) { this.lobbySession = session; import('./mp-resume.js').then((m) => m.showResumeLobby(this, session)).catch((e) => this._menuMulti(String(e?.message || e))); return; }
    this.mode = 'menu';
    this.menuEl.classList.remove('hidden'); this.hudEl.classList.add('hidden');
    this.lobbySession = session;
    const box = this._menuBox('');
    box.classList.add('lobby');
    const myPeer = () => session.transport?.id ?? session.peerId ?? session.id;
    let state = session.state || session.lobby || null, left = false;
    const chatLog = [];
    const head = el('div', 'lb-head');
    const body = el('div', 'lb-body');
    const chat = el('div', 'lb-chat', '<div class="lb-log"></div>');
    const ci = el('input', 'mpinput'); ci.placeholder = tr('Mesaj yaz, Enter · @claude: hata / öneri bildir'); ci.maxLength = 160;
    chat.append(withMention(ci));
    const foot = el('div', 'lb-foot');
    // online friends with "Davet Et" (the code below works as before)
    const inv = el('div', 'lb-invite-slot');
    import('./friends-ui.js').then((m) => { if (this.lobbySession === session) inv.append(m.lobbyInvites(this, session)); }).catch(() => {});
    this._lobbyNoteEl = el('div', 'mperr prof-ok hidden');
    box.append(head, this._lobbyNoteEl, body, inv, chat, foot);
    const sendChat = (t) => { t = String(t || '').trim(); if (!t) return; safe(() => (session.chat || session.sendChat || session.say)?.call(session, t)); if (/@claude/i.test(t)) this._lobbyNote(tr('✔ Geri bildirimin geliştiriciye iletildi, teşekkürler!')); };
    ci.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') { sendChat(ci.value); ci.value = ''; } };
    const drawLog = () => { const l = chat.querySelector('.lb-log'); l.innerHTML = chatLog.slice(-40).map((m) => `<div><b>${esc(m.name || '?')}:</b> ${mention(esc(m.text))}</div>`).join(''); l.scrollTop = l.scrollHeight; };
    const call = (fn, ...a) => { this._click(); safe(() => { const r = session[fn]?.(...a); if (r?.catch) r.catch(() => {}); }); };
    const sel = (opts, val, onch, cls = '') => {
      const s = el('select', 'mpsel ' + cls);
      for (const [v, t] of opts) { const o = el('option', '', esc(t)); o.value = String(v); if (String(v) === String(val)) o.selected = true; s.append(o); }
      s.onchange = () => onch(s.value); s.onkeydown = (ev) => ev.stopPropagation(); return s;
    };
    const TEAMS = [1, 2, 3, 4].map((t) => [t, tr('Takım ') + t]);
    const DIFF = [['easy', tr('Kolay')], ['normal', tr('Normal')], ['hard', tr('Zor')]];
    // the host re-broadcasts the lobby every 2 s: only rebuild when it changed, and keep the
    // "add AI" picks and a half-typed name across rebuilds
    let aTeam = 2, aDiff = 'normal', lastKey = null, nameDraft = null;
    const render = () => {
      if (left || this.lobbySession !== session) return;
      const st = state || {}, slots = st.slots || [], me = myPeer();
      let key = null; try { key = JSON.stringify([st, me, session.isHost]); } catch (e) { /* ignore */ }
      if (key != null && key === lastKey) return;
      lastKey = key;
      const nmFocused = !!(document.activeElement && document.activeElement.classList?.contains('lb-myname'));
      const host = session.isHost ?? (st.hostPeer != null && st.hostPeer === me);
      head.innerHTML = tr('<h2>Lobi</h2><div class="lb-hint">Sağdaki listeden çevrimiçi oyuncuları davet et; daveti kabul eden lobine girer.</div>');
      body.innerHTML = '';
      const list = el('div', 'lb-slots');
      slots.forEach((s, i) => {
        const mine = s.kind === 'human' && s.peer != null && s.peer === me;
        const row = el('div', 'lb-slot team' + (s.team || 1) + (mine ? ' mine' : ''));
        row.append(el('span', 'lb-sw', ''));
        row.lastChild.style.background = hex(PLAYER_COLORS[i] ?? 0xffffff);
        if (s.kind === 'human') row.append(avatarEl(s.av, s.uid, 'av-sm'));
        row.append(el('span', 'lb-name', esc(pn(s.name) || (s.kind === 'ai' ? tr('Yapay Zekâ') : tr('Oyuncu'))) + (s.peer && s.peer === st.hostPeer ? ' <small>' + ico('x-crown') + '</small>' : '') + (mine ? ' <small>' + tr('(sen)') + '</small>' : '')));
        if (s.kind === 'human' && s.tp != null) row.append(el('span', 'lb-tp', tr('Sv ') + levelOf(s.tp).level + ' · ' + esc(tpText(s.tp))));
        row.append(el('span', 'lb-kind ' + s.kind, s.kind === 'ai' ? tr('Yapay Zekâ') : tr('İnsan')));
        const canTeam = mine || (host && s.kind === 'ai');
        if (canTeam) row.append(sel(TEAMS, s.team || 1, (v) => (mine ? call('setTeam', +v) : call('setSlot', i, { team: +v })), 'lb-team'));
        else row.append(el('span', 'lb-teamtag', tr('Takım ') + esc(s.team || 1)));
        if (s.kind === 'ai') {
          if (host) row.append(sel(DIFF, s.difficulty || 'normal', (v) => call('setSlot', i, { difficulty: v })));
          else row.append(el('span', 'lb-teamtag', (DIFF.find((d) => d[0] === s.difficulty) || DIFF[1])[1]));
          if (host) { const rm = el('button', 'lb-x', '✕'); rm.title = tr('Kaldır'); rm.onclick = () => call('removeSlot', i); row.append(rm); }
        } else {
          row.append(el('span', 'lb-ready' + (s.ready ? ' on' : ''), s.ready ? tr('✔ Hazır') : tr('Bekliyor')));
        }
        list.append(row);
      });
      body.append(list);
      if (host) {
        const add = el('div', 'lb-add');
        add.append(el('span', '', tr('Yapay zekâ ekle:')), sel(TEAMS, aTeam, (v) => { aTeam = +v; }), sel(DIFF, aDiff, (v) => { aDiff = v; }));
        const ab = el('button', 'mbtn small', tr('+ Ekle')); ab.disabled = slots.length >= 8;
        ab.onclick = () => call('addAI', aTeam, aDiff); add.append(ab); body.append(add);
        const sets = st.settings || {}, sg = el('div', 'lb-settings');
        body.append(this._lobbyMap(sets, slots.length, (t) => call('setSettings', { mapType: t })));
        const srow = (lab, node) => { const r = el('div', 'frow', `<label>${lab}</label>`); r.append(node); sg.append(r); };
        srow(tr('Harita Boyutu'), sel([[192, tr('Minik')], [256, tr('Küçük')], [320, tr('Orta')], [384, tr('Büyük')], [448, tr('Çok Büyük')], [512, tr('Dev')]], sets.mapSize ?? 320, (v) => call('setSettings', { mapSize: +v })));
        srow(tr('İklim'), sel(CLIMATE_OPTS, sets.climate ?? 'random', (v) => call('setSettings', { climate: v })));
        srow(tr('Başlangıç Kaynakları'), sel([['low', tr('Düşük')], ['normal', tr('Normal')], ['high', tr('Yüksek')]], sets.startRes ?? 'normal', (v) => call('setSettings', { startRes: v })));
        srow(tr('Başlangıç Çağı'), sel(AGES.map((a, j) => [j, tr(a.name)]), sets.startAge ?? 0, (v) => call('setSettings', { startAge: +v })));
        srow(tr('Harita'), sel([['explored', tr('Keşfedilmiş')], ['dark', tr('Karanlık')]], sets.fog ?? 'explored', (v) => call('setSettings', { fog: v })));
        srow(tr('Oda Listesi'), sel([['1', tr('Herkese açık')], ['0', tr('Sadece davetle')]], st.listed === false ? '0' : '1', (v) => call('setListed', v === '1')));
        body.append(sg);
      } else {
        const sets = st.settings || {};
        body.append(this._lobbyMap(sets, slots.length, null));
        body.append(el('div', 'lb-hint', `${tr('Harita:')} ${esc(({ 192: tr('Minik'), 256: tr('Küçük'), 320: tr('Orta'), 384: tr('Büyük'), 448: tr('Çok Büyük'), 512: tr('Dev') })[sets.mapSize] || sets.mapSize || '-')} · ${tr('Tür:')} ${MAP_TYPE_TR[sets.mapType || 'river'] || '-'} · ${tr('İklim:')} ${(CLIMATE_OPTS.find((c) => c[0] === (sets.climate || 'random')) || CLIMATE_OPTS[0])[1]} · ${tr('Kaynak:')} ${({ low: tr('Düşük'), normal: tr('Normal'), high: tr('Yüksek') })[sets.startRes] || '-'} · ${tr('Çağ:')} ${tr(AGES[sets.startAge ?? 0]?.name) || '-'}`));
      }
      foot.innerHTML = '';
      const mySlot = slots.find((s) => s.kind === 'human' && s.peer === me);
      if (!session.verified) {
        // (only an unverified transport lets the name be typed here; with the relay the account's name is used)
        const nm = el('input', 'mpinput lb-myname'); nm.maxLength = 20; nm.value = mySlot?.name || this._mpName();
        nm.onkeydown = (ev) => { ev.stopPropagation(); if (ev.key === 'Enter') nm.blur(); };
        nm.oninput = () => { nameDraft = nm.value; };
        nm.onchange = () => { nameDraft = null; const v = nm.value.trim(); if (!v || v === mySlot?.name) return; const n = this._setMpName(v); if (!n) { nm.value = mySlot?.name || this._mpName(); return; } nm.value = n; call('setName', n); };
        foot.append(nm);
        if (nmFocused) { if (nameDraft != null) nm.value = nameDraft; nm.focus(); }
      }
      const rd = el('button', 'mbtn small' + (mySlot?.ready ? ' on' : ''), mySlot?.ready ? tr('✔ Hazırım') : tr('Hazırım'));
      rd.onclick = () => call('setReady', !mySlot?.ready); foot.append(rd);
      if (host) {
        const humans = slots.filter((s) => s.kind === 'human'), teams = new Set(slots.map((s) => s.team || 1));
        const okStart = humans.length > 0 && humans.every((s) => s.ready) && teams.size >= 2;
        const sb = el('button', 'mbtn small primary', tr('Başlat')); sb.disabled = !okStart;
        sb.title = okStart ? '' : tr('Herkes hazır olmalı ve en az iki farklı takım bulunmalı');
        sb.onclick = () => call('start'); foot.append(sb);
      }
      const lv = el('button', 'mbtn small', tr('Ayrıl'));
      lv.onclick = () => { this._click(); left = true; this.lobbySession = null; safe(() => session.close?.()); this._menuMulti(); };
      foot.append(lv);
    };
    const on = (n, fn) => safe(() => session.on?.(n, (p) => { if (!left) safe(() => fn(p || {})); }));
    on('lobby', (s) => { state = s; if (this.lobbySession === session && this.mode === 'menu') render(); });
    on('chat', (m) => { chatLog.push(m); if (this.lobbySession === session && this.mode === 'menu') drawLog(); else if (this.app.net === session) this._chatPush(m); });
    on('start', (p) => { if (this.lobbySession !== session) return; this.lobbySession = null; safe(() => this.app.startMultiplayer?.(session, p.cfg)); });
    // in-game stall / resume / desync / peerLeft banners are routed by app.startMultiplayer (main.js)
    on('closed', () => { if (this.lobbySession === session) { this.lobbySession = null; this._menuMulti(tr('Bağlantı kapandı.')); } else if (this.app.net === session) this.toast(tr('⚠ Ağ bağlantısı kapandı'), 'warn'); });
    render(); drawLog();
    this._onlinePanel(box);
  }
  // a green line at the top of the lobby (e.g. "X davet edildi")
  _lobbyNote(text) { const n = this._lobbyNoteEl; if (!n || !n.isConnected) return; n.textContent = String(text || ''); n.classList.toggle('hidden', !text); }
  // a friend invited us into his room: a card with Katıl / Reddet (src/ui/friends-ui.js)
  showInvite(m) { import('./friends-ui.js').then((x) => x.showInvite(this, m)).catch((e) => console.warn(e)); }
  netStatus(st) {
    st = st || {};
    if (st.type === 'resume') { if (this.netEl) { this.netEl.remove(); this.netEl = null; } return; }
    if (st.type === 'chat') return;   // chat is toasted by the lobby session's 'chat' handler
    if (st.type === 'peerLeft' || st.type === 'desync') { this.toast((st.type === 'desync' ? '⚠ ' : '👋 ') + (st.text || ''), 'warn'); if (st.type === 'peerLeft') return; }
    if (!this.netEl) { this.netEl = el('div', 'netbanner panel'); this.root.append(this.netEl); }
    this.netEl.className = 'netbanner panel ' + (st.type || '');
    this.netEl.textContent = st.text || tr('Bekleniyor…');
    if (st.type === 'desync' && st.sticky) this.netEl.classList.add('sticky');
    else if (st.type === 'desync') { const n = this.netEl; setTimeout(() => { if (this.netEl === n) { n.remove(); this.netEl = null; } }, 6000); }
  }
  // ------------------------------------------------------------------ in-game chat (multiplayer; single player: @claude feedback only)
  _chatAllowed() { return this.mode === 'hud' && (!!this.app.net || (!!this.game && !this.app.demo)); }
  _chatKey() { return this.app.net || this.game || null; }
  // Docked at the left edge between the scoreboard and the minimap. Closed: the last <=6 lines float
  // there and fade ~12 s after arriving. Open (Enter / 💬): glass panel with the whole match history + input.
  _chatEnsure() {
    if (!this.app.net && !(this.game && !this.app.demo)) return null;
    if (!this.chatDock) {
      const d = el('div', 'chatdock hidden');
      const head = el('div', 'chathead');
      const tg = el('button', 'chattoggle', '💬<span class="chatbadge hidden"></span>');
      tg.title = tr('Sohbet (Enter)');
      tg.onmousedown = (ev) => ev.preventDefault();   // keep focus in the input while open
      tg.onclick = () => { this._click(); if (this.chatOpen) this.closeChat(); else this.openChat(); };
      // (no download button any more, 2026-11-17: the logs are read from Firestore, tools/read-chatlog.mjs)
      head.append(tg, el('span', 'chattitle', tr('Sohbet · Enter: gönder · Esc: kapat')));
      const feed = el('div', 'chatfeed', '<div class="cspacer"></div>');
      const row = el('div', 'chatin');
      const i = el('input', 'mpinput'); i.maxLength = 200; i.placeholder = tr('Mesaj yaz… (@claude: hata / öneri bildir)'); i.autocomplete = 'off'; i.spellcheck = false;
      row.append(withMention(i));
      d.append(head, feed, row);
      const stop = (ev) => ev.stopPropagation();
      i.addEventListener('keyup', stop); i.addEventListener('keypress', stop);
      i.onkeydown = (ev) => {
        ev.stopPropagation();
        if (ev.key === 'Enter') {
          ev.preventDefault();
          const t = i.value.trim().slice(0, 200);
          if (!t) { this.closeChat(); return; }
          if (this._chatSend(t)) i.value = '';
        } else if (ev.key === 'Escape') { ev.preventDefault(); this.closeChat(); }
      };
      i.onblur = () => setTimeout(() => { if (this.chatOpen && document.activeElement !== i && !this._chatHover) this.closeChat(); }, 150);
      d.onmouseenter = () => { this._chatHover = true; };
      d.onmouseleave = () => { this._chatHover = false; if (this.chatOpen && document.activeElement !== i) this.closeChat(); };
      d.addEventListener('wheel', (ev) => ev.stopPropagation(), { passive: true });
      window.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' && this.chatOpen && document.activeElement !== i) this.closeChat(); }, true);
      this.hudEl.append(d);
      Object.assign(this, { chatDock: d, chatFeed: feed, chatInput: i, chatBadge: tg.querySelector('.chatbadge') });
      this.chatOpen = false; this.chatUnread = 0;
    }
    if (this._chatSess !== this._chatKey()) this._chatReset();
    return this.chatDock;
  }
  _chatReset() {
    this._chatSess = this._chatKey(); this.chatLog = []; this.chatUnread = 0;
    if (this.chatFeed) this.chatFeed.innerHTML = '<div class="cspacer"></div>';
    this._chatBadge();
    if (this.chatFeed) this._chatPush({ sys: true, text: tr('💬 Hata ya da önerin mi var? Enter ile sohbeti aç, @claude yazıp gönder; geliştiriciye gider.') });
  }
  // a line typed into the chat -> true when it was sent. Multiplayer: to everyone in the room. Single player: only
  // @claude lines go anywhere (the cloud chat log, read with tools/read-chatlog.mjs --claude)
  _chatSend(t) {
    const s = this.app.net, fb = /@claude/i.test(t);
    if (s) safe(() => (s.chat || s.sendChat || s.say)?.call(s, t));
    else if (fb) {
      this._chatPush({ mine: true, text: t });
      safe(() => logChat({ room: 'TEK', name: this._mpName() || '?', text: t, mine: true }));
    } else { this._chatPush({ sys: true, text: tr('Tek oyunculu oyunda sohbet geri bildirim içindir: mesajının başına @claude yaz.') }); return false; }
    if (fb) setTimeout(() => this._chatPush({ sys: true, text: tr('✔ Geri bildirimin geliştiriciye iletildi, teşekkürler!') }), 300);
    return true;
  }
  _chatBadge() {
    const b = this.chatBadge; if (!b) return;
    b.textContent = this.chatUnread > 9 ? '9+' : String(this.chatUnread || '');
    b.classList.toggle('hidden', !this.chatUnread);
  }
  // m: { from, name, text } from the session's 'chat' event, or { sys: true, text }
  _chatPush(m) {
    if (!m || !this._chatEnsure()) return;
    const s = this.app.net, g = this.game;
    const mine = !m.sys && (!!m.mine || (m.from != null && m.from === safe(() => s.id)));
    let pid = mine ? this._me() : safe(() => s.pidOf?.get(m.from));
    const p = pid != null ? g?.players?.[pid] : null;
    const line = el('div', 'cl' + (m.sys ? ' sys' : '') + (mine ? ' mine' : '') + ' new live');
    line.append(el('span', 'ct'));
    line.firstChild.textContent = fmtTime(g?.time || 0);
    if (!m.sys) {
      const n = el('b', 'cn'); n.textContent = (mine ? tr('Sen') : (m.name || (pid != null ? this._pname(pid) : '?'))) + ':';
      const col = p?.color ?? (pid != null ? PLAYER_COLORS[pid] : null);
      if (col != null) n.style.color = typeof col === 'number' ? hex(col) : String(col);
      line.append(n);
    }
    const tx = el('span', 'cx');
    for (const part of String(m.text || '').slice(0, 200).split(/(@claude)/i)) {
      if (/^@claude$/i.test(part)) tx.append(el('span', 'cmention', '@claude')); else if (part) tx.append(document.createTextNode(part));
    }
    line.append(tx);
    const f = this.chatFeed, nearBottom = f.scrollHeight - f.scrollTop - f.clientHeight < 40;
    f.append(line);
    const item = { at: performance.now(), el: line };
    this.chatLog.push(item);
    while (this.chatLog.length > 250) { const o = this.chatLog.shift(); o.el.remove(); }
    setTimeout(() => line.classList.remove('new'), 1400);
    if (!this.chatOpen || nearBottom) f.scrollTop = f.scrollHeight;
    if (!mine && !m.sys) {
      safe(() => this.app.audio?.ui('chat'));
      if (!this.chatOpen) { this.chatUnread++; this._chatBadge(); }
    }
    this._chatTick();
  }
  _chatSys(text) { if (this.app.net && text) safe(() => this._chatPush({ sys: true, text })); }
  _chatTick() {
    const on = this._chatAllowed();
    if (on && !this.chatDock) this._chatEnsure();
    const d = this.chatDock; if (!d) return;
    d.classList.toggle('hidden', !on);
    if (!on) { if (this.chatOpen) this.closeChat(); return; }
    if (this._chatSess !== this._chatKey()) this._chatReset();
    // start right below the multiplayer scoreboard (top-left), never under it
    const sb = this.scoreEl && !this.scoreEl.classList.contains('hidden') ? this.scoreEl.getBoundingClientRect() : null;
    const qb = this.questsEl && !this.questsEl.classList.contains('hidden') ? this.questsEl.getBoundingClientRect() : null;
    const top = Math.round(Math.max(sb && sb.height ? sb.bottom : 48, qb && qb.height ? qb.bottom : 0) + 10);
    if (top !== this._chatTop) { this._chatTop = top; d.style.setProperty('--chat-top', top + 'px'); }
    const now = performance.now(), L = this.chatLog || [];
    let shown = 0;
    for (let k = L.length - 1; k >= 0; k--) {
      const it = L[k], age = now - it.at, vis = shown < 6 && age < 12000;
      if (vis) shown++;
      it.el.classList.toggle('live', vis); it.el.classList.toggle('fading', vis && age > 10800);
      if (age >= 12000) break;   // everything older has already aged out
    }
  }
  openChat() {
    if (!this._chatAllowed() || !this._chatEnsure()) return false;
    const d = this.chatDock;
    d.classList.remove('hidden');
    if (!this.chatOpen) {
      this.chatOpen = true; d.classList.add('open');
      this.chatUnread = 0; this._chatBadge();
      this.chatFeed.scrollTop = this.chatFeed.scrollHeight;
    }
    this.chatInput?.focus();   // synchronously: keys typed right after Enter must land in the input, not the game
    this.chatFeed.scrollTop = this.chatFeed.scrollHeight;
    return true;
  }
  closeChat() {
    if (!this.chatDock) return;
    this.chatOpen = false; this.chatDock.classList.remove('open');
    if (document.activeElement === this.chatInput) this.chatInput.blur();
    this._chatTick();
  }
  _refreshScore() {
    const g = this.game;
    if (!this.app.net || !g?.mp) { if (this.scoreEl) this.scoreEl.classList.add('hidden'); return; }
    if (!this.scoreEl) { this.scoreEl = el('div', 'scoreboard panel'); this.hudEl.append(this.scoreEl); }
    this.scoreEl.classList.remove('hidden');
    const me = this._me();
    const rows = (g.players || []).map((p, i) => ({ p, id: p.id ?? i })).sort((a, b) => this._teamOf(a.id) - this._teamOf(b.id) || a.id - b.id);
    let h = '';
    for (const { p, id } of rows) {
      const ally = this._ally(me, id), you = id === me;
      const res = ally && !you ? `<span class="sbres">${RES_LIST.map((r) => `${RES_ICON[r]}${Math.floor(p.res?.[r] || 0)}`).join(' ')}</span>` : '';
      h += `<div class="sbrow${you ? ' you' : ally ? ' ally' : ''}${p.defeated || p.left ? ' out' : ''}"><span class="dot" style="background:${hex(PLAYER_COLORS[id] ?? 0xffffff)}"></span><span class="sbn">${esc(this._pname(id))}${p.kind === 'ai' ? ' 🤖' : ''}${p.defeated ? ' ☠' : p.left ? ' ⏏' : ''}</span><span class="sbt team${this._teamOf(id)}">T${this._teamOf(id)}</span><span class="sba">${esc((tr(AGES[p.age]?.name) || '').split(' ')[0])}</span>${res}</div>`;
    }
    if (h !== this.scoreSig) { this.scoreSig = h; this.scoreEl.innerHTML = h; }
  }
}
