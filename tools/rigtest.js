/* CPU-only Three.js rig regression: node tools/rigtest.js.
   Also supplies the geometric measurements used by the browser smoke test. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

function inspectRigPose(THREE, model, root, weapon, weaponMesh, reloading) {
  root.updateWorldMatrix(true, true);
  const finite = [];
  root.traverse((part) => finite.push(...part.matrixWorld.elements));
  const right = model.handR.getWorldPosition(new THREE.Vector3());
  const left = model.handL.getWorldPosition(new THREE.Vector3());
  const grip = new THREE.Vector3(...weapon.pose.grip).applyMatrix4(weaponMesh.matrixWorld);
  const support = new THREE.Vector3(...weapon.pose.support).applyMatrix4(weaponMesh.matrixWorld);
  const poseRoot = model.poseRoot || root;
  const gripTarget = model.gripTarget.clone().applyMatrix4(poseRoot.matrixWorld);
  const supportTarget = model.supportTarget.clone().applyMatrix4(poseRoot.matrixWorld);
  const muzzle = new THREE.Vector3(...weapon.muzzle).applyMatrix4(weaponMesh.matrixWorld);
  const receiver = root.worldToLocal(new THREE.Vector3(0, 0, 0.12).applyMatrix4(weaponMesh.matrixWorld));
  let limbLengthError = 0, jointGap = 0;
  for (const rig of [model.rigL, model.rigR]) {
    limbLengthError = Math.max(limbLengthError, Math.abs(rig.upper.scale.y - rig.upperLength),
      Math.abs(rig.forearm.scale.y - rig.forearmLength));
    const elbow = new THREE.Vector3(0, 1, 0).applyMatrix4(rig.upper.matrixWorld);
    const wrist = new THREE.Vector3(0, 1, 0).applyMatrix4(rig.forearm.matrixWorld);
    jointGap = Math.max(jointGap, elbow.distanceTo(rig.forearm.getWorldPosition(new THREE.Vector3())),
      wrist.distanceTo(rig.hand.getWorldPosition(new THREE.Vector3())));
  }
  finite.push(...right.toArray(), ...left.toArray(), ...muzzle.toArray());
  return {
    finite: finite.every(Number.isFinite),
    gripError: right.distanceTo(grip),
    supportError: left.distanceTo(reloading || weapon.pose.oneHanded ? supportTarget : support),
    gripTargetError: gripTarget.distanceTo(grip),
    supportTargetError: reloading || weapon.pose.oneHanded ? 0 : supportTarget.distanceTo(support),
    limbLengthError: limbLengthError,
    jointGap: jointGap,
    gripDepth: model.gripTarget.z,
    receiverClearsBody: receiver.z > 0.33 || Math.abs(receiver.x) > 0.4 || receiver.y > 1.52,
    muzzle: muzzle.toArray(),
    handRight: right.toArray(),
    handLeft: left.toArray()
  };
}

const RIG_POSES = [
  { name: 'idle', recoil: 0, aiming: false, speed: 0, phase: 0, reload: 0 },
  { name: 'aim', recoil: 0, aiming: true, speed: 0, phase: 0.4, reload: 0 },
  { name: 'run', recoil: 0, aiming: false, speed: 10.5, phase: 1.3, reload: 0 },
  { name: 'recoil', recoil: 1, aiming: false, speed: 0, phase: 2.1, reload: 0 },
  { name: 'aim-moving-recoil', recoil: 1, aiming: true, speed: 5.2, phase: 3.8, reload: 0 },
  { name: 'reload-early', recoil: 0, aiming: false, speed: 6, phase: 0.7, reload: 0.8 },
  { name: 'reload-middle', recoil: 0, aiming: false, speed: 6, phase: 1.7, reload: 0.5 },
  { name: 'reload-late', recoil: 0, aiming: false, speed: 0, phase: 4.1, reload: 0.15 }
];

async function main() {
  const workspace = path.resolve(__dirname, '..');
  const THREE = await import('data:text/javascript;base64,' +
    fs.readFileSync(path.join(workspace, 'vendor', 'three.module.js')).toString('base64'));
  const storage = new Map();
  const context = {
    THREE, Math, console, performance,
    window: { localStorage: {
      getItem: (key) => storage.has(key) ? storage.get(key) : null,
      setItem: (key, value) => storage.set(key, String(value))
    } },
    sfx: new Proxy({}, { get: () => () => {} })
  };
  vm.createContext(context);
  for (const file of ['00-util.js', '05-save.js', '40-models.js', '45-customize.js', '60-weapons.js', '80-player.js']) {
    new vm.Script(fs.readFileSync(path.join(workspace, 'src', file), 'utf8'), { filename: file }).runInContext(context);
  }
  const api = vm.runInContext('({ Player, WEAPONS, initPrimitives, buildWeaponGeometries, clampLook, part, G, sampleMeleePose })', context);
  api.initPrimitives(); api.buildWeaponGeometries();
  const surface = api.part(api.G.box, { color: 0x808080 });
  const expectedColor = new THREE.Color(0x808080);
  const colors = surface.getAttribute('color');
  for (let i = 0; i < colors.count; i++) {
    assert(Math.abs(colors.getX(i) - expectedColor.r) < 1e-6 && Math.abs(colors.getY(i) - expectedColor.g) < 1e-6 &&
      Math.abs(colors.getZ(i) - expectedColor.b) < 1e-6, 'authored surface color is double-linearized or noisy');
  }
  surface.dispose();
  const game = { scene: new THREE.Scene(), level: { start: { x: 7, z: -3 }, raycastWall: () => null } };
  const player = new api.Player(game);
  for (const weapon of api.WEAPONS) player.giveWeapon(weapon.id);
  let cases = 0, worstGrip = 0, worstSupport = 0;
  const inspect = (weapon, pose, label) => {
    player.recoil = weapon.recoil * pose.recoil;
    player.aiming = pose.aiming;
    player.walkPhase = pose.phase;
    player.vx = pose.speed * 0.6; player.vz = pose.speed * 0.8;
    player.reloadTotal = weapon.reload;
    player.reloading = pose.reload * weapon.reload;
    player.spin = weapon.spinUp ? 1 : 0;
    player.meleeAttack = pose.attack !== undefined ? { age: pose.attack, total: 1, heavy: !!pose.heavy } : null;
    player.angle = 0.7 + cases * 0.17;
    player.updateModel(1 / 60, pose.speed, player.x + 8, player.z + 4);
    const metrics = inspectRigPose(THREE, player.model, player.root, weapon, player.weaponMesh, pose.reload > 0);
    worstGrip = Math.max(worstGrip, metrics.gripError);
    worstSupport = Math.max(worstSupport, metrics.supportError);
    assert(metrics.finite, label + ': non-finite rig transform');
    assert(metrics.gripError < 0.012, label + ': firing hand misses grip by ' + metrics.gripError);
    assert(metrics.supportError < 0.012, label + ': support hand misses target by ' + metrics.supportError);
    assert(metrics.gripTargetError < 1e-5 && metrics.supportTargetError < 1e-5,
      label + ': declared grip targets disagree with the transformed weapon sockets');
    assert(metrics.limbLengthError < 0.002 && metrics.jointGap < 1e-5,
      label + ': arm segments stretch or disconnect at elbow/wrist');
    if (pose.name === 'idle') {
      assert(metrics.gripDepth >= 0.37 && metrics.receiverClearsBody,
        label + ': firing hand or receiver sits inside the chest');
    }
    if (!pose.attack) {
      assert(player.model.upperBody.rotation.toArray().slice(0, 3).every(v => Math.abs(v) < 1e-8) &&
        Math.abs(player.model.upperBody.position.z) < 1e-8 && Math.abs(player.model.head.rotation.y) < 1e-8,
        label + ': previous melee stroke leaked into the next pose');
    }
    const muzzle = player.muzzleWorld(new THREE.Vector3());
    const renderedMuzzle = new THREE.Vector3(...weapon.muzzle).applyMatrix4(player.weaponMesh.matrixWorld);
    assert(muzzle.toArray().every(Number.isFinite) && muzzle.distanceTo(renderedMuzzle) < 1e-5,
      label + ': firing origin disagrees with rendered muzzle');
    assert(Math.abs(player.weaponMesh.rotation.z) < 1e-8, label + ': weapon receiver spins instead of its barrel rotor');
    cases++;
  };
  for (let i = 0; i < api.WEAPONS.length; i++) {
    player.setWeapon(i);
    const weapon = api.WEAPONS[i];
    assert(weapon.pose && player.model.handL && player.model.handR, weapon.id + ': grip rig metadata missing');
    for (const pose of RIG_POSES) inspect(weapon, pose, weapon.id + '/' + pose.name);
    if (weapon.fire === 'melee') {
      for (const heavy of [false, true]) {
        const spec = heavy ? weapon.heavy : weapon, total = spec.windup + spec.activeTime + spec.recovery;
        const boundaries = [0, spec.windup / total, (spec.windup + spec.activeTime) / total, 1];
        const samples = new Set(Array.from({ length: 241 }, (_, i) => i / 240));
        for (const point of boundaries) for (const delta of [-1e-6, 0, 1e-6]) samples.add(Math.max(0, Math.min(1, point + delta)));
        for (const attack of Array.from(samples).sort((a, b) => a - b)) {
          inspect(weapon, { ...RIG_POSES[0], name: 'attack', attack, heavy }, weapon.id + '/attack-' + attack + '-' + heavy);
        }
        for (const boundary of boundaries) {
          const before = api.sampleMeleePose(weapon, Math.max(0, boundary - 1e-6), heavy);
          const after = api.sampleMeleePose(weapon, Math.min(1, boundary + 1e-6), heavy);
          assert(before.values.every((value, index) => Math.abs(value - after.values[index]) < 1e-3), weapon.id + ': pose discontinuity at phase boundary');
        }
        for (const [phase, age] of [['windup', spec.windup / 2], ['active', spec.windup + spec.activeTime / 2], ['recovery', spec.windup + spec.activeTime + spec.recovery / 2]]) {
          assert.strictEqual(api.sampleMeleePose(weapon, age / total, heavy).phase, phase, weapon.id + ': visual phase disagrees with combat');
          inspect(weapon, { ...RIG_POSES[2], name: 'moving-attack', attack: age / total, heavy }, weapon.id + '/moving-' + phase + '-' + heavy);
        }
        assert(api.sampleMeleePose(weapon, 1, heavy).values.every(v => v === 0), weapon.id + ': stroke does not settle to ready');
      }
      player.meleeAttack = null;
    } else {
      inspect(weapon, RIG_POSES[0], weapon.id + '/mechanism-idle');
      const parts = player.weaponMesh.userData.weaponParts;
      assert(parts.length && parts.every(p => p.name && p.geometry.userData.shared), weapon.id + ': missing shared moving mechanism');
      const poses = new Map(parts.map(p => [p.name, p.matrix.clone()]));
      inspect(weapon, RIG_POSES[6], weapon.id + '/mechanism-reload');
      const reloadPart = parts.find(p => ['magazine', 'cylinder', 'pump', 'breakBarrels', 'bowString'].includes(p.name));
      if (reloadPart) assert(!reloadPart.matrix.equals(poses.get(reloadPart.name)), weapon.id + ': reload mechanism never moves');
      assert(player.weaponMesh.material.isMeshStandardMaterial && !player.weaponMesh.material.flatShading,
        weapon.id + ': weapon lost its smooth physically lit material');
    }
  }
  player.x = -4; player.z = 11;
  player.applyLook(api.clampLook({ helmet: 'recon', shoulders: 'heavy', backpack: false }));
  for (let i = 0; i < api.WEAPONS.length; i++) {
    player.setWeapon(i);
    inspect(api.WEAPONS[i], RIG_POSES[4], api.WEAPONS[i].id + '/changed-look');
  }
  console.log('RIG_OK cases=' + cases + ' weapons=' + api.WEAPONS.length +
    ' maxGripError=' + worstGrip.toFixed(6) + ' maxSupportError=' + worstSupport.toFixed(6));
}

module.exports = { inspectRigPose, RIG_POSES };
if (require.main === module) main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
