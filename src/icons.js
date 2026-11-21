// Aevum - one icon set for the whole UI: game-icons.net silhouettes (CC BY 3.0, see assets/icons/LICENSE.md),
// built into one sprite (assets/icons/icons.svg) by tools/build-icons.mjs. They take the text colour.
// Every unit / building / tech of data.js has an icon (keys u-<unit>, b-<building>, t-<tech>).
import { UNITS, BUILDINGS, TECHS } from './data.js';
import { fetchAsset } from './cdn.js';

const SPRITE = 'icons/icons.svg';   // (under assets/: from jsDelivr on the live site, src/cdn.js)
const OK = /^[a-z0-9-]+$/;

// The sprite is put into the page ONCE, before the UI is built, and icons point into it (#gi-key).
// (A reference into the external file made the browser re-resolve it - and, with the server's no-store, fetch
// it again - every time a panel re-rendered: icons blinked.)
if (typeof document !== 'undefined' && !document.getElementById('gi-sprite')) {
  try {
    /* from the host: no-cache, revalidated with the ETag (a tiny 304) so a new icon shows at once despite /assets/ being
       cached a day; the CDN's copy at the pinned commit never changes */
    const txt = await fetchAsset(SPRITE, undefined, { cache: 'no-cache' }).then(r => (r.ok ? r.text() : ''));
    if (txt.startsWith('<svg')) {
      const holder = document.createElement('div');
      holder.id = 'gi-sprite'; holder.setAttribute('aria-hidden', 'true');
      holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden';
      holder.innerHTML = txt;
      (document.body || document.documentElement).prepend(holder);
    }
  } catch (err) { console.warn('[icons]', err); }
}

// the markup of icon `key` (it is safe to put into innerHTML; toast() keeps exactly this markup)
export function ico(key, cls = '') {
  if (!OK.test(key)) key = 'x-unknown';
  return `<svg class="gi${cls ? ' ' + cls : ''}" aria-hidden="true"><use href="#gi-${key}"></use></svg>`;
}
// matches the markup ico() makes, after HTML escaping (used to keep icons inside escaped text)
export const ICO_ESCAPED_RE = /&lt;svg class=&quot;gi( [a-z0-9 -]+)?&quot; aria-hidden=&quot;true&quot;&gt;&lt;use href=&quot;#gi-[a-z0-9-]+&quot;&gt;&lt;\/use&gt;&lt;\/svg&gt;/g;
const unesc = s => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"');
// escaped text in which our icons stay icons
export const keepIcons = escaped => String(escaped).replace(ICO_ESCAPED_RE, unesc);
// plain text without icon markup (for title attributes, aria labels, logs)
export const stripIcons = s => String(s).replace(/<svg class="gi[^]*?<\/svg>\s*/g, '');

export const RES_ICONS = { food: ico('r-food', 'res-food'), wood: ico('r-wood', 'res-wood'), stone: ico('r-stone', 'res-stone'), gold: ico('r-gold', 'res-gold') };
export const CAT_ICONS = { eco: ico('c-eco'), mil: ico('c-mil'), def: ico('c-def'), tra: ico('c-tra') };
export const NATURE_ICONS = { tree: ico('n-tree'), stone: ico('r-stone', 'res-stone'), gold: ico('r-gold', 'res-gold'), berries: ico('n-berries'), deer: ico('n-deer'), fish: ico('n-fish') };

// the data's emoji icons become sprite icons (UI only: the simulation never reads `icon`)
let applied = false;
export function applyIcons() {
  if (applied) return; applied = true;
  for (const [k, d] of Object.entries(UNITS)) d.icon = ico('u-' + k);
  for (const [k, d] of Object.entries(BUILDINGS)) d.icon = ico('b-' + k);
  for (const [k, d] of Object.entries(TECHS)) d.icon = ico('t-' + k);
}
