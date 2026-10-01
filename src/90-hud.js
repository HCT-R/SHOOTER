/* ========================================================================
   90-hud.js — DOM overlay: bars, weapon rack, minimap, screens
   ======================================================================== */

/* Short, readable names for key codes. The panel is narrow and "ShiftLeft"
   in a row of two-character labels wrecks the column. */
function keyLabel(code) {
  if (!code) return '—';
  if (/^Key[A-Z]$/.test(code)) return code.slice(3);
  if (/^Digit[0-9]$/.test(code)) return code.slice(5);
  if (/^Numpad[0-9]$/.test(code)) return 'N' + code.slice(6);
  const named = {
    ArrowUp: '↑', ArrowDown: '↓', ArrowLeft: '←', ArrowRight: '→',
    ShiftLeft: 'SHIFT', ShiftRight: 'SHIFT ПР', ControlLeft: 'CTRL', ControlRight: 'CTRL ПР',
    AltLeft: 'ALT', AltRight: 'ALT ПР', Space: 'ПРОБЕЛ', Enter: 'ENTER', Escape: 'ESC',
    Tab: 'TAB', Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']',
    Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/'
  };
  return named[code] || code;
}

class Hud {
  constructor(game) {
    this.game = game;
    const $ = (id) => document.getElementById(id);
    this.$ = $;

    this.healthFill = $('healthFill');
    this.healthText = $('healthText');
    this.armorFill = $('armorFill');
    this.armorText = $('armorText');
    this.ammoMag = $('ammoMag');
    this.ammoReserve = $('ammoReserve');
    this.weaponName = $('weaponName');
    this.reloadBar = $('reloadBar');
    this.reloadFill = $('reloadFill');
    this.weaponRack = $('weaponRack');
    this.waveNum = $('waveNum');
    this.waveInfo = $('waveInfo');
    this.scoreVal = $('scoreVal');
    this.killsVal = $('killsVal');
    this.moneyVal = $('moneyVal');
    this.vignette = $('vignette');
    this.banner = $('banner');
    this.bannerSub = $('bannerSub');
    this.bannerWrap = $('bannerWrap');
    this.popups = $('popups');
    this.crosshair = $('crosshair');
    this.hitmark = $('hitmark');
    this.bossWrap = $('bossWrap');
    this.bossFill = $('bossFill');
    this.bossName = $('bossName');
    this.dashFill = $('dashFill');
    this.fpsVal = $('fpsVal');
    this.grenadeFill = $('grenadeFill');
    this.grenadeText = $('grenadeText');
    this.sectorName = $('sectorName');
    this.sectorIndex = $('sectorIndex');
    this.sectorObjective = $('sectorObjective');
    this.comboBox = $('comboBox');
    this.comboCount = $('comboCount');
    this.comboFill = $('comboFill');
    this.prepHint = $('prepHint');

    this.mapCanvas = $('minimap');
    this.mapCtx = this.mapCanvas.getContext('2d');

    this._rackIds = null;
    this._hitTimer = 0;
    this._killTimer = 0;
    this._critTimer = 0;
    // the strip is rebuilt only when the build actually changes, not per frame
    this._buildSignature = null;
    this._bannerTimer = 0;
    this._popupPool = [];
    this._fpsAcc = 0;
    this._fpsFrames = 0;
    this._lastMag = -1;
    this._modeHudTimer = 0;
    this._rosterSignature = '';
    this._arenaHud = null;
    this._damageCueTimer = 0;
    this._damageCueSource = { x: 0, z: 0 };
    this._signalOrigin = new THREE.Vector3();
    this._signalTarget = new THREE.Vector3();
    this._namePoint = new THREE.Vector3();
    this._escortPoint = new THREE.Vector3();
    this.setCallsign(loadLook().nickname);
  }

  setCallsign(value) {
    const name = sanitizeNickname(value);
    for (const id of ['playerCallsign', 'playerNameTag', 'menuCallsign']) this.$(id).textContent = name;
  }

  resetTransient() {
    this._hitTimer = this._killTimer = this._critTimer = this._bannerTimer = this._damageCueTimer = 0;
    this._modeHudTimer = 0; this._hudModeId = null; this._arenaHud = null;
    this._rackIds = null; this._buildSignature = null; this._rosterSignature = '';
    this.bannerWrap.classList.remove('show'); this.hitmark.style.opacity = '0'; this.vignette.style.opacity = '0';
    for (const node of this.popups.children) clearTimeout(node._t);
    this.popups.replaceChildren(); this._popupPool.length = 0;
    for (const id of ['damageDirection', 'zoneDirection', 'countdownCue', 'zoneWarning', 'spectatorBar', 'respawnLoadoutPanel', 'escortNameTag']) this.$(id).hidden = true;
  }

  renderModeMenu(modeId, sessionText) {
    const cards = Array.from(document.querySelectorAll('[data-mode]'));
    const selected = cards.find((card) => card.dataset.mode === modeId) || cards[0];
    if (!selected) return;
    for (const card of cards) {
      const active = card === selected;
      card.classList.toggle('selected', active);
      card.setAttribute('aria-pressed', String(active));
    }
    this.$('modeTitle').textContent = selected.dataset.title;
    this.$('modeDescription').textContent = selected.dataset.description;
    this.$('modeRules').textContent = selected.dataset.rules;
    const campaign = selected.dataset.mode === 'campaign';
    const duel = selected.dataset.mode === 'duel';
    const bots = this.$('modePlayersSetting');
    bots.disabled = campaign || duel;
    this.$('botDifficultySetting').disabled = campaign;
    this.$('loadoutSetting').disabled = selected.dataset.mode !== 'ffa';
    this.$('campaignBtn').hidden = !campaign;
    this.$('campaignContinueBtn').hidden = !campaign || !campaignProgress().checkpoint;
    this.$('modeStatus').textContent = campaign ? 'ОДИНОЧНАЯ ИГРА' : 'ТРЕНИРОВКА С БОТАМИ';
    this.$('modeSession').textContent = sessionText || (campaign ? 'ЛОКАЛЬНАЯ ИГРА' :
      duel ? 'ВЫ + 1 БОТ' : 'ВЫ + ' + bots.value + ' БОТОВ');
    this.$('deployBtn').textContent = campaign ? 'НАЧАТЬ ОПЕРАЦИЮ' : 'НАЧАТЬ МАТЧ';
  }

  renderCampaignMenu() {
    const progress = campaignProgress();
    const host = this.$('missionGrid');
    host.textContent = '';
    for (const mission of CAMPAIGN_MISSIONS) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'missionCard';
      button.dataset.mission = String(mission.id);
      button.disabled = mission.id > progress.unlocked;
      const number = document.createElement('span'); number.className = 'missionNumber'; number.textContent = String(mission.id).padStart(2, '0');
      const title = document.createElement('strong'); title.textContent = mission.title;
      const subtitle = document.createElement('small'); subtitle.textContent = mission.subtitle;
      const description = document.createElement('p'); description.textContent = mission.briefing;
      const status = document.createElement('em'); status.textContent = progress.completed.includes(mission.id) ? '✓ ОПЕРАЦИЯ ЗАВЕРШЕНА · ПОВТОРИТЬ' : button.disabled ? 'ЗАВЕРШИТЕ ПРЕДЫДУЩУЮ МИССИЮ' : 'НАЧАТЬ МИССИЮ ↗';
      button.append(number, title, subtitle, description, status); host.appendChild(button);
    }
    this.$('campaignContinueBtn').hidden = !progress.checkpoint;
    if (progress.checkpoint) this.$('campaignContinueBtn').textContent = 'ПРОДОЛЖИТЬ · МИССИЯ ' + progress.checkpoint.missionId;
  }

  updateCampaignHud(game) {
    const state = game.campaign && game.campaign.hudState();
    const panel = this.$('missionPanel'); panel.hidden = !state;
    const tag = this.$('escortNameTag'); tag.hidden = !(state && state.npc);
    if (state && state.npc) {
      const npc = state.npc; this._escortPoint.set(npc.x, 3.1, npc.z).project(game.camera);
      tag.hidden = Math.abs(this._escortPoint.x) > .94 || Math.abs(this._escortPoint.y) > .93;
      tag.style.left = ((this._escortPoint.x * .5 + .5) * window.innerWidth) + 'px';
      tag.style.top = ((-.5 * this._escortPoint.y + .5) * window.innerHeight) + 'px';
      tag.textContent = 'ИНЖЕНЕР МИР · ' + Math.ceil(npc.hp);
    }
    this.$('interactionHint').hidden = !state || !state.hint && !state.checkpoint;
    if (!state) return;
    const interact = keyLabel(game.input.binds.interact?.[0] || 'KeyV');
    this.$('waveLabel').textContent = 'ЭТАП';
    this.waveNum.textContent = state.stage + ' / ' + state.stages;
    this.waveInfo.textContent = 'МИССИЯ ' + state.missionId + ' ИЗ 6';
    this.sectorName.textContent = game.campaign.def.title;
    this.sectorIndex.textContent = String(state.missionId).padStart(2, '0');
    this.sectorObjective.textContent = game.campaign.def.subtitle;
    this.$('runProgress').textContent = state.checkpoint ? 'КОНТРОЛЬНАЯ ТОЧКА СОХРАНЕНА' : 'ОПЕРАЦИЯ «ЗАТМЕНИЕ»';
    this.$('missionTask').textContent = state.title;
    this.$('missionCounter').textContent = state.counter || '';
    this.$('missionFill').style.width = Math.round(clamp(state.progress || 0, 0, 1) * 100) + '%';
    this.$('missionRadio').textContent = state.radio || '';
    this.$('missionRadio').hidden = !state.radio;
    this.$('interactionHint').textContent = state.checkpoint ? interact + ' · ПРОДОЛЖИТЬ МИССИЮ' : interact + ' · ВЗАИМОДЕЙСТВОВАТЬ';
    this.prepHint.textContent = 'B · СНАБЖЕНИЕ';
    this.prepHint.style.display = state.checkpoint ? 'block' : 'none';
  }

  updateModeHud(dt, game) {
    // Round state is a small view model. Throttle DOM roster work separately
    // from the simulation so larger local matches do not create UI churn.
    this._modeHudTimer -= dt;
    const modeId = game.modeId || 'campaign';
    const arena = modeId !== 'campaign' && game.arena && typeof game.arena.hudState === 'function';
    document.body.classList.toggle('arena-mode', !!arena);
    this.$('mapBox').hidden = modeId !== 'campaign';
    const modeChanged = this._hudModeId !== modeId;
    this._hudModeId = modeId;
    if (this._modeHudTimer <= 0 || modeChanged) {
      this._modeHudTimer = 0.15;
      this._arenaHud = arena ? game.arena.hudState() : null;
      const state = this._arenaHud;
      const spectating = !!(state && (state.spectating || state.spectator));
      this.$('spectatorBar').hidden = !spectating;
      this.$('respawnLoadoutPanel').hidden = !(modeId === 'ffa' && state && state.self && !state.self.alive);
      this.$('spectatorName').textContent = state && (state.spectatorName || state.watchName) || 'НАБЛЮДЕНИЕ';
      this.crosshair.style.display = spectating || !game.player.alive ? 'none' : '';
      this.$('matchPanel').hidden = !state;
      this.$('mapZoneLegend').hidden = !(state && state.zone);
      const phase = arena ? game.arena.phase : '';
      const counting = phase === 'countdown' || phase === 'roundBreak';
      this.$('countdownCue').hidden = !counting;
      this.$('countdownNumber').textContent = counting ? String(Math.max(1, Math.ceil(game.arena.countdown))).padStart(2, '0') : '';
      this.$('countdownLabel').textContent = phase === 'roundBreak' ? 'СЛЕДУЮЩИЙ РАУНД' : 'ПРИГОТОВЬТЕСЬ';
      const clock = state && state.time !== undefined ? state.time : game.time;
      this.$('matchClock').textContent = typeof clock === 'number'
        ? String(Math.floor(Math.max(0, clock) / 60)).padStart(2, '0') + ':' + String(Math.floor(Math.max(0, clock) % 60)).padStart(2, '0')
        : String(clock || '00:00');
      this.$('modeHudLabel').textContent = state ? state.label || 'АРЕНА' : 'КАМПАНИЯ';
      this.$('matchScore').textContent = state ? String(state.score === undefined ? '' : state.score) : '';
      this.$('matchObjective').textContent = state ? state.objective || state.rules || (game.arena.def && game.arena.def.rules) || '' : '';
      const zoneReadout = this.$('zoneReadout');
      zoneReadout.hidden = !(state && state.zone);
      if (state && state.zone) {
        const zone = state.zone, self = state.self || game.player;
        const destination = state.zoneTarget || zone;
        const margin = destination.radius - Math.hypot(self.x - destination.x, self.z - destination.z);
        zoneReadout.textContent = 'ЗОНА ' + (zone.stage || 1) + ' · ' + (zone.phase === 'shrink' ? 'СУЖЕНИЕ' : 'ДО СУЖЕНИЯ') +
          ' ' + Math.ceil(zone.remaining || 0) + ' С · ' + (margin < 0 ? Math.ceil(-margin) + (typeof state.zoneWarning === 'string' ? ' М ДО НОВОЙ ЗОНЫ' : ' М ДО БЕЗОПАСНОСТИ') : Math.floor(margin) + ' М ДО ГРАНИЦЫ');
      }
      const warning = state && state.zoneWarning;
      this.$('zoneWarning').hidden = !warning;
      this.$('zoneWarning').textContent = warning === true ? 'ВНЕ ЗОНЫ · ДВИГАЙТЕСЬ ПО СТРЕЛКЕ' : warning || '';
      const roster = state && Array.isArray(state.roster) ? state.roster : [];
      const visible = roster.slice(0, 4);
      const playerRow = roster.find((entry) => entry.isPlayer);
      if (playerRow && !visible.includes(playerRow)) visible[visible.length - 1] = playerRow;
      this._playerRank = playerRow ? roster.indexOf(playerRow) + 1 : 0;
      this._rosterCount = roster.length;
      const signature = JSON.stringify(visible);
      if (signature !== this._rosterSignature) {
        this._rosterSignature = signature;
        const host = this.$('matchRoster');
        host.textContent = '';
        for (const entry of visible) {
          const row = document.createElement('div');
          row.className = 'rosterRow' + (entry.isPlayer ? ' isPlayer' : '') + (entry.alive === false ? ' out' : '');
          const rank = document.createElement('span');
          rank.textContent = String(roster.indexOf(entry) + 1).padStart(2, '0');
          const name = document.createElement('span');
          name.textContent = entry.name || 'ОПЕРАТОР';
          const score = document.createElement('b');
          score.textContent = entry.alive === false && modeId === 'royale' ? '×' : String(entry.score === undefined ? '—' : entry.score);
          row.append(rank, name, score);
          host.appendChild(row);
        }
      }
    }
    // These fields are also touched by the campaign HUD each frame. Restore
    // arena labels every frame while the expensive view-model read is cached.
    const state = this._arenaHud;
    this.$('waveLabel').textContent = state ? state.counterLabel || (modeId === 'royale' ? 'В ЖИВЫХ' : 'СЧЁТ') : 'ВОЛНА';
    if (state) {
      const counter = state.counterValue === undefined
        ? modeId === 'royale' ? parseInt(state.score, 10) || 0 : state.score || '0'
        : state.counterValue;
      this.waveNum.textContent = String(counter);
      this.waveInfo.textContent = 'ВАША ПОЗИЦИЯ ' + this._playerRank + ' / ' + this._rosterCount;
      this.sectorName.textContent = game.level.arenaName || game.level.arenaLayout?.title || 'БОЕВАЯ АРЕНА';
      this.sectorIndex.textContent = game.level.arenaCode || 'ARENA';
      this.sectorObjective.textContent = state.objective || '';
      this.$('runProgress').textContent = game.network?.room ? 'КОМНАТА ОНЛАЙН' : 'ТРЕНИРОВКА';
      this.prepHint.style.display = 'none';
    }
    const creditStat = this.moneyVal.parentElement;
    if (creditStat) creditStat.hidden = !!state;
  }

  damageIndicator(srcX, srcZ, amount) {
    if (!Number.isFinite(srcX) || !Number.isFinite(srcZ) || amount <= 0) return;
    const p = this.game.player;
    if (Math.hypot(srcX - p.x, srcZ - p.z) < 0.5) return;
    this._damageCueSource.x = srcX;
    this._damageCueSource.z = srcZ;
    this._damageCueTimer = 0.65;
  }

  updateCombatSignals(dt, game) {
    const p = game.player;
    this._damageCueTimer = Math.max(0, this._damageCueTimer - dt);
    this._signalOrigin.set(p.x, 1.2, p.z).project(game.camera);
    const originX = (this._signalOrigin.x * 0.5 + 0.5) * window.innerWidth;
    const originY = (-this._signalOrigin.y * 0.5 + 0.5) * window.innerHeight;
    const pointArrow = (node, target, radius, alpha) => {
      this._signalTarget.set(target.x, 1.2, target.z).project(game.camera);
      const dx = (this._signalTarget.x - this._signalOrigin.x) * window.innerWidth;
      const dy = -(this._signalTarget.y - this._signalOrigin.y) * window.innerHeight;
      const length = Math.hypot(dx, dy);
      node.hidden = !p.alive || length < 1;
      if (node.hidden) return;
      node.style.left = (originX + dx / length * radius) + 'px';
      node.style.top = (originY + dy / length * radius) + 'px';
      node.style.transform = 'translate(-50%,-50%) rotate(' + (Math.atan2(dy, dx) + Math.PI / 2) + 'rad)';
      node.style.opacity = String(alpha);
    };
    const hit = this.$('damageDirection');
    hit.hidden = this._damageCueTimer <= 0;
    if (!hit.hidden) pointArrow(hit, this._damageCueSource, 53, Math.min(1, this._damageCueTimer * 4));
    const zone = this._arenaHud && this._arenaHud.zone;
    const zoneArrow = this.$('zoneDirection');
    zoneArrow.hidden = !(zone && this._arenaHud.zoneWarning);
    if (!zoneArrow.hidden) pointArrow(zoneArrow, this._arenaHud.zoneTarget || zone, 76, 0.95);

    // Colour only a target under the actual ground cursor, never an enemy
    // concealed by cover. The brief hit marker remains the shot confirmation.
    let targetUnderAim = false;
    if (game.aim && p.alive && p.reloading <= 0) {
      for (const e of game.enemies.list) {
        if (e.state === S_DYING || e.alive === false) continue;
        if (Math.hypot(e.x - game.aim.x, e.z - game.aim.z) > (e.def.radius || 0.6) + 0.4) continue;
        if (!game.level.lineOfSight(p.x, p.z, e.x, e.z)) continue;
        const dx = e.x - p.x, dz = e.z - p.z, distance = Math.hypot(dx, dz);
        const stopAt = Math.max(0, distance - (e.def.radius || 0.6));
        const cover = distance > 0.01 && game.props && game.props.raycast(p.x, p.z, dx / distance, dz / distance, stopAt);
        if (!cover) { targetUnderAim = true; break; }
      }
    }
    this.crosshair.classList.toggle('targeted', targetUnderAim);
    this.crosshair.classList.toggle('reloading', p.reloading > 0);
    this.crosshair.style.color = p.reloading > 0 ? '#ffc271' : targetUnderAim ? '#ff837b' : p.aiming ? '#7cf4df' : '#edf7ef';
  }

  /* the static map only needs rasterising once per level */
  buildMinimap(level) {
    if (this.game.modeId && this.game.modeId !== 'campaign') return;
    const S = 200;
    this.mapCanvas.width = S;
    this.mapCanvas.height = S;
    const off = document.createElement('canvas');
    off.width = off.height = S;
    const g = off.getContext('2d');
    const cell = S / level.w;

    g.fillStyle = '#090b0e';
    g.fillRect(0, 0, S, S);
    for (let tz = 0; tz < level.h; tz++) {
      for (let tx = 0; tx < level.w; tx++) {
        if (level.isWallTile(tx, tz)) continue;
        g.fillStyle = '#1a303a';
        g.fillRect(tx * cell, tz * cell, cell + 0.6, cell + 0.6);
      }
    }
    // District tint locates the arena's large spaces without obscuring cover.
    const layout = level.arenaLayout;
    if (layout && Array.isArray(layout.districts)) {
      g.save();
      g.globalAlpha = 0.13;
      for (const area of layout.districts) {
        g.fillStyle = typeof area.color === 'number' ? '#' + area.color.toString(16).padStart(6, '0') : area.color || '#6ab8a8';
        g.fillRect((area.x / TILE + level.w / 2 - area.w / TILE / 2) * cell,
          (area.z / TILE + level.h / 2 - area.d / TILE / 2) * cell, area.w / TILE * cell, area.d / TILE * cell);
      }
      g.restore();
    }
    // outline walls that border walkable space
    g.fillStyle = level.sector ? '#' + level.sector.accent.toString(16).padStart(6, '0') : '#3d5470';
    g.globalAlpha = 0.35;
    for (let tz = 0; tz < level.h; tz++) {
      for (let tx = 0; tx < level.w; tx++) {
        if (!level.isWallTile(tx, tz)) continue;
        let exposed = false;
        for (let k = 0; k < 4 && !exposed; k++) {
          const nx = tx + (k === 0 ? 1 : k === 1 ? -1 : 0);
          const nz = tz + (k === 2 ? 1 : k === 3 ? -1 : 0);
          if (level.inBounds(nx, nz) && !level.isWallTile(nx, nz)) exposed = true;
        }
        if (exposed) g.fillRect(tx * cell, tz * cell, cell + 0.6, cell + 0.6);
      }
    }
    this.mapBase = off;
    this.mapCell = cell;
    this.mapSize = S;
  }

  drawMinimap(level, player, enemies, pickups) {
    if (this.game.modeId && this.game.modeId !== 'campaign') return;
    const ctx = this.mapCtx;
    const S = this.mapSize;
    const cell = this.mapCell;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapBase, 0, 0);

    const toX = (wx) => (wx / TILE + level.w / 2) * cell;
    const toZ = (wz) => (wz / TILE + level.h / 2) * cell;

    // Campaign navigation only. Competitive modes intentionally reveal no map.
    const arenaHud = this._arenaHud;
    const zone = arenaHud && arenaHud.zone;
    if (zone && Number.isFinite(zone.radius)) {
      ctx.save();
      ctx.fillStyle = '#ffc27125';
      ctx.beginPath();
      ctx.rect(0, 0, S, S);
      ctx.arc(toX(zone.x || 0), toZ(zone.z || 0), zone.radius / TILE * cell, 0, TAU, true);
      ctx.fill('evenodd');
      ctx.strokeStyle = '#ffc271';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(toX(zone.x || 0), toZ(zone.z || 0), zone.radius / TILE * cell, 0, TAU);
      ctx.stroke();
      ctx.fillStyle = '#ffc271';
      ctx.fillRect(toX(zone.x || 0) - 2, toZ(zone.z || 0) - 0.5, 4, 1);
      ctx.fillRect(toX(zone.x || 0) - 0.5, toZ(zone.z || 0) - 2, 1, 4);
      ctx.restore();
    }

    // pickups
    ctx.fillStyle = '#37e0c8';
    for (let i = 0; i < pickups.items.length; i++) {
      const it = pickups.items[i];
      ctx.fillRect(toX(it.x) - 2, toZ(it.z) - 0.6, 4, 1.2);
      ctx.fillRect(toX(it.x) - 0.6, toZ(it.z) - 2, 1.2, 4);
    }

    // aliens
    const list = enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.state === S_DYING) continue;
      ctx.fillStyle = '#ff837b';
      const r = e.def.boss ? 4 : e.def.radius > 1 ? 2.6 : 2;
      ctx.beginPath();
      const ex = toX(e.x), ez = toZ(e.z);
      ctx.moveTo(ex, ez - r); ctx.lineTo(ex + r, ez); ctx.lineTo(ex, ez + r); ctx.lineTo(ex - r, ez); ctx.closePath();
      ctx.fill();
    }

    if (arenaHud && Array.isArray(arenaHud.blips)) {
      for (const blip of arenaHud.blips) {
        if (blip.isPlayer || blip.alive === false) continue;
        ctx.fillStyle = '#ff8c72';
        ctx.strokeStyle = '#1b0b08';
        ctx.lineWidth = 1;
        const x = toX(blip.x), z = toZ(blip.z);
        ctx.beginPath();
        ctx.moveTo(x, z - 3); ctx.lineTo(x + 3, z); ctx.lineTo(x, z + 3); ctx.lineTo(x - 3, z);
        ctx.closePath(); ctx.fill(); ctx.stroke();
      }
    }

    const mission = this.game.campaign?.hudState();
    if (mission) {
      ctx.strokeStyle = '#ffd095'; ctx.lineWidth = 1.5;
      for (const target of mission.targets || []) {
        const x = toX(target.x), z = toZ(target.z);
        ctx.beginPath(); ctx.arc(x, z, 4.5, 0, TAU); ctx.stroke();
      }
      if (mission.npc) {
        ctx.fillStyle = '#7cf4df';
        ctx.fillRect(toX(mission.npc.x) - 2.5, toZ(mission.npc.z) - 2.5, 5, 5);
      }
    }

    // player + facing wedge
    const pxx = toX(player.x), pzz = toZ(player.z);
    ctx.save();
    ctx.translate(pxx, pzz);
    ctx.rotate(-player.angle + Math.PI / 2);
    ctx.fillStyle = 'rgba(120,235,255,0.28)';
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.arc(0, 0, 22, -0.5, 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.restore();

    ctx.fillStyle = '#7cf4df';
    ctx.beginPath();
    ctx.arc(pxx, pzz, 3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
    ctx.strokeStyle = '#7cf4df55';
    ctx.beginPath(); ctx.arc(pxx, pzz, 5.5, 0, TAU); ctx.stroke();
  }

  buildWeaponRack(player) {
    const list = player.loadoutList ? player.loadoutList() : player.ownedList();
    const ids = list.join(',');
    if (ids === this._rackIds) return;
    this._rackIds = ids;
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const w = WEAPONS[list[i]];
      html += '<div class="slot" data-idx="' + list[i] + '">' +
        '<span class="num">' + (i + 1) + '</span>' +
        '<span class="nm">' + w.short + '</span></div>';
    }
    this.weaponRack.innerHTML = html;
    this._slots = this.weaponRack.querySelectorAll('.slot');
  }

  /* Four slots, always four: a sold slot stays as a hole rather than letting
     the row collapse, so the shop does not jump under the cursor mid-visit. */
  renderUpgrades() {
    const game = this.game;
    this.$('upgradeCredits').textContent = fmt(game.money);
    const reroll = this.$('shopReroll');
    const price = game.rerollCost();
    reroll.textContent = 'ОБНОВИТЬ АССОРТИМЕНТ · ' + fmt(price) + ' КР.';
    reroll.disabled = game.money < price;
    // the harness, with what each weapon is worth traded in
    const carried = game.player.carriedList();
    this.$('shopSlots').textContent = carried.length + ' / ' + ARSENAL_SLOTS;
    this.$('shopArsenal').innerHTML = carried.map((idx) => {
      const w = WEAPONS[idx];
      const refund = Math.floor(w.price * WEAPON_SELL_RATIO);
      // the same question, asked about what is already carried
      const held = weaponPortraits.get(w.id);
      return '<span class="held">' +
        (held ? '<img class="heldShot" alt="" src="' + held + '">' : '') + w.short +
        '<button data-sell="' + w.id + '" title="Сдать за ' + refund + ' кр.">−' + refund + '</button></span>';
    }).join('') || '<span class="held empty">ТОЛЬКО ПИСТОЛЕТ</span>';
    const full = game.player.arsenalFull();
    this.$('upgradeGrid').innerHTML = game.shopStock.map((slot, index) => {
      if (!slot) return '<article class="upgrade empty"><div class="upgradeIcon">·</div><h3>ПУСТО</h3>' +
        '<p>Склад не смог предложить ничего нового.</p></article>';
      if (slot.sold) return '<article class="upgrade sold"><div class="upgradeIcon">✓</div><h3>ПРИОБРЕТЕНО</h3>' +
        '<p>Товар получен в этом заходе.</p></article>';
      const weapon = slot.kind === 'weapon';
      const portrait = weapon ? weaponPortraits.get(slot.id)
        : slot.id === 'supply' ? weaponPortraits.getItem('ammo', 'supply')
        : slot.id === 'medkit' ? weaponPortraits.getItem('bigHealth') : null;
      const def = weapon ? WEAPON_BY_ID[slot.id] : FIELD_UPGRADES.find((u) => u.id === slot.id);
      const melee = weapon && def.fire === 'melee';
      const blocked = weapon && full && !melee;
      const rank = weapon ? 0 : (game.upgrades[slot.id] || 0);
      const note = melee ? 'БЛИЖНИЙ БОЙ · ОТДЕЛЬНЫЙ СЛОТ' : weapon ? 'ОРУЖИЕ · ' + AMMO_TYPES[def.ammo].name
        : def.max === Infinity ? 'РАСХОДНЫЕ МАТЕРИАЛЫ' : 'УРОВЕНЬ ' + rank + ' / ' + def.max;
      const desc = melee ? 'Урон ' + def.damage + ' · ЛКМ: быстрый удар · ПКМ: тяжёлый удар' : weapon ? 'Урон ' + def.damage + ' · магазин ' + def.mag + ' · в комплекте боезапас' : def.desc;
      return '<article class="upgrade' + (slot.locked ? ' locked' : '') + '">' +
        '<button class="pin" data-lock="' + index + '" aria-pressed="' + !!slot.locked + '" aria-label="Закрепить товар" title="Закрепить до следующего обновления">' +
        (slot.locked ? '★' : '☆') + '</button>' +
        (portrait
          ? '<div class="gunShot' + (weapon ? '' : ' supplyShot') + '"><img alt="" width="320" height="192" src="' + portrait + '"></div>'
          : '<div class="upgradeIcon">' + (weapon ? '⌐' : def.icon) + '</div>') +
        '<h3>' + (weapon ? def.name : def.title) + '</h3>' +
        '<p>' + desc + '</p>' +
        '<small>' + note + '</small>' +
        '<button class="btn" data-slot="' + index + '"' + (blocked || game.money < slot.price ? ' disabled' : '') + '>' +
        (blocked ? 'НЕТ МЕСТА В АРСЕНАЛЕ' : fmt(slot.price) + ' КР. — КУПИТЬ') + '</button></article>';
    }).join('');
  }

  /* Compact read-out of the run's build. A roguelite where the player cannot
     see what they picked is a roguelite they cannot plan in, but this sits in
     the corner: icons and ranks only, full names live on the pick screen. */
  renderRunProgress() {
    const text = this.game.runProgressText();
    const node = this.$('runProgress');
    if (node.textContent !== text) node.textContent = text;
  }

  renderBuild() {
    const game = this.game;
    const ids = Object.keys(game.perks);
    const signature = ids.map((id) => id + game.perks[id]).join('|');
    if (signature === this._buildSignature) return;
    this._buildSignature = signature;
    const strip = this.$('buildStrip');
    strip.classList.toggle('active', ids.length > 0);
    this.$('buildChips').innerHTML = ids.map((id) => {
      const perk = PERK_BY_ID[id];
      const rank = game.perks[id];
      return '<span class="buildChip" style="--rarity:' + PERK_RARITY[perk.rarity].color + '" title="' +
        perk.title + ' — ' + perk.desc + '">' + perk.icon +
        (perk.max > 1 ? '<b>' + rank + '</b>' : '') + '</span>';
    }).join('');
  }

  /* The station is the only place samples are worth anything, so it has to
     read as progress even when nothing is affordable yet: ranks already
     bought stay lit, and the price of the next one is always visible. */
  /* The rebinding panel. Capture is deliberately one key at a time and shows
     the whole list per action, because a player who cannot see what an action
     is already bound to will bind over something they wanted. */
  renderBinds() {
    const input = this.game.input;
    this.$('bindPanel').innerHTML = ACTIONS.map((action) => {
      const codes = input.binds[action.id] || [];
      const shown = codes.length
        ? codes.map((c) => '<kbd>' + keyLabel(c) + '</kbd>').join('')
        : '<kbd>—</kbd>';
      const pad = action.pad ? '<kbd>G' + action.pad[0] + '</kbd>' : '';
      return '<div class="bindRow" data-action="' + action.id + '">' +
        '<b>' + action.label + '</b>' +
        '<span class="codes">' + shown + pad + '</span>' +
        '<button data-bind="' + action.id + '">НАЗНАЧИТЬ</button></div>';
    }).join('');
  }

  renderStation() {
    const samples = parseInt(store.get('samples', '0'), 10) || 0;
    const ranks = this.game.stationRanks();
    this.$('stationSamples').textContent = fmt(samples);
    this.$('stationRuns').textContent = fmt(parseInt(store.get('runs', '0'), 10) || 0);
    this.$('stationSpent').textContent = fmt(metaInvested(ranks));
    this.$('stationGrid').innerHTML = META_UPGRADES.map((upgrade) => {
      const rank = ranks[upgrade.id] || 0;
      const price = metaCost(upgrade, rank);
      const capped = rank >= upgrade.max;
      const pips = [];
      for (let i = 0; i < upgrade.max; i++) pips.push('<i class="' + (i < rank ? 'on' : '') + '"></i>');
      return '<article class="station' + (rank ? ' owned' : '') + '">' +
        '<div class="stationIcon">' + upgrade.icon + '</div>' +
        '<h3>' + upgrade.title + '</h3>' +
        '<div class="stationRank">' + pips.join('') + '</div>' +
        '<p>' + upgrade.desc + '</p>' +
        '<button class="btn" data-station="' + upgrade.id + '"' +
        (capped || samples < price ? ' disabled' : '') + '>' +
        (capped ? 'МАКСИМУМ' : fmt(price) + ' ОБР. — КУПИТЬ') + '</button></article>';
    }).join('');
  }

  renderPerks() {
    const game = this.game;
    this.$('perkWave').textContent = game.wave;
    const owned = game.perkRankText();
    this.$('perkBuild').textContent = owned || 'БИЛД ПУСТ';
    this.$('perkGrid').innerHTML = game.perkOffer.map((perk, index) => {
      const rarity = PERK_RARITY[perk.rarity];
      const rank = game.perks[perk.id] || 0;
      const tags = perk.tags.map((t) => '<em>' + PERK_TAGS[t] + '</em>').join('');
      return '<article class="perk" style="--rarity:' + rarity.color + '">' +
        '<div class="perkKey">' + (index + 1) + '</div>' +
        '<div class="perkIcon">' + perk.icon + '</div>' +
        '<h3>' + perk.title + '</h3>' +
        '<div class="perkTags">' + tags + '</div>' +
        '<p>' + perk.desc + '</p>' +
        '<small>' + rarity.label + (rank ? ' · УРОВЕНЬ ' + rank + ' / ' + perk.max : '') + '</small>' +
        '<button class="btn" data-perk="' + perk.id + '">ВЗЯТЬ</button></article>';
    }).join('');
  }

  popup(text, color) {
    if (!text) return;
    let el = this._popupPool.pop();
    if (!el) {
      el = document.createElement('div');
      el.className = 'popup';
      this.popups.appendChild(el);
    }
    el.textContent = text;
    el.style.color = typeof color === 'number'
      ? '#' + color.toString(16).padStart(6, '0')
      : (color || '#fff');
    el.style.display = 'block';
    el.style.animation = 'none';
    void el.offsetWidth;               // restart the CSS animation
    el.style.animation = 'popup 1.25s ease-out forwards';
    clearTimeout(el._t);
    el._t = setTimeout(() => {
      el.style.display = 'none';
      this._popupPool.push(el);
    }, 1250);
  }

  showBanner(text, sub, duration) {
    this.bannerWrap.classList.toggle('compact', !!(this.game.arena || this.game.campaign));
    this.banner.textContent = text;
    this.bannerSub.textContent = sub || '';
    this.bannerWrap.classList.add('show');
    this._bannerTimer = duration === undefined ? 2.2 : duration;
  }

  hitMarker(killed, crit) {
    this._hitTimer = 0.11;
    if (killed) this._killTimer = 0.22;
    if (crit) this._critTimer = 0.26;
  }

  update(dt, game) {
    const p = game.player;
    this._namePoint.set(p.x, 2.65, p.z).project(game.camera);
    const tag = this.$('playerNameTag');
    tag.style.left = ((this._namePoint.x * 0.5 + 0.5) * window.innerWidth) + 'px';
    tag.style.top = ((-this._namePoint.y * 0.5 + 0.5) * window.innerHeight) + 'px';
    tag.style.display = p.alive && Math.abs(this._namePoint.x) < 0.95 && Math.abs(this._namePoint.y) < 0.95 ? 'block' : 'none';

    // bars
    const hpPct = clamp(p.hp / p.maxHp, 0, 1);
    this.healthFill.style.width = (hpPct * 100).toFixed(1) + '%';
    this.healthText.textContent = Math.ceil(p.hp);
    this.$('vitals').classList.toggle('critical', hpPct < 0.3);
    this.$('combatStatus').textContent = hpPct < 0.3 ? 'КРИТИЧЕСКОЕ СОСТОЯНИЕ · НАЙДИТЕ УКРЫТИЕ' :
      p.armor > 0 ? 'БРОНЯ АКТИВНА / БОЕЦ ГОТОВ' : 'БЕЗ БРОНИ / БЕРЕГИТЕ ЗДОРОВЬЕ';
    this.healthFill.style.background = hpPct > 0.5
      ? 'linear-gradient(90deg,#3f9c87,#7cf4df)'
      : hpPct > 0.25
        ? 'linear-gradient(90deg,#b48342,#ffd095)'
        : 'linear-gradient(90deg,#b86138,#ffb86b)';

    const apPct = clamp(p.armor / p.maxArmor, 0, 1);
    this.armorFill.style.width = (apPct * 100).toFixed(1) + '%';
    this.armorText.textContent = Math.ceil(p.armor);

    // ammo
    const w = p.weapon;
    this.weaponName.textContent = w.name;
    const melee = w.fire === 'melee' || w.usesAmmo === false;
    this.ammoMag.textContent = melee ? '—' : p.mag;
    this.ammoMag.className = melee ? 'mag' : p.mag === 0 ? 'mag empty' : (p.mag <= w.mag * 0.25 ? 'mag low' : 'mag');
    this.ammoReserve.textContent = melee ? 'БЛИЖНИЙ БОЙ' : Number.isFinite(p.reserve) ? p.reserve : '∞';
    const ammoState = this.$('ammoState');
    const ammoEmpty = !melee && p.mag === 0 && p.reserve === 0;
    ammoState.className = melee ? '' : ammoEmpty ? 'danger' : p.mag === 0 || p.reloading > 0 ? 'warn' : '';
    ammoState.textContent = melee ? p.fireTimer > 0 ? 'ВОССТАНОВЛЕНИЕ · ' + p.fireTimer.toFixed(1) + ' С' : 'ЛКМ · БЫСТРЫЙ УДАР / ПКМ · ТЯЖЁЛЫЙ' : p.reloading > 0 ? 'ПЕРЕЗАРЯДКА · ' + Math.max(0, p.reloading).toFixed(1) + ' С' :
      ammoEmpty ? 'НЕТ ПАТРОНОВ · СМЕНИТЕ ОРУЖИЕ' : p.mag === 0 ? 'R · ПЕРЕЗАРЯДИТЬ' :
      p.aiming ? 'ТОЧНЫЙ ОГОНЬ' : 'ПКМ · ТОЧНЫЙ ОГОНЬ';

    const heal = this.$('healHint');
    heal.hidden = !game.arena || game.modeId !== 'royale';
    heal.textContent = p.healing > 0 ? 'ЛЕЧЕНИЕ · ' + Number(p.healing).toFixed(1) + ' С' :
      keyLabel(game.input.binds.heal?.[0] || 'KeyH') + ' · АПТЕЧКИ ' + (p.medkits || 0);
    if (p.reloading > 0 && !melee) {
      this.reloadBar.style.opacity = '1';
      this.reloadFill.style.width = ((1 - p.reloading / p.reloadTotal) * 100).toFixed(1) + '%';
    } else {
      this.reloadBar.style.opacity = '0';
    }

    // dash cooldown ring
    this.dashFill.style.width = ((1 - clamp(p.dashCd / 1.5, 0, 1)) * 100).toFixed(0) + '%';
    this.grenadeFill.style.width = ((1 - clamp(p.grenadeCd / p.grenadeCooldown, 0, 1)) * 100).toFixed(0) + '%';
    this.grenadeText.textContent = p.grenadeCd > 0 ? Math.ceil(p.grenadeCd) + 'с' : 'G';
    this.sectorName.textContent = game.level.sector.name;
    this.sectorIndex.textContent = String(game.sectorIndex + 1).padStart(2, '0');
    this.sectorObjective.textContent = game.sectorPending ? 'Переход в следующий сектор после подготовки' :
      game.level.sector.subtitle + ' · волн до перехода: ' + (game.waveState === 'active' ? 3 - ((game.wave - 1) % 3) : 3 - (game.wave % 3));
    this.prepHint.style.display = game.waveState === 'prep' ? 'block' : 'none';
    this.comboBox.classList.toggle('active', game.combo >= 2);
    this.comboCount.textContent = '×' + Math.min(4, 1 + Math.floor(game.combo / 5) * 0.5).toFixed(1);
    this.$('comboLabel').textContent = game.combo + ' ЦЕЛЕЙ ПОДРЯД';
    this.comboFill.style.width = (game.comboTimer / 4 * 100).toFixed(1) + '%';
    this.crosshair.style.color = p.aiming ? '#7cf4df' : '#fff';

    // weapon rack highlight
    this.buildWeaponRack(p);
    if (this._slots) {
      for (let i = 0; i < this._slots.length; i++) {
        const idx = parseInt(this._slots[i].dataset.idx, 10);
        this._slots[i].classList.toggle('active', idx === p.weaponIndex);
      }
    }

    // counters
    this.scoreVal.textContent = fmt(Math.floor(game.score));
    this.killsVal.textContent = fmt(game.stats.kills);
    this.moneyVal.textContent = fmt(Math.floor(game.money));
    this.waveNum.textContent = game.wave;
    this.waveInfo.textContent = game.waveStatusText();

    // damage vignette: pulses when hurt, stays on when critical
    const hurt = p.hurtFlash;
    const crit = hpPct < 0.3 ? (0.32 + Math.sin(game.time * 6) * 0.14) * (1 - hpPct / 0.3) : 0;
    this.vignette.style.opacity = clamp(hurt * 0.46 + crit * 0.55, 0, 0.62).toFixed(3);

    // crosshair colour reacts to what is under it
    if (this._hitTimer > 0) this._hitTimer -= dt;
    if (this._killTimer > 0) this._killTimer -= dt;
    if (this._critTimer > 0) this._critTimer -= dt;
    // a crit outranks a kill in the marker: it is the rarer event to read
    this.hitmark.style.opacity = this._hitTimer > 0 || this._critTimer > 0 ? '1' : '0';
    this.hitmark.style.color = this._critTimer > 0 ? '#ffd23c' : this._killTimer > 0 ? '#ff4438' : '#ffffff';
    this.hitmark.style.transform = 'translate(-50%,-50%) scale(' +
      (this._critTimer > 0 ? 2 : this._killTimer > 0 ? 1.5 : 1) + ')';

    this.renderBuild();
    this.renderRunProgress();

    if (this._bannerTimer > 0) {
      this._bannerTimer -= dt;
      if (this._bannerTimer <= 0) this.bannerWrap.classList.remove('show');
    }

    // boss bar
    const boss = game.activeBoss;
    if (boss && boss.state !== S_DYING) {
      this.bossWrap.classList.add('show');
      // the phase is the one thing about this fight the bar cannot show with
      // a width, and a player who cannot see it reads a reset as a bug
      this.bossName.textContent = boss.def.phases
        ? boss.def.label + ' · ФАЗА ' + (boss.bossPhase + 1) + ' / ' + boss.def.phases.length
        : boss.def.label;
      this.bossWrap.classList.toggle('shielded', boss.shield > 0);
      this.bossFill.style.width = (clamp(boss.hp / boss.maxHp, 0, 1) * 100).toFixed(1) + '%';
    } else {
      this.bossWrap.classList.remove('show');
    }

    // fps, averaged over half a second
    this._fpsAcc += dt;
    this._fpsFrames++;
    if (this._fpsAcc >= 0.5) {
      this.fpsVal.textContent = Math.round(this._fpsFrames / this._fpsAcc);
      this._fpsAcc = 0;
      this._fpsFrames = 0;
    }

    this.updateModeHud(dt, game);
    this.updateCampaignHud(game);
    this.updateCombatSignals(dt, game);
    this.drawMinimap(game.level, p, game.enemies, game.pickups);
  }

  setCrosshair(sx, sy, spread) {
    this.crosshair.style.left = sx + 'px';
    this.crosshair.style.top = sy + 'px';
    this.crosshair.style.setProperty('--spread', spread.toFixed(1) + 'px');
  }
}
