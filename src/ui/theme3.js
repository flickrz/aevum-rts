// Aevum - theme 3 (the look of main menu v3 on every screen), behind ?menu3.
// This module is imported only when a menu draft flag is in the URL (ui.js: menuDraftReady), never on a normal start.
// index.html's first inline script does the early part: it sets window.AEVUM_MENU, adds class "theme3" to <html> and
// writes the <link> tags below with the parser, so the first paint is already themed. ensureTheme() repeats that for
// a page that did not (an older cached index.html), and loadMenuDraft() fetches the menu draft's own module.
//
// The look is one stylesheet, src/ui/theme3.css (every rule scoped under ".theme3"): tokens and shared pieces first,
// then a section per area (menus, social, hud top, hud bottom, overlays). menu3.css holds only the main menu itself.

export const THEME3 = typeof document !== 'undefined' && document.documentElement.classList.contains('theme3');

const FONTS = 'https://fonts.googleapis.com/css2?family=Cinzel:wght@400;500;600&family=Alegreya:wght@500;600;700;800&family=Nunito:wght@500;600;700;800&display=swap';

function link(id, href) {
  if (document.getElementById(id)) return;
  const l = document.createElement('link');
  l.id = id; l.rel = 'stylesheet'; l.href = href;
  document.head.appendChild(l);
}

export function ensureTheme() {
  if (typeof document === 'undefined') return;
  document.documentElement.classList.add('theme3');
  link('aevum-menu3-font', FONTS);
  link('aevum-t3', new URL('./theme3.css', import.meta.url).href);
  link('aevum-menu3-css', new URL('./menu3.css', import.meta.url).href);
}

// the main menu draft's entry: (ui, note) => void
export function loadMenuDraft(kind) {
  if (kind === 'menu3') { ensureTheme(); return import('./menu3.js').then((m) => m.menu3Main); }
  return import('./menu2.js').then((m) => m.menu2Main);
}

export default { THEME3, ensureTheme, loadMenuDraft };
