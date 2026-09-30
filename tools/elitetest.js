/* Elite ranks: the roll, the stat edits and what a rank does when it dies.
   No renderer and no browser — the ranks are data plus one hook.
   Run: node tools/elitetest.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const testMath = Object.create(Math);
const noop = () => {};
const context = { Math: testMath, console, sfx: new Proxy({}, { get: () => noop }) };
for (const name of ['Crawler', 'Grunt', 'Spitter', 'Flyer', 'Brute', 'Queen', 'Siege', 'Warden', 'Overmind']) {
  context['build' + name] = noop;
}
vm.createContext(context);
for (const file of ['00-util.js', '30-level.js', '70-enemies.js']) {
  new vm.Script(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file }).runInContext(context);
}
const { EnemyManager, ENEMY_BY_ID, ELITE_MODS, ELITE_BY_ID, eliteChance, makeRng } =
  vm.runInContext('({ EnemyManager, ENEMY_BY_ID, ELITE_MODS, ELITE_BY_ID, eliteChance, makeRng })', context);

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };

/* A manager with just enough game around it to spawn, kill and split. */
function fixture(seed, wave) {
  const manager = Object.create(EnemyManager.prototype);
  manager.list = [];
  manager.nextId = 1;
  manager._fallbackRng = makeRng(1);
  manager.eliteRanks = true;
  manager.meshes = [];
  const fx = {};
  for (const key of ['sparks', 'gibs', 'decals', 'lights', 'smoke', 'tracers']) {
    fx[key] = { burst: noop, emit: noop, blood: noop, flash: noop, add: noop };
  }
  const game = {
    rng: makeRng(seed), wave: wave === undefined ? 9 : wave, fx,
    enemies: manager, kills: [], explosions: [],
    shake: noop,
    waveScale: () => ({ hp: 1, dmg: 1, speed: 1 }),
    explosion: (...args) => { game.explosions.push(args); return 0; },
    onEnemyKilled: (e) => game.kills.push(e)
  };
  manager.game = game;
  return { manager, game };
}

/* ---------------------------------------------------------------- table */
const seen = new Set();
for (const mod of ELITE_MODS) {
  check(!seen.has(mod.id), 'duplicate elite id ' + mod.id);
  seen.add(mod.id);
  check(typeof mod.label === 'string' && mod.label.length > 0, mod.id + ' has no label');
  check(typeof mod.desc === 'string' && mod.desc.length > 0, mod.id + ' has no description');
  check(Array.isArray(mod.tint) && mod.tint.length === 3, mod.id + ' has no usable tint');
  for (const channel of mod.tint) check(channel > 0 && channel < 4, mod.id + ' has an unusable tint channel');
  check(mod.scale > 0.5 && mod.scale < 2, mod.id + ' is scaled out of readable range');
  check(mod.hp > 0 && mod.speed > 0, mod.id + ' has a nonsense stat multiplier');
  // a rank is a threat, so it has to pay more than the plain alien
  check(mod.worth > 1, mod.id + ' is worth no more than an ordinary alien');
  check(ELITE_BY_ID[mod.id] === mod, mod.id + ' missing from the index');
  // a rank must read as different at a glance, not only on the health bar
  check(mod.tint.some((c) => Math.abs(c - 1) > 0.1) || Math.abs(mod.scale - 1) > 0.05,
    mod.id + ' looks exactly like an ordinary alien');
}
check(ELITE_MODS.length >= 3, 'too few elite ranks to multiply anything');

/* --------------------------------------------------------------- chance */
check(eliteChance(1) === 0, 'elites appeared on the first wave');
check(eliteChance(2) === 0, 'elites appeared before the player is armed');
check(eliteChance(5) > 0, 'elites never start appearing');
check(eliteChance(9) > eliteChance(5), 'the elite rate stopped climbing');
check(eliteChance(999) <= 0.35, 'elites became the baseline instead of a highlight');
check(eliteChance(999) === eliteChance(500), 'the elite rate has no ceiling');

/* ------------------------------------------------------------ the roll */
{
  // a generator that always rolls under the threshold makes every alien elite
  const { manager } = fixture(1);
  manager.game.rng = () => 0;
  const e = manager.spawn('grunt', 0, 0, { hp: 1, dmg: 1, speed: 1 });
  check(!!e.elite, 'a certain roll produced no rank');
  check(e.elite === ELITE_MODS[0], 'the rank index did not follow the roll');
}
{
  // and one that always rolls high makes none
  const { manager } = fixture(1);
  manager.game.rng = () => 0.999;
  const e = manager.spawn('grunt', 0, 0, { hp: 1, dmg: 1, speed: 1 });
  check(e.elite === null, 'an impossible roll still produced a rank');
  check(e.worth === ENEMY_BY_ID.grunt.score, 'a plain alien was repriced');
}
{
  // bosses are authored fights and never take a rank
  const { manager } = fixture(1);
  manager.game.rng = () => 0;
  for (const id of ['queen', 'siege', 'warden']) {
    const boss = manager.spawn(id, 0, 0, { hp: 1, dmg: 1, speed: 1 });
    check(boss.elite === null, id + ' was given an elite rank');
  }
}

/* ------------------------------------------------------------ the edits */
for (const mod of ELITE_MODS) {
  const { manager } = fixture(1);
  const plain = manager.spawn('grunt', 0, 0, { hp: 1, dmg: 1, speed: 1 });
  const baseHp = plain.maxHp;
  // force this exact rank onto a fresh alien
  const fresh = manager.spawn('grunt', 0, 0, { hp: 1, dmg: 1, speed: 1 });
  fresh.elite = null; fresh.hp = fresh.maxHp = baseHp; fresh.worth = ENEMY_BY_ID.grunt.score;
  const baseSpeed = fresh.speed;
  let index = ELITE_MODS.indexOf(mod);
  let step = 0;
  manager.applyElite(fresh, () => (step++ === 0 ? 0 : (index + 0.5) / ELITE_MODS.length));
  check(fresh.elite === mod, 'could not force rank ' + mod.id);
  check(Math.abs(fresh.maxHp - baseHp * mod.hp) < 1e-6, mod.id + ' did not scale health');
  check(fresh.hp === fresh.maxHp, mod.id + ' spawned already damaged');
  check(Math.abs(fresh.speed - baseSpeed * mod.speed) < 1e-6, mod.id + ' did not scale speed');
  check(fresh.worth > ENEMY_BY_ID.grunt.score, mod.id + ' is not worth more than a plain alien');
}

/* -------------------------------------------------------------- on death */
{
  // volatile detonates once, and the blast is allowed to reach the player
  const { manager, game } = fixture(1);
  const e = manager.spawn('grunt', 4, 5, { hp: 1, dmg: 1, speed: 1 });
  e.elite = ELITE_BY_ID.volatile;
  manager.kill(e, 1, 0, 10);
  check(game.explosions.length === 1, 'a volatile elite did not detonate exactly once');
  check(game.explosions[0][5] === true, 'the detonation could not hurt the player');
  check(game.kills.length === 1, 'the kill was not reported');
}
{
  // a plain alien of the same type does nothing special
  const { manager, game } = fixture(1);
  const e = manager.spawn('grunt', 4, 5, { hp: 1, dmg: 1, speed: 1 });
  e.elite = null;
  manager.kill(e, 1, 0, 10);
  check(game.explosions.length === 0, 'an ordinary alien detonated');
}
{
  /* A splitter's children must be plain. If a rank could seed itself the room
     would fill without bound, which is a frame-rate bug wearing a game design
     costume. */
  const { manager } = fixture(1);
  manager.game.rng = () => 0;  // every roll would otherwise produce a rank
  const e = manager.spawn('grunt', 2, 2, { hp: 1, dmg: 1, speed: 1 });
  e.elite = ELITE_BY_ID.splitter;
  const before = manager.list.length;
  manager.kill(e, 1, 0, 10);
  const children = manager.list.slice(before);
  check(children.length === 2, 'a splitter did not split in two');
  for (const child of children) {
    check(child.def.id === 'crawler', 'a splitter produced the wrong creature');
    check(child.elite === null, 'a splitter seeded another elite');
  }
  check(manager.eliteRanks === true, 'suppression leaked out of spawnPlain');
}
{
  // suppression survives a throw inside the spawn it wraps
  const { manager } = fixture(1);
  manager.spawn = () => { throw new Error('boom'); };
  try { manager.spawnPlain('crawler', 0, 0); } catch (error) { /* expected */ }
  check(manager.eliteRanks === true, 'a failed plain spawn left ranks suppressed');
}

/* ------------------------------------------------------------ determinism */
{
  const roll = (seed) => {
    const { manager } = fixture(seed, 12);
    const out = [];
    for (let i = 0; i < 60; i++) {
      const e = manager.spawn('grunt', i, 0, { hp: 1, dmg: 1, speed: 1 });
      out.push(e.elite ? e.elite.id : '-');
    }
    return out.join(',');
  };
  check(roll(777) === roll(777), 'the same seed produced different elites');
  check(roll(777) !== roll(31337), 'elite rolls ignored the seed');
  check(roll(777).indexOf('volatile') >= 0 || roll(777).indexOf('swift') >= 0 ||
    roll(777).indexOf('armored') >= 0 || roll(777).indexOf('splitter') >= 0,
    'no elite appeared in 60 spawns at wave 12');
}
{
  // the rate really does follow the wave
  const count = (wave) => {
    const { manager } = fixture(99, wave);
    let elites = 0;
    // stay under the per-type cap; spawn() returns null once it is reached
    for (let i = 0; i < 150; i++) {
      const e = manager.spawn('grunt', i, 0, { hp: 1, dmg: 1, speed: 1 });
      check(!!e, 'the fixture hit the spawn cap at ' + i);
      if (e.elite) elites++;
    }
    return elites;
  };
  check(count(1) === 0, 'elites spawned on wave one');
  check(count(12) > count(4), 'the elite rate did not grow with the run');
}

console.log('ELITE_OK: ' + checks + ' assertions; ' + ELITE_MODS.length +
  ' ranks, wave-gated rate, bosses exempt, split children stay plain, seeded rolls');
