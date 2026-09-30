/* 60 Hz simulation clock. Inputs are consumed by a tick, never by a render.
   Long stalls deliberately discard excess time instead of fast-forwarding
   combat. Returning false from step stops catch-up at a state transition. */
const SIM_DT = 1 / 60;
class FixedStepClock {
  constructor(step = SIM_DT, maxSteps = 8) {
    this.step = step;
    this.maxSteps = maxSteps;
    this.accumulator = 0;
    this.droppedTime = 0;
  }
  reset() { this.accumulator = 0; }
  advance(elapsed, update) {
    if (!Number.isFinite(elapsed) || elapsed < 0) elapsed = 0;
    const accepted = Math.min(elapsed, this.step * this.maxSteps);
    this.droppedTime += elapsed - accepted;
    this.accumulator += accepted;
    let steps = 0;
    while (this.accumulator + 1e-10 >= this.step && steps < this.maxSteps) {
      this.accumulator = Math.max(0, this.accumulator - this.step);
      steps++;
      if (update(this.step) === false) { this.reset(); break; }
    }
    return { steps, alpha: clamp(this.accumulator / this.step, 0, 1) };
  }
}

/* Impact freeze. Durations are converted to whole ticks on the way in, so a
   freeze is part of the simulation and not of wall-clock time: the same seed
   and the same commands still produce the same run at any frame rate.
   Freezes never stack — the longest pending one wins and is capped. */
const HIT_STOP = { crit: 0.035, heavy: 0.05, boss: 0.09, rail: 0.045 };
class HitStop {
  constructor(step = SIM_DT, cap = 0.12) {
    this.step = step;
    this.maxTicks = Math.max(1, Math.round(cap / step));
    this.ticks = 0;
  }
  /* seconds <= 0 (or a disabled effect) is a no-op, so callers can pass a
     scale of 0 instead of branching at every call site */
  freeze(seconds) {
    if (!(seconds > 0)) return this.ticks;
    const want = Math.min(this.maxTicks, Math.round(seconds / this.step));
    if (want > this.ticks) this.ticks = want;
    return this.ticks;
  }
  /* true while combat should hold still; spends one tick per call */
  consume() {
    if (this.ticks <= 0) return false;
    this.ticks--;
    return true;
  }
  clear() { this.ticks = 0; }
  get active() { return this.ticks > 0; }
}

/* Only seed creation uses external entropy; gameplay consumes game.rng. */
function freshRunSeed() {
  if (globalThis.crypto && globalThis.crypto.getRandomValues) {
    return globalThis.crypto.getRandomValues(new Uint32Array(1))[0];
  }
  return (Math.random() * 4294967296) >>> 0;
}

function sectorSeed(runSeed, sectorIndex) {
  return makeRng((runSeed ^ Math.imul(sectorIndex + 1, 0x9e3779b9)) >>> 0).int(0, 0xffffffff);
}
