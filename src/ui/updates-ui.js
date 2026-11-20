// Aevum - the "Güncellemeler" screen: every release with its date and what came with it (src/changelog.js).
// The menu button gets a "Yeni" mark until the player has opened the screen once after a release.
import { CHANGELOG, LATEST } from '../changelog.js';

const KEY = 'aevum.seenVersion';
const h = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; };
const AYLAR = ['Ocak', 'Şubat', 'Mart', 'Nisan', 'Mayıs', 'Haziran', 'Temmuz', 'Ağustos', 'Eylül', 'Ekim', 'Kasım', 'Aralık'];
const fmtDate = (d) => { const [y, m, dd] = String(d).split('-').map(Number); return dd + ' ' + (AYLAR[m - 1] || '') + ' ' + y; };

export function hasUnseen() { try { return localStorage.getItem(KEY) !== LATEST; } catch (e) { return false; } }

export function menuUpdates(ui) {
  const box = ui._menuBox('');
  box.classList.add('updates');
  // (owner 2026-11-20: the way back sits at the top, always in view while the list scrolls)
  const top = h('div', 'up-top');
  const back = h('button', 'mbtn small up-back', '← Geri'); back.type = 'button';
  back.onclick = () => { try { ui._click(); } catch (e) { /* ignore */ } ui._menuMain(); };
  top.append(back, h('h2', '', 'Güncellemeler'));
  box.append(top);
  box.append(h('div', 'mpnote', 'Oyuna ne zaman ne geldi. Bir hata ya da önerin varsa oyun içi sohbete @claude yazman yeter.'));
  const list = h('div', 'up-list');
  CHANGELOG.forEach((r, i) => {
    const sec = h('section', 'up-rel' + (i === 0 ? ' latest' : ''));
    const head = h('div', 'up-head');
    head.append(h('b', 'up-v', 'Sürüm ' + r.v), h('span', 'up-title', r.title), h('span', 'up-date', fmtDate(r.date)));
    if (i === 0) head.append(h('span', 'up-new', 'En yeni'));
    const ul = h('ul', 'up-items');
    for (const t of r.items) ul.append(h('li', '', t));
    sec.append(head, ul);
    list.append(sec);
  });
  box.append(list);
  ui._mbtn(box, 'Geri', () => ui._menuMain());
  try { localStorage.setItem(KEY, LATEST); } catch (e) { /* private mode */ }
}

export default { menuUpdates, hasUnseen };
