/* ========================================================================
   95-game.js — scene assembly, wave director, main loop
   ======================================================================== */

const ST_MENU = 'menu', ST_PLAY = 'play', ST_PAUSE = 'pause', ST_DEAD = 'dead', ST_UPGRADE = 'upgrade',
  ST_PERK = 'perk', ST_VICTORY = 'victory';

/* A run has an end. Without one there is no "I finished it" — not for the
   player, not in a review, and no moment at which the station is worth
   visiting. Four sectors of three waves; the boss of the fourth is the
   finale. Endless mode continues from there for records. */
const RUN_FINAL_WAVE = 12;
const WAVES_PER_SECTOR = 3;
// paid into the sample yield on victory, before banking scales it
const RUN_COMPLETE_SAMPLES = 150;

/* which aliens are available, and how the horde is weighted, per wave */
function waveComposition(wave) {
  const pool = [];
  pool.push({ id: 'crawler', weight: 10 });
  if (wave >= 2) pool.push({ id: 'grunt', weight: 6 });
  if (wave >= 3) pool.push({ id: 'flyer', weight: 4 + Math.min(4, wave - 3) });
  if (wave >= 4) pool.push({ id: 'spitter', weight: 3 + Math.min(4, wave - 4) });
  if (wave >= 6) pool.push({ id: 'brute', weight: 2 + Math.min(5, (wave - 6) * 0.6) });
  return pool;
}

class Game {
  constructor(canvas) {
    this.canvas = canvas;
    this.state = ST_MENU;
    this.time = 0;
    this.tick = 0;
    this.runSeed = freshRunSeed();
    this.rng = makeRng(this.runSeed);
    this.levelRevision = 0;
    this.events = [];
    this.wave = 0;
    this.score = 0;
    this.money = 0;
    this.stats = { kills: 0, shots: 0, hits: 0, waveKills: 0 };
    this.activeBoss = null;
    this.shakeAmt = 0;
    this.shakeTime = 0;
    this.shakeDirX = 0;
    this.shakeDirZ = 0;
    this.hitStop = new HitStop();
    this.intensity = 0;
    this.sectorIndex = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.upgrades = {};
    this.shopStock = [];
    this.shopRerolls = 0;
    this.perks = {};
    this.perkOffer = [];
    this.metaRanks = {};
    this.endless = false;
    this.bankedSamples = 0;
    this.runCounted = false;
    this.sampleYield = 0;
    this.sampleRate = 1;
    this.perkOfferBonus = 0;
    this.waveEvent = WAVE_EVENTS[0];
    this.motionScale = Number(store.get('motion', '1'));

    this._setupRenderer();
    this.pixelFX = new PixelRenderer(this.renderer, Number(store.get('pixels', '2')));
    this.presentation = new TWEEN.Group();
    this.presentationTime = 0;
    this._setupScene();

    this.input = new InputState(canvas);
    this.hud = new Hud(this);
    this.ui = new UiNav(this);
    this.damageNumbers = new DamageNumbers(document.getElementById('dmgLayer'));
    this.damageNumbers.enabled = store.get('dmgnum', '1') !== '0';
    this._dmgPoint = new THREE.Vector3();

    this.raycaster = new THREE.Raycaster();
    this.aim = new THREE.Vector3();
    this._ndc = new THREE.Vector2();
    this._camTarget = new THREE.Vector3();
    this._camPos = new THREE.Vector3();
    this._radiusHits = [];

    this.newLevel(sectorSeed(this.runSeed, 0));

    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  _setupRenderer() {
    const r = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      powerPreference: 'high-performance'
    });
    r.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    r.shadowMap.enabled = true;
    r.shadowMap.type = THREE.PCFSoftShadowMap;
    r.outputColorSpace = THREE.SRGBColorSpace;
    r.toneMapping = THREE.ACESFilmicToneMapping;
    r.toneMappingExposure = 1.32;
    this.renderer = r;
    this.pixelRatioScale = 1;
  }

  _setupScene() {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05070a);
    scene.fog = new THREE.FogExp2(0x05070a, 0.0135);
    this.scene = scene;

    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 260);
    this.aimCamera = this.camera.clone();
    this.camOffset = new THREE.Vector3(0, 26, 11);

    scene.add(new THREE.HemisphereLight(0x8db6cf, 0x192530, 2.1));
    scene.add(new THREE.AmbientLight(0x9bafbd, 0.9));

    // key light follows the player so the shadow map stays tight
    const key = new THREE.DirectionalLight(0xc9e2f5, 2.1);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 90;
    const ext = 30;
    key.shadow.camera.left = -ext;
    key.shadow.camera.right = ext;
    key.shadow.camera.top = ext;
    key.shadow.camera.bottom = -ext;
    key.shadow.bias = -0.0006;
    key.shadow.normalBias = 0.035;
    scene.add(key);
    scene.add(key.target);
    this.keyLight = key;

    // pooled lamp lights, re-homed to whichever fixtures are nearest.
    // Intensity is in candela (three r155+ physical units), so room lighting
    // needs values in the tens, not the single digits.
    this.lampLights = [];
    for (let i = 0; i < 5; i++) {
      const l = new THREE.PointLight(0xffd9a8, 0, 30, 1.7);
      l.userData = {};
      scene.add(l);
      this.lampLights.push(l);
    }
  }

  /* ------------------------------------------------------------------ */
  newLevel(seed) {
    this.levelRevision++;
    this.events.length = 0;
    this._previousVisual = null;
    if (this.levelView) {
      this.scene.remove(this.levelView.group);
      this.scene.remove(this.props.group);
      this.levelView.dispose();
      this.props.dispose();
    }
    this.level = new LevelMap(48, 48, seed, this.sectorIndex);
    this.levelView = new LevelView(this.scene, this.level);

    if (!this.fx) {
      this.fx = {
        sparks: new SparkFX(this.scene, 1400),
        gibs: new GibFX(this.scene, 460),
        smoke: new SmokeFX(this.scene, 340),
        decals: new DecalFX(this.scene, 200),
        tracers: new TracerFX(this.scene, 160),
        blobs: new BlobShadowFX(this.scene, 320),
        lights: new FlashLights(this.scene, 6),
        shockwaves: new ShockwaveFX(this.scene, 24)
      };
    } else {
      this.fx.sparks.clear();
      this.fx.gibs.clear();
      this.fx.smoke.clear();
      this.fx.decals.clear();
      this.fx.tracers.clear();
      this.fx.lights.clear();
      this.fx.shockwaves.clear();
    }

    this.props = new Props(this);
    this.level.setObstacles(this.props.solids);
    if (!this.enemies) this.enemies = new EnemyManager(this);
    else this.enemies.reset();
    if (!this.projectiles) this.projectiles = new Projectiles(this);
    else this.projectiles.clear();
    if (!this.hazards) this.hazards = new Hazards(this);
    else this.hazards.clear();
    if (this.damageNumbers) this.damageNumbers.clear();
    if (!this.pickups) this.pickups = new Pickups(this);
    else this.pickups.clear();

    if (!this.player) this.player = new Player(this);
    else this.player.reset();

    this.level.rebuildNav(this.player.x, this.player.z);
    this.hud.buildMinimap(this.level);

    // frame the marine straight away so the menu has the facility as a
    // backdrop instead of whatever happens to sit at the world origin
    this.aim.set(this.player.x, 1, this.player.z + 4);
    this._camSmooth = null;
    this.updateCamera(1);
  }

  startRun(seed = freshRunSeed()) {
    sfx.flameStop();
    sfx.spinup(false, 0);
    this.sectorIndex = 0;
    this.sectorPending = false;
    this.runSeed = Number(seed) >>> 0;
    this.rng = makeRng(this.runSeed);
    this.tick = 0;
    this.newLevel(sectorSeed(this.runSeed, 0));
    this.player.reset();
    this.time = 0;
    this.wave = 0;
    this.score = 0;
    this.money = 180;
    this.upgrades = {};
    this.shopStock = [];
    this.shopRerolls = 0;
    this.perks = {};
    this.perkOffer = [];
    this.endless = false;
    this.bankedSamples = 0;
    this.runCounted = false;
    this.sampleYield = 0;
    this.sampleRate = 1;
    this.perkOfferBonus = 0;
    this.combo = 0;
    this.comboTimer = 0;
    this.waveEvent = WAVE_EVENTS[0];
    this.stats = { kills: 0, shots: 0, hits: 0, waveKills: 0 };
    this.activeBoss = null;
    this.shakeAmt = 0;
    this.hitStop.clear();
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.waveState = 'prep';
    this.prepTimer = 7;
    this.state = ST_PLAY;
    this.player.giveWeapon('smg');
    this.player.callsign = loadLook().nickname;
    this.hud.setCallsign(this.player.callsign);
    this.player.addArmor(40);
    this.applyStationUpgrades();
    this.input.clear();
    for (const id of ['start', 'pause', 'gameover', 'upgradeScreen', 'perkScreen', 'victory', 'stationScreen']) {
      document.getElementById(id).classList.remove('show');
    }
    this.hud.showBanner('ОПЕРАЦИЯ: ЗАТМЕНИЕ', 'Сектор 01 • зачистите три волны', 3);
    document.body.classList.add('playing');
    this.hud.update(0, this);
    this.revealSector();
  }

  revealSector() {
    this.presentation.removeAll();
    const reveal = this.pixelFX.uniforms.reveal;
    reveal.value = this.motionScale ? 0.25 : 1;
    new TWEEN.Tween(reveal, this.presentation).to({ value: 1 }, 700)
      .easing(TWEEN.Easing.Cubic.Out).start(this.presentationTime);
  }

  advanceSector() {
    this.pickups.collectAll();
    const p = this.player;
    // newLevel resets transient combat state; preserve the entire run loadout.
    const saved = {};
    for (const key of ['owned', 'mags', 'ammo', 'weaponIndex', 'hp', 'maxHp', 'armor', 'maxArmor',
      'damageMultiplier', 'reloadMultiplier', 'critScale', 'critPower', 'speedScale', 'dashCooldown',
      'burnScale', 'splashScale', 'chainBonus', 'pierceBonus', 'burnChains',
      'grenadeCooldown', 'grenadeCd']) saved[key] = p[key];
    this.sectorIndex++;
    this.newLevel(sectorSeed(this.runSeed, this.sectorIndex));
    Object.assign(p, saved);
    p.setWeapon(saved.weaponIndex);
    p.invuln = 2;
    this.sectorPending = false;
    this.hitStop.clear();
    this.revealSector();
    this.hud.popup('НОВЫЙ СЕКТОР • СНАРЯЖЕНИЕ СОХРАНЕНО', '#6ce9df');
  }

  /* Offered after every wave. The pick is mandatory: a build that can be
     skipped is a build the player never learns to read. Time is frozen while
     the screen is up because update() returns early for any non-play state. */
  /* Ranks are read fresh at the start of every run, so buying at the station
     takes effect on the next deployment without a reload. A profile that
     cannot be read yields no ranks rather than blocking the run. */
  /* Buying is deliberately not allowed mid-run: ranks are read once at
     deployment, so a purchase during a wave would either do nothing or
     change the run halfway through. The menu is the only entry point. */
  buyStationUpgrade(id) {
    if (this.state !== ST_MENU) return false;
    const def = META_BY_ID[id];
    if (!def) return false;
    const ranks = this.stationRanks();
    const rank = ranks[id] || 0;
    const price = metaCost(def, rank);
    const samples = parseInt(store.get('samples', '0'), 10) || 0;
    if (!Number.isFinite(price) || samples < price) return false;
    ranks[id] = rank + 1;
    store.set('samples', samples - price);
    store.set('meta', ranks);
    sfx.pickup('weapon');
    this.hud.renderStation();
    return true;
  }

  stationRanks() {
    let raw;
    try { raw = JSON.parse(store.get('meta', '{}')); } catch (error) { raw = null; }
    return clampMetaRanks(raw);
  }

  applyStationUpgrades() {
    this.metaRanks = this.stationRanks();
    for (const upgrade of META_UPGRADES) {
      const rank = this.metaRanks[upgrade.id] || 0;
      if (rank > 0) upgrade.apply(this.player, rank, this);
    }
  }

  /* Samples accrue as raw yield and are scaled once, at banking time: a rate
     bought mid-session must not retroactively change what is already earned,
     and a per-kill float would drift away from the number on screen. */
  earnedSamples() {
    return Math.floor(this.sampleYield * this.sampleRate);
  }

  /* Winning banks, and endless mode can then end in death, which banks
     again. Paying out the difference keeps a victorious run from being
     counted — or paid — twice. */
  bankRun() {
    const total = this.earnedSamples();
    const earned = Math.max(0, total - this.bankedSamples);
    this.bankedSamples = total;
    const held = parseInt(store.get('samples', '0'), 10) || 0;
    store.set('samples', held + earned);
    if (!this.runCounted) {
      this.runCounted = true;
      store.set('runs', (parseInt(store.get('runs', '0'), 10) || 0) + 1);
    }
    return earned;
  }

  /* The finale is its own encounter: the Overmind, three phases that are three
     different fights, each transition erupting a ring of vents that takes
     floor away. Its health is tuned to land close to what the old apex Hive
     Queen finale cost, so the fight gained structure without gaining length. */
  isFinalWave(wave) {
    return !this.endless && wave === RUN_FINAL_WAVE;
  }

  runProgressText() {
    if (this.endless) return 'БЕЗ ПРЕДЕЛА · ВОЛНА ' + this.wave;
    return 'ВОЛНА ' + Math.min(this.wave, RUN_FINAL_WAVE) + ' / ' + RUN_FINAL_WAVE;
  }

  onRunComplete() {
    this.state = ST_VICTORY;
    this.waveState = 'prep';
    this.activeBoss = null;
    this.hitStop.clear();
    this.input.mouseDown = false;
    document.body.classList.remove('playing');
    sfx.flameStop();
    sfx.spinup(false, 0);
    this.sampleYield += RUN_COMPLETE_SAMPLES;
    this.score += 5000;
    const best = Math.max(this.score, parseInt(store.get('best', '0'), 10) || 0);
    store.set('best', Math.floor(best));
    const earned = this.bankRun();
    const acc = this.stats.shots > 0 ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;
    document.getElementById('winTime').textContent = Math.floor(this.time / 60) + ':' +
      String(Math.floor(this.time % 60)).padStart(2, '0');
    document.getElementById('winKills').textContent = fmt(this.stats.kills);
    document.getElementById('winScore').textContent = fmt(Math.floor(this.score));
    document.getElementById('winAcc').textContent = acc + '%';
    document.getElementById('winSamples').textContent = '+' + fmt(earned);
    document.getElementById('winBuild').textContent = this.perkRankText() || 'БИЛД ПУСТ';
    document.getElementById('victory').classList.add('show');
    sfx.ui('wave');
  }

  /* Endless is the same run continued, not a new one: the build, the loadout
     and the already-banked yield all carry over, so a second banking at death
     only pays out what was earned after the win. */
  continueEndless() {
    if (this.state !== ST_VICTORY) return false;
    this.endless = true;
    this.state = ST_PLAY;
    this.waveState = 'prep';
    this.prepTimer = 12;
    this.sectorPending = true;
    this.input.endFrame();
    document.getElementById('victory').classList.remove('show');
    document.body.classList.add('playing');
    this.hud.showBanner('РЕЖИМ БЕЗ ПРЕДЕЛА', 'Волны продолжаются • рекорд идёт дальше', 3.4);
    return true;
  }

  offerPerks() {
    if (this.state !== ST_PLAY) return false;
    const offer = rollPerkOffer(this.perks, this.rng, 3 + this.perkOfferBonus);
    if (!offer.length) return false;
    this.perkOffer = offer;
    this.state = ST_PERK;
    this.input.mouseDown = false;
    sfx.flameStop();
    sfx.spinup(false, 0);
    document.body.classList.remove('playing');
    document.getElementById('perkScreen').classList.add('show');
    this.hud.renderPerks();
    sfx.ui('wave');
    return true;
  }

  choosePerk(id) {
    if (this.state !== ST_PERK) return false;
    const perk = this.perkOffer.find((p) => p.id === id);
    if (!perk) return false;
    this.perks[perk.id] = (this.perks[perk.id] || 0) + 1;
    perk.apply(this);
    this.perkOffer = [];
    this.state = ST_PLAY;
    this.input.endFrame();
    document.getElementById('perkScreen').classList.remove('show');
    document.body.classList.add('playing');
    sfx.pickup('weapon');
    this.hud.popup(perk.title + ' ПОЛУЧЕН', PERK_RARITY[perk.rarity].color);
    this.hud.update(0, this);
    // the break is doctrine then supply; opening the shop here is what makes
    // the credits earned this wave feel like they belong to this wave
    this.openUpgrades();
    return true;
  }

  perkRankText() {
    const owned = Object.keys(this.perks);
    if (!owned.length) return '';
    return owned.map((id) => PERK_BY_ID[id].title + ' ×' + this.perks[id]).join(' · ');
  }

  openUpgrades() {
    if (this.state !== ST_PLAY || this.waveState !== 'prep') return false;
    // reopening the same shop between waves must not reroll it for free
    if (!this.shopStock.length) { this.shopRerolls = 0; this.rollShop([]); }
    this.state = ST_UPGRADE;
    this.input.mouseDown = false;
    sfx.flameStop();
    sfx.spinup(false, 0);
    document.body.classList.remove('playing');
    document.getElementById('upgradeScreen').classList.add('show');
    this.hud.renderUpgrades();
    return true;
  }

  closeUpgrades() {
    if (this.state !== ST_UPGRADE) return;
    this.state = ST_PLAY;
    this.input.endFrame();
    document.getElementById('upgradeScreen').classList.remove('show');
    document.body.classList.add('playing');
  }

  /* Stock is rolled once per visit and then stands: rerolling is the only
     way to change it, and it costs. A shop that quietly reshuffled would
     make the reroll price meaningless. */
  shopContext() {
    return { owned: this.player.owned, upgrades: this.upgrades, wave: this.wave };
  }

  rollShop(keep) {
    this.shopStock = rollShopStock(this.shopContext(), this.rng, SHOP_SLOTS, keep || []);
  }

  rerollCost() {
    return shopRerollCost(this.shopRerolls);
  }

  rerollShop() {
    if (this.state !== ST_UPGRADE) return false;
    const price = this.rerollCost();
    if (this.money < price) return false;
    this.money -= price;
    this.shopRerolls++;
    // a locked slot survives; a sold one stays sold, or a reroll would be a
    // way to buy the same upgrade twice at the first rank's price
    const keep = this.shopStock.map((slot) => (slot && (slot.locked || slot.sold) ? slot : null));
    this.rollShop(keep);
    sfx.ui('tick');
    this.hud.renderUpgrades();
    return true;
  }

  toggleShopLock(index) {
    if (this.state !== ST_UPGRADE) return false;
    const slot = this.shopStock[index];
    if (!slot || slot.sold) return false;
    slot.locked = !slot.locked;
    this.hud.renderUpgrades();
    return true;
  }

  /* One entry point for spending credits. It resolves the slot, checks the
     price against the slot rather than against the table, and only then
     applies the effect — so a stale price on screen can never be honoured. */
  buySlot(index) {
    if (this.state !== ST_UPGRADE || this.waveState !== 'prep') return false;
    const slot = this.shopStock[index];
    if (!slot || slot.sold) return false;
    if (this.money < slot.price) return false;
    if (slot.kind === 'weapon') {
      if (this.player.owned[slot.id]) return false;
      // the harness is full: the player has to give something up first
      if (this.player.arsenalFull()) return false;
      this.money -= slot.price;
      this.player.giveWeapon(slot.id);
      const ammo = WEAPON_BY_ID[slot.id].ammo;
      if (ammo !== 'none') this.player.giveAmmo(ammo, AMMO_PICKUP[ammo] * 2);
      this.hud.buildWeaponRack(this.player);
      this.hud.popup(WEAPON_BY_ID[slot.id].name + ' ПРИОБРЕТЁН', '#ffc46c');
    } else {
      if (!this.applyFieldUpgrade(slot.id)) return false;
      this.money -= slot.price;
    }
    slot.sold = true;
    slot.locked = false;
    sfx.pickup('weapon');
    this.hud.renderUpgrades();
    this.hud.update(0, this);
    return true;
  }

  /* Selling happens at the counter only, and only for something that takes
     a slot. The refund is a fraction of the shelf price, so trading a
     weapon in is a way to change your mind, not a way to farm credits. */
  sellWeapon(id) {
    if (this.state !== ST_UPGRADE || this.waveState !== 'prep') return false;
    const w = WEAPON_BY_ID[id];
    if (!w || !w.price) return false;
    if (!this.player.owned[id]) return false;
    const refund = Math.floor(w.price * WEAPON_SELL_RATIO);
    if (!this.player.dropWeapon(id)) return false;
    this.money += refund;
    this.hud.buildWeaponRack(this.player);
    this.hud.popup(w.name + ' СДАН · +' + refund + ' КР.', '#8fd8ff');
    sfx.ui('tick');
    this.hud.renderUpgrades();
    this.hud.update(0, this);
    return true;
  }

  /* The effect half of a requisition, with no pricing in it. Returns false
     when the purchase would do nothing at all, so the caller never charges
     for a medkit at full health. */
  applyFieldUpgrade(id) {
    const def = FIELD_UPGRADES.find((u) => u.id === id);
    if (!def) return false;
    const count = this.upgrades[id] || 0;
    if (count >= def.max) return false;
    const p = this.player;
    if (id === 'medkit' && p.hp >= p.maxHp) return false;
    if (id === 'supply' && !p.ownedList().some((i) => {
      const w = WEAPONS[i]; return w.ammo !== 'none' && p.ammo[w.ammo] < AMMO_TYPES[w.ammo].max;
    })) return false;
    this.upgrades[id] = count + 1;
    if (id === 'damage') p.damageMultiplier = 1 + (count + 1) * 0.15;
    if (id === 'reload') p.reloadMultiplier = Math.pow(0.88, count + 1);
    if (id === 'vitality') { p.maxHp += 25; p.heal(50); }
    if (id === 'armor') { p.maxArmor += 25; p.armor = p.maxArmor; }
    if (id === 'medkit') p.heal(60);
    if (id === 'supply') for (const i of p.ownedList()) {
      const w = WEAPONS[i];
      if (w.ammo !== 'none') p.giveAmmo(w.ammo, AMMO_PICKUP[w.ammo] * 2);
    }
    return true;
  }

  /* Kept for the id-addressed path used by tooling: find the offered slot
     carrying this upgrade and buy that. There is no way to buy something the
     shop is not currently offering. */
  buyUpgrade(id) {
    const index = this.shopStock.findIndex((slot) => slot && !slot.sold && slot.kind === 'upgrade' && slot.id === id);
    return index < 0 ? false : this.buySlot(index);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.aimCamera.aspect = w / h;
    this.aimCamera.updateProjectionMatrix();
    this.pixelFX.resize(w, h);
  }

  /* dirX/dirZ point where the camera should be kicked. The strongest pending
     shake owns the direction; weaker ones only extend the decay. */
  shake(amount, duration, dirX = 0, dirZ = 0) {
    if (amount >= this.shakeAmt) { this.shakeDirX = dirX; this.shakeDirZ = dirZ; }
    this.shakeAmt = Math.max(this.shakeAmt, amount);
    this.shakeTime = Math.max(this.shakeTime, duration);
  }

  /* ---------------------------------------------------- wave director */
  waveStatusText() {
    if (this.waveState === 'prep') return 'ПОДГОТОВКА · ' + Math.max(0, Math.ceil(this.prepTimer)) + ' С';
    const left = this.spawnQueue.length + this.enemies.aliveCount;
    const label = this.isFinalWave(this.wave) ? 'ФИНАЛЬНАЯ СХВАТКА'
      : this.wave % WAVES_PER_SECTOR === 0 ? 'БОСС СЕКТОРА' : this.waveEvent.name;
    return 'ЦЕЛЕЙ: ' + left + ' · ' + label;
  }

  waveScale() {
    const w = Math.max(1, this.wave);
    const apex = this.isFinalWave(w) ? 1.45 : 1;
    return {
      hp: (1 + (w - 1) * 0.15) * this.waveEvent.hp * apex,
      dmg: 1 + (w - 1) * 0.08,
      speed: Math.min(1.6, (1 + (w - 1) * 0.02) * this.waveEvent.speed)
    };
  }

  beginWave() {
    // the shop belongs to the break, not to the run: drop the stock so the
    // next break rolls its own and the reroll price starts over
    this.shopStock = [];
    this.shopRerolls = 0;
    const moved = this.sectorPending;
    if (moved) this.advanceSector();
    this.wave++;
    this.waveState = 'active';
    this.stats.waveKills = 0;
    const w = this.wave;
    const isBoss = w % WAVES_PER_SECTOR === 0;
    const finale = this.isFinalWave(w);
    const bossId = finale ? 'overmind' : ['siege', 'warden', 'queen'][(Math.floor(w / WAVES_PER_SECTOR) - 1) % 3];
    this.waveEvent = isBoss ? WAVE_EVENTS[0] : WAVE_EVENTS[(w - 1) % WAVE_EVENTS.length];

    // budget grows super-linearly but the drip-feed keeps it survivable
    let budget = Math.floor((14 + w * 7 + w * w * 0.55) * this.waveEvent.budget);
    const pool = waveComposition(w);
    const queue = [];

    if (isBoss) {
      budget = Math.floor(budget * 0.4);
    }
    // the finale arrives with an escort, not alone in an empty room
    if (finale) budget = Math.floor(budget * 1.6);

    let guard = 0;
    while (budget > 0 && guard++ < 900) {
      let totalWeight = 0;
      for (let i = 0; i < pool.length; i++) {
        if (ENEMY_BY_ID[pool[i].id].cost <= budget) totalWeight += pool[i].weight;
      }
      if (totalWeight <= 0) break;
      let roll = this.rng() * totalWeight;
      for (let i = 0; i < pool.length; i++) {
        const def = ENEMY_BY_ID[pool[i].id];
        if (def.cost > budget) continue;
        roll -= pool[i].weight;
        if (roll <= 0) { queue.push(pool[i].id); budget -= def.cost; break; }
      }
    }

    // shuffle so the horde arrives mixed rather than sorted by type
    for (let i = queue.length - 1; i > 0; i--) {
      const j = (this.rng() * (i + 1)) | 0;
      const t = queue[i]; queue[i] = queue[j]; queue[j] = t;
    }
    if (isBoss) queue.unshift(bossId);
    this.spawnQueue = queue;
    this.spawnTimer = 0;

    sfx.ui('wave');
    if (finale) {
      this.hud.showBanner('ФИНАЛЬНАЯ СХВАТКА', ENEMY_BY_ID[bossId].label + ' • последний рубеж', 4);
    } else {
      this.hud.showBanner(isBoss ? ENEMY_BY_ID[bossId].label : moved ? this.level.sector.name : 'ВОЛНА ' + w,
        isBoss ? 'БОСС СЕКТОРА • уходите из зон поражения' : this.waveEvent.desc, isBoss || moved ? 3.4 : 2.4);
    }
  }

  endWave() {
    if (this.isFinalWave(this.wave)) { this.onRunComplete(); return; }
    this.waveState = 'prep';
    this.prepTimer = this.wave % WAVES_PER_SECTOR === 0 ? 16 : 11;
    this.activeBoss = null;
    const bonus = 100 * this.wave;
    this.score += bonus;
    const credits = 140 + this.wave * 35;
    this.money += credits;
    this.sectorPending = this.wave % WAVES_PER_SECTOR === 0;
    this.hud.showBanner(this.sectorPending ? 'СЕКТОР ЗАЧИЩЕН' : 'ВОЛНА ОТБИТА',
      '+' + credits + ' КРЕДИТОВ • B — СНАБЖЕНИЕ', 3);
    sfx.pickup('weapon');
    this.spawnWaveRewards();
    this.pickups.collectAll();
    // last, so the rewards exist before the run pauses on the choice
    this.offerPerks();
  }

  spawnWaveRewards() {
    const L = this.level;
    const p = this.player;

    // guarantee sustain between waves
    this.pickups.spawn('bigHealth', ...this._nearFloor(9));
    this.pickups.spawn('armor', ...this._nearFloor(11));

    // Only weapons that consume ammo can drop a crate. Filtering up front
    // matters: after wave 1 the player often still owns nothing but the
    // pistol, and retrying until a match turns up would never terminate.
    const feedable = p.ownedList().filter((idx) => WEAPONS[idx].ammo !== 'none');
    for (let i = 0; i < 3 && feedable.length; i++) {
      const wi = WEAPONS[feedable[(this.rng() * feedable.length) | 0]];
      this.pickups.spawn('ammo', ...this._nearFloor(8 + i * 2), wi.ammo);
    }

    // Weapons are no longer handed out on the floor. They are stock, and the
    // shop decides what is on offer; WEAPON_UNLOCK only gates how early.
  }

  _nearFloor(minDist) {
    let best = null, score = Infinity;
    for (let i = 0; i < 60; i++) {
      const pos = this.level.randomFloorPos(minDist * 0.45, this.player.x, this.player.z, this.rng);
      if (this.props.solids.some((s) => dist2(s.x, s.z, pos.x, pos.z) < (s.r + 0.8) ** 2)) continue;
      const d = Math.sqrt(dist2(pos.x, pos.z, this.player.x, this.player.z));
      const value = Math.abs(d - minDist) + (this.level.lineOfSight(pos.x, pos.z, this.player.x, this.player.z) ? 0 : 18);
      if (value < score) { score = value; best = pos; }
      if (score < 1) break;
    }
    return best ? [best.x, best.z] : [this.player.x, this.player.z];
  }

  updateWaves(dt) {
    if (this.waveState === 'prep') {
      this.prepTimer -= dt;
      if (this.prepTimer <= 3 && Math.floor(this.prepTimer + dt) !== Math.floor(this.prepTimer) && this.prepTimer > 0) {
        sfx.ui('tick');
      }
      if (this.prepTimer <= 0) this.beginWave();
      return;
    }

    // drip-feed the queue so the arena fills up instead of popping in at once
    if (this.spawnQueue.length) {
      this.spawnTimer -= dt;
      if (this.spawnTimer <= 0) {
        const live = this.enemies.aliveCount;
        const cap = Math.min(150, 34 + this.wave * 5);
        if (live < cap) {
          const id = this.spawnQueue.shift();
          this.spawnFromEdge(id);
          this.spawnTimer = ENEMY_BY_ID[id].boss ? 1.2 : lerp(0.42, 0.1, Math.min(1, this.wave / 14));
        } else {
          this.spawnTimer = 0.35;
        }
      }
    } else if (this.enemies.aliveCount === 0) {
      this.endWave();
    }
  }

  /* pick a spawn point that is off-camera and reachable */
  spawnFromEdge(id) {
    const L = this.level;
    const p = this.player;
    const pts = L.spawnPoints;
    let best = null, bestScore = -Infinity;
    for (let tries = 0; tries < 14; tries++) {
      const s = pts[(this.rng() * pts.length) | 0];
      if (!s) break;
      const d = Math.sqrt(dist2(s.x, s.z, p.x, p.z));
      if (d < 16) continue;
      // prefer just out of view, not on the far side of the map
      const score = -Math.abs(d - 26) + (L.lineOfSight(s.x, s.z, p.x, p.z) ? -14 : 0) + this.rng() * 4;
      if (score > bestScore) { bestScore = score; best = s; }
    }
    if (!best) best = L.randomFloorPos(18, p.x, p.z, this.rng);
    const jitter = 1.4;
    const e = this.spawnEnemyAt(id,
      best.x + (this.rng() - 0.5) * jitter,
      best.z + (this.rng() - 0.5) * jitter);
    if (e && e.def.boss) this.activeBoss = e;
    if (e) {
      this.fx.sparks.burst(e.x, 0.4, e.z, 8, 3, 0.5, 0.4, e.def.blood, 0.5, 8);
    }
    return e;
  }

  spawnEnemyAt(id, x, z) {
    const pos = { x: x, z: z };
    this.level.resolveCircle(pos, ENEMY_BY_ID[id].radius);
    return this.enemies.spawn(id, pos.x, pos.z, this.waveScale());
  }

  /* ------------------------------------------------------ callbacks */
  damagePlayer(amount, sx, sz) {
    this.player.takeDamage(amount, sx, sz);
  }

  /* A phase change is the arena changing, not only the boss. Vents erupt in a
     ring around it, so the fight moves because the floor the player was
     standing on stops being floor — and it moves outward, away from the boss,
     which is the opposite of what the player wants to do. Positions come from
     the run RNG and skip walls, so the eruption is reproducible by seed and
     never lands somewhere unreachable. */
  onBossPhase(e, phase) {
    const color = e.def.telegraphColor || 0xc6ff4a;
    const turn = this.rng() * Math.PI * 2;
    this.hazards.ring(e.x, e.z, 7.4 + e.bossPhase * 1.1, 5 + e.bossPhase * 2,
      2.5, 13 + e.bossPhase * 3, Math.round(9 + e.bossPhase * 4), color, turn,
      (x, z) => !this.level.isWallAt(x, z));
    this.shake(5, 0.6, 0, 0);
    if (this.fx.shockwaves) this.fx.shockwaves.emit(e.x, e.z, 9.5, color, 0.9);
    this.fx.sparks.burst(e.x, e.y + 2.4, e.z, 44, 9, 1.2, 0.9, color, 0.6, 3);
    this.fx.lights.flash(e.x, 2.2, e.z, color, 110, 22, 0.35);
    sfx.screech(0.3, 1);
    sfx.explode(0.5);
    this.hud.showBanner(e.def.label, 'ФАЗА ' + (e.bossPhase + 1) + ' • ' + phase.label, 2.6);
  }

  onHitConfirm(killed) {
    this.hud.hitMarker(killed);
  }

  /* Every point of player weapon damage passes here. Freezes are short and
     only for moments the player is meant to notice: a crit, a heavy or boss
     kill, a railgun slug. Reduced motion turns the freeze off entirely. */
  onWeaponHit(e, killed, crit, w, amount) {
    this.damageNumbers.addFor(e, amount, crit);
    if (crit) {
      e.flash = 1.7;
      e.squash = 1;
      this.hud.hitMarker(killed, true);
      sfx.ui('crit');
    }
    const d = e.def;
    let seconds = 0;
    if (killed) seconds = d.boss ? HIT_STOP.boss : d.mass >= 3 ? HIT_STOP.heavy : crit ? HIT_STOP.crit : 0;
    else if (w && w.fire === 'rail') seconds = HIT_STOP.rail;
    this.hitStop.freeze(seconds * this.motionScale);
  }

  onEnemyKilled(e) {
    this.stats.kills++;
    this.stats.waveKills++;
    // worth about one sample per common alien, dozens for a boss
    this.sampleYield += Math.max(1, Math.round((e.worth || e.def.score) / 14));
    const worth = Math.floor((e.worth || e.def.score) * (1 + this.wave * 0.05));
    this.combo = this.comboTimer > 0 ? this.combo + 1 : 1;
    this.comboTimer = 4;
    const mult = Math.min(4, 1 + Math.floor(this.combo / 5) * 0.5);
    this.score += Math.floor(worth * mult);
    if (this.combo % 5 === 0) this.hud.popup('СЕРИЯ ' + this.combo + ' • ×' + mult, '#ffe1a6');
    if (e === this.activeBoss) this.activeBoss = null;

    // loot: money is common, supplies are rarer
    const r = this.rng();
    if (e.def.boss) {
      for (let i = 0; i < 6; i++) {
        this.pickups.spawn('money', e.x + (this.rng() - 0.5) * 4, e.z + (this.rng() - 0.5) * 4, 150);
      }
      this.pickups.spawn('bigHealth', e.x + 1.5, e.z);
      this.pickups.spawn('armor', e.x - 1.5, e.z);
    } else if (r < 0.3) {
      this.pickups.spawn('money', e.x, e.z, 10 + e.def.score);
    } else if (r < 0.37) {
      const owned = this.player.ownedList();
      const w = WEAPONS[owned[(this.rng() * owned.length) | 0]];
      if (w.ammo !== 'none') this.pickups.spawn('ammo', e.x, e.z, w.ammo);
      else this.pickups.spawn('money', e.x, e.z, 15);
    } else if (r < 0.42 && this.player.hp < this.player.maxHp * 0.7) {
      this.pickups.spawn('health', e.x, e.z);
    }
  }

  onPlayerDeath() {
    this.state = ST_DEAD;
    document.getElementById('victory').classList.remove('show');
    document.body.classList.remove('playing');
    sfx.flameStop();
    sfx.spinup(false, 0);
    this.shake(12, 1.2);
    this.fx.sparks.burst(this.player.x, 1.2, this.player.z, 40, 9, 0.9, 0.6, 0xd41a1a, 1, 14);
    this.fx.decals.blood(this.player.x, this.player.z, 5);

    const best = Math.max(this.score, parseInt(store.get('best', '0'), 10) || 0);
    store.set('best', Math.floor(best));
    const earned = this.bankRun();
    const acc = this.stats.shots > 0 ? Math.round((this.stats.hits / this.stats.shots) * 100) : 0;

    document.getElementById('goWave').textContent = this.wave;
    document.getElementById('goKills').textContent = fmt(this.stats.kills);
    document.getElementById('goScore').textContent = fmt(Math.floor(this.score));
    document.getElementById('goAcc').textContent = acc + '%';
    document.getElementById('goBest').textContent = fmt(Math.floor(best));
    document.getElementById('goSamples').textContent = '+' + fmt(earned);
    document.getElementById('gameover').classList.add('show');
  }

  spawnRocket(x, y, z, angle, w) { this.projectiles.spawnRocket(x, y, z, angle, w); }
  spawnAcid(e, tx, tz) { this.projectiles.spawnAcid(e, tx, tz); }

  explosion(x, y, z, damage, radius, hurtsPlayer) {
    const fx = this.fx;
    sfx.explode(clamp(radius / 6, 0.6, 1.6));
    this.shake(clamp(radius * 1.3, 3, 11), 0.4);

    fx.lights.flash(x, y + 0.6, z, 0xffa040, 900, radius * 4.5, 0.42);
    fx.sparks.burst(x, y, z, 46, radius * 3.2, 0.65, 0.85, 0xffb040, 1, 16);
    fx.sparks.burst(x, y, z, 20, radius * 1.8, 0.9, 1.5, 0xff5a1e, 1, 8);
    for (let i = 0; i < 12; i++) {
      const a = Math.random() * TAU;
      const s = Math.random() * radius * 1.4;
      fx.smoke.emit(x + Math.cos(a) * s * 0.4, y + Math.random() * 1.4, z + Math.sin(a) * s * 0.4,
        Math.cos(a) * s, 1.6 + Math.random() * 2, Math.sin(a) * s,
        1.5 + Math.random(), 1.6, 3.4, 0x35302c, 0.55);
    }
    fx.decals.scorch(x, z, radius * 1.7);
    fx.shockwaves.emit(x, z, radius * 1.1, 0xffbd74, 0.55);

    // damage falls off with distance and requires line of sight
    const hits = this.enemies.queryRadius(x, z, radius, this._radiusHits);
    let hitCount = 0;
    for (let i = 0; i < hits.length; i++) {
      const e = hits[i];
      const dx = e.x - x, dz = e.z - z;
      const d = Math.hypot(dx, dz) || 0.001;
      if (!this.level.lineOfSight(x, z, e.x, e.z)) continue;
      hitCount++;
      const falloff = 1 - clamp(d / radius, 0, 1);
      const dmg = damage * (0.35 + falloff * 0.65);
      const killed = this.enemies.damage(e, dmg, dx / d, dz / d, 10 * falloff, 0);
      // splash never crits, so the readout shows it plain
      this.damageNumbers.addFor(e, dmg, false);
      this.onHitConfirm(killed);
    }

    if (hurtsPlayer && this.player.alive) {
      const dx = this.player.x - x, dz = this.player.z - z;
      const d = Math.hypot(dx, dz);
      if (d < radius && this.level.lineOfSight(x, z, this.player.x, this.player.z)) {
        const falloff = 1 - clamp(d / radius, 0, 1);
        // self-damage is heavily reduced so rockets stay usable in corridors
        this.player.takeDamage(damage * falloff * 0.22, x, z);
        this.player.kx += (dx / (d || 1)) * falloff * 16;
        this.player.kz += (dz / (d || 1)) * falloff * 16;
      }
    }

    // chain-react nearby barrels, staggered so it reads as a chain
    const props = this.props;
    const barrels = props.barrels;
    for (let i = 0; i < barrels.length; i++) {
      const b = barrels[i];
      if (!b.alive || b.pending) continue;
      if (dist2(b.x, b.z, x, z) < radius * radius && this.level.lineOfSight(x, z, b.x, b.z)) {
        b.hp = 0;
        b.pending = true;
        this.events.push({ dueTick: this.tick + this.rng.int(4, 11), barrel: b });
      }
    }
    return hitCount;
  }

  /* ------------------------------------------------------ main loop */
  updateEvents() {
    // Remove due entries before exploding: explosions can append more events.
    const due = this.events.filter((event) => event.dueTick <= this.tick);
    this.events = this.events.filter((event) => event.dueTick > this.tick);
    for (const event of due) {
      if (this.state !== ST_PLAY) break;
      if (event.barrel.alive) this.props.explodeBarrel(event.barrel);
    }
  }

  updateAim() {
    /* The right stick aims relative to the marine; the mouse aims at a point
       on the floor. Keeping the stick in world space rather than faking a
       cursor position means the aim does not drift when the camera leads. */
    const look = this.input.stick(2, 3);
    if (look) {
      const reach = 14;
      this.aim.set(this.player.x + look.x * reach, 1, this.player.z + look.z * reach);
      return;
    }
    this._ndc.set(this.input.mx, this.input.my);
    this.raycaster.setFromCamera(this._ndc, this.aimCamera);
    const ray = this.raycaster.ray;
    const planeY = 1.0;
    const denom = ray.direction.y;
    if (Math.abs(denom) < 1e-5) return;
    const t = (planeY - ray.origin.y) / denom;
    if (t < 0) return;
    this.aim.copy(ray.direction).multiplyScalar(t).add(ray.origin);
  }

  updateCamera(dt) {
    const p = this.player;
    // bias the framing toward where the player is aiming
    let lx = this.aim.x - p.x, lz = this.aim.z - p.z;
    const llen = Math.hypot(lx, lz);
    const maxLead = 6.5;
    if (llen > maxLead) { lx = lx / llen * maxLead; lz = lz / llen * maxLead; }

    // keep the framing inside the facility so the border never dominates view
    const halfW = (this.level.w / 2 - 3) * TILE;
    const halfH = (this.level.h / 2 - 3) * TILE;
    this._camTarget.set(
      clamp(p.x + lx * 0.42, -halfW, halfW),
      0,
      clamp(p.z + lz * 0.42, -halfH, halfH)
    );
    if (!this._camSmooth) this._camSmooth = this._camTarget.clone();
    this._camSmooth.x = damp(this._camSmooth.x, this._camTarget.x, 6.5, dt);
    this._camSmooth.z = damp(this._camSmooth.z, this._camTarget.z, 6.5, dt);

    this._camPos.copy(this._camSmooth).add(this.camOffset);

    // Aim uses a fixed-tick camera before cosmetic shake or interpolation.
    this.aimCamera.position.copy(this._camPos);
    this.aimCamera.lookAt(this._camSmooth.x, 0.8, this._camSmooth.z);
    this.aimCamera.updateMatrixWorld();

    if (this.shakeTime > 0) {
      this.shakeTime -= dt;
      const k = this.shakeAmt * clamp(this.shakeTime / 0.3, 0, 1) * this.motionScale;
      // a damped oscillation along the impact axis reads as recoil; the
      // leftover random jitter keeps it from looking mechanical
      const punch = Math.sin(this.shakeTime * 54) * k * 0.2;
      this._camPos.x += this.shakeDirX * punch + (Math.random() - 0.5) * k * 0.12;
      this._camPos.y += (Math.random() - 0.5) * k * 0.16;
      this._camPos.z += this.shakeDirZ * punch + (Math.random() - 0.5) * k * 0.12;
      if (this.shakeTime <= 0) { this.shakeAmt = 0; this.shakeDirX = 0; this.shakeDirZ = 0; }
    }

    this.camera.position.copy(this._camPos);
    this.camera.lookAt(this._camSmooth.x, 0.8, this._camSmooth.z);

    // keep the shadow frustum centred on the action
    this.keyLight.position.set(p.x + 18, 34, p.z + 14);
    this.keyLight.target.position.set(p.x, 0, p.z);
    this.keyLight.target.updateMatrixWorld();
  }

  update(dt) {
    const input = this.input;
    input.pollPad();
    /* An open screen owns the stick and the d-pad. It reads directions as
       held state and takes only the pad's own edges, so nothing below has
       to know a menu is up. */
    this.ui.update(dt);
    this.captureVisualState();
    if (this.state !== ST_PAUSE && this.state !== ST_UPGRADE) {
      this.presentationTime += dt * 1000;
      this.presentation.update(this.presentationTime, false);
    }
    if (this.state !== ST_PLAY && sfx.musicBus) sfx.musicBus.gain.setTargetAtTime(0, sfx.t, 0.12);

    if (this.state === ST_VICTORY) {
      // Enter is not read here: it clicks whichever button the screen has
      // focused, which is what the hint means and what a pad does too
      input.endFrame();
      return;
    }
    if (this.state === ST_PERK) {
      // number keys mirror the cards left to right; there is no way to decline
      for (let i = 0; i < this.perkOffer.length; i++) {
        if (input.once('Digit' + (i + 1))) { this.choosePerk(this.perkOffer[i].id); break; }
      }
      input.endFrame();
      return;
    }
    if (this.state === ST_UPGRADE) {
      if (input.once('Escape') || input.actionOnce('shop')) this.closeUpgrades();
      input.endFrame();
      return;
    }
    if (this.state === ST_PLAY && input.actionOnce('shop')) {
      if (this.openUpgrades()) { input.endFrame(); return; }
      this.hud.popup('СНАБЖЕНИЕ ДОСТУПНО МЕЖДУ ВОЛНАМИ', '#ffc46c');
    }

    if (input.actionOnce('pause')) {
      if (this.state === ST_PLAY) {
        this.state = ST_PAUSE;
        document.body.classList.remove('playing');
        sfx.flameStop();
        sfx.spinup(false, 0);
        document.getElementById('pause').classList.add('show');
      } else if (this.state === ST_PAUSE) {
        this.state = ST_PLAY;
        document.body.classList.add('playing');
        document.getElementById('pause').classList.remove('show');
      }
    }
    if (input.actionOnce('music')) {
      sfx.musicOn = !sfx.musicOn;
      store.set('music', sfx.musicOn ? '1' : '0');
      this.hud.popup(sfx.musicOn ? 'МУЗЫКА ВКЛЮЧЕНА' : 'МУЗЫКА ВЫКЛЮЧЕНА', '#8fd8ff');
    }

    if (this.state !== ST_PLAY) {
      // Enter belongs to the focused button; R stays a bare shortcut
      if (this.state === ST_DEAD && input.once('KeyR')) {
        document.getElementById('gameover').classList.remove('show');
        this.startRun();
      }
      // keep the lamps breathing behind the menu and the death screen
      if (this.state === ST_MENU || this.state === ST_DEAD) {
        this.time += dt;
        this.levelView.updateLamps(this.lampLights, this.player.x, this.player.z, this.time);
        this.fx.lights.update(dt);
        if (this.state === ST_DEAD) {
          this.player.update(dt, input, this.aim.x, this.aim.z);
          this.fx.sparks.update(dt, this.camera.quaternion);
          this.fx.smoke.update(dt, this.camera.quaternion);
          this.fx.tracers.update(dt);
          this.fx.shockwaves.update(dt);
          this.fx.gibs.update(dt, this.level, () => {});
          this.updateCamera(dt);
        }
      }
      input.endFrame();
      return;
    }

    /* Impact freeze. The tick is still spent, so the wave director, the clock
       and the replay stay aligned; only the world stops moving. Camera and
       particles keep running or the freeze reads as a dropped frame. */
    if (this.hitStop.consume()) {
      this.updateCamera(dt);
      this.fx.lights.update(dt);
      this.fx.sparks.update(dt, this.camera.quaternion);
      this.fx.smoke.update(dt, this.camera.quaternion);
      this.hud.update(dt, this);
      input.endFrame();
      return;
    }

    this.time += dt;
    this.tick++;
    this.updateEvents();
    if (this.state !== ST_PLAY) { input.endFrame(); return; }
    if (input.actionOnce('nextWave') && this.waveState === 'prep') this.prepTimer = 0;
    this.comboTimer = Math.max(0, this.comboTimer - dt);
    if (this.comboTimer === 0) this.combo = 0;
    this.updateAim();

    this.player.update(dt, input, this.aim.x, this.aim.z);
    this.props.resolve(this.player, PLAYER_RADIUS);
    if (this.player.alive) this.player.updateModel(0, Math.hypot(this.player.vx, this.player.vz));
    if (this.state !== ST_PLAY) { input.endFrame(); return; }

    // refresh the flow field a few times a second — cheap and plenty responsive
    this.level.navTimer -= dt;
    if (this.level.navTimer <= 0) {
      this.level.navTimer = 0.18;
      this.level.rebuildNav(this.player.x, this.player.z);
    }

    this.enemies.update(dt, this.player);
    if (this.state !== ST_PLAY) { input.endFrame(); return; }
    for (let i = 0; i < this.enemies.list.length; i++) {
      const e = this.enemies.list[i];
      if (e.state !== S_DYING) this.props.resolve(e, e.def.radius * 0.7);
    }

    this.projectiles.update(dt, this.player);
    this.hazards.update(dt, this.player);
    this.damageNumbers.update(dt);
    if (this.state !== ST_PLAY) { input.endFrame(); return; }
    this.pickups.update(dt, this.player, this.time);
    this.updateWaves(dt);

    const camQuat = this.camera.quaternion;
    this.fx.sparks.update(dt, camQuat);
    this.fx.smoke.update(dt, camQuat);
    this.fx.tracers.update(dt);
    this.fx.gibs.update(dt, this.level, (x, z, r, g, b) => {
      if (Math.random() < 0.4) this.fx.decals.blood(x, z, 0.7 + Math.random() * 0.9);
    });
    this.fx.lights.update(dt);
    this.fx.shockwaves.update(dt);

    this.fx.blobs.begin();
    this.fx.blobs.add(this.player.x, this.player.z, 1.5);
    this.enemies.render(this.fx.blobs);
    this.fx.blobs.end();

    this.updateCamera(dt);
    this.levelView.updateLamps(this.lampLights, this.player.x, this.player.z, this.time);

    // music intensity tracks how much pressure the player is under
    const pressure = clamp(this.enemies.aliveCount / 26, 0, 1) * 0.7 +
      clamp(1 - (this.time - this.player.lastDamageTime) / 6, 0, 1) * 0.3;
    sfx.updateMusic(dt, this.waveState === 'prep' ? pressure * 0.25 : pressure);

    this.hud.update(dt, this);
    const rect = this.canvas.getBoundingClientRect();
    this.hud.setCrosshair(
      (input.mx * 0.5 + 0.5) * rect.width,
      (-input.my * 0.5 + 0.5) * rect.height,
      (this.player.aiming ? 3 : 6) + this.player.weapon.spread * this.player.spreadScale * 90 + this.player.recoil * 40
    );

    input.endFrame();
  }

  captureVisualState() {
    const p = this.player;
    if (!this._previousVisual) this._previousVisual = {
      player: new THREE.Vector3(), rotation: new THREE.Quaternion(),
      camera: new THREE.Vector3(), cameraRotation: new THREE.Quaternion()
    };
    const previous = this._previousVisual;
    previous.player.copy(p.root.position); previous.rotation.copy(p.root.quaternion);
    previous.camera.copy(this.camera.position); previous.cameraRotation.copy(this.camera.quaternion);
  }

  render(alpha = 1) {
    // Interpolation is temporary. In particular muzzleWorld() must always see
    // the authoritative weapon transform, even when called after a render.
    const previous = this._previousVisual;
    const p = this.player;
    if (!previous || this.state !== ST_PLAY) alpha = 1;
    const position = p.root.position.clone(), rotation = p.root.quaternion.clone();
    const playerEuler = p.root.rotation.clone(), silhouetteEuler = p.silhouette.rotation.clone();
    const silhouettePosition = p.silhouette.position.clone();
    const cameraPosition = this.camera.position.clone(), cameraRotation = this.camera.quaternion.clone();
    if (alpha < 1) {
      p.root.position.lerpVectors(previous.player, position, alpha);
      p.root.quaternion.slerpQuaternions(previous.rotation, rotation, alpha);
      p.silhouette.position.copy(p.root.position);
      p.silhouette.quaternion.copy(p.root.quaternion);
      this.camera.position.lerpVectors(previous.camera, cameraPosition, alpha);
      this.camera.quaternion.slerpQuaternions(previous.cameraRotation, cameraRotation, alpha);
    }
    this.fx.blobs.begin();
    this.fx.blobs.add(p.root.position.x, p.root.position.z, 1.5);
    this.enemies.render(this.fx.blobs, alpha);
    this.fx.blobs.end();
    this.projectiles.render(alpha);
    this.hazards.render();
    this.damageNumbers.render(this.camera, this._dmgPoint, window.innerWidth, window.innerHeight);
    try { this.pixelFX.render(this.scene, this.camera); }
    finally {
      p.root.position.copy(position); p.root.rotation.copy(playerEuler);
      p.silhouette.position.copy(silhouettePosition); p.silhouette.rotation.copy(silhouetteEuler);
      p.root.updateMatrixWorld(true);
      this.camera.position.copy(cameraPosition); this.camera.quaternion.copy(cameraRotation);
      this.camera.updateMatrixWorld();
    }
  }
}
