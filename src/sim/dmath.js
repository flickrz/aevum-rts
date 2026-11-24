// Aevum - deterministic math for the simulation.
// Math.sin / cos / atan2 / hypot (and **) are "implementation-approximated" in JavaScript: V8 (Chrome, Edge) and
// SpiderMonkey (Firefox) may return results one bit apart. In lockstep multiplayer such a bit grows into a split
// game (2026-11-23: every logged desync had a Firefox client on one side, Chrome on the other). These versions use
// only + - * / Math.sqrt and Math.round, which IEEE 754 defines exactly, so every engine gets the same bits.
// Use them (not Math.*) everywhere in src/sim.

const PIO2_1 = 1.57079632673412561417e+00, PIO2_1T = 6.07710050650619224932e-11, INV_PIO2 = 6.36619772367581382433e-01;
const PI = 3.14159265358979311600e+00, PI_2 = 1.57079632679489655800e+00, PI_4 = 7.85398163397448278999e-01;

function ksin(x) {
  const z = x * x;
  return x + x * z * (-1.66666666666666324348e-01 + z * (8.33333333332248946124e-03 + z * (-1.98412698298579493134e-04 +
    z * (2.75573137070700676789e-06 + z * (-2.50507602534068634195e-08 + z * 1.58969099521155010221e-10)))));
}
function kcos(x) {
  const z = x * x;
  return 1 - 0.5 * z + z * z * (4.16666666666666019037e-02 + z * (-1.38888888888741095749e-03 + z * (2.48015872894767294178e-05 +
    z * (-2.75573143513906633035e-07 + z * (2.08757232129817482790e-09 + z * -1.13596475577881948265e-11)))));
}
// x = q*pi/2 + r, |r| <= ~pi/4
function reduce(x) { const q = Math.round(x * INV_PIO2); return [q, (x - q * PIO2_1) - q * PIO2_1T]; }

export function dsin(x) {
  if (!Number.isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  switch (((q % 4) + 4) % 4) { case 0: return ksin(r); case 1: return kcos(r); case 2: return -ksin(r); default: return -kcos(r); }
}
export function dcos(x) {
  if (!Number.isFinite(x)) return NaN;
  const [q, r] = reduce(x);
  switch (((q % 4) + 4) % 4) { case 0: return kcos(r); case 1: return -ksin(r); case 2: return -kcos(r); default: return ksin(r); }
}
// atan on |u| <= tan(pi/8): Taylor series, enough terms for double precision
function katan(u) {
  const z = u * u; let s = 0;
  for (let n = 25; n >= 0; n--) s = ((n & 1) ? -1 : 1) / (2 * n + 1) + z * s;
  return u * s;
}
export function datan(x) {
  if (x !== x) return NaN;
  const neg = x < 0; let t = neg ? -x : x, r;
  if (t > 1) { r = t === Infinity ? PI_2 : PI_2 - atanUnit(1 / t); } else r = atanUnit(t);
  return neg ? -r : r;
}
function atanUnit(t) { return t > 0.41421356237309503 ? PI_4 + katan((t - 1) / (t + 1)) : katan(t); }
export function datan2(y, x) {
  if (x !== x || y !== y) return NaN;
  if (x > 0) return datan(y / x);
  if (x < 0) return y >= 0 ? datan(y / x) + PI : datan(y / x) - PI;
  return y > 0 ? PI_2 : y < 0 ? -PI_2 : 0;
}
export function dhypot(x, y) { return Math.sqrt(x * x + y * y); }
export function sq(x) { return x * x; }
