/* ========================================================================
   20-textures.js — canvas-generated textures (no image files)
   ======================================================================== */

function makeCanvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}

/* value noise, tileable by wrapping the lattice */
function noiseField(size, cells, seedFn) {
  const grid = new Float32Array((cells + 1) * (cells + 1));
  for (let y = 0; y < cells; y++)
    for (let x = 0; x < cells; x++)
      grid[y * (cells + 1) + x] = seedFn();
  // wrap edges so the texture tiles seamlessly
  for (let i = 0; i < cells; i++) {
    grid[i * (cells + 1) + cells] = grid[i * (cells + 1)];
    grid[cells * (cells + 1) + i] = grid[i];
  }
  grid[cells * (cells + 1) + cells] = grid[0];

  const out = new Float32Array(size * size);
  const scale = cells / size;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const fx = x * scale, fy = y * scale;
      const x0 = Math.floor(fx), y0 = Math.floor(fy);
      const tx = fx - x0, ty = fy - y0;
      const sx = tx * tx * (3 - 2 * tx), sy = ty * ty * (3 - 2 * ty);
      const a = grid[y0 * (cells + 1) + x0];
      const b = grid[y0 * (cells + 1) + x0 + 1];
      const c = grid[(y0 + 1) * (cells + 1) + x0];
      const d = grid[(y0 + 1) * (cells + 1) + x0 + 1];
      out[y * size + x] = lerp(lerp(a, b, sx), lerp(c, d, sx), sy);
    }
  }
  return out;
}

function fbm(size, octaves, seedFn) {
  const acc = new Float32Array(size * size);
  let amp = 1, total = 0, cells = 4;
  for (let o = 0; o < octaves; o++) {
    const f = noiseField(size, cells, seedFn);
    for (let i = 0; i < acc.length; i++) acc[i] += f[i] * amp;
    total += amp;
    amp *= 0.5;
    cells *= 2;
  }
  for (let i = 0; i < acc.length; i++) acc[i] /= total;
  return acc;
}

const TEX = {};

function buildTextures() {
  const R = makeRng(1337);

  // Opaque facility surfaces are authored on a small, exact pixel grid.
  // Soft particles below deliberately use separate filtered textures.
  buildIndustrialPixelTextures();

  /* ---- soft radial glow (additive particles, lights, shadows) ------ */
  {
    const S = 128;
    const c = makeCanvas(S);
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(255,255,255,1)');
    rg.addColorStop(0.25, 'rgba(255,255,255,0.62)');
    rg.addColorStop(0.55, 'rgba(255,255,255,0.18)');
    rg.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    TEX.glow = new THREE.CanvasTexture(c);
  }

  /* ---- smoke puff -------------------------------------------------- */
  {
    const S = 128;
    const c = makeCanvas(S);
    const g = c.getContext('2d');
    const field = fbm(S, 5, R);
    const img = g.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        const falloff = clamp(1 - r, 0, 1);
        const a = clamp(falloff * falloff * (0.45 + field[i] * 0.95), 0, 1);
        d[i * 4] = d[i * 4 + 1] = d[i * 4 + 2] = 255;
        d[i * 4 + 3] = a * 255;
      }
    }
    g.putImageData(img, 0, 0);
    TEX.smoke = new THREE.CanvasTexture(c);
  }

  /* ---- blood splat decals (a few variants) ------------------------- */
  TEX.blood = [];
  for (let v = 0; v < 4; v++) {
    const S = 128;
    const c = makeCanvas(S);
    const g = c.getContext('2d');
    g.clearRect(0, 0, S, S);
    const cx = S / 2, cy = S / 2;

    const blobs = R.int(5, 9);
    g.fillStyle = 'rgba(255,255,255,1)';
    for (let i = 0; i < blobs; i++) {
      const a = R() * TAU;
      const r = R.range(0, 20);
      const rad = R.range(12, 30);
      g.beginPath();
      g.ellipse(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rad, rad * R.range(0.6, 1.1), R() * TAU, 0, TAU);
      g.fill();
    }
    // droplets flung outward
    for (let i = 0; i < R.int(14, 26); i++) {
      const a = R() * TAU;
      const r = R.range(24, 60);
      const rad = R.range(1.5, 5);
      g.beginPath();
      g.arc(cx + Math.cos(a) * r, cy + Math.sin(a) * r, rad, 0, TAU);
      g.fill();
    }

    // feather the alpha and tint dark arterial red
    const img = g.getImageData(0, 0, S, S);
    const d = img.data;
    const field = fbm(S, 4, R);
    for (let i = 0; i < S * S; i++) {
      let a = d[i * 4 + 3] / 255;
      a *= 0.55 + field[i] * 0.75;
      const x = (i % S) - cx, y = Math.floor(i / S) - cy;
      const rr = Math.sqrt(x * x + y * y) / (S / 2);
      a *= clamp(1.25 - rr * 1.25, 0, 1);
      const shade = 0.5 + field[i] * 0.45;
      // dark and arterial: bright red reads as paint once decals overlap
      d[i * 4] = 74 * shade;
      d[i * 4 + 1] = 8 * shade;
      d[i * 4 + 2] = 10 * shade;
      d[i * 4 + 3] = clamp(a, 0, 1) * 232;
    }
    g.putImageData(img, 0, 0);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    TEX.blood.push(t);
  }

  /* ---- scorch mark ------------------------------------------------- */
  {
    const S = 128;
    const c = makeCanvas(S);
    const g = c.getContext('2d');
    const field = fbm(S, 4, R);
    const img = g.createImageData(S, S);
    const d = img.data;
    for (let y = 0; y < S; y++) {
      for (let x = 0; x < S; x++) {
        const i = y * S + x;
        const dx = (x - S / 2) / (S / 2), dy = (y - S / 2) / (S / 2);
        const r = Math.sqrt(dx * dx + dy * dy);
        const a = clamp((1 - r) * 1.4, 0, 1) * (0.4 + field[i] * 0.8);
        const v = 10 + field[i] * 18;
        d[i * 4] = v; d[i * 4 + 1] = v * 0.9; d[i * 4 + 2] = v * 0.85;
        d[i * 4 + 3] = clamp(a, 0, 1) * 235;
      }
    }
    g.putImageData(img, 0, 0);
    TEX.scorch = new THREE.CanvasTexture(c);
    TEX.scorch.colorSpace = THREE.SRGBColorSpace;
  }

  /* ---- circular blob shadow ---------------------------------------- */
  {
    const S = 64;
    const c = makeCanvas(S);
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
    rg.addColorStop(0, 'rgba(0,0,0,0.72)');
    rg.addColorStop(0.5, 'rgba(0,0,0,0.42)');
    rg.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = rg;
    g.fillRect(0, 0, S, S);
    TEX.blob = new THREE.CanvasTexture(c);
  }

  buildFacilityTextures();
}

/* Pixel surfaces use authored colour clusters and one-pixel bevels.
   Nearest sampling preserves the painted texel grid without grain overlays. */
function facilityPixelTexture(canvas, repeat = false, isColor = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.anisotropy = 1;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

const FACILITY_PIXEL_RAMPS = [
  { seam: '#182732', shade: '#2b3d49', base: '#405766', inset: '#344b59',
    edge: '#617e8c', light: '#829ca7', accent: '#77c6cb', title: 'DOCK 07', code: 'CARGO' },
  { seam: '#242b40', shade: '#424c62', base: '#65758b', inset: '#536379',
    edge: '#8a9cb0', light: '#b1c1cd', accent: '#b5a6de', title: 'CRYO LAB', code: 'BIO LAB' },
  { seam: '#282930', shade: '#45434a', base: '#66605b', inset: '#534f50',
    edge: '#8d8170', light: '#b2a089', accent: '#dfad61', title: 'REACTOR', code: 'POWER' }
];

function paintFacilityPlate(g, x, y, ramp, kind) {
  const rect = (color, px, py, w, h) => { g.fillStyle = color; g.fillRect(x + px, y + py, w, h); };
  rect(ramp.shade, 1, 1, 30, 30);
  rect(ramp.base, 2, 2, 27, 27);
  rect(ramp.edge, 3, 2, 25, 1);
  rect(ramp.edge, 2, 3, 1, 25);
  rect(ramp.seam, 3, 29, 27, 1);
  rect(ramp.seam, 29, 3, 1, 26);

  // Large uninterrupted faces read as metal plates; detail is concentrated
  // in a few functional clusters rather than scattered across the surface.
  if (kind === 'vent') {
    rect(ramp.shade, 6, 8, 20, 15);
    rect(ramp.seam, 7, 9, 18, 12);
    for (let row = 0; row < 3; row++) {
      rect(ramp.edge, 8, 10 + row * 4, 16, 1);
      rect(ramp.inset, 8, 11 + row * 4, 16, 2);
    }
    rect(ramp.accent, 7, 25, 6, 1);
  } else if (kind === 'lab') {
    rect(ramp.inset, 6, 7, 20, 18);
    rect(ramp.shade, 6, 7, 20, 1);
    rect(ramp.edge, 7, 24, 19, 1);
    rect(ramp.accent, 8, 10, 2, 8);
    rect(ramp.accent, 8, 18, 6, 2);
    rect(ramp.light, 21, 10, 2, 2);
    rect(ramp.shade, 19, 18, 4, 3);
  } else {
    rect(ramp.inset, 6, 8, 20, 15);
    rect(ramp.shade, 6, 8, 20, 1);
    rect(ramp.edge, 7, 22, 18, 1);
    rect(ramp.shade, 13, 10, 6, 2);
    rect(ramp.seam, 14, 11, 4, 1);
    rect(ramp.accent, 7, 25, 5, 1);
    rect(ramp.accent, 14, 25, 2, 1);
  }
  for (const [px, py] of [[4, 4], [26, 4], [4, 26], [26, 26]]) {
    rect(ramp.seam, px, py, 2, 2);
    rect(ramp.light, px, py, 1, 1);
  }
}

function makeFacilityFloor(sector) {
  const canvas = makeCanvas(64), g = canvas.getContext('2d');
  const ramp = FACILITY_PIXEL_RAMPS[sector];
  g.imageSmoothingEnabled = false;
  g.fillStyle = ramp.seam; g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 2; y++) for (let x = 0; x < 2; x++) {
    const kind = sector === 2 ? 'vent' : sector === 1 ? 'lab' : x === y ? 'panel' : 'vent';
    paintFacilityPlate(g, x * 32, y * 32, ramp, kind);
  }
  return facilityPixelTexture(canvas, true);
}

function buildIndustrialPixelTextures() {
  TEX.floor = makeFacilityFloor(0);

  const wall = makeCanvas(64), w = wall.getContext('2d');
  w.imageSmoothingEnabled = false;
  const rect = (color, x, y, width, height) => { w.fillStyle = color; w.fillRect(x, y, width, height); };
  rect('#1c2a37', 0, 0, 64, 64);
  for (let x = 0; x < 64; x += 32) {
    rect('#405768', x + 2, 2, 28, 53);
    rect('#8298a4', x + 3, 2, 26, 1);
    rect('#627d8d', x + 2, 3, 1, 50);
    rect('#293e50', x + 28, 4, 2, 50);
    rect('#293e50', x + 5, 7, 21, 10);
    rect('#344b5c', x + 6, 8, 19, 8);
    rect('#8298a4', x + 8, 10, 8, 1);
    rect('#bfa56b', x + 23, 10, 2, 3);
    for (const y of [20, 39]) {
      rect('#1c2a37', x + 2, y, 28, 3);
      rect('#627d8d', x + 3, y + 3, 26, 1);
    }
    rect('#293e50', x + 6, 27, 20, 8);
    for (let slit = 0; slit < 4; slit++) {
      rect('#1c2a37', x + 8 + slit * 4, 28, 2, 5);
      rect('#627d8d', x + 8 + slit * 4, 33, 2, 1);
    }
    rect('#344b5c', x + 6, 45, 20, 7);
    rect('#627d8d', x + 7, 51, 18, 1);
    rect('#293e50', x + 1, 57, 30, 5);
    rect('#627d8d', x + 2, 57, 28, 1);
  }
  TEX.wall = facilityPixelTexture(wall, true);

  const hazard = makeCanvas(32), h = hazard.getContext('2d');
  h.imageSmoothingEnabled = false;
  // Integer stair-steps, eight pixels per stripe: no anti-aliased diagonals.
  for (let y = 0; y < 32; y++) for (let x = 0; x < 32; x++) {
    const yellow = ((x + y) % 16) < 8;
    h.fillStyle = yellow ? (y < 2 ? '#ecd089' : y > 28 ? '#947343' : '#c9a55d')
      : (y < 2 ? '#48515a' : '#252f3b');
    h.fillRect(x, y, 1, 1);
  }
  TEX.hazard = facilityPixelTexture(hazard, true);
}

/* Compact 5x7 lettering: floor signs remain true pixel assets too. */
const FACILITY_PIXEL_FONT = {
  A:'01110/10001/10001/11111/10001/10001/10001', B:'11110/10001/10001/11110/10001/10001/11110',
  C:'01111/10000/10000/10000/10000/10000/01111', D:'11110/10001/10001/10001/10001/10001/11110',
  E:'11111/10000/10000/11110/10000/10000/11111', G:'01111/10000/10000/10111/10001/10001/01110',
  I:'111/010/010/010/010/010/111', K:'10001/10010/10100/11000/10100/10010/10001',
  L:'10000/10000/10000/10000/10000/10000/11111', O:'01110/10001/10001/10001/10001/10001/01110',
  P:'11110/10001/10001/11110/10000/10000/10000', R:'11110/10001/10001/11110/10100/10010/10001',
  S:'01111/10000/10000/01110/00001/00001/11110', T:'11111/00100/00100/00100/00100/00100/00100',
  W:'10001/10001/10001/10101/10101/10101/01010', Y:'10001/10001/01010/00100/00100/00100/00100',
  '0':'01110/10001/10011/10101/11001/10001/01110', '1':'00100/01100/00100/00100/00100/00100/01110',
  '2':'01110/10001/00001/00010/00100/01000/11111', '3':'11110/00001/00001/01110/00001/00001/11110',
  '7':'11111/00001/00010/00100/01000/01000/01000', ' ':'000/000/000/000/000/000/000'
};

function paintFacilityText(g, text, centerX, y, scale = 1) {
  const glyphs = Array.from(text).map((letter) => (FACILITY_PIXEL_FONT[letter] || FACILITY_PIXEL_FONT[' ']).split('/'));
  const width = glyphs.reduce((sum, rows) => sum + (rows[0].length + 1) * scale, -scale);
  let x = Math.floor(centerX - width / 2);
  for (const rows of glyphs) {
    for (let row = 0; row < rows.length; row++) for (let column = 0; column < rows[row].length; column++) {
      if (rows[row][column] === '1') g.fillRect(x + column * scale, y + row * scale, scale, scale);
    }
    x += (rows[0].length + 1) * scale;
  }
}

function buildFacilityTextures() {
  TEX.sectorFloor = [TEX.floor, makeFacilityFloor(1), makeFacilityFloor(2)];
  TEX.sectorMarking = [];
  for (let sector = 0; sector < 3; sector++) {
    const ramp = FACILITY_PIXEL_RAMPS[sector];
    const sign = makeCanvas(128), s = sign.getContext('2d');
    s.imageSmoothingEnabled = false;
    s.fillStyle = ramp.accent;
    for (const [x, y, flipX, flipY] of [[7, 7, 1, 1], [119, 7, -1, 1], [7, 119, 1, -1], [119, 119, -1, -1]]) {
      s.fillRect(flipX > 0 ? x : x - 21, y, 23, 2);
      s.fillRect(x, flipY > 0 ? y : y - 21, 2, 23);
    }
    s.globalAlpha = 0.4;
    s.fillRect(15, 15, 98, 1); s.fillRect(15, 112, 98, 1);
    s.fillRect(15, 16, 1, 96); s.fillRect(112, 16, 1, 96);
    for (let x = 27; x < 102; x += 8) { s.fillRect(x, 43, 4, 1); s.fillRect(x, 79, 4, 1); }
    s.globalAlpha = 0.85;
    paintFacilityText(s, ramp.title, 64, 52, 2);
    paintFacilityText(s, ramp.code, 64, 69);
    paintFacilityText(s, 'SECTOR 0' + (sector + 1), 64, 99);
    for (const x of [46, 62, 78]) {
      s.fillRect(x, 24, 2, 2); s.fillRect(x - 1, 26, 4, 2); s.fillRect(x - 2, 28, 6, 2);
    }
    TEX.sectorMarking.push(facilityPixelTexture(sign));
  }

  const vent = makeCanvas(32), v = vent.getContext('2d');
  v.imageSmoothingEnabled = false;
  const fill = (color, x, y, w, h) => { v.fillStyle = color; v.fillRect(x, y, w, h); };
  fill('#233440', 0, 0, 32, 32);
  fill('#7d94a0', 1, 1, 30, 1); fill('#607988', 1, 2, 1, 28);
  fill('#152531', 30, 2, 1, 29); fill('#152531', 1, 30, 29, 1);
  fill('#344e5d', 4, 4, 24, 24);
  for (let y = 6; y < 27; y += 4) {
    fill('#152531', 6, y, 20, 2); fill('#708995', 6, y + 2, 20, 1);
  }
  TEX.vent = facilityPixelTexture(vent);

  // Flat, authored seam normals align exactly with the 32px plate grid.
  // No high-frequency normal noise or random specular flecks.
  const normal = makeCanvas(64), n = normal.getContext('2d');
  n.fillStyle = '#8080ff'; n.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 64; y += 32) for (let x = 0; x < 64; x += 32) {
    n.fillStyle = '#7080fd'; n.fillRect(x + 2, y + 3, 1, 25);
    n.fillStyle = '#9080fd'; n.fillRect(x + 29, y + 3, 1, 25);
    n.fillStyle = '#8070fd'; n.fillRect(x + 3, y + 2, 25, 1);
    n.fillStyle = '#8090fd'; n.fillRect(x + 3, y + 29, 25, 1);
  }
  TEX.floorNormal = facilityPixelTexture(normal, true, false);
}
