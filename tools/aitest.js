'use strict';
const assert = require('node:assert/strict');
const { performance } = require('node:perf_hooks');
const { World } = require('../src/62-combat-core.js');
const reports = [];
for (const modeId of ['duel', 'ffa', 'royale']) {
  const bots = modeId === 'duel' ? 1 : 31;
  const world = new World({ modeId, botCount: bots, capacity: 32, seed: 129, difficulty: 'normal' });
  world.addPlayer({ id: 'local' });
  const positions = new Map(world.list.map(a => [a.id, { x: a.x, z: a.z }]));
  const begin = performance.now();
  for (let i = 0; i < 60 * 90 && !world.result; i++) world.step();
  const elapsedMs = performance.now() - begin, m = world.metrics;
  assert(m.maxPathSearchesPerStep <= 3, 'global pathfinding budget');
  assert(m.maxPathExpansionsPerStep <= 3072, 'bounded BFS work');
  assert(m.sensePasses < m.steps * bots / 3, 'sensing is staggered, not per actor per tick');
  assert(m.pathSearches < m.steps * bots / 8, 'paths are cached');
  let moved = 0;
  for (const a of world.list) {
    assert(Number.isFinite(a.x) && Number.isFinite(a.z) && Number.isFinite(a.hp));
    if (a.alive) assert(world.map.clear(a.x, a.z), modeId + ' actor embedded in cover: ' + a.id);
    if (a.bot && Math.hypot(a.x - positions.get(a.id).x, a.z - positions.get(a.id).z) > 2) moved++;
  }
  assert(moved >= bots * .7, modeId + ' bots navigate');
  assert(world.list.some(a => a.bot && a.shotSeq > 0 && a.damageDealt > 0), modeId + ' bots acquire targets and deal damage');
  // A generous guard catches accidental unbounded work without making CI
  // depend on a particular desktop's clock speed.
  assert(elapsedMs < 10000, modeId + ' 90-second simulation exceeded 10 seconds CPU');
  reports.push({ modeId, actors: world.list.length, simulatedSeconds: +world.time.toFixed(1), cpuMs: +elapsedMs.toFixed(1), kills: world.list.reduce((n, a) => n + a.kills, 0), sensePasses: m.sensePasses, paths: m.pathSearches, maxPathsPerStep: m.maxPathSearchesPerStep });
  for (let i = 0; i < 60 * 920 && !world.result; i++) world.step();
  assert(world.result, modeId + ' resolves under its hard time limit');
  assert(world.result.standings.length === world.list.length);
  assert(world.result.winnerIds.every(id => world.actors.has(id)));
}
// Perception remembers a location for at most 2.5 seconds; no living target's
// coordinates are read through cover between perception samples.
{
  const w = new World({ modeId: 'ffa', seed: 8, botCount: 1 }); w.addPlayer({ id: 'human' }); w.start();
  for (let i = 0; i < 190; i++) w.step();
  const bot = w.list.find(a => a.bot), human = w.actors.get('human');
  bot.x = -8; bot.z = 0; human.x = 8; human.z = 0; bot.spawnProtection = human.spawnProtection = 0; bot.brain.senseIn = 0; w._hash.rebuild(w.list); w._botInput(bot, 1 / 60);
  assert.equal(bot.brain.targetId, 'human'); const remembered = { ...bot.brain.lastKnown };
  human.x = 35; human.z = 35; w._botInput(bot, 1 / 60); assert.deepEqual(bot.brain.lastKnown, remembered);
  w.time += 3; bot.brain.senseIn = 0; w._hash.rebuild(w.list); w._botInput(bot, 1 / 60); assert.equal(bot.brain.targetId, null); assert.equal(bot.brain.lastKnown, null);
}
for (const difficulty of ['easy', 'normal', 'hard']) {
  const world = new World({ modeId: 'ffa', difficulty, botCount: 1 }); world.addPlayer({ id: 'human' }); world.start();
  for (let i = 0; i < 190; i++) world.step();
  const bot = world.list.find(a => a.bot), human = world.actors.get('human');
  bot.x = human.x = 0; bot.z = -1; human.z = 1; bot.weaponId = human.weaponId = 'smg';
  const command = { seq: 1000, moveX: 1, moveZ: 0, aimX: 20, aimZ: 0, fire: false, slot: null };
  bot.input = { ...command }; bot.processedSeq = -1; world.setInput('human', command);
  world._updateActor(bot, 1 / 60); world._updateActor(human, 1 / 60);
  assert(Math.abs(bot.vx - human.vx) < 1e-10, difficulty + ' changes thinking, not physical movement speed');
}
{
  const w = new World({ modeId: 'ffa', botCount: 1, seed: 15 }), bot = w.list[0];
  bot.x = -27; bot.z = -27; bot.brain.pathGoal = -1;
  const goal = { x: -12, z: -12 }; assert(!w.map.los(bot, goal));
  let initialSearches = 0;
  for (let i = 0; i < 180; i++) {
    w._pathsThisStep = 0; w.time += 1 / 60; const next = w._pathPoint(bot, goal);
    if (!i) initialSearches = w.metrics.pathSearches;
    const dx = next.x - bot.x, dz = next.z - bot.z, length = Math.hypot(dx, dz);
    if (length > .01) w._move(bot, dx / length * .055, dz / length * .055);
  }
  assert.equal(w.metrics.pathSearches, initialSearches, 'unchanged reachable route is not periodically rebuilt');
  const changed = { x: 24, z: -27 }; w._pathsThisStep = 0; w._pathPoint(bot, changed);
  assert(w.metrics.pathSearches > initialSearches, 'changed goal gets a new route');
}
{
  const w = new World({ modeId: 'ffa', botCount: 1, seed: 8 }), bot = w.list.find(a => a.bot);
  w.addPlayer({ id: 'human' }); w.start(); const human = w.actors.get('human');
  bot.x = -10.5; bot.z = -40.5; human.x = -1.5; human.z = -40.5; bot.spawnProtection = human.spawnProtection = 0;
  const cover = w._botCover(bot, human);
  assert(cover && w.map.clear(cover.x, cover.z) && !w.map.los(cover, human), 'chosen cover actually blocks perceived attacker');
  bot.hp = 15; bot.brain.senseIn = 0; w._hash.rebuild(w.list); w._botInput(bot, 1 / 60);
  assert(bot.brain.coverGoal && Math.hypot(bot.input.moveX, bot.input.moveZ) > 0, 'injured bot moves toward cover');
  w._updateActor(bot, 1 / 60);
  bot.x = cover.x; bot.z = cover.z; bot.brain.senseIn = 0; bot.hp = 100;
  bot.mags[bot.weaponId] = 5; w._hash.rebuild(w.list); w._botInput(bot, 1 / 60); w._updateActor(bot, 1 / 60);
  assert(bot.reloading > 0, 'bot begins reloading behind cover');
  bot.loadout = ['pistol', 'shotgun', 'sniper', 'knife']; w._equip(bot);
  assert.equal(w._botWeapon(bot, 1), 'knife', 'bot chooses melee inside reach');
  assert.equal(w._botWeapon(bot, 30), 'sniper', 'bot chooses precise long-range weapon');
  bot.mags.sniper = 0; bot.ammo.slug = 0;
  assert.notEqual(w._botWeapon(bot, 30), 'sniper', 'bot cannot select an empty weapon without reserve');
}
console.log('AI_OK', JSON.stringify(reports));
