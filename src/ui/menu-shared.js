// Aevum - Shared helpers for main menu v2 (?menu2) and v3 (?menu3) drafts.
// Neither flag is active on the live menu; without them the existing menu runs unchanged.
import { gchatPanel } from './gchat-ui.js';
import { ask } from './ask.js';
import { tr } from '../i18n.js';

function hasFlag(name) {
  try {
    const p = new URLSearchParams(location.search);
    return p.has(name) && p.get(name) !== '0';
  } catch { return false; }
}

export const MENU2 = hasFlag('menu2');
export const MENU3 = hasFlag('menu3');
export const MENU_DRAFT = MENU2 || MENU3;

export const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
export const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
};
export const htmlEl = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

export function ensureCss(id, href) {
  if (typeof document === 'undefined' || document.getElementById(id)) return;
  const link = document.createElement('link');
  link.id = id;
  link.rel = 'stylesheet';
  link.href = href;
  document.head.appendChild(link);
}

export function clickOf(ui, fn) {
  return () => {
    safe(() => ui._click());
    safe(() => ui.app.audio?.resume());
    fn();
  };
}

// Frame the live demo camera on player 0's Town Center (closer, higher pitch, 3/4 angle, slow yaw kept).
export function frameDemoCamera(ui, opts) {
  if (!ui.app.demo || !ui.app.renderer || !ui.app.renderer.cam) return;
  const g = ui.app.game;
  const tc = safe(() => g && g.buildingsOf && g.buildingsOf(0).find((b) => b.type === 'towncenter'), null);
  const p0 = g && g.players && g.players[0];
  const cam = ui.app.renderer.cam;
  const tx = tc ? tc.x : (p0 && p0.startX != null ? p0.startX : cam.tx);
  const tz = tc ? tc.z : (p0 && p0.startZ != null ? p0.startZ : cam.tz);
  cam.tx = tx;
  cam.tz = tz;
  cam.dist = (opts && opts.dist) || 31;
  cam.pitch = (opts && opts.pitch) || 0.96;
  if (ui._menuDraftFramedGame !== g) {
    cam.yaw = (opts && opts.yaw != null) ? opts.yaw : 0.55;
    ui._menuDraftFramedGame = g;
  }
  if (ui.app.renderer._c) {
    ui.app.renderer._c.tx = cam.tx;
    ui.app.renderer._c.tz = cam.tz;
    ui.app.renderer._c.dist = cam.dist;
    ui.app.renderer._c.pitch = cam.pitch;
    ui.app.renderer._c.yaw = cam.yaw;
  }
}

export async function confirmLogout(ui) {
  const cloud = ui.app.cloud;
  if (!cloud || !cloud.loggedIn) return;
  if (!(await ask({
    title: tr('Çıkış'),
    text: tr('Çıkış yapılsın mı?\nProfilin, maç geçmişin ve kayıtların hesabında kalır.'),
    ok: tr('Çıkış Yap'),
  }))) return;
  if (ui.app.game && !ui.app.demo) safe(() => ui.app.toMenu());
  cloud.logout();
  ui._menuMain(tr('Çıkış yapıldı.'));
}

// Shared inline SVG glyphs (matte, cozy, no external fonts or dependencies)
export const SVG_CREST = `<svg class="md-crest-svg" viewBox="0 0 44 26" aria-hidden="true">
  <path d="M22 2l2.2 6.5L22 24l-2.2-15.5z" fill="#e0be70"/>
  <path d="M18 10h8v2h-8z" fill="#b89448"/>
  <path d="M18 11C12 8 6 7 2 5c3 4 5 7 9 9-3 1-5 1-7 1 4 3 9 3 14 1z" fill="#cfa654"/>
  <path d="M26 11c6-3 12-4 16-6-3 4-5 7-9 9 3 1 5 1 7 1-4 3-9 3-14 1z" fill="#b89246"/>
</svg>`;

export const SVG_HOME = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4 3.5 10.6h2.3V20h4.7v-5.6h3V20h4.7v-9.4h2.3z"/></svg>`;
export const SVG_PLUS = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/></svg>`;
export const SVG_PLAY = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.8v14.4L19 12z"/></svg>`;
export const SVG_USER = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12zm0 2.2c-4.2 0-7.6 2.1-7.6 4.8v1h15.2v-1c0-2.7-3.4-4.8-7.6-4.8z"/></svg>`;
export const SVG_USERS = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M9 11.5a3.5 3.5 0 1 0-3.5-3.5A3.5 3.5 0 0 0 9 11.5zm6.5.5a3 3 0 1 0-3-3 3 3 0 0 0 3 3zM9 13.5c-3.4 0-6.2 1.7-6.2 4v1.5h12.4v-1.5c0-2.3-2.8-4-6.2-4zm6.5.5c-.6 0-1.2.1-1.8.3 1.4.9 2.3 2.1 2.3 3.7v1h5.2v-1.2c0-2.1-2.5-3.8-5.7-3.8z"/></svg>`;
export const SVG_STATS = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16v1.8H4zm2-2.2V11h3v5.8zm4.5 0V6h3v10.8zm4.5 0V9h3v7.8z"/></svg>`;
export const SVG_GEAR = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5a.5.5 0 0 0 .6.2l2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6zM12 15.4A3.4 3.4 0 1 1 15.4 12 3.4 3.4 0 0 1 12 15.4z"/></svg>`;
export const SVG_LOGOUT = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8v-2H6V6h8zm2.8 4.2-1.4 1.4 1.8 1.8H10v2h7.2l-1.8 1.8 1.4 1.4L21 12z"/></svg>`;
export const SVG_NEWS = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4.5 9.5 8.5H5a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 5 15.5h1.4l1.2 4h2.2l-1-4h.7L19 19.5a.8.8 0 0 0 1.1-.7V5.2a.8.8 0 0 0-1.1-.7z"/></svg>`;
export const SVG_GIFT = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-2.3A3 3 0 0 0 13 3.7L12 5l-1-1.3A3 3 0 0 0 6.3 7H4a1 1 0 0 0-1 1v3h18V8a1 1 0 0 0-1-1zm-5-2a1.2 1.2 0 0 1 0 2.4h-2.2L14 5.5a1.2 1.2 0 0 1 1-.5zm-6 0a1.2 1.2 0 0 1 1 .5l1.2 1.9H9A1.2 1.2 0 0 1 9 5zM4 13v7a1 1 0 0 0 1 1h6v-8zm9 0v8h6a1 1 0 0 0 1-1v-7z"/></svg>`;
export const SVG_CHAT = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.8 2 11.4c0 2.5 1.3 4.8 3.5 6.4L4.4 21l3.9-1.4c1.2.3 2.4.5 3.7.5 5.5 0 10-3.8 10-8.7S17.5 3 12 3zm-3.5 9.6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm3.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm3.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>`;
export const SVG_BOOK = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4a2 2 0 0 0-2 2v13a1 1 0 0 0 1.4.9A10 10 0 0 1 11 19V5.6A7.6 7.6 0 0 0 5 4zm14 0a7.6 7.6 0 0 0-6 1.6V19a10 10 0 0 1 6.6.9A1 1 0 0 0 21 19V6a2 2 0 0 0-2-2z"/></svg>`;
export const SVG_SEND = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 19.8 21 12 3.2 4.2 3 10.2 14.5 12 3 13.8z"/></svg>`;
export const SVG_BULB = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6.5 6.5 0 0 0-3.8 11.8c.7.5 1.1 1.3 1.2 2.2h5.2c.1-.9.5-1.7 1.2-2.2A6.5 6.5 0 0 0 12 3zm-2.5 15.5h5v1.3a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5z"/></svg>`;
export const SVG_CAL = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2V3h-2v2H9V3zm12 6v10H5V9z"/></svg>`;
export const SVG_BELL = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.5a2 2 0 0 0-2 2v.4A6 6 0 0 0 6 10.5v4.1l-1.6 2.1A1 1 0 0 0 5.2 18h13.6a1 1 0 0 0 .8-1.3L18 14.6v-4.1a6 6 0 0 0-4-5.6v-.4a2 2 0 0 0-2-2zm-2 17a2 2 0 0 0 4 0z"/></svg>`;
export const SVG_HELP = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 18h2v-2h-2v2zm1-14a5.5 5.5 0 0 0-5.5 5.5h2A3.5 3.5 0 1 1 12 13a1 1 0 0 0-1 1v1h2v-.4A5.5 5.5 0 0 0 12 4z"/></svg>`;
export const SVG_SWORDS = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6.2 3H3v3.2l7.1 7.1-2.2 2.2-1.4-1.4-1.4 1.4 2.1 2.1-2.4 2.4 1.4 1.4 2.4-2.4 2.1 2.1 1.4-1.4-1.4-1.4 2.2-2.2 2.2 2.2-1.4 1.4 1.4 1.4 2.1-2.1 2.4 2.4 1.4-1.4-2.4-2.4 2.1-2.1-1.4-1.4-1.4 1.4-2.2-2.2L21 6.2V3h-3.2L12 8.8z"/></svg>`;
export const SVG_SCROLL = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M6 3a2.5 2.5 0 0 0-2.5 2.5V7h2v11.5A2.5 2.5 0 0 0 8 21h9.5a2.5 2.5 0 0 0 2.5-2.5V17h-2V5.5A2.5 2.5 0 0 0 15.5 3zm2.5 4h7v2h-7zm0 4h7v2h-7zm0 4h5v2h-5z"/></svg>`;

// Build & decorate the shared Genel Sohbet panel for menu2 / menu3.
// opts: { cls, titleWrapCls, icoCls, rulesIcoCls, sendIcoCls, iconOnlySend }
export function buildMenuChat(ui, opts = {}) {
  const gc = gchatPanel(ui, { colorNames: true });
  if (!gc) return null;
  if (opts.cls) gc.classList.add(opts.cls);
  const head = gc.querySelector('.gc-head');
  if (head) {
    const ttl = head.querySelector('.gc-title');
    if (ttl) {
      const wrap = h('span', opts.titleWrapCls || '');
      wrap.append(htmlEl('span', opts.icoCls || '', SVG_CHAT), ttl);
      head.prepend(wrap);
    }
    const rb = head.querySelector('.gc-rbtn');
    if (rb) rb.prepend(htmlEl('span', opts.rulesIcoCls || '', SVG_BOOK));
  }
  const go = gc.querySelector('.gc-go');
  if (go) {
    if (opts.iconOnlySend) {
      go.setAttribute('aria-label', tr('Gönder'));
      go.title = tr('Gönder');
      go.innerHTML = `<span class="${opts.sendIcoCls || ''}">${SVG_SEND}</span>`;
    } else {
      go.prepend(htmlEl('span', opts.sendIcoCls || '', SVG_SEND));
    }
  }
  return gc;
}
