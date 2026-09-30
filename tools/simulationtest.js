const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');
const context = vm.createContext({});
for (const file of ['00-util.js', '15-simulation.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
}
const { FixedStepClock, makeRng, sectorSeed, HitStop, HIT_STOP, SIM_DT } =
  vm.runInContext('({FixedStepClock, makeRng, sectorSeed, HitStop, HIT_STOP, SIM_DT})', context);
function run(schedule) {
  const clock = new FixedStepClock(), rng = makeRng(7632);
  let x = 0, shots = 0, ticks = 0, frame = 0;
  while (ticks < 600) {
    clock.advance(schedule[frame++ % schedule.length], dt => {
      x += (ticks % 80 < 40 ? 1 : -1) * dt;
      if (ticks % 7 === 0) shots += rng();
      return ++ticks < 600;
    });
  }
  return [x, shots, ticks, rng.getState()];
}
const reference = run([1 / 60]);
for (const schedule of [[1 / 30], [1 / 144], [0.003, 0.04, 0.011, 0.007]]) {
  assert.deepEqual(run(schedule), reference, 'frame schedule changed simulation');
}
const clock = new FixedStepClock();
let calls = 0, edge = true, actions = 0;
const update = () => { calls++; if (edge) { actions++; edge = false; } };
assert.equal(clock.advance(1 / 144, update).steps, 0);
assert.equal(edge, true, 'zero-tick frame consumed input');
clock.advance(1 / 30, update);
assert.equal(actions, 1, 'catch-up repeated input');
assert.equal(calls, 2);
clock.reset();
calls = 0;
const transition = clock.advance(0.1, () => { calls++; return false; });
assert.equal(calls, 1, 'state transition continued catch-up');
assert.equal(transition.alpha, 0);
clock.advance(30, update);
assert.equal(calls, 9, 'long stall exceeded catch-up limit');
assert(clock.droppedTime > 29);
for (const invalid of [NaN, Infinity, -1]) assert.equal(clock.advance(invalid, update).steps, 0);
const rng = makeRng(99), saved = rng.getState(), roll = rng();
rng.setState(saved); assert.equal(rng(), roll);
assert.equal(sectorSeed(12, 0), sectorSeed(12, 0));
assert.notEqual(sectorSeed(12, 0), sectorSeed(12, 1));
/* hit stop is counted in ticks, so it must behave the same at any frame rate */
const stop = new HitStop();
assert.equal(stop.active, false);
assert.equal(stop.consume(), false, 'idle freeze consumed a tick');
stop.freeze(HIT_STOP.crit);
assert.equal(stop.ticks, Math.round(HIT_STOP.crit / SIM_DT));
const short = stop.ticks;
stop.freeze(HIT_STOP.crit);
assert.equal(stop.ticks, short, 'equal freezes stacked');
stop.freeze(HIT_STOP.boss);
assert.equal(stop.ticks, Math.round(HIT_STOP.boss / SIM_DT), 'longer freeze did not win');
stop.freeze(HIT_STOP.crit);
assert.equal(stop.ticks, Math.round(HIT_STOP.boss / SIM_DT), 'shorter freeze cut a longer one');
let frozen = 0;
while (stop.consume()) frozen++;
assert.equal(frozen, Math.round(HIT_STOP.boss / SIM_DT));
assert.equal(stop.active, false);
for (const ignored of [0, -1, NaN, undefined]) {
  stop.freeze(ignored);
  assert.equal(stop.active, false, 'freeze accepted ' + ignored);
}
stop.freeze(10);
assert.equal(stop.ticks, stop.maxTicks, 'freeze exceeded the cap');
stop.clear();
assert.equal(stop.ticks, 0);
/* a freeze spends real ticks: the clock still advances the same number of
   steps, the world simply holds still during them */
const held = new FixedStepClock(), holder = new HitStop();
holder.freeze(HIT_STOP.heavy);
let moved = 0, ticks = 0;
for (let frame = 0; frame < 30; frame++) {
  held.advance(1 / 60, () => { ticks++; if (!holder.consume()) moved++; });
}
assert.equal(ticks, 30);
assert.equal(moved, 30 - Math.round(HIT_STOP.heavy / SIM_DT), 'freeze did not hold the world still');

console.log('SIMULATION_OK: 30/60/144 Hz + irregular frames, input retention, transitions, stall cap, RNG restore, tick-counted hit stop');
