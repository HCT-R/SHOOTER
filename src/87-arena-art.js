/* Arena landmarks follow the exact LevelMap collision rectangles. Ground
   markings are flush; raised structures stay over solid tiles. Repeated
   detail is instanced so industrial districts do not add a draw per rib. */
class ArenaArt {
  constructor(game, modeId) {
    this.scene = game.scene;
    this.group = new THREE.Group(); this.group.name = 'Arena architecture';
    this.batches = new Map(); this.textures = [];
    const layout = game.level.arenaLayout;
    if (!layout) return;
    const accent = layout.accent, extent = layout.extent;
    const labels = [];
    const label = (text, x, z, w, color, y = 0.062) => labels.push({ text, x, z, w, color, y });

    // Broad streets and district aprons replace the endless tile grid with
    // places recognizable from a small top-down viewport.
    for (const d of layout.districts) {
      this.floor(d.w, d.d, d.x, d.z, 0x1b2930, 0.023, 0.74);
      const labelZ = modeId === 'duel' ? -18 : d.z + (d.z < 0 ? 1 : -1) * (d.d / 2 - 1.4);
      label(d.label, d.x, labelZ, modeId === 'duel' ? 7 : 10, d.color);
      this.floor(d.w - 0.8, 0.1, d.x, d.z - d.d / 2 + 0.5, d.color, 0.043, 0.6);
      this.floor(0.1, d.d - 0.8, d.x - d.w / 2 + 0.5, d.z, d.color, 0.043, 0.6);
    }
    for (const lane of layout.lanes) {
      this.floor(lane.w, lane.d, lane.x, lane.z, 0x14222a, 0.035, 0.95);
      if (lane.w > lane.d) {
        for (const side of [-1, 1]) this.floor(lane.w, 0.11, lane.x, lane.z + side * (lane.d / 2 - 0.35), 0x819899, 0.049, 0.42);
        for (let x = -lane.w / 2 + 2; x < lane.w / 2 - 1; x += 5.4) {
          if (Math.abs(x) >= 8) this.floor(2.3, 0.085, x + lane.x, lane.z, 0xb5bcad, 0.052, 0.55);
        }
      } else {
        for (const side of [-1, 1]) this.floor(0.11, lane.d, lane.x + side * (lane.w / 2 - 0.35), lane.z, 0x819899, 0.049, 0.42);
        for (let z = -lane.d / 2 + 2; z < lane.d / 2 - 1; z += 5.4) {
          if (Math.abs(z) >= 8) this.floor(0.085, 2.3, lane.x, z + lane.z, 0xb5bcad, 0.052, 0.55);
        }
      }
    }
    const plaza = modeId === 'royale' ? 18 : modeId === 'ffa' ? 13 : 10;
    this.floor(plaza, plaza, 0, 0, 0x27383e, 0.056, 0.9);
    this.ring(plaza * 0.36, plaza * 0.36 + 0.07, 0, 0, accent, 0.068, 0.62);
    this.ring(plaza * 0.39, plaza * 0.39 + 0.035, 0, 0, accent, 0.068, 0.32);
    this.floor(1.5, 0.08, 0, 0, accent, 0.07, 0.55); this.floor(0.08, 1.5, 0, 0, accent, 0.07, 0.55);
    label(layout.code, 0, plaza * 0.34, Math.min(8, plaza * 0.75), accent, 0.075);
    if (modeId === 'duel') {
      for (const side of [-1, 1]) {
        this.chevron(side * 7.8, 0, side < 0 ? -Math.PI / 2 : Math.PI / 2, accent, 1.5);
        label(side < 0 ? '01' : '02', side * 25, 7.5, 3, side < 0 ? accent : layout.secondary);
      }
      label('NORTH LANE', 0, -21, 8, 0x9cbdbd); label('SOUTH LANE', 0, 21, 8, 0x9cbdbd);
    } else {
      for (const side of [-1, 1]) {
        this.chevron(side * 11, 0, side < 0 ? -Math.PI / 2 : Math.PI / 2, accent, 1.4);
        this.chevron(0, side * 11, side < 0 ? Math.PI : 0, accent, 1.4);
        for (let k = -2; k <= 2; k++) {
          this.floor(0.42, 4.4, side * 17 + k * 0.8, 0, 0xa0a9a0, 0.057, 0.34);
          this.floor(4.4, 0.42, 0, side * 17 + k * 0.8, 0xa0a9a0, 0.057, 0.34);
        }
      }
      label(modeId === 'royale' ? 'CENTRAL PLAZA' : 'TRANSFER NODE', 0, -plaza * 0.34, 8, 0x9cb5b8, 0.075);
    }
    for (let index = 0; index < layout.blocks.length; index++) {
      const block = layout.blocks[index], { x, z, w, d, color } = block;
      this.box(x, WALL_H + 0.09, z, w - 0.24, 0.18, d - 0.24, color, 'paint');
      for (const side of [-1, 1]) {
        this.box(x, WALL_H + 0.2, z + side * (d / 2 - 0.18), w - 0.18, 0.18, 0.16, 0x1a2a31, 'metal');
        this.box(x + side * (w / 2 - 0.18), WALL_H + 0.2, z, 0.16, 0.18, d - 0.18, 0x1a2a31, 'metal');
        this.box(x, 1.7, z + side * (d / 2 + 0.015), w * 0.72, 0.2, 0.04, color, 'paint');
        this.box(x + side * (w / 2 + 0.015), 1.7, z, 0.04, 0.2, d * 0.72, color, 'paint');
      }
      for (const sx of [-1, 1]) for (const sz of [-1, 1]) {
        this.box(x + sx * (w / 2 - 0.3), WALL_H + 0.3, z + sz * (d / 2 - 0.3), 0.17, 0.12, 0.45, accent, 'glow');
      }
      if (block.kind === 'cargo') {
        for (let offset = -d / 2 + 0.65; offset < d / 2 - 0.4; offset += 0.7) this.box(x, WALL_H + 0.235, z + offset, w - 0.8, 0.055, 0.095, 0x24353a, 'metal');
        for (const side of [-1, 1]) this.box(x + side * w * 0.32, WALL_H + 0.28, z, 0.3, 0.08, d - 0.7, layout.secondary, 'paint');
      } else if (block.kind === 'reactor') {
        const r = Math.min(w, d) * 0.25;
        this.cylinder(x, WALL_H + 0.65, z, r, 1.1, 0x26343d);
        this.cylinder(x, WALL_H + 1.23, z, r * 0.94, 0.08, accent, true);
        this.cylinder(x, WALL_H + 1.34, z, r * 0.73, 0.18, 0x1e2c34);
        this.box(x, WALL_H + 0.42, z, Math.min(w - 1, r * 3.2), 0.3, 0.42, 0x879491, 'metal');
      } else if (block.kind === 'relay') {
        this.box(x, WALL_H + 0.62, z, Math.max(1.5, w * 0.48), 0.95, Math.max(1.5, d * 0.48), 0x293b46, 'metal');
        this.box(x, WALL_H + 1.14, z, w * 0.4, 0.085, d * 0.4, color, 'paint');
        for (let k = -1; k <= 1; k++) this.box(x + k * 0.46, WALL_H + 1.26, z, 0.2, 0.16, Math.min(2.2, d * 0.3), accent, 'glow');
        this.box(x + w * 0.28, WALL_H + 1.8, z - d * 0.25, 0.13, 2.4, 0.13, 0x8fa1a6, 'metal');
        this.box(x + w * 0.28, WALL_H + 2.85, z - d * 0.25, 0.6, 0.08, 0.13, layout.secondary, 'glow');
      } else {
        const count = Math.max(2, Math.floor(Math.max(w, d) / 2.5));
        for (let k = 0; k < count; k++) {
          const t = (k + 0.5) / count - 0.5;
          const px = x + (w > d ? t * (w - 1.6) : 0), pz = z + (w > d ? 0 : t * (d - 1.6));
          this.box(px, WALL_H + 0.38, pz, Math.min(1.35, w - 0.8), 0.42, Math.min(1.35, d - 0.8), 0x1c2a32, 'metal');
          for (let fin = -2; fin <= 2; fin++) this.box(px + fin * 0.19, WALL_H + 0.63, pz, 0.055, 0.11, 1.05, 0x738890, 'metal');
        }
      }
      if (index % 2 === 0) label(String(index + 1).padStart(2, '0'), x + w * 0.25, z + d * 0.2, Math.min(2.8, d * 0.38), 0xc4d0cc, WALL_H + 0.335);
    }
    for (const pad of game.level.spawnPoints) {
      this.floor(3.7, 3.7, pad.x, pad.z, 0x273c43, 0.04, 0.82);
      for (const side of [-1, 1]) {
        this.floor(0.14, 1.1, pad.x + side * 1.6, pad.z, accent, 0.059, 0.6);
        this.floor(1.1, 0.14, pad.x, pad.z + side * 1.6, accent, 0.059, 0.6);
      }
    }
    for (let p = -extent + 3; p <= extent - 3; p += 6) for (const side of [-1, 1]) {
      this.floor(1.1, 0.1, p, side * (extent - 0.8), accent, 0.047, 0.45);
      this.floor(0.1, 1.1, side * (extent - 0.8), p, accent, 0.047, 0.45);
    }
    this.flush(); this.buildLabels(labels); this.scene.add(this.group);
  }
  queue(kind, color, opacity, transform) {
    const key = kind + ':' + color + ':' + opacity;
    if (!this.batches.has(key)) this.batches.set(key, { kind, color, opacity, transforms: [] });
    this.batches.get(key).transforms.push(transform);
  }
  floor(w, d, x, z, color, y = 0.04, opacity = 1) { this.queue('floor', color, opacity, { x, y, z, w, h: 1, d }); }
  box(x, y, z, w, h, d, color, kind) { this.queue(kind, color, 1, { x, y, z, w, h, d }); }
  cylinder(x, y, z, radius, height, color, glow = false) { this.queue(glow ? 'cylinderGlow' : 'cylinder', color, 1, { x, y, z, w: radius, h: height, d: radius }); }
  ring(inner, outer, x, z, color, y, opacity) {
    const geometry = new THREE.RingGeometry(inner, outer, 64); geometry.rotateX(-Math.PI / 2);
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, toneMapped: false }));
    mesh.position.set(x, y, z); this.group.add(mesh);
  }
  chevron(x, z, angle, color, size) {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute([-0.55,0,-0.5, 0,0,0.45, 0,0,0.1, 0,0,0.45, 0.55,0,-0.5, 0,0,0.1], 3));
    const mesh = new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color, opacity: 0.62, transparent: true, side: THREE.DoubleSide, depthWrite: false, toneMapped: false }));
    mesh.position.set(x, 0.066, z); mesh.rotation.y = angle; mesh.scale.setScalar(size); this.group.add(mesh);
  }
  flush() {
    const matrix = new THREE.Matrix4(), pos = new THREE.Vector3(), scale = new THREE.Vector3(), quat = new THREE.Quaternion();
    for (const batch of this.batches.values()) {
      const floor = batch.kind === 'floor', cylinder = batch.kind.startsWith('cylinder');
      const geo = floor ? new THREE.PlaneGeometry(1, 1) : cylinder ? new THREE.CylinderGeometry(1, 1, 1, 18) : new THREE.BoxGeometry(1, 1, 1);
      if (floor) geo.rotateX(-Math.PI / 2);
      const glowing = batch.kind === 'glow' || batch.kind === 'cylinderGlow';
      const material = glowing ? new THREE.MeshBasicMaterial({ color: batch.color, toneMapped: false }) :
        new THREE.MeshStandardMaterial({ color: batch.color, roughness: floor ? 0.95 : batch.kind === 'paint' ? 0.74 : 0.46,
          metalness: floor ? 0.08 : 0.48, transparent: batch.opacity < 1, opacity: batch.opacity, depthWrite: !floor });
      const mesh = new THREE.InstancedMesh(geo, material, batch.transforms.length);
      batch.transforms.forEach((t, i) => { pos.set(t.x, t.y, t.z); scale.set(t.w, t.h, t.d); matrix.compose(pos, quat, scale); mesh.setMatrixAt(i, matrix); });
      mesh.instanceMatrix.needsUpdate = true; mesh.receiveShadow = !glowing; mesh.castShadow = !floor && !glowing;
      mesh.userData.arenaDetail = true; this.group.add(mesh);
    }
    this.batches.clear();
  }
  buildLabels(labels) {
    const canvas = document.createElement('canvas'); canvas.width = 1024; canvas.height = 512;
    const ctx = canvas.getContext('2d'); if (!ctx) return;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    labels.slice(0, 32).forEach((label, i) => {
      ctx.fillStyle = '#' + label.color.toString(16).padStart(6, '0');
      ctx.font = '700 ' + (label.text.length < 4 ? 46 : 23) + 'px monospace';
      ctx.fillText(label.text, (i % 4) * 256 + 128, Math.floor(i / 4) * 64 + 32, 245);
    });
    const texture = new THREE.CanvasTexture(canvas); this.textures.push(texture);
    texture.colorSpace = THREE.SRGBColorSpace; texture.magFilter = THREE.LinearFilter;
    texture.minFilter = THREE.LinearFilter; texture.generateMipmaps = false;
    const material = new THREE.MeshBasicMaterial({ map: texture, transparent: true, opacity: 0.76, depthWrite: false, toneMapped: false });
    labels.slice(0, 32).forEach((label, i) => {
      const geo = new THREE.PlaneGeometry(label.w, label.w / 4), uv = geo.attributes.uv;
      for (let k = 0; k < uv.count; k++) uv.setXY(k, (uv.getX(k) + i % 4) / 4, (uv.getY(k) + 7 - Math.floor(i / 4)) / 8);
      geo.rotateX(-Math.PI / 2);
      const mesh = new THREE.Mesh(geo, material); mesh.position.set(label.x, label.y, label.z); this.group.add(mesh);
    });
  }
  dispose() {
    this.scene.remove(this.group); disposeLevelGroup(this.group);
    for (const texture of this.textures) texture.dispose();
  }
}
