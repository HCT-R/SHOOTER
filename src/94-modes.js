/* Presentation adapter. Offline practice and the server use CombatCore.World. */
const MODE_DEFS = Object.freeze({
  campaign: { id: 'campaign', label: 'КАМПАНИЯ', description: 'Операция «Затмение»: шесть сюжетных миссий, контрольные точки и развитие бойца.', rules: '6 миссий · сюжет · контрольные точки' },
  duel: { id: 'duel', label: 'ДУЭЛЬ 1 НА 1', description: 'Равное снаряжение и смена сторон. После 90 секунд зона вынуждает сблизиться.', rules: 'До 5 побед · раунд 90 секунд · общий предел 15 минут', bots: 1, target: 5, duration: 900 },
  ffa: { id: 'ffa', label: 'КАЖДЫЙ ЗА СЕБЯ', description: 'Выберите комплект и набирайте устранения. Возрождение через три секунды.', rules: '20 устранений или 5 минут · до 32 участников', bots: 7, target: 20, duration: 300 },
  royale: { id: 'royale', label: 'БАТЛ РОЯЛЬ', description: 'Пистолет и нож на старте. Ищите оружие, лечитесь и следите за зоной.', rules: 'Одна жизнь · пять этапов зоны · до 8 минут', bots: 11, duration: 480 }
});
function normalizeModeId(id) { return Object.prototype.hasOwnProperty.call(MODE_DEFS, id) ? id : 'campaign'; }
function createArenaLevel(seed, modeId) {
  const map = CombatCore.createArenaMap(modeId, seed), level = new LevelMap(map.w, map.h, seed, modeId === 'royale' ? 2 : 0);
  level.grid.set(map.grid); level.start = { ...map.start }; level.spawnPoints = map.spawns; level.propSpots = [];
  level.rooms = [{ x: 2, z: 2, w: map.w - 4, h: map.h - 4, cx: map.w / 2, cz: map.h / 2, number: 1, kind: 'cargo' }]; level.startRoom = level.rooms[0];
  level.arenaLayout = map.arenaLayout; level.arenaName = map.arenaName; level.arenaCode = map.arenaCode;
  level.lamps = map.spawns.map((p, i) => ({ ...p, hue: map.arenaLayout.accent, phase: i, flicker: false }));
  level._initNavRouting(); return level;
}
const ARENA_BODY = Object.freeze({ radius: .58, mass: 1, blood: 0xff6473, score: 1, boss: false, ranged: true });
const ARENA_INTERPOLATION_MS = 85;
// This clock is presentation-only. A short knife stroke must survive between
// 20 Hz snapshots, including the recovery snapshot received before its render.
class ArenaMeleeClock {
  constructor() { this.reset(); }
  reset() { this.weaponId = null; this.segments = []; this.time = -Infinity; this.seq = -1; }
  observe(actor, time) {
    const weapon = WEAPON_BY_ID[actor.weaponId];
    if (!actor.alive || weapon?.fire !== 'melee') { this.reset(); return; }
    if (this.weaponId !== actor.weaponId || time < this.time) this.reset();
    this.weaponId = actor.weaponId; this.time = time; this.seq = actor.shotSeq;
    this.segments = this.segments.filter(s => s.start + s.total > time - .4);
    if (!actor.attackPhase) return;
    const spec = CombatCore.meleeStats(weapon, actor.attackHeavy), total = spec.windup + spec.activeTime + spec.recovery;
    const start = time - Math.max(0, Math.min(1, actor.attackProgress || 0)) * total;
    let segment = this.segments.find(s => s.seq === actor.shotSeq || s.seq === null && Math.abs(s.start - start) < .035);
    if (!segment) { segment = { played: false, angle: actor.angle }; this.segments.push(segment); }
    Object.assign(segment, { seq: actor.shotSeq, start, total, windup: spec.windup, activeTime: spec.activeTime, heavy: !!actor.attackHeavy });
  }
  event(event, snapshotTime) {
    if (event.weaponId !== this.weaponId || event.type !== 'melee') return;
    // Events carry a start time, but no sequence number. Match an observed
    // stroke by start time rather than attaching an old event to the newest one.
    const existing = this.segments.find(s => event.phase === 'windup' ? Math.abs(s.start - event.time) < .035 : event.time >= s.start && event.time <= s.start + s.total);
    if (existing) { if (Number.isFinite(event.angle)) existing.angle = event.angle; return; }
    if (event.phase !== 'windup' || snapshotTime - event.time > .25) return;
    const spec = CombatCore.meleeStats(WEAPON_BY_ID[event.weaponId], event.heavy);
    this.segments.push({ seq: null, start: event.time, total: spec.windup + spec.activeTime + spec.recovery,
      windup: spec.windup, activeTime: spec.activeTime, heavy: !!event.heavy, angle: event.angle, played: false });
    if (this.segments.length > 8) this.segments.shift();
  }
  sample(time, onSwing) {
    let current = null;
    for (const segment of this.segments) {
      const age = time - segment.start;
      if (!segment.played && age >= segment.windup) {
        segment.played = true;
        // Reappearing/late actors never replay an already finished swing.
        if (age <= segment.windup + segment.activeTime + .08) onSwing?.(this.weaponId, segment.heavy);
      }
      if (age >= 0 && age < segment.total && (!current || segment.start > current.start)) current = segment;
    }
    return current ? { progress: Math.max(0, Math.min(1, (time - current.start) / current.total)), heavy: current.heavy, angle: current.angle } : { progress: 0, heavy: false, angle: null };
  }
}
function sampleArenaFrame(frames, now) {
  if (!frames?.length) return null;
  while (frames.length > 2 && frames[1].at < now) frames.shift();
  const a = frames[0], next = frames[1] || a, t = Math.max(0, Math.min(1, (now - a.at) / Math.max(1, next.at - a.at)));
  return { x: a.x + (next.x - a.x) * t, z: a.z + (next.z - a.z) * t,
    angle: angleLerp(a.angle, next.angle, t), time: a.time + (next.time - a.time) * t + Math.max(0, Math.min(2, (now - next.at) / 1000)) };
}
const ARENA_PROJECTILE_ASSETS = {};
function arenaProjectileAsset(kind) {
  if (ARENA_PROJECTILE_ASSETS[kind]) return ARENA_PROJECTILE_ASSETS[kind];
  const bolt = kind === 'bolt', shell = kind === 'shell', grenade = kind === 'grenade';
  const geo = grenade ? new THREE.SphereGeometry(.16, 16, 10) : mergeParts([
    part(G.cyl, { rot: [Math.PI / 2, 0, 0], scale: [bolt ? .013 : shell ? .07 : .09, bolt ? .62 : .42, bolt ? .013 : shell ? .07 : .09], color: bolt ? 0xc5d5d2 : 0x77847b }),
    part(G.cone, { pos: [0, 0, bolt ? .35 : .27], rot: [Math.PI / 2, 0, 0], scale: [bolt ? .035 : .085, .16, bolt ? .035 : .085], color: bolt ? 0xe7f1ec : 0xcd9968 }),
    part(G.box, { pos: [0, 0, -.2], scale: [bolt ? .11 : .23, .018, .12], color: 0x718f89 })
  ]);
  const material = new THREE.MeshStandardMaterial({ color: grenade ? 0xa3ac81 : 0xffffff, vertexColors: !grenade,
    emissive: shell ? 0x6e340f : 0x000000, roughness: .4, metalness: .6 });
  geo.userData.shared = material.userData.shared = true;
  return ARENA_PROJECTILE_ASSETS[kind] = { geo, material };
}
const ARENA_PICKUP_GLOW = {};
function arenaPickupGlow(kind) {
  if (!ARENA_PICKUP_GLOW.geometry) {
    const geometry = new THREE.RingGeometry(.34, .68, 40); geometry.rotateX(-Math.PI / 2); geometry.userData.shared = true;
    ARENA_PICKUP_GLOW.geometry = geometry;
  }
  if (!ARENA_PICKUP_GLOW[kind]) {
    const material = new THREE.MeshBasicMaterial({ color: kind === 'medkit' ? 0x9cded0 : 0xd4c097, transparent: true, opacity: .12, depthWrite: false, toneMapped: false });
    material.userData.shared = true; ARENA_PICKUP_GLOW[kind] = material;
  }
  return new THREE.Mesh(ARENA_PICKUP_GLOW.geometry, ARENA_PICKUP_GLOW[kind]);
}
class ArenaOpponents {
  constructor(match) { this.match = match; this.game = match.game; this.list = []; this.aliveCount = 0; }
  get count() { return this.list.length; }
  reset() { this.dispose(); }
  update() {}
  spawn() { return null; }
  raycast(...args) { return EnemyManager.prototype.raycast.apply(this, args); }
  queryRadius(...args) { return EnemyManager.prototype.queryRadius.apply(this, args); }
  damage() { return false; }
  render(blobs, alpha = 1) {
    const now = performance.now(), dt = this._renderAt ? Math.min(.05, (now - this._renderAt) / 1000) : 0; this._renderAt = now;
    this.match.renderLocalMelee(now);
    for (const e of this.list) {
      const m = e.model; if (!m) continue;
      m.root.visible = e.alive;
      const frame = this.match.online ? sampleArenaFrame(e.frames, now - ARENA_INTERPOLATION_MS) : null;
      m.root.position.set(frame?.x ?? lerp(e.prevX ?? e.x, e.x, alpha), 0, frame?.z ?? lerp(e.prevZ ?? e.z, e.z, alpha)); m.root.rotation.y = frame?.angle ?? e.angle;
      this.match.updateMeleeVisual(e, frame?.time ?? this.match.presentationTime(now));
      if (Number.isFinite(e.meleeVisualAngle)) m.root.rotation.y = e.meleeVisualAngle;
      const speed = Math.hypot(e.vx || 0, e.vz || 0), swing = Math.sin(e.walkPhase * 2.2) * Math.min(1, speed / 5) * .5;
      m.legL.rotation.x = swing; m.legR.rotation.x = -swing;
      if (e.gun) posePlayerWeapon(m, WEAPON_BY_ID[e.weaponId], e.gun, { aiming: e.aiming, recoil: e.recoil || 0, movement: speed / 8, phase: e.walkPhase, bob: 0, reloadProgress: e.reloading > 0 ? 1 - e.reloading / (e.reloadTotal || WEAPON_BY_ID[e.weaponId].reload) : -1, spin: e.spin || 0, dt, attackProgress: e.attackProgress || 0, heavyAttack: e.attackHeavy });
      e.health.scale.x = Math.max(.01, e.hp / e.maxHp);
      e.healthGroup.quaternion.copy(m.root.quaternion).invert().multiply(this.game.camera.quaternion);
      if (blobs && e.alive) blobs.add(e.x, e.z, 1.5);
    }
    this.match.renderZone();
  }
  disposeActor(e) { e.meleeVisual?.reset(); if (e.model) { this.game.scene.remove(e.model.root); disposeLevelGroup(e.model.root); e.model = null; } }
  dispose() { for (const e of this.list) this.disposeActor(e); this.list.length = 0; this.aliveCount = 0; }
}
class ArenaMatch {
  constructor(game, modeId, options = {}) {
    this.game = game; this.modeId = modeId; this.def = MODE_DEFS[modeId]; this.options = options;
    this.online = !!options.online; this.guest = this.online; this.localId = String(options.localId || 'local');
    this.enemies = new ArenaOpponents(this); this.participants = new Map(); this.phase = 'countdown'; this.elapsed = 0; this.remaining = this.def.duration; this.round = 0; this.countdown = 3; this.result = null;
    this.seq = 0; this.lastEvent = 0; this.pending = []; this.roster = []; this.visualLoot = new Map(); this.visualProjectiles = new Map(); this.spectateStep = 0;
    this.predictionMap = new CombatCore.GridMap(CombatCore.createArenaMap(modeId, game.runSeed));
    if (!options.headless) { this.art = new ArenaArt(game, modeId); this.buildZone(); }
    if (!this.online) {
      const count = modeId === 'duel' ? 1 : Math.max(1, Math.min(31, Number(options.botCount ?? this.def.bots)));
      this.world = new CombatCore.World({ modeId, seed: game.runSeed, capacity: count + 1, difficulty: options.difficulty || 'normal', botCount: 0 });
      this.world.addPlayer({ id: this.localId, name: game.player.callsign || 'NOMAD', loadout: modeId === 'duel' ? undefined : options.loadout || 'assault' });
      for (let i = 0; i < count; i++) this.world.addPlayer({ id: 'bot-' + i, name: ['VEX', 'KIRA', 'ECHO', 'ION', 'ONYX', 'NOVA'][i % 6] + '-' + (i + 1), bot: true });
      this.world.start(); this.applySnapshot(this.world.snapshot(this.localId));
    }
  }
  inputPacket(neutral = false) {
    const g = this.game, i = g.input, p = g.player;
    let x = 0, z = 0, slot = -1;
    if (!neutral) {
      x = (i.actionDown('moveRight') ? 1 : 0) - (i.actionDown('moveLeft') ? 1 : 0) + (i.padMoveX || 0);
      z = (i.actionDown('moveDown') ? 1 : 0) - (i.actionDown('moveUp') ? 1 : 0) + (i.padMoveZ || 0);
      const stick = i.stick(0, 1); if (stick) { x = stick.x; z = stick.z; }
      const slots = this.self?.weaponSlots || ['pistol', 'rifle', 'shotgun', 'knife'];
      for (let n = 0; n < slots.length; n++) if (i.once('Digit' + (n + 1))) slot = n;
      let cycle = (i.actionOnce('nextWeapon') ? 1 : 0) - (i.actionOnce('prevWeapon') ? 1 : 0);
      if (i.wheel) cycle += Math.sign(i.wheel);
      if (this.self && !this.self.alive) { if (cycle) this.spectateStep = Math.sign(cycle); slot = -1; }
      else if (cycle) slot = (Math.max(0, slots.indexOf(p.weapon.id)) + cycle + slots.length) % slots.length;
    }
    const packet = { seq: ++this.seq, moveX: x, moveZ: z, aimX: g.aim.x, aimZ: g.aim.z, slot,
      fire: !neutral && (i.mouseDown || i.mousePressed || i.actionDown('fire')), altFire: !neutral && (i.rightDown || i.rightPressed || i.actionDown('aim') || i.actionOnce('aim')),
      aim: !neutral && (i.rightDown || i.actionDown('aim')), reload: !neutral && i.actionOnce('reload'), dash: !neutral && i.actionOnce('dash'), sprint: !neutral && i.actionDown('sprint'),
      interact: !neutral && i.actionOnce('interact'), heal: !neutral && i.actionOnce('heal'), spectate: this.spectateStep || 0,
      loadout: document.getElementById('loadoutSetting')?.value || this.options.loadout || 'assault' };
    this.spectateStep = 0; return packet;
  }
  frame(dt) {
    const g = this.game, p = g.player; g.updateAim();
    const input = this.inputPacket(g.state !== ST_PLAY || this.online && (g.network?.focusLost || document.hidden));
    if (this.world) { this.world.setInput(this.localId, input); this.world.step(dt); this.applySnapshot(this.world.snapshot(this.localId)); }
    else {
      if (g.network?.sendControls(input)) { this.pending.push({ input, dt }); if (this.pending.length > 180) this.pending.shift(); }
      if (p.alive && ['active', 'overtime'].includes(this.phase)) Object.assign(p, CombatCore.predictMovement(p, input, dt, this.predictionMap));
      this.interpolate(dt);
    }
    g.time = this.elapsed; g.tick++;
    p.hurtFlash = Math.max(0, p.hurtFlash - dt * 2.2); p.recoil = damp(p.recoil, 0, 12, dt);
    p.walkPhase += dt * (2.5 + Math.hypot(p.vx || 0, p.vz || 0) * 1.5);
    if (this._flameUntil && performance.now() > this._flameUntil) { this._flameUntil = 0; sfx.flameStop(); }
    sfx.spinup(p.alive && p.weapon.spinUp && p.spin > .02, p.spin || 0);
    this.updateMeleeVisual(p, this.presentationTime());
    p.updateModel(dt, Math.hypot(p.vx || 0, p.vz || 0), g.aim.x, g.aim.z);
    if (Number.isFinite(p.meleeVisualAngle)) { p.root.rotation.y = p.meleeVisualAngle; p.silhouette.rotation.y = p.meleeVisualAngle; }
    const watched = this.self && !this.self.alive && this.latest?.spectating;
    g.cameraSubject = watched ? this.participants.get(typeof watched === 'object' ? watched.id : watched) : null;
    g.updateCamera(dt); g.levelView.updateLamps(g.lampLights, g.cameraSubject?.x ?? p.x, g.cameraSubject?.z ?? p.z, g.time);
    g.fx.tracers.update(dt); g.fx.lights.update(dt); g.fx.sparks.update(dt, g.camera.quaternion); g.fx.smoke.update(dt, g.camera.quaternion); g.fx.shockwaves.update(dt); g.damageNumbers.update(dt);
    g.hud.update(dt, g); const rect = g.canvas.getBoundingClientRect();
    g.hud.setCrosshair((g.input.mx * .5 + .5) * rect.width, (-g.input.my * .5 + .5) * rect.height, 5 + p.recoil * 35);
    sfx.updateMusic(dt, this.phase === 'active' ? .65 : .15);
  }
  interpolate(dt) {
    const now = performance.now() - ARENA_INTERPOLATION_MS;
    for (const e of this.enemies.list) {
      e.prevX = e.x; e.prevZ = e.z;
      const frame = sampleArenaFrame(e.frames, now); if (!frame) continue;
      e.x = frame.x; e.z = frame.z; e.angle = frame.angle;
      e.walkPhase += dt * (2.5 + Math.hypot(e.vx || 0, e.vz || 0) * 1.5); e.recoil = damp(e.recoil || 0, 0, 12, dt);
    }
  }
  presentationTime(now = performance.now()) {
    // Finish already-known strokes during packet loss, without predicting a
    // new attack or moving another actor. Two seconds cover the longest stroke.
    // Offline pause/countdown must never advance a local combat animation.
    const running = this.game.state === ST_PLAY && ['active', 'overtime'].includes(this.phase) && !this.latest?.paused;
    return (this.latest?.time || 0) + (running ? Math.max(0, Math.min(this.online ? 2 : 1 / 60, (now - this.snapshotAt) / 1000)) : 0);
  }
  updateMeleeVisual(actor, time) {
    if (!actor?.meleeVisual) return;
    if (!actor.alive) { actor.meleeVisual.reset(); actor.attackProgress = 0; actor.attackHeavy = false; actor.meleeVisualAngle = null; return; }
    const visual = actor.meleeVisual.sample(time, this.options.headless ? null : (weaponId, heavy) => {
      if (actor === this.game.player) sfx.melee?.('swing', weaponId, heavy);
      else sfx.at((actor.x - this.game.player.x) / 22, Math.hypot(actor.x - this.game.player.x, actor.z - this.game.player.z), () => sfx.melee?.('swing', weaponId, heavy));
    });
    actor.attackProgress = actor.alive ? visual.progress : 0; actor.attackHeavy = actor.alive && visual.heavy;
    actor.meleeVisualAngle = visual.angle;
  }
  renderLocalMelee(now) {
    const player = this.game.player;
    if (player.weapon?.fire !== 'melee' || !player.model || !player._weaponPoseState) return;
    this.updateMeleeVisual(player, this.presentationTime(now));
    if (Number.isFinite(player.meleeVisualAngle)) { player.root.rotation.y = player.meleeVisualAngle; player.silhouette.rotation.y = player.meleeVisualAngle; }
    const pose = player._weaponPoseState; pose.attackProgress = player.attackProgress; pose.heavyAttack = player.attackHeavy; pose.dt = 0;
    posePlayerWeapon(player.model, player.weapon, player.weaponMesh, pose);
  }
  buildActor(e) {
    const m = e.model = buildPlayer(Object.assign({}, LOOK_DEFAULTS, { jacket: 0x785054, pants: 0x343e49, vestColor: 0x313d48, accent: 0xffa583, helmet: 'tactical', shoulders: 'heavy', backpack: false }));
    const group = e.healthGroup = new THREE.Group(); group.position.y = 2.65; m.root.add(group);
    const bg = new THREE.Mesh(new THREE.PlaneGeometry(1.08, .23), new THREE.MeshBasicMaterial({ color: 0x0b141c, side: THREE.DoubleSide })); group.add(bg);
    const geo = new THREE.PlaneGeometry(.92, .115); geo.translate(.46, 0, 0);
    e.health = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0xffa583, side: THREE.DoubleSide, toneMapped: false })); e.health.position.set(-.46, 0, .02); group.add(e.health);
    this.setActorWeapon(e); this.game.scene.add(m.root);
  }
  setActorWeapon(e) {
    if (!e.model || !WEAPON_GEO[e.weaponId]) return;
    if (e.gun) { e.model.weaponPivot.remove(e.gun); disposeLevelGroup(e.gun); }
    e.gun = new THREE.Mesh(WEAPON_GEO[e.weaponId], e.model.material); e.gun.scale.setScalar(WEAPON_VISUAL_SCALE); e.model.weaponPivot.add(e.gun);
    configureWeaponModel(e.gun, WEAPON_BY_ID[e.weaponId], e.gun.material);
  }
  applySnapshot(s) {
    if (!s || s.version !== CombatCore.VERSION || s.modeId !== this.modeId) return false;
    const resetMelee = this.latest && (s.round !== this.latest.round || s.seed !== this.latest.seed || s.time < this.latest.time || ['roundBreak', 'finished', 'countdown'].includes(s.phase) && s.phase !== this.latest.phase);
    if (resetMelee) { this.game.player.meleeVisual?.reset(); for (const actor of this.enemies.list) { actor.meleeVisual?.reset(); actor.frames.length = 0; } }
    this.snapshotAt = performance.now();
    this.latest = s; for (const key of ['phase', 'elapsed', 'remaining', 'round', 'countdown', 'zone']) this[key] = s[key]; this.roster = s.roster || [];
    const p = this.game.player, own = s.self; this.self = own;
    if (own) {
      if (!this.options.headless && p.reloading > 0 && own.reloading <= 0 && own.weaponId === p.weapon.id) sfx.reload('in', p.weapon.reloadStyle || p.weapon.id);
      if (own.hp < p.hp) { p.hurtFlash = 1; p.lastDamageTime = s.time; if (!this.options.headless) sfx.hurt(); }
      const { reserve, ...body } = own;
      Object.assign(p, body, { invuln: own.spawnProtection || 0, reloadTotal: own.reloadTotal || WEAPON_BY_ID[own.weaponId]?.reload || 1, dashCooldown: 1.8 });
      if (!p.meleeVisual) p.meleeVisual = new ArenaMeleeClock();
      if (['active', 'overtime'].includes(s.phase)) p.meleeVisual.observe(own, s.time); else p.meleeVisual.reset();
      p.owned = { ...own.owned }; p.mags = { ...own.mags }; p.ammo = { ...own.ammo }; p.carrySlots = (own.weaponSlots || []).slice();
      const idx = WEAPONS.findIndex(w => w.id === own.weaponId); if (idx >= 0 && p.weaponIndex !== idx) p.setWeapon(idx);
      this.pending = this.pending.filter(c => c.input.seq > (own.inputSeq ?? -1));
      if (this.online && p.alive) for (const c of this.pending) Object.assign(p, CombatCore.predictMovement(p, c.input, c.dt, this.predictionMap));
      p.reloading = own.reloading; p.meleeId = own.weaponSlots?.find(id => WEAPON_BY_ID[id]?.slot === 'melee') || 'knife';
      this.game.stats.kills = own.score || 0; this.game.stats.shots = own.shotSeq || 0; this.game.score = own.score || 0;
    }
    const visible = new Set((s.actors || []).filter(a => a.id !== this.localId).map(a => a.id));
    for (const e of this.enemies.list.slice()) if (!visible.has(e.id)) { this.enemies.disposeActor(e); this.participants.delete(e.id); this.enemies.list.splice(this.enemies.list.indexOf(e), 1); }
    if (own) this.participants.set(this.localId, { ...own, isLocal: true });
    for (const actor of s.actors || []) {
      if (actor.id === this.localId) continue;
      let e = this.participants.get(actor.id);
      if (!e) { e = { ...actor, def: ARENA_BODY, walkPhase: 0, recoil: 0, frames: [], prevX: actor.x, prevZ: actor.z }; this.participants.set(e.id, e); this.enemies.list.push(e); if (!this.options.headless) this.buildActor(e); }
      const oldWeapon = e.weaponId, oldX = e.x, oldZ = e.z, oldAngle = e.angle;
      Object.assign(e, actor, { state: actor.alive ? S_CHASE : S_DYING, invuln: actor.spawnProtection || 0, burn: 0, y: 0 });
      if (!e.meleeVisual) e.meleeVisual = new ArenaMeleeClock();
      if (['active', 'overtime'].includes(s.phase)) e.meleeVisual.observe(actor, s.time); else e.meleeVisual.reset();
      // Duplicate snapshots must not insert a zero-duration interpolation frame.
      if (e.frames[e.frames.length - 1]?.time !== s.time) e.frames.push({ at: this.snapshotAt, time: s.time, x: actor.x, z: actor.z, angle: actor.angle });
      if (e.frames.length > 8) e.frames.shift();
      if (this.online) { e.x = oldX; e.z = oldZ; e.angle = oldAngle; } else { e.prevX = oldX; e.prevZ = oldZ; e.walkPhase += 1 / 60 * (2.5 + Math.hypot(e.vx, e.vz) * 1.5); }
      if (oldWeapon !== e.weaponId && !this.options.headless) this.setActorWeapon(e);
    }
    this.enemies.aliveCount = this.enemies.list.filter(e => e.alive).length;
    if (!this.options.headless) this.presentObjects(s);
    for (const event of s.events || []) {
      // Retained events can restore a locked direction for an actor first
      // revealed mid-stroke. The clock merges them without replaying sound.
      if (event.type === 'melee') (event.actorId === this.localId ? p : this.participants.get(event.actorId))?.meleeVisual?.event(event, s.time);
      if (event.id > this.lastEvent && !this.options.headless) this.presentEvent(event);
    }
    for (const event of s.events || []) this.lastEvent = Math.max(this.lastEvent, event.id || 0);
    this.updateMeleeVisual(p, s.time);
    if (s.result && !this.result) { this.result = s.result; this.showResult(); }
    return true;
  }
  presentObjects(s) {
    const sync = (items, models, projectile) => {
      const ids = new Set(items.map(x => x.id));
      for (const [id, mesh] of models) if (!ids.has(id)) { this.game.scene.remove(mesh); disposeLevelGroup(mesh); models.delete(id); }
      for (const item of items) {
        let mesh = models.get(item.id);
        if (!mesh) {
          const colors = { weapon: 0xefba6a, ammo: 0x81c4eb, armor: 0x62ddcf, medkit: 0xeb9595 };
          if (projectile) {
            const asset = arenaProjectileAsset(item.kind || 'rocket'); mesh = new THREE.Mesh(asset.geo, asset.material);
          } else if (item.kind === 'weapon' && WEAPON_BY_ID[item.weaponId]) {
            const weapon = WEAPON_BY_ID[item.weaponId]; mesh = new THREE.Mesh(WEAPON_GEO[weapon.geo], WEAPON_MATERIAL);
            configureWeaponModel(mesh, weapon, mesh.material); mesh.scale.setScalar(1.5); mesh.rotation.x = .3;
          } else if (item.kind === 'ammo' || item.kind === 'medkit') {
            mesh = createPickupModel(item.kind === 'medkit' ? 'health' : 'ammo', 'supply');
            const glow = arenaPickupGlow(item.kind); glow.position.y = -.52; mesh.add(glow);
          } else {
            const geo = typeof PICKUP_GEO !== 'undefined' && PICKUP_GEO[item.kind === 'medkit' ? 'health' : item.kind];
            mesh = new THREE.Mesh(geo || new THREE.OctahedronGeometry(.35), new THREE.MeshStandardMaterial({ color: geo ? 0xffffff : colors[item.kind] || 0xffffff,
              vertexColors: !!geo, emissive: 0x101c23, roughness: .5, metalness: .3 }));
            mesh.scale.setScalar(.75);
          }
          mesh.userData.kind = item.kind; this.game.scene.add(mesh); models.set(item.id, mesh);
        }
        if (projectile && mesh.userData.placed) {
          const kind = item.kind || 'rocket';
          if (kind === 'bolt' || kind === 'shell') this.game.fx.tracers.add(item.x, item.y ?? .8, item.z, mesh.position.x, mesh.position.z, kind === 'bolt' ? .035 : .13, kind === 'bolt' ? 0xc2e4d8 : 0xffc77e, .065);
          else if (kind === 'rocket') this.game.fx.smoke.emit(item.x, item.y ?? .8, item.z, 0, .45, 0, .4, .23, 1.2, 0x74797a, .22);
        }
        mesh.position.set(item.x, projectile ? (item.y ?? .8) : .6 + Math.sin(this.elapsed * 2 + item.x) * .045, item.z);
        mesh.userData.placed = true;
        if (!projectile) mesh.rotation.y = this.elapsed * .45;
        else { mesh.rotation.y = Math.atan2(item.vx || 0, item.vz || 0); mesh.rotation.x = item.kind === 'grenade' ? this.elapsed * 7 : -Math.atan2(item.vy || 0, Math.hypot(item.vx || 0, item.vz || 0)); }
      }
    };
    sync(s.loot || [], this.visualLoot, false); sync(s.projectiles || [], this.visualProjectiles, true);
  }
  eventMuzzle(e, actor, weapon) {
    const point = this._muzzlePoint || (this._muzzlePoint = new THREE.Vector3());
    const dx = Math.sin(e.angle || 0), dz = Math.cos(e.angle || 0);
    point.set(e.x + dx * .55, 1.3, e.z + dz * .55);
    if (actor === this.game.player && actor.weapon.id === weapon.id) actor.muzzleWorld(point);
    else if (actor?.gun && actor.weaponId === weapon.id) {
      actor.model.root.position.set(actor.x, 0, actor.z); actor.model.root.rotation.y = actor.angle;
      actor.gun.updateWorldMatrix(true, false); point.set(...weapon.muzzle).applyMatrix4(actor.gun.matrixWorld);
    }
    const length = Math.hypot(point.x - e.x, point.z - e.z);
    if (length > .001) {
      const mx = (point.x - e.x) / length, mz = (point.z - e.z) / length;
      const wall = this.predictionMap.ray(e.x, e.z, mx, mz, length);
      if (wall < length) { point.x = e.x + mx * Math.max(0, wall - .08); point.z = e.z + mz * Math.max(0, wall - .08); }
    }
    return point;
  }
  presentEvent(e) {
    const g = this.game;
    const actor = e.actorId === this.localId ? g.player : this.participants.get(e.actorId);
    const spatial = callback => {
      const x = e.x ?? actor?.x, z = e.z ?? actor?.z;
      if (e.actorId === this.localId || !Number.isFinite(x) || !Number.isFinite(z)) callback();
      else sfx.at((x - g.player.x) / 22, Math.hypot(x - g.player.x, z - g.player.z), callback);
    };
    if (e.type === 'shot') {
      const w = WEAPON_BY_ID[e.weaponId]; if (!w) return;
      if (actor) actor.recoil = w.recoil || .1;
      const muzzle = this.eventMuzzle(e, actor, w);
      if (w.fire === 'flame') {
        this._flameUntil = performance.now() + 160;
        const distance = Math.hypot(e.x - g.player.x, e.z - g.player.z); sfx.flame(e.actorId === this.localId ? .8 : .4 / (1 + distance * .1));
        for (const line of e.segments || []) {
          const dx = line.toX - muzzle.x, dz = line.toZ - muzzle.z;
          for (let i = 1; i <= 3; i++) g.fx.sparks.emit(muzzle.x + dx * i / 5, muzzle.y, muzzle.z + dz * i / 5, dx * .6, .35, dz * .6, .19, .55, i % 2 ? 0xffad55 : 0xff6338, 0);
        }
        g.fx.lights.flash(e.x, 1.2, e.z, 0xff9345, 30, 7, .08);
      } else {
        for (const line of e.segments || []) {
          const origin = line.x === e.x && line.z === e.z ? muzzle : { x: line.x, y: 1.25, z: line.z };
          g.fx.tracers.add(origin.x, origin.y, origin.z, line.toX, line.toZ, w.tracerWidth || .07, w.tracer || 0xffd5a0, .09);
        }
        if (w.projectileKind !== 'bolt') {
          const color = w.fire === 'arc' ? 0x68e9ff : w.fire === 'rail' ? 0xd69cff : 0xffca86;
          const dx = Math.sin(e.angle || 0), dz = Math.cos(e.angle || 0);
          g.fx.lights.flash(muzzle.x, muzzle.y, muzzle.z, color, w.suppressed ? 12 : 48, w.suppressed ? 4 : 7, .05);
          if (!w.suppressed) g.fx.sparks.muzzle?.(muzzle.x, muzzle.y, muzzle.z, dx, dz, color, w.fire === 'spread' || w.fire === 'rail');
        }
        spatial(() => sfx.shot(w.sound || w.id, (e.actorId === this.localId ? .8 : .6) * (w.suppressed ? .55 : 1)));
      }
    } else if (e.type === 'hit') {
      const target = this.participants.get(e.targetId), ownHit = e.actorId === this.localId;
      if (ownHit) {
        g.stats.hits++; g.onHitConfirm?.(this.roster.find(a => a.id === e.targetId)?.alive === false);
        if (target && !target.isLocal) g.damageNumbers?.addFor(target, e.damage, false);
        if (e.kind === 'melee') sfx.melee?.('hit', g.player.weapon.id, g.player.attackHeavy); else sfx.hitFlesh();
      }
      if (target && !target.isLocal && g.fx.sparks.impact) g.fx.sparks.impact(target.x, 1.1, target.z, Math.sin(actor?.angle || 0), Math.cos(actor?.angle || 0), 0xf5ab98, true);
      // Hidden attackers never gain a precise direction through presentation.
      if (e.targetId === this.localId && actor && e.actorId !== this.localId) g.hud.damageIndicator?.(actor.x, actor.z, e.damage);
    } else if (e.type === 'death' && e.killerId === this.localId) g.onHitConfirm?.(true);
    else if (e.type === 'explosion') { g.fx.shockwaves.emit(e.x, e.z, e.radius, 0xffb567, .55); g.fx.sparks.burst(e.x, 1, e.z, 18, 8, .6, .25, 0xffc46b, 1, 10); spatial(() => sfx.explode(.7)); }
    else if (e.type === 'impact') { g.fx.sparks.impact?.(e.x, .9, e.z, Math.sin(actor?.angle || 0), Math.cos(actor?.angle || 0), 0xc2e4d8, false); }
    else if (e.type === 'reload') spatial(() => sfx.reload('out', WEAPON_BY_ID[e.weaponId]?.reloadStyle || e.weaponId));
    else if (e.type === 'dash') { g.fx.sparks.dashWake?.(e.x, e.z, Math.sin(e.angle), Math.cos(e.angle)); spatial(() => sfx.dash()); }
    else if (e.type === 'heal' && e.actorId === this.localId) {
      if (e.phase === 'complete') { sfx.pickup('health'); g.hud.popup('ЗДОРОВЬЕ ВОССТАНОВЛЕНО', '#7cf4df'); }
      else if (e.phase === 'cancel') { sfx.ui('back'); g.hud.popup('ЛЕЧЕНИЕ ПРЕРВАНО', '#ffc46c'); }
      else { sfx.ui('tick'); g.hud.popup('ЛЕЧЕНИЕ · НЕ ДВИГАЙТЕСЬ', '#7cf4df'); }
    }
    else if (e.type === 'pickup' && e.actorId === this.localId) { sfx.pickup(e.kind === 'medkit' ? 'health' : e.kind); g.hud.popup(WEAPON_BY_ID[e.weaponId]?.name || { medkit: '+АПТЕЧКА', armor: '+БРОНЯ', ammo: '+БОЕПРИПАСЫ' }[e.kind] || 'ПОДОБРАНО', '#a8e9d4'); }
    else if (e.type === 'sound') sfx.at(Math.sin(e.bearing || 0) * .55, e.distance === 'near' ? 12 : 25, () => sfx.shot('smg', .14));
    // Melee windup/active events feed the sequence-aware visual clock above.
    // Swing audio follows its active phase; contact sparks remain hit-confirmed.
  }
  hudState() {
    const me = this.self || { score: 0, deaths: 0, alive: false }, alive = this.roster.filter(a => a.alive && !a.spectator).length;
    let objective = this.def.rules;
    if (this.phase === 'countdown' || this.phase === 'roundBreak') objective = (this.phase === 'roundBreak' ? 'Следующий раунд' : 'Начало') + ' через ' + Math.ceil(this.countdown) + ' · ' + (this.phase === 'roundBreak' ? this.latest?.nextRoundLoadout || me.weaponSlots || [] : this.latest?.roundLoadout || me.weaponSlots || []).map(id => WEAPON_BY_ID[id]?.name || id).join(' / ');
    else if (!me.alive) objective = this.modeId === 'ffa' && !me.spectator ? 'Возрождение через ' + Math.ceil(me.respawnIn || 0) : 'НАБЛЮДЕНИЕ · переключайте участника';
    else if (this.modeId === 'royale') {
      const bind = (id, fallback) => { if (this.game.input?.padActive) return id === 'heal' ? 'R3' : 'L3'; const code = this.game.input?.binds?.[id]?.[0] || fallback; return typeof keyLabel === 'function' ? keyLabel(code) : code.replace(/^Key/, ''); };
      let nearby = null;
      // Follow the authority's reverse pickup order, so a stack cannot offer
      // one weapon in the prompt and replace it with another on interaction.
      for (let i = (this.latest?.loot?.length || 0) - 1; i >= 0; i--) {
        const loot = this.latest.loot[i];
        if (loot.kind === 'weapon' && Math.hypot(loot.x - me.x, loot.z - me.z) <= 2.2 && this.predictionMap.los(me, loot)) { nearby = loot; break; }
      }
      objective = me.healing > 0 ? 'ЛЕЧЕНИЕ ' + me.healing.toFixed(1) + ' С · НЕ ДВИГАЙТЕСЬ' : bind('heal', 'KeyH') + ' · АПТЕЧКИ ' + (me.medkits || 0);
      if (nearby) {
        const weapon = WEAPON_BY_ID[nearby.weaponId], matching = (me.weaponSlots || []).filter(id => WEAPON_BY_ID[id]?.slot === weapon.slot);
        const replaced = matching.length >= (weapon.slot === 'primary' ? 2 : 1) ? (matching.includes(me.weaponId) ? me.weaponId : matching[matching.length - 1]) : null;
        objective = bind('interact', 'KeyV') + ' · ' + weapon.name + (replaced && replaced !== weapon.id ? ' ← ' + WEAPON_BY_ID[replaced].short : '') + ' · ' + objective;
      } else objective = 'ИЩИТЕ ОРУЖИЕ · ' + objective;
    }
    const roster = this.roster.filter(a => !a.spectator).slice().sort((a, b) => this.modeId === 'royale' && this.result ? (a.placement || 99) - (b.placement || 99) : b.score - a.score || a.deaths - b.deaths).map(a => ({ ...a, isPlayer: a.id === this.localId, name: a.name + (a.bot ? ' [БОТ]' : '') }));
    const outside = this.zone && me.alive && Math.hypot(me.x - this.zone.x, me.z - this.zone.z) > this.zone.radius;
    const next = this.modeId === 'royale' && this.zone ? { x: this.zone.nextX, z: this.zone.nextZ, radius: this.zone.nextRadius } : null;
    const nextOutside = next && me.alive && Math.hypot(me.x - next.x, me.z - next.z) > next.radius;
    return { label: this.def.label, time: Math.floor(Math.max(0, this.remaining) / 60) + ':' + String(Math.ceil(Math.max(0, this.remaining)) % 60).padStart(2, '0'), score: this.modeId === 'royale' ? alive + ' в живых' : this.modeId === 'duel' ? me.score + ' : ' + (this.roster.find(a => a.id !== this.localId)?.score || 0) : me.score + ' / 20',
      objective, roster, zone: this.zone, zoneTarget: outside ? this.zone : nextOutside ? next : null, zoneWarning: outside ? true : nextOutside ? 'НОВАЯ ЗОНА · ДВИГАЙТЕСЬ ПО СТРЕЛКЕ' : false, spectator: !me.alive && this.modeId === 'royale', spectating: this.latest?.spectating, spectatorName: this.roster.find(a => a.id === this.latest?.spectating)?.name || '', self: me };
  }
  summary() { return this.hudState(); }
  snapshot() { return this.world ? this.world.snapshot(this.localId) : this.latest; }
  onPlayerDeath() {}
  showResult() {
    this.phase = 'finished'; if (this.options.headless) return;
    const won = this.result.winnerIds?.includes(this.localId), g = this.game;
    g.state = 'arenaResult'; g.input.clear(); document.body.classList.remove('playing');
    document.getElementById('arenaResultTitle').textContent = this.result.draw ? 'НИЧЬЯ' : won ? 'ПОБЕДА' : 'МАТЧ ЗАВЕРШЁН';
    document.getElementById('arenaResultSubtitle').textContent = this.def.label;
    const stats = document.getElementById('arenaResultStats'); stats.textContent = '';
    for (const [i, a] of this.hudState().roster.entries()) { const row = document.createElement('div'); row.className = 'arenaResultRow'; row.textContent = (a.placement || i + 1) + '. ' + a.name + ' · ' + a.score + ' / ' + a.deaths; stats.appendChild(row); }
    document.getElementById('arenaResults').classList.add('show');
  }
  buildZone() {
    const geo = new THREE.RingGeometry(.991, 1, 128); geo.rotateX(-Math.PI / 2);
    this.zoneRing = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ color: 0x7cf2ea, transparent: true, opacity: .8, depthWrite: false, side: THREE.DoubleSide }));
    this.zoneWall = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 2.8, 128, 1, true), new THREE.MeshBasicMaterial({ color: 0x80cdda, transparent: true, opacity: .065, depthWrite: false, side: THREE.DoubleSide }));
    this.zoneRing.position.y = .1; this.zoneWall.position.y = 1.4; this.game.scene.add(this.zoneRing, this.zoneWall); this.renderZone();
    if (this.modeId === 'royale') {
      this.nextZoneRing = new THREE.Mesh(geo.clone(), new THREE.MeshBasicMaterial({ color: 0xf5e2bd, transparent: true, opacity: .7, depthWrite: false, side: THREE.DoubleSide }));
      this.nextZoneRing.position.y = .12; this.game.scene.add(this.nextZoneRing);
    }
  }
  renderZone() { for (const mesh of [this.zoneRing, this.zoneWall, this.nextZoneRing]) if (mesh) { mesh.visible = !!this.zone; if (this.zone) { const next = mesh === this.nextZoneRing; mesh.position.x = next ? this.zone.nextX : this.zone.x; mesh.position.z = next ? this.zone.nextZ : this.zone.z; mesh.scale.setScalar(Math.max(.01, next ? this.zone.nextRadius : this.zone.radius)); mesh.scale.y = 1; } } }
  dispose() { this.game.player.meleeVisual?.reset(); this.enemies.dispose(); this.art?.dispose(); for (const mesh of [this.zoneRing, this.zoneWall, this.nextZoneRing, ...this.visualLoot.values(), ...this.visualProjectiles.values()]) if (mesh) { this.game.scene.remove(mesh); disposeLevelGroup(mesh); } this.visualLoot.clear(); this.visualProjectiles.clear(); this.pending.length = 0; if (!this.options.headless) { sfx.flameStop(); sfx.spinup(false, 0); } }
}
