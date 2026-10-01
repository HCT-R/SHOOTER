/* ========================================================================
   80-player.js — input, marine controller, weapon handling
   ======================================================================== */

/* ------------------------------------------------------------- controls */
/* The game asks for actions, never for key codes. Everything downstream —
   rebinding, a gamepad, button prompts, a future Steam Deck layout — is then
   a matter of what an action is bound to, not of editing the controller.

   Weapon digits and the doctrine cards stay literal: they are positional
   ("the third one"), not named actions, and rebinding them would only make
   the on-screen numbers lie. */
const ACTIONS = [
  { id: 'interact', label: 'Взаимодействовать', keys: ['KeyV'], pad: [10] },
  { id: 'heal', label: 'Аптечка', keys: ['KeyH'], pad: [11] },
  { id: 'moveUp', label: 'Вперёд', keys: ['KeyW', 'ArrowUp'], pad: [12] },
  { id: 'moveDown', label: 'Назад', keys: ['KeyS', 'ArrowDown'], pad: [13] },
  { id: 'moveLeft', label: 'Влево', keys: ['KeyA', 'ArrowLeft'], pad: [14] },
  { id: 'moveRight', label: 'Вправо', keys: ['KeyD', 'ArrowRight'], pad: [15] },
  { id: 'sprint', label: 'Бег', keys: ['ShiftLeft', 'ShiftRight'] },
  { id: 'dash', label: 'Рывок', keys: ['Space'], pad: [0] },
  { id: 'grenade', label: 'Граната', keys: ['KeyG'], pad: [1] },
  { id: 'reload', label: 'Перезарядка', keys: ['KeyR'], pad: [2] },
  { id: 'torch', label: 'Фонарь', keys: ['KeyF'], pad: [3] },
  { id: 'prevWeapon', label: 'Предыдущее оружие', keys: ['KeyQ'], pad: [4] },
  { id: 'nextWeapon', label: 'Следующее оружие', keys: ['KeyE'], pad: [5] },
  { id: 'aim', label: 'Прицеливание', keys: [], pad: [6] },
  { id: 'fire', label: 'Огонь', keys: [], pad: [7] },
  { id: 'shop', label: 'Склад снабжения', keys: ['KeyB'], pad: [8] },
  { id: 'pause', label: 'Пауза', keys: ['Escape', 'KeyP'], pad: [9] },
  { id: 'music', label: 'Музыка', keys: ['KeyM'] },
  { id: 'nextWave', label: 'Начать волну досрочно', keys: ['KeyN'] }
];

const ACTION_BY_ID = {};
for (const action of ACTIONS) ACTION_BY_ID[action.id] = action;

/* At most this many keys per action: the rebinding panel has to stay readable,
   and an unbounded list in a hand-edited profile is a memory question. */
const MAX_BINDS_PER_ACTION = 3;

function defaultBinds() {
  const out = {};
  for (const action of ACTIONS) out[action.id] = action.keys.slice();
  return out;
}

/* Key codes arrive from the profile, which is text the player can edit. Only
   the shapes the browser actually emits are accepted; anything else is
   dropped rather than trusted, and an action left with nothing falls back to
   its default instead of becoming unusable. */
const KEY_CODE = /^(?:Key[A-Z]|Digit[0-9]|Arrow(?:Up|Down|Left|Right)|F[1-9][0-9]?|Numpad[0-9]|Shift(?:Left|Right)|Control(?:Left|Right)|Alt(?:Left|Right)|Space|Enter|Escape|Tab|Backquote|Minus|Equal|Bracket(?:Left|Right)|Backslash|Semicolon|Quote|Comma|Period|Slash)$/;

function clampBinds(value) {
  const out = defaultBinds();
  if (!value || typeof value !== 'object') return out;
  for (const action of ACTIONS) {
    const raw = value[action.id];
    if (!Array.isArray(raw)) continue;
    const codes = [];
    for (const code of raw) {
      if (typeof code !== 'string' || !KEY_CODE.test(code)) continue;
      if (codes.indexOf(code) < 0) codes.push(code);
      if (codes.length >= MAX_BINDS_PER_ACTION) break;
    }
    // an explicitly empty list is a deliberate unbind and is kept; a list that
    // held nothing usable at all falls back to the default
    if (codes.length || raw.length === 0) out[action.id] = codes;
  }
  return out;
}

function loadBinds() {
  let raw;
  try { raw = JSON.parse(store.get('binds', '{}')); } catch (error) { raw = null; }
  return clampBinds(raw);
}

function saveBinds(binds) {
  return store.set('binds', clampBinds(binds));
}

/* Left stick below this is treated as centred: sticks rest off-centre, and a
   marine that drifts on his own reads as a bug rather than as analogue. */
const PAD_DEADZONE = 0.28;
const PAD_TRIGGER = 0.4;

class InputState {
  constructor(dom) {
    this.keys = Object.create(null);
    this.pressed = Object.create(null);
    this.mouseDown = false;
    this.mousePressed = false; this.rightPressed = false;
    this.rightDown = false;
    this.mx = 0;
    this.my = 0;
    this.wheel = 0;
    this.dom = dom;
    this.binds = loadBinds();
    // the pad is sampled once per tick, exactly like the keyboard, so a
    // frame that runs no tick cannot swallow or repeat a button
    this.padIndex = -1;
    this.padButtons = [];
    this.padPressed = Object.create(null);
    this.padAxes = [0, 0, 0, 0];
    this.padActive = false;

    this._onKeyDown = (e) => {
      if (InputState.isEditable(e.target)) { this.clear(); return; }
      const k = e.code;
      if (!this.keys[k]) this.pressed[k] = true;
      this.keys[k] = true;
      // stop the browser scrolling / quick-finding under the game
      if (document.body.classList.contains('playing') && ['Space', 'Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Slash', 'Quote'].indexOf(k) >= 0) {
        e.preventDefault();
      }
    };
    this._onKeyUp = (e) => { this.keys[e.code] = false; };
    this._onMove = (e) => {
      const r = dom.getBoundingClientRect();
      this.mx = ((e.clientX - r.left) / r.width) * 2 - 1;
      this.my = -((e.clientY - r.top) / r.height) * 2 + 1;
    };
    this._onDown = (e) => {
      if (InputState.isEditable(e.target)) { this.clear(); return; }
      if (e.button === 0) {
        if (!this.mouseDown) this.mousePressed = true;
        this.mouseDown = true;
      }
      if (e.button === 2) { if (!this.rightDown) this.rightPressed = true; this.rightDown = true; }
    };
    this._onUp = (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.rightDown = false;
    };
    this._onWheel = (e) => { this.wheel += Math.sign(e.deltaY); e.preventDefault(); };
    this._onBlur = () => this.clear();
    this._onFocus = (e) => { if (InputState.isEditable(e.target)) this.clear(); };

    window.addEventListener('keydown', this._onKeyDown);
    window.addEventListener('keyup', this._onKeyUp);
    window.addEventListener('blur', this._onBlur);
    window.addEventListener('focusin', this._onFocus);
    window.addEventListener('focusout', this._onFocus);
    dom.addEventListener('mousemove', this._onMove);
    dom.addEventListener('mousedown', this._onDown);
    window.addEventListener('mouseup', this._onUp);
    dom.addEventListener('wheel', this._onWheel, { passive: false });
    dom.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  static isEditable(target) {
    return !!target && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
  }

  clear() {
    this.keys = Object.create(null);
    this.pressed = Object.create(null);
    this.padPressed = Object.create(null);
    this.padButtons = [];
    this.wheel = 0;
    this.mouseDown = this.rightDown = false;
    this.mousePressed = false; this.rightPressed = false;
  }

  /* The whole game asks through these two. A key and a pad button are the
     same thing to a caller: the action is either held or it fired. */
  actionDown(id) {
    const codes = this.binds[id];
    if (codes) for (let i = 0; i < codes.length; i++) if (this.keys[codes[i]]) return true;
    const buttons = ACTION_BY_ID[id] && ACTION_BY_ID[id].pad;
    if (buttons) for (let i = 0; i < buttons.length; i++) if (this.padButtons[buttons[i]]) return true;
    return false;
  }

  actionOnce(id) {
    const codes = this.binds[id];
    let fired = false;
    // every bound source is consumed, not just the first: leaving one
    // latched would fire the action again on the next tick
    if (codes) for (let i = 0; i < codes.length; i++) if (this.once(codes[i])) fired = true;
    const buttons = ACTION_BY_ID[id] && ACTION_BY_ID[id].pad;
    if (buttons) for (let i = 0; i < buttons.length; i++) {
      if (this.padPressed[buttons[i]]) { this.padPressed[buttons[i]] = false; fired = true; }
    }
    return fired;
  }

  rebind(id, codes) {
    if (!ACTION_BY_ID[id]) return false;
    const next = Object.assign({}, this.binds);
    next[id] = codes;
    this.binds = clampBinds(next);
    saveBinds(this.binds);
    return true;
  }

  resetBinds() {
    this.binds = defaultBinds();
    saveBinds(this.binds);
  }

  /* Poll the pad once per tick. Edges are derived here rather than from
     events because the Gamepad API has none. */
  pollPad() {
    const pads = (typeof navigator !== 'undefined' && navigator.getGamepads) ? navigator.getGamepads() : null;
    let pad = null;
    if (pads) for (let i = 0; i < pads.length; i++) if (pads[i] && pads[i].connected !== false) { pad = pads[i]; break; }
    if (!pad) {
      if (this.padActive) { this.padButtons = []; this.padPressed = Object.create(null); this.padAxes = [0, 0, 0, 0]; }
      this.padActive = false;
      return false;
    }
    this.padActive = true;
    const buttons = pad.buttons || [];
    for (let i = 0; i < buttons.length; i++) {
      const b = buttons[i];
      const held = typeof b === 'number' ? b > PAD_TRIGGER : !!(b && (b.pressed || b.value > PAD_TRIGGER));
      if (held && !this.padButtons[i]) this.padPressed[i] = true;
      this.padButtons[i] = held;
    }
    const axes = pad.axes || [];
    for (let i = 0; i < 4; i++) this.padAxes[i] = typeof axes[i] === 'number' ? axes[i] : 0;
    return true;
  }

  /* Analogue stick past the deadzone, rescaled so the first usable value is
     a slow walk instead of a jump to a third of full speed. */
  stick(xAxis, zAxis) {
    const x = this.padAxes[xAxis] || 0, z = this.padAxes[zAxis] || 0;
    const len = Math.hypot(x, z);
    if (len < PAD_DEADZONE) return null;
    const scaled = Math.min(1, (len - PAD_DEADZONE) / (1 - PAD_DEADZONE));
    return { x: (x / len) * scaled, z: (z / len) * scaled, len: scaled };
  }

  /* Menus activate on the pad button alone. Enter and Space already click
     a focused button through the browser, so reading them as an action
     here would press the same button twice. */
  padOnce(button) {
    if (this.padPressed[button]) { this.padPressed[button] = false; return true; }
    return false;
  }

  once(code) {
    if (this.pressed[code]) { this.pressed[code] = false; return true; }
    return false;
  }
  down(code) { return !!this.keys[code]; }
  endFrame() {
    this.pressed = Object.create(null);
    this.padPressed = Object.create(null);
    this.wheel = 0;
    this.mousePressed = false; this.rightPressed = false;
  }
}

/* Barrel heat is cosmetic and only drives smoke after a burst. It is
   deliberately not a jam or an accuracy penalty: the player should read it
   as the weapon having worked hard, not as something they must manage. */
const BARREL_HEAT_MAX = 12;
const BARREL_COOL = 3.2;
const BARREL_SMOKE = 4;

const PLAYER_RADIUS = 0.42;
const PLAYER_SPEED = 7.4;
const SPRINT_MULT = 1.42;
const WEAPON_VISUAL_SCALE = 1.35;

class Player {
  constructor(game) {
    this.game = game;
    const m = buildPlayer(loadLook());
    this.model = m;
    this.root = m.root;
    game.scene.add(this.root);

    this.weaponMesh = new THREE.Mesh(WEAPON_GEO.pistol, m.material);
    this.weaponMesh.scale.setScalar(WEAPON_VISUAL_SCALE);
    this.weaponMesh.castShadow = true;
    m.weaponPivot.add(this.weaponMesh);
    configureWeaponModel(this.weaponMesh, WEAPON_BY_ID.pistol, m.material);
    this._weaponPoseState = { aiming: false, recoil: 0, movement: 0, phase: 0,
      bob: 0, reloadProgress: -1, spin: 0, dt: 0 };

    /* X-ray silhouette: pillars and wall corners sit between the camera and
       the marine at this angle, and losing the player behind one is fatal.
       The silhouette ignores depth and is drawn first in the transparent
       queue; the solid model then draws over it wherever it is actually
       visible, so the outline only shows through when he is occluded. */
    const silGeo = mergeParts([
      part(G.box, { pos: [0, 1.16, 0], scale: [0.64, 0.68, 0.44], color: 0xffffff }),
      part(G.sph, { pos: [0, 1.62, 0.02], scale: [0.25, 0.27, 0.26], color: 0xffffff }),
      part(G.box, { pos: [-0.17, 0.56, 0], scale: [0.24, 0.64, 0.26], color: 0xffffff }),
      part(G.box, { pos: [0.17, 0.56, 0], scale: [0.24, 0.64, 0.26], color: 0xffffff })
    ]);
    this.silhouette = new THREE.Mesh(silGeo, new THREE.MeshBasicMaterial({
      color: 0x74ecff, transparent: true, opacity: 0.5,
      depthTest: false, depthWrite: false, toneMapped: false
    }));
    this.silhouette.renderOrder = 4;
    this.silhouette.frustumCulled = false;
    game.scene.add(this.silhouette);

    // The local marine has open corner brackets, never an opponent's ring.
    // All geometry is built once; animation only changes transforms/colors.
    this.selfReadout = new THREE.Group();
    this.selfReadout.name = 'local-player-readout';
    const bracketParts = [];
    for (const x of [-1, 1]) for (const z of [-1, 1]) {
      bracketParts.push(part(G.box, { pos: [x * 0.67, 0, z * 0.8], scale: [0.34, 0.008, 0.065], color: 0xffffff }));
      bracketParts.push(part(G.box, { pos: [x * 0.8, 0, z * 0.67], scale: [0.065, 0.008, 0.34], color: 0xffffff }));
    }
    this.selfBrackets = new THREE.Mesh(mergeParts(bracketParts), new THREE.MeshBasicMaterial({
      color: 0x6ce8ff, transparent: true, opacity: 0.8, depthWrite: false, toneMapped: false
    }));
    this.selfBrackets.renderOrder = 4;
    this.selfReadout.add(this.selfBrackets);
    const chevron = new THREE.BufferGeometry();
    chevron.setAttribute('position', new THREE.Float32BufferAttribute([
      -0.19, 0, -0.1, 0, 0, 0.19, 0, 0, 0.05,
      0.19, 0, -0.1, 0, 0, 0.05, 0, 0, 0.19
    ], 3));
    this.selfDirection = new THREE.Mesh(chevron, new THREE.MeshBasicMaterial({
      color: 0xd5faff, side: THREE.DoubleSide, transparent: true, opacity: 0.95,
      depthWrite: false, toneMapped: false
    }));
    this.selfDirection.renderOrder = 4;
    this.selfReadout.add(this.selfDirection);
    const barGeo = new THREE.BoxGeometry(1, 0.012, 0.09);
    this.reloadTrack = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({
      color: 0x0b202e, transparent: true, opacity: 0.9, depthWrite: false, toneMapped: false
    }));
    this.reloadTrack.position.set(0, 0.005, 1.35); this.reloadTrack.scale.x = 1.26;
    this.reloadFill = new THREE.Mesh(barGeo, new THREE.MeshBasicMaterial({
      color: 0xffd082, transparent: true, opacity: 1, depthWrite: false, toneMapped: false
    }));
    this.reloadFill.position.set(0, 0.018, 1.35);
    this.reloadTrack.renderOrder = 4; this.reloadFill.renderOrder = 5;
    this.selfReadout.add(this.reloadTrack, this.reloadFill);
    this._selfColor = new THREE.Color(0x6ce8ff);
    this._selfHurtColor = new THREE.Color(0xff796d);
    game.scene.add(this.selfReadout);

    // put the solid marine into the transparent queue just after the
    // silhouette so the draw order above actually holds
    m.material.transparent = true;
    m.material.opacity = 1;
    this.root.traverse((o) => { if (o.isMesh) o.renderOrder = 5; });

    // a spotlight cone from the muzzle sells the darkness of the facility
    this.torch = new THREE.SpotLight(0xffe6c0, 95, 36, 0.62, 0.78, 1.5);
    this.torch.position.set(0, 1.3, 0);
    this.torchTarget = new THREE.Object3D();
    game.scene.add(this.torchTarget);
    this.torch.target = this.torchTarget;
    this.root.add(this.torch);
    this.torchOn = true;

    // a soft pool of light around the marine so he and whatever is clawing at
    // him stay readable even with the flashlight pointed elsewhere
    this.suitLight = new THREE.PointLight(0xbcd8ff, 9, 11, 1.6);
    this.suitLight.position.set(0, 1.5, 0);
    this.root.add(this.suitLight);

    this._ignore = new Set();
    this._radiusHits = [];
    this._chainHits = [];
    // ЦЕПНОЙ ОЖОГ runs inside dealDamage, which arcShot calls while it still
    // holds _chainHits, so the conduction needs a scratch array of its own
    this._burnChainHits = [];
    this._conducting = false;
    this.grenadeMesh = new THREE.Mesh(
      new THREE.IcosahedronGeometry(0.19, 1),
      new THREE.MeshStandardMaterial({ color: 0x3b5960, emissive: 0x53e8d1, emissiveIntensity: 1.5, metalness: 0.7, roughness: 0.3 })
    );
    this.grenadeMesh.castShadow = true;
    game.scene.add(this.grenadeMesh);
    this.reset();
  }

  /* swap the visible rig for a new customization without touching state,
     lights or the equipped weapon mesh */
  applyLook(look) {
    const old = this.model;
    const pieces = [old.upperBody, old.legL, old.legR];
    old.weaponPivot.remove(this.weaponMesh);
    const disposed = new Set();
    for (const piece of pieces) {
      piece.traverse((o) => {
        if (o.isMesh && !o.geometry.userData.shared && !disposed.has(o.geometry)) {
          disposed.add(o.geometry);
          o.geometry.dispose();
        }
      });
      this.root.remove(piece);
    }
    old.material.dispose();

    const m = buildPlayer(look || loadLook());
    this.model = m;
    this.root.add(m.upperBody, m.legL, m.legR);
    m.root = this.root;
    m.material.transparent = true;
    m.material.opacity = 1;
    this.weaponMesh.material = m.material;
    m.weaponPivot.add(this.weaponMesh);
    configureWeaponModel(this.weaponMesh, this.weapon, m.material);
    this.root.traverse((o) => { if (o.isMesh) o.renderOrder = 5; });
    this.updateModel(0, Math.hypot(this.vx, this.vz));
  }

  reset() {
    const l = this.game.level;
    this.x = l.start.x;
    this.z = l.start.z;
    this.vx = 0; this.vz = 0;
    this.kx = 0; this.kz = 0;
    this.angle = 0;
    this.hp = 100; this.maxHp = 100;
    this.armor = 0; this.maxArmor = 100;
    this.alive = true;

    this.owned = { pistol: true, knife: true };
    this.meleeId = 'knife';
    this.mags = { pistol: WEAPON_BY_ID.pistol.mag };
    this.ammo = Object.fromEntries(Object.keys(AMMO_TYPES).filter(id => id !== 'none').map(id => [id, 0]));
    this.damageMultiplier = 1;
    this.reloadMultiplier = 1;
    // crit knobs are run-local and multiply the per-weapon table, so field
    // upgrades and perks can raise either the frequency or the payoff
    this.critScale = 1;
    this.critPower = 1;
    // perk-facing multipliers; every one of them is neutral at 1 so a fresh
    // run behaves exactly as it did before perks existed
    this.speedScale = 1;
    this.dashCooldown = 1.5;
    this.burnScale = 1;
    this.splashScale = 1;
    this.chainBonus = 0;
    this.pierceBonus = 0;
    this.burnChains = false;
    this.weaponIndex = 0;
    this.fireTimer = 0;
    this._burstRemaining = 0; this._burstTimer = 0; this._burstAimX = this._burstAimZ = 0;
    this.meleeAttack = null; this.meleeSequence = 0;
    this.reloading = 0;
    this.reloadTotal = 0;
    this.spin = 0;
    this.recoil = 0;
    this.walkPhase = 0;
    this.dashTimer = 0;
    this.dashCd = 0;
    this.dashX = 0;
    this.dashZ = 0;
    this.grenadeCd = 0;
    this.grenadeCooldown = 8;
    this.grenadeRange = 18;
    this.grenade = null;
    this.grenadeMesh.visible = false;
    this.aiming = false;
    this.bloom = 0;
    this.barrelHeat = 0;
    this._smokeTimer = 0;
    this.spreadScale = 1;
    this._footstepT = 0;
    this.triggerLatched = false;
    this.invuln = 0;
    this.hurtFlash = 0;
    this.lastDamageTime = -99;
    this.flameTick = 0;
    this.firedThisFrame = false;
    this._shotHitConfirmed = false;

    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.set(0, 0, 0);
    this.silhouette.position.set(this.x, 0, this.z);
    this.silhouette.rotation.set(0, 0, 0);
    this.setWeapon(0);
    this.updateModel(0, 0);
  }

  get weapon() { return WEAPONS[this.weaponIndex]; }
  get mag() { return this.mags[this.weapon.id] || 0; }
  get reserve() {
    const w = this.weapon;
    if (this.game.arena?.self?.reserveLimited) return this.game.arena.self.reserve || 0;
    return w.ammo === 'none' ? Infinity : this.ammo[w.ammo];
  }

  ownedList() {
    const out = [];
    for (let i = 0; i < WEAPONS.length; i++) if (this.owned[WEAPONS[i].id]) out.push(i);
    return out;
  }

  /* Weapons that occupy a harness slot. The sidearm is carried for free. */
  carriedList() {
    return this.ownedList().filter(i => WEAPONS[i].slot === 'primary');
  }

  loadoutList() {
    if (this.game.arena && Array.isArray(this.weaponSlots)) {
      return this.weaponSlots.map(id => WEAPONS.findIndex(w => w.id === id)).filter(index => index >= 0);
    }
    const out = [], sidearm = WEAPONS.findIndex(w => w.id === 'pistol');
    if (this.owned.pistol) out.push(sidearm);
    out.push(...this.carriedList().slice(0, ARSENAL_SLOTS));
    const melee = WEAPONS.findIndex(w => w.id === this.meleeId && this.owned[w.id]);
    if (melee >= 0) out.push(melee);
    return out;
  }

  arsenalFull() { return this.carriedList().length >= ARSENAL_SLOTS; }

  /* Giving up a weapon returns its slot. The sidearm cannot be dropped, and
     dropping whatever is in hand falls back to it rather than to nothing. */
  dropWeapon(id) {
    if (id === 'pistol' || id === 'knife' || !this.owned[id] || this.meleeAttack || this._burstRemaining > 0) return false;
    const wasHeld = this.weapon.id === id;
    delete this.owned[id];
    delete this.mags[id];
    if (this.meleeId === id) this.meleeId = 'knife';
    if (wasHeld) {
      this.reloading = 0;
      this.reloadTotal = 0;
      this.spin = 0;
      this.setWeapon(WEAPONS.findIndex((w) => w.id === 'pistol'));
    }
    return true;
  }

  setWeapon(index) {
    if (this.meleeAttack || this._burstRemaining > 0) return;
    const w = WEAPONS[index];
    if (!w || !this.owned[w.id]) return;
    if (this.weaponIndex === index && this.weaponMesh.geometry === WEAPON_GEO[w.geo]) return;
    this.weaponIndex = index;
    if (w.fire === 'melee') this.meleeId = w.id;
    this.weaponMesh.geometry = WEAPON_GEO[w.geo];
    configureWeaponModel(this.weaponMesh, w, this.model.material);
    this.reloading = 0;
    this.spin = 0;
    this.bloom = 0;
    this.barrelHeat = 0;
    this.triggerLatched = false;
    sfx.spinup(false, 0);
    sfx.flameStop();
    if (this.mags[w.id] === undefined) this.mags[w.id] = 0;
    sfx.reload('swap');
    this.updateModel(0, Math.hypot(this.vx, this.vz));
  }

  cycleWeapon(dir) {
    const list = this.loadoutList();
    if (list.length < 2) return;
    let at = list.indexOf(this.weaponIndex);
    at = (at + dir + list.length) % list.length;
    this.setWeapon(list[at]);
  }

  giveWeapon(id) {
    const w = WEAPON_BY_ID[id];
    if (!w) return false;
    const isNew = !this.owned[id];
    this.owned[id] = true;
    if (isNew) {
      this.mags[id] = w.mag;
      if (w.ammo !== 'none') {
        this.ammo[w.ammo] = Math.min(AMMO_TYPES[w.ammo].max, this.ammo[w.ammo] + AMMO_PICKUP[w.ammo] * 1.5);
      }
      this.setWeapon(WEAPONS.indexOf(w));
    } else if (w.ammo !== 'none') {
      this.ammo[w.ammo] = Math.min(AMMO_TYPES[w.ammo].max, this.ammo[w.ammo] + AMMO_PICKUP[w.ammo]);
    }
    return isNew;
  }

  giveAmmo(type, amount) {
    const cap = AMMO_TYPES[type].max;
    if (this.ammo[type] >= cap) return false;
    this.ammo[type] = Math.min(cap, this.ammo[type] + amount);
    return true;
  }

  heal(v) {
    if (this.hp >= this.maxHp) return false;
    this.hp = Math.min(this.maxHp, this.hp + v);
    return true;
  }

  addArmor(v) {
    if (this.armor >= this.maxArmor) return false;
    this.armor = Math.min(this.maxArmor, this.armor + v);
    return true;
  }

  startReload() {
    const w = this.weapon;
    if (w.usesAmmo === false || this.meleeAttack || this._burstRemaining > 0) return;
    if (this.reloading > 0) return;
    if (this.mag >= w.mag) return;
    if (w.ammo !== 'none' && this.ammo[w.ammo] <= 0) return;
    this.reloading = w.reload * this.reloadMultiplier;
    this.reloadTotal = this.reloading;
    sfx.reload('out', w.reloadStyle || w.id);
  }

  finishReload() {
    const w = this.weapon;
    const need = w.mag - this.mag;
    if (w.ammo === 'none') {
      this.mags[w.id] = w.mag;
    } else {
      const take = Math.min(w.shellReload ? 1 : need, this.ammo[w.ammo]);
      this.mags[w.id] = this.mag + take;
      this.ammo[w.ammo] -= take;
    }
    sfx.reload('in', w.reloadStyle || w.id);
    if (w.shellReload && this.mag < w.mag && this.reserve > 0) {
      this.reloading = (w.shellTime || w.reload) * this.reloadMultiplier;
      this.reloadTotal = this.reloading;
    }
  }

  throwGrenade(aimX, aimZ) {
    if (!this.alive || this.grenadeCd > 0 || this.grenade) return false;
    const dx = aimX - this.x, dz = aimZ - this.z;
    const len = Math.hypot(dx, dz);
    const dirX = len > 0.05 ? dx / len : Math.sin(this.angle);
    const dirZ = len > 0.05 ? dz / len : Math.cos(this.angle);
    let distance = clamp(len, 2.5, this.grenadeRange);
    const wall = this.game.level.raycastWall(this.x, this.z, dirX, dirZ, distance);
    if (wall) distance = Math.max(0, wall.dist - 0.45);
    this.grenade = {
      sx: this.x, sz: this.z,
      tx: this.x + dirX * distance, tz: this.z + dirZ * distance,
      time: 0, flight: 0.45 + distance * 0.018, fuse: 0.28,
      damage: 170 * this.damageMultiplier * this.splashScale,
      radius: 5.6 * Math.sqrt(this.splashScale)
    };
    this.grenadeCd = this.grenadeCooldown;
    this.grenadeMesh.visible = true;
    this.grenadeMesh.position.set(this.x, 1.2, this.z);
    sfx.grenade('throw');
    return true;
  }

  updateGrenade(dt) {
    const a = this.grenade;
    if (!a) return;
    a.time += dt;
    const t = clamp(a.time / a.flight, 0, 1);
    const x = lerp(a.sx, a.tx, t), z = lerp(a.sz, a.tz, t);
    const y = lerp(1.2, 0.23, t) + Math.sin(t * Math.PI) * 3;
    this.grenadeMesh.position.set(x, y, z);
    this.grenadeMesh.rotation.x += dt * 11;
    this.grenadeMesh.rotation.z += dt * 7;
    this.grenadeMesh.material.emissiveIntensity = t < 1 ? 1.5 : 2 + Math.sin(a.time * 55) * 1.8;
    this.game.fx.sparks.emit(x, y, z, 0, 0.2, 0, 0.2, 0.17, 0x7effdc, 0);
    if (a.time >= a.flight + a.fuse) {
      this.grenade = null;
      this.grenadeMesh.visible = false;
      this.game.explosion(a.tx, 0.35, a.tz, a.damage, a.radius, false, this.id || 'campaign-player');
      sfx.grenade('detonate');
    }
  }

  takeDamage(amount, srcX, srcZ) {
    if (!this.alive || this.invuln > 0) return;
    // armour eats most of the hit but degrades as it does
    const mitigated = CombatCore.mitigateDamage(amount, this.armor, .62);
    this.armor = mitigated.armor; amount = mitigated.damage;
    this.hp -= amount;
    this.hurtFlash = 1;
    this.invuln = 0.28;
    this.lastDamageTime = this.game.time;
    sfx.hurt();

    const g = this.game;
    const a = Math.atan2(this.x - srcX, this.z - srcZ);
    if (g.hud && g.hud.damageIndicator) g.hud.damageIndicator(srcX, srcZ, amount);
    g.shake(Math.min(7, 2 + amount * 0.09), 0.28, Math.sin(a), Math.cos(a));
    g.fx.sparks.burst(this.x, 1.2, this.z, 6, 4, 0.4, 0.32, 0xd41a1a, 0.7, 12);
    g.fx.decals.blood(this.x + Math.sin(a) * 0.5, this.z + Math.cos(a) * 0.5, 1.6, 0xff8888);

    if (this.hp <= 0) {
      this.hp = 0;
      this.alive = false;
      this.selfReadout.visible = false;
      this.meleeAttack = null; this._burstRemaining = 0;
      g.onPlayerDeath();
    }
  }

  /* ------------------------------------------------------------------ */
  update(dt, input, aimX, aimZ) {
    const g = this.game;
    if (!this.alive) {
      this.root.rotation.z = damp(this.root.rotation.z, Math.PI * 0.42, 4, dt);
      this.root.position.y = damp(this.root.position.y, 0.1, 4, dt);
      return;
    }

    this.firedThisFrame = false;
    if (this.invuln > 0) this.invuln -= dt;
    if (this.hurtFlash > 0) this.hurtFlash = Math.max(0, this.hurtFlash - dt * 2.2);
    if (this.dashCd > 0) this.dashCd -= dt;
    this.grenadeCd = Math.max(0, this.grenadeCd - dt);
    this.bloom = damp(this.bloom, 0, 4.8, dt);
    this.aiming = this.weapon.fire !== 'melee' && (input.rightDown || input.actionDown('aim'));
    this.updateGrenade(dt);

    /* --- aim ------------------------------------------------------- */
    const adx = aimX - this.x, adz = aimZ - this.z;
    if (adx * adx + adz * adz > 0.04) {
      this.angle = angleLerp(this.angle, Math.atan2(adx, adz), Math.min(1, 22 * dt));
    }

    /* --- movement -------------------------------------------------- */
    let mx = 0, mz = 0;
    /* The camera sits at +Z looking down at -Z, so screen-up (forward) is
       world -Z. W must therefore subtract from mz, not add. */
    if (input.actionDown('moveUp')) mz -= 1;
    if (input.actionDown('moveDown')) mz += 1;
    if (input.actionDown('moveLeft')) mx -= 1;
    if (input.actionDown('moveRight')) mx += 1;
    // keys are digital, so a diagonal is normalised: WA must not outrun W
    let mlen = Math.hypot(mx, mz);
    if (mlen > 0) { mx /= mlen; mz /= mlen; }
    /* The stick wins while it is pushed and keeps its own magnitude. It is
       read after the normalisation on purpose: normalising it too would
       turn every analogue reading into a full-speed run, which is exactly
       what a stick is for avoiding. */
    const stick = input.stick(0, 1);
    if (stick) { mx = stick.x; mz = stick.z; mlen = stick.len; }

    const sprinting = input.actionDown('sprint');
    let w = this.weapon;
    let speed = PLAYER_SPEED * this.speedScale;
    if (sprinting && mlen > 0) speed *= SPRINT_MULT;
    if (this.aiming) speed *= 0.68;
    // heavy weapons slow you down while spun up
    if (w.moveScale && this.spin > 0.1) speed *= lerp(1, w.moveScale, this.spin);
    if (this.reloading > 0) speed *= 0.86;

    // dash
    if (input.actionOnce('dash') && this.dashCd <= 0 && mlen > 0) {
      this.dashTimer = 0.16;
      this.dashCd = this.dashCooldown;
      this.invuln = Math.max(this.invuln, 0.22);
      // a dash is always full length: an eased stick is a slow walk, but it
      // must not produce a stunted dash
      const dashX = mx / mlen, dashZ = mz / mlen;
      this.dashX = dashX; this.dashZ = dashZ;
      sfx.dash();
      if (g.fx.sparks.dashWake) g.fx.sparks.dashWake(this.x, this.z, dashX, dashZ);
      for (let side = -1; side <= 1; side += 2) {
        const wakeX = this.x + dashZ * side * 0.27, wakeZ = this.z - dashX * side * 0.27;
        g.fx.tracers.add(wakeX, 0.16, wakeZ, wakeX - dashX * 1.2, wakeZ - dashZ * 1.2, 0.11, 0x56e7ff, 0.16);
      }
    }

    if (this.dashTimer > 0) {
      this.dashTimer -= dt;
      this.vx = this.dashX * 24;
      this.vz = this.dashZ * 24;
    } else {
      this.vx = damp(this.vx, mx * speed, 17, dt);
      this.vz = damp(this.vz, mz * speed, 17, dt);
    }

    this.x += (this.vx + this.kx) * dt;
    this.z += (this.vz + this.kz) * dt;
    const kd = 1 - Math.min(1, 8 * dt);
    this.kx *= kd; this.kz *= kd;
    g.level.resolveCircle(this, PLAYER_RADIUS);

    const movedSpeed = Math.hypot(this.vx, this.vz);
    this.walkPhase += dt * (2.5 + movedSpeed * 1.5);
    this._footstepT -= dt;
    if (movedSpeed > 1.5 && this.dashTimer <= 0 && this._footstepT <= 0) {
      this._footstepT = sprinting ? 0.23 : 0.33;
      sfx.footstep(sprinting ? 0.7 : 0.45);
    }
    this.spreadScale = (this.aiming ? 0.42 : 1) * (1 + this.bloom + (sprinting && mlen > 0 ? 0.65 : 0));

    /* --- weapon switching ------------------------------------------ */
    const slots = this.loadoutList();
    for (let i = 0; i < slots.length; i++) if (input.once('Digit' + (i + 1))) this.setWeapon(slots[i]);
    if (input.actionOnce('prevWeapon')) this.cycleWeapon(-1);
    if (input.actionOnce('nextWeapon')) this.cycleWeapon(1);
    if (input.wheel) this.cycleWeapon(input.wheel > 0 ? 1 : -1);
    if (input.actionOnce('reload')) this.startReload();
    if (input.actionOnce('grenade')) this.throwGrenade(aimX, aimZ);
    if (input.actionOnce('torch')) {
      this.torchOn = !this.torchOn;
      this.torch.visible = this.torchOn;
    }
    w = this.weapon;
    // A complete click between ticks still fires once. A new press also
    // releases a semi-auto latch left over from the previous held trigger.
    if (input.mousePressed || input.actionOnce('fire')) this.triggerLatched = false;
    const heavyMelee = w.fire === 'melee' && (input.rightDown || input.rightPressed || input.actionDown('aim'));
    if (input.rightPressed || (w.fire === 'melee' && input.actionOnce('aim'))) this.triggerLatched = false;
    const wantFire = input.mouseDown || input.mousePressed || input.actionDown('fire') || heavyMelee;
    // A loaded shotgun can interrupt its individual shell loading to fire.
    if (w.shellReload && this.reloading > 0 && wantFire && !this.triggerLatched && this.mag > 0) {
      this.reloading = 0;
    }

    /* --- reloading -------------------------------------------------- */
    if (this.reloading > 0) {
      this.reloading -= dt;
      if (this.reloading <= 0) { this.reloading = 0; this.finishReload(); }
    }

    /* --- firing ----------------------------------------------------- */
    if (this.fireTimer > 0) this.fireTimer -= dt;

    this.updateMelee(dt);
    if (this._burstRemaining > 0) {
      this._burstTimer -= dt;
      while (this._burstTimer <= 0 && this._burstRemaining > 0) {
        this._burstRemaining--;
        if (this.mag > 0 && this.alive) this.shoot(this._burstAimX, this._burstAimZ, true);
        else this._burstRemaining = 0;
        this._burstTimer += w.burstInterval || 0.075;
      }
    }

    /* Smoke vents once the trigger is released, not on every shot: a single
       round should not puff, and a long burst should leave the barrel
       smoking for a couple of seconds afterwards. */
    if (this.barrelHeat > 0) {
      this.barrelHeat = Math.max(0, this.barrelHeat - dt * BARREL_COOL);
      this._smokeTimer -= dt;
      if (!wantFire && this.barrelHeat > BARREL_SMOKE && this._smokeTimer <= 0) {
        this._smokeTimer = 0.11;
        const vent = this.muzzleWorld(_muzzleTmp);
        const energy = w.ammo === 'cell' || w.fire === 'rail';
        g.fx.smoke.emit(vent.x, vent.y, vent.z,
          (Math.random() - 0.5) * 0.7, 0.9 + Math.random() * 0.5, (Math.random() - 0.5) * 0.7,
          0.9 + Math.random() * 0.5, 0.26, 1.9, energy ? 0x7fb6c8 : 0x7a7670, 0.3);
      }
    }

    // minigun barrels must spin before it will fire
    if (w.spinUp) {
      this.spin = clamp(this.spin + (wantFire && this.mag > 0 ? dt / w.spinUp : -dt / (w.spinUp * 0.7)), 0, 1);
      sfx.spinup(this.spin > 0.02, this.spin);
    } else if (this.spin > 0) {
      this.spin = 0;
      sfx.spinup(false, 0);
    }

    let firing = false;
    // semi-autos latch the trigger until the button is released
    if (wantFire && this.reloading <= 0 && this.fireTimer <= 0 && (w.auto || !this.triggerLatched)) {
      if (w.fire === 'melee') {
        this.beginMelee(heavyMelee, aimX, aimZ); this.triggerLatched = true;
      } else if (this.mag <= 0) {
        if (this.reserve > 0) this.startReload();
        else { sfx.dryFire(); this.fireTimer = 0.4; }
        this.triggerLatched = true;
      } else if (!w.spinUp || this.spin >= 0.98) {
        this.shoot(aimX, aimZ);
        firing = true;
        this.triggerLatched = true;
      }
    }
    if (!wantFire) this.triggerLatched = false;

    if (w.fire === 'flame') {
      if (wantFire && this.reloading <= 0 && this.mag > 0) sfx.flame(1); else sfx.flameStop();
    } else {
      sfx.flameStop();
    }

    // auto-reload the moment the magazine runs dry
    if (w.usesAmmo !== false && this.mag <= 0 && this.reloading <= 0 && this.reserve > 0 && wantFire) this.startReload();

    this.recoil = damp(this.recoil, 0, 12, dt);
    this.updateModel(dt, movedSpeed, aimX, aimZ);
  }

  /* muzzle position in world space, written into `out` */
  muzzleWorld(out) {
    const w = this.weapon;
    const m = w.muzzle;
    // Use the rendered rig transform, including gun scale, recoil and sway.
    this.updateModel(0, Math.hypot(this.vx, this.vz));
    this.weaponMesh.updateWorldMatrix(true, false);
    out.set(m[0], m[1], m[2]).applyMatrix4(this.weaponMesh.matrixWorld);
    const dx = out.x - this.x, dz = out.z - this.z;
    const length = Math.max(0.0001, Math.hypot(dx, dz));
    const cover = this.raycastCover(this.x, this.z, dx / length, dz / length, length);
    if (cover) {
      const safe = Math.max(0, cover.dist - 0.08);
      out.x = this.x + dx / length * safe;
      out.z = this.z + dz / length * safe;
    }
    return out;
  }

  shoot(aimX, aimZ, burstFollowup = false) {
    const g = this.game;
    const w = this.weapon;
    if (w.fire === 'melee') { this.beginMelee(false, aimX, aimZ); return; }
    if (!burstFollowup) this.fireTimer = Math.max(-0.04, this.fireTimer) + w.interval;
    if (w.burstCount && !burstFollowup) {
      this._burstRemaining = w.burstCount - 1; this._burstTimer = w.burstInterval;
      this._burstAimX = aimX; this._burstAimZ = aimZ;
    }
    this.mags[w.id] = this.mag - 1;
    this.recoil = w.recoil;
    this.firedThisFrame = true;
    this.bloom = Math.min(1.15, this.bloom + (w.auto ? 0.16 : 0.08));
    if (w.fire !== 'flame') this.barrelHeat = Math.min(BARREL_HEAT_MAX, this.barrelHeat + 1);
    this._shotHitConfirmed = false;
    g.stats.shots++;

    const mz = this.muzzleWorld(_muzzleTmp);
    const baseAngle = Math.atan2(aimX - mz.x, aimZ - mz.z);
    // kick the camera back along the barrel instead of jittering at random
    g.shake(w.shake, 0.14, -Math.sin(baseAngle), -Math.cos(baseAngle));

    if (w.fire !== 'flame') {
      sfx.shot(w.sound, w.suppressed ? 0.48 : 1);
      if (w.projectileKind !== 'bolt') {
      const muzzleColor = w.fire === 'rail' ? 0xdc86ff : w.fire === 'arc' ? 0x69eaff : w.fire === 'projectile' ? 0xffb060 : 0xffd090;
      g.fx.lights.flash(mz.x, mz.y, mz.z, muzzleColor,
        w.suppressed ? 24 : w.fire === 'spread' ? 150 : 85, w.suppressed ? 5 : 10, 0.065);
      // muzzle flare + smoke
      const fa = baseAngle;
      if (g.fx.sparks.muzzle) g.fx.sparks.muzzle(mz.x, mz.y, mz.z, Math.sin(fa), Math.cos(fa), muzzleColor,
        w.id === 'shotgun' || w.fire === 'rail' || w.fire === 'projectile');
      if (w.id === 'shotgun' || w.fire === 'projectile') {
        g.fx.smoke.emit(mz.x, mz.y, mz.z, Math.sin(fa) * 3, 0.7, Math.cos(fa) * 3,
          0.8, 0.7, 2.4, 0x6a6a70, 0.4);
      }
      // ejected casing
      if (w.ammo !== 'rocket' && w.ammo !== 'cell' && w.ammo !== 'bolt' && w.ammo !== 'grenade' && w.fire !== 'rail') {
        const ea = baseAngle + Math.PI / 2;
        g.fx.gibs.emit(mz.x, mz.y, mz.z,
          Math.sin(ea) * 3 + (Math.random() - 0.5), 3 + Math.random() * 1.5, Math.cos(ea) * 3 + (Math.random() - 0.5),
          w.ammo === 'cannon' ? 0.12 : 0.075, 0xd8b34a, 2.5);
      }
      }
    }

    switch (w.fire) {
      case 'hitscan':
        this.hitscan(mz, baseAngle + (g.rng() - 0.5) * w.spread * this.spreadScale, w);
        break;
      case 'spread':
        for (let i = 0; i < w.pellets; i++) {
          const spreadT = w.pellets > 1 ? (i / (w.pellets - 1)) * 2 - 1 : 0;
          const spread = w.spread * (this.aiming ? 0.8 : 1);
          this.hitscan(mz, baseAngle + spreadT * spread * 0.5 + (g.rng() - 0.5) * spread * 0.4, w);
        }
        break;
      case 'projectile': {
        const stats = g.stats;
        let confirmed = false;
        g.spawnRocket(mz.x, mz.y, mz.z, baseAngle + (g.rng() - 0.5) * w.spread * this.spreadScale,
          Object.assign({}, w, {
            damage: w.damage * this.damageMultiplier,
            splash: w.splash * this.damageMultiplier * this.splashScale,
            splashRadius: w.splashRadius * Math.sqrt(this.splashScale),
            onHit: () => { if (!confirmed) { confirmed = true; stats.hits++; } }
          }));
        break;
      }
      case 'arc':
        this.arcShot(mz, baseAngle + (g.rng() - 0.5) * w.spread * this.spreadScale, w);
        break;
      case 'rail':
        this.railShot(mz, baseAngle + (g.rng() - 0.5) * w.spread * this.spreadScale, w);
        break;
      case 'flame':
        this.flameTick_(mz, baseAngle, w);
        break;
    }
  }

  beginMelee(heavy, aimX, aimZ) {
    const w = this.weapon;
    if (w.fire !== 'melee' || this.meleeAttack || this.fireTimer > 0 || !this.alive) return false;
    const spec = typeof CombatCore !== 'undefined' && CombatCore.meleeStats
      ? CombatCore.meleeStats(w, heavy) : Object.assign({}, w, heavy ? w.heavy : null);
    const total = spec.windup + spec.activeTime + spec.recovery;
    this.fireTimer = total;
    this.meleeAttack = { id: ++this.meleeSequence, weapon: w, spec, heavy: !!heavy, age: 0, total,
      angle: Math.atan2(aimX - this.x, aimZ - this.z), hits: new Set(), marked: false };
    this.game.stats.meleeAttacks = (this.game.stats.meleeAttacks || 0) + 1;
    return true;
  }

  updateMelee(dt) {
    const attack = this.meleeAttack;
    if (!attack) return;
    if (!this.alive) { this.meleeAttack = null; return; }
    const g = this.game, spec = attack.spec, previousAge = attack.age;
    attack.age += dt; this.angle = attack.angle;
    const activeEnd = spec.windup + spec.activeTime;
    if (attack.age >= spec.windup && previousAge < activeEnd) {
      const dx = Math.sin(attack.angle), dz = Math.cos(attack.angle);
      if (!attack.marked) {
        attack.marked = true;
        if (sfx.melee) sfx.melee('swing', attack.weapon.id, attack.heavy);
        const cover = this.raycastCover(this.x, this.z, dx, dz, spec.reach);
        if (cover) this.damageCover(cover, spec.damage * this.damageMultiplier);
      }
      const candidates = g.enemies.queryRadius(this.x, this.z, spec.reach + 2, this._radiusHits);
      for (let i = 0; i < candidates.length && attack.hits.size < spec.maxTargets; i++) {
        const e = candidates[i], key = e.id === undefined ? e : e.id;
        if (attack.hits.has(key) || e.state === S_DYING || !(e.hp > 0)) continue;
        const tx = e.x - this.x, tz = e.z - this.z, distance = Math.hypot(tx, tz);
        const radius = e.def.radius || 0.4;
        if (!CombatCore.meleeInArc(this, e, attack.angle, spec.reach, spec.arc, radius)) continue;
        const invDistance = distance > 0.0001 ? 1 / distance : 0;
        const hitX = invDistance ? tx * invDistance : dx, hitZ = invDistance ? tz * invDistance : dz;
        if (this.raycastCover(this.x, this.z, hitX, hitZ, Math.max(0, distance - radius * 0.6))) continue;
        attack.hits.add(key);
        const killed = this.dealDamage(e, spec.damage * this.damageMultiplier, hitX, hitZ, spec.knock, 0, attack.weapon);
        g.onHitConfirm(killed);
        if (g.fx.sparks.impact) g.fx.sparks.impact(e.x, (e.y || 0) + 0.9, e.z, dx, dz,
          attack.weapon.id === 'spear' ? 0x8ccbc4 : 0xbfb7a6, true);
        if (sfx.melee) sfx.melee('hit', attack.weapon.id, attack.heavy);
      }
    }
    if (attack.age >= attack.total) this.meleeAttack = null;
  }

  confirmShotHit() {
    // Accuracy is successful discharges / discharges, including flame ticks.
    // Shotgun pellets, piercing rounds and arc jumps share one confirmation.
    if (!this._shotHitConfirmed) {
      this._shotHitConfirmed = true;
      this.game.stats.hits++;
    }
  }

  /* Single funnel for weapon damage. Crits are rolled here so every firing
     mode shares one rule, and the roll draws from the run RNG only when the
     weapon actually has a chance — a flamethrower tick must not shift the
     stream that decides layouts and loot. */
  dealDamage(e, amount, dirX, dirZ, knock, burnDps, w) {
    const g = this.game;
    e.lastDamageOwnerId = this.id || 'campaign-player';
    if (burnDps > 0) e.burnOwnerId = this.id || 'campaign-player';
    const chance = w && w.crit ? w.crit * this.critScale : 0;
    const crit = chance > 0 && g.rng() < chance;
    if (crit) amount *= (w.critMult || 2) * this.critPower;
    const wasBurning = e.burn > 0;
    const killed = g.enemies.damage(e, amount, dirX, dirZ, crit ? knock * 1.5 : knock, burnDps);
    // the readout needs the number, and only this line knows it after the crit
    if (g.onWeaponHit) g.onWeaponHit(e, killed, crit, w, amount);
    if (wasBurning) this.conductBurn_(e, amount);
    return killed;
  }

  /* ЦЕПНОЙ ОЖОГ: a burning body conducts, so any hit on it lashes out at one
     neighbour. The arc deals a fraction, never crits, and never conducts
     again — otherwise a crowded room would chain until the frame died. */
  conductBurn_(from, amount) {
    if (!this.burnChains || this._conducting) return;
    const g = this.game;
    const candidates = g.enemies.queryRadius(from.x, from.z, 6, this._burnChainHits);
    let target = null, best = Infinity;
    for (let i = 0; i < candidates.length; i++) {
      const e = candidates[i];
      if (e === from || e.state === S_DYING) continue;
      const d = dist2(e.x, e.z, from.x, from.z);
      if (d < best) { best = d; target = e; }
    }
    if (!target) return;
    this._conducting = true;
    try {
      const dx = target.x - from.x, dz = target.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      this.arcBeam(from.x, from.y + 0.9, from.z, target.x, target.z, 0.12);
      const killed = this.dealDamage(target, amount * 0.45, dx / len, dz / len, 2, 0, null);
      g.onHitConfirm(killed);
    } finally {
      this._conducting = false;
    }
  }

  raycastCover(ax, az, dx, dz, distance) {
    const g = this.game;
    const wall = g.level.raycastWall(ax, az, dx, dz, distance);
    const prop = g.props && g.props.raycast(ax, az, dx, dz, distance);
    return prop && (!wall || prop.dist < wall.dist) ? prop : wall;
  }

  damageCover(cover, amount) {
    if (cover && cover.barrel) this.game.props.damageBarrel(cover.barrel, amount);
  }

  hitscan(origin, angle, w) {
    const g = this.game;
    const dx = Math.sin(angle), dz = Math.cos(angle);
    let maxDist = w.range;

    const cover = this.raycastCover(origin.x, origin.z, dx, dz, w.range);
    if (cover) maxDist = cover.dist;

    this._ignore.clear();
    let remaining = (w.pierce || 0) + 1 + this.pierceBonus;
    let endDist = maxDist;
    let reachesCover = true;

    while (remaining > 0) {
      const ex = origin.x + dx * maxDist, ez = origin.z + dz * maxDist;
      const hit = g.enemies.raycast(origin.x, origin.z, ex, ez, 0.05, this._ignore);
      if (!hit || (cover && hit.t >= 1)) break;
      remaining--;
      const e = hit.enemy;
      this._ignore.add(e);
      if (remaining === 0) { endDist = hit.t * maxDist; reachesCover = false; }

      const killed = this.dealDamage(e, w.damage * this.damageMultiplier, dx, dz, w.knock, 0, w);
      g.onHitConfirm(killed);
      this.confirmShotHit();

      const hy = e.y + e.def.radius * 0.9;
      if (g.fx.sparks.impact) g.fx.sparks.impact(e.x - dx * e.def.radius * 0.5, hy,
        e.z - dz * e.def.radius * 0.5, dx, dz, e.def.blood, false);
      g.fx.gibs.emit(e.x, hy, e.z, -dx * 3 + (Math.random() - 0.5) * 3, 3 + Math.random() * 2, -dz * 3 + (Math.random() - 0.5) * 3,
        0.09, e.def.blood, 3);
      sfx.hitFlesh();
    }

    // tracer stops at whatever it actually hit
    if (w.tracer) {
      g.fx.tracers.add(origin.x, origin.y, origin.z,
        origin.x + dx * endDist, origin.z + dz * endDist, w.tracerW, w.tracer, 0.055);
    }

    if (reachesCover && cover) {
      this.damageCover(cover, w.damage * this.damageMultiplier);
      if (g.fx.sparks.impact) g.fx.sparks.impact(cover.x, origin.y, cover.z, dx, dz, 0xffc766, true);
      g.fx.smoke.emit(cover.x, origin.y, cover.z, 0, 0.8, 0, 0.5, 0.3, 2, 0x8a8478, 0.3);
      sfx.hitWall();
    }
  }

  railShot(origin, angle, w) {
    const g = this.game;
    const dx = Math.sin(angle), dz = Math.cos(angle);
    const cover = this.raycastCover(origin.x, origin.z, dx, dz, w.range);
    const distance = cover ? cover.dist : w.range;
    const endX = origin.x + dx * distance, endZ = origin.z + dz * distance;
    g.fx.tracers.add(origin.x, origin.y, origin.z, endX, endZ, w.tracerW, w.tracer, 0.26);
    g.fx.tracers.add(origin.x, origin.y + 0.02, origin.z, endX, endZ, 0.15, 0x6ceeff, 0.18);
    g.fx.tracers.add(origin.x, origin.y + 0.035, origin.z, endX, endZ, 0.055, 0xffffff, 0.1);
    // Ionised air remains in the rail's path after the central beam fades.
    const segments = Math.min(30, Math.ceil(distance / 2));
    for (let i = 1; i <= segments; i++) {
      const t = i / segments;
      g.fx.sparks.emit(origin.x + dx * distance * t, origin.y, origin.z + dz * distance * t,
        dz * Math.sin(i * 2.4), 0.35, -dx * Math.sin(i * 2.4), 0.32, 0.22,
        i % 2 ? 0xcc7bff : 0x72ecff, -0.25);
    }

    this._ignore.clear();
    let damage = w.damage * this.damageMultiplier;
    for (let i = 0; i <= w.pierce; i++) {
      const hit = g.enemies.raycast(origin.x, origin.z, endX, endZ, 0.16, this._ignore);
      if (!hit || (cover && hit.t >= 1)) break;
      const e = hit.enemy;
      this._ignore.add(e);
      const killed = this.dealDamage(e, damage, dx, dz, w.knock, 0, w);
      g.onHitConfirm(killed);
      this.confirmShotHit();
      g.fx.sparks.burst(e.x, e.y + e.def.radius, e.z, 12, 8, 0.45, 0.35, 0xabdfff, 0.8, 4);
      g.fx.lights.flash(e.x, e.y + 1, e.z, 0xc684ff, 110, 8, 0.22);
      damage *= 0.9;
    }
    if (cover) {
      this.damageCover(cover, damage);
      g.fx.sparks.burst(cover.x, origin.y, cover.z, 16, 8, 0.5, 0.28, 0xe8c3ff, 0.8, 9);
      g.fx.lights.flash(cover.x, origin.y, cover.z, 0x9edcff, 95, 10, 0.24);
    }
  }

  arcBeam(ax, y, az, bx, bz, width) {
    const tracers = this.game.fx.tracers;
    tracers.add(ax, y, az, bx, bz, width, 0x5cddff, 0.14);
    tracers.add(ax, y + 0.015, az, bx, bz, width * 0.3, 0xe3fbff, 0.09);
    const dx = bx - ax, dz = bz - az;
    const length = Math.hypot(dx, dz) || 1;
    const segments = Math.min(7, Math.max(2, Math.ceil(length / 2.5)));
    let px = ax, pz = az;
    for (let i = 1; i <= segments; i++) {
      const jitter = i === segments ? 0 : (Math.random() - 0.5) * 0.8;
      const nx = ax + dx * i / segments + dz / length * jitter;
      const nz = az + dz * i / segments - dx / length * jitter;
      tracers.add(px, y + 0.025, pz, nx, nz, 0.055, 0xba88ff, 0.18);
      px = nx; pz = nz;
    }
  }

  arcShot(origin, angle, w) {
    const g = this.game;
    const dx = Math.sin(angle), dz = Math.cos(angle);
    const cover = this.raycastCover(origin.x, origin.z, dx, dz, w.range);
    const distance = cover ? cover.dist : w.range;
    let hit = g.enemies.raycast(origin.x, origin.z,
      origin.x + dx * distance, origin.z + dz * distance, 0.18, null);
    if (cover && hit && hit.t >= 1) hit = null;
    const ex = hit ? hit.enemy.x : origin.x + dx * distance;
    const ez = hit ? hit.enemy.z : origin.z + dz * distance;
    this.arcBeam(origin.x, origin.y, origin.z, ex, ez, w.tracerW);
    g.fx.sparks.burst(ex, origin.y, ez, hit ? 13 : 6, 5, 0.32, 0.32, 0x76f4ff, 0.8, 3);
    g.fx.lights.flash(ex, origin.y, ez, 0x64edff, 75, 8, 0.16);
    if (!hit) {
      if (cover) { this.damageCover(cover, w.damage * this.damageMultiplier); sfx.hitWall(); }
      return;
    }

    this._ignore.clear();
    let enemy = hit.enemy;
    let fromX = origin.x, fromZ = origin.z;
    let damage = w.damage * this.damageMultiplier;
    const chains = w.chain + this.chainBonus;
    for (let jump = 0; jump <= chains; jump++) {
      this._ignore.add(enemy);
      const rx = enemy.x - fromX, rz = enemy.z - fromZ;
      const len = Math.hypot(rx, rz) || 1;
      const killed = this.dealDamage(enemy, damage, rx / len, rz / len, w.knock, 0, w);
      g.onHitConfirm(killed);
      this.confirmShotHit();
      g.fx.sparks.burst(enemy.x, enemy.y + 0.9, enemy.z, 7, 4, 0.32, 0.25, 0x81eaff, 0.7, 2);
      if (jump === chains) break;
      fromX = enemy.x; fromZ = enemy.z;
      const candidates = g.enemies.queryRadius(fromX, fromZ, w.chainRange, this._chainHits);
      let nearest = null, nearestDist = w.chainRange * w.chainRange;
      for (let i = 0; i < candidates.length; i++) {
        const candidate = candidates[i];
        if (this._ignore.has(candidate)) continue;
        const d = dist2(fromX, fromZ, candidate.x, candidate.z);
        const length = Math.sqrt(d);
        if (d < nearestDist && (length < 1e-5 || !this.raycastCover(fromX, fromZ,
          (candidate.x - fromX) / length, (candidate.z - fromZ) / length, length))) {
          nearest = candidate; nearestDist = d;
        }
      }
      if (!nearest) break;
      this.arcBeam(fromX, 1, fromZ, nearest.x, nearest.z, w.tracerW * 0.65);
      enemy = nearest;
      damage *= w.chainFalloff;
    }
  }

  flameTick_(origin, angle, w) {
    const g = this.game;
    const dx = Math.sin(angle), dz = Math.cos(angle);

    // spray particles along the cone
    for (let i = 0; i < 3; i++) {
      const a = angle + (Math.random() - 0.5) * w.spread * 2;
      const sp = 13 + Math.random() * 7;
      g.fx.sparks.emit(origin.x, origin.y, origin.z,
        Math.sin(a) * sp, (Math.random() - 0.35) * 2.2, Math.cos(a) * sp,
        0.44 + Math.random() * 0.2, 1.5 + Math.random(),
        Math.random() < 0.55 ? 0xff8a1e : (Math.random() < 0.6 ? 0xffd24a : 0xff4a1e), -1.5);
    }
    if (Math.random() < 0.5) {
      const a = angle + (Math.random() - 0.5) * w.spread * 2;
      g.fx.smoke.emit(origin.x + dx * 4, origin.y + 0.4, origin.z + dz * 4,
        Math.sin(a) * 3, 1.6, Math.cos(a) * 3, 1.5, 1.4, 2.6, 0x2a2622, 0.34);
    }
    g.fx.lights.flash(origin.x + dx * 2, origin.y + 0.3, origin.z + dz * 2, 0xff7a20, 60, 14, 0.09);

    // Damage inside the cone respects both wall and prop cover.
    const hits = g.enemies.queryRadius(origin.x, origin.z, w.range, this._radiusHits);
    const cosLimit = Math.cos(w.spread * 2.6);
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const ex = e.x - origin.x, ez = e.z - origin.z;
      const len = Math.hypot(ex, ez) || 1;
      // things right on top of you always burn, regardless of facing
      if (len > 1.6 && (ex / len) * dx + (ez / len) * dz < cosLimit) continue;
      if (this.raycastCover(origin.x, origin.z, ex / len, ez / len, len)) continue;
      const falloff = 1 - clamp(len / w.range, 0, 1) * 0.45;
      // w.damage is damage-per-second; one tick is worth interval seconds of it
      const perTick = w.damage * w.interval * falloff * this.damageMultiplier;
      const killed = this.dealDamage(e, perTick, ex / len, ez / len, w.knock, w.burn * 3.2 * this.damageMultiplier * this.burnScale, w);
      g.onHitConfirm(killed);
      this.confirmShotHit();
    }
    if (g.props) {
      for (const barrel of g.props.barrels) {
        if (!barrel.alive) continue;
        const ex = barrel.x - origin.x, ez = barrel.z - origin.z;
        const len = Math.hypot(ex, ez) || 0.001;
        if (len > w.range || (len > 1.6 && ex / len * dx + ez / len * dz < cosLimit)) continue;
        const cover = this.raycastCover(origin.x, origin.z, ex / len, ez / len, len);
        if (cover && cover.barrel === barrel) {
          this.damageCover(cover, w.damage * w.interval * (1 - len / w.range * 0.45) * this.damageMultiplier);
        }
      }
    }
  }

  updateModel(dt, movedSpeed, aimX, aimZ) {
    const m = this.model;
    this.root.position.set(this.x, 0, this.z);
    this.root.rotation.y = this.angle;
    this.silhouette.position.set(this.x, 0, this.z);
    this.silhouette.rotation.y = this.angle;
    this.selfReadout.position.set(this.x, 0.083, this.z);
    this.selfReadout.visible = this.alive && this.root.visible && this.game.state !== 'menu';
    const dashScale = this.dashTimer > 0 ? 1.13 : 1;
    this.selfBrackets.scale.setScalar(dashScale);
    this.selfBrackets.material.color.copy(this._selfColor).lerp(this._selfHurtColor, clamp(this.hurtFlash, 0, 1));
    this.selfBrackets.material.opacity = this.dashTimer > 0 ? 1 : 0.8;
    this.selfDirection.position.set(Math.sin(this.angle) * 1.02, 0.012, Math.cos(this.angle) * 1.02);
    this.selfDirection.rotation.y = this.angle;
    const reloading = this.reloading > 0 && this.reloadTotal > 0;
    this.reloadTrack.visible = this.reloadFill.visible = reloading;
    if (reloading) {
      const progress = clamp(1 - this.reloading / this.reloadTotal, 0.025, 1);
      this.reloadFill.scale.x = 1.18 * progress;
      this.reloadFill.position.x = -0.59 + 0.59 * progress;
    }

    // walk cycle
    const swing = Math.sin(this.walkPhase * 2.2) * Math.min(1, movedSpeed / 5) * 0.55;
    m.legL.rotation.x = swing;
    m.legR.rotation.x = -swing;
    const bob = Math.abs(Math.sin(this.walkPhase * 2.2)) * Math.min(1, movedSpeed / 5) * 0.055;
    m.torso.position.y = bob;
    m.head.position.y = 1.62 + bob;

    const pose = this._weaponPoseState;
    pose.aiming = this.aiming;
    pose.recoil = this.recoil;
    pose.attackProgress = this.game.arena ? this.attackProgress || 0 : this.meleeAttack ? this.meleeAttack.age / this.meleeAttack.total : 0;
    pose.heavyAttack = this.game.arena ? !!this.attackHeavy : !!(this.meleeAttack && this.meleeAttack.heavy);
    pose.movement = Math.min(1, movedSpeed / 8);
    pose.phase = this.walkPhase;
    pose.bob = bob;
    pose.reloadProgress = this.reloading > 0 && this.reloadTotal > 0
      ? 1 - this.reloading / this.reloadTotal : -1;
    pose.spin = this.spin;
    pose.dt = dt;
    posePlayerWeapon(m, this.weapon, this.weaponMesh, pose);

    this.torchTarget.position.set(
      this.x + Math.sin(this.angle) * 14,
      0.6,
      this.z + Math.cos(this.angle) * 14
    );
  }
}

const _muzzleTmp = new THREE.Vector3();
