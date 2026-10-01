'use strict';
const assert = require('node:assert/strict');
const Core = require('../src/62-combat-core.js');
const { WEAPONS, WEAPON_BY_ID } = require('../src/60-weapons.js');
let count = 0;
function test(name, fn) { fn(); count++; console.log('OK', name); }
function advance(w, seconds, update) { for (let i = 0; i < Math.ceil(seconds * 60); i++) { if (update) update(i); w.step(1 / 60); } }
function arena(mode = 'ffa', extra = {}) {
  const w = new Core.World({ modeId: mode, seed: 17, ...extra });
  w.addPlayer({ id: 'a', name: 'ALPHA' }); w.addPlayer({ id: 'b', name: 'BRAVO' });
  w.start(); advance(w, 3.1); place(w.actors.get('a'), -7, 0); place(w.actors.get('b'), 7, 0); w._hash.rebuild(w.list);
  return w;
}
function place(a, x, z) { a.x = x; a.z = z; a.hp = a.maxHp; a.armor = 0; a.spawnProtection = 0; a.alive = true; a.vx = a.vz = 0; }
function input(w, id, fields) { const a = w.actors.get(id); w.setInput(id, { seq: a.input.seq + 1, aimX: 7, aimZ: 0, ...fields }); }
function flatMap(size = 24) {
  const m = Core.createArenaMap('duel'); m.w = m.h = size; m.grid = new Uint8Array(size * size); m.spawns = [{ x: -12, z: 0 }, { x: 12, z: 0 }];
  for (let z = 0; z < size; z++) for (let x = 0; x < size; x++) if (x < 2 || z < 2 || x >= size - 2 || z >= size - 2) m.grid[z * size + x] = 1;
  return m;
}
test('pure module exposes 25 weapons, reproducible maps and connected spawn routes', () => {
  assert.equal(WEAPONS.length, 25);
  for (const mode of ['duel', 'ffa', 'royale']) {
    const map = new Core.GridMap(Core.createArenaMap(mode, 9)), visited = new Set([map.floor[0]]), queue = [map.floor[0]];
    for (let i = 0; i < queue.length; i++) for (const next of map.neighbors[queue[i]]) if (!visited.has(next)) { visited.add(next); queue.push(next); }
    assert.equal(visited.size, map.floor.length, mode + ' floor has no isolated islands');
    for (const spawn of map.spawns) assert(map.clear(spawn.x, spawn.z));
    assert(map.clear(0, 0)); assert.equal(map.arenaLayout.blocks.length > 0, true);
    assert.deepEqual(Array.from(map.grid), Array.from(Core.createArenaMap(mode, 9).grid));
    for (const block of map.arenaLayout.blocks) assert(map.wall(block.x, block.z));
  }
});
test('input validation ignores replay, NaN, Infinity and normalizes diagonals', () => {
  const w = arena(), a = w.actors.get('a');
  assert(w.setInput('a', { seq: 10, moveX: 10, moveZ: 10, aimX: Infinity, aimZ: NaN, fire: 'yes' }));
  assert.equal(w.setInput('a', { seq: 9, fire: true }), false);
  assert.equal(a.input.fire, false); assert(Math.abs(Math.hypot(a.input.moveX, a.input.moveZ) - 1) < 1e-12);
  w.step(); assert(Number.isFinite(a.angle)); advance(w, .5); assert.equal(a.vx, 0); assert.equal(a.vz, 0);
});
test('shared collision helpers include origin overlap, endpoint contact and angular edge', () => {
  assert.equal(Core.rayCircleHit({ x: 0, z: 0 }, 1, 0, 4, { x: -.2, z: 0 }, .58), 0);
  assert.equal(Core.segmentCircleHit({ x: 0, z: 0 }, 1, 0, 4, { x: 4.5, z: 0 }, .5), 4);
  assert.equal(Core.rayCircleHit({ x: 0, z: 0 }, 1, 0, 4, { x: 4.6, z: 0 }, .5), null);
  assert(Core.meleeInArc({ x: 0, z: 0 }, { x: 0, z: -.2 }, 0, 1, .4, .5));
  const angle = .2 + Math.asin(.5 / 2) - .0001;
  assert(Core.meleeInArc({ x: 0, z: 0 }, { x: Math.sin(angle) * 2, z: Math.cos(angle) * 2 }, 0, 2, .4, .5));
  assert.deepEqual(Core.mitigateDamage(20, 5), { damage: 15, absorbed: 5, armor: 0 });
  assert.deepEqual(Core.projectileKinematics({ x: 1, y: 2, z: 3, vx: 4, vy: 5, vz: 6, gravity: 10 }, .1), { x: 1.4, y: 2.4, z: 3.6, vx: 4, vy: 4, vz: 6 });
});
test('prediction is exact with authoritative movement, dash and wall collision', () => {
  const w = arena(), a = w.actors.get('a'); place(a, -39, 0);
  let predicted = w.snapshot('a').self;
  for (let i = 0; i < 180; i++) {
    const controls = { seq: i + 1, moveX: i < 90 ? -1 : 1, moveZ: .4, dash: i === 0 || i === 120, sprint: true, aimX: 0, aimZ: 2 };
    predicted = { ...predicted, ...Core.predictMovement(predicted, controls, 1 / 60, w.map) };
    w.setInput('a', controls); w.step();
    assert(Math.abs(predicted.x - a.x) < 1e-10); assert(Math.abs(predicted.z - a.z) < 1e-10); assert(w.map.clear(a.x, a.z));
  }
});
test('visibility and bullets cannot pass a wall corner in either direction', () => {
  const map = new Core.GridMap(Core.createArenaMap('ffa', 8));
  const a = { x: -10.5, z: -31.5 }, b = { x: -1.5, z: -40.5 };
  assert(map.clear(a.x, a.z) && map.clear(b.x, b.z));
  assert.equal(map.los(a, b), false); assert.equal(map.los(b, a), false);
  for (const [from, to] of [[a, b], [b, a]]) {
    const distance = Math.hypot(to.x - from.x, to.z - from.z);
    assert(map.ray(from.x, from.z, (to.x - from.x) / distance, (to.z - from.z) / distance, distance) < distance);
  }
});
test('fixed authority produces identical command results at 30, 60 and 144 display Hz', () => {
  function run(hz) {
    const w = new Core.World({ modeId: 'ffa', seed: 300, botCount: 7 }); w.addPlayer({ id: 'p' }); w.start();
    for (let frame = 0; frame < hz * 16; frame++) {
      const halfSecond = Math.floor(frame * 2 / hz);
      w.setInput('p', { seq: frame, moveX: halfSecond % 4 < 2 ? 1 : -1, moveZ: halfSecond % 4 === 1 ? .5 : 0, aimX: 0, aimZ: 0, fire: halfSecond % 3 !== 0, sprint: false, dash: halfSecond === 10, reload: halfSecond === 15 });
      w.step(1 / hz);
    }
    const snapshot = w.snapshot(null); for (const actor of snapshot.actors) delete actor.inputSeq;
    return { tick: snapshot.tick, time: snapshot.time, actors: snapshot.actors, roster: snapshot.roster, result: snapshot.result, projectiles: snapshot.projectiles };
  }
  assert.deepEqual(run(30), run(60)); assert.deepEqual(run(60), run(144));
});
test('rapid input edges survive packets coalesced before one authority tick', () => {
  const w = arena(), a = w.actors.get('a'); w.giveWeapon('a', 'pistol'); a.mags.pistol = 3;
  input(w, 'a', { fire: true, dash: true, moveX: 1 }); input(w, 'a', { fire: false, dash: false, moveX: 1 });
  const received = a.input.seq; assert(w.snapshot('a').self.inputSeq < received); w.step(); assert.equal(a.mags.pistol, 2); assert(a.dashCd > 1); assert.equal(w.snapshot('a').self.inputSeq, received);
  input(w, 'a', { reload: true }); input(w, 'a', { reload: false }); w.step(); assert(a.reloading > 0);
  const br = arena('royale'), p = br.actors.get('a'); p.hp = 20; input(br, 'a', { heal: true }); input(br, 'a', { heal: false }); br.step(); assert(p.healing > 0);
});
test('four-slot loadouts allow every weapon and enforce two primary slots', () => {
  const w = arena(); const a = w.actors.get('a'); assert.equal(a.weaponSlots.length, 4); assert.equal(WEAPON_BY_ID[a.weaponSlots[0]].slot, 'sidearm');
  for (const weapon of WEAPONS) { const other = new Core.World({ loadout: 'weapon:' + weapon.id, modeId: 'duel' }); const p = other.addPlayer({ id: 'p' }); assert(p.owned[weapon.id]); }
  w.giveWeapon('a', 'rocket'); assert.equal(a.weaponSlots.filter(id => WEAPON_BY_ID[id].slot === 'primary').length, 2);
  input(w, 'a', { slot: 3 }); w.step(); assert.equal(WEAPON_BY_ID[a.weaponId].slot, 'melee');
});
test('all firearm families resolve in core with finite state and authoritative events', () => {
  for (const weapon of WEAPONS.filter(w => w.fire !== 'melee')) {
    const w = arena('ffa', { level: flatMap() }), a = w.actors.get('a'), b = w.actors.get('b');
    place(a, -2, 0); place(b, weapon.fire === 'flame' ? 3 : 6, 0); b.hp = b.maxHp = 10000; w.giveWeapon('a', weapon.id); w._hash.rebuild(w.list);
    const seen = new Set();
    advance(w, 2.5, i => { for (const e of w.events) if (e.weaponId === weapon.id) seen.add(e.type); input(w, 'a', { fire: weapon.auto || i % 30 < 15, aimX: b.x, aimZ: b.z }); });
    assert(a.shotSeq > 0, weapon.id + ' fires');
    assert(seen.has('shot'), weapon.id + ' emits shot');
    if (weapon.id !== 'grenadeLauncher') assert(b.hp < b.maxHp, weapon.id + ' damages target');
    assert(Number.isFinite(b.hp)); assert(a.mags[weapon.id] >= 0);
  }
});
test('reload consumes reserves and shell reload can be interrupted by a shot', () => {
  const w = arena(), a = w.actors.get('a'); w.giveWeapon('a', 'smg'); a.mags.smg = 0; a.ammo.smg = 10;
  input(w, 'a', { reload: true }); advance(w, 1.7); assert.equal(a.mags.smg, 10); assert.equal(a.ammo.smg, 0);
  w.giveWeapon('a', 'shotgun'); a.mags.shotgun = 0; input(w, 'a', { reload: true }); advance(w, 1.3); assert(a.mags.shotgun > 0); const before = a.mags.shotgun;
  input(w, 'a', { fire: true }); w.step(); assert.equal(a.reloading, 0); assert.equal(a.mags.shotgun, before - 1);
});
test('burst rifle fires scheduled rounds after the trigger is released', () => {
  const w = arena(), a = w.actors.get('a'); w.giveWeapon('a', 'burstRifle'); const before = a.mags.burstRifle;
  input(w, 'a', { fire: true }); w.step(); input(w, 'a', { fire: false }); advance(w, .25);
  assert.equal(a.mags.burstRifle, before - 3); assert.equal(a.shotSeq, 3);
});
test('all melee weapons use windup, arc, reach, one hit per swing and recovery', () => {
  for (const weapon of WEAPONS.filter(w => w.fire === 'melee')) {
    const w = arena('ffa', { level: flatMap() }), a = w.actors.get('a'), b = w.actors.get('b'); place(a, 0, 0); place(b, 1.4, 0); w.giveWeapon('a', weapon.id); w._hash.rebuild(w.list);
    input(w, 'a', { fire: true, aimX: b.x, aimZ: 0 }); w.step(); assert.equal(a.attackPhase, 'windup'); assert.equal(b.hp, 100);
    advance(w, weapon.windup + weapon.activeTime + .03); const damage = 100 - b.hp; assert(Math.abs(damage - weapon.damage * .55) < .001, weapon.id);
    advance(w, 1); assert.equal(a.attackPhase, null); assert.equal(100 - b.hp, damage, 'held trigger cannot repeat a melee swing');
  }
});
test('melee cannot reach through cover or hit behind attacker; heavy stays below full health', () => {
  const w = arena('ffa', { level: flatMap() }), a = w.actors.get('a'), b = w.actors.get('b'); place(a, 0, 0); place(b, -1.5, 0); w.giveWeapon('a', 'hammer');
  input(w, 'a', { altFire: true, aimX: 4, aimZ: 0 }); advance(w, 1.1); assert.equal(b.hp, 100);
  input(w, 'a', { altFire: false }); advance(w, 1); place(b, 1.5, 0); input(w, 'a', { altFire: true, aimX: 4, aimZ: 0 }); advance(w, 1.1); assert(b.hp > 0 && b.hp < 10);
  const m = w.map; m.grid[m.cell(1.5, 0)] = 1; place(a, -1, 0); place(b, 3.5, 0); input(w, 'a', { altFire: false }); advance(w, 1); input(w, 'a', { altFire: true, aimX: 4, aimZ: 0 }); advance(w, 1.1); assert.equal(b.hp, 100);
});
test('no post-hit immunity; armor absorbs damage and simultaneous FFA kills both score', () => {
  const w = arena(), a = w.actors.get('a'), b = w.actors.get('b'); a.armor = 30;
  w.damage('a', 20, 'b'); w.damage('a', 20, 'b'); w.step(); assert.equal(a.hp, 84); assert.equal(a.armor, 6);
  a.armor = 0; w.damage('a', 200, 'b'); w.damage('b', 200, 'a'); w.step(); assert.equal(a.alive, false); assert.equal(b.alive, false); assert.equal(a.score, 1); assert.equal(b.score, 1);
});
test('FFA has 3-second respawn and 1.5-second shield canceled by attacking', () => {
  const w = arena(), a = w.actors.get('a'); w.damage('a', 1000, 'b'); w.step(); advance(w, 2.9); assert.equal(a.alive, false); advance(w, .15); assert(a.alive && a.spawnProtection > 1.4);
  const hp = a.hp; w.damage('a', 1000, 'b'); w.step(); assert.equal(a.hp, hp);
  input(w, 'a', { fire: true }); w.step(); assert.equal(a.spawnProtection, 0); w.damage('a', 20, 'b'); w.step(); assert(a.hp < hp);
});
test('duel has equal equipment, simultaneous draw, overtime, first-five and hard cap', () => {
  const w = arena('duel'), a = w.actors.get('a'), b = w.actors.get('b'); assert.deepEqual(a.weaponSlots, b.weaponSlots);
  w.damage('a', 1000, 'b'); w.damage('b', 1000, 'a'); w.step(); assert.equal(w.phase, 'roundBreak'); assert.equal(a.score + b.score, 0);
  advance(w, 4.6); assert.equal(w.phase, 'active'); assert.equal(w.round, 2); w.roundElapsed = 90; w.step(); assert.equal(w.phase, 'overtime'); assert(w.zone && w.zone.radius < 30);
  a.score = 4; w.damage('b', 1000, 'a'); w.step(); assert.equal(w.result.winnerId, 'a'); assert.equal(a.score, 5);
  const capped = arena('duel'); capped.time = capped.startedAt + 900; capped.phase = 'roundBreak'; capped.step(); assert(capped.result && capped.result.reason === 'time');
});
test('FFA score and time limits preserve tied winner set', () => {
  const w = arena(); w.actors.get('a').score = 19; w.damage('b', 1000, 'a'); w.step(); assert.equal(w.result.winnerId, 'a');
  const tie = arena(); tie.elapsed = 300; tie.step(); assert.equal(tie.result.draw, true); assert.equal(tie.result.winnerIds.length, 2);
});
test('royale five stages are seeded, shrink monotonically and end in a reachable plaza', () => {
  const w = arena('royale'); let last = Infinity;
  for (let t = 0; t < 480; t++) { w.elapsed = t; w._updateZone(); assert(w.zone.radius <= last + 1e-8); last = w.zone.radius; assert(w.zone.stage >= 1 && w.zone.stage <= 5); }
  assert(w.zone.radius < 1); assert(w.map.clear(w.zone.nextX, w.zone.nextZ)); assert.equal(w._zoneStages.length, 5);
  for (const loot of w.loot) assert(w.map.clear(loot.x, loot.z));
});
test('royale supports loot, bounded armor, ammo, medkits and interruption', () => {
  const w = arena('royale'), a = w.actors.get('a'); w.loot.length = 0;
  w._addLoot({ x: a.x, z: a.z, kind: 'weapon', weaponId: 'rocket' }); input(w, 'a', { interact: true }); w.step(); assert(a.owned.rocket);
  w._addLoot({ x: a.x, z: a.z, kind: 'armor', amount: 500 }); w.step(); assert.equal(a.armor, 75);
  a.hp = 20; a.armor = 0; a.medkits = 2; input(w, 'a', { heal: true }); advance(w, 1); assert(a.healing > 0); w.damage('a', 1, 'b'); w.step(); assert.equal(a.healing, 0); assert.equal(a.medkits, 2);
  advance(w, .2); input(w, 'a', { heal: true }); advance(w, 3.1); assert.equal(a.hp, 84); assert.equal(a.medkits, 1);
  a.hp = 30; input(w, 'a', { heal: true }); w.step(); input(w, 'a', { moveX: 1 }); w.step(); assert.equal(a.healing, 0);
});
test('royale pistol reserves are finite while arena sidearm reload remains unlimited', () => {
  const w = arena('royale'), a = w.actors.get('a'); w.loot.length = 0; a.ammo.pistol = 3; a.mags.pistol = 0;
  input(w, 'a', { reload: true }); advance(w, 1.2); assert.equal(a.mags.pistol, 3); assert.equal(a.ammo.pistol, 0);
  a.mags.pistol = 0; input(w, 'a', { reload: true }); w.step(); assert.equal(a.reloading, 0); assert.equal(w.snapshot('a').self.reserveLimited, true);
  w._addLoot({ x: a.x, z: a.z, kind: 'ammo' }); w.step(); assert.equal(a.ammo.pistol, 28); assert.equal(w.snapshot('a').self.reserve, 28);
  const duel = arena('duel'), p = duel.actors.get('a'); p.weaponId = 'pistol'; p.mags.pistol = 0; input(duel, 'a', { reload: true }); advance(duel, 1.2); assert.equal(p.mags.pistol, 14); assert.equal(duel.snapshot('a').self.reserveLimited, false);
});
test('projectiles sweep into cover, grenades bounce/fuse and bolt has no splash', () => {
  const w = arena('ffa', { level: flatMap() }), a = w.actors.get('a'), b = w.actors.get('b'); place(a, -8, 0); place(b, 8, 0);
  w.map.grid[w.map.cell(0, 0)] = 1; w.map.grid[w.map.cell(0, -1)] = 1; w.giveWeapon('a', 'rocket'); input(w, 'a', { fire: true }); advance(w, .6); assert.equal(b.hp, 100); assert.equal(w.projectiles.length, 0); assert(w.events.some(e => e.type === 'explosion'));
  w.giveWeapon('a', 'grenadeLauncher'); a.fireWasDown = false; a.fireCd = 0; input(w, 'a', { fire: true }); advance(w, .3); assert(w.projectiles.length === 1 && w.projectiles[0].vy !== 0); advance(w, 1.1); assert.equal(w.projectiles.length, 0);
  const bolt = arena('ffa', { level: flatMap() }); bolt.addPlayer({ id: 'near' }); place(bolt.actors.get('a'), -5, 0); place(bolt.actors.get('b'), 5, 0); place(bolt.actors.get('near'), 5, 1.3); bolt.giveWeapon('a', 'crossbow'); input(bolt, 'a', { fire: true, aimX: 5, aimZ: 0 }); advance(bolt, .3); assert.equal(bolt.actors.get('near').hp, 100); assert(!bolt.events.some(e => e.type === 'explosion'));
});
test('royale elimination spectates without ending when local player dies; late join spectates', () => {
  const w = arena('royale'); w.addPlayer({ id: 'c' }); assert(w.actors.get('c').spectator);
  // A third original competitor is made before start in the normal path.
  const full = new Core.World({ modeId: 'royale', capacity: 4 }); for (const id of ['a', 'b', 'c']) full.addPlayer({ id }); full.start(); advance(full, 3.1);
  full.damage('a', 1000, 'b'); full.step(); assert.equal(full.result, null); assert(full.snapshot('a').spectating); assert.equal(full.actors.get('a').placement, 3);
  full.damage('b', 1000, 'c'); full.step(); assert.equal(full.result.winnerId, 'c'); assert.equal(full.actors.get('c').placement, 1);
});
test('royale simultaneous last deaths are a draw, not iteration-order victory', () => {
  const w = arena('royale'); w.damage('a', 1000, 'b'); w.damage('b', 1000, 'a'); w.step(); assert(w.result.draw); assert.deepEqual(w.result.winnerIds, []);
});
test('personal snapshots redact unseen actors, inventory and exact sound coordinates', () => {
  const w = arena('ffa', { level: flatMap() }), a = w.actors.get('a'), b = w.actors.get('b');
  place(a, -5, 0); place(b, 5, 0); const wallCell = w.map.cell(0, 0); w.map.grid[wallCell] = 1; w.map.grid[wallCell - w.map.w] = 1;
  w.events.length = 0; input(w, 'b', { fire: true, aimX: 12, aimZ: 0 }); w.step();
  const s = w.snapshot('a'); assert.equal(s.actors.some(p => p.id === 'b'), false); assert(s.roster.some(p => p.id === 'b'));
  assert.equal(s.roster.find(p => p.id === 'b').x, undefined); const sound = s.events.find(e => e.type === 'sound'); assert(sound); assert.equal(sound.x, undefined); assert.equal(sound.actorId, undefined);
  place(b, -5, 6); w.events.length = 0; const visible = w.snapshot('a').actors.find(p => p.id === 'b'); assert(visible); assert.equal(visible.ammo, undefined); assert(s.self.ammo);
  assert.equal(w.snapshot('unknown').actors.length, 0);
  place(b, 5, 0); w._event('hit', { actorId: 'a', targetId: 'b', damage: 10, x: b.x, z: b.z }); const hiddenHit = w.snapshot('a').events.find(e => e.type === 'hit'); assert.equal(hiddenHit.x, undefined); assert.equal(hiddenHit.targetId, undefined);
  place(b, -5, 6); w._event('explosion', { actorId: 'b', weaponId: 'rocket', x: 5, z: 0, radius: 5 });
  const blast = w.snapshot('a').events.at(-1); assert.equal(blast.type, 'sound'); assert.equal(blast.x, undefined, 'visible shooter does not reveal a blast behind cover');
});
test('disconnect ends a duel and FFA replaces a bot only at its next death', () => {
  const duel = arena('duel'); duel.removePlayer('b'); assert.equal(duel.result.winnerId, 'a');
  const w = new Core.World({ modeId: 'ffa', capacity: 3, botCount: 2 }); w.addPlayer({ id: 'a' }); w.start(); advance(w, 3.1);
  const join = w.addPlayer({ id: 'human' }); assert(join.pending && join.spectator); const bot = w.list.find(p => p.bot); bot.spawnProtection = 0; w.damage(bot.id, 1000, 'a'); w.step();
  assert(!w.actors.has(bot.id)); assert(!join.pending && !join.spectator && join.alive); assert.equal(w.list.length, 3);
});
test('authoritative simulation is deterministic and snapshots are JSON-safe', () => {
  const run = () => { const w = new Core.World({ modeId: 'ffa', seed: 445, botCount: 15 }); w.addPlayer({ id: 'human' }); advance(w, 20); return w.snapshot(null); };
  const a = run(), b = run(); assert.deepEqual(a, b); const json = JSON.stringify(a); assert(!json.includes('NaN')); assert(!json.includes('Infinity'));
});
test('duel rotates reproducible equal loadouts and forfeits after a drawn round', () => {
  const a = arena('duel', { seed: 901 }), same = arena('duel', { seed: 901 }), different = arena('duel', { seed: 902 });
  assert.deepEqual(a.duelLoadouts, same.duelLoadouts); assert.notDeepEqual(a.duelLoadouts, different.duelLoadouts);
  const before = a.snapshot('a').roundLoadout, next = a.snapshot('a').nextRoundLoadout;
  a.damage('a', 1000, 'b'); a.damage('b', 1000, 'a'); a.step(); advance(a, 4.6);
  assert.deepEqual(a.actors.get('a').weaponSlots, next); assert.deepEqual(a.actors.get('b').weaponSlots, next); assert.notDeepEqual(before, next);
  a.damage('a', 1000, 'b'); a.damage('b', 1000, 'a'); a.step(); a.removePlayer('b'); assert.equal(a.result.winnerId, 'a');
});
test('FFA tie breaker uses deaths and full ties share placement', () => {
  const w = arena(); w.actors.get('a').score = w.actors.get('b').score = 9; w.actors.get('a').deaths = 2; w.actors.get('b').deaths = 3;
  w.elapsed = 300; w.step(); assert.equal(w.result.winnerId, 'a'); assert.equal(w.result.standings[0].placement, 1);
  const tie = arena(); tie.elapsed = 300; tie.step(); assert(tie.result.draw); assert(tie.result.standings.every(a => a.placement === 1));
});
test('pending FFA human uses a vacancy and BR pickup cannot cancel melee recovery', () => {
  const w = new Core.World({ modeId: 'ffa', capacity: 3, botCount: 2 }); w.addPlayer({ id: 'a' }); w.start(); advance(w, 3.1);
  const pending = w.addPlayer({ id: 'waiting' }); assert(pending.pending); w.removePlayer('a'); w.step(); assert(pending.alive && !pending.pending); assert.equal(w.list.filter(a => !a.spectator).length, 3);
  const br = arena('royale'), a = br.actors.get('a'); br.giveWeapon('a', 'hammer'); br.loot = []; br._addLoot({ x: a.x, z: a.z, kind: 'weapon', weaponId: 'rifle' });
  input(br, 'a', { altFire: true }); br.step(); assert(a.attack); input(br, 'a', { interact: true }); br.step(); assert(a.attack); assert.equal(a.weaponId, 'hammer');
});
console.log('CORE_OK', count, 'cases');
