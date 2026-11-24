import { tr } from '../i18n.js';
// In-game confirmation dialog (replaces the browser's confirm()). DOM only.
// ask({ title, text, ok = tr('Evet'), cancel = 'Vazgeç', danger }) -> Promise<boolean>
//   Enter = ok, Esc = cancel, a click on the dark backdrop = cancel. While it is open the game's hotkeys
//   (src/input.js) see nothing: a capture-phase keydown listener swallows every key, and input.js also
//   checks askOpen(). The overlay covers the whole screen, so clicks never reach the HUD, the menu or the map.
//   Only one dialog at a time: a second ask() waits until the first one is answered.

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

let open = 0;
let chain = Promise.resolve();

export function askOpen() { return open > 0; }

export function ask(opts = {}) {
  const run = () => new Promise((resolve) => show(opts, resolve));
  const p = chain.then(run, run);
  chain = p.catch(() => {});
  return p;
}

function show(opts, resolve) {
  if (typeof document === 'undefined') { resolve(false); return; }
  const { title = tr('Emin misin?'), text = '', ok = tr('Evet'), cancel = tr('Vazgeç'), danger = false } = opts;
  const root = document.getElementById('ui') || document.body;
  const ov = document.createElement('div');
  ov.className = 'overlay askov';
  const m = document.createElement('div');
  m.className = 'modal panel askbox';
  m.setAttribute('role', 'alertdialog');
  // (text: plain text, line breaks kept)
  m.innerHTML = `<h2>${esc(title)}</h2>` + (text ? `<div class="asktext">${esc(text).replace(/\n/g, '<br>')}</div>` : '');
  const row = document.createElement('div');
  row.className = 'askbtns';
  const bNo = document.createElement('button');
  bNo.type = 'button'; bNo.className = 'mbtn small'; bNo.textContent = cancel;
  const bYes = document.createElement('button');
  bYes.type = 'button'; bYes.className = 'mbtn small ' + (danger ? 'danger askdanger' : 'primary'); bYes.textContent = ok;
  row.append(bNo, bYes);
  m.append(row);
  ov.append(m);

  let done = false;
  const finish = (v) => {
    if (done) return; done = true; open--;
    window.removeEventListener('keydown', onKey, true);
    ov.remove();
    resolve(v);
  };
  const onKey = (e) => {
    e.stopImmediatePropagation();
    if (e.key === 'Escape') { e.preventDefault(); finish(false); }
    else if (e.key === 'Enter') { e.preventDefault(); finish(document.activeElement !== bNo); }   // (the focused button)
    else if (e.key === 'Tab') { e.preventDefault(); (document.activeElement === bYes ? bNo : bYes).focus(); }
    else if (e.key !== ' ') e.preventDefault();   // (Space presses the focused button)
  };
  // nothing under the dialog gets the mouse (the game listens on window for mousemove / mouseup)
  for (const t of ['mousedown', 'mouseup', 'click', 'dblclick', 'contextmenu', 'wheel']) ov.addEventListener(t, (e) => { e.stopPropagation(); if (t === 'contextmenu') e.preventDefault(); }, t === 'wheel' ? { passive: true } : undefined);
  ov.addEventListener('mousedown', (e) => { if (e.target === ov) finish(false); });
  bNo.onclick = () => finish(false);
  bYes.onclick = () => finish(true);

  open++;
  window.addEventListener('keydown', onKey, true);
  // (key-ups are let through: a key held when the dialog opened is released in the game's input, no stuck keys)
  root.append(ov);
  try { (danger ? bNo : bYes).focus({ preventScroll: true }); } catch (err) { /* ignore */ }
}

export default ask;
