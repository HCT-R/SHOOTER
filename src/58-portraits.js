/* ========================================================================
   58-portraits.js — pixel portraits of the weapons
   ======================================================================== */

/* A shop card that says RAILGUN asks the player to remember what a railgun
   looks like. A card that shows the gun does not, and the player picks with
   their eyes instead of their memory.

   The portrait is rendered from the same geometry the marine actually carries,
   so it cannot drift from what buying the thing gives you. A hand-drawn icon
   would look better and would eventually lie; this one is always right by
   construction, including the day someone reshapes a model.

   Rendering happens once, in a throwaway renderer of its own. Borrowing the
   game's renderer would mean saving and restoring its render target, clear
   colour and alpha around a call that happens in the middle of a UI rebuild —
   a lot of state to put back correctly for a picture that is drawn once. The
   context is disposed as soon as the last portrait is in hand. */

const PORTRAIT_W = 160;
const PORTRAIT_H = 96;
/* Deliberately small, then scaled up by CSS with pixelated rendering: the game
   is a pixel shooter and a crisp high-resolution gun on the card would be the
   one thing on screen that is not. */

class WeaponPortraits {
  constructor() {
    this.cache = Object.create(null);
    this.built = false;
    this.failed = false;
  }

  /* Data URL for a weapon, or null when portraits are unavailable — every
     caller has to keep working without them. */
  get(id) {
    if (!this.built && !this.failed) this.build();
    return this.cache[id] || null;
  }

  build() {
    this.built = true;
    if (typeof THREE === 'undefined' || typeof document === 'undefined') { this.failed = true; return; }
    let renderer = null;
    try {
      const canvas = document.createElement('canvas');
      canvas.width = PORTRAIT_W;
      canvas.height = PORTRAIT_H;
      // preserveDrawingBuffer: toDataURL() reads the buffer back, and without
      // this the browser is free to have cleared it by the time we ask
      renderer = new THREE.WebGLRenderer({
        canvas: canvas, antialias: false, alpha: true, preserveDrawingBuffer: true
      });
      renderer.setPixelRatio(1);
      renderer.setSize(PORTRAIT_W, PORTRAIT_H, false);
      renderer.setClearColor(0x000000, 0);

      const scene = new THREE.Scene();
      // flat, high-contrast lighting: the portrait has to read as a silhouette
      // at card size, not as a well-lit still life
      scene.add(new THREE.AmbientLight(0xbcd8e4, 1.45));
      const key = new THREE.DirectionalLight(0xffffff, 1.9);
      key.position.set(-2.4, 3.2, 2.6);
      scene.add(key);
      const rim = new THREE.DirectionalLight(0x69eaff, 0.9);
      rim.position.set(2.6, -0.6, -2.2);
      scene.add(rim);

      const material = new THREE.MeshLambertMaterial({ vertexColors: true });
      const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.01, 40);
      const holder = new THREE.Object3D();
      scene.add(holder);

      for (const weapon of WEAPONS) {
        const geometry = WEAPON_GEO[weapon.id];
        if (!geometry) continue;
        const mesh = new THREE.Mesh(geometry, material);
        configureWeaponModel(mesh, weapon, material);
        /* Three-quarter view from the front left: the muzzle points along +Z,
           and a gun seen straight from the side hides everything that makes
           one weapon look different from another. */
        mesh.rotation.set(0.32, -2.25, 0.16);
        holder.add(mesh);

        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        const reach = (geometry.boundingSphere ? geometry.boundingSphere.radius : 0.5) * 1.16;
        const aspect = PORTRAIT_W / PORTRAIT_H;
        camera.left = -reach * aspect;
        camera.right = reach * aspect;
        camera.top = reach;
        camera.bottom = -reach;
        camera.position.set(0, 0, 12);
        camera.lookAt(0, 0, 0);
        camera.updateProjectionMatrix();

        renderer.render(scene, camera);
        this.cache[weapon.id] = renderer.domElement.toDataURL('image/png');
        holder.remove(mesh);
      }
      material.dispose();
    } catch (error) {
      // no WebGL, a blocked canvas readback, a tainted context: the cards fall
      // back to their text and nothing else notices
      this.failed = true;
      this.cache = Object.create(null);
    }
    if (renderer) {
      try { renderer.forceContextLoss(); } catch (error) { /* older builds */ }
      try { renderer.dispose(); } catch (error) { /* already gone */ }
    }
  }
}

/* One cache for the session: the geometry never changes at runtime, so the
   portraits never need rebuilding. */
const weaponPortraits = new WeaponPortraits();
