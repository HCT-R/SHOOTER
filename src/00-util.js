/* ========================================================================
   00-util.js — math, RNG, pooling, small helpers
   ======================================================================== */

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, t) => a + (b - a) * clamp(t, 0, 1);
const damp = (a, b, lambda, dt) => lerp(a, b, 1 - Math.exp(-lambda * dt));
const sign = Math.sign;
const dist2 = (ax, az, bx, bz) => { const dx = ax - bx, dz = az - bz; return dx * dx + dz * dz; };
const angleLerp = (a, b, t) => {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU; else if (d < -Math.PI) d += TAU;
  return a + d * t;
};

/* deterministic RNG so a seed always yields the same facility layout */
function makeRng(seed) {
  let s = seed >>> 0;
  const fn = () => {
    s |= 0; s = (s + 0x6D2B79F5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  fn.range = (a, b) => a + fn() * (b - a);
  fn.int = (a, b) => Math.floor(a + fn() * (b - a + 1));
  fn.pick = (arr) => arr[Math.floor(fn() * arr.length)];
  fn.chance = (p) => fn() < p;
  fn.sign = () => (fn() < 0.5 ? -1 : 1);
  fn.getState = () => s >>> 0;
  fn.setState = (value) => { s = value >>> 0; };
  return fn;
}

/* fixed-capacity object pool; alive items are kept packed at the front so
   the update loop is a plain forward scan with no holes */
class Pool {
  constructor(capacity, factory) {
    this.items = new Array(capacity);
    for (let i = 0; i < capacity; i++) { this.items[i] = factory(i); this.items[i].alive = false; }
    this.count = 0;
    this.capacity = capacity;
  }
  spawn() {
    if (this.count >= this.capacity) {
      // recycle the oldest slot rather than dropping the request
      const o = this.items[0];
      this.items[0] = this.items[this.count - 1];
      this.items[this.count - 1] = o;
      o.alive = true;
      return o;
    }
    const o = this.items[this.count++];
    o.alive = true;
    return o;
  }
  release(i) {
    const last = --this.count;
    const o = this.items[i];
    o.alive = false;
    this.items[i] = this.items[last];
    this.items[last] = o;
  }
  clear() { for (let i = 0; i < this.capacity; i++) this.items[i].alive = false; this.count = 0; }
}

/* uniform-grid spatial hash for enemy separation and bullet queries */
class SpatialHash {
  constructor(cellSize) {
    this.cell = cellSize;
    this.map = new Map();
  }
  key(cx, cz) { return cx * 73856093 ^ cz * 19349663; }
  clear() { this.map.clear(); }
  insert(obj, x, z) {
    const cx = Math.floor(x / this.cell), cz = Math.floor(z / this.cell);
    const k = this.key(cx, cz);
    let b = this.map.get(k);
    if (!b) { b = []; this.map.set(k, b); }
    b.push(obj);
  }
  /* collects into `out` (an array that is reused by the caller) */
  query(x, z, radius, out) {
    out.length = 0;
    const c = this.cell;
    const x0 = Math.floor((x - radius) / c), x1 = Math.floor((x + radius) / c);
    const z0 = Math.floor((z - radius) / c), z1 = Math.floor((z + radius) / c);
    for (let cx = x0; cx <= x1; cx++) {
      for (let cz = z0; cz <= z1; cz++) {
        const b = this.map.get(this.key(cx, cz));
        if (b) for (let i = 0; i < b.length; i++) out.push(b[i]);
      }
    }
    return out;
  }
}

/* shortest distance from point p to segment a->b, on the XZ plane */
function segPointDist2(ax, az, bx, bz, px, pz) {
  const dx = bx - ax, dz = bz - az;
  const len2 = dx * dx + dz * dz;
  let t = len2 > 0 ? ((px - ax) * dx + (pz - az) * dz) / len2 : 0;
  t = clamp(t, 0, 1);
  const cx = ax + dx * t, cz = az + dz * t;
  return dist2(cx, cz, px, pz);
}

const fmt = (n) => n.toLocaleString('en-US');
