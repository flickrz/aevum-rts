// Aevum - Main Menu v3 draft (?menu3): top navigation bar, left player/news/action rail,
// open temperate village center, right Genel Sohbet, and dismissible bottom tip bar.
import { levelOf } from '../rank.js';
import { avatarEl, tpText, loginScreen, googleBlock } from './cloud-ui.js';
import { newsBox, hasUnreadNews, openNews } from './news-ui.js';
import { menuUpdates, hasUnseen } from './updates-ui.js';
import { interruptedEntry } from './notice-ui.js';
import { ico } from '../icons.js';
import { tr } from '../i18n.js';
import {
  MENU3, safe, h, htmlEl, ensureCss, clickOf, frameDemoCamera, confirmLogout, buildMenuChat,
  SVG_HOME, SVG_PLAY, SVG_USER, SVG_USERS, SVG_STATS, SVG_GEAR, SVG_LOGOUT,
  SVG_NEWS, SVG_BULB, SVG_BELL, SVG_HELP, SVG_SWORDS, SVG_SCROLL,
} from './menu-shared.js';

export { MENU3 };

const CSS_ID = 'aevum-menu3-css';
const TIP_KEY = 'aevum.m3TipClosed';

// Subtle gold laurel branches flanking the AEVUM brand subtitle
const SVG_LAUREL_L = `<svg class="m3-laurel" viewBox="0 0 36 22" aria-hidden="true">
  <path d="M33 19C20 18 10 13 4 3" fill="none" stroke="#a6884c" stroke-width="1.3" stroke-linecap="round"/>
  <ellipse cx="9" cy="8" rx="4.2" ry="1.8" transform="rotate(-48 9 8)" fill="#c9a558"/>
  <ellipse cx="14" cy="13" rx="4.4" ry="1.8" transform="rotate(-32 14 13)" fill="#b89246"/>
  <ellipse cx="21" cy="16.5" rx="4.4" ry="1.8" transform="rotate(-16 21 16.5)" fill="#c9a558"/>
  <ellipse cx="12" cy="5.5" rx="3.4" ry="1.5" transform="rotate(14 12 5.5)" fill="#b89246"/>
  <ellipse cx="18" cy="10.5" rx="3.6" ry="1.5" transform="rotate(18 18 10.5)" fill="#d6b467"/>
</svg>`;

const SVG_LAUREL_R = `<svg class="m3-laurel m3-laurel-r" viewBox="0 0 36 22" aria-hidden="true">
  <path d="M3 19C16 18 26 13 32 3" fill="none" stroke="#a6884c" stroke-width="1.3" stroke-linecap="round"/>
  <ellipse cx="27" cy="8" rx="4.2" ry="1.8" transform="rotate(48 27 8)" fill="#c9a558"/>
  <ellipse cx="22" cy="13" rx="4.4" ry="1.8" transform="rotate(32 22 13)" fill="#b89246"/>
  <ellipse cx="15" cy="16.5" rx="4.4" ry="1.8" transform="rotate(16 15 16.5)" fill="#c9a558"/>
  <ellipse cx="24" cy="5.5" rx="3.4" ry="1.5" transform="rotate(-14 24 5.5)" fill="#b89246"/>
  <ellipse cx="18" cy="10.5" rx="3.6" ry="1.5" transform="rotate(-18 18 10.5)" fill="#d6b467"/>
</svg>`;

// Faint cozy castle & forest silhouette anchored at the bottom of the left column
const SVG_COL_CASTLE = `<svg class="m3-col-art-svg" viewBox="0 0 320 112" preserveAspectRatio="xMidYMax slice" aria-hidden="true">
  <path d="M0 84 L58 70 L118 78 L176 64 L244 74 L320 68 L320 112 L0 112 Z" fill="#181d27" opacity="0.55"/>
  <g fill="#141822" opacity="0.72">
    <rect x="128" y="44" width="12" height="38"/>
    <polygon points="126,44 134,29 142,44"/>
    <rect x="144" y="32" width="18" height="50"/>
    <polygon points="142,32 153,14 164,32"/>
    <rect x="166" y="46" width="13" height="36"/>
    <polygon points="164,46 172.5,31 181,46"/>
    <rect x="116" y="56" width="74" height="28"/>
    <rect x="116" y="51" width="6" height="5"/><rect x="126" y="51" width="6" height="5"/>
    <rect x="184" y="51" width="6" height="5"/>
  </g>
  <g fill="#e0b660" opacity="0.48">
    <rect x="151" y="42" width="2.5" height="4.5"/><rect x="133" y="53" width="2" height="3.5"/>
    <rect x="171" y="55" width="2" height="3.5"/>
  </g>
  <path d="M0 90 Q90 78 178 92 T320 84 L320 112 L0 112 Z" fill="#12161e" opacity="0.82"/>
  <g fill="#10141c" opacity="0.82">
    <polygon points="24,104 34,72 44,104"/>
    <polygon points="40,108 52,68 64,108"/>
    <polygon points="62,106 72,80 82,106"/>
    <polygon points="232,106 242,76 252,106"/>
    <polygon points="250,108 262,66 274,108"/>
    <polygon points="274,106 286,76 298,106"/>
  </g>
</svg>`;

const tipClosed = () => { try { return sessionStorage.getItem(TIP_KEY) === '1'; } catch { return false; } };
const closeTip = () => { try { sessionStorage.setItem(TIP_KEY, '1'); } catch { /* ignore */ } };

export function menu3Main(ui, note) {
  if (!ui._signedIn()) { loginScreen(ui); if (note) ui._menuNote(note); return; }
  ensureCss(CSS_ID, new URL('./menu3.css', import.meta.url).href);
  frameDemoCamera(ui);

  ui.menuEl.innerHTML = '';
  ui.menuEl.classList.remove('with-hud', 'm-left');

  const cloud = ui.app.cloud;
  const prof = safe(() => ui.app.getProfile(), null);
  const root = h('div', 'm3-root');
  const click = (fn) => clickOf(ui, fn);

  // ==================== TOP BAR ====================
  const topbar = h('header', 'm3-topbar');

  // -- Left: AEVUM brand with laurel --
  const brand = h('div', 'm3-brand');
  brand.append(
    h('div', 'm3-logo', 'AEVUM'),
    htmlEl('div', 'm3-tagrow', `${SVG_LAUREL_L}<span class="m3-tagline"></span>${SVG_LAUREL_R}`)
  );
  brand.querySelector('.m3-tagline').textContent = tr('Çağları aş · Uygarlığını kur');

  // -- Center: navigation tabs --
  const tabs = h('nav', 'm3-tabs');
  tabs.setAttribute('aria-label', tr('Ana Menü'));
  const addTab = (iconHtml, label, fn, opts = {}) => {
    const b = h('button', 'm3-tab' + (opts.active ? ' m3-active' : ''));
    b.type = 'button';
    b.innerHTML = `<span class="m3-tab-ico">${iconHtml}</span><span class="m3-tab-lbl"></span>`;
    b.querySelector('.m3-tab-lbl').textContent = label;
    if (opts.dot) b.append(h('span', 'm3-dot'));
    b.onclick = click(fn);
    return b;
  };
  const tabHome = addTab(SVG_HOME, tr('Ana Sayfa'), () => {}, { active: true });
  const tabPlay = addTab(SVG_SWORDS, tr('Oyna'), () => ui._menuSetup());
  const tabFriends = addTab(SVG_USERS, tr('Arkadaşlar'), () => import('./friends-ui.js').then((m) => m.menuFriends(ui)));
  const tabUpdates = addTab(SVG_SCROLL, tr('Güncellemeler'), () => menuUpdates(ui), { dot: hasUnseen() });
  tabs.append(tabHome, tabPlay, tabFriends, tabUpdates);

  Promise.resolve(safe(() => cloud && cloud.isOwner(), false)).then((own) => {
    if (!own || !tabs.isConnected) return;
    const tabStats = addTab(SVG_STATS, tr('İstatistikler'), () => import('./stats-ui.js').then((m) => m.menuStats(ui)));
    tabs.insertBefore(tabStats, tabUpdates);
  }).catch(() => {});

  // -- Right: round icon buttons (Bildirim, Nasıl Oynanır, Ayarlar) --
  const topActs = h('div', 'm3-top-actions');
  const roundBtn = (iconHtml, title, fn) => {
    const b = h('button', 'm3-rbtn');
    b.type = 'button';
    b.title = title;
    b.setAttribute('aria-label', title);
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

  const helpBtn = roundBtn(SVG_HELP, tr('Nasıl Oynanır'), () => ui._menuHowto());
  const setBtn = roundBtn(SVG_GEAR, tr('Ayarlar'), () => ui._menuSettings());
  topActs.append(bellBtn, helpBtn, setBtn);

  topbar.append(brand, tabs, topActs);

  // ==================== MAIN BODY ====================
  const body = h('div', 'm3-body');

  // -- Left column: player card, Duyurular, Yeni Oyun CTA, action cards, faint castle --
  const leftCol = h('aside', 'm3-left-col');
  const leftInner = h('div', 'm3-left-inner');

  if (note) {
    const nEl = h('div', 'm3-note', String(note));
    nEl.setAttribute('role', 'status');
    leftInner.append(nEl);
  }
  if (cloud && cloud.loggedIn && cloud.status === 'expired') {
    const exp = h('div', 'm3-card m3-expired');
    exp.append(h('div', 'mperr', tr('Oturumun sona erdi: aynı Google hesabıyla tekrar giriş yap.')), googleBlock(ui, { small: true }));
    leftInner.append(exp);
  }

  // 1) Player card with crimson hanging avatar banner
  const pCard = h('div', 'm3-card m3-player-card');
  const pBanner = h('button', 'm3-pbanner');
  pBanner.type = 'button';
  pBanner.title = tr('Profil');
  pBanner.onclick = click(() => import('./profile-ui.js').then((m) => m.menuProfile(ui)));
  pBanner.append(
    htmlEl('span', 'm3-pbanner-bg',
      '<svg viewBox="0 0 72 96" preserveAspectRatio="none" aria-hidden="true">' +
      '<polygon points="1,0 71,0 71,78 36,94 1,78" fill="#4c181a"/>' +
      '<polyline points="1,0 1,78 36,94 71,78 71,0" fill="none" stroke="#a6884c" stroke-width="1.8"/>' +
      '<polyline points="5,0 5,75 36,89 67,75 67,0" fill="none" stroke="rgba(224,190,112,0.28)" stroke-width="1"/>' +
      '</svg>')
  );
  const avRing = h('span', 'm3-avring');
  avRing.append(avatarEl(prof ? prof.avatar : null, prof ? prof.uid : '', 'm3-av'));
  pBanner.append(avRing);

  const pBody = h('div', 'm3-pbody');
  const pTop = h('div', 'm3-ptop');
  const pNameBtn = h('button', 'm3-pname', (prof && prof.name) || tr('Oyuncu'));
  pNameBtn.type = 'button';
  pNameBtn.onclick = pBanner.onclick;

  const pLinks = h('div', 'm3-plinks');
  const profLink = h('button', 'm3-plink');
  profLink.type = 'button';
  profLink.innerHTML = `${SVG_USER}<span></span>`;
  profLink.querySelector('span').textContent = tr('Profil');
  profLink.onclick = pBanner.onclick;

  const outLink = h('button', 'm3-plink');
  outLink.type = 'button';
  outLink.innerHTML = `${SVG_LOGOUT}<span></span>`;
  outLink.querySelector('span').textContent = tr('Çıkış');
  outLink.onclick = click(() => confirmLogout(ui));
  if (!cloud || !cloud.loggedIn) outLink.disabled = true;

  pLinks.append(profLink, outLink);
  pTop.append(pNameBtn, pLinks);

  const pRank = h('div', 'm3-prank');
  const tpBar = h('div', 'm3-tpbar');
  const tpFill = document.createElement('i');
  tpBar.append(tpFill);

  const tpRow = h('div', 'm3-tprow');
  const lvCircle = h('span', 'm3-lvcircle');
  const tpNums = h('span', 'm3-tpnums');
  tpRow.append(lvCircle, tpNums);

  pBody.append(pTop, pRank, tpBar, tpRow);
  pCard.append(pBanner, pBody);

  const drawPlayer = () => {
    const curProf = safe(() => ui.app.getProfile(), prof);
    if (curProf && curProf.name) pNameBtn.textContent = curProf.name;
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

  // 2) Duyurular card with paging dots (reuses newsBox)
  safe(() => {
    const nb = newsBox(ui, { embedded: true, pager: true, onSeen: syncBellDot });
    if (!nb) return;
    nb.classList.add('m3-news');
    const head = nb.querySelector('.news-head');
    if (head) head.prepend(htmlEl('span', 'm3-card-ico', SVG_NEWS));
    const main = nb.querySelector('.news-main');
    if (main) main.append(h('span', 'm3-news-chev', '›'));
    leftInner.append(nb);
  });

  // 3) Big gold Yeni Oyun CTA button
  const playBtn = h('button', 'm3-play-btn');
  playBtn.type = 'button';
  playBtn.innerHTML =
    `<span class="m3-play-ico">${SVG_SWORDS}</span>` +
    `<span class="m3-play-txt"><b class="m3-play-title"></b><small class="m3-play-sub"></small></span>` +
    `<span class="m3-chev">›</span>`;
  playBtn.querySelector('.m3-play-title').textContent = tr('Yeni Oyun');
  playBtn.querySelector('.m3-play-sub').textContent = tr('Harita ve ayarlar');
  playBtn.onclick = click(() => ui._menuSetup());
  leftInner.append(playBtn);

  // 4) Action list cards
  const listEl = h('div', 'm3-list');
  const addItem = (iconHtml, title, sub, fn, cls = '') => {
    const b = h('button', 'm3-item' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.innerHTML =
      `<span class="m3-item-ico">${iconHtml}</span>` +
      `<span class="m3-item-txt"><b class="m3-item-title"></b><small class="m3-item-sub"></small></span>` +
      `<span class="m3-chev">›</span>`;
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
    const cs = contCard.querySelector('.m3-item-sub');
    if (cs) cs.textContent = n ? tr('Son kayıttan') : tr('Kayıt yok');
    const ss = savesCard.querySelector('.m3-item-sub');
    if (ss) ss.textContent = n ? n + tr(' kayıt') : '';
  }).catch(() => {});

  leftInner.append(listEl);
  leftCol.append(leftInner, htmlEl('div', 'm3-col-art', SVG_COL_CASTLE));

  // -- Center: open live village + bottom centered dismissible tip bar --
  const stage = h('div', 'm3-stage');
  if (!tipClosed()) {
    const tip = h('div', 'm3-tip');
    const tipBody = htmlEl('button', 'm3-tip-body',
      `<span class="m3-tip-ico" aria-hidden="true">${SVG_BULB}</span>` +
      `<span class="m3-tip-txt">${tr('<b>İpucu:</b> Önerin mi var? <b>Buraya tıkla ve yaz</b>, ya da oyunda <kbd>Enter</kbd> ile sohbeti açıp <b class="cmention">@claude</b> yaz; doğrudan geliştiriciye gider.')}</span>`);
    tipBody.type = 'button';
    tipBody.onclick = click(() => ui._fbBox());
    const tipX = h('button', 'm3-tip-x', '✕');
    tipX.type = 'button';
    tipX.title = tr('Kapat');
    tipX.setAttribute('aria-label', tr('Kapat'));
    tipX.onclick = (ev) => {
      ev.stopPropagation();
      safe(() => ui._click());
      closeTip();
      tip.remove();
    };
    tip.append(tipBody, tipX);
    stage.append(tip);
  }

  // -- Right: Genel Sohbet (reuses shared builder with icon-only send button) --
  const chatCol = h('div', 'm3-chat-col');
  safe(() => {
    const gc = buildMenuChat(ui, {
      cls: 'm3-chat',
      titleWrapCls: 'm3-chat-titlewrap',
      icoCls: 'm3-card-ico',
      rulesIcoCls: 'm3-rules-ico',
      sendIcoCls: 'm3-send-ico',
      iconOnlySend: true,
    });
    if (gc) chatCol.append(gc);
  });

  body.append(leftCol, stage, chatCol);
  root.append(topbar, body);
  ui.menuEl.append(root);
}

export default { MENU3, menu3Main };
