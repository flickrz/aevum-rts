// Aevum - Main Menu v3 draft (?menu3), after the owner's mockup (2026-11-27): a top bar (logo left, a few tabs in a
// framed group, round icon buttons right), a left column (player card on a red banner, Duyurular, the big gold
// "Yeni Oyun", the play list as framed cards), the live village in the middle ringed by a dark forest vignette, the
// Genel Sohbet on the right and a slim tip bar at the bottom. Off without ?menu3; reuses newsBox / gchatPanel.
import { levelOf } from '../rank.js';
import { avatarEl, tpText, loginScreen, googleBlock } from './cloud-ui.js';
import { newsBox, hasUnreadNews, openNews } from './news-ui.js';
import { menuUpdates, hasUnseen } from './updates-ui.js';
import { interruptedEntry } from './notice-ui.js';
import { ico } from '../icons.js';
import { tr } from '../i18n.js';
import {
  MENU3, safe, h, htmlEl, ensureCss, clickOf, frameDemoCamera, confirmLogout, buildMenuChat,
  SVG_PLAY, SVG_USER, SVG_USERS, SVG_STATS, SVG_GEAR, SVG_LOGOUT,
  SVG_NEWS, SVG_BULB, SVG_BELL, SVG_HELP, SVG_SWORDS, SVG_SCROLL,
} from './menu-shared.js';

export { MENU3 };

const CSS_ID = 'aevum-menu3-css';
const FONT_ID = 'aevum-menu3-font';
const TIP_KEY = 'aevum.m3TipClosed';

// gold laurel branches beside the logo (inline SVG, mirrored for the right one)
const laurel = (cls) => `<svg class="m3-laurel ${cls}" viewBox="0 0 40 40" aria-hidden="true">
  <path d="M33 37C18 33 8 22 6 4" fill="none" stroke="#b08b45" stroke-width="1.6" stroke-linecap="round"/>
  <g fill="#c9a256">
    <ellipse cx="7" cy="9" rx="5" ry="2" transform="rotate(-80 7 9)"/>
    <ellipse cx="9" cy="16" rx="5.4" ry="2.1" transform="rotate(-62 9 16)"/>
    <ellipse cx="13" cy="23" rx="5.6" ry="2.2" transform="rotate(-44 13 23)"/>
    <ellipse cx="19" cy="29" rx="5.6" ry="2.2" transform="rotate(-28 19 29)"/>
    <ellipse cx="26" cy="34" rx="5.4" ry="2.1" transform="rotate(-12 26 34)"/>
  </g>
  <g fill="#a88440">
    <ellipse cx="13" cy="11" rx="4.4" ry="1.8" transform="rotate(10 13 11)"/>
    <ellipse cx="17" cy="18" rx="4.6" ry="1.9" transform="rotate(24 17 18)"/>
    <ellipse cx="23" cy="24.5" rx="4.6" ry="1.9" transform="rotate(38 23 24.5)"/>
  </g>
</svg>`;

// a faint castle on a hill, drawn on the right of every play card (as in the mockup)
const SVG_ITEM_ART = `<svg viewBox="0 0 200 64" preserveAspectRatio="xMaxYMax meet" aria-hidden="true">
  <path d="M40 64 L78 44 L104 52 L132 36 L170 48 L200 42 L200 64 Z" fill="currentColor" opacity=".55"/>
  <g fill="currentColor">
    <rect x="120" y="22" width="7" height="22"/><polygon points="118.5,22 123.5,12 128.5,22"/>
    <rect x="130" y="14" width="10" height="30"/><polygon points="128.5,14 135,2 141.5,14"/>
    <rect x="143" y="24" width="7" height="20"/><polygon points="141.5,24 146.5,15 151.5,24"/>
    <rect x="112" y="32" width="46" height="14"/>
    <rect x="112" y="29" width="4" height="3"/><rect x="120" y="29" width="4" height="3"/><rect x="154" y="29" width="4" height="3"/>
    <polygon points="160,64 166,46 172,64"/><polygon points="170,64 177,40 184,64"/><polygon points="182,64 188,48 194,64"/>
    <polygon points="86,64 92,48 98,64"/><polygon points="96,64 102,44 108,64"/>
  </g>
</svg>`;

// the dark castle and pines at the foot of the left column
const SVG_COL_CASTLE = `<svg class="m3-col-art-svg" viewBox="0 0 440 150" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <defs><linearGradient id="m3sky" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#d9a55a" stop-opacity="0"/><stop offset=".7" stop-color="#c98d44" stop-opacity=".28"/><stop offset="1" stop-color="#8a5a2a" stop-opacity=".1"/></linearGradient></defs>
  <rect x="0" y="40" width="440" height="110" fill="url(#m3sky)"/>
  <path d="M0 118 L70 96 L130 106 L200 84 L270 100 L340 88 L440 104 L440 150 L0 150 Z" fill="#2a2a26"/>
  <g fill="#1a1b19">
    <rect x="180" y="58" width="16" height="50"/><polygon points="177,58 188,38 199,58"/>
    <rect x="200" y="40" width="24" height="68"/><polygon points="197,40 212,14 227,40"/>
    <rect x="228" y="60" width="16" height="48"/><polygon points="225,60 236,41 247,60"/>
    <rect x="166" y="76" width="96" height="34"/>
    <rect x="166" y="70" width="7" height="6"/><rect x="178" y="70" width="7" height="6"/><rect x="243" y="70" width="7" height="6"/><rect x="255" y="70" width="7" height="6"/>
  </g>
  <g fill="#e8b45e" opacity=".7"><rect x="210" y="54" width="3" height="5"/><rect x="186" y="70" width="2.5" height="4"/><rect x="235" y="73" width="2.5" height="4"/></g>
  <path d="M0 128 Q110 110 220 126 T440 120 L440 150 L0 150 Z" fill="#141613"/>
  <g fill="#10120f">
    <polygon points="14,150 30,96 46,150"/><polygon points="40,150 58,86 76,150"/><polygon points="70,150 84,108 98,150"/>
    <polygon points="330,150 346,100 362,150"/><polygon points="356,150 374,84 392,150"/><polygon points="388,150 404,104 420,150"/>
  </g>
</svg>`;

const tipClosed = () => { try { return sessionStorage.getItem(TIP_KEY) === '1'; } catch { return false; } };
const closeTip = () => { try { sessionStorage.setItem(TIP_KEY, '1'); } catch { /* ignore */ } };

export function menu3Main(ui, note) {
  if (!ui._signedIn()) { loginScreen(ui); if (note) ui._menuNote(note); return; }
  ensureCss(FONT_ID, 'https://fonts.googleapis.com/css2?family=Cinzel:wght@500;600;700&family=Alegreya:wght@500;600;700&display=swap');
  ensureCss(CSS_ID, new URL('./menu3.css', import.meta.url).href);
  frameDemoCamera(ui, { dist: 33, pitch: 1.02 });

  ui.menuEl.innerHTML = '';
  ui.menuEl.classList.remove('with-hud', 'm-left');

  const cloud = ui.app.cloud;
  const prof = safe(() => ui.app.getProfile(), null);
  const root = h('div', 'm3-root');
  const click = (fn) => clickOf(ui, fn);

  // the forest-dark ring around the village (under the panels, over the scene)
  root.append(h('div', 'm3-vignette'));

  // ==================== TOP BAR ====================
  const topbar = h('header', 'm3-topbar');

  const brand = h('div', 'm3-brand');
  brand.innerHTML = `${laurel('m3-laurel-l')}<span class="m3-brand-txt"><span class="m3-logo">AEVUM</span><span class="m3-tagline"></span></span>${laurel('m3-laurel-r')}`;
  brand.querySelector('.m3-tagline').textContent = tr('Çağları aş · Uygarlığını kur');

  // (owner 2026-11-27: "üst menüde oyna falan var gereksiz") only what the left column does not already offer
  const tabs = h('nav', 'm3-tabs');
  tabs.setAttribute('aria-label', tr('Ana Menü'));
  const addTab = (iconHtml, label, fn, opts = {}) => {
    const b = h('button', 'm3-tab');
    b.type = 'button';
    b.innerHTML = `<span class="m3-tab-ico">${iconHtml}</span><span class="m3-tab-lbl"></span>`;
    b.querySelector('.m3-tab-lbl').textContent = label;
    if (opts.dot) b.append(h('span', 'm3-dot'));
    b.onclick = click(fn);
    return b;
  };
  const tabFriends = addTab(SVG_USERS, tr('Arkadaşlar'), () => import('./friends-ui.js').then((m) => m.menuFriends(ui)));
  const tabUpdates = addTab(SVG_SCROLL, tr('Güncellemeler'), () => menuUpdates(ui), { dot: hasUnseen() });
  const tabHow = addTab(SVG_HELP, tr('Nasıl Oynanır'), () => ui._menuHowto());
  tabs.append(tabFriends, tabUpdates, tabHow);
  Promise.resolve(safe(() => cloud && cloud.isOwner(), false)).then((own) => {
    if (!own || !tabs.isConnected) return;
    tabs.insertBefore(addTab(SVG_STATS, tr('İstatistikler'), () => import('./stats-ui.js').then((m) => m.menuStats(ui))), tabUpdates);
  }).catch(() => {});

  const topActs = h('div', 'm3-top-actions');
  const roundBtn = (iconHtml, title, fn) => {
    const b = h('button', 'm3-rbtn');
    b.type = 'button'; b.title = title; b.setAttribute('aria-label', title);
    b.innerHTML = iconHtml;
    b.onclick = click(fn);
    return b;
  };
  const bellDot = h('span', 'm3-dot m3-rbtn-dot');
  const syncBellDot = () => {
    const hasInvite = !!(typeof document !== 'undefined' && document.querySelector('.invite-card'));
    bellDot.classList.toggle('hidden', !(hasUnreadNews() || hasInvite));
  };
  const bellBtn = roundBtn(SVG_BELL, tr('Bildirimler'), () => openNews(ui, syncBellDot));
  bellBtn.append(bellDot);
  syncBellDot();
  topActs.append(bellBtn, roundBtn(SVG_GEAR, tr('Ayarlar'), () => ui._menuSettings()));

  topbar.append(brand, tabs, topActs);

  // ==================== BODY ====================
  const body = h('div', 'm3-body');
  const leftCol = h('aside', 'm3-left-col');
  const leftInner = h('div', 'm3-left-inner');

  if (note) { const nEl = h('div', 'm3-note', String(note)); nEl.setAttribute('role', 'status'); leftInner.append(nEl); }
  if (cloud && cloud.loggedIn && cloud.status === 'expired') {
    const exp = h('div', 'm3-frame m3-expired');
    exp.append(h('div', 'mperr', tr('Oturumun sona erdi: aynı Google hesabıyla tekrar giriş yap.')), googleBlock(ui, { small: true }));
    leftInner.append(exp);
  }

  // 1) the player card: avatar on a hanging red banner, name, Profil / Çıkış, rank, TP bar
  const openProfile = click(() => import('./profile-ui.js').then((m) => m.menuProfile(ui)));
  const pCard = h('div', 'm3-frame m3-player');
  const pBanner = h('button', 'm3-pbanner');
  pBanner.type = 'button'; pBanner.title = tr('Profil'); pBanner.onclick = openProfile;
  const avRing = h('span', 'm3-avring');
  avRing.append(avatarEl(prof ? prof.avatar : null, prof ? prof.uid : '', 'm3-av'));
  pBanner.append(avRing);

  const pBody = h('div', 'm3-pbody');
  const pTop = h('div', 'm3-ptop');
  const pName = h('button', 'm3-pname', (prof && prof.name) || tr('Oyuncu'));
  pName.type = 'button'; pName.onclick = openProfile;
  const pLinks = h('div', 'm3-plinks');
  const link = (svg, text, fn) => { const b = h('button', 'm3-plink'); b.type = 'button'; b.innerHTML = `${svg}<span></span>`; b.querySelector('span').textContent = text; b.onclick = fn; return b; };
  const outLink = link(SVG_LOGOUT, tr('Çıkış'), click(() => confirmLogout(ui)));
  if (!cloud || !cloud.loggedIn) outLink.disabled = true;
  pLinks.append(link(SVG_USER, tr('Profil'), openProfile), outLink);
  pTop.append(pName, pLinks);
  const pRank = h('div', 'm3-prank');
  const tpBar = h('div', 'm3-tpbar'); const tpFill = document.createElement('i'); tpBar.append(tpFill);
  const tpRow = h('div', 'm3-tprow');
  const lvCircle = h('span', 'm3-lvcircle'); const tpNums = h('span', 'm3-tpnums');
  tpRow.append(lvCircle, tpNums);
  pBody.append(pTop, pRank, tpBar, tpRow);
  pCard.append(pBanner, pBody);
  const drawPlayer = () => {
    const cur = safe(() => ui.app.getProfile(), prof);
    if (cur && cur.name) pName.textContent = cur.name;
    const tpVal = cloud && cloud.loggedIn && cloud.tp ? cloud.tp.tp : 0;
    const L = levelOf(tpVal);
    pRank.textContent = tr('Seviye {0} · {1}', L.level, L.rank);
    lvCircle.textContent = String(L.level);
    tpFill.style.width = Math.round(L.frac * 100) + '%';
    tpNums.textContent = tpText(L.tp) + ' · ' + tr('sonraki seviye {0} TP', L.next);
  };
  drawPlayer();
  if (cloud && typeof cloud.onChange === 'function') {
    const off = cloud.onChange(() => { if (!root.isConnected) { off(); return; } drawPlayer(); });
  }
  leftInner.append(pCard);

  // 2) Duyurular (newsBox, embedded, with paging dots)
  safe(() => {
    const nb = newsBox(ui, { embedded: true, pager: true, onSeen: syncBellDot });
    if (!nb) return;
    nb.classList.add('m3-news', 'm3-frame');
    const head = nb.querySelector('.news-head');
    if (head) head.prepend(htmlEl('span', 'm3-card-ico', SVG_NEWS));
    const main = nb.querySelector('.news-main');
    if (main) main.append(h('span', 'm3-news-chev', '›'));
    leftInner.append(nb);
  });

  // 3) the big gold "Yeni Oyun"
  const playBtn = h('button', 'm3-play-btn');
  playBtn.type = 'button';
  playBtn.innerHTML = `<span class="m3-play-ico">${SVG_SWORDS}</span><span class="m3-play-txt"><b class="m3-play-title"></b><small class="m3-play-sub"></small></span><span class="m3-chev">›</span>`;
  playBtn.querySelector('.m3-play-title').textContent = tr('Yeni Oyun');
  playBtn.querySelector('.m3-play-sub').textContent = tr('Harita ve ayarlar');
  playBtn.onclick = click(() => ui._menuSetup());
  leftInner.append(playBtn);

  // 4) the play list
  const listEl = h('div', 'm3-list');
  const addItem = (iconHtml, title, sub, fn, cls = '') => {
    const b = h('button', 'm3-item' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.innerHTML = `<span class="m3-item-art" aria-hidden="true">${SVG_ITEM_ART}</span><span class="m3-item-ico">${iconHtml}</span><span class="m3-item-txt"><b class="m3-item-title"></b><small class="m3-item-sub"></small></span><span class="m3-chev">›</span>`;
    b.querySelector('.m3-item-title').textContent = title;
    b.querySelector('.m3-item-sub').textContent = sub || '';
    b.onclick = click(fn);
    listEl.append(b);
    return b;
  };
  if (ui.game && !ui.game.over && !ui.app.demo && !ui.app.net) {
    addItem(ico('x-speed'), tr('Oyuna Dön'), tr('kaldığın yer'), () => { ui.showHUD(); ui.app.setPaused?.(false); }, 'm3-item-resume');
  }
  const multiCard = addItem(SVG_USERS, tr('Çok Oyunculu'), tr('Davet et, birlikte oyna'), () => ui._menuMulti());
  safe(() => interruptedEntry(ui, listEl, multiCard));
  addItem(ico('x-build'), tr('Sandbox'), tr('Serbest kur'), () => ui.app.newGame({ mapSize: 256, enemies: 1, difficulty: 'normal', startRes: 'high', startAge: 0, sandbox: true, seed: (Math.random() * 1e9) | 0 }));
  const contCard = addItem(SVG_PLAY, tr('Devam Et'), tr('Kayıt yok'), () => Promise.resolve(safe(() => ui.app.continueLast(), false)).then((ok) => {
    if (!ok && ui.app.lastLoadError && ui.mode === 'menu') ui._menuSaves(ui.app.lastLoadError);
  }).catch(() => {}));
  const savesCard = addItem(ico('x-save'), tr('Kayıtlı Oyunlar'), '', () => ui._menuSaves());
  contCard.disabled = true;
  Promise.resolve(safe(() => ui.app.listSaves(), [])).then((l) => {
    if (!listEl.isConnected) return;
    const n = (l && l.length) | 0;
    contCard.disabled = !n;
    const cs = contCard.querySelector('.m3-item-sub'); if (cs) cs.textContent = n ? tr('Son kayıttan') : tr('Kayıt yok');
    const ss = savesCard.querySelector('.m3-item-sub'); if (ss) ss.textContent = n ? n + tr(' kayıt') : tr('Kayıt yok');
  }).catch(() => {});
  leftInner.append(listEl);
  leftCol.append(leftInner, htmlEl('div', 'm3-col-art', SVG_COL_CASTLE));

  // the middle: the live village and the tip bar at the bottom
  const stage = h('div', 'm3-stage');
  if (!tipClosed()) {
    const tip = h('div', 'm3-tip m3-frame');
    const tipBody = htmlEl('button', 'm3-tip-body',
      `<span class="m3-tip-ico" aria-hidden="true">${SVG_BULB}</span>` +
      `<span class="m3-tip-txt">${tr('<b>İpucu:</b> Önerin mi var? <b>Buraya tıkla ve yaz</b>, ya da oyunda <kbd>Enter</kbd> ile sohbeti açıp <b class="cmention">@claude</b> yaz; doğrudan geliştiriciye gider.')}</span>`);
    tipBody.type = 'button';
    tipBody.onclick = click(() => ui._fbBox());
    const tipX = h('button', 'm3-tip-x', '✕');
    tipX.type = 'button'; tipX.title = tr('Kapat'); tipX.setAttribute('aria-label', tr('Kapat'));
    tipX.onclick = (ev) => { ev.stopPropagation(); safe(() => ui._click()); closeTip(); tip.remove(); };
    tip.append(tipBody, tipX);
    stage.append(tip);
  }

  // the right: Genel Sohbet
  const chatCol = h('div', 'm3-chat-col');
  safe(() => {
    const gc = buildMenuChat(ui, { cls: 'm3-chat', titleWrapCls: 'm3-chat-titlewrap', icoCls: 'm3-card-ico', rulesIcoCls: 'm3-rules-ico', sendIcoCls: 'm3-send-ico', iconOnlySend: true });
    if (gc) { gc.classList.add('m3-frame'); chatCol.append(gc); }
  });

  body.append(leftCol, stage, chatCol);
  root.append(topbar, body);
  ui.menuEl.append(root);
}

export default { MENU3, menu3Main };
