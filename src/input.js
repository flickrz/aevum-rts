// Mouse / keyboard input: selection, commands, placement, camera.
import { BUILDINGS, UNITS } from './data.js';
import { RES_ICONS } from './icons.js';
import { MINE_CAP, NO_ROTATE } from './sim/game.js';
import { tr } from './i18n.js';
import { pickCursor, cursorCss } from './cursor.js';

const DRAG_PX = 5;
// (players 2026-11-22: "you have to push the mouse right to the edge to scroll") the edge zone is wider and the pan
// ramps up toward the very edge (EDGE_MIN of full speed at the zone's inner side)
const EDGE_PX = 18, EDGE_MIN = 0.35;
const TP_PAN = 0.0028;   // touchpad mode: world tiles per wheel pixel, per tile of camera distance
const PAN_FAST = 2.5;   // camera pan speed multiplier while Shift is held
const C_MOVE = 0x7dff7a, C_ATTACK = 0xff4a3d, C_GATHER = 0xffd84a, C_BUILD = 0x6ab8ff, C_RALLY = 0xffffff;

export class Input {
  constructor(app) {
    this.app = app;
    this.canvas = app.renderer.canvas || document.getElementById('game');
    this.placing = null;
    this.keys = new Set();
    this.mouse = { x: 0, y: 0, inside: false };
    this.drag = null;      // left button box select {x0,y0,active}
    this.rot = null;       // camera rotate {x,y} (Space / Shift+middle / Alt+middle)
    this.mpan = null;      // middle button drag pan {x,y}
    this.wallStart = null; // {tx,tz}
    this.groups = {};
    this.lastGroupTap = { n: -1, t: 0 };
    this.idleIdx = 0;
    this.shift = false;

    this.box = document.createElement('div');
    this.box.style.cssText = 'position:fixed;display:none;z-index:50;pointer-events:none;' +
      'border:1px solid #9dff8a;background:rgba(120,255,110,0.12);box-shadow:0 0 0 1px rgba(0,0,0,.5)';
    document.body.appendChild(this.box);
    // right-drag formation facing (BFME-style): a ghost arrow from the press point along the drag
    this.fline = document.createElement('div');
    this.fline.style.cssText = 'position:fixed;display:none;z-index:50;pointer-events:none;height:3px;transform-origin:0 50%;' +
      'background:rgba(120,255,110,0.85);box-shadow:0 0 0 1px rgba(0,0,0,.5)';
    this.fline.innerHTML = '<span style="position:absolute;right:-9px;top:-8px;color:#9dff8a;font-size:16px;line-height:18px;text-shadow:0 0 2px #000">▶</span>';
    document.body.appendChild(this.fline);

    const c = this.canvas;
    c.addEventListener('mousedown', e => this.onDown(e));
    window.addEventListener('mousemove', e => this.onMove(e));
    window.addEventListener('mouseup', e => this.onUp(e));
    c.addEventListener('dblclick', e => this.onDbl(e));
    c.addEventListener('wheel', e => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', e => e.preventDefault());
    c.addEventListener('auxclick', e => e.preventDefault());
    window.addEventListener('keydown', e => this.onKeyDown(e));
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code); this.shift = e.shiftKey;
      if (e.key === ' ' && this.rot && this.rot.space) {
        const tap = this.rot.moved < 4; this.rot = null;
        if (tap && this.app.lastAlert) this.app.focus(this.app.lastAlert.x, this.app.lastAlert.z);
      }
      // Shift released after Shift-placing several buildings: the placement tool stays (2026-11-17 playtest: "letting go
      // of Shift drops the building, you have to pick it from the list again"); the next plain click places the last
      // one and ends it, Esc / right click end it as before
      if (e.key === 'Shift' && this.shiftPlaced) this.shiftPlaced = false;
    });
    this._bindTouch(c);
    window.addEventListener('blur', () => { this.keys.clear(); this.shift = false; this.mouse.inside = false; this.endDrag(); this.rot = null; this.mpan = null; });
    document.addEventListener('mouseleave', () => { this.mouse.inside = false; });
    // only trust "inside" together with real coordinates (a bare mouseenter left x/y at 0,0 -> edge scroll to the corner)
    document.addEventListener('mouseenter', e => {
      if (e && e.clientX != null && (e.clientX || e.clientY)) { this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true; }
    });
  }

  get game() { return this.app.game; }
  get active() { return !!this.app.game && !this.app.demo; }
  me() { return this.app.game?.me ?? 0; }
  // other player on our team (not ourselves): friendly but not controllable
  isAllyOwner(o) { const g = this.app.game, me = this.me(); if (o == null || o < 0 || o === me) return false; try { const r = g?.isAlly?.(me, o); if (r !== undefined) return !!r; } catch (err) { /* ignore */ } return false; }
  isEnemyOwner(o) { const g = this.app.game, me = this.me(); if (o == null || o < 0 || o === me) return false; try { const r = g?.isEnemy?.(me, o); if (r !== undefined) return !!r; } catch (err) { /* ignore */ } return !this.isAllyOwner(o); }

  reset() {
    this.placing = null; this.wallStart = null; this.placeDown = false; this.groups = {}; this.keys.clear(); this.placeRot = 0;
    this.endDrag(); this.rot = null; this.mpan = null; this.setLineLabel(null);
    try { this.app.renderer.setGhost(null); } catch (err) { /* ignore */ }
  }

  // ---------- helpers ----------
  ent(id) { return id == null ? null : this.game.getEntity(id); }
  ownUnits() { return this.app.selection.filter(id => { const e = this.ent(id); return e && e.kind === 'unit' && e.owner === this.me() && !e.dead; }); }
  ownVillagers() { return this.app.selection.filter(id => { const e = this.ent(id); return e && e.kind === 'unit' && e.owner === this.me() && !e.dead && e.type === 'villager'; }); }
  // a building that trains units (only those take a rally flag)
  _trains(id) { const e = this.ent(id); return !!e && !!BUILDINGS[e.type] && (BUILDINGS[e.type].trains || []).length > 0; }
  // a drop-off camp (lumber camp, mining camp, mill): a rally flag on it sends new villagers to work around it
  _dropCamp(e) { const d = BUILDINGS[e.type]; return !!d && !!d.dropoff && !(d.trains || []).length; }
  ownBuildings() { return this.app.selection.filter(id => { const e = this.ent(id); return e && e.kind === 'building' && e.owner === this.me(); }); }
  sfx(name, kind) { try { this.app.audio.ui(name); if (name === 'command') this.app.audio.voice?.(this.app.selection, kind); } catch (err) { /* ignore */ } }
  // the target an order went to pulses for a moment (renderer.flashTarget), so the player sees which one was taken
  flash(id, col) { const r = this.app.renderer; try { if (r && typeof r.flashTarget === 'function') r.flashTarget(id, col); } catch (err) { /* ignore */ } }

  tileFor(type, g) {
    const size = (BUILDINGS[type] && BUILDINGS[type].size) || 1;
    return { tx: Math.round(g.x - size / 2), tz: Math.round(g.z - size / 2) };
  }

  // ---------- placement ----------
  startPlacement(type) {
    if (!this.active || !BUILDINGS[type]) return;
    this.placing = type; this.wallStart = null; this.placeDown = false; this.shiftPlaced = false;
    this.placeRot = this.canTurn(type) ? (this.placeRot | 0) & 3 : 0;   // (the last turn is kept for the next building)
    this.syncGhostRot();
    try { this.app.ui.setPlacement(type); } catch (err) { /* ignore */ }
    this.updateGhost();
  }
  canTurn(type) { return !!type && !NO_ROTATE.has(type) && !this.isLineTool(type); }
  syncGhostRot() { const r = this.app.renderer; try { if (r && typeof r.setGhostRot === 'function') r.setGhostRot(this.placeRot | 0); } catch (err) { /* ignore */ } }
  // R while placing: a quarter turn
  turnPlacement() {
    if (!this.placing || !this.canTurn(this.placing)) return false;
    this.placeRot = ((this.placeRot | 0) + 1) & 3;
    this.syncGhostRot(); this.updateGhost();
    return true;
  }
  cancelPlacement() {
    if (!this.placing) return;
    this.placing = null; this.wallStart = null; this.placeDown = false;
    try { this.app.renderer.setGhost(null); } catch (err) { /* ignore */ }
    try { this.app.ui.setPlacement(null); } catch (err) { /* ignore */ }
    this.setLineLabel(null);
  }
  // wall-like tools: drag a line of 1-tile segments
  isLineTool(type) { return type === 'wall' || type === 'gate' || type === 'rail'; }
  // drag-line tools (start tile -> end tile); gate stays a single-click 1-tile tool
  isDragLine(type) { return type === 'wall' || type === 'rail'; }
  // 4-connected tile line (corner tile inserted on diagonal steps, so the wall stays closed)
  lineTiles(x0, z0, x1, z1) {
    const out = [[x0, z0]], dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0), sx = x1 > x0 ? 1 : -1, sz = z1 > z0 ? 1 : -1;
    let x = x0, z = z0, ix = 0, iz = 0;
    while ((ix < dx || iz < dz) && out.length < 120) {
      if ((0.5 + ix) / dx < (0.5 + iz) / dz) { x += sx; ix++; } else { z += sz; iz++; }
      out.push([x, z]);
    }
    return out;
  }
  // own wall/gate/tower already on the tile: skipped silently (counts as connected)
  ownLinkAt(tx, tz) {
    const b = this.game.buildingAt ? this.game.buildingAt(tx, tz) : null;
    if (!b || b.owner !== this.me()) return false;
    if (this.placing === 'rail') return b.type === 'rail';
    return b.type === 'wall' || b.type === 'gate' || b.type === 'tower';
  }
  // the tiles the current line would place: [{tx,tz,valid}]
  linePlan(end, start) {
    const type = this.placing, game = this.game, d = BUILDINGS[type];
    const s = !this.isDragLine(type) ? end : start || (this.placeDown && this.wallStart) || end;
    const res = Object.assign({}, game.players[this.me()].res), out = [];
    for (const [tx, tz] of this.lineTiles(s.tx, s.tz, end.tx, end.tz)) {
      if (this.isDragLine(type) && this.ownLinkAt(tx, tz)) continue;
      let valid = !!game.canPlace(type, tx, tz, this.me());
      if (valid) { for (const k in d.cost) if ((res[k] || 0) < d.cost[k]) valid = false; if (valid) for (const k in d.cost) res[k] -= d.cost[k]; }
      out.push({ type, tx, tz, valid });
    }
    return out;
  }
  setLineLabel(plan) {
    if (!plan) { if (this.lineLbl) this.lineLbl.style.display = 'none'; return; }
    if (!this.lineLbl) {
      this.lineLbl = document.createElement('div');
      this.lineLbl.style.cssText = 'position:fixed;z-index:60;pointer-events:none;padding:2px 7px;border-radius:4px;font:600 12px system-ui,sans-serif;background:rgba(10,12,16,.82);white-space:nowrap';
      document.body.appendChild(this.lineLbl);
    }
    const d = BUILDINGS[this.placing], n = plan.filter(p => p.valid).length, want = plan.length;
    const cost = Object.keys(d.cost).map(k => (RES_ICONS[k] || k) + ' ' + d.cost[k] * want).join(' ');
    const l = this.lineLbl, ok = n === want && want > 0;
    l.innerHTML = tr('{0} parça · {1}', want, cost) + (ok ? '' : ' ' + tr('({0} yerleşir)', n));   // (numbers and our icons only)
    l.style.color = ok ? '#bfffb0' : '#ff7a6a';
    l.style.left = (this.mouse.x + 16) + 'px'; l.style.top = (this.mouse.y + 18) + 'px'; l.style.display = 'block';
  }
  updateGhost() {
    if (!this.placing) return;
    const g = this.app.renderer.screenToGround(this.mouse.x, this.mouse.y);
    if (!g) { this.app.renderer.setGhost(null); this.setLineLabel(null); return; }
    const { tx, tz } = this.tileFor(this.placing, g);
    if (this.isLineTool(this.placing)) {
      const plan = this.linePlan({ tx, tz });
      this.app.renderer.setGhost(plan.length ? plan : null);
      this.setLineLabel(plan.length && (this.placeDown || plan.length !== 1) ? plan : null);
      return;
    }
    const valid = !!this.game.canPlace(this.placing, tx, tz, this.me()) && !!this.game.canAfford(this.me(), BUILDINGS[this.placing].cost);
    this.app.renderer.setGhost({ type: this.placing, tx, tz, valid, rot: this.placeRot | 0 });
  }
  placeAt(tx, tz, queue = false) {
    const id = this.game.placeBuilding(this.me(), this.placing, tx, tz, this.ownVillagers(), !!queue, this.canTurn(this.placing) ? this.placeRot | 0 : 0);
    return id != null && id !== false;
  }
  finishPlacement(e) {
    const type = this.placing;
    const g = this.app.renderer.screenToGround(e.clientX, e.clientY);
    if (!g) { this.wallStart = null; return; }
    const end = this.tileFor(type, g);
    let placed = 0;
    if (this.isLineTool(type)) {
      const plan = this.linePlan(end, this.wallStart).filter(p => this.game.canPlace(type, p.tx, p.tz, this.me()));
      const want = plan.length;
      const ids = want ? this.game.placeLine(this.me(), type, plan.map(p => [p.tx, p.tz]), this.ownVillagers(), !!e.shiftKey) : [];
      placed = ids.length;
      this.wallStart = null;
      this.setLineLabel(null);
      if (placed) {
        this.sfx('place');
        if (want > 1) { try { this.app.ui.toast(tr('{0} / {1} {2} parçası yerleştirildi', placed, want, tr(BUILDINGS[type].name || '')) + (placed < want ? tr(' (kaynak yetmedi)') : ''), placed < want ? 'warn' : 'info'); } catch (err) { /* ignore */ } }
        this.updateGhost();
        return; // tool stays active: press again to continue the wall
      }
    } else if (this.placeAt(end.tx, end.tz, !!e.shiftKey)) placed = 1;
    this.wallStart = null;
    if (placed) {
      this.sfx('place');
      if (!e.shiftKey) this.cancelPlacement(); else this.shiftPlaced = true; // Shift held: keep placing, villagers queue the jobs
    } else {
      this.sfx('error');
      try {
        const ui = this.app.ui, d = BUILDINGS[type];
        if (ui && ui.hint) {
          if (d && d.cost && !this.game.canAfford(this.me(), d.cost)) ui.hint('afford', tr('⛔ Yetersiz kaynak: {0} için kaynağın yetmiyor', (d.name ? tr(d.name) : tr('bina'))));
          else if (type === 'dock') ui.hint('place', tr('⛔ Kıyıya yerleştir: bir kısmı suda olmalı'));
          else if (type === 'gate') ui.hint('place', tr('⛔ Kapı bitmiş bir sur parçasına ya da boş bir kareye konur'));
          else ui.hint('place', tr('⛔ Buraya inşa edilemez — boş ve keşfedilmiş bir alan seç'));
        }
      } catch (err) { /* ignore */ }
    }
  }

  // ---------- one-shot targeting (transport unload, attack-move, patrol) ----------
  startUnload(transportId) {
    if (!this.game.cmdUnload) return false;
    return this.startTargeting({ kind: 'unload', id: transportId }, tr('⚓ Boşaltma noktası: kıyıya sol tık · Esc / sağ tık: iptal'));
  }
  // kind 'amove' / 'patrol': the next left click on the ground gives the order to the selected units (Shift: queued)
  startGroundCmd(kind) {
    if (!this.ownUnits().length) return false;
    return this.startTargeting({ kind }, this.groundCmdLabel(kind));
  }
  groundCmdLabel(kind) {
    return kind === 'patrol' ? tr('🔁 Devriye: hedef noktaya sol tık · Shift: sıraya ekle · Esc / sağ tık: iptal') : tr('⚔ Saldırarak yürü: hedef noktaya sol tık · Shift: sıraya ekle · Esc / sağ tık: iptal');
  }
  startTargeting(t, label) {
    this.cancelPlacement();
    this.targeting = t;
    if (!this.tgtLbl) {
      this.tgtLbl = document.createElement('div');
      this.tgtLbl.style.cssText = 'position:fixed;z-index:60;pointer-events:none;padding:2px 7px;border-radius:4px;font:600 12px system-ui,sans-serif;background:rgba(10,12,16,.82);color:#bfe6ff;white-space:nowrap';
      document.body.appendChild(this.tgtLbl);
    }
    this.tgtLbl.textContent = label;
    this.tgtLbl.style.left = (this.mouse.x + 16) + 'px'; this.tgtLbl.style.top = (this.mouse.y + 18) + 'px';
    this.tgtLbl.style.display = 'block';
    try { this.canvas.style.cursor = 'crosshair'; } catch (err) { /* ignore */ }
    return true;
  }
  cancelTargeting() {
    this.targeting = null;
    if (this.tgtLbl) this.tgtLbl.style.display = 'none';
    try { this.canvas.style.cursor = ''; } catch (err) { /* ignore */ }
  }
  finishTargeting(e) {
    const t = this.targeting; this.cancelTargeting();
    if (!t || !this.active) return;
    const g = this.app.renderer.screenToGround(e.clientX, e.clientY);
    if (!g) return;
    if (t.kind === 'unload' && this.game.cmdUnload?.(t.id, g.x, g.z)) { this.app.renderer.addMarker(g.x, g.z, C_MOVE); this.sfx('command'); }
    // (the whole selection in one command: the sim gives villagers, carts, healers and unarmed ships a plain move in the same formation)
    else if ((t.kind === 'amove' || t.kind === 'patrol') && this.game[t.kind === 'patrol' ? 'cmdPatrol' : 'cmdAttackMove']?.(this.ownUnits(), g.x, g.z, !!e.shiftKey)) {
      this.app.renderer.addMarker(g.x, g.z, C_ATTACK); this.sfx('command', 'attack');
      // Shift held: stay armed for the next waypoint
      if (e.shiftKey) this.startTargeting(t, this.groundCmdLabel(t.kind));
    }
    else this.sfx('error');
  }

  // ---------- mouse ----------
  onDown(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    if (e.button === 1) {
      e.preventDefault();
      if (e.shiftKey || e.altKey) this.rot = { x: e.clientX, y: e.clientY };
      else this.mpan = { x: e.clientX, y: e.clientY };
      return;
    }
    if (!this.active) return;
    if (this.targeting && (e.button === 0 || e.button === 2)) {
      e.preventDefault();
      if (e.button === 0) this.finishTargeting(e); else this.cancelTargeting();
      return;
    }
    // map flare: Alt + left click, or a left click after the 📍 button (right click cancels)
    if ((this.flareArmed || (e.altKey && e.button === 0)) && (e.button === 0 || e.button === 2)) {
      e.preventDefault();
      const armed = this.flareArmed; this.disarmFlare();
      if (e.button === 2 && armed) return;
      const g = this.app.renderer.screenToGround(e.clientX, e.clientY);
      if (g) this.app.flare?.(g.x, g.z);
      return;
    }
    if (e.button === 0) {
      if (this.placing) {
        const g = this.app.renderer.screenToGround(e.clientX, e.clientY);
        this.wallStart = g ? this.tileFor(this.placing, g) : null;
        this.placeDown = true;
        this.updateGhost();
        return;
      }
      this.drag = { x0: e.clientX, y0: e.clientY, active: false };
    } else if (e.button === 2) {
      e.preventDefault();
      if (this.placing) { this.cancelPlacement(); return; }
      this._lastMove = null; this.fdrag = null;
      this.contextCommand(e);
      // a plain ground move: holding the button and dragging then sets the formation's facing (on release)
      const lm = this._lastMove; this._lastMove = null;
      if (lm) this.fdrag = { x0: e.clientX, y0: e.clientY, ...lm, active: false };
    }
  }

  onMove(e) {
    this.mouse.x = e.clientX; this.mouse.y = e.clientY; this.mouse.inside = true;
    this.shift = e.shiftKey;
    if (this.placing && this.active && !this.rot && !this.mpan) this.updateGhost();
    if (this.targeting && this.tgtLbl) { this.tgtLbl.style.left = (e.clientX + 16) + 'px'; this.tgtLbl.style.top = (e.clientY + 18) + 'px'; }
    if (this.mpan) {
      if (this.active) {
        const cam = this.app.renderer.cam;
        this.pan(-(e.clientX - this.mpan.x), e.clientY - this.mpan.y, Math.max(10, cam.dist) * TP_PAN * 1.15);
      }
      this.mpan.x = e.clientX; this.mpan.y = e.clientY;
      return;
    }
    if (this.rot) {
      const cam = this.app.renderer.cam;
      if (this.rot.space) this.rot.moved += Math.abs(e.clientX - this.rot.x) + Math.abs(e.clientY - this.rot.y);
      cam.yaw -= (e.clientX - this.rot.x) * 0.006;
      cam.pitch += (e.clientY - this.rot.y) * 0.003;
      this.rot.x = e.clientX; this.rot.y = e.clientY;
      return;
    }
    if (this.fdrag) {
      const f = this.fdrag, dx = e.clientX - f.x0, dy = e.clientY - f.y0, len = Math.hypot(dx, dy);
      if (len > 12) f.active = true;
      if (f.active) { const s = this.fline.style; s.display = 'block'; s.left = f.x0 + 'px'; s.top = (f.y0 - 1) + 'px'; s.width = len + 'px'; s.transform = 'rotate(' + Math.atan2(dy, dx) + 'rad)'; }
    }
    if (this.drag) {
      const d = this.drag;
      if (!d.active && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) > DRAG_PX) d.active = true;
      if (d.active) {
        const s = this.box.style;
        s.display = 'block';
        s.left = Math.min(d.x0, e.clientX) + 'px'; s.top = Math.min(d.y0, e.clientY) + 'px';
        s.width = Math.abs(e.clientX - d.x0) + 'px'; s.height = Math.abs(e.clientY - d.y0) + 'px';
      }
    }
    this.hoverCursor(e);
  }

  // context cursor (axe / pickaxe / food / hammer / sword) for what a right click would do; view only, picks at most every 50 ms
  hoverCursor(e) {
    const now = performance.now();
    if (now - (this._curT || 0) < 50) return;
    this._curT = now;
    if (this.targeting || this.flareArmed) { this._cur = null; return; }   // (they own the crosshair; re-set after)
    let name = '';
    try {
      const busy = !this.active || this.placing || this.rot || this.mpan || (this.drag && this.drag.active) || (this.fdrag && this.fdrag.active)
        || e.target !== this.canvas || document.documentElement.classList.contains('touch');
      if (!busy) {
        const sel = { villagers: false, military: false };
        for (const id of this.ownUnits()) { if (this.ent(id).type === 'villager') sel.villagers = true; else sel.military = true; }
        if (sel.villagers || sel.military) {
          let t = this.ent(this.app.renderer.pick(e.clientX, e.clientY));
          if (t && !this.game.isEntityVisible(t)) t = null;
          name = pickCursor(sel, t, this.me(), o => this.isEnemyOwner(o));
        }
      }
    } catch (err) { name = ''; }
    if (name !== this._cur) { this._cur = name; try { this.canvas.style.cursor = cursorCss(name); } catch (err) { /* ignore */ } }
  }

  endDrag() { this.drag = null; this.box.style.display = 'none'; }

  onUp(e) {
    if (e.button === 1) { if (!(this.rot && this.rot.space)) this.rot = null; this.mpan = null; return; }
    if (e.button === 2 && this.fdrag) {
      const f = this.fdrag; this.fdrag = null; this.fline.style.display = 'none';
      if (!f.active || !this.active) return;
      const g = this.app.renderer.screenToGround(e.clientX, e.clientY);
      if (!g) return;
      const dx = g.x - f.x, dz = g.z - f.z;
      if (Math.hypot(dx, dz) < 0.5) return;
      // the same move again, now facing the drag direction (replaces the order the press gave)
      if (this.game.cmdMove(f.units, f.x, f.z, false, null, [dx, dz])) { this.app.renderer.addMarker(f.x, f.z, C_MOVE); this.sfx('command'); }
      return;
    }
    if (e.button !== 0) return;
    if (this.placing && this.placeDown) {
      this.placeDown = false;
      if (this.active) this.finishPlacement(e);
      return;
    }
    this.placeDown = false;
    const d = this.drag;
    if (!d) return;
    this.endDrag();
    if (!this.active) return;
    const app = this.app;
    if (d.active) {
      const ids = app.renderer.unitsInRect(Math.min(d.x0, e.clientX), Math.min(d.y0, e.clientY),
        Math.max(d.x0, e.clientX), Math.max(d.y0, e.clientY)) || [];
      if (e.shiftKey) app.select(app.selection.concat(ids));
      else app.select(ids);
      return;
    }
    const id = app.renderer.pick(e.clientX, e.clientY);
    const ent = this.ent(id);
    if (!ent || ent.dead || !this.game.isEntityVisible(ent)) { if (!e.shiftKey) app.select([]); return; }
    if (e.shiftKey && ent.owner === this.me()) {
      // only keep a homogeneous own selection when shift-adding
      const cur = app.selection.filter(i => { const x = this.ent(i); return x && x.owner === this.me() && x.kind === ent.kind; }); // units with units, buildings with buildings
      if (cur.includes(id)) app.select(cur.filter(i => i !== id));
      else app.select(cur.concat([id]));
    } else app.select([id]);
  }

  onDbl(e) {
    if (!this.active || this.placing || e.button !== 0) return;
    const ent = this.ent(this.app.renderer.pick(e.clientX, e.clientY));
    if (ent && ent.owner === this.me() && ent.kind === 'building' && !ent.dead) {
      // all own finished buildings of the same type on screen
      const r = this.app.renderer, W = window.innerWidth, H = window.innerHeight;
      const ids = this.game.buildingsOf(this.me()).filter(b => !b.dead && b.done && b.type === ent.type && (() => { const s = r.worldToScreen(b.x, r.groundY ? r.groundY(b.x, b.z) : 0, b.z); return s.visible && s.x >= 0 && s.y >= 0 && s.x <= W && s.y <= H; })()).map(b => b.id);
      if (!ids.includes(ent.id)) ids.unshift(ent.id);
      this.app.select(ids);
      return;
    }
    if (!ent || ent.owner !== this.me() || ent.kind !== 'unit') return;
    const ids = (this.app.renderer.unitsInRect(0, 0, window.innerWidth, window.innerHeight) || [])
      .filter(id => { const u = this.ent(id); return u && u.type === ent.type; });
    if (ids.length) this.app.select(ids);
  }

  onWheel(e) {
    e.preventDefault();
    const r = this.app.renderer, cam = r.cam;
    // touchpad mode (Settings): two-finger scroll pans, a pinch (the browser sends it as a wheel with ctrlKey) zooms
    const tp = !!this.app.ui?.settings?.touchpad;
    if (tp && !e.ctrlKey) {
      if (!this.active || this.rot) return;
      const px = e.deltaMode === 1 ? 33 : 1;
      this.pan(e.deltaX * px, -e.deltaY * px, Math.max(10, cam.dist) * TP_PAN);
      return;
    }
    const f = Math.pow(tp ? 1.01 : 1.0015, e.deltaMode === 1 ? e.deltaY * 33 : e.deltaY);
    const old = cam.dist;
    const nd = Math.max(8, Math.min(110, old * f));
    const k = nd / old;
    if (this.active && k < 1) {
      const g = r.screenToGround(e.clientX, e.clientY);
      if (g) { cam.tx = g.x + (cam.tx - g.x) * k; cam.tz = g.z + (cam.tz - g.z) * k; }
    }
    cam.dist = nd;
  }

  // ---------- commands ----------
  contextCommand(e) {
    const app = this.app, game = this.game, r = app.renderer;
    const queue = e.shiftKey;
    let units = this.ownUnits();
    const g = r.screenToGround(e.clientX, e.clientY);
    let target = this.ent(r.pick(e.clientX, e.clientY));
    if (target && (target.dead || !game.isEntityVisible(target))) target = null;

    if (!units.length) {
      const blds = this.ownBuildings().filter(id => this._trains(id));
      if (!blds.length) return;
      const work = target && (target.kind === 'resource' || (target.kind === 'building' && target.owner === this.me() && (target.type === 'farm' || target.type === 'pasture' || this._dropCamp(target))));
      const p = work ? { x: target.x, z: target.z } : g;
      if (!p) return;
      let ok = false;
      for (const id of blds) ok = game.setRally(id, p.x, p.z, work ? target.id : null) || ok;
      if (ok) { r.addMarker(p.x, p.z, work ? C_GATHER : C_RALLY); this.sfx('command'); if (work) app.ui?.hint?.('rallywork', tr(target.type === 'fish' ? '🚩 Yeni balıkçı tekneleri doğrudan burada avlanacak' : '🚩 Yeni köylüler doğrudan burada çalışacak'), 'info', 4); }
      return;
    }

    const villagers = this.ownVillagers();
    // ships: their own commands; land units of a mixed selection continue below
    const isShip = (id) => { const u = this.ent(id); return !!(u && (u.naval || UNITS[u.type]?.naval)); };
    const ships = units.filter(isShip);
    if (ships.length) {
      const land = units.filter(id => !ships.includes(id));
      this.shipCommand(ships, target, g, queue, land.length > 0);
      if (!land.length) return;
      units = land;
    }
    if (target && target.kind === 'unit' && target.owner === this.me() && target.type === 'transport' && !target.dead) {
      if (game.cmdBoard?.(units, target.id)) { r.addMarker(target.x, target.z, C_GATHER); this.sfx('command'); }
      return;
    }
    if (target) {
      if (target.owner >= 0 && target.owner !== this.me() && this.isEnemyOwner(target.owner)) {
        if (game.cmdAttack(units, target.id, queue)) { r.addMarker(target.x, target.z, C_ATTACK); this.flash(target.id, C_ATTACK); this.sfx('command', 'attack'); }
        return;
      }
      if (target.kind === 'resource' && target.live) {   // (a live wolf / bear: everyone who can fight goes for it)
        if (game.cmdAttack(units, target.id, queue)) { r.addMarker(target.x, target.z, C_ATTACK); this.flash(target.id, C_ATTACK); this.sfx('command', 'attack'); }
        return;
      }
      if (target.kind === 'resource') {
        if (villagers.length) {
          game.cmdGather(villagers, target.id, queue);
          const rest = units.filter(id => !villagers.includes(id));
          if (rest.length) game.cmdMove(rest, target.x, target.z, queue);
          r.addMarker(target.x, target.z, C_GATHER); this.flash(target.id, C_GATHER); this.sfx('command', 'gather:' + ({ tree: 'wood', stone: 'stone', gold: 'gold', berries: 'food', deer: 'food', fish: 'food' })[target.type]);
          return;
        }
      } else if (target.kind === 'building' && target.owner === this.me() && villagers.length) {
        const rad = (target.size || 0) * 0.71;   // (the ring goes round the footprint, not under the model)
        if (!target.done || target.hp < target.maxHp) {
          game.cmdBuild(villagers, target.id, queue);
          r.addMarker(target.x, target.z, C_BUILD, rad); this.flash(target.id, C_BUILD); this.sfx('command', 'build');
          return;
        }
        if (target.type === 'farm' || target.type === 'pasture') {
          game.cmdGather(villagers, target.id, queue);
          r.addMarker(target.x, target.z, C_GATHER, rad); this.flash(target.id, C_GATHER); this.sfx('command', 'gather:food');
          return;
        }
        // carrying villagers right-clicking a matching finished drop-off building (TC, storage, lumber/mine camp, mill): drop load there
        const drop = BUILDINGS[target.type]?.dropoff;
        const carriers = drop ? villagers.filter(id => { const u = this.ent(id); return u && u.carry && u.carry.amount > 0 && drop.includes(u.carry.type); }) : [];
        if (carriers.length && game.cmdReturn?.(carriers, target.id, queue)) {
          const empty = villagers.filter(id => !carriers.includes(id));
          if (empty.length && (target.type === 'lumbercamp' || target.type === 'minecamp')) {
            const best = this._campRes(target, empty);
            if (best) game.cmdGather(empty, best.id, queue);
          }
          const rest = units.filter(id => !villagers.includes(id));
          if (rest.length) game.cmdMove(rest, target.x, target.z, queue);
          r.addMarker(target.x, target.z, C_GATHER, rad); this.flash(target.id, C_GATHER); this.sfx('command', 'gather:' + (this.ent(carriers[0])?.carry?.type || 'wood'));
          return;
        }
        // a lumber camp / mine camp: work the nearest tree / stone or gold to it on explored tiles (a mine whose
        // deposit already has MINE_CAP of my villagers, not counting these, only when no other one has room)
        if (target.type === 'lumbercamp' || target.type === 'minecamp') {
          const best = this._campRes(target, villagers);
          if (best && game.cmdGather(villagers, best.id, queue)) {
            // (the rest of a mixed selection walks to the camp, as with a right click on a resource)
            const rest = units.filter(id => !villagers.includes(id));
            if (rest.length) game.cmdMove(rest, target.x, target.z, queue);
            r.addMarker(target.x, target.z, C_GATHER, rad); r.addMarker(best.x, best.z, C_GATHER); this.flash(best.id, C_GATHER); this.sfx('command', 'gather:' + ({ tree: 'wood', stone: 'stone', gold: 'gold', berries: 'food', deer: 'food', fish: 'food' })[best.type]); return;
          }
        }
      }
    }
    const p = g || (target ? { x: target.x, z: target.z } : null);
    if (p) this.commandGround(p.x, p.z, queue);
  }

  // right click with ships selected (silent=true: land units of the same selection get the sound/marker)
  shipCommand(ships, target, g, queue, silent) {
    const game = this.game, r = this.app.renderer;
    const ok = (x, z, col) => { if (!silent) { r.addMarker(x, z, col); this.sfx('command'); } };
    if (target) {
      if (target.owner >= 0 && target.owner !== this.me() && this.isEnemyOwner(target.owner)) {
        const war = ships.filter(id => { const u = this.ent(id); return u && !['fishboat', 'transport'].includes(u.type); });
        if (war.length && game.cmdAttack(war, target.id, queue)) { ok(target.x, target.z, C_ATTACK); }
        const rest = ships.filter(id => !war.includes(id));
        if (rest.length && g) game.cmdMove(rest, g.x, g.z, queue);
        return;
      }
      const fish = ships.filter(id => this.ent(id)?.type === 'fishboat');
      const others = ships.filter(id => !fish.includes(id));
      if (fish.length && target.kind === 'resource' && (target.type === 'fish' || target.res === 'fish')) {
        game.cmdGather(fish, target.id); ok(target.x, target.z, C_GATHER);
        if (others.length && g) game.cmdMove(others, g.x, g.z, queue);
        return;
      }
      if (fish.length && target.kind === 'building' && target.owner === this.me() && target.type === 'dock' && target.done) {
        const done = game.cmdReturn ? game.cmdReturn(fish, target.id) : game.cmdGather(fish, target.id);
        if (!done) game.cmdMove(fish, target.x, target.z, queue);
        ok(target.x, target.z, C_GATHER);
        if (others.length && g) game.cmdMove(others, g.x, g.z, queue);
        return;
      }
    }
    const p = g || (target ? { x: target.x, z: target.z } : null);
    // loaded transports ordered onto land: sail to the nearest coast point there and unload everyone
    if (p && game.cmdUnload && game._navWater && !game._navWater(Math.floor(p.x), Math.floor(p.z))) {
      const full = ships.filter(id => { const u = this.ent(id); return u && u.type === 'transport' && (u.cargo || []).length; });
      const done = full.filter(id => game.cmdUnload(id, p.x, p.z));
      if (done.length) { ok(p.x, p.z, C_GATHER); ships = ships.filter(id => !done.includes(id)); if (!ships.length) return; }
    }
    if (p && game.cmdMove(ships, p.x, p.z, queue)) ok(p.x, p.z, C_MOVE);
  }

  // the resource villagers sent to their own lumber / mine camp go to work: the nearest tree (or stone / gold) to the
  // camp on an explored tile; for a mine, the nearest one on a deposit that still has room comes first
  _campRes(camp, vils) {
    const game = this.game, N = game.map.size, fog = game.fog, wood = camp.type === 'lumbercamp', me = this.me();
    const cap = !wood && typeof game.mineLoad === 'function' && typeof game._depOf === 'function';
    // places the selected villagers already hold, per deposit (they free them when they switch)
    const mineOf = new Map();
    if (cap) for (const id of vils) { const u = this.ent(id); let o = u && u.order; if (o && o.type === 'return') o = o.resume; if (o && o.type === 'gather' && o.dadm) mineOf.set(o.dadm, (mineOf.get(o.dadm) || 0) + 1); }
    const room = new Map();
    let best = null, bd = Infinity, full = null, fd = Infinity;
    for (const e of game.entities.values()) {
      if (e.kind !== 'resource' || e.dead || !(e.amount > 0) || (wood ? e.type !== 'tree' : (e.type !== 'stone' && e.type !== 'gold'))) continue;
      if (fog && !fog[(e.z | 0) * N + (e.x | 0)]) continue;
      const d = (e.x - camp.x) ** 2 + (e.z - camp.z) ** 2; if (d >= bd) continue;
      if (cap) {
        const dep = game._depOf(e); let ok = room.get(dep);
        if (ok === undefined) { ok = game.mineLoad(dep, me) - (mineOf.get(dep) || 0) < MINE_CAP; room.set(dep, ok); }
        if (!ok) { if (d < fd) { fd = d; full = e; } continue; }
      }
      bd = d; best = e;
    }
    return best || full;
  }

  commandGround(x, z, queue = false) {
    if (!this.active) return;
    const units = this.ownUnits();
    if (units.length) {
      if (this.game.cmdMove(units, x, z, queue)) { this.app.renderer.addMarker(x, z, C_MOVE); this.sfx('command'); if (!queue) this._lastMove = { units: units.slice(), x, z }; }
      return;
    }
    const blds = this.ownBuildings().filter(id => this._trains(id));
    let ok = false;
    for (const id of blds) ok = this.game.setRally(id, x, z) || ok;
    if (ok) { this.app.renderer.addMarker(x, z, C_RALLY); this.sfx('command'); }
  }

  // ---------- keyboard ----------
  onKeyDown(e) {
    const t = e.target;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    // a confirmation dialog (src/ui/ask.js) is open: it owns the keyboard (it already swallows keys in the capture phase)
    try { if (this.app.ui && this.app.ui.askOpen && this.app.ui.askOpen()) return; } catch (err) { /* ignore */ }
    this.shift = e.shiftKey;
    const app = this.app, game = this.game;
    const k = e.key, code = e.code;

    if (code === 'F5') { e.preventDefault(); if (this.active && !app.net) app.saveGame(); return; }
    if (!this.active) return;
    if (k === 'Enter' && (app.net || (game && !app.demo))) { e.preventDefault(); try { app.ui.openChat?.(); } catch (err) { /* ignore */ } return; }
    if (code === 'F10' || ((k === 'p' || k === 'P') && !e.ctrlKey)) {
      e.preventDefault();
      // single player: pause; multiplayer: pause / resume the match for everybody
      if (!e.repeat) { if (!app.net) app.setPaused(!app.paused); else if (typeof app.net.requestPause === 'function') app.net.requestPause(!app.net.paused); }
      return;
    }
    if (k === 'Escape') {
      const modal = app.ui && app.ui.modalEl;
      if (modal && !modal.classList.contains('hidden')) { try { app.ui._closeModal(); } catch (err) { /* ignore */ } } // an open modal (tech tree, stats) closes first
      else if (app.ui && app.ui.gameMenuVisible && app.ui.gameMenuVisible()) { try { app.ui.toggleGameMenu(false); } catch (err) { /* ignore */ } }
      else if (this.flareArmed) this.disarmFlare();
      else if (this.targeting) this.cancelTargeting();
      else if (this.placing) this.cancelPlacement();
      else if (app.ui && app.ui.cardBack && app.ui.cardBack()) { /* a build page was open: back to the main card */ }
      else if (app.selection.length) app.select([]);
      else { try { app.ui.toggleGameMenu(true); } catch (err) { /* ignore */ } }   // nothing to cancel: the game menu
      return;
    }
    // control groups
    if (/^Digit[1-9]$/.test(code)) {
      const n = +code.slice(5);
      if (e.ctrlKey) {
        e.preventDefault();
        this.setGroup(n);
        return;
      }
      if (!e.altKey && !e.metaKey) {
        const now = performance.now();
        this.recallGroup(n, this.lastGroupTap.n === n && now - this.lastGroupTap.t < 400);
        this.lastGroupTap = { n, t: now };
        return;
      }
    }
    if (e.ctrlKey && !e.altKey && !e.metaKey && code === 'KeyA') {
      e.preventDefault();
      if (!e.repeat) this.selectAllUnits();
      return;
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return;

    // W/A/S/D are camera-only: never routed to the command card or any other shortcut
    if (code === 'KeyW' || code === 'KeyA' || code === 'KeyS' || code === 'KeyD') { this.keys.add(code); return; }
    if (k === 'Home' || k === 'Backspace') { if (k === 'Backspace') e.preventDefault(); this.goHome(); return; }
    if (k === ' ') {
      e.preventDefault();
      // held: the mouse turns the camera like the middle button; released without turning: jump to the last alert (keyup)
      if (!e.repeat && !this.rot) this.rot = { x: this.mouse.x, y: this.mouse.y, space: true, moved: 0 };
      return;
    }
    if (k === '.' || k === 'Tab' || k === ':') { e.preventDefault(); this.nextIdleVillager(e.shiftKey); return; }   // (with Shift: all of them, owner 2026-11-20)
    if (k === 'Delete') {
      const own = app.selection.filter(id => { const x = this.ent(id); return x && x.owner === this.me(); });
      for (const id of own) game.deleteEntity(id);
      return;
    }
    if (k.startsWith('Arrow')) { e.preventDefault(); this.keys.add(code); return; }
    // R while placing turns the building (the card's R hotkey waits until the placement ends)
    if (code === 'KeyR' && this.placing) { if (!e.repeat) this.turnPlacement(); return; }

    if (k.length === 1 && /[a-zA-ZçğıöşüÇĞİÖŞÜ]/.test(k)) {
      if (!e.repeat) {
        let handled = false;
        try { handled = !!(app.ui.hotkey && app.ui.hotkey(k.toLowerCase())); } catch (err) { console.warn(err); }
        if (handled) return;
        if (code === 'KeyQ' && !app.selection.length && !this.placing && !this.targeting) { this.selectAllMilitary(); return; }
      }
    }
  }

  goHome() {
    const game = this.game;
    const tc = game.buildingsOf(this.me()).find(b => b.type === 'towncenter');
    if (tc) this.app.focus(tc.x, tc.z);
    else { const p = game.players[this.me()]; this.app.focus(p.startX, p.startZ); }
  }

  // ---- map flare (the 📍 button): the next left click on the map or the minimap places it
  armFlare() {
    if (this.placing) this.cancelPlacement();
    if (this.targeting) this.cancelTargeting();
    this.flareArmed = true;
    try { this.canvas.style.cursor = 'crosshair'; } catch (err) { /* ignore */ }
  }
  disarmFlare() {
    if (!this.flareArmed) return;
    this.flareArmed = false;
    try { this.canvas.style.cursor = ''; } catch (err) { /* ignore */ }
  }

  // ---- control groups (Ctrl+1..9 / the shortcut bar above the bottom panel); own living entities only
  groupIds(n) {
    const me = this.app.game ? this.app.game.me : 0;
    const ids = (this.groups[n] || []).filter(id => { const x = this.ent(id); return x && !x.dead && x.owner === me; });
    this.groups[n] = ids;
    return ids;
  }
  setGroup(n, ids) {
    const me = this.app.game ? this.app.game.me : 0;
    const list = (ids || this.app.selection).filter(id => { const x = this.ent(id); return x && !x.dead && x.owner === me; });
    if (list.length) this.groups[n] = list.slice(); else delete this.groups[n];
    this.groupsRev = (this.groupsRev || 0) + 1;
    this._saveGroup(n, list);
    return list.length;
  }
  clearGroup(n) { delete this.groups[n]; this.groupsRev = (this.groupsRev || 0) + 1; this._saveGroup(n, []); }
  // the sim keeps a copy per player for the save (a lockstep command in multiplayer, see Game.cmdGroup)
  _saveGroup(n, ids) { const g = this.app.game; if (!g || this.app.demo || typeof g.cmdGroup !== 'function') return; try { g.cmdGroup(g.me ?? 0, n, ids.slice()); } catch (err) { console.warn('[groups]', err); } }
  // after a load: the groups saved with the game, by entity id (dead units are gone)
  restoreGroups(game) {
    const cg = game && typeof game.controlGroups === 'function' ? game.controlGroups(game.me ?? 0) : {};
    this.groups = {}; for (const n in cg) this.groups[n] = cg[n].slice();
    this.groupsRev = (this.groupsRev || 0) + 1;
  }
  recallGroup(n, focus) {
    const ids = this.groupIds(n);
    if (!ids.length) return false;
    this.app.select(ids);
    if (focus) {
      let sx = 0, sz = 0;
      for (const id of ids) { const x = this.ent(id); sx += x.x; sz += x.z; }
      this.app.focus(sx / ids.length, sz / ids.length);
    }
    return true;
  }

  // Ctrl+A: all own commandable units on the map
  selectAllUnits() {
    const ids = this.game.unitsOf(this.me()).filter(u => !u.dead && !u.aboard && u.type !== 'train').map(u => u.id);
    if (ids.length) this.app.select(ids);
  }
  // Q (with nothing selected): all own military units (land soldiers, support, siege, and warships)
  selectAllMilitary() {
    const ids = this.game.unitsOf(this.me()).filter(u => {
      if (u.dead || u.aboard) return false;
      const d = UNITS[u.type];
      return !!d && d.cls !== 'civil' && d.cls !== 'train' && u.type !== 'fishboat' && u.type !== 'transport';
    }).map(u => u.id);
    if (!ids.length) {
      this.game.events.emit('notify', { text: tr('Askerî birlik yok.'), type: 'info' });
      return;
    }
    this.app.select(ids);
  }

  // the next idle villager; all: every idle villager at once (Shift), the camera on the one nearest the middle of them
  nextIdleVillager(all = false) {
    const idle = this.game.unitsOf(this.me()).filter(u => u.type === 'villager' && u.state === 'idle' && !u.dead && !u.sheltered);
    if (!idle.length) {
      this.game.events.emit('notify', { text: tr('Boşta köylü yok.'), type: 'info' });
      return;
    }
    if (all) {
      let cx = 0, cz = 0; for (const v of idle) { cx += v.x; cz += v.z; } cx /= idle.length; cz /= idle.length;
      let f = idle[0], fd = Infinity; for (const v of idle) { const d = (v.x - cx) ** 2 + (v.z - cz) ** 2; if (d < fd) { fd = d; f = v; } }
      this.app.select(idle.map(v => v.id));
      this.app.focus(f.x, f.z);
      return;
    }
    const u = idle[this.idleIdx++ % idle.length];
    this.app.select([u.id]);
    this.app.focus(u.x, u.z);
  }

  // ---------- per frame ----------
  update(dt) {
    this.touchTick();
    if (!this.active) return;
    const r = this.app.renderer, cam = r.cam, K = this.keys;
    let mx = 0, mz = 0; // right, forward
    if (this.stick && (this.stick.x || this.stick.y)) { mx += this.stick.x * 1.4; mz -= this.stick.y * 1.4; }   // touch stick (_bindTouch)
    if (K.has('KeyW') || K.has('ArrowUp')) mz += 1;
    if (K.has('KeyS') || K.has('ArrowDown')) mz -= 1;
    if (K.has('KeyD') || K.has('ArrowRight')) mx += 1;
    if (K.has('KeyA') || K.has('ArrowLeft')) mx -= 1;
    const edgeOn = this.app.ui?.settings?.edgePan !== false;
    const modalOpen = !!(this.app.ui?.modalEl && !this.app.ui.modalEl.classList.contains('hidden')) || !!(this.app.ui?.pauseEl && !this.app.ui.pauseEl.classList.contains('hidden'));
    if (edgeOn && !this.touchMode && this.mouse.inside && document.hasFocus() && !this.rot && !this.mpan && !this.app.paused && !modalOpen) {
      const w = window.innerWidth, h = window.innerHeight, m = this.mouse;
      if (m.x >= 0 && m.y >= 0 && m.x <= w && m.y <= h) {
        const ramp = (d) => EDGE_MIN + (1 - EDGE_MIN) * Math.min(1, Math.max(0, 1 - d / EDGE_PX));
        if (m.x <= EDGE_PX) mx -= ramp(m.x); else if (m.x >= w - EDGE_PX) mx += ramp(w - m.x);
        if (m.y <= EDGE_PX) mz += ramp(m.y); else if (m.y >= h - EDGE_PX) mz -= ramp(h - m.y);
      }
    }
    // Shift held: pan PAN_FAST times faster (keys and screen edge); a diagonal is no faster than a straight pan
    if (mx || mz) this.pan(mx, mz, Math.max(10, cam.dist * 0.9) * (this.shift ? PAN_FAST : 1) * dt / Math.max(1, Math.hypot(mx, mz)));
    if (this.placing) this.updateGhost();
  }
  // ---------- touch (phones / tablets; owner 2026-11-23: players want to play on the phone) ----------
  // One finger drags the map, two fingers pinch-zoom (and pan), a tap selects, a tap with own units selected gives the
  // order a right click would (move, gather, attack, build...), a long press then drag is the selection box, a double
  // tap selects all of that type on screen. The "Bırak" button drops the selection (a ground tap would be an order).
  _bindTouch(c) {
    const T = { pts: new Map(), mode: null, x0: 0, y0: 0, t0: 0, long: 0, pinch: null, lastTap: 0, lx: 0, ly: 0 };
    const fake = (x, y, button) => ({ clientX: x, clientY: y, button, shiftKey: false, altKey: false, ctrlKey: false, preventDefault() {} });
    const mid = () => { const p = [...T.pts.values()]; return { x: (p[0].x + p[1].x) / 2, y: (p[0].y + p[1].y) / 2, d: Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y) }; };
    this.dropBtn = document.createElement('button');
    this.dropBtn.type = 'button';
    this.dropBtn.textContent = tr('Bırak');
    this.dropBtn.className = 'mbtn small touch-drop';
    this.dropBtn.style.cssText = 'position:fixed;right:calc(12px + env(safe-area-inset-right));top:52px;z-index:40;display:none';
    this.dropBtn.onclick = (e) => {
      e.stopPropagation();
      if (this.placing) this.cancelPlacement();
      else if (this.targeting) this.cancelTargeting();
      else if (this.flareArmed) this.disarmFlare();
      else this.app.select([]);
    };
    document.body.appendChild(this.dropBtn);
    // (owner 2026-11-23: "a gamepad analog stick") bottom-right stick pans the map: direction and speed follow the thumb;
    // with the stick for panning, a one-finger drag on the map is always the selection box
    this.boxMode = true;
    this.stick = { x: 0, y: 0, id: null };
    const pad = this.modeBtn = document.createElement('div');
    pad.className = 'touch-stick';
    pad.style.cssText = 'position:fixed;left:calc(14px + env(safe-area-inset-left));bottom:165px;width:112px;height:112px;border-radius:50%;z-index:40;display:none;' +
      'background:radial-gradient(circle,rgba(20,26,38,.35),rgba(20,26,38,.6));border:1px solid rgba(230,200,120,.35);touch-action:none';
    const knob = document.createElement('div');
    knob.style.cssText = 'position:absolute;left:50%;top:50%;width:46px;height:46px;margin:-23px 0 0 -23px;border-radius:50%;' +
      'background:rgba(230,200,120,.55);border:1px solid rgba(255,230,160,.8);box-shadow:0 2px 6px rgba(0,0,0,.5);pointer-events:none';
    pad.appendChild(knob);
    document.body.appendChild(pad);
    const R = 40;
    const setStick = (cx, cy) => {
      const r = pad.getBoundingClientRect(), dx = cx - (r.left + r.width / 2), dy = cy - (r.top + r.height / 2), l = Math.hypot(dx, dy) || 1, k = Math.min(1, l / R);
      this.stick.x = dx / l * k; this.stick.y = dy / l * k;
      knob.style.transform = `translate(${this.stick.x * R}px,${this.stick.y * R}px)`;
    };
    const stop = () => { this.stick.x = this.stick.y = 0; this.stick.id = null; knob.style.transform = ''; };
    pad.addEventListener('touchstart', (e) => { e.preventDefault(); e.stopPropagation(); const t = e.changedTouches[0]; this.stick.id = t.identifier; setStick(t.clientX, t.clientY); }, { passive: false });
    pad.addEventListener('touchmove', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === this.stick.id) setStick(t.clientX, t.clientY); }, { passive: false });
    pad.addEventListener('touchend', (e) => { e.preventDefault(); for (const t of e.changedTouches) if (t.identifier === this.stick.id) stop(); }, { passive: false });
    pad.addEventListener('touchcancel', stop);
    const opts = { passive: false };
    // html.touch: the compact phone layout in style.css (a touch screen, or the first touch)
    try { if (window.matchMedia && matchMedia('(pointer: coarse)').matches) document.documentElement.classList.add('touch'); } catch (err) { /* */ }
    c.addEventListener('touchstart', (e) => {
      e.preventDefault();
      this.touchMode = true; this.mouse.inside = false;
      document.documentElement.classList.add('touch');
      for (const t of e.changedTouches) T.pts.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (T.pts.size === 1) {
        const t = e.changedTouches[0];
        T.mode = 'tap'; T.x0 = T.lx = t.clientX; T.y0 = T.ly = t.clientY; T.t0 = performance.now();
        this.mouse.x = t.clientX; this.mouse.y = t.clientY;
        if (this.placing) { this.updateGhost(); }
        clearTimeout(T.long);
        T.long = setTimeout(() => {   // long press: box select
          if (T.mode !== 'tap' || !this.active || this.placing || this.targeting) return;
          T.mode = 'box'; this.drag = { x0: T.x0, y0: T.y0, active: true };
          if (navigator.vibrate) try { navigator.vibrate(15); } catch (err) { /* */ }
        }, 450);
      } else if (T.pts.size === 2) {
        clearTimeout(T.long);
        if (T.mode === 'box') this.endDrag();
        T.mode = 'pinch'; T.pinch = mid();
      }
    }, opts);
    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      for (const t of e.changedTouches) if (T.pts.has(t.identifier)) T.pts.set(t.identifier, { x: t.clientX, y: t.clientY });
      if (!this.active) return;
      const cam = this.app.renderer.cam;
      if (T.mode === 'pinch' && T.pts.size >= 2) {
        const m = mid(), p = T.pinch;
        if (p.d > 0 && m.d > 0) cam.dist = Math.max(8, Math.min(110, cam.dist * p.d / m.d));
        this.pan(-(m.x - p.x), (m.y - p.y), Math.max(10, cam.dist) * TP_PAN * 0.9);
        T.pinch = m; return;
      }
      const t = e.changedTouches[0]; if (!t) return;
      this.mouse.x = t.clientX; this.mouse.y = t.clientY;
      if (T.mode === 'tap' && Math.hypot(t.clientX - T.x0, t.clientY - T.y0) > 12) {
        clearTimeout(T.long);
        if (this.placing) T.mode = 'place';
        else if (this.boxMode && !this.targeting) { T.mode = 'box'; this.drag = { x0: T.x0, y0: T.y0, active: true }; }
        else T.mode = 'pan';
      }
      if (T.mode === 'place') { this.updateGhost(); return; }
      if (T.mode === 'pan') {
        this.pan(-(t.clientX - T.lx), (t.clientY - T.ly), Math.max(10, cam.dist) * TP_PAN * 0.9);
      } else if (T.mode === 'box') {
        this.onMove(fake(t.clientX, t.clientY, 0));
      }
      T.lx = t.clientX; T.ly = t.clientY;
    }, opts);
    const end = (e) => {
      e.preventDefault();
      clearTimeout(T.long);
      const t = e.changedTouches[0];
      for (const x of e.changedTouches) T.pts.delete(x.identifier);
      if (T.mode === 'pinch') { if (T.pts.size === 0) T.mode = null; return; }
      if (T.pts.size) return;
      const mode = T.mode; T.mode = null;
      if (!t || e.type === 'touchcancel') { this.endDrag(); return; }
      const x = t.clientX, y = t.clientY;
      if (mode === 'box') { this.onUp(fake(x, y, 0)); return; }
      if (mode === 'place') { this.onDown(fake(x, y, 0)); this.onUp(fake(x, y, 0)); return; }
      if (mode !== 'tap') return;
      this.app.audio?.resume?.();
      this.mouse.x = x; this.mouse.y = y;
      const now = performance.now();
      if (now - T.lastTap < 320 && Math.hypot(x - T.tx, y - T.ty) < 30) { T.lastTap = 0; this.onDbl(fake(x, y, 0)); return; }
      T.lastTap = now; T.tx = x; T.ty = y;
      this._tap(x, y, fake);
    };
    c.addEventListener('touchend', end, opts);
    c.addEventListener('touchcancel', end, opts);
  }
  _tap(x, y, fake) {
    if (!this.active) return;
    if (this.placing || this.targeting || this.flareArmed) { this.onDown(fake(x, y, 0)); this.onUp(fake(x, y, 0)); return; }
    const app = this.app, own = this.ownUnits();
    const target = this.ent(app.renderer.pick(x, y));
    const isOwnUnit = target && !target.dead && target.owner === this.me() && target.kind === 'unit';
    // own units selected and the tap is not on another own unit: that is an order (the desktop right click)
    if (own.length && !isOwnUnit) { this.contextCommand(fake(x, y, 2)); return; }
    this.drag = { x0: x, y0: y, active: false };
    this.onUp(fake(x, y, 0));
  }
  // the touch "Bırak" / "İptal" button shows while a placement/target tool is active or something is selected
  touchTick() {
    if (!this.dropBtn) return;
    const tool = !!(this.placing || this.targeting || this.flareArmed);
    const on = !!(this.touchMode && this.active && (tool || (this.app.selection && this.app.selection.length)));
    if (on !== this._dropOn) { this._dropOn = on; this.dropBtn.style.display = on ? 'block' : 'none'; }
    if (on && tool !== this._dropTool) {
      this._dropTool = tool;
      this.dropBtn.textContent = tool ? tr('İptal') : tr('Bırak');
      this.dropBtn.classList.toggle('cancel', tool);
    }
    const m = !!(this.touchMode && this.active);
    if (m !== this._modeOn) { this._modeOn = m; this.modeBtn.style.display = m ? 'block' : 'none'; }
  }
  // move the camera target by (mx right, mz forward) * sp on the ground, clamped to the map
  pan(mx, mz, sp) {
    const r = this.app.renderer, cam = r.cam;
    // derive ground-plane basis from the actual camera matrix (independent of yaw convention)
    const el = r.camera.matrixWorld.elements;
    let rx = el[0], rz = el[2];
    let fx = -el[8], fz = -el[10];
    if (Math.hypot(fx, fz) < 0.05) { fx = el[4]; fz = el[6]; }
    let l = Math.hypot(fx, fz) || 1; fx /= l; fz /= l;
    l = Math.hypot(rx, rz) || 1; rx /= l; rz /= l;
    cam.tx += (rx * mx + fx * mz) * sp;
    cam.tz += (rz * mx + fz * mz) * sp;
    const N = this.game.map.size;
    cam.tx = Math.max(0, Math.min(N, cam.tx));
    cam.tz = Math.max(0, Math.min(N, cam.tz));
  }
}
