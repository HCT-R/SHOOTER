/* Headless smoke test: builds a probe page from index.html, drives the real
   game loop through Chrome's software WebGL, and reports any runtime error.

   usage: node tools/smoketest.js [frames] [--click] [--shot path.png]
          [--menu | --customizer | --boss siege|warden|queen] [--weapon id] [--yaw radians]
*/

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFileSync } = require('child_process');

const root = path.join(__dirname, '..');
const { inspectRigPose, RIG_POSES } = require(path.join(__dirname, 'rigtest.js'));
const { replayProbe } = require(path.join(__dirname, 'replayprobe.js'));
const args0 = process.argv.slice(2);

/* The probe reaches the game only through window.PixelProtocol. A name this
   file uses but 99-main.js does not publish throws inside the page, which
   surfaces minutes later as a bare TypeError with no result block — after a
   full browser run has already been paid for. Check it in milliseconds
   instead, before Chrome is ever started. */
function checkPublicSurface() {
  const main = fs.readFileSync(path.join(root, 'src', '99-main.js'), 'utf8');
  const block = main.match(/window\.PixelProtocol = \{[\s\S]*?\};/);
  if (!block) { console.log('!! could not find window.PixelProtocol in 99-main.js'); process.exit(1); }
  const exported = new Set(Array.from(block[0].matchAll(/(\w+):\s*\w+/g), (m) => m[1]));
  // attached separately, after the namespace literal
  exported.add('customizer'); exported.add('customizerError');
  const self = fs.readFileSync(__filename, 'utf8');
  const used = new Set(Array.from(self.matchAll(/\bA\.(\w+)/g), (m) => m[1]));
  const missing = Array.from(used).filter((name) => !exported.has(name));
  if (missing.length) {
    console.log('!! probe uses names that window.PixelProtocol does not export: ' + missing.join(', '));
    console.log('   add them in src/99-main.js or reach them another way');
    process.exit(1);
  }
}
/* The probe is assembled as one long template and only becomes code inside
   the page. A syntax error there — a duplicate binding is the easy one to
   write, since every block shares featureProbe's scope — surfaces as a page
   that renders but never reports, minutes after Chrome starts. Parse it
   here first, where the answer costs milliseconds. */
function checkProbeSyntax() {
  const open = PROBE.indexOf('>', PROBE.indexOf('<script')) + 1;
  const close = PROBE.lastIndexOf('</' + 'script>');
  if (open <= 0 || close <= open) { console.log('!! could not isolate the probe script'); process.exit(1); }
  // the injected text carries ${...} holes; any literal stands in for parsing
  const body = PROBE.slice(open, close).replace(/\$\{[^}]*\}/g, '0');
  try {
    new Function(body);
  } catch (error) {
    console.log('!! the probe script does not parse: ' + error.message);
    process.exit(1);
  }
}
checkPublicSurface();

const shotIdx = args0.indexOf('--shot');
const SHOT = shotIdx >= 0 ? path.resolve(args0[shotIdx + 1]) : null;
const FRAMES = parseInt(args0.find((a) => /^\d+$/.test(a)) || '420', 10);
/* screenshot runs stop mid-combat; test runs continue into the death screen */
const KILL_AT_END = !SHOT;
/* --click enters through the DEPLOY button instead of calling startRun() */
const CLICK = args0.indexOf('--click') >= 0;
/* --menu freezes the actual start screen instead of entering combat. */
const MENU = args0.indexOf('--menu') >= 0;
const CUSTOMIZER = args0.indexOf('--customizer') >= 0;
const yawIndex = args0.indexOf('--yaw');
const SHOW_YAW = yawIndex < 0 ? -0.52 : Number(args0[yawIndex + 1]);
if (!Number.isFinite(SHOW_YAW)) throw new Error('Invalid --yaw');
const bossIdx = args0.indexOf('--boss');
const BOSS = bossIdx >= 0 ? args0[bossIdx + 1] : null;
if (BOSS && !['siege', 'warden', 'queen'].includes(BOSS)) throw new Error('Unknown --boss: ' + BOSS);
const weaponIdx = args0.indexOf('--weapon');
const SHOW_WEAPON = weaponIdx >= 0 ? args0[weaponIdx + 1] : null;
if (weaponIdx >= 0 && (!SHOW_WEAPON || !/^[a-z]+$/.test(SHOW_WEAPON))) throw new Error('--weapon requires a weapon ID');

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
];

function findChrome() {
  for (const c of CHROME_CANDIDATES) if (c && fs.existsSync(c)) return c;
  throw new Error('no Chrome/Edge binary found');
}

/* the probe drives update/render directly instead of waiting on rAF, so the
   whole run finishes before the load event and lands in --dump-dom output */
const PROBE = `
<script type="module">
(function(){
  const inspectRigPose = ${inspectRigPose.toString()};
  const replayProbe = ${replayProbe.toString()};
  const rigPoses = ${JSON.stringify(RIG_POSES)};
  const log = [];
  let finished = false;
  const isFailure = (line) => !/^(NOTE|WARN):/.test(line) ||
    (/^WARN:/.test(line) && /WebGL|GL_INVALID|shader|NaN|non.finite/i.test(line));
  const fail = (kind, msg) => {
    const line = kind + ': ' + msg;
    log.push(line);
    if (finished) {
      if (isFailure(line)) out.textContent = out.textContent.replace(/^RESULT_OK/, 'RESULT_FAIL');
      out.textContent += '\\n' + line;
    }
  };
  window.addEventListener('error', (e) => fail('ERROR', (e.message||'') + ' @ ' + (e.filename||'') + ':' + (e.lineno||'')));
  window.addEventListener('unhandledrejection', (e) => fail('REJECT', String(e.reason)));
  const realErr = console.error;
  console.error = function(){ fail('CONSOLE', Array.prototype.join.call(arguments,' ')); realErr.apply(console, arguments); };
  const realWarn = console.warn;
  console.warn = function(){ fail('WARN', Array.prototype.join.call(arguments,' ')); realWarn.apply(console, arguments); };

  const out = document.createElement('pre');
  out.id = 'PROBE_RESULT';
  out.style.display = 'none';
  document.body.appendChild(out);

  function freezeShowcase(g, customizer) {
    g.hud._bannerTimer = 0;
    g.hud.bannerWrap.classList.remove('show');
    const capture = (canvas) => {
      // WebGL's default preserveDrawingBuffer=false discards its backing
      // pixels after compositing. Capture synchronously while they exist.
      const still = document.createElement('img');
      still.src = canvas.toDataURL('image/png');
      still.id = canvas.id;
      still.className = canvas.className;
      still.style.cssText = canvas.style.cssText;
      const computed = getComputedStyle(canvas);
      for (const name of ['position', 'top', 'right', 'bottom', 'left', 'width', 'height',
        'display', 'margin', 'z-index', 'border-radius', 'flex-shrink', 'align-self']) {
        still.style.setProperty(name, computed.getPropertyValue(name));
      }
      still.width = canvas.width; still.height = canvas.height;
      still.alt = 'Frozen game render';
      canvas.replaceWith(still);
    };
    g.render();
    capture(g.renderer.domElement);
    if (customizer) { customizer.update(0); capture(customizer.renderer.domElement); }
    // Keep the captured images, and prevent the already queued boot frame
    // from scheduling hundreds of unnecessary software-WebGL redraws.
    g.update = function () {};
    g.render = function () {};
    if (window.AS3D.customizer) window.AS3D.customizer.update = function () {};
    window.requestAnimationFrame = function () { return 0; };
  }

  function run(){
    const g = window.game;
    if (!g) { out.textContent = 'FATAL: window.game missing'; return; }
    // Software WebGL keeps the same rendering paths at a smaller resolution;
    // full-size screenshots retain the actual game quality settings.
    if (!${SHOT ? 'true' : 'false'}) {
      g.renderer.setPixelRatio(0.5);
      g.keyLight.shadow.mapSize.set(512, 512);
      if (g.keyLight.shadow.map) { g.keyLight.shadow.map.dispose(); g.keyLight.shadow.map = null; }
    }
    try { sfxProbe(g); } catch(e) { fail('AUDIO', e.message); }

    try {
      if (${JSON.stringify(SHOW_WEAPON)} && !window.AS3D.WEAPONS.some((w) => w.id === ${JSON.stringify(SHOW_WEAPON)})) {
        throw new Error('Unknown showcase weapon: ' + ${JSON.stringify(SHOW_WEAPON)});
      }
      if (${CUSTOMIZER}) {
        const cust = window.AS3D.customizer;
        if (!cust) throw new Error('customizer is unavailable');
        document.getElementById('start').classList.remove('show');
        cust.show();
        cust.look = window.AS3D.clampLook(Object.assign({}, cust.look, {
          nickname: 'АСЕТ-07', helmet: 'recon', shoulders: 'heavy', accent: 0x70eeff
        }));
        cust.rebuild(); cust._syncNickname();
        cust.setPreviewWeapon(${JSON.stringify(SHOW_WEAPON || 'railgun')});
        cust._renderPanel();
        cust.turntable.rotation.y = ${SHOW_YAW};
        cust.autoRotate = false;
        freezeShowcase(g, cust);
        out.textContent = (log.some(isFailure) ? 'RESULT_FAIL' : 'RESULT_OK') +
          '\\ncustomizer=frozen\\nISSUES(' + log.length + '):\\n' + log.join('\\n');
        finished = true;
        return;
      }
      if (${MENU}) {
        if (g.state !== 'menu' || !document.getElementById('start').classList.contains('show')) {
          fail('MENU', 'initial menu is not visible');
        }
        pixelProbe(g, (condition, kind, message) => { if (!condition) fail(kind, message); });
        g.update(1/60);
        freezeShowcase(g);
        out.textContent = (log.some(isFailure) ? 'RESULT_FAIL' : 'RESULT_OK') +
          '\\nmenu=frozen\\nISSUES(' + log.length + '):\\n' + log.join('\\n');
        finished = true;
        return;
      }
      if (${CLICK}) {
        // the real entry path: press DEPLOY the way a player does, which is
        // what wires up audio and tears down the start screen
        const startEl = document.getElementById('start');
        if (!startEl.classList.contains('show')) fail('UI', 'start screen was not showing before the click');
        document.getElementById('deployBtn').click();
        if (g.state !== 'play') fail('CLICK', 'DEPLOY did not start the game (state=' + g.state + ')');
        if (startEl.classList.contains('show')) fail('CLICK', 'start screen still visible after DEPLOY');
        if (!document.body.classList.contains('playing')) fail('CLICK', 'body.playing not set, cursor would stay visible');
      } else {
        g.startRun();
        document.getElementById('start').classList.remove('show');
        document.body.classList.add('playing');
      }

      let featureResults = 'skipped for screenshot';
      if (${KILL_AT_END}) {
        featureResults = 'replay=' + replayProbe(g, window.PixelProtocol) + '; ' + featureProbe(g);
      }

      // the bot aims at whatever is closest, so kills/loot/gore all get hit
      g.updateAim = function () {
        let best = null, bd = Infinity;
        for (let i = 0; i < this.enemies.list.length; i++) {
          const e = this.enemies.list[i];
          if (e.state === 3) continue;
          const d = (e.x - this.player.x) * (e.x - this.player.x) + (e.z - this.player.z) * (e.z - this.player.z);
          if (d < bd) { bd = d; best = e; }
        }
        if (best) this.aim.set(best.x, 1.0, best.z);
        else this.aim.set(this.player.x + Math.sin(this.time) * 8, 1.0, this.player.z + Math.cos(this.time) * 8);
      };

      // grant every weapon and plenty of ammo so all fire modes get exercised
      for (const w of window.AS3D.WEAPONS) g.player.giveWeapon(w.id);
      for (const t of new Set(window.AS3D.WEAPONS.map((w) => w.ammo))) if (t !== 'none') g.player.giveAmmo(t, 99999);

      // the bot is not meant to survive on skill; it needs to live long enough
      // to drive the wave director through several cycles
      g.player.maxHp = 1e6; g.player.hp = 1e6;


      // one of every alien, spawned at a distance so they have to path in
      for (const id of ['crawler','grunt','spitter','flyer','brute']) {
        for (let k=0;k<3;k++) {
          const a = Math.random()*Math.PI*2, r = 11 + k*2;
          g.spawnEnemyAt(id, g.player.x + Math.cos(a)*r, g.player.z + Math.sin(a)*r);
        }
      }

      const stats = { maxEnemies: 0, maxWave: 0 };
      let perkPicks = 0, victories = 0, shopVisits = 0;
      /* The doctrine screen halts the simulation until a card is taken, so
         every loop that drives update() has to be able to clear it — not just
         the main frame loop. Cycling the index also leaves the run with a
         mixed build instead of one column of the same perk. */
      const resolvePerk = () => {
        if (g.state === 'victory') {
          // clearing the last wave halts the run just as hard as a modal does
          victories++;
          if (!g.continueEndless()) fail('FINALE', 'the victory screen refused to continue');
          return true;
        }
        if (g.state === 'upgrade') {
          // the shop opens itself after every wave and halts the run until
          // it is closed, exactly like the doctrine screen
          shopVisits++;
          g.closeUpgrades();
          if (g.state === 'upgrade') fail('SHOP', 'the shop refused to close');
          return true;
        }
        if (g.state !== 'perk') return false;
        if (!g.perkOffer.length) { fail('PERK', 'doctrine screen opened with no cards'); return false; }
        perkPicks++;
        input.pressed['Digit' + (1 + (perkPicks % g.perkOffer.length))] = true;
        g.update(1/60);
        if (g.state === 'perk') fail('PERK', 'doctrine screen ignored a number key');
        // taking a perk hands straight over to the shop
        if (g.state === 'upgrade') { shopVisits++; g.closeUpgrades(); }
        return true;
      };
      const input = g.input;
      let boss = null, bossAdds = false;

      // controls: the camera sits at +Z, so W (forward/screen-up) must drive
      // the player toward -Z, and diagonals must not exceed run speed
      try {
        input.keys['KeyW'] = true; input.keys['KeyS'] = false; input.keys['KeyD'] = false;
        g.player.vx = 0; g.player.vz = 0;
        g.update(1/60); g.update(1/60);
        if (g.player.vz > -0.1) fail('CTRL', 'W does not drive -Z forward (vz=' + g.player.vz.toFixed(2) + ')');
        input.keys['KeyW'] = false; input.keys['KeyS'] = true;
        g.player.vx = 0; g.player.vz = 0;
        g.update(1/60); g.update(1/60);
        if (g.player.vz < 0.1) fail('CTRL', 'S does not drive +Z backward (vz=' + g.player.vz.toFixed(2) + ')');
        input.keys['KeyS'] = false; input.keys['KeyW'] = true; input.keys['KeyD'] = true;
        g.player.vx = 0; g.player.vz = 0;
        g.update(1/60); g.update(1/60); g.update(1/60); g.update(1/60);
        const sp = Math.hypot(g.player.vx, g.player.vz);
        if (sp > 9.5) fail('CTRL', 'diagonal movement faster than sprint (speed=' + sp.toFixed(2) + ')');
        input.keys['KeyW'] = false;

      } catch (e) { fail('CTRL', 'control probe threw: ' + e.message); }

      for (let f = 0; f < ${FRAMES}; f++) {
        // release the trigger periodically so semi-autos keep cycling
        input.mouseDown = (f % 7) !== 0;
        input.keys['KeyW'] = (f % 120) < 60;
        input.keys['KeyD'] = (f % 90) < 45;
        if (f % 70 === 0) input.pressed['Space'] = true;
        // rotate through the whole arsenal
        if (f % 40 === 0) input.pressed['Digit' + ((1 + ((f/40)|0) % window.AS3D.WEAPONS.length) % 10)] = true;
        if (f % 200 === 150) input.pressed['KeyR'] = true;
        if (f % 240 === 100) input.pressed['KeyG'] = true;
        input.rightDown = f % 120 < 35;

        g.update(1/60);
        resolvePerk();
        g.render();
        stats.maxEnemies = Math.max(stats.maxEnemies, g.enemies.aliveCount);
        stats.maxWave = Math.max(stats.maxWave, g.wave);

        // extra pressure early on; stop later so waves can actually be cleared
        if (f % 30 === 0 && f < ${FRAMES} * 0.35 && g.enemies.aliveCount < 40) {
          g.spawnEnemyAt('crawler', g.player.x + (Math.random()-0.5)*16, g.player.z + (Math.random()-0.5)*16);
        }
        if (f === 200) g.explosion(g.player.x + 6, 0.7, g.player.z, 200, 7, true);
        if (f === 260) { g.player.invuln = 0; g.player.takeDamage(45, g.player.x+2, g.player.z); }
        // skip the between-wave wait so several waves run inside the budget
        if (g.waveState === 'prep' && g.prepTimer > 0.5) g.prepTimer = 0.4;
        // boss phase: spawn late, let her summon and barrage, then force the
        // kill so the wave can still be cleared afterwards
        if (f === Math.floor(${FRAMES} * 0.55)) {
          boss = g.spawnEnemyAt('queen', g.player.x + 14, g.player.z + 6);
          if (boss) g.activeBoss = boss; else fail('BOSS', 'queen failed to spawn');
        }
        if (f === Math.floor(${FRAMES} * 0.82) && boss) {
          if (boss.state === 3) fail('BOSS', 'queen died before the scripted kill');
          bossAdds = g.enemies.list.some((e) => e.def.id === 'crawler');
          g.enemies.damage(boss, 1e6, 1, 0, 0, 0);
          if (boss.state !== 3) fail('BOSS', 'queen survived lethal damage');
          if (g.activeBoss) fail('BOSS', 'activeBoss not cleared on death');
        }
      }

      // wave transition: clear the field deterministically and confirm the
      // director ends the wave, hands out rewards, and starts the next one
      let waveAdvanced = 'skipped', deathState = 'n/a';
      if (${KILL_AT_END}) {
        g.spawnQueue.length = 0;
        const live = g.enemies.list.slice();
        for (let i = 0; i < live.length; i++) {
          if (live[i].state !== 3) g.enemies.damage(live[i], 1e9, 1, 0, 0, 0);
        }
        const before = g.wave;
        const originalRewards = g.spawnWaveRewards;
        let rewardDrops = 0;
        g.spawnWaveRewards = function () {
          const count = this.pickups.items.length;
          const result = originalRewards.call(this);
          rewardDrops += this.pickups.items.length - count;
          return result;
        };
        let guard = 0;
        while (g.wave === before && guard++ < 3000) { g.update(1/60); resolvePerk(); }
        g.spawnWaveRewards = originalRewards;
        waveAdvanced = (g.wave === before + 1) ? 'yes' : 'NO(stuck at ' + g.wave + ')';
        if (g.wave !== before + 1) fail('WAVE', 'director did not advance the wave after a clear');
        if (rewardDrops <= 0) fail('WAVE', 'no rewards dropped between waves');
        if (g.enemies.aliveCount === 0 && g.spawnQueue.length === 0 && g.waveState === 'active') {
          fail('WAVE', 'new wave started with an empty spawn queue');
        }
      }

      if (${KILL_AT_END}) {
        // force the death path (score screen, storage write); clear i-frames
        // first or a recent alien hit will absorb the killing blow
        g.player.invuln = 0;
        g.player.maxHp = 100; g.player.hp = 100;
        g.player.takeDamage(9999, g.player.x, g.player.z);
        g.update(1/60); g.render();
        deathState = g.state;
        if (g.state !== 'dead') fail('STATE', 'player death did not reach the dead state');
      } else {
        // Freeze for the screenshot. Chrome keeps the page's rAF loop running
        // under --virtual-time-budget long after this probe returns, so the
        // sim has to be pinned or the capture shows an unrelated later state.
        input.mouseDown = false;
        input.rightDown = false;
        for (const k in input.keys) input.keys[k] = false;
        if (${JSON.stringify(BOSS)}) {
          g.enemies.reset(); g.projectiles.clear();
          g.player.x = g.level.start.x; g.player.z = g.level.start.z;
          g.player.vx = g.player.vz = g.player.kx = g.player.kz = 0;
          const id = ${JSON.stringify(BOSS)};
          const enemy = g.spawnEnemyAt(id, g.player.x + 6, g.player.z - 4);
          if (!enemy) throw new Error('screenshot boss failed to spawn: ' + id);
          g.activeBoss = enemy;
          g.wave = 3 * (['siege', 'warden', 'queen'].indexOf(id) + 1);
          g.waveState = 'active'; g.spawnQueue.length = 0;
          enemy.specialCd = 0; enemy.hp = enemy.maxHp * 0.8;
          g.player.setWeapon(window.AS3D.WEAPONS.findIndex((w) => w.id === ${JSON.stringify(SHOW_WEAPON || 'railgun')}));
          g.player.angle = Math.atan2(enemy.x - g.player.x, enemy.z - g.player.z);
          g.player.mags[g.player.weapon.id] = g.player.weapon.mag; g.player.reloading = 0;
          g.player.shoot(enemy.x, enemy.z);
          g._camSmooth = null; g.updateCamera(1);
        }
        // Preserve the health percentage while hiding the bot's test buffer.
        const healthRatio = g.player.hp / g.player.maxHp;
        g.player.maxHp = 100;
        g.player.hp = Math.max(1, Math.min(100, Math.ceil(healthRatio * 100)));
        if (${JSON.stringify(SHOW_WEAPON)} && !${JSON.stringify(BOSS)}) {
          g.player.setWeapon(window.AS3D.WEAPONS.findIndex((w) => w.id === ${JSON.stringify(SHOW_WEAPON)}));
          g.player.reloading = 0; g.player.recoil = 0;
        }
        g.update(1/60);
        freezeShowcase(g);
      }

      // snapshot the run before restarting, or the reported figures are just
      // the fresh state of the last restart
      const run = {
        wave: g.wave, kills: g.stats.kills, shots: g.stats.shots, hits: g.stats.hits,
        pickups: g.pickups.items.length, weapons: g.player.ownedList().length
      };

      // restarting rebuilds the facility from scratch; geometry count must
      // settle rather than climb with every run
      let restartGeo = 'skipped';
      if (${KILL_AT_END}) {
        const before = g.renderer.info.memory.geometries;
        for (let r = 0; r < 3; r++) {
          g.startRun();
          for (let f = 0; f < 20; f++) { g.update(1/60); g.render(); }
        }
        const after = g.renderer.info.memory.geometries;
        restartGeo = before + '->' + after;
        if (after > before * 1.6 + 12) fail('LEAK', 'geometry count grew ' + before + ' -> ' + after + ' over 3 restarts');
      }

      const gl = g.renderer.getContext();
      const glErr = gl.getError();
      if (glErr !== 0) fail('GL', 'glGetError = 0x' + glErr.toString(16));

      const info = g.renderer.info;
      out.textContent = (log.some(isFailure) ? 'RESULT_FAIL' : 'RESULT_OK') + '\\n' +
        'features=' + featureResults + '\\n' +
        'frames=${FRAMES}\\n' +
        'wave=' + run.wave + ' (peak ' + stats.maxWave + ')\\n' +
        'bossSummonedAdds=' + bossAdds + '\\n' +
        'waveAdvanced=' + waveAdvanced + '\\n' +
        'restartGeometries=' + restartGeo + '\\n' +
        'pickupsLive=' + run.pickups + '\\n' +
        'weapons=' + run.weapons + '\\n' +
        'kills=' + run.kills + '\\n' +
        'shots=' + run.shots + '\\n' +
        'hits=' + run.hits + '\\n' +
        'peakAliens=' + stats.maxEnemies + '\\n' +
        'perksTaken=' + perkPicks + ' victories=' + victories + ' shopVisits=' + shopVisits + '\\n' +
        'drawCalls=' + info.render.calls + '\\n' +
        'triangles=' + info.render.triangles + '\\n' +
        'geometries=' + info.memory.geometries + '\\n' +
        'textures=' + info.memory.textures + '\\n' +
        'stateAfterDeath=' + deathState + '\\n' +
        'entry=' + (${CLICK} ? 'DEPLOY button' : 'startRun()') + '\\n' +
        'audioContext=' + ((window.AS3D && window.AS3D.sfx && window.AS3D.sfx.ctx) ? window.AS3D.sfx.ctx.state : 'none') + '\\n' +
        'renderer=' + (gl.getParameter(gl.VERSION)) + '\\n' +
        'ISSUES(' + log.length + '):\\n' + log.slice(0, 40).join('\\n');
      finished = true;
    } catch (e) {
      out.textContent = 'RESULT_THROW\\n' + (e && e.stack ? e.stack : String(e)) +
        '\\nISSUES(' + log.length + '):\\n' + log.slice(0,40).join('\\n');
      finished = true;
    }
  }

  function profileProbe(g, check) {
    const A = window.AS3D, input = g.input, cust = A.customizer;
    check(!!cust, 'LOOK', 'customizer unavailable: ' + A.customizerError);
    if (!cust) return;
    const nickname = 'Асет-07';
    check(A.sanitizeNickname(nickname) === nickname, 'NICK', 'Cyrillic nickname was lost');
    check(A.sanitizeNickname('Ж'.repeat(30)).length === 18, 'NICK', 'nickname exceeds 18 characters');
    check(!A.sanitizeNickname('Асет' + String.fromCharCode(0x202e)).includes(String.fromCharCode(0x202e)),
      'NICK', 'directional control survived nickname normalization');
    const defaults = A.clampLook(null);
    const invalid = A.clampLook({ helmet: 'invalid', shoulders: 'invalid', accent: -1, nickname: '' });
    check(invalid.helmet === defaults.helmet && invalid.shoulders === defaults.shoulders &&
      invalid.accent === defaults.accent && invalid.nickname === defaults.nickname, 'LOOK', 'invalid cosmetic fallback failed');
    const look = Object.assign({}, defaults, { nickname: nickname, skin: 0x9a6a44, hairStyle: 'mohawk',
      helmet: 'recon', shoulders: 'heavy', backpack: false, accent: 0xb6a0ff, vest: false });
    A.saveLook(look);
    const back = A.loadLook();
    check(Object.keys(look).every((k) => back[k] === look[k]), 'LOOK', 'expanded profile did not round-trip');
    const ownedBefore = JSON.stringify(g.player.owned);
    cust.look = back; cust.rebuild(); cust._renderPanel(); cust._syncNickname(); cust.show();
    const nameField = document.getElementById('custNickname');
    const hostile = '<img src=x onerror=alert(1)>Асет';
    nameField.value = hostile; nameField.dispatchEvent(new Event('input', { bubbles: true }));
    cust.commit();
    const safe = A.sanitizeNickname(hostile);
    check(A.loadLook().nickname === safe && !/[<>]/.test(safe), 'NICK', 'HTML nickname was not normalized');
    for (const id of ['custCallsign', 'playerCallsign']) {
      const el = document.getElementById(id);
      check(el && el.textContent === safe && el.children.length === 0, 'NICK', id + ' treated nickname as markup');
    }
    nameField.value = nickname; nameField.dispatchEvent(new Event('input', { bubbles: true }));
    cust.randomize(); check(cust.look.nickname === nickname, 'NICK', 'randomize replaced the nickname');
    cust.resetLook(); check(cust.look.nickname === nickname, 'NICK', 'resetLook replaced the nickname');
    for (const id of ['railgun', 'autocannon']) {
      check(cust.setPreviewWeapon(id) && cust.previewWeaponId === id && !!cust.previewWeapon.geometry,
        'LOOK', id + ' could not be previewed');
      check(cust.previewWeapon.scale.x >= 1.3, 'LOOK', id + ' preview uses an undersized weapon');
      cust.update(1/60);
    }
    cust.commit(); cust.hide();
    check(JSON.stringify(g.player.owned) === ownedBefore, 'LOOK', 'preview changed run inventory');
    check(g.player.model.head.parent === g.player.root && g.player.callsign === nickname,
      'LOOK', 'profile commit did not update the live marine');

    // Generic controls exercise InputState itself, not only the nickname
    // field's own propagation guard. A focused edit must clear prior input.
    for (const tag of ['input', 'textarea', 'select', 'div']) {
      const edit = document.createElement(tag);
      if (tag === 'div') { edit.contentEditable = 'true'; edit.tabIndex = 0; }
      document.body.appendChild(edit);
      input.keys.KeyW = true; input.mouseDown = input.rightDown = true;
      edit.focus();
      check(!input.down('KeyW') && !input.mouseDown && !input.rightDown, 'INPUT', tag + ' focus retained held game input');
      for (const code of ['KeyW', 'KeyP', 'KeyB', 'KeyG', 'KeyR', 'Space', 'Digit0', 'Enter']) {
        edit.dispatchEvent(new KeyboardEvent('keydown', { code: code, bubbles: true }));
        edit.dispatchEvent(new KeyboardEvent('keyup', { code: code, bubbles: true }));
      }
      check(!Object.values(input.keys).some(Boolean) && Object.keys(input.pressed).length === 0 &&
        !input.mouseDown && !input.rightDown, 'INPUT', tag + ' typing reached game actions');
      const stateBefore = g.state, originalStart = g.startRun;
      let deployments = 0;
      try {
        g.state = 'menu';
        g.startRun = function () { deployments++; };
        edit.dispatchEvent(new KeyboardEvent('keydown', { code: 'Enter', bubbles: true }));
        check(deployments === 0, 'INPUT', tag + ' Enter started a game');
      } finally { g.state = stateBefore; g.startRun = originalStart; }
      edit.blur(); edit.remove(); input.clear();
    }
  }

  function rigProbe(g, check) {
    const A = window.AS3D, p = g.player, THREE = A.THREE;
    const saved = {};
    for (const key of ['weaponIndex', 'recoil', 'aiming', 'walkPhase', 'vx', 'vz', 'reloading', 'reloadTotal', 'spin', 'angle']) saved[key] = p[key];
    try {
      for (let i = 0; i < A.WEAPONS.length; i++) {
        p.setWeapon(i);
        const weapon = p.weapon;
        const hasRig = weapon.pose && p.model.handL && p.model.handR && p.model.gripTarget && p.model.supportTarget;
        check(!!hasRig, 'RIG', weapon.id + ': hand and socket metadata missing');
        if (!hasRig) continue;
        for (let k = 0; k < rigPoses.length; k++) {
          const pose = rigPoses[k], label = weapon.id + '/' + pose.name;
          p.recoil = weapon.recoil * pose.recoil;
          p.aiming = pose.aiming; p.walkPhase = pose.phase;
          p.vx = pose.speed * 0.6; p.vz = pose.speed * 0.8;
          p.reloadTotal = weapon.reload; p.reloading = weapon.reload * pose.reload;
          p.spin = weapon.spinUp ? 1 : 0; p.angle = 0.4 + k * 0.67;
          p.updateModel(1/60, pose.speed, p.x + 4, p.z + 6);
          const metrics = inspectRigPose(THREE, p.model, p.root, weapon, p.weaponMesh, pose.reload > 0);
          check(metrics.finite, 'RIG', label + ': non-finite transforms');
          check(metrics.gripError < 0.012 && metrics.supportError < 0.012,
            'RIG', label + ': hands miss sockets (grip=' + metrics.gripError + ', support=' + metrics.supportError + ')');
          check(metrics.gripTargetError < 1e-5 && metrics.supportTargetError < 1e-5,
            'RIG', label + ': grip targets drifted from the gun');
          check(metrics.limbLengthError < 0.002 && metrics.jointGap < 1e-5,
            'RIG', label + ': arm segments stretch or disconnect');
          if (pose.name === 'idle') check(metrics.gripDepth >= 0.37 && metrics.receiverClearsBody,
            'RIG', label + ': firing hand or receiver sits inside the chest');
          const muzzle = p.muzzleWorld(new THREE.Vector3());
          const tip = new THREE.Vector3(...weapon.muzzle).applyMatrix4(p.weaponMesh.matrixWorld);
          // The live muzzle may be pulled back to avoid firing through a wall.
          const dx = tip.x - p.x, dz = tip.z - p.z, distance = Math.hypot(dx, dz);
          const blocked = g.level.raycastWall(p.x, p.z, dx / distance, dz / distance, distance);
          check(muzzle.toArray().every(Number.isFinite) && (blocked || muzzle.distanceTo(tip) < 1e-5),
            'RIG', label + ': muzzle disagrees with rendered tip');
          check(Math.abs(p.weaponMesh.rotation.z) < 1e-8, 'RIG', label + ': whole receiver spins');
        }
      }
      const cust = A.customizer;
      if (cust) {
        cust.show();
        for (const weapon of A.WEAPONS) {
          cust.setPreviewWeapon(weapon.id); cust.update(0);
          const m = inspectRigPose(THREE, cust.model, cust.model.root, weapon, cust.previewWeapon, false);
          check(m.finite && m.gripError < 0.012 && m.supportError < 0.012,
            'RIG', weapon.id + ': customizer holds the weapon incorrectly');
        }
        cust.hide();
      }
    } finally {
      const index = saved.weaponIndex;
      delete saved.weaponIndex;
      p.setWeapon(index); Object.assign(p, saved);
      p.updateModel(0, Math.hypot(p.vx, p.vz), p.x + 4, p.z + 6);
    }
  }

  function pixelProbe(g, check) {
    const fx = g.pixelFX, renderer = g.renderer;
    check(!!fx && !!window.AS3D.TWEEN, 'PIXEL', 'pixel renderer or tween.js is missing');
    if (!fx) return;
    const saved = { width: fx.width, height: fx.height, pixelSize: fx.pixelSize,
      target: renderer.getRenderTarget(), autoReset: renderer.info.autoReset, motion: g.motionScale };
    try {
      for (const mode of [0, 2, 3, 4, 6]) {
        fx.setPixelSize(mode); fx.resize(319, 181);
        check(fx.pixelSize === mode, 'PIXEL', 'pixel mode rejected: ' + mode);
        const divisor = mode || 2;
        const logicalWidth = Math.ceil(319 / divisor), logicalHeight = Math.ceil(181 / divisor);
        check(fx.logicalWidth === logicalWidth && fx.logicalHeight === logicalHeight && fx.renderScale === 2,
          'PIXEL', 'odd resize produced incorrect logical dimensions or supersampling scale for ' + mode);
        check(fx.target.width === logicalWidth * 2 && fx.target.height === logicalHeight * 2,
          'PIXEL', 'scene target is not supersampled for mode ' + mode);
        check(fx.detailTarget && fx.detailTarget.width === logicalWidth && fx.detailTarget.height === logicalHeight,
          'PIXEL', 'detail target is not at logical resolution for mode ' + mode);
        check(fx.target.depthTexture && fx.target.depthTexture.isDepthTexture,
          'PIXEL', 'scene target has no readable depth texture');
        check(fx.uniforms.sourceSize.value.x === logicalWidth && fx.uniforms.sourceSize.value.y === logicalHeight &&
          Math.abs(fx.uniforms.texel.value.x - 1 / logicalWidth) < 1e-10 &&
          Math.abs(fx.uniforms.texel.value.y - 1 / logicalHeight) < 1e-10,
          'PIXEL', 'art shader sampling grid does not match logical dimensions');
        check(fx.detailTarget && fx.detailTarget.texture.magFilter === window.AS3D.THREE.NearestFilter,
          'PIXEL', 'styled pixels are smoothed instead of nearest-neighbour scaled');
        g.render();
        check(renderer.getRenderTarget() === saved.target && renderer.info.autoReset === saved.autoReset,
          'PIXEL', 'render did not restore render target or statistics state');
        check(renderer.getContext().getError() === 0, 'GL', 'pixel mode ' + mode + ' generated a GL error');
      }
      for (const invalid of [-1, 5, NaN, 'invalid']) {
        fx.setPixelSize(invalid);
        check(fx.pixelSize === 2, 'PIXEL', 'invalid pixel mode was not normalized');
      }
      // A tiny unlit reference scene catches a black/incorrect colour pass
      // even when the GLSL compiles and all framebuffer sizes look valid.
      const THREE = window.AS3D.THREE;
      const sampleScene = new THREE.Scene();
      const sampleCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 5);
      sampleCamera.position.z = 2;
      const sampleGeo = new THREE.PlaneGeometry(0.9, 0.9);
      const sampleMat = new THREE.MeshBasicMaterial({ color: 0x4080c0 });
      sampleScene.add(new THREE.Mesh(sampleGeo, sampleMat));
      const clearColor = renderer.getClearColor(new THREE.Color()).clone();
      const clearAlpha = renderer.getClearAlpha(), reveal = fx.uniforms.reveal.value;
      try {
        renderer.setClearColor(0x000000, 0);
        fx.setPixelSize(2); fx.resize(32, 24); fx.uniforms.reveal.value = 1;
        fx.render(sampleScene, sampleCamera);
        const center = new Uint8Array(4), background = new Uint8Array(4);
        renderer.readRenderTargetPixels(fx.detailTarget, 8, 6, 1, 1, center);
        renderer.readRenderTargetPixels(fx.detailTarget, 0, 0, 1, 1, background);
        check(center[2] > center[1] && center[1] > center[0] && center[0] > 10 && center[3] > 245,
          'PIXEL', 'unlit reference quad lost colour or became black: ' + Array.from(center));
        check(background[3] < 5, 'PIXEL', 'empty art target lost transparent background: ' + Array.from(background));
        check(renderer.getContext().getError() === 0, 'GL', 'reference art pass generated a GL error');
      } finally {
        renderer.setClearColor(clearColor, clearAlpha); fx.uniforms.reveal.value = reveal;
        sampleGeo.dispose(); sampleMat.dispose();
      }
      fx.setPixelSize(2); fx.resize(saved.width, saved.height);
      const width = fx.target.width, height = fx.target.height;
      g.motionScale = 1; g.revealSector();
      check(fx.uniforms.reveal.value < 1, 'TWEEN', 'sector reveal did not begin');
      for (let i = 0; i < 60; i++) {
        g.update(1/60);
        if (g.state === 'perk') g.choosePerk(g.perkOffer[0].id);
        if (g.state === 'upgrade') g.closeUpgrades();
      }
      check(Math.abs(fx.uniforms.reveal.value - 1) < 1e-6, 'TWEEN', 'sector reveal failed to finish');
      check(fx.target.width === width && fx.target.height === height, 'PIXEL', 'reveal changed render target size');
      check(g.presentation.getAll().length === 0, 'TWEEN', 'completed reveal retained its tween');
    } finally {
      g.motionScale = saved.motion;
      fx.setPixelSize(saved.pixelSize); fx.resize(saved.width, saved.height);
      renderer.setRenderTarget(saved.target);
      renderer.info.autoReset = saved.autoReset;
    }
    check(fx.width === saved.width && fx.height === saved.height && fx.pixelSize === saved.pixelSize,
      'PIXEL', 'probe did not restore render dimensions and mode');
  }

  function featureProbe(g) {
    const A = window.AS3D, p = g.player, input = g.input;
    let checks = 0;
    const check = (condition, kind, message) => { checks++; if (!condition) fail(kind, message); };
    const key = (code) => {
      window.dispatchEvent(new KeyboardEvent('keydown', { code: code }));
      window.dispatchEvent(new KeyboardEvent('keyup', { code: code }));
    };
    const clearInput = () => {
      input.mouseDown = input.rightDown = false;
      for (const k in input.keys) input.keys[k] = false;
      input.endFrame();
    };
    const navCheck = (level, label) => {
      check(!level.isWallAt(level.start.x, level.start.z), 'NAV', label + ': player starts in a wall');
      level.rebuildNav(level.start.x, level.start.z);
      let isolated = 0;
      for (let i = 0; i < level.grid.length; i++) if (level.grid[i] === 0 && level.navDist[i] < 0) isolated++;
      check(isolated === 0, 'NAV', label + ': ' + isolated + ' unreachable floor tiles');
      check(level.spawnPoints.length > 0 && level.spawnPoints.every((pos) =>
        !level.isWallAt(pos.x, pos.z) && level.navDist[level.idx(level.worldToTileX(pos.x), level.worldToTileZ(pos.z))] >= 0),
        'NAV', label + ': invalid or unreachable spawn points');
      check(level.propSpots.every((pos) => !level.isWallAt(pos.x, pos.z)), 'NAV', label + ': prop in a wall');
    };
    const finiteScene = (label) => {
      let bad = null;
      const checkedGeometry = new Set();
      g.scene.traverse((object) => {
        if (bad) return;
        if (!object.matrixWorld.elements.every(Number.isFinite)) bad = object.type + ' matrix';
        if (object.isInstancedMesh) {
          const values = object.instanceMatrix.array;
          for (let i = 0; i < object.count * 16; i++) {
            if (!Number.isFinite(values[i])) { bad = object.type + ' instance'; break; }
          }
        }
        if (object.geometry && !checkedGeometry.has(object.geometry)) {
          checkedGeometry.add(object.geometry);
          for (const name of ['position', 'normal']) {
            const attribute = object.geometry.attributes[name];
            if (attribute && !attribute.array.every(Number.isFinite)) bad = object.type + ' ' + name;
          }
        }
      });
      check(!bad && [p.x, p.z, p.hp, p.armor].every(Number.isFinite), 'FINITE', label + ': ' + bad);
    };

    // Exercise generation independently of GPU rendering across all themes.
    for (let sector = 0; sector < 3; sector++) {
      for (let seed = 0; seed < 8; seed++) navCheck(new A.LevelMap(48, 48, 701 + seed * 29, sector), 'sector ' + sector + ', seed ' + seed);
    }

    profileProbe(g, check);
    pixelProbe(g, check);
    check(A.WEAPONS.length === 10, 'ARSENAL', 'expected ten weapons');
    for (const weapon of A.WEAPONS) p.giveWeapon(weapon.id);
    for (const type of new Set(A.WEAPONS.map((w) => w.ammo))) if (type !== 'none') p.giveAmmo(type, 99999);
    check(p.ownedList().length === 10, 'ARSENAL', 'not all ten weapons could be granted');
    for (let i = 0; i < A.WEAPONS.length; i++) {
      const code = 'Digit' + ((i + 1) % 10);
      clearInput(); key(code);
      p.update(1/60, input, p.x, p.z + 3); input.endFrame();
      const w = A.WEAPONS[i];
      check(p.weapon.id === w.id, 'ARSENAL', code + ' did not equip ' + w.id);
      p.fireTimer = 0; p.reloading = 0; p.triggerLatched = false; p.spin = 1;
      p.mags[w.id] = w.mag;
      const shots = g.stats.shots;
      input.mouseDown = true;
      p.update(1/60, input, p.x, p.z + 3); input.endFrame();
      check(g.stats.shots > shots && p.mag < w.mag, 'ARSENAL', w.id + ' did not fire and consume a round');
      g.render();
    }
    clearInput(); g.projectiles.clear();
    rigProbe(g, check);

    // Real mouse events must enable precision aim and restore hip fire.
    p.bloom = 0;
    p.update(1/60, input, p.x, p.z + 3);
    const hipSpread = p.spreadScale;
    g.canvas.dispatchEvent(new MouseEvent('mousedown', { button: 2, bubbles: true }));
    p.update(1/60, input, p.x, p.z + 3);
    check(p.aiming && p.spreadScale < hipSpread * 0.6, 'AIM', 'RMB did not tighten weapon spread');
    window.dispatchEvent(new MouseEvent('mouseup', { button: 2 }));
    p.update(1/60, input, p.x, p.z + 3);
    check(!p.aiming && !input.rightDown, 'AIM', 'RMB stayed latched after release');

    // A single plasma round must damage the primary and two nearby targets.
    p.x = g.level.start.x; p.z = g.level.start.z; p.angle = 0;
    const targets = [[0, 3], [2.2, 3], [-2.2, 3]].map((offset) => {
      const e = g.spawnEnemyAt('grunt', p.x + offset[0], p.z + offset[1]);
      if (e) { e.hp = 1000; e.maxHp = 1000; }
      return e;
    });
    check(targets.every(Boolean), 'PLASMA', 'could not create arc targets');
    const plasmaIndex = A.WEAPONS.findIndex((w) => w.id === 'plasma');
    p.setWeapon(plasmaIndex);
    p.spreadScale = 0; p.fireTimer = 0; p.mags.plasma = p.weapon.mag;
    const primary = targets[0];
    if (primary) p.shoot(primary.x, primary.z);
    check(targets.every((e) => e && e.hp < 1000), 'PLASMA', 'arc did not chain to all three targets');
    const cellBefore = p.ammo.cell;
    p.mags.plasma = 0; p.reloading = 0;
    key('KeyR'); p.update(1/60, input, p.x, p.z + 3); input.endFrame();
    check(p.reloading > 0, 'PLASMA', 'R did not start cell reload');
    for (let frame = 0; frame < 180 && p.reloading > 0; frame++) p.update(1/60, input, p.x, p.z + 3);
    check(p.mag === p.weapon.mag && p.ammo.cell === cellBefore - p.weapon.mag,
      'PLASMA', 'cell reload did not transfer the correct reserve amount');
    g.enemies.reset();

    // The ninth weapon penetrates a line; the tenth launches small explosive
    // shells. Both count at most one accuracy confirmation per discharge.
    p.setWeapon(A.WEAPONS.findIndex((w) => w.id === 'railgun'));
    p.angle = 0; p.spreadScale = 0; p.reloading = 0; p.mags.railgun = p.weapon.mag;
    const railTargets = [3, 4.5, 6].map((distance) => {
      const e = g.spawnEnemyAt('grunt', p.x + 0.2, p.z + distance);
      if (e) e.hp = e.maxHp = 10000;
      return e;
    });
    const railHits = g.stats.hits;
    p.shoot(p.x + 0.2, p.z + 9);
    check(railTargets.every((e) => e && e.hp < 10000), 'RAIL', 'railgun failed to penetrate all aligned targets');
    check(g.stats.hits === railHits + 1, 'ACCURACY', 'railgun counted pierced targets as extra shots');
    g.enemies.reset();
    p.setWeapon(A.WEAPONS.findIndex((w) => w.id === 'autocannon'));
    p.angle = 0; p.spreadScale = 0; p.mags.autocannon = p.weapon.mag;
    const shellVictim = g.spawnEnemyAt('grunt', p.x + 0.2, p.z + 4);
    if (shellVictim) shellVictim.hp = shellVictim.maxHp = 1000;
    const shellHits = g.stats.hits;
    p.shoot(p.x + 0.2, p.z + 4);
    check(g.projectiles.rockets.some((r) => r.w.projectileKind === 'shell'), 'CANNON', 'autocannon did not launch a shell');
    for (let f = 0; f < 120 && g.projectiles.rockets.length; f++) g.projectiles.update(1/60, p);
    check(shellVictim && shellVictim.hp < 1000, 'CANNON', 'autocannon shell did not damage its target');
    check(g.stats.hits === shellHits + 1, 'ACCURACY', 'explosive shell confirmation was missing or duplicated');
    g.enemies.reset(); g.projectiles.clear();

    // Throw through G, reject a second throw during cooldown, and verify the
    // real explosion damages a target after the visible flight and fuse.
    p.grenadeCd = 0;
    key('KeyG'); p.update(1/60, input, p.x, p.z + 3); input.endFrame();
    const grenade = p.grenade;
    check(!!grenade && p.grenadeCd > 0 && p.grenadeMesh.visible, 'GRENADE', 'G did not throw a visible grenade');
    if (grenade) {
      check(!g.level.isWallAt(grenade.tx, grenade.tz), 'GRENADE', 'grenade target is inside a wall');
      key('KeyG'); p.update(1/60, input, p.x, p.z + 3); input.endFrame();
      check(p.grenade === grenade, 'GRENADE', 'cooldown allowed another grenade');
      const victim = g.spawnEnemyAt('grunt', grenade.tx, grenade.tz);
      if (victim) { victim.hp = victim.maxHp = 1000; }
      for (let frame = 0; frame < 100 && p.grenade; frame++) p.updateGrenade(1/60);
      check(!p.grenade && !p.grenadeMesh.visible, 'GRENADE', 'grenade did not detonate and hide');
      check(victim && victim.hp < 1000, 'GRENADE', 'grenade explosion caused no enemy damage');
      check(p.grenadeCd > 0 && !p.throwGrenade(p.x, p.z + 3), 'GRENADE', 'detonation bypassed cooldown');
    }
    g.enemies.reset(); clearInput();

    /* The shop. Weapons are no longer handed out on the floor, so this is the
       only way to arm up: stock is rolled, priced, rerollable and pinnable,
       and nothing may be bought that is not actually on the shelf. */
    g.waveState = 'active';
    const combatMoney = g.money;
    check(!g.openUpgrades() && g.state === 'play', 'SHOP', 'shop opened during combat');
    check(!g.buySlot(0) && g.money === combatMoney, 'SHOP', 'a purchase escaped shop gating');
    g.state = 'upgrade';
    check(!g.buySlot(0) && g.money === combatMoney, 'SHOP', 'a purchase escaped active-wave gating');
    g.state = 'play'; g.waveState = 'prep';
    g.wave = 9; g.shopStock = []; g.upgrades = {};
    for (const unlock of A.WEAPON_UNLOCK) delete p.owned[unlock.id];
    check(g.openUpgrades() && document.getElementById('upgradeScreen').classList.contains('show'),
      'SHOP', 'shop did not open during preparation');
    check(g.shopStock.length === A.SHOP_SLOTS, 'SHOP', 'the shop did not fill its slots');
    check(document.querySelectorAll('#upgradeGrid [data-slot]').length > 0, 'SHOP', 'the shop rendered no buyable slot');
    const stocked = g.shopStock.filter(Boolean);
    check(stocked.length > 0, 'SHOP', 'the shop opened empty');
    check(new Set(stocked.map((x) => x.kind + x.id)).size === stocked.length, 'SHOP', 'the shop listed a duplicate');
    // reopening between waves must not silently reroll the shelf
    const shelf = g.shopStock.map((x) => (x ? x.kind + x.id : '-')).join();
    g.closeUpgrades(); g.openUpgrades();
    check(g.shopStock.map((x) => (x ? x.kind + x.id : '-')).join() === shelf, 'SHOP', 'reopening rerolled the shop for free');
    // nothing is affordable at zero credits, and a refusal never debits
    g.money = 0;
    check(!g.buySlot(0) && g.money === 0, 'SHOP', 'insufficient funds were accepted');
    check(!g.rerollShop() && g.money === 0, 'SHOP', 'a free reroll was granted');
    check(!g.buySlot(999) && !g.buySlot(-1), 'SHOP', 'a slot outside the shelf was bought');
    // rerolling costs, climbs, and respects locks
    g.money = 100000;
    const firstReroll = g.rerollCost();
    if (!g.shopStock[0]) g.shopStock[0] = { kind: 'upgrade', id: 'medkit', price: 80, locked: false, sold: false };
    g.shopStock[0].locked = true;
    const pinned = g.shopStock[0];
    const moneyBefore = g.money;
    check(g.rerollShop(), 'SHOP', 'an affordable reroll was refused');
    check(g.money === moneyBefore - firstReroll, 'SHOP', 'the reroll charged the wrong price');
    check(g.shopStock[0] === pinned, 'SHOP', 'a pinned slot was rerolled away');
    check(g.rerollCost() > firstReroll, 'SHOP', 'the reroll price did not climb');
    // a lock can be released again
    check(g.toggleShopLock(0) && !g.shopStock[0].locked, 'SHOP', 'a pin could not be released');
    check(g.toggleShopLock(0) && g.shopStock[0].locked, 'SHOP', 'a slot could not be pinned');
    // buying a weapon: it arrives with ammunition and leaves the shelf sold
    g.rollShop([]);
    let weaponSlot = g.shopStock.findIndex((x) => x && x.kind === 'weapon');
    if (weaponSlot < 0) {
      g.shopStock[0] = { kind: 'weapon', id: 'rifle', price: A.WEAPON_BY_ID.rifle.price, locked: false, sold: false };
      weaponSlot = 0;
    }
    const bought = g.shopStock[weaponSlot];
    check(!p.owned[bought.id], 'SHOP', 'the shop offered a weapon the player already had');
    g.money = bought.price;
    check(g.buySlot(weaponSlot), 'SHOP', 'an affordable weapon was refused');
    check(p.owned[bought.id], 'SHOP', 'the bought weapon never arrived');
    check(g.money === 0, 'SHOP', 'the weapon was charged the wrong price');
    check(g.shopStock[weaponSlot].sold, 'SHOP', 'the sold slot stayed on sale');
    check(!g.buySlot(weaponSlot), 'SHOP', 'a sold slot was bought twice');
    const ammoType = A.WEAPON_BY_ID[bought.id].ammo;
    if (ammoType !== 'none') check(p.ammo[ammoType] > 0, 'SHOP', 'the bought weapon came without ammunition');
    // a sold slot stays sold through a reroll, so it cannot be re-bought cheaply
    g.money = 100000;
    check(g.rerollShop(), 'SHOP', 'could not reroll after a purchase');
    check(g.shopStock[weaponSlot].sold, 'SHOP', 'a reroll refilled a slot already paid for');
    // upgrades still apply their effect and climb in rank
    g.shopStock[1] = { kind: 'upgrade', id: 'damage', price: 220, locked: false, sold: false };
    const damageBefore = p.damageMultiplier;
    check(g.buySlot(1), 'SHOP', 'an upgrade could not be bought');
    check(p.damageMultiplier > damageBefore, 'SHOP', 'the bought upgrade had no effect');
    check(g.upgrades.damage === 1, 'SHOP', 'the upgrade rank was not recorded');
    // a purchase that would do nothing is refused before it charges
    p.hp = p.maxHp;
    g.shopStock[2] = { kind: 'upgrade', id: 'medkit', price: 80, locked: false, sold: false };
    const fullMoney = g.money;
    check(!g.buySlot(2) && g.money === fullMoney, 'SHOP', 'a no-effect purchase spent credits');
    p.hp = p.maxHp - 70;
    check(g.buySlot(2) && p.hp === p.maxHp - 10, 'SHOP', 'the medkit did not heal');
    // The id-addressed path only reaches what is on the shelf. The shelf is
    // emptied first: asserting against rolled stock would make this a coin
    // flip on whatever RNG state the run arrived with.
    g.shopStock = [null, null, null, null];
    check(!g.buyUpgrade('armor'), 'SHOP', 'an upgrade not on the shelf was bought by id');
    const armorRank = g.upgrades.armor || 0;
    g.shopStock[3] = { kind: 'upgrade', id: 'armor', price: 160, locked: false, sold: false };
    g.money = 160;
    check(g.buyUpgrade('armor') && g.upgrades.armor === armorRank + 1,
      'SHOP', 'an offered upgrade could not be bought by id');
    // weapons are bought, never dropped: clearing a wave leaves none on the floor
    g.money = 100000;
    const floorBefore = g.pickups.items.length;
    g.spawnWaveRewards();
    const weaponDrops = g.pickups.items.slice(floorBefore).filter((item) => item.kind === 'weapon').length;
    check(weaponDrops === 0, 'SHOP', 'a weapon was still handed out on the floor');
    // a new wave clears the shelf so the next break rolls its own
    g.closeUpgrades();
    g.enemies.reset(); g.spawnQueue.length = 0;
    g.beginWave();
    check(g.shopStock.length === 0 && g.shopRerolls === 0, 'SHOP', 'the shop survived into the next wave');
    g.waveState = 'prep'; g.state = 'play';


    /* Controls in the real loop. The unit test proves the mapping; this
       proves a pad actually moves the marine through game.update(), and that
       the rebinding panel is wired to the same bindings the game reads. */
    g.state = 'play'; g.waveState = 'prep'; g.enemies.reset(); clearInput();
    const realPads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : null;
    let fakePads = [];
    navigator.getGamepads = () => fakePads;
    const padState = (buttons, axes) => [{ connected: true, index: 0,
      buttons: (buttons || []).map((v) => ({ pressed: !!v, value: v ? 1 : 0 })),
      axes: axes || [0, 0, 0, 0] }];
    try {
      // left stick drives movement through the same update path as the keys
      p.x = g.level.start.x; p.z = g.level.start.z; p.vx = 0; p.vz = 0;
      fakePads = padState([], [0, -1, 0, 0]);
      for (let i = 0; i < 6; i++) g.update(1/60);
      check(Math.hypot(p.vx, p.vz) > 1, 'CONTROLS', 'the left stick did not move the marine');
      const stickSpeed = Math.hypot(p.vx, p.vz);
      // and a stick barely off centre moves him slower than a full push
      p.vx = 0; p.vz = 0;
      fakePads = padState([], [0, -(A.PAD_DEADZONE + 0.05), 0, 0]);
      for (let i = 0; i < 6; i++) g.update(1/60);
      check(Math.hypot(p.vx, p.vz) < stickSpeed, 'CONTROLS', 'the stick is digital, not analogue');
      fakePads = padState([], [0, 0, 0, 0]);
      for (let i = 0; i < 4; i++) g.update(1/60);
      // the right stick aims
      fakePads = padState([], [0, 0, 1, 0]);
      g.update(1/60);
      check(g.aim.x > p.x + 1, 'CONTROLS', 'the right stick did not aim');
      fakePads = padState([], [0, 0, 0, 0]);
      // a pad button reaches its action inside a real tick
      p.dashCd = 0; p.dashTimer = 0;
      input.keys.KeyW = true;
      fakePads = padState([true], [0, 0, 0, 0]);
      g.update(1/60);
      check(p.dashTimer > 0, 'CONTROLS', 'the pad dash button did nothing');
      input.keys.KeyW = false;
      fakePads = [];
      g.update(1/60);
      check(!input.padActive, 'CONTROLS', 'the pad stayed active after unplugging');
    } finally {
      if (realPads) navigator.getGamepads = realPads; else delete navigator.getGamepads;
      fakePads = [];
      clearInput();
    }
    // the rebinding panel lists every action and drives the live bindings
    g.hud.renderBinds();
    check(document.querySelectorAll('#bindPanel [data-bind]').length === A.ACTIONS.length,
      'CONTROLS', 'the rebinding panel did not list every action');
    const beforeBind = input.binds.dash.slice();
    check(input.rebind('dash', ['KeyC']), 'CONTROLS', 'a rebind was refused');
    g.hud.renderBinds();
    p.dashCd = 0; p.dashTimer = 0;
    input.keys.KeyW = true; input.pressed.KeyC = true;
    g.update(1/60);
    check(p.dashTimer > 0, 'CONTROLS', 'the rebound key does not dash');
    p.dashCd = 0; p.dashTimer = 0;
    input.pressed.Space = true;
    g.update(1/60);
    check(p.dashTimer === 0, 'CONTROLS', 'the replaced key still dashes');
    input.keys.KeyW = false;
    input.rebind('dash', beforeBind);
    input.resetBinds();
    check(input.binds.dash.join() === A.defaultBinds().dash.join(), 'CONTROLS', 'reset did not restore defaults');
    clearInput();
    /* Menu navigation without a pointer. The unit test proves the spatial
       pick and the repeat; this proves every screen actually hands focus to
       something, that the highlight is the browser's own focus, and that a
       pad can buy, back out and be refused where it should be. */
    g.state = 'play'; g.waveState = 'prep'; clearInput();
    const navShow = (id) => document.getElementById(id).classList.add('show');
    const navHide = (id) => document.getElementById(id).classList.remove('show');
    const navHideAll = () => {
      for (const def of A.NAV_SCREENS) navHide(def.id);
      g.ui.update(1/60);
    };
    const navMoneyBefore = g.money;
    g.money = 5000;
    g.rollShop([]);
    g.hud.renderUpgrades();
    g.hud.renderStation();
    g.hud.renderBinds();
    g.perkOffer = [A.PERKS[0], A.PERKS[1], A.PERKS[2]];
    g.hud.renderPerks();
    navHideAll();

    // the keyboard builds its grid on demand; build it so the sweep below
    // sees the screen as a player would
    document.getElementById('custKeyboard').click();
    document.getElementById('oskDone').click();

    // every screen has to open on something a player can act on
    for (const navDef of A.NAV_SCREENS) {
      navShow(navDef.id);
      g.ui.update(1/60);
      const navAt = g.ui.focus;
      check(!!navAt, 'UINAV', navDef.id + ' opened with nothing focused');
      if (navAt) {
        check(document.getElementById(navDef.id).contains(navAt),
          'UINAV', navDef.id + ' focused something outside itself');
        check(document.activeElement === navAt,
          'UINAV', navDef.id + ' highlighted a button the browser had not focused');
        check(navAt.classList.contains('navHere'), 'UINAV', navDef.id + ' left the focus unmarked');
        check(!navAt.disabled, 'UINAV', navDef.id + ' opened on a disabled control');
      }
      navHide(navDef.id);
      g.ui.update(1/60);
    }
    check(g.ui.focus === null, 'UINAV', 'the focus outlived the last screen');
    check(!document.activeElement || document.activeElement === document.body ||
      !document.activeElement.closest('.screen'),
      'UINAV', 'a screen button kept browser focus into the run');

    // a held direction steps once, then waits before repeating
    navShow('start');
    g.ui.update(1/60);
    const navMenuFirst = g.ui.focus;
    input.keys.KeyD = true;
    g.ui.update(1/60);
    check(g.ui.focus !== navMenuFirst, 'UINAV', 'holding right did not move the focus');
    const navMenuSecond = g.ui.focus;
    g.ui.update(1/60);
    check(g.ui.focus === navMenuSecond, 'UINAV', 'a held direction repeated on the very next tick');
    input.keys.KeyD = false;
    g.ui.update(1/60);
    // and the row wraps, or the last button is a dead end on a pad
    let navWrapped = false;
    for (let i = 0; i < 8 && !navWrapped; i++) {
      input.keys.KeyD = true; g.ui.update(1/60);
      input.keys.KeyD = false; g.ui.update(1/60);
      navWrapped = g.ui.focus === navMenuFirst;
    }
    check(navWrapped, 'UINAV', 'the menu row never wrapped back to the first button');
    navHideAll();

    // the left stick steers a menu as well as the marine
    const navRealPads = navigator.getGamepads ? navigator.getGamepads.bind(navigator) : null;
    let navFakePads = [];
    navigator.getGamepads = () => navFakePads;
    try {
      navShow('pause');
      g.ui.update(1/60);
      const navStickFrom = g.ui.focus;
      navFakePads = [{ connected: true, index: 0, buttons: [], axes: [0, 1, 0, 0] }];
      input.pollPad();
      g.ui.update(1/60);
      check(g.ui.focus !== navStickFrom, 'UINAV', 'the left stick did not move the menu focus');
      // a stick resting inside its deadzone must not walk the menu on its own
      navFakePads = [{ connected: true, index: 0, buttons: [], axes: [0, 0, 0, 0] }];
      input.pollPad();
      const navRest = g.ui.focus;
      for (let i = 0; i < 30; i++) g.ui.update(1/60);
      check(g.ui.focus === navRest, 'UINAV', 'a centred stick drifted through the menu');
      // the d-pad reaches the same actions
      const navDpadFrom = g.ui.focus;
      navFakePads = [{ connected: true, index: 0, buttons: [], axes: [0, 0, 0, 0] }];
      navFakePads[0].buttons = [];
      for (let i = 0; i < 16; i++) navFakePads[0].buttons.push({ pressed: i === 13, value: i === 13 ? 1 : 0 });
      input.pollPad();
      g.ui.update(1/60);
      check(g.ui.focus !== navDpadFrom, 'UINAV', 'the d-pad did not move the menu focus');
      navFakePads = [];
      input.pollPad();
    } finally {
      if (navRealPads) navigator.getGamepads = navRealPads; else delete navigator.getGamepads;
      navFakePads = [];
      navHideAll();
      clearInput();
    }

    // left and right adjust a slider instead of walking off it
    navShow('pause');
    g.ui.update(1/60);
    const navVolume = document.getElementById('volumeSetting');
    g.ui.setFocus(navVolume, 0);
    const navVolumeBefore = navVolume.value;
    // start away from either end, or a slider already at 0 could not move left
    navVolume.value = '50';
    input.keys.KeyA = true;
    g.ui.update(1/60);
    input.keys.KeyA = false;
    check(navVolume.value !== '50', 'UINAV', 'left did not move the volume slider');
    check(g.ui.focus === navVolume, 'UINAV', 'adjusting the slider moved the focus off it');
    navVolume.value = navVolumeBefore;
    navVolume.dispatchEvent(new Event('input', { bubbles: true }));
    // and navigation stands still while a rebinding row waits for a key
    g.ui.update(1/60);
    const navArmedAt = g.ui.focus;
    g.ui.suspended = true;
    input.keys.KeyS = true;
    g.ui.update(1/60); g.ui.update(1/60);
    check(g.ui.focus === navArmedAt, 'UINAV', 'navigation moved while a rebinding row was armed');
    g.ui.suspended = false;
    input.keys.KeyS = false;
    navHideAll();
    clearInput();

    // the pad backs out of the shop and buys with the same two buttons
    check(g.openUpgrades(), 'UINAV', 'the shop refused to open for the navigation check');
    g.ui.update(1/60);
    const navShopAt = g.ui.focus;
    check(navShopAt && document.getElementById('upgradeScreen').contains(navShopAt),
      'UINAV', 'the shop opened without focusing anything of its own');
    // the focus has to survive the grid being rebuilt under it
    const navSlot = document.querySelector('#upgradeGrid [data-slot]:not([disabled])');
    if (navSlot) {
      g.ui.setFocus(navSlot, 0);
      const navSlotKey = A.navKey(navSlot);
      g.hud.renderUpgrades();
      g.ui.update(1/60);
      check(g.ui.focus !== navSlot, 'UINAV', 'the shop grid did not actually rebuild');
      check(g.ui.focus && A.navKey(g.ui.focus) === navSlotKey,
        'UINAV', 'the focus did not survive the shop rebuild');
    }
    input.padPressed[1] = true;
    g.ui.update(1/60);
    check(g.state !== 'upgrade', 'UINAV', 'the pad B button did not close the shop');
    navHideAll();
    clearInput();

    // the doctrine pick has no way out, and A takes the focused card
    g.state = 'perk';
    g.perkOffer = [A.PERKS[0], A.PERKS[1], A.PERKS[2]];
    g.hud.renderPerks();
    navShow('perkScreen');
    g.ui.update(1/60);
    input.padPressed[1] = true;
    g.ui.update(1/60);
    check(document.getElementById('perkScreen').classList.contains('show'),
      'UINAV', 'the doctrine screen was backed out of');
    const navPerksBefore = Object.keys(g.perks).length;
    input.padPressed[0] = true;
    g.ui.update(1/60);
    check(Object.keys(g.perks).length > navPerksBefore,
      'UINAV', 'the pad A button did not take the focused card');
    if (g.state === 'upgrade') g.closeUpgrades();
    navHideAll();
    g.money = navMoneyBefore;
    g.state = 'play';
    clearInput();
    /* The editor and its on-screen keyboard: the last screen that needed a
       mouse. The unit test proves the alphabet and the limit; this proves the
       pad reaches the field at all and that leaving the keyboard does not
       take the editor down with it. */
    const navCust = A.customizer;
    check(!!navCust, 'UINAV', 'the editor is unavailable: ' + A.customizerError);
    if (navCust) {
      const navField = document.getElementById('custNickname');
      const navSavedName = navField.value;
      navCust.show();
      try {
        g.ui.update(1/60);
        check(g.ui.focus && document.getElementById('custScreen').contains(g.ui.focus),
          'UINAV', 'the editor opened with nothing focused');
        const navEditorAt = g.ui.focus;
        input.keys.KeyS = true;
        g.ui.update(1/60);
        input.keys.KeyS = false;
        check(g.ui.focus !== navEditorAt, 'UINAV', 'the editor focus did not move');

        // the keyboard opens over the editor and takes navigation with it
        document.getElementById('custKeyboard').click();
        g.ui.update(1/60);
        check(document.getElementById('oskScreen').contains(g.ui.focus),
          'UINAV', 'the keyboard did not take the focus from the editor');

        navField.value = '';
        navField.dispatchEvent(new Event('input', { bubbles: true }));
        const navKeyBtn = document.querySelector('#oskKeys [data-key]');
        check(!!navKeyBtn, 'UINAV', 'the keyboard rendered no keys');
        g.ui.setFocus(navKeyBtn, 0);
        input.padPressed[0] = true;
        g.ui.update(1/60);
        check(navField.value === navKeyBtn.dataset.key, 'UINAV',
          'the pad typed ' + JSON.stringify(navField.value) + ' instead of ' + JSON.stringify(navKeyBtn.dataset.key));
        check(A.sanitizeNickname(navField.value) === navField.value,
          'UINAV', 'the keyboard typed a character the profile strips');
        document.getElementById('oskBack').click();
        check(navField.value === '', 'UINAV', 'delete did not remove the last character');

        // the layout toggle swaps the alphabet rather than redrawing the same one
        const navRuKey = document.querySelector('#oskKeys [data-key]').dataset.key;
        document.getElementById('oskLayout').click();
        const navEnKey = document.querySelector('#oskKeys [data-key]').dataset.key;
        check(navEnKey !== navRuKey, 'UINAV', 'the layout toggle changed nothing');
        document.getElementById('oskLayout').click();

        // the keyboard stops where the profile truncates
        for (let i = 0; i < A.NICKNAME_MAX + 4; i++) {
          document.querySelector('#oskKeys [data-key]').click();
        }
        check(Array.from(navField.value).length === A.NICKNAME_MAX, 'UINAV',
          'the keyboard typed ' + Array.from(navField.value).length + ' characters against a limit of ' + A.NICKNAME_MAX);
        document.getElementById('oskClear').click();
        check(navField.value === '', 'UINAV', 'clear did not empty the field');

        // B leaves the keyboard only, and navigation returns to the editor
        input.padPressed[1] = true;
        g.ui.update(1/60);
        check(!document.getElementById('oskScreen').classList.contains('show'),
          'UINAV', 'the pad B button did not close the keyboard');
        check(navCust._running, 'UINAV', 'closing the keyboard closed the editor as well');
        g.ui.update(1/60);
        check(document.getElementById('custScreen').contains(g.ui.focus),
          'UINAV', 'closing the keyboard did not hand focus back to the editor');
      } finally {
        navField.value = navSavedName;
        navField.dispatchEvent(new Event('input', { bubbles: true }));
        navCust.commit();
        navCust.hide();
        g.ui.update(1/60);
        clearInput();
      }
      check(A.loadLook().nickname === navSavedName, 'UINAV', 'the editor lost the saved callsign');
      check(!navCust._running, 'UINAV', 'the editor stayed open after the check');
    }

    /* The finale, driven directly. A 420-frame run never reaches wave twelve,
       so the fight is set up here: the wave is asked who it leads with through
       the real beginWave(), and the phases are then walked in the real update
       loop, where the shield, the eruption and the HUD all have to agree. */
    g.enemies.reset(); clearInput();
    g.hazards.clear();
    g.state = 'play';
    g.endless = false;
    g.sectorPending = false;
    g.wave = A.RUN_FINAL_WAVE - 1;
    g.waveState = 'prep';
    g.beginWave();
    check(g.isFinalWave(g.wave), 'FINALE', 'wave ' + g.wave + ' is not the final wave');
    check(g.spawnQueue[0] === 'overmind', 'FINALE',
      'the final wave leads with ' + g.spawnQueue[0] + ', not the Overmind');
    // the escort is not the subject here
    g.spawnQueue = [];
    g.waveState = 'prep'; g.prepTimer = 999;
    g.enemies.reset();

    // winning here banks a run, and the block that checks run accounting
    // further down counts from zero; put the counters back afterwards
    /* Samples are spendable and can be put back. The run counter only ever
       climbs — set() merges it with Math.max — so winning here is permanent,
       and the block that checks run accounting counts relative to whatever it
       finds rather than assuming a zero. */
    const finSamplesBefore = A.store.get('samples', '0');
    const finTable = A.ENEMY_BY_ID.overmind;
    const finBoss = g.enemies.spawn('overmind', p.x + 7, p.z, g.waveScale());
    check(!!finBoss, 'FINALE', 'the Overmind could not be spawned');
    if (finBoss) {
      g.activeBoss = finBoss;
      // the player is not the subject either: keep them up so the fight runs
      const finDrive = (ticks) => {
        for (let i = 0; i < ticks; i++) { p.hp = p.maxHp; g.update(1/60); }
      };
      check(finBoss.def !== finTable, 'FINALE', 'the boss shares the type table it rewrites');
      check(finBoss.bossPhase === 0 && finBoss.def.ranged === false,
        'FINALE', 'the fight did not start in its first phase');
      check(finBoss.maxHp > A.ENEMY_BY_ID.queen.hp, 'FINALE', 'the finale spawned under sector-boss health');
      finDrive(4);

      // second phase: the swarm, and the arena losing floor
      const finHazardsBefore = g.hazards.count;
      finBoss.hp = finBoss.maxHp * 0.6;
      finDrive(6);
      check(finBoss.bossPhase === 1, 'FINALE', 'the boss did not enter its second phase');
      check(finBoss.shield > 0, 'FINALE', 'the transition did not shield the boss');
      check(g.hazards.count > finHazardsBefore, 'FINALE', 'the transition erupted no hazards');
      check(finBoss.def.spawnsAdds === true, 'FINALE', 'the swarm phase does not swarm');
      // a shielded boss keeps its health no matter what lands on it
      const finShieldedHp = finBoss.hp;
      g.enemies.damage(finBoss, 4000, 0, 1, 0, 0);
      check(finBoss.hp === finShieldedHp, 'FINALE', 'a reforming boss lost health');
      g.hud.update(1/60, g);
      check(document.getElementById('bossName').textContent.indexOf('ФАЗА') >= 0,
        'FINALE', 'the boss bar does not name the phase');
      check(document.getElementById('bossWrap').classList.contains('shielded'),
        'FINALE', 'the bar does not show that the boss cannot be hurt');
      // the shield is a window, not a state: it has to run out
      finDrive(140);
      check(finBoss.shield === 0, 'FINALE', 'the shield never expired');
      g.enemies.damage(finBoss, 50, 0, 1, 0, 0);
      check(finBoss.hp < finShieldedHp, 'FINALE', 'the boss stayed immune after reforming');

      // a hazard hurts whoever stands in it, through the same update loop
      g.hazards.clear();
      g.hazards.spawn(p.x, p.z, 4.5, 14, 6);
      p.hp = p.maxHp;
      const finHpBefore = p.hp;
      p.invuln = 0;
      for (let i = 0; i < 90; i++) g.update(1/60);
      check(p.hp < finHpBefore, 'FINALE', 'standing in an erupted vent cost nothing');

      // third phase: the adds stop and the core comes out
      finBoss.hp = finBoss.maxHp * 0.3;
      finDrive(6);
      check(finBoss.bossPhase === 2, 'FINALE', 'the boss did not enter its last phase');
      check(finBoss.def.spawnsAdds === false, 'FINALE', 'the last phase still calls reinforcements');
      check(finBoss.def.speed > finTable.phases[0].speed, 'FINALE', 'the last phase is not faster');
      check(A.nextBossPhase(finBoss) === -1, 'FINALE', 'the boss wanted a fourth phase');

      /* Killing it on the final wave ends the run. This is the whole point of
         the encounter existing, so it is asserted through endWave(), not by
         calling onRunComplete() directly. */
      g.waveState = 'active';
      g.spawnQueue = [];
      finBoss.shield = 0;
      g.enemies.list = g.enemies.list.filter((e) => e === finBoss);
      g.enemies.damage(finBoss, finBoss.maxHp * 3, 0, 1, 0, 0);
      check(finBoss.hp <= 0, 'FINALE', 'the Overmind survived three times its health');
      let finGuard = 0;
      while (g.state === 'play' && finGuard++ < 400) { p.hp = p.maxHp; g.update(1/60); }
      check(g.state === 'victory', 'FINALE', 'killing the Overmind left the run in ' + g.state);

      /* The mutation that would poison the rest of the session: phase overrides
         must have landed on the copy, never on the shared table. */
      check(finTable.ranged === false, 'FINALE', 'the shared type kept ranged attacks on');
      check(finTable.spawnsAdds === false, 'FINALE', 'the shared type was left spawning adds');
      check(finTable.speed === finTable.phases[0].speed, 'FINALE', 'the shared type kept a later phase speed');
      check(finTable.special === 'seismic', 'FINALE', 'the shared type kept a later phase attack');

      if (g.state === 'victory') g.continueEndless();
    }
    /* The run stays endless from here on: no later block can then trip the
       finale again by clearing a wave numbered twelve. */
    g.endless = true;
    A.store.set('samples', finSamplesBefore);
    g.activeBoss = null;
    g.hazards.clear();
    g.enemies.reset();
    g.state = 'play'; g.waveState = 'prep'; g.prepTimer = 999;
    p.hp = p.maxHp;
    clearInput();

    /* Damage readouts. They are cosmetic, so the checks are that they appear,
       say a number, are reachable from the settings and vanish when switched
       off — including the ones already on screen. */
    g.state = 'play'; g.waveState = 'prep'; g.prepTimer = 999;
    g.enemies.reset(); clearInput();
    const dnCritScale = p.critScale;
    p.critScale = 0;
    g.damageNumbers.enabled = true;
    g.damageNumbers.clear();
    const dnTarget = g.spawnEnemyAt('grunt', p.x + 4, p.z);
    check(!!dnTarget, 'DMGNUM', 'nothing to shoot for the readout check');
    if (dnTarget) {
      dnTarget.hp = dnTarget.maxHp = 100000;
      p.dealDamage(dnTarget, 42, 0, 1, 0, 0, A.WEAPON_BY_ID.rifle);
      check(g.damageNumbers.list.length === 1, 'DMGNUM', 'a hit produced no readout');
      check(g.damageNumbers.list[0].amount === 42, 'DMGNUM',
        'the readout says ' + g.damageNumbers.list[0].amount + ' for a hit of 42');
      const dnNodes = document.querySelectorAll('#dmgLayer .dmgNum');
      check(dnNodes.length === A.DAMAGE_NUMBER_CAP, 'DMGNUM', 'the readout pool was not built');
      g.render(1);
      check(dnNodes[0].style.display === 'block', 'DMGNUM', 'the readout was never drawn');
      check(dnNodes[0].textContent === '42', 'DMGNUM',
        'the readout drew ' + JSON.stringify(dnNodes[0].textContent));
      // a second hit climbs the same number rather than opening another
      p.dealDamage(dnTarget, 8, 0, 1, 0, 0, A.WEAPON_BY_ID.rifle);
      check(g.damageNumbers.list.length === 1 && g.damageNumbers.list[0].amount === 50,
        'DMGNUM', 'a second hit did not climb the number already up');
      // a crit is marked and styled apart
      p.critScale = 1000;
      g.damageNumbers.clear();
      p.dealDamage(dnTarget, 30, 0, 1, 0, 0, A.WEAPON_BY_ID.railgun);
      check(g.damageNumbers.list.length === 1 && g.damageNumbers.list[0].crit,
        'DMGNUM', 'a crit produced no marked readout');
      g.render(1);
      check(document.querySelector('#dmgLayer .dmgNum.crit') !== null,
        'DMGNUM', 'a crit readout is not drawn as one');
      p.critScale = 0;

      // the setting reaches both the readout and the profile
      const dnToggle = document.getElementById('dmgnumSetting');
      dnToggle.checked = false;
      dnToggle.dispatchEvent(new Event('change', { bubbles: true }));
      check(g.damageNumbers.enabled === false, 'DMGNUM', 'the setting did not reach the readout');
      check(A.store.get('dmgnum', '1') === '0', 'DMGNUM', 'the setting did not reach the profile');
      g.render(1);
      check(dnNodes[0].style.display === 'none', 'DMGNUM', 'switching off left numbers on screen');
      p.dealDamage(dnTarget, 25, 0, 1, 0, 0, A.WEAPON_BY_ID.rifle);
      check(g.damageNumbers.list.length === 0, 'DMGNUM', 'a disabled readout still recorded a hit');
      dnToggle.checked = true;
      dnToggle.dispatchEvent(new Event('change', { bubbles: true }));
      check(g.damageNumbers.enabled === true, 'DMGNUM', 'the setting could not be turned back on');
      check(A.store.get('dmgnum', '0') === '1', 'DMGNUM', 'turning it back on did not reach the profile');
    }
    p.critScale = dnCritScale;
    g.damageNumbers.clear();
    g.enemies.reset();
    clearInput();

    /* Weapon portraits. The point of the card is that the player sees the gun
       they are buying, so the checks are that a picture exists, that it is
       really on the card, and that two different weapons do not render the
       same one — which is what a silently blank renderer would produce. */
    check(A.weaponPortraits.get('rifle') !== null, 'SHOP', 'weapon portraits could not be rendered');
    check(!A.weaponPortraits.failed, 'SHOP', 'the portrait renderer gave up');
    const shotIds = Object.keys(A.weaponPortraits.cache);
    check(shotIds.length === A.WEAPONS.length, 'SHOP',
      'portraits exist for ' + shotIds.length + ' of ' + A.WEAPONS.length + ' weapons');
    for (const shotId of shotIds) {
      check(A.weaponPortraits.cache[shotId].indexOf('data:image/png') === 0,
        'SHOP', shotId + ' has no portrait image');
    }
    const shotSeen = {};
    let shotDuplicate = '';
    for (const shotId of shotIds) {
      const image = A.weaponPortraits.cache[shotId];
      if (shotSeen[image]) shotDuplicate = shotSeen[image] + ' and ' + shotId;
      shotSeen[image] = shotId;
    }
    check(shotDuplicate === '', 'SHOP', 'the same portrait was rendered for ' + shotDuplicate);

    // and the card actually carries it
    const shotMoney = g.money;
    g.money = 9000;
    g.rollShop([]);
    g.shopStock[0] = { kind: 'weapon', id: 'railgun', price: 100, locked: false, sold: false };
    g.hud.renderUpgrades();
    const shotImg = document.querySelector('#upgradeGrid .gunShot img');
    check(!!shotImg, 'SHOP', 'a weapon card showed no portrait');
    if (shotImg) {
      check(shotImg.getAttribute('src') === A.weaponPortraits.cache.railgun,
        'SHOP', 'the card showed a portrait of the wrong weapon');
    }
    // an upgrade card is not a weapon and keeps its glyph
    g.shopStock[0] = { kind: 'upgrade', id: g.shopStock[1] && g.shopStock[1].kind === 'upgrade' ? g.shopStock[1].id : 'damage',
      price: 100, locked: false, sold: false };
    g.hud.renderUpgrades();
    check(document.querySelectorAll('#upgradeGrid .upgradeIcon').length > 0,
      'SHOP', 'an upgrade card lost its icon');
    g.money = shotMoney;

    /* Elite ranks in the real game: they have to survive a render, a rank
       must not stack onto a boss, and a splitter must not be able to fill
       the arena with copies of itself. */
    g.enemies.reset(); clearInput();
    g.wave = 12; g.state = 'play'; g.waveState = 'active';
    check(A.eliteChance(g.wave) > 0, 'ELITE', 'no elites are possible at wave 12');
    let eliteSeen = 0;
    for (let i = 0; i < 80; i++) {
      const e = g.spawnEnemyAt('grunt', p.x + 6 + (i % 7), p.z + (i % 5) - 2);
      if (e && e.elite) eliteSeen++;
    }
    check(eliteSeen > 0, 'ELITE', 'no elite appeared in 80 spawns at wave 12');
    // an elite is worth more than the alien it rides
    const eliteOne = g.enemies.list.find((e) => e.elite);
    check(eliteOne.worth > eliteOne.def.score, 'ELITE', 'an elite paid an ordinary reward');
    // rendering a mixed crowd must not throw or produce nonsense transforms
    g.enemies.update(1/60, p);
    g.fx.blobs.begin(); g.enemies.render(g.fx.blobs, 0.5); g.fx.blobs.end();
    g.render(); finiteScene('elite crowd');
    // a boss never carries a rank, even on a wave where elites are common
    g.enemies.reset();
    for (const id of ['queen', 'siege', 'warden']) {
      const boss = g.spawnEnemyAt(id, p.x + 9, p.z);
      check(boss && boss.elite === null, 'ELITE', id + ' was given an elite rank');
    }
    // a splitter leaves plain children behind, never more splitters
    g.enemies.reset();
    const host = g.spawnEnemyAt('grunt', p.x + 5, p.z);
    host.elite = A.ELITE_BY_ID.splitter;
    const beforeSplit = g.enemies.list.length;
    g.enemies.kill(host, 1, 0, 9999);
    const children = g.enemies.list.slice(beforeSplit);
    check(children.length === 2, 'ELITE', 'a splitter did not leave two children');
    check(children.every((c) => c.elite === null), 'ELITE', 'a splitter seeded more elites');
    check(g.enemies.eliteRanks === true, 'ELITE', 'rank suppression leaked past the split');
    // a volatile one detonates, and the blast is a real explosion in the world
    g.enemies.reset();
    const bomb = g.spawnEnemyAt('grunt', p.x + 12, p.z);
    bomb.elite = A.ELITE_BY_ID.volatile;
    p.invuln = 99;
    g.enemies.kill(bomb, 1, 0, 9999);
    g.update(1/60); g.render(); finiteScene('elite detonation');
    p.invuln = 0;
    g.enemies.reset(); g.waveState = 'prep'; g.state = 'play';
    /* The harness cap is what gives a purchase weight: it has to actually
       block a buy, the sidearm has to stay unloseable, and selling has to be
       a loss rather than an income. */
    g.state = 'upgrade'; g.waveState = 'prep';
    for (const unlock of A.WEAPON_UNLOCK) delete p.owned[unlock.id];
    p.owned.pistol = true; p.setWeapon(0);
    check(p.carriedList().length === 0, 'ARSENAL', 'the sidearm took a harness slot');
    check(!p.arsenalFull(), 'ARSENAL', 'an empty harness reported itself full');
    const fillers = A.WEAPON_UNLOCK.slice(0, A.ARSENAL_SLOTS).map((u) => u.id);
    for (const id of fillers) p.giveWeapon(id);
    check(p.carriedList().length === A.ARSENAL_SLOTS, 'ARSENAL', 'carried weapons were miscounted');
    check(p.arsenalFull(), 'ARSENAL', 'a full harness did not report itself full');
    // a full harness blocks the purchase before it charges
    const spare = A.WEAPON_UNLOCK.find((u) => fillers.indexOf(u.id) < 0);
    g.shopStock = [{ kind: 'weapon', id: spare.id, price: A.WEAPON_BY_ID[spare.id].price, locked: false, sold: false },
      null, null, null];
    g.money = 100000;
    const richBefore = g.money;
    check(!g.buySlot(0), 'ARSENAL', 'a weapon was bought with no slot free');
    check(g.money === richBefore, 'ARSENAL', 'a blocked purchase still charged');
    check(!p.owned[spare.id], 'ARSENAL', 'a blocked purchase still delivered');
    g.hud.renderUpgrades();
    check(document.querySelectorAll('#shopArsenal [data-sell]').length === A.ARSENAL_SLOTS,
      'ARSENAL', 'the shop did not list the carried weapons');
    // selling frees the slot and refunds a fraction, never the full price
    const sold = fillers[0];
    const price = A.WEAPON_BY_ID[sold].price;
    const refundValue = Math.floor(price * A.WEAPON_SELL_RATIO);
    check(refundValue > 0 && refundValue < price, 'ARSENAL', 'selling is not a loss');
    p.setWeapon(A.WEAPONS.findIndex((w) => w.id === sold));
    const beforeSale = g.money;
    check(g.sellWeapon(sold), 'ARSENAL', 'a carried weapon could not be sold');
    check(g.money === beforeSale + refundValue, 'ARSENAL', 'the refund was wrong');
    check(!p.owned[sold], 'ARSENAL', 'the sold weapon stayed in the harness');
    check(p.weapon.id === 'pistol', 'ARSENAL', 'selling the held weapon left nothing in hand');
    check(!p.arsenalFull(), 'ARSENAL', 'selling did not free a slot');
    check(!g.sellWeapon(sold), 'ARSENAL', 'a weapon was sold twice');
    // the sidearm is not for sale at any price
    check(!g.sellWeapon('pistol') && p.owned.pistol, 'ARSENAL', 'the sidearm was sold');
    check(!p.dropWeapon('pistol') && p.owned.pistol, 'ARSENAL', 'the sidearm could be dropped');
    check(!g.sellWeapon('no-such-weapon'), 'ARSENAL', 'an unknown weapon was sold');
    // and now the purchase goes through into the freed slot
    check(g.buySlot(0) && p.owned[spare.id], 'ARSENAL', 'the freed slot did not accept a purchase');
    check(p.carriedList().length === A.ARSENAL_SLOTS, 'ARSENAL', 'buying overfilled the harness');
    // selling is only a counter transaction
    g.closeUpgrades();
    check(!g.sellWeapon(spare.id) && p.owned[spare.id], 'ARSENAL', 'a weapon was sold outside the shop');
    g.state = 'upgrade';
    g.waveState = 'active';
    check(!g.sellWeapon(spare.id), 'ARSENAL', 'a weapon was sold mid-wave');
    g.waveState = 'prep'; g.state = 'play';
    /* A run that ends. The structure is the deliverable here: the last wave
       has to be reachable, clearing it has to stop the run, and the win has
       to pay out exactly once even when endless mode later ends in death. */
    const victoryScreen = document.getElementById('victory');
    A.store.set('samples', 0); A.store.set('meta', {});
    // the counter climbs and cannot be reset, so the win is counted relatively
    const finaleRunsBefore = parseInt(A.store.get('runs', '0'), 10) || 0;
    g.startRun(); clearInput();
    check(!g.endless, 'FINALE', 'a fresh run started in endless mode');
    check(g.isFinalWave(A.RUN_FINAL_WAVE), 'FINALE', 'the final wave is not final');
    check(!g.isFinalWave(A.RUN_FINAL_WAVE - 1), 'FINALE', 'an ordinary wave was treated as the finale');
    check(A.RUN_FINAL_WAVE % A.WAVES_PER_SECTOR === 0, 'FINALE', 'the run does not end on a boss wave');
    check(g.runProgressText().indexOf(String(A.RUN_FINAL_WAVE)) >= 0, 'FINALE', 'run progress does not show its length');
    // the finale schedules the boss and is harder than the same boss earlier
    g.wave = A.RUN_FINAL_WAVE - 1; g.sectorPending = false; g.enemies.reset();
    g.beginWave();
    check(g.wave === A.RUN_FINAL_WAVE && g.spawnQueue[0] === 'overmind', 'FINALE', 'the finale did not schedule the final boss');
    const apexHp = g.waveScale().hp;
    g.endless = true;
    check(apexHp > g.waveScale().hp, 'FINALE', 'the finale is no harder than an ordinary wave');
    g.endless = false;
    // clearing it ends the run instead of starting wave 13
    g.sampleYield = 400; g.stats.shots = 10; g.stats.hits = 5;
    g.spawnQueue.length = 0; g.enemies.reset();
    const wonAt = g.wave;
    g.endWave();
    check(g.state === 'victory' && victoryScreen.classList.contains('show'), 'FINALE', 'clearing the last wave did not end the run');
    check(g.wave === wonAt, 'FINALE', 'the run continued past its own finale');
    const bankedOnWin = parseInt(A.store.get('samples', '0'), 10) || 0;
    check(bankedOnWin > 0, 'FINALE', 'winning banked nothing');
    check((parseInt(A.store.get('runs', '0'), 10) || 0) === finaleRunsBefore + 1, 'FINALE', 'the won run was not counted');
    check(document.getElementById('winSamples').textContent.indexOf('+') === 0, 'FINALE', 'the victory screen showed no reward');
    check(document.getElementById('winTime').textContent.indexOf(':') > 0, 'FINALE', 'the victory screen showed no time');
    // endless continues the same run rather than starting a new one
    check(g.continueEndless() && g.endless && g.state === 'play', 'FINALE', 'endless mode did not start');
    check(!victoryScreen.classList.contains('show'), 'FINALE', 'the victory screen stayed up');
    check(!g.continueEndless(), 'FINALE', 'endless mode was entered twice');
    check(!g.isFinalWave(A.RUN_FINAL_WAVE), 'FINALE', 'endless mode still treats wave 12 as the finale');
    check(g.runProgressText().indexOf('/') < 0, 'FINALE', 'endless mode still advertises a run length');
    g.spawnQueue.length = 0; g.enemies.reset(); g.endWave();
    check(g.state !== 'victory', 'FINALE', 'endless mode ended the run again');
    if (g.state === 'perk') g.choosePerk(g.perkOffer[0].id);
    if (g.state === 'upgrade') g.closeUpgrades();
    // dying after a win pays the difference and does not count a second run
    g.sampleYield += 200;
    const heldBeforeDeath = parseInt(A.store.get('samples', '0'), 10) || 0;
    const expected = g.earnedSamples() - bankedOnWin;
    g.player.invuln = 0; g.player.takeDamage(99999, g.player.x, g.player.z);
    check(g.state === 'dead', 'FINALE', 'the endless run did not end in death');
    check((parseInt(A.store.get('samples', '0'), 10) || 0) === heldBeforeDeath + expected,
      'FINALE', 'death after a win paid out the already-banked samples again');
    check((parseInt(A.store.get('runs', '0'), 10) || 0) === finaleRunsBefore + 1, 'FINALE', 'one run was counted twice');
    check(!victoryScreen.classList.contains('show'), 'FINALE', 'death left the victory screen up');
    // and a new run drops all of it
    g.startRun(); clearInput();
    check(!g.endless && g.bankedSamples === 0 && !g.runCounted, 'FINALE', 'a new run inherited the previous outcome');
    A.store.set('samples', 0);
    /* Meta-progression. The whole point is that a lost run leaves something
       behind, so the checks are about the currency surviving and about the
       station refusing to hand out what has not been paid for. */
    const stationScreen = document.getElementById('stationScreen');
    A.store.set('samples', 0); A.store.set('meta', {});
    g.startRun(); clearInput();
    check(g.earnedSamples() === 0, 'META', 'a fresh run started with banked samples');
    g.sampleYield = 0; g.sampleRate = 1;
    const crawler = g.spawnEnemyAt('crawler', p.x + 4, p.z);
    check(!!crawler, 'META', 'could not spawn a sample source');
    g.enemies.damage(crawler, 1e9, 1, 0, 0, 0);
    check(g.earnedSamples() > 0, 'META', 'a kill yielded no samples');
    const oneKill = g.earnedSamples();
    g.sampleRate = 2;
    check(g.earnedSamples() === oneKill * 2, 'META', 'the harvest rate did not scale the yield');
    g.sampleRate = 1;
    // banking is what makes the currency meta rather than run-local
    const runsBefore = parseInt(A.store.get('runs', '0'), 10) || 0;
    const banked = g.bankRun();
    check(banked === oneKill, 'META', 'banking reported a different amount than it earned');
    check((parseInt(A.store.get('samples', '0'), 10) || 0) === banked, 'META', 'samples did not reach the profile');
    check((parseInt(A.store.get('runs', '0'), 10) || 0) === runsBefore + 1, 'META', 'the run counter did not advance');
    // the station only trades while the run is over
    const def = A.META_UPGRADES[0];
    A.store.set('samples', def.cost);
    g.state = 'play';
    check(!g.buyStationUpgrade(def.id), 'META', 'a station upgrade was bought mid-run');
    g.state = 'menu';
    check(!g.buyStationUpgrade('no-such-upgrade'), 'META', 'an unknown station upgrade was accepted');
    A.store.set('samples', def.cost - 1);
    check(!g.buyStationUpgrade(def.id), 'META', 'an unaffordable upgrade was sold');
    check((g.stationRanks()[def.id] || 0) === 0, 'META', 'a refused purchase still granted a rank');
    A.store.set('samples', def.cost + 5);
    check(g.buyStationUpgrade(def.id), 'META', 'an affordable upgrade was refused');
    check(g.stationRanks()[def.id] === 1, 'META', 'the purchased rank was not stored');
    check((parseInt(A.store.get('samples', '0'), 10) || 0) === 5, 'META', 'the purchase charged the wrong price');
    // ranks stop at the cap and the price climbs on the way there
    A.store.set('samples', 1000000);
    for (let rank = 1; rank < def.max; rank++) {
      const held = parseInt(A.store.get('samples', '0'), 10) || 0;
      check(g.buyStationUpgrade(def.id), 'META', 'could not buy rank ' + (rank + 1));
      check((parseInt(A.store.get('samples', '0'), 10) || 0) === held - A.metaCost(def, rank),
        'META', 'rank ' + (rank + 1) + ' was charged the wrong price');
    }
    check(!g.buyStationUpgrade(def.id), 'META', 'a capped upgrade was sold again');
    check(g.stationRanks()[def.id] === def.max, 'META', 'the cap was exceeded');
    // and the ranks actually change the next deployment
    A.store.set('meta', {}); g.startRun();
    const plainHp = p.maxHp, plainMoney = g.money, plainWeapons = p.ownedList().length;
    A.store.set('meta', { reserves: 5, stipend: 4, sidearm: 3 });
    g.startRun(); clearInput();
    check(p.maxHp > plainHp, 'META', 'station reserves did not raise starting health');
    check(g.money > plainMoney, 'META', 'the operating fund did not raise starting credits');
    check(p.ownedList().length > plainWeapons, 'META', 'the personal arsenal granted no extra weapon');
    check(p.hp === p.maxHp, 'META', 'a run started below its own maximum health');
    // the doctrine archive widens the offer instead of being cosmetic
    A.store.set('meta', { doctrine: 1 }); g.startRun(); clearInput();
    g.waveState = 'prep'; g.state = 'play'; g.perks = {}; g.perkOffer = [];
    check(g.offerPerks() && g.perkOffer.length === 4, 'META', 'the doctrine archive did not widen the offer');
    g.choosePerk(g.perkOffer[0].id);
    // the station screen renders every upgrade and reports the balance
    g.state = 'menu';
    g.hud.renderStation();
    check(document.querySelectorAll('#stationGrid [data-station]').length === A.META_UPGRADES.length,
      'META', 'the station did not render every upgrade');
    check(document.getElementById('stationSamples').textContent.length > 0, 'META', 'the station showed no balance');
    // a tampered profile cannot smuggle in content that does not exist
    A.store.set('meta', { reserves: 99, ghostUpgrade: 4 });
    const clamped = g.stationRanks();
    check(clamped.reserves === A.META_BY_ID.reserves.max, 'META', 'a tampered rank was not clamped');
    check(clamped.ghostUpgrade === undefined, 'META', 'an unknown upgrade survived into the run');
    A.store.set('meta', {}); A.store.set('samples', 0);
    g.startRun(); clearInput();
    /* The restarts above wiped what the requisition block bought, and the
       sector-transition check below is only meaningful if there is something
       non-default left to preserve. Put distinctive values back explicitly
       rather than letting that check quietly assert defaults survive. */
    p.damageMultiplier = 1.6; p.reloadMultiplier = Math.pow(0.88, 3);
    p.maxHp = 200; p.hp = 150; p.maxArmor = 200; p.armor = 90;
    p.giveWeapon('railgun'); p.giveAmmo('slug', 40);
    g.money = 4321; g.upgrades = { damage: 4, reload: 3 };
    /* Doctrine screen. It is mandatory, so everything about it is load
       bearing: if it can be entered and not left, the run is unplayable. */
    const perkScreen = document.getElementById('perkScreen');
    g.perks = {}; g.perkOffer = []; g.state = 'play';
    check(!g.choosePerk('overcharge'), 'PERK', 'a perk was taken outside the doctrine screen');
    check(g.offerPerks() && g.state === 'perk' && perkScreen.classList.contains('show'),
      'PERK', 'doctrine screen did not open');
    check(g.perkOffer.length === 3 && new Set(g.perkOffer.map((x) => x.id)).size === 3,
      'PERK', 'offer was not three distinct cards');
    check(!g.offerPerks(), 'PERK', 'doctrine screen re-opened on top of itself');
    check(document.querySelectorAll('#perkGrid [data-perk]').length === 3, 'PERK', 'offer did not render three buttons');
    check(!g.choosePerk('a-perk-that-does-not-exist') && g.state === 'perk',
      'PERK', 'an off-offer perk was accepted');
    const offered = g.perkOffer[0];
    const neutral = () => p.damageMultiplier === 1 && p.reloadMultiplier === 1 && p.maxHp === 100 &&
      p.maxArmor === 100 && p.critScale === 1 && p.critPower === 1 && p.spreadScale === 1 &&
      p.speedScale === 1 && p.dashCooldown === 1.5 && p.burnScale === 1 && p.splashScale === 1 &&
      p.chainBonus === 0 && p.pierceBonus === 0 && !p.burnChains && p.grenadeCooldown === 8;
    // restarting here would discard the requisitions the sector block checks,
    // so the effect is measured as a diff instead of against a fresh run
    const perkStatSnapshot = () => JSON.stringify([p.damageMultiplier, p.reloadMultiplier, p.maxHp,
      p.maxArmor, p.critScale, p.critPower, p.spreadScale, p.speedScale, p.dashCooldown,
      p.burnScale, p.splashScale, p.chainBonus, p.pierceBonus, p.burnChains, p.grenadeCooldown]);
    const statsBefore = perkStatSnapshot();
    check(g.choosePerk(offered.id) && !perkScreen.classList.contains('show'),
      'PERK', 'taking a perk did not close the doctrine screen');
    // the break runs doctrine then supply: the shop takes over from here
    check(g.state === 'upgrade' && document.getElementById('upgradeScreen').classList.contains('show'),
      'PERK', 'taking a perk did not hand over to the shop');
    g.closeUpgrades();
    check(g.state === 'play', 'PERK', 'closing the shop did not resume the run');
    check(g.perks[offered.id] === 1 && g.perkOffer.length === 0, 'PERK', 'the pick was not recorded');
    check(perkStatSnapshot() !== statsBefore, 'PERK', offered.id + ' applied no effect to the player');
    // the in-combat strip is the only place a build is visible during a wave
    g.hud.update(0, g);
    const strip = document.getElementById('buildStrip');
    check(strip.classList.contains('active') &&
      document.querySelectorAll('#buildChips .buildChip').length === 1,
      'PERK', 'the build strip did not show the taken perk');
    g.perks = {}; g.hud.update(0, g);
    check(!strip.classList.contains('active') && document.querySelectorAll('#buildChips .buildChip').length === 0,
      'PERK', 'the build strip survived an emptied build');
    // the same seed with the same picks has to reproduce the same offer
    const offerFor = () => {
      // reseeding through the live generator keeps makeRng out of the page's
      // public surface; setState(seed) is what makeRng(seed) starts from
      g.rng.setState(60013); g.perks = {}; g.state = 'play'; g.offerPerks();
      const ids = g.perkOffer.map((x) => x.id).join();
      g.choosePerk(g.perkOffer[0].id);
      g.closeUpgrades();
      return ids;
    };
    check(offerFor() === offerFor(), 'PERK', 'the same seed produced a different offer');
    // the gated perk stays out of the pool until the build earns both halves
    const gated = A.PERK_BY_ID.arcburn;
    check(!A.perkAvailable(gated, {}), 'PERK', 'synergy perk was available to an empty build');
    check(!A.perkAvailable(gated, { thermite: 3 }), 'PERK', 'synergy perk appeared with half the combination');
    check(A.perkAvailable(gated, { thermite: 1, conductor: 1 }),
      'PERK', 'synergy perk stayed hidden after both halves were taken');
    g.perks = {}; g.perkOffer = []; g.state = 'play';
    p.critScale = 3; p.speedScale = 1.21; p.burnScale = 2; p.chainBonus = 1; p.burnChains = true;
    p.grenadeCooldown = 6; p.pierceBonus = 1; p.splashScale = 1.5; p.dashCooldown = 0.9;
    const saved = JSON.stringify({ owned: p.owned, mags: p.mags, ammo: p.ammo,
      weaponIndex: p.weaponIndex, hp: p.hp, maxHp: p.maxHp, armor: p.armor, maxArmor: p.maxArmor,
      damageMultiplier: p.damageMultiplier, reloadMultiplier: p.reloadMultiplier, grenadeCd: p.grenadeCd,
      critScale: p.critScale, critPower: p.critPower, speedScale: p.speedScale, dashCooldown: p.dashCooldown,
      burnScale: p.burnScale, splashScale: p.splashScale, chainBonus: p.chainBonus,
      pierceBonus: p.pierceBonus, burnChains: p.burnChains, grenadeCooldown: p.grenadeCooldown,
      upgrades: g.upgrades, money: g.money });
    const geometryCounts = [], textureCounts = [];
    // Render two complete theme cycles. The second may reuse shared textures,
    // but must not retain the first cycle's disposed environment geometry.
    for (let step = 0; step < 6; step++) {
      g.advanceSector();
      check(g.level.sector.id === A.SECTOR_DEFS[(step + 1) % 3].id, 'SECTOR', 'sector sequence did not wrap');
      const after = JSON.stringify({ owned: p.owned, mags: p.mags, ammo: p.ammo,
        weaponIndex: p.weaponIndex, hp: p.hp, maxHp: p.maxHp, armor: p.armor, maxArmor: p.maxArmor,
        damageMultiplier: p.damageMultiplier, reloadMultiplier: p.reloadMultiplier, grenadeCd: p.grenadeCd,
        critScale: p.critScale, critPower: p.critPower, speedScale: p.speedScale, dashCooldown: p.dashCooldown,
        burnScale: p.burnScale, splashScale: p.splashScale, chainBonus: p.chainBonus,
        pierceBonus: p.pierceBonus, burnChains: p.burnChains, grenadeCooldown: p.grenadeCooldown,
        upgrades: g.upgrades, money: g.money });
      check(after === saved, 'SECTOR', 'transition changed purchased or perk stats or inventory');
      check(p.x === g.level.start.x && p.z === g.level.start.z && p.alive, 'SECTOR', 'player was not placed at the new safe start');
      navCheck(g.level, 'rendered sector ' + step);
      g.levelView.updateLamps(g.lampLights, p.x, p.z, step);
      p.updateModel(0, 0, p.x, p.z + 3); g.updateCamera(1); g.render();
      finiteScene('sector ' + step);
      geometryCounts.push(g.renderer.info.memory.geometries);
      textureCounts.push(g.renderer.info.memory.textures);
      if (step >= 3) {
        check(geometryCounts[step] <= geometryCounts[step - 3] + 18, 'LEAK', 'sector geometry retained: ' + geometryCounts.join(','));
        check(textureCounts[step] <= Math.max.apply(null, textureCounts.slice(0, 3)) + 2,
          'LEAK', 'sector textures retained: ' + textureCounts.join(','));
      }
    }

    // Clear-wave progression itself must request a transfer after wave three.
    g.wave = 3; g.waveState = 'active'; g.spawnQueue.length = 0; g.enemies.reset();
    g.endWave();
    check(g.state === 'perk', 'PERK', 'clearing a wave did not offer a doctrine choice');
    g.choosePerk(g.perkOffer[0].id);
    g.closeUpgrades();
    check(g.sectorPending && g.waveState === 'prep', 'SECTOR', 'third cleared wave did not request a sector transfer');
    const oldSector = g.sectorIndex;
    g.beginWave();
    check(g.wave === 4 && g.sectorIndex === oldSector + 1 && !g.sectorPending,
      'SECTOR', 'wave four did not enter the next sector');

    for (const [wave, id] of [[3, 'siege'], [6, 'warden'], [9, 'queen']]) {
      g.wave = wave - 1; g.sectorPending = false; g.enemies.reset();
      g.beginWave();
      check(g.wave === wave && g.spawnQueue[0] === id, 'BOSS', id + ' is not scheduled first at wave ' + wave);
      g.updateWaves(1/60);
      const boss = g.activeBoss;
      check(boss && boss.def.id === id && boss.def.boss && boss.def.radius >= 2.2,
        'BOSS', id + ' did not spawn as a large active boss');
      if (boss) {
        check(!g.level.isWallAt(boss.x, boss.z) && Number.isFinite(boss.hp) && boss.hp > 0,
          'BOSS', id + ' spawned with invalid position or health');
        g.enemies.update(1/60, p);
        g.fx.blobs.begin(); g.enemies.render(g.fx.blobs); g.fx.blobs.end();
        g.render(); finiteScene(id);
        g.enemies.damage(boss, 1e9, 1, 0, 0, 0);
        check(boss.state === 3 && !g.activeBoss, 'BOSS', id + ' death did not clear the boss bar state');
      }
    }

    g.startRun(); clearInput();
    check(g.sectorIndex === 0 && g.level.sectorIndex === 0 && Object.keys(g.upgrades).length === 0,
      'RESET', 'new run retained old sector or purchases');
    check(p.damageMultiplier === 1 && p.reloadMultiplier === 1 && p.maxHp === 100 && p.maxArmor === 100,
      'RESET', 'new run retained purchased stats');
    check(Object.keys(g.perks).length === 0 && g.perkOffer.length === 0 && !perkScreen.classList.contains('show'),
      'RESET', 'new run retained the old build');
    check(neutral(), 'RESET', 'new run retained perk stats');
    check(p.ownedList().length === 2 && p.owned.pistol && p.owned.smg && !p.owned.plasma && p.ammo.cell === 0,
      'RESET', 'new run retained the previous arsenal');
    check(p.grenadeCd === 0 && !p.grenade && !p.grenadeMesh.visible && g.money === 180,
      'RESET', 'new run retained grenade or credit state');
    check(p.callsign === 'Асет-07' && A.loadLook().nickname === 'Асет-07', 'NICK', 'restart discarded the saved callsign');
    return checks + ' assertions; sectors=6; navLayouts=24; weapons=10; bosses=3; rigPoses=80; pixels/TWEEN/nickname/G/RMB/rail/cannon/shop/reroll/pins/arsenal/elites/perks/station/finale/pad/rebind/reset/uinav/osk/overmind/hazards/dmgnum/portraits';
  }

  function sfxProbe(g){
    // exercise the synthesiser paths even though headless has no output device
    const sfx = window.AS3D && window.AS3D.sfx;
    if (!sfx) { fail('AUDIO', 'window.AS3D.sfx missing'); return; }
    sfx.init();
    if (!sfx.ctx) { log.push('NOTE: no AudioContext in this environment'); return; }
    for (const weapon of window.AS3D.WEAPONS) if (weapon.sound !== 'flame') sfx.shot(weapon.sound, 1);
    sfx.explode(1); sfx.screech(1,1);
    sfx.hitFlesh(); sfx.hitWall(); sfx.gib(); sfx.spit(); sfx.hurt();
    sfx.pickup('ammo'); sfx.ui('wave'); sfx.reload('out'); sfx.dryFire();
    sfx.flame(1); sfx.flameStop(); sfx.spinup(true, 0.5); sfx.spinup(false, 0);
    sfx.grenade('throw'); sfx.grenade('detonate'); sfx.footstep(0.5);
    for (let i=0;i<40;i++) sfx.updateMusic(0.05, 0.8);
  }

  run();
})();
</script>
`;
checkProbeSyntax();

function main() {
  const chrome = findChrome();
  const index = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  if (index.indexOf('</body>') === -1) throw new Error('index.html has no </body>');
  const probePage = index.replace('</body>', () => PROBE + '</body>');

  console.log('Runtime: Node ' + process.version + '; browser=' + chrome);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-protocol-smoke-'));
  const pagePath = path.join(tmp, 'probe.html');
  fs.writeFileSync(pagePath, probePage, 'utf8');

  const args = [
    '--headless=new',
    '--disable-gpu',
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--allow-file-access-from-files',
    '--mute-audio',
    '--no-sandbox',
    '--window-size=1280,720',
    // The probe runs synchronously before load, so this budget only covers the
    // wait afterwards. Keep it short: under virtual time rAF fires as fast as
    // the CPU allows, and every one of those frames is a software GL redraw.
    '--virtual-time-budget=300',
    '--user-data-dir=' + path.join(tmp, 'profile'),
    '--dump-dom',
    ...(SHOT ? ['--screenshot=' + SHOT] : []),
    'file:///' + pagePath.replace(/\\/g, '/')
  ];

  let dom = '', chromeFailed = false;
  try {
    dom = execFileSync(chrome, args, {
      encoding: 'utf8',
      // nine minutes covers a normal machine; software WebGL on a slow host
      // needs more, so CHROME_TIMEOUT_MS can raise it without editing this file
      timeout: Math.max(60000, Number(process.env.CHROME_TIMEOUT_MS) || 540000),
      maxBuffer: 1024 * 1024 * 64,
      stdio: ['ignore', 'pipe', 'pipe']
    });
  } catch (e) {
    chromeFailed = true;
    dom = (e.stdout || '') + '\n[chrome exited: ' + e.message + ']';
  }

  if (SHOT) {
    if (!fs.existsSync(SHOT)) { console.log('!! no screenshot written'); process.exit(1); }
    console.log('screenshot: ' + SHOT + ' (' + (fs.statSync(SHOT).size / 1024).toFixed(0) + ' KB)');
  }

  const m = dom.match(/<pre id="PROBE_RESULT"[^>]*>([\s\S]*?)<\/pre>/);
  if (!m) {
    console.log('!! probe produced no result block');
    console.log(dom.slice(0, 3000));
    process.exit(1);
  }
  const text = m[1]
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');
  console.log(text.trim());

  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (e) { /* leave temp dir */ }

  // A completed run can still report assertion failures or console errors.
  // Benign environment notes/warnings are allowed; WebGL/shader warnings are
  // failures because a seemingly successful screenshot can hide broken draws.
  const issueBlock = text.split(/ISSUES\(\d+\):\s*/)[1] || '';
  const failures = issueBlock.split(/\r?\n/).filter((line) => line.trim()).filter((line) =>
    !/^(NOTE|WARN):/.test(line) || (/^WARN:/.test(line) && /WebGL|GL_INVALID|shader|NaN|non.finite/i.test(line)));
  if (chromeFailed || text.indexOf('RESULT_OK') !== 0 || failures.length) process.exit(1);
}

main();
