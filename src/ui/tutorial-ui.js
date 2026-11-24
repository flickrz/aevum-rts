// Tutorial mode, view side: the guide's story panel, gold highlights on the card / HUD, the camera and selection
// watch of chapter 1, the marker pulses, the camera look towards the rival in chapter 5 and the tutorial's end
// screen. The rules live in sim/tutorial.js; this only reads game.quests.s and reports UI facts through ack().
import { UNITS, BUILDINGS } from '../data.js';
import { TUT_CFG, SPEAKER } from '../sim/tutorial.js';
import { tr } from '../i18n.js';

const CAT_NAMES = { eco: tr('İnşa: Ekonomi'), mil: tr('İnşa: Askeri'), def: tr('İnşa: Savunma') };
const STANCE_NAMES = { aggressive: tr('Saldırgan'), defensive: tr('Savunma'), hold: tr('Mevzi Koru') };
const INFO_MS = 6000;      // an info line (Aferin, raid warning) closes by itself after this long
const MARKER_MS = 2500;    // chapter 2: a ground pulse on the marker this often
const GOLD = 0xffd84a;

const fmtTime = (s) => { s = Math.max(0, Math.floor(s)); const m = Math.floor(s / 60); return (m < 10 ? '0' : '') + m + ':' + String(s % 60).padStart(2, '0'); };   // (same as ui.js)
const mk = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export class TutorialUI {
  constructor(ui, game) {
    this.ui = ui; this.app = ui.app; this.game = game;
    this.msgSeq = 0; this.hintSeq = 0; this.page = 0; this.lines = []; this.kind = null; this.infoT = 0;
    this.cam0 = null; this.markerT = 0; this.pan = null; this.panned = -1; this.hlNodes = [];
    const p = this.el = mk('div', 'panel tut-story hidden');
    p.append(mk('h4', null, SPEAKER), this.lineEl = mk('div', 'tl'), this.hintEl = mk('div', 'th'));
    const row = mk('div', 'tb');
    this.pageEl = mk('span', 'tp');
    this.btn = mk('button', 'mbtn small primary', tr('Devam'));
    this.btn.onclick = () => { this.ui._click?.(); this._next(); };
    row.append(this.pageEl, this.btn); p.append(row);
    // (the panel must not take the clicks meant for the map under it, but its button must work)
    p.addEventListener('mousedown', (e) => e.stopPropagation());
    ui.hudEl.append(p);
  }
  get tq() { const q = this.game && this.game.quests; return q && q.tutorial ? q : null; }
  get live() { return this.app.game === this.game && !this.app.demo; }
  destroy() { this._clearHl(); this.el.remove(); this.pan = null; }

  // ---- story panel
  _show(kind, lines) {
    this.kind = kind; this.lines = lines || []; this.page = 0; this.infoT = performance.now();
    this.hintEl.textContent = ''; this.hintEl.classList.add('hidden'); this.lineEl.classList.remove('hidden');
    this._renderPage();
    this.el.classList.remove('hidden');
  }
  _renderPage() {
    this.lineEl.textContent = this.lines[this.page] || '';
    const n = this.lines.length;
    this.pageEl.textContent = n > 1 ? (this.page + 1) + '/' + n : '';
    this.btn.textContent = this.kind === 'hint' || this.kind === 'info' ? tr('Tamam') : tr('Devam');
    if (this.kind === 'info' && this.page < n - 1) this.btn.textContent = 'Devam';
  }
  _next() {
    if (this.page < this.lines.length - 1) { this.page++; this._renderPage(); return; }
    const kind = this.kind;
    this.el.classList.add('hidden'); this.kind = null;
    if (kind === 'intro' || kind === 'end') this.tq?.ack('go');
  }
  _hint(h) {
    // a smaller line under the panel's heading; it does not replace unread story lines
    if (this.kind === 'intro' || this.kind === 'end') return;
    this.kind = 'hint'; this.lines = [];
    this.lineEl.classList.add('hidden'); this.hintEl.classList.remove('hidden');
    this.hintEl.textContent = h.text; this.pageEl.textContent = ''; this.btn.textContent = tr('Tamam');
    this.el.classList.remove('hidden');
    if (h.x != null && h.z != null) { this._ping(h.x, h.z); this.ui.toast?.(tr('Bilge Ayaz bir yer gösterdi. Gitmek için tıkla.'),'info', h.x, h.z); }
  }
  // (several pings at once - the gather chapter points at three resources - play the flare sound once)
  _ping(x, z) {
    const now = performance.now(), quiet = now - (this._pingAt || 0) < 400; this._pingAt = now;
    const A = this.ui.app && this.ui.app.audio, old = A && A.ui;
    try { if (quiet && A) A.ui = () => null; this.ui.showFlare?.({ pid: 0, x, z, mine: true }); } catch (err) { /* view only */ } finally { if (quiet && A) A.ui = old; }
  }

  // ---- highlights (re-applied after every command card render: the card rebuilds its buttons)
  _clearHl() { for (const n of this.hlNodes) n.classList.remove('tut-hl'); this.hlNodes = []; }
  applyHl() {
    const tq = this.tq; this._clearHl();
    if (!tq || !this.live) return;
    const s = tq.s, ch = tq.chapter;
    if (!ch || (s.phase !== 'story' && s.phase !== 'play')) return;
    const add = (n) => { if (n) { n.classList.add('tut-hl'); this.hlNodes.push(n); } };
    for (const k of ch.hl || []) {
      const [a, b] = k.split(':');
      if (a === 'idle') add(this.ui.idleEl);
      else if (a === 'grp') add(this.ui.grpEl);
      else {
        if (a === 'age') add(this.ui.ageBtn);   // (the age-up button of the next age box, bottom left)
        const name = a === 'cat' ? CAT_NAMES[b] : a === 'b' ? tr(BUILDINGS[b]?.name || '') : a === 'u' ? tr(UNITS[b]?.name || '') : a === 'st' ? STANCE_NAMES[b] : null;
        for (const btn of this.ui.buttons || []) {
          if (!btn || !btn.spec) continue;
          const nm = String(btn.spec.name || '');
          if ((name && nm === name) || (a === 'age' && (nm.startsWith('Çağ Atla') || nm.startsWith(tr('Çağ Atla')))) || (a === 'form' && (nm.startsWith('Diziliş') || nm.startsWith(tr('Diziliş'))))) add(btn.node);
        }
      }
    }
  }

  // ---- every UI refresh (about 8 times a second)
  tick() {
    const tq = this.tq; if (!tq || !this.live) { this.el.classList.add('hidden'); return; }
    const s = tq.s, g = this.game;
    if (g.over) { this.el.classList.add('hidden'); this._clearHl(); return; }   // (the end screen takes over)
    if (s.msg && s.msg.seq !== this.msgSeq) {
      this.msgSeq = s.msg.seq;
      this._show(s.msg.kind === 'lose' ? 'end' : s.msg.kind, s.msg.lines);
      for (const p of s.msg.pings || []) if (p) this._ping(p.x, p.z);
      if (s.msg.x != null && s.msg.z != null) this._ping(s.msg.x, s.msg.z);
    }
    if (s.hint && s.hint.seq !== this.hintSeq) { this.hintSeq = s.hint.seq; this._hint(s.hint); }
    if (this.kind === 'info' && performance.now() - this.infoT > INFO_MS) { this.el.classList.add('hidden'); this.kind = null; }
    // chapter 1: the camera moved 8 tiles / zoomed 6, and at least 5 own villagers are selected
    if (s.step === 0 && s.phase === 'play') {
      const cam = this.app.renderer?.cam;
      if (cam) {
        if (!this.cam0) this.cam0 = { tx: cam.tx, tz: cam.tz, dist: cam.dist };
        if (Math.hypot(cam.tx - this.cam0.tx, cam.tz - this.cam0.tz) >= 8 || Math.abs(cam.dist - this.cam0.dist) >= 6) tq.ack('cam');
      }
      const me = g.me | 0;
      const n = (this.app.selection || []).filter((id) => { const e = g.getEntity(id); return e && !e.dead && e.owner === me && e.type === 'villager'; }).length;
      if (n >= 5) tq.ack('sel');
    }
    // chapter 2: the marker pulses on the ground
    if (s.step === 1 && (s.phase === 'story' || s.phase === 'play') && s.ids.marker) {
      const now = performance.now();
      if (now - this.markerT > MARKER_MS) { this.markerT = now; try { this.app.renderer?.addMarker?.(s.ids.marker.x, s.ids.marker.z, GOLD); } catch (err) { /* view only */ } }
    }
    // chapter 5: a short look towards the rival's camp, then back (view only)
    if (tq.chapter && tq.chapter.pan && this.panned !== s.step && s.phase === 'story') {
      this.panned = s.step;
      const cam = this.app.renderer?.cam, e = g.getEntity(s.ids.enemyTc);
      if (cam && e) this.pan = { t: 0, ax: cam.tx, az: cam.tz, bx: cam.tx + (e.x - cam.tx) * 0.45, bz: cam.tz + (e.z - cam.tz) * 0.45 };
    }
    this.applyHl();
  }
  // every frame: the camera look of chapter 5
  frame(dt) {
    const P = this.pan; if (!P) return;
    const cam = this.app.renderer?.cam; if (!cam || !this.live) { this.pan = null; return; }
    P.t += dt;
    const ease = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };
    const f = P.t < 0.8 ? ease(P.t / 0.8) : P.t < 1.4 ? 1 : ease(1 - (P.t - 1.4) / 0.8);
    cam.tx = P.ax + (P.bx - P.ax) * f; cam.tz = P.az + (P.bz - P.az) * f;
    if (P.t >= 2.2) { cam.tx = P.ax; cam.tz = P.az; this.pan = null; }
  }

  // HUD objective line (ui _refreshSlow): the chapter's objective instead of the normal age steps
  objective(objEl) {
    const o = this.tq?.objective();
    if (!o) { objEl.classList.add('hidden'); return; }
    objEl.classList.remove('hidden');
    const steps = objEl.querySelector('.osteps'), ot = objEl.querySelector('.ot'), om = objEl.querySelector('.om'), bar = objEl.querySelector('.obar i');
    const cost = objEl.querySelector('.acost'); if (cost && cost.innerHTML) cost.innerHTML = '';   // (no age cost in the chapter line)
    const head = tr('Öğretici · Bölüm {0}/{1}', o.n, o.of) + ' · ' + o.title, txt = o.done ? '✔ ' + o.text : o.text, prog = o.done ? tr('Tamamlandı') : o.progress;
    if (steps.textContent !== head) steps.textContent = head;
    if (ot.textContent !== txt) ot.textContent = txt;
    if (om.textContent !== prog) om.textContent = prog;
    om.classList.toggle('ready', !!o.done);
    bar.style.width = (((o.n - 1) + (o.done ? 1 : 0)) / o.of * 100).toFixed(1) + '%';
  }

  // the tutorial's end screen (ui showGameOver): returns the modal panel to show
  gameOver(won) {
    const ui = this.ui;
    this.el.classList.add('hidden'); this._clearHl();
    const m = mk('div', 'modal panel');
    m.append(mk('h1', won ? 'win' : 'lose', won ? tr('ZAFER') : tr('YENİLGİ')));
    const d = mk('div', null, won ? tr('Öğretici tamamlandı! Artık gerçek bir maça hazırsın. · Süre: {0}', fmtTime(this.game.time || 0)) : tr('Şehir Merkezin düştü. Bilge Ayaz seni bekliyor: yeniden dene.'));
    d.style.color = 'var(--dim)'; m.append(d);
    const btn = (t, fn, cls = '') => { const b = mk('button', 'mbtn small ' + cls, t); b.onclick = () => { ui._click?.(); fn(); }; m.append(b); };
    const toMenu = () => { ui._closeModal(true); try { this.app.toMenu?.(); } catch (err) { /* ignore */ } ui.showMenu(); };
    if (won) {
      btn(tr('Ana Menü'), toMenu, 'primary');
      btn('Yeni Oyun Kur', () => { toMenu(); try { ui._menuSetup(); } catch (err) { /* ignore */ } });
    } else {
      btn(tr('Yeniden Başla'), () => { ui._closeModal(true); this.app.newGame({ ...TUT_CFG }); }, 'primary');
      btn(tr('Ana Menü'), toMenu);
    }
    return m;
  }
}
