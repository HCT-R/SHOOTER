/* ========================================================================
   85-world.js — level meshes, props, barrels, pickups, projectiles
   ======================================================================== */

/* Frees the per-level meshes when a new facility is generated. Geometry
   flagged `userData.shared` (props, pickups, weapons) is reused across runs
   and must survive; textures are shared globally and are never disposed. */
function disposeLevelGroup(group) {
  const geometries = new Set(), materials = new Set();
  group.traverse((o) => {
    if (!o.isMesh && !o.isInstancedMesh && !o.isPoints && !o.isLine) return;
    if (o.geometry && !o.geometry.userData.shared && !geometries.has(o.geometry)) {
      geometries.add(o.geometry); o.geometry.dispose();
    }
    const mats = Array.isArray(o.material) ? o.material : [o.material];
    for (let i = 0; i < mats.length; i++) {
      if (mats[i] && !mats[i].userData.shared && !materials.has(mats[i])) { materials.add(mats[i]); mats[i].dispose(); }
    }
    if (o.dispose) o.dispose();
  });
  group.clear();
}

/* ------------------------------------------------------ static geometry */
class LevelView {
  constructor(scene, level) {
    this.scene = scene;
    this.level = level;
    this.group = new THREE.Group();
    scene.add(this.group);
    const sector = level.sector;
    scene.background.set(sector.fog);
    scene.fog.color.set(sector.fog);
    scene.fog.density = sector.fogDensity;

    this._buildFloor();
    this._buildWalls();
    this._buildLamps();
    this._buildRoomDetails();
    this._buildAtmosphere();
  }

  _buildFloor() {
    const L = this.level;
    // The plane runs well past the map border so that standing in an edge
    // room never frames empty background. Doubling keeps the tiling aligned.
    const PAD = 2;
    const w = L.w * TILE * PAD, h = L.h * TILE * PAD;
    // the shared texture is used directly; map size never varies between runs,
    // so a per-level clone would only be extra GPU memory to track and free
    const tex = TEX.sectorFloor[L.sectorIndex];
    tex.repeat.set((L.w / 8) * PAD, (L.h / 8) * PAD);
    TEX.floorNormal.repeat.copy(tex.repeat);

    const geo = new THREE.PlaneGeometry(w, h);
    const mat = new THREE.MeshStandardMaterial({
      map: tex, normalMap: TEX.floorNormal, normalScale: new THREE.Vector2(0.15, 0.15),
      roughness: L.sectorIndex === 1 ? 0.79 : 0.9, metalness: 0.13, color: L.sector.floorTint
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.rotation.x = -Math.PI / 2;
    mesh.receiveShadow = true;
    this.group.add(mesh);
    this.floorMesh = mesh;
  }

  _buildWalls() {
    const L = this.level;
    // Every wall tile is drawn, not just the ones facing open space: from this
    // camera angle a solid block of unrendered tiles reads as a black void.
    // It is all one instanced draw call either way.
    const blocks = [];
    const exposedTiles = [];
    const faces = [];
    for (let tz = 0; tz < L.h; tz++) {
      for (let tx = 0; tx < L.w; tx++) {
        if (!L.isWallTile(tx, tz)) continue;
        blocks.push([tx, tz]);
        let exposed = false;
        for (let k = 0; k < 4; k++) {
          const nx = tx + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const nz = tz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (L.inBounds(nx, nz) && !L.isWallTile(nx, nz)) {
            exposed = true;
            faces.push({ tx: tx, tz: tz, nx: nx - tx, nz: nz - tz });
          }
        }
        if (exposed) exposedTiles.push([tx, tz]);
      }
    }
    const visible = blocks;

    const geo = new THREE.BoxGeometry(TILE, WALL_H, TILE);
    const sideMat = new THREE.MeshStandardMaterial({
      map: TEX.wall, roughness: 0.76, metalness: 0.32, color: L.sector.wallTint
    });
    // The top faces are pure filler — from this camera you see acres of them,
    // so they get a flat dark cap and the lit floor stays the read. Not fully
    // black, or free-standing pillars look like holes punched in the room.
    // BoxGeometry group order is +X, -X, +Y, -Y, +Z, -Z.
    const capMat = new THREE.MeshStandardMaterial({
      color: L.sector.capColor, roughness: 0.9, metalness: 0.12
    });
    const mat = [sideMat, sideMat, capMat, capMat, sideMat, sideMat];
    const mesh = new THREE.InstancedMesh(geo, mat, visible.length);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    const c = new THREE.Color();
    for (let i = 0; i < visible.length; i++) {
      p.set(L.tileToWorldX(visible[i][0]), WALL_H / 2, L.tileToWorldZ(visible[i][1]));
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
      // subtle per-block value variation breaks up the repetition
      const v = 0.88 + ((visible[i][0] * 17 + visible[i][1] * 31) % 13) / 70;
      c.setRGB(v, v, v * 1.02);
      mesh.setColorAt(i, c);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    this.group.add(mesh);
    this.wallMesh = mesh;

    // hazard trim, only along walls that actually face a room or corridor
    const trimGeo = new THREE.BoxGeometry(TILE * 1.005, 0.16, TILE * 1.005);
    const trimMat = new THREE.MeshStandardMaterial({ map: TEX.hazard, roughness: 0.7, metalness: 0.3 });
    const trim = new THREE.InstancedMesh(trimGeo, trimMat, exposedTiles.length);
    for (let i = 0; i < exposedTiles.length; i++) {
      p.set(L.tileToWorldX(exposedTiles[i][0]), 0.08, L.tileToWorldZ(exposedTiles[i][1]));
      m.compose(p, q, s);
      trim.setMatrixAt(i, m);
    }
    trim.instanceMatrix.needsUpdate = true;
    trim.receiveShadow = true;
    this.group.add(trim);
    this._buildWallDetails(faces);
    this._buildContactShadows(faces);
  }

  // Fixed contact shade survives the low preset's disabled shadow map.
  // Three instanced bands hug actual collision faces, never open routes.
  _buildContactShadows(faces) {
    for (const [width, opacity] of [[0.9, 0.07], [0.42, 0.10], [0.14, 0.18]]) {
      const strips = faces.map(f => ({
        x: this.level.tileToWorldX(f.tx) + f.nx * (TILE / 2 + width / 2),
        y: 0.078 + (0.9 - width) * 0.002,
        z: this.level.tileToWorldZ(f.tz) + f.nz * (TILE / 2 + width / 2),
        w: f.nx ? width : TILE, h: f.nx ? TILE : width, d: 1, rx: -Math.PI / 2
      }));
      this._instances(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
        color: 0x050b12, transparent: true, opacity, depthWrite: false, toneMapped: false
      }), strips);
    }
  }

  /* Unit geometry plus matrices keeps the extra trim to a few draw calls. */
  _instances(geo, material, transforms) {
    if (!transforms.length) { geo.dispose(); material.dispose(); return null; }
    const mesh = new THREE.InstancedMesh(geo, material, transforms.length);
    const matrix = new THREE.Matrix4(), position = new THREE.Vector3();
    const rotation = new THREE.Quaternion(), scale = new THREE.Vector3();
    const euler = new THREE.Euler();
    for (let i = 0; i < transforms.length; i++) {
      const t = transforms[i];
      position.set(t.x, t.y, t.z);
      scale.set(t.w, t.h, t.d);
      euler.set(t.rx || 0, t.ry || 0, t.rz || 0);
      rotation.setFromEuler(euler);
      matrix.compose(position, rotation, scale);
      mesh.setMatrixAt(i, matrix);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    return mesh;
  }

  _buildWallDetails(faces) {
    const L = this.level, ribs = [], strips = [], floorLights = [], vents = [];
    for (let i = 0; i < faces.length; i++) {
      const f = faces[i];
      const x = L.tileToWorldX(f.tx), z = L.tileToWorldZ(f.tz);
      const vertical = !!f.nx;
      const fx = x + f.nx * (TILE / 2 + 0.045), fz = z + f.nz * (TILE / 2 + 0.045);
      ribs.push({ x: fx, y: WALL_H - 0.17, z: fz,
        w: vertical ? 0.16 : TILE, h: 0.3, d: vertical ? TILE : 0.16 });
      // Short luminous sections leave visible dark gaps between wall panels.
      strips.push({ x: fx + f.nx * 0.09, y: WALL_H - 0.17, z: fz + f.nz * 0.09,
        w: vertical ? 0.035 : TILE * 0.72, h: 0.055, d: vertical ? TILE * 0.72 : 0.035 });
      if ((f.tx + f.tz) % 3 === 0) {
        floorLights.push({ x: x + f.nx * 1.9, y: 0.025, z: z + f.nz * 1.9,
          w: vertical ? 0.065 : 0.72, h: 0.024, d: vertical ? 0.72 : 0.065 });
      }
      if ((f.tx * 3 + f.tz * 7) % 5 === 0) {
        // Decorative vents sit flush to the wall and do not add collision.
        vents.push({ x: fx + f.nx * 0.025, y: 1.6, z: fz + f.nz * 0.025,
          w: 0.9, h: 0.72, d: 1, ry: vertical ? f.nx * Math.PI / 2 : f.nz < 0 ? Math.PI : 0 });
        ribs.push({ x: fx, y: 1.45, z: fz,
          w: vertical ? 0.18 : 0.10, h: 2.6, d: vertical ? 0.10 : 0.18 });
      }
    }
    this._instances(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshStandardMaterial({ color: 0x25333e, metalness: 0.65, roughness: 0.42 }), ribs);
    this.stripMesh = this._instances(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: L.sector.accent, toneMapped: false }), strips);
    this._instances(new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: L.sector.accent, toneMapped: false }), floorLights);
    this._instances(new THREE.PlaneGeometry(1, 1),
      new THREE.MeshStandardMaterial({ map: TEX.vent, metalness: 0.5, roughness: 0.55 }), vents);
  }

  _buildRoomDetails() {
    const L = this.level, markings = [], lanes = [], pools = [], pads = [];
    const R = makeRng(L.seed ^ 0x41703);
    this.haze = [];
    // ArenaArt owns the map's districts, spawn pads and navigation graphics.
    if (L.arenaLayout) return;
    for (const room of L.rooms) {
      const x = L.tileToWorldX(room.cx), z = L.tileToWorldZ(room.cz);
      const size = Math.min(10.5, Math.min(room.w, room.h) * TILE * 0.61);
      markings.push({ x: x, y: 0.018, z: z, w: size, h: size, d: 1, rx: -Math.PI / 2 });
      // Edge lanes run inside each room, making its boundaries readable.
      const left = L.tileToWorldX(room.x) - TILE * 0.18;
      const top = L.tileToWorldZ(room.z) - TILE * 0.18;
      const width = (room.w - 0.65) * TILE, depth = (room.h - 0.65) * TILE;
      lanes.push({ x: left + width * 0.5, y: 0.022, z: top, w: width, h: 0.02, d: 0.075 });
      lanes.push({ x: left, y: 0.022, z: top + depth * 0.5, w: 0.075, h: 0.02, d: depth });
      // Flush maintenance panels add scale without obstructing movement.
      for (let k = 0; k < 2; k++) {
        const tx = k ? room.x + room.w - 2 : room.x + 1, tz = room.z + 1;
        if (L.isWallTile(tx, tz)) continue;
        pads.push({ x: L.tileToWorldX(tx), y: 0.028, z: L.tileToWorldZ(tz),
          w: 1.7, h: 1.7, d: 1, rx: -Math.PI / 2 });
      }
      pools.push({ x: x, y: 0.032, z: z, w: size * 1.7, h: size * 1.7, d: 1, rx: -Math.PI / 2 });
      if (room.number % 2 === 0 || L.sectorIndex === 1) {
        const haze = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
          map: TEX.smoke, color: L.sector.lampColor, transparent: true,
          opacity: L.sectorIndex === 1 ? 0.11 : 0.065, depthWrite: false,
          blending: THREE.AdditiveBlending, toneMapped: false
        }));
        haze.rotation.x = -Math.PI / 2;
        haze.scale.set(size * 1.3, size * 1.05, 1);
        haze.position.set(x, 0.11, z);
        haze.userData.phase = R() * TAU;
        this.haze.push(haze); this.group.add(haze);
      }
    }
    this._instances(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: TEX.sectorMarking[L.sectorIndex], transparent: true, opacity: 0.6,
      depthWrite: false, toneMapped: false
    }), markings);
    this._instances(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({
      color: L.sector.accent, transparent: true, opacity: 0.24, depthWrite: false
    }), lanes);
    this._instances(new THREE.PlaneGeometry(1, 1), new THREE.MeshStandardMaterial({
      map: TEX.vent, roughness: 0.62, metalness: 0.4
    }), pads);
    this._instances(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({
      map: TEX.glow, color: L.sector.accent, transparent: true, opacity: 0.11,
      blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false
    }), pools);

    // A clear deployment ring distinguishes the safe starting location.
    this.entryRing = new THREE.Mesh(new THREE.RingGeometry(2.65, 2.72, 64), new THREE.MeshBasicMaterial({
      color: L.sector.accent, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false
    }));
    this.entryRing.rotation.x = -Math.PI / 2;
    this.entryRing.position.set(L.start.x, 0.04, L.start.z);
    this.group.add(this.entryRing);
  }

  _buildAtmosphere() {
    const L = this.level, R = makeRng(L.seed ^ 0x2ba991);
    const count = Math.min(420, L.rooms.length * 20);
    const positions = new Float32Array(count * 3);
    this.dustBase = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const pos = L.randomFloorPos(0, 0, 0, R);
      positions[i * 3] = pos.x + R.range(-1, 1);
      positions[i * 3 + 1] = R.range(0.2, 3.6);
      positions[i * 3 + 2] = pos.z + R.range(-1, 1);
    }
    this.dustBase.set(positions);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(positions, 3).setUsage(THREE.DynamicDrawUsage));
    this.dust = new THREE.Points(geo, new THREE.PointsMaterial({
      color: L.sector.lampColor, map: TEX.glow, size: L.sectorIndex === 1 ? 0.105 : 0.075,
      opacity: 0.5, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false
    }));
    this.group.add(this.dust);
  }

  _updateAtmosphere(time) {
    if (this.entryRing) this.entryRing.material.opacity = 0.52 + Math.sin(time * 1.6) * 0.14;
    for (const haze of this.haze) haze.rotation.z = Math.sin(time * 0.09 + haze.userData.phase) * 0.18;
    if (!this.dust) return;
    const positions = this.dust.geometry.attributes.position.array;
    for (let i = 0; i < positions.length; i += 3) {
      positions[i] = this.dustBase[i] + Math.sin(time * 0.17 + i) * 0.35;
      positions[i + 1] = this.dustBase[i + 1] + Math.sin(time * 0.27 + i * 1.7) * 0.25;
    }
    this.dust.geometry.attributes.position.needsUpdate = true;
  }

  _buildLamps() {
    const L = this.level;
    const geo = PROP_GEO.lamp;
    const mat = new THREE.MeshBasicMaterial({ vertexColors: true });
    const mesh = new THREE.InstancedMesh(geo, mat, L.lamps.length);
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const s = new THREE.Vector3(1, 1, 1);
    for (let i = 0; i < L.lamps.length; i++) {
      p.set(L.lamps[i].x, WALL_H - 0.3, L.lamps[i].z);
      m.compose(p, q, s);
      mesh.setMatrixAt(i, m);
    }
    mesh.instanceMatrix.needsUpdate = true;
    this.group.add(mesh);
    this.lampMesh = mesh;
    this._lampColor = new THREE.Color();
  }

  /* every run builds a fresh facility, so the old one has to hand back its
     GPU memory or a few restarts pile up hundreds of MB of textures */
  dispose() { disposeLevelGroup(this.group); }

  /* only the handful of lamps nearest the player get a real light */
  updateLamps(lights, px, pz, time) {
    this._updateAtmosphere(time);
    const L = this.level;
    const lamps = L.lamps;
    // partial selection: find the N closest without a full sort
    const N = lights.length;
    for (let i = 0; i < N; i++) lights[i].userData.d = Infinity;
    for (let i = 0; i < lamps.length; i++) {
      const d = dist2(lamps[i].x, lamps[i].z, px, pz);
      if (d > 52 * 52) continue;
      for (let k = 0; k < N; k++) {
        if (d < lights[k].userData.d) {
          for (let j = N - 1; j > k; j--) {
            lights[j].userData.d = lights[j - 1].userData.d;
            lights[j].userData.lamp = lights[j - 1].userData.lamp;
          }
          lights[k].userData.d = d;
          lights[k].userData.lamp = lamps[i];
          break;
        }
      }
    }
    for (let k = 0; k < N; k++) {
      const l = lights[k];
      const lamp = l.userData.lamp;
      if (!lamp || l.userData.d === Infinity) { l.intensity = 0; continue; }
      l.visible = true;
      l.position.set(lamp.x, WALL_H - 0.55, lamp.z);
      l.color.set(lamp.hue);
      let inten = L.sectorIndex === 1 ? 54 : 48;
      if (lamp.flicker) {
        const f = Math.sin(time * 27 + lamp.phase) * Math.sin(time * 11.3 + lamp.phase * 2.1);
        inten *= f > -0.25 ? 1 : 0.15;
      }
      l.intensity = inten;
    }
  }
}

/* ------------------------------------------------------------ props */
class Props {
  constructor(game) {
    this.game = game;
    const scene = game.scene;
    const L = game.level;
    const R = makeRng(L.seed ^ 0x9e3779b9);

    this.barrels = [];
    this.solids = [];   // {x,z,r} blocking circles

    const staticKinds = ['crate', 'container', 'console', 'pipes'];
    const buckets = { crate: [], container: [], console: [], pipes: [] };

    for (let i = 0; i < L.propSpots.length; i++) {
      const spot = L.propSpots[i];
      const roll = R();
      if (roll < 0.2) {
        this.barrels.push({
          x: spot.x, z: spot.z, hp: 26, alive: true, mesh: null, rot: spot.rot
        });
      } else {
        const kind = L.sectorIndex === 1
          ? (roll < 0.65 ? 'console' : roll < 0.82 ? 'container' : roll < 0.9 ? 'crate' : 'pipes')
          : L.sectorIndex === 2
            ? (roll < 0.44 ? 'pipes' : roll < 0.72 ? 'console' : roll < 0.84 ? 'container' : 'crate')
            : (roll < 0.57 ? 'crate' : roll < 0.86 ? 'container' : roll < 0.94 ? 'console' : 'pipes');
        buckets[kind].push(spot);
        const r = kind === 'container' ? 1.35 : kind === 'pipes' ? 0 : 0.72;
        if (r > 0) this.solids.push({ x: spot.x, z: spot.z, r: r });
      }
    }

    const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.63, metalness: 0.24 });
    this.group = new THREE.Group();
    scene.add(this.group);

    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);

    for (let k = 0; k < staticKinds.length; k++) {
      const kind = staticKinds[k];
      const spots = buckets[kind];
      if (!spots.length) continue;
      const mesh = new THREE.InstancedMesh(PROP_GEO[kind], mat, spots.length);
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      for (let i = 0; i < spots.length; i++) {
        e.set(0, Math.round(spots[i].rot / (Math.PI / 2)) * (Math.PI / 2), 0);
        q.setFromEuler(e);
        p.set(spots[i].x, 0, spots[i].z);
        const sc = 0.9 + R() * 0.25;
        s.set(sc, sc, sc);
        m.compose(p, q, s);
        mesh.setMatrixAt(i, m);
      }
      mesh.instanceMatrix.needsUpdate = true;
      this.group.add(mesh);
    }

    // barrels stay individual meshes because they get destroyed
    this.barrelMesh = new THREE.InstancedMesh(PROP_GEO.barrel, mat, Math.max(1, this.barrels.length));
    this.barrelMesh.castShadow = true;
    this.barrelMesh.receiveShadow = true;
    this.group.add(this.barrelMesh);
    for (let i = 0; i < this.barrels.length; i++) {
      this.solids.push({ x: this.barrels[i].x, z: this.barrels[i].z, r: 0.5, barrel: this.barrels[i] });
    }
    this.refreshBarrels();
  }

  refreshBarrels() {
    const m = new THREE.Matrix4();
    const p = new THREE.Vector3();
    const q = new THREE.Quaternion();
    const e = new THREE.Euler();
    const s = new THREE.Vector3(1, 1, 1);
    let n = 0;
    for (let i = 0; i < this.barrels.length; i++) {
      const b = this.barrels[i];
      if (!b.alive) continue;
      e.set(0, b.rot, 0);
      q.setFromEuler(e);
      p.set(b.x, 0, b.z);
      m.compose(p, q, s);
      this.barrelMesh.setMatrixAt(n++, m);
    }
    this.barrelMesh.count = n;
    this.barrelMesh.instanceMatrix.needsUpdate = true;
  }

  dispose() { disposeLevelGroup(this.group); }

  /* First entry into a solid circle; distances are in world units. */
  raycast(ax, az, dx, dz, maxD) {
    const length = Math.hypot(dx, dz);
    if (length < 1e-8 || maxD < 0) return null;
    dx /= length; dz /= length;
    let nearest = null, nearestDist = Infinity;
    for (const solid of this.solids) {
      if (solid.barrel && !solid.barrel.alive) continue;
      const distance = CombatCore.rayCircleHit({ x: ax, z: az }, dx, dz, maxD, solid, solid.r);
      if (distance === null) continue;
      if (distance > maxD || distance >= nearestDist) continue;
      nearestDist = distance;
      nearest = solid;
    }
    return nearest ? { dist: nearestDist, x: ax + dx * nearestDist, z: az + dz * nearestDist,
      solid: nearest, barrel: nearest.barrel || null } : null;
  }

  damageBarrel(barrel, amount) {
    if (!barrel || !barrel.alive || amount <= 0) return false;
    barrel.hp -= amount;
    if (barrel.hp <= 0) this.explodeBarrel(barrel);
    return true;
  }

  /* barrels are the only props that take damage */
  damageAt(x, z, amount) {
    let hit = false;
    for (let i = 0; i < this.barrels.length; i++) {
      const b = this.barrels[i];
      if (!b.alive) continue;
      if (dist2(x, z, b.x, b.z) > 0.9 * 0.9) continue;
      hit = this.damageBarrel(b, amount) || hit;
    }
    return hit;
  }

  explodeBarrel(b) {
    if (!b.alive) return;
    b.alive = false;
    this.refreshBarrels();
    for (let i = 0; i < this.solids.length; i++) {
      if (this.solids[i].barrel === b) { this.solids.splice(i, 1); break; }
    }
    if (this.game.level.setObstacles) this.game.level.setObstacles(this.solids);
    this.game.explosion(b.x, 0.7, b.z, 150, 6.0, true);
    this.game.fx.gibs.burst(b.x, 0.7, b.z, 10, 8, 0.2, 0xa8261c);
  }

  /* nearest blocking prop resolution for a moving circle */
  resolve(pos, radius) {
    for (let i = 0; i < this.solids.length; i++) {
      const s = this.solids[i];
      const dx = pos.x - s.x, dz = pos.z - s.z;
      const rr = radius + s.r;
      const d2v = dx * dx + dz * dz;
      if (d2v >= rr * rr || d2v < 1e-8) continue;
      const d = Math.sqrt(d2v);
      const push = rr - d;
      pos.x += (dx / d) * push;
      pos.z += (dz / d) * push;
    }
  }
}

/* --------------------------------------------------------- pickups */
const PICKUP_KINDS = {
  health:    { geo: 'health', color: 0xff5a5a, sound: 'health', label: '+25 HP' },
  bigHealth: { geo: 'bigHealth', color: 0xff2a2a, sound: 'health', label: '+60 HP' },
  armor:     { geo: 'armor',  color: 0x4aa8ff, sound: 'armor',  label: '+40 ARMOR' },
  money:     { geo: 'money',  color: 0x38e0d0, sound: 'money',  label: '' },
  ammo:      { geo: 'ammo',   color: 0xd8c84a, sound: 'ammo',   label: 'AMMO' },
  weapon:    { geo: 'weapon', color: 0xffa42a, sound: 'weapon', label: '' }
};

class Pickups {
  constructor(game) {
    this.game = game;
    this.items = [];
    this.group = new THREE.Group();
    game.scene.add(this.group);
    this.mat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.glowGeo = new THREE.PlaneGeometry(1, 1);
    // one glow material per pickup colour, built once; cloning per spawned
    // item leaked a material for every crate picked up over a long run
    this.glowMats = {};
    for (const kind in PICKUP_KINDS) {
      this.glowMats[kind] = new THREE.MeshBasicMaterial({
        map: TEX.glow, color: PICKUP_KINDS[kind].color,
        transparent: true, blending: THREE.AdditiveBlending,
        depthWrite: false, toneMapped: false
      });
    }
  }

  spawn(kind, x, z, payload) {
    const def = PICKUP_KINDS[kind];
    if (!def) return;
    const detailed = kind === 'ammo' || kind === 'health' || kind === 'bigHealth';
    const mesh = detailed ? createPickupModel(def.geo, payload) : new THREE.Mesh(PICKUP_GEO[def.geo], this.mat);
    const sc = def.scale || 1;
    mesh.scale.setScalar(sc);
    mesh.castShadow = true;
    const glow = new THREE.Mesh(this.glowGeo, this.glowMats[kind]);
    glow.scale.setScalar(2.2 * sc);
    glow.rotation.x = -Math.PI / 2;
    glow.position.y = -0.35;
    mesh.add(glow);

    const holder = new THREE.Group();
    holder.position.set(x, 0.55, z);
    holder.add(mesh);
    this.group.add(holder);

    this.items.push({
      kind: kind, def: def, x: x, z: z, holder: holder, mesh: mesh,
      payload: payload || null, phase: Math.random() * TAU, life: 0, taken: false
    });
  }

  update(dt, player, time) {
    for (let i = this.items.length - 1; i >= 0; i--) {
      const it = this.items[i];
      if (it.taken) {
        this.group.remove(it.holder);
        this.items.splice(i, 1);
        continue;
      }
      it.phase += dt * 2.2;
      it.mesh.rotation.y += dt * 0.45;
      it.holder.position.y = 0.55 + Math.sin(it.phase) * 0.045;

      if (!player.alive) continue;
      const d2v = dist2(it.x, it.z, player.x, player.z);
      // gentle magnet so you don't have to walk over them exactly
      if (d2v < 9 && d2v > 0.5) {
        const d = Math.sqrt(d2v);
        const pull = (1 - d / 3) * dt * 9;
        it.x += (player.x - it.x) / d * pull;
        it.z += (player.z - it.z) / d * pull;
        it.holder.position.x = it.x;
        it.holder.position.z = it.z;
      }
      if (d2v < 1.1 * 1.1) {
        if (this.collect(it, player)) {
          // geometry and materials are shared, so only the node is discarded
          this.group.remove(it.holder);
          this.items.splice(i, 1);
        }
      }
    }
  }

  collect(it, player) {
    if (it.taken || !player.alive) return false;
    const g = this.game;
    let ok = false;
    let text = '';
    switch (it.kind) {
      case 'health':    ok = player.heal(25); text = '+25 HEALTH'; break;
      case 'bigHealth': ok = player.heal(60); text = '+60 HEALTH'; break;
      case 'armor':     ok = player.addArmor(40); text = '+40 ARMOR'; break;
      case 'money':
        ok = true;
        g.money += it.payload;
        g.score += it.payload;
        text = '+' + it.payload;
        break;
      case 'ammo':
        ok = player.giveAmmo(it.payload, AMMO_PICKUP[it.payload]);
        text = '+' + AMMO_PICKUP[it.payload] + ' ' + AMMO_TYPES[it.payload].name;
        break;
      case 'weapon': {
        const isNew = player.giveWeapon(it.payload);
        ok = true;
        text = (isNew ? '' : '+AMMO ') + WEAPON_BY_ID[it.payload].name;
        break;
      }
    }
    if (ok) {
      it.taken = true;
      sfx.pickup(it.def.sound);
      g.hud.popup(text, it.def.color);
      g.fx.sparks.burst(it.x, 0.7, it.z, 10, 4, 0.4, 0.35, it.def.color, 0.8, 10);
    }
    return ok;
  }

  /* Stable spawn order makes capped rewards predictable at wave/sector end.
     Ineligible health/ammo remain on the floor until they can be used. */
  collectAll(player = this.game.player) {
    if (!player || !player.alive) return 0;
    let collected = 0, write = 0;
    for (let i = 0; i < this.items.length; i++) {
      const item = this.items[i];
      const newlyCollected = !item.taken && this.collect(item, player);
      if (item.taken) {
        this.group.remove(item.holder);
        if (newlyCollected) collected++;
      } else {
        this.items[write++] = item;
      }
    }
    this.items.length = write;
    return collected;
  }

  clear() {
    for (let i = 0; i < this.items.length; i++) this.group.remove(this.items[i].holder);
    this.items.length = 0;
  }
}

/* ------------------------------------------------------ projectiles */
class Projectiles {
  constructor(game) {
    this.game = game;
    this.rockets = [];
    this.acid = [];

    const scene = game.scene;
    this.rocketGeo = mergeParts([
      part(G.cyl, { pos: [0, 0, 0], rot: [Math.PI / 2, 0, 0], scale: [0.09, 0.5, 0.09], color: 0x4a5240 }),
      part(G.cone, { pos: [0, 0, 0.34], rot: [Math.PI / 2, 0, 0], scale: [0.1, 0.24, 0.1], color: 0x9a3020 }),
      part(G.box, { pos: [0, 0, -0.22], scale: [0.24, 0.03, 0.16], color: 0x2a2f26 }),
      part(G.box, { pos: [0, 0, -0.22], scale: [0.03, 0.24, 0.16], color: 0x2a2f26 })
    ]);
    this.rocketMat = new THREE.MeshLambertMaterial({ vertexColors: true });
    this.rocketMesh = new THREE.InstancedMesh(this.rocketGeo, this.rocketMat, 32);
    this.rocketMesh.frustumCulled = false;
    this.rocketMesh.count = 0;
    scene.add(this.rocketMesh);
    this.grenadeGeo = new THREE.SphereGeometry(0.16, 16, 10);
    this.grenadeMat = new THREE.MeshStandardMaterial({ color: 0x9da880, roughness: 0.5, metalness: 0.55 });
    this.grenadeMesh = new THREE.InstancedMesh(this.grenadeGeo, this.grenadeMat, 32);
    this.boltGeo = mergeParts([
      part(G.cyl, { rot: [Math.PI / 2, 0, 0], scale: [0.014, 0.65, 0.014], color: 0xb6c5c5 }),
      part(G.cone, { pos: [0, 0, 0.39], rot: [Math.PI / 2, 0, 0], scale: [0.04, 0.15, 0.04], color: 0xe6edf0 }),
      part(G.box, { pos: [0, 0, -0.24], scale: [0.14, 0.02, 0.13], color: 0x729d96 })
    ]);
    this.boltMesh = new THREE.InstancedMesh(this.boltGeo, this.rocketMat, 32);
    for (const mesh of [this.grenadeMesh, this.boltMesh]) { mesh.count = 0; mesh.frustumCulled = false; scene.add(mesh); }

    this.acidGeo = new THREE.IcosahedronGeometry(0.22, 0);
    this.acidMat = new THREE.MeshBasicMaterial({ color: 0xaaff33, toneMapped: false });
    this.acidMesh = new THREE.InstancedMesh(this.acidGeo, this.acidMat, 120);
    this.acidMesh.frustumCulled = false;
    this.acidMesh.count = 0;
    scene.add(this.acidMesh);

    this._m = new THREE.Matrix4();
    this._p = new THREE.Vector3();
    this._q = new THREE.Quaternion();
    this._e = new THREE.Euler();
    this._s = new THREE.Vector3(1, 1, 1);
    this._hits = [];
  }

  spawnRocket(x, y, z, angle, w) {
    if (this.rockets.length >= 32) return;
    this.owners ||= new Map();
    const ownerId = w.ownerId || this.game.player.id || 'campaign-player';
    this.owners.set(ownerId, w.owner || this.game.player);
    this.rockets.push({
      x: x, y: y, z: z, angle: angle,
      prevX: x, prevY: y, prevZ: z,
      vx: Math.sin(angle) * w.projSpeed, vz: Math.cos(angle) * w.projSpeed,
      speed: w.projSpeed, vy: w.projectileKind === 'grenade' ? 4.8 : 0, gravity: w.projectileKind === 'grenade' ? w.projGravity || 14 : 0,
      ownerId,
      life: w.fuse || (w.projectileKind === 'bolt' ? w.range / w.projSpeed : 4), w: w, smokeT: 0, bounces: 0
    });
  }

  spawnAcid(e, tx, tz) {
    if (this.acid.length >= 120) return;
    const d = e.def;
    const y = e.y + (d.projectileY === undefined ? d.radius * 1.6 : d.projectileY);
    const dx = tx - e.x, dz = tz - e.z;
    const len = Math.hypot(dx, dz) || 1;
    // lead the shot slightly so it is dodgeable but threatening
    const x = e.x + (dx / len) * d.radius, z = e.z + (dz / len) * d.radius;
    this.acid.push({
      x: x, y: y, z: z, prevX: x, prevY: y, prevZ: z,
      vx: (dx / len) * d.projSpeed, vz: (dz / len) * d.projSpeed,
      vy: 1.6, gravity: 5, ownerId: e.id, life: 3.2, damage: e.damage === undefined ? d.damage : e.damage
    });
  }

  update(dt, player) {
    const g = this.game;

    /* rockets */
    for (let i = this.rockets.length - 1; i >= 0; i--) {
      const r = this.rockets[i];
      r.prevX = r.x; r.prevY = r.y; r.prevZ = r.z;
      r.life -= dt;
      const grenade = r.w.projectileKind === 'grenade', bolt = r.w.projectileKind === 'bolt';
      if (grenade) {
        const motion = CombatCore.projectileKinematics(r, dt); r.vy = motion.vy; r.y = motion.y;
        if (r.y < 0.18) { r.y = 0.18; r.vy = Math.abs(r.vy) * (r.w.bounce || 0.45); r.vx *= 0.78; r.vz *= 0.78; }
      }
      const stepX = r.vx * dt, stepZ = r.vz * dt;
      const nx = r.x + stepX, nz = r.z + stepZ;

      let boom = false, bx = nx, bz = nz;
      const hit = g.enemies.raycast(r.x, r.z, nx, nz, 0.25, null);
      const distance = Math.hypot(stepX, stepZ) || 0.001;
      const wall = g.level.raycastWall(r.x, r.z, stepX / distance, stepZ / distance, distance);
      let stop = wall ? wall.dist : Infinity;
      const prop = g.props.raycast(r.x, r.z, stepX / distance, stepZ / distance, distance);
      let propHit = null, enemyHit = null, directHit = false;
      if (prop && prop.dist < stop) { stop = prop.dist; propHit = prop; }
      if (hit && hit.t * distance < stop && (!grenade || r.y < (hit.enemy.y || 0) + hit.enemy.def.radius * 2 + 0.45)) {
        stop = hit.t * distance; enemyHit = hit.enemy; propHit = null;
      }
      if (stop !== Infinity) {
        boom = true;
        bx = r.x + stepX / distance * Math.max(0, stop - 0.06);
        bz = r.z + stepZ / distance * Math.max(0, stop - 0.06);
        if (enemyHit) {
          // direct impact goes through the player funnel; the splash that
          // follows is handled by explosion() and never crits
          const killed = this.owners.get(r.ownerId).dealDamage(enemyHit, r.w.damage || 0,
            stepX / distance, stepZ / distance, r.w.knock || 0, 0, r.w);
          g.onHitConfirm(killed);
          directHit = true;
        } else if (propHit && propHit.barrel) {
          g.props.damageBarrel(propHit.barrel, r.w.damage || 0);
        }
      } else if (r.life <= 0) { boom = true; }

      if (grenade && boom && !enemyHit && r.life > 0 && r.bounces < 4) {
        r.bounces++;
        const factor = r.w.bounce || 0.45;
        if (Math.abs(stepX) > Math.abs(stepZ)) r.vx *= -factor;
        else r.vz *= -factor;
        r.angle = Math.atan2(r.vx, r.vz);
        r.x = bx; r.z = bz; boom = false;
      } else { r.x = boom ? bx : nx; r.z = boom ? bz : nz; }
      if (r.life <= 0) { boom = true; bx = r.x; bz = r.z; }

      const shell = r.w.projectileKind === 'shell';
      // Cannon shells leave bright streaks; rockets retain smoky exhaust.
      r.smokeT -= dt;
      if (r.smokeT <= 0 && !grenade && !bolt) {
        r.smokeT = shell ? 0.035 : 0.012;
        if (!shell) g.fx.smoke.emit(r.x, r.y, r.z, (Math.random() - 0.5) * 1.2, 0.7, (Math.random() - 0.5) * 1.2,
          0.85, 0.42, 3.2, 0x555055, 0.44);
        g.fx.sparks.emit(r.x - Math.sin(r.angle) * 0.3, r.y, r.z - Math.cos(r.angle) * 0.3,
          (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2, (Math.random() - 0.5) * 2,
          0.14, 0.6, 0xffb44a, 0);
        if (shell) g.fx.tracers.add(r.x, r.y, r.z, r.x - stepX * 2, r.z - stepZ * 2, 0.2, 0xffcf70, 0.08);
      }
      if (!grenade && !bolt) g.fx.lights.flash(r.x, r.y, r.z, 0xff9040, 40, 10, 0.05);
      if (bolt && g.fx.tracers) g.fx.tracers.add(r.x, r.y, r.z, r.prevX, r.prevZ, 0.035, 0xbeddd8, 0.055);

      if (boom) {
        const hits = r.w.splash > 0 && r.w.splashRadius > 0 ? g.explosion(bx, r.y, bz, r.w.splash, r.w.splashRadius, true, r.ownerId) : 0;
        if (bolt && directHit && g.fx.sparks.impact) g.fx.sparks.impact(bx, r.y, bz, Math.sin(r.angle), Math.cos(r.angle), 0xc9e4df, false);
        if ((directHit || hits > 0) && r.w.onHit) r.w.onHit();
        this.rockets.splice(i, 1);
      }
    }

    /* acid globs */
    for (let i = this.acid.length - 1; i >= 0; i--) {
      const a = this.acid[i];
      a.prevX = a.x; a.prevY = a.y; a.prevZ = a.z;
      a.life -= dt;
      Object.assign(a, CombatCore.projectileKinematics(a, dt));

      let done = false;
      if (a.life <= 0 || a.y < 0.15) done = true;
      else if (g.level.isWallAt(a.x, a.z)) done = true;
      else if (player.alive && dist2(a.x, a.z, player.x, player.z) < 0.8 * 0.8 && Math.abs(a.y - 1.1) < 1.3) {
        g.damagePlayer(a.damage, a.x, a.z);
        done = true;
      }

      if (Math.random() < dt * 30) {
        g.fx.sparks.emit(a.x, a.y, a.z, (Math.random() - 0.5) * 1.5, -0.5, (Math.random() - 0.5) * 1.5,
          0.35, 0.3, 0x9fe03a, 3);
      }

      if (done) {
        g.fx.sparks.burst(a.x, Math.max(0.2, a.y), a.z, 8, 4, 0.4, 0.34, 0x9fe03a, 0.7, 12);
        g.fx.decals.blood(a.x, a.z, 1.5, 0x88ff44);
        this.acid.splice(i, 1);
      }
    }

  }

  render(alpha = 1) {
    alpha = clamp(alpha, 0, 1);
    let n = 0, grenadeCount = 0, boltCount = 0;
    for (let i = 0; i < this.rockets.length; i++) {
      const r = this.rockets[i];
      this._e.set(r.w.projectileKind === 'grenade' ? r.life * 7 : 0, r.angle, 0);
      this._q.setFromEuler(this._e);
      this._p.set(lerp(r.prevX, r.x, alpha), lerp(r.prevY, r.y, alpha), lerp(r.prevZ, r.z, alpha));
      this._s.setScalar(r.w.projectileKind === 'shell' ? 0.65 : 1);
      this._m.compose(this._p, this._q, this._s);
      if (r.w.projectileKind === 'grenade') this.grenadeMesh.setMatrixAt(grenadeCount++, this._m);
      else if (r.w.projectileKind === 'bolt') this.boltMesh.setMatrixAt(boltCount++, this._m);
      else this.rocketMesh.setMatrixAt(n++, this._m);
    }
    this.rocketMesh.count = n;
    this.rocketMesh.instanceMatrix.needsUpdate = true;
    this.grenadeMesh.count = grenadeCount; this.boltMesh.count = boltCount;
    this.grenadeMesh.instanceMatrix.needsUpdate = this.boltMesh.instanceMatrix.needsUpdate = true;

    n = 0;
    this._s.set(1, 1, 1);
    for (let i = 0; i < this.acid.length; i++) {
      const a = this.acid[i];
      this._p.set(lerp(a.prevX, a.x, alpha), lerp(a.prevY, a.y, alpha), lerp(a.prevZ, a.z, alpha));
      this._q.identity();
      this._m.compose(this._p, this._q, this._s);
      this.acidMesh.setMatrixAt(n++, this._m);
    }
    this.acidMesh.count = n;
    this.acidMesh.instanceMatrix.needsUpdate = true;
  }

  clear() {
    this.rockets.length = 0;
    this.owners?.clear();
    this.acid.length = 0;
    this.rocketMesh.count = 0;
    this.grenadeMesh.count = 0; this.boltMesh.count = 0;
    this.acidMesh.count = 0;
  }
}
