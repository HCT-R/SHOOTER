/* ========================================================================
   86-hazards.js — persistent floor hazards
   ======================================================================== */

/* A hazard is a circle on the floor that hurts whoever stands in it. It is the
   arena half of the finale: the Overmind does not only change its own attacks
   between phases, it takes floor away, and the fight moves because the ground
   stops being safe rather than because the boss asked it to.

   Two rules are deliberate and both are tested:

   Damage lands on a fixed tick, not per frame. A per-frame fraction would make
   a hazard bite harder on a faster machine, and the replay comparison across
   30/60/144 Hz would drift apart on nothing but a floor pool.

   A hazard arms before it bites. An eruption that appears under the player and
   hurts in the same instant is not a fight, it is a dice roll: the arming
   window is exactly the time it takes to walk out of one.

   Nothing here draws from the run RNG. A caller that wants a ring of hazards
   passes the angle it wants it turned to, so the fight stays reproducible by
   seed without this file having an opinion about randomness. */

const HAZARD_CAP = 48;
const HAZARD_TICK = 0.55;
const HAZARD_WARM = 0.85;
const HAZARD_FADE = 1.1;

const _hzPos = new THREE.Vector3();
const _hzScl = new THREE.Vector3();
const _hzMtx = new THREE.Matrix4();
const _hzCol = new THREE.Color();
const _hzFlat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

class Hazards {
  constructor(game) {
    this.game = game;
    this.cap = HAZARD_CAP;
    this.n = 0;
    const f = () => new Float32Array(this.cap);
    this.px = f(); this.pz = f(); this.radius = f();
    this.life = f(); this.max = f(); this.warm = f(); this.next = f();
    this.damage = f();
    this.r = f(); this.g = f(); this.b = f();

    if (typeof THREE === 'undefined' || !game.scene) return;
    // a bright rim over a dim pool reads as a hole in the floor rather than as
    // a decal, and costs one instanced draw for the whole fight
    const geo = new THREE.RingGeometry(0.18, 1, 44, 3);
    const position = geo.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const at = Math.hypot(position.getX(i), position.getY(i));
      const edge = clamp((at - 0.18) / 0.82, 0, 1);
      const brightness = 0.22 + edge * edge * 1.5;
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = brightness;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.7,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 3;
    game.scene.add(this.mesh);
  }

  spawn(x, z, radius, life, damage, color) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) ||
        !Number.isFinite(life) || radius <= 0 || life <= 0) return -1;
    let i = this.n;
    if (this.n < this.cap) this.n++;
    else {
      // recycle whatever is closest to closing, so a fresh eruption is never
      // the one dropped
      i = 0;
      for (let k = 1; k < this.cap; k++) {
        if (this.life[k] < this.life[i]) i = k;
      }
    }
    this.px[i] = x; this.pz[i] = z; this.radius[i] = radius;
    this.life[i] = this.max[i] = life;
    this.warm[i] = HAZARD_WARM;
    this.next[i] = 0;
    this.damage[i] = Number.isFinite(damage) ? damage : 0;
    _hzCol.set(color === undefined ? 0xff4d7a : color);
    this.r[i] = _hzCol.r; this.g[i] = _hzCol.g; this.b[i] = _hzCol.b;
    return i;
  }

  /* A ring of hazards around a point. `turn` is supplied by the caller rather
     than rolled here, so the same seed erupts the same way, and `accept` lets
     the caller veto a position — a wall, a pit, whatever it knows about that
     this file deliberately does not. */
  ring(x, z, spread, count, radius, life, damage, color, turn, accept) {
    const made = [];
    const total = Math.max(1, count | 0);
    for (let k = 0; k < total; k++) {
      const a = (turn || 0) + k / total * Math.PI * 2;
      const hx = x + Math.cos(a) * spread, hz = z + Math.sin(a) * spread;
      if (accept && !accept(hx, hz)) continue;
      const at = this.spawn(hx, hz, radius, life, damage, color);
      if (at >= 0) made.push(at);
    }
    return made;
  }

  get count() { return this.n; }

  /* Only an armed hazard that is not already fading can hurt; the same test
     answers "is this tile dangerous" for anything that wants to avoid one. */
  biting(i) {
    return this.warm[i] <= 0 && this.life[i] > HAZARD_FADE;
  }

  dangerAt(x, z) {
    for (let i = 0; i < this.n; i++) {
      if (!this.biting(i)) continue;
      const dx = x - this.px[i], dz = z - this.pz[i];
      if (dx * dx + dz * dz <= this.radius[i] * this.radius[i]) return true;
    }
    return false;
  }

  clear() {
    this.n = 0;
    if (this.mesh) this.mesh.count = 0;
  }

  update(dt, player) {
    let i = 0;
    while (i < this.n) {
      const remaining = this.life[i] - dt;
      if (remaining <= 0) {
        const last = --this.n;
        this.px[i] = this.px[last]; this.pz[i] = this.pz[last];
        this.radius[i] = this.radius[last];
        this.life[i] = this.life[last]; this.max[i] = this.max[last];
        this.warm[i] = this.warm[last]; this.next[i] = this.next[last];
        this.damage[i] = this.damage[last];
        this.r[i] = this.r[last]; this.g[i] = this.g[last]; this.b[i] = this.b[last];
        continue;
      }
      this.life[i] = remaining;
      if (this.warm[i] > 0) { this.warm[i] -= dt; i++; continue; }
      this.next[i] -= dt;
      if (this.next[i] <= 0) {
        this.next[i] = HAZARD_TICK;
        if (player && player.alive && this.damage[i] > 0 && remaining > HAZARD_FADE) {
          const dx = player.x - this.px[i], dz = player.z - this.pz[i];
          if (dx * dx + dz * dz <= this.radius[i] * this.radius[i]) {
            this.game.damagePlayer(this.damage[i], this.px[i], this.pz[i]);
          }
        }
      }
      i++;
    }
  }

  render() {
    if (!this.mesh) return;
    for (let i = 0; i < this.n; i++) {
      // grows while arming, shrinks while closing, so the dangerous middle of
      // its life is the only time it looks full size
      const arming = this.warm[i] > 0 ? 1 - this.warm[i] / HAZARD_WARM : 1;
      const closing = Math.min(1, this.life[i] / HAZARD_FADE);
      const size = this.radius[i] * (0.35 + 0.65 * arming) * (0.45 + 0.55 * closing);
      _hzPos.set(this.px[i], 0.06 + (i % 5) * 0.001, this.pz[i]);
      _hzScl.set(size, size, 1);
      _hzMtx.compose(_hzPos, _hzFlat, _hzScl);
      this.mesh.setMatrixAt(i, _hzMtx);
      // an arming hazard pulses so it reads as a warning, not as damage
      const pulse = this.warm[i] > 0 ? 0.45 + Math.abs(Math.sin(this.warm[i] * 14)) * 0.55 : closing;
      _hzCol.setRGB(this.r[i] * pulse, this.g[i] * pulse, this.b[i] * pulse);
      this.mesh.setColorAt(i, _hzCol);
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }
}
