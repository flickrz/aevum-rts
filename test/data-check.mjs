// Data integrity + new building/tech effects. Run from ROOT: node test/data-check.mjs
import { UNITS, BUILDINGS, TECHS } from '../src/data.js';
import { Game } from '../src/sim/game.js';

let bad = 0; const fail = m => { bad++; console.error('FAIL', m); };
const where = {};
for (const [bid, b] of Object.entries(BUILDINGS)) {
  if (b.id !== bid) fail('building id mismatch ' + bid);
  for (const u of b.trains) if (!UNITS[u]) fail(`${bid}.trains unknown unit ${u}`);
  for (const t of b.researches) { if (!TECHS[t]) fail(`${bid}.researches unknown tech ${t}`); else { (where[t] = where[t] || []).push(bid); if (TECHS[t].age < b.age) fail(`tech ${t} age ${TECHS[t].age} < building ${bid} age ${b.age}`); } }
  for (const r of b.dropoff || []) if (!['food', 'wood', 'stone', 'gold'].includes(r)) fail(`${bid}.dropoff ${r}`);
}
for (const [tid, t] of Object.entries(TECHS)) {
  if (t.id !== tid) fail('tech id mismatch ' + tid);
  if (!where[tid] && !TECHS[tid].legacy) fail('tech not researchable anywhere: ' + tid);
  if (!t.name || !t.desc || !t.icon || !t.fx) fail('tech incomplete: ' + tid);
}
// a building's command card has 14 places (the 15th is the delete button)
for (const [k, b] of Object.entries(BUILDINGS)) if ((b.trains || []).length + (b.researches || []).length > 14) fail('too many buttons on ' + k);
for (const u of Object.keys(UNITS)) if (UNITS[u].cls !== 'train' && !UNITS[u].legacy && !Object.values(BUILDINGS).some(b => b.trains.includes(u))) fail('unit not trainable: ' + u);

// every fx key must be a known mod of the right shape
const g = new Game({ mapSize: 256, enemies: 0, seed: 7, startAge: 4, sandbox: true });   // (256: the smallest size since 2026-11-13, room for the 12x12 farm)
const p = g.players[0], base = p.mods;
for (const t of Object.values(TECHS)) for (const k in t.fx) {
  if (!(k in base)) fail(`tech ${t.id}: unknown mod ${k}`);
  else if ((typeof t.fx[k] === 'number') !== (typeof base[k] === 'number')) fail(`tech ${t.id}: mod ${k} wrong shape`);
}
for (const t of Object.keys(TECHS)) p.techs.add(t);
g._mods(p); g._rescaleBuildings(p); g._rescaleUnits(p);
for (const k in p.mods) { const v = p.mods[k]; if (typeof v === 'number' ? !isFinite(v) : Object.values(v).some(x => !isFinite(x))) fail('mod not finite: ' + k); }

// placement + effects of the six new buildings
const tc = g.buildings.find(b => b.owner === 0 && b.type === 'towncenter');
const put = (type) => {
  for (let r = 4; r < 44; r++) for (let dz = -r; dz <= r; dz++) for (let dx = -r; dx <= r; dx++) {
    const tx = (tc.x | 0) + dx, tz = (tc.z | 0) + dz;
    if (g.canPlace(type, tx, tz, 0)) { const id = g.placeBuilding(0, type, tx, tz, []); if (id != null) return g.getEntity(id); }
  }
  fail('could not place ' + type); return null;
};
const made = {};
// (the mill is legacy since 2026-11-14: it cannot be placed; its techs are researched at the farm)
for (const t of ['lumbercamp', 'minecamp', 'temple', 'academy', 'bank', 'farm']) made[t] = put(t);
for (const b of Object.values(made)) if (b && !b.done) g._complete(b);
const gold0 = p.stats.gathered.gold;
const v = g.units.find(u => u.owner === 0 && u.type === 'villager');
v.x = made.temple.x; v.z = made.temple.z + 2.5; v.hp = 5; g.cmdStop([v.id]);
for (let i = 0; i < 400; i++) g.update(0.05); // 20 s
if (!(p.stats.gathered.gold > gold0)) fail('bank gave no gold'); else console.log('bank gold in 20 s:', p.stats.gathered.gold - gold0);
if (!(v.hp > 5)) fail('temple did not heal'); else console.log('temple healed villager to', v.hp, '/', v.maxHp);
{ let free = null; for (let r = 4; r < 44 && !free; r++) for (let dz = -r; dz <= r && !free; dz++) for (let dx = -r; dx <= r; dx++) { const tx = (tc.x | 0) + dx, tz = (tc.z | 0) + dz; if (g.canPlace('mill', tx, tz, 0)) { free = [tx, tz]; break; } }
  if (!free || g.isUnlocked(0, 'building', 'mill') || g.placeBuilding(0, 'mill', free[0], free[1], []) != null) fail('the legacy mill can still be placed'); else console.log('legacy mill: not placeable'); }
const s2 = Game.deserialize(JSON.stringify(g.serialize()));
if (s2.buildings.length !== g.buildings.length) fail('serialize lost buildings');
for (let i = 0; i < 40; i++) s2.update(0.05);
console.log(`techs ${Object.keys(TECHS).length}, buildings ${Object.keys(BUILDINGS).length}, units ${Object.keys(UNITS).length}`);
console.log(bad ? `${bad} FAILURES` : 'DATA CHECK OK');
process.exit(bad ? 1 : 0);
