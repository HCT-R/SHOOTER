/* ========================================================================
   70-enemies.js — alien roster, AI, and instanced rendering
   ======================================================================== */

const ENEMY_TYPES = [
  {
    id: 'crawler', label: 'Crawler', build: buildCrawler, cap: 300,
    hp: 34, speed: 6.3, damage: 9, radius: 0.5, mass: 0.7, score: 12,
    scale: 1.0, atkRange: 1.15, windup: 0.24, cooldown: 0.72,
    blood: 0x8a1410, gibs: 5, gibSize: 0.16, pitch: 1.5,
    bob: 0.09, bobRate: 17, roll: 0.13, flying: false, cost: 1
  },
  {
    id: 'grunt', label: 'Grunt', build: buildGrunt, cap: 200,
    hp: 90, speed: 3.6, damage: 19, radius: 0.62, mass: 1.4, score: 26,
    scale: 1.0, atkRange: 1.5, windup: 0.34, cooldown: 1.05,
    blood: 0x2f7a18, gibs: 8, gibSize: 0.2, pitch: 1.0,
    bob: 0.13, bobRate: 9.5, roll: 0.09, flying: false, cost: 3
  },
  {
    id: 'spitter', label: 'Spitter', build: buildSpitter, cap: 110,
    hp: 66, speed: 3.0, damage: 15, radius: 0.58, mass: 1.1, score: 38,
    scale: 1.0, atkRange: 14, windup: 0.55, cooldown: 2.1, ranged: true,
    keepDist: 9.5, projSpeed: 17,
    blood: 0x6a2f8f, gibs: 7, gibSize: 0.18, pitch: 1.25,
    acidPool: { radius: 1.5, life: 4.5, damage: 4 },
    bob: 0.11, bobRate: 8, roll: 0.12, flying: false, cost: 4
  },
  {
    id: 'flyer', label: 'Stinger', build: buildFlyer, cap: 140,
    hp: 52, speed: 5.6, damage: 13, radius: 0.5, mass: 0.6, score: 30,
    scale: 1.0, atkRange: 1.3, windup: 0.2, cooldown: 0.85,
    blood: 0x1f6a72, gibs: 6, gibSize: 0.15, pitch: 1.7,
    bob: 0.3, bobRate: 5.5, roll: 0.3, flying: true, hoverY: 1.05, cost: 3
  },
  {
    id: 'brute', label: 'Brute', build: buildBrute, cap: 60,
    hp: 460, speed: 2.6, damage: 44, radius: 1.15, mass: 5.5, score: 130,
    scale: 1.0, atkRange: 2.3, windup: 0.55, cooldown: 1.5,
    blood: 0x7a1a12, gibs: 14, gibSize: 0.3, pitch: 0.55,
    bob: 0.16, bobRate: 6.2, roll: 0.07, flying: false, cost: 12,
    shakeOnStep: true
  },
  {
    id: 'queen', label: 'Hive Queen', build: buildQueen, cap: 4,
    hp: 4600, speed: 2.3, damage: 62, radius: 2.5, mass: 30, score: 1500,
    scale: 1.0, atkRange: 4.6, windup: 0.7, cooldown: 1.7,
    blood: 0x8a1a4a, gibs: 26, gibSize: 0.42, pitch: 0.42,
    acidPool: { radius: 3.4, life: 9, damage: 9 },
    bob: 0.2, bobRate: 4.4, roll: 0.05, flying: false, cost: 0,
    boss: true, spawnsAdds: true, ranged: true, projSpeed: 20, projectileY: 1.6, rangedCooldown: 3.4,
    special: 'nova', specialRadius: 7.2, specialRange: 10, specialWindup: 1.2,
    specialCooldown: 11, telegraphColor: 0xff538e
  },
  {
    id: 'siege', label: 'Siege Behemoth', build: buildSiege, cap: 3,
    hp: 1800, speed: 2.05, damage: 42, radius: 2.45, mass: 40, score: 1200,
    scale: 1.0, atkRange: 3.8, windup: 0.85, cooldown: 1.85,
    blood: 0xb97730, gibs: 28, gibSize: 0.44, pitch: 0.34,
    bob: 0.13, bobRate: 3.8, roll: 0.035, flying: false, cost: 0,
    boss: true, spawnsAdds: false, ranged: false, shakeOnStep: true,
    special: 'seismic', specialRadius: 7.4, specialRange: 10, specialWindup: 1.35,
    specialCooldown: 6.7, telegraphColor: 0xffb04a
  },
  {
    id: 'warden', label: 'Neon Warden', build: buildWarden, cap: 3,
    hp: 2600, speed: 2.8, damage: 32, radius: 2.25, mass: 24, score: 1450,
    scale: 1.0, atkRange: 20, windup: 0.85, cooldown: 2.6,
    blood: 0x418dca, gibs: 24, gibSize: 0.36, pitch: 0.66,
    bob: 0.18, bobRate: 3.5, roll: 0.045, flying: true, hoverY: 0.3, cost: 0,
    boss: true, spawnsAdds: false, ranged: true, keepDist: 12,
    projSpeed: 21, projectileY: 1.3, rangedCooldown: 3.7,
    special: 'pulse', specialRadius: 5.8, specialRange: 7.3, specialWindup: 1.05,
    specialCooldown: 8.5, telegraphColor: 0x69fff0, volleySpread: 2.15
  },
  /* The finale. Three phases that are three different fights: a wall to be
     kited, a swarm to be cleared, then a duel against the exposed core. The
     phase table overrides fields of the type itself, so the whole AI keeps
     reading d.<field> and knows nothing about phases — see applyPhase().
     `at` is the health fraction the phase begins at, and the first one has to
     be 1: it is where the fight starts, not a transition. */
  {
    id: 'overmind', label: 'Overmind', build: buildOvermind, cap: 2,
    hp: 4800, speed: 1.9, damage: 66, radius: 2.7, mass: 36, score: 2600,
    scale: 1.0, atkRange: 5.0, windup: 0.75, cooldown: 1.7,
    blood: 0x7ad63a, gibs: 34, gibSize: 0.5, pitch: 0.3,
    acidPool: { radius: 3.8, life: 10, damage: 10 },
    bob: 0.1, bobRate: 3.2, roll: 0.03, flying: false, cost: 0,
    boss: true, spawnsAdds: false, ranged: false, projSpeed: 19, projectileY: 2.0,
    rangedCooldown: 3.2, volleySpread: 2.6,
    special: 'seismic', specialRadius: 8.2, specialRange: 11, specialWindup: 1.3,
    specialCooldown: 6.2, telegraphColor: 0xc6ff4a,
    phases: [
      { at: 1, label: 'БРОНЯ', speed: 1.9, scale: 1, ranged: false, spawnsAdds: false,
        special: 'seismic', specialRadius: 8.2, specialWindup: 1.3, specialCooldown: 6.2 },
      { at: 0.66, label: 'РОЕНИЕ', speed: 2.55, scale: 0.97, ranged: true, spawnsAdds: true,
        special: 'nova', specialRadius: 7.0, specialWindup: 1.15, specialCooldown: 8.2,
        rangedCooldown: 3.2 },
      { at: 0.33, label: 'ЯДРО', speed: 3.2, scale: 0.9, ranged: true, spawnsAdds: false,
        special: 'nova', specialRadius: 6.2, specialWindup: 0.9, specialCooldown: 4.4,
        rangedCooldown: 2.1 }
    ]
  }
];

/* The phase decision, kept out of the AI loop so it can be asked without a
   level, a scene or a player. A reforming boss never advances: two thresholds
   crossed by one very large hit are still two beats of the fight, not one
   skipped, and the shield window is what holds them apart. */
function nextBossPhase(e) {
  const phases = e.def && e.def.phases;
  if (!phases || e.shield > 0) return -1;
  const next = e.bossPhase + 1;
  if (next >= phases.length) return -1;
  return e.hp <= e.maxHp * phases[next].at ? next : -1;
}

const ENEMY_BY_ID = {};
for (let i = 0; i < ENEMY_TYPES.length; i++) ENEMY_BY_ID[ENEMY_TYPES[i].id] = ENEMY_TYPES[i];

/* ---------------------------------------------------------- elite ranks */
/* A modifier rides an ordinary alien and changes how the fight reads without
   costing a new model or a new AI. That is the whole point: variety per unit
   of work. Each one is a silhouette cue (tint, scale) plus one behavioural
   promise the player can learn and plan around.

   Bosses never take a rank — their fights are already authored, and stacking
   a modifier on top would turn a telegraphed encounter into a coin flip. */
const ELITE_MODS = [
  {
    id: 'volatile', label: 'НЕСТАБИЛЬНЫЙ', tint: [1.5, 0.75, 0.55], scale: 1.08,
    hp: 1, speed: 1, worth: 2.2,
    desc: 'взрывается при смерти',
    onDeath: (game, e) => {
      // hurts the player too: standing on top of one is the mistake it
      // teaches, and a harmless explosion teaches nothing
      game.explosion(e.x, e.y + e.def.radius * 0.6, e.z, 60 + game.wave * 6, 5.2, true);
    }
  },
  {
    id: 'swift', label: 'СТРЕМИТЕЛЬНЫЙ', tint: [0.8, 1.35, 1.45], scale: 0.92,
    hp: 0.7, speed: 1.5, worth: 1.7,
    desc: 'быстрый и хрупкий'
  },
  {
    id: 'armored', label: 'БРОНИРОВАННЫЙ', tint: [1.15, 1.15, 1.3], scale: 1.18,
    hp: 2.4, speed: 0.78, worth: 2,
    desc: 'толстая шкура, медленный шаг'
  },
  {
    id: 'splitter', label: 'РАСЩЕПЛЯЮЩИЙСЯ', tint: [1.25, 0.85, 1.4], scale: 1.1,
    hp: 1.3, speed: 0.95, worth: 2.4,
    desc: 'распадается на две особи',
    onDeath: (game, e) => {
      /* Children are spawned plain. An elite that could split into splitters
         would multiply without bound in a crowded room, and the frame budget
         would go before the player did. */
      for (let i = 0; i < 2; i++) {
        const a = e.angle + Math.PI * (i ? 0.5 : -0.5);
        game.enemies.spawnPlain('crawler', e.x + Math.sin(a) * 1.2, e.z + Math.cos(a) * 1.2);
      }
    }
  }
];

const ELITE_BY_ID = {};
for (const mod of ELITE_MODS) ELITE_BY_ID[mod.id] = mod;

/* Elites start appearing once the player has a weapon worth the name, then
   climb to a ceiling: past roughly a third of the horde the rank stops being
   a highlight and becomes the baseline. */
function eliteChance(wave) {
  return clamp((wave - 2) * 0.035, 0, 0.32);
}

const S_CHASE = 0, S_WINDUP = 1, S_RECOVER = 2, S_DYING = 3, S_SPECIAL = 4;

class EnemyManager {
  constructor(game) {
    this.game = game;
    this.scene = game.scene;
    this.list = [];
    this.nextId = 1;
    this._fallbackRng = makeRng(0x454e454d);
    // switched off while an elite spawns its own children
    this.eliteRanks = true;
    this._renderCounts = new Uint16Array(ENEMY_TYPES.length);
    this.hash = new SpatialHash(2.5);
    this.neighbors = [];
    this.aliveCount = 0;
    this._dir = { x: 0, z: 0 };
    this._eul = new THREE.Euler();
    this._q = new THREE.Quaternion();
    this._p = new THREE.Vector3();
    this._s = new THREE.Vector3();
    this._m = new THREE.Matrix4();
    this._c = new THREE.Color();

    this.meshes = [];
    for (let i = 0; i < ENEMY_TYPES.length; i++) {
      const t = ENEMY_TYPES[i];
      const geo = t.build();
      const mat = new THREE.MeshLambertMaterial({ vertexColors: true, emissive: 0x070909 });
      const mesh = new THREE.InstancedMesh(geo, mat, t.cap);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.castShadow = true;
      mesh.receiveShadow = false;
      mesh.count = 0;
      this.scene.add(mesh);
      this.meshes.push(mesh);
    }

    // One shared instanced warning ring for every possible living alien.
    // No per-attack geometry/material allocations, even in the largest swarm.
    const warningGeo = new THREE.RingGeometry(0.91, 1, 48, 1, 0, TAU * 0.94);
    warningGeo.rotateX(-Math.PI / 2);
    this.warnings = new THREE.InstancedMesh(warningGeo, new THREE.MeshBasicMaterial({
      color: 0xffffff, transparent: true, opacity: 0.83,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false,
      side: THREE.DoubleSide
    }), ENEMY_TYPES.reduce((n, d) => n + d.cap, 0));
    this.warnings.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.warnings.count = 0;
    this.warnings.frustumCulled = false;
    this.warnings.renderOrder = 3;
    this.scene.add(this.warnings);
  }

  reset() {
    this.list.length = 0;
    this.nextId = 1;
    this._fallbackRng = makeRng(0x454e454d);
    this.aliveCount = 0;
    this.warnings.count = 0;
    for (let i = 0; i < this.meshes.length; i++) this.meshes[i].count = 0;
  }

  get count() { return this.list.length; }

  spawn(typeId, x, z, waveScale) {
    const ti = ENEMY_BY_ID[typeId];
    if (!ti) return null;
    const idx = ENEMY_TYPES.indexOf(ti);
    let typeCount = 0;
    for (let i = 0; i < this.list.length; i++) if (this.list[i].type === idx) typeCount++;
    if (typeCount >= ti.cap) return null;

    const scale = waveScale || { hp: 1, dmg: 1, speed: 1 };
    const R = this.game.rng || this._fallbackRng;
    const speedScale = scale.speed * (0.9 + R() * 0.2);
    /* A phased boss gets its own copy of its type. Phase changes rewrite
       speed, attacks and reach, and writing those onto the shared table would
       leave every later spawn in the session — including the next run — with
       the last phase of the previous fight. */
    const e = {
      id: this.nextId++, type: idx, def: ti.phases ? Object.assign({}, ti) : ti,
      x: x, z: z, y: ti.flying ? ti.hoverY : 0,
      vx: 0, vz: 0,
      hp: ti.hp * scale.hp, maxHp: ti.hp * scale.hp,
      damage: ti.damage * scale.dmg,
      speed: ti.speed * speedScale, speedScale: speedScale,
      angle: R() * TAU,
      state: S_CHASE, timer: 0, cd: R() * 0.5,
      rangedCd: 1 + R() * 2,
      specialCd: 3 + R() * 3,
      specialKind: '', windupTotal: ti.windup,
      attackX: x, attackZ: z, enraged: false,
      flash: 0, squash: 0, burn: 0, burnDps: 0,
      kx: 0, kz: 0,
      phase: R() * TAU,
      dying: 0,
      sizeJitter: ti.boss ? 1 : 0.9 + R() * 0.2,
      addTimer: 6,
      lastMoan: R() * 6,
      elite: null,
      bossPhase: 0, shield: 0,
      worth: ti.score
    };
    if (ti.phases) this.applyPhase(e, 0);
    if (this.eliteRanks && !ti.boss) this.applyElite(e, R);
    e.prevX = e.x; e.prevZ = e.z; e.prevY = e.y; e.prevAngle = e.angle;
    e.prevPhase = e.phase; e.prevSquash = e.squash;
    this.list.push(e);
    return e;
  }

  /* Spawn with elite ranks suppressed. Used for anything an elite creates,
     so a rank can never seed more of itself. */
  spawnPlain(typeId, x, z) {
    const previous = this.eliteRanks;
    this.eliteRanks = false;
    try {
      return this.spawn(typeId, x, z, this.game.waveScale ? this.game.waveScale() : null);
    } finally {
      this.eliteRanks = previous;
    }
  }

  /* The roll and the stat edit are one step so a rank can never be recorded
     without its effect, or applied twice. */
  applyElite(e, rng) {
    const wave = this.game.wave || 1;
    if (rng() >= eliteChance(wave)) return null;
    const mod = ELITE_MODS[(rng() * ELITE_MODS.length) | 0];
    e.elite = mod;
    e.hp = e.maxHp = e.maxHp * mod.hp;
    e.speed *= mod.speed;
    e.worth = Math.round(e.worth * mod.worth);
    return mod;
  }

  /* Phase overrides are written onto the enemy's own copy of its type. That
     is the whole trick: the AI, the renderer and the telegraph rings keep
     reading d.<field> and none of them has to learn what a phase is. */
  applyPhase(e, index) {
    const phase = e.def.phases && e.def.phases[index];
    if (!phase) return null;
    e.bossPhase = index;
    for (const key in phase) {
      if (key === 'at' || key === 'label') continue;
      e.def[key] = phase[key];
    }
    // the jitter a spawn rolled stays applied, so a phase changes the base
    // speed without erasing the variation
    e.speed = e.def.speed * (e.speedScale || 1);
    return phase;
  }

  advancePhase(e) {
    const phase = this.applyPhase(e, e.bossPhase + 1);
    if (!phase) return null;
    /* Reforming: a window where the boss can neither be hurt nor attack. It
       is what makes a phase a beat in the fight instead of a stat change the
       player never notices happening. */
    e.shield = phase.shield || 1.5;
    e.state = S_RECOVER;
    e.timer = e.shield;
    e.specialKind = '';
    e.specialCd = Math.max(e.specialCd, e.shield + 0.4);
    e.rangedCd = Math.max(e.rangedCd, e.shield + 0.4);
    // a swarm phase has to start swarming, not wait out its spawn timer
    if (phase.spawnsAdds) e.addTimer = e.shield + 1.2;
    if (this.game.onBossPhase) this.game.onBossPhase(e, phase);
    return phase;
  }

  beginSpecial(e, kind, duration, targetX, targetZ) {
    e.state = S_SPECIAL;
    e.specialKind = kind;
    e.timer = e.windupTotal = duration;
    e.attackX = targetX;
    e.attackZ = targetZ;
    sfx.screech(e.def.pitch * 0.85, 0.8);
  }

  finishSpecial(e, player) {
    const g = this.game;
    const d = e.def;
    if (e.specialKind === 'volley') {
      const dx = e.attackX - e.x, dz = e.attackZ - e.z;
      const len = Math.hypot(dx, dz) || 1;
      const spread = e.enraged ? 2 : 1;
      const spacing = d.volleySpread || 3.1;
      for (let k = -spread; k <= spread; k++) {
        g.spawnAcid(e, e.attackX + dz / len * k * spacing, e.attackZ - dx / len * k * spacing);
      }
      sfx.spit();
    } else {
      const radius = d.specialRadius || 4.3;
      const color = d.telegraphColor || 0xffa04d;
      const count = d.boss ? 52 : 32;
      for (let k = 0; k < count; k++) {
        const a = k / count * TAU;
        g.fx.sparks.emit(e.x + Math.sin(a) * 0.4, 0.16, e.z + Math.cos(a) * 0.4,
          Math.sin(a) * radius * 3.5, 0.15, Math.cos(a) * radius * 3.5,
          0.58, d.boss ? 0.8 : 0.5, color, 0);
      }
      g.fx.sparks.burst(e.x, 0.25, e.z, 16, 5, 0.55, 0.65, color, 0.7, 10);
      if (g.fx.shockwaves) g.fx.shockwaves.emit(e.x, e.z, radius, color, d.id === 'siege' ? 0.8 : 0.6);
      g.fx.lights.flash(e.x, 0.8, e.z, color, d.boss ? 80 : 38, radius * 2, 0.2);
      const dx = player.x - e.x, dz = player.z - e.z;
      const dist = Math.hypot(dx, dz);
      if (player.alive && dist <= radius && g.level.lineOfSight(e.x, e.z, player.x, player.z)) {
        g.damagePlayer(e.damage * (d.boss ? 0.8 : 0.7), e.x, e.z);
        player.kx += dx / Math.max(0.1, dist) * 7;
        player.kz += dz / Math.max(0.1, dist) * 7;
      }
      g.shake(d.boss ? 4 : 2, 0.25);
      sfx.explode(d.boss ? 0.55 : 0.3);
    }
    e.state = S_RECOVER;
    e.timer = e.specialKind === 'volley' ? 0.3 : 0.75;
    e.specialKind = '';
  }

  damage(e, amount, dirX, dirZ, knock, burnDps) {
    if (e.state === S_DYING) return false;
    /* A reforming boss absorbs everything. The flash still plays: a shot that
       lands on a shield has to look like it landed, or the player reads it as
       the game losing their hits. */
    if (e.shield > 0) { e.flash = Math.max(e.flash, 0.5); return false; }
    e.hp -= amount;
    e.flash = 1;
    // squash reads as the body absorbing the hit; it springs back in ~0.15 s
    e.squash = 1;
    if (burnDps) { e.burn = Math.max(e.burn, 4.0); e.burnDps = Math.max(e.burnDps, burnDps); }
    if (knock) {
      const k = knock / e.def.mass;
      e.kx += dirX * k;
      e.kz += dirZ * k;
    }
    if (e.hp <= 0) { this.kill(e, dirX, dirZ, amount); return true; }
    return false;
  }

  kill(e, dirX, dirZ, overkill) {
    const g = this.game;
    e.state = S_DYING;
    e.dying = 0;
    const d = e.def;
    const gy = e.y + d.radius;

    // overkill tears them apart instead of just dropping them
    const violent = overkill > e.maxHp * 0.55 || d.id === 'crawler';
    const gibCount = violent ? d.gibs : Math.ceil(d.gibs * 0.4);
    g.fx.gibs.burst(e.x, gy, e.z, gibCount, violent ? 9 : 4.5, d.gibSize, d.blood);
    g.fx.sparks.burst(e.x, gy, e.z, violent ? 16 : 8, 7, 0.45, 0.5, d.blood, 0.8, 16);
    g.fx.decals.blood(e.x, e.z, d.radius * (violent ? 5.2 : 3.6));
    if (violent) {
      g.fx.decals.blood(e.x + (Math.random() - 0.5) * 2.5, e.z + (Math.random() - 0.5) * 2.5, d.radius * 3);
    }
    /* Acid blood leaves the ground dangerous for a few seconds. This is the
       one death effect that is not cosmetic, so it is deliberately small and
       short: a wave of spitters must not carpet the arena, and the hazard's
       own arming window gives whoever killed it time to step off the body. */
    if (d.acidPool && g.hazards) {
      g.hazards.spawn(e.x, e.z, d.acidPool.radius, d.acidPool.life, d.acidPool.damage, d.blood);
    }
    sfx.gib();
    if (d.boss) {
      g.fx.sparks.burst(e.x, gy + 1, e.z, 60, 14, 1.3, 1.1, d.telegraphColor || 0xff4d7a, 1, 12);
      sfx.explode(1.4);
      g.shake(9, 0.9);
    }

    /* Before the reward, so a splitter's children are already on the field
       when the wave director next counts what is alive. */
    if (e.elite && e.elite.onDeath) e.elite.onDeath(g, e);

    g.onEnemyKilled(e);
  }

  /* ------------------------------------------------------------------ */
  update(dt, player) {
    const level = this.game.level;
    const list = this.list;
    const R = this.game.rng || this._fallbackRng;

    // rebuild the broadphase once per frame for separation queries
    this.hash.clear();
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      e.prevX = e.x; e.prevZ = e.z; e.prevY = e.y; e.prevAngle = e.angle;
      e.prevPhase = e.phase; e.prevSquash = e.squash;
      if (e.state === S_DYING) continue;
      this.hash.insert(e, e.x, e.z);
    }

    const px = player.x, pz = player.z;
    let nearest = Infinity;

    for (let i = list.length - 1; i >= 0; i--) {
      const e = list[i];
      const d = e.def;

      if (e.state === S_DYING) {
        e.dying += dt;
        if (e.dying > 1.4) { list.splice(i, 1); continue; }
        continue;
      }

      if (e.flash > 0) e.flash = Math.max(0, e.flash - dt * 5.5);
      if (e.squash > 0) e.squash = Math.max(0, e.squash - dt * 7);

      // burning damage over time
      if (e.burn > 0) {
        e.burn -= dt;
        e.hp -= e.burnDps * dt;
        if (Math.random() < dt * 22) {
          this.game.fx.sparks.emit(
            e.x + (Math.random() - 0.5) * d.radius, e.y + Math.random() * d.radius * 2, e.z + (Math.random() - 0.5) * d.radius,
            (Math.random() - 0.5) * 1.2, 1.8 + Math.random() * 2, (Math.random() - 0.5) * 1.2,
            0.4, 0.5, Math.random() < 0.5 ? 0xff8a1e : 0xffd24a, -2);
        }
        if (e.hp <= 0) { this.kill(e, 0, 0, 0); continue; }
      }

      const dx = px - e.x, dz = pz - e.z;
      const distSq = dx * dx + dz * dz;
      if (distSq < nearest) nearest = distSq;
      const dist = Math.sqrt(distSq);
      const invDist = dist > 0.0001 ? 1 / dist : 0;

      // occasional idle vocalisation, only when close enough to matter
      e.lastMoan -= dt;
      if (e.lastMoan <= 0) {
        e.lastMoan = 4 + Math.random() * 7;
        if (dist < 26 && Math.random() < 0.35) sfx.screech(d.pitch, 0.5);
      }

      const hasLOS = level.lineOfSight(e.x, e.z, px, pz);

      e.specialCd -= dt;
      e.rangedCd -= dt;
      if (e.shield > 0) e.shield = Math.max(0, e.shield - dt);
      if (nextBossPhase(e) >= 0) this.advancePhase(e);
      // phases are the escalation for a boss that has them; stacking the
      // generic enrage on top would make phase three twice as fast as tuned
      if (d.boss && !d.phases && !e.enraged && e.hp < e.maxHp * 0.45) {
        e.enraged = true;
        e.specialCd = Math.min(e.specialCd, 0.5);
        this.game.fx.sparks.burst(e.x, e.y + 2, e.z, 34, 8, 1, 0.8, d.telegraphColor || 0xff4d92, 0.5, 3);
        sfx.screech(0.36, 1);
        this.game.shake(3, 0.45);
      }

      /* --- steering ------------------------------------------------ */
      let wantX = 0, wantZ = 0;
      const bodyRadius = d.radius * 0.82;
      const directPath = hasLOS && (!level.obstacleLineClear || level.obstacleLineClear(e.x, e.z, px, pz, bodyRadius));
      if (directPath) {
        wantX = dx * invDist;
        wantZ = dz * invDist;
      } else {
        level.flowDir(e.x, e.z, this._dir, bodyRadius);
        wantX = this._dir.x;
        wantZ = this._dir.z;
        if (wantX === 0 && wantZ === 0) { wantX = dx * invDist; wantZ = dz * invDist; }
      }

      // ranged types hold their preferred distance instead of closing
      if (d.ranged && d.keepDist && directPath) {
        if (dist < d.keepDist * 0.8) { wantX = -wantX; wantZ = -wantZ; }
        else if (dist < d.keepDist * 1.15) { const t = wantX; wantX = wantZ * 0.9; wantZ = -t * 0.9; }
      }
      // Stingers curve across the firing line instead of forming a straight
      // queue with the grounded swarm. The final approach remains readable.
      if (d.flying && directPath && dist > 3 && e.state === S_CHASE) {
        const weave = Math.sin(e.phase * 0.42) * 0.55;
        wantX += dz * invDist * weave;
        wantZ -= dx * invDist * weave;
      }

      /* --- separation ---------------------------------------------- */
      const near = this.hash.query(e.x, e.z, d.radius * 2.4, this.neighbors);
      let sepX = 0, sepZ = 0;
      for (let k = 0; k < near.length; k++) {
        const o = near[k];
        if (o === e) continue;
        const ox = e.x - o.x, oz = e.z - o.z;
        const rr = d.radius + o.def.radius;
        const dd = ox * ox + oz * oz;
        if (dd > rr * rr || dd < 1e-6) continue;
        const dl = Math.sqrt(dd);
        const push = (rr - dl) / rr;
        // heavier aliens shove lighter ones aside rather than the reverse
        const w = o.def.mass / (d.mass + o.def.mass) * 2;
        sepX += (ox / dl) * push * w;
        sepZ += (oz / dl) * push * w;
      }

      /* --- attack state machine ------------------------------------ */
      let moveScale = 1;
      if (e.cd > 0) e.cd -= dt;

      if (e.state === S_SPECIAL) {
        e.timer -= dt;
        moveScale = 0;
        if (e.timer <= 0) this.finishSpecial(e, player);
      } else if (e.state === S_WINDUP) {
        e.timer -= dt;
        moveScale = d.ranged && d.keepDist ? 0 : 0.12;
        if (e.timer <= 0) {
          if (d.ranged && d.keepDist) {
            this.game.spawnAcid(e, e.attackX, e.attackZ);
            sfx.spit();
          } else if (dist <= d.atkRange + 0.5 && hasLOS) {
            this.game.damagePlayer(e.damage, e.x, e.z);
            // a landed hit shoves the player back
            player.kx += dx * invDist * 3.2;
            player.kz += dz * invDist * 3.2;
          }
          e.state = S_RECOVER;
          e.timer = 0.22;
        }
      } else if (e.state === S_RECOVER) {
        e.timer -= dt;
        moveScale = 0.35;
        if (e.timer <= 0) { e.state = S_CHASE; e.cd = d.cooldown * (e.enraged ? 0.72 : 1); }
      } else {
        const inRange = d.ranged && d.keepDist
          ? (dist <= d.atkRange && hasLOS)
          : dist <= d.atkRange;
        if ((d.id === 'brute' || d.boss) && e.specialCd <= 0 && hasLOS && dist < (d.specialRange || 6)) {
          this.beginSpecial(e, d.special || 'slam', d.specialWindup || 0.95, e.x, e.z);
          e.specialCd = (d.specialCooldown || 7) * (e.enraged ? 0.68 : 1);
          moveScale = 0;
        } else if (d.boss && d.ranged && e.rangedCd <= 0 && hasLOS && dist < 34) {
          this.beginSpecial(e, 'volley', e.enraged ? 0.65 : 0.95, px + player.vx * 0.18, pz + player.vz * 0.18);
          e.rangedCd = d.rangedCooldown * (e.enraged ? 0.7 : 1);
          moveScale = 0;
        } else if (inRange && e.cd <= 0 && hasLOS) {
          e.state = S_WINDUP;
          e.timer = e.windupTotal = d.windup;
          // Lock aim at the beginning of the visible windup: strafing or a
          // well-timed dash can now avoid a spitter's shot reliably.
          e.attackX = px + player.vx * 0.12;
          e.attackZ = pz + player.vz * 0.12;
          if (Math.random() < 0.5) sfx.screech(d.pitch * 1.1, 0.7);
        }
      }

      // The queen calls reinforcements while her attack state machine handles
      // aimed volleys and the ground nova. Enraging accelerates both cycles.
      if (d.spawnsAdds) {
        e.addTimer -= dt;
        if (e.addTimer <= 0) {
          e.addTimer = e.enraged ? 6.5 : 9;
          for (let k = 0; k < (e.enraged ? 6 : 4); k++) {
            const a = R() * TAU;
            const type = e.enraged && k === 0 ? 'spitter' : 'crawler';
            this.game.spawnEnemyAt(type, e.x + Math.cos(a) * 3.4, e.z + Math.sin(a) * 3.4);
          }
          sfx.screech(0.5, 1);
        }
      }

      /* --- integrate ------------------------------------------------ */
      const spd = e.speed * moveScale * (e.enraged ? 1.22 : 1);
      const targetVX = wantX * spd + sepX * spd * 1.5;
      const targetVZ = wantZ * spd + sepZ * spd * 1.5;
      e.vx = damp(e.vx, targetVX, 9, dt);
      e.vz = damp(e.vz, targetVZ, 9, dt);

      // knockback decays fast so it reads as an impulse, not a slide
      e.x += (e.vx + e.kx) * dt;
      e.z += (e.vz + e.kz) * dt;
      const kd = 1 - Math.min(1, 7 * dt);
      e.kx *= kd; e.kz *= kd;

      level.resolveCircle(e, d.radius * 0.82);

      /* --- facing + animation -------------------------------------- */
      const mvLen = Math.hypot(e.vx, e.vz);
      const aiming = e.state === S_WINDUP || e.state === S_SPECIAL;
      const faceX = aiming ? dx * invDist : dist < 14 || !hasLOS ? (mvLen > 0.3 ? e.vx : dx * invDist) : dx * invDist;
      const faceZ = aiming ? dz * invDist : dist < 14 || !hasLOS ? (mvLen > 0.3 ? e.vz : dz * invDist) : dz * invDist;
      e.angle = angleLerp(e.angle, Math.atan2(faceX, faceZ), Math.min(1, 11 * dt));
      e.phase += dt * d.bobRate * (0.35 + mvLen / Math.max(0.5, d.speed));

      if (d.flying) {
        e.y = damp(e.y, d.hoverY + Math.sin(e.phase * 0.7) * 0.35, 4, dt);
      }
    }

    this.aliveCount = 0;
    for (let i = 0; i < list.length; i++) if (list[i].state !== S_DYING) this.aliveCount++;
    this.nearestDist = Math.sqrt(nearest);
  }

  /* pack live enemies into their per-type instanced meshes */
  render(blobs, alpha = 1) {
    alpha = clamp(alpha, 0, 1);
    const counts = this._renderCounts;
    counts.fill(0);
    const list = this.list;
    let warningCount = 0;

    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      const d = e.def;
      const mesh = this.meshes[e.type];
      const ci = counts[e.type];
      if (ci >= d.cap) continue;

      const x = lerp(e.prevX, e.x, alpha), z = lerp(e.prevZ, e.z, alpha);
      const angle = angleLerp(e.prevAngle, e.angle, alpha);
      const phase = lerp(e.prevPhase, e.phase, alpha);
      const squash = lerp(e.prevSquash || 0, e.squash, alpha);
      let y = lerp(e.prevY, e.y, alpha);
      const eliteScale = e.elite ? e.elite.scale : 1;
      let scaleY = d.scale * e.sizeJitter * eliteScale;
      let scaleXZ = d.scale * e.sizeJitter * eliteScale;
      let roll = 0, pitch = 0;

      if (e.state === S_DYING) {
        const t = clamp(e.dying / 1.4, 0, 1);
        // collapse and sink under the floor
        y -= t * t * (d.radius * 2.6);
        scaleY *= 1 - t * 0.55;
        scaleXZ *= 1 + t * 0.25;
        pitch = t * 1.1;
      } else {
        // impact deformation: wide and short, on top of the pose below
        if (squash > 0) { scaleXZ *= 1 + squash * 0.2; scaleY *= 1 - squash * 0.16; }
        const bob = Math.sin(phase) * d.bob;
        y += Math.abs(bob) * (d.flying ? 0.4 : 1);
        roll = Math.cos(phase * 0.5) * d.roll;
        if (e.state === S_WINDUP || e.state === S_SPECIAL) {
          const k = clamp(1 - e.timer / Math.max(0.001, e.windupTotal), 0, 1);
          pitch = -k * (e.state === S_SPECIAL ? 0.42 : 0.3);
          scaleXZ *= 1 + k * 0.09;
          scaleY *= 1 - k * (e.state === S_SPECIAL ? 0.16 : 0.06);
        } else if (e.state === S_RECOVER) {
          pitch = 0.25;
        }
      }

      this._eul.set(pitch, angle, roll);
      this._q.setFromEuler(this._eul);
      this._p.set(x, y, z);
      this._s.set(scaleXZ, scaleY, scaleXZ);
      this._m.compose(this._p, this._q, this._s);
      mesh.setMatrixAt(ci, this._m);

      // white flash on hit, orange when burning
      let r = 1, g = 1, b = 1;
      if (e.flash > 0) {
        const f = e.flash * 1.6;
        r += f * 2.4; g += f * 1.1; b += f * 1.1;
      }
      if (e.elite) { r *= e.elite.tint[0]; g *= e.elite.tint[1]; b *= e.elite.tint[2]; }
      if (e.burn > 0) { r *= 1.5; g *= 0.85; b *= 0.6; }
      if (e.enraged) { r *= 1.35; g *= 0.8; b *= 1.2; }
      if (e.state === S_SPECIAL) {
        const pulse = 0.25 + Math.sin(e.timer * 23) * 0.18;
        r += pulse * 1.8; g += pulse * 0.5;
      }
      if (e.state === S_DYING) {
        const t = clamp(e.dying / 1.4, 0, 1);
        const dk = 1 - t * 0.6;
        r *= dk; g *= dk; b *= dk;
      }
      this._c.setRGB(r, g, b);
      mesh.setColorAt(ci, this._c);

      if (e.state === S_WINDUP || e.state === S_SPECIAL) {
        const ranged = (d.keepDist && e.state === S_WINDUP) || e.specialKind === 'volley';
        const radius = ranged ? (d.boss ? 1.6 : 1.15)
          : e.state === S_SPECIAL ? (d.specialRadius || 4.3) : d.atkRange + 0.5;
        const wx = ranged ? e.attackX : x;
        const wz = ranged ? e.attackZ : z;
        this._p.set(wx, 0.09, wz);
        this._eul.set(0, e.timer * 2, 0);
        this._q.setFromEuler(this._eul);
        this._s.set(radius, 1, radius);
        this._m.compose(this._p, this._q, this._s);
        this.warnings.setMatrixAt(warningCount, this._m);
        this._c.set(d.telegraphColor || (ranged ? 0xc3f55b : 0xffa24c));
        this._c.multiplyScalar(0.7 + 0.3 * Math.sin(e.timer * 21));
        this.warnings.setColorAt(warningCount++, this._c);
      }

      if (blobs && e.state !== S_DYING) {
        blobs.add(x, z, d.radius * (d.flying ? 2.0 : 2.7));
      }

      counts[e.type] = ci + 1;
    }

    for (let i = 0; i < this.meshes.length; i++) {
      const m = this.meshes[i];
      m.count = counts[i];
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    this.warnings.count = warningCount;
    this.warnings.instanceMatrix.needsUpdate = true;
    if (this.warnings.instanceColor) this.warnings.instanceColor.needsUpdate = true;
  }

  /* nearest live enemy whose body sphere the segment a->b passes through */
  raycast(ax, az, bx, bz, radiusPad, ignoreSet) {
    let best = null, bestT = Infinity;
    const dx = bx - ax, dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-5) return null;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.state === S_DYING) continue;
      if (ignoreSet && ignoreSet.has(e)) continue;
      const rr = e.def.radius + radiusPad;
      const distance = CombatCore.rayCircleHit({ x: ax, z: az }, dx / len, dz / len, len, e, rr);
      if (distance === null) continue;
      const t = distance / len;
      if (t < bestT) { bestT = t; best = e; }
    }
    return best ? { enemy: best, t: clamp(bestT, 0, 1) } : null;
  }

  /* everything inside a radius — used by explosions and the flamethrower */
  queryRadius(x, z, radius, out) {
    out.length = 0;
    const list = this.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.state === S_DYING) continue;
      const rr = radius + e.def.radius;
      if (dist2(x, z, e.x, e.z) <= rr * rr) out.push(e);
    }
    return out;
  }
}
