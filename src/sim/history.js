// Aevum - end-of-game graphs (player request 2026-11-24): a small time series per player, one sample every
// HIST_STEP seconds of game time. Read-only over the sim state (never part of hash() or any decision), so every
// multiplayer client records the same numbers; kept in saves so a continued match keeps its graph.
import { UNITS } from '../data.js';

export const HIST_STEP = 30;
export const HIST_KEYS = ['score', 'mil', 'eco', 'res', 'pop', 'age'];
const RES = ['food', 'wood', 'stone', 'gold'];
const costSum = (c) => { let s = 0; for (const k in c || {}) s += c[k] || 0; return s; };

// the overall score shown in the stats table (moved here from ui.js so the graph and the table agree)
export function playerScore(p) {
  const s = p.stats || {}, ga = s.gathered || {};
  const techs = typeof s.techs === 'number' ? s.techs : (p.techs?.size || 0);
  return Math.round(RES.reduce((a, r) => a + (ga[r] || 0), 0) / 10 + (s.kills || 0) * 20 + (s.buildingsBuilt || 0) * 15 + (s.razed || 0) * 40 + techs * 30 + (p.age || 0) * 200 + (s.unitsTrained || 0) * 5);
}

// one sample: { t, v: [[score, mil, eco, res, pop, age] per player] }
export function histSample(g) {
  const army = new Array(g.players.length).fill(0);
  for (const u of g.units || []) {
    if (u.dead || u.train || !(u.owner >= 0) || u.owner >= army.length) continue;
    const d = UNITS[u.type]; if (!d || d.cls === 'civil' || !(d.atk > 0)) continue;
    army[u.owner] += costSum(d.cost);
  }
  const v = g.players.map((p, i) => {
    const s = p.stats || {}, ga = s.gathered || {};
    // military: what the army on the field is worth, plus what it has destroyed
    const mil = Math.round(army[i] / 10 + (s.kills || 0) * 20 + (s.razed || 0) * 40);
    const eco = Math.round(RES.reduce((a, r) => a + (ga[r] || 0), 0));
    const res = Math.round(RES.reduce((a, r) => a + (p.res?.[r] || 0), 0));
    return [playerScore(p), mil, eco, res, p.pop | 0, p.age | 0];
  });
  return { t: Math.round(g.time || 0), v };
}

// called every sim step: adds a sample when the next HIST_STEP mark is passed (and one at the end of the match)
export function histTick(g) {
  const h = g.history || (g.history = []);
  const last = h[h.length - 1];
  if (!last || (g.time || 0) >= last.t + HIST_STEP || (g.over && !g._histEnd)) {
    if (g.over) g._histEnd = true;
    const s = histSample(g);
    if (last && last.t === s.t) h[h.length - 1] = s; else h.push(s);
    if (h.length > 400) { const k = []; for (let i = 0; i < h.length; i += 2) k.push(h[i]); if (k[k.length - 1] !== h[h.length - 1]) k.push(h[h.length - 1]); g.history = k; }
  }
}
