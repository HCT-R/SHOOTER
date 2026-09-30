/* ========================================================================
   99-main.js — boot, asset generation, frame loop
   ======================================================================== */

function boot() {
  const canvas = document.getElementById('view');
  const loading = document.getElementById('loading');

  // everything is generated, so "loading" is really just CPU work
  buildTextures();
  initPrimitives();
  buildWeaponGeometries();
  buildPropGeometries();
  buildPickupGeometries();

  let game;
  try {
    game = new Game(canvas);
  } catch (err) {
    loading.innerHTML = '<div class="err">Could not start WebGL<br><small>' +
      String(err && err.message ? err.message : err) + '</small></div>';
    throw err;
  }
  window.game = game;
  // handles for the headless smoke test and for poking at things in devtools
  window.PixelProtocol = { sfx: sfx, THREE: THREE, WEAPONS: WEAPONS, WEAPON_BY_ID: WEAPON_BY_ID, ENEMY_TYPES: ENEMY_TYPES, TEX: TEX,
    loadLook: loadLook, saveLook: saveLook, randomLook: randomLook, clampLook: clampLook,
    SECTOR_DEFS: SECTOR_DEFS, FIELD_UPGRADES: FIELD_UPGRADES, LevelMap: LevelMap,
    ELITE_MODS: ELITE_MODS, ELITE_BY_ID: ELITE_BY_ID, eliteChance: eliteChance,
    PERKS: PERKS, PERK_BY_ID: PERK_BY_ID, PERK_RARITY: PERK_RARITY, PERK_TAGS: PERK_TAGS,
    SHOP_SLOTS: SHOP_SLOTS, shopRerollCost: shopRerollCost, shopCandidates: shopCandidates,
    ARSENAL_SLOTS: ARSENAL_SLOTS, WEAPON_SELL_RATIO: WEAPON_SELL_RATIO,
    ACTIONS: ACTIONS, ACTION_BY_ID: ACTION_BY_ID, defaultBinds: defaultBinds, clampBinds: clampBinds,
    UiNav: UiNav, NavRepeat: NavRepeat, pickNeighbour: pickNeighbour, navAdjustable: navAdjustable,
    navAdjust: navAdjust, navKey: navKey, NAV_SCREENS: NAV_SCREENS, NAV_SELECTOR: NAV_SELECTOR,
    NAV_KEYS: NAV_KEYS, NAV_STICK: NAV_STICK, NAV_REPEAT_FIRST: NAV_REPEAT_FIRST,
    PAD_DEADZONE: PAD_DEADZONE, OSK_ROWS: OSK_ROWS, oskType: oskType, NICKNAME_MAX: NICKNAME_MAX,
    rollShopStock: rollShopStock, WEAPON_UNLOCK: WEAPON_UNLOCK,
    META_UPGRADES: META_UPGRADES, META_BY_ID: META_BY_ID, metaCost: metaCost,
    clampMetaRanks: clampMetaRanks, metaInvested: metaInvested,
    rollPerkOffer: rollPerkOffer, perkAvailable: perkAvailable, perkTagCount: perkTagCount,
    sanitizeNickname: sanitizeNickname, TWEEN: TWEEN, PixelRenderer: PixelRenderer,
    posePlayerWeapon: posePlayerWeapon, configureWeaponModel: configureWeaponModel,
    RUN_FINAL_WAVE: RUN_FINAL_WAVE, WAVES_PER_SECTOR: WAVES_PER_SECTOR,
    RUN_COMPLETE_SAMPLES: RUN_COMPLETE_SAMPLES,
    FixedStepClock: FixedStepClock, SIM_DT: SIM_DT, store: store,
    Hazards: Hazards, HAZARD_TICK: HAZARD_TICK, HAZARD_WARM: HAZARD_WARM, HAZARD_FADE: HAZARD_FADE,
    WeaponPortraits: WeaponPortraits, weaponPortraits: weaponPortraits,
    DamageNumbers: DamageNumbers, DAMAGE_NUMBER_CAP: DAMAGE_NUMBER_CAP,
    DAMAGE_NUMBER_LIFE: DAMAGE_NUMBER_LIFE, DAMAGE_NUMBER_MERGE: DAMAGE_NUMBER_MERGE,
    ENEMY_BY_ID: ENEMY_BY_ID, nextBossPhase: nextBossPhase,
    HitStop: HitStop, HIT_STOP: HIT_STOP };
  window.AS3D = window.PixelProtocol; // compatibility for existing developer probes

  let customizer = null;
  try {
    customizer = new Customizer(game);
    window.AS3D.customizer = customizer;
  } catch (err) {
    // a second WebGL context can fail on locked-down machines; the game
    // itself must still run, customization just becomes unavailable
    window.AS3D.customizerError = String(err && err.message);
    console.warn('customizer unavailable: ' + (err && err.message));
  }

  loading.style.display = 'none';
  document.getElementById('start').classList.add('show');
  const refreshMenuTotals = () => {
    document.getElementById('menuBest').textContent = fmt(parseInt(store.get('best', '0'), 10) || 0);
    document.getElementById('menuSamples').textContent = fmt(parseInt(store.get('samples', '0'), 10) || 0);
  };
  refreshMenuTotals();
  const volume = document.getElementById('volumeSetting');
  volume.value = clamp(Number(store.get('volume', '55')), 0, 100);
  sfx.musicOn = store.get('music', '1') !== '0';
  volume.addEventListener('input', () => {
    store.set('volume', volume.value);
    if (sfx.master) sfx.master.gain.setTargetAtTime(Number(volume.value) / 100, sfx.ctx.currentTime, 0.05);
  });
  const motion = document.getElementById('motionSetting');
  if (store.get('motion', '') === '' && window.matchMedia('(prefers-reduced-motion: reduce)').matches) game.motionScale = 0;
  motion.checked = game.motionScale > 0;
  motion.addEventListener('change', () => {
    game.motionScale = motion.checked ? 1 : 0;
    store.set('motion', game.motionScale);
  });
  const dmgnum = document.getElementById('dmgnumSetting');
  dmgnum.checked = game.damageNumbers.enabled;
  dmgnum.addEventListener('change', () => {
    game.damageNumbers.enabled = dmgnum.checked;
    // turning them off has to clear what is already on screen, or the last
    // few numbers hang there until they age out
    if (!dmgnum.checked) game.damageNumbers.clear();
    store.set('dmgnum', dmgnum.checked ? '1' : '0');
  });
  const pixelSetting = document.getElementById('pixelSetting');
  pixelSetting.value = String(game.pixelFX.pixelSize);
  pixelSetting.addEventListener('change', () => {
    game.pixelFX.setPixelSize(pixelSetting.value);
    if (customizer && customizer.pixelFX) customizer.pixelFX.setPixelSize(pixelSetting.value);
    store.set('pixels', game.pixelFX.pixelSize);
    game.pixelRatioScale = 1;
    game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  });
  document.getElementById('upgradeClose').addEventListener('click', () => game.closeUpgrades());
  document.getElementById('upgradeGrid').addEventListener('click', (e) => {
    const lock = e.target.closest('[data-lock]');
    if (lock) { game.toggleShopLock(Number(lock.dataset.lock)); return; }
    const button = e.target.closest('[data-slot]');
    if (button) game.buySlot(Number(button.dataset.slot));
  });
  document.getElementById('shopReroll').addEventListener('click', () => game.rerollShop());
  document.getElementById('shopArsenal').addEventListener('click', (e) => {
    const button = e.target.closest('[data-sell]');
    if (button) game.sellWeapon(button.dataset.sell);
  });
  document.getElementById('perkGrid').addEventListener('click', (e) => {
    const button = e.target.closest('[data-perk]');
    if (button) game.choosePerk(button.dataset.perk);
  });
  document.getElementById('stationGrid').addEventListener('click', (e) => {
    const button = e.target.closest('[data-station]');
    if (button) game.buyStationUpgrade(button.dataset.station);
  });
  const showStation = () => {
    document.getElementById('start').classList.remove('show');
    document.getElementById('stationScreen').classList.add('show');
    game.hud.renderStation();
  };
  const hideStation = () => {
    document.getElementById('stationScreen').classList.remove('show');
    document.getElementById('start').classList.add('show');
    refreshMenuTotals();
  };
  document.getElementById('stationBtn').addEventListener('click', showStation);
  document.getElementById('endlessBtn').addEventListener('click', () => game.continueEndless());
  document.getElementById('winStationBtn').addEventListener('click', () => {
    document.getElementById('victory').classList.remove('show');
    game.state = ST_MENU;
    document.body.classList.remove('playing');
    refreshMenuTotals();
    showStation();
  });
  document.getElementById('stationClose').addEventListener('click', hideStation);

  const beginRun = () => {
    sfx.init();
    sfx.resume();
    if (sfx.master) sfx.master.gain.value = Number(volume.value) / 100;
    document.getElementById('start').classList.remove('show');
    game.startRun();
  };
  document.getElementById('deployBtn').addEventListener('click', beginRun);
  document.getElementById('custBtn').addEventListener('click', () => {
    if (!customizer) return;
    document.getElementById('start').classList.remove('show');
    customizer.show();
  });
  document.getElementById('custSave').addEventListener('click', () => {
    customizer.commit();
    customizer.hide();
    document.getElementById('start').classList.add('show');
  });
  document.getElementById('custRandom').addEventListener('click', () => {
    if (customizer) customizer.randomize();
  });
  document.getElementById('custReset').addEventListener('click', () => {
    if (customizer) customizer.resetLook();
  });
  document.getElementById('retryBtn').addEventListener('click', () => {
    document.getElementById('gameover').classList.remove('show');
    game.startRun();
  });
  document.getElementById('lockerBtn').addEventListener('click', () => {
    document.getElementById('gameover').classList.remove('show');
    game.state = ST_MENU;
    document.body.classList.remove('playing');
    refreshMenuTotals();
    showStation();
  });
  /* On-screen keyboard for the callsign. The field is never navigated to: a
     focused text input owns the arrow keys, so a pad reaches the callsign
     through this instead, while a mouse still clicks straight into the field.
     Keys are built as nodes with textContent rather than markup, because the
     value shown here is whatever the player typed. */
  const oskField = () => document.getElementById('custNickname');
  const oskScreen = document.getElementById('oskScreen');
  const oskKeys = document.getElementById('oskKeys');
  const oskCount = document.createElement('span');
  const oskShown = document.createElement('span');
  oskCount.id = 'oskCount';
  document.getElementById('oskValue').appendChild(oskCount);
  document.getElementById('oskValue').appendChild(oskShown);
  let oskLayout = 'ru';

  const oskDraw = () => {
    const text = oskField().value;
    const length = Array.from(text).length;
    oskCount.textContent = length + ' / ' + NICKNAME_MAX;
    oskShown.textContent = text || 'ПОЗЫВНОЙ';
    oskShown.className = text ? '' : 'placeholder';
  };
  const oskApply = (key) => {
    const field = oskField();
    field.value = oskType(field.value, key, NICKNAME_MAX);
    // the editor listens for input to sanitise and count, so go through it
    field.dispatchEvent(new Event('input', { bubbles: true }));
    oskDraw();
  };
  const oskBuild = () => {
    oskKeys.textContent = '';
    for (const row of OSK_ROWS[oskLayout]) {
      const line = document.createElement('div');
      line.className = 'oskRow';
      for (const ch of row) {
        const key = document.createElement('button');
        key.type = 'button';
        key.dataset.key = ch;
        key.textContent = ch;
        line.appendChild(key);
      }
      oskKeys.appendChild(line);
    }
    document.getElementById('oskLayout').textContent = oskLayout === 'ru' ? 'LAT' : 'РУС';
  };
  const oskOpen = () => { oskBuild(); oskDraw(); oskScreen.classList.add('show'); };
  const oskClose = () => oskScreen.classList.remove('show');

  oskKeys.addEventListener('click', (e) => {
    const key = e.target.closest('[data-key]');
    if (key) oskApply(key.dataset.key);
  });
  document.getElementById('oskSpace').addEventListener('click', () => oskApply(' '));
  document.getElementById('oskBack').addEventListener('click', () => oskApply('back'));
  document.getElementById('oskClear').addEventListener('click', () => oskApply('clear'));
  document.getElementById('oskLayout').addEventListener('click', () => {
    oskLayout = oskLayout === 'ru' ? 'en' : 'ru';
    oskBuild();
  });
  document.getElementById('oskDone').addEventListener('click', oskClose);
  document.getElementById('custKeyboard').addEventListener('click', oskOpen);

  /* Rebinding capture. The listener is installed only while a row is armed
     so a stray keypress can never rewrite a binding, and it runs in the
     capture phase so the game's own handlers do not also see the key. */
  let bindingAction = null;
  const renderBinds = () => game.hud.renderBinds();
  const stopBinding = () => {
    if (!bindingAction) return;
    window.removeEventListener('keydown', captureBind, true);
    bindingAction = null;
    game.ui.suspended = false;
    renderBinds();
  };
  function captureBind(e) {
    e.preventDefault();
    e.stopPropagation();
    const action = bindingAction;
    if (e.code !== 'Escape') {
      const current = (game.input.binds[action] || []).slice();
      // binding a key it already has removes it, so the same button both
      // adds and clears without a separate control
      const at = current.indexOf(e.code);
      if (at >= 0) current.splice(at, 1); else current.unshift(e.code);
      game.input.rebind(action, current);
    }
    stopBinding();
  }
  document.getElementById('bindPanel').addEventListener('click', (e) => {
    const button = e.target.closest('[data-bind]');
    if (!button) return;
    stopBinding();
    bindingAction = button.dataset.bind;
    // the screen is waiting for a key; navigation must not also read one
    game.ui.suspended = true;
    window.addEventListener('keydown', captureBind, true);
    renderBinds();
    button.closest('.bindRow').classList.add('listening');
    button.textContent = 'НАЖМИТЕ КЛАВИШУ';
  });
  document.getElementById('bindReset').addEventListener('click', () => {
    stopBinding();
    game.input.resetBinds();
    renderBinds();
  });
  renderBinds();

  document.getElementById('resumeBtn').addEventListener('click', () => {
    game.state = ST_PLAY;
    document.body.classList.add('playing');
    document.getElementById('pause').classList.remove('show');
  });
  document.getElementById('quitBtn').addEventListener('click', () => {
    document.getElementById('pause').classList.remove('show');
    document.getElementById('start').classList.add('show');
    game.state = ST_MENU;
    document.body.classList.remove('playing');
    game.input.mouseDown = false;
    sfx.flameStop();
    sfx.spinup(false, 0);
    refreshMenuTotals();
  });
  window.addEventListener('resize', () => { if (customizer) customizer._resize(); });
  window.addEventListener('keydown', (e) => {
    /* Escape leaves the innermost thing first: the keyboard, then the
       editor. Without the order the keyboard would take the whole editor
       down with it. */
    const escapeEditor = () => {
      if (!customizer || !customizer._running) return;
      if (oskScreen.classList.contains('show')) oskClose();
      else document.getElementById('custSave').click();
    };
    if (InputState.isEditable(e.target)) {
      if (e.code === 'Escape') escapeEditor();
      return;
    }
    /* Arrows and WASD steer the open screen. Without this a focused
       dropdown would change its value while the focus walked away from
       it, and the page would scroll under the menu. */
    if (game.ui.active() && NAV_KEYS.indexOf(e.code) >= 0) e.preventDefault();
    if (e.code === 'Enter' && game.state === ST_MENU && !(customizer && customizer._running) && e.target.tagName !== 'BUTTON') beginRun();
    if (e.code === 'Escape') escapeEditor();
  });
  if (!customizer) document.getElementById('custBtn').disabled = true;
  const pauseForFocus = () => {
    if (game.state !== ST_PLAY) return;
    game.state = ST_PAUSE;
    sfx.flameStop();
    sfx.spinup(false, 0);
    document.body.classList.remove('playing');
    document.getElementById('pause').classList.add('show');
  };
  window.addEventListener('blur', pauseForFocus);
  // the audio context can be suspended by the browser until a real gesture
  window.addEventListener('pointerdown', () => sfx.resume());

  /* --- frame loop with adaptive resolution ------------------------- */
  let last = performance.now();
  let slowFrames = 0, fastFrames = 0;
  const clock = new FixedStepClock();
  game.clock = clock;
  let lastState = game.state, lastRevision = game.levelRevision;
  window.addEventListener('blur', () => { clock.reset(); game.input.clear(); });
  document.addEventListener('visibilitychange', () => {
    clock.reset(); last = performance.now();
    game.input.clear();
    if (document.hidden) pauseForFocus();
  });

  function frame(now) {
    requestAnimationFrame(frame);
    const raw = (now - last) / 1000;
    last = now;
    // Preview animation is presentation only; combat always advances at60Hz.
    const dt = clamp(raw, 0.0001, 0.05);

    // The editor fills the screen. Give its model the frame budget while
    // it is open instead of drawing a second, completely hidden 3D scene.
    if (customizer && customizer._running) {
      /* The editor runs outside the fixed step, so navigation has to be
         driven from here: game.update() never runs while it is open. Input is
         no longer wiped every frame — the editor needs it now — and is
         cleared on the way in and on the way out instead. */
      clock.reset();
      game.input.pollPad();
      game.ui.update(dt);
      customizer.update(dt);
      game.input.endFrame();
    } else {
      const changed = lastState !== game.state || lastRevision !== game.levelRevision;
      if (changed) {
        clock.reset(); game._previousVisual = null;
      }
      const frameStep = clock.advance(changed ? 0 : raw, (step) => {
        const state = game.state, revision = game.levelRevision;
        game.update(step);
        return state === game.state && revision === game.levelRevision;
      });
      lastState = game.state; lastRevision = game.levelRevision;
      game.render(frameStep.alpha);
    }

    // drop internal resolution if we are consistently missing frame budget
    if (raw > 0.026) { slowFrames++; fastFrames = 0; } else { fastFrames++; slowFrames = 0; }
    if (!game.pixelFX.pixelSize && slowFrames > 90 && game.pixelRatioScale > 0.64) {
      game.pixelRatioScale = Math.max(0.64, game.pixelRatioScale - 0.18);
      game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * game.pixelRatioScale);
      slowFrames = 0;
    } else if (fastFrames > 600 && game.pixelRatioScale < 1) {
      game.pixelRatioScale = Math.min(1, game.pixelRatioScale + 0.18);
      game.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2) * game.pixelRatioScale);
      fastFrames = 0;
    }
  }
  requestAnimationFrame(frame);
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
