// Aevum - small pictures of the map types for the "Yeni Oyun" screen. Each one is a real map from the game's own
// generator (a small 112-tile map with a fixed seed: the same picture every time), drawn from above: land and
// water in the chosen climate's colours, light from the north-west on the hills, forests, gold and stone, and the
// players' start spots. Built one per frame and cached, so the screen opens at once.
import { Game } from '../sim/game.js';
import { PLAYER_COLORS } from '../data.js';
import { CLIMATES } from '../render/renderer.js';

const SIZE = 112, SEED = 424242;
const cache = new Map();   // type|enemies|climate -> canvas
const rgb = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];
const mix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

function paint(type, enemies, climate) {
  const g = new Game({ mapSize: SIZE, enemies, difficulty: 'easy', startRes: 'normal', startAge: 0, sandbox: true, seed: SEED, mapType: type });
  const C = CLIMATES[climate] || CLIMATES.temperate;
  const map = g.map, N = map.size, V = N + 1, h = map.heights;
  const col = [C.mm[0], [126, 100, 66], rgb(C.sand || 0xd8c48a), rgb(C.shallow), rgb(C.deep), [128, 124, 118], C.mm[1]];
  const cv = document.createElement('canvas'); cv.width = N; cv.height = N;
  const cx = cv.getContext('2d'), img = cx.createImageData(N, N), d = img.data;
  for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
    const i = z * N + x, t = map.tiles[i];
    let c = col[t] || col[0];
    // hill shading: brighter on slopes facing the north-west light, rock lighter on the peaks
    const hc = h[z * V + x], dx = h[z * V + x + 1] - hc, dz = h[(z + 1) * V + x] - hc;
    const s = Math.max(-0.35, Math.min(0.35, -(dx + dz) * 0.35));
    if (t === 5) c = mix(c, [236, 234, 228], Math.max(0, Math.min(0.7, (hc - 2) / 6)));
    const k = t === 3 || t === 4 ? 1 : 1 + s;
    d[i * 4] = c[0] * k; d[i * 4 + 1] = c[1] * k; d[i * 4 + 2] = c[2] * k; d[i * 4 + 3] = 255;
  }
  // forests and the mines on top
  const leaf = (C.leaf || [0x4c8f35]).map(rgb), pine = (C.pine || [0x2f6b3a]).map(rgb);
  for (const e of g.entities.values()) {
    if (e.kind !== 'resource' || e.dead) continue;
    const i = (Math.min(N - 1, e.z | 0) * N + Math.min(N - 1, e.x | 0)) * 4;
    let c = null;
    if (e.type === 'tree') { const p = ((e.id * 2654435761) >>> 0) % 7; c = mix(p < 3 ? pine[p % pine.length] : leaf[p % leaf.length], [20, 30, 15], 0.18); }
    else if (e.type === 'gold') c = [236, 196, 70];
    else if (e.type === 'stone') c = [196, 196, 200];
    if (c) { d[i] = c[0]; d[i + 1] = c[1]; d[i + 2] = c[2]; }
  }
  cx.putImageData(img, 0, 0);
  // the start spots: a ring in each player's colour
  const out = document.createElement('canvas'); out.width = N * 2; out.height = N * 2;
  const o = out.getContext('2d');
  o.imageSmoothingEnabled = false; o.drawImage(cv, 0, 0, N * 2, N * 2);
  g.players.forEach((p, k) => {
    const x = (p.startX || 0) * 2, z = (p.startZ || 0) * 2, c = PLAYER_COLORS[k] ?? 0xffffff;
    o.beginPath(); o.arc(x, z, 7, 0, Math.PI * 2); o.fillStyle = '#' + c.toString(16).padStart(6, '0'); o.fill();
    o.lineWidth = 2.5; o.strokeStyle = '#fff'; o.stroke();
  });
  return out;
}

// -> a canvas now if it is cached, else null and cb(canvas) a moment later (one map per frame)
const queue = [];
let busy = false;
function pump() {
  if (busy || !queue.length) return;
  busy = true;
  setTimeout(() => {   // (a timer, not a frame callback: a hidden tab gets no frames and the queue would stall)
    const job = queue.shift();
    let c = cache.get(job.key);
    if (!c) { try { c = paint(job.type, job.enemies, job.climate); } catch (e) { console.warn('[map preview]', e); c = null; } if (c) cache.set(job.key, c); }
    for (const cb of job.cbs) { try { cb(c); } catch (e) { /* ignore */ } }
    busy = false; pump();
  }, 20);
}
export function mapPreview(type, enemies, climate, cb) {
  const key = type + '|' + enemies + '|' + climate;
  if (cache.has(key)) return cache.get(key);
  const j = queue.find((q) => q.key === key);
  if (j) j.cbs.push(cb); else queue.push({ key, type, enemies, climate, cbs: [cb] });
  pump();
  return null;
}
// the climate a 'random' pick shows in the previews
export const previewClimate = (c) => (CLIMATES[c] ? c : 'temperate');
