/* Real browser campaign + responsive UI integration. Run after tools/build.js. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const { createGameServer } = require('../server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
if (!chrome) throw new Error('Chrome/Edge required');

async function main() {
  const { server, wss } = createGameServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-campaign-'));
  let processHandle, socket;
  try {
    processHandle = spawn(chrome, ['--headless=new', '--no-sandbox', '--disable-gpu', '--use-gl=angle',
      '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--mute-audio', '--no-first-run',
      '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1280,720', 'about:blank'],
    { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('No browser endpoint')), 15000);
      processHandle.stderr.on('data', chunk => {
        const match = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/);
        if (match) { clearTimeout(timeout); resolve(match[1]); }
      });
      processHandle.on('error', reject);
    });
    socket = new WebSocket(endpoint);
    await new Promise(resolve => socket.once('open', resolve));
    let sequence = 0;
    const pending = new Map(), exceptions = [];
    socket.on('message', raw => {
      const message = JSON.parse(raw);
      if (message.id && pending.has(message.id)) {
        const request = pending.get(message.id); pending.delete(message.id); clearTimeout(request.timeout);
        if (message.error) request.reject(new Error(message.error.message)); else request.resolve(message.result);
      }
      if (message.method === 'Runtime.exceptionThrown') exceptions.push(message.params.exceptionDetails.exception?.description || message.params.exceptionDetails.text);
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++sequence;
      const timeout = setTimeout(() => { pending.delete(id); reject(new Error('Timeout: ' + method)); }, 30000);
      pending.set(id, { resolve, reject, timeout });
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const evaluate = async (tab, expression) => {
      const result = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true }, tab);
      if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text);
      return result.result.value;
    };
    const until = async (tab, expression) => {
      for (let i = 0; i < 150; i++) {
        const result = await evaluate(tab, expression);
        if (result) return result;
        await sleep(30);
      }
      throw new Error('Timed out: ' + expression);
    };
    const tab = async () => {
      const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
      await call('Runtime.enable', {}, sessionId);
      await call('Page.enable', {}, sessionId);
      await call('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
      await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
      await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = function(){ return 0; };' }, sessionId);
      await call('Page.navigate', { url }, sessionId);
      await until(sessionId, '!!window.game && document.getElementById("start").classList.contains("show")');
      await evaluate(sessionId, `window.testTicks = count => { for(let i=0;i<count;i++) game.update(1/60); }`);
      return sessionId;
    };
    const host = await tab();
    const capture = async name => {
      // Let CSS opacity/bar transitions settle independently of manual ticks.
      await sleep(250);
      const shot = await call('Page.captureScreenshot', { format: 'png' }, host);
      fs.writeFileSync(path.join(__dirname, '../preview-campaign-test-' + name + '.png'), Buffer.from(shot.data, 'base64'));
    };
    const result = await evaluate(host, `(() => {
      if (!PixelProtocol.CAMPAIGN_MISSIONS || PixelProtocol.CAMPAIGN_MISSIONS[0].stages.length < 7) throw Error('Rebuild index before campaign browser regression');
      window.campaignBrowserStats={stages:0,perks:0,purchases:0};
      window.testMove = at => {Object.assign(game.player,{x:at.x,z:at.z,vx:0,vz:0,kx:0,kz:0,invuln:99});};
      window.testKill = () => {for(const enemy of game.enemies.list.slice())if(enemy.hp>0){enemy.shield=0;game.enemies.damage(enemy,1e7,1,0,0,0);} game.hitStop.remaining=0;};
      window.testResume = () => {
        if(game.state==='perk'){game.choosePerk(game.perkOffer[0].id);campaignBrowserStats.perks++;}
        if(game.state==='upgrade')game.closeUpgrades();
        if(game.campaign.phase==='checkpoint')game.campaign.interact();
      };
      window.testObjective = () => {
        testResume();const c=game.campaign,stage=c.stage;if(c.finished)return {done:true};
        testKill();game.player.hp=game.player.maxHp;game.player.armor=game.player.maxArmor;game.player.invuln=99;
        if(stage.type==='collect'||stage.type==='interact') {const t=c.activeTargets()[0];if(t){testMove(t);c.interact();}}
        else if(stage.type==='escort')testMove(c.npc);
        else testMove(c.point(stage.target||stage.entry));
        const before=c.stageIndex;
        // Resolve real Game hooks. Defence time is accelerated through the
        // director only after the real simulation has validated occupancy.
        game.update(1/60);
        if(c.stageIndex===before && !c.finished && c.phase==='active')c.update(stage.type==='escort'?.15:1);
        if(c.stageIndex!==before)campaignBrowserStats.stages++;
        return {done:c.finished,mission:c.missionId,stage:c.stageIndex,type:stage.type,state:game.state,npc:c.npc&&{x:c.npc.x,z:c.npc.z,hp:c.npc.hp,path:c.npc.pathIndex,route:c.npc.routeIndex}};
      };
      game.startRun(3107,'campaign',{missionId:1});return {title:game.campaign.def.title,mission:game.level.campaignId};
    })()`);
    assert.equal(result.mission,1);

    // A checkpoint restores the full build, owned catalog, selected melee,
    // credits and current stage after the actual player-death callback.
    const retry = await evaluate(host, `(() => {
      const c=game.campaign;testMove(c.point('training'));game.update(1/60);
      if(c.phase!=='checkpoint')throw Error('Reach objective did not checkpoint');campaignBrowserStats.stages++;
      game.player.giveWeapon('spear');game.player.giveWeapon('suppressedSmg');
      game.player.damageMultiplier=1.6;game.money=4321;c.saveCheckpoint();
      c.interact();game.player.invuln=0;game.player.armor=0;game.player.takeDamage(100000,game.player.x+3,game.player.z);
      if(game.state!=='campaignFailed')throw Error('Death did not open campaign retry');
      document.getElementById('checkpointRetryBtn').click();
      return {stage:game.campaign.stageIndex,hp:game.player.hp,melee:game.player.meleeId,owned:game.player.owned,damage:game.player.damageMultiplier,money:game.money};
    })()`);
    assert.equal(retry.stage,1);assert(retry.hp>0);assert.equal(retry.melee,'spear');assert.equal(retry.damage,1.6);assert.equal(retry.money,4321);assert(retry.owned.suppressedSmg);

    // All mission transitions use the real next-mission button to verify
    // persistence and screen bindings, not direct director construction.
    for(let mission=1;mission<=6;mission++){
      let latest;
      for(let attempts=0;attempts<180;attempts++){
        latest=await evaluate(host, `(() => {let s;for(let i=0;i<60;i++){s=testObjective();if(s.done)break;}return s;})()`);
        if(latest.done)break;
      }
      assert(latest?.done,'Mission stuck: '+JSON.stringify(latest));
      assert.equal(latest.state,'campaignComplete','Mission failed: '+JSON.stringify(latest));
      assert.equal(await evaluate(host,'document.getElementById("campaignComplete").classList.contains("show")'),true);
      await evaluate(host,'game.render()');await capture('mission-'+mission+'-complete');
      const progress=await evaluate(host,'PixelProtocol.campaignProgress()');assert(progress.completed.includes(mission));
      if(mission<6){
        const next=await evaluate(host,`(() => {const before={money:game.money,damage:game.player.damageMultiplier,melee:game.player.meleeId};document.getElementById('campaignNextBtn').click();return {before,mission:game.campaign.missionId,money:game.money,damage:game.player.damageMultiplier,melee:game.player.meleeId};})()`);
        assert.equal(next.mission,mission+1);assert.equal(next.money,next.before.money);assert.equal(next.damage,next.before.damage);assert.equal(next.melee,next.before.melee);
      } else assert.equal(progress.checkpoint,null);
      console.log('PASS campaign mission '+mission+' complete, checkpoint + next-mission gear carry');
    }

    // Replaying an already-completed finale pays no duplicate story bonus.
    const dedup=await evaluate(host,`(() => {game.startRun(3107,'campaign',{missionId:6});const c=game.campaign;c.stageIndex=c.def.stages.length-1;game.sampleYield=0;const before=Number(PixelProtocol.store.get('samples','0'));c.completeMission();return Number(PixelProtocol.store.get('samples','0'))-before;})()`);
    assert.equal(dedup,0,'Repeated story-completion reward duplicated');

    const escortRetry=await evaluate(host,`(() => {
      game.startRun(3107,'campaign',{missionId:3});const c=game.campaign;c.stageIndex=5;c.placeAtEntry();c.saveCheckpoint();c.beginStage();
      game.enemies.reset();testMove(c.npc);c.npc.hp=1;game.enemies.spawn('grunt',c.npc.x+.5,c.npc.z,{hp:1,dmg:1,speed:1});c.update(1);
      const failed=game.state==='campaignFailed';document.getElementById('checkpointRetryBtn').click();
      return {failed,stage:game.campaign.stageIndex,hp:game.campaign.npc?.hp};
    })()`);
    assert(escortRetry.failed,'Actual escort damage did not fail mission');assert.equal(escortRetry.stage,5);assert.equal(escortRetry.hp,140);

    const slots=await evaluate(host,`(() => {
      game.startRun(3107,'campaign',{missionId:1});for(const id of ['rifle','shotgun','grenadeLauncher','hammer'])game.player.giveWeapon(id);
      const list=game.player.loadoutList(),index=list.findIndex(i=>PixelProtocol.WEAPONS[i].id==='hammer');
      game.input.keys['Digit'+(index+1)]=true;game.input.pressed['Digit'+(index+1)]=true;game.update(1/60);game.hud.update(0,game);
      return {full:game.player.arsenalFull(),melee:game.player.meleeId,count:list.length,rack:Array.from(document.querySelectorAll('#weaponRack .num')).map(n=>n.textContent),weapon:game.player.weapon.id};
    })()`);
    assert(slots.full,'Harness did not reach capacity');assert.equal(slots.melee,'hammer');assert.equal(slots.count,5);
    assert.deepEqual(slots.rack,['1','2','3','4','5']);assert.equal(slots.weapon,'hammer','High catalog weapon unreachable via carried hotkey');

    const respawn=await evaluate(host,`(() => {
      game.startRun(4271,'ffa',{botCount:3});testTicks(190);const a=game.arena,w=a.world;w.members.get(a.localId).spawnProtection=0;
      w.damage(a.localId,100000);testTicks(2);game.hud._modeHudTimer=0;game.hud.update(0,game);
      const visible=!document.getElementById('respawnLoadoutPanel').hidden;
      const select=document.getElementById('respawnLoadoutSetting');select.value='weapon:hammer';select.dispatchEvent(new Event('change'));testTicks(200);
      return {visible,alive:a.self.alive,weapons:a.self.weaponSlots,selection:select.value,closed:document.getElementById('respawnLoadoutPanel').hidden};
    })()`);
    assert(respawn.visible,'FFA loadout chooser missing during respawn');assert(respawn.alive);assert(respawn.weapons.includes('hammer'),'Respawn selection ignored');
    assert.equal(respawn.selection,'weapon:hammer');assert(respawn.closed,'Respawn chooser covers live match');

    const spectate=await evaluate(host,`(() => {
      game.startRun(4271,'royale',{botCount:7});testTicks(190);const a=game.arena,w=a.world;w.members.get(a.localId).spawnProtection=0;w.damage(a.localId,100000);testTicks(2);
      game.hud._modeHudTimer=0;game.hud.update(0,game);const before=a.latest.spectating;
      const visible=!document.getElementById('spectatorBar').hidden;document.getElementById('spectatorNextBtn').click();testTicks(2);
      return {visible,before,after:a.latest.spectating,mapHidden:document.getElementById('mapBox').hidden};
    })()`);
    assert(spectate.visible,'BR spectator controls absent');assert(spectate.mapHidden);assert.notDeepEqual(spectate.after,spectate.before,'Spectator switch did not change target');

    const viewportCheck = async screen => {
      const bounds=await evaluate(host,`(() => {const s=document.getElementById(${JSON.stringify(screen)});return {page:document.documentElement.scrollWidth,width:innerWidth,scroll:s.scrollWidth,client:s.clientWidth};})()`);
      assert(bounds.page<=bounds.width,'Page overflows '+screen);assert(bounds.scroll<=bounds.client+1,'Screen overflows '+screen);
    };
    for(const [width,height] of [[1280,720],[900,600],[640,600]]){
      await call('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:false},host);
      await evaluate(host,`game.resize();document.getElementById('campaignMenuBtn').click();game.render()`);
      await viewportCheck('start');await capture('menu-'+width);
      await evaluate(host,`document.getElementById('campaignBtn').click();game.render()`);
      await viewportCheck('missionSelectScreen');await capture('missions-'+width);
      await evaluate(host,`document.getElementById('missionSelectBack').click();document.getElementById('custBtn').click();AS3D.customizer._resize();AS3D.customizer.update(.1);game.render()`);
      await viewportCheck('custScreen');await capture('editor-'+width);
      await evaluate(host,`document.getElementById('custSave').click();game.startRun(3107,'campaign',{missionId:3});game.player.giveWeapon('spear');game.player.giveWeapon('suppressedSmg');game.campaign.stageIndex=5;game.campaign.placeAtEntry();game.campaign.beginStage();for(let i=0;i<120;i++)game.update(1/60);game.render()`);
      await capture('escort-hud-'+width);
      assert.equal(await evaluate(host,'document.getElementById("mapBox").hidden'),false,'Campaign map hidden');
      await evaluate(host,`game.startRun(3107,'campaign',{missionId:1});testMove(game.campaign.point('training'));game.update(1/60);game.money=99999;game.openUpgrades();game.hud.renderUpgrades();game.render()`);
      await viewportCheck('upgradeScreen');await capture('shop-'+width);
      const purchase=await evaluate(host,`(() => {const index=game.shopStock.findIndex((s,i)=>s&&!s.sold&&!document.querySelector('[data-slot="'+i+'"]').disabled);if(index<0)throw Error('No purchase choice');const credits=game.money;game.buySlot(index);game.closeUpgrades();campaignBrowserStats.purchases++;return {spent:game.money<credits,saved:PixelProtocol.campaignProgress().checkpoint?.money===game.money};})()`);
      assert(purchase.spent,'Shop transaction failed');assert(purchase.saved,'Shop purchase not checkpointed');
      await evaluate(host,`game.startRun(4271,'royale',{botCount:7});testTicks(190);game.render()`);
      assert.equal(await evaluate(host,'document.getElementById("mapBox").hidden'),true,'PvP map exposed');await capture('royale-hud-'+width);
    }
    assert.deepEqual(exceptions,[],'Browser runtime exceptions');
    console.log('CAMPAIGN_BROWSER_OK '+JSON.stringify(await evaluate(host,'campaignBrowserStats')));
  } finally {
    if(socket)socket.close();if(processHandle)processHandle.kill();
    for(const ws of wss.clients)ws.terminate();await new Promise(resolve=>server.close(resolve));await sleep(150);
    const absolute=path.resolve(profile),temp=path.resolve(os.tmpdir())+path.sep;
    if(absolute.startsWith(temp))try{fs.rmSync(absolute,{force:true,recursive:true});}catch(_){}
  }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
