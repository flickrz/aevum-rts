// Aevum - the "Duyurular" (announcements) box on the right of the main menu: the newest announcement (src/news.js, plus
// the latest release from src/changelog.js) with a couple of older titles under it; a click opens the full text.
// An unread dot shows until the newest one has been opened (localStorage 'aevum.newsSeen'). On phones (html.touch or a
// low screen) the box collapses to a small button that opens the same panel. No network: everything is in the bundle.
import { ico } from '../icons.js';
import { NEWS } from '../news.js';
import { CHANGELOG } from '../changelog.js';
import { tr } from '../i18n.js';

const KEY = 'aevum.newsSeen';
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const fmtDate = (d) => { const [y, m, dd] = String(d).split('-').map(Number); return dd + ' ' + (AYLAR[m - 1] ? tr(AYLAR[m - 1]) : '') + ' ' + y; };

// every announcement, newest first (only what is written in src/news.js; owner 2026-11-25: nothing is added
// automatically). An entry with changelog: '0.9.8' lists that release's items under its text when opened.
export function allNews() {
  const out = NEWS.map((n) => {
    const r = n.changelog ? CHANGELOG.find((c) => c.v === n.changelog) : null;
    return { ...n, title: tr(n.title), body: tr(n.body), linkText: n.linkText ? tr(n.linkText) : '', release: !!r, items: r ? r.items.map((t) => tr(t)) : [] };
  });
  return out.sort((a, b) => String(b.date).localeCompare(String(a.date)));
}
const seen = () => { try { return localStorage.getItem(KEY) || ''; } catch (e) { return ''; } };
const markSeen = (id) => { try { localStorage.setItem(KEY, id); } catch (e) { /* private mode */ } };

function openPanel(ui, list, first, onSeen) {
  ui.menuEl.querySelector('.news-ov')?.remove();
  const ov = h('div', 'news-ov');
  const p = h('div', 'news-modal panel');
  const esc = (e) => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
  const close = () => { ov.remove(); document.removeEventListener('keydown', esc, true); };
  document.addEventListener('keydown', esc, true);
  ov.onclick = (e) => { if (e.target === ov) close(); };
  const x = h('button', 'news-x', '✕'); x.type = 'button'; x.title = tr('Kapat');
  x.onclick = () => { try { ui._click(); } catch (e) { /* */ } close(); };
  const body = h('div', 'news-full');
  const others = h('div', 'news-others');
  const show = (it) => {
    body.innerHTML = '';
    body.append(h('div', 'news-date', fmtDate(it.date)), h('h3', 'news-ftitle', it.title));
    if (it.img) { const im = h('img', 'news-img'); im.src = it.img; im.alt = ''; body.append(im); }
    if (it.release) { const ul = h('ul', 'news-items'); for (const t of it.items) ul.append(h('li', '', t)); body.append(ul); }
    else for (const para of String(it.body).split(/\n\s*\n/)) body.append(h('p', 'news-p', para));
    if (it.link) { const a = h('a', 'mbtn small news-link', it.linkText || tr('Aç')); a.href = it.link; a.target = '_blank'; a.rel = 'noopener'; body.append(a); }
    if (it.id === list[0].id) { markSeen(it.id); onSeen(); }
    others.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b._id === it.id));
    p.scrollTop = 0;
  };
  if (list.length > 1) for (const it of list.slice(0, 6)) {
    const b = h('button', 'news-olink', it.title); b.type = 'button'; b._id = it.id; b.onclick = () => show(it); others.append(b);
  }
  p.append(x, h('h2', '', tr('Duyurular')), body);
  if (list.length > 1) p.append(others);
  ov.append(p); ui.menuEl.append(ov);
  show(first);
}

export function newsBox(ui) {
  const list = allNews(); if (!list.length) return null;
  const top = list[0];
  const wrap = h('div', 'news-wrap');
  const dot = () => { const d = h('span', 'news-dot'); d.title = tr('Yeni'); return d; };
  const unread = seen() !== top.id;
  const clear = () => wrap.querySelectorAll('.news-dot').forEach((d) => d.remove());
  const open = (it) => { try { ui._click(); } catch (e) { /* */ } openPanel(ui, list, it, clear); };
  // the card (desktop)
  const card = h('aside', 'news-box panel');
  const head = h('div', 'news-head'); head.append(h('span', 'news-lbl', tr('Duyurular')));
  if (unread) head.append(dot());
  const main = h('button', 'news-main'); main.type = 'button';
  main.append(h('b', 'news-title', top.title), h('span', 'news-body', top.body), h('span', 'news-date', fmtDate(top.date)));
  main.onclick = () => open(top);
  card.append(head, main);
  if (list.length > 1) {
    const older = h('div', 'news-older');
    for (const it of list.slice(1, 3)) { const b = h('button', 'news-olink', it.title); b.type = 'button'; b.onclick = () => open(it); older.append(b); }
    card.append(older);
  }
  // the small button (phones)
  const btn = h('button', 'news-btn panel'); btn.innerHTML = ico('x-tech'); btn.type = 'button'; btn.title = tr('Duyurular');
  if (unread) btn.append(dot());
  btn.onclick = () => open(top);
  wrap.append(card, btn);
  // (owner 2026-11-26, drawn on screenshots) the card on the left, under the player plate, as wide as the menu column;
  // where that gap is too small, top right as before. The general chat (ui.js, .menu-chat) on the right: its top in line
  // with the card (or the AEVUM box when the card is not on the left), its bottom with the AEVUM box
  const align = () => {
    if (!wrap.isConnected) { removeEventListener('resize', align); return; }
    const par = wrap.parentElement; if (!par) return;
    const pr = par.getBoundingClientRect(); if (!pr.height) return;   // (a hidden page lays nothing out: try again when shown)
    const box = par.querySelector('.menu-box.main'), plate = par.querySelector('.mh-plate');
    const chat = par.querySelector('.gchat.menu-chat');
    const bTop = box ? box.offsetTop : 0;   // (offsetTop: not moved by the rise-in transform)
    let cTop = bTop;
    wrap.classList.remove('left'); wrap.style.left = wrap.style.width = wrap.style.top = '';
    if (getComputedStyle(card).display !== 'none' && box) {
      const p = plate && plate.getBoundingClientRect(), bx = box.getBoundingClientRect();
      const pBot = p ? p.bottom - pr.top : 4, w = Math.max(bx.width, p ? p.width : 0);
      wrap.classList.add('left'); wrap.style.left = (bx.left - pr.left) + 'px'; wrap.style.width = w + 'px';
      const room = bTop - pBot;
      if (room < card.offsetHeight + 12) { wrap.classList.remove('left'); wrap.style.left = wrap.style.width = ''; }
      else { cTop = Math.round(pBot + (room - card.offsetHeight) / 2); wrap.style.top = cTop + 'px'; }
    }
    if (chat && box && getComputedStyle(chat).display !== 'none') { chat.style.top = cTop + 'px'; chat.style.height = Math.max(260, bTop + box.offsetHeight - cTop) + 'px'; }
  };
  addEventListener('resize', align); document.addEventListener('visibilitychange', align); requestAnimationFrame(() => { if (typeof ResizeObserver !== 'undefined' && wrap.parentElement) new ResizeObserver(align).observe(wrap.parentElement); requestAnimationFrame(align); }); setTimeout(align, 700); setTimeout(align, 1600); addEventListener('animationend', align, { capture: true });   // (again once the menu's fonts / rise-in settled)
  return wrap;
}

export default { newsBox, allNews };
