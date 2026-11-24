// Aevum - two languages (owner 2026-11-24: "tarayıcının diline göre olsun, ingilizce de olsun").
// The game's texts stay written in Turkish in the code; tr('...') returns the English one when the language is
// English. The English texts live in src/i18n/en-*.js, one file per area, each a plain map
// { 'Türkçe metin': 'English text' }, merged here.
// Texts with values in them: tr('{0} odun eksik', n) -> the key keeps {0}, {1}... placeholders in both languages.
// The language: the player's choice (Settings, localStorage 'aevum.lang'), else the browser's language
// (Turkish browsers get Turkish, every other one English). Changing it reloads the page.
import EN_UI from './i18n/en-ui.js';
import EN_DATA from './i18n/en-data.js';
import EN_SIM from './i18n/en-sim.js';
import EN_MISC from './i18n/en-misc.js';

const KEY = 'aevum.lang';
function detect() {
  try { const s = localStorage.getItem(KEY); if (s === 'tr' || s === 'en') return s; } catch (e) { /* */ }
  try {
    const langs = (typeof navigator !== 'undefined' && (navigator.languages && navigator.languages.length ? navigator.languages : [navigator.language])) || [];
    return langs.some((l) => /^tr\b/i.test(String(l || ''))) ? 'tr' : 'en';
  } catch (e) { return 'tr'; }
}
export const LANG = typeof window === 'undefined' ? 'tr' : detect();
const EN = Object.assign({}, EN_UI, EN_DATA, EN_SIM, EN_MISC);
const fill = (s, a) => (a.length ? String(s).replace(/\{(\d+)\}/g, (m, i) => (a[i] !== undefined ? a[i] : m)) : s);

// tr('Türkçe', ...values) -> the text in the current language
export function tr(s, ...a) {
  if (LANG === 'en') { const e = EN[s]; if (e != null) return fill(e, a); }
  return fill(s, a);
}
export function setLang(l) {
  if (l !== 'tr' && l !== 'en') return;
  try { localStorage.setItem(KEY, l); } catch (e) { /* */ }
  if (l !== LANG && typeof location !== 'undefined') location.reload();
}
if (typeof document !== 'undefined') { try { document.documentElement.lang = LANG; } catch (e) { /* */ } }

// the locale for dates and numbers ('en-US' in English, else 'tr-TR')
export const loc = () => (LANG === 'en' ? 'en-US' : 'tr-TR');

// default player names made in Turkish by the simulation / lobby ("Oyuncu 2", "Yapay Zekâ 3", "Bilgisayar 1")
export function pn(n) {
  const s = String(n == null ? '' : n);
  if (LANG !== 'en') return s;
  const m = /^(Oyuncu|Yapay Zekâ|Bilgisayar|Komutan)(?: (\d+))?$/.exec(s);
  if (!m) return s;
  return ({ Oyuncu: 'Player', 'Yapay Zekâ': 'AI', Bilgisayar: 'Computer', Komutan: 'Commander' })[m[1]] + (m[2] ? ' ' + m[2] : '');
}

// a message the server sent (in Turkish, the protocol keeps it): its English text, also for the ones with numbers in them
const SRV_RX = [
  [/^Herkesi davet etmek için (\d+) sn bekle\.$/, 'Herkesi davet etmek için {0} sn bekle.'],
  [/^Maç (\d+) dakikadan kısa sürdü: TP verilmez\.$/, 'Maç {0} dakikadan kısa sürdü: TP verilmez.'],
  [/^Bir saatte en çok (\d+) galibiyet TP verir\.$/, 'Bir saatte en çok {0} galibiyet TP verir.'],
];
export function srvTr(s) {
  if (typeof s !== 'string' || LANG !== 'en') return s;
  if (EN[s] != null) return EN[s];
  for (const [rx, k] of SRV_RX) { const m = rx.exec(s); if (m) return tr(k, ...m.slice(1)); }
  return s;
}
