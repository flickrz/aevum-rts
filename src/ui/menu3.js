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
  SVG_NEWS, SVG_BULB, SVG_BELL, SVG_HELP, SVG_SCROLL,
} from './menu-shared.js';
import { forestSvg, colSceneSvg, ITEM_ARTS, BANNER_SVG, SVG_SWORDS2, SVG_CHEV, SVG_PLANE, SVG_HAMMER, SVG_FLOPPY, laurel } from './menu3-art.js';

export { MENU3 };

const CSS_ID = 'aevum-menu3-css';
const FONT_ID = 'aevum-menu3-font';
const TIP_KEY = 'aevum.m3TipClosed';

const tipClosed = () => { try { return sessionStorage.getItem(TIP_KEY) === '1'; } catch { return false; } };
const closeTip = () => { try { sessionStorage.setItem(TIP_KEY, '1'); } catch { /* ignore */ } };

export function menu3Main(ui, note) {
  if (!ui._signedIn()) { loginScreen(ui); if (note) ui._menuNote(note); return; }
  ensureCss(FONT_ID, 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600&family=Alegreya:wght@500;600;700;800&family=Nunito:wght@500;600;700;800&display=swap');
  ensureCss(CSS_ID, new URL('./menu3.css', import.meta.url).href);
  frameDemoCamera(ui, { dist: 46, pitch: 1.0 });

  ui.menuEl.innerHTML = '';
  ui.menuEl.classList.remove('with-hud', 'm-left');

  const cloud = ui.app.cloud;
  const prof = safe(() => ui.app.getProfile(), null);
  const root = h('div', 'm3-root');
  const click = (fn) => clickOf(ui, fn);

  // the forest-dark ring around the village (under the panels, over the scene)
  root.append(htmlEl('div', 'm3-vignette', forestSvg()));

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
  pBanner.innerHTML = BANNER_SVG;
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
    if (main) main.append(htmlEl('span', 'm3-news-chev', SVG_CHEV));
    leftInner.append(nb);
  });

  // 3) the big gold "Yeni Oyun"
  const playBtn = h('button', 'm3-play-btn');
  playBtn.type = 'button';
  playBtn.innerHTML = `<span class="m3-play-ico">${SVG_SWORDS2}</span><span class="m3-play-txt"><b class="m3-play-title"></b><small class="m3-play-sub"></small></span><span class="m3-chev">${SVG_CHEV}</span>`;
  playBtn.querySelector('.m3-play-title').textContent = tr('Yeni Oyun');
  playBtn.querySelector('.m3-play-sub').textContent = tr('Harita ve ayarlar');
  playBtn.onclick = click(() => ui._menuSetup());
  leftInner.append(playBtn);

  // 4) the play list
  const listEl = h('div', 'm3-list');
  const addItem = (iconHtml, title, sub, fn, cls = '') => {
    const b = h('button', 'm3-item' + (cls ? ' ' + cls : ''));
    b.type = 'button';
    b.innerHTML = `<span class="m3-item-art" aria-hidden="true">${ITEM_ARTS[listEl.childElementCount % ITEM_ARTS.length]}</span><span class="m3-item-ico">${iconHtml}</span><span class="m3-item-txt"><b class="m3-item-title"></b><small class="m3-item-sub"></small></span><span class="m3-chev">${SVG_CHEV}</span>`;
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
  addItem(SVG_HAMMER, tr('Sandbox'), tr('Serbest kur'), () => ui._menuSetup(true));
  const contCard = addItem(SVG_PLAY, tr('Devam Et'), tr('Kayıt yok'), () => Promise.resolve(safe(() => ui.app.continueLast(), false)).then((ok) => {
    if (!ok && ui.app.lastLoadError && ui.mode === 'menu') ui._menuSaves(ui.app.lastLoadError);
  }).catch(() => {}));
  const savesCard = addItem(SVG_FLOPPY, tr('Kayıtlı Oyunlar'), '', () => ui._menuSaves());
  contCard.disabled = true;
  Promise.resolve(safe(() => ui.app.listSaves(), [])).then((l) => {
    if (!listEl.isConnected) return;
    const n = (l && l.length) | 0;
    contCard.disabled = !n;
    const cs = contCard.querySelector('.m3-item-sub'); if (cs) cs.textContent = n ? tr('Son kayıttan') : tr('Kayıt yok');
    const ss = savesCard.querySelector('.m3-item-sub'); if (ss) ss.textContent = n ? n + tr(' kayıt') : tr('Kayıt yok');
  }).catch(() => {});
  leftInner.append(listEl);
  leftCol.append(leftInner);
  root.append(htmlEl('div', 'm3-col-art', colSceneSvg()));

  // the middle: the live village and the tip bar at the bottom
  const stage = h('div', 'm3-stage');
  if (!tipClosed()) {
    const tip = h('div', 'm3-tip m3-frame');
    const tipBody = htmlEl('button', 'm3-tip-body',
      `<span class="m3-tip-ico" aria-hidden="true">${SVG_BULB}</span>` +
      `<span class="m3-tip-txt">${tr('<b>İpucu:</b> Önerin mi var? <b>Buraya tıkla ve yaz</b>, ya da oyunda <kbd>Enter</kbd> ile sohbeti açıp <b class="cmention">@claude</b> yaz; doğrudan geliştiriciye gider.')}</span>`);
    tipBody.type = 'button';
    tipBody.onclick = click(() => ui._fbBox());
    const tipX = htmlEl('button', 'm3-tip-x', '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3 3l10 10M13 3 3 13" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>');
    tipX.type = 'button'; tipX.title = tr('Kapat'); tipX.setAttribute('aria-label', tr('Kapat'));
    tipX.onclick = (ev) => { ev.stopPropagation(); safe(() => ui._click()); closeTip(); tip.remove(); };
    tip.append(tipBody, tipX);
    stage.append(tip);
  }

  // the right: Genel Sohbet
  const chatCol = h('div', 'm3-chat-col');
  safe(() => {
    const gc = buildMenuChat(ui, { cls: 'm3-chat', titleWrapCls: 'm3-chat-titlewrap', icoCls: 'm3-card-ico', rulesIcoCls: 'm3-rules-ico', sendIcoCls: 'm3-send-ico', iconOnlySend: true });
    if (!gc) return;
    gc.classList.add('m3-frame');
    const plane = gc.querySelector('.m3-send-ico'); if (plane) plane.innerHTML = SVG_PLANE;
    chatCol.append(gc);
  });

  body.append(leftCol, stage, chatCol);
  root.append(topbar, body);
  ui.menuEl.append(root);
}

export default { MENU3, menu3Main };
