// Aevum - Main Menu v3 (?menu3): the hand-drawn (inline SVG) art of the menu. Everything here is static markup built
// once per menu open: the forest ring around the village, the castle scene at the foot of the left column, the misty
// little landscapes on the play cards, the hanging red banner, the crossed swords and the laurels. No images, no
// dependencies; a seeded random keeps the forest the same on every open.

function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6D2B79F5) >>> 0; let t = s; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
const f1 = (n) => Math.round(n * 10) / 10;
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
const rgb = (c) => `rgb(${c[0]},${c[1]},${c[2]})`;

// A low-poly pine: stacked tiers, each split into a lit (left) and a shaded (right) half. tone 0 = deep shade, 1 = sunlit.
function pine(x, base, hgt, tone, tiers = 4) {
  const lit = rgb(mix([14, 30, 18], [112, 146, 62], tone));
  const mid = rgb(mix([10, 23, 14], [70, 108, 48], tone));
  const dark = rgb(mix([7, 16, 10], [36, 66, 34], tone));
  const w = hgt * 0.34;
  let out = `<rect x="${f1(x - hgt * 0.03)}" y="${f1(base - hgt * 0.12)}" width="${f1(hgt * 0.06)}" height="${f1(hgt * 0.12)}" fill="${rgb(mix([10, 9, 7], [58, 40, 24], tone))}"/>`;
  const top = base - hgt;
  const span = hgt * 0.9;
  for (let i = tiers - 1; i >= 0; i--) {
    const k = (i + 1) / tiers;
    const yT = top + span * (i / tiers) * 0.82;
    const yB = top + span * k + hgt * 0.04;
    const ww = w * (0.36 + 0.64 * k);
    const sag = hgt * 0.035;
    out += `<polygon points="${f1(x)},${f1(yT)} ${f1(x - ww)},${f1(yB)} ${f1(x - ww * 0.3)},${f1(yB - sag)} ${f1(x)},${f1(yB)}" fill="${i % 2 ? lit : mid}"/>`;
    out += `<polygon points="${f1(x)},${f1(yT)} ${f1(x + ww)},${f1(yB)} ${f1(x + ww * 0.34)},${f1(yB - sag)} ${f1(x)},${f1(yB)}" fill="${dark}"/>`;
  }
  return out;
}

// A low-poly round bush / blossom crown: a faceted ball (dark body, a mid facet, a small light cap, lit from top-left).
function blob(r, x, y, rad, cols) {
  const n = 7;
  const a0 = r() * 6.28;
  const ring = [];
  for (let i = 0; i < n; i++) { const a = a0 + (i / n) * 6.283; const rr = rad * (0.86 + r() * 0.24); ring.push([Math.cos(a) * rr, Math.sin(a) * rr * 0.94]); }
  const poly = (k, ox, oy, c) => `<polygon points="${ring.map((p) => f1(x + ox * rad + p[0] * k) + ',' + f1(y + oy * rad + p[1] * k)).join(' ')}" fill="${c}"/>`;
  return poly(1, 0, 0, cols[2]) + poly(0.76, -0.13, -0.17, cols[1]) + poly(0.42, -0.3, -0.36, cols[0]);
}

const MAUVE = ['#cdb1c4', '#a78a9f', '#75596f'];
const ROSE = ['#d9bfc6', '#b3929d', '#80626e'];
const LEAF = ['#8ea646', '#63822f', '#3f5a24'];
const LEAF_D = ['#5d7a34', '#3f5c27', '#27401c'];

// The clearing: soft ellipses in a 1920x1080 space; inside them the village shows, outside the forest closes in.
const HOLES = [[948, 600, 474, 452], [820, 780, 370, 310], [1090, 470, 340, 310], [990, 850, 390, 226]];
const holeF = (x, y) => {
  let m = 9;
  for (const [cx, cy, rx, ry] of HOLES) { const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2; if (d < m) m = d; }
  return m;
};

export function forestSvg() {
  const r = rng(20261127);
  const trees = [];
  for (let gy = 60; gy <= 1150; gy += 46) {
    for (let gx = -20; gx <= 1950; gx += 62) {
      const x = gx + (r() - 0.5) * 54, y = gy + (r() - 0.5) * 36;
      const f = holeF(x, y - 30);
      if (f < 0.8) continue;                                   // the meadow stays open
      if (x < 486 && y > 150 && y < 900) { r(); continue; }      // behind the left column
      if (x > 1404 && y > 150 && y < 930) { r(); continue; }     // behind the chat
      if (y > 1010 && x > 560 && x < 1350) { r(); continue; }    // behind the tip
      if (x < 540 && y >= 900) { r(); continue; }                // the castle scene has its own trees
      const edge = Math.max(0, 1 - (f - 0.8) / 0.75);            // 1 at the rim of the clearing, 0 deep in the woods
      const tone = 0.07 + edge * edge * 0.5 + r() * 0.1;
      const hgt = 78 + r() * r() * 96 + (y > 880 ? 34 : 0);
      trees.push([y, pine(x, y, hgt, tone, r() < 0.5 ? 4 : 3)]);
    }
  }
  // blossom bushes and round trees at the rim (bottom right corner and the right edge of the meadow, as in the mockup)
  const bush = (x, y, s, list, z = 0) => {
    let o = `<ellipse cx="${x}" cy="${y + s * 1.25}" rx="${s * 2.6}" ry="${s * 0.6}" fill="#030a05" opacity=".45"/>`;
    for (const [dx, dy, k, cols] of list) o += blob(r, x + dx * s, y + dy * s, s * k, cols);
    trees.push([z || y + s, o]);
  };
  bush(1286, 816, 30, [[-1.5, 0.7, 0.9, LEAF_D], [1.3, 0.8, 0.95, LEAF_D], [-0.3, 0.9, 0.9, LEAF], [-1.1, -0.2, 1.0, MAUVE], [0.9, -0.1, 1.05, ROSE], [-0.1, -0.9, 1.1, MAUVE], [0.3, 0.1, 0.95, ROSE], [1.6, -0.9, 0.8, LEAF], [-1.9, -0.9, 0.7, ROSE]]);
  bush(1322, 700, 24, [[0, 0, 1, LEAF], [1.0, 0.6, 0.85, LEAF_D], [-0.9, 0.6, 0.8, LEAF_D], [0.2, -0.8, 0.8, LEAF]]);
  bush(1548, 1024, 38, [[-2.3, 0.6, 0.8, LEAF_D], [-1.3, -0.1, 0.95, MAUVE], [-0.1, -0.7, 1.1, ROSE], [1.0, -0.3, 1.0, MAUVE], [0.2, 0.5, 0.95, LEAF], [-1.0, 0.8, 0.85, LEAF], [1.9, 0.5, 0.9, LEAF_D], [2.5, -0.5, 0.75, ROSE], [1.2, 0.9, 0.8, LEAF], [3.2, 0.5, 0.8, LEAF]], 5000);
  bush(1226, 400, 20, [[0, 0, 1, LEAF], [1.3, 0.4, 0.9, LEAF_D], [0.5, 0.9, 0.8, LEAF_D]]);
  bush(596, 330, 22, [[0, 0, 1, LEAF_D], [1.2, 0.5, 0.85, LEAF], [0.4, -0.8, 0.75, LEAF]]);
  bush(606, 900, 26, [[0, 0, 1, LEAF], [1.2, 0.4, 0.9, LEAF_D], [-1.0, 0.5, 0.8, LEAF_D], [0.3, -0.8, 0.85, ROSE]]);
  // a few big sunlit pines in the bottom right corner
  for (const [x, y, hh, t] of [[1790, 1100, 190, 0.5], [1872, 1060, 170, 0.42], [1716, 1128, 150, 0.36], [1900, 1140, 200, 0.55]]) trees.push([y, pine(x, y, hh, t, 4)]);
  trees.sort((a, b) => a[0] - b[0]);

  const holes = HOLES.map(([cx, cy, rx, ry]) => `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" fill="url(#m3f-h)"/>`).join('');
  return `<svg class="m3-forest" viewBox="0 0 1920 1080" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <radialGradient id="m3f-h"><stop offset="0" stop-color="#000"/><stop offset=".66" stop-color="#000"/><stop offset=".86" stop-color="#000" stop-opacity=".55"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient>
    <mask id="m3f-m" maskUnits="userSpaceOnUse" x="-200" y="-200" width="2320" height="1480"><rect x="-200" y="-200" width="2320" height="1480" fill="#fff"/>${holes}</mask>
    <radialGradient id="m3f-sun" cx="948" cy="560" r="520" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#fff3b8" stop-opacity=".14"/><stop offset="1" stop-color="#fff3b8" stop-opacity="0"/></radialGradient>
  </defs>
  <rect x="-200" y="-200" width="2320" height="1480" fill="#07120b" opacity=".95" mask="url(#m3f-m)"/>
  <rect x="400" y="60" width="1100" height="1020" fill="url(#m3f-sun)"/>
  ${trees.map((t) => t[1]).join('')}
</svg>`;
}

// The castle at dusk at the foot of the left column.
export function colSceneSvg() {
  const r = rng(77);
  const facet = (pts, c) => `<polygon points="${pts}" fill="${c}"/>`;
  const tower = (x, y, w, hh, roof) => `<rect x="${x - w / 2}" y="${y - hh}" width="${w}" height="${hh}"/><polygon points="${x - w / 2 - 1.5},${y - hh} ${x},${y - hh - roof} ${x + w / 2 + 1.5},${y - hh}"/>`;
  let pines = '';
  for (const [x, y, hh, t] of [[200, 196, 40, 0.1], [224, 200, 34, 0.08], [330, 192, 36, 0.1], [352, 197, 30, 0.08], [386, 204, 34, 0.1], [452, 214, 44, 0.12], [486, 222, 52, 0.14]]) pines += pine(x, y, hh, t, 3);
  let front = '';
  for (const [x, y, hh, t] of [[20, 250, 150, 0.5], [78, 262, 124, 0.72], [-14, 268, 120, 0.38], [136, 268, 92, 0.6]]) front += pine(x, y, hh, t, 4);
  void r;
  return `<svg class="m3-col-art-svg" viewBox="0 0 520 250" preserveAspectRatio="xMinYMax slice" aria-hidden="true">
  <defs>
    <radialGradient id="m3c-glow" cx="276" cy="160" r="240" gradientUnits="userSpaceOnUse"><stop offset="0" stop-color="#f6ae48" stop-opacity=".85"/><stop offset=".3" stop-color="#d27f2e" stop-opacity=".5"/><stop offset=".7" stop-color="#7a4520" stop-opacity=".2"/><stop offset="1" stop-color="#3a2416" stop-opacity="0"/></radialGradient>
    <linearGradient id="m3c-hill" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#7f9a3a"/><stop offset=".5" stop-color="#4f6f2a"/><stop offset="1" stop-color="#1f3317"/></linearGradient>
  </defs>
  <rect x="0" y="0" width="520" height="250" fill="url(#m3c-glow)"/>
  <g transform="translate(0 16)">
  <g>
    ${facet('60,176 132,110 168,138 214,176', '#4b4d50')}${facet('132,110 168,138 150,150 118,138', '#77756c')}${facet('132,110 118,138 92,160 60,176', '#3a3c40')}
    ${facet('356,180 420,124 452,150 520,172 520,184', '#45474b')}${facet('420,124 452,150 436,158 410,146', '#6d6a62')}
    ${facet('0,170 40,150 96,182 0,190', '#33363a')}
  </g>
  <path d="M0 198 Q70 172 130 174 Q190 176 226 150 Q258 124 282 124 Q308 124 338 150 Q372 178 430 172 Q480 170 520 190 L520 250 L0 250 Z" fill="#1b1d17"/>
  <g fill="#12130f">
    ${tower(246, 132, 13, 30, 15)}${tower(267, 132, 16, 52, 22)}${tower(288, 132, 12, 36, 16)}${tower(305, 134, 10, 24, 13)}${tower(230, 136, 9, 18, 11)}
    <rect x="224" y="112" width="88" height="26"/>
    <rect x="224" y="107" width="6" height="5"/><rect x="236" y="107" width="6" height="5"/><rect x="296" y="107" width="6" height="5"/><rect x="306" y="107" width="6" height="5"/>
    <rect x="266.2" y="52" width="1.6" height="10"/><polygon points="267.8,52 276,54.5 267.8,57"/>
  </g>
  <g fill="#f4bb62"><rect x="264.5" y="92" width="3" height="5"/><rect x="244.5" y="112" width="2.6" height="4"/><rect x="287" y="108" width="2.6" height="4"/><rect x="270" y="120" width="2.6" height="4"/></g>
  ${pines}
  </g>
  <path d="M70 250 Q170 190 300 188 T520 214 L520 250 Z" fill="url(#m3c-hill)"/>
  <path d="M0 232 Q150 204 300 236 T520 232 L520 250 L0 250 Z" fill="#14230f"/>
  ${front}
</svg>`;
}

// The misty little landscapes on the play cards (four variants, like the mockup: castle, keep, hills, pines).
const artWrap = (inner) => `<svg viewBox="0 0 260 64" preserveAspectRatio="xMaxYMax slice" aria-hidden="true">
  <path d="M0 64 L40 46 L84 54 L128 34 L168 48 L212 30 L260 44 L260 64 Z" fill="#fff" opacity=".045"/>
  ${inner}
</svg>`;
const spire = (x, y, w, hh, roof) => `<rect x="${x - w / 2}" y="${y - hh}" width="${w}" height="${hh}"/><polygon points="${x - w / 2 - 1},${y - hh} ${x},${y - hh - roof} ${x + w / 2 + 1},${y - hh}"/>`;
const tree = (x, y, hh) => `<polygon points="${x - hh * 0.3},${y} ${x},${y - hh} ${x + hh * 0.3},${y}"/>`;
export const ITEM_ARTS = [
  artWrap(`<path d="M70 64 L120 44 L150 40 L206 46 L260 58 L260 64 Z" fill="#fff" opacity=".06"/>
    <g fill="#fff" opacity=".1">${spire(138, 42, 6, 16, 8)}${spire(150, 42, 9, 26, 11)}${spire(163, 42, 6, 20, 8)}${spire(176, 43, 7, 14, 8)}<rect x="132" y="30" width="50" height="13"/>${tree(108, 50, 15)}${tree(118, 48, 19)}${tree(196, 47, 16)}${tree(206, 49, 20)}${tree(218, 52, 14)}</g>`),
  artWrap(`<path d="M90 64 L150 46 L196 40 L260 52 L260 64 Z" fill="#fff" opacity=".06"/>
    <g fill="#fff" opacity=".1">${spire(190, 42, 12, 26, 13)}${spire(176, 43, 6, 14, 8)}${spire(204, 43, 6, 16, 8)}<rect x="172" y="34" width="36" height="9"/>${tree(150, 48, 14)}${tree(160, 46, 18)}${tree(224, 48, 17)}${tree(234, 50, 13)}</g>`),
  artWrap(`<path d="M60 64 L112 40 L140 50 L180 26 L214 44 L240 36 L260 46 L260 64 Z" fill="#fff" opacity=".06"/>
    <path d="M110 64 L160 50 L200 54 L260 46 L260 64 Z" fill="#fff" opacity=".05"/>
    <g fill="#fff" opacity=".09">${tree(136, 56, 13)}${tree(146, 54, 16)}${tree(226, 50, 15)}</g>`),
  artWrap(`<path d="M100 64 L160 50 L210 46 L260 54 L260 64 Z" fill="#fff" opacity=".06"/>
    <g fill="#fff" opacity=".1">${tree(168, 52, 18)}${tree(180, 50, 26)}${tree(194, 50, 21)}${tree(208, 49, 30)}${tree(222, 51, 20)}${tree(236, 54, 16)}${spire(150, 53, 7, 12, 7)}</g>`),
];

// The red banner the avatar hangs on: rolled top, gold piping, pointed tail.
export const BANNER_SVG = `<svg class="m3-pbanner-svg" viewBox="0 0 104 156" aria-hidden="true">
  <defs>
    <linearGradient id="m3b-r" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#5c1716"/><stop offset=".18" stop-color="#99302a"/><stop offset=".55" stop-color="#8a2622"/><stop offset="1" stop-color="#561312"/></linearGradient>
    <linearGradient id="m3b-s" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity=".28"/><stop offset=".2" stop-color="#000" stop-opacity="0"/><stop offset=".8" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity=".35"/></linearGradient>
    <linearGradient id="m3b-rod" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#c2574a"/><stop offset=".45" stop-color="#93302a"/><stop offset="1" stop-color="#4f1211"/></linearGradient>
  </defs>
  <path d="M8 8 H96 V128 L52 152 L8 128 Z" fill="url(#m3b-r)" stroke="#2c0908" stroke-width="2" stroke-linejoin="round"/>
  <path d="M8 8 H96 V128 L52 152 L8 128 Z" fill="url(#m3b-s)"/>
  <path d="M14.5 14 H89.5 V124.5 L52 145 L14.5 124.5 Z" fill="none" stroke="#e0b565" stroke-width="1.6" stroke-linejoin="round" opacity=".8"/>
  <rect x="2" y="2" width="100" height="13" rx="6.5" fill="url(#m3b-rod)" stroke="#2c0908" stroke-width="1.5"/>
  <rect x="7" y="4.4" width="90" height="2.2" rx="1.1" fill="#f0a08a" opacity=".45"/>
</svg>`;

// Two crossed swords, points up (for the gold "Yeni Oyun").
const SWORD = `<path d="M24 1.5 27.6 7.5V28.5h-7.2V7.5z"/><path d="M24 4.5v23" stroke="rgba(255,236,180,.55)" stroke-width="1" fill="none"/><rect x="14.5" y="28" width="19" height="4.6" rx="2.3"/><rect x="21.8" y="32" width="4.4" height="9"/><circle cx="24" cy="43.4" r="3.4"/>`;
export const SVG_SWORDS2 = `<svg class="md-ico" viewBox="0 0 48 48" aria-hidden="true"><g transform="rotate(45 24 26)">${SWORD}</g><g transform="rotate(-45 24 26)">${SWORD}</g></svg>`;

export const SVG_CHEV = `<svg viewBox="0 0 12 20" aria-hidden="true"><path d="M2.5 2.5 10 10l-7.5 7.5" fill="none" stroke="currentColor" stroke-width="2.6" stroke-linecap="round" stroke-linejoin="round"/></svg>`;

// gold laurel branch beside the logo (mirrored for the right one)
export const laurel = (cls) => `<svg class="m3-laurel ${cls}" viewBox="0 0 40 40" aria-hidden="true">
  <path d="M33 37C18 33 8 22 6 4" fill="none" stroke="#b08b45" stroke-width="1.4" stroke-linecap="round"/>
  <g fill="#d2aa58">
    <ellipse cx="7" cy="9" rx="5" ry="2" transform="rotate(-80 7 9)"/>
    <ellipse cx="9" cy="16" rx="5.4" ry="2.1" transform="rotate(-62 9 16)"/>
    <ellipse cx="13" cy="23" rx="5.6" ry="2.2" transform="rotate(-44 13 23)"/>
    <ellipse cx="19" cy="29" rx="5.6" ry="2.2" transform="rotate(-28 19 29)"/>
    <ellipse cx="26" cy="34" rx="5.4" ry="2.1" transform="rotate(-12 26 34)"/>
  </g>
  <g fill="#a88440">
    <ellipse cx="13" cy="11" rx="4.4" ry="1.8" transform="rotate(10 13 11)"/>
    <ellipse cx="17" cy="18" rx="4.6" ry="1.9" transform="rotate(24 17 18)"/>
    <ellipse cx="23" cy="24.5" rx="4.6" ry="1.9" transform="rotate(38 23 24.5)"/>
  </g>
</svg>`;

// paper plane for the chat send button
export const SVG_PLANE = `<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M21.5 2.5 2.4 10.3c-.6.3-.6 1.100 0 1.400l6.300 2.300 2 6.400c.2.600 1 .8 1.500.3l3-3.300 4.300 3.200c.5.400 1.200.1 1.300-.5L22.600 3.400c.1-.6-.5-1.100-1.100-.9zM10.300 13.700l7.700-6.800-6 8-.6 3.200z" fill="currentColor"/></svg>`;

// simple chunky glyphs for the play cards
export const SVG_HAMMER = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><g transform="rotate(45 12 12)"><rect x="10.4" y="7" width="3.2" height="16" rx="1.4"/><path d="M5 2.500h11.500l3 2.200v3.600l-3-1.300H5a1 1 0 0 1-1-1v-2.500a1 1 0 0 1 1-1z"/></g></svg>`;
export const SVG_FLOPPY = `<svg class="md-ico" viewBox="0 0 24 24" aria-hidden="true"><path d="M5 3h11.500L21 7.500V19a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zm2 2v4.500h8V5zm5.200.8h1.800v2.900h-1.800zM7 13.500V19h10v-5.500z"/></svg>`;
