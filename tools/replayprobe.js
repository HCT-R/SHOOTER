/* Runs against the real browser Game, injected by smoketest.js. */
function replayProbe(g, A) {
  const require = (condition, message) => { if (!condition) throw new Error('Replay: ' + message); };
  const fields = (object, names) => names.map(name => object[name]);
  const snapshot = () => JSON.stringify({
    seed: g.runSeed, map: g.level.seed, sector: g.sectorIndex,
    rng: g.rng.getState(), tick: g.tick, time: g.time, state: g.state,
    wave: g.wave, waveState: g.waveState, queue: g.spawnQueue, spawnTimer: g.spawnTimer,
    prep: g.prepTimer, money: g.money, score: g.score, stats: g.stats,
    aim: g.aim.toArray(), cameraTarget: g._camSmooth.toArray(),
    player: fields(g.player, ['x','z','vx','vz','kx','kz','angle','hp','armor','weaponIndex',
      'fireTimer','reloading','reloadTotal','spin','recoil','walkPhase','dashCd','grenadeCd','grenade','ammo','mags','owned',
      'triggerLatched','dashTimer','dashX','dashZ','flameTick','invuln','bloom','spreadScale','aiming','lastDamageTime']),
    enemies: g.enemies.list.map(e => fields(e, ['id','type','x','y','z','angle','hp','speed',
      'state','cd','rangedCd','specialCd','phase','burn','burnDps','kx','kz','vx','vz',
      'timer','windupTotal','attackX','attackZ','specialKind','addTimer','enraged','dying'])),
    rockets: g.projectiles.rockets.map(r => fields(r, ['x','y','z','vx','vz','angle','life'])),
    acid: g.projectiles.acid.map(a => fields(a, ['x','y','z','vx','vy','vz','life','damage'])),
    pickups: g.pickups.items.map(i => fields(i, ['kind','payload','x','z','taken'])),
    barrels: g.props.barrels.map(b => fields(b, ['x','z','alive','hp','pending'])),
    events: g.events.map(e => [e.dueTick, e.barrel.x, e.barrel.z])
  });
  const previousMotion = g.motionScale;
  const schedules = [[1/30], [1/60], [1/144], [0.004, 0.029, 0.011, 0.018]];
  const checkpoints = [];
  for (let run = 0; run < schedules.length; run++) {
    g.startRun(0x51ced123);
    g.motionScale = run % 2; // shake must never change aiming or shot results
    g.player.invuln = 1e6;
    const clock = new A.FixedStepClock();
    let command = 0, frame = 0, pausedTick = -1;
    const states = [];
    while (command < 540) {
      const result = clock.advance(schedules[run][frame++ % schedules[run].length], dt => {
        const t = command++, input = g.input;
        input.keys.KeyW = t % 100 < 35; input.keys.KeyD = t % 150 < 55;
        input.mouseDown = t % 9 !== 0;
        input.rightDown = t % 80 < 40;
        input.mx = Math.sin(t / 50) * 0.55; input.my = Math.cos(t / 65) * 0.35;
        if (t === 1) input.pressed.KeyN = true;
        if (t === 20) g.spawnEnemyAt('queen', g.player.x + 9, g.player.z + 3);
        if (t === 45) input.pressed.KeyG = true;
        if (t === 60 || t === 180 || t === 300) {
          g.player.giveWeapon(t === 60 ? 'shotgun' : t === 180 ? 'rocket' : 'railgun');
          g.player.giveAmmo(g.player.weapon.ammo, 100);
        }
        if (t === 110 && g.props.barrels.length) {
          const barrel = g.props.barrels.find(b => b.alive);
          if (barrel) g.explosion(barrel.x, 1, barrel.z, 1, 2, false);
          require(g.events.length > 0, 'barrel chain was not scheduled');
        }
        if (t === 111) { g.state = 'pause'; pausedTick = g.tick; }
        if (t > 111 && t < 130) require(g.tick === pausedTick, 'pause advanced combat');
        if (t === 130) g.state = 'play';
        if (t === 400) { g.endWave(); g.sectorPending = true; }
        if (t === 420) {
          g.beginWave();
          require(g.events.length === 0, 'sector carried stale barrel events');
        }
        g.update(dt);
        if (command % 60 === 0) states.push(snapshot());
        return command < 540;
      });
      // Different render counts exercise temporary interpolation transforms.
      if (frame === 15 || frame === 30) {
        const before = snapshot(), muzzle = g.player.muzzleWorld(new A.THREE.Vector3());
        const muzzleBefore = [muzzle.x, muzzle.y, muzzle.z];
        g.render(result.alpha);
        require(snapshot() === before, 'render mutated authoritative state');
        const after = g.player.muzzleWorld(new A.THREE.Vector3());
        require(muzzleBefore.every((v, i) => Math.abs(v - [after.x, after.y, after.z][i]) < 1e-9),
          'interpolation changed muzzle origin');
      }
    }
    checkpoints.push(states);
  }
  for (let run = 1; run < checkpoints.length; run++) {
    for (let i = 0; i < checkpoints[0].length; i++) {
      if (checkpoints[run][i] !== checkpoints[0][i]) {
        const expected = JSON.parse(checkpoints[0][i]), actual = JSON.parse(checkpoints[run][i]);
        const different = Object.keys(expected).filter(k => JSON.stringify(expected[k]) !== JSON.stringify(actual[k]));
        throw new Error('Replay differs: schedule ' + run + ', command ' + ((i + 1) * 60) + ', fields=' + different.join(','));
      }
    }
  }
  g.motionScale = previousMotion;
  g.startRun();
  return '30/60/144Hz+irregular; 540 tick commands x4; shake isolation; pause/barrels/sector; render/muzzle isolation';
}
module.exports = { replayProbe };
