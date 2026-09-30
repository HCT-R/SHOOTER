/* ========================================================================
   30-level.js — BSP facility generation, collision grid, nav flow-field
   ======================================================================== */

const TILE = 3;
const WALL_H = 3.0;

const T_WALL = 1;
const T_FLOOR = 0;

/* Shared by the level renderer, wave director, HUD and ambient audio.
   All colours are numeric RGB values; sectorIndex wraps through this list. */
const SECTOR_DEFS = Object.freeze([
  Object.freeze({ id: 'dock', name: 'DOCK 07', subtitle: 'Грузовой терминал',
    accent: 0x44e7ee, fog: 0x07131d, fogDensity: 0.0105,
    floorTint: 0xb4d5dc, wallTint: 0xa8cbd5, capColor: 0x182a36,
    lampColor: 0x99eaff, hazardColor: 0xe8bf52 }),
  Object.freeze({ id: 'cryo', name: 'CRYO LAB', subtitle: 'Криогенный комплекс',
    accent: 0xb39aff, fog: 0x101027, fogDensity: 0.012,
    floorTint: 0xd8d2f3, wallTint: 0xc3cbe7, capColor: 0x272b44,
    lampColor: 0xa2bbff, hazardColor: 0xa3bfff }),
  Object.freeze({ id: 'reactor', name: 'REACTOR CORE', subtitle: 'Реакторный блок',
    accent: 0xffa252, fog: 0x1b100d, fogDensity: 0.0115,
    floorTint: 0xd9b69b, wallTint: 0xd2b7a2, capColor: 0x342720,
    lampColor: 0xffb36d, hazardColor: 0xff9d35 })
]);

class LevelMap {
  constructor(w, h, seed, sectorIndex = 0) {
    this.w = w;
    this.h = h;
    this.seed = seed;
    this.sectorIndex = ((sectorIndex | 0) % SECTOR_DEFS.length + SECTOR_DEFS.length) % SECTOR_DEFS.length;
    this.sector = SECTOR_DEFS[this.sectorIndex];
    this.rng = makeRng(seed);
    this.grid = new Uint8Array(w * h).fill(T_WALL);
    this.rooms = [];
    this.lamps = [];
    this.spawnPoints = [];
    this.propSpots = [];
    this.start = { x: 0, z: 0 };

    // nav
    this.navDist = new Int32Array(w * h).fill(-1);
    this.navQueue = new Int32Array(w * h);
    this.navTimer = 0;

    this._generate();
    this._deriveSpots();
    this._initNavRouting();
  }

  idx(tx, tz) { return tz * this.w + tx; }
  inBounds(tx, tz) { return tx >= 0 && tz >= 0 && tx < this.w && tz < this.h; }

  isWallTile(tx, tz) {
    if (!this.inBounds(tx, tz)) return true;
    return this.grid[this.idx(tx, tz)] === T_WALL;
  }

  /* world <-> tile. world origin sits at the centre of the map */
  tileToWorldX(tx) { return (tx - this.w / 2 + 0.5) * TILE; }
  tileToWorldZ(tz) { return (tz - this.h / 2 + 0.5) * TILE; }
  worldToTileX(x) { return Math.floor(x / TILE + this.w / 2); }
  worldToTileZ(z) { return Math.floor(z / TILE + this.h / 2); }

  isWallAt(x, z) { return this.isWallTile(this.worldToTileX(x), this.worldToTileZ(z)); }

  /* ---------------- generation ---------------- */
  _generate() {
    const R = this.rng;
    // Dock: open cargo halls. Cryo: compact laboratories. Reactor: big arenas.
    const MIN_LEAF = [11, 9, 13][this.sectorIndex];

    // 1. recursive binary-space partition
    const leaves = [];
    const split = (x, z, w, h, depth) => {
      const canSplitW = w > MIN_LEAF * 2;
      const canSplitH = h > MIN_LEAF * 2;
      if (depth > 5 || (!canSplitW && !canSplitH) || (depth > 2 && R.chance(0.18))) {
        leaves.push({ x: x, z: z, w: w, h: h });
        return;
      }
      let horiz;
      if (canSplitW && canSplitH) horiz = w > h ? false : true;
      else horiz = !canSplitW;

      if (horiz) {
        const cut = R.int(MIN_LEAF, h - MIN_LEAF);
        split(x, z, w, cut, depth + 1);
        split(x, z + cut, w, h - cut, depth + 1);
      } else {
        const cut = R.int(MIN_LEAF, w - MIN_LEAF);
        split(x, z, cut, h, depth + 1);
        split(x + cut, z, w - cut, h, depth + 1);
      }
    };
    split(2, 2, this.w - 4, this.h - 4, 0);

    // 2. carve a room inside each leaf
    for (let i = 0; i < leaves.length; i++) {
      const L = leaves[i];
      const margin = this.sectorIndex === 1 ? 4 : 3;
      const rw = Math.max(5, L.w - R.int(2, margin));
      const rh = Math.max(5, L.h - R.int(2, margin));
      const rx = L.x + Math.floor((L.w - rw) / 2);
      const rz = L.z + Math.floor((L.h - rh) / 2);
      const room = { x: rx, z: rz, w: rw, h: rh, cx: rx + (rw >> 1), cz: rz + (rh >> 1),
        number: i + 1, kind: ['cargo', 'lab', 'power'][this.sectorIndex] };
      this.rooms.push(room);
      this._carveRect(rx, rz, rw, rh);
    }

    // 3. connect rooms in sequence, then add loops so the map isn't a tree
    for (let i = 1; i < this.rooms.length; i++) {
      this._corridor(this.rooms[i - 1], this.rooms[i]);
    }
    const extra = Math.floor(this.rooms.length * (this.sectorIndex === 2 ? 0.75 : 0.4));
    for (let i = 0; i < extra; i++) {
      const a = R.pick(this.rooms), b = R.pick(this.rooms);
      if (a !== b) this._corridor(a, b);
    }

    // 4. pillars and alcoves for cover
    for (let i = 0; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      if (room.w >= 9 && room.h >= 9 && R.chance(0.7)) {
        const px = room.x + 2, pz = room.z + 2;
        const pw = room.w - 4, ph = room.h - 4;
        const pattern = R.int(0, 2);
        if (pattern === 0) {
          this.grid[this.idx(px, pz)] = T_WALL;
          this.grid[this.idx(px + pw - 1, pz)] = T_WALL;
          this.grid[this.idx(px, pz + ph - 1)] = T_WALL;
          this.grid[this.idx(px + pw - 1, pz + ph - 1)] = T_WALL;
        } else if (pattern === 1) {
          const cx = room.cx, cz = room.cz;
          this.grid[this.idx(cx, cz)] = T_WALL;
          this.grid[this.idx(cx + 1, cz)] = T_WALL;
          this.grid[this.idx(cx, cz + 1)] = T_WALL;
          this.grid[this.idx(cx + 1, cz + 1)] = T_WALL;
        } else {
          for (let k = 0; k < 3; k++) {
            const bx = R.int(room.x + 1, room.x + room.w - 2);
            const bz = R.int(room.z + 1, room.z + room.h - 2);
            this.grid[this.idx(bx, bz)] = T_WALL;
          }
        }
      }
    }

    // Keep the spawn pads and a connected spine free after adding cover.
    // Previously a centre pillar could put the player inside a wall.
    for (const room of this.rooms) this._carveRect(room.cx - 1, room.cz - 1, 3, 3);
    for (let i = 1; i < this.rooms.length; i++) this._corridor(this.rooms[i - 1], this.rooms[i]);

    // 5. seal the border so nothing can walk off the map
    for (let x = 0; x < this.w; x++) {
      this.grid[this.idx(x, 0)] = T_WALL;
      this.grid[this.idx(x, this.h - 1)] = T_WALL;
    }
    for (let z = 0; z < this.h; z++) {
      this.grid[this.idx(0, z)] = T_WALL;
      this.grid[this.idx(this.w - 1, z)] = T_WALL;
    }

    // Decorative cover may create a tiny enclosed pocket. Seal such pockets
    // rather than allowing enemies or loot to spawn outside the nav network.
    const origin = this.rooms[0];
    this.rebuildNav(this.tileToWorldX(origin.cx), this.tileToWorldZ(origin.cz));
    for (let i = 0; i < this.grid.length; i++) {
      if (this.grid[i] === T_FLOOR && this.navDist[i] < 0) this.grid[i] = T_WALL;
    }
    this.navDist.fill(-1);
  }

  _carveRect(x, z, w, h) {
    for (let tz = z; tz < z + h; tz++) {
      for (let tx = x; tx < x + w; tx++) {
        if (this.inBounds(tx, tz)) this.grid[this.idx(tx, tz)] = T_FLOOR;
      }
    }
  }

  _corridor(a, b) {
    const R = this.rng;
    const width = this.sectorIndex === 2 ? 3 : R.chance(this.sectorIndex === 0 ? 0.65 : 0.25) ? 3 : 2;
    const half = width >> 1;
    if (R.chance(0.5)) {
      this._carveRect(Math.min(a.cx, b.cx), a.cz - half, Math.abs(a.cx - b.cx) + 1, width);
      this._carveRect(b.cx - half, Math.min(a.cz, b.cz), width, Math.abs(a.cz - b.cz) + 1);
    } else {
      this._carveRect(a.cx - half, Math.min(a.cz, b.cz), width, Math.abs(a.cz - b.cz) + 1);
      this._carveRect(Math.min(a.cx, b.cx), b.cz - half, Math.abs(a.cx - b.cx) + 1, width);
    }
  }

  /* choose start, alien spawn points, lamp and prop positions */
  _deriveSpots() {
    const R = this.rng;
    const lampRng = makeRng(this.seed ^ 0x4c414d50);
    const startRoom = this.rooms[Math.floor(this.rooms.length / 2)];
    this.start.x = this.tileToWorldX(startRoom.cx);
    this.start.z = this.tileToWorldZ(startRoom.cz);
    this.startRoom = startRoom;

    for (let i = 0; i < this.rooms.length; i++) {
      const room = this.rooms[i];
      // lamps: one per room, plus one extra in large rooms
      this.lamps.push({
        x: this.tileToWorldX(room.cx),
        z: this.tileToWorldZ(room.cz),
        hue: lampRng.chance(0.16) ? 0xff6652 : this.sector.lampColor,
        phase: lampRng() * TAU,
        flicker: room !== startRoom && lampRng.chance(0.22)
      });
      if (room.w * room.h > 150) {
        this.lamps.push({ x: this.tileToWorldX(room.x + 2), z: this.tileToWorldZ(room.z + 2),
          hue: this.sector.accent, phase: lampRng() * TAU, flicker: false });
      }

      if (room !== startRoom) {
        // spawn points in room corners, away from the middle
        for (let k = 0; k < 3; k++) {
          const tx = R.int(room.x + 1, room.x + room.w - 2);
          const tz = R.int(room.z + 1, room.z + room.h - 2);
          if (!this.isWallTile(tx, tz)) {
            this.spawnPoints.push({ x: this.tileToWorldX(tx), z: this.tileToWorldZ(tz) });
          }
        }
      }

      // prop spots: floor tiles inside rooms
      const propCount = Math.floor((room.w * room.h) / (this.sectorIndex === 0 ? 23 : 30));
      const occupied = new Set();
      for (let k = 0; k < propCount; k++) {
        const tx = R.int(room.x + 1, room.x + room.w - 2);
        const tz = R.int(room.z + 1, room.z + room.h - 2);
        if (this.isWallTile(tx, tz)) continue;
        // Leave crossing lanes open; wide containers cannot plug a doorway.
        if (Math.abs(tx - room.cx) <= 1 || Math.abs(tz - room.cz) <= 1) continue;
        if (occupied.has(this.idx(tx, tz))) continue;
        if (this.isWallTile(tx - 1, tz) || this.isWallTile(tx + 1, tz) ||
            this.isWallTile(tx, tz - 1) || this.isWallTile(tx, tz + 1)) continue;
        occupied.add(this.idx(tx, tz));
        const wx = this.tileToWorldX(tx) + R.range(-0.3, 0.3);
        const wz = this.tileToWorldZ(tz) + R.range(-0.3, 0.3);
        if (dist2(wx, wz, this.start.x, this.start.z) < 64) continue;
        this.propSpots.push({ x: wx, z: wz, rot: R() * TAU });
      }
    }
  }

  /* random walkable world position at least `minDist` from (fx,fz) */
  randomFloorPos(minDist, fx, fz, rng) {
    const R = rng || this.rng;
    for (let tries = 0; tries < 60; tries++) {
      const room = R.pick(this.rooms);
      const tx = R.int(room.x, room.x + room.w - 1);
      const tz = R.int(room.z, room.z + room.h - 1);
      if (this.isWallTile(tx, tz)) continue;
      const x = this.tileToWorldX(tx), z = this.tileToWorldZ(tz);
      if (minDist && dist2(x, z, fx, fz) < minDist * minDist) continue;
      return { x: x, z: z };
    }
    return { x: this.start.x, z: this.start.z };
  }

  /* ---------------- collision ---------------- */
  /* pushes a circle out of any solid tile it overlaps; returns true if it hit */
  resolveCircle(pos, radius) {
    let hit = false;
    const tx = this.worldToTileX(pos.x);
    const tz = this.worldToTileZ(pos.z);
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        const cx = tx + ox, cz = tz + oz;
        if (!this.isWallTile(cx, cz)) continue;
        // tile AABB in world space
        const minX = this.tileToWorldX(cx) - TILE / 2;
        const maxX = minX + TILE;
        const minZ = this.tileToWorldZ(cz) - TILE / 2;
        const maxZ = minZ + TILE;
        const nx = clamp(pos.x, minX, maxX);
        const nz = clamp(pos.z, minZ, maxZ);
        const dx = pos.x - nx, dz = pos.z - nz;
        const d2 = dx * dx + dz * dz;
        if (d2 >= radius * radius) continue;
        hit = true;
        if (d2 > 1e-8) {
          const d = Math.sqrt(d2);
          const push = radius - d;
          pos.x += (dx / d) * push;
          pos.z += (dz / d) * push;
        } else {
          // centre is inside the tile: eject along the shallowest axis
          const toLeft = pos.x - minX, toRight = maxX - pos.x;
          const toTop = pos.z - minZ, toBot = maxZ - pos.z;
          const m = Math.min(toLeft, toRight, toTop, toBot);
          if (m === toLeft) pos.x = minX - radius;
          else if (m === toRight) pos.x = maxX + radius;
          else if (m === toTop) pos.z = minZ - radius;
          else pos.z = maxZ + radius;
        }
      }
    }
    return hit;
  }

  /* grid DDA: is the straight line a->b unobstructed? */
  lineOfSight(ax, az, bx, bz) {
    let x0 = this.worldToTileX(ax), z0 = this.worldToTileZ(az);
    const x1 = this.worldToTileX(bx), z1 = this.worldToTileZ(bz);
    let dx = Math.abs(x1 - x0), dz = Math.abs(z1 - z0);
    const sx = x0 < x1 ? 1 : -1, sz = z0 < z1 ? 1 : -1;
    let err = dx - dz;
    let guard = 0;
    while (guard++ < 256) {
      if (this.isWallTile(x0, z0)) return false;
      if (x0 === x1 && z0 === z1) return true;
      const e2 = err * 2;
      if (e2 > -dz) { err -= dz; x0 += sx; }
      if (e2 < dx) { err += dx; z0 += sz; }
    }
    return false;
  }

  /* first wall hit along a ray, or null. Used by hitscan weapons. */
  raycastWall(ax, az, dx, dz, maxDist) {
    const step = 0.35;
    const steps = Math.ceil(maxDist / step);
    for (let i = 1; i <= steps; i++) {
      const t = i * step;
      const x = ax + dx * t, z = az + dz * t;
      if (this.isWallAt(x, z)) {
        return { x: ax + dx * (t - step * 0.5), z: az + dz * (t - step * 0.5), dist: t - step * 0.5 };
      }
    }
    return null;
  }

  /* ---------------- navigation ---------------- */
  /* Half-tile samples preserve a centre lane for a boss in a six-unit
     corridor. Inflating whole floor tiles would incorrectly close it. */
  _initNavRouting() {
    this.navStep = TILE / 2;
    this.navWidth = this.w * 2;
    this.navHeight = this.h * 2;
    const size = this.navWidth * this.navHeight;
    this._navFineQueue = new Int32Array(size);
    this._navWalls = new Float32Array(size);
    this._navBuckets = new Array(size);
    this._navProfiles = [0.55, 1.0, 2.1].map(radius => ({
      radius, open: new Uint8Array(size), links: new Uint8Array(size),
      dist: new Int32Array(size).fill(-1)
    }));
    for (let iz = 0; iz < this.navHeight; iz++) {
      for (let ix = 0; ix < this.navWidth; ix++) {
        const x = this._navX(ix), z = this._navZ(iz);
        const tx = this.worldToTileX(x), tz = this.worldToTileZ(z);
        let nearest = Infinity;
        for (let oz = -1; oz <= 1; oz++) {
          for (let ox = -1; ox <= 1; ox++) {
            if (!this.isWallTile(tx + ox, tz + oz)) continue;
            const dx = Math.max(0, Math.abs(x - this.tileToWorldX(tx + ox)) - TILE / 2);
            const dz = Math.max(0, Math.abs(z - this.tileToWorldZ(tz + oz)) - TILE / 2);
            nearest = Math.min(nearest, Math.hypot(dx, dz));
          }
        }
        this._navWalls[iz * this.navWidth + ix] = nearest;
      }
    }
    this.setObstacles([]);
  }

  _navX(ix) { return (ix + 0.5) * this.navStep - this.w * TILE / 2; }
  _navZ(iz) { return (iz + 0.5) * this.navStep - this.h * TILE / 2; }

  /* Props calls this after construction or barrel destruction. No tile is
     converted into a wall; collision and the original wall field stay intact. */
  setObstacles(solids) {
    this.navObstacles = solids || [];
    this.navTimer = 0;
    if (!this._navProfiles) return;
    const width = this.navWidth, height = this.navHeight, step = this.navStep;
    const buckets = this._navBuckets;
    for (let i = 0; i < buckets.length; i++) if (buckets[i]) buckets[i].length = 0;
    for (const s of this.navObstacles) {
      if (s.barrel && !s.barrel.alive) continue;
      // Include the adjacent edge as well as the largest agent radius.
      const reach = s.r + 2.1 + step;
      const x0 = clamp(Math.floor((s.x - reach + this.w * TILE / 2) / step), 0, width - 1);
      const x1 = clamp(Math.floor((s.x + reach + this.w * TILE / 2) / step), 0, width - 1);
      const z0 = clamp(Math.floor((s.z - reach + this.h * TILE / 2) / step), 0, height - 1);
      const z1 = clamp(Math.floor((s.z + reach + this.h * TILE / 2) / step), 0, height - 1);
      for (let z = z0; z <= z1; z++) for (let x = x0; x <= x1; x++) {
        const i = z * width + x;
        if (!buckets[i]) buckets[i] = [];
        buckets[i].push(s);
      }
    }
    for (const profile of this._navProfiles) {
      const radius = profile.radius, open = profile.open, links = profile.links;
      profile.dist.fill(-1);
      links.fill(0);
      for (let i = 0; i < open.length; i++) {
        open[i] = this._navWalls[i] + 1e-6 >= radius ? 1 : 0;
        if (!open[i] || !buckets[i]) continue;
        const x = this._navX(i % width), z = this._navZ((i / width) | 0);
        for (const s of buckets[i]) {
          if (dist2(x, z, s.x, s.z) < (radius + s.r) ** 2 - 1e-6) { open[i] = 0; break; }
        }
      }
      for (let i = 0; i < open.length; i++) {
        if (!open[i]) continue;
        const ix = i % width, iz = (i / width) | 0;
        const x = this._navX(ix), z = this._navZ(iz);
        if (ix + 1 < width && open[i + 1] && this._navEdgeClear(i, x, z, x + step, z, radius)) {
          links[i] |= 1; links[i + 1] |= 2;
        }
        if (iz + 1 < height && open[i + width] && this._navEdgeClear(i, x, z, x, z + step, radius)) {
          links[i] |= 4; links[i + width] |= 8;
        }
      }
    }
  }

  _navEdgeClear(index, ax, az, bx, bz, radius) {
    const nearby = this._navBuckets[index];
    if (nearby) for (const s of nearby) {
      if (segPointDist2(ax, az, bx, bz, s.x, s.z) < (s.r + radius) ** 2 - 1e-6) return false;
    }
    return true;
  }

  obstacleLineClear(ax, az, bx, bz, radius = 0) {
    if (this.navObstacles) for (const s of this.navObstacles) {
      if (s.barrel && !s.barrel.alive) continue;
      if (segPointDist2(ax, az, bx, bz, s.x, s.z) < (s.r + radius) ** 2 - 1e-6) return false;
    }
    return true;
  }

  _rebuildRadiusFields(targetX, targetZ) {
    const width = this.navWidth, queue = this._navFineQueue;
    for (const profile of this._navProfiles) {
      const dist = profile.dist, links = profile.links;
      dist.fill(-1);
      let goal = -1, nearest = Infinity;
      // The player can stand closer to a wall than a boss. Use the nearest
      // visible, reachable centre as that radius profile's goal instead.
      for (let i = 0; i < dist.length; i++) {
        if (!profile.open[i]) continue;
        const x = this._navX(i % width), z = this._navZ((i / width) | 0);
        const d = dist2(x, z, targetX, targetZ);
        if (d < nearest && this.lineOfSight(x, z, targetX, targetZ)) { nearest = d; goal = i; }
      }
      if (goal < 0) continue;
      let head = 0, tail = 0;
      dist[goal] = 0;
      queue[tail++] = goal;
      while (head < tail) {
        const cur = queue[head++], nextDistance = dist[cur] + 1;
        for (let k = 0; k < 4; k++) {
          if (!(links[cur] & (1 << k))) continue;
          const next = cur + (k === 0 ? 1 : k === 1 ? -1 : k === 2 ? width : -width);
          if (dist[next] >= 0) continue;
          dist[next] = nextDistance;
          queue[tail++] = next;
        }
      }
    }
  }

  /* BFS distance field from the player; aliens descend its gradient, so they
     round corners instead of grinding into walls */
  rebuildNav(targetX, targetZ) {
    const dist = this.navDist;
    dist.fill(-1);
    const tx = clamp(this.worldToTileX(targetX), 0, this.w - 1);
    const tz = clamp(this.worldToTileZ(targetZ), 0, this.h - 1);
    if (this.isWallTile(tx, tz)) return;

    const q = this.navQueue;
    let head = 0, tail = 0;
    const startIdx = this.idx(tx, tz);
    dist[startIdx] = 0;
    q[tail++] = startIdx;

    while (head < tail) {
      const cur = q[head++];
      const cd = dist[cur];
      const cxT = cur % this.w;
      const czT = (cur / this.w) | 0;
      for (let k = 0; k < 4; k++) {
        const nx = cxT + (k === 0 ? 1 : k === 1 ? -1 : 0);
        const nz = czT + (k === 2 ? 1 : k === 3 ? -1 : 0);
        if (nx < 0 || nz < 0 || nx >= this.w || nz >= this.h) continue;
        const ni = nz * this.w + nx;
        if (dist[ni] !== -1 || this.grid[ni] === T_WALL) continue;
        dist[ni] = cd + 1;
        q[tail++] = ni;
      }
    }
    if (this._navProfiles) this._rebuildRadiusFields(targetX, targetZ);
  }

  /* unit vector pointing downhill on the distance field, written into `out` */
  flowDir(x, z, out, radius = 0) {
    if (!this._navProfiles) return this._wallFlowDir(x, z, out);
    const profiles = this._navProfiles;
    const profile = radius <= profiles[0].radius ? profiles[0]
      : radius <= profiles[1].radius ? profiles[1] : profiles[2];
    const width = this.navWidth;
    const ix = Math.floor((x + this.w * TILE / 2) / this.navStep);
    const iz = Math.floor((z + this.h * TILE / 2) / this.navStep);
    out.x = out.z = 0;
    if (ix < 0 || iz < 0 || ix >= width || iz >= this.navHeight) return false;
    const index = iz * width + ix, here = profile.dist[index];
    if (here === 0) return true;
    let best = here < 0 ? Infinity : here, bestIndex = -1;
    for (let oz = -1; oz <= 1; oz++) for (let ox = -1; ox <= 1; ox++) {
      if ((!ox && !oz) || ix + ox < 0 || ix + ox >= width || iz + oz < 0 || iz + oz >= this.navHeight) continue;
      const next = index + oz * width + ox, d = profile.dist[next];
      if (d < 0 || d >= best) continue;
      // A diagonal needs both clear side cells; an axis move needs its edge.
      if (ox && oz) {
        if (!profile.open[index + ox] || !profile.open[index + oz * width]) continue;
      } else if (here >= 0 && !(profile.links[index] & (ox > 0 ? 1 : ox < 0 ? 2 : oz > 0 ? 4 : 8))) continue;
      const nx = this._navX(ix + ox), nz = this._navZ(iz + oz);
      if (!this._navEdgeClear(index, x, z, nx, nz, radius)) continue;
      if (!this.lineOfSight(x, z, nx, nz)) continue;
      best = d; bestIndex = next;
    }
    if (bestIndex < 0) return false;
    const dx = this._navX(bestIndex % width) - x, dz = this._navZ((bestIndex / width) | 0) - z;
    const length = Math.hypot(dx, dz) || 1;
    out.x = dx / length; out.z = dz / length;
    return true;
  }

  _wallFlowDir(x, z, out) {
    const tx = this.worldToTileX(x), tz = this.worldToTileZ(z);
    if (!this.inBounds(tx, tz)) { out.x = 0; out.z = 0; return false; }
    const here = this.navDist[this.idx(tx, tz)];
    if (here <= 0) { out.x = 0; out.z = 0; return here === 0; }

    let bestD = here, bx = 0, bz = 0, found = false;
    for (let oz = -1; oz <= 1; oz++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (ox === 0 && oz === 0) continue;
        const nx = tx + ox, nz = tz + oz;
        if (!this.inBounds(nx, nz)) continue;
        const d = this.navDist[this.idx(nx, nz)];
        if (d === -1) continue;
        // diagonals may not cut a corner through a wall
        if (ox !== 0 && oz !== 0 && (this.isWallTile(tx + ox, tz) || this.isWallTile(tx, tz + oz))) continue;
        if (d < bestD) { bestD = d; bx = ox; bz = oz; found = true; }
      }
    }
    if (!found) { out.x = 0; out.z = 0; return false; }
    const len = Math.hypot(bx, bz) || 1;
    out.x = bx / len;
    out.z = bz / len;
    return true;
  }
}
