/* ========================================================================
   45-customize.js — trooper appearance config, persistence, 3D preview UI

   New clothing / hair options slot into LOOK_OPTIONS and buildPlayer()
   picks them up; nothing here needs to change when items are added.
   ======================================================================== */

const LOOK_KEY = 'look';

const LOOK_DEFAULTS = {
  nickname: 'NOMAD',
  skin: 0xc08a63,
  hairStyle: 'short',
  hairColor: 0x3a2a1a,
  jacket: 0x5c6e50,
  pants: 0x3d4652,
  vest: true,
  vestColor: 0x2f3a45,
  helmet: 'none',
  shoulders: 'standard',
  backpack: true,
  accent: 0x70eeff
};

const HAIR_STYLES = ['buzz', 'short', 'mohawk', 'long', 'none'];
const HELMET_STYLES = ['none', 'tactical', 'recon'];
const SHOULDER_STYLES = ['standard', 'heavy', 'light'];

/* The callsign length lives here because the on-screen keyboard has to stop
   at exactly the point the profile would truncate: a keyboard that lets a
   player type a nineteenth character and then silently drops it is worse
   than one that refuses the key. */
const NICKNAME_MAX = 18;

function normalizeNickname(value, trim = true) {
  if (typeof value !== 'string' && typeof value !== 'number') return '';
  let clean = String(value).normalize('NFKC')
    .replace(/<[^>]*>/g, '')
    .replace(/[\p{Cc}\p{Cf}]/gu, '')
    .replace(/[^\p{Script=Latin}\p{Script=Cyrillic}0-9 _.-]/gu, '')
    .replace(/ +/g, ' ');
  if (trim) clean = clean.trim();
  clean = Array.from(clean).slice(0, NICKNAME_MAX).join('');
  return trim ? clean.trim() : clean;
}

function sanitizeNickname(value) {
  return normalizeNickname(value) || LOOK_DEFAULTS.nickname;
}

const LOOK_OPTIONS = {
  skin: [0xf0c8a0, 0xdcae84, 0xc08a63, 0x9a6a44, 0x6f4a30, 0x4a3020],
  hairColor: [0x1a1410, 0x3a2a1a, 0x6e4a26, 0xa8783a, 0xb8b8bc, 0x8a3a1e, 0x2a5a3a],
  jacket: [0x5c6e50, 0x44526a, 0x6d4a3a, 0x3a3f46, 0x5a2f2f, 0x2f4a44, 0x6a6254, 0x44403a],
  pants: [0x3d4652, 0x2c3138, 0x4a4238, 0x333d2f, 0x26313d],
  vestColor: [0x2f3a45, 0x3a2f2a, 0x44403a, 0x2f4436, 0x40303a],
  accent: [0x70eeff, 0xffbf61, 0x91efa2, 0xb6a0ff, 0xff727f, 0xe8f5ff]
};

const LOOK_PRESETS = [
  { name: 'РАЗВЕДЧИК', look: { skin: 0xc08a63, hairStyle: 'short', hairColor: 0x3a2a1a, jacket: 0x5c6e50, pants: 0x3d4652, vest: true, vestColor: 0x2f3a45, helmet: 'recon', shoulders: 'light', backpack: true, accent: 0x70eeff } },
  { name: 'ШТУРМОВИК', look: { skin: 0x9a6a44, hairStyle: 'buzz', hairColor: 0x1a1410, jacket: 0x6d4a3a, pants: 0x4a4238, vest: true, vestColor: 0x3a2f2a, helmet: 'tactical', shoulders: 'heavy', backpack: true, accent: 0xffbf61 } },
  { name: 'МЕДИК', look: { skin: 0xf0c8a0, hairStyle: 'long', hairColor: 0xa8783a, jacket: 0x44403a, pants: 0x2c3138, vest: true, vestColor: 0x2f4436, helmet: 'none', shoulders: 'standard', backpack: true, accent: 0x91efa2 } },
  { name: 'ТЯЖЁЛЫЙ', look: { skin: 0x6f4a30, hairStyle: 'none', hairColor: 0x1a1410, jacket: 0x3a3f46, pants: 0x26313d, vest: true, vestColor: 0x40303a, helmet: 'tactical', shoulders: 'heavy', backpack: true, accent: 0xff727f } },
  { name: 'СЛЕДОПЫТ', look: { skin: 0xdcae84, hairStyle: 'mohawk', hairColor: 0x8a3a1e, jacket: 0x2f4a44, pants: 0x333d2f, vest: false, vestColor: 0x2f3a45, helmet: 'none', shoulders: 'light', backpack: false, accent: 0xb6a0ff } }
];

function clampLook(look) {
  const out = Object.assign({}, LOOK_DEFAULTS);
  if (look && typeof look === 'object') {
    for (const key of Object.keys(LOOK_DEFAULTS)) {
      if (Object.prototype.hasOwnProperty.call(look, key)) out[key] = look[key];
    }
  }
  const pick = (v, list, fallback) => list.indexOf(v) >= 0 ? v : fallback;
  out.skin = pick(out.skin, LOOK_OPTIONS.skin, LOOK_DEFAULTS.skin);
  out.hairColor = pick(out.hairColor, LOOK_OPTIONS.hairColor, LOOK_DEFAULTS.hairColor);
  out.jacket = pick(out.jacket, LOOK_OPTIONS.jacket, LOOK_DEFAULTS.jacket);
  out.pants = pick(out.pants, LOOK_OPTIONS.pants, LOOK_DEFAULTS.pants);
  out.vestColor = pick(out.vestColor, LOOK_OPTIONS.vestColor, LOOK_DEFAULTS.vestColor);
  out.hairStyle = pick(out.hairStyle, HAIR_STYLES, LOOK_DEFAULTS.hairStyle);
  out.vest = parseProfileBoolean(out.vest, LOOK_DEFAULTS.vest);
  out.nickname = sanitizeNickname(out.nickname);
  out.helmet = pick(out.helmet, HELMET_STYLES, LOOK_DEFAULTS.helmet);
  out.shoulders = pick(out.shoulders, SHOULDER_STYLES, LOOK_DEFAULTS.shoulders);
  out.backpack = parseProfileBoolean(out.backpack, LOOK_DEFAULTS.backpack);
  out.accent = pick(out.accent, LOOK_OPTIONS.accent, LOOK_DEFAULTS.accent);
  return out;
}

function loadLook() {
  let raw = null;
  try { raw = JSON.parse(store.get(LOOK_KEY, 'null')); } catch (e) { raw = null; }
  return clampLook(raw);
}

function saveLook(look) {
  store.set(LOOK_KEY, JSON.stringify(clampLook(look)));
}

function randomLook(nickname = loadLook().nickname) {
  const r = (list) => list[(Math.random() * list.length) | 0];
  return {
    nickname: sanitizeNickname(nickname),
    skin: r(LOOK_OPTIONS.skin),
    hairStyle: r(HAIR_STYLES),
    hairColor: r(LOOK_OPTIONS.hairColor),
    jacket: r(LOOK_OPTIONS.jacket),
    pants: r(LOOK_OPTIONS.pants),
    vest: Math.random() < 0.75,
    vestColor: r(LOOK_OPTIONS.vestColor),
    helmet: r(HELMET_STYLES),
    shoulders: r(SHOULDER_STYLES),
    backpack: Math.random() < 0.7,
    accent: r(LOOK_OPTIONS.accent)
  };
}

/* ------------------------------------------------------------------
   Customizer screen: its own small scene so the menu backdrop and the
   preview lighting stay independent of the game scene.
   ------------------------------------------------------------------ */
class Customizer {
  constructor(game) {
    this.game = game;
    this.look = loadLook();
    this.previewWeaponId = game.player.weapon.id;
    this.previewDistance = 3.8;
    this.previewElevation = 0.18;
    this.autoRotate = true;

    this.renderer = new THREE.WebGLRenderer({
      canvas: document.getElementById('custView'),
      antialias: true, alpha: true, powerPreference: 'low-power'
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.2;


    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(34, 1, 0.1, 20);
    this._positionCamera();

    this.scene.add(new THREE.HemisphereLight(0x9fb8d8, 0x1a2028, 2.2));
    const key = new THREE.DirectionalLight(0xffe8c8, 2.4);
    key.position.set(2.4, 3.4, 2.8);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x6fb8ff, 1.4);
    rim.position.set(-2.6, 2.2, -2.4);
    this.scene.add(rim);
    // Broad neutral fill keeps the face and dark armour readable as the
    // turntable rotates, while the coloured rim remains the accent.
    const frontFill = new THREE.DirectionalLight(0xdce5ed, 1.8);
    frontFill.position.set(-0.4, 1.8, 5);
    this.scene.add(frontFill);
    this.scene.add(new THREE.AmbientLight(0xc3d0dc, 0.28));

    const floor = new THREE.Mesh(
      new THREE.CircleGeometry(1.4, 28),
      new THREE.MeshBasicMaterial({ color: 0x0d1319 })
    );
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);
    this.platformRing = new THREE.Mesh(
      new THREE.RingGeometry(1.26, 1.285, 64),
      new THREE.MeshBasicMaterial({ color: this.look.accent, transparent: true, opacity: 0.8 })
    );
    this.platformRing.rotation.x = -Math.PI / 2;
    this.platformRing.position.y = 0.008;
    this.scene.add(this.platformRing);

    this.turntable = new THREE.Group();
    this.scene.add(this.turntable);
    this.spin = 0.32;
    this.dragging = false;

    this._buildUI();
    this._bindNickname();
    this.rebuild();
    const viewReset = document.getElementById('custViewReset');
    if (viewReset) viewReset.addEventListener('click', () => this.resetView());

    const cv = this.renderer.domElement;
    cv.style.touchAction = 'none';
    cv.addEventListener('pointerdown', (e) => {
      if (e.button !== 0) return;
      this.dragging = true;
      this._dragX = e.clientX; this._dragY = e.clientY;
      try { cv.setPointerCapture(e.pointerId); } catch (error) { /* synthetic input has no active pointer */ }
    });
    const release = () => { this.dragging = false; };
    cv.addEventListener('pointerup', release);
    cv.addEventListener('pointercancel', release);
    cv.addEventListener('lostpointercapture', release);
    cv.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this._dragX, dy = e.clientY - this._dragY;
      this._dragX = e.clientX; this._dragY = e.clientY;
      this.turntable.rotation.y += dx * 0.012;
      this.previewElevation = clamp(this.previewElevation + dy * 0.005, -0.05, 0.65);
      this.autoRotate = false;
      this._positionCamera();
      this._syncViewButton();
    });
    cv.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.zoom(Math.exp(e.deltaY * 0.001));
    }, { passive: false });

    this._running = false;
  }

  _bindNickname() {
    this.$nickname = document.getElementById('custNickname');
    this.$nicknameCount = document.getElementById('custNicknameCount');
    this.$callsign = document.getElementById('custCallsign');
    if (this.$nickname) {
      // The code-point limit is applied here, not with HTML's UTF-16 limit.
      this.$nickname.removeAttribute('maxlength');
      const update = (event) => {
        if (event && event.isComposing) return;
        const value = this.$nickname.value;
        const caret = this.$nickname.selectionStart;
        const draft = normalizeNickname(value, false);
        if (draft !== value) {
          this.$nickname.value = draft;
          if (caret !== null) {
            const next = normalizeNickname(value.slice(0, caret), false).length;
            this.$nickname.setSelectionRange(next, next);
          }
        }
        this.look.nickname = sanitizeNickname(draft);
        this._syncNickname(false);
      };
      this.$nickname.addEventListener('input', update);
      this.$nickname.addEventListener('compositionend', update);
      this.$nickname.addEventListener('blur', () => { update(); this._syncNickname(); });
      // Name entry must not leak WASD/B/R keystrokes into the game controls.
      for (const event of ['keydown', 'keyup']) this.$nickname.addEventListener(event, (e) => {
        if (e.code !== 'Escape') e.stopPropagation();
        else if (event === 'keydown') {
          // Escape reaches the screen's save handler before blur necessarily
          // runs, so finalize the current text synchronously first.
          this.look.nickname = sanitizeNickname(this.$nickname.value);
          this._syncNickname();
        }
      });
    }
    this._syncNickname();
  }

  _syncNickname(replaceInput = true) {
    const nickname = sanitizeNickname(this.look.nickname);
    this.look.nickname = nickname;
    if (this.$nickname && replaceInput) this.$nickname.value = nickname;
    if (this.$nicknameCount) {
      const draft = this.$nickname ? this.$nickname.value : nickname;
      this.$nicknameCount.textContent = Array.from(draft).length + ' / 18';
    }
    if (this.$callsign) this.$callsign.textContent = nickname;
  }

  _positionCamera() {
    const frame = this._previewFrame;
    const sine = Math.sin(this.previewElevation), cosine = Math.cos(this.previewElevation);
    let radius = this.previewDistance, x = 0, y = 0.98, z = 0;
    if (frame) {
      // Frame the complete held weapon and arms, including during a full
      // turntable rotation. Zoom remains relative to the fitted view.
      const vertical = Math.tan(this.camera.fov * Math.PI / 360);
      const horizontal = vertical * Math.max(0.3, this.camera.aspect);
      // Each support point describes a mesh corner's height and radius from
      // the turntable centre. These analytic bounds cover every yaw angle,
      // without treating a long gun as if it also extended beside the boots.
      const across = Math.hypot(cosine, 1 / horizontal);
      const topY = sine + cosine / vertical, topR = Math.abs(cosine - sine / vertical);
      const bottomY = sine - cosine / vertical, bottomR = Math.abs(cosine + sine / vertical);
      let fit = 1;
      for (let i = 0; i < frame.points.length; i += 2) {
        const radial = frame.points[i], height = frame.points[i + 1];
        fit = Math.max(fit, height * sine + radial * across,
          height * topY + radial * topR, height * bottomY + radial * bottomR);
      }
      radius = fit * 1.06 * this.previewDistance / 3.8;
      const yaw = this.turntable.rotation.y;
      x = frame.x * Math.cos(yaw) + frame.z * Math.sin(yaw);
      z = frame.z * Math.cos(yaw) - frame.x * Math.sin(yaw);
      y = frame.y;
    }
    this.camera.position.set(x, y + sine * radius, z + cosine * radius);
    this.camera.lookAt(x, y, z);
  }

  _fitPreview() {
    if (!this.model) return;
    const yaw = this.turntable.rotation.y;
    this.turntable.rotation.y = 0;
    this.turntable.updateMatrixWorld(true);
    const bounds = new THREE.Box3().setFromObject(this.model.root);
    const size = bounds.getSize(new THREE.Vector3());
    const center = bounds.getCenter(new THREE.Vector3());
    const points = [], point = new THREE.Vector3();
    this.model.root.traverse((object) => {
      if (!object.isMesh) return;
      if (!object.geometry.boundingBox) object.geometry.computeBoundingBox();
      const box = object.geometry.boundingBox;
      for (let corner = 0; corner < 8; corner++) {
        point.set(corner & 1 ? box.max.x : box.min.x, corner & 2 ? box.max.y : box.min.y,
          corner & 4 ? box.max.z : box.min.z).applyMatrix4(object.matrixWorld).sub(center);
        points.push(Math.hypot(point.x, point.z), point.y);
      }
    });
    this.turntable.rotation.y = yaw;
    this.turntable.updateMatrixWorld(true);
    if (![size.x, size.y, size.z, center.x, center.y, center.z, ...points].every(Number.isFinite)) return;
    this._previewFrame = { x: center.x, y: center.y, z: center.z, points: points };
    this._positionCamera();
  }

  zoom(factor) {
    if (!Number.isFinite(factor) || factor <= 0) return;
    this.previewDistance = clamp(this.previewDistance * factor, 2.6, 6.0);
    this._positionCamera();
  }

  resetView() {
    this.previewDistance = 3.8;
    this.previewElevation = 0.18;
    this.turntable.rotation.y = -0.25;
    this.autoRotate = true;
    this._positionCamera();
    this._syncViewButton();
  }

  _syncViewButton() {
    if (!this.$rotate) return;
    this.$rotate.classList.toggle('sel', this.autoRotate);
    this.$rotate.setAttribute('aria-pressed', String(this.autoRotate));
    this.$rotate.textContent = this.autoRotate ? 'ВРАЩЕНИЕ: ВКЛ' : 'ВРАЩЕНИЕ: ВЫКЛ';
  }

  _buildUI() {
    const $ = (id) => document.getElementById(id);
    const hex = (c) => '#' + c.toString(16).padStart(6, '0');

    this.$screen = $('custScreen');
    const swatchRow = (label, optionList, current, onPick) => {
      const row = document.createElement('div');
      row.className = 'custRow';
      const l = document.createElement('span');
      l.className = 'custLabel';
      l.textContent = label;
      row.appendChild(l);
      const wrap = document.createElement('div');
      wrap.className = 'custSwatches';
      for (const c of optionList) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'swatch';
        b.style.background = hex(c);
        b.setAttribute('aria-label', label + ' ' + hex(c));
        b.setAttribute('aria-pressed', String(c === current));
        if (c === current) b.classList.add('sel');
        b.addEventListener('click', () => onPick(c));
        wrap.appendChild(b);
      }
      row.appendChild(wrap);
      return row;
    };
    const btnRow = (label, options, current, onPick) => {
      const row = document.createElement('div');
      row.className = 'custRow';
      const l = document.createElement('span');
      l.className = 'custLabel';
      l.textContent = label;
      row.appendChild(l);
      const wrap = document.createElement('div');
      wrap.className = 'custSwatches';
      for (const o of options) {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'pill';
        b.textContent = o.label;
        b.setAttribute('aria-pressed', String(o.value === current));
        if (o.value === current) b.classList.add('sel');
        b.addEventListener('click', () => onPick(o.value));
        wrap.appendChild(b);
      }
      row.appendChild(wrap);
      return row;
    };

    this._swatchRow = swatchRow;
    this._btnRow = btnRow;
    this._panel = $('custPanel');
    this._renderPanel();
  }

  _renderPanel() {
    const look = this.look;
    const swatchRow = this._swatchRow, btnRow = this._btnRow;
    this._panel.replaceChildren();
    const section = (title, note) => {
      const group = document.createElement('div');
      group.className = 'custSection';
      const heading = document.createElement('div');
      heading.className = 'custSectionHeading'; heading.textContent = title;
      group.appendChild(heading);
      if (note) {
        const description = document.createElement('p');
        description.className = 'custSectionNote'; description.textContent = note;
        group.appendChild(description);
      }
      this._panel.appendChild(group);
      return group;
    };

    const presetSection = section('01 / ПРОФИЛЬ БОЙЦА');
    const presets = document.createElement('div');
    presets.className = 'custRow';
    const pl = document.createElement('span');
    pl.className = 'custLabel';
    pl.textContent = 'ГОТОВЫЙ ОБЛИК';
    presets.appendChild(pl);
    const pw = document.createElement('div');
    pw.className = 'custSwatches';
    for (const p of LOOK_PRESETS) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'pill';
      b.textContent = p.name;
      const selected = Object.keys(p.look).every((key) => look[key] === p.look[key]);
      b.classList.toggle('sel', selected);
      b.setAttribute('aria-pressed', String(selected));
      b.addEventListener('click', () => {
        this.look = clampLook(Object.assign({}, p.look, { nickname: this.look.nickname }));
        this._renderPanel(); this.rebuild(); this._syncNickname();
      });
      pw.appendChild(b);
    }
    presets.appendChild(pw);
    presetSection.appendChild(presets);

    const set = (k) => (v) => { this.look[k] = v; this._renderPanel(); this.rebuild(); };
    const faceSection = section('02 / ВНЕШНОСТЬ', look.helmet !== 'none' ? 'Снимите шлем, чтобы рассмотреть причёску.' : null);
    faceSection.appendChild(swatchRow('КОЖА', LOOK_OPTIONS.skin, look.skin, set('skin')));
    faceSection.appendChild(btnRow('ПРИЧЁСКА',
      HAIR_STYLES.map((h) => ({ label: ({ buzz: 'ЁЖИК', short: 'КОРОТКАЯ', mohawk: 'ИРОКЕЗ', long: 'ДЛИННАЯ', none: 'БЕЗ ВОЛОС' })[h], value: h })),
      look.hairStyle, set('hairStyle')));
    faceSection.appendChild(swatchRow('ЦВЕТ ВОЛОС', LOOK_OPTIONS.hairColor, look.hairColor, set('hairColor')));
    const kitSection = section('03 / ЭКИПИРОВКА', 'Внешний вид не влияет на боевые характеристики.');
    kitSection.appendChild(btnRow('ШЛЕМ', [
      { label: 'БЕЗ ШЛЕМА', value: 'none' }, { label: 'ТАКТИЧЕСКИЙ', value: 'tactical' },
      { label: 'РАЗВЕДЧИК', value: 'recon' }
    ], look.helmet, set('helmet')));
    kitSection.appendChild(btnRow('НАПЛЕЧНИКИ', [
      { label: 'СТАНДАРТ', value: 'standard' }, { label: 'ТЯЖЁЛЫЕ', value: 'heavy' },
      { label: 'ЛЁГКИЕ', value: 'light' }
    ], look.shoulders, set('shoulders')));
    kitSection.appendChild(swatchRow('КУРТКА', LOOK_OPTIONS.jacket, look.jacket, set('jacket')));
    kitSection.appendChild(swatchRow('БРЮКИ', LOOK_OPTIONS.pants, look.pants, set('pants')));
    kitSection.appendChild(btnRow('БРОНЕЖИЛЕТ',
      [{ label: 'ДА', value: true }, { label: 'НЕТ', value: false }],
      look.vest, set('vest')));
    kitSection.appendChild(swatchRow('ЦВЕТ БРОНИ', LOOK_OPTIONS.vestColor, look.vestColor, set('vestColor')));
    kitSection.appendChild(btnRow('РЮКЗАК', [{ label: 'ЕСТЬ', value: true }, { label: 'НЕТ', value: false }], look.backpack, set('backpack')));
    kitSection.appendChild(swatchRow('ПОДСВЕТКА', LOOK_OPTIONS.accent, look.accent, set('accent')));

    const previewSection = section('04 / ОСМОТР', 'Потяните модель для поворота и наклона. Колесо мыши меняет масштаб.');
    previewSection.appendChild(btnRow('ОРУЖИЕ', WEAPONS.filter((weapon) => WEAPON_GEO[weapon.geo])
      .map((weapon) => ({ label: weapon.short, value: weapon.id })), this.previewWeaponId,
      (id) => { this.setPreviewWeapon(id); this._renderPanel(); }));
    const note = document.createElement('p');
    note.className = 'custSectionNote'; note.textContent = 'Оружие для осмотра. Арсенал забега сохраняется.';
    previewSection.appendChild(note);
    const viewControls = document.createElement('div');
    viewControls.className = 'custViewControls';
    const action = (label, callback, ariaLabel) => {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'pill'; button.textContent = label;
      if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
      button.addEventListener('click', callback); viewControls.appendChild(button);
      return button;
    };
    action('−', () => this.zoom(1.13), 'Отдалить модель');
    action('+', () => this.zoom(1 / 1.13), 'Приблизить модель');
    this.$rotate = action('', () => { this.autoRotate = !this.autoRotate; this._syncViewButton(); });
    action('СБРОСИТЬ РАКУРС', () => this.resetView());
    this._syncViewButton(); previewSection.appendChild(viewControls);
  }

  randomize() {
    this.look = randomLook(this.look.nickname);
    this._renderPanel(); this.rebuild(); this._syncNickname();
  }

  resetLook() {
    this.look = clampLook({ nickname: this.look.nickname });
    this._renderPanel(); this.rebuild(); this._syncNickname(); this.resetView();
  }

  setPreviewWeapon(id) {
    const weapon = WEAPONS.find((w) => w.id === id);
    if (!weapon || !WEAPON_GEO[weapon.geo]) return false;
    this.previewWeaponId = id;
    if (!this.model) return true;
    this._releasePreviewWeapon();
    // Weapon geometry is cached for the game and must outlive this preview.
    this.previewWeapon = new THREE.Mesh(WEAPON_GEO[weapon.geo], this.model.material);
    this.previewWeapon.scale.setScalar(WEAPON_VISUAL_SCALE);
    this.model.weaponPivot.add(this.previewWeapon);
    configureWeaponModel(this.previewWeapon, weapon, this.model.material);
    posePlayerWeapon(this.model, weapon, this.previewWeapon);
    this._fitPreview();
    return true;
  }

  _releasePreviewWeapon() {
    if (!this.previewWeapon) return;
    this.previewWeapon.removeFromParent();
    const geometries = new Set(), materials = new Set();
    this.previewWeapon.traverse((object) => {
      if (!object.isMesh) return;
      if (!object.geometry.userData.shared && !geometries.has(object.geometry)) {
        geometries.add(object.geometry); object.geometry.dispose();
      }
      const list = Array.isArray(object.material) ? object.material : [object.material];
      for (const material of list) {
        if (material && material !== this.model.material && !material.userData.shared && !materials.has(material)) {
          materials.add(material); material.dispose();
        }
      }
    });
    this.previewWeapon = null;
  }

  rebuild() {
    this.look = clampLook(this.look);
    if (this.model) {
      this._releasePreviewWeapon();
      this.turntable.remove(this.model.root);
      const disposed = new Set();
      this.model.root.traverse((o) => {
        if (o.isMesh && !o.geometry.userData.shared && !disposed.has(o.geometry)) {
          disposed.add(o.geometry); o.geometry.dispose();
        }
      });
      this.model.material.dispose();
    }
    this.previewWeapon = null;
    this.model = buildPlayer(this.look);
    this.model.material.transparent = true;
    this.model.material.opacity = 1;
    this.turntable.add(this.model.root);
    if (!this.setPreviewWeapon(this.previewWeaponId)) this.setPreviewWeapon('pistol');
    this.platformRing.material.color.setHex(this.look.accent);
    this._syncNickname(false);
  }

  show() {
    this.game.input._onBlur();
    this._syncNickname();
    this.$screen.classList.add('show');
    this._running = true;
    this._resize();
  }

  hide() {
    this.$screen.classList.remove('show');
    document.getElementById('oskScreen').classList.remove('show');
    this._running = false;
    this.dragging = false;
    // the frame loop no longer wipes input while the editor is open, so a
    // key still held on the way out must not arrive in the run
    this.game.input.clear();
  }

  commit() {
    if (this.$nickname) this.look.nickname = sanitizeNickname(this.$nickname.value);
    this.look = clampLook(this.look);
    this._syncNickname();
    saveLook(this.look);
    // apply to the live trooper so the next deployment shows it immediately
    this.game.player.applyLook(this.look);
    this.game.player.callsign = this.look.nickname;
    this.game.hud.setCallsign(this.look.nickname);
  }

  _resize() {
    const cv = this.renderer.domElement;
    const w = cv.clientWidth || 320, h = cv.clientHeight || 420;
    this.renderer.setSize(w, h, false);

    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this._positionCamera();
  }

  update(dt) {
    if (!this._running) return;
    if (!this.dragging && this.autoRotate) {
      this.turntable.rotation.y += this.spin * dt;
    }
    /* The right stick turns the model. A pad has no drag, and without this
       the back of the trooper is unreachable on a Deck. */
    const turn = this.game.input.stick(2, 3);
    if (turn && !document.getElementById('oskScreen').classList.contains('show')) {
      this.turntable.rotation.y += turn.x * dt * 2.6;
    }
    // gentle idle pose so the preview is never a frozen mannequin
    const m = this.model;
    if (m) {
      const t = performance.now() * 0.001;
      const swing = Math.sin(t * 1.7) * 0.06;
      const bob = Math.sin(t * 2.3) * 0.008;
      m.legL.rotation.x = swing;
      m.legR.rotation.x = -swing;
      m.torso.position.y = bob;
      m.head.position.y = 1.62 + bob;
      posePlayerWeapon(m, WEAPON_BY_ID[this.previewWeaponId], this.previewWeapon,
        { phase: t, bob: bob, movement: 0, spin: 0, dt: dt });
    }
    this._positionCamera();
    this.renderer.render(this.scene, this.camera);
  }
}
