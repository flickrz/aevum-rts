// Playtest 2 (UI batch): tribute to allies, market barter, control groups in the save.
// node test/playtest2-ui-test.mjs
import { Game, CMD_METHODS } from '../src/sim/game.js';

const fails = [];
const ok = (c, m) => { if (!c) fails.push(m); console.log((c ? '  ok   ' : '  FAIL ') + m); return !!c; };
const run = (g, s) => { for (let i = 0; i < Math.round(s * 30); i++) g.update(1 / 30); };
const cfg = me => ({ mapSize: 96, seed: 5, mp: true, me,
  players: [{ kind: 'human', team: 1, name: 'A' }, { kind: 'human', team: 1, name: 'B' }, { kind: 'human', team: 2, name: 'C' }] });
const spot = (g, type, pid, r0 = 6) => { const p = g.players[pid]; for (let r = r0; r < r0 + 20; r++) for (let k = 0; k < 24; k++) { const a = k / 24 * 6.283, tx = Math.round(p.startX + Math.cos(a) * r), tz = Math.round(p.startZ + Math.sin(a) * r); if (g.canPlace(type, tx, tz, pid)) return [tx, tz]; } return null; };

ok(CMD_METHODS.includes('cmdTribute') && CMD_METHODS.includes('cmdGroup'), 'cmdTribute / cmdGroup are network commands');

// ---- 1) tribute (lockstep path: the same command stream on two clients)
console.log('Tribute');
const A = new Game(cfg(0)), B = new Game(cfg(1));
const both = (pid, m, a) => { const ra = A.execCommand(pid, m, JSON.parse(JSON.stringify(a))), rb = B.execCommand(pid, m, JSON.parse(JSON.stringify(a))); if (ra !== rb) fails.push('clients disagree on ' + m); return ra; };
for (const g of [A, B]) { g.players[0].res.wood = 700; g.players[1].res.wood = 0; g.players[2].res.wood = 50; }
ok(both(0, 'cmdTribute', [0, 1, 'wood', 500]) === true, 'tribute to an ally runs through execCommand');
ok(A.players[0].res.wood === 200 && A.players[1].res.wood === 500, 'tribute moves 500 wood (700/0 -> 200/500)');
ok(both(0, 'cmdTribute', [0, 2, 'wood', 100]) === false && A.players[2].res.wood === 50 && A.players[0].res.wood === 200, 'tribute to an enemy is refused');
ok(both(0, 'cmdTribute', [0, 0, 'wood', 100]) === false, 'tribute to oneself is refused');
ok(both(0, 'cmdTribute', [0, 1, 'wood', -100]) === false && both(0, 'cmdTribute', [0, 1, 'wood', 0]) === false && both(0, 'cmdTribute', [0, 1, 'wood', NaN]) === false, 'zero / negative / NaN amounts are refused');
ok(both(0, 'cmdTribute', [0, 1, 'mana', 100]) === false && both(0, 'cmdTribute', [0, 1, 'res', 100]) === false, 'unknown resources are refused');
ok(both(0, 'cmdTribute', [0, 1, 'wood', 1e9]) === true && A.players[0].res.wood === 0 && A.players[1].res.wood === 700, 'more than you have sends only what you have');
ok(both(0, 'cmdTribute', [0, 1, 'wood', 100]) === false, 'nothing left: refused');
const g1 = A.players[1].res.gold, g2 = A.players[2].res.gold;
both(2, 'cmdTribute', [0, 1, 'gold', 50]);
ok(A.players[1].res.gold === g1 && A.players[2].res.gold === g2, 'enemy (forged as player 0) cannot pay into team 1');
A.players[1].defeated = B.players[1].defeated = true;
A.players[0].res.food = B.players[0].res.food = 300;
ok(both(0, 'cmdTribute', [0, 1, 'food', 100]) === false, 'a defeated ally gets nothing');
A.players[1].defeated = B.players[1].defeated = false;
run(A, 2); run(B, 2);
ok(A.hash() === B.hash(), 'both clients stay in sync after the tributes');

// ---- 2) barter at the market
console.log('Barter');
const s = spot(A, 'market', 0);
for (const g of [A, B]) g._addBuilding('market', 0, s[0], s[1], true);
for (const g of [A, B]) { const r = g.players[0].res; r.wood = 1000; r.food = 0; r.stone = 0; r.gold = 0; }
const viaGold = Math.floor(A.tradeRate('wood', 'gold', 0) * A.tradeRate('gold', 'food', 0) / 100);
const direct = A.tradeRate('wood', 'food', 0);
ok(direct > viaGold && direct <= viaGold * 1.2, `barter rate (100 wood -> ${direct} food) is a bit better than selling then buying (${viaGold})`);
ok(A.tradeRate('wood', 'gold', 0) === 35 && A.tradeRate('gold', 'wood', 0) === 140, 'gold prices unchanged (100 wood -> 35 gold, 100 gold -> 140 wood)');
ok(A.tradeRate('stone', 'wood', 0) > A.tradeRate('wood', 'stone', 0), 'stone is worth more than wood in barter too');
ok(both(0, 'trade', [0, 'wood', 'food']) === true && A.players[0].res.wood === 900 && A.players[0].res.food === direct, 'trade wood -> food in one step through execCommand');
ok(both(0, 'trade', [0, 'stone', 'food']) === false, 'barter needs 100 of the given resource');
ok(both(1, 'trade', [1, 'wood', 'food']) === false, 'barter needs an own finished market');
A.players[0].techs.add('coinage'); B.players[0].techs.add('coinage'); A._mods(A.players[0]); B._mods(B.players[0]);
ok(A.tradeRate('wood', 'food', 0) > direct && A.tradeRate('wood', 'food', 0) < 100, 'the trade techs raise the barter rate too (still below 1:1)');
ok(A.hash() === B.hash(), 'both clients stay in sync after barter');

// ---- 3) control groups saved with the game
console.log('Control groups');
const us0 = A.unitsOf(0), us1 = A.unitsOf(1), tc0 = A.buildingsOf(0).find(b => b.type === 'towncenter');
const grp1 = us0.slice(0, 4).map(u => u.id), grp2 = [tc0.id];
ok(both(0, 'cmdGroup', [0, 1, grp1]) && both(0, 'cmdGroup', [0, 2, grp2]), 'cmdGroup runs through execCommand');
both(0, 'cmdGroup', [0, 3, [us1[0].id, us0[5].id]]);
ok(JSON.stringify(A.controlGroups(0)[3]) === JSON.stringify([us0[5].id]), "an ally's unit is dropped from my group");
both(1, 'cmdGroup', [0, 1, [us1[0].id]]);
ok(JSON.stringify(A.controlGroups(0)[1]) === JSON.stringify(grp1) && JSON.stringify(A.controlGroups(1)[1]) === JSON.stringify([us1[0].id]), 'each player has his own groups (forged owner ignored)');
ok(both(0, 'cmdGroup', [0, 12, grp1]) === false && both(0, 'cmdGroup', [0, 0, grp1]) === false, 'only groups 1-9');
const h0 = A.hash(); both(0, 'cmdGroup', [0, 4, grp1]); ok(A.hash() === h0, 'groups are not part of the hash');
// one unit of group 1 dies before the save, another after the load
A._kill(A.entities.get(grp1[0]), null); B._kill(B.entities.get(grp1[0]), null);
run(A, 1); run(B, 1);
const json = JSON.stringify(A.serialize());
const L0 = Game.deserialize(JSON.parse(json), { me: 0 }), L1 = Game.deserialize(JSON.parse(json), { me: 1 });
ok(JSON.stringify(L0.controlGroups(0)[1]) === JSON.stringify(grp1.slice(1)), 'group 1 restored by id after load, the dead unit dropped');
ok(JSON.stringify(L0.controlGroups(0)[2]) === JSON.stringify(grp2), 'group 2 (a building) restored');
ok(JSON.stringify(L1.controlGroups(1)[1]) === JSON.stringify([us1[0].id]), "the other player's groups come with the same multiplayer save");
ok(L0.hash() === L1.hash() && L0.hash() === A.hash(), 'loaded copies agree with the original');
L0._kill(L0.entities.get(grp1[1]), null);
ok(JSON.stringify(L0.controlGroups(0)[1]) === JSON.stringify(grp1.slice(2)), 'a unit that dies after the load drops out too');
ok(both(0, 'cmdGroup', [0, 2, []]) && !A.controlGroups(0)[2], 'an empty list clears a group');
// old saves (no groups)
const old = JSON.parse(json); for (const p of old.players) delete p.cg;
ok(JSON.stringify(Game.deserialize(old, { me: 0 }).controlGroups(0)) === '{}', 'an old save without groups loads with none');

// single player save too
const S = new Game({ mapSize: 96, seed: 9, enemies: 1, difficulty: 'easy' });
const sv = S.unitsOf(0).slice(0, 3).map(u => u.id);
ok(S.cmdGroup(0, 5, sv), 'single player: cmdGroup direct call');
const S2 = Game.deserialize(JSON.parse(JSON.stringify(S.serialize())));
ok(JSON.stringify(S2.controlGroups(0)[5]) === JSON.stringify(sv), 'single player: group 5 back after load');

// ---- 4) town bell (MP-safe sim command, shelter + resume previous task)
console.log('Town bell');
{
  ok(CMD_METHODS.includes('cmdTownBell'), 'cmdTownBell is a network command');
  const A2 = new Game(cfg(0)), B2 = new Game(cfg(1));
  const both2 = (pid, m, a) => { const ra = A2.execCommand(pid, m, JSON.parse(JSON.stringify(a))), rb = B2.execCommand(pid, m, JSON.parse(JSON.stringify(a))); if (ra !== rb) fails.push('clients disagree on ' + m); return ra; };
  const tcA = A2.buildingsOf(0).find(b => b.type === 'towncenter');
  const vils = A2.unitsOf(0).filter(u => u.type === 'villager');
  const tree = A2.resourceNear(tcA.x, tcA.z, 30, 'tree');
  const gold = A2.resourceNear(tcA.x, tcA.z, 30, 'gold');
  both2(0, 'cmdGather', [vils.slice(0, 3).map(u => u.id), tree.id]);
  both2(0, 'cmdGather', [vils.slice(3, 6).map(u => u.id), gold.id]);
  run(A2, 8); run(B2, 8);
  // forged owner: player 1 cannot ring player 0's bell
  both2(1, 'cmdTownBell', [0]);
  ok(!A2.players[0].bell && !!A2.players[1].bell, 'forged owner ignored (player 1 rang own bell, not player 0)');
  // player 0 rings bell
  ok(both2(0, 'cmdTownBell', [0]) === true && A2.players[0].bell === true, 'player 0 rings town bell');
  ok(vils.slice(0, 6).every(u => u.sheltered === tcA.id && u.order && u.order.type === 'move' && u.order.bell === 1), 'all working villagers head to nearest Town Center');
  // manually redirect villager 0 while bell is active: it should NOT be overwritten on resume
  both2(0, 'cmdMove', [[vils[0].id], tcA.x + 12, tcA.z]);
  ok(!vils[0].sheltered, 'manual order clears shelter flag on that villager');
  run(A2, 6); run(B2, 6);
  // save/load while bell is active preserves bell state and saved tasks
  const snap = Game.deserialize(JSON.parse(JSON.stringify(A2.serialize())), { me: 0 });
  ok(snap.players[0].bell === true && snap.hash() === A2.hash(), 'town bell state survives save/load with same hash');
  // second press: sheltered villagers return to their previous tree/gold tasks
  ok(both2(0, 'cmdTownBell', [0]) === true && A2.players[0].bell === false, 'second press turns town bell off');
  ok(vils[1].order && (vils[1].order.type === 'gather' || vils[1].order.type === 'return'), 'tree villager resumed gathering');
  ok(vils[3].order && (vils[3].order.type === 'gather' || vils[3].order.type === 'return'), 'gold villager resumed gathering');
  ok(!vils[0].order || vils[0].order.type === 'move', 'manually redirected villager kept its manual order');
  run(A2, 4); run(B2, 4);
  ok(A2.hash() === B2.hash(), 'both clients stay in sync after town bell cycle');
}

console.log(fails.length ? `\n${fails.length} FAILED` : '\nALL OK');
process.exit(fails.length ? 1 : 0);
