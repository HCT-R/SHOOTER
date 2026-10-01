/* Serialized into the real browser by activitytest. Exercise authoritative
   events through the live Three.js/audio/HUD adapter for every weapon. */
module.exports = function arenaFeedbackProbe() {
  const { WEAPONS, WEAPON_BY_ID, sfx, THREE } = PixelProtocol;
  let checks = 0;
  const check = (value, why) => { if (!value) throw Error(why); checks++; };
  const calls = {}, originals = {};
  for (const name of ['shot', 'reload', 'melee', 'flame', 'flameStop', 'pickup']) {
    originals[name] = sfx[name];
    sfx[name] = function (...args) { calls[name] = (calls[name] || 0) + 1; return originals[name].apply(this, args); };
  }
  try {
    game.startRun(4271, 'ffa', { botCount: 1 });
    const arena = game.arena, world = arena.world, me = world.actors.get('local'), target = world.list.find(a => a.bot);
    target.bot = false;
    world.phase = 'active'; world.countdown = 0;
    let seq = 0;
    const step = (input = {}) => {
      world.setInput(me.id, { seq: ++seq, aimX: target.x, aimZ: target.z, ...input });
      world.step(1 / 60); arena.applySnapshot(world.snapshot(me.id));
      game.player.updateModel(1 / 60, 0); game.fx.sparks.update(1 / 60, game.camera.quaternion);
      game.fx.tracers.update(1 / 60); game.fx.smoke.update(1 / 60, game.camera.quaternion);
    };
    const projectiles = new Map();
    for (const weapon of WEAPONS) {
      Object.assign(me, { x: -5, z: 0, hp: 10000, maxHp: 10000, fireCd: 0, spin: 0, fireWasDown: false, spawnProtection: 0 });
      Object.assign(target, { x: weapon.fire === 'melee' ? -3.8 : 1, z: 0, hp: 10000, maxHp: 10000, armor: 0, knockX: 0, knockZ: 0, spawnProtection: 0 });
      world.projectiles.length = 0;
      world.giveWeapon(me.id, weapon.id); step();
      const before = me.shotSeq, eventBefore = arena.lastEvent;
      const duration = Math.ceil((weapon.spinUp || 0) * 60) + 65;
      for (let frame = 0; frame < duration; frame++) {
        step({ fire: frame === 0 || !!weapon.spinUp });
        for (const model of arena.visualProjectiles.values()) projectiles.set(model.userData.kind, model.geometry.uuid);
      }
      check(me.shotSeq > before && arena.lastEvent > eventBefore, weapon.id + ': real attack reaches presentation');
      check(game.player.weapon.id === weapon.id, weapon.id + ': equipped model follows authority');
      game.player.root.updateWorldMatrix(true, true);
      check(game.player.weaponMesh.matrixWorld.elements.every(Number.isFinite), weapon.id + ': finite weapon transform');
      const muzzle = game.player.muzzleWorld(new THREE.Vector3());
      check([muzzle.x, muzzle.y, muzzle.z].every(Number.isFinite), weapon.id + ': finite rig muzzle');
      if (weapon.fire === 'melee') {
        me.fireCd = 0; me.attack = null; me.fireWasDown = false;
        step({ altFire: true });
        check(arena.self.attackHeavy && game.player.attackHeavy, weapon.id + ': heavy attack reaches rig');
        for (let i = 0; i < 110; i++) step();
      } else {
        me.mags[weapon.id] = 0; me.fireCd = 0; me.burstRemaining = 0;
        step({ reload: true });
        check(game.player.reloading > 0 && game.player.reloadTrack.visible, weapon.id + ': reload pose and indicator');
        me.reloading = .001; step();
      }
      const frozen = JSON.stringify(calls); arena.applySnapshot(world.snapshot(me.id));
      check(JSON.stringify(calls) === frozen, weapon.id + ': repeated snapshot does not replay sound');
      game.updateCamera(1 / 60); game.render();
      check(game.renderer.getContext().getError() === 0, weapon.id + ': no WebGL error');
    }
    check(projectiles.size === 4 && new Set(projectiles.values()).size === 4, 'four distinct projectile model families');
    check(calls.shot > 0 && calls.reload > 0 && calls.melee > 0 && calls.flame > 0, 'family audio receives authority events');
    check(game.stats.hits > 0, 'authority hits update confirmation statistics');
    arena.self.alive = false; game.input.pressed.KeyE = true;
    const watched = arena.inputPacket();
    check(watched.spectate === 1 && watched.slot === -1, 'weapon cycle changes spectator target after death');
    game.input.clear();
    const oldStops = calls.flameStop || 0;
    game.startRun(4271, 'royale', { botCount: 1 });
    check(calls.flameStop > oldStops, 'leaving match silences flame loop');
    const br = game.arena, bw = br.world, survivor = bw.actors.get('local');
    bw.phase = 'active'; bw.countdown = 0; bw.list.find(a => a.bot).bot = false;
    bw.loot = [{ id: 'probe-weapon', kind: 'weapon', weaponId: 'hammer', x: survivor.x, z: survivor.z }];
    br.applySnapshot(bw.snapshot('local'));
    check(br.hudState().objective.includes(WEAPON_BY_ID.hammer.name), 'nearby loot prompt names actual weapon');
    bw.setInput(survivor.id, { seq: 1, interact: true }); bw.step(1 / 60); br.applySnapshot(bw.snapshot('local'));
    check(game.player.weapon.id === 'hammer' && calls.pickup > 0, 'pickup applies weapon and sound');
    survivor.hp = 20; survivor.medkits = 1;
    bw.setInput(survivor.id, { seq: 2, heal: true }); bw.step(1 / 60); br.applySnapshot(bw.snapshot('local'));
    check(br.self.healing > 0, 'healing channel reaches HUD');
    bw.setInput(survivor.id, { seq: 3, moveX: 1 }); bw.step(1 / 60); br.applySnapshot(bw.snapshot('local'));
    check(br.self.healing === 0, 'movement interrupts healing presentation');
    survivor.x = -20; survivor.z = 0;
    bw.zone = { x: 0, z: 0, radius: 50, nextX: 15, nextZ: 0, nextRadius: 10, stage: 1, phase: 'hold', remaining: 20 };
    br.applySnapshot(bw.snapshot('local')); game.player.updateModel(0, 0); game.updateCamera(1); game.hud.update(.25, game); game.render();
    check(!document.getElementById('zoneDirection').hidden && br.nextZoneRing.visible, 'future zone has a visible world ring and direction arrow');
    check(document.getElementById('zoneReadout').textContent.includes('25'), 'zone HUD shows distance to future boundary');
    check(document.getElementById('mapBox').hidden, 'zone navigation does not reveal a minimap');
    game.network.returnToLobby();
    return { checks, projectiles: [...projectiles.keys()], sounds: calls };
  } finally { for (const name of Object.keys(originals)) sfx[name] = originals[name]; }
};
