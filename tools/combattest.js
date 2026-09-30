/* CPU-only combat fixtures against the production controllers and Three.js.
   Run: node tools/combattest.js. No browser, renderer or audio device needed. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

async function main() {
  const workspace = path.resolve(__dirname, '..');
  const THREE = await import('data:text/javascript;base64,' +
    fs.readFileSync(path.join(workspace, 'vendor', 'three.module.js')).toString('base64'));
  const noop = () => {};
  // a gamepad is only a snapshot object, so the pad half of the control
  // layer runs here without hardware
  let pads = [];
  const cosmeticMath = Object.create(Math);
  const context = {
    THREE, Math: cosmeticMath, console, performance, TEX: { glow: null },
    document: { body: { classList: { contains: () => true } } },
    navigator: { getGamepads: () => pads },
    window: { addEventListener: noop, localStorage: { getItem: () => null, setItem: noop } },
    sfx: new Proxy({}, { get: () => noop })
  };
  vm.createContext(context);
  for (const file of ['00-util.js', '05-save.js', '15-simulation.js', '40-models.js', '45-customize.js',
    '60-weapons.js', '70-enemies.js', '80-player.js', '85-world.js', '91-damagenumbers.js',
    '92-upgrades.js']) {
    new vm.Script(fs.readFileSync(path.join(workspace, 'src', file), 'utf8'), { filename: file }).runInContext(context);
  }
  const A = vm.runInContext('({ Player, InputState, Props, Pickups, Projectiles, EnemyManager, WEAPONS, WEAPON_BY_ID, ' +
    'makeRng, initPrimitives, buildWeaponGeometries, buildPickupGeometries, HitStop, HIT_STOP, SIM_DT, ' +
    'PERKS, PERK_BY_ID, PAD_DEADZONE, DamageNumbers, DAMAGE_NUMBER_CAP, DAMAGE_NUMBER_LIFE, ' +
    'DAMAGE_NUMBER_MERGE })', context);
  A.initPrimitives(); A.buildWeaponGeometries(); A.buildPickupGeometries();
  let cases = 0;
  function test(name, run) {
    try { run(); cases++; } catch (error) { error.message = name + ': ' + error.message; throw error; }
  }
  function near(actual, expected, message) { assert(Math.abs(actual - expected) < 1e-6, message || `${actual} != ${expected}`); }
  function fixture() {
    const fx = {};
    for (const key of ['lights', 'sparks', 'smoke', 'gibs', 'tracers', 'decals']) {
      fx[key] = { flash: noop, burst: noop, emit: noop, add: noop, blood: noop };
    }
    const game = {
      scene: new THREE.Scene(), rng: A.makeRng(24681357), fx,
      level: { start: { x: 0, z: 0 }, raycastWall: () => null,
        isWallAt: () => false, lineOfSight: () => true, resolveCircle: noop,
        setObstacles: (solids) => { game.obstacleNotifications++; game.obstacles = solids; } },
      stats: { shots: 0, hits: 0 }, money: 0, score: 0, time: 0,
      hud: { popup: noop }, shake: noop, obstacleNotifications: 0,
      confirmations: [], explosions: [], weaponHits: [], hitStop: new A.HitStop(),
      motionScale: 1,
      onHitConfirm: (killed) => game.confirmations.push(killed),
      onWeaponHit: (e, killed, crit, w, amount) => {
        game.weaponHits.push({ killed, crit, weapon: w && w.id, amount });
        game.damageNumbers.addFor(e, amount, crit);
        let seconds = 0;
        if (killed) seconds = e.def.boss ? A.HIT_STOP.boss : e.def.mass >= 3 ? A.HIT_STOP.heavy : crit ? A.HIT_STOP.crit : 0;
        else if (w && w.fire === 'rail') seconds = A.HIT_STOP.rail;
        game.hitStop.freeze(seconds * game.motionScale);
      },
      explosion: (...args) => { game.explosions.push(args); return 0; }
    };
    game.props = Object.assign(Object.create(A.Props.prototype), {
      game, solids: [], barrels: [], refreshBarrels: noop
    });
    game.enemies = Object.assign(Object.create(A.EnemyManager.prototype), {
      game, list: [], kill: (enemy) => { enemy.state = 3; game.kills = (game.kills || 0) + 1; }
    });
    game.player = new A.Player(game);
    // damage fixtures assert exact numbers, so crits stay off unless a test
    // opts in; a zero chance also never draws from the run RNG
    game.player.critScale = 0;
    // no host element: the readout is a list of numbers plus a DOM pool, and
    // only the list is worth asserting on
    game.damageNumbers = new A.DamageNumbers(null);
    game.projectiles = new A.Projectiles(game);
    game.spawnRocket = (...args) => game.projectiles.spawnRocket(...args);
    return game;
  }
  // a real spawn() hands out unique ids, and anything keyed by enemy relies
  // on that, so the fixture has to as well
  let enemySeq = 0;
  function enemy(game, x, z, radius = 0.5, hp = 1000) {
    const result = { id: ++enemySeq, x, z, y: 0, hp, maxHp: hp, state: 0, kx: 0, kz: 0, burn: 0, burnDps: 0,
      def: { radius, mass: 1, blood: 0xff0000 } };
    game.enemies.list.push(result);
    return result;
  }
  function barrel(game, x, z, hp = 1000) {
    const result = { x, z, hp, alive: true, rot: 0 };
    game.props.barrels.push(result);
    game.props.solids.push({ x, z, r: 0.5, barrel: result });
    return result;
  }
  function equip(game, id) {
    game.player.giveWeapon(id);
    game.player.setWeapon(A.WEAPONS.findIndex((weapon) => weapon.id === id));
    game.player.fireTimer = 0;
    game.player.reloading = 0;
    return game.player.weapon;
  }
  function input() {
    const dom = { addEventListener: noop, getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 }) };
    return new A.InputState(dom);
  }
  function tick(game, controls) {
    game.player.update(1 / 60, controls, 0, 30);
    controls.endFrame();
  }
  const origin = new THREE.Vector3(0, 1, 0);
  const mouseEvent = { button: 0, target: { tagName: 'CANVAS' } };

  test('complete mouse click is retained for exactly one simulation tick', () => {
    const game = fixture(), controls = input();
    controls._onDown(mouseEvent); controls._onUp(mouseEvent);
    assert(!controls.mouseDown && controls.mousePressed);
    tick(game, controls);
    assert.strictEqual(game.stats.shots, 1);
    assert(!controls.mousePressed);
    game.player.fireTimer = 0;
    tick(game, controls);
    assert.strictEqual(game.stats.shots, 1);
  });
  test('held semi-auto fires once and a fast second click releases its latch', () => {
    const game = fixture(), controls = input();
    controls._onDown(mouseEvent); tick(game, controls);
    game.player.fireTimer = 0; tick(game, controls);
    assert.strictEqual(game.stats.shots, 1);
    controls._onUp(mouseEvent); controls._onDown(mouseEvent); controls._onUp(mouseEvent);
    tick(game, controls);
    assert.strictEqual(game.stats.shots, 2);
  });
  test('held automatic fire continues after the mouse edge is consumed', () => {
    const game = fixture(), controls = input(); equip(game, 'smg');
    controls._onDown(mouseEvent); tick(game, controls);
    game.player.fireTimer = 0; tick(game, controls);
    assert.strictEqual(game.stats.shots, 2);
  });
  test('blur, editable focus and clear discard mouse and keyboard latches', () => {
    const controls = input();
    for (const clear of [() => controls.clear(), () => controls._onBlur(),
      () => controls._onFocus({ target: { tagName: 'INPUT' } })]) {
      controls._onDown(mouseEvent);
      controls._onKeyDown({ code: 'KeyW', target: { tagName: 'CANVAS' }, preventDefault: noop });
      clear();
      assert(!controls.mouseDown && !controls.mousePressed && !controls.down('KeyW') && !controls.once('KeyW'));
    }
    controls._onDown({ button: 0, target: { tagName: 'TEXTAREA' } });
    assert(!controls.mousePressed && !controls.mouseDown);
  });
  test('buffered click interrupts individual shotgun shell loading', () => {
    const game = fixture(), controls = input(); equip(game, 'shotgun');
    game.player.reloading = 1;
    controls._onDown(mouseEvent); controls._onUp(mouseEvent); tick(game, controls);
    assert.strictEqual(game.stats.shots, 1);
    assert.strictEqual(game.player.reloading, 0);
  });

  test('prop ray chooses entry distance rather than center order', () => {
    const game = fixture();
    const small = { x: 0, z: 5, r: 0.3 }, large = { x: 0, z: 6, r: 2 };
    game.props.solids = [small, large];
    const hit = game.props.raycast(0, 0, 0, 4, 10);
    assert.strictEqual(hit.solid, large); near(hit.dist, 4); near(hit.z, 4);
  });
  test('prop ray handles tangents, origin overlap, misses and finite segments', () => {
    const game = fixture(); game.props.solids = [{ x: 1, z: 5, r: 1 }];
    near(game.props.raycast(0, 0, 0, 1, 5).dist, 5);
    assert.strictEqual(game.props.raycast(0, 0, 0, 1, 4.99), null);
    assert.strictEqual(game.props.raycast(0, 0, 0, -1, 10), null);
    assert.strictEqual(game.props.raycast(0, 0, 0, 0, 10), null);
    near(game.props.raycast(1, 5, 0, 1, 0).dist, 0);
  });
  test('destroyed barrels stop blocking and notify obstacle navigation once', () => {
    const game = fixture(), target = barrel(game, 0, 4, 20);
    assert.strictEqual(game.props.raycast(0, 0, 0, 1, 10).barrel, target);
    assert(game.props.damageBarrel(target, 20));
    assert.strictEqual(game.props.raycast(0, 0, 0, 1, 10), null);
    assert.strictEqual(game.obstacleNotifications, 1);
    assert.strictEqual(game.obstacles, game.props.solids);
    assert.strictEqual(game.explosions.length, 1);
    assert(!game.props.damageBarrel(target, 20)); game.props.explodeBarrel(target);
    assert.strictEqual(game.obstacleNotifications, 1);
  });
  test('enemy ray uses exact body entry and excludes out-of-segment enemies', () => {
    const game = fixture();
    const small = enemy(game, 0, 5, 0.3), large = enemy(game, 0, 6, 2);
    let hit = game.enemies.raycast(0, 0, 0, 10, 0, null);
    assert.strictEqual(hit.enemy, large); near(hit.t, 0.4);
    hit = game.enemies.raycast(0, 0, 0, 10, 0, new Set([large]));
    assert.strictEqual(hit.enemy, small); near(hit.t, 0.47);
    assert.strictEqual(game.enemies.raycast(0, 0, 0, 3.99, 0, null), null);
    near(game.enemies.raycast(0, 6, 0, 10, 0, null).t, 0);
    game.enemies.list = []; enemy(game, 0, -0.8, 0.5); enemy(game, 0, 10.8, 0.5);
    assert.strictEqual(game.enemies.raycast(0, 0, 0, 10, 0, null), null);
  });

  for (const [id, method] of [['pistol', 'hitscan'], ['railgun', 'railShot'], ['plasma', 'arcShot'], ['flamer', 'flameTick_']]) {
    test(id + ' is blocked by solid props', () => {
      const game = fixture(), target = enemy(game, 0, 7);
      game.props.solids.push({ x: 0, z: 4, r: 1 });
      game.player[method](origin, 0, A.WEAPON_BY_ID[id]);
      assert.strictEqual(target.hp, 1000); assert.strictEqual(game.stats.hits, 0);
    });
    test(id + ' damages the impacted barrel and cannot hit an enemy behind it', () => {
      const game = fixture(), target = enemy(game, 0, 7), cover = barrel(game, 0, 4);
      game.player[method](origin, 0, A.WEAPON_BY_ID[id]);
      assert(cover.hp < 1000); assert.strictEqual(target.hp, 1000);
    });
  }
  test('hitscan preserves piercing before cover, then damages its barrel once', () => {
    const game = fixture(), first = enemy(game, 0, 2), behind = enemy(game, 0, 8), cover = barrel(game, 0, 5);
    game.player.hitscan(origin, 0, A.WEAPON_BY_ID.rifle);
    near(first.hp, 1000 - A.WEAPON_BY_ID.rifle.damage);
    near(cover.hp, 1000 - A.WEAPON_BY_ID.rifle.damage);
    assert.strictEqual(behind.hp, 1000); assert.strictEqual(game.stats.hits, 1);
  });
  test('nonpiercing hitscan does not damage a barrel behind its enemy', () => {
    const game = fixture(); enemy(game, 0, 2); const cover = barrel(game, 0, 5);
    game.player.hitscan(origin, 0, A.WEAPON_BY_ID.pistol);
    assert.strictEqual(cover.hp, 1000);
  });
  test('nearer wall wins over a prop for every direct-fire weapon', () => {
    const game = fixture(), cover = barrel(game, 0, 5), target = enemy(game, 0, 7);
    game.level.raycastWall = () => ({ x: 0, z: 2, dist: 2 });
    for (const [id, method] of [['pistol', 'hitscan'], ['railgun', 'railShot'], ['plasma', 'arcShot'], ['flamer', 'flameTick_']]) {
      game.player[method](origin, 0, A.WEAPON_BY_ID[id]);
    }
    assert.strictEqual(cover.hp, 1000); assert.strictEqual(target.hp, 1000);
  });
  test('arc cannot chain through a prop to a second target', () => {
    const game = fixture(), primary = enemy(game, 0, 3), secondary = enemy(game, 3, 3);
    game.props.solids.push({ x: 1.5, z: 3, r: 0.6 });
    game.player.arcShot(origin, 0, A.WEAPON_BY_ID.plasma);
    assert(primary.hp < 1000); assert.strictEqual(secondary.hp, 1000);
  });
  test('long muzzle is clamped before intervening prop cover', () => {
    const game = fixture(); equip(game, 'railgun');
    const raw = game.player.muzzleWorld(new THREE.Vector3()).clone();
    const distance = Math.hypot(raw.x, raw.z);
    game.props.solids.push({ x: raw.x * 0.6, z: raw.z * 0.6, r: 0.2 });
    const clipped = game.player.muzzleWorld(new THREE.Vector3());
    assert(Math.hypot(clipped.x, clipped.z) < distance * 0.6 - 0.2);
  });

  for (const id of ['rocket', 'autocannon']) {
    test(id + ' applies direct damage before splash and confirms only once', () => {
      const game = fixture(), target = enemy(game, 0, 4);
      const weapon = A.WEAPON_BY_ID[id]; let confirmed = 0;
      game.explosion = (x, y, z, damage, radius) => {
        near(target.hp, 1000 - weapon.damage, 'direct damage missing before radial explosion');
        near(damage, weapon.splash); near(radius, weapon.splashRadius);
        assert(z < target.z); assert.strictEqual(game.confirmations.length, 1);
        game.enemies.damage(target, damage, 0, 1, 0, 0);
        return 1;
      };
      game.projectiles.spawnRocket(0, 1, 0, 0, { ...weapon, onHit: () => confirmed++ });
      game.projectiles.update(0.2, game.player);
      near(target.hp, 1000 - weapon.damage - weapon.splash);
      assert.strictEqual(confirmed, 1); assert.strictEqual(game.projectiles.rockets.length, 0);
      game.projectiles.update(0.2, game.player); assert.strictEqual(confirmed, 1);
    });
    test(id + ' confirms a lethal direct hit even when splash finds no survivor', () => {
      const game = fixture(), target = enemy(game, 0, 3, 0.5, 1); let confirmed = 0;
      game.projectiles.spawnRocket(0, 1, 0, 0, { ...A.WEAPON_BY_ID[id], onHit: () => confirmed++ });
      game.projectiles.update(0.2, game.player);
      assert.strictEqual(target.state, 3); assert.strictEqual(game.kills, 1);
      assert.strictEqual(confirmed, 1); assert.strictEqual(game.confirmations[0], true);
    });
    test(id + ' stops at nearest prop before an enemy', () => {
      const game = fixture(), target = enemy(game, 0, 5), cover = barrel(game, 0, 2);
      game.projectiles.spawnRocket(0, 1, 0, 0, A.WEAPON_BY_ID[id]);
      game.projectiles.update(0.2, game.player);
      near(cover.hp, 1000 - A.WEAPON_BY_ID[id].damage);
      assert.strictEqual(target.hp, 1000); assert.strictEqual(game.explosions.length, 1);
      near(game.explosions[0][2], 1.44);
    });
    test(id + ' stops at wall before prop and enemy', () => {
      const game = fixture(), target = enemy(game, 0, 5), cover = barrel(game, 0, 3);
      game.level.raycastWall = () => ({ x: 0, z: 1, dist: 1 });
      game.projectiles.spawnRocket(0, 1, 0, 0, A.WEAPON_BY_ID[id]);
      game.projectiles.update(0.2, game.player);
      assert.strictEqual(cover.hp, 1000); assert.strictEqual(target.hp, 1000);
      near(game.explosions[0][2], 0.94);
    });
    test(id + ' strikes an enemy before the farther prop', () => {
      const game = fixture(), target = enemy(game, 0, 2), cover = barrel(game, 0, 5);
      game.projectiles.spawnRocket(0, 1, 0, 0, A.WEAPON_BY_ID[id]);
      game.projectiles.update(0.2, game.player);
      near(target.hp, 1000 - A.WEAPON_BY_ID[id].damage); assert.strictEqual(cover.hp, 1000);
    });
  }
  test('projectile render interpolation does not mutate simulation positions', () => {
    const game = fixture(), projectiles = game.projectiles;
    projectiles.spawnRocket(10, 1, 10, 0, A.WEAPON_BY_ID.rocket);
    projectiles.spawnAcid({ x: 20, y: 0, z: 20, damage: 5,
      def: { radius: 0.5, projSpeed: 10, damage: 5 } }, 20, 40);
    projectiles.update(1 / 60, game.player);
    const before = JSON.stringify([projectiles.rockets, projectiles.acid]);
    for (const alpha of [0, 0.5, 1]) {
      projectiles.render(alpha);
      for (const [entity, mesh] of [[projectiles.rockets[0], projectiles.rocketMesh], [projectiles.acid[0], projectiles.acidMesh]]) {
        const matrix = new THREE.Matrix4(); mesh.getMatrixAt(0, matrix);
        const position = new THREE.Vector3().setFromMatrixPosition(matrix);
        near(position.z, entity.prevZ + (entity.z - entity.prevZ) * alpha);
      }
    }
    assert.strictEqual(JSON.stringify([projectiles.rockets, projectiles.acid]), before);
  });

  test('same simulation seed gives identical spread despite cosmetic random changes', () => {
    function sequence(cosmetic) {
      cosmeticMath.random = () => cosmetic;
      const game = fixture(), angles = [];
      game.player.hitscan = (o, angle) => angles.push(angle);
      game.player.railShot = game.player.arcShot = game.player.hitscan;
      game.spawnRocket = (x, y, z, angle) => angles.push(angle);
      for (const weapon of A.WEAPONS) {
        if (weapon.fire === 'flame') continue;
        equip(game, weapon.id); game.player.shoot(0, 30);
      }
      return { angles, state: game.rng.getState() };
    }
    assert.deepStrictEqual(sequence(0.01), sequence(0.99));
    delete cosmeticMath.random;
  });
  test('pickup sweep applies eligible rewards exactly once in spawn order', () => {
    const game = fixture(), pickups = new A.Pickups(game);
    game.player.hp = 40;
    pickups.spawn('money', 50, 50, 70); pickups.spawn('health', 50, 50);
    pickups.spawn('weapon', 50, 50, 'rifle'); pickups.spawn('ammo', 50, 50, 'rifle');
    const money = pickups.items[0];
    assert.strictEqual(pickups.collectAll(), 4);
    assert.strictEqual(game.money, 70); assert.strictEqual(game.score, 70); assert.strictEqual(game.player.hp, 65);
    assert(game.player.owned.rifle); assert.strictEqual(game.player.ammo.rifle, 225);
    assert.strictEqual(pickups.items.length, 0); assert.strictEqual(pickups.group.children.length, 0);
    assert.strictEqual(pickups.collectAll(), 0); assert(!pickups.collect(money, game.player));
    assert.strictEqual(game.money, 70);
  });
  test('pickup sweep retains capped rewards and does nothing for a dead player', () => {
    const game = fixture(), pickups = new A.Pickups(game);
    pickups.spawn('health', 50, 50); pickups.spawn('money', 50, 50, 11);
    game.player.alive = false; assert.strictEqual(pickups.collectAll(), 0);
    assert.strictEqual(pickups.items.length, 2);
    game.player.alive = true; assert.strictEqual(pickups.collectAll(), 1);
    assert.strictEqual(pickups.items.length, 1); assert.strictEqual(game.money, 11);
    game.player.hp = 50; assert.strictEqual(pickups.collectAll(), 1);
    assert.strictEqual(game.player.hp, 75); assert.strictEqual(pickups.collectAll(), 0);
  });
  test('already collected items are removed without paying twice or reporting new rewards', () => {
    const game = fixture(), pickups = new A.Pickups(game);
    pickups.spawn('money', 0, 0, 17);
    assert(pickups.collect(pickups.items[0], game.player));
    assert.strictEqual(pickups.collectAll(), 0); assert.strictEqual(game.money, 17);
    assert.strictEqual(pickups.items.length, 0);
    pickups.spawn('money', 0, 0, 9);
    assert(pickups.collect(pickups.items[0], game.player));
    pickups.update(1 / 60, game.player, 0);
    assert.strictEqual(game.money, 26); assert.strictEqual(pickups.items.length, 0);
  });
  /* ---------------------------------------------------- crits + hit stop */
  test('a weapon without a crit chance never draws from the run RNG', () => {
    const game = fixture(), target = enemy(game, 0, 3);
    game.player.critScale = 1;
    const before = game.rng.getState();
    game.player.dealDamage(target, 10, 0, 1, 0, 0, A.WEAPON_BY_ID.rocket);
    assert.strictEqual(game.rng.getState(), before, 'splash weapon consumed a roll');
    near(target.hp, 990);
    assert.strictEqual(game.weaponHits[0].crit, false);
  });
  test('a certain crit multiplies damage and knockback, a certain miss does not', () => {
    for (const [scale, hp, knock] of [[0, 1000 - 34, 2.4], [999, 1000 - 34 * 2, 2.4 * 1.5]]) {
      const game = fixture(), target = enemy(game, 0, 3);
      game.player.critScale = scale;
      game.player.dealDamage(target, A.WEAPON_BY_ID.rifle.damage, 0, 1, A.WEAPON_BY_ID.rifle.knock, 0, A.WEAPON_BY_ID.rifle);
      near(target.hp, hp); near(target.kz, knock);
      assert.strictEqual(game.weaponHits[0].crit, scale > 0);
    }
  });
  test('critPower scales the payoff without touching the frequency', () => {
    const game = fixture(), target = enemy(game, 0, 3);
    game.player.critScale = 999; game.player.critPower = 2;
    game.player.dealDamage(target, 100, 0, 1, 0, 0, A.WEAPON_BY_ID.rifle);
    near(target.hp, 1000 - 100 * 2 * 2);
  });
  test('the same seed rolls the same crits regardless of frame pacing', () => {
    const roll = (seed) => {
      const game = fixture();
      game.rng = A.makeRng(seed);
      game.player.critScale = 1;
      const out = [];
      for (let i = 0; i < 40; i++) {
        const target = enemy(game, 0, 3);
        game.player.dealDamage(target, 10, 0, 1, 0, 0, A.WEAPON_BY_ID.rifle);
        out.push(game.weaponHits[i].crit);
      }
      return out.join('');
    };
    assert.strictEqual(roll(4242), roll(4242), 'crit stream diverged for one seed');
    assert.notStrictEqual(roll(4242), roll(99), 'crit stream ignored the seed');
    assert(roll(4242).includes('true'), 'a 10% chance never fired in 40 rolls');
  });
  test('hit stop freezes on a crit kill, a heavy kill and a rail hit, but not a plain hit', () => {
    const cases = [
      { weapon: 'rifle', mass: 1, kill: false, crit: false, ticks: 0 },
      { weapon: 'rifle', mass: 1, kill: true, crit: false, ticks: 0 },
      { weapon: 'rifle', mass: 1, kill: true, crit: true, ticks: Math.round(A.HIT_STOP.crit / A.SIM_DT) },
      { weapon: 'rifle', mass: 5.5, kill: true, crit: false, ticks: Math.round(A.HIT_STOP.heavy / A.SIM_DT) },
      { weapon: 'railgun', mass: 1, kill: false, crit: false, ticks: Math.round(A.HIT_STOP.rail / A.SIM_DT) }
    ];
    for (const c of cases) {
      const game = fixture(), target = enemy(game, 0, 3, 0.5, c.kill ? 1 : 100000);
      target.def.mass = c.mass;
      game.player.critScale = c.crit ? 999 : 0;
      game.player.dealDamage(target, 50, 0, 1, 0, 0, A.WEAPON_BY_ID[c.weapon]);
      assert.strictEqual(game.hitStop.ticks, c.ticks,
        c.weapon + ' kill=' + c.kill + ' crit=' + c.crit + ' froze ' + game.hitStop.ticks + ' ticks');
    }
  });
  test('reduced motion removes the freeze entirely', () => {
    const game = fixture(), target = enemy(game, 0, 3, 0.5, 1);
    game.motionScale = 0;
    game.player.dealDamage(target, 50, 0, 1, 0, 0, A.WEAPON_BY_ID.railgun);
    assert.strictEqual(game.hitStop.active, false);
  });
  test('a hit records squash so the body deforms on impact', () => {
    const game = fixture(), target = enemy(game, 0, 3);
    const manager = Object.assign(Object.create(A.EnemyManager.prototype), { game, list: [target] });
    manager.damage(target, 5, 0, 1, 0, 0);
    assert.strictEqual(target.squash, 1); assert.strictEqual(target.flash, 1);
  });

  /* -------------------------------------------------------------- perks */
  test('every perk effect moves the stat it advertises and nothing else', () => {
    const watched = ['damageMultiplier', 'reloadMultiplier', 'critScale', 'critPower', 'spreadScale',
      'maxHp', 'maxArmor', 'speedScale', 'dashCooldown', 'burnScale', 'splashScale',
      'chainBonus', 'pierceBonus', 'grenadeCooldown'];
    for (const perk of A.PERKS) {
      const game = fixture(), p = game.player;
      game.perks = {};
      // the fixture disables crits for the damage cases; perks need the
      // neutral value back or a multiplier has nothing to multiply
      p.critScale = 1;
      const before = {};
      for (const key of watched) before[key] = p[key];
      const changed = [];
      perk.apply(game);
      for (const key of watched) if (p[key] !== before[key]) changed.push(key);
      const touchesFlag = p.burnChains !== false;
      assert(changed.length > 0 || touchesFlag, perk.id + ' changed nothing at all');
      assert(changed.length <= 2, perk.id + ' changed too many stats: ' + changed.join(', '));
    }
  });
  test('perk ranks stack multiplicatively and stay within their cap', () => {
    const game = fixture(), p = game.player;
    const perk = A.PERK_BY_ID.overcharge;
    for (let rank = 0; rank < perk.max; rank++) perk.apply(game);
    near(p.damageMultiplier, Math.pow(1.12, perk.max));
  });
  test('the pierce perk adds one more target to a hitscan line', () => {
    for (const [bonus, survivors] of [[0, 1], [1, 0]]) {
      const game = fixture();
      const first = enemy(game, 0, 2), second = enemy(game, 0, 5), third = enemy(game, 0, 8);
      game.player.pierceBonus = bonus;
      game.player.hitscan(origin, 0, A.WEAPON_BY_ID.rifle);
      const untouched = [first, second, third].filter((e) => e.hp === 1000).length;
      assert.strictEqual(untouched, survivors, 'pierceBonus ' + bonus + ' hit the wrong number of enemies');
    }
  });
  test('the splash perk raises both rocket damage and radius', () => {
    const plain = fixture(), boosted = fixture();
    boosted.player.splashScale = 4;
    for (const game of [plain, boosted]) {
      game.player.giveWeapon('rocket'); game.player.giveAmmo('rocket', 10);
      game.player.setWeapon(A.WEAPONS.findIndex((w) => w.id === 'rocket'));
      game.player.shoot(0, 30);
    }
    const a = plain.projectiles.rockets[0].w, b = boosted.projectiles.rockets[0].w;
    near(b.splash, a.splash * 4);
    near(b.splashRadius, a.splashRadius * 2);
  });
  test('burn conduction arcs to one neighbour, only while the target burns', () => {
    for (const [burning, enabled, expectArc] of [[true, true, true], [false, true, false], [true, false, false]]) {
      const game = fixture(), target = enemy(game, 0, 3), neighbour = enemy(game, 1.5, 3);
      game.player.critScale = 0;
      game.player.burnChains = enabled;
      if (burning) { target.burn = 4; target.burnDps = 1; }
      game.player.dealDamage(target, 100, 0, 1, 0, 0, A.WEAPON_BY_ID.rifle);
      assert.strictEqual(neighbour.hp < 1000, expectArc,
        'burning=' + burning + ' enabled=' + enabled + ' produced the wrong arc');
      if (expectArc) near(neighbour.hp, 1000 - 45);
    }
  });
  test('burn conduction never chains through a second burning body', () => {
    const game = fixture(), target = enemy(game, 0, 3), neighbour = enemy(game, 1.5, 3), far = enemy(game, 3, 3);
    game.player.critScale = 0;
    game.player.burnChains = true;
    target.burn = 4; neighbour.burn = 4;
    game.player.dealDamage(target, 100, 0, 1, 0, 0, A.WEAPON_BY_ID.rifle);
    assert(neighbour.hp < 1000, 'the first arc did not land');
    assert.strictEqual(far.hp, 1000, 'conduction chained past its single jump');
  });

  /* The stick reading is analogue inside InputState, but movement normalises
     the vector so a keyboard diagonal cannot outrun a straight line. Do those
     two in the wrong order and every stick reading becomes a full-speed run —
     a bug the input layer alone cannot see, because its own numbers are
     right. */
  const padAxes = (axes) => [{ connected: true, buttons: [], axes: axes }];

  test('an eased stick walks where a full push runs', () => {
    const game = fixture(), controls = input();
    const speedAfter = (axes) => {
      pads = padAxes(axes);
      controls.pollPad();
      game.player.vx = 0; game.player.vz = 0;
      for (let i = 0; i < 6; i++) tick(game, controls);
      return Math.hypot(game.player.vx, game.player.vz);
    };
    const full = speedAfter([0, -1, 0, 0]);
    const eased = speedAfter([0, -(A.PAD_DEADZONE + 0.05), 0, 0]);
    assert(full > 1, 'a fully pushed stick did not move the marine');
    assert(eased < full * 0.5, 'an eased stick ran at ' + eased + ' against ' + full);
    pads = []; controls.pollPad();
  });

  test('a keyboard diagonal does not outrun a straight line', () => {
    const game = fixture(), controls = input();
    const speedAfter = (codes) => {
      controls.keys = Object.create(null);
      for (const code of codes) controls.keys[code] = true;
      game.player.vx = 0; game.player.vz = 0;
      for (let i = 0; i < 8; i++) tick(game, controls);
      return Math.hypot(game.player.vx, game.player.vz);
    };
    near(speedAfter(['KeyW', 'KeyD']), speedAfter(['KeyW']), 'a diagonal is faster than a straight line');
  });

  test('a dash from an eased stick is still full length', () => {
    const game = fixture(), controls = input();
    pads = padAxes([0, -(A.PAD_DEADZONE + 0.05), 0, 0]);
    controls.pollPad();
    game.player.dashCd = 0;
    controls.pressed.Space = true;
    tick(game, controls);
    near(Math.hypot(game.player.dashX, game.player.dashZ), 1, 'the dash direction was not a unit vector');
    assert(game.player.dashZ < -0.9, 'the dash went the wrong way');
    pads = []; controls.pollPad();
  });

  /* Damage readouts. Cosmetic, so the tests are about not lying and not
     spamming: one target keeps one climbing number, and nothing here may
     touch the run RNG or the fight would change when it is switched off. */
  test('hits on one target fold into a single climbing number', () => {
    const game = fixture(), target = enemy(game, 0, 3);
    const dn = game.damageNumbers;
    dn.add(target.id, 40, false, 0, 1, 3);
    dn.add(target.id, 35, false, 0, 1, 3);
    assert.strictEqual(dn.list.length, 1, 'a second hit opened a second number');
    assert.strictEqual(dn.list[0].amount, 75, 'the number did not add up');
    // a different target gets its own
    const other = enemy(game, 4, 3);
    dn.add(other.id, 10, false, 4, 1, 3);
    assert.strictEqual(dn.list.length, 2, 'two targets shared one number');
  });

  test('a number stops merging once it has been read', () => {
    const game = fixture(), target = enemy(game, 0, 3);
    const dn = game.damageNumbers;
    dn.add(target.id, 40, false, 0, 1, 3);
    dn.update(A.DAMAGE_NUMBER_MERGE + 0.01);
    dn.add(target.id, 40, false, 0, 1, 3);
    assert.strictEqual(dn.list.length, 2, 'a stale number was still merged into');
    // and merging restarts the life, so held fire keeps one number up
    const fresh = fixture(), held = enemy(fresh, 0, 3);
    const dn2 = fresh.damageNumbers;
    dn2.add(held.id, 5, false, 0, 1, 3);
    for (let i = 0; i < 40; i++) { dn2.update(1 / 60); dn2.add(held.id, 5, false, 0, 1, 3); }
    assert.strictEqual(dn2.list.length, 1, 'sustained fire produced a blizzard');
    assert.strictEqual(dn2.list[0].amount, 205, 'the climbing number lost hits');
  });

  test('a crit marks the number it lands on', () => {
    const game = fixture(), target = enemy(game, 0, 3);
    const dn = game.damageNumbers;
    dn.add(target.id, 20, false, 0, 1, 3);
    dn.add(target.id, 90, true, 0, 1, 3);
    assert.strictEqual(dn.list[0].crit, true, 'a crit folded into a number lost its mark');
  });

  test('readouts expire, respect their cap and ignore nothing-hits', () => {
    const game = fixture();
    const dn = game.damageNumbers;
    dn.add(1, 10, false, 0, 1, 0);
    dn.update(A.DAMAGE_NUMBER_LIFE + 0.01);
    assert.strictEqual(dn.list.length, 0, 'a number outlived its life');
    for (let i = 0; i < A.DAMAGE_NUMBER_CAP + 9; i++) dn.add(100 + i, 5, false, i, 1, 0);
    assert.strictEqual(dn.list.length, A.DAMAGE_NUMBER_CAP, 'the readout grew past its cap');
    assert.strictEqual(dn.add(7, 0, false, 0, 1, 0), null, 'a hit for nothing produced a number');
    assert.strictEqual(dn.add(7, -5, false, 0, 1, 0), null, 'a negative hit produced a number');
    dn.clear();
    assert.strictEqual(dn.list.length, 0, 'clearing left numbers behind');
    dn.enabled = false;
    assert.strictEqual(dn.add(7, 50, false, 0, 1, 0), null, 'a disabled readout still recorded a hit');
    assert.strictEqual(dn.list.length, 0, 'a disabled readout still stored a hit');
  });

  test('a burst of real fire reports what it actually dealt', () => {
    const game = fixture(), target = enemy(game, 0, 3, 0.5, 100000);
    const weapon = equip(game, 'minigun');
    const dn = game.damageNumbers;
    const before = game.rng.getState();
    let dealt = 0;
    for (let i = 0; i < 10; i++) dealt += 1, game.player.dealDamage(target, 12, 0, 1, 0, 0, weapon);
    assert.strictEqual(dn.list.length, 1, 'a burst opened ' + dn.list.length + ' numbers');
    assert.strictEqual(dn.list[0].amount, 120, 'the readout did not match the damage dealt');
    assert.strictEqual(Math.round(100000 - target.hp), 120, 'the readout and the health disagree');
    // switching it off must not be able to change a fight, so it cannot draw
    // from the run RNG at all
    assert.strictEqual(game.rng.getState(), before, 'the readout moved the run RNG');
  });

  /* Barrel heat drives smoke after a burst and nothing else. The assertion
     that matters is the second one: the day it starts touching spread it has
     become a mechanic the player has to manage, which is not what it is. */
  test('barrel heat builds, cools and never touches accuracy', () => {
    const game = fixture(), controls = input();
    const weapon = equip(game, 'rifle');
    const p = game.player;
    assert.strictEqual(p.barrelHeat, 0, 'a fresh marine started with a hot barrel');
    controls.mouseDown = true;
    for (let i = 0; i < 40; i++) { p.fireTimer = 0; tick(game, controls); }
    assert(p.barrelHeat > 0, 'firing did not heat the barrel');
    const hot = p.barrelHeat;
    // heat is capped, so a long burst cannot bank minutes of smoke
    for (let i = 0; i < 200; i++) { p.fireTimer = 0; tick(game, controls); }
    assert(p.barrelHeat <= 12.001, 'barrel heat ran past its cap: ' + p.barrelHeat);

    // the same weapon, same state, cold versus hot: the spread must not move
    controls.mouseDown = false;
    p.bloom = 0; p.aiming = false;
    tick(game, controls);
    const spreadHot = p.spreadScale;
    p.barrelHeat = 0; p.bloom = 0;
    tick(game, controls);
    assert.strictEqual(p.spreadScale, spreadHot, 'barrel heat changed the spread');

    // and it cools back to nothing on its own
    p.barrelHeat = hot;
    for (let i = 0; i < 600; i++) tick(game, controls);
    assert.strictEqual(p.barrelHeat, 0, 'the barrel never cooled');
    // swapping weapons starts cold: the smoke belongs to the barrel that fired
    p.barrelHeat = 8;
    equip(game, 'shotgun');
    assert.strictEqual(p.barrelHeat, 0, 'a swapped weapon inherited the heat');
  });

  console.log('COMBAT_OK cases=' + cases + ' weapons=' + A.WEAPONS.length + ' perks=' + A.PERKS.length);
}

if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
