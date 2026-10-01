/* ========================================================================
   40-models.js — procedural smooth geometry (merged, vertex-coloured)

   BufferGeometryUtils lives in three's addons, which this single-file build
   does not include, so mergeParts() does the concatenation itself.
   Model convention: +Z is forward, +Y is up, origin at the feet.
   ======================================================================== */

const _mtx = new THREE.Matrix4();
const _quat = new THREE.Quaternion();
const _eul = new THREE.Euler();
const _v3a = new THREE.Vector3();
const _v3b = new THREE.Vector3();
const _col = new THREE.Color();

/* darken (k < 1) or lighten (k > 1) a hex colour, returned as hex */
function shade(hex, k) {
  _col.set(hex);
  if (k <= 1) _col.multiplyScalar(k);
  else _col.lerp(new THREE.Color(0xffffff), k - 1);
  return _col.getHex();
}

/* a single primitive, pre-transformed and tinted */
function part(geo, opt) {
  opt = opt || {};
  const g = geo.index ? geo.toNonIndexed() : geo.clone();
  const p = opt.pos || [0, 0, 0];
  const r = opt.rot || [0, 0, 0];
  const s = opt.scale || [1, 1, 1];
  _eul.set(r[0], r[1], r[2]);
  _quat.setFromEuler(_eul);
  _v3a.set(p[0], p[1], p[2]);
  _v3b.set(s[0], s[1], s[2]);
  _mtx.compose(_v3a, _quat, _v3b);
  g.applyMatrix4(_mtx);

  const n = g.attributes.position.count;
  const colors = new Float32Array(n * 3);
  _col.set(opt.color === undefined ? 0xffffff : opt.color);
  // Color.set(hex) already converts sRGB to the linear working colour space.
  // Keep each authored surface clean; vertex noise muddies the material palette.
  for (let i = 0; i < n; i++) {
    colors[i * 3] = _col.r;
    colors[i * 3 + 1] = _col.g;
    colors[i * 3 + 2] = _col.b;
  }
  g.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  if (!g.attributes.uv) {
    g.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
  }
  return g;
}

function mergeParts(parts) {
  let total = 0;
  for (let i = 0; i < parts.length; i++) total += parts[i].attributes.position.count;

  const pos = new Float32Array(total * 3);
  const nrm = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const col = new Float32Array(total * 3);

  let o = 0;
  for (let i = 0; i < parts.length; i++) {
    const g = parts[i];
    const n = g.attributes.position.count;
    pos.set(g.attributes.position.array.subarray(0, n * 3), o * 3);
    nrm.set(g.attributes.normal.array.subarray(0, n * 3), o * 3);
    uv.set(g.attributes.uv.array.subarray(0, n * 2), o * 2);
    col.set(g.attributes.color.array.subarray(0, n * 3), o * 3);
    o += n;
    g.dispose();
  }

  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.BufferAttribute(nrm, 3));
  out.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  out.setAttribute('color', new THREE.BufferAttribute(col, 3));
  out.computeBoundingSphere();
  return out;
}

/* marks a geometry as outliving any single level, so the teardown that runs
   between runs knows to leave it alone */
function markShared(table) {
  for (const k in table) {
    const g = table[k];
    if (g && g.isBufferGeometry) g.userData.shared = true;
  }
  return table;
}

/* shared primitive sources — cloned by part(), never used directly */
const G = {};
function initPrimitives() {
  G.ico1 = new THREE.IcosahedronGeometry(1, 1);
  G.ico0 = new THREE.IcosahedronGeometry(1, 0);
  G.oct = new THREE.OctahedronGeometry(1, 0);
  G.box = new THREE.BoxGeometry(1, 1, 1);
  // Rounded clothing, armor and gloves retain the unit bounds used by IK.
  // Analytic normals join the six faces smoothly without changing joints.
  G.body = new THREE.BoxGeometry(1, 1, 1, 4, 4, 4);
  const position = G.body.attributes.position, normal = G.body.attributes.normal;
  for (let i = 0; i < position.count; i++) {
    _v3a.fromBufferAttribute(position, i);
    _v3b.set(clamp(_v3a.x, -.34, .34), clamp(_v3a.y, -.34, .34), clamp(_v3a.z, -.34, .34));
    _v3a.sub(_v3b).normalize(); normal.setXYZ(i, _v3a.x, _v3a.y, _v3a.z);
    _v3a.multiplyScalar(.16).add(_v3b); position.setXYZ(i, _v3a.x, _v3a.y, _v3a.z);
  }
  G.body.computeBoundingSphere();
  G.cyl = new THREE.CylinderGeometry(1, 1, 1, 20);
  G.cone = new THREE.ConeGeometry(1, 1, 16);
  G.sph = new THREE.SphereGeometry(1, 24, 16);
  G.tor = new THREE.TorusGeometry(1, 0.28, 12, 24);
  G.plane = new THREE.PlaneGeometry(1, 1);
}

/* ------------------------------------------------------------------
   Aliens. Each returns one merged geometry.
   ------------------------------------------------------------------ */

function buildCrawler() {
  const p = [];
  const shell = 0x44282d, flesh = 0xa64a34, claw = 0xf2dac1, eye = 0xffae39;
  // low flat carapace
  p.push(part(G.ico1, { pos: [0, 0.34, 0], scale: [0.48, 0.3, 0.68], color: shell }));
  p.push(part(G.ico0, { pos: [0, 0.46, -0.12], scale: [0.34, 0.26, 0.42], color: flesh }));
  // head + mandibles
  p.push(part(G.oct, { pos: [0, 0.32, 0.62], scale: [0.26, 0.22, 0.3], color: shell }));
  p.push(part(G.cone, { pos: [-0.14, 0.3, 0.84], rot: [Math.PI / 2.1, 0, 0.3], scale: [0.06, 0.3, 0.06], color: claw }));
  p.push(part(G.cone, { pos: [0.14, 0.3, 0.84], rot: [Math.PI / 2.1, 0, -0.3], scale: [0.06, 0.3, 0.06], color: claw }));
  p.push(part(G.ico0, { pos: [-0.12, 0.42, 0.72], scale: [0.06, 0.06, 0.06], color: eye }));
  p.push(part(G.ico0, { pos: [0.12, 0.42, 0.72], scale: [0.06, 0.06, 0.06], color: eye }));
  // six splayed legs
  for (let i = 0; i < 3; i++) {
    const z = 0.34 - i * 0.34;
    for (let s = -1; s <= 1; s += 2) {
      p.push(part(G.box, {
        pos: [s * 0.42, 0.2, z], rot: [0, 0, s * 0.85],
        scale: [0.42, 0.07, 0.09], color: shell
      }));
      p.push(part(G.box, {
        pos: [s * 0.6, 0.06, z], rot: [0, 0, s * -0.5],
        scale: [0.1, 0.24, 0.07], color: 0x4a1f16
      }));
    }
  }
  // spines
  p.push(part(G.cone, { pos: [0, 0.62, -0.1], scale: [0.07, 0.24, 0.07], color: claw }));
  p.push(part(G.cone, { pos: [-0.18, 0.56, -0.3], rot: [0, 0, -0.4], scale: [0.06, 0.18, 0.06], color: claw }));
  p.push(part(G.cone, { pos: [0.18, 0.56, -0.3], rot: [0, 0, 0.4], scale: [0.06, 0.18, 0.06], color: claw }));
  // Overlapping armour and amber organs stay legible from the game camera.
  for (let i = 0; i < 4; i++) {
    const z = 0.3 - i * 0.23;
    p.push(part(G.ico0, { pos: [0, 0.53, z], scale: [0.39 - i * 0.04, 0.14, 0.17], color: i % 2 ? shell : flesh }));
    for (const s of [-1, 1]) {
      p.push(part(G.oct, { pos: [s * 0.3, 0.51, z], scale: [0.045, 0.075, 0.1], color: eye }));
    }
  }
  return mergeParts(p);
}

function buildGrunt() {
  const p = [];
  const skin = 0x507d68, plate = 0x233c43, claw = 0xe3ded0, eye = 0xbaff67;
  // torso
  p.push(part(G.ico1, { pos: [0, 1.02, 0], scale: [0.5, 0.6, 0.42], color: skin }));
  p.push(part(G.ico0, { pos: [0, 1.28, 0.16], scale: [0.4, 0.34, 0.3], color: plate }));
  // hunched head
  p.push(part(G.ico1, { pos: [0, 1.5, 0.3], scale: [0.28, 0.26, 0.34], color: skin }));
  p.push(part(G.cone, { pos: [0, 1.46, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.16, 0.26, 0.14], color: plate }));
  p.push(part(G.ico0, { pos: [-0.13, 1.58, 0.46], scale: [0.055, 0.055, 0.055], color: eye }));
  p.push(part(G.ico0, { pos: [0.13, 1.58, 0.46], scale: [0.055, 0.055, 0.055], color: eye }));
  // arms ending in claws
  for (let s = -1; s <= 1; s += 2) {
    p.push(part(G.box, { pos: [s * 0.52, 1.12, 0.06], rot: [0, 0, s * 0.35], scale: [0.5, 0.17, 0.19], color: skin }));
    p.push(part(G.box, { pos: [s * 0.78, 0.86, 0.22], rot: [0.5, 0, s * 0.2], scale: [0.16, 0.44, 0.16], color: plate }));
    for (let k = -1; k <= 1; k++) {
      p.push(part(G.cone, {
        pos: [s * 0.78 + k * 0.08, 0.6, 0.36], rot: [Math.PI * 0.72, 0, k * 0.25],
        scale: [0.045, 0.26, 0.045], color: claw
      }));
    }
  }
  // digitigrade legs
  for (let s = -1; s <= 1; s += 2) {
    p.push(part(G.box, { pos: [s * 0.24, 0.62, -0.04], scale: [0.24, 0.5, 0.26], color: skin }));
    p.push(part(G.box, { pos: [s * 0.24, 0.24, 0.06], rot: [0.3, 0, 0], scale: [0.2, 0.46, 0.2], color: plate }));
    p.push(part(G.box, { pos: [s * 0.24, 0.05, 0.2], scale: [0.2, 0.1, 0.34], color: 0x1d3d18 }));
  }
  // dorsal spines
  for (let i = 0; i < 4; i++) {
    p.push(part(G.cone, {
      pos: [0, 1.24 + i * 0.1, -0.28 - i * 0.05], rot: [-0.5, 0, 0],
      scale: [0.06, 0.2 - i * 0.02, 0.06], color: claw
    }));
  }
  for (const s of [-1, 1]) {
    p.push(part(G.ico0, { pos: [s * 0.48, 1.4, -0.04], scale: [0.34, 0.27, 0.38], color: plate }));
    p.push(part(G.cone, { pos: [s * 0.57, 1.68, -0.02], rot: [0, 0, -s * 0.35], scale: [0.09, 0.37, 0.1], color: claw }));
    for (let i = 0; i < 3; i++) {
      p.push(part(G.box, { pos: [s * 0.27, 1.1 - i * 0.17, 0.36], rot: [0, 0, s * 0.23], scale: [0.25, 0.07, 0.09], color: plate }));
    }
  }
  p.push(part(G.oct, { pos: [0, 1.23, 0.42], scale: [0.13, 0.24, 0.055], color: eye }));
  return mergeParts(p);
}

function buildSpitter() {
  const p = [];
  const skin = 0x79538d, sac = 0xbbed48, plate = 0x342442, eye = 0xe2ff7e;
  p.push(part(G.ico1, { pos: [0, 0.86, 0], scale: [0.46, 0.5, 0.52], color: skin }));
  // glowing venom sacs
  p.push(part(G.sph, { pos: [-0.3, 1.02, -0.2], scale: [0.24, 0.24, 0.24], color: sac }));
  p.push(part(G.sph, { pos: [0.3, 1.02, -0.2], scale: [0.24, 0.24, 0.24], color: sac }));
  p.push(part(G.sph, { pos: [0, 1.18, -0.3], scale: [0.2, 0.2, 0.2], color: sac }));
  // head / spout
  p.push(part(G.ico0, { pos: [0, 1.06, 0.34], scale: [0.26, 0.24, 0.28], color: plate }));
  p.push(part(G.cyl, { pos: [0, 1.02, 0.62], rot: [Math.PI / 2, 0, 0], scale: [0.09, 0.3, 0.09], color: 0x2f1b3f }));
  p.push(part(G.ico0, { pos: [-0.12, 1.16, 0.44], scale: [0.05, 0.05, 0.05], color: eye }));
  p.push(part(G.ico0, { pos: [0.12, 1.16, 0.44], scale: [0.05, 0.05, 0.05], color: eye }));
  // four spindly legs
  for (let i = 0; i < 2; i++) {
    for (let s = -1; s <= 1; s += 2) {
      const z = 0.2 - i * 0.42;
      p.push(part(G.box, { pos: [s * 0.36, 0.62, z], rot: [0, 0, s * 0.7], scale: [0.36, 0.08, 0.08], color: plate }));
      p.push(part(G.box, { pos: [s * 0.5, 0.3, z], rot: [0, 0, s * -0.18], scale: [0.09, 0.6, 0.09], color: skin }));
    }
  }
  for (const s of [-1, 1]) {
    p.push(part(G.tor, { pos: [s * 0.32, 1.03, -0.2], rot: [Math.PI / 2, 0, 0], scale: [0.245, 0.245, 0.2], color: plate }));
    p.push(part(G.cone, { pos: [s * 0.35, 1.4, -0.2], rot: [0, 0, -s * 0.35], scale: [0.06, 0.38, 0.07], color: skin }));
  }
  p.push(part(G.tor, { pos: [0, 1.02, 0.76], scale: [0.12, 0.12, 0.09], color: sac }));
  p.push(part(G.box, { pos: [0, 0.91, 0.27], scale: [0.065, 0.06, 0.6], color: sac }));
  return mergeParts(p);
}

function buildBrute() {
  const p = [];
  const hide = 0x4f282d, plate = 0x926157, bone = 0xe6d4b5, eye = 0xff9038;
  // heavy chest
  p.push(part(G.ico1, { pos: [0, 1.7, 0], scale: [1.0, 0.95, 0.8], color: hide }));
  p.push(part(G.ico1, { pos: [0, 2.05, 0.3], scale: [0.78, 0.6, 0.6], color: plate }));
  // armour ridges
  for (let i = 0; i < 3; i++) {
    p.push(part(G.box, {
      pos: [0, 1.5 + i * 0.4, -0.62 + i * 0.06], rot: [0.2, 0, 0],
      scale: [1.3 - i * 0.16, 0.16, 0.4], color: plate
    }));
  }
  // small armoured head sunk into the shoulders
  p.push(part(G.ico0, { pos: [0, 2.28, 0.5], scale: [0.36, 0.32, 0.4], color: hide }));
  p.push(part(G.cone, { pos: [-0.26, 2.5, 0.34], rot: [-0.3, 0, -0.5], scale: [0.09, 0.42, 0.09], color: bone }));
  p.push(part(G.cone, { pos: [0.26, 2.5, 0.34], rot: [-0.3, 0, 0.5], scale: [0.09, 0.42, 0.09], color: bone }));
  p.push(part(G.ico0, { pos: [-0.16, 2.34, 0.78], scale: [0.07, 0.07, 0.07], color: eye }));
  p.push(part(G.ico0, { pos: [0.16, 2.34, 0.78], scale: [0.07, 0.07, 0.07], color: eye }));
  // massive arms
  for (let s = -1; s <= 1; s += 2) {
    p.push(part(G.ico0, { pos: [s * 1.0, 1.9, 0], scale: [0.42, 0.42, 0.42], color: plate }));
    p.push(part(G.box, { pos: [s * 1.12, 1.4, 0.1], rot: [0, 0, s * 0.16], scale: [0.42, 0.9, 0.44], color: hide }));
    p.push(part(G.ico0, { pos: [s * 1.2, 0.86, 0.24], scale: [0.34, 0.3, 0.34], color: plate }));
    for (let k = -1; k <= 1; k++) {
      p.push(part(G.cone, {
        pos: [s * 1.2 + k * 0.16, 0.58, 0.4], rot: [Math.PI * 0.78, 0, k * 0.2],
        scale: [0.08, 0.44, 0.08], color: bone
      }));
    }
  }
  // legs
  for (let s = -1; s <= 1; s += 2) {
    p.push(part(G.box, { pos: [s * 0.44, 1.0, 0], scale: [0.46, 0.9, 0.5], color: hide }));
    p.push(part(G.box, { pos: [s * 0.44, 0.36, 0.08], scale: [0.4, 0.72, 0.42], color: plate }));
    p.push(part(G.box, { pos: [s * 0.44, 0.08, 0.24], scale: [0.42, 0.18, 0.62], color: 0x3a1613 }));
    p.push(part(G.ico0, { pos: [s * 0.85, 2.17, 0], scale: [0.55, 0.39, 0.7], color: plate }));
    p.push(part(G.cone, { pos: [s * 0.93, 2.62, -0.08], rot: [-0.12, 0, -s * 0.3], scale: [0.17, 0.72, 0.17], color: bone }));
    p.push(part(G.box, { pos: [s * 1.13, 1.14, 0.4], scale: [0.31, 0.55, 0.08], color: 0x2a2531 }));
    for (let i = 0; i < 3; i++) {
      p.push(part(G.box, { pos: [s * 0.38, 2.0 - i * 0.19, 0.66], rot: [0, 0, s * 0.2], scale: [0.42, 0.065, 0.08], color: eye }));
    }
  }
  return mergeParts(p);
}

function buildFlyer() {
  const p = [];
  const skin = 0x276b83, wing = 0x66dce4, eye = 0xff6a80;
  p.push(part(G.ico1, { pos: [0, 0.9, 0], scale: [0.3, 0.34, 0.5], color: skin }));
  p.push(part(G.oct, { pos: [0, 0.9, 0.44], scale: [0.2, 0.18, 0.26], color: 0x1e4a52 }));
  p.push(part(G.ico0, { pos: [-0.09, 0.98, 0.5], scale: [0.05, 0.05, 0.05], color: eye }));
  p.push(part(G.ico0, { pos: [0.09, 0.98, 0.5], scale: [0.05, 0.05, 0.05], color: eye }));
  // membranous wings
  for (let s = -1; s <= 1; s += 2) {
    p.push(part(G.plane, { pos: [s * 0.52, 1.06, -0.06], rot: [-Math.PI / 2, 0, s * 0.3], scale: [0.9, 0.62, 1], color: wing }));
    p.push(part(G.box, { pos: [s * 0.36, 1.06, 0.04], rot: [0, s * 0.3, 0], scale: [0.6, 0.05, 0.05], color: skin }));
    p.push(part(G.oct, { pos: [s * 0.67, 1.07, -0.12], rot: [0, s * 0.4, 0], scale: [0.68, 0.045, 0.31], color: wing }));
    p.push(part(G.box, { pos: [s * 0.68, 1.12, 0.02], rot: [0, s * 0.18, 0], scale: [0.78, 0.035, 0.055], color: 0xb3fbf6 }));
    p.push(part(G.cone, { pos: [s * 0.21, 0.83, 0.6], rot: [Math.PI * 0.6, 0, s * 0.15], scale: [0.06, 0.48, 0.06], color: 0xeee1c5 }));
  }
  // trailing tail
  p.push(part(G.cone, { pos: [0, 0.86, -0.56], rot: [-Math.PI / 2, 0, 0], scale: [0.1, 0.5, 0.1], color: skin }));
  // tucked legs
  for (let s = -1; s <= 1; s += 2) {
    p.push(part(G.box, { pos: [s * 0.16, 0.62, 0.06], rot: [0.5, 0, 0], scale: [0.08, 0.4, 0.08], color: 0x1e4a52 }));
  }
  return mergeParts(p);
}

function buildQueen() {
  const p = [];
  const hide = 0x4a1d3f, plate = 0x7d2f5c, bone = 0xf0e2c0, sac = 0xff4d7a, eye = 0xffee66;
  p.push(part(G.ico1, { pos: [0, 2.4, -0.4], scale: [1.5, 1.5, 1.9], color: hide }));
  p.push(part(G.ico1, { pos: [0, 2.0, -2.2], scale: [1.2, 1.1, 1.4], color: sac }));
  p.push(part(G.ico0, { pos: [0, 1.6, -3.4], scale: [0.8, 0.7, 0.9], color: sac }));
  // crowned head
  p.push(part(G.ico1, { pos: [0, 3.2, 1.2], scale: [0.8, 0.75, 1.0], color: plate }));
  for (let i = -3; i <= 3; i++) {
    p.push(part(G.cone, {
      pos: [i * 0.28, 3.9 + Math.cos(i * 0.5) * 0.2, 0.9 - Math.abs(i) * 0.1],
      rot: [-0.5, 0, i * 0.16],
      scale: [0.1, 0.9 - Math.abs(i) * 0.12, 0.1], color: bone
    }));
  }
  p.push(part(G.cone, { pos: [0, 3.0, 2.1], rot: [Math.PI / 2, 0, 0], scale: [0.4, 0.8, 0.35], color: hide }));
  p.push(part(G.ico0, { pos: [-0.34, 3.36, 1.7], scale: [0.14, 0.14, 0.14], color: eye }));
  p.push(part(G.ico0, { pos: [0.34, 3.36, 1.7], scale: [0.14, 0.14, 0.14], color: eye }));
  // scythe arms
  for (let s = -1; s <= 1; s += 2) {
    p.push(part(G.ico0, { pos: [s * 1.5, 3.0, 0.4], scale: [0.5, 0.5, 0.5], color: plate }));
    p.push(part(G.box, { pos: [s * 1.9, 2.3, 0.7], rot: [0.3, 0, s * 0.3], scale: [0.34, 1.5, 0.36], color: hide }));
    p.push(part(G.cone, { pos: [s * 2.2, 1.2, 1.3], rot: [Math.PI * 0.7, 0, s * 0.3], scale: [0.16, 1.5, 0.16], color: bone }));
  }
  // four thick legs
  for (let i = 0; i < 2; i++) {
    for (let s = -1; s <= 1; s += 2) {
      const z = 0.4 - i * 1.5;
      p.push(part(G.box, { pos: [s * 1.1, 2.0, z], rot: [0, 0, s * 0.5], scale: [1.2, 0.3, 0.34], color: plate }));
      p.push(part(G.box, { pos: [s * 1.7, 1.0, z], rot: [0, 0, s * -0.12], scale: [0.34, 1.9, 0.34], color: hide }));
      p.push(part(G.box, { pos: [s * 1.8, 0.1, z + 0.2], scale: [0.4, 0.22, 0.7], color: bone }));
    }
  }
  // Crown, segmented abdomen and visible reactor-like brood organs.
  for (let i = 0; i < 5; i++) {
    const z = -0.35 - i * 0.59;
    const r = 1.22 - i * 0.1;
    p.push(part(G.ico0, { pos: [0, 2.78 - i * 0.16, z], scale: [r, 0.36, 0.43], color: plate }));
    for (const s of [-1, 1]) {
      p.push(part(G.oct, { pos: [s * r, 2.3 - i * 0.13, z], scale: [0.16, 0.3, 0.24], color: 0xff7199 }));
      p.push(part(G.cone, { pos: [s * r, 3.13 - i * 0.18, z], rot: [-0.4, 0, -s * 0.45], scale: [0.09, 0.66, 0.1], color: bone }));
    }
  }
  p.push(part(G.oct, { pos: [0, 3.76, 1.54], scale: [0.28, 0.43, 0.12], color: 0xff8db2 }));
  const geometry = mergeParts(p);
  geometry.scale(1.1, 1.3, 1.1);
  geometry.computeBoundingSphere();
  return geometry;
}

function buildSiege() {
  const p = [];
  const shell = 0x334149, armor = 0x9c7050, dark = 0x182b36, core = 0xffae43;
  // A tall, broad four-legged siege engine. Its feet fit a six-unit corridor;
  // the elevated shoulders supply scale without increasing collision width.
  p.push(part(G.box, { pos: [0, 2.85, 0], scale: [2.7, 2.5, 2.6], color: shell }));
  p.push(part(G.box, { pos: [0, 4.05, -0.22], scale: [3.1, 0.72, 2.4], color: armor }));
  p.push(part(G.box, { pos: [0, 3.1, 1.4], rot: [-0.16, 0, 0], scale: [2.05, 1.9, 0.42], color: armor }));
  p.push(part(G.box, { pos: [0, 3.4, 1.68], scale: [1.35, 0.2, 0.1], color: core }));
  p.push(part(G.box, { pos: [0, 2.5, 1.67], scale: [0.74, 0.7, 0.18], color: dark }));
  p.push(part(G.oct, { pos: [0, 2.48, 1.83], scale: [0.37, 0.35, 0.13], color: core }));
  for (const s of [-1, 1]) {
    p.push(part(G.box, { pos: [s * 1.85, 3.4, 0], scale: [1.0, 1.5, 1.8], color: armor }));
    p.push(part(G.box, { pos: [s * 2.0, 2.0, 0.65], scale: [0.88, 1.9, 1.0], color: shell }));
    p.push(part(G.box, { pos: [s * 2.0, 0.94, 1.0], scale: [1.06, 0.72, 1.32], color: dark }));
    p.push(part(G.box, { pos: [s * 2.0, 1.02, 1.72], scale: [0.87, 0.22, 0.15], color: core }));
    p.push(part(G.box, { pos: [s * 1.04, 0.7, -0.9], scale: [0.8, 1.3, 1.0], color: armor }));
    p.push(part(G.box, { pos: [s * 1.04, 0.16, -0.75], scale: [0.96, 0.32, 1.45], color: dark }));
    // Armoured exhaust stacks make its back recognisable from any angle.
    p.push(part(G.box, { pos: [s * 0.88, 4.78, -0.63], scale: [0.54, 1.7, 0.62], color: dark }));
    p.push(part(G.box, { pos: [s * 0.88, 5.56, -0.63], scale: [0.61, 0.17, 0.68], color: core }));
    for (let i = 0; i < 4; i++) {
      p.push(part(G.box, { pos: [s * 1.88, 3.88 - i * 0.3, 0.96], scale: [0.77, 0.12, 0.11], color: i % 2 ? dark : core }));
      p.push(part(G.box, { pos: [s * 0.73, 3.75 - i * 0.38, -1.36], scale: [0.42, 0.13, 0.08], color: core }));
    }
  }
  return mergeParts(p);
}

/* The Overmind: the hive fused into the reactor it captured. Architectural
   rather than insectoid, so the finale does not read as a bigger Queen —
   anchored to the floor, built around a core that is visibly exposed on one
   side. The broken flank is deliberate: the fight ends by shooting the thing
   the silhouette has been pointing at from the first second. */
function buildOvermind() {
  const p = [];
  const shell = 0x2b3a30, plate = 0x55684a, bone = 0xd9d2a8;
  const core = 0xc6ff4a, sac = 0x9a4fd8, hot = 0xffd24a;

  // anchor claws: it grew into the floor and does not walk so much as drag
  for (let i = 0; i < 6; i++) {
    const a = i / 6 * TAU + 0.26;
    p.push(part(G.box, {
      pos: [Math.sin(a) * 1.85, 0.42, Math.cos(a) * 1.85], rot: [0, -a, 0.22],
      scale: [0.46, 0.7, 2.3], color: shell
    }));
    p.push(part(G.cone, {
      pos: [Math.sin(a) * 2.85, 0.22, Math.cos(a) * 2.85], rot: [Math.PI * 0.62, -a, 0],
      scale: [0.2, 1.15, 0.2], color: bone
    }));
  }
  p.push(part(G.cyl, { pos: [0, 0.55, 0], scale: [1.95, 1.1, 1.95], color: plate }));

  // segmented column, narrowing as it rises
  for (let i = 0; i < 4; i++) {
    const r = 1.5 - i * 0.2;
    p.push(part(G.cyl, { pos: [0, 1.35 + i * 0.86, 0], scale: [r, 0.52, r], color: i % 2 ? shell : plate }));
    p.push(part(G.tor, { pos: [0, 1.62 + i * 0.86, 0], rot: [Math.PI / 2, 0, 0], scale: [r * 0.96, r * 0.96, 0.5], color: bone }));
  }

  /* The shell: plates all the way round except the +X flank, which is gone.
     The gap is the weak point and it is the only asymmetry in the model. */
  for (let i = 0; i < 12; i++) {
    const a = i / 12 * TAU;
    if (Math.sin(a) > 0.58) continue;
    p.push(part(G.box, {
      pos: [Math.sin(a) * 1.72, 2.95, Math.cos(a) * 1.72], rot: [0, -a, Math.sin(a) * 0.2],
      scale: [0.62, 1.95, 0.34], color: i % 3 === 0 ? plate : shell
    }));
    p.push(part(G.box, {
      pos: [Math.sin(a) * 1.78, 3.75, Math.cos(a) * 1.78], rot: [0, -a, 0],
      scale: [0.4, 0.12, 0.2], color: hot
    }));
  }
  // torn plate edges where the flank broke away
  for (const side of [-1, 1]) {
    p.push(part(G.cone, {
      pos: [1.25, 3.5 + side * 0.5, side * 1.05], rot: [0, 0.7, -1.1 - side * 0.35],
      scale: [0.16, 1.2, 0.3], color: bone
    }));
  }

  // the exposed core inside a broken cage of ribs
  p.push(part(G.sph, { pos: [0.28, 2.95, 0], scale: [1.02, 1.12, 1.02], color: core }));
  p.push(part(G.ico0, { pos: [0.58, 2.95, 0], scale: [0.62, 0.72, 0.62], color: hot }));
  for (let i = 0; i < 7; i++) {
    const a = -1.1 + i / 6 * 2.2;
    p.push(part(G.box, {
      pos: [Math.sin(a) * 1.28 - 0.1, 2.95, Math.cos(a) * 1.28], rot: [0, -a, 0],
      scale: [0.14, 2.3, 0.14], color: bone
    }));
  }

  // brood sacs clustered under the shell, the source of phase two
  for (let i = 0; i < 5; i++) {
    const a = i / 5 * TAU + 0.5;
    p.push(part(G.ico0, {
      pos: [Math.sin(a) * 1.15, 1.85 + (i % 2) * 0.4, Math.cos(a) * 1.15],
      scale: [0.44, 0.52, 0.44], color: sac
    }));
  }

  // crown of three spires
  for (let i = 0; i < 3; i++) {
    const a = i / 3 * TAU + 0.4;
    p.push(part(G.cone, {
      pos: [Math.sin(a) * 0.62, 5.15, Math.cos(a) * 0.62], rot: [Math.cos(a) * 0.22, 0, -Math.sin(a) * 0.22],
      scale: [0.19, 2.1, 0.19], color: plate
    }));
    p.push(part(G.oct, {
      pos: [Math.sin(a) * 0.86, 5.9, Math.cos(a) * 0.86],
      scale: [0.24, 0.38, 0.24], color: sac
    }));
  }
  p.push(part(G.ico1, { pos: [0, 4.5, 0], scale: [0.92, 0.72, 0.92], color: plate }));
  p.push(part(G.oct, { pos: [0.5, 4.55, 0.55], scale: [0.2, 0.28, 0.12], color: core }));
  p.push(part(G.oct, { pos: [-0.5, 4.55, 0.55], scale: [0.2, 0.28, 0.12], color: core }));

  // two grafted blade limbs, held high and back
  for (const side of [-1, 1]) {
    p.push(part(G.ico0, { pos: [side * 1.5, 4.1, -0.3], scale: [0.52, 0.52, 0.52], color: plate }));
    p.push(part(G.box, { pos: [side * 2.25, 3.55, -0.75], rot: [0.35, 0, side * 0.55], scale: [0.36, 2.0, 0.4], color: shell }));
    p.push(part(G.cone, { pos: [side * 2.75, 2.1, -0.1], rot: [Math.PI * 0.72, 0, side * 0.45], scale: [0.2, 2.1, 0.2], color: bone }));
  }

  const geometry = mergeParts(p);
  geometry.computeBoundingSphere();
  return geometry;
}

function buildWarden() {
  const p = [];
  const shell = 0x34426b, armor = 0xa6b8ce, dark = 0x17273e, core = 0x69fff0, violet = 0xb282f6;
  // Floating sentinel: a vertical diamond body, a broken halo and two low
  // cannons. Cyan geometry identifies the origin of its aimed energy shots.
  p.push(part(G.oct, { pos: [0, 3.0, 0], scale: [1.15, 2.05, 1.12], color: shell }));
  p.push(part(G.oct, { pos: [0, 3.55, 0.83], scale: [0.7, 1.05, 0.23], color: armor }));
  p.push(part(G.oct, { pos: [0, 3.55, 1.04], scale: [0.3, 0.6, 0.1], color: core }));
  p.push(part(G.box, { pos: [0, 4.65, 0], scale: [0.64, 0.58, 0.62], color: dark }));
  p.push(part(G.box, { pos: [0, 4.68, 0.35], scale: [0.48, 0.14, 0.08], color: core }));
  for (let i = 0; i < 10; i++) {
    const a = i / 10 * TAU;
    if (i === 0 || i === 5) continue;
    p.push(part(G.box, { pos: [Math.sin(a) * 1.63, 4.35 + Math.cos(a) * 1.38, -0.5], rot: [0, 0, -a], scale: [0.48, 0.26, 0.32], color: i % 2 ? violet : armor }));
    p.push(part(G.box, { pos: [Math.sin(a) * 1.63, 4.35 + Math.cos(a) * 1.38, -0.3], rot: [0, 0, -a], scale: [0.29, 0.1, 0.07], color: core }));
  }
  for (const s of [-1, 1]) {
    p.push(part(G.box, { pos: [s * 1.18, 3.05, 0], rot: [0, 0, s * 0.32], scale: [1.1, 0.36, 0.55], color: armor }));
    p.push(part(G.box, { pos: [s * 1.68, 2.23, 0.35], scale: [0.55, 1.43, 0.68], color: shell }));
    p.push(part(G.box, { pos: [s * 1.68, 1.5, 1.12], scale: [0.72, 0.6, 1.7], color: armor }));
    p.push(part(G.box, { pos: [s * 1.68, 1.5, 2.03], scale: [0.52, 0.4, 0.15], color: dark }));
    p.push(part(G.box, { pos: [s * 1.68, 1.5, 2.13], scale: [0.27, 0.22, 0.08], color: core }));
    p.push(part(G.cone, { pos: [s * 0.63, 0.85, -0.2], rot: [Math.PI, 0, s * 0.3], scale: [0.23, 1.1, 0.32], color: violet }));
    for (let i = 0; i < 3; i++) {
      p.push(part(G.box, { pos: [s * 1.68, 1.85, 0.68 + i * 0.38], scale: [0.78, 0.09, 0.14], color: core }));
    }
  }
  p.push(part(G.oct, { pos: [0, 1.07, 0], scale: [0.34, 0.43, 0.34], color: core }));
  return mergeParts(p);
}

/* ------------------------------------------------------------------
   Player — a human trooper assembled from a customization config
   (see loadLook / LOOK_OPTIONS in 45-customize.js). Kept as a Group
   so limbs can animate independently.
   ------------------------------------------------------------------ */
function buildPlayer(look) {
  look = look || LOOK_DEFAULTS;
  const root = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.57, metalness: 0.25, flatShading: false });
  // Author the rig in its existing character coordinates, then turn the
  // whole upper body around the waist. Shoulders and weapon move together.
  const upperBody = new THREE.Group(), poseRoot = new THREE.Group();
  upperBody.position.y = 1.02; poseRoot.position.y = -1.02;
  upperBody.add(poseRoot); root.add(upperBody);

  // deliberately lighter than anything in the alien palette: in a dark
  // facility the player has to be the most readable thing on screen
  const skin = look.skin;
  const hair = look.hairColor;
  const top = look.jacket;
  const topDark = shade(look.jacket, 0.72);
  const pants = look.pants;
  const boot = 0x272d38;
  const accentColor = look.accent === undefined ? 0x70eeff : look.accent;
  const helmet = look.helmet || 'none';
  const shoulders = look.shoulders || 'standard';

  const torsoParts = [
    part(G.body, { pos: [0, 1.15, 0], scale: [0.62, 0.66, 0.42], color: top }),
    part(G.body, { pos: [0, 1.42, 0], scale: [0.7, 0.16, 0.48], color: topDark }),
    // shoulders
    part(G.body, { pos: [-0.36, 1.36, 0], scale: [0.18, 0.2, 0.4], color: topDark }),
    part(G.body, { pos: [0.36, 1.36, 0], scale: [0.18, 0.2, 0.4], color: topDark }),
    // Chest telemetry remains part of the torso across all cosmetic rigs.
    part(G.body, { pos: [0, 1.28, 0.315], scale: [0.21, 0.09, 0.035], color: 0x152937 }),
    part(G.body, { pos: [0, 1.28, 0.337], scale: [0.16, 0.028, 0.012], color: accentColor }),
    part(G.body, { pos: [0, 0.86, 0.015], scale: [0.68, 0.13, 0.46], color: boot }),
    part(G.body, { pos: [0, 0.86, 0.255], scale: [0.13, 0.075, 0.055], color: 0xe5a744 })
  ];
  if (look.backpack !== false) {
    torsoParts.push(
      part(G.body, { pos: [0, 1.1, -0.32], scale: [0.46, 0.54, 0.29], color: topDark }),
      part(G.body, { pos: [0, 1.16, -0.485], scale: [0.1, 0.39, 0.04], color: accentColor })
    );
    for (const s of [-1, 1]) {
      torsoParts.push(part(G.body, { pos: [s * 0.19, 1.12, -0.43], scale: [0.13, 0.57, 0.16], color: 0x8394a5 }));
      torsoParts.push(part(G.body, { pos: [s * 0.19, 0.88, -0.44], scale: [0.1, 0.07, 0.18], color: accentColor }));
    }
  }
  for (const s of [-1, 1]) {
    const heavy = shoulders === 'heavy', light = shoulders === 'light';
    const width = heavy ? 0.38 : light ? 0.17 : 0.25;
    torsoParts.push(part(G.body, { pos: [s * (heavy ? 0.4 : 0.37), 1.46, 0], rot: [0, 0, -s * 0.16], scale: [width, heavy ? 0.27 : 0.13, light ? 0.31 : 0.48], color: heavy ? shade(top, 1.25) : 0xc0ced5 }));
    torsoParts.push(part(G.body, { pos: [s * (heavy ? 0.43 : 0.4), heavy ? 1.615 : 1.54, 0.04], scale: [heavy ? 0.21 : 0.065, 0.025, light ? 0.14 : 0.26], color: accentColor }));
    if (heavy) torsoParts.push(part(G.body, { pos: [s * 0.55, 1.3, 0.04], scale: [0.12, 0.23, 0.34], color: 0x4a6070 }));
  }
  if (look.vest) {
    const vc = look.vestColor, vd = shade(look.vestColor, 0.65);
    // plate carrier over the jacket
    torsoParts.push(
      part(G.body, { pos: [0, 1.18, 0.22], scale: [0.56, 0.5, 0.14], color: vc }),
      part(G.body, { pos: [0, 1.32, 0.21], scale: [0.62, 0.12, 0.12], color: vd }),
      part(G.body, { pos: [-0.16, 1.0, 0.28], scale: [0.16, 0.14, 0.1], color: vd }),
      part(G.body, { pos: [0.16, 1.0, 0.28], scale: [0.16, 0.14, 0.1], color: vd })
    );
  }
  const torsoMesh = new THREE.Mesh(mergeParts(torsoParts), mat);
  torsoMesh.castShadow = true;
  poseRoot.add(torsoMesh);

  // head: bare skin so hair and face read as human, not a robot
  const headParts = [
    part(G.sph, { pos: [0, 0, 0], scale: [0.2, 0.23, 0.21], color: skin }),
    // face
    part(G.ico0, { pos: [-0.07, 0.02, 0.185], scale: [0.032, 0.028, 0.02], color: 0x14181e }),
    part(G.ico0, { pos: [0.07, 0.02, 0.185], scale: [0.032, 0.028, 0.02], color: 0x14181e })
  ];
  if (helmet === 'none' && look.hairStyle === 'short') {
    headParts.push(
      part(G.sph, { pos: [0, 0.05, -0.02], scale: [0.21, 0.2, 0.22], color: hair }),
      part(G.body, { pos: [0, -0.02, -0.16], scale: [0.3, 0.16, 0.1], color: hair })
    );
  } else if (helmet === 'none' && look.hairStyle === 'mohawk') {
    headParts.push(
      part(G.body, { pos: [0, 0.18, -0.03], scale: [0.07, 0.14, 0.34], color: hair })
    );
  } else if (helmet === 'none' && look.hairStyle === 'long') {
    headParts.push(
      part(G.sph, { pos: [0, 0.05, -0.02], scale: [0.21, 0.2, 0.22], color: hair }),
      part(G.body, { pos: [0, -0.16, -0.12], scale: [0.3, 0.42, 0.14], color: hair })
    );
  } else if (helmet === 'none' && look.hairStyle === 'buzz') {
    headParts.push(
      part(G.sph, { pos: [0, 0.04, -0.02], scale: [0.205, 0.215, 0.215], color: shade(hair, 0.85) })
    );
  }
  // A monocular visor leaves the selected face and hairstyle visible.
  headParts.push(
    part(G.body, { pos: [0.18, 0.01, 0.025], scale: [0.09, 0.13, 0.17], color: 0x354b60 }),
    part(G.body, { pos: [0.1, 0.015, 0.211], scale: [0.16, 0.082, 0.032], color: accentColor }),
    part(G.body, { pos: [0.21, 0.13, -0.03], scale: [0.025, 0.18, 0.025], color: 0x8496a6 })
  );
  if (helmet === 'tactical') {
    headParts.push(
      part(G.body, { pos: [0, 0.09, -0.02], scale: [0.46, 0.34, 0.44], color: shade(top, 0.8) }),
      part(G.body, { pos: [0, 0.027, 0.235], scale: [0.39, 0.14, 0.07], color: accentColor }),
      part(G.body, { pos: [0, -0.13, 0.19], scale: [0.4, 0.16, 0.2], color: 0x354757 }),
      part(G.body, { pos: [0, 0.28, -0.025], scale: [0.11, 0.055, 0.36], color: 0xaab8c4 })
    );
    for (const s of [-1, 1]) headParts.push(part(G.body, { pos: [s * 0.25, -0.04, 0.06], scale: [0.09, 0.2, 0.24], color: 0x7a8fa3 }));
  } else if (helmet === 'recon') {
    headParts.push(
      part(G.body, { pos: [0, 0.145, -0.04], scale: [0.43, 0.2, 0.4], color: 0x768899 }),
      part(G.body, { pos: [0, 0.13, 0.23], scale: [0.46, 0.075, 0.2], color: 0x354757 }),
      part(G.body, { pos: [0.25, 0.15, -0.06], scale: [0.12, 0.16, 0.26], color: 0x243c50 }),
      part(G.body, { pos: [0.25, 0.15, 0.09], scale: [0.083, 0.095, 0.035], color: accentColor }),
      part(G.body, { pos: [-0.22, 0.29, -0.1], scale: [0.024, 0.31, 0.024], color: 0x91a1ac })
    );
  }
  const headMesh = new THREE.Mesh(mergeParts(headParts), mat);
  headMesh.position.set(0, 1.62, 0.02);
  headMesh.castShadow = true;
  poseRoot.add(headMesh);

  const legGeo = mergeParts([
    part(G.body, { pos: [0, -0.26, 0], scale: [0.22, 0.52, 0.24], color: pants }),
    part(G.body, { pos: [0, -0.42, 0.02], scale: [0.23, 0.14, 0.25], color: shade(pants, 0.7) }),
    part(G.body, { pos: [0, -0.55, 0.05], scale: [0.24, 0.14, 0.36], color: boot }),
    part(G.body, { pos: [0, -0.29, 0.14], scale: [0.21, 0.2, 0.09], color: 0x778795 }),
    part(G.body, { pos: [0, -0.31, 0.192], scale: [0.1, 0.03, 0.016], color: accentColor })
  ]);
  const legL = new THREE.Mesh(legGeo, mat);
  legL.position.set(-0.17, 0.82, 0);
  legL.castShadow = true;
  const legR = new THREE.Mesh(legGeo, mat);
  legR.position.set(0.17, 0.82, 0);
  legR.castShadow = true;
  root.add(legL, legR);

  // Unit-length segments are posed between real shoulder/elbow/wrist joints.
  // Both sides share their geometry; the groups preserve the public rig API.
  const upperGeo = mergeParts([
    part(G.body, { pos: [0, 0.5, 0], scale: [0.17, 1, 0.19], color: top }),
    part(G.body, { pos: [0, 0.26, -0.035], scale: [0.2, 0.32, 0.2], color: topDark })
  ]);
  const forearmGeo = mergeParts([
    part(G.body, { pos: [0, 0.5, 0], scale: [0.155, 1, 0.17], color: top }),
    part(G.body, { pos: [0, 0.48, -0.085], scale: [0.185, 0.55, 0.075], color: 0x778795 }),
    part(G.body, { pos: [0, 0.52, -0.13], scale: [0.085, 0.16, 0.018], color: accentColor }),
    part(G.body, { pos: [0, 0.91, 0], scale: [0.17, 0.15, 0.18], color: boot })
  ]);
  const gloveGeo = mergeParts([
    part(G.body, { pos: [0.054, 0, 0], scale: [0.075, 0.14, 0.16], color: 0x283645 }),
    part(G.body, { pos: [-0.025, -0.045, 0.025], scale: [0.105, 0.045, 0.17], color: 0x344859 }),
    part(G.body, { pos: [-0.051, 0.012, 0.047], scale: [0.043, 0.11, 0.115], color: 0x344859 }),
    part(G.body, { pos: [0.045, 0.074, 0.045], rot: [0, 0, -0.35], scale: [0.055, 0.043, 0.1], color: 0x647585 })
  ]);
  const makeArm = (side) => {
    const group = new THREE.Group();
    const upper = new THREE.Mesh(upperGeo, mat);
    const forearm = new THREE.Mesh(forearmGeo, mat);
    const hand = new THREE.Mesh(gloveGeo, mat);
    hand.scale.x = side;
    upper.castShadow = forearm.castShadow = hand.castShadow = true;
    group.add(upper, forearm, hand);
    return { group, upper, forearm, hand, side,
      shoulder: new THREE.Vector3(side * 0.36, 1.33, 0.025),
      elbow: new THREE.Vector3(), upperLength: 0.42, forearmLength: 0.45 };
  };
  const rigL = makeArm(-1), rigR = makeArm(1);
  const armL = rigL.group, armR = rigR.group;
  poseRoot.add(armL, armR);

  const weaponPivot = new THREE.Group();
  weaponPivot.position.set(0.2, 1.2, 0.1);
  poseRoot.add(weaponPivot);

  return {
    root: root,
    upperBody: upperBody,
    poseRoot: poseRoot,
    meleePose: {},
    head: headMesh,
    torso: torsoMesh,
    legL: legL, legR: legR,
    armL: armL, armR: armR,
    rigL: rigL, rigR: rigR,
    handL: rigL.hand, handR: rigR.hand,
    gripTarget: new THREE.Vector3(), supportTarget: new THREE.Vector3(),
    weaponPivot: weaponPivot,
    material: mat
  };
}

const _poseMatrix = new THREE.Matrix4();
const _poseDir = new THREE.Vector3();
const _posePole = new THREE.Vector3();
const _poseShoulder = new THREE.Vector3();
const _poseUp = new THREE.Vector3(0, 1, 0);
const _poseHandQuat = new THREE.Quaternion();
const _poseLeftQuat = new THREE.Quaternion();
const _poseHandTurn = new THREE.Quaternion();
const _poseZ = new THREE.Vector3(0, 0, 1);
const _poseGuardEuler = new THREE.Euler(-0.12, 0.15, -0.15);
const _emptyWeaponPoseState = {};
const _defaultWeaponPose = {
  hold: [0.13, 1.3, 0.42], grip: [0, -0.13, 0],
  support: [-0.075, -0.12, 0.015], reload: [-0.025, -0.22, 0]
};

function poseArmSegment(mesh, start, end) {
  _poseDir.subVectors(end, start);
  const length = Math.max(0.001, _poseDir.length());
  mesh.position.copy(start);
  mesh.scale.set(1, length, 1);
  mesh.quaternion.setFromUnitVectors(_poseUp, _poseDir.multiplyScalar(1 / length));
}

function solvePlayerArm(rig, target, handRotation, bob) {
  _poseShoulder.copy(rig.shoulder);
  _poseShoulder.y += bob;
  _poseDir.subVectors(target, _poseShoulder);
  const rawDistance = Math.max(0.001, _poseDir.length());
  _poseDir.multiplyScalar(1 / rawDistance);
  const a = rig.upperLength, b = rig.forearmLength;
  const distance = clamp(rawDistance, Math.abs(a - b) + 0.002, a + b - 0.002);
  // Pole vectors keep elbows naturally below/outside the weapon, including
  // crossing the support hand over to the receiver during a reload.
  _posePole.set(rig.side * 0.58, -0.85, -0.18);
  _posePole.addScaledVector(_poseDir, -_posePole.dot(_poseDir)).normalize();
  const along = (a * a - b * b + distance * distance) / (2 * distance);
  const bend = Math.sqrt(Math.max(0, a * a - along * along));
  rig.elbow.copy(_poseShoulder).addScaledVector(_poseDir, along).addScaledVector(_posePole, bend);
  poseArmSegment(rig.upper, _poseShoulder, rig.elbow);
  poseArmSegment(rig.forearm, rig.elbow, target);
  rig.hand.position.copy(target);
  rig.hand.quaternion.copy(handRotation);
}

// Stateless sampling keeps the rendered stroke tied to combat's actual
// windup/contact/recovery windows, independent of frame rate or networking.
// This helper deliberately has no dependency on the combat runtime.
function sampleMeleePose(weapon, progress, heavy, output) {
  const out = output || {}, values = out.values || (out.values = new Float32Array(10));
  values.fill(0); out.phase = null; out.phaseProgress = 0;
  const presentation = weapon.pose && weapon.pose.presentation;
  if (!presentation) return out;
  const spec = heavy && weapon.heavy || weapon;
  const windup = spec.windup ?? weapon.windup, active = spec.activeTime ?? weapon.activeTime;
  const recovery = spec.recovery ?? weapon.recovery, total = windup + active + recovery;
  const age = clamp(progress || 0, 0, 1) * total;
  out.total = total;
  if (!(age > 0) || age >= total) return out;
  const profile = heavy ? presentation.heavy : presentation.light;
  let from = null, to = null, t;
  if (age < windup) { out.phase = 'windup'; to = profile[0]; t = age / windup; }
  else if (age < windup + active) { out.phase = 'active'; from = profile[0]; to = profile[1]; t = (age - windup) / active; }
  else { out.phase = 'recovery'; from = profile[1]; t = (age - windup - active) / recovery; }
  out.phaseProgress = t;
  const blend = t * t * (3 - 2 * t);
  for (let i = 0; i < values.length; i++) values[i] = lerp(from ? from[i] : 0, to ? to[i] : 0, blend);
  return out;
}

/* Shared by the live marine and the character preview. Sockets are authored
   in unscaled weapon coordinates; hands follow the exact rendered transform. */
function posePlayerWeapon(model, weapon, weaponMesh, state) {
  state = state || _emptyWeaponPoseState;
  const pose = weapon.pose || _defaultWeaponPose;
  const move = clamp(state.movement || 0, 0, 1);
  const phase = state.phase || 0;
  const bob = state.bob || 0;
  const aim = state.aiming ? 1 : 0;
  const kick = clamp(state.recoil || 0, 0, 0.55);
  const reload = state.reloadProgress === undefined || state.reloadProgress < 0
    ? 0 : Math.sin(clamp(state.reloadProgress, 0, 1) * Math.PI);
  const pivot = model.weaponPivot;
  pivot.position.set(pose.hold[0], pose.hold[1] + bob + aim * 0.045 - reload * 0.08,
    pose.hold[2] - kick * 0.14);
  pivot.rotation.set(-kick * 0.4 + reload * 0.18,
    Math.sin(phase) * move * (aim ? 0.009 : 0.023), -reload * (pose.heavy ? 0.08 : 0.2));
  weaponMesh.rotation.set(0, 0, 0);
  const attack = clamp(state.attackProgress || 0, 0, 1);
  const meleePose = sampleMeleePose(weapon, attack, !!state.heavyAttack, model.meleePose);
  const stroke = meleePose.values;
  if (model.upperBody) {
    model.upperBody.position.set(0, 1.02, stroke[9]);
    model.upperBody.rotation.set(stroke[6], stroke[7], stroke[8]);
    model.head.rotation.y = -stroke[7] * 0.55;
  }
  if (pose.melee && pose.presentation) {
    const ready = pose.presentation.ready;
    pivot.position.x += stroke[0]; pivot.position.y += stroke[1]; pivot.position.z += stroke[2];
    pivot.rotation.x += ready[0] + stroke[3]; pivot.rotation.y += ready[1] + stroke[4]; pivot.rotation.z += ready[2] + stroke[5];
  }
  pivot.updateMatrix();
  weaponMesh.updateMatrix();
  _poseMatrix.multiplyMatrices(pivot.matrix, weaponMesh.matrix);
  model.gripTarget.fromArray(pose.grip).applyMatrix4(_poseMatrix);
  model.supportTarget.fromArray(pose.support);
  if (reload > 0 && pose.reload) {
    model.supportTarget.x = lerp(model.supportTarget.x, pose.reload[0], reload);
    model.supportTarget.y = lerp(model.supportTarget.y, pose.reload[1], reload);
    model.supportTarget.z = lerp(model.supportTarget.z, pose.reload[2], reload);
  }
  model.supportTarget.applyMatrix4(_poseMatrix);
  // A knife or one-handed blade leaves the other hand guarding the body;
  // attaching it to the blade would stretch the arm during a thrust.
  if (pose.oneHanded) model.supportTarget.set(-0.3, 1.12 + bob + Math.max(0, -stroke[3]) * 0.035, 0.3);
  _poseHandQuat.copy(pivot.quaternion).multiply(weaponMesh.quaternion);
  _poseLeftQuat.copy(_poseHandQuat).multiply(_poseHandTurn.setFromAxisAngle(_poseZ, pose.supportRoll || 0));
  if (pose.oneHanded) _poseLeftQuat.setFromEuler(_poseGuardEuler);
  solvePlayerArm(model.rigR, model.gripTarget, _poseHandQuat, bob);
  solvePlayerArm(model.rigL, model.supportTarget, _poseLeftQuat, bob);
  for (const piece of (weaponMesh.userData.weaponParts || [])) {
    if (piece.name === 'barrelRotor') continue;
    piece.position.copy(piece.userData.rest); piece.rotation.set(0, 0, 0);
    if (piece.name === 'magazine') { piece.position.y -= reload * 0.32; piece.rotation.z = reload * 0.28; }
    else if (piece.name === 'bolt') piece.position.z -= kick * 0.34 + (weapon.reloadStyle === 'bolt' ? reload * 0.13 : 0);
    else if (piece.name === 'pump') piece.position.z -= kick * 0.24 + reload * 0.04;
    else if (piece.name === 'cylinder') { piece.position.x -= reload * 0.14; piece.rotation.z = (state.reloadProgress > 0 ? state.reloadProgress : 0) * TAU; }
    else if (piece.name === 'breakBarrels') piece.rotation.x = reload * 0.55;
    else if (piece.name === 'bowString') { piece.position.z += reload * 0.19; piece.scale.x = 1 - reload * 0.08; }
  }
  const rotor = weaponMesh.userData.barrelRotor;
  if (rotor) rotor.rotation.z = (rotor.rotation.z + (state.spin || 0) * (state.dt || 0) * 26) % TAU;
}

function configureWeaponModel(mesh, weapon, material) {
  for (const child of (mesh.userData.weaponParts || [])) mesh.remove(child);
  if (mesh.userData.barrelRotor) mesh.remove(mesh.userData.barrelRotor);
  mesh.userData.weaponParts = []; mesh.userData.barrelRotor = null;
  mesh.material = WEAPON_MATERIAL || material;
  mesh.rotation.set(0, 0, 0);
  const add = (name, geo, x, y, z) => {
    if (!geo) return;
    const piece = new THREE.Mesh(geo, mesh.material); piece.name = name;
    piece.position.set(x, y, z); piece.userData.rest = piece.position.clone();
    piece.castShadow = true; piece.renderOrder = mesh.renderOrder;
    mesh.add(piece); mesh.userData.weaponParts.push(piece); return piece;
  };
  if (weapon.id === 'minigun') mesh.userData.barrelRotor = add('barrelRotor', WEAPON_MOVING_GEO.minigun, 0, 0, 0);
  if (weapon.id === 'spear') {
    const core = add('energyInlay', WEAPON_PART_GEO.spearCore, 0, 0, 0);
    if (core) core.material = MELEE_ENERGY_MATERIAL;
  }
  if (weapon.fire !== 'melee') {
    const reload = weapon.reloadStyle || (weapon.shellReload ? 'pump' : 'magazine');
    if (reload === 'cylinder') add('cylinder', WEAPON_PART_GEO.cylinder, 0, 0.025, 0.2);
    else if (reload === 'pump') add('pump', WEAPON_PART_GEO.pump, 0, -0.045, 0.48);
    else if (reload === 'break') add('breakBarrels', WEAPON_PART_GEO.breakBarrels, 0, 0.04, 0.33);
    else if (weapon.id === 'crossbow') add('bowString', WEAPON_PART_GEO.bowString, 0, 0.02, 0.43);
    else if (weapon.ammo !== 'rocket' && weapon.ammo !== 'fuel') {
      const socket = weapon.pose.reload || weapon.pose.support;
      add('magazine', WEAPON_PART_GEO[reload === 'belt' ? 'boxMagazine' : 'magazine'], socket[0], socket[1], socket[2]);
    }
    add('bolt', WEAPON_PART_GEO.bolt, 0.065, 0.035, 0.15);
  }
}

/* ------------------------------------------------------------------
   Weapon models, held at the player's weapon pivot (+Z = muzzle).
   ------------------------------------------------------------------ */
const WEAPON_GEO = {};
const WEAPON_MOVING_GEO = {};
const WEAPON_PART_GEO = {};
let WEAPON_MATERIAL = null;
let MELEE_ENERGY_MATERIAL = null;
function buildWeaponGeometries() {
  // Small machined bevels catch the key light at native resolution; authored
  // dimensions stay identical to the unit box used by all weapon sockets.
  if (!G.weaponBox) {
    const outline = new THREE.Shape();
    outline.moveTo(-0.42, -0.42); outline.lineTo(0.42, -0.42); outline.lineTo(0.42, 0.42);
    outline.lineTo(-0.42, 0.42); outline.closePath();
    G.weaponBox = new THREE.ExtrudeGeometry(outline, { depth: 0.84, steps: 1,
      bevelEnabled: true, bevelThickness: 0.08, bevelSize: 0.08, bevelSegments: 2, curveSegments: 1 });
    G.weaponBox.translate(0, 0, -0.42);
  }
  const metal = 0x3a4048, dark = 0x1b1f25, grip = 0x2a2118, hot = 0xb8620f, brass = 0xb08d3a;
  const accent = 0x66d9ff;   // tritium sights / status LEDs, reads as emissive

  WEAPON_GEO.pistol = mergeParts([
    part(G.weaponBox, { pos: [0, 0, 0.16], scale: [0.08, 0.13, 0.42], color: metal }),
    part(G.weaponBox, { pos: [0, -0.13, 0.0], scale: [0.08, 0.24, 0.13], color: grip }),
    part(G.weaponBox, { pos: [0, 0.03, 0.4], scale: [0.05, 0.05, 0.16], color: dark }),
    // slide serrations + sights
    part(G.weaponBox, { pos: [0, 0.08, 0.1], scale: [0.084, 0.03, 0.18], color: dark }),
    part(G.weaponBox, { pos: [0, 0.1, 0.33], scale: [0.02, 0.03, 0.02], color: accent }),
    part(G.weaponBox, { pos: [0, 0.1, 0.02], scale: [0.05, 0.03, 0.02], color: dark }),
    part(G.weaponBox, { pos: [0, -0.02, 0.06], scale: [0.03, 0.05, 0.1], color: dark })
  ]);

  WEAPON_GEO.shotgun = mergeParts([
    part(G.weaponBox, { pos: [0, 0, 0.38], scale: [0.11, 0.13, 0.85], color: dark }),
    part(G.cyl, { pos: [0, 0.04, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.055, 0.7, 0.055], color: metal }),
    // tube magazine under the barrel + pump ridges
    part(G.cyl, { pos: [0, -0.05, 0.55], rot: [Math.PI / 2, 0, 0], scale: [0.045, 0.58, 0.045], color: 0x2e343c }),
    part(G.weaponBox, { pos: [0, -0.05, 0.2], scale: [0.09, 0.09, 0.3], color: 0x4a3524 }),
    part(G.weaponBox, { pos: [0, -0.09, 0.2], scale: [0.1, 0.03, 0.3], color: 0x33261a }),
    part(G.weaponBox, { pos: [0, -0.14, -0.02], scale: [0.09, 0.22, 0.14], color: grip }),
    part(G.weaponBox, { pos: [0.1, -0.02, -0.17], scale: [0.09, 0.16, 0.17], color: 0x4a3524 }),
    part(G.weaponBox, { pos: [0.05, -0.02, -0.075], rot: [0, -0.59, 0], scale: [0.065, 0.12, 0.18], color: dark }),
    // front + rear sights
    part(G.weaponBox, { pos: [0, 0.1, 0.78], scale: [0.02, 0.035, 0.02], color: accent }),
    part(G.weaponBox, { pos: [0, 0.09, 0.02], scale: [0.05, 0.03, 0.02], color: dark })
  ]);

  WEAPON_GEO.smg = mergeParts([
    part(G.weaponBox, { pos: [0, 0, 0.2], scale: [0.1, 0.16, 0.5], color: metal }),
    part(G.cyl, { pos: [0, 0.03, 0.5], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.32, 0.035], color: dark }),
    // suppressor shroud for a distinct silhouette
    part(G.cyl, { pos: [0, 0.03, 0.66], rot: [Math.PI / 2, 0, 0], scale: [0.055, 0.16, 0.055], color: 0x2e343c }),
    part(G.weaponBox, { pos: [0, -0.22, 0.06], scale: [0.07, 0.34, 0.11], color: dark }),
    part(G.weaponBox, { pos: [0, -0.13, -0.06], scale: [0.08, 0.2, 0.12], color: grip }),
    part(G.weaponBox, { pos: [0, 0.1, 0.1], scale: [0.05, 0.06, 0.2], color: dark }),
    // foregrip + side rail + sight dot
    part(G.weaponBox, { pos: [0, -0.1, 0.12], rot: [0.35, 0, 0], scale: [0.07, 0.16, 0.08], color: grip }),
    part(G.weaponBox, { pos: [0.055, 0.02, 0.24], scale: [0.015, 0.03, 0.22], color: dark }),
    part(G.weaponBox, { pos: [0, 0.14, 0.18], scale: [0.02, 0.025, 0.02], color: accent })
  ]);

  WEAPON_GEO.rifle = mergeParts([
    part(G.weaponBox, { pos: [0, 0, 0.3], scale: [0.09, 0.15, 0.8], color: metal }),
    part(G.cyl, { pos: [0, 0.02, 0.7], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.5, 0.035], color: dark }),
    // carry handle / optic rail with a glowing dot sight
    part(G.weaponBox, { pos: [0, 0.12, 0.24], scale: [0.05, 0.08, 0.34], color: dark }),
    part(G.weaponBox, { pos: [0, 0.19, 0.2], scale: [0.06, 0.06, 0.14], color: 0x2e343c }),
    part(G.ico0, { pos: [0, 0.19, 0.28], scale: [0.022, 0.022, 0.022], color: accent }),
    part(G.weaponBox, { pos: [0, -0.2, 0.12], scale: [0.08, 0.32, 0.16], color: dark }),
    part(G.weaponBox, { pos: [0, -0.12, -0.06], scale: [0.08, 0.2, 0.12], color: grip }),
    part(G.weaponBox, { pos: [0.1, -0.02, -0.2], scale: [0.09, 0.16, 0.18], color: dark }),
    part(G.weaponBox, { pos: [0.05, -0.02, -0.075], rot: [0, -0.59, 0], scale: [0.065, 0.12, 0.18], color: metal }),
    // handguard vents + angled foregrip
    part(G.weaponBox, { pos: [0, 0.02, 0.48], scale: [0.098, 0.06, 0.26], color: 0x2e343c }),
    part(G.weaponBox, { pos: [0, -0.1, 0.12], rot: [0.4, 0, 0], scale: [0.08, 0.16, 0.08], color: grip })
  ]);

  WEAPON_GEO.flamer = mergeParts([
    part(G.weaponBox, { pos: [0, 0, 0.24], scale: [0.13, 0.14, 0.56], color: 0x4a4234 }),
    part(G.cyl, { pos: [0, 0.02, 0.62], rot: [Math.PI / 2, 0, 0], scale: [0.075, 0.42, 0.075], color: dark }),
    part(G.tor, { pos: [0, 0.02, 0.78], rot: [0, 0, 0], scale: [0.09, 0.09, 0.09], color: hot }),
    // pilot flame glowing at the nozzle
    part(G.ico0, { pos: [0, 0.02, 0.86], scale: [0.03, 0.03, 0.03], color: 0xffd24a }),
    part(G.cyl, { pos: [-0.12, -0.02, 0.22], rot: [Math.PI / 2, 0, 0], scale: [0.11, 0.44, 0.11], color: 0x7a2a1e }),
    part(G.cyl, { pos: [0.12, -0.02, 0.22], rot: [Math.PI / 2, 0, 0], scale: [0.11, 0.44, 0.11], color: 0x7a2a1e }),
    // tank valves + pressure gauge
    part(G.cyl, { pos: [-0.12, 0.1, 0.03], scale: [0.03, 0.08, 0.03], color: brass }),
    part(G.cyl, { pos: [0.12, 0.1, 0.03], scale: [0.03, 0.08, 0.03], color: brass }),
    part(G.cyl, { pos: [0, 0.09, 0.16], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.03, 0.035], color: accent }),
    part(G.weaponBox, { pos: [0, -0.14, 0.02], scale: [0.08, 0.22, 0.13], color: grip })
  ]);

  WEAPON_GEO.minigun = mergeParts([
    part(G.weaponBox, { pos: [0, 0, 0.17], scale: [0.22, 0.24, 0.42], color: metal }),
    part(G.weaponBox, { pos: [-0.2, -0.04, 0.04], scale: [0.16, 0.3, 0.3], color: brass }),
    part(G.weaponBox, { pos: [0, -0.18, -0.06], scale: [0.09, 0.24, 0.14], color: grip }),
    // Crosswise carry handle matches the support-hand socket and grip roll.
    part(G.weaponBox, { pos: [0, 0.18, 0.12], scale: [0.3, 0.06, 0.08], color: dark }),
    part(G.weaponBox, { pos: [-0.12, 0.1, 0.12], scale: [0.055, 0.16, 0.08], color: metal }),
    part(G.weaponBox, { pos: [0.12, 0.1, 0.12], scale: [0.055, 0.16, 0.08], color: metal })
  ]);
  WEAPON_MOVING_GEO.minigun = mergeParts([
    part(G.cyl, { pos: [0, 0, 0.56], rot: [Math.PI / 2, 0, 0], scale: [0.085, 0.62, 0.085], color: dark }),
    part(G.cyl, { pos: [0, 0.09, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.7, 0.035], color: 0x78899b }),
    part(G.cyl, { pos: [0.08, -0.045, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.7, 0.035], color: 0x78899b }),
    part(G.cyl, { pos: [-0.08, -0.045, 0.6], rot: [Math.PI / 2, 0, 0], scale: [0.035, 0.7, 0.035], color: 0x78899b }),
    part(G.tor, { pos: [0, 0, 0.3], scale: [0.14, 0.14, 0.12], color: 0x2e343c }),
    part(G.tor, { pos: [0, 0, 0.88], scale: [0.12, 0.12, 0.08], color: hot })
  ]);

  WEAPON_GEO.rocket = mergeParts([
    part(G.cyl, { pos: [0, 0.03, 0.24], rot: [Math.PI / 2, 0, 0], scale: [0.11, 1.0, 0.11], color: 0x3f4a3a }),
    part(G.cyl, { pos: [0, 0.03, 0.74], rot: [Math.PI / 2, 0, 0], scale: [0.13, 0.14, 0.13], color: dark }),
    // warhead tip in warning orange
    part(G.cone, { pos: [0, 0.03, 0.88], rot: [Math.PI / 2, 0, 0], scale: [0.09, 0.16, 0.09], color: hot }),
    part(G.weaponBox, { pos: [0, 0.17, 0.1], scale: [0.06, 0.1, 0.4], color: dark }),
    part(G.weaponBox, { pos: [0, -0.14, -0.02], scale: [0.08, 0.22, 0.13], color: grip }),
    part(G.weaponBox, { pos: [0.14, 0.03, -0.2], scale: [0.12, 0.12, 0.3], color: 0x7a3a1e }),
    // grip + sight
    part(G.weaponBox, { pos: [-0.065, -0.1, 0.12], scale: [0.23, 0.065, 0.08], color: grip }),
    part(G.weaponBox, { pos: [0, 0.24, 0.06], scale: [0.04, 0.08, 0.12], color: dark }),
    part(G.ico0, { pos: [0, 0.28, 0.1], scale: [0.025, 0.025, 0.025], color: accent })
  ]);

  WEAPON_GEO.plasma = mergeParts([
    part(G.weaponBox, { pos: [0, 0, 0.22], scale: [0.22, 0.24, 0.55], color: 0x25344e }),
    part(G.weaponBox, { pos: [0, 0.14, 0.16], scale: [0.19, 0.055, 0.4], color: 0xe0e5e9 }),
    part(G.weaponBox, { pos: [0, -0.18, 0.03], rot: [-0.15, 0, 0], scale: [0.1, 0.3, 0.16], color: dark }),
    part(G.weaponBox, { pos: [0, -0.12, 0.18], scale: [0.16, 0.15, 0.19], color: 0x8d59d6 }),
    part(G.cyl, { pos: [0, 0.035, 0.54], rot: [Math.PI / 2, 0, 0], scale: [0.072, 0.6, 0.072], color: 0x70f6ff }),
    part(G.ico1, { pos: [0, 0.035, 0.92], scale: [0.095, 0.095, 0.15], color: 0xd1ffff }),
    part(G.weaponBox, { pos: [0.1, 0, -0.135], scale: [0.09, 0.18, 0.14], color: 0xc6d6df }),
    part(G.weaponBox, { pos: [0.05, 0, -0.07], rot: [0, -0.62, 0], scale: [0.06, 0.11, 0.17], color: 0x758ba3 })
  ].concat([-1, 1].flatMap((s) => [
    part(G.weaponBox, { pos: [s * 0.13, 0.035, 0.64], scale: [0.07, 0.13, 0.66], color: 0xa6b9ce }),
    part(G.weaponBox, { pos: [s * 0.13, 0.11, 0.64], scale: [0.027, 0.02, 0.5], color: 0x8fffff }),
    part(G.weaponBox, { pos: [s * 0.16, 0.035, 0.92], rot: [0, -s * 0.2, 0], scale: [0.075, 0.2, 0.18], color: 0x48527f })
  ]), [0.45, 0.62, 0.79].map((z) =>
    part(G.tor, { pos: [0, 0.035, z], scale: [0.13, 0.13, 0.11], color: 0xa57bff })
  )));

  const railParts = [
    part(G.weaponBox, { pos: [0, 0.02, 0.19], scale: [0.22, 0.25, 0.58], color: 0x2a3550 }),
    part(G.weaponBox, { pos: [0, 0.18, 0.12], scale: [0.17, 0.07, 0.39], color: 0xdce4ee }),
    part(G.weaponBox, { pos: [0, -0.19, 0.02], rot: [-0.14, 0, 0], scale: [0.1, 0.3, 0.15], color: dark }),
    part(G.weaponBox, { pos: [0.1, -0.02, -0.2], scale: [0.09, 0.19, 0.18], color: 0x758ba3 }),
    part(G.weaponBox, { pos: [0.05, -0.02, -0.075], rot: [0, -0.59, 0], scale: [0.065, 0.12, 0.18], color: dark }),
    part(G.weaponBox, { pos: [0, 0.26, 0.23], scale: [0.09, 0.11, 0.29], color: 0x172438 }),
    part(G.weaponBox, { pos: [0, 0.26, 0.385], scale: [0.06, 0.07, 0.035], color: 0xff86ed }),
    part(G.weaponBox, { pos: [0, 0.025, 0.76], scale: [0.07, 0.06, 0.84], color: 0x92ffff })
  ];
  for (const s of [-1, 1]) {
    railParts.push(part(G.weaponBox, { pos: [s * 0.12, 0.025, 0.78], scale: [0.085, 0.15, 0.94], color: 0x91a8bf }));
    railParts.push(part(G.weaponBox, { pos: [s * 0.12, 0.115, 0.79], scale: [0.04, 0.025, 0.84], color: 0x73faff }));
    for (let i = 0; i < 4; i++) railParts.push(part(G.weaponBox, { pos: [s * 0.17, 0.02, 0.48 + i * 0.19], scale: [0.05, 0.21, 0.07], color: 0xc56fcf }));
  }
  WEAPON_GEO.railgun = mergeParts(railParts);

  const cannonParts = [
    part(G.weaponBox, { pos: [0, 0.02, 0.2], scale: [0.34, 0.33, 0.45], color: 0x435261 }),
    part(G.weaponBox, { pos: [0, 0.22, 0.2], scale: [0.24, 0.07, 0.35], color: 0xd79948 }),
    part(G.weaponBox, { pos: [0, -0.23, 0], scale: [0.14, 0.31, 0.18], color: dark }),
    part(G.cyl, { pos: [-0.31, -0.035, 0.23], rot: [0, 0, Math.PI / 2], scale: [0.22, 0.32, 0.22], color: 0x7f5940 }),
    part(G.weaponBox, { pos: [0.24, 0.01, 0.22], scale: [0.14, 0.25, 0.33], color: 0x8e9eab }),
    part(G.cyl, { pos: [0, 0.025, 0.54], rot: [Math.PI / 2, 0, 0], scale: [0.195, 0.39, 0.195], color: dark }),
    part(G.tor, { pos: [0, 0.025, 0.94], scale: [0.185, 0.185, 0.13], color: 0xffb44c })
  ];
  for (let i = 0; i < 4; i++) {
    const a = i * Math.PI / 2;
    cannonParts.push(part(G.cyl, { pos: [Math.cos(a) * 0.105, 0.025 + Math.sin(a) * 0.105, 0.78], rot: [Math.PI / 2, 0, 0], scale: [0.052, 0.54, 0.052], color: 0x8d9eaf }));
    cannonParts.push(part(G.weaponBox, { pos: [Math.cos(a) * 0.17, 0.025 + Math.sin(a) * 0.17, 0.53], rot: [0, 0, a], scale: [0.075, 0.06, 0.21], color: 0xffb44c }));
  }
  WEAPON_GEO.autocannon = mergeParts(cannonParts);

  // A shared ceramic/metal finish with a distinct identifying colour on each
  // weapon; the larger cross section reads at the tactical camera distance.
  const finishes = {
    pistol: [0x71d9eb, 0.16, 0.075, 0.3],
    shotgun: [0xf2ad52, 0.34, 0.09, 0.42],
    smg: [0x5fddac, 0.2, 0.09, 0.35],
    rifle: [0x76aef1, 0.36, 0.09, 0.46],
    flamer: [0xff8950, 0.23, 0.1, 0.4],
    minigun: [0xd96b63, 0.09, 0.15, 0.35],
    rocket: [0xe3c776, 0.22, 0.13, 0.42]
  };
  for (const id in finishes) {
    const f = finishes[id];
    const panels = [WEAPON_GEO[id]];
    for (const s of [-1, 1]) {
      panels.push(part(G.weaponBox, { pos: [s * f[2], 0.005, f[1]], scale: [0.035, 0.105, f[3]], color: f[0] }));
      panels.push(part(G.weaponBox, { pos: [s * (f[2] + 0.021), 0.035, f[1]], scale: [0.012, 0.025, f[3] * 0.6], color: 0xe1eef1 }));
      for (let i = 0; i < 3; i++) {
        panels.push(part(G.weaponBox, { pos: [s * (f[2] + 0.022), -0.03, f[1] - f[3] * 0.22 + i * 0.07], scale: [0.013, 0.035, 0.024], color: dark }));
      }
    }
    WEAPON_GEO[id] = mergeParts(panels);
  }
  buildExpandedWeaponGeometries();
  WEAPON_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.4, metalness: 0.62, flatShading: false });
  WEAPON_MATERIAL.userData.shared = true;
  WEAPON_PART_GEO.magazine = part(G.weaponBox, { scale: [0.077, 0.21, 0.11], color: 0x34414c });
  WEAPON_PART_GEO.spearCore = mergeParts([-1, 1].map(side => part(G.weaponBox, {
    pos: [0, -.1 + side * .045, 1.375], scale: [.018, .009, .31], color: 0x8fc2c5
  })));
  if (!MELEE_ENERGY_MATERIAL) {
    MELEE_ENERGY_MATERIAL = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .35,
      metalness: .35, emissive: 0x448e97, emissiveIntensity: .55 });
    MELEE_ENERGY_MATERIAL.userData.shared = true;
  }
  WEAPON_PART_GEO.boxMagazine = part(G.weaponBox, { scale: [0.19, 0.2, 0.24], color: 0x42544d });
  WEAPON_PART_GEO.bolt = part(G.weaponBox, { scale: [0.025, 0.045, 0.16], color: 0x95a7b4 });
  WEAPON_PART_GEO.pump = part(G.weaponBox, { scale: [0.11, 0.09, 0.24], color: 0x343b42 });
  WEAPON_PART_GEO.cylinder = part(G.cyl, { rot: [Math.PI / 2, 0, 0], scale: [0.092, 0.18, 0.092], color: 0x71818b });
  WEAPON_PART_GEO.breakBarrels = mergeParts([-1, 1].map(side => part(G.cyl, {
    pos: [side * 0.06, 0, 0.27], rot: [Math.PI / 2, 0, 0], scale: [0.054, 0.58, 0.054], color: 0x6b7c8b
  })));
  WEAPON_PART_GEO.bowString = mergeParts([-1, 1].map(side => part(G.weaponBox, {
    pos: [side * 0.21, 0, 0], rot: [0, side * 0.65, 0], scale: [0.47, 0.015, 0.015], color: 0xd0d9d7
  })));
  markShared(WEAPON_PART_GEO);
  for (const id in WEAPON_GEO) {
    WEAPON_GEO[id].computeBoundingSphere();
  }
  markShared(WEAPON_MOVING_GEO);

  return markShared(WEAPON_GEO);
}

/* Readable full-resolution silhouettes with smooth barrels and separate
   mechanical parts. The material and source geometries are shared by actors. */
function buildExpandedWeaponGeometries() {
  const metal = 0x6b7c8b, dark = 0x26313b, polymer = 0x3f4d55, grip = 0x353334;
  for (const weapon of WEAPONS) {
    if (WEAPON_GEO[weapon.geo]) continue;
    const p = [], box = (pos, scale, color = dark, rot) => p.push(part(G.weaponBox, { pos, scale, color, rot }));
    const tube = (x, y, z, radius, length, color = metal) => p.push(part(G.cyl, { pos: [x, y, z], rot: [Math.PI / 2, 0, 0], scale: [radius, length, radius], color }));
    if (weapon.fire === 'melee') {
      // Blade/head proportions carry the silhouette; handle sockets remain
      // at their authored locations so larger metalwork never enlarges hands.
      const blade = (outline, thickness, color, y = -0.1) => {
        const shape = new THREE.Shape(); shape.moveTo(...outline[0]);
        for (let i = 1; i < outline.length; i++) shape.lineTo(...outline[i]);
        shape.closePath();
        const geo = new THREE.ExtrudeGeometry(shape, { depth: thickness, steps: 1, bevelEnabled: true,
          bevelThickness: 0.008, bevelSize: 0.009, bevelSegments: 2, curveSegments: 1 });
        geo.translate(0, 0, -thickness / 2); geo.rotateX(Math.PI / 2);
        p.push(part(geo, { pos: [0, y, 0], color })); geo.dispose();
      };
      const long = weapon.id === 'spear', heavy = weapon.id === 'hammer';
      const end = long ? 1.22 : heavy ? 0.84 : weapon.id === 'axe' ? 0.67 : 0.17;
      tube(0, -0.1, (end - 0.16) / 2, 0.037, end + 0.16, long || heavy ? 0x77838a : grip);
      tube(0, -0.1, 0.015, 0.048, 0.34, 0x303b40);
      tube(0, -0.1, -0.165, 0.051, 0.035, 0x9aa9af);
      for (let i = 0; i < 6; i++) tube(0, -0.1, -0.12 + i * 0.048, 0.051, 0.016, 0x46555b);
      if (long || heavy) {
        tube(0, -0.1, 0.3, 0.047, 0.22, 0x334044);
        for (let i = 0; i < 4; i++) tube(0, -0.1, 0.22 + i * 0.05, 0.05, 0.014, 0x526168);
      }
      if (heavy) {
        box([0, -0.1, 0.86], [0.59, 0.23, 0.3], 0x829299);
        box([0, -0.1, 0.86], [0.32, 0.29, 0.22], 0x38464e);
        for (const side of [-1, 1]) {
          box([side * 0.31, -0.1, 0.86], [0.065, 0.28, 0.33], 0xc0cbd0);
          box([side * 0.18, 0.025, 0.86], [0.025, 0.018, 0.21], 0xb99a62);
        }
        tube(0, -0.1, 0.655, 0.061, 0.12, 0x9aa7ad);
      } else if (weapon.id === 'axe') {
        blade([[0.015, 0.55], [0.23, 0.46], [0.35, 0.52], [0.365, 0.87], [0.24, 0.91], [0.085, 0.72]], 0.075, 0x95a7b1);
        blade([[0.315, 0.515], [0.35, 0.52], [0.365, 0.87], [0.32, 0.884]], 0.08, 0xe0e6e8);
        blade([[-0.035, 0.56], [-0.245, 0.68], [-0.04, 0.72]], 0.065, 0xaab9c1);
        box([0, -0.1, 0.645], [0.14, 0.16, 0.18], 0x394950);
      } else if (long) {
        tube(0, -0.1, 1.12, 0.065, 0.2, 0x4b5c63);
        blade([[-0.045, 1.17], [-0.125, 1.31], [0, 1.66], [0.125, 1.31], [0.045, 1.17]], 0.048, 0xc4d2d7);
        blade([[-0.018, 1.2], [0, 1.6], [0.018, 1.2]], 0.065, 0x607982);
        box([0, -0.062, 1.12], [0.045, 0.02, 0.095], 0x8ea9ad);
      } else if (weapon.id === 'machete') {
        blade([[-0.078, 0.19], [-0.088, 0.77], [-0.025, 1.02], [0.085, 0.97], [0.145, 0.84], [0.09, 0.22]], 0.041, 0xa4b5c1);
        blade([[0.065, 0.23], [0.118, 0.83], [0.07, 0.94], [-0.025, 1.02], [0.085, 0.97], [0.145, 0.84], [0.09, 0.22]], 0.045, 0xe1e7e9);
        box([-0.052, -0.073, 0.47], [0.019, 0.012, 0.36], 0x536c79);
        box([0, -0.1, 0.17], [0.23, 0.085, 0.045], 0x8d9da6);
      } else {
        blade([[-0.064, 0.19], [-0.071, 0.58], [0, 0.79], [0.076, 0.52], [0.076, 0.19]], 0.04, 0xa6b9c5);
        blade([[0.05, 0.2], [0.052, 0.51], [0, 0.79], [0.076, 0.52], [0.076, 0.19]], 0.044, 0xe4e9eb);
        box([-0.018, -0.073, 0.36], [0.018, 0.012, 0.2], 0x506978);
        box([0, -0.1, 0.17], [0.205, 0.072, 0.04], 0x9eafb8);
      }
    } else {
      const pistol = weapon.id === 'revolver', long = ['dmr', 'sniper', 'lmg'].includes(weapon.id);
      box([0, 0, 0.22], [pistol ? 0.1 : 0.145, pistol ? 0.13 : 0.19, pistol ? 0.39 : 0.56], metal);
      box(weapon.pose.grip, [0.087, 0.23, 0.13], grip, [-0.15, 0, 0]);
      const end = weapon.muzzle[2], length = Math.max(0.18, end - 0.4);
      if (weapon.id !== 'doubleBarrel') tube(0, weapon.muzzle[1], 0.4 + length * 0.5, weapon.id === 'grenadeLauncher' ? 0.095 : 0.035, length);
      if (!pistol) {
        box([0.1, -0.015, -0.19], [0.095, 0.18, 0.2], polymer);
        box([0.045, -0.02, -0.065], [0.07, 0.12, 0.19], metal, [0, -0.6, 0]);
        box([0, -0.015, 0.48], [0.155, 0.13, 0.28], polymer);
      }
      if (weapon.suppressed) tube(0, 0.03, end - 0.13, 0.067, 0.29, dark);
      if (long) {
        tube(0, 0.19, 0.28, weapon.id === 'sniper' ? 0.055 : 0.043, weapon.id === 'sniper' ? 0.41 : 0.29, dark);
        box([0, 0.11, 0.2], [0.08, 0.1, 0.12], polymer);
        tube(0, 0.19, weapon.id === 'sniper' ? 0.493 : 0.43, 0.035, 0.008, 0x6fbcce);
      } else box([0, 0.14, 0.18], [0.07, 0.06, 0.12], dark);
      if (weapon.id === 'crossbow') {
        for (const side of [-1, 1]) {
          box([side * 0.27, 0.02, 0.62], [0.54, 0.055, 0.075], metal, [0, side * -0.25, 0]);
        }
        tube(0, 0.065, 0.68, 0.01, 0.7, 0xa9b8b0);
      }
      if (weapon.id === 'lmg') { box([-0.14, -0.12, 0.12], [0.22, 0.28, 0.3], 0x59634a); }
      const stripe = weapon.suppressed ? 0x829f94 : weapon.ammo === 'shell' ? 0xc8a66b : 0x80b2c4;
      for (const side of [-1, 1]) box([side * 0.076, 0.045, 0.22], [0.013, 0.024, 0.21], stripe);
    }
    WEAPON_GEO[weapon.geo] = mergeParts(p);
  }
}

/* ------------------------------------------------------------------
   Level props.
   ------------------------------------------------------------------ */
const PROP_GEO = {};
function buildPropGeometries() {
  const crateWood = 0x6b4a2a, crateTrim = 0x8a6134, metal = 0x50565f, dark = 0x22262c;

  PROP_GEO.crate = mergeParts([
    part(G.box, { pos: [0, 0.55, 0], scale: [1.1, 1.1, 1.1], color: crateWood }),
    part(G.box, { pos: [0, 0.55, 0], scale: [1.14, 0.16, 1.14], color: crateTrim }),
    part(G.box, { pos: [0, 1.06, 0], scale: [1.16, 0.1, 1.16], color: crateTrim }),
    part(G.box, { pos: [0, 0.06, 0], scale: [1.16, 0.1, 1.16], color: crateTrim })
  ]);

  PROP_GEO.container = mergeParts([
    part(G.box, { pos: [0, 0.8, 0], scale: [2.4, 1.6, 1.2], color: 0x2f5a4a }),
    part(G.box, { pos: [0, 1.6, 0], scale: [2.44, 0.12, 1.24], color: 0x1f3e33 }),
    part(G.box, { pos: [-0.8, 0.8, 0.62], scale: [0.1, 1.4, 0.06], color: 0x1f3e33 }),
    part(G.box, { pos: [0, 0.8, 0.62], scale: [0.1, 1.4, 0.06], color: 0x1f3e33 }),
    part(G.box, { pos: [0.8, 0.8, 0.62], scale: [0.1, 1.4, 0.06], color: 0x1f3e33 })
  ]);

  PROP_GEO.console = mergeParts([
    part(G.box, { pos: [0, 0.5, 0], scale: [1.4, 1.0, 0.6], color: metal }),
    part(G.box, { pos: [0, 1.06, -0.1], rot: [-0.35, 0, 0], scale: [1.3, 0.7, 0.1], color: dark }),
    part(G.box, { pos: [0, 1.06, -0.06], rot: [-0.35, 0, 0], scale: [1.1, 0.5, 0.06], color: 0x1c6e7a }),
    part(G.box, { pos: [0, 0.04, 0], scale: [1.5, 0.1, 0.7], color: dark })
  ]);

  PROP_GEO.pipes = mergeParts([
    part(G.cyl, { pos: [0, 1.9, 0], rot: [0, 0, Math.PI / 2], scale: [0.16, 3.0, 0.16], color: 0x6a5a3a }),
    part(G.cyl, { pos: [0, 2.3, 0.4], rot: [0, 0, Math.PI / 2], scale: [0.12, 3.0, 0.12], color: 0x5a6a7a }),
    part(G.box, { pos: [-1.2, 1.2, 0.2], scale: [0.16, 1.6, 0.16], color: 0x3a4048 }),
    part(G.box, { pos: [1.2, 1.2, 0.2], scale: [0.16, 1.6, 0.16], color: 0x3a4048 })
  ]);

  PROP_GEO.barrel = mergeParts([
    part(G.cyl, { pos: [0, 0.55, 0], scale: [0.42, 1.1, 0.42], color: 0xa8261c }),
    part(G.tor, { pos: [0, 0.34, 0], rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.42, 0.16], color: 0x7a1a12 }),
    part(G.tor, { pos: [0, 0.78, 0], rot: [Math.PI / 2, 0, 0], scale: [0.42, 0.42, 0.16], color: 0x7a1a12 }),
    part(G.cyl, { pos: [0, 1.12, 0], scale: [0.34, 0.08, 0.34], color: 0xd8b418 })
  ]);

  PROP_GEO.lamp = mergeParts([
    part(G.box, { pos: [0, 0, 0], scale: [1.2, 0.14, 0.4], color: 0x2a2f36 }),
    part(G.box, { pos: [0, -0.09, 0], scale: [1.0, 0.06, 0.3], color: 0xfff0d0 })
  ]);

  return markShared(PROP_GEO);
}

/* Supply assets share geometry and physically lit materials across the shop,
   campaign and arenas. Three surface groups keep the draw count bounded. */
const PICKUP_GEO = {};
const PICKUP_AMMO_GEO = {};
let PICKUP_MATERIALS = null;

function supplyGeometry(kind, variant) {
  const surfaces = [[], [], []];
  const box = (p, s, c, material = 0, r) => surfaces[material].push(part(G.weaponBox || G.body, { pos: p, scale: s, color: c, rot: r }));
  const cylinder = (p, s, c, material = 1, r) => surfaces[material].push(part(G.cyl, { pos: p, scale: s, color: c, rot: r }));
  const dark = 0x263539, rubber = 0x152126, steel = 0x97a9ab, medical = kind !== 'ammo', large = kind === 'bigHealth';
  const width = medical ? (large ? .86 : .72) : .9, depth = medical ? .43 : .56;
  const casing = medical ? 0xdce3db : 0x536b60, accent = medical ? 0xcd594c : 0xd2ab63;
  box([0, -.045, 0], [width, .36, depth], casing);
  box([0, -.215, 0], [width + .025, .065, depth + .025], rubber, 2);
  // Protective corner bumpers and recessed seams are visible from above.
  for (const x of [-1, 1]) for (const z of [-1, 1]) {
    box([x * (width / 2 - .045), -.035, z * (depth / 2 - .02)], [.12, .38, .09], dark, 2);
    box([x * (width / 2 - .045), -.155, z * (depth / 2 + .029)], [.06, .025, .012], steel, 1);
  }
  const lidY = medical ? .17 : .16;
  if (medical) {
    box([0, lidY, 0], [width + .01, .085, depth + .015], casing);
    box([0, .132, 0], [width + .017, .022, depth + .02], dark, 2);
    box([0, .215, 0], [.29, .013, .088], accent);
    box([0, .216, 0], [.09, .014, .28], accent);
    for (const z of [-1, 1]) {
      box([0, -.015, z * (depth / 2 + .005)], [.23, .065, .016], accent);
      box([0, -.015, z * (depth / 2 + .007)], [.065, .21, .018], accent);
    }
    if (large) for (const x of [-1, 1]) box([x * .285, .216, 0], [.025, .012, .23], steel, 1);
    // Low folding carry handle leaves the medical symbol unobscured.
    for (const x of [-1, 1]) box([x * .145, .275, -.135], [.035, .105, .035], steel, 1);
    box([0, .326, -.135], [.31, .045, .046], rubber, 2);
  } else {
    // Open lid, padded tray and retaining rail reveal the actual ammunition.
    box([0, .125, 0], [width - .13, .035, depth - .095], rubber, 2);
    box([0, .335, -.225], [width, .34, .055], casing, 0, [-.24, 0, 0]);
    box([0, .338, -.192], [width - .13, .24, .02], dark, 2, [-.24, 0, 0]);
    box([0, .385, -.168], [.31, .06, .014], accent);
    for (const x of [-1, 1]) cylinder([x * .3, .17, -.23], [.023, .14, .023], steel, 1, [0, 0, Math.PI / 2]);
    for (const x of [-1, 1]) box([x * .48, -.02, 0], [.045, .11, .22], rubber, 2);
    const type = variant || 'supply';
    if (type === 'fuel') {
      box([0, .23, .015], [.47, .22, .3], 0xb17b45);
      for (const x of [-1, 1]) box([x * .17, .23, .015], [.045, .23, .31], dark, 2);
      cylinder([.17, .36, -.045], [.05, .06, .05], steel);
      box([-.08, .37, .015], [.22, .036, .045], rubber, 2);
    } else if (type === 'cell') {
      for (const x of [-.24, 0, .24]) {
        box([x, .255, .04], [.16, .245, .22], steel, 1);
        box([x, .265, .157], [.1, .16, .012], 0x65bdc6);
        box([x, .385, .04], [.11, .025, .14], dark, 2);
      }
    } else if (type === 'rocket' || type === 'grenade') {
      for (const x of [-.23, .0, .23]) {
        cylinder([x, .22, .035], [.067, .34, .067], 0x87956a, 0, [Math.PI / 2, 0, 0]);
        cylinder([x, .22, -.105], [.071, .065, .071], accent, 1, [Math.PI / 2, 0, 0]);
        if (type === 'rocket') surfaces[1].push(part(G.cone, { pos: [x, .22, .255], rot: [Math.PI / 2, 0, 0], scale: [.067, .12, .067], color: steel }));
        else cylinder([x, .22, .22], [.067, .03, .067], dark, 2, [Math.PI / 2, 0, 0]);
      }
    } else if (type === 'bolt') {
      for (const x of [-.26, -.13, 0, .13, .26]) {
        cylinder([x, .205, .02], [.014, .46, .014], steel, 1, [Math.PI / 2, 0, 0]);
        surfaces[1].push(part(G.cone, { pos: [x, .205, .29], rot: [Math.PI / 2, 0, 0], scale: [.029, .085, .029], color: steel }));
        box([x, .205, -.15], [.065, .015, .1], 0x82b8a3);
      }
    } else {
      const shell = type === 'shell', heavy = type === 'cannon' || type === 'slug';
      const count = heavy ? 4 : 6, radius = heavy ? .058 : .043;
      for (let i = 0; i < count; i++) {
        const x = (i - (count - 1) / 2) * (heavy ? .17 : .12);
        const mixedShell = shell || type === 'supply' && i > 3;
        cylinder([x, .24, .035], [radius, .22, radius], mixedShell ? 0xa45743 : 0xbc9c59, mixedShell ? 0 : 1);
        cylinder([x, .141, .035], [radius * 1.1, .037, radius * 1.1], 0xd3ba7b, 1);
        if (mixedShell) cylinder([x, .353, .035], [radius, .015, radius], 0xe5c899, 0);
        else surfaces[1].push(part(G.cone, { pos: [x, .396, .035], scale: [radius, .095, radius], color: 0xb6bbb2 }));
      }
    }
    box([0, .205, .19], [width - .16, .037, .022], steel, 1);
  }
  for (const x of [-1, 1]) {
    box([x * width * .31, .075, depth / 2 + .018], [.075, .115, .035], steel, 1);
    box([x * width * .31, .08, depth / 2 + .039], [.038, .04, .013], rubber, 2);
  }
  if (!medical) box([0, -.055, depth / 2 + .011], [.29, .075, .016], accent);
  const counts = surfaces.map(p => p.reduce((sum, g) => sum + g.attributes.position.count, 0));
  const geometry = mergeParts(surfaces.flat());
  let offset = 0; counts.forEach((count, i) => { if (count) geometry.addGroup(offset, count, i); offset += count; });
  geometry.userData.shared = true;
  return geometry;
}

function createPickupModel(kind, variant = '') {
  if (!PICKUP_MATERIALS) buildPickupGeometries();
  let geometry;
  if (kind === 'ammo') geometry = PICKUP_AMMO_GEO[variant] || PICKUP_AMMO_GEO.supply;
  else geometry = PICKUP_GEO[kind] || PICKUP_GEO.health;
  const mesh = new THREE.Mesh(geometry, PICKUP_MATERIALS);
  mesh.castShadow = true; mesh.receiveShadow = true;
  return mesh;
}

function buildPickupGeometries() {
  if (PICKUP_MATERIALS) return PICKUP_GEO;
  PICKUP_MATERIALS = [
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .64, metalness: .12 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .29, metalness: .78 }),
    new THREE.MeshStandardMaterial({ vertexColors: true, roughness: .9, metalness: .02 })
  ];
  for (const material of PICKUP_MATERIALS) material.userData.shared = true;
  PICKUP_GEO.health = supplyGeometry('health');
  PICKUP_GEO.bigHealth = supplyGeometry('bigHealth');
  PICKUP_GEO.armor = mergeParts([
    part(G.box, { pos: [0, 0.02, 0], scale: [0.42, 0.5, 0.16], color: 0x2f6fa8 }),
    part(G.box, { pos: [0, -0.22, 0], rot: [0, 0, Math.PI / 4], scale: [0.3, 0.3, 0.16], color: 0x2f6fa8 }),
    part(G.box, { pos: [0, 0.06, 0.1], scale: [0.2, 0.28, 0.04], color: 0x8fd0ff })
  ]);
  for (const type of ['supply', 'shell', 'smg', 'rifle', 'fuel', 'mini', 'rocket', 'cell', 'slug', 'cannon', 'grenade', 'bolt']) {
    PICKUP_AMMO_GEO[type] = supplyGeometry('ammo', type);
  }
  PICKUP_GEO.ammo = PICKUP_AMMO_GEO.supply;
  PICKUP_GEO.money = mergeParts([
    part(G.oct, { pos: [0, 0, 0], scale: [0.22, 0.34, 0.22], color: 0x38e0d0 })
  ]);
  PICKUP_GEO.weapon = mergeParts([
    part(G.box, { pos: [0, 0, 0], scale: [0.9, 0.26, 0.44], color: 0x3a4a5a }),
    part(G.box, { pos: [0, 0.15, 0], scale: [0.92, 0.06, 0.46], color: 0x28323e }),
    part(G.box, { pos: [0, 0.02, 0.23], scale: [0.4, 0.12, 0.02], color: 0xffa42a })
  ]);
  return markShared(PICKUP_GEO);
}
