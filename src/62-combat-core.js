/* Shared deterministic arena simulation. This file deliberately has no DOM,
   rendering, audio, storage or transport dependencies. Both practice and the
   room worker run this exact authority; snapshots are personal views. */
(function (root, factory) {
  const data = typeof module === 'object' && module.exports ? require('./60-weapons.js') : root.ProtocolWeapons;
  const api = factory(data);
  if (typeof module === 'object' && module.exports) module.exports = api;
  root.CombatCore = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function (data) {
  'use strict';
  const VERSION = 1, TILE = 3, BODY_RADIUS = 0.48, HIT_RADIUS = 0.58;
  const WEAPONS = data.WEAPONS, BY_ID = data.WEAPON_BY_ID;
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
  const finite = (v, fallback = 0) => Number.isFinite(v) ? v : fallback;
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
  const angleDelta = (a, b) => Math.atan2(Math.sin(a - b), Math.cos(a - b));
  function randomSource(seed) {
    let s = (Number(seed) || 1) >>> 0;
    return () => { s += 0x6D2B79F5; let v = s; v = Math.imul(v ^ v >>> 15, v | 1); v ^= v + Math.imul(v ^ v >>> 7, v | 61); return ((v ^ v >>> 14) >>> 0) / 4294967296; };
  }
  function meleeStats(w, heavy) { return Object.assign({}, w, heavy && w.heavy || {}); }
  const LOADOUTS = Object.freeze({ assault: ['pistol', 'smg', 'rifle', 'knife'], scout: ['pistol', 'suppressedSmg', 'dmr', 'spear'], heavy: ['pistol', 'lmg', 'doubleBarrel', 'hammer'], specialist: ['pistol', 'crossbow', 'grenadeLauncher', 'machete'] });
  function rayCircleHit(origin, dx, dz, distance, target, radius = HIT_RADIUS) {
    const rx = target.x - origin.x, rz = target.z - origin.z, square = rx * rx + rz * rz;
    if (distance < 0) return null;
    if (square <= radius * radius) return 0;
    const along = rx * dx + rz * dz, perpendicular = square - along * along;
    if (along < 0 || perpendicular > radius * radius) return null;
    const enter = Math.max(0, along - Math.sqrt(Math.max(0, radius * radius - perpendicular)));
    return enter <= distance + 1e-8 ? Math.min(enter, distance) : null;
  }
  function meleeInArc(origin, target, angle, reach, arc, radius = HIT_RADIUS) {
    const distance = Math.sqrt(dist2(origin, target));
    if (distance <= radius) return true;
    return distance <= reach + radius && Math.abs(angleDelta(Math.atan2(target.x - origin.x, target.z - origin.z), angle)) <= arc / 2 + Math.asin(clamp(radius / distance, 0, 1));
  }
  function mitigateDamage(amount, armor, absorption = .6) {
    const absorbed = Math.min(Math.max(0, armor), Math.max(0, amount) * clamp(absorption, 0, 1));
    return { damage: Math.max(0, amount) - absorbed, absorbed, armor: Math.max(0, armor - absorbed) };
  }
  function projectileKinematics(p, dt) {
    const vx = finite(p.vx), vz = finite(p.vz), vy = finite(p.vy) - finite(p.gravity) * dt;
    return { x: finite(p.x) + vx * dt, y: finite(p.y) + vy * dt, z: finite(p.z) + vz * dt, vx, vy, vz };
  }

  function createArenaMap(modeId = 'ffa', seed = 1) {
    const size = modeId === 'duel' ? 24 : modeId === 'royale' ? 40 : 32;
    const grid = new Uint8Array(size * size).fill(1);
    for (let z = 2; z < size - 2; z++) for (let x = 2; x < size - 2; x++) grid[z * size + x] = 0;
    const themes = {
      duel: { title: 'ПОЛИГОН «ВЕКТОР»', code: 'VECTOR-01', accent: 0x64ded2, secondary: 0xefac72 },
      ffa: { title: 'ЛИТЕЙНЫЙ УЗЕЛ', code: 'JUNCTION-07', accent: 0xf0bb6c, secondary: 0x8cacf2 },
      royale: { title: 'РАЙОН ЗАТМЕНИЯ', code: 'DISTRICT-09', accent: 0x89c9d7, secondary: 0xe5aa78 }
    };
    const theme = themes[modeId] || themes.ffa;
    const arenaLayout = Object.assign({ blocks: [], districts: [], lanes: [], extent: (size / 2 - 2) * TILE }, theme);
    const block = (tx, tz, w, d, kind, color, label) => {
      for (let z = tz; z < tz + d; z++) for (let x = tx; x < tx + w; x++) grid[z * size + x] = 1;
      arenaLayout.blocks.push({ tx, tz, tilesW: w, tilesD: d, x: (tx + w / 2 - size / 2) * TILE, z: (tz + d / 2 - size / 2) * TILE, w: w * TILE, d: d * TILE, kind, color, label });
    };
    if (modeId === 'duel') {
      for (const x of [6, 15]) for (const z of [7, 15]) block(x, z, 3, 2, 'cargo', 0x42696b, 'COVER');
      block(3, 11, 2, 2, 'relay', 0x406175, 'A'); block(19, 11, 2, 2, 'relay', 0x79604b, 'B');
      block(10, 4, 4, 1, 'service', 0x3f5964, 'NORTH'); block(10, 19, 4, 1, 'service', 0x3f5964, 'SOUTH');
      for (const z of [-21, 0, 21]) arenaLayout.lanes.push({ x: 0, z, w: 54, d: z === 0 ? 10 : 6 });
      arenaLayout.districts.push({ x: -24, z: 0, w: 10, d: 54, label: 'ALPHA', color: 0x5bcaba }, { x: 24, z: 0, w: 10, d: 54, label: 'BRAVO', color: 0xdba975 });
    } else if (modeId === 'ffa') {
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const tx = sx < 0 ? 7 : size - 12, tz = sz < 0 ? 7 : size - 10, color = sx === sz ? 0x756453 : 0x435d75;
        block(tx, tz, 5, 3, sx === sz ? 'cargo' : 'reactor', color, sx < 0 ? 'FAB-01' : 'FAB-02');
        block(sx < 0 ? 7 : size - 10, sz < 0 ? 10 : size - 14, 3, 4, 'service', color, 'SERVICE');
        arenaLayout.districts.push({ x: sx * 23, z: sz * 23, w: 28, d: 28, label: sx < 0 ? (sz < 0 ? 'ASSEMBLY' : 'LOADING') : (sz < 0 ? 'COOLANT' : 'TURBINE'), color: sx === sz ? 0xcfaa6a : 0x83a9d3 });
      }
      for (const z of [4, 26]) block(14, z, 4, 2, 'relay', 0x645960, 'GRID');
      for (const x of [4, 26]) block(x, 14, 2, 4, 'cargo', 0x4b6164, 'FREIGHT');
      arenaLayout.lanes.push({ x: 0, z: 0, w: 78, d: 12 }, { x: 0, z: 0, w: 12, d: 78 });
    } else {
      const parcels = [[5, 5, 6, 4, 'cargo'], [5, 11, 4, 6, 'service'], [11, 12, 5, 3, 'reactor'], [13, 5, 4, 4, 'relay']];
      let district = 0;
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        const colors = [0x526b7b, 0x7b5d4d, 0x567167, 0x6b627c], names = ['TRANSIT', 'FOUNDRY', 'WATERWORKS', 'SIGNAL'];
        for (const [x, z, w, d, kind] of parcels) block(sx < 0 ? x : size - x - w, sz < 0 ? z : size - z - d, w, d, kind, colors[district], names[district]);
        arenaLayout.districts.push({ x: sx * 30, z: sz * 30, w: 42, d: 42, label: names[district], color: colors[district] }); district++;
      }
      arenaLayout.lanes.push({ x: 0, z: 0, w: 102, d: 13 }, { x: 0, z: 0, w: 13, d: 102 });
    }
    const spawns = [];
    for (const [x, z] of [[3, 3], [size / 2, 3], [size - 4, 3], [size - 4, size - 4], [size / 2, size - 4], [3, size - 4], [3, size / 2], [size - 4, size / 2]]) {
      if (!grid[z * size + x]) spawns.push({ x: (x - size / 2 + .5) * TILE, z: (z - size / 2 + .5) * TILE });
    }
    return { seed, w: size, h: size, tile: TILE, grid, start: { x: -Math.min(18, size - 7), z: 0 }, spawns, spawnPoints: spawns, arenaLayout, arenaName: theme.title, arenaCode: theme.code };
  }

  class GridMap {
    constructor(map) {
      Object.assign(this, map); this.tile = map.tile || TILE;
      this.grid = Uint8Array.from(map.grid); this.floor = [];
      this.halfW = this.w * this.tile / 2; this.halfH = this.h * this.tile / 2;
      this.spawns = map.spawns || map.spawnPoints || [];
      for (let i = 0; i < this.grid.length; i++) if (!this.grid[i]) this.floor.push(i);
      this.neighbors = Array.from({ length: this.grid.length }, (_, i) => {
        if (this.grid[i]) return [];
        const x = i % this.w, z = Math.floor(i / this.w), ns = [];
        if (x > 0 && !this.grid[i - 1]) ns.push(i - 1); if (x + 1 < this.w && !this.grid[i + 1]) ns.push(i + 1);
        if (z > 0 && !this.grid[i - this.w]) ns.push(i - this.w); if (z + 1 < this.h && !this.grid[i + this.w]) ns.push(i + this.w);
        return ns;
      });
    }
    cell(x, z) { return Math.floor((z + this.halfH) / this.tile) * this.w + Math.floor((x + this.halfW) / this.tile); }
    point(i) { return { x: (i % this.w + .5) * this.tile - this.halfW, z: (Math.floor(i / this.w) + .5) * this.tile - this.halfH }; }
    wall(x, z) {
      const tx = Math.floor((x + this.halfW) / this.tile), tz = Math.floor((z + this.halfH) / this.tile);
      return tx < 0 || tz < 0 || tx >= this.w || tz >= this.h || !!this.grid[tz * this.w + tx];
    }
    clear(x, z, radius = BODY_RADIUS) { return !this.wall(x - radius, z - radius) && !this.wall(x + radius, z - radius) && !this.wall(x - radius, z + radius) && !this.wall(x + radius, z + radius); }
    ray(x, z, dx, dz, maxDist) {
      if (this.wall(x, z)) return 0;
      let tx = Math.floor((x + this.halfW) / this.tile), tz = Math.floor((z + this.halfH) / this.tile);
      const sx = dx < 0 ? -1 : 1, sz = dz < 0 ? -1 : 1;
      let nx = Math.abs(dx) < 1e-9 ? Infinity : (((tx + (sx > 0 ? 1 : 0)) * this.tile - this.halfW) - x) / dx;
      let nz = Math.abs(dz) < 1e-9 ? Infinity : (((tz + (sz > 0 ? 1 : 0)) * this.tile - this.halfH) - z) / dz;
      const stepx = Math.abs(this.tile / dx), stepz = Math.abs(this.tile / dz);
      for (let n = 0; n < this.w + this.h + 4; n++) {
        let d;
        if (Math.abs(nx - nz) < 1e-9) {
          d = nx; if (d > maxDist) return maxDist;
          // A corner touched by either neighboring wall blocks both ray
          // directions. Stepping one axis first made visibility asymmetric.
          if (tx + sx < 0 || tx + sx >= this.w || tz + sz < 0 || tz + sz >= this.h || this.grid[tz * this.w + tx + sx] || this.grid[(tz + sz) * this.w + tx]) return Math.max(0, d);
          tx += sx; tz += sz; nx += stepx; nz += stepz;
        } else if (nx < nz) { d = nx; nx += stepx; tx += sx; } else { d = nz; nz += stepz; tz += sz; }
        if (d > maxDist) return maxDist;
        if (tx < 0 || tz < 0 || tx >= this.w || tz >= this.h || this.grid[tz * this.w + tx]) return Math.max(0, d);
      }
      return maxDist;
    }
    los(a, b) { const dx = b.x - a.x, dz = b.z - a.z, d = Math.hypot(dx, dz); return d < .01 || this.ray(a.x, a.z, dx / d, dz / d, d) >= d - .01; }
  }

  // Reused cell buckets avoid the all-pairs sensing and per-ray allocations
  // that previously made adding opponents disproportionately expensive.
  class ActorHash {
    constructor(map) { this.size = 8; this.w = Math.ceil(map.w * map.tile / 8); this.h = Math.ceil(map.h * map.tile / 8); this.ox = map.halfW; this.oz = map.halfH; this.buckets = Array.from({ length: this.w * this.h }, () => []); }
    rebuild(actors) {
      for (const b of this.buckets) b.length = 0;
      for (const a of actors) if (a.alive && !a.spectator) { const x = clamp(Math.floor((a.x + this.ox) / 8), 0, this.w - 1), z = clamp(Math.floor((a.z + this.oz) / 8), 0, this.h - 1); this.buckets[z * this.w + x].push(a); }
    }
    query(x0, z0, x1, z1, out) {
      out.length = 0;
      const lx = clamp(Math.floor((x0 + this.ox) / 8), 0, this.w - 1), hx = clamp(Math.floor((x1 + this.ox) / 8), 0, this.w - 1);
      const lz = clamp(Math.floor((z0 + this.oz) / 8), 0, this.h - 1), hz = clamp(Math.floor((z1 + this.oz) / 8), 0, this.h - 1);
      for (let z = lz; z <= hz; z++) for (let x = lx; x <= hx; x++) for (const a of this.buckets[z * this.w + x]) out.push(a);
      return out;
    }
  }

  function moveBody(a, dx, dz, map) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dz)) / .35));
    for (let i = 0; i < steps; i++) {
      if (map.clear(a.x + dx / steps, a.z)) a.x += dx / steps; else a.vx = 0;
      if (map.clear(a.x, a.z + dz / steps)) a.z += dz / steps; else a.vz = 0;
    }
  }
  // Pure prediction shares authority movement and collision. It intentionally
  // predicts no damage, inventory, pickups, or match result.
  function predictMovement(actor, input, dt, level) {
    const map = level && typeof level.clear === 'function' ? level : new GridMap(level);
    const a = { x: finite(actor.x), z: finite(actor.z), vx: 0, vz: 0, angle: finite(actor.angle), dashCd: finite(actor.dashCd), dashTime: finite(actor.dashTime), dashX: finite(actor.dashX), dashZ: finite(actor.dashZ), dashWasDown: !!actor.dashWasDown, knockX: finite(actor.knockX), knockZ: finite(actor.knockZ) };
    const w = BY_ID[actor.weaponId] || BY_ID.smg;
    let mx = clamp(finite(input.moveX), -1, 1), mz = clamp(finite(input.moveZ), -1, 1), length = Math.hypot(mx, mz);
    if (length > 1) { mx /= length; mz /= length; }
    let left = clamp(finite(dt), 0, .25);
    while (left > 1e-8) {
      const step = Math.min(left, 1 / 60); left -= step;
      a.dashCd = Math.max(0, a.dashCd - step);
      if (Number.isFinite(input.aimX) && Number.isFinite(input.aimZ) && Math.hypot(input.aimX - a.x, input.aimZ - a.z) > .02) a.angle = Math.atan2(input.aimX - a.x, input.aimZ - a.z);
      if (input.dash && !a.dashWasDown && !a.dashCd && length > .05 && !actor.attackPhase) { a.dashCd = 1.5; a.dashTime = .16; a.dashX = mx; a.dashZ = mz; }
      const speed = 7.4 * (input.sprint && !input.fire && !input.aim ? 1.42 : 1) * (input.aim && w.fire !== 'melee' ? .67 : 1) * (w.moveScale || 1) * (actor.attackPhase === 'windup' ? .65 : 1) * finite(actor.speedScale, 1);
      a.vx = (a.dashTime > 0 ? a.dashX * 24 : mx * speed) + a.knockX; a.vz = (a.dashTime > 0 ? a.dashZ * 24 : mz * speed) + a.knockZ;
      moveBody(a, a.vx * step, a.vz * step, map);
      a.dashTime = Math.max(0, a.dashTime - step); a.knockX *= Math.exp(-9 * step); a.knockZ *= Math.exp(-9 * step); a.dashWasDown = !!input.dash;
    }
    return a;
  }

  const BOT_SKILL = Object.freeze({ easy: { sense: .34, reaction: .3, error: .11, retreatHp: 25, reloadFraction: .12, strafe: .35 }, normal: { sense: .22, reaction: .19, error: .058, retreatHp: 40, reloadFraction: .25, strafe: .6 }, hard: { sense: .15, reaction: .11, error: .027, retreatHp: 55, reloadFraction: .35, strafe: .8 } });
  const NEUTRAL = Object.freeze({ seq: -1, moveX: 0, moveZ: 0, aimX: 0, aimZ: 1, fire: false, altFire: false, reload: false, dash: false, sprint: false, aim: false, slot: null, interact: false, heal: false, spectate: false });

  class World {
    constructor(options = {}) {
      this.modeId = ['duel', 'ffa', 'royale'].includes(options.modeId) ? options.modeId : 'ffa';
      this.seed = (finite(options.seed, 1) >>> 0) || 1; this.rng = randomSource(this.seed);
      this.capacity = this.modeId === 'duel' ? 2 : clamp(Math.floor(finite(options.capacity, 32)), 2, 128);
      this.difficulty = BOT_SKILL[options.difficulty] ? options.difficulty : 'normal'; this.skill = BOT_SKILL[this.difficulty];
      this.map = new GridMap(options.level || createArenaMap(this.modeId, this.seed)); this.level = this.map;
      this.actors = new Map(); this.members = this.actors; this.list = [];
      this.projectiles = []; this.loot = []; this.events = []; this._eventId = 0; this._projectileId = 0; this._lootId = 0;
      this.tick = 0; this.time = 0; this.elapsed = 0; this._accumulator = 0; this.phase = 'waiting'; this.countdown = 0; this.round = 0; this.roundElapsed = 0; this.result = null;
      this.target = this.modeId === 'duel' ? 5 : 20; this.duration = this.modeId === 'royale' ? 480 : this.modeId === 'duel' ? 900 : 300;
      this.remaining = this.duration; this.zone = null; this.started = false; this.paused = false;
      this.sharedLoadout = this._normalizeLoadout(options.loadout); this.hasSharedLoadout = options.loadout !== undefined;
      const loadoutRng = randomSource(this.seed ^ 0x524f554e);
      const guns = WEAPONS.filter(w => w.slot === 'primary').map(w => w.id), melee = WEAPONS.filter(w => w.slot === 'melee').map(w => w.id);
      for (let i = guns.length - 1; i > 0; i--) { const j = Math.floor(loadoutRng() * (i + 1)); [guns[i], guns[j]] = [guns[j], guns[i]]; }
      this.duelLoadouts = Array.from({ length: guns.length }, (_, i) => ['pistol', guns[i], guns[(i + 1) % guns.length], melee[Math.floor(loadoutRng() * melee.length)]]);
      this._damage = []; this._candidates = []; this._rayCandidates = []; this._meleeCandidates = []; this._spawnCandidates = [];
      this._hash = new ActorHash(this.map); this._pathQueue = new Int32Array(this.map.grid.length); this._pathPrev = new Int32Array(this.map.grid.length); this._pathStamp = new Uint32Array(this.map.grid.length); this._pathGeneration = 0;
      this.metrics = { steps: 0, sensePasses: 0, losChecks: 0, candidateChecks: 0, pathSearches: 0, pathExpansions: 0, maxPathSearchesPerStep: 0, maxPathExpansionsPerStep: 0 };
      this._pathsThisStep = 0; this._expansionsThisStep = 0;
      this._zoneStages = this._makeZoneStages();
      if (this.modeId === 'royale') this._seedLoot();
      const botCount = clamp(Math.floor(finite(options.botCount, 0)), 0, this.capacity - 1);
      for (let i = 0; i < botCount; i++) this.addPlayer({ id: 'bot-' + (i + 1), name: ['VEX', 'KIRA', 'ECHO', 'RIFT', 'JUNO', 'GHOST', 'ION', 'ONYX'][i % 8] + (i >= 8 ? ' ' + (i + 1) : ''), bot: true });
    }
    _normalizeLoadout(loadout) {
      const source = Array.isArray(loadout) ? loadout : typeof loadout === 'string' && LOADOUTS[loadout] ? LOADOUTS[loadout] : loadout && typeof loadout === 'object' ? [loadout.primary, loadout.secondary, loadout.sidearm, loadout.melee] : [];
      const selected = typeof loadout === 'string' && loadout.startsWith('weapon:') ? BY_ID[loadout.slice(7)] : null;
      const result = { primary: [], sidearm: 'pistol', melee: 'knife' };
      for (const id of selected ? [selected.id] : source) if (BY_ID[id]) {
        const slot = BY_ID[id].slot || 'primary';
        if (slot === 'primary') { if (!result.primary.includes(id) && result.primary.length < 2) result.primary.push(id); }
        else result[slot] = id;
      }
      for (const id of ['smg', 'rifle']) if (result.primary.length < 2 && !result.primary.includes(id)) result.primary.push(id);
      return [result.sidearm, ...result.primary, result.melee];
    }
    addPlayer({ id, name = 'PLAYER', bot = false, loadout, spectator = false } = {}) {
      if (typeof id !== 'string' || !id || this.actors.has(id)) return null;
      if (this.modeId === 'duel' && !bot && !this.started && !this.hasSharedLoadout && loadout !== undefined) {
        this.sharedLoadout = this._normalizeLoadout(loadout); this.hasSharedLoadout = true;
        for (const member of this.list) member.loadout = this.sharedLoadout.slice();
      }
      let pending = false;
      if (this.list.filter(a => !a.spectator).length >= this.capacity) {
        if (bot || this.modeId === 'duel') return null;
        if (this.modeId === 'ffa') {
          const vacancy = this.list.find(a => a.bot && !a.alive);
          if (vacancy) this.removePlayer(vacancy.id);
          else if (this.list.some(a => a.bot) && this.list.filter(a => a.pending).length < this.list.filter(a => a.bot).length) pending = true;
          else return null;
        } else if (this.list.filter(a => a.spectator).length >= 32) return null;
      }
      const index = this.list.length, late = this.started && this.modeId === 'royale';
      const a = { id, name: String(name).replace(/[\x00-\x1f]/g, '').slice(0, 32), bot: !!bot, x: 0, z: 0, vx: 0, vz: 0, angle: 0,
        hp: 100, maxHp: 100, armor: 0, alive: !spectator && !late && !pending, spectator: !!spectator || late || pending, pending, weaponId: 'smg', owned: {}, mags: {}, ammo: {}, weaponSlots: [], score: 0, deaths: 0, kills: 0,
        spawnProtection: 0, dashCd: 0, dashTime: 0, reloading: 0, reloadTotal: 0, attackPhase: null, attackTimer: 0, attack: null, fireCd: 0, burstRemaining: 0, burstTimer: 0, spin: 0,
        medkits: 0, healing: 0, respawnIn: 0, placement: null, spectateId: null, shotSeq: 0, damageDealt: 0, input: { ...NEUTRAL }, pendingActions: {}, firePressed: false, altPressed: false, lastInputAt: -100, processedSeq: -1, fireWasDown: false, dashWasDown: false,
        loadout: this.modeId === 'duel' ? this.sharedLoadout.slice() : this._normalizeLoadout(loadout), lastDamageAt: -100, burn: 0, burnOwner: null, knockX: 0, knockZ: 0,
        brain: { senseIn: index % 7 * .025, targetId: null, seenAt: -100, reactionAt: 0, lastKnown: null, goal: null, path: [], pathCursor: 0, pathGoal: -1, progressAt: 0, progressX: 0, progressZ: 0, wanderAt: 0, aimError: 0, strafe: index % 2 ? 1 : -1, healUntil: 0, coverGoal: null, coverUntil: 0, coverSearchAt: 0, weaponAt: 0, weaponSlot: null } };
      this.actors.set(id, a); this.list.push(a);
      this._equip(a); if (a.alive) this._spawn(a);
      this._hash.rebuild(this.list);
      this._event('join', { actorId: id, name: a.name, spectator: a.spectator });
      return a;
    }
    removePlayer(id) {
      const a = this.actors.get(id); if (!a) return false;
      if (this.started && a.alive && !a.spectator) { a.alive = false; a.placement = this.list.filter(p => p.alive && !p.spectator).length + 1; this._event('death', { actorId: id, killerId: null, reason: 'disconnect' }); }
      this.actors.delete(id); this.list.splice(this.list.indexOf(a), 1); this._hash.rebuild(this.list);
      this._event('leave', { actorId: id });
      if (this.started && this.modeId !== 'ffa' && !this.result) {
        const remaining = this.list.filter(p => !p.spectator && (this.modeId === 'duel' || p.alive));
        if (remaining.length <= 1) this.finish(remaining[0] ? [remaining[0].id] : [], 'disconnect');
      }
      return true;
    }
    setInput(id, input = {}) {
      const a = this.actors.get(id); if (!a || a.bot || !input || typeof input !== 'object') return false;
      const seq = input.seq === undefined ? a.input.seq + 1 : input.seq;
      if (!Number.isSafeInteger(seq) || seq <= a.input.seq) return false;
      if (input.fire === true && !a.input.fire) a.firePressed = true;
      if ((input.altFire === true || input.aim === true) && !a.input.altFire && !a.input.aim) a.altPressed = true;
      let mx = clamp(finite(input.moveX), -1, 1), mz = clamp(finite(input.moveZ), -1, 1); const length = Math.hypot(mx, mz);
      if (length > 1) { mx /= length; mz /= length; }
      const bool = k => input[k] === true;
      a.input = { seq, moveX: mx, moveZ: mz, aimX: clamp(finite(input.aimX, a.x + Math.sin(a.angle) * 10), -10000, 10000), aimZ: clamp(finite(input.aimZ, a.z + Math.cos(a.angle) * 10), -10000, 10000),
        fire: bool('fire'), altFire: bool('altFire'), reload: bool('reload'), dash: bool('dash'), sprint: bool('sprint'), aim: bool('aim'), interact: bool('interact'), heal: bool('heal'), spectate: input.spectate === true || input.spectate === 1 || input.spectate === -1 ? input.spectate : false,
        slot: typeof input.slot === 'string' && input.slot.length < 32 ? input.slot : Number.isInteger(input.slot) && input.slot >= 0 && input.slot < 4 ? input.slot : null };
      for (const key of ['reload', 'dash', 'interact', 'heal']) if (a.input[key]) a.pendingActions[key] = true;
      if (a.input.slot !== null) a.pendingActions.slot = a.input.slot;
      if (a.input.spectate) a.pendingActions.spectate = a.input.spectate;
      if (this.modeId === 'ffa' && (typeof input.loadout === 'string' && input.loadout.length < 64 || Array.isArray(input.loadout) && input.loadout.length <= 4)) a.loadout = this._normalizeLoadout(input.loadout);
      a.lastInputAt = this.time; return true;
    }
    start() {
      if (this.started || this.result || this.list.filter(a => !a.spectator).length < 2) return false;
      this.started = true; this.startedAt = this.time; this.round = 1; this.phase = 'countdown'; this.countdown = 3;
      this._prepareDuelLoadout();
      for (const a of this.list) if (!a.spectator) { a.alive = true; this._equip(a); this._spawn(a); }
      this._hash.rebuild(this.list); this._event('phase', { phase: this.phase, round: this.round }); return true;
    }
    duelRoundLoadout(round) { return (round <= 1 && this.hasSharedLoadout ? this.sharedLoadout : this.duelLoadouts[(Math.max(1, round) - 1) % this.duelLoadouts.length]).slice(); }
    _prepareDuelLoadout() { if (this.modeId === 'duel') for (const a of this.list) a.loadout = this.duelRoundLoadout(this.round); }
    _equip(a) {
      a.owned = {}; a.mags = {}; a.ammo = {}; a.weaponSlots = [];
      for (const w of WEAPONS) if (w.ammo !== 'none') a.ammo[w.ammo] = 0;
      if (this.modeId === 'royale') a.ammo.pistol = 42;
      const ids = this.modeId === 'royale' ? ['pistol', 'knife'] : a.loadout;
      for (const id of ids) this.giveWeapon(a.id, id, false);
      a.weaponId = this.modeId === 'royale' ? 'pistol' : ids[1]; a.armor = this.modeId === 'royale' ? 0 : 30; a.medkits = this.modeId === 'royale' ? 1 : 0;
    }
    giveWeapon(actorId, weaponId, replace = true) {
      const a = this.actors.get(actorId), w = BY_ID[weaponId]; if (!a || !w) return false;
      if (replace && !a.owned[weaponId]) {
        const sameSlot = a.weaponSlots.filter(id => BY_ID[id].slot === w.slot), limit = w.slot === 'primary' ? 2 : 1;
        if (sameSlot.length >= limit) {
          const oldId = sameSlot.includes(a.weaponId) ? a.weaponId : sameSlot[sameSlot.length - 1];
          delete a.owned[oldId]; delete a.mags[oldId]; a.weaponSlots.splice(a.weaponSlots.indexOf(oldId), 1);
        }
      }
      if (!a.owned[weaponId]) a.weaponSlots.push(weaponId);
      a.weaponSlots.sort((x, y) => ['sidearm', 'primary', 'melee'].indexOf(BY_ID[x].slot) - ['sidearm', 'primary', 'melee'].indexOf(BY_ID[y].slot));
      a.owned[weaponId] = true; a.mags[weaponId] = w.mag || 0;
      if (w.ammo !== 'none') a.ammo[w.ammo] = Math.min(data.AMMO_TYPES[w.ammo]?.max || 999, (a.ammo[w.ammo] || 0) + (w.mag || 0) * 3);
      if (replace) { a.weaponId = weaponId; a.reloading = 0; a.attack = null; a.attackPhase = null; a.burstRemaining = 0; }
      return true;
    }
    _spawn(a) {
      let p;
      if (this.modeId === 'duel') {
        const index = this.list.filter(v => !v.spectator).indexOf(a), flip = this.round % 2 === 0 ? -1 : 1;
        p = { x: (index ? 1 : -1) * 22.5 * flip, z: (index ? 1 : -1) * 7.5 * flip };
        if (!this.map.clear(p.x, p.z)) p = this.map.spawns[index % this.map.spawns.length];
      } else {
        let best = -Infinity; p = this.map.point(this.map.floor[0]);
        const count = Math.min(40, this.map.floor.length);
        for (let i = 0; i < count; i++) {
          const point = i < this.map.spawns.length ? this.map.spawns[i] : this.map.point(this.map.floor[Math.floor(this.rng() * this.map.floor.length)]);
          if (this.zone && Math.hypot(point.x - this.zone.x, point.z - this.zone.z) > this.zone.radius - 2) continue;
          let score = 10000;
          for (const other of this.list) if (other !== a && other.alive && !other.spectator) { const d = dist2(point, other); score = Math.min(score, d); if (d < 400 && this.map.los(point, other)) score -= 240; }
          score += this.rng() * 12; if (score > best) { best = score; p = point; }
        }
      }
      a.x = p.x; a.z = p.z; a.vx = 0; a.vz = 0; a.hp = a.maxHp; a.alive = true; a.respawnIn = 0; a.spectateId = null; a.spawnProtection = this.modeId === 'ffa' ? 1.5 : 0;
      a.angle = Math.atan2(-a.x, -a.z); a.dashCd = 0; a.dashTime = 0; a.reloading = 0; a.fireCd = 0; a.burstRemaining = 0; a.attack = null; a.attackPhase = null; a.healing = 0; a.burn = 0; a.knockX = 0; a.knockZ = 0;
      a.brain.coverGoal = null; a.brain.coverUntil = 0; a.brain.weaponSlot = null; a.brain.weaponAt = 0;
      a.brain.path.length = 0; a.brain.pathGoal = -1; a.brain.progressAt = this.time; a.brain.progressX = a.x; a.brain.progressZ = a.z; a.brain.targetId = null; a.brain.lastKnown = null; a.brain.goal = null;
      a.pendingActions = {}; a.firePressed = false; a.altPressed = false;
      this._event('spawn', { actorId: a.id, x: a.x, z: a.z });
    }
    step(dt = 1 / 60) {
      if (!Number.isFinite(dt) || dt <= 0 || this.paused || this.result) return;
      // Catch up boundedly after a scheduling hiccup; never integrate a large
      // projectile/movement leap through cover.
      this._accumulator += Math.min(dt, .25);
      while (this._accumulator + 1e-10 >= 1 / 60 && !this.result) { this._accumulator = Math.max(0, this._accumulator - 1 / 60); this._step(1 / 60); }
    }
    _step(dt) {
      this.tick++; this.time += dt; this.metrics.steps++; this._pathsThisStep = 0; this._expansionsThisStep = 0;
      if (this.phase === 'waiting') { this.start(); return; }
      if (this.modeId === 'duel' && this.time - this.startedAt >= this.duration) { this._finishByScore('time'); return; }
      if (this.phase === 'countdown' || this.phase === 'roundBreak') {
        for (const a of this.list) { a.pendingActions = {}; a.firePressed = false; a.altPressed = false; a.processedSeq = a.input.seq; }
        this.countdown = Math.max(0, this.countdown - dt);
        if (this.countdown <= 1e-8) {
          if (this.phase === 'roundBreak') { this.round++; this._prepareDuelLoadout(); for (const a of this.list) if (!a.spectator) { this._equip(a); this._spawn(a); } this.projectiles.length = 0; this.phase = 'countdown'; this.countdown = 2; }
          else { this.phase = 'active'; this.roundElapsed = 0; }
          this._event('phase', { phase: this.phase, round: this.round });
        }
        return;
      }
      this.elapsed += dt; this.roundElapsed += dt; this.remaining = Math.max(0, this.duration - (this.modeId === 'duel' ? this.time - this.startedAt : this.elapsed));
      this._updateZone(); this._hash.rebuild(this.list);
      for (const a of this.list) {
        if (a.bot && a.alive) this._botInput(a, dt);
        else if (this.time - a.lastInputAt > .4) { a.input = { ...NEUTRAL, seq: a.input.seq }; a.pendingActions = {}; a.firePressed = false; a.altPressed = false; }
        this._updateActor(a, dt);
      }
      this._hash.rebuild(this.list);
      for (const a of this.list) if (a.alive && !a.spectator) this._combat(a, dt);
      this._updateProjectiles(dt); this._commitDamage(); this._resolveRules();
      if (this.modeId === 'ffa' && this.list.some(a => a.pending)) {
        for (const waiting of this.list.filter(a => a.pending)) {
          const retiring = this.list.find(a => a.bot && !a.alive);
          const vacancy = this.list.filter(a => !a.spectator).length < this.capacity;
          if (!retiring && !vacancy) break;
          if (!vacancy) this.removePlayer(retiring.id);
          waiting.pending = false; waiting.spectator = false; this._equip(waiting); this._spawn(waiting);
        }
      }
      this.metrics.maxPathSearchesPerStep = Math.max(this.metrics.maxPathSearchesPerStep, this._pathsThisStep);
      this.metrics.maxPathExpansionsPerStep = Math.max(this.metrics.maxPathExpansionsPerStep, this._expansionsThisStep);
      // Events survive multiple clients' reads and are deduplicated by id.
      while (this.events.length && (this.events.length > 512 || this.time - this.events[0].time > 2)) this.events.shift();
    }
    _updateActor(a, dt) {
      const input = a.bot ? a.input : { ...a.input, ...a.pendingActions }, fresh = input.seq > a.processedSeq;
      a.pendingActions = {};
      if (!a.alive || a.spectator) {
        if (fresh && input.spectate) this._cycleSpectator(a, input.spectate === -1 ? -1 : 1);
        a.processedSeq = input.seq;
        if (this.modeId === 'ffa' && !a.spectator) { a.respawnIn = Math.max(0, a.respawnIn - dt); if (!a.respawnIn) { this._equip(a); this._spawn(a); } }
        return;
      }
      a.spawnProtection = Math.max(0, a.spawnProtection - dt); a.fireCd = Math.max(0, a.fireCd - dt);
      if (fresh && input.slot !== null && !a.attack) {
        const id = typeof input.slot === 'number' ? a.weaponSlots[input.slot] : a.owned[input.slot] ? input.slot : a.weaponSlots.find(w => BY_ID[w].slot === input.slot);
        if (id && id !== a.weaponId) { a.weaponId = id; a.reloading = 0; a.burstRemaining = 0; a.spin = 0; a.fireCd = Math.max(a.fireCd, .18); this._interruptHeal(a); }
      }
      if (Math.hypot(input.aimX - a.x, input.aimZ - a.z) > .02) a.angle = Math.atan2(input.aimX - a.x, input.aimZ - a.z);
      const moving = Math.hypot(input.moveX, input.moveZ) > .05;
      if (input.fire || input.altFire || moving || input.dash) this._interruptHeal(a);
      if (fresh && input.heal && a.medkits > 0 && a.hp < a.maxHp && !a.healing && !input.fire && !moving && this.time - a.lastDamageAt > .15) { a.healing = 3; this._event('heal', { actorId: a.id, phase: 'start' }); }
      if (a.healing > 0) { a.healing -= dt; if (a.healing <= 0) { a.medkits--; a.hp = Math.min(a.maxHp, a.hp + 65); a.healing = 0; this._event('heal', { actorId: a.id, phase: 'complete' }); } }
      const w = BY_ID[a.weaponId], oldDash = a.dashCd;
      a.speedScale = 1;
      Object.assign(a, predictMovement(a, input, dt, this.map));
      if (!oldDash && a.dashCd > 1) this._event('dash', { actorId: a.id, x: a.x, z: a.z, angle: Math.atan2(input.moveX, input.moveZ) });
      if (a.burn > 0) { a.burn = Math.max(0, a.burn - dt); this._queueDamage(a, 5 * dt, a.burnOwner, 'burn'); }
      if (this.zone && Math.hypot(a.x - this.zone.x, a.z - this.zone.z) > this.zone.radius) this._queueDamage(a, this.zone.damage * dt, null, 'zone');
      if (this.modeId === 'royale') this._pickups(a, fresh && input.interact);
      if (fresh && input.reload) this._reload(a);
      if (a.reloading > 0) {
        a.reloading -= dt;
        if (a.reloading <= 0) {
          if (w.shellReload) { this._loadAmmo(a, w, 1); if (a.mags[w.id] < w.mag && this._hasReserve(a, w)) a.reloading = w.shellTime || w.reload; else a.reloading = 0; }
          else { this._loadAmmo(a, w, w.mag - a.mags[w.id]); a.reloading = 0; }
        }
      }
      a.processedSeq = input.seq; a.dashWasDown = input.dash;
    }
    _move(a, dx, dz) {
      moveBody(a, dx, dz, this.map);
    }
    _interruptHeal(a) { if (a.healing > 0) { a.healing = 0; this._event('heal', { actorId: a.id, phase: 'cancel' }); } }
    _hasReserve(a, w) { return w.ammo === 'none' ? this.modeId !== 'royale' || (a.ammo.pistol || 0) > 0 : (a.ammo[w.ammo] || 0) > 0; }
    _loadAmmo(a, w, n) {
      const ammo = w.ammo === 'none' && this.modeId === 'royale' ? 'pistol' : w.ammo, unlimited = ammo === 'none';
      const count = Math.min(n, unlimited ? n : a.ammo[ammo] || 0); a.mags[w.id] = (a.mags[w.id] || 0) + count; if (!unlimited) a.ammo[ammo] -= count;
    }
    _reload(a) {
      const w = BY_ID[a.weaponId]; if (w.usesAmmo === false || a.reloading > 0 || a.attack || a.mags[w.id] >= w.mag || !this._hasReserve(a, w)) return false;
      a.reloadTotal = w.reload; a.reloading = w.reload; a.burstRemaining = 0; this._event('reload', { actorId: a.id, weaponId: w.id, duration: w.reload }); return true;
    }
    _combat(a, dt) {
      const w = BY_ID[a.weaponId], trigger = a.input.fire || a.firePressed || (w.fire === 'melee' && (a.input.altFire || a.input.aim || a.altPressed)), heavy = a.input.altFire || a.input.aim || a.altPressed;
      a.firePressed = false; a.altPressed = false;
      if (a.attack) { this._updateMelee(a, dt); a.fireWasDown = trigger; return; }
      if (w.spinUp) a.spin = clamp(a.spin + (trigger ? dt / w.spinUp : -dt * 2), 0, 1);
      if (a.burstRemaining > 0 && !a.reloading) { a.burstTimer -= dt; if (a.burstTimer <= 0 && a.mags[w.id] > 0) { this._fire(a, w); a.burstRemaining--; a.burstTimer += w.burstInterval || .075; } }
      if (trigger && (!a.fireWasDown || w.auto) && a.fireCd <= 1e-8 && !a.healing && (!w.spinUp || a.spin >= 1)) {
        if (a.reloading && w.shellReload && a.mags[w.id] > 0) a.reloading = 0;
        if (!a.reloading) {
          if (w.fire === 'melee') this._startMelee(a, w, heavy);
          else if (a.mags[w.id] > 0) { this._fire(a, w); a.fireCd = w.interval; if (w.burstCount) { a.burstRemaining = w.burstCount - 1; a.burstTimer = w.burstInterval; } }
          else this._reload(a);
        }
      }
      a.fireWasDown = trigger;
    }
    _damageValue(w, kind = 'damage') {
      const field = kind === 'splash' ? 'pvpSplash' : 'pvpDamage';
      if (Number.isFinite(w[field])) return w[field];
      const scale = w.id === 'railgun' ? .22 : w.fire === 'melee' ? .55 : w.fire === 'arc' ? .55 : kind === 'splash' ? .5 : .75;
      return (w[kind] || 0) * scale;
    }
    _fire(a, w) {
      a.mags[w.id]--; a.spawnProtection = 0; a.shotSeq++; this._interruptHeal(a);
      const spread = (w.spread || 0) * (a.input.aim ? .43 : 1) * (Math.hypot(a.vx, a.vz) > 3 ? 1.13 : 1), segments = [];
      if (w.fire === 'projectile') {
        const angle = a.angle + (this.rng() - .5) * spread * 2, dx = Math.sin(angle), dz = Math.cos(angle);
        const offset = Math.min(.65, this.map.ray(a.x, a.z, dx, dz, .65) * .8);
        const p = { id: 'p-' + ++this._projectileId, ownerId: a.id, weaponId: w.id, x: a.x + dx * offset, z: a.z + dz * offset, y: 1.1, vx: dx * w.projSpeed, vz: dz * w.projSpeed,
          vy: w.projectileKind === 'grenade' ? 4.5 : 0, life: w.fuse || w.range / w.projSpeed, gravity: w.projGravity || 0, kind: w.projectileKind || 'rocket', born: this.time };
        this.projectiles.push(p); this._event('projectile', { projectileId: p.id, actorId: a.id, weaponId: w.id, x: p.x, y: p.y, z: p.z, vx: p.vx, vz: p.vz });
      } else if (w.fire === 'flame') {
        this._hash.query(a.x - w.range, a.z - w.range, a.x + w.range, a.z + w.range, this._rayCandidates);
        for (const target of this._rayCandidates) if (target !== a && dist2(a, target) <= w.range ** 2 && Math.abs(angleDelta(Math.atan2(target.x - a.x, target.z - a.z), a.angle)) < (w.spread || .2) + .08 && this.map.los(a, target)) {
          this._queueDamage(target, this._damageValue(w) * w.interval, a.id, 'flame'); target.burn = Math.min(w.burn || 1, 2.5); target.burnOwner = a.id;
        }
        const reach = this.map.ray(a.x, a.z, Math.sin(a.angle), Math.cos(a.angle), w.range);
        segments.push({ x: a.x, z: a.z, toX: a.x + Math.sin(a.angle) * reach, toZ: a.z + Math.cos(a.angle) * reach });
      } else {
        const pellets = w.fire === 'spread' ? w.pellets || 1 : 1;
        let chainOrigin = null;
        for (let i = 0; i < pellets; i++) {
          const angle = a.angle + (this.rng() - .5) * spread * 2, dx = Math.sin(angle), dz = Math.cos(angle);
          const wall = this.map.ray(a.x, a.z, dx, dz, w.range), hits = this._rayHits(a, dx, dz, wall, a.id);
          let end = wall; const maxHits = 1 + (w.pierce || 0);
          for (let h = 0; h < Math.min(hits.length, maxHits); h++) {
            const hit = hits[h], falloff = w.fire === 'spread' ? clamp(1 - hit.distance / (w.range * 1.4), .35, 1) : 1;
            this._queueDamage(hit.actor, this._damageValue(w) * falloff, a.id, w.fire); chainOrigin = hit.actor;
            if (h === maxHits - 1 || w.fire === 'arc') { end = hit.distance; break; }
          }
          segments.push({ x: a.x, z: a.z, toX: a.x + dx * end, toZ: a.z + dz * end });
        }
        if (w.fire === 'arc' && chainOrigin) {
          const used = new Set([a.id, chainOrigin.id]); let origin = chainOrigin;
          for (let i = 0; i < (w.chain || 0); i++) {
            this._hash.query(origin.x - w.chainRange, origin.z - w.chainRange, origin.x + w.chainRange, origin.z + w.chainRange, this._rayCandidates);
            let target = null, nearest = w.chainRange ** 2;
            for (const candidate of this._rayCandidates) if (!used.has(candidate.id) && dist2(candidate, origin) < nearest && this.map.los(origin, candidate)) { target = candidate; nearest = dist2(candidate, origin); }
            if (!target) break;
            this._queueDamage(target, this._damageValue(w) * (w.chainFalloff || .7) ** (i + 1), a.id, 'arc'); segments.push({ x: origin.x, z: origin.z, toX: target.x, toZ: target.z }); used.add(target.id); origin = target;
          }
        }
      }
      this._event('shot', { actorId: a.id, weaponId: w.id, x: a.x, z: a.z, angle: a.angle, segments });
      this._hearShot(a, w);
    }
    _rayHits(origin, dx, dz, distance, ignoreId) {
      this._hash.query(Math.min(origin.x, origin.x + dx * distance) - HIT_RADIUS, Math.min(origin.z, origin.z + dz * distance) - HIT_RADIUS, Math.max(origin.x, origin.x + dx * distance) + HIT_RADIUS, Math.max(origin.z, origin.z + dz * distance) + HIT_RADIUS, this._rayCandidates);
      const hits = [];
      for (const actor of this._rayCandidates) {
        if (actor.id === ignoreId || !actor.alive) continue;
        const enter = rayCircleHit(origin, dx, dz, distance, actor);
        if (enter !== null) hits.push({ actor, distance: enter });
      }
      hits.sort((a, b) => a.distance - b.distance); return hits;
    }
    _startMelee(a, w, heavy) {
      const spec = meleeStats(w, heavy); a.spawnProtection = 0; a.attack = { spec, heavy: !!heavy, hits: new Set(), age: 0, angle: a.angle }; a.attackPhase = 'windup'; a.attackTimer = spec.windup; a.shotSeq++;
      this._event('melee', { actorId: a.id, weaponId: w.id, heavy: !!heavy, phase: 'windup', angle: a.angle, duration: spec.windup });
    }
    _updateMelee(a, dt) {
      const attack = a.attack, spec = attack.spec; attack.age += dt;
      const phase = attack.age < spec.windup ? 'windup' : attack.age < spec.windup + spec.activeTime ? 'active' : 'recovery';
      if (phase !== a.attackPhase) { a.attackPhase = phase; this._event('melee', { actorId: a.id, weaponId: a.weaponId, heavy: attack.heavy, phase, angle: attack.angle }); }
      a.attackTimer = Math.max(0, spec.windup + spec.activeTime + spec.recovery - attack.age);
      if (phase === 'active') {
        this._hash.query(a.x - spec.reach - HIT_RADIUS, a.z - spec.reach - HIT_RADIUS, a.x + spec.reach + HIT_RADIUS, a.z + spec.reach + HIT_RADIUS, this._meleeCandidates);
        this._meleeCandidates.sort((x, y) => dist2(a, x) - dist2(a, y));
        for (const target of this._meleeCandidates) {
          if (target === a || attack.hits.has(target.id) || attack.hits.size >= spec.maxTargets || dist2(a, target) > (spec.reach + HIT_RADIUS) ** 2) continue;
          const targetAngle = Math.atan2(target.x - a.x, target.z - a.z);
          if (!meleeInArc(a, target, attack.angle, spec.reach, spec.arc) || !this.map.los(a, target)) continue;
          attack.hits.add(target.id); this._queueDamage(target, this._damageValue(spec), a.id, 'melee');
          target.knockX += Math.sin(targetAngle) * (spec.knock || 0); target.knockZ += Math.cos(targetAngle) * (spec.knock || 0);
        }
      }
      if (attack.age >= spec.windup + spec.activeTime + spec.recovery) { a.attack = null; a.attackPhase = null; a.attackTimer = 0; a.fireCd = .04; }
    }
    _updateProjectiles(dt) {
      for (let i = this.projectiles.length - 1; i >= 0; i--) {
        const p = this.projectiles[i], w = BY_ID[p.weaponId], motion = projectileKinematics(p, dt); p.life -= dt; p.vy = motion.vy; p.y = motion.y;
        const distance = Math.hypot(p.vx, p.vz) * dt, dx = distance ? p.vx * dt / distance : 0, dz = distance ? p.vz * dt / distance : 0;
        const wall = this.map.ray(p.x, p.z, dx, dz, distance), hits = p.y < 2.4 ? this._rayHits(p, dx, dz, wall, p.ownerId) : [];
        let hit = hits[0], removed = false;
        if (hit && p.kind !== 'grenade') { p.x += dx * hit.distance; p.z += dz * hit.distance; this._queueDamage(hit.actor, this._damageValue(w), p.ownerId, 'projectile'); removed = true; }
        else if (wall < distance - .001) {
          p.x += dx * Math.max(0, wall - .04); p.z += dz * Math.max(0, wall - .04);
          if (p.kind === 'grenade') { if (this.map.wall(p.x + dx * .12, p.z)) p.vx *= -(w.bounce || .45); if (this.map.wall(p.x, p.z + dz * .12)) p.vz *= -(w.bounce || .45); p.vx *= .85; p.vz *= .85; }
          else removed = true;
        } else { p.x = motion.x; p.z = motion.z; }
        if (p.y < .12) { p.y = .12; p.vy = Math.abs(p.vy) * (w.bounce || .45); p.vx *= .8; p.vz *= .8; }
        if (p.life <= 0) removed = true;
        if (removed) { if (w.splash > 0) this._explode(p, w); else this._event('impact', { actorId: p.ownerId, weaponId: w.id, x: p.x, z: p.z }); this.projectiles.splice(i, 1); }
      }
    }
    _explode(p, w) {
      const radius = w.splashRadius; this._hash.query(p.x - radius, p.z - radius, p.x + radius, p.z + radius, this._candidates);
      for (const target of this._candidates) { const distance = Math.sqrt(dist2(p, target)); if (distance < radius && this.map.los(p, target)) this._queueDamage(target, this._damageValue(w, 'splash') * (1 - distance / radius) * (target.id === p.ownerId ? .65 : 1), p.ownerId, 'explosion'); }
      this._event('explosion', { actorId: p.ownerId, weaponId: w.id, x: p.x, z: p.z, radius });
    }
    _queueDamage(target, amount, sourceId, kind) {
      if (!target || !target.alive || target.spectator || !Number.isFinite(amount) || amount <= 0) return;
      if (kind !== 'zone' && (target.spawnProtection > 0 || target.dashTime > 0)) return;
      this._damage.push({ target, amount, sourceId, kind });
    }
    damage(id, amount, sourceId = null, kind = 'debug') { this._queueDamage(this.actors.get(id), amount, sourceId, kind); }
    _commitDamage() {
      const killed = [];
      for (const hit of this._damage) {
        const a = hit.target, { absorbed, damage, armor } = mitigateDamage(hit.amount, a.armor, hit.kind === 'zone' ? 0 : .6);
        a.armor = armor; a.hp = Math.max(0, a.hp - damage); a.lastDamageAt = this.time; this._interruptHeal(a);
        if (hit.sourceId && hit.sourceId !== a.id) { const source = this.actors.get(hit.sourceId); if (source) source.damageDealt += damage; }
        if (hit.amount > .3) this._event('hit', { actorId: hit.sourceId, targetId: a.id, damage: Math.round(damage * 10) / 10, absorbed, x: a.x, z: a.z, kind: hit.kind });
        if (!a.hp && !killed.some(k => k.actor === a)) killed.push({ actor: a, sourceId: hit.sourceId, kind: hit.kind });
      }
      this._damage.length = 0;
      const livingBefore = this.list.filter(a => a.alive && !a.spectator).length;
      // Commit the complete damage batch before deciding a winner. A lethal
      // trade in one tick is a draw, independent of actor iteration order.
      for (const death of killed) {
        const a = death.actor, killer = this.actors.get(death.sourceId); a.alive = false; a.hp = 0; a.deaths++; a.vx = 0; a.vz = 0; a.attack = null; a.attackPhase = null; a.healing = 0; a.respawnIn = this.modeId === 'ffa' ? 3 : 0;
        if (killer && killer !== a) { killer.kills++; if (this.modeId !== 'duel') killer.score++; }
        else if (this.modeId === 'ffa' && killer === a) a.score = Math.max(0, a.score - 1);
        if (this.modeId === 'royale') { a.placement = livingBefore - killed.length + 1; this._dropLoot(a); }
        this._event('death', { actorId: a.id, killerId: killer && killer !== a ? killer.id : null, reason: death.kind, x: a.x, z: a.z, placement: a.placement });
      }
    }
    _resolveRules() {
      if (this.result) return;
      const active = this.list.filter(a => !a.spectator), living = active.filter(a => a.alive);
      if (this.modeId === 'duel') {
        if (living.length < 2 || this.roundElapsed >= 120) {
          if (living.length === 1) living[0].score++;
          if (living.some(a => a.score >= this.target)) { this.finish(living.filter(a => a.score >= this.target).map(a => a.id), 'score'); return; }
          if (this.elapsed >= this.duration) { this._finishByScore('time'); return; }
          this.phase = 'roundBreak'; this.countdown = 2.5; this.zone = null; this.projectiles.length = 0; this._event('roundEnd', { winnerId: living.length === 1 ? living[0].id : null, round: this.round });
        } else if (this.roundElapsed >= 90 && this.phase !== 'overtime') { this.phase = 'overtime'; this._event('phase', { phase: 'overtime' }); }
        if (this.elapsed >= this.duration && !this.result) this._finishByScore('time');
      } else if (this.modeId === 'ffa') {
        if (active.some(a => a.score >= this.target)) this._finishByScore('score'); else if (this.elapsed >= this.duration) this._finishByScore('time');
      } else {
        if (living.length <= 1) { if (living[0]) living[0].placement = 1; this.finish(living.map(a => a.id), living.length ? 'lastSurvivor' : 'mutualElimination'); }
        else if (this.elapsed >= this.duration) {
          // The final zone reaches zero and deals lethal damage at the hard
          // limit; health, join order and host identity never break a tie.
          for (const a of living) this._queueDamage(a, 10000, null, 'zone'); this._commitDamage(); this.finish([], 'mutualElimination');
        }
      }
    }
    _finishByScore(reason) {
      const ranked = this.list.filter(a => !a.spectator).sort((a, b) => b.score - a.score || (this.modeId === 'ffa' ? a.deaths - b.deaths : 0)), first = ranked[0];
      this.finish(ranked.filter(a => a.score === first.score && (this.modeId !== 'ffa' || a.deaths === first.deaths)).map(a => a.id), reason);
    }
    finish(winnerIds = [], reason = 'finished') {
      if (this.result) return this.result;
      if (this.modeId === 'ffa') {
        const ranked = this.list.filter(a => !a.spectator).sort((a, b) => b.score - a.score || a.deaths - b.deaths);
        for (let i = 0; i < ranked.length; i++) ranked[i].placement = i && ranked[i].score === ranked[i - 1].score && ranked[i].deaths === ranked[i - 1].deaths ? ranked[i - 1].placement : i + 1;
      }
      this.phase = 'finished'; this.result = { winnerIds: winnerIds.slice(), winnerId: winnerIds.length === 1 ? winnerIds[0] : null, draw: winnerIds.length !== 1, reason, elapsed: this.elapsed, round: this.round,
        standings: this.list.filter(a => !a.spectator).map(a => ({ id: a.id, name: a.name, score: a.score, kills: a.kills, deaths: a.deaths, placement: a.placement })).sort((a, b) => this.modeId === 'royale' ? (a.placement || 99) - (b.placement || 99) : b.score - a.score || a.deaths - b.deaths) };
      this._event('result', { result: this.result }); return this.result;
    }
    _makeZoneStages() {
      const start = Math.hypot(this.map.halfW - 6, this.map.halfH - 6), targets = [40, 27, 17, 8, 0];
      let x = 0, z = 0, radius = start;
      return targets.map((target, i) => {
        const shift = i < 3 ? Math.min(5, radius - target) : 0, nx = i >= 3 ? 0 : clamp(x + (this.rng() - .5) * shift, -5, 5), nz = i >= 3 ? 0 : clamp(z + (this.rng() - .5) * shift, -5, 5);
        const stage = { start: i * 96, hold: i === 4 ? 20 : 40, duration: 96, x, z, radius, nextX: nx, nextZ: nz, nextRadius: target, damage: [2, 4, 7, 12, 25][i] }; x = nx; z = nz; radius = target; return stage;
      });
    }
    _updateZone() {
      if (this.modeId === 'duel' && this.roundElapsed >= 90) { const t = clamp((this.roundElapsed - 90) / 30, 0, 1); this.zone = { x: 0, z: 0, radius: 30 * (1 - t), nextX: 0, nextZ: 0, nextRadius: 0, stage: 1, phase: 'shrink', remaining: Math.max(0, 120 - this.roundElapsed), damage: 8 + t * 24 }; }
      if (this.modeId !== 'royale') return;
      const index = Math.min(4, Math.floor(this.elapsed / 96)), s = this._zoneStages[index], age = this.elapsed - s.start, t = clamp((age - s.hold) / (s.duration - s.hold), 0, 1);
      this.zone = { x: s.x + (s.nextX - s.x) * t, z: s.z + (s.nextZ - s.z) * t, radius: s.radius + (s.nextRadius - s.radius) * t,
        nextX: s.nextX, nextZ: s.nextZ, nextRadius: s.nextRadius, stage: index + 1, phase: age < s.hold ? 'hold' : 'shrink', remaining: Math.max(0, (age < s.hold ? s.hold : s.duration) - age), damage: s.damage };
    }
    _seedLoot() {
      const guns = WEAPONS.filter(w => !['pistol', 'knife'].includes(w.id));
      // A seeded shuffled floor sample gives every district equipment without
      // hiding pickups inside the collision geometry.
      const floor = this.map.floor.slice();
      for (let i = floor.length - 1; i > 0; i--) { const j = Math.floor(this.rng() * (i + 1)); [floor[i], floor[j]] = [floor[j], floor[i]]; }
      for (let i = 0; i < Math.min(90, floor.length); i++) {
        const p = this.map.point(floor[i]), type = i % 5;
        if (type < 2) { const w = guns[Math.floor(i / 5) * 2 % guns.length + type] || guns[type]; this._addLoot({ ...p, kind: 'weapon', weaponId: w.id }); }
        else this._addLoot({ ...p, kind: type === 2 ? 'ammo' : type === 3 ? 'armor' : 'medkit', amount: type === 3 ? 35 : 1 });
      }
    }
    _addLoot(item) { const loot = { id: 'l-' + ++this._lootId, ...item }; this.loot.push(loot); return loot; }
    _pickups(a, interact) {
      for (let i = this.loot.length - 1; i >= 0; i--) {
        const loot = this.loot[i]; if (dist2(a, loot) > 2.2 ** 2 || !this.map.los(a, loot)) continue;
        let taken = false;
        if (loot.kind === 'weapon' && interact && !a.attack && !a.burstRemaining) { const w = BY_ID[loot.weaponId], matching = a.weaponSlots.filter(id => BY_ID[id].slot === w.slot), old = matching.includes(a.weaponId) ? a.weaponId : matching[matching.length - 1]; if (matching.length >= (w.slot === 'primary' ? 2 : 1) && old && old !== w.id) this._addLoot({ x: a.x - .6, z: a.z, kind: 'weapon', weaponId: old }); this.giveWeapon(a.id, w.id); taken = true; interact = false; }
        else if (loot.kind === 'armor' && a.armor < 75) { a.armor = Math.min(75, a.armor + loot.amount); taken = true; }
        else if (loot.kind === 'medkit' && a.medkits < 3) { a.medkits++; taken = true; }
        else if (loot.kind === 'ammo') { if (this.modeId === 'royale' && a.ammo.pistol < 84) { a.ammo.pistol = Math.min(84, a.ammo.pistol + 28); taken = true; } for (const id of a.weaponSlots) { const w = BY_ID[id]; if (w.ammo !== 'none' && a.ammo[w.ammo] < data.AMMO_TYPES[w.ammo].max) { a.ammo[w.ammo] = Math.min(data.AMMO_TYPES[w.ammo].max, a.ammo[w.ammo] + (data.AMMO_PICKUP[w.ammo] || w.mag)); taken = true; } } }
        if (taken) { this.loot.splice(i, 1); this._event('pickup', { actorId: a.id, lootId: loot.id, kind: loot.kind, weaponId: loot.weaponId, x: loot.x, z: loot.z }); }
      }
    }
    _dropLoot(a) { for (const id of a.weaponSlots) if (BY_ID[id].slot === 'primary') this._addLoot({ x: a.x, z: a.z, kind: 'weapon', weaponId: id }); if (a.medkits) this._addLoot({ x: a.x + .35, z: a.z, kind: 'medkit', amount: 1 }); this._addLoot({ x: a.x, z: a.z + .35, kind: 'ammo', amount: 1 }); }
    _cycleSpectator(a, direction) { const living = this.list.filter(p => p.alive && !p.spectator && p !== a); if (!living.length) { a.spectateId = null; return; } const current = living.findIndex(p => p.id === a.spectateId); a.spectateId = living[(current + direction + living.length) % living.length].id; }
    _event(type, fields) { const event = { id: ++this._eventId, tick: this.tick, time: this.time, type, ...fields }; this.events.push(event); return event; }
    _hearShot(source, weapon) {
      const range = weapon.id === 'suppressedSmg' || weapon.id === 'crossbow' ? 10 : 28;
      this._hash.query(source.x - range, source.z - range, source.x + range, source.z + range, this._candidates);
      for (const a of this._candidates) if (a.bot && a !== source && dist2(a, source) < range * range && !a.brain.targetId) {
        a.brain.lastKnown = { x: Math.round(source.x / 6) * 6, z: Math.round(source.z / 6) * 6 }; a.brain.seenAt = this.time - 1; a.brain.wanderAt = this.time + 1;
      }
    }
    _botWeapon(a, distance) {
      let best = a.weaponId, score = -Infinity;
      for (const id of a.weaponSlots) {
        const w = BY_ID[id], melee = w.fire === 'melee', loaded = melee || a.mags[id] > 0;
        if (!loaded && !this._hasReserve(a, w)) continue;
        let value;
        if (melee) value = distance < w.reach * .9 ? 240 : distance < w.reach + .5 ? 80 : 0;
        else {
          value = Math.min(210, this._damageValue(w) * (w.pellets || 1) / Math.max(.12, w.interval));
          value *= clamp(1 - distance / Math.max(1, w.range) * .6, .1, 1);
          if (w.fire !== 'spread' && w.fire !== 'flame') value /= 1 + ((w.spread || 0) * distance * .6 / HIT_RADIUS) ** 2;
          if (w.fire === 'spread' || w.fire === 'flame') value *= clamp(1 - distance / (w.fire === 'flame' ? w.range : 18), .01, 1);
          if (w.fire === 'projectile') value *= distance < (w.splashRadius || 1) * 1.7 ? .02 : .75;
          if (!loaded) value *= .22;
          if (w.spinUp && distance < 5) value *= .4;
          if (id === a.weaponId) value *= 1.12;
        }
        if (value > score) { score = value; best = id; }
      }
      return best;
    }
    _botCover(a, threat) {
      // Bounded local search; only the last perceived threat position is used.
      // Route requests still share the global three-search-per-tick budget.
      let best = null, score = Infinity;
      const away = Math.atan2(a.x - threat.x, a.z - threat.z);
      for (const radius of [3, 6, 9]) for (let i = 0; i < 8; i++) {
        const angle = away + i * Math.PI / 4, p = { x: a.x + Math.sin(angle) * radius, z: a.z + Math.cos(angle) * radius };
        if (!this.map.clear(p.x, p.z) || this.zone && Math.hypot(p.x - this.zone.x, p.z - this.zone.z) > this.zone.radius - 1) continue;
        this.metrics.losChecks++;
        if (this.map.los(threat, p)) continue;
        const value = radius + (this.map.los(a, p) ? 0 : 4) - Math.min(25, Math.sqrt(dist2(threat, p))) * .08;
        if (value < score) { score = value; best = p; }
      }
      return best;
    }
    _botInput(a, dt) {
      const b = a.brain; b.senseIn -= dt;
      if (b.senseIn <= 0) {
        b.senseIn += this.skill.sense; this.metrics.sensePasses++;
        this._hash.query(a.x - 33, a.z - 33, a.x + 33, a.z + 33, this._candidates);
        let target = null, nearest = 33 * 33;
        for (const other of this._candidates) {
          this.metrics.candidateChecks++;
          if (other === a || other.spawnProtection > 0) continue;
          const d = dist2(a, other); if (d >= nearest) continue;
          this.metrics.losChecks++; if (!this.map.los(a, other)) continue;
          nearest = d; target = other;
        }
        if (target) {
          if (b.targetId !== target.id) b.reactionAt = this.time + this.skill.reaction;
          b.targetId = target.id; b.seenAt = this.time; b.lastKnown = { x: target.x, z: target.z }; b.aimError = (this.rng() - .5) * this.skill.error * 2;
        } else { b.targetId = null; if (this.time - b.seenAt > 2.5) b.lastKnown = null; }
        if (!a.attack && !a.burstRemaining && !a.reloading && this.time >= b.weaponAt) {
          b.weaponSlot = this._botWeapon(a, b.lastKnown ? Math.sqrt(dist2(a, b.lastKnown)) : 18); b.weaponAt = this.time + .75;
        }
        const weapon = BY_ID[b.weaponSlot || a.weaponId];
        if (b.lastKnown && this.time >= b.coverSearchAt && (a.hp < this.skill.retreatHp || weapon.usesAmmo !== false && a.mags[weapon.id] < weapon.mag * this.skill.reloadFraction && this._hasReserve(a, weapon))) {
          b.coverGoal = this._botCover(a, b.lastKnown); b.coverUntil = this.time + Math.max(3.5, weapon.reload + 1); b.coverSearchAt = this.time + 3;
        }
      }
      const target = this.actors.get(b.targetId), slot = !a.attack && !a.burstRemaining && !a.reloading && a.owned[b.weaponSlot] ? b.weaponSlot : null, w = BY_ID[slot || a.weaponId];
      let goal = b.lastKnown, moveX = 0, moveZ = 0, fire = false, aimX = a.x + Math.sin(a.angle) * 10, aimZ = a.z + Math.cos(a.angle) * 10, heal = false, interact = false;
      const visibleTarget = target && target.alive && this.time - b.seenAt < this.skill.sense + .02;
      if (visibleTarget) {
        // Use the sampled location, not a continuously updated hidden target.
        const known = b.lastKnown, distance = Math.sqrt(dist2(a, known)), angle = Math.atan2(known.x - a.x, known.z - a.z) + b.aimError;
        aimX = a.x + Math.sin(angle) * 30; aimZ = a.z + Math.cos(angle) * 30;
        const range = w.fire === 'melee' ? w.reach + .25 : Math.min(w.range * .8, w.fire === 'spread' ? 12 : w.fire === 'flame' ? 8 : 24);
        fire = this.time >= b.reactionAt && distance < range && a.spawnProtection <= .3;
        if (w.fire !== 'melee' && distance < range * .8) { const sign = distance < range * .38 ? -1 : 0; moveX = Math.sin(angle) * sign + Math.cos(angle) * b.strafe * this.skill.strafe; moveZ = Math.cos(angle) * sign - Math.sin(angle) * b.strafe * this.skill.strafe; goal = null; }
        if (!w.auto && a.fireWasDown) fire = false;
      }
      const seekingCover = b.coverGoal && this.time < b.coverUntil;
      if (seekingCover) { goal = dist2(a, b.coverGoal) > .5 ** 2 ? b.coverGoal : null; moveX = 0; moveZ = 0; if (a.reloading) fire = false; }
      if (this.modeId === 'royale') {
        const outside = this.zone && Math.hypot(a.x - this.zone.nextX, a.z - this.zone.nextZ) > this.zone.nextRadius * .85;
        if (outside) { goal = { x: this.zone.nextX, z: this.zone.nextZ }; moveX = 0; moveZ = 0; }
        if (!visibleTarget && !outside && !seekingCover) {
          let nearestLoot = null, best = 18 * 18;
          for (const loot of this.loot) { if (loot.kind === 'weapon' && (a.owned[loot.weaponId] || a.weaponSlots.filter(id => BY_ID[id].slot === BY_ID[loot.weaponId].slot).length >= (BY_ID[loot.weaponId].slot === 'primary' ? 2 : 1))) continue; if (loot.kind === 'armor' && a.armor >= 65 || loot.kind === 'medkit' && a.medkits >= 2) continue; const d = dist2(a, loot); if (d < best && this.map.los(a, loot)) { best = d; nearestLoot = loot; } }
          if (nearestLoot) { goal = nearestLoot; interact = best < 2.2 ** 2; }
        }
        if (!visibleTarget && a.hp < 60 && a.medkits && this.time - a.lastDamageAt > 2 && (!this.zone || Math.hypot(a.x - this.zone.x, a.z - this.zone.z) < this.zone.radius - 3)) { heal = true; goal = null; moveX = 0; moveZ = 0; b.healUntil = this.time + 3.2; }
        if (a.healing > 0 || b.healUntil > this.time && !visibleTarget && a.hp < 65) { goal = null; moveX = 0; moveZ = 0; }
      }
      if (!goal && !visibleTarget && !seekingCover && !heal && !a.healing && b.healUntil <= this.time) {
        if (!b.goal || this.time >= b.wanderAt || dist2(a, b.goal) < 2) { b.goal = this.map.point(this.map.floor[Math.floor(this.rng() * this.map.floor.length)]); b.wanderAt = this.time + 5; }
        goal = b.goal;
      }
      if (goal) { const next = this._pathPoint(a, goal), dx = next.x - a.x, dz = next.z - a.z, len = Math.hypot(dx, dz); if (len > .15) { moveX = dx / len; moveZ = dz / len; } }
      // Local separation is bounded by the same neighboring-cell query.
      this._hash.query(a.x - 1.4, a.z - 1.4, a.x + 1.4, a.z + 1.4, this._candidates);
      for (const other of this._candidates) if (other !== a) { const d = Math.sqrt(dist2(a, other)); if (d > .01 && d < 1.15) { moveX += (a.x - other.x) / d * .65; moveZ += (a.z - other.z) / d * .65; } }
      const length = Math.hypot(moveX, moveZ); if (length > 1) { moveX /= length; moveZ /= length; }
      if (a.healing || heal) { moveX = 0; moveZ = 0; }
      const safeToReload = !b.lastKnown || !this.map.los(a, b.lastKnown);
      a.input = { ...NEUTRAL, seq: a.input.seq + 1, slot, moveX, moveZ, aimX, aimZ, fire, altFire: w.fire === 'melee' && fire && a.hp < 45, reload: a.mags[w.id] <= 0 || safeToReload && a.mags[w.id] < w.mag * .6, interact, heal,
        dash: visibleTarget && a.hp < 35 && !a.dashCd && this.rng() < .025, sprint: !visibleTarget && !!goal, aim: visibleTarget && w.fire !== 'melee' && w.range > 45 };
      a.lastInputAt = this.time;
    }
    _pathPoint(a, goal) {
      if (this.map.los(a, goal) && this.map.clear(goal.x, goal.z)) return goal;
      const b = a.brain, start = this.map.cell(a.x, a.z); let target = this.map.cell(goal.x, goal.z);
      if (target < 0 || target >= this.map.grid.length || this.map.grid[target]) { target = this.map.floor.reduce((best, i) => dist2(this.map.point(i), goal) < dist2(this.map.point(best), goal) ? i : best, this.map.floor[0]); }
      if (Math.hypot(a.x - b.progressX, a.z - b.progressZ) > .2) { b.progressAt = this.time; b.progressX = a.x; b.progressZ = a.z; }
      const nextCell = b.path[b.pathCursor], blocked = nextCell !== undefined && (this.map.grid[nextCell] || !this.map.los(a, this.map.point(nextCell))), stuck = b.path.length > b.pathCursor && this.time - b.progressAt > .6;
      if ((b.pathGoal !== target || blocked || stuck) && this._pathsThisStep < 3) {
        this._pathsThisStep++; this.metrics.pathSearches++; this._pathGeneration++; const stamp = this._pathGeneration;
        let head = 0, tail = 0, found = false; this._pathQueue[tail++] = start; this._pathStamp[start] = stamp; this._pathPrev[start] = -1;
        while (head < tail && head < 1024) {
          const cell = this._pathQueue[head++]; if (cell === target) { found = true; break; }
          for (const next of this.map.neighbors[cell] || []) if (!this.map.grid[next] && this._pathStamp[next] !== stamp) { this._pathStamp[next] = stamp; this._pathPrev[next] = cell; this._pathQueue[tail++] = next; }
        }
        this.metrics.pathExpansions += head; this._expansionsThisStep += head;
        b.path.length = 0;
        if (found) { for (let cell = target; cell !== start && cell !== -1; cell = this._pathPrev[cell]) b.path.push(cell); b.path.reverse(); }
        b.pathCursor = 0; b.pathGoal = target; b.progressAt = this.time; b.progressX = a.x; b.progressZ = a.z;
      }
      while (b.pathCursor < b.path.length) { const p = this.map.point(b.path[b.pathCursor]); if (dist2(a, p) < .5 ** 2) b.pathCursor++; else return p; }
      return a;
    }
    _actorView(a, personal) {
      const view = { id: a.id, name: a.name, bot: a.bot, x: a.x, z: a.z, vx: a.vx, vz: a.vz, angle: a.angle, hp: a.hp, maxHp: a.maxHp, armor: a.armor, alive: a.alive, spectator: a.spectator,
        weaponId: a.weaponId, aiming: !!a.input.aim && BY_ID[a.weaponId].fire !== 'melee', spin: a.spin || 0, score: a.score, kills: a.kills, deaths: a.deaths, spawnProtection: a.spawnProtection, dashCd: a.dashCd, dashTime: a.dashTime, dashX: a.dashX || 0, dashZ: a.dashZ || 0, dashWasDown: a.dashWasDown, knockX: a.knockX, knockZ: a.knockZ, reloading: a.reloading, reloadTotal: a.reloadTotal,
        attackPhase: a.attackPhase, attackTimer: a.attackTimer, attackProgress: a.attack ? clamp(a.attack.age / (a.attack.spec.windup + a.attack.spec.activeTime + a.attack.spec.recovery), 0, 1) : 0, attackHeavy: !!a.attack?.heavy, shotSeq: a.shotSeq, respawnIn: a.respawnIn, healing: a.healing, placement: a.placement };
      if (personal) {
        const weapon = BY_ID[a.weaponId], reserveLimited = weapon.usesAmmo !== false && (weapon.ammo !== 'none' || this.modeId === 'royale');
        Object.assign(view, { owned: { ...a.owned }, weaponSlots: a.weaponSlots.slice(), mags: { ...a.mags }, ammo: { ...a.ammo }, medkits: a.medkits, inputSeq: a.processedSeq, damageDealt: a.damageDealt, reserveLimited, reserve: reserveLimited ? a.ammo[weapon.ammo === 'none' ? 'pistol' : weapon.ammo] || 0 : 0 });
      }
      return view;
    }
    snapshot(viewerId = null) {
      const debug = viewerId === null, viewer = this.actors.get(viewerId); let origin = viewer;
      if (viewer && (!viewer.alive || viewer.spectator)) { if (!this.actors.get(viewer.spectateId)?.alive) this._cycleSpectator(viewer, 1); origin = this.actors.get(viewer.spectateId) || viewer; }
      const visible = new Set();
      if (debug) for (const a of this.list) visible.add(a.id);
      else if (origin) for (const a of this.list) if (a === viewer || a === origin || a.alive && dist2(origin, a) <= 42 ** 2 && this.map.los(origin, a)) visible.add(a.id);
      const pointVisible = p => debug || !!origin && dist2(origin, p) <= 42 ** 2 && this.map.los(origin, p);
      const events = [];
      for (const e of this.events) {
        const publicEvent = ['phase', 'roundEnd', 'join', 'leave', 'result'].includes(e.type);
        if (debug || publicEvent) events.push({ ...e });
        else if (e.type === 'death') events.push({ id: e.id, tick: e.tick, time: e.time, type: 'death', actorId: e.actorId, killerId: e.killerId, reason: e.reason, placement: e.placement });
        else if (((e.actorId && visible.has(e.actorId)) || e.targetId === viewerId || e.actorId === viewerId || e.x !== undefined && pointVisible(e)) &&
          (e.x === undefined || pointVisible(e) || e.actorId === viewerId || e.type === 'hit')) {
          // A hit on the viewer conveys impact, not a hidden shooter's world
          // position or weapon inventory. Shot segments are clipped below.
          const copy = { ...e };
          if (e.type === 'shot' && e.segments) copy.segments = e.segments.filter(s => pointVisible({ x: s.x, z: s.z }) && pointVisible({ x: s.toX, z: s.toZ }));
          if (e.type === 'hit' && !visible.has(e.targetId) && e.targetId !== viewerId) { delete copy.x; delete copy.z; delete copy.targetId; }
          if (e.actorId && !visible.has(e.actorId) && e.actorId !== viewerId && e.type === 'hit') delete copy.actorId;
          events.push(copy);
        } else if (origin && ['shot', 'explosion', 'melee'].includes(e.type) && e.x !== undefined && dist2(origin, e) < 28 ** 2) {
          const w = BY_ID[e.weaponId]; if (w && ['suppressedSmg', 'crossbow'].includes(w.id) && dist2(origin, e) > 10 ** 2) continue;
          events.push({ id: e.id, tick: e.tick, time: e.time, type: 'sound', sound: e.type, bearing: Math.round(Math.atan2(e.x - origin.x, e.z - origin.z) / (Math.PI / 4)) * Math.PI / 4, distance: dist2(origin, e) < 12 ** 2 ? 'near' : 'far' });
        }
      }
      return { version: VERSION, modeId: this.modeId, seed: this.seed, tick: this.tick, time: this.time, elapsed: this.elapsed, phase: this.phase, countdown: this.countdown, round: this.round, remaining: this.remaining, target: this.target, result: this.result,
        zone: this.zone ? { ...this.zone } : null, paused: this.paused, capacity: this.capacity,
        roundLoadout: this.modeId === 'duel' ? this.duelRoundLoadout(this.round) : null, nextRoundLoadout: this.modeId === 'duel' ? this.duelRoundLoadout(this.round + 1) : null,
        roster: this.list.map(a => ({ id: a.id, name: a.name, bot: a.bot, alive: a.alive, spectator: a.spectator, pending: a.pending, score: a.score, kills: a.kills, deaths: a.deaths, placement: a.placement })),
        actors: this.list.filter(a => visible.has(a.id)).map(a => this._actorView(a, debug || a === viewer)),
        self: viewer ? this._actorView(viewer, true) : null, spectating: viewer?.spectateId || null,
        loot: this.loot.filter(pointVisible).map(l => ({ ...l })), projectiles: this.projectiles.filter(pointVisible).map(p => ({ ...p })), events };
    }
  }
  return { VERSION, World, GridMap, createArenaMap, meleeStats, meleeInArc, rayCircleHit, segmentCircleHit: rayCircleHit, mitigateDamage, projectileKinematics, predictMovement, randomSource, BODY_RADIUS, HIT_RADIUS, BOT_SKILL, LOADOUTS };
});
