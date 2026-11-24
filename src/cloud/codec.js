import { tr } from '../i18n.js';
// Aevum - save payload codec for the cloud: JSON -> UTF-8 -> gzip (CompressionStream, when available) -> base64,
// split into chunks; SHA-256 of the JSON text for the integrity check. Runs in browsers and node 20+.
// crypto.subtle only exists in secure contexts (https / localhost): a LAN game over plain http falls back to the
// small pure-JS SHA-256 below.

export const CHUNK_CHARS = 512 * 1024;   // base64 characters per chunk document (Firestore limit: 1 MiB per doc)

const enc = new TextEncoder();
const dec = new TextDecoder();
export const utf8 = (s) => enc.encode(s);
export const fromUtf8 = (b) => dec.decode(b);

// ---------- base64 ----------
export function toBase64(bytes) {
  if (typeof btoa !== 'function' && typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
export function fromBase64(str) {
  if (typeof str !== 'string' || /[^A-Za-z0-9+/=]/.test(str)) throw new Error('base64 bozuk');
  if (typeof atob !== 'function' && typeof Buffer !== 'undefined') return new Uint8Array(Buffer.from(str, 'base64'));
  const s = atob(str), out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

// ---------- gzip ----------
export const canGzip = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function' && typeof Response === 'function';
async function pipe(bytes, stream) {
  const s = new Blob([bytes]).stream().pipeThrough(stream);
  return new Uint8Array(await new Response(s).arrayBuffer());
}
export const gzip = (bytes) => pipe(bytes, new CompressionStream('gzip'));
export const gunzip = (bytes) => pipe(bytes, new DecompressionStream('gzip'));

// ---------- SHA-256 ----------
const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5, 0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3,
  0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174, 0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967, 0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13,
  0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85, 0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3, 0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208,
  0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2]);
export function sha256Js(bytes) {
  const len = bytes.length, total = ((len + 9 + 63) >> 6) << 6;
  const m = new Uint8Array(total); m.set(bytes); m[len] = 0x80;
  const dv = new DataView(m.buffer);
  dv.setUint32(total - 8, Math.floor(len / 0x20000000)); dv.setUint32(total - 4, (len << 3) >>> 0);
  const H = new Uint32Array([0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19]);
  const W = new Uint32Array(64);
  const rotr = (x, n) => (x >>> n) | (x << (32 - n));
  for (let off = 0; off < total; off += 64) {
    for (let i = 0; i < 16; i++) W[i] = dv.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) {
      const a = W[i - 15], b = W[i - 2];
      W[i] = (W[i - 16] + (rotr(a, 7) ^ rotr(a, 18) ^ (a >>> 3)) + W[i - 7] + (rotr(b, 17) ^ rotr(b, 19) ^ (b >>> 10))) >>> 0;
    }
    let [a, b, c, d, e, f, g, h] = H;
    for (let i = 0; i < 64; i++) {
      const t1 = (h + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) >>> 0;
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0;
      h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t2) >>> 0;
    }
    H[0] += a; H[1] += b; H[2] += c; H[3] += d; H[4] += e; H[5] += f; H[6] += g; H[7] += h;
  }
  let s = ''; for (const x of H) s += x.toString(16).padStart(8, '0');
  return s;
}
export async function sha256Hex(bytes) {
  const subtle = globalThis.crypto && globalThis.crypto.subtle;
  if (subtle && typeof subtle.digest === 'function') {
    try {
      const d = new Uint8Array(await subtle.digest('SHA-256', bytes));
      let s = ''; for (const b of d) s += b.toString(16).padStart(2, '0');
      return s;
    } catch (e) { /* fall through */ }
  }
  return sha256Js(bytes);
}

// ---------- whole payload ----------
// obj -> {sha, size, enc: 'gzip'|'none', parts: [base64 string]}
export async function packSave(obj, { chunkChars = CHUNK_CHARS, noGzip = false } = {}) {
  const json = JSON.stringify(obj);
  const raw = utf8(json);
  const sha = await sha256Hex(raw);
  let body = raw, encName = 'none';
  if (!noGzip && canGzip()) { try { body = await gzip(raw); encName = 'gzip'; } catch (e) { body = raw; encName = 'none'; } }
  const b64 = toBase64(body);
  const parts = [];
  for (let i = 0; i < b64.length; i += chunkChars) parts.push(b64.slice(i, i + chunkChars));
  if (!parts.length) parts.push('');
  return { sha, size: raw.length, enc: encName, parts };
}
// parts + meta -> obj; throws Error('...') when anything does not match
export async function unpackSave(parts, meta) {
  const b64 = parts.join('');
  let body;
  try { body = fromBase64(b64); } catch (e) { throw new Error(tr('Kayıt bozuk (base64).')); }
  if (meta.enc === 'gzip') {
    if (!canGzip()) throw new Error(tr('Bu tarayıcı sıkıştırılmış kaydı açamıyor.'));
    try { body = await gunzip(body); } catch (e) { throw new Error(tr('Kayıt bozuk (açılamadı).')); }
  } else if (meta.enc !== 'none') throw new Error(tr('Bilinmeyen kayıt biçimi.'));
  if (meta.size != null && body.length !== meta.size) throw new Error(tr('Kayıt boyutu tutmuyor (bozuk indirme).'));
  const sha = await sha256Hex(body);
  if (sha !== meta.sha) throw new Error(tr('Kayıt bütünlük denetimi başarısız (bozuk indirme).'));
  return JSON.parse(fromUtf8(body));
}
