/* ========================================================================
   50-fx.js — instanced particles, gore decals, tracers, dynamic flashes

   Particles are stored as parallel typed arrays (structure-of-arrays) and
   uploaded to one InstancedMesh per layer, so a thousand of them still
   costs a single draw call.
   ======================================================================== */

/* adds a per-instance alpha attribute to a stock material */
function patchInstanceAlpha(material, capacity) {
  const arr = new Float32Array(capacity).fill(1);
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = 'attribute float aAlpha;\nvarying float vAlpha;\n' +
      shader.vertexShader.replace('void main() {', 'void main() {\n  vAlpha = aAlpha;');
    shader.fragmentShader = 'varying float vAlpha;\n' +
      shader.fragmentShader.replace(
        '#include <map_fragment>',
        '#include <map_fragment>\n  diffuseColor.a *= vAlpha;'
      );
  };
  material.customProgramCacheKey = () => 'instAlpha';
  return arr;
}

const _fxMtx = new THREE.Matrix4();
const _fxPos = new THREE.Vector3();
const _fxScl = new THREE.Vector3();
const _fxQuat = new THREE.Quaternion();
const _fxCol = new THREE.Color();
const _flatQuat = new THREE.Quaternion().setFromEuler(new THREE.Euler(-Math.PI / 2, 0, 0));

/* ---------------------------------------------------------------- sparks */
class SparkFX {
  constructor(scene, capacity) {
    this.cap = capacity;
    this.n = 0;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.max = f(); this.size = f(); this.grav = f();
    this.r = f(); this.g = f(); this.b = f();

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.glow,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 8;
    scene.add(this.mesh);
  }

  emit(x, y, z, vx, vy, vz, life, size, color, gravity) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = (Math.random() * this.cap) | 0;   // full: displace a random particle
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = life; this.max[i] = life;
    this.size[i] = size;
    this.grav[i] = gravity === undefined ? 0 : gravity;
    _fxCol.set(color);
    this.r[i] = _fxCol.r; this.g[i] = _fxCol.g; this.b[i] = _fxCol.b;
  }

  burst(x, y, z, count, speed, life, size, color, spreadY, gravity) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * TAU;
      const s = speed * (0.35 + Math.random() * 0.65);
      const up = (Math.random() * 2 - 1) * (spreadY === undefined ? 0.6 : spreadY);
      this.emit(x, y, z,
        Math.cos(a) * s, up * s + s * 0.25, Math.sin(a) * s,
        life * (0.6 + Math.random() * 0.7), size * (0.6 + Math.random() * 0.8),
        color, gravity);
    }
  }

  update(dt, camQuat) {
    let i = 0;
    while (i < this.n) {
      let l = this.life[i] - dt;
      if (l <= 0) {
        // swap-remove keeps the live range packed
        const last = --this.n;
        this.px[i] = this.px[last]; this.py[i] = this.py[last]; this.pz[i] = this.pz[last];
        this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
        this.life[i] = this.life[last]; this.max[i] = this.max[last];
        this.size[i] = this.size[last]; this.grav[i] = this.grav[last];
        this.r[i] = this.r[last]; this.g[i] = this.g[last]; this.b[i] = this.b[last];
        continue;
      }
      this.life[i] = l;
      this.vy[i] -= this.grav[i] * dt;
      const drag = 1 - Math.min(1, 2.2 * dt);
      this.vx[i] *= drag; this.vz[i] *= drag;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      if (this.py[i] < 0.05) { this.py[i] = 0.05; this.vy[i] *= -0.3; }

      const t = l / this.max[i];
      const s = this.size[i] * (0.35 + t * 0.85);
      _fxPos.set(this.px[i], this.py[i], this.pz[i]);
      _fxScl.set(s, s, s);
      _fxMtx.compose(_fxPos, camQuat, _fxScl);
      this.mesh.setMatrixAt(i, _fxMtx);
      // additive: darkening toward black is the fade
      _fxCol.setRGB(this.r[i] * t, this.g[i] * t, this.b[i] * t);
      this.mesh.setColorAt(i, _fxCol);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}

/* ------------------------------------------------------ ground shockwaves */
class ShockwaveFX {
  constructor(scene, capacity = 24) {
    this.cap = Math.max(1, capacity | 0);
    this.n = 0;
    const f = () => new Float32Array(this.cap);
    this.px = f(); this.pz = f(); this.radius = f();
    this.life = f(); this.max = f();
    this.r = f(); this.g = f(); this.b = f();

    // An open, narrow band keeps the centre of the blast and its targets
    // visible. Vertex brightness softens both edges without a new texture.
    const geo = new THREE.RingGeometry(0.9, 1, 64, 3);
    const position = geo.attributes.position;
    const colors = new Float32Array(position.count * 3);
    for (let i = 0; i < position.count; i++) {
      const radius = Math.hypot(position.getX(i), position.getY(i));
      const edge = clamp((radius - 0.9) / 0.1, 0, 1);
      const brightness = Math.sin(edge * Math.PI);
      colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = brightness;
    }
    geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.MeshBasicMaterial({
      vertexColors: true, transparent: true, opacity: 0.82,
      blending: THREE.AdditiveBlending, depthWrite: false,
      toneMapped: false, side: THREE.DoubleSide
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, this.cap);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(this.cap * 3), 3);
    this.mesh.instanceColor.setUsage(THREE.DynamicDrawUsage);
    this.mesh.count = 0;
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 4;
    scene.add(this.mesh);
  }

  emit(x, z, radius, color, life = 0.6) {
    if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(radius) ||
        !Number.isFinite(life) || radius <= 0 || life <= 0) return false;
    let i = this.n;
    if (this.n < this.cap) this.n++;
    else {
      // Recycle the most faded wave, preserving newly created explosions.
      i = 0;
      for (let k = 1; k < this.cap; k++) {
        if (this.life[k] / this.max[k] < this.life[i] / this.max[i]) i = k;
      }
    }
    this.px[i] = x; this.pz[i] = z; this.radius[i] = radius;
    this.life[i] = this.max[i] = life;
    _fxCol.set(color);
    this.r[i] = _fxCol.r; this.g[i] = _fxCol.g; this.b[i] = _fxCol.b;
    return true;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      const remaining = this.life[i] - dt;
      if (remaining <= 0) {
        const last = --this.n;
        this.px[i] = this.px[last]; this.pz[i] = this.pz[last];
        this.radius[i] = this.radius[last];
        this.life[i] = this.life[last]; this.max[i] = this.max[last];
        this.r[i] = this.r[last]; this.g[i] = this.g[last]; this.b[i] = this.b[last];
        continue;
      }
      this.life[i] = remaining;
      const t = remaining / this.max[i];
      // Fast initial expansion eases towards the actual blast radius.
      const size = this.radius[i] * (0.12 + 0.88 * (1 - t * t));
      const brightness = t * t;
      _fxPos.set(this.px[i], 0.075 + (i % 4) * 0.001, this.pz[i]);
      _fxScl.set(size, size, 1);
      _fxMtx.compose(_fxPos, _flatQuat, _fxScl);
      this.mesh.setMatrixAt(i, _fxMtx);
      _fxCol.setRGB(this.r[i] * brightness, this.g[i] * brightness, this.b[i] * brightness);
      this.mesh.setColorAt(i, _fxCol);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}

/* ------------------------------------------------------------------ gibs */
class GibFX {
  constructor(scene, capacity) {
    this.cap = capacity;
    this.n = 0;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.rx = f(); this.ry = f(); this.rz = f();
    this.wx = f(); this.wy = f(); this.wz = f();
    this.life = f(); this.max = f(); this.size = f();
    this.r = f(); this.g = f(); this.b = f();

    const geo = new THREE.IcosahedronGeometry(0.5, 0);
    const mat = new THREE.MeshLambertMaterial({ vertexColors: false });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.castShadow = false;
    scene.add(this.mesh);
    this._eul = new THREE.Euler();
  }

  emit(x, y, z, vx, vy, vz, size, color, life) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = (Math.random() * this.cap) | 0;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.rx[i] = Math.random() * TAU; this.ry[i] = Math.random() * TAU; this.rz[i] = Math.random() * TAU;
    this.wx[i] = (Math.random() - 0.5) * 18;
    this.wy[i] = (Math.random() - 0.5) * 18;
    this.wz[i] = (Math.random() - 0.5) * 18;
    this.size[i] = size;
    this.life[i] = this.max[i] = life === undefined ? 6 : life;
    _fxCol.set(color);
    this.r[i] = _fxCol.r; this.g[i] = _fxCol.g; this.b[i] = _fxCol.b;
  }

  burst(x, y, z, count, speed, size, color) {
    for (let k = 0; k < count; k++) {
      const a = Math.random() * TAU;
      const s = speed * (0.3 + Math.random() * 0.9);
      this.emit(x, y + Math.random() * 0.4, z,
        Math.cos(a) * s, 2 + Math.random() * s, Math.sin(a) * s,
        size * (0.5 + Math.random()), color, 5 + Math.random() * 4);
    }
  }

  update(dt, level, onLand) {
    let i = 0;
    while (i < this.n) {
      let l = this.life[i] - dt;
      if (l <= 0) {
        const last = --this.n;
        const cp = (a) => { a[i] = a[last]; };
        cp(this.px); cp(this.py); cp(this.pz);
        cp(this.vx); cp(this.vy); cp(this.vz);
        cp(this.rx); cp(this.ry); cp(this.rz);
        cp(this.wx); cp(this.wy); cp(this.wz);
        cp(this.life); cp(this.max); cp(this.size);
        cp(this.r); cp(this.g); cp(this.b);
        continue;
      }
      this.life[i] = l;
      this.vy[i] -= 22 * dt;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;

      const rest = this.size[i] * 0.45;
      if (this.py[i] <= rest) {
        this.py[i] = rest;
        if (this.vy[i] < -1.5) {
          this.vy[i] *= -0.32;
          this.vx[i] *= 0.55; this.vz[i] *= 0.55;
          if (onLand && Math.random() < 0.5) onLand(this.px[i], this.pz[i], this.r[i], this.g[i], this.b[i]);
        } else {
          this.vy[i] = 0;
          this.vx[i] *= 1 - Math.min(1, 7 * dt);
          this.vz[i] *= 1 - Math.min(1, 7 * dt);
          this.wx[i] *= 0.9; this.wy[i] *= 0.9; this.wz[i] *= 0.9;
        }
      } else if (level && level.isWallAt(this.px[i], this.pz[i])) {
        this.vx[i] *= -0.4; this.vz[i] *= -0.4;
        this.px[i] += this.vx[i] * dt * 2;
        this.pz[i] += this.vz[i] * dt * 2;
      }

      this.rx[i] += this.wx[i] * dt;
      this.ry[i] += this.wy[i] * dt;
      this.rz[i] += this.wz[i] * dt;

      // sink through the floor over the last second instead of popping out
      const fade = Math.min(1, l / 1.0);
      const s = this.size[i];
      this._eul.set(this.rx[i], this.ry[i], this.rz[i]);
      _fxQuat.setFromEuler(this._eul);
      _fxPos.set(this.px[i], this.py[i] - (1 - fade) * s, this.pz[i]);
      _fxScl.set(s, s, s);
      _fxMtx.compose(_fxPos, _fxQuat, _fxScl);
      this.mesh.setMatrixAt(i, _fxMtx);
      _fxCol.setRGB(this.r[i], this.g[i], this.b[i]);
      this.mesh.setColorAt(i, _fxCol);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}

/* ----------------------------------------------------------------- smoke */
class SmokeFX {
  constructor(scene, capacity) {
    this.cap = capacity;
    this.n = 0;
    const f = () => new Float32Array(capacity);
    this.px = f(); this.py = f(); this.pz = f();
    this.vx = f(); this.vy = f(); this.vz = f();
    this.life = f(); this.max = f(); this.size = f(); this.grow = f(); this.spin = f(); this.rot = f();
    this.r = f(); this.g = f(); this.b = f(); this.alpha = f();

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.smoke,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    });
    this.aAlpha = patchInstanceAlpha(mat, capacity);
    geo.setAttribute('aAlpha', new THREE.InstancedBufferAttribute(this.aAlpha, 1));
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 7;
    scene.add(this.mesh);
    this._attr = geo.attributes.aAlpha;
  }

  emit(x, y, z, vx, vy, vz, life, size, grow, color, alpha) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = (Math.random() * this.cap) | 0;
    this.px[i] = x; this.py[i] = y; this.pz[i] = z;
    this.vx[i] = vx; this.vy[i] = vy; this.vz[i] = vz;
    this.life[i] = this.max[i] = life;
    this.size[i] = size; this.grow[i] = grow;
    this.rot[i] = Math.random() * TAU;
    this.spin[i] = (Math.random() - 0.5) * 1.4;
    this.alpha[i] = alpha === undefined ? 0.55 : alpha;
    _fxCol.set(color);
    this.r[i] = _fxCol.r; this.g[i] = _fxCol.g; this.b[i] = _fxCol.b;
  }

  update(dt, camQuat) {
    let i = 0;
    while (i < this.n) {
      let l = this.life[i] - dt;
      if (l <= 0) {
        const last = --this.n;
        const cp = (a) => { a[i] = a[last]; };
        cp(this.px); cp(this.py); cp(this.pz);
        cp(this.vx); cp(this.vy); cp(this.vz);
        cp(this.life); cp(this.max); cp(this.size); cp(this.grow);
        cp(this.spin); cp(this.rot); cp(this.alpha);
        cp(this.r); cp(this.g); cp(this.b);
        continue;
      }
      this.life[i] = l;
      const drag = 1 - Math.min(1, 1.1 * dt);
      this.vx[i] *= drag; this.vz[i] *= drag; this.vy[i] *= 0.99;
      this.px[i] += this.vx[i] * dt;
      this.py[i] += this.vy[i] * dt;
      this.pz[i] += this.vz[i] * dt;
      this.rot[i] += this.spin[i] * dt;

      const t = l / this.max[i];
      const age = 1 - t;
      const s = this.size[i] * (1 + this.grow[i] * age);
      _fxQuat.copy(camQuat);
      _fxQuat.multiply(_tmpSpin.setFromAxisAngle(_axisZ, this.rot[i]));
      _fxPos.set(this.px[i], this.py[i], this.pz[i]);
      _fxScl.set(s, s, s);
      _fxMtx.compose(_fxPos, _fxQuat, _fxScl);
      this.mesh.setMatrixAt(i, _fxMtx);
      _fxCol.setRGB(this.r[i], this.g[i], this.b[i]);
      this.mesh.setColorAt(i, _fxCol);
      // ease in fast, out slow
      this.aAlpha[i] = this.alpha[i] * Math.min(1, age * 8) * t * t;
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
    this._attr.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}
const _tmpSpin = new THREE.Quaternion();
const _axisZ = new THREE.Vector3(0, 0, 1);

/* ---------------------------------------------------------------- decals */
/* Gore is permanent — the pool only recycles once it is full, which is the
   whole point of the genre. */
class DecalFX {
  constructor(scene, perVariant) {
    this.layers = [];
    this.perVariant = perVariant;
    const mk = (tex, order) => {
      const geo = new THREE.PlaneGeometry(1, 1);
      const mat = new THREE.MeshBasicMaterial({
        map: tex,
        transparent: true,
        depthWrite: false,
        toneMapped: true,
        polygonOffset: true,
        polygonOffsetFactor: -4,
        polygonOffsetUnits: -4
      });
      const mesh = new THREE.InstancedMesh(geo, mat, perVariant);
      mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      mesh.frustumCulled = false;
      mesh.count = 0;
      mesh.renderOrder = order;
      scene.add(mesh);
      return { mesh: mesh, n: 0, next: 0 };
    };
    for (let i = 0; i < TEX.blood.length; i++) this.layers.push(mk(TEX.blood[i], 2));
    this.scorchLayer = mk(TEX.scorch, 1);
  }

  _place(layer, x, z, size, rot, tint) {
    const i = layer.n < this.perVariant ? layer.n++ : (layer.next = (layer.next + 1) % this.perVariant);
    _fxQuat.copy(_flatQuat);
    _tmpSpin.setFromAxisAngle(_axisZ, rot);
    _fxQuat.multiply(_tmpSpin);
    // stagger height slightly so overlapping decals don't z-fight
    _fxPos.set(x, 0.014 + (i % 12) * 0.0016, z);
    _fxScl.set(size, size, 1);
    _fxMtx.compose(_fxPos, _fxQuat, _fxScl);
    layer.mesh.setMatrixAt(i, _fxMtx);
    // A recycled acid-tinted slot must not turn subsequent normal blood
    // green. Untinted decals explicitly restore their original texture.
    _fxCol.set(tint === undefined ? 0xffffff : tint);
    layer.mesh.setColorAt(i, _fxCol);
    if (layer.mesh.instanceColor) layer.mesh.instanceColor.needsUpdate = true;
    layer.mesh.count = layer.n;
    layer.mesh.instanceMatrix.needsUpdate = true;
  }

  blood(x, z, size, tint) {
    const layer = this.layers[(Math.random() * this.layers.length) | 0];
    this._place(layer, x, z, size, Math.random() * TAU, tint);
  }

  scorch(x, z, size) {
    this._place(this.scorchLayer, x, z, size, Math.random() * TAU);
  }

  clear() {
    for (let i = 0; i < this.layers.length; i++) {
      this.layers[i].n = 0; this.layers[i].next = 0; this.layers[i].mesh.count = 0;
    }
    this.scorchLayer.n = 0; this.scorchLayer.next = 0; this.scorchLayer.mesh.count = 0;
  }
}

/* --------------------------------------------------------------- tracers */
class TracerFX {
  constructor(scene, capacity) {
    this.cap = capacity;
    this.n = 0;
    const f = () => new Float32Array(capacity);
    this.ax = f(); this.az = f(); this.bx = f(); this.bz = f(); this.y = f();
    this.life = f(); this.max = f(); this.width = f();
    this.r = f(); this.g = f(); this.b = f();

    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.glow,
      blending: THREE.AdditiveBlending,
      transparent: true,
      depthWrite: false,
      toneMapped: false
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 9;
    scene.add(this.mesh);
    this._eul = new THREE.Euler();
  }

  add(ax, ay, az, bx, bz, width, color, life) {
    let i;
    if (this.n < this.cap) i = this.n++;
    else i = (Math.random() * this.cap) | 0;
    this.ax[i] = ax; this.az[i] = az; this.bx[i] = bx; this.bz[i] = bz;
    this.y[i] = ay;
    this.life[i] = this.max[i] = life === undefined ? 0.06 : life;
    this.width[i] = width;
    _fxCol.set(color);
    this.r[i] = _fxCol.r; this.g[i] = _fxCol.g; this.b[i] = _fxCol.b;
  }

  update(dt) {
    let i = 0;
    while (i < this.n) {
      const l = this.life[i] - dt;
      if (l <= 0) {
        const last = --this.n;
        const cp = (a) => { a[i] = a[last]; };
        cp(this.ax); cp(this.az); cp(this.bx); cp(this.bz); cp(this.y);
        cp(this.life); cp(this.max); cp(this.width);
        cp(this.r); cp(this.g); cp(this.b);
        continue;
      }
      this.life[i] = l;
      const dx = this.bx[i] - this.ax[i], dz = this.bz[i] - this.az[i];
      const len = Math.hypot(dx, dz);
      const t = l / this.max[i];
      // laid flat, rotated in the XZ plane to follow the shot
      this._eul.set(-Math.PI / 2, 0, -Math.atan2(dz, dx));
      _fxQuat.setFromEuler(this._eul);
      _fxPos.set((this.ax[i] + this.bx[i]) / 2, this.y[i], (this.az[i] + this.bz[i]) / 2);
      _fxScl.set(len, this.width[i] * (0.4 + t * 0.6), 1);
      _fxMtx.compose(_fxPos, _fxQuat, _fxScl);
      this.mesh.setMatrixAt(i, _fxMtx);
      _fxCol.setRGB(this.r[i] * t, this.g[i] * t, this.b[i] * t);
      this.mesh.setColorAt(i, _fxCol);
      i++;
    }
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  clear() { this.n = 0; this.mesh.count = 0; }
}

/* ---------------------------------------------------------- blob shadows */
class BlobShadowFX {
  constructor(scene, capacity) {
    const geo = new THREE.PlaneGeometry(1, 1);
    const mat = new THREE.MeshBasicMaterial({
      map: TEX.blob,
      transparent: true,
      depthWrite: false,
      color: 0x000000,
      toneMapped: false,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6
    });
    this.mesh = new THREE.InstancedMesh(geo, mat, capacity);
    this.mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.mesh.frustumCulled = false;
    this.mesh.count = 0;
    this.mesh.renderOrder = 3;
    scene.add(this.mesh);
    this.n = 0;
    this.cap = capacity;
  }
  begin() { this.n = 0; }
  add(x, z, size) {
    if (this.n >= this.cap) return;
    _fxPos.set(x, 0.05, z);
    _fxScl.set(size, size, 1);
    _fxMtx.compose(_fxPos, _flatQuat, _fxScl);
    this.mesh.setMatrixAt(this.n++, _fxMtx);
  }
  end() {
    this.mesh.count = this.n;
    this.mesh.instanceMatrix.needsUpdate = true;
  }
}

/* -------------------------------------------------- pooled dynamic lights */
class FlashLights {
  constructor(scene, count) {
    this.lights = [];
    for (let i = 0; i < count; i++) {
      const l = new THREE.PointLight(0xffffff, 0, 18, 2);
      // Keep the light count stable so muzzle flashes do not compile a new
      // material/shader variant each time a pooled light wakes or expires.
      l.visible = true;
      scene.add(l);
      this.lights.push({ light: l, life: 0, max: 0, power: 0 });
    }
    this.cursor = 0;
  }
  flash(x, y, z, color, power, radius, life) {
    const e = this.lights[this.cursor];
    this.cursor = (this.cursor + 1) % this.lights.length;
    e.light.position.set(x, y, z);
    e.light.color.set(color);
    e.light.distance = radius;
    e.light.visible = true;
    e.power = power;
    e.life = e.max = life;
    e.light.intensity = power;
  }
  update(dt) {
    for (let i = 0; i < this.lights.length; i++) {
      const e = this.lights[i];
      if (e.life <= 0) continue;
      e.life -= dt;
      if (e.life <= 0) { e.light.intensity = 0; continue; }
      const t = e.life / e.max;
      e.light.intensity = e.power * t * t;
    }
  }
  clear() {
    for (let i = 0; i < this.lights.length; i++) {
      this.lights[i].life = 0;
      this.lights[i].light.visible = true;
      this.lights[i].light.intensity = 0;
    }
  }
}
