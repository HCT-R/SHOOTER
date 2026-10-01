/* ========================================================================
   58-portraits.js — cached studio portraits of carried and supplied equipment
   ======================================================================== */

const PORTRAIT_W = 320;
const PORTRAIT_H = 192;

/* Every portrait uses the same model as the field item. One temporary WebGL
   context renders the whole catalogue, then releases its private resources.
   Geometry and materials owned by the game are deliberately left alive. */
class WeaponPortraits {
  constructor() {
    this.cache = Object.create(null);
    this.itemCache = Object.create(null);
    this.built = false;
    this.failed = false;
  }

  get(id) {
    if (!this.built && !this.failed) this.build();
    return this.cache[id] || null;
  }

  getItem(kind, variant) {
    if (!this.built && !this.failed) this.build();
    const key = 'item:' + kind + (kind === 'ammo' ? ':' + (variant || 'supply') : '');
    return this.itemCache[key] || null;
  }

  build() {
    if (this.built) return;
    this.built = true;
    if (typeof THREE === 'undefined' || typeof document === 'undefined') { this.failed = true; return; }
    let renderer = null, material = null, shadowGeometry = null, shadowMaterial = null, shadowTexture = null;
    try {
      const canvas = document.createElement('canvas');
      renderer = new THREE.WebGLRenderer({
        canvas, antialias: true, alpha: true, preserveDrawingBuffer: true
      });
      renderer.setPixelRatio(1);
      renderer.setSize(PORTRAIT_W, PORTRAIT_H, false);
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.1;

      const scene = new THREE.Scene();
      scene.add(new THREE.AmbientLight(0xbcd8e4, 1.8));
      const key = new THREE.DirectionalLight(0xfff1df, 3.2);
      key.position.set(-2.4, 3.2, 2.6); scene.add(key);
      const rim = new THREE.DirectionalLight(0x69eaff, 0.9);
      rim.position.set(2.6, 0.6, -2.2); scene.add(rim);
      const fill = new THREE.DirectionalLight(0xc7d7df, 0.7);
      fill.position.set(1, 2, 5); scene.add(fill);

      const shadowCanvas = document.createElement('canvas');
      shadowCanvas.width = shadowCanvas.height = 64;
      const ctx = shadowCanvas.getContext('2d');
      const gradient = ctx.createRadialGradient(32, 32, 0, 32, 32, 32);
      gradient.addColorStop(0, 'rgba(0,0,0,0.32)');
      gradient.addColorStop(0.4, 'rgba(0,0,0,0.18)');
      gradient.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gradient; ctx.fillRect(0, 0, 64, 64);
      shadowTexture = new THREE.CanvasTexture(shadowCanvas);
      shadowGeometry = new THREE.PlaneGeometry(1, 1);
      shadowMaterial = new THREE.MeshBasicMaterial({ map: shadowTexture, transparent: true, depthWrite: false });
      const shadow = new THREE.Mesh(shadowGeometry, shadowMaterial); scene.add(shadow);

      material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
      camera.position.set(0, 0, 12); camera.lookAt(0, 0, 0);
      const holder = new THREE.Object3D(); scene.add(holder);
      const bounds = new THREE.Box3(), center = new THREE.Vector3(), size = new THREE.Vector3();
      const renderPortrait = (mesh, consumable, melee = false) => {
        // Cases stay upright: their lid, latches and medical markings must
        // all be readable at card size under the same studio lighting.
        mesh.rotation.set(consumable ? 0.34 : melee ? 0.94 : 0.32,
          consumable ? -0.62 : melee ? -2.05 : -2.25, consumable ? 0 : melee ? -0.06 : 0.16);
        holder.add(mesh); holder.position.set(0, 0, 0); holder.updateWorldMatrix(true, true);
        bounds.setFromObject(mesh); bounds.getCenter(center); bounds.getSize(size);
        holder.position.copy(center).multiplyScalar(-1);
        const aspect = PORTRAIT_W / PORTRAIT_H;
        const reach = Math.max(size.y * 0.5, size.x / aspect * 0.5, 0.01) * 1.2;
        camera.left = -reach * aspect; camera.right = reach * aspect;
        camera.top = reach; camera.bottom = -reach; camera.updateProjectionMatrix();
        shadow.position.set(0, -size.y * 0.47, -size.z * 0.5 - 0.1);
        shadow.scale.set(size.x * 1.04, Math.max(size.y * 0.15, size.x * 0.06), 1);
        renderer.render(scene, camera);
        const image = renderer.domElement.toDataURL('image/png');
        holder.remove(mesh);
        return image;
      };

      for (const weapon of WEAPONS) {
        const geometry = WEAPON_GEO[weapon.geo];
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, material);
        configureWeaponModel(mesh, weapon, material);
        this.cache[weapon.id] = renderPortrait(mesh, false, weapon.fire === 'melee');
      }
      const variants = ['supply', ...Object.keys(AMMO_TYPES).filter(id => id !== 'none')];
      for (const variant of variants) {
        this.itemCache['item:ammo:' + variant] = renderPortrait(createPickupModel('ammo', variant), true);
      }
      for (const kind of ['health', 'bigHealth']) {
        this.itemCache['item:' + kind] = renderPortrait(createPickupModel(kind), true);
      }
    } catch (error) {
      // A browser without WebGL still has complete labels and buy controls.
      this.failed = true;
      this.cache = Object.create(null); this.itemCache = Object.create(null);
    } finally {
      if (material) material.dispose();
      if (shadowMaterial) shadowMaterial.dispose();
      if (shadowGeometry) shadowGeometry.dispose();
      if (shadowTexture) shadowTexture.dispose();
      if (renderer) {
        try { renderer.forceContextLoss(); } catch (error) { /* older builds */ }
        try { renderer.dispose(); } catch (error) { /* already gone */ }
      }
    }
  }
}

const weaponPortraits = new WeaponPortraits();
