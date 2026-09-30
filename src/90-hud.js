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
    this._namePoint = new THREE.Vector3();
    this.setCallsign(loadLook().nickname);
  }

  setCallsign(value) {
    const name = sanitizeNickname(value);
    for (const id of ['playerCallsign', 'playerNameTag', 'menuCallsign']) this.$(id).textContent = name;
  }

  /* the static map only needs rasterising once per level */
  buildMinimap(level) {
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
        g.fillStyle = '#243040';
        g.fillRect(tx * cell, tz * cell, cell + 0.6, cell + 0.6);
      }
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
    const ctx = this.mapCtx;
    const S = this.mapSize;
    const cell = this.mapCell;
    ctx.clearRect(0, 0, S, S);
    ctx.drawImage(this.mapBase, 0, 0);

    const toX = (wx) => (wx / TILE + level.w / 2) * cell;
    const toZ = (wz) => (wz / TILE + level.h / 2) * cell;

    // pickups
    ctx.fillStyle = '#37e0c8';
    for (let i = 0; i < pickups.items.length; i++) {
      const it = pickups.items[i];
      ctx.fillRect(toX(it.x) - 1.5, toZ(it.z) - 1.5, 3, 3);
    }

    // aliens
    const list = enemies.list;
    for (let i = 0; i < list.length; i++) {
      const e = list[i];
      if (e.state === S_DYING) continue;
      ctx.fillStyle = e.def.boss ? '#ff3ea0' : e.def.ranged ? '#c86bff' : '#ff4438';
      const r = e.def.boss ? 4 : e.def.radius > 1 ? 2.6 : 1.7;
      ctx.beginPath();
      ctx.arc(toX(e.x), toZ(e.z), r, 0, TAU);
      ctx.fill();
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

    ctx.fillStyle = '#7ce8ff';
    ctx.beginPath();
    ctx.arc(pxx, pzz, 3, 0, TAU);
    ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.85)';
    ctx.lineWidth = 1;
    ctx.stroke();
  }

  buildWeaponRack(player) {
    const ids = player.ownedList().join(',');
    if (ids === this._rackIds) return;
    this._rackIds = ids;
    const list = player.ownedList();
    let html = '';
    for (let i = 0; i < list.length; i++) {
      const w = WEAPONS[list[i]];
      html += '<div class="slot" data-idx="' + list[i] + '">' +
        '<span class="num">' + ((list[i] + 1) % 10) + '</span>' +
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
      // the gun itself, not its name: a card reading RAILGUN asks the player
      // to remember what one looks like
      const portrait = weapon ? weaponPortraits.get(slot.id) : null;
      const blocked = weapon && full;
      const def = weapon ? WEAPON_BY_ID[slot.id] : FIELD_UPGRADES.find((u) => u.id === slot.id);
      const rank = weapon ? 0 : (game.upgrades[slot.id] || 0);
      const note = weapon ? 'ОРУЖИЕ · ' + AMMO_TYPES[def.ammo].name
        : def.max === Infinity ? 'РАСХОДНЫЕ МАТЕРИАЛЫ' : 'УРОВЕНЬ ' + rank + ' / ' + def.max;
      const desc = weapon ? 'Урон ' + def.damage + ' · магазин ' + def.mag + ' · в комплекте боезапас' : def.desc;
      return '<article class="upgrade' + (slot.locked ? ' locked' : '') + '">' +
        '<button class="pin" data-lock="' + index + '" title="Закрепить до следующего обновления">' +
        (slot.locked ? '★' : '☆') + '</button>' +
        (portrait
          ? '<div class="gunShot"><img alt="" src="' + portrait + '"></div>'
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
    this.healthFill.style.background = hpPct > 0.5
      ? 'linear-gradient(90deg,#2fbf4a,#7ff06a)'
      : hpPct > 0.25
        ? 'linear-gradient(90deg,#c8a02a,#f0d24a)'
        : 'linear-gradient(90deg,#c02020,#ff5a4a)';

    const apPct = clamp(p.armor / p.maxArmor, 0, 1);
    this.armorFill.style.width = (apPct * 100).toFixed(1) + '%';
    this.armorText.textContent = Math.ceil(p.armor);

    // ammo
    const w = p.weapon;
    this.weaponName.textContent = w.name;
    this.ammoMag.textContent = p.mag;
    this.ammoMag.className = p.mag === 0 ? 'mag empty' : (p.mag <= w.mag * 0.25 ? 'mag low' : 'mag');
    this.ammoReserve.textContent = w.ammo === 'none' ? '∞' : p.ammo[w.ammo];

    if (p.reloading > 0) {
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
    this.vignette.style.opacity = clamp(hurt * 0.85 + crit, 0, 1).toFixed(3);

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

    this.drawMinimap(game.level, p, game.enemies, game.pickups);
  }

  setCrosshair(sx, sy, spread) {
    this.crosshair.style.left = sx + 'px';
    this.crosshair.style.top = sy + 'px';
    this.crosshair.style.setProperty('--spread', spread.toFixed(1) + 'px');
  }
}
