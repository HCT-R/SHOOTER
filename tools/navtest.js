/* CPU-only navigation, seeded enemy state and interpolation regressions.
   Run with: node tools/navtest.js. No renderer, browser or npm dependencies. */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const root = path.resolve(__dirname, '..');
const testMath = Object.create(Math);
const context = { Math: testMath, console };
for (const name of ['Crawler', 'Grunt', 'Spitter', 'Flyer', 'Brute', 'Queen', 'Siege', 'Warden', 'Overmind']) {
  context['build' + name] = () => {};
}
vm.createContext(context);
for (const file of ['00-util.js', '30-level.js', '60-weapons.js', '62-combat-core.js', '70-enemies.js']) {
  new vm.Script(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file }).runInContext(context);
}
const { LevelMap, EnemyManager, makeRng, SpatialHash } = vm.runInContext(
  '({ LevelMap, EnemyManager, makeRng, SpatialHash })', context);

function map(width, height, carve) {
  const level = new LevelMap(width, height, 3107);
  level.grid.fill(1);
  carve(level);
  level._initNavRouting();
  return level;
}

function fieldDistance(level, x, z, profile) {
  const ix = Math.floor((x + level.w * 1.5) / level.navStep);
  const iz = Math.floor((z + level.h * 1.5) / level.navStep);
  return level._navProfiles[profile].dist[iz * level.navWidth + ix];
}

function follow(level, start, target, radius) {
  const pos = { ...start }, dir = { x: 0, z: 0 };
  let maxDetour = 0;
  for (let i = 0; i < 800; i++) {
    if (Math.hypot(pos.x - target.x, pos.z - target.z) < 2) return { pos, maxDetour };
    assert(level.flowDir(pos.x, pos.z, dir, radius), 'reachable agent has no flow direction at ' + JSON.stringify(pos));
    assert(Math.hypot(dir.x, dir.z) > 0, 'agent stopped before reaching target');
    const nx = pos.x + dir.x * 0.15, nz = pos.z + dir.z * 0.15;
    assert(level.obstacleLineClear(pos.x, pos.z, nx, nz, radius), 'steering intersects a solid prop');
    pos.x = nx; pos.z = nz;
    level.resolveCircle(pos, radius);
    assert(!level.isWallAt(pos.x, pos.z), 'agent entered a wall');
    maxDetour = Math.max(maxDetour, Math.abs(pos.z - start.z));
  }
  assert.fail('flow failed to reach the player within bounded steps');
}

// A radius2.05 boss fits the real six-unit corridor, although it cannot fit
// at either original tile centre. Fine nodes must preserve that route.
const corridor = map(20, 12, level => level._carveRect(1, 5, 18, 2));
const start = { x: -22, z: 0 }, goal = { x: 22, z: 0 };
corridor.rebuildNav(goal.x, goal.z);
assert(fieldDistance(corridor, start.x, start.z, 2) >= 0, 'boss corridor was artificially sealed');
follow(corridor, start, goal, 2.05);

// Props are separate from wall topology. Small agents route around the
// barrel; its actual remaining clearance is too narrow for a boss.
const barrel = { alive: true };
corridor.setObstacles([{ x: 0, z: 0, r: 0.65, barrel }]);
corridor.rebuildNav(goal.x, goal.z);
assert(fieldDistance(corridor, start.x, start.z, 0) >= 0, 'small agent cannot route around barrel');
assert.equal(fieldDistance(corridor, start.x, start.z, 2), -1, 'boss routed through a physically narrow gap');
assert(follow(corridor, start, goal, 0.41).maxDetour > 1, 'agent did not detour around barrel');
barrel.alive = false;
corridor.setObstacles([]);
assert.equal(corridor.navTimer, 0, 'destroyed barrel did not invalidate navigation');
corridor.rebuildNav(goal.x, goal.z);
assert(fieldDistance(corridor, start.x, start.z, 2) >= 0, 'destroyed barrel left a stale obstruction');

const room = map(14, 14, level => level._carveRect(1, 1, 12, 12));
room.setObstacles([{ x: 0, z: 0, r: 1.35 }]);
room.rebuildNav(10, 0);
assert(!room.obstacleLineClear(-10, 0, 10, 0, 0.51), 'direct chase ignored a container');
assert(follow(room, { x: -10, z: 0 }, { x: 10, z: 0 }, 0.51).maxDetour > 1.85,
  'container route did not clear the agent radius');

// Seeded layouts retain connected spawn points in every sector.
for (let sector = 0; sector < 3; sector++) {
  for (const seed of [7, 8191]) {
    const a = new LevelMap(48, 48, seed, sector), b = new LevelMap(48, 48, seed, sector);
    assert.deepStrictEqual(Array.from(a.grid), Array.from(b.grid));
    assert.equal(JSON.stringify(a.spawnPoints), JSON.stringify(b.spawnPoints));
    assert.equal(JSON.stringify(a.propSpots), JSON.stringify(b.propSpots));
    a.rebuildNav(a.start.x, a.start.z);
    for (const spawn of a.spawnPoints) {
      assert(a.navDist[a.idx(a.worldToTileX(spawn.x), a.worldToTileZ(spawn.z))] >= 0,
        'generated spawn disconnected from player');
    }
  }
}

// Enemy simulation can run without constructing any Three.js meshes.
function manager(seed) {
  const enemy = Object.create(EnemyManager.prototype);
  enemy.list = []; enemy.nextId = 1; enemy._fallbackRng = makeRng(123);
  enemy.game = { rng: makeRng(seed) };
  enemy.meshes = []; enemy.warnings = { count: 0 };
  return enemy;
}
function snapshot(enemy) {
  return enemy.list.map(e => ({ id: e.id, x: e.x, z: e.z, y: e.y, speed: e.speed,
    angle: e.angle, phase: e.phase, cd: e.cd, rangedCd: e.rangedCd, specialCd: e.specialCd }));
}
testMath.random = () => 0.1;
const first = manager(98765);
for (const type of ['crawler', 'flyer', 'queen']) first.spawn(type, 3, 4);
testMath.random = () => 0.91;
const second = manager(98765);
for (const type of ['crawler', 'flyer', 'queen']) second.spawn(type, 3, 4);
assert.equal(JSON.stringify(snapshot(first)), JSON.stringify(snapshot(second)), 'cosmetics changed seeded enemy state');
assert.deepStrictEqual(Array.from(first.list, e => e.id), [1, 2, 3]);
first.reset();
assert.equal(first.spawn('crawler', 0, 0).id, 1, 'enemy IDs did not reset');

function summonSnapshot(cosmeticValue) {
  testMath.random = () => cosmeticValue;
  context.sfx = { screech() {} };
  const enemy = manager(77), summoned = [];
  enemy.hash = new SpatialHash(2.5); enemy.neighbors = []; enemy._dir = { x: 0, z: 0 };
  enemy.game.level = { lineOfSight: () => false,
    flowDir(x, z, out) { out.x = 1; out.z = 0; }, resolveCircle() {} };
  enemy.game.spawnEnemyAt = (type, x, z) => summoned.push({ type, x, z });
  const queen = enemy.spawn('queen', 4, 6);
  queen.addTimer = 0;
  enemy.update(1 / 60, { x: 100, z: 0, alive: true, vx: 0, vz: 0 });
  assert.equal(queen.prevX, 4); assert.equal(queen.prevZ, 6);
  assert.equal(summoned.length, 4, 'queen did not summon expected adds');
  return JSON.stringify({ state: snapshot(enemy), summoned });
}
assert.equal(summonSnapshot(0.01), summonSnapshot(0.98), 'cosmetic randomness changed queen summons');

// A minimal render sink checks interpolation at the same coordinates used
// by instanced bodies, warning rings and blob shadows, without a GPU.
const e = second.list[2];
second.list = [e];
e.prevX = -4; e.x = 8; e.prevZ = 2; e.z = 10;
e.prevY = 0; e.y = 2; e.prevAngle = 3.1; e.angle = -3.1;
e.prevPhase = e.phase = 0; e.state = 4; e.specialKind = 'nova'; e.timer = 0.5;
const vector = () => ({ set(x, y, z) { this.x = x; this.y = y; this.z = z; } });
second._renderCounts = new Uint16Array(8);
second._p = vector(); second._s = vector(); second._eul = vector();
second._q = { setFromEuler(value) { this.y = value.y; } };
second._m = { compose(p, q) { this.x = p.x; this.y = p.y; this.z = p.z; this.angle = q.y; } };
second._c = { setRGB() {}, set() {}, multiplyScalar() {} };
const matrices = [], shadows = [], warnings = [];
const mesh = { instanceMatrix: {}, setMatrixAt(i, m) { matrices.push({ ...m }); }, setColorAt() {} };
second.meshes = Array.from({ length: 8 }, () => mesh);
second.warnings = { instanceMatrix: {}, setMatrixAt(i, m) { warnings.push({ ...m }); }, setColorAt() {} };
const before = JSON.stringify(snapshot(second));
second.render({ add(x, z) { shadows.push({ x, z }); } }, 0.25);
assert.equal(matrices[0].x, -1); assert.equal(matrices[0].z, 4);
assert(Math.abs(matrices[0].angle - Math.PI) < 0.05, 'angle interpolation took long path');
assert.deepStrictEqual(shadows[0], { x: -1, z: 4 });
assert.equal(warnings[0].x, -1); assert.equal(warnings[0].z, 4);
assert.equal(JSON.stringify(snapshot(second)), before, 'render mutated simulation');

console.log('PASS nav: boss corridor, prop detours, radius clearance, barrel invalidation, 6 seeded maps; enemy RNG/IDs and render interpolation');
