// Context-sensitive mouse cursor (view only, never read by src/sim).
// pickCursor(sel, target, me, isEnemy) -> 'axe' | 'pickaxe' | 'food' | 'hammer' | 'sword' | ''
//   sel: { villagers: bool, military: bool }  (own selection kinds)
//   target: the hovered entity (or null), isEnemy(owner) -> bool
export function pickCursor(sel, t, me, isEnemy) {
  if (!t || t.dead || !sel || !(sel.villagers || sel.military)) return '';
  if (t.kind === 'resource') {
    if (t.live && (t.type === 'wolf' || t.type === 'bear')) return 'sword';
    if (!sel.villagers) return '';
    if (t.type === 'tree') return 'axe';
    if (t.type === 'gold' || t.type === 'stone') return 'pickaxe';
    if (t.type === 'fish') return '';
    return 'food';                       // berries, deer and other huntables
  }
  if (t.owner >= 0 && t.owner !== me && isEnemy && isEnemy(t.owner)) return 'sword';
  if (t.kind === 'building' && t.owner === me && sel.villagers) {
    if (!t.done || t.hp < t.maxHp) return 'hammer';
    if (t.type === 'farm' || t.type === 'pasture') return 'food';
  }
  return '';
}

// 32x32 flat SVG icons, dark outline; hotspot per icon
const O = 'stroke="#1a1208" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"';
const ICONS = {
  axe: [`<path d="M8 28 L22 10" ${O} stroke-width="5"/><path d="M8 28 L22 10" stroke="#a8743c" stroke-width="2.5" stroke-linecap="round"/><path d="M17 5 Q27 3 29 13 L21 14 Z" fill="#cfd6dc" ${O}/>`, 4, 4],
  pickaxe: [`<path d="M9 28 L22 11" ${O} stroke-width="5"/><path d="M9 28 L22 11" stroke="#a8743c" stroke-width="2.5" stroke-linecap="round"/><path d="M6 9 Q18 0 30 14 Q19 7 6 9 Z" fill="#b9c2ca" ${O}/>`, 4, 4],
  food: [`<path d="M6 27 L14 19" ${O} stroke-width="5"/><path d="M6 27 L14 19" stroke="#a8743c" stroke-width="2.5" stroke-linecap="round"/><path d="M13 20 Q8 6 20 4 Q30 4 28 15 Q26 9 20 9 Q14 10 16 18 Z" fill="#dfe5ea" ${O}/><circle cx="25" cy="24" r="3.5" fill="#d8343a" ${O} stroke-width="1.5"/>`, 4, 4],
  hammer: [`<path d="M9 28 L19 14" ${O} stroke-width="5"/><path d="M9 28 L19 14" stroke="#a8743c" stroke-width="2.5" stroke-linecap="round"/><path d="M13 9 L22 3 L29 12 L20 18 Z" fill="#9aa4ad" ${O}/>`, 4, 4],
  sword: [`<path d="M4 4 L20 20" ${O} stroke-width="6"/><path d="M4 4 L20 20" stroke="#e4e9ee" stroke-width="3" stroke-linecap="round"/><path d="M16 24 L24 16" ${O} stroke-width="5"/><path d="M16 24 L24 16" stroke="#e0b040" stroke-width="2.5" stroke-linecap="round"/><path d="M21 21 L28 28" ${O} stroke-width="5"/><path d="M21 21 L28 28" stroke="#8a5a2b" stroke-width="2.5" stroke-linecap="round"/>`, 3, 3],
};
const cache = {};
export function cursorCss(name) {
  if (!name || !ICONS[name]) return '';
  if (cache[name]) return cache[name];
  const [body, hx, hy] = ICONS[name];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">${body}</svg>`;
  return (cache[name] = `url("data:image/svg+xml,${encodeURIComponent(svg)}") ${hx} ${hy}, auto`);
}
