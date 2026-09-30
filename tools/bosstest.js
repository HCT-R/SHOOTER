/* The finale: the Overmind's phases and the hazard field its transitions
   erupt. Both are gameplay, so both run here against the production classes
   rather than against a description of them.
   Run: node tools/bosstest.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

async function main() {
  const root = path.resolve(__dirname, '..');
  const THREE = await import('data:text/javascript;base64,' +
    fs.readFileSync(path.join(root, 'vendor', 'three.module.js')).toString('base64'));
  const noop = () => {};
  const context = {
    THREE, Math, console, performance, TEX: { glow: null },
    document: { body: { classList: { contains: () => true } } },
    window: { addEventListener: noop, localStorage: { getItem: () => null, setItem: noop } },
    sfx: new Proxy({}, { get: () => noop })
  };
  vm.createContext(context);
  for (const file of ['00-util.js', '05-save.js', '15-simulation.js', '40-models.js', '45-customize.js',
    '60-weapons.js', '70-enemies.js', '86-hazards.js', '92-upgrades.js']) {
    new vm.Script(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file }).runInContext(context);
  }
  const A = vm.runInContext('({ EnemyManager, ENEMY_TYPES, ENEMY_BY_ID, nextBossPhase, Hazards, ' +
    'HAZARD_TICK, HAZARD_WARM, HAZARD_FADE, HAZARD_CAP, makeRng, initPrimitives })', context);
  A.initPrimitives();

  let checks = 0;
  const check = (condition, message) => { assert(condition, message); checks++; };

  /* A manager without meshes: spawning, damage and the phase machinery are all
     prototype methods and none of them needs a scene. */
  function fixture() {
    const game = {
      rng: A.makeRng(90210), scene: null, phaseCalls: [], hurt: [],
      damagePlayer: (amount, x, z) => game.hurt.push({ amount, x, z }),
      onBossPhase: (e, phase) => game.phaseCalls.push({ phase: e.bossPhase, label: phase.label }),
      fx: { sparks: { burst: noop, emit: noop }, lights: { flash: noop }, shockwaves: { emit: noop },
        gibs: { burst: noop }, decals: { blood: noop }, smoke: { emit: noop } },
      shake: noop, hud: { showBanner: noop, popup: noop },
      level: { isWallAt: () => false, lineOfSight: () => true },
      onEnemyKilled: noop, spawnEnemyAt: noop,
      waveScale: () => ({ hp: 1, dmg: 1, speed: 1 })
    };
    game.enemies = Object.assign(Object.create(A.EnemyManager.prototype), {
      game, list: [], nextId: 1, eliteRanks: false, aliveCount: 0,
      _fallbackRng: A.makeRng(1)
    });
    return game;
  }
  const overmind = (game) => game.enemies.spawn('overmind', 0, 0, { hp: 1, dmg: 1, speed: 1 });

  /* --------------------------------------------------------- the table */
  {
    const d = A.ENEMY_BY_ID.overmind;
    check(!!d, 'the Overmind is not in the enemy table');
    check(d.boss === true, 'the finale is not marked as a boss');
    check(Array.isArray(d.phases) && d.phases.length === 3, 'the finale does not have three phases');
    check(d.phases[0].at === 1, 'the first phase does not start at full health');
    for (let i = 1; i < d.phases.length; i++) {
      check(d.phases[i].at < d.phases[i - 1].at, 'phase ' + i + ' does not begin below the one before it');
      check(d.phases[i].at > 0, 'phase ' + i + ' begins at or below zero health');
    }
    for (const phase of d.phases) {
      check(typeof phase.label === 'string' && phase.label.length > 0, 'a phase has no label');
      // every phase must leave the boss able to do something
      check(phase.special || phase.ranged || phase.spawnsAdds, phase.label + ' has no way to threaten anyone');
    }
    // the three phases have to be three different fights, not three stat rows
    check(d.phases[0].ranged === false && d.phases[1].ranged === true, 'ranged attacks do not arrive with a phase');
    check(d.phases[1].spawnsAdds === true && d.phases[2].spawnsAdds === false,
      'the swarm phase is not the only one that swarms');
    check(d.phases[2].speed > d.phases[0].speed, 'the last phase is not faster than the first');
    // it is the finale, so it must outweigh the sector bosses
    check(d.hp > A.ENEMY_BY_ID.queen.hp, 'the finale is weaker than a sector boss');
  }

  /* ------------------------------------------------- the first phase at spawn */
  {
    const game = fixture();
    const e = overmind(game);
    check(!!e, 'the Overmind could not be spawned');
    check(e.bossPhase === 0, 'a fresh boss did not start in its first phase');
    check(e.def.ranged === false, 'the first phase arrived with ranged attacks');
    check(e.def.special === 'seismic', 'the first phase has the wrong attack');
    check(e.shield === 0, 'a fresh boss started shielded');
    check(e.def !== A.ENEMY_BY_ID.overmind, 'a phased boss shares the table it rewrites');
    // an unphased enemy has no reason to pay for a copy
    const grunt = game.enemies.spawn('grunt', 3, 3, { hp: 1, dmg: 1, speed: 1 });
    check(grunt.def === A.ENEMY_BY_ID.grunt, 'an ordinary alien was given its own type copy');
  }

  /* ------------------------------------------------------------ thresholds */
  {
    const game = fixture();
    const e = overmind(game);
    const at = (fraction) => { e.hp = e.maxHp * fraction; return A.nextBossPhase(e); };
    check(at(1) === -1, 'a boss at full health wanted to change phase');
    check(at(0.7) === -1, 'the second phase began early');
    check(at(0.66) === 1, 'the second phase did not begin at its threshold');
    check(at(0.5) === 1, 'the second phase was skipped below its threshold');
    // crossing does not happen twice: advancing is what moves the marker
    game.enemies.advancePhase(e);
    check(e.bossPhase === 1, 'advancing did not move to the second phase');
    check(A.nextBossPhase(e) === -1, 'a reforming boss advanced again');
    e.shield = 0;
    check(at(0.4) === -1, 'the third phase began early');
    check(at(0.33) === 2, 'the third phase did not begin at its threshold');
    game.enemies.advancePhase(e);
    e.shield = 0;
    check(at(0.01) === -1, 'the boss advanced past its last phase');
    check(e.bossPhase === 2, 'the boss is not in its last phase');
    check(game.enemies.advancePhase(e) === null, 'advancing past the last phase produced a phase');
  }

  /* ------------------------------------- one hit across two thresholds */
  {
    /* A railgun slug through a nearly dead boss can cross both thresholds in one
       tick. It must still be two beats: the shield holds the second one until
       the first has been played. */
    const game = fixture();
    const e = overmind(game);
    e.hp = e.maxHp * 0.2;
    check(A.nextBossPhase(e) === 1, 'the first transition was not the one taken');
    game.enemies.advancePhase(e);
    check(e.bossPhase === 1 && e.shield > 0, 'the transition did not put up a shield');
    check(A.nextBossPhase(e) === -1, 'both phases were consumed at once');
    e.shield = 0;
    check(A.nextBossPhase(e) === 2, 'the second transition never became available');
    check(game.phaseCalls.length === 1, 'the arena changed more than once for one hit');
  }

  /* --------------------------------------------------------- the shield */
  {
    const game = fixture();
    const e = overmind(game);
    game.enemies.advancePhase(e);
    const before = e.hp;
    check(e.shield > 0, 'advancing did not shield the boss');
    check(game.enemies.damage(e, 5000, 0, 1, 0, 0) === false, 'a shielded boss was killed');
    check(e.hp === before, 'a shielded boss lost health');
    check(e.flash > 0, 'a shot absorbed by the shield did not show');
    e.burn = 0;
    game.enemies.damage(e, 100, 0, 1, 0, 30);
    check(e.burn === 0, 'the shield let fire through');
    e.shield = 0;
    game.enemies.damage(e, 100, 0, 1, 0, 0);
    check(e.hp === before - 100, 'the boss stayed immune after reforming');
    check(game.phaseCalls.length === 1 && game.phaseCalls[0].phase === 1,
      'the arena change did not report the phase it entered');
  }

  /* ----------------------------------------------- what a phase rewrites */
  {
    const game = fixture();
    const e = overmind(game);
    const jitter = e.speedScale;
    check(jitter > 0, 'the spawn jitter was not kept');
    game.enemies.advancePhase(e);
    check(e.def.ranged === true, 'the second phase did not gain ranged attacks');
    check(e.def.spawnsAdds === true, 'the second phase does not call reinforcements');
    check(e.speedScale === jitter, 'a phase change erased the spawn jitter');
    check(Math.abs(e.speed - e.def.speed * jitter) < 1e-9, 'the phase speed ignored the jitter');
    check(e.addTimer > 0 && e.addTimer <= e.shield + 2, 'the swarm phase waits too long to swarm');
    game.enemies.advancePhase(e);
    check(e.def.spawnsAdds === false, 'the last phase still calls reinforcements');
    check(e.def.specialCooldown < A.ENEMY_BY_ID.overmind.phases[0].specialCooldown,
      'the last phase does not attack more often');

    /* The one that would poison the whole session: phase overrides must land on
       the copy, never on the shared table. */
    const table = A.ENEMY_BY_ID.overmind;
    check(table.ranged === false, 'the shared type was left with ranged attacks on');
    check(table.spawnsAdds === false, 'the shared type was left spawning adds');
    check(table.special === 'seismic', 'the shared type kept a later phase attack');
    check(table.speed === table.phases[0].speed, 'the shared type kept a later phase speed');
    check(table.scale === 1, 'the shared type kept a later phase scale');
    // and a boss spawned afterwards starts from the beginning again
    const fresh = overmind(fixture());
    check(fresh.bossPhase === 0 && fresh.def.ranged === false,
      'the next Overmind inherited the previous fight');
  }

  /* ------------------------------------------------- enrage stays away */
  {
    // the generic 45% enrage would stack on top of phase three; phases are the
    // escalation for a boss that has them
    const game = fixture();
    const e = overmind(game);
    check(A.ENEMY_BY_ID.overmind.phases.length > 1, 'the finale has no phases to replace enrage');
    check(e.enraged === false, 'a fresh boss was already enraged');
    check(!A.ENEMY_BY_ID.queen.phases, 'the Hive Queen grew phases and still relies on enrage');
  }

  /* ---------------------------------------------------- the hazard field */
  {
    const game = fixture();
    const hz = new A.Hazards(game);
    const player = { x: 0, z: 0, alive: true };
    check(hz.count === 0, 'a fresh hazard field was not empty');
    check(hz.spawn(0, 0, -1, 5, 10) === -1, 'a hazard with no radius was accepted');
    check(hz.spawn(0, 0, 3, -1, 10) === -1, 'a hazard with no life was accepted');
    check(hz.spawn(NaN, 0, 3, 5, 10) === -1, 'a hazard at no position was accepted');
    check(hz.count === 0, 'a rejected hazard was still stored');

    hz.spawn(0, 0, 3, 8, 12);
    check(hz.count === 1, 'a hazard was not stored');

    /* Arming: an eruption under the player has to be survivable. Nothing lands
       until the warning has been on screen. */
    let elapsed = 0;
    while (elapsed < A.HAZARD_WARM - 0.05) { hz.update(1 / 60, player); elapsed += 1 / 60; }
    check(game.hurt.length === 0, 'a hazard bit before it finished arming');
    check(hz.dangerAt(0, 0) === false, 'an arming hazard already counted as dangerous');
    // arming is the grace period, so the first bite lands the moment it ends
    while (elapsed < A.HAZARD_WARM + 0.05) { hz.update(1 / 60, player); elapsed += 1 / 60; }
    check(game.hurt.length === 1, 'an armed hazard did not bite once: ' + game.hurt.length);
    check(game.hurt[0].amount === 12, 'the hazard bit for the wrong amount');
    check(hz.dangerAt(0, 0) === true, 'an armed hazard did not report as dangerous');
    check(hz.dangerAt(9, 9) === false, 'a hazard reached outside its radius');

    // standing outside costs nothing
    const bites = game.hurt.length;
    player.x = 6;
    for (let i = 0; i < 120; i++) hz.update(1 / 60, player);
    check(game.hurt.length === bites, 'a hazard hit a player standing outside it');

    // and it closes rather than lasting forever
    for (let i = 0; i < 600; i++) hz.update(1 / 60, player);
    check(hz.count === 0, 'a hazard outlived its life');
  }

  /* ----------------------------------------- damage does not follow the frame rate */
  {
    /* The property that matters: a hazard bites on its own clock. Counted per
       frame instead, the same three seconds would cost 180 hits at 60 Hz and
       432 at 144 Hz. */
    const run = (step) => {
      const game = fixture();
      const hz = new A.Hazards(game);
      const player = { x: 0, z: 0, alive: true };
      hz.spawn(0, 0, 3, 30, 5);
      const steps = Math.round(4 / step);
      for (let i = 0; i < steps; i++) hz.update(step, player);
      return game.hurt.length;
    };
    const slow = run(1 / 30), normal = run(1 / 60), fast = run(1 / 144);
    check(Math.abs(slow - normal) <= 1 && Math.abs(fast - normal) <= 1,
      'hazard damage follows the frame rate: ' + slow + ' / ' + normal + ' / ' + fast);
    // one bite when arming ends, then one every tick until the closing window
    const expected = Math.floor((4 - A.HAZARD_WARM) / A.HAZARD_TICK) + 1;
    check(Math.abs(normal - expected) <= 1, 'a hazard bit ' + normal + ' times instead of about ' + expected);
  }

  /* ----------------------------------------------- the fade and the ring */
  {
    const game = fixture();
    const hz = new A.Hazards(game);
    const player = { x: 0, z: 0, alive: true };
    // a closing hazard stops biting before it disappears, so its last visible
    // moment is never the one that kills
    // a vent whose whole armed life is the closing window never bites at all
    hz.spawn(0, 0, 3, A.HAZARD_WARM + A.HAZARD_FADE, 7);
    for (let i = 0; i < 400; i++) hz.update(1 / 60, player);
    check(game.hurt.length === 0, 'a hazard bit during the seconds it was closing');
    // and the guard is not simply refusing to ever bite
    hz.spawn(0, 0, 3, A.HAZARD_WARM + A.HAZARD_FADE + 1.2, 7);
    for (let i = 0; i < 400; i++) hz.update(1 / 60, player);
    check(game.hurt.length > 0, 'a hazard with room to bite never did');

    const ring = hz.ring(0, 0, 7, 6, 2.5, 10, 9, 0xff0000, 0.3);
    check(ring.length === 6, 'the ring did not erupt every vent');
    check(hz.count === 6, 'the ring stored the wrong number of hazards');
    // the caller decides where a vent may open; the field knows nothing of walls
    hz.clear();
    const filtered = hz.ring(0, 0, 7, 6, 2.5, 10, 9, 0xff0000, 0, (x) => x > 0);
    check(filtered.length > 0 && filtered.length < 6, 'the ring ignored the filter it was given');
    // the same turn produces the same ring, so a seeded fight erupts the same way
    hz.clear(); hz.ring(0, 0, 7, 4, 2.5, 10, 9, 0xff0000, 1.25);
    const first = Array.from(hz.px.slice(0, 4));
    hz.clear(); hz.ring(0, 0, 7, 4, 2.5, 10, 9, 0xff0000, 1.25);
    const again = Array.from(hz.px.slice(0, 4));
    check(first.every((v, i) => Math.abs(v - again[i]) < 1e-12), 'the same ring erupted differently');
    hz.clear();
    check(hz.count === 0, 'clearing left hazards behind');
  }

  /* ---------------------------------------------------------- capacity */
  {
    const game = fixture();
    const hz = new A.Hazards(game);
    for (let i = 0; i < A.HAZARD_CAP + 12; i++) hz.spawn(i, 0, 2, 5 + i * 0.1, 3);
    check(hz.count === A.HAZARD_CAP, 'the hazard field grew past its capacity');
    // the newest eruption survives: recycling takes whatever was closest to closing
    let newest = false;
    for (let i = 0; i < hz.count; i++) if (Math.abs(hz.px[i] - (A.HAZARD_CAP + 11)) < 1e-9) newest = true;
    check(newest, 'a fresh eruption was dropped in favour of an old one');
  }

  /* ------------------------------------------------------ acid on death */
  {
    const game = fixture();
    game.hazards = new A.Hazards(game);
    const pool = A.ENEMY_BY_ID.spitter.acidPool;
    check(!!pool, 'the spitter has no acid to leave');
    const spitter = game.enemies.spawn('spitter', 5, 7, { hp: 1, dmg: 1, speed: 1 });
    const rngBefore = game.rng.getState();
    game.enemies.kill(spitter, 0, 1, 10);
    check(game.hazards.count === 1, 'a spitter left no acid behind');
    check(Math.abs(game.hazards.px[0] - 5) < 1e-9 && Math.abs(game.hazards.pz[0] - 7) < 1e-9,
      'the pool did not land where the spitter died');
    check(Math.abs(game.hazards.radius[0] - pool.radius) < 1e-9, 'the pool has the wrong radius');
    // the pool is placed, not rolled: a seeded fight must stay reproducible
    check(game.rng.getState() === rngBefore, 'a death pool drew from the run RNG');

    /* Whoever killed it is standing on the body. The hazard's arming window is
       what makes that survivable, and this is the case it exists for. */
    const player = { x: 5, z: 7, alive: true };
    for (let i = 0; i < Math.round(A.HAZARD_WARM * 60) - 2; i++) game.hazards.update(1 / 60, player);
    check(game.hurt.length === 0, 'the acid burned its killer before they could step off');
    // a few ticks past the window it bites, so the guard is a delay, not a veto
    for (let i = 0; i < 6; i++) game.hazards.update(1 / 60, player);
    check(game.hurt.length === 1, 'the acid never burned anyone at all');

    // an enemy without acid blood leaves nothing
    const crawler = game.enemies.spawn('crawler', 1, 1, { hp: 1, dmg: 1, speed: 1 });
    check(!A.ENEMY_BY_ID.crawler.acidPool, 'the crawler grew acid blood');
    game.enemies.kill(crawler, 0, 1, 10);
    check(game.hazards.count === 1, 'an enemy without acid blood still left a pool');
    // and the things made of acid leave more of it than a spitter does
    for (const id of ['queen', 'overmind']) {
      check(A.ENEMY_BY_ID[id].acidPool.radius > pool.radius, id + ' leaves no more acid than a spitter');
    }
    // a pool must not outlast the wave it was spilled in
    check(pool.life < 15, 'a spitter pool lasts ' + pool.life + ' seconds');
  }

  console.log('BOSS_OK: ' + checks + ' assertions; three phases with their own type copy, ' +
    'shielded transitions, a hazard field on a fixed tick, and acid left where acid-blooded aliens die');
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
