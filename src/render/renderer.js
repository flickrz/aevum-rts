// Aevum - world renderer: terrain, water, trees, decor, sky, lights, fog of war, camera
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { Fx } from './fx.js';
import { EntityView } from './entities.js';
import { Floaters } from './floaters.js';
import { OrderLines } from './orderlines.js';
import { PLAYER_COLORS } from '../data.js';
import { loadTrees, treeVersion, treeGeo, glbWarm } from './glb-models.js';

const HORIZON = 0xc4dcee;
const ZENITH = 0x3a7bd0;
const FOG_DENSITY = 0.0034;
// Climates (view only: the simulation never sees them). cfg.climate picks one; 'random' / missing is resolved
// from the map seed, so every client of a match sees the same. Colours are hex; atmo tints the age skies.
export const CLIMATES = {
  temperate: { name: 'Ilıman', grass: 0x74ad3e, forest: 0x4d7c33, grass2: 0x93bf4e, grass3: 0x5c9a3a, dry: 0xa9ad55, sand: 0xdcc98f,
    leaf: [0x5fa53a, 0x76b843, 0x4c8f35, 0x8fb845], pine: [0x2f6b3a, 0x3a7a44, 0x285c38, 0x44804a], blade: [0x7fbf45, 0x9ccc50, 0x66a83c, 0xb5c95a],
    flowers: [0xffffff, 0xffd84a, 0xff7a8a, 0xb48cff, 0xff9a3a], flowerMul: 1, hill: [0x6da23d, 0x8fb84c, 0x4f8434], atmo: null, fog: 1,
    deep: 0x14507a, shallow: 0x4fc0c8, mm: [[79, 125, 58], [47, 90, 44]] },
  spring: { name: 'İlkbahar', grass: 0x6fb83e, forest: 0x4a8a34, grass2: 0x8fd052, grass3: 0x58a63a, dry: 0x9fbf55, sand: 0xdccb92,
    leaf: [0x7cc04a, 0xf2a6c6, 0x98d058, 0xf7d0e0], pine: [0x2f6b3a, 0x3a7a44, 0x2d6a3e, 0x44804a], blade: [0x86c84a, 0xa4d658, 0x6cb440, 0xbcd862],
    flowers: [0xffffff, 0xffe066, 0xff8aa8, 0xc49cff, 0xff6fa8, 0xfff2a0], flowerMul: 2.2, hill: [0x72b043, 0x96c955, 0x57903a], atmo: { h: 0xd4e8f4, mix: 0.35 }, fog: 0.9,
    deep: 0x16587e, shallow: 0x58c8cc, mm: [[86, 140, 62], [54, 104, 48]] },
  autumn: { name: 'Sonbahar', grass: 0x8f9a3e, forest: 0x6a6a32, grass2: 0xb0a24c, grass3: 0x76843a, dry: 0xc0a050, sand: 0xd8c288,
    leaf: [0xd4762c, 0xc4482a, 0xe2a83a, 0xb86a2a], pine: [0x34613a, 0x3d6a40, 0x2c5636, 0x4a7446], blade: [0xa8a048, 0xc0a850, 0x8c9440, 0xd0b058],
    flowers: [0xffb040, 0xe8702a, 0xf0d060], flowerMul: 0.6, hill: [0x93963f, 0xb3a24c, 0x6f7a36], atmo: { h: 0xe8d2b4, z: 0x5a86b8, s: 0xffd6a2, mix: 0.55 }, fog: 1.1,
    deep: 0x1d4c6a, shallow: 0x5aa6aa, mm: [[128, 128, 60], [96, 92, 48]] },
  winter: { name: 'Kış', grass: 0xe6edf1, forest: 0xc9d5d8, grass2: 0xf5f9fc, grass3: 0xd2dde2, dry: 0xb8c4bc, sand: 0xd8dcd6, snowy: true,
    leaf: [0xc8d2cf, 0xa9b5ad, 0xdbe3e0, 0x8f9a8c], pine: [0x2f5844, 0x3a6650, 0x2a4e3e, 0x46705a], blade: [0xb9c6c2, 0xcfd9d6, 0xa4b2aa, 0xe2e9e8],
    flowers: [0xffffff], flowerMul: 0, hill: [0xe1e9ee, 0xf3f7fa, 0xc5d1d6], atmo: { h: 0xe2eaf0, z: 0x6f93bd, s: 0xeef4ff, mix: 0.7 }, fog: 1.35,
    deep: 0x2a5874, shallow: 0x8cc2cc, mm: [[214, 222, 228], [178, 192, 196]] },
  arid: { name: 'Kurak', grass: 0xc7ad6a, forest: 0x9a8c4e, grass2: 0xd8c17e, grass3: 0xa89a58, dry: 0xd2b066, sand: 0xe4cc8e,
    leaf: [0x8a9a4a, 0x9fa856, 0x76863e, 0xb0aa5c], pine: [0x5c6e3a, 0x667840, 0x52643a, 0x748048], blade: [0xc4b468, 0xd6c278, 0xa89c56, 0xe0cc84],
    flowers: [0xffd84a, 0xff9a3a], flowerMul: 0.25, hill: [0xc6aa68, 0xd8bf7c, 0xa48f56], atmo: { h: 0xeadab4, z: 0x5f8fc6, s: 0xffe4b8, mix: 0.6 }, fog: 1.15,
    deep: 0x1a5470, shallow: 0x5cc0bc, mm: [[190, 168, 104], [150, 136, 82]] },
};
export const CLIMATE_KEYS = Object.keys(CLIMATES);
export function climateOf(cfg) {
  const want = cfg && cfg.climate;
  if (want && CLIMATES[want]) return want;
  let h = ((cfg && cfg.seed) | 0) ^ 0x9e3779b9; h = Math.imul(h ^ (h >>> 16), 0x45d9f3b); h ^= h >>> 16;
  return CLIMATE_KEYS[(h >>> 0) % CLIMATE_KEYS.length];
}

// per-age atmosphere for player 0 (horizon/fog, zenith, sun colour, fog density) - subtle, blended smoothly
const AGE_ATMO = [
  { h: 0xe6d3b6, z: 0x4f84c4, s: 0xffdcae, d: 0.0037 }, // Tas Devri: warm dawn
  { h: 0xc4dcee, z: 0x3a7bd0, s: 0xffedcf, d: 0.0034 }, // Tunc Devri: clear day
  { h: 0xbad6f2, z: 0x3170d2, s: 0xfff3e0, d: 0.0032 }, // Orta Cag: crisp blue
  { h: 0xd2d4d6, z: 0x4577bc, s: 0xffe6c4, d: 0.0038 }, // Barut Cagi: powder haze
  { h: 0xe8dcc6, z: 0x4f86c8, s: 0xfff0d6, d: 0.0036 }, // Sanayi Cagi: bright day, light warm industrial haze
];
const SUN_BASE = 3.0;

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const TREE_CHUNK = 24;   // tiles per side of one tree draw chunk (see _buildTrees)

function hash2(x, z) {
  const s = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return s - Math.floor(s);
}
function vnoise(x, z) {
  const xi = Math.floor(x), zi = Math.floor(z);
  const fx = x - xi, fz = z - zi;
  const ux = fx * fx * (3 - 2 * fx), uz = fz * fz * (3 - 2 * fz);
  const a = hash2(xi, zi), b = hash2(xi + 1, zi), c = hash2(xi, zi + 1), d = hash2(xi + 1, zi + 1);
  return a + (b - a) * ux + (c - a) * uz + (a - b - c + d) * ux * uz;
}
function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeDetailTexture() {
  const S = 256;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  g.fillStyle = 'rgb(222,222,222)';
  g.fillRect(0, 0, S, S);
  for (let i = 0; i < 9000; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const v = Math.random() < 0.5 ? 255 : 120;
    g.fillStyle = `rgba(${v},${v},${v},${0.05 + Math.random() * 0.12})`;
    const r = 0.6 + Math.random() * 2.2;
    g.fillRect(x, y, r, r);
  }
  for (let i = 0; i < 1400; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const v = Math.random() < 0.5 ? 255 : 90;
    g.strokeStyle = `rgba(${v},${v},${v},${0.06 + Math.random() * 0.1})`;
    g.lineWidth = 1;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + (Math.random() - 0.5) * 5, y - 2 - Math.random() * 5);
    g.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 22;
    const gr = g.createRadialGradient(x, y, 0, x, y, r);
    const v = Math.random() < 0.5 ? 255 : 100;
    gr.addColorStop(0, `rgba(${v},${v},${v},0.10)`);
    gr.addColorStop(1, `rgba(${v},${v},${v},0)`);
    g.fillStyle = gr;
    g.fillRect(x - r, y - r, r * 2, r * 2);
  }
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const SKY_VERT = `
varying vec3 vDir;
void main(){
  vDir = normalize(position);
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;
const SKY_FRAG = `
uniform vec3 uHorizon; uniform vec3 uZenith; uniform vec3 uSunDir;
varying vec3 vDir;
void main(){
  vec3 d = normalize(vDir);
  float h = max(d.y, 0.0);
  vec3 col = mix(uHorizon, uZenith, pow(h, 0.55));
  float s = max(dot(d, uSunDir), 0.0);
  col += vec3(1.0, 0.85, 0.6) * (pow(s, 350.0) * 2.0 + pow(s, 12.0) * 0.18);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

const WATER_VERT = `
varying vec3 vWorld;
void main(){
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vWorld = wp.xyz;
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const WATER_FRAG = `
uniform float uTime; uniform float uMapSize; uniform float uFogDensity;
uniform sampler2D uFow; uniform sampler2D uDepth;
uniform vec3 uSunDir; uniform vec3 uFogColor; uniform vec3 uDeep; uniform vec3 uShallow; uniform vec3 uSky;
varying vec3 vWorld;
void main(){
  vec2 p = vWorld.xz;
  float t = uTime;
  vec2 g = vec2(0.0);
  g += vec2(1.0, 0.6) * cos(dot(p, vec2(1.0, 0.6)) * 0.9 + t * 1.1) * 0.10;
  g += vec2(-0.7, 1.0) * cos(dot(p, vec2(-0.7, 1.0)) * 1.7 + t * 1.6) * 0.07;
  g += vec2(0.3, -1.0) * cos(dot(p, vec2(0.3, -1.0)) * 3.1 + t * 2.3) * 0.045;
  g += vec2(1.0, 1.0) * cos(dot(p, vec2(1.0, 1.0)) * 5.3 - t * 2.9) * 0.03;
  vec3 n = normalize(vec3(-g.x, 1.0, -g.y));
  vec3 v = normalize(cameraPosition - vWorld);
  float fres = pow(1.0 - max(dot(n, v), 0.0), 3.0);
  vec2 uv = p / uMapSize;
  float inside = step(0.0, uv.x) * step(uv.x, 1.0) * step(0.0, uv.y) * step(uv.y, 1.0);
  float depth = mix(1.0, texture2D(uDepth, (p + 0.5) / (uMapSize + 1.0)).r, inside);
  vec3 col = mix(uShallow, uDeep, smoothstep(0.0, 0.75, depth));
  col = mix(col, uSky, clamp(fres * 0.65, 0.0, 1.0));
  vec3 hv = normalize(uSunDir + v);
  col += vec3(1.0, 0.95, 0.8) * pow(max(dot(n, hv), 0.0), 140.0) * 1.3;
  float foam = smoothstep(0.17, 0.0, depth) * (0.55 + 0.45 * sin(depth * 55.0 - t * 2.2 + p.x * 0.9 + p.y * 0.7));
  foam = clamp(foam, 0.0, 1.0);
  col = mix(col, vec3(1.0), foam * 0.75);
  float alpha = mix(0.5, 0.93, smoothstep(0.0, 0.55, depth));
  alpha = clamp(max(alpha, foam * 0.85) + fres * 0.2, 0.0, 1.0);
  float fw = texture2D(uFow, clamp(uv, 0.0, 1.0)).r;
  vec2 fo = max(-uv, uv - 1.0);   // outside the map: daylight within a few tiles, like the border hills
  fw = mix(fw, 1.0, smoothstep(0.5, 7.0, max(max(fo.x, fo.y), 0.0) * uMapSize));
  col *= mix(0.05, 1.0, fw);
  float d = distance(cameraPosition, vWorld);
  float ff = 1.0 - exp(-uFogDensity * uFogDensity * d * d);
  col = mix(col, uFogColor, ff);
  gl_FragColor = vec4(col, alpha);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.quality = 'high';
    this.time = 0;
    this.game = null;
    this.entityView = null;
    this.N = 96;

    const r = (this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' }));
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.05;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.shadowMap.enabled = true;
    r.localClippingEnabled = true; // construction sites reveal buildings course by course
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    // a lost WebGL context (driver reset, GPU memory) shows a black canvas: let the browser restore it
    canvas.addEventListener('webglcontextlost', (ev) => { ev.preventDefault(); console.warn('[Renderer] WebGL context lost'); this._ctxLost = true; }, false);
    canvas.addEventListener('webglcontextrestored', () => { console.warn('[Renderer] WebGL context restored'); this._ctxLost = false; this._arAvg = null; }, false);

    this.scene = new THREE.Scene();
    this.scene.fog = new THREE.FogExp2(HORIZON, FOG_DENSITY);
    // depth precision (z-fighting): near follows the zoom (_updateCamera, 1 close up .. 4 zoomed out); far just past
    // the sky dome (radius 1200, centred on the camera)
    this.camera = new THREE.PerspectiveCamera(40, 1, 1, 1300);
    this.cam = { tx: 48, tz: 48, dist: 26, yaw: 0, pitch: 0.87 };
    this._c = { tx: 48, tz: 48, dist: 26, yaw: 0, pitch: 0.87 };

    // shared uniforms (fog of war, time)
    this._blankFow = new THREE.DataTexture(new Uint8Array([255]), 1, 1, THREE.RedFormat, THREE.UnsignedByteType);
    this._blankFow.needsUpdate = true;
    this.shared = { uFow: { value: this._blankFow }, uMapSize: { value: 96 }, uTime: { value: 0 } };
    this.sunDir = new THREE.Vector3(0.5, 0.8, 0.3).normalize();

    // lights
    this.hemi = new THREE.HemisphereLight(0xd6eaff, 0x7a6845, 1.15);
    this.scene.add(this.hemi);
    const sun = (this.sun = new THREE.DirectionalLight(0xffedcf, 3.0));
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    sun.shadow.bias = -0.0005;
    sun.shadow.normalBias = 0.06;
    sun.shadow.camera.near = 1;
    sun.shadow.camera.far = 300;
    this.scene.add(sun);
    this.scene.add(sun.target);
    this._shadowHalf = 0;

    // sky dome
    this.skyU = {
      uHorizon: { value: new THREE.Color(HORIZON) },
      uZenith: { value: new THREE.Color(ZENITH) },
      uSunDir: { value: this.sunDir },
    };
    this.sky = new THREE.Mesh(
      new THREE.SphereGeometry(1200, 24, 12),
      new THREE.ShaderMaterial({ uniforms: this.skyU, vertexShader: SKY_VERT, fragmentShader: SKY_FRAG, side: THREE.BackSide, depthWrite: false, fog: false })
    );
    this.sky.frustumCulled = false;
    this.sky.renderOrder = -10;
    this.scene.add(this.sky);

    this.fx = new Fx(this.scene);
    this._atmoAge = -1; this._atmoT = { h: new THREE.Color(HORIZON), z: new THREE.Color(ZENITH), s: new THREE.Color(0xffedcf), d: FOG_DENSITY };
    this._fogD = FOG_DENSITY; this._sunBoost = 0; this._celebrate = [];
    this.world = null;
    this._subs = [];
    this._markers = [];
    this._markerGeo = new THREE.RingGeometry(0.72, 0.9, 40).rotateX(-Math.PI / 2);
    this._ray = new THREE.Raycaster();
    this._v = new THREE.Vector3();
    this.floaters = new Floaters(this.camera); this._fv = new THREE.Vector3();
    this.orderLines = new OrderLines(this.scene); this._olH = (x, z) => this.groundY(x, z); this._olC = (pid) => PLAYER_COLORS[pid] ?? 0xffffff;
    this._v2 = new THREE.Vector2();
    this._dummy = new THREE.Object3D();
    this._dummy.rotation.order = 'YXZ';
    this._warned = false;

    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // ---------------------------------------------------------------- helpers
  heightAt(x, z) {
    const N = this.N, H = this._heights;
    if (!H) return 0;
    x = clamp(x, 0, N - 0.0001); z = clamp(z, 0, N - 0.0001);
    const xi = x | 0, zi = z | 0, fx = x - xi, fz = z - zi, W = N + 1;
    const a = H[zi * W + xi], b = H[zi * W + xi + 1], c = H[(zi + 1) * W + xi], d = H[(zi + 1) * W + xi + 1];
    return (a + (b - a) * fx) * (1 - fz) + (c + (d - c) * fx) * fz;
  }
  groundY(x, z) { return Math.max(this.heightAt(x, z), 0); }

  _fogAt(x, z) {
    const g = this.game;
    if (!g || !g.fog) return 2;
    const N = this.N, tx = clamp(x | 0, 0, N - 1), tz = clamp(z | 0, 0, N - 1);
    return g.fog[tz * N + tx];
  }

  /** Patch a built-in material: fog-of-war darkening (+ optional wind sway / hide when unexplored). Usable by other views too. */
  patchMaterial(mat, opt = {}) {
    const u = this.shared;
    const sway = opt.sway || 0, hide = !!opt.hide;
    mat.onBeforeCompile = (sh) => {
      sh.uniforms.uFow = u.uFow; sh.uniforms.uMapSize = u.uMapSize; sh.uniforms.uTime = u.uTime;
      let bv = '#include <begin_vertex>\n';
      if (sway > 0) {
        bv += `#ifdef USE_INSTANCING
        float swP = instanceMatrix[3].x * 0.71 + instanceMatrix[3].z * 0.93;
        transformed.x += sin(uTime * 1.7 + swP) * ${sway.toFixed(4)} * position.y;
        transformed.z += cos(uTime * 1.3 + swP * 1.3) * ${(sway * 0.7).toFixed(4)} * position.y;
        #endif\n`;
      }
      if (hide) {
        bv += `#ifdef USE_INSTANCING
        transformed *= smoothstep(0.02, 0.3, texture2D(uFow, instanceMatrix[3].xz / uMapSize).r);
        #endif\n`;
      }
      sh.vertexShader = 'uniform sampler2D uFow;\nuniform float uMapSize;\nuniform float uTime;\nvarying vec2 vFowUv;\n' +
        sh.vertexShader
          .replace('#include <begin_vertex>', bv)
          .replace('#include <project_vertex>', `#include <project_vertex>
        vec4 fowWp = vec4(transformed, 1.0);
        #ifdef USE_INSTANCING
        fowWp = instanceMatrix * fowWp;
        #endif
        fowWp = modelMatrix * fowWp;
        vFowUv = fowWp.xz / uMapSize;`);
      // outside the map (opt.outside: the scenery around it): at the edge exactly the map's own fog shade (no seam),
      // then within a few tiles the full daylight of the map (owner 2026-11-14: the land goes on, no dark band), and
      // far out a soft haze of the sky's fog colour
      const fowLine = opt.outside
        ? 'vec2 fo = max(-vFowUv, vFowUv - 1.0); float fd = max(max(fo.x, fo.y), 0.0) * uMapSize;\n' +
          'gl_FragColor.rgb *= mix(mix(0.05, 1.0, texture2D(uFow, clamp(vFowUv, 0.0, 1.0)).r), 1.0, smoothstep(0.5, 7.0, fd));\n' +
          '#ifdef USE_FOG\ngl_FragColor.rgb = mix(gl_FragColor.rgb, fogColor, 0.3 * smoothstep(6.0, 90.0, fd));\n#endif\n'
        : 'gl_FragColor.rgb *= mix(0.05, 1.0, texture2D(uFow, clamp(vFowUv, 0.0, 1.0)).r);\n';
      sh.fragmentShader = 'uniform sampler2D uFow;\nuniform float uMapSize;\nvarying vec2 vFowUv;\n' +
        sh.fragmentShader.replace('#include <dithering_fragment>', fowLine + '#include <dithering_fragment>');
    };
    mat.customProgramCacheKey = () => 'aevum_' + sway.toFixed(4) + '_' + (hide ? 1 : 0) + (opt.outside ? '_out' : '');
    return mat;
  }

  // ---------------------------------------------------------------- world build
  setGame(game) {
    this._disposeWorld();
    this.game = game;
    if (this.orderLines) this.orderLines.clear();
    this._atmoAge = -1; this._sunBoost = 0; this._celebrate = [];
    if (!game) return;
    const map = game.map, N = (this.N = map.size);
    this._heights = map.heights;
    this.climateKey = climateOf(game.cfg); this.climate = CLIMATES[this.climateKey];
    this.hemi.groundColor.setHex(this.climate.snowy ? 0xb4c2c8 : this.climateKey === 'arid' ? 0x9a8458 : 0x7a6845);   // (light bounced off the ground)
    this.shared.uMapSize.value = N;
    this.world = new THREE.Group();
    this.scene.add(this.world);

    this._buildFow();
    this._buildTerrain();
    this._buildWater();
    this._buildTrees();
    this._buildDecor();

    const me0 = game.me ?? 0;
    const p0 = game.players && (game.players[me0] || game.players[0]);
    if (p0 && p0.startX != null) { this.cam.tx = p0.startX; this.cam.tz = p0.startZ; }
    else { this.cam.tx = N / 2; this.cam.tz = N / 2; }
    this.cam.dist = 26; this.cam.yaw = 0; this.cam.pitch = 0.87;
    Object.assign(this._c, this.cam);

    try {
      this.entityView = new EntityView(this.scene, game, { renderer: this, fx: this.fx });
    } catch (err) {
      console.error('[Renderer] EntityView failed', err);
      this.entityView = null;
    }
    this._subscribe();
  }

  _disposeWorld() {
    const ev = this.game && this.game.events;
    if (ev && ev.off) for (const [n, f] of this._subs) { try { ev.off(n, f); } catch (e) { /* ignore */ } }
    this._subs = [];
    if (this.entityView) { try { this.entityView.dispose(); } catch (e) { console.warn(e); } this.entityView = null; }
    if (this.world) {
      this.world.traverse((o) => {
        if (o.geometry) o.geometry.dispose();
        if (o.material) {
          const ms = Array.isArray(o.material) ? o.material : [o.material];
          for (const m of ms) { if (m.map) m.map.dispose(); m.dispose(); }
        }
      });
      this.scene.remove(this.world);
      this.world = null;
    }
    for (const m of this._markers) { this.scene.remove(m.mesh); m.mesh.material.dispose(); }
    this._markers = [];
    if (this.floaters) this.floaters.clear();
    if (this.fowTex) { this.fowTex.dispose(); this.fowTex = null; }
    if (this.depthTex) { this.depthTex.dispose(); this.depthTex = null; }
    this.shared.uFow.value = this._blankFow;
    this.trees = new Map();
    this._falling = [];
    this.treeMeshes = null;
    this.terrain = null;
    this.water = null;
  }

  _buildFow() {
    const N = this.N;
    this._fowData = new Uint8Array(N * N);
    this._fowCur = new Float32Array(N * N);
    const t = (this.fowTex = new THREE.DataTexture(this._fowData, N, N, THREE.RedFormat, THREE.UnsignedByteType));
    t.magFilter = THREE.LinearFilter; t.minFilter = THREE.LinearFilter;
    t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
    t.needsUpdate = true;
    this.shared.uFow.value = t;
    this._fowVer = -1; this._fowDirty = true; this._fowFirst = true;
  }

  _updateFow(dt) {
    const g = this.game;
    if (!g || !this.fowTex) return;
    if (g.fogVersion !== this._fowVer) { this._fowVer = g.fogVersion; this._fowDirty = true; }
    if (!this._fowDirty) return;
    const fog = g.fog, cur = this._fowCur, out = this._fowData, n = out.length;
    const step = this._fowFirst ? 1000 : dt * 520;
    let dirty = false;
    for (let i = 0; i < n; i++) {
      const f = fog ? fog[i] : 2;
      const target = f === 2 ? 255 : f === 1 ? 112 : 0;
      let c = cur[i];
      if (c !== target) {
        const d = target - c;
        c += d > step ? step : d < -step ? -step : d;
        cur[i] = c; out[i] = c;
        if (c !== target) dirty = true;
      }
    }
    this._fowFirst = false;
    this._fowDirty = dirty;
    this.fowTex.needsUpdate = true;
  }

  _buildTerrain() {
    const map = this.game.map, N = this.N, W = N + 1, H = map.heights, T = map.tiles;
    const pos = new Float32Array(W * W * 3), uv = new Float32Array(W * W * 2), col = new Float32Array(W * W * 3);
    for (let vz = 0; vz < W; vz++) for (let vx = 0; vx < W; vx++) {
      const i = vz * W + vx;
      pos[i * 3] = vx; pos[i * 3 + 1] = H[i]; pos[i * 3 + 2] = vz;
      uv[i * 2] = vx / 5; uv[i * 2 + 1] = vz / 5;
    }
    const idx = new Uint32Array(N * N * 6);
    let k = 0;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const a = z * W + x, b = a + 1, c = a + W, d = c + 1;
      idx[k++] = a; idx[k++] = c; idx[k++] = b; idx[k++] = b; idx[k++] = c; idx[k++] = d;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx, 1));
    geo.computeVertexNormals();
    const nrm = geo.attributes.normal.array;

    const C = (h) => new THREE.Color(h);
    const K = this.climate || CLIMATES.temperate;
    const pal = [C(K.grass), C(K.snowy ? 0x8a8278 : 0x66492a), C(K.sand), C(0xbfb27e), C(0x5f6f62), C(0x8d8780), C(K.forest)];
    const grass2 = C(K.grass2), grass3 = C(K.grass3), rock = C(0x8a847c), snow = C(0xf5f8fc), dry = C(K.dry);
    const tmp = new THREE.Color();
    for (let vz = 0; vz < W; vz++) for (let vx = 0; vx < W; vx++) {
      const i = vz * W + vx;
      let r = 0, g = 0, b = 0, n = 0;
      for (let dz = -1; dz <= 0; dz++) for (let dx = -1; dx <= 0; dx++) {
        const tx = vx + dx, tz = vz + dz;
        if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
        const t = T[tz * N + tx];
        tmp.copy(pal[t] || pal[0]);
        if (t === 0) {
          const nz = vnoise(tx * 0.13 + 7, tz * 0.13 + 3);
          const nz2 = vnoise(tx * 0.045 + 31, tz * 0.045 + 17);
          if (nz > 0.5) tmp.lerp(grass2, (nz - 0.5) * 1.5); else tmp.lerp(grass3, (0.5 - nz) * 1.2);
          if (nz2 > 0.62) tmp.lerp(dry, (nz2 - 0.62) * 1.6);
        }
        r += tmp.r; g += tmp.g; b += tmp.b; n++;
      }
      if (n) { r /= n; g /= n; b /= n; }
      tmp.setRGB(r, g, b);
      const h = H[i], ny = nrm[i * 3 + 1];
      if (h > 0.15 && ny < 0.86) tmp.lerp(rock, clamp((0.86 - ny) * 4.5, 0, 0.85));
      if (h > 5.2) tmp.lerp(snow, clamp((h - 5.2) / 1.1, 0, 1) * clamp(ny * 1.3 - 0.2, 0, 1));
      if (h < 0) tmp.multiplyScalar(clamp(1 + h * 0.25, 0.45, 1));
      const j = 0.9 + vnoise(vx * 0.9, vz * 0.9) * 0.14 + (hash2(vx, vz) - 0.5) * 0.06;
      col[i * 3] = tmp.r * j; col[i * 3 + 1] = tmp.g * j; col[i * 3 + 2] = tmp.b * j;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, map: makeDetailTexture(), roughness: 0.95, metalness: 0 });
    this.patchMaterial(mat);
    const mesh = (this.terrain = new THREE.Mesh(geo, mat));
    mesh.receiveShadow = true;
    mesh.frustumCulled = false;
    this.world.add(mesh);

    // dark skirt under the map so edges do not show sky
    const skirt = new THREE.Mesh(new THREE.PlaneGeometry(N + 600, N + 600).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x1b3a4a }));
    skirt.position.set(N / 2, -3.2, N / 2);
    this.world.add(skirt);
    try { this._buildBorderHills(); } catch (err) { console.warn('[Renderer] border hills', err); }
  }

  // Natural hills around the map (view only; the simulation never sees them): a ring of rolling, rocky,
  // partly snowy hills that rises from the map's edge, with pines on the lower slopes, so the world does not
  // end in a cut-off edge. Fog of war darkens them like the map edge next to them.
  _buildBorderHills() {
    const N = this.N, H = this._heights, W = N + 1, B = 40, S = 1;      // ring width (tiles), grid step
    const edgeH = (x, z) => { const cx = clamp(Math.round(x), 0, N), cz = clamp(Math.round(z), 0, N); return H[cz * W + cx]; };
    const hAt = (x, z) => {
      const ox = x < 0 ? -x : x > N ? x - N : 0, oz = z < 0 ? -z : z > N ? z - N : 0;
      const d = Math.max(ox, oz);
      const e = edgeH(x, z);
      if (d <= 0) return e;
      // rise: gentle foot, then hills; noise makes ridges and saddles, a second octave adds bumps
      const n1 = vnoise(x * 0.06 + 11, z * 0.06 + 5), n2 = vnoise(x * 0.17 + 3, z * 0.17 + 29);
      const rise = Math.min(1, d / 14), foot = rise * rise * (3 - 2 * rise);
      const top = 3.2 + n1 * 6.5 + n2 * 1.6 + Math.min(1, Math.max(0, (d - 14) / 20)) * 2.5;
      const base = Math.max(e, 0.05);
      // farther out the hills grow into mountain ranges that run to the horizon (the far grid below)
      const far = Math.min(1, Math.max(0, (d - 30) / 90)), mtn = far * far * (vnoise(x * 0.011 + 71, z * 0.011 + 13) * 22 + vnoise(x * 0.034 + 5, z * 0.034 + 41) * 7);
      // (always above the water plane, which is wider than the map: no stray lakes in the hills)
      return Math.max(e + (base - e) * Math.min(1, d / 2) + foot * top + mtn, Math.min(1, d) * 0.3);
    };
    const distOut = (x, z) => Math.max(x < 0 ? -x : x > N ? x - N : 0, z < 0 ? -z : z > N ? z - N : 0);
    // signed: outside the map the distance to it, inside MINUS the distance to the nearest edge. (The grids pick
    // their cells with it; distOut is 0 everywhere inside, so the near grid used to cover the WHOLE map 0.3 under
    // the terrain - wasted triangles, and it showed through wherever a foundation lowered the ground.)
    const sdist = (x, z) => { const o = distOut(x, z); return o > 0 ? o : -Math.min(x, z, N - x, N - z); };
    const KH = (this.climate || CLIMATES.temperate).hill;
    const grass = new THREE.Color(KH[0]), grass2 = new THREE.Color(KH[1]), dark = new THREE.Color(KH[2]), rock = new THREE.Color(0x8a847c), rock2 = new THREE.Color(0x6f6a64), snow = new THREE.Color(0xf2f5fa), sand = new THREE.Color(0xd8c690), c = new THREE.Color();
    const detail = makeDetailTexture();
    // one grid over [-R, N+R] with step S; keep(cellDist) picks the cells; drop lowers it (the far grid sits
    // a little under the near one where they overlap, so no seam shows)
    const tcol = this.terrain && this.terrain.geometry.attributes.color ? this.terrain.geometry.attributes.color.array : null;
    const grid = (R, S, keep, drop, near) => {
      const G = Math.round((N + 2 * R) / S) + 1, verts = [], idx = [], id = new Int32Array(G * G).fill(-1);
      const cellOk = (i, j) => i >= 0 && j >= 0 && i < G - 1 && j < G - 1 && keep(sdist(-R + (i + 0.5) * S, -R + (j + 0.5) * S));
      for (let j = 0; j < G; j++) for (let i = 0; i < G; i++) {
        if (!cellOk(i, j) && !cellOk(i - 1, j) && !cellOk(i, j - 1) && !cellOk(i - 1, j - 1)) continue;
        const x = -R + i * S, z = -R + j * S;
        id[j * G + i] = verts.length / 3;
        // (near grid: only its part under the map is lowered; at the edge it meets the map's own heights)
        verts.push(x, hAt(x, z) - (near ? (distOut(x, z) > 0 || !(x > 0 && z > 0 && x < N && z < N) ? 0 : drop) : drop), z);
      }
      for (let j = 0; j < G - 1; j++) for (let i = 0; i < G - 1; i++) {
        if (!cellOk(i, j)) continue;
        const a = id[j * G + i], b = id[j * G + i + 1], cc = id[(j + 1) * G + i], d = id[(j + 1) * G + i + 1];
        idx.push(a, cc, b, b, cc, d);
      }
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.Float32BufferAttribute(verts, 3));
      const uv = new Float32Array((verts.length / 3) * 2);
      for (let v = 0; v < verts.length / 3; v++) { uv[v * 2] = verts[v * 3] / 5; uv[v * 2 + 1] = verts[v * 3 + 2] / 5; }
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setIndex(idx);
      geo.computeVertexNormals();
      const nrm = geo.attributes.normal.array, nv = verts.length / 3, col = new Float32Array(nv * 3);
      if (near) {   // normals from the height field itself (as the map's terrain has them): no shading seam at the edge
        for (let v = 0; v < nv; v++) {
          const x = verts[v * 3], z = verts[v * 3 + 2], gx = (hAt(x + 1, z) - hAt(x - 1, z)) / 2, gz = (hAt(x, z + 1) - hAt(x, z - 1)) / 2, l = Math.hypot(gx, 1, gz);
          nrm[v * 3] = -gx / l; nrm[v * 3 + 1] = 1 / l; nrm[v * 3 + 2] = -gz / l;
        }
      }
      for (let v = 0; v < nv; v++) {
        const x = verts[v * 3], y = verts[v * 3 + 1] + drop, z = verts[v * 3 + 2], ny = nrm[v * 3 + 1];
        const n = vnoise(x * 0.13 + 7, z * 0.13 + 3);
        c.copy(grass); if (n > 0.5) c.lerp(grass2, (n - 0.5) * 1.4); else c.lerp(dark, (0.5 - n) * 1.2);
        if (y < 0.25) c.lerp(sand, clamp((0.25 - y) * 3, 0, 0.9));
        if (ny < 0.88) c.lerp(vnoise(x * 0.3, z * 0.3) > 0.5 ? rock : rock2, clamp((0.88 - ny) * 3.2, 0, 0.9));
        if (y > 7.2) c.lerp(rock2, clamp((y - 7.2) / 6, 0, 0.6));                     // bare rock above the forests
        if (y > 13) c.lerp(snow, clamp((y - 13) / 3, 0, 1) * clamp(ny * 1.4 - 0.2, 0, 1)); // snow caps
        const jj = 0.9 + vnoise(x * 0.9, z * 0.9) * 0.14 + (hash2(x | 0, z | 0) - 0.5) * 0.05;
        let r = c.r * jj, gg = c.g * jj, b = c.b * jj;
        // the first tiles out take the colour of the map's edge, so ground runs on without a line
        const dd = distOut(x, z);
        if (near && tcol && dd < 8) {
          const k = (clamp(Math.round(z), 0, N) * W + clamp(Math.round(x), 0, N)) * 3, t = 1 - clamp(dd / 8, 0, 1), tt = t * t * (3 - 2 * t);
          r += (tcol[k] - r) * tt; gg += (tcol[k + 1] - gg) * tt; b += (tcol[k + 2] - b) * tt;
        }
        col[v * 3] = r; col[v * 3 + 1] = gg; col[v * 3 + 2] = b;
      }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = this.patchMaterial(new THREE.MeshStandardMaterial({ vertexColors: true, map: detail, roughness: near ? 0.95 : 0.96, metalness: 0, flatShading: !near }), { outside: true });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.receiveShadow = true; mesh.frustumCulled = false;
      this.world.add(mesh);
      return mesh;
    };
    grid(B, 2, (d) => d > -2, 0.6, true);           // near hills: 2-tile cells, reaching 2 tiles under the map's edge (0.6 below it)
    grid(340, 8, (d) => d >= 34, 0.6);              // far mountains to the horizon: 8-tile cells (cheap), under the fog
    // pines on the lower, not too steep slopes
    const spots = [];
    for (let z = -B + 1; z < N + B - 1; z += 2.1) for (let x = -B + 1; x < N + B - 1; x += 2.1) {
      const ox = x < 0 ? -x : x > N ? x - N : 0, oz = z < 0 ? -z : z > N ? z - N : 0, d = Math.max(ox, oz);
      if (d < 3) continue;
      const jx = x + (hash2((x * 7) | 0, (z * 7) | 0) - 0.5) * 1.3, jz = z + (hash2((x * 13) | 0, (z * 3) | 0) - 0.5) * 1.3;
      const y = hAt(jx, jz), slope = Math.abs(hAt(jx + 0.6, jz) - y) + Math.abs(hAt(jx, jz + 0.6) - y);
      if (y < 0.3 || y > 6.4 || slope > 1.1) continue;
      if (vnoise(jx * 0.09 + 50, jz * 0.09 + 20) < 0.48 || hash2((jx * 5) | 0, (jz * 5) | 0) < 0.25) continue;
      spots.push(jx, y, jz);
    }
    const n = spots.length / 3; if (!n) return;
    // (cheap pines: two 6-sided tiers on a short dark base, ~26 triangles, no shadows)
    const pineGeo = this._foliageGeo([new THREE.CylinderGeometry(0.06, 0.1, 0.5, 4).translate(0, 0.25, 0), new THREE.ConeGeometry(0.62, 1.2, 6, 1, true).translate(0, 1.05, 0), new THREE.ConeGeometry(0.44, 1.0, 6, 1, true).translate(0, 1.8, 0)]);
    const leaf = new THREE.InstancedMesh(pineGeo, this.patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { outside: true }), n);
    const pc = (this.climate || CLIMATES.temperate).pine.map((c) => new THREE.Color(c));
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3(), up = new THREE.Vector3(0, 1, 0);
    for (let k = 0; k < n; k++) {
      const x = spots[k * 3], y = spots[k * 3 + 1], z = spots[k * 3 + 2], r = hash2((x * 31) | 0, (z * 17) | 0);
      q.setFromAxisAngle(up, r * 6.283); const sc = 0.9 + r * 0.8; s.set(sc, sc * (0.9 + hash2(k, 3) * 0.4), sc); p.set(x, y - 0.05, z);
      m.compose(p, q, s); leaf.setMatrixAt(k, m); leaf.setColorAt(k, pc[k & 3]);
    }
    leaf.castShadow = false; leaf.receiveShadow = false; leaf.frustumCulled = false; this.world.add(leaf);
  }

  // the sim changed heights in a rectangle of vertices (a levelled foundation): move those terrain vertices and
  // recompute their normals (the heights array is shared with the sim, units and buildings follow by themselves)
  _patchTerrain(r) {
    const t = this.terrain; if (!t || !r) return;
    const N = this.N, W = N + 1, H = this._heights, pos = t.geometry.attributes.position, nrm = t.geometry.attributes.normal;
    const x0 = Math.max(0, r.x0 - 1), z0 = Math.max(0, r.z0 - 1), x1 = Math.min(N, r.x1 + 1), z1 = Math.min(N, r.z1 + 1);
    const h = (x, z) => H[clamp(z, 0, N) * W + clamp(x, 0, N)];
    for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
      const i = z * W + x;
      pos.array[i * 3 + 1] = H[i];
      const nx = h(x - 1, z) - h(x + 1, z), nz = h(x, z - 1) - h(x, z + 1), l = Math.hypot(nx, 2, nz);
      nrm.array[i * 3] = nx / l; nrm.array[i * 3 + 1] = 2 / l; nrm.array[i * 3 + 2] = nz / l;
    }
    pos.needsUpdate = true; nrm.needsUpdate = true;
  }

  _buildWater() {
    const N = this.N, W = N + 1, H = this.game.map.heights;
    const d = new Uint8Array(W * W);
    for (let i = 0; i < d.length; i++) d[i] = clamp(-H[i] / 1.4, 0, 1) * 255;
    const dt = (this.depthTex = new THREE.DataTexture(d, W, W, THREE.RedFormat, THREE.UnsignedByteType));
    dt.magFilter = dt.minFilter = THREE.LinearFilter;
    dt.needsUpdate = true;
    this.waterU = {
      uTime: this.shared.uTime, uMapSize: this.shared.uMapSize, uFow: this.shared.uFow,
      uDepth: { value: dt }, uSunDir: { value: this.sunDir },
      uFogColor: { value: new THREE.Color(HORIZON) }, uFogDensity: { value: FOG_DENSITY },
      uDeep: { value: new THREE.Color((this.climate || CLIMATES.temperate).deep) }, uShallow: { value: new THREE.Color((this.climate || CLIMATES.temperate).shallow) },
      uSky: { value: new THREE.Color(0xa9d2f2) },
    };
    const mat = new THREE.ShaderMaterial({ uniforms: this.waterU, vertexShader: WATER_VERT, fragmentShader: WATER_FRAG, transparent: true, depthWrite: false });
    const w = (this.water = new THREE.Mesh(new THREE.PlaneGeometry(N + 600, N + 600).rotateX(-Math.PI / 2), mat));
    w.position.set(N / 2, 0, N / 2);
    w.renderOrder = 1;
    this.world.add(w);
  }

  _foliageGeo(parts) {
    const gs = parts.map((g) => (g.index ? g.toNonIndexed() : g));
    const geo = mergeGeometries(gs);
    geo.computeBoundingBox();
    const p = geo.attributes.position, y0 = geo.boundingBox.min.y, y1 = geo.boundingBox.max.y;
    const c = new Float32Array(p.count * 3);
    for (let i = 0; i < p.count; i++) {
      const k = 0.62 + 0.5 * ((p.getY(i) - y0) / (y1 - y0));
      c[i * 3] = k; c[i * 3 + 1] = k; c[i * 3 + 2] = k;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(c, 3));
    return geo;
  }

  _buildTrees() {
    this.trees = new Map();
    this._falling = [];
    const list = [];
    for (const e of this.game.entities.values()) if (e.kind === 'resource' && e.type === 'tree') list.push(e);
    const trunkMat = this.patchMaterial(new THREE.MeshLambertMaterial({ color: 0x7a5533 }), { sway: 0.012, hide: true });
    const leafMat = this.patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }), { sway: 0.03, hide: true });
    const bTrunk = new THREE.CylinderGeometry(0.08, 0.14, 1.0, 6).translate(0, 0.5, 0);
    const bLeaf = this._foliageGeo([
      new THREE.IcosahedronGeometry(0.62, 1).scale(1, 0.85, 1).translate(0, 1.3, 0),
      new THREE.IcosahedronGeometry(0.44, 0).translate(0.14, 1.85, 0.06),
    ]);
    const pTrunk = new THREE.CylinderGeometry(0.07, 0.12, 0.8, 6).translate(0, 0.4, 0);
    const pLeaf = this._foliageGeo([
      new THREE.ConeGeometry(0.58, 1.15, 7).translate(0, 1.15, 0),
      new THREE.ConeGeometry(0.4, 1.0, 7).translate(0, 1.95, 0),
    ]);
    // Trees are drawn in chunks of TREE_CHUNK x TREE_CHUNK tiles, each its own instanced mesh with a bounding
    // sphere: the camera and the sun's shadow camera skip every chunk they do not see (one mesh for the whole map
    // drew all forests twice a frame, the biggest GPU cost on large maps).
    const kindOf = (e) => (this.heightAt(e.x, e.z) > 3.0 ? 1 : 0);
    const keyOf = (kind, x, z) => kind + ':' + Math.floor(x / TREE_CHUNK) + ':' + Math.floor(z / TREE_CHUNK);
    const caps = new Map();
    for (const e of list) { const k = keyOf(kindOf(e), e.x, e.z); caps.set(k, (caps.get(k) || 0) + 1); }
    const geos = [[bTrunk, bLeaf], [pTrunk, pLeaf]];
    const mk = (geo, mat, n, cx, cz) => {
      const m = new THREE.InstancedMesh(geo, mat, n);
      m.count = 0; m.castShadow = true; m.receiveShadow = true; m.frustumCulled = true;
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      // (fixed sphere around the chunk: trees only ever shrink or fall inside it)
      m.boundingSphere = new THREE.Sphere(new THREE.Vector3(cx, 3, cz), TREE_CHUNK * 0.75 + 3);
      this.world.add(m);
      return m;
    };
    this.treeMeshes = new Map();
    // the chunk of a tree, made when first needed (room for a few trees added later)
    this._treeChunk = (kind, x, z) => {
      const key = keyOf(kind, x, z);
      let tm = this.treeMeshes.get(key);
      if (!tm) {
        const n = (caps.get(key) || 0) + 24, cx = (Math.floor(x / TREE_CHUNK) + 0.5) * TREE_CHUNK, cz = (Math.floor(z / TREE_CHUNK) + 0.5) * TREE_CHUNK;
        tm = { trunk: mk(geos[kind][0], trunkMat, n, cx, cz), leaf: mk(geos[kind][1], leafMat, n, cx, cz), n: 0, cap: n, kind };
        this._treeLook(tm);   // (a generated tree if its file has loaded already)
        this.treeMeshes.set(key, tm);
      }
      return tm;
    };
    const KT = this.climate || CLIMATES.temperate;
    this._leafCols = [KT.leaf.map((c) => new THREE.Color(c)), KT.pine.map((c) => new THREE.Color(c))];
    for (const e of list) this._addTree(e);
    for (const tm of this.treeMeshes.values()) {
      tm.trunk.instanceMatrix.needsUpdate = true; tm.leaf.instanceMatrix.needsUpdate = true;
      if (tm.leaf.instanceColor) tm.leaf.instanceColor.needsUpdate = true;
    }
    this._treeScan = 0;
    this._treeV = treeVersion();
    try { loadTrees(); } catch (err) { /* procedural trees */ }
  }

  // a tree chunk in the generated tree look (glb-models.js): a textured tree is drawn whole by the crown mesh with
  // its own material (the climate colour only tints it lightly), the trunk mesh then draws nothing
  _treeLook(tm) {
    const gg = treeGeo(tm.kind);
    if (!gg || tm.look === gg) return;
    tm.look = gg;
    if (gg.whole) {
      this._treeTexMat = this._treeTexMat || [];
      let m = this._treeTexMat[tm.kind];
      if (!m) m = this._treeTexMat[tm.kind] = this.patchMaterial(new THREE.MeshLambertMaterial({ map: gg.map }), { sway: 0.03, hide: true });
      this._emptyGeo = this._emptyGeo || new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([], 3));
      tm.trunk.geometry = this._emptyGeo; tm.trunk.visible = false;   // (nothing to draw: no empty draw call, main pass or shadow)
      tm.leaf.geometry = gg.whole; tm.leaf.material = m;
      // the instance colours were the climate's leaf colours (multiplying a grey crown): now only a light tint
      if (tm.leaf.instanceColor) {
        const a = tm.leaf.instanceColor.array;
        for (let i = 0; i < a.length; i++) a[i] = 0.72 + 0.28 * Math.min(1, a[i] * 2.2);
        tm.leaf.instanceColor.needsUpdate = true;
      }
      tm.tex = true;
    } else {
      if (gg.trunk) tm.trunk.geometry = gg.trunk;
      tm.leaf.geometry = gg.leaf;
    }
  }

  _addTree(e) {
    if (!this.treeMeshes || this.trees.has(e.id)) return;
    const y = this.heightAt(e.x, e.z);
    const kind = y > 3.0 ? 1 : 0;
    const tm = this._treeChunk(kind, e.x, e.z);
    if (tm.n >= tm.cap) return;
    const v = (e.variant | 0) & 3;
    const h = hash2(e.x * 3.3, e.z * 5.1);
    const rec = {
      e, kind, tm, idx: tm.n++, x: e.x, y: y - 0.03, z: e.z,
      s: (e.scale || 1) * (0.85 + v * 0.09 + h * 0.2), sy: 0.9 + hash2(e.z, e.x) * 0.3,
      rot: h * Math.PI * 2, amt: e.amount, fall: -1,
    };
    this.trees.set(e.id, rec);
    tm.trunk.count = tm.leaf.count = tm.n;
    this._setTree(rec, this._amtScale(rec), 0);
    const c = this._leafCols[kind][v].clone().multiplyScalar(0.9 + h * 0.25);
    if (tm.tex) { c.r = 0.72 + 0.28 * Math.min(1, c.r * 2.2); c.g = 0.72 + 0.28 * Math.min(1, c.g * 2.2); c.b = 0.72 + 0.28 * Math.min(1, c.b * 2.2); }
    tm.leaf.setColorAt(rec.idx, c);
    if (tm.leaf.instanceColor) tm.leaf.instanceColor.needsUpdate = true;
  }

  _amtScale(rec) {
    const e = rec.e;
    const m = e.maxAmount || e.amount || 1;
    return 0.72 + 0.28 * clamp((e.amount || 0) / m, 0, 1);
  }

  _setTree(rec, mul, tilt) {
    const d = this._dummy, tm = rec.tm;
    d.position.set(rec.x, rec.y, rec.z);
    d.rotation.set(tilt, rec.rot, 0);
    const s = rec.s * mul;
    d.scale.set(s, s * rec.sy, s);
    d.updateMatrix();
    tm.trunk.setMatrixAt(rec.idx, d.matrix);
    tm.leaf.setMatrixAt(rec.idx, d.matrix);
    tm.trunk.instanceMatrix.needsUpdate = true;
    tm.leaf.instanceMatrix.needsUpdate = true;
  }

  _fellTree(e) {
    const rec = this.trees && this.trees.get(e.id);
    if (!rec || rec.fall >= 0) return;
    rec.fall = 0;
    this._falling.push(rec);
    if (this._fogAt(rec.x, rec.z) === 2) {
      this.fx.burst('leaf', rec.x, rec.y + 1.4, rec.z);
      this.fx.burst('wood', rec.x, rec.y + 0.3, rec.z);
    }
  }

  _updateTrees(dt) {
    if (!this.treeMeshes) return;
    // generated tree models arrived: every chunk swaps its trunk / crown look (instances stay as they are)
    if (this._treeV !== treeVersion()) {
      this._treeV = treeVersion();
      for (const tm of this.treeMeshes.values()) this._treeLook(tm);
    }
    // falling animation
    for (let i = this._falling.length - 1; i >= 0; i--) {
      const rec = this._falling[i];
      rec.fall += dt;
      const t = rec.fall;
      if (t >= 1.5) {
        this._setTree(rec, 0, 0);
        this.trees.delete(rec.e.id);
        this._falling.splice(i, 1);
        if (this._fogAt(rec.x, rec.z) === 2) this.fx.burst('dust', rec.x, rec.y + 0.1, rec.z);
      } else {
        const k = Math.min(t / 0.9, 1);
        const mul = t > 1.0 ? 1 - (t - 1.0) / 0.5 : 1;
        this._setTree(rec, this._amtScale(rec) * Math.max(mul, 0.001), k * k * 1.45);
      }
    }
    // amount-based shrink (throttled)
    this._treeScan -= dt;
    if (this._treeScan <= 0) {
      this._treeScan = 0.5;
      for (const rec of this.trees.values()) {
        if (rec.fall >= 0) continue;
        if (rec.e.amount !== rec.amt) { rec.amt = rec.e.amount; this._setTree(rec, this._amtScale(rec), 0); }
      }
    }
  }

  _buildDecor() {
    const map = this.game.map, N = this.N, T = map.tiles;
    const rnd = mulberry((this.game.cfg && this.game.cfg.seed) || 1337);
    const d = this._dummy;
    // grass tuft: 3 blades
    const gp = [], gc = [], gn = [];
    for (let b = 0; b < 3; b++) {
      const a = (b / 3) * Math.PI * 2 + 0.4, cx = Math.cos(a), sz = Math.sin(a);
      const px = -sz * 0.035, pz = cx * 0.035, lean = 0.09;
      gp.push(cx * 0.03 - px, 0, sz * 0.03 - pz, cx * 0.03 + px, 0, sz * 0.03 + pz, cx * (0.03 + lean), 0.3, sz * (0.03 + lean));
      gc.push(0.55, 0.55, 0.55, 0.55, 0.55, 0.55, 1.15, 1.15, 1.15);
      gn.push(0, 1, 0, 0, 1, 0, 0, 1, 0);
    }
    const gGeo = new THREE.BufferGeometry();
    gGeo.setAttribute('position', new THREE.Float32BufferAttribute(gp, 3));
    gGeo.setAttribute('color', new THREE.Float32BufferAttribute(gc, 3));
    gGeo.setAttribute('normal', new THREE.Float32BufferAttribute(gn, 3));
    const gMat = this.patchMaterial(new THREE.MeshLambertMaterial({ vertexColors: true, side: THREE.DoubleSide }), { sway: 0.28, hide: true });
    const nGrass = Math.min(9000, Math.floor(N * N * 0.45));
    const grass = new THREE.InstancedMesh(gGeo, gMat, nGrass);
    const fGeo = new THREE.IcosahedronGeometry(0.06, 0).translate(0, 0.17, 0);
    const fMat = this.patchMaterial(new THREE.MeshLambertMaterial({}), { sway: 0.2, hide: true });
    const KD = this.climate || CLIMATES.temperate;
    const nFl = Math.floor(Math.min(1400, Math.floor(N * N * 0.07)) * KD.flowerMul);
    const flowers = new THREE.InstancedMesh(fGeo, fMat, nFl);
    const rGeo = new THREE.DodecahedronGeometry(0.22, 0);
    const rMat = this.patchMaterial(new THREE.MeshLambertMaterial({ color: 0x9a948c, flatShading: true }), { hide: true });
    const nRock = Math.min(700, Math.floor(N * N * 0.035));
    const rocks = new THREE.InstancedMesh(rGeo, rMat, nRock);
    const gcols = KD.blade.map((c) => new THREE.Color(c));
    const fcols = KD.flowers.map((c) => new THREE.Color(c));
    let ng = 0, nf = 0, nr = 0;
    const tries = (nGrass + nFl + nRock) * 4;
    for (let i = 0; i < tries && (ng < nGrass || nf < nFl || nr < nRock); i++) {
      const x = rnd() * N, z = rnd() * N;
      const t = T[(z | 0) * N + (x | 0)];
      const y = this.heightAt(x, z);
      if (y < 0.15) continue;
      const pick = rnd();
      d.rotation.set(0, rnd() * 6.28, 0);
      if ((t === 0 || t === 6) && pick < 0.8 && ng < nGrass) {
        if (vnoise(x * 0.2, z * 0.2) < 0.35) continue; // clumps
        const s = 0.8 + rnd() * 1.0;
        d.position.set(x, y - 0.01, z); d.scale.set(s, s * (0.8 + rnd() * 0.6), s); d.updateMatrix();
        grass.setMatrixAt(ng, d.matrix);
        grass.setColorAt(ng, gcols[(rnd() * gcols.length) | 0]);
        ng++;
      } else if (t === 0 && pick < 0.9 && nf < nFl) {
        if (vnoise(x * 0.11 + 50, z * 0.11) < 0.55) continue;
        const s = 0.8 + rnd() * 0.7;
        d.position.set(x, y, z); d.scale.set(s, s, s); d.updateMatrix();
        flowers.setMatrixAt(nf, d.matrix);
        flowers.setColorAt(nf, fcols[(rnd() * fcols.length) | 0]);
        nf++;
      } else if ((t === 0 || t === 2 || t === 5 || t === 6) && pick >= 0.9 && nr < nRock) {
        if (map.blocked && map.blocked[(z | 0) * N + (x | 0)] && t !== 5) continue;
        const s = 0.5 + rnd() * (t === 5 ? 2.2 : 1.0);
        d.rotation.set(rnd() * 3, rnd() * 6.28, rnd() * 3);
        d.position.set(x, y + 0.02, z); d.scale.set(s, s * 0.7, s * (0.7 + rnd() * 0.6)); d.updateMatrix();
        rocks.setMatrixAt(nr, d.matrix);
        nr++;
      }
    }
    grass.count = ng; flowers.count = nf; rocks.count = nr;
    for (const m of [grass, flowers, rocks]) {
      m.frustumCulled = false;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
      this.world.add(m);
    }
    grass.receiveShadow = true;
    rocks.castShadow = true; rocks.receiveShadow = true;
    this.decor = { grass, flowers, rocks };
    d.rotation.set(0, 0, 0);
    // tile -> decor instances (packed meshIndex * 2^16 + instance), so buildings / rails can hide what they cover
    const idx = new Map(), meshes = [grass, flowers, rocks], mm = new THREE.Matrix4();
    meshes.forEach((m, k) => {
      for (let i = 0; i < m.count; i++) {
        m.getMatrixAt(i, mm); const tx = Math.floor(mm.elements[12]), tz = Math.floor(mm.elements[14]);
        if (tx < 0 || tz < 0 || tx >= N || tz >= N) continue;
        const key = tz * N + tx; let a = idx.get(key); if (!a) idx.set(key, a = []); a.push(k * 65536 + i);
      }
    });
    this._decorIdx = idx; this._decorMeshes = meshes;
    const bs = this.game && this.game.buildings; if (bs) for (const b of bs) if (b && !b.dead) this._hideDecor(b);
  }
  // scale to zero the decor instances (grass / flowers / rocks) on a building's footprint tiles
  _hideDecor(b) {
    const idx = this._decorIdx, ms = this._decorMeshes; if (!idx || !ms || !b) return;
    const N = this.N, s = b.size || 1, tx0 = b.tx != null ? b.tx : Math.floor(b.x - s / 2), tz0 = b.tz != null ? b.tz : Math.floor(b.z - s / 2);
    const Z = this._zeroM || (this._zeroM = new THREE.Matrix4().makeScale(0, 0, 0)); let hit = 0;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) {
      const a = idx.get((tz0 + j) * N + tx0 + i); if (!a) continue;
      for (const p of a) { const m = ms[(p / 65536) | 0]; if (!m) continue; m.setMatrixAt(p & 65535, Z); hit |= 1 << ((p / 65536) | 0); }
      idx.delete((tz0 + j) * N + tx0 + i);
    }
    for (let k = 0; k < ms.length; k++) if (hit & (1 << k)) ms[k].instanceMatrix.needsUpdate = true;
  }

  // ---------------------------------------------------------------- events -> particles
  _subscribe() {
    const g = this.game, ev = g.events;
    if (!ev || !ev.on) return;
    const on = (n, f) => {
      const w = (p) => { try { f(p || {}); } catch (err) { if (!this._warned) { this._warned = true; console.warn('[Renderer] fx handler', n, err); } } };
      ev.on(n, w); this._subs.push([n, w]);
    };
    const vis = (x, z) => this._fogAt(x, z) === 2;
    on('hit', ({ target, x, y, z, proj }) => {
      const px = x != null ? x : target && target.x, pz = z != null ? z : target && target.z;
      if (px == null || !vis(px, pz)) return;
      const py = y != null ? y : this.groundY(px, pz) + 0.8;
      if (proj === 'cannonball') { this.fx.burst('explosion', px, py, pz); this.fx.burst('flash', px, py, pz); this.fx.burst('debris', px, py - 0.4, pz); this.fx.burst('dust', px, py - 0.5, pz); return; }
      if (proj === 'stone') { this.fx.burst('dust', px, py, pz); this.fx.burst('debris', px, py - 0.4, pz); this.fx.burst('stone', px, py, pz); }
      if (target && target.kind === 'building') this.fx.burst(proj ? 'dust' : 'spark', px, py, pz);
      else if (target && target.kind === 'unit') {
        const siege = target.type === 'ram' || target.type === 'catapult' || target.type === 'cannon' || target.type === 'artillery';
        this.fx.burst(siege ? 'spark' : 'blood', px, py, pz);
      } else this.fx.burst('hit', px, py, pz);
    });
    on('death', ({ e }) => {
      if (!e || !vis(e.x, e.z)) return;
      const y = this.groundY(e.x, e.z);
      if (e.kind === 'building') {
        const s = (e.size || 2) * 0.35;
        for (let i = 0; i < 4; i++) {
          const ox = (Math.random() - 0.5) * 2 * s, oz = (Math.random() - 0.5) * 2 * s;
          this.fx.burst(i === 0 ? 'explosion' : 'dust', e.x + ox, y + 0.6 + Math.random(), e.z + oz);
        }
        this.fx.burst('smoke', e.x, y + 1.2, e.z);
        const n = Math.min(9, 2 + Math.round((e.size || 2) * 1.5)), r = (e.size || 2) * 0.5;
        for (let i = 0; i < n; i++) {
          const ox = (Math.random() - 0.5) * 2 * r, oz = (Math.random() - 0.5) * 2 * r;
          this.fx.burst(i % 3 === 0 ? 'build' : 'debris', e.x + ox, y + 0.3 + Math.random() * 1.2, e.z + oz);
          if (i % 2 === 0) this.fx.burst('dust', e.x + ox, y + 0.2, e.z + oz);
        }
      } else if (e.kind === 'unit') {
        this.fx.burst('dust', e.x, y + 0.2, e.z);
      }
    });
    on('buildComplete', ({ e }) => {
      if (!e || !vis(e.x, e.z)) return;
      this.fx.burst('build', e.x, this.groundY(e.x, e.z) + 0.6, e.z);
    });
    // "+13" over the drop-off building: the local player's own deposits only, where they can see it
    on('deposit', ({ unit, owner, res, amount }) => {
      if (!unit || owner !== (g.me ?? 0) || !(amount > 0)) return;
      const o = unit.order, ge = (id) => (id != null && g.getEntity ? g.getEntity(id) : null);
      let b = o ? ge(o.dropId) : null;
      if (!b && o) { const t = ge(o.targetId); if (t && t.kind === 'building') b = t; }
      const at = b && !b.dead ? b : unit;
      if (!vis(at.x, at.z)) return;
      const y = this.groundY(at.x, at.z) + (at === b ? Math.min(4.2, 1.3 + (b.size || 1) * 0.36) : 2.2);
      this.floaters.add(at.x, y, at.z, res, amount, at.id, this._fv);
    });
    on('gatherTick', ({ unit, res }) => {
      if (!unit || !vis(unit.x, unit.z)) return;
      const k = res === 'wood' ? 'wood' : res === 'stone' ? 'stone' : res === 'gold' ? 'gold' : null;
      if (!k) return;
      let x = unit.x, z = unit.z;
      const t = unit.targetId != null && g.getEntity ? g.getEntity(unit.targetId) : null;
      if (t) { x = x + (t.x - x) * 0.75; z = z + (t.z - z) * 0.75; }
      this.fx.burst(k, x, this.groundY(x, z) + 0.75, z);
      if (k === 'wood' && Math.random() < 0.35) this.fx.burst('leaf', x, this.groundY(x, z) + 1.6, z);
    });
    on('ageUp', ({ owner }) => {
      let x, z;
      const tc = g.buildingsOf ? g.buildingsOf(owner).find((b) => b.type === 'towncenter') : null;
      if (tc) { x = tc.x; z = tc.z; } else { const p = g.players[owner]; if (!p) return; x = p.startX; z = p.startZ; }
      const me = g.me ?? 0;
      if (owner !== me && !vis(x, z)) return;
      const y = this.groundY(x, z);
      this.fx.burst('ageup', x, y + 1.5, z);
      this.fx.burst('ageup', x, y + 3.2, z);
      if (owner !== me) return;
      // celebration: golden bursts ripple outward over every own building + warm light boost
      this._sunBoost = 1;
      const bs = (g.buildingsOf ? g.buildingsOf(me) : []).filter((b) => b && !b.dead)
        .map((b) => ({ b, d: Math.hypot(b.x - x, b.z - z) })).sort((a, b) => a.d - b.d).slice(0, 40);
      this._celebrate = bs.map(({ b, d }) => ({ x: b.x, z: b.z, h: 0.8 + (b.size || 2) * 0.45, t: 0.25 + Math.min(2.6, d * 0.06) }));
    });
    on('treeFelled', ({ e }) => { if (e) this._fellTree(e); });
    on('remove', ({ e }) => {
      if (!e || e.type !== 'tree') return;
      const rec = this.trees.get(e.id);
      if (!rec) return;
      if (rec.fall < 0) { this._fellTree(e); }
    });
    on('spawn', ({ e }) => { if (e && e.kind === 'resource' && e.type === 'tree') this._addTree(e); else if (e && e.kind === 'building') this._hideDecor(e); });
    on('buildStart', ({ e }) => {
      if (!e || e.kind !== 'building') return;
      this._hideDecor(e);
      // a cloud of dust where the foundation is laid (the ground under it was just levelled)
      if (this._fogAt(e.x, e.z) === 2) { const s = e.size || 1; for (let k = 0; k < Math.min(6, 1 + (s >> 1)); k++) this.fx.burst('dust', e.x + (Math.random() - .5) * s * .7, this.groundY(e.x, e.z) + .1, e.z + (Math.random() - .5) * s * .7); }
    });
    on('terrain', (r) => this._patchTerrain(r));
  }

  // ---------------------------------------------------------------- public API
  resize() {
    const c = this.canvas;
    const w = Math.max(1, c.clientWidth || window.innerWidth), h = Math.max(1, c.clientHeight || window.innerHeight);
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._w = w; this._h = h;
  }

  setQuality(q) {
    this.quality = q === 'low' ? 'low' : 'high';
    const low = this.quality === 'low';
    this.renderer.setPixelRatio(low ? 1 : Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = !low;
    this.sun.castShadow = !low;
    if (this.decor) { this.decor.grass.visible = !low; this.decor.flowers.visible = !low; }
    this.scene.traverse((o) => { if (o.material && !Array.isArray(o.material)) o.material.needsUpdate = true; });
    this.resize();
  }

  _ndc(cx, cy) {
    const r = this.canvas.getBoundingClientRect();
    return this._v2.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
  }

  screenToGround(clientX, clientY) {
    if (!this.game) return null;
    this._ray.setFromCamera(this._ndc(clientX, clientY), this.camera);
    const o = this._ray.ray.origin, d = this._ray.ray.direction;
    if (d.y >= -0.0001) return null;
    const N = this.N;
    let t = Math.max(0, (o.y - 9) / -d.y), prev = t;
    const tMax = t + 700;
    for (; t < tMax; t += 0.4) {
      const x = o.x + d.x * t, z = o.z + d.z * t, y = o.y + d.y * t;
      if (y <= this.groundY(x, z)) {
        let a = prev, b = t;
        for (let i = 0; i < 7; i++) {
          const m = (a + b) / 2;
          const mx = o.x + d.x * m, mz = o.z + d.z * m;
          if (o.y + d.y * m <= this.groundY(mx, mz)) b = m; else a = m;
        }
        return { x: clamp(o.x + d.x * b, 0.01, N - 0.01), z: clamp(o.z + d.z * b, 0.01, N - 0.01) };
      }
      prev = t;
    }
    return null;
  }

  pick(clientX, clientY) {
    if (!this.game) return null;
    this._ray.setFromCamera(this._ndc(clientX, clientY), this.camera);
    if (this.entityView && this.entityView.pick) {
      try {
        const id = this.entityView.pick(this._ray);
        if (id != null) return id;
      } catch (err) { /* ignore */ }
    }
    const p = this.screenToGround(clientX, clientY);
    if (!p || !this.game.resourceNear) return null;
    const r = this.game.resourceNear(p.x, p.z, 1.4);
    if (r && r.type === 'tree' && !r.dead && this._fogAt(r.x, r.z) > 0) return r.id;
    return null;
  }

  worldToScreen(x, y, z) {
    const v = this._v.set(x, y, z).project(this.camera);
    const r = this.canvas.getBoundingClientRect();
    const sx = (v.x * 0.5 + 0.5) * r.width + r.left, sy = (-v.y * 0.5 + 0.5) * r.height + r.top;
    return { x: sx, y: sy, visible: v.z > -1 && v.z < 1 && v.x >= -1 && v.x <= 1 && v.y >= -1 && v.y <= 1 };
  }

  unitsInRect(x0, y0, x1, y1) {
    const out = [];
    if (!this.game) return out;
    const ax = Math.min(x0, x1), bx = Math.max(x0, x1), ay = Math.min(y0, y1), by = Math.max(y0, y1);
    const me = this.game.me ?? 0;
    for (const e of this.game.entities.values()) {
      if (e.kind !== 'unit' || e.owner !== me || e.dead) continue;
      const s = this.worldToScreen(e.x, this.groundY(e.x, e.z) + 0.5, e.z);
      if (s.visible && s.x >= ax && s.x <= bx && s.y >= ay && s.y <= by) out.push(e.id);
    }
    return out;
  }

  setSelection(ids) {
    if (this.entityView && this.entityView.setSelection) { try { this.entityView.setSelection(ids || []); } catch (e) { /* ignore */ } }
  }

  setGhost(spec) {
    if (this.entityView && this.entityView.setGhost) { try { this.entityView.setGhost(spec); } catch (e) { /* ignore */ } }
  }

  // radius > 0: the ring closes onto a footprint of that radius and stays around it (a building as the target)
  addMarker(x, z, colorHex = 0x7dff7a, radius = 0) {
    const mat = new THREE.MeshBasicMaterial({ color: colorHex, transparent: true, opacity: 1, depthTest: false, depthWrite: false, side: THREE.DoubleSide, fog: false });
    const mesh = new THREE.Mesh(this._markerGeo, mat);
    mesh.position.set(x, this.groundY(x, z) + 0.12, z);
    mesh.renderOrder = 30;
    this.scene.add(mesh);
    this._markers.push({ mesh, t: 0, r: radius });
    if (this._markers.length > 24) { const m = this._markers.shift(); this.scene.remove(m.mesh); m.mesh.material.dispose(); }
  }

  _updateMarkers(dt) {
    for (let i = this._markers.length - 1; i >= 0; i--) {
      const m = this._markers[i];
      m.t += dt;
      const k = m.t / 0.65;
      if (k >= 1) { this.scene.remove(m.mesh); m.mesh.material.dispose(); this._markers.splice(i, 1); continue; }
      const e = 1 - (1 - k) * (1 - k), s = m.r > 0 ? (m.r / 0.81) * (1.35 - 0.35 * e) : 1.5 - 1.2 * e;
      m.mesh.scale.set(s, 1, s);
      m.mesh.material.opacity = 1 - k * k;
    }
  }

  _updateCamera(dt) {
    const cam = this.cam, c = this._c, N = this.N;
    if (!isFinite(cam.tx)) cam.tx = N / 2;
    if (!isFinite(cam.tz)) cam.tz = N / 2;
    if (!isFinite(cam.dist)) cam.dist = 26;
    if (!isFinite(cam.yaw)) cam.yaw = 0;
    if (!isFinite(cam.pitch)) cam.pitch = 0.87;
    cam.tx = clamp(cam.tx, 0, N); cam.tz = clamp(cam.tz, 0, N);
    cam.dist = clamp(cam.dist, 8, 90);
    cam.pitch = clamp(cam.pitch, 0.42, 1.4);
    const k = 1 - Math.exp(-dt * 12);
    c.tx += (cam.tx - c.tx) * k; c.tz += (cam.tz - c.tz) * k;
    c.dist += (cam.dist - c.dist) * k; c.yaw += (cam.yaw - c.yaw) * k; c.pitch += (cam.pitch - c.pitch) * k;
    const ty = this.groundY(c.tx, c.tz);
    const hd = c.dist * Math.cos(c.pitch);
    const px = c.tx + Math.sin(c.yaw) * hd, pz = c.tz + Math.cos(c.yaw) * hd;
    let py = ty + c.dist * Math.sin(c.pitch);
    py = Math.max(py, this.groundY(px, pz) + 1.5);
    this.camera.position.set(px, py, pz);
    this.camera.lookAt(c.tx, ty, c.tz);
    const nr = clamp(c.dist * 0.05, 1, 4);   // (the camera stays >= ~0.4 x dist above the ground it looks at)
    if (Math.abs(this.camera.near - nr) > 0.02) { this.camera.near = nr; this.camera.updateProjectionMatrix(); }
    this.camera.updateMatrixWorld();
    this.sky.position.copy(this.camera.position);

    // sun: slow drift, shadow frustum follows camera target
    const az = 0.85 + Math.sin(this.time * 0.012) * 0.4, el = 0.92 + Math.sin(this.time * 0.007) * 0.08;
    this.sunDir.set(Math.cos(el) * Math.sin(az), Math.sin(el), Math.cos(el) * Math.cos(az)).normalize();
    const half = clamp(c.dist * 1.05, 16, 80);
    const sc = this.sun.shadow.camera;
    if (Math.abs(half - this._shadowHalf) > 0.5) {
      this._shadowHalf = half;
      sc.left = -half; sc.right = half; sc.top = half; sc.bottom = -half;
      sc.updateProjectionMatrix();
    }
    // focus slightly ahead of the target (toward the far side of the view)
    const fx = c.tx - Math.sin(c.yaw) * half * 0.25, fz = c.tz - Math.cos(c.yaw) * half * 0.25;
    this.sun.target.position.set(fx, ty, fz);
    this.sun.position.set(fx + this.sunDir.x * 140, ty + this.sunDir.y * 140, fz + this.sunDir.z * 140);
    this.sun.target.updateMatrixWorld();
  }

  /** Per-age sky/fog/sun tint (local player game.me) + age-up celebration bursts and light boost. */
  _updateAtmosphere(dt) {
    const p = this.game && this.game.players ? this.game.players[this.game.me ?? 0] : null;
    const age = clamp(p && p.age != null ? p.age | 0 : 1, 0, AGE_ATMO.length - 1);
    const T = this._atmoT;
    if (age !== this._atmoAge) {
      const first = this._atmoAge < 0;
      this._atmoAge = age;
      const a = AGE_ATMO[age], ca = this.climate && this.climate.atmo;
      T.h.setHex(a.h); T.z.setHex(a.z); T.s.setHex(a.s); T.d = a.d * ((this.climate && this.climate.fog) || 1);
      if (ca) { const t = new THREE.Color(); if (ca.h) T.h.lerp(t.setHex(ca.h), ca.mix); if (ca.z) T.z.lerp(t.setHex(ca.z), ca.mix); if (ca.s) T.s.lerp(t.setHex(ca.s), ca.mix); }
      if (first) { this.scene.fog.color.copy(T.h); this.skyU.uHorizon.value.copy(T.h); this.skyU.uZenith.value.copy(T.z); this.sun.color.copy(T.s); this._fogD = T.d; }
    }
    const k = 1 - Math.exp(-dt * 0.9);
    this.scene.fog.color.lerp(T.h, k);
    this.skyU.uHorizon.value.lerp(T.h, k);
    this.skyU.uZenith.value.lerp(T.z, k);
    this.sun.color.lerp(T.s, k);
    this._fogD += (T.d - this._fogD) * k;
    this.scene.fog.density = this._fogD;
    if (this.waterU) {
      if (this.waterU.uFogColor) this.waterU.uFogColor.value.copy(this.scene.fog.color);
      if (this.waterU.uFogDensity) this.waterU.uFogDensity.value = this._fogD;
    }
    if (this._sunBoost > 0) this._sunBoost = Math.max(0, this._sunBoost - dt / 2);
    const e = this._sunBoost;
    this.sun.intensity = SUN_BASE * (1 + 0.25 * e * e * (3 - 2 * e));
    const c = this._celebrate;
    if (c.length) {
      for (let i = c.length - 1; i >= 0; i--) {
        const q = c[i]; q.t -= dt;
        if (q.t > 0) continue;
        c.splice(i, 1);
        const y = this.groundY(q.x, q.z);
        this.fx.burst('gold', q.x, y + q.h, q.z);
        this.fx.burst('spark', q.x, y + q.h + 0.4, q.z);
        this.fx.burst('gold', q.x, y + q.h + 0.9, q.z);
      }
    }
  }

  render(dt) {
    dt = clamp(dt || 0, 0, 0.1);
    this.time += dt;
    this.shared.uTime.value = this.time;
    this._updateCamera(dt);
    if (this.game) {
      this._updateFow(dt);
      this._updateTrees(dt);
      if (this.entityView) {
        try { this.entityView.update(dt, this.time); }
        catch (err) { if (!this._warnedEV) { this._warnedEV = true; console.error('[Renderer] entityView.update', err); } }
      }
      // rally flag line / shift waypoint line of the selection (view only)
      try { this.orderLines.update(dt, this.game, this.entityView && this.entityView.selected, this._olH, this._olC); }
      catch (err) { if (!this._warnedOL) { this._warnedOL = true; console.error('[Renderer] orderLines', err); } }
    }
    this._updateMarkers(dt);
    this._updateAtmosphere(dt);
    this.fx.scale = (this._h * this.renderer.getPixelRatio() * 0.5) / Math.tan((this.camera.fov * Math.PI) / 360);
    this.fx.update(dt);
    this.floaters.update(dt, this._fv);
    // (a resolution change clears the canvas: it happens right before drawing, so no frame is left black)
    this._adaptResolution();
    try { glbWarm(this.renderer); } catch (err) { /* warming is only a head start */ }
    this.renderer.render(this.scene, this.camera);
  }

  // Dynamic resolution: when frames stay slow (under ~45 fps for 2 s) the render resolution steps down a little,
  // and it steps back up once frames are fast again for a while. Smoothness first; the HUD is not affected.
  _adaptResolution() {
    const now = performance.now(), last = this._arLast || now;
    this._arLast = now;
    const ft = now - last;
    if (ft <= 0 || ft > 250) return;                       // (first frame, tab switch, a stall: not a measure)
    this._arAvg = this._arAvg == null ? ft : this._arAvg * 0.95 + ft * 0.05;
    // (judged on a steady average over 4 s, so a single hitch never changes it; going back up waits 30 s
    //  after the last step down, so it does not flip back and forth)
    if (now - (this._arT || 0) < 4000) return;
    const maxPr = this.quality === 'low' ? 1 : Math.min(window.devicePixelRatio || 1, 2), minPr = Math.min(maxPr, 0.75);
    const pr = this.renderer.getPixelRatio();
    // stepping all the way down did not make frames any faster (the browser holds the frame rate itself, e.g.
    // Chrome's Energy Saver caps every page at 30 fps): go back to the resolution the steps started from, and do not
    // step down again while frames stay about that slow
    const st = this._arStep;
    if (st) {
      if (this._arAvg < st.avg * 0.9) this._arStep = null;   // (a gain: keep the lower resolution)
      else if (pr <= minPr + 0.01) {
        this._arStep = null; this._arT = now; this._arCapAvg = this._arAvg;
        this.renderer.setPixelRatio(st.pr); this.resize();
        return;
      }
    }
    if (this._arCapAvg != null && this._arAvg < this._arCapAvg * 0.6) this._arCapAvg = null;   // (the cap is gone)
    if (this._arAvg > 24 && pr > minPr + 0.01 && !(this._arCapAvg != null && this._arAvg < this._arCapAvg * 1.15)) {
      this._arT = now; this._arSlowAt = now; if (!this._arStep) this._arStep = { pr, avg: this._arAvg };
      this.renderer.setPixelRatio(Math.max(minPr, pr - 0.25)); this.resize();
    } else if (this._arAvg < 17.5 && pr < maxPr - 0.01 && now - (this._arSlowAt || 0) > 30000) {
      this._arT = now;
      this.renderer.setPixelRatio(Math.min(maxPr, pr + 0.25)); this.resize();
    }
  }
}
