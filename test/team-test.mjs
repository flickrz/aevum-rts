// Teams: node test/team-test.mjs
import { Game } from '../src/sim/game.js';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok ' : '  FAIL ') + m); return !!c; };
const run = (g, s) => { for (let i = 0; i < Math.round(s * 30); i++) g.update(1 / 30); };
const g = new Game({ mapSize: 96, seed: 5, mp: true, me: 0,
  players: [{ kind: 'human', team: 1, name: 'A' }, { kind: 'human', team: 1, name: 'B' }, { kind: 'human', team: 2, name: 'C' }] });
const attacks = []; g.events.on('attack', p => attacks.push([p.attacker.owner, p.target.owner, p.attacker.kind]));
let over = null; g.events.on('gameOver', p => { over = p; });

ok(g.players.length === 3 && g.ais.length === 0 && g.players[2].team === 2 && g.players[1].name === 'B' && g.players[0].kind === 'human', 'players / teams / names');
const p0 = g.players[0];
const spot = (type, cx, cz) => { for (let r = 3; r < 20; r++) for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, tx = Math.round(cx + Math.cos(a) * r), tz = Math.round(cz + Math.sin(a) * r); if (g.canPlace(type, tx, tz, 0)) return [tx, tz]; } return null; };
const s0 = g.unitsOf(0).find(u => u.type === 'spearman'), s1 = g.unitsOf(1).find(u => u.type === 'spearman'), v1 = g.unitsOf(1).find(u => u.type === 'villager');
// 1) allies side by side never auto-attack
const sp = spot('house', p0.startX, p0.startZ + 6);
s1.x = s0.x + 0.8; s1.z = s0.z; v1.x = s0.x - 0.8; v1.z = s0.z;
run(g, 3);
ok(!attacks.some(a => (a[0] === 0 && a[1] === 1) || (a[0] === 1 && a[1] === 0)), 'allies do not auto-attack each other');
// 2) cmdAttack on an ally is refused
ok(g.execCommand(0, 'cmdAttack', [[s0.id], v1.id]) === false && !(s0.order && s0.order.type === 'attack'), 'cmdAttack on an ally refused');
ok(g.cmdAttack([s0.id], v1.id) === false, 'cmdAttack (direct) on an ally refused');
// 3) tower ignores allies, shoots enemies
const tw = g._addBuilding('tower', 0, sp[0], sp[1], true);
s1.x = tw.x + 2; s1.z = tw.z; s1.order = null; v1.x = tw.x - 2; v1.z = tw.z; v1.order = null;
attacks.length = 0; run(g, 3);
ok(!attacks.some(a => a[2] === 'building' && a[1] === 1), 'tower ignores allied units');
const e2 = g.unitsOf(2).find(u => u.type === 'spearman'); e2.x = tw.x + 1.5; e2.z = tw.z + 1.5; e2.order = null; e2.path = null;
attacks.length = 0; run(g, 3);
ok(attacks.some(a => a[0] === 0 && a[1] === 2), 'tower / own units fire at the enemy team');
// 4) shared vision: the ally's unit reveals fog for the local team
const N = g.map.size, fx = 48, fz = 10;
const far = g.unitsOf(1).find(u => u.type === 'villager' && u !== v1);
far.x = fx + 0.5; far.z = fz + 0.5; far.order = null; g._updateFog();
ok(g.fog[fz * N + fx] === 2, 'ally unit reveals fog for the local team');
const e3 = g.unitsOf(2).find(u => u.type === 'villager'); e3.x = fx + 1.5; e3.z = fz + 0.5; e3.order = null;
ok(g.isEntityVisible(e3) && g.isEntityVisible(far), 'enemy next to ally unit visible; ally always visible');
const g2 = new Game({ mapSize: 96, seed: 5, mp: true, me: 2, players: g.cfg.players });
ok(!g2.isEntityVisible(g2.unitsOf(0)[0]), 'enemy team does not see team 1 base at start');
// 5) execCommand refuses to move another player's unit
const ox = v1.x, oz = v1.z, oo = v1.order;
ok(g.execCommand(0, 'cmdMove', [[v1.id], 5, 5, false]) === false && v1.order === oo, 'execCommand refuses moving an ally unit');
ok(g.execCommand(0, 'cmdMove', [[e3.id], 5, 5, false]) === false, 'execCommand refuses moving an enemy unit');
const tc1 = g.buildingsOf(1).find(b => b.type === 'towncenter');
ok(g.execCommand(0, 'train', [tc1.id, 'villager']) === false && tc1.queue.length === 0, 'execCommand refuses training in an ally building');
ok(g.execCommand(0, 'cmdMove', [[s0.id], 20, 20, false]) === true && s0.order && s0.order.type === 'move', 'execCommand moves own unit');
// 6) gates: allies pass, enemies do not
const gs = spot('gate', p0.startX - 6, p0.startZ); const gate = g._addBuilding('gate', 0, gs[0], gs[1], true);
ok(g._pass(gs[0], gs[1], 0) && g._pass(gs[0], gs[1], 1) && !g._pass(gs[0], gs[1], 2), 'gate passable for own + allies only');
// 7) team victory when the enemy team is wiped
ok(!over, 'no game over yet');
for (const e of [...g.entities.values()]) if (e.owner === 2 && !e.dead) g._kill(e, null);
run(g, 2);
ok(over && over.won === true && over.winnerTeam === 1 && g.players[2].defeated, 'team victory fires: ' + JSON.stringify(over));
// legacy cfg: player 0 human team 1, AIs team 2
const L = new Game({ mapSize: 96, enemies: 2, seed: 9 });
ok(L.players.length === 3 && L.me === 0 && !L.mp && L.teamOf(0) === 1 && L.teamOf(1) === 2 && L.teamOf(2) === 2 && L.ais.length === 2 && L.quests.list.length === 0, 'legacy cfg teams / AIs / quests');
const Ls = Game.deserialize(JSON.parse(JSON.stringify(L.serialize())));
ok(Ls.teamOf(2) === 2 && Ls.players[0].name === L.players[0].name, 'save/load keeps teams');
const old = L.serialize(); for (const p of old.players) { delete p.team; delete p.kind; delete p.name; }
const Lo = Game.deserialize(old); ok(Lo.teamOf(0) === 1 && Lo.teamOf(1) === 2 && Lo.players[1].kind === 'ai', 'old save without teams loads');
console.log(fails.length ? 'FAILED: ' + fails.length : 'ALL OK');
process.exit(fails.length ? 1 : 0);
