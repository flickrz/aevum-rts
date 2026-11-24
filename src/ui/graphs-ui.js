// Aevum - the graphs on the game-over and Stats screens (player request 2026-11-24): one line per player over the
// match, a tab per score type, the legend turns players on and off. Plain SVG, data from sim/history.js.
import { tr } from '../i18n.js';
import { PLAYER_COLORS } from '../data.js';
import { HIST_KEYS, histSample } from '../sim/history.js';

const TABS = { score: 'Genel Skor', mil: 'Askeri', eco: 'Ekonomi', res: 'Eldeki Kaynak', pop: 'Nüfus', age: 'Çağ' };
const hex = (c) => '#' + (c >>> 0).toString(16).padStart(6, '0');
const fmtT = (s) => Math.floor(s / 60) + ':' + String(Math.floor(s % 60)).padStart(2, '0');
const fmtV = (v) => (v >= 10000 ? Math.round(v / 1000) + 'k' : String(v));

// players: [{ id, name }] - who may be shown (the caller hides rivals not met yet)
export function graphPanel(game, players) {
  const wrap = document.createElement('div'); wrap.className = 'hgraph';
  // the graph also shows "now": the recorded samples plus a live one
  const hist = (game.history || []).slice();
  const now = histSample(game); if (!hist.length || hist[hist.length - 1].t < now.t) hist.push(now);
  if (hist.length < 2 || !players.length) return wrap;
  let key = 'score'; const off = new Set();
  const seg = document.createElement('div'); seg.className = 'seg wrap';
  const svgBox = document.createElement('div'); svgBox.className = 'hg-plot';
  const leg = document.createElement('div'); leg.className = 'hg-leg';
  const W = 600, H = 200, L = 40, B = 18, T = 8, R = 8;
  const draw = () => {
    const ki = HIST_KEYS.indexOf(key), tMax = Math.max(1, hist[hist.length - 1].t);
    let vMax = 1; for (const s of hist) for (const p of players) if (!off.has(p.id)) vMax = Math.max(vMax, s.v[p.id]?.[ki] || 0);
    if (key === 'age') vMax = Math.max(vMax, 4);
    const x = (t) => L + (t / tMax) * (W - L - R), y = (v) => H - B - (v / vMax) * (H - B - T);
    let s = `<svg viewBox="0 0 ${W} ${H}">`;
    for (let i = 0; i <= 4; i++) { const v = (vMax * i) / 4, yy = y(v); s += `<line x1="${L}" x2="${W - R}" y1="${yy}" y2="${yy}" class="hg-grid"/><text x="${L - 4}" y="${yy + 3}" text-anchor="end" class="hg-ax">${key === 'age' ? Math.round(v) + 1 : fmtV(Math.round(v))}</text>`; }
    for (let i = 0; i <= 4; i++) { const t = (tMax * i) / 4; s += `<text x="${x(t)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === 4 ? 'end' : 'middle'}" class="hg-ax">${fmtT(t)}</text>`; }
    for (const p of players) {
      if (off.has(p.id)) continue;
      const pts = hist.filter((h) => h.v[p.id]).map((h) => x(h.t).toFixed(1) + ',' + y(h.v[p.id][ki] || 0).toFixed(1)).join(' ');
      s += `<polyline points="${pts}" fill="none" stroke="${hex(PLAYER_COLORS[p.id] ?? 0xffffff)}" stroke-width="2.2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
    }
    svgBox.innerHTML = s + '</svg>';
    for (const b of seg.children) b.classList.toggle('on', b.dataset.k === key);
    for (const c of leg.children) c.classList.toggle('off', off.has(+c.dataset.id));
  };
  for (const k of HIST_KEYS) { const b = document.createElement('button'); b.dataset.k = k; b.textContent = tr(TABS[k]); b.onclick = () => { key = k; draw(); }; seg.append(b); }
  for (const p of players) {
    const c = document.createElement('button'); c.className = 'hg-chip'; c.dataset.id = p.id; c.title = tr('Göster / gizle');
    c.innerHTML = `<span class="dot" style="background:${hex(PLAYER_COLORS[p.id] ?? 0xffffff)}"></span>`; c.append(document.createTextNode(p.name));
    c.onclick = () => { if (off.has(p.id)) off.delete(p.id); else if (off.size < players.length - 1) off.add(p.id); draw(); };
    leg.append(c);
  }
  wrap.append(seg, svgBox, leg); draw();
  return wrap;
}
