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

  // High-resolution industrial materials remain fully offline.
  buildIndustrialTextures();

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

/* Smooth mipmapped surfaces: quiet materials, restrained seams, legible signs. */
function facilityTexture(canvas, repeat = false, isColor = true) {
  const texture = new THREE.CanvasTexture(canvas);
  texture.magFilter = THREE.LinearFilter; texture.minFilter = THREE.LinearMipmapLinearFilter;
  texture.generateMipmaps = true; texture.anisotropy = 4;
  if (repeat) texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  if (isColor) texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}
const FACILITY_SURFACES = [
  { base: '#455965', shade: '#354954', edge: '#607984', accent: '#8bbdbb', title: 'DOCK 07', code: 'CARGO TERMINAL' },
  { base: '#657581', shade: '#4c5e6c', edge: '#8b9eaa', accent: '#b3b4db', title: 'CRYO LAB', code: 'RESEARCH DIVISION' },
  { base: '#625f5b', shade: '#4b4c4d', edge: '#85827a', accent: '#d5b281', title: 'REACTOR', code: 'POWER CONTROL' }
];
function makeFacilityFloor(sector) {
  const canvas = makeCanvas(512), g = canvas.getContext('2d'), ramp = FACILITY_SURFACES[sector];
  g.fillStyle = ramp.shade; g.fillRect(0, 0, 512, 512);
  for (let y = 0; y < 512; y += 128) for (let x = 0; x < 512; x += 128) {
    const grad = g.createLinearGradient(x, y, x + 128, y + 128);
    grad.addColorStop(0, ramp.base); grad.addColorStop(1, ramp.shade);
    g.fillStyle = grad; g.beginPath(); g.roundRect(x + 1.5, y + 1.5, 125, 125, 3); g.fill();
    g.strokeStyle = ramp.edge; g.globalAlpha = 0.23; g.lineWidth = 1;
    g.beginPath(); g.moveTo(x + 6, y + 2.5); g.lineTo(x + 121, y + 2.5); g.stroke(); g.globalAlpha = 1;
    if ((x / 128 + y / 128 * 3 + sector) % 7 === 0) {
      g.strokeStyle = ramp.shade; g.lineWidth = 1.5; g.strokeRect(x + 25, y + 31, 76, 68);
      g.fillStyle = ramp.shade; g.beginPath(); g.roundRect(x + 54, y + 40, 20, 3, 1.5); g.fill();
      g.globalAlpha = 0.38; g.fillStyle = ramp.edge;
      for (const dx of [20, 108]) { g.beginPath(); g.arc(x + dx, y + 19, 1.3, 0, TAU); g.fill(); }
      g.globalAlpha = 1;
    }
  }
  return facilityTexture(canvas, true);
}
function buildIndustrialTextures() {
  TEX.floor = makeFacilityFloor(0);
  const wall = makeCanvas(512), g = wall.getContext('2d');
  g.fillStyle = '#273a49'; g.fillRect(0, 0, 512, 512);
  for (let x = 0; x < 512; x += 256) {
    const gradient = g.createLinearGradient(x, 0, x + 256, 0);
    gradient.addColorStop(0, '#647c8a'); gradient.addColorStop(0.035, '#536d7d'); gradient.addColorStop(0.88, '#3f5768'); gradient.addColorStop(1, '#2d4454');
    g.fillStyle = gradient; g.beginPath(); g.roundRect(x + 7, 7, 242, 451, 8); g.fill();
    g.strokeStyle = '#8ba1ac'; g.lineWidth = 1; g.globalAlpha = 0.65; g.strokeRect(x + 13.5, 13.5, 229, 439); g.globalAlpha = 1;
    for (const y of [138, 302]) { g.fillStyle = '#273a49'; g.fillRect(x + 9, y, 238, 5); g.fillStyle = '#708693'; g.fillRect(x + 12, y + 5, 232, 1); }
    g.fillStyle = '#344d5c'; g.beginPath(); g.roundRect(x + 42, 45, 172, 52, 5); g.fill();
    g.fillStyle = '#aac0cb'; g.font = '500 14px Arial'; g.fillText('SERVICE / 07', x + 56, 68);
    for (let i = 0; i < 7; i++) { g.fillStyle = '#203442'; g.beginPath(); g.roundRect(x + 48 + i * 24, 200, 9, 48, 4); g.fill(); }
    g.fillStyle = '#718794'; g.fillRect(x + 24, 477, 208, 2);
  }
  TEX.wall = facilityTexture(wall, true);
  const hazard = makeCanvas(512), h = hazard.getContext('2d');
  h.fillStyle = '#303a42'; h.fillRect(0, 0, 512, 512); h.fillStyle = '#c6a45f';
  for (let x = -512; x < 1024; x += 128) { h.beginPath(); h.moveTo(x, 0); h.lineTo(x + 64, 0); h.lineTo(x - 448, 512); h.lineTo(x - 512, 512); h.closePath(); h.fill(); }
  const shade = h.createLinearGradient(0, 0, 0, 512); shade.addColorStop(0, 'rgba(255,255,255,.16)'); shade.addColorStop(0.45, 'rgba(0,0,0,0)'); shade.addColorStop(1, 'rgba(0,0,0,.2)'); h.fillStyle = shade; h.fillRect(0, 0, 512, 512);
  TEX.hazard = facilityTexture(hazard, true);
}
function buildFacilityTextures() {
  TEX.sectorFloor = [TEX.floor, makeFacilityFloor(1), makeFacilityFloor(2)]; TEX.sectorMarking = [];
  for (let sector = 0; sector < 3; sector++) {
    const ramp = FACILITY_SURFACES[sector], sign = makeCanvas(512), g = sign.getContext('2d');
    g.strokeStyle = ramp.accent; g.lineWidth = 3; g.globalAlpha = 0.7; g.strokeRect(32, 32, 448, 448);
    g.lineWidth = 1; g.globalAlpha = 0.35; g.strokeRect(46, 46, 420, 420); g.globalAlpha = 1;
    g.fillStyle = ramp.accent; g.textAlign = 'center'; g.font = '600 57px Arial'; g.fillText(ramp.title, 256, 243);
    g.font = '500 19px Arial'; g.fillText(ramp.code, 256, 281); g.font = '500 20px Arial'; g.fillText('SECTOR 0' + (sector + 1), 256, 421);
    g.fillRect(166, 139, 180, 2); g.fillRect(166, 334, 180, 2); TEX.sectorMarking.push(facilityTexture(sign));
  }
  const vent = makeCanvas(512), v = vent.getContext('2d');
  const gradient = v.createLinearGradient(0, 0, 512, 512); gradient.addColorStop(0, '#7b919c'); gradient.addColorStop(1, '#293e4b');
  v.fillStyle = gradient; v.fillRect(0, 0, 512, 512); v.fillStyle = '#3b5362'; v.fillRect(16, 16, 480, 480);
  for (let y = 64; y < 458; y += 48) { v.fillStyle = '#172c39'; v.beginPath(); v.roundRect(54, y, 404, 21, 8); v.fill(); v.fillStyle = '#7d939e'; v.fillRect(60, y + 22, 392, 2); }
  TEX.vent = facilityTexture(vent);
  const normal = makeCanvas(512), n = normal.getContext('2d'); n.fillStyle = '#8080ff'; n.fillRect(0, 0, 512, 512);
  for (let i = 0; i < 512; i += 128) {
    const vertical = n.createLinearGradient(i, 0, i + 4, 0); vertical.addColorStop(0, '#7480fd'); vertical.addColorStop(0.5, '#8c80fd'); vertical.addColorStop(1, '#8080ff'); n.fillStyle = vertical; n.fillRect(i, 0, 4, 512);
    const horizontal = n.createLinearGradient(0, i, 0, i + 4); horizontal.addColorStop(0, '#8074fd'); horizontal.addColorStop(0.5, '#808cfd'); horizontal.addColorStop(1, '#8080ff'); n.fillStyle = horizontal; n.fillRect(0, i, 512, 4);
  }
  TEX.floorNormal = facilityTexture(normal, true, false);
}
