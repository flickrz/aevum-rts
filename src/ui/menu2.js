// Aevum - Main Menu v2 draft (?menu2): matte cozy desktop layout around the live village demo.
// Separate from the live menu code path; only entered from UI._menuMain when ?menu2 is in the URL.
import { levelOf } from '../rank.js';
import { avatarEl, tpText, loginScreen, googleBlock } from './cloud-ui.js';
import { newsBox } from './news-ui.js';
import { gchatPanel } from './gchat-ui.js';
import { menuUpdates, hasUnseen } from './updates-ui.js';
import { interruptedEntry } from './notice-ui.js';
import { CHANGELOG } from '../changelog.js';
import { ask } from './ask.js';
import { ico } from '../icons.js';
import { tr } from '../i18n.js';

export const MENU2 = (() => {
  try {
    const p = new URLSearchParams(location.search);
    return p.has('menu2') && p.get('menu2') !== '0';
  } catch { return false; }
})();

const CSS_ID = 'aevum-menu2-css';
const safe = (fn, fb) => { try { return fn(); } catch (e) { console.warn(e); return fb; } };
const h = (tag, cls, text) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = String(text);
  return e;
};
const htmlEl = (tag, cls, html) => {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html != null) e.innerHTML = html;
  return e;
};

function ensureCss() {
  if (typeof document === 'undefined' || document.getElementById(CSS_ID)) return;
  const link = document.createElement('link');
  link.id = CSS_ID;
  link.rel = 'stylesheet';
  link.href = new URL('./menu2.css', import.meta.url).href;
  document.head.appendChild(link);
}

// ---------- inline SVG ornaments & UI glyphs (matte, cozy, zero external assets) ----------
const SVG_CREST = `<svg class="m2-crest-svg" viewBox="0 0 44 26" aria-hidden="true">
  <path d="M22 2l2.2 6.5L22 24l-2.2-15.5z" fill="#e0be70"/>
  <path d="M18 10h8v2h-8z" fill="#b89448"/>
  <path d="M18 11C12 8 6 7 2 5c3 4 5 7 9 9-3 1-5 1-7 1 4 3 9 3 14 1z" fill="#cfa654"/>
  <path d="M26 11c6-3 12-4 16-6-3 4-5 7-9 9 3 1 5 1 7 1-4 3-9 3-14 1z" fill="#b89246"/>
</svg>`;

const SVG_TORCH = `<svg class="m2-torch-svg" viewBox="0 0 28 46" aria-hidden="true">
  <g class="m2-flame">
    <path d="M14 3c4 6 7 10 6 15a6 6 0 0 1-12 0c0-5 2-9 6-15z" fill="#e88a32"/>
    <path d="M14 8c2.6 4 4.2 6.5 3.6 9.8a3.6 3.6 0 0 1-7.2 0C9.8 14.5 11.4 12 14 8z" fill="#f7cb66"/>
    <ellipse cx="14" cy="18.5" rx="2" ry="2.6" fill="#fff2c2"/>
  </g>
  <path d="M8 23h12l-2 5H10z" fill="#6b5636" stroke="#a6884c" stroke-width="1"/>
  <rect x="12" y="28" width="4" height="14" rx="1.5" fill="#4f3e27"/>
  <path d="M10 34h8v2.5h-8z" fill="#8c7240"/>
  <path d="M11 42h6l-1 3h-4z" fill="#6b5636"/>
</svg>`;

const SVG_HOME = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3.4 3.5 10.6h2.3V20h4.7v-5.6h3V20h4.7v-9.4h2.3z"/></svg>`;
const SVG_PLUS = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M11 4h2v7h7v2h-7v7h-2v-7H4v-2h7z"/></svg>`;
const SVG_PLAY = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7.5 4.8v14.4L19 12z"/></svg>`;
const SVG_USER = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 12a4.5 4.5 0 1 0-4.5-4.5A4.5 4.5 0 0 0 12 12zm0 2.2c-4.2 0-7.6 2.1-7.6 4.8v1h15.2v-1c0-2.7-3.4-4.8-7.6-4.8z"/></svg>`;
const SVG_STATS = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 19h16v1.8H4zm2-2.2V11h3v5.8zm4.5 0V6h3v10.8zm4.5 0V9h3v7.8z"/></svg>`;
const SVG_GEAR = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19.4 13a7.9 7.9 0 0 0 .1-1 7.9 7.9 0 0 0-.1-1l2.1-1.6a.5.5 0 0 0 .1-.6l-2-3.5a.5.5 0 0 0-.6-.2l-2.5 1a7.4 7.4 0 0 0-1.7-1l-.4-2.6a.5.5 0 0 0-.5-.4h-4a.5.5 0 0 0-.5.4l-.4 2.6a7.4 7.4 0 0 0-1.7 1l-2.5-1a.5.5 0 0 0-.6.2l-2 3.5a.5.5 0 0 0 .1.6L4.6 11a7.9 7.9 0 0 0-.1 1 7.9 7.9 0 0 0 .1 1l-2.1 1.6a.5.5 0 0 0-.1.6l2 3.5a.5.5 0 0 0 .6.2l2.5-1a7.4 7.4 0 0 0 1.7 1l.4 2.6a.5.5 0 0 0 .5.4h4a.5.5 0 0 0 .5-.4l.4-2.6a7.4 7.4 0 0 0 1.7-1l2.5 1a.5.5 0 0 0 .6-.2l2-3.5a.5.5 0 0 0-.1-.6zM12 15.4A3.4 3.4 0 1 1 15.4 12 3.4 3.4 0 0 1 12 15.4z"/></svg>`;
const SVG_LOGOUT = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M14 4H6a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h8v-2H6V6h8zm2.8 4.2-1.4 1.4 1.8 1.8H10v2h7.2l-1.8 1.8 1.4 1.4L21 12z"/></svg>`;
const SVG_NEWS = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M19 4.5 9.5 8.5H5a1.5 1.5 0 0 0-1.5 1.5v4A1.5 1.5 0 0 0 5 15.5h1.4l1.2 4h2.2l-1-4h.7L19 19.5a.8.8 0 0 0 1.1-.7V5.2a.8.8 0 0 0-1.1-.7z"/></svg>`;
const SVG_GIFT = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M20 7h-2.3A3 3 0 0 0 13 3.7L12 5l-1-1.3A3 3 0 0 0 6.3 7H4a1 1 0 0 0-1 1v3h18V8a1 1 0 0 0-1-1zm-5-2a1.2 1.2 0 0 1 0 2.4h-2.2L14 5.5a1.2 1.2 0 0 1 1-.5zm-6 0a1.2 1.2 0 0 1 1 .5l1.2 1.9H9A1.2 1.2 0 0 1 9 5zM4 13v7a1 1 0 0 0 1 1h6v-8zm9 0v8h6a1 1 0 0 0 1-1v-7z"/></svg>`;
const SVG_CHAT = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3C6.5 3 2 6.8 2 11.4c0 2.5 1.3 4.8 3.5 6.4L4.4 21l3.9-1.4c1.2.3 2.4.5 3.7.5 5.5 0 10-3.8 10-8.7S17.5 3 12 3zm-3.5 9.6a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm3.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4zm3.5 0a1.2 1.2 0 1 1 0-2.4 1.2 1.2 0 0 1 0 2.4z"/></svg>`;
const SVG_BOOK = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 4a2 2 0 0 0-2 2v13a1 1 0 0 0 1.4.9A10 10 0 0 1 11 19V5.6A7.6 7.6 0 0 0 5 4zm14 0a7.6 7.6 0 0 0-6 1.6V19a10 10 0 0 1 6.6.9A1 1 0 0 0 21 19V6a2 2 0 0 0-2-2z"/></svg>`;
const SVG_SEND = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M3.2 19.8 21 12 3.2 4.2 3 10.2 14.5 12 3 13.8z"/></svg>`;
const SVG_BULB = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3a6.5 6.5 0 0 0-3.8 11.8c.7.5 1.1 1.3 1.2 2.2h5.2c.1-.9.5-1.7 1.2-2.2A6.5 6.5 0 0 0 12 3zm-2.5 15.5h5v1.3a1.5 1.5 0 0 1-1.5 1.5h-2a1.5 1.5 0 0 1-1.5-1.5z"/></svg>`;
const SVG_CAL = `<svg class="m2-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M7 3v2H5a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V7a2 2 0 0 0-2-2h-2V3h-2v2H9V3zm12 6v10H5V9z"/></svg>`;

// Hero card illustration: cozy matte twilight landscape (distant castle, rolling hills, bannerman & soldiers)
const SVG_HERO_ART = `<svg class="m2-hero-svg" viewBox="0 0 320 156" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <linearGradient id="m2sky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#3c4460"/>
      <stop offset="48%" stop-color="#8b6b5c"/>
      <stop offset="82%" stop-color="#d89d60"/>
      <stop offset="100%" stop-color="#e5ba78"/>
    </linearGradient>
    <linearGradient id="m2fade" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171b24" stop-opacity="0"/>
      <stop offset="68%" stop-color="#171b24" stop-opacity="0.18"/>
      <stop offset="100%" stop-color="#171b24" stop-opacity="0.96"/>
    </linearGradient>
  </defs>
  <rect width="320" height="156" fill="url(#m2sky)"/>
  <circle cx="96" cy="72" r="24" fill="#f2cf88" opacity="0.55"/>
  <circle cx="96" cy="72" r="14" fill="#fadfa2" opacity="0.72"/>
  <path d="M0 96 L48 76 L108 92 L166 72 L228 84 L282 64 L320 74 L320 156 L0 156 Z" fill="#50526c"/>
  <path d="M0 112 L62 94 L126 106 L194 82 L254 88 L320 96 L320 156 L0 156 Z" fill="#3a3f54"/>
  <!-- distant hilltop castle on the right -->
  <g fill="#45475e">
    <rect x="218" y="54" width="12" height="36"/>
    <polygon points="216,54 224,38 232,54"/>
    <rect x="234" y="42" width="16" height="48"/>
    <polygon points="232,42 242,22 252,42"/>
    <rect x="252" y="56" width="14" height="34"/>
    <polygon points="250,56 259,40 268,56"/>
    <rect x="206" y="66" width="66" height="24"/>
    <rect x="206" y="61" width="6" height="5"/><rect x="216" y="61" width="6" height="5"/>
    <rect x="266" y="61" width="6" height="5"/>
  </g>
  <!-- warm castle window specks -->
  <g fill="#e8be6c" opacity="0.85">
    <rect x="240" y="52" width="2.5" height="4"/><rect x="223" y="62" width="2" height="3.5"/>
    <rect x="258" y="64" width="2" height="3.5"/>
  </g>
  <!-- pine trees along midground -->
  <g fill="#262c3a">
    <polygon points="154,108 161,86 168,108"/>
    <polygon points="164,110 172,82 180,110"/>
    <polygon points="178,108 184,90 190,108"/>
    <polygon points="274,104 282,78 290,104"/>
    <polygon points="288,108 298,74 308,108"/>
    <polygon points="304,110 314,82 324,110"/>
  </g>
  <!-- foreground hill -->
  <path d="M0 110 Q74 96 146 116 T320 112 L320 156 L0 156 Z" fill="#1e2430"/>
  <!-- bannerman and companions on the left ridge -->
  <g fill="#161a24">
    <!-- left scout with spear -->
    <circle cx="38" cy="84" r="4"/>
    <path d="M33 89 L43 89 L45 107 L41 122 L38 122 L37 109 L35 122 L32 122 L32 105 Z"/>
    <rect x="27" y="64" width="2" height="54" transform="rotate(-8 28 90)"/>
    <!-- central standard bearer -->
    <circle cx="67" cy="74" r="5"/>
    <path d="M58 80 L76 80 L79 106 L74 124 L69 124 L67 108 L64 124 L59 124 L57 104 Z"/>
    <path d="M58 82 L50 106 L58 106 Z"/>
    <!-- flagpole & crimson banner -->
    <rect x="86" y="22" width="2.6" height="94" transform="rotate(8 87 70)"/>
    <path d="M92 26 Q114 28 134 38 L122 46 L132 54 Q110 52 89 48 Z" fill="#6b2326"/>
    <polygon points="107,36 110,41 115,41 111,44 112,49 107,46 102,49 103,44 99,41 104,41" fill="#d8b05c"/>
    <!-- third soldier on right -->
    <circle cx="114" cy="88" r="3.8"/>
    <path d="M109 93 L119 93 L121 109 L117 124 L114 124 L113 111 L111 124 L108 124 L108 107 Z"/>
    <rect x="122" y="70" width="1.8" height="46" transform="rotate(6 123 93)"/>
  </g>
  <rect width="320" height="156" fill="url(#m2fade)"/>
</svg>`;

// Subtle twilight silhouette for the bottom of the left hanging nav banner
const SVG_NAV_ART = `<svg class="m2-nav-art-svg" viewBox="0 0 210 110" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs>
    <linearGradient id="m2nsky" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#171b24" stop-opacity="1"/>
      <stop offset="42%" stop-color="#2a2d3d" stop-opacity="0.7"/>
      <stop offset="100%" stop-color="#6e5340" stop-opacity="0.55"/>
    </linearGradient>
  </defs>
  <rect width="210" height="110" fill="url(#m2nsky)"/>
  <path d="M0 78 L54 58 L112 72 L164 52 L210 66 L210 110 L0 110 Z" fill="#252a38"/>
  <g fill="#1b202c">
    <rect x="26" y="42" width="10" height="34"/>
    <polygon points="24,42 31,30 38,42"/>
    <rect x="38" y="34" width="14" height="42"/>
    <polygon points="36,34 45,20 54,34"/>
    <rect x="54" y="46" width="10" height="30"/>
    <rect x="20" y="54" width="50" height="24"/>
  </g>
  <path d="M0 84 Q70 72 135 88 T210 80 L210 110 L0 110 Z" fill="#141821"/>
  <g fill="#11151d">
    <polygon points="150,94 157,72 164,94"/>
    <polygon points="164,96 173,68 182,96"/>
    <polygon points="182,98 192,72 202,98"/>
  </g>
</svg>`;

function frameDemoCamera(ui) {
  if (!ui.app.demo || !ui.app.renderer || !ui.app.renderer.cam) return;
  const g = ui.app.game;
  const tc = safe(() => g && g.buildingsOf && g.buildingsOf(0).find((b) => b.type === 'towncenter'), null);
  const p0 = g && g.players && g.players[0];
  const cam = ui.app.renderer.cam;
  const tx = tc ? tc.x : (p0 && p0.startX != null ? p0.startX : cam.tx);
  const tz = tc ? tc.z : (p0 && p0.startZ != null ? p0.startZ : cam.tz);
  cam.tx = tx;
  cam.tz = tz;
  cam.dist = 31;
  cam.pitch = 0.96;
  if (ui._m2FramedGame !== g) {
    cam.yaw = 0.55;
    ui._m2FramedGame = g;
  }
  if (ui.app.renderer._c) {
    ui.app.renderer._c.tx = cam.tx;
    ui.app.renderer._c.tz = cam.tz;
    ui.app.renderer._c.dist = cam.dist;
    ui.app.renderer._c.pitch = cam.pitch;
    ui.app.renderer._c.yaw = cam.yaw;
  }
}

export function menu2Main(ui, note) {
  if (!ui._signedIn()) { loginScreen(ui); if (note) ui._menuNote(note); return; }
  ensureCss();
  frameDemoCamera(ui);

  ui.menuEl.innerHTML = '';
  ui.menuEl.classList.remove('with-hud', 'm-left');

  const cloud = ui.app.cloud;
  const prof = safe(() => ui.app.getProfile(), null);
  const root = h('div', 'm2-root');

  const click = (fn) => () => {
    safe(() => ui._click());
    safe(() => ui.app.audio?.resume());
    fn();
  };

  // ==================== TOP BAR ====================
  const topbar = h('header', 'm2-topbar');

  // -- Left: player plate (reuses avatarEl, levelOf, tpText, cloud.onChange) --
  const plate = h('button', 'm2-player');
  plate.type = 'button';
  plate.title = tr('Profil');
  plate.onclick = click(() => import('./profile-ui.js').then((m) => m.menuProfile(ui)));

  const avWrap = h('span', 'm2-avwrap');
  avWrap.append(avatarEl(prof ? prof.avatar : null, prof ? prof.uid : '', 'm2-av'));

  const pInfo = h('span', 'm2-pinfo');
  const pName = h('span', 'm2-pname', (prof && prof.name) || tr('Oyuncu'));
  const pRank = h('span', 'm2-prank');
  const tpRow = h('span', 'm2-tprow');
  const tpBar = h('span', 'm2-tpbar');
  const tpFill = document.createElement('i');
  tpBar.append(tpFill);
  const tpNums = h('span', 'm2-tpnums');
  tpRow.append(tpBar, tpNums);
  pInfo.append(pName, pRank, tpRow);
  plate.append(avWrap, pInfo);

  const drawPlayer = () => {
    const curProf = safe(() => ui.app.getProfile(), prof);
    if (curProf && curProf.name) pName.textContent = curProf.name;
    const tpVal = cloud && cloud.loggedIn && cloud.tp ? cloud.tp.tp : 0;
    const L = levelOf(tpVal);
    pRank.textContent = tr('Seviye {0} · {1}', L.level, L.rank);
    tpFill.style.width = Math.round(L.frac * 100) + '%';
    tpNums.textContent = tpText(L.tp) + ' / ' + tpText(L.next);
  };
  drawPlayer();
  if (cloud && typeof cloud.onChange === 'function') {
    const off = cloud.onChange(() => { if (!root.isConnected) { off(); return; } drawPlayer(); });
  }

  // -- Center: hanging dark red banner + two small torches --
  const crestWrap = h('div', 'm2-center-crest');
  const torchL = htmlEl('span', 'm2-torch m2-torch-l', SVG_TORCH);
  const torchR = htmlEl('span', 'm2-torch m2-torch-r', SVG_TORCH);
  const banner = h('div', 'm2-banner');
  const bannerBody = h('div', 'm2-banner-body');
  bannerBody.append(
    htmlEl('div', 'm2-crest-emblem', SVG_CREST),
    h('div', 'm2-logo', 'AEVUM'),
    h('div', 'm2-tagline', '✦ ' + tr('Çağları aş · Uygarlığını kur') + ' ✦')
  );
  const bannerTip = htmlEl('div', 'm2-banner-tip',
    '<svg viewBox="0 0 280 28" preserveAspectRatio="none" aria-hidden="true">' +
    '<polygon points="0,0 280,0 140,26" fill="#471719"/>' +
    '<polyline points="2,0 140,25 278,0" fill="none" stroke="#9e8045" stroke-width="2.2"/>' +
    '<polyline points="9,0 140,21 271,0" fill="none" stroke="rgba(224,190,112,0.35)" stroke-width="1"/>' +
    '</svg>');
  banner.append(bannerBody, bannerTip);
  crestWrap.append(torchL, banner, torchR);

  // -- Right: icon tabs (Profil, [İstatistikler for owner], Ayarlar, Çıkış) --
  const tabs = h('nav', 'm2-top-tabs');
  tabs.setAttribute('aria-label', tr('Profil'));
  const makeTab = (svgHtml, label, fn, cls = '') => {
    const b = h('button', 'm2-tab' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.innerHTML = `<span class="m2-tab-ico">${svgHtml}</span><span class="m2-tab-lbl"></span>`;
    b.querySelector('.m2-tab-lbl').textContent = label;
    b.onclick = click(fn);
    return b;
  };
  const tabProf = makeTab(SVG_USER, tr('Profil'), () => import('./profile-ui.js').then((m) => m.menuProfile(ui)));
  const tabSet = makeTab(SVG_GEAR, tr('Ayarlar'), () => ui._menuSettings());
  const tabOut = makeTab(SVG_LOGOUT, tr('Çıkış'), async () => {
    if (!cloud || !cloud.loggedIn) return;
    if (!(await ask({ title: tr('Çıkış'), text: tr('Çıkış yapılsın mı?\nProfilin, maç geçmişin ve kayıtların hesabında kalır.'), ok: tr('Çıkış Yap') }))) return;
    if (ui.app.game && !ui.app.demo) safe(() => ui.app.toMenu());
    cloud.logout();
    ui._menuMain(tr('Çıkış yapıldı.'));
  }, 'm2-tab-out');
  if (!cloud || !cloud.loggedIn) tabOut.disabled = true;

  tabs.append(tabProf, tabSet, tabOut);
  Promise.resolve(safe(() => cloud && cloud.isOwner(), false)).then((own) => {
    if (!own || !tabs.isConnected) return;
    const tabStats = makeTab(SVG_STATS, tr('İstatistikler'), () => import('./stats-ui.js').then((m) => m.menuStats(ui)));
    tabs.insertBefore(tabStats, tabSet);
  }).catch(() => {});

  topbar.append(plate, crestWrap, tabs);

  // ==================== MAIN BODY ====================
  const body = h('div', 'm2-body');

  // -- Left: tall hanging banner navigation --
  const navCol = h('aside', 'm2-nav-col');
  const navBanner = h('div', 'm2-nav-banner');
  const navCrest = htmlEl('div', 'm2-nav-crest',
    '<div class="m2-nav-pennant">' +
    '<svg class="m2-pennant-bg" viewBox="0 0 64 52" preserveAspectRatio="none" aria-hidden="true">' +
    '<polygon points="1,0 63,0 63,38 32,51 1,38" fill="#471719"/>' +
    '<polyline points="1,0 1,38 32,51 63,38 63,0" fill="none" stroke="#9e8045" stroke-width="1.8"/>' +
    '</svg>' + SVG_CREST + '</div>');
  const navList = h('nav', 'm2-nav-list');

  const navItem = (iconHtml, label, fn, opts = {}) => {
    const b = h('button', 'm2-nav-item' + (opts.active ? ' m2-active' : '') + (opts.cls ? ' ' + opts.cls : ''));
    b.type = 'button';
    b.innerHTML = `<span class="m2-nav-ico">${iconHtml}</span><span class="m2-nav-txt"></span>`;
    b.querySelector('.m2-nav-txt').textContent = label;
    if (opts.meta != null) {
      const m = h('span', 'm2-nav-meta', opts.meta);
      b.append(m);
    }
    b.onclick = click(fn);
    navList.append(b);
    return b;
  };

  navItem(SVG_HOME, tr('Ana Sayfa'), () => {}, { active: true });
  if (ui.game && !ui.game.over && !ui.app.demo && !ui.app.net) {
    navItem(ico('x-speed'), tr('Oyuna Dön'), () => { ui.showHUD(); ui.app.setPaused?.(false); }, { cls: 'm2-nav-resume' });
  }
  navItem(SVG_PLUS, tr('Yeni Oyun'), () => ui._menuSetup());
  const multiBtn = navItem(ico('x-ally'), tr('Çok Oyunculu'), () => ui._menuMulti());
  safe(() => interruptedEntry(ui, navList, multiBtn));
  navItem(ico('u-villager'), tr('Arkadaşlar'), () => import('./friends-ui.js').then((m) => m.menuFriends(ui)));
  navItem(ico('x-build'), tr('Sandbox'), () => ui.app.newGame({ mapSize: 256, enemies: 1, difficulty: 'normal', startRes: 'high', startAge: 0, sandbox: true, seed: (Math.random() * 1e9) | 0 }));
  const contBtn = navItem(SVG_PLAY, tr('Devam Et'), () => Promise.resolve(safe(() => ui.app.continueLast(), false)).then((ok) => {
    if (!ok && ui.app.lastLoadError && ui.mode === 'menu') ui._menuSaves(ui.app.lastLoadError);
  }).catch(() => {}), { meta: '' });
  const savesBtn = navItem(ico('x-save'), tr('Kayıtlı Oyunlar'), () => ui._menuSaves(), { meta: '' });

  contBtn.disabled = true;
  Promise.resolve(safe(() => ui.app.listSaves(), [])).then((l) => {
    if (!navList.isConnected) return;
    const n = (l && l.length) | 0;
    contBtn.disabled = !n;
    contBtn.title = n ? tr('son kayıttan') : tr('kayıt yok');
    const sm = savesBtn.querySelector('.m2-nav-meta');
    if (sm) sm.textContent = n ? String(n) : '';
  }).catch(() => {});

  navList.append(h('div', 'm2-nav-sep'));
  navItem(ico('x-quests'), tr('Nasıl Oynanır'), () => ui._menuHowto(), { cls: 'm2-nav-sub' });

  const navArt = htmlEl('div', 'm2-nav-art', SVG_NAV_ART);
  const navTip = htmlEl('div', 'm2-nav-tip',
    '<svg viewBox="0 0 210 26" preserveAspectRatio="none" aria-hidden="true">' +
    '<polygon points="0,0 210,0 105,24" fill="#171b24"/>' +
    '<polyline points="1,0 105,23 209,0" fill="none" stroke="#967a42" stroke-width="2"/>' +
    '</svg>');

  navBanner.append(navCrest, navList, navArt, navTip);
  navCol.append(navBanner);

  // -- Middle-left: Duyurular + Yeni Oyun Hero + Güncellemeler cards --
  const cardsCol = h('section', 'm2-cards-col');

  if (note) {
    const nEl = h('div', 'm2-note', String(note));
    nEl.setAttribute('role', 'status');
    cardsCol.append(nEl);
  }
  if (cloud && cloud.loggedIn && cloud.status === 'expired') {
    const exp = h('div', 'm2-card m2-expired');
    exp.append(h('div', 'mperr', tr('Oturumun sona erdi: aynı Google hesabıyla tekrar giriş yap.')), googleBlock(ui, { small: true }));
    cardsCol.append(exp);
  }

  // 1) Duyurular card (reuses newsBox with { embedded: true })
  safe(() => {
    const nb = newsBox(ui, { embedded: true });
    if (!nb) return;
    nb.classList.add('m2-news');
    const head = nb.querySelector('.news-head');
    if (head) {
      head.prepend(htmlEl('span', 'm2-card-ico', SVG_NEWS));
      head.append(h('span', 'm2-head-chev', '›'));
    }
    const dt = nb.querySelector('.news-date');
    if (dt) dt.prepend(htmlEl('span', 'm2-date-ico', SVG_CAL));
    cardsCol.append(nb);
  });

  // 2) Yeni Oyun Hero card
  const hero = h('div', 'm2-card m2-hero');
  const heroArt = htmlEl('div', 'm2-hero-art', SVG_HERO_ART);
  const heroBody = h('div', 'm2-hero-body');
  heroBody.append(
    h('div', 'm2-hero-title', tr('Yeni Oyun')),
    h('p', 'm2-hero-desc', tr('Harita ve ayarları belirle, uygarlığını kurmaya başla.'))
  );
  const cta = h('button', 'm2-cta');
  cta.type = 'button';
  cta.append(h('span', '', tr('Yeni Oyun Başlat')), h('span', 'm2-cta-chev', '›'));
  cta.onclick = click(() => ui._menuSetup());
  heroBody.append(cta);
  hero.append(heroArt, heroBody);
  cardsCol.append(hero);

  // 3) Güncellemeler card
  const upd = h('button', 'm2-card m2-updates');
  upd.type = 'button';
  upd.onclick = click(() => menuUpdates(ui));
  const updHead = h('div', 'm2-upd-head');
  updHead.append(htmlEl('span', 'm2-card-ico', SVG_GIFT), h('span', 'm2-upd-lbl', tr('Güncellemeler')));
  if (hasUnseen()) updHead.append(h('span', 'm2-badge', tr('Yeni')));
  else if (CHANGELOG && CHANGELOG[0]) updHead.append(h('span', 'm2-ver', 'v' + CHANGELOG[0].v));
  const updSub = h('div', 'm2-upd-sub');
  const updLine = (CHANGELOG && CHANGELOG[0] && CHANGELOG[0].title) ? tr(CHANGELOG[0].title) : tr('Oyun sizlerle hızla gelişiyor.');
  updSub.append(h('span', 'm2-upd-txt', updLine), h('span', 'm2-head-chev', '›'));
  upd.append(updHead, updSub);
  cardsCol.append(upd);

  // -- Center: open live village spacer --
  const stage = h('div', 'm2-stage');
  stage.setAttribute('aria-hidden', 'true');

  // -- Right: Genel Sohbet (reuses gchatPanel with { colorNames: true }) --
  const chatCol = h('div', 'm2-chat-col');
  safe(() => {
    const gc = gchatPanel(ui, { colorNames: true });
    if (!gc) return;
    gc.classList.add('m2-chat');
    const head = gc.querySelector('.gc-head');
    if (head) {
      const titleWrap = h('span', 'm2-chat-titlewrap');
      const ttl = head.querySelector('.gc-title');
      if (ttl) {
        titleWrap.append(htmlEl('span', 'm2-card-ico', SVG_CHAT), ttl);
        head.prepend(titleWrap);
      }
      const rb = head.querySelector('.gc-rbtn');
      if (rb) rb.prepend(htmlEl('span', 'm2-rules-ico', SVG_BOOK));
    }
    const go = gc.querySelector('.gc-go');
    if (go) go.prepend(htmlEl('span', 'm2-send-ico', SVG_SEND));
    chatCol.append(gc);
  });

  body.append(navCol, cardsCol, stage, chatCol);

  // ==================== BOTTOM-LEFT FEEDBACK BAR ====================
  const fb = htmlEl('div', 'm2-fb',
    `<span class="m2-fb-ico" aria-hidden="true">${SVG_BULB}</span>` +
    `<span class="m2-fb-txt">${tr('Hata mı buldun, önerin mi var? <b>Buraya tıkla ve yaz</b>, ya da oyunda <kbd>Enter</kbd> ile sohbeti açıp <b class="cmention">@claude</b> yaz; doğrudan geliştiriciye gider.')}</span>`);
  fb.setAttribute('role', 'button');
  fb.tabIndex = 0;
  fb.addEventListener('click', click(() => ui._fbBox()));
  fb.addEventListener('keydown', (ev) => {
    if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); click(() => ui._fbBox())(); }
  });

  root.append(topbar, body, fb);
  ui.menuEl.append(root);
}

export default { MENU2, menu2Main };
