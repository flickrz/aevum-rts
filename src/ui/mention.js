// Aevum - @claude in the chat inputs (lobby and in-game): typing "@" opens a small list with @claude (arrow keys +
// Enter/Tab, or a click), and while typing, @claude is highlighted inside the input itself (a mirror of the text
// drawn over the input, whose own text is made transparent). A line with @claude is feedback for the developer.
const OPTIONS = [{ tag: '@claude', label: 'Geliştiriciye hata / öneri gönder' }];
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export const hasClaude = (t) => /@claude/i.test(String(t || ''));

// wraps the input -> the wrapper to put in the page instead of the input
export function withMention(input) {
  const wrap = document.createElement('div'); wrap.className = 'mn-wrap';
  const mirror = document.createElement('div'); mirror.className = 'mn-mirror'; mirror.setAttribute('aria-hidden', 'true');
  const pop = document.createElement('div'); pop.className = 'mn-pop hidden'; pop.setAttribute('role', 'listbox');
  wrap.append(input, mirror, pop);
  let styled = false, sel = 0, token = null;   // token: {start, end} of the "@xx" being typed

  // the mirror copies the input's text box exactly (font, padding, border width) once the input is on the page
  const copyStyle = () => {
    if (styled || !input.isConnected) return;
    const cs = getComputedStyle(input);
    for (const k of ['fontFamily', 'fontSize', 'fontWeight', 'letterSpacing', 'lineHeight', 'paddingTop', 'paddingRight', 'paddingBottom', 'paddingLeft', 'borderTopWidth', 'borderRightWidth', 'borderBottomWidth', 'borderLeftWidth', 'textIndent', 'boxSizing']) mirror.style[k] = cs[k];
    mirror.style.color = cs.color;
    styled = true;
  };
  const sync = () => { mirror.scrollLeft = input.scrollLeft; };
  const draw = () => {
    const v = input.value;
    const on = v.includes('@');
    if (on) {
      copyStyle();
      mirror.innerHTML = esc(v).replace(/@claude/gi, '<span class="mn-hit">$&</span>') + ' ';
      requestAnimationFrame(sync);
    } else mirror.textContent = '';
    wrap.classList.toggle('mn-on', on);
    wrap.classList.toggle('mn-claude', hasClaude(v));
  };

  // the list: open while the word at the caret is "@" + the start of an option
  const close = () => { token = null; pop.classList.add('hidden'); };
  const options = () => {
    const pos = input.selectionStart ?? input.value.length;
    const m = /(^|\s)@(\w*)$/.exec(input.value.slice(0, pos));
    if (!m) return [];
    const q = m[2].toLowerCase();
    const list = OPTIONS.filter((o) => o.tag.slice(1).startsWith(q) && o.tag.slice(1) !== q);
    if (list.length) token = { start: pos - q.length - 1, end: pos };
    return list;
  };
  const openList = () => {
    const list = options();
    if (!list.length) { close(); return; }
    sel = Math.min(sel, list.length - 1);
    pop.textContent = '';
    list.forEach((o, k) => {
      const it = document.createElement('div');
      it.className = 'mn-item' + (k === sel ? ' on' : ''); it.setAttribute('role', 'option');
      const b = document.createElement('b'); b.textContent = o.tag;
      const s = document.createElement('span'); s.textContent = o.label;
      it.append(b, s);
      it.onmousedown = (ev) => { ev.preventDefault(); ev.stopPropagation(); pick(o); };   // (keeps the focus in the input)
      it.onmouseenter = () => { sel = k; pop.querySelectorAll('.mn-item').forEach((x, j) => x.classList.toggle('on', j === k)); };
      pop.append(it);
    });
    pop.classList.remove('hidden');
  };
  const pick = (o) => {
    if (!token) return;
    const v = input.value, rest = v.slice(token.end).replace(/^\w*/, '');
    const before = v.slice(0, token.start) + o.tag + ' ';
    input.value = before + rest.replace(/^ /, '');
    input.setSelectionRange(before.length, before.length);
    close(); draw(); input.focus();
  };

  // runs before the chat's own Enter / Escape handling (a capture listener on the target fires first)
  input.addEventListener('keydown', (ev) => {
    if (pop.classList.contains('hidden')) return;
    const n = pop.children.length;
    if (ev.key === 'ArrowDown' || ev.key === 'ArrowUp') { sel = (sel + (ev.key === 'ArrowDown' ? 1 : n - 1)) % n; openList(); }
    else if (ev.key === 'Enter' || ev.key === 'Tab') { const list = options(); if (list[sel]) pick(list[sel]); }
    else if (ev.key === 'Escape') close();
    else return;
    ev.preventDefault(); ev.stopImmediatePropagation(); ev.stopPropagation();
  }, true);
  input.addEventListener('input', () => { sel = 0; draw(); openList(); });
  for (const t of ['keyup', 'click', 'scroll', 'select']) input.addEventListener(t, () => { requestAnimationFrame(sync); if (t !== 'scroll' && t !== 'select') { if (input.value.includes('@')) openList(); else close(); } });
  input.addEventListener('blur', () => setTimeout(close, 120));
  // the chat clears the input after sending (value set from code fires no input event)
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
  Object.defineProperty(input, 'value', { configurable: true, get() { return desc.get.call(this); }, set(v) { desc.set.call(this, v); draw(); } });
  return wrap;
}

export default { withMention, hasClaude };
