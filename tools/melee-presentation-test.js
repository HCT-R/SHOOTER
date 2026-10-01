/* Presentation regression: real weapon timings with 20 Hz authority snapshots,
   30/60/144 Hz renders, latency/jitter, visibility changes and event replays. */
'use strict';
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const CombatCore = require('../src/62-combat-core.js');
const { WEAPONS, WEAPON_BY_ID } = require('../src/60-weapons.js');
let now = 0;
const angleLerp = (a, b, t) => a + Math.atan2(Math.sin(b - a), Math.cos(b - a)) * t;
const context = vm.createContext({ CombatCore, WEAPONS, WEAPON_BY_ID, performance: { now: () => now },
  ST_PLAY: 'play', S_CHASE: 1, S_DYING: 2, angleLerp, console });
vm.runInContext(fs.readFileSync(require.resolve('../src/94-modes.js'), 'utf8'), context);
const { ArenaMeleeClock, ArenaMatch, sampleArenaFrame } = vm.runInContext('({ArenaMeleeClock,ArenaMatch,sampleArenaFrame})', context);
let cases = 0, samples = 0;
function test(name, run) { run(); cases++; console.log('OK', name); }
function record(weapon, heavy, time, start = .3, seq = 1) {
  const spec = CombatCore.meleeStats(weapon, heavy), age = time - start, total = spec.windup + spec.activeTime + spec.recovery;
  const attacking = age >= 0 && age < total;
  return { id: 'remote', weaponId: weapon.id, alive: true, shotSeq: seq,
    attackHeavy: heavy, attackProgress: attacking ? age / total : 0,
    attackPhase: !attacking ? null : age < spec.windup ? 'windup' : age < spec.windup + spec.activeTime ? 'active' : 'recovery' };
}
test('all ten attacks remain continuous at 30/60/144 FPS and 50/100/200 ms latency', () => {
  for (const weapon of WEAPONS.filter(w => w.fire === 'melee')) for (const heavy of [false, true]) {
    const spec = CombatCore.meleeStats(weapon, heavy), total = spec.windup + spec.activeTime + spec.recovery;
    for (const fps of [30, 60, 144]) for (const latency of [.05, .1, .2]) {
      const clock = new ArenaMeleeClock(), frames = [], packets = [];
      let swings = 0, activeFrames = 0, previous = -1;
      for (let tick = 0; tick < (total + 1) * 20; tick++) {
        const time = tick / 20;
        // A dropped packet and modest receive jitter exercise a sparse buffer.
        if (tick === 10) continue;
        packets.push({ time, at: time + latency + (tick % 3) * .003, actor: record(weapon, heavy, time) });
      }
      for (let frame = 0; frame / fps < total + 1; frame++) {
        const at = frame / fps;
        while (packets.length && packets[0].at <= at) {
          const packet = packets.shift(); clock.observe(packet.actor, packet.time);
          clock.event({ type: 'melee', phase: 'windup', time: .3, weaponId: weapon.id, heavy }, packet.time);
          frames.push({ at: packet.at * 1000, time: packet.time, x: packet.time * 3, z: 0, angle: packet.time });
          if (frames.length > 8) frames.shift();
        }
        const pose = sampleArenaFrame(frames, at * 1000 - 85); if (!pose) continue;
        const visual = clock.sample(pose.time, () => swings++);
        if (at * 1000 - 85 <= frames[frames.length - 1].at) assert(Math.abs(pose.x / 3 - pose.time) < 1e-10, 'buffered movement and attack use one presentation time');
        else assert.equal(pose.x, frames[frames.length - 1].x, 'packet loss finishes known animation without extrapolating actor position');
        const age = pose.time - .3;
        if (age > .001 && age < total - .001) {
          assert(Math.abs(visual.progress - age / total) < 1e-8, weapon.id + ' phase matches authority time');
          assert(visual.progress + 1e-8 >= previous, 'same sequence never jumps backwards');
          assert.equal(visual.heavy, heavy); previous = visual.progress; activeFrames++;
        }
        samples++;
      }
      assert.equal(swings, 1, weapon.id + ' active swing audio plays once');
      assert(activeFrames >= Math.floor(total * fps) - 2, weapon.id + ' stroke remains visible between snapshots');
    }
  }
});
test('completed snapshots preserve delayed recovery and never restart a sequence', () => {
  const clock = new ArenaMeleeClock(), weapon = WEAPON_BY_ID.knife;
  clock.observe(record(weapon, false, .65), .65);
  clock.sample(.65);
  clock.observe(record(weapon, false, .75), .75);
  const delayed = clock.sample(.67);
  assert(delayed.progress > .8 && delayed.progress < 1);
  assert.equal(clock.sample(.8).progress, 0);
  clock.observe(record(weapon, false, .85), .85);
  clock.event({ type: 'melee', phase: 'windup', weaponId: weapon.id, time: .3 }, .85);
  assert.equal(clock.sample(.85).progress, 0);
  let replay = 0; clock.sample(.85, () => replay++); assert.equal(replay, 0);
});
test('event start merges into later sequence snapshot; distinct strokes stay distinct', () => {
  const clock = new ArenaMeleeClock(), weapon = WEAPON_BY_ID.knife;
  clock.observe(record(weapon, false, .25), .25);
  const event = { type: 'melee', phase: 'windup', weaponId: weapon.id, time: .3, heavy: false };
  clock.event(event, .4); clock.event(event, .4);
  clock.observe(record(weapon, false, .4), .4);
  assert.equal(clock.segments.length, 1); assert.equal(clock.segments[0].seq, 1);
  let swings = 0; clock.sample(.4, () => swings++); clock.sample(.41, () => swings++);
  clock.observe(record(weapon, true, .9, .85, 2), .9);
  clock.event({ ...event, time: .85, heavy: true }, .9);
  clock.sample(1.1, () => swings++);
  assert.equal(swings, 2); assert.equal(clock.sample(1.1).heavy, true);
});
test('strike direction follows the authority event even when the actor keeps aiming', () => {
  const clock = new ArenaMeleeClock(), weapon = WEAPON_BY_ID.spear;
  clock.observe({ ...record(weapon, true, .35), angle: 0 }, .35);
  clock.event({ type: 'melee', phase: 'windup', weaponId: weapon.id, time: .3, heavy: true, angle: .4 }, .35);
  clock.observe({ ...record(weapon, true, .6), angle: 2.1 }, .6);
  assert.equal(clock.sample(.6).angle, .4, 'aim updates cannot rotate the locked strike');
  clock.reset(); clock.observe({ ...record(weapon, true, .8), angle: 2.1 }, .8);
  clock.event({ type: 'melee', phase: 'active', weaponId: weapon.id, time: .74, heavy: true, angle: .4 }, .8);
  assert.equal(clock.sample(.8).angle, .4, 'active event corrects a stroke first observed mid-animation');
  assert.equal(clock.sample(2).angle, null, 'ready pose resumes live aim after recovery');
});
test('death, weapon switch, hidden actors, round and match disposal clear animations', () => {
  const player = { hp: 100, weaponIndex: 0, weapon: WEAPONS[0],
    setWeapon(index) { this.weaponIndex = index; this.weapon = WEAPONS[index]; } };
  const game = { state: 'play', player, stats: {}, runSeed: 1, scene: { remove() {} } };
  const arena = new ArenaMatch(game, 'ffa', { online: true, headless: true, localId: 'local' });
  function snapshot(time, changes = {}) {
    const body = { ...record(WEAPON_BY_ID.machete, true, time), hp: 100, maxHp: 100, x: 0, z: 0, angle: 0, vx: 0, vz: 0,
      owned: {}, mags: {}, ammo: {}, weaponSlots: ['pistol', 'machete'], reloading: 0 };
    return { version: CombatCore.VERSION, modeId: 'ffa', time, seed: 1, phase: 'active', round: 1,
      self: { ...body, id: 'local' }, actors: [body], roster: [], events: [], ...changes };
  }
  now = 1000; arena.applySnapshot(snapshot(.5));
  const remote = arena.participants.get('remote'); assert(remote.meleeVisual.segments.length);
  arena.applySnapshot(snapshot(.55, { actors: [] }));
  assert.equal(remote.meleeVisual.segments.length, 0); assert(!arena.participants.has('remote'));
  arena.lastEvent = 50;
  arena.applySnapshot(snapshot(.6, { events: [{ id: 10, type: 'melee', phase: 'windup', actorId: 'remote', weaponId: 'machete', heavy: true, time: .3, angle: .8 }] }));
  assert.equal(arena.participants.get('remote').meleeVisual.sample(.6).angle, .8, 'retained authority event restores direction after visibility redaction');
  const died = snapshot(.6); died.self.alive = false; arena.applySnapshot(died);
  assert.equal(player.attackProgress, 0); assert.equal(player.meleeVisual.segments.length, 0);
  arena.applySnapshot(snapshot(.65));
  const switched = snapshot(.7); switched.self.weaponId = 'pistol'; arena.applySnapshot(switched);
  assert.equal(player.attackProgress, 0); assert.equal(player.meleeVisual.segments.length, 0);
  arena.applySnapshot(snapshot(.75));
  arena.applySnapshot(snapshot(.8, { round: 2, phase: 'roundBreak' }));
  assert.equal(player.meleeVisual.segments.length, 0);
  arena.applySnapshot(snapshot(.85, { round: 2 }));
  arena.dispose(); assert.equal(player.meleeVisual.segments.length, 0);
});
test('lost packets finish known strokes without inventing movement or another attack', () => {
  const game = { state: 'play', player: {}, stats: {}, runSeed: 1 };
  const arena = new ArenaMatch(game, 'ffa', { online: true, headless: true });
  arena.latest = { time: 5 }; arena.phase = 'active'; arena.snapshotAt = 1000;
  assert.equal(arena.presentationTime(1030), 5.03); assert.equal(arena.presentationTime(9000), 7);
  for (const weapon of WEAPONS.filter(w => w.fire === 'melee')) {
    const clock = new ArenaMeleeClock(); clock.observe(record(weapon, true, .35), .35);
    const frozenFrames = [{ time: .35, at: 1000, x: 2, z: 3, angle: .4 }];
    const rendered = sampleArenaFrame(frozenFrames, 4000 - 85);
    assert.equal(rendered.x, 2); assert.equal(rendered.z, 3);
    assert.equal(clock.sample(rendered.time).progress, 0, weapon.id + ' cannot become a stuck remote pose');
    assert.equal(clock.sample(.35 + 2).progress, 0, weapon.id + ' cannot become a stuck owner pose');
  }
  arena.latest.paused = true; assert.equal(arena.presentationTime(9000), 5);
  arena.latest.paused = false; arena.phase = 'finished'; assert.equal(arena.presentationTime(9000), 5);
});
console.log('MELEE_PRESENTATION_OK', cases, 'cases;', samples, 'render samples; 10 attacks x 3 FPS x 3 latency profiles');
