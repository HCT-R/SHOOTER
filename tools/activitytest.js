/* Real browser integration: all menu modes, settings, and two-client rooms. */
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const { createGameServer } = require('../server');
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const visuals = process.argv.includes('--visuals');
const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(file => file && fs.existsSync(file));
if (!chrome) throw new Error('Chrome/Edge required');

async function main() {
  const { server, wss } = createGameServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'pixel-activity-'));
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
    const tab = async (address = url) => {
      const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
      const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
      await call('Runtime.enable', {}, sessionId);
      await call('Page.enable', {}, sessionId);
      await call('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
      await call('Emulation.setDeviceMetricsOverride', { width: 1280, height: 720, deviceScaleFactor: 1, mobile: false }, sessionId);
      await call('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame = function(){ return 0; };' }, sessionId);
      await call('Page.navigate', { url: address }, sessionId);
      await until(sessionId, '!!window.game && document.getElementById("start").classList.contains("show")');
      await evaluate(sessionId, `window.testTicks = count => { for(let i=0;i<count;i++) game.update(1/60); }`);
      return sessionId;
    };
    const host = await tab();
    const capture = async name => {
      // Let CSS opacity/bar transitions settle independently of manual ticks.
      await sleep(250);
      const shot = await call('Page.captureScreenshot', { format: 'png' }, host);
      fs.writeFileSync(path.join(__dirname, '../preview-' + name + '.png'), Buffer.from(shot.data, 'base64'));
    };
    assert.equal(await evaluate(host, 'document.querySelectorAll("[data-mode]").length'), 4);
    assert.equal(await evaluate(host, 'Array.from(document.getElementById("modePlayersSetting").options).some(o=>o.value==="31")'), true, '32 participants selectable in the menu');
    for (const mode of ['duel', 'ffa', 'royale', 'campaign']) {
      const state = await evaluate(host, `(() => {
        document.querySelector('[data-mode="${mode}"]').click();
        document.getElementById('deployBtn').click();
        ${visuals ? 'game.startRun(4271,' + JSON.stringify(mode) + ');' : ''}
        for(let i=0;i<240;i++) game.update(1/60);
        game.render();
        const result={mode:game.modeId,arena:!!game.arena,count:game.arena?.roster.length,state:game.state};
        return result;
      })()`);
      assert.equal(state.mode, mode, JSON.stringify(exceptions)); assert.equal(state.arena, mode !== 'campaign', JSON.stringify(exceptions));
      if (mode === 'duel') assert.equal(state.count, 2);
      assert.equal(state.state, 'play');
      if (visuals) {
        await capture(mode);
        console.log('VISUAL ' + mode + ' ' + JSON.stringify(await evaluate(host,
          '({draws:game.renderer.info.render.calls,triangles:game.renderer.info.render.triangles,geometries:game.renderer.info.memory.geometries,textures:game.renderer.info.memory.textures})')));
        if (mode !== 'campaign') {
          await evaluate(host, `game.camera.position.set(0,game.level.w*3*.94,game.level.w*.45); game.camera.lookAt(0,0,0); game.render()`);
          await capture(mode + '-map');
        }
        if (mode === 'ffa') {
          await evaluate(host, `(() => {
            const w=game.arena.world, p=w.members.get('local'), enemy=w.list.find(a=>a.bot);
            Object.assign(p,{x:0,z:0,spawnProtection:0}); Object.assign(enemy,{x:7,z:0,spawnProtection:0});
            w.setInput(p.id,{seq:99999,fire:true,aimX:7,aimZ:0}); w.step(1/60);
            game.arena.applySnapshot(w.snapshot('local')); game.player.updateModel(0,0); game._camSmooth=null; game.updateCamera(1); game.render();
          })()`);
          await capture('combat');
        }
      }
      await evaluate(host, 'game.network.returnToLobby()');
    }
    if (visuals) {
      for (const [width, height] of [[1280,720],[900,600],[640,600]]) {
        await call('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false }, host);
        await evaluate(host, 'game.resize(); game.render()');
        await capture('menu-' + width);
        assert.equal(await evaluate(host, 'document.documentElement.scrollWidth>innerWidth'), false, 'Menu fits width ' + width);
        await evaluate(host, 'game.startRun(4271,"royale"); for(let i=0;i<190;i++) game.update(1/60); game.render()');
        await capture('hud-' + width);
        await evaluate(host, 'game.network.returnToLobby()');
      }
      await call('Emulation.setDeviceMetricsOverride', { width:1280, height:720, deviceScaleFactor:1, mobile:false }, host);
      await evaluate(host, 'game.resize()');
    }
    await evaluate(host, `(() => {
      for (const id of ['low','high','balanced']) {
        document.getElementById('qualitySetting').value=id;
        document.getElementById('qualitySetting').dispatchEvent(new Event('change')); game.render();
        if (game.renderer.getContext().getError()) throw Error('Graphics error: '+id);
      }
      for (const [id,value] of [['sfxVolumeSetting','37'],['musicVolumeSetting','21']]) {
        const input=document.getElementById(id); input.value=value; input.dispatchEvent(new Event('input'));
      }
      if(PixelProtocol.store.get('sfxVolume')!=='37'||PixelProtocol.store.get('musicVolume')!=='21') throw Error('Mixer persistence');
    })()`);
    console.log('PASS browser: four selectable modes, actual render, quality presets, saved mixer');
    const feedback = await evaluate(host, '(' + require('./arena-feedback-probe.js').toString() + ')()');
    console.log('PASS browser arena feedback: ' + JSON.stringify(feedback));
    const restarts = await evaluate(host, '(' + require('./arena-restart-probe.js').toString() + ')()');
    console.log('PASS browser arena restarts: ' + JSON.stringify(restarts));
    const guest = await tab();
    for (const mode of ['duel', 'ffa', 'royale']) {
      await evaluate(host, 'game.network.create(' + JSON.stringify(mode) + ')');
      const code = await until(host, 'game.network.room?.modeId===' + JSON.stringify(mode) + ' && game.network.room.code');
      await evaluate(guest, 'game.network.join(' + JSON.stringify(code) + ')');
      await until(host, 'game.network.room?.participants.length===2');
      await until(guest, 'game.network.room?.participants.length===2');
      await evaluate(host, 'game.network.ready()'); await evaluate(guest, 'game.network.ready()');
      await until(host, 'game.network.room.participants.every(p=>p.ready)');
      await evaluate(host, 'game.network.start()');
      await until(host, 'game.arena?.online && game.arena.modeId===' + JSON.stringify(mode));
      await until(guest, 'game.arena?.online && game.arena.modeId===' + JSON.stringify(mode));
      await until(guest, 'game.arena.phase==="active"');
      const before = await evaluate(guest, '({x:game.player.x,z:game.player.z,tick:game.arena.latest.tick})');
      for(let n=0;n<12;n++) {
        await evaluate(guest, 'game.state="play"; game.network.focusLost=false; game.input.keys.KeyD=true; game.update(1/60); game.update(1/60)');
        await sleep(36);
      }
      await evaluate(guest, 'game.input.clear(); game.update(1/60); game.render()');
      const after = await evaluate(guest, '({x:game.player.x,z:game.player.z,tick:game.arena.latest.tick,core:!!game.arena.world})');
      assert(after.tick>before.tick, 'Server advances independently of rendered frames');
      assert.equal(after.core,false,'Online client has no authority world');
      assert.notEqual(after.x,before.x,'Commands move player and reconcile');
      assert.equal(await evaluate(guest, 'document.getElementById("mapBox").hidden'),true,'No PvP minimap');
      await evaluate(host, 'game.state="pause"');
      const t0=await evaluate(guest,'game.arena.latest.tick'); await sleep(150);
      assert(await evaluate(guest,'game.arena.latest.tick')>t0,'Pausing creator does not pause server');
      if(mode==='ffa') {
        await evaluate(host,'game.network.leave()');
        await until(guest,'game.network.isHost && game.arena?.online');
        assert.equal(await evaluate(guest,'game.arena.phase'), 'active','Creator departure preserves FFA');
        const id=await evaluate(guest,'game.network.id');
        await evaluate(guest,'game.network.socket.close()');
        await until(guest,'game.network.socket.readyState===1 && !game.network.disconnectedAt');
        assert.equal(await evaluate(guest,'game.network.id'),id,'Reconnect preserves identity');
      }
      await evaluate(host,'game.network.leave()'); await evaluate(guest,'game.network.leave()');
    }
    // An invite link puts a fresh tab straight into the creator's duel room.
    await evaluate(host, 'game.network.create("duel")');
    const inviteCode = await until(host, 'game.network.room?.modeId==="duel" && game.network.room.code');
    assert.equal(await evaluate(host, 'document.getElementById("roomInviteBtn").hidden'), false, 'Invite button in a room');
    const invitee = await tab(await evaluate(host, 'game.network.invite'));
    await until(invitee, 'game.network.room?.code===' + JSON.stringify(inviteCode));
    await until(host, 'game.network.room?.participants.length===2');
    await evaluate(invitee, 'game.network.leave()'); await evaluate(host, 'game.network.leave()');
    assert.equal(await evaluate(host, 'document.getElementById("roomInviteBtn").hidden'), true, 'No invite button outside a room');
    console.log('PASS browser: two clients, authoritative snapshots, prediction, pause independence, FFA creator exit and reconnect, invite link');
    await evaluate(host, 'game.startRun(4271,"royale"); testTicks(190); game.render()');
    if (visuals) await capture('battle-royale');
    assert.deepEqual(exceptions, [], 'No browser runtime exceptions');
    console.log('ACTIVITY_OK');
  } finally {
    if (socket) socket.close();
    if (processHandle) processHandle.kill();
    for (const ws of wss.clients) ws.terminate();
    await new Promise(resolve => server.close(resolve));
    await sleep(150);
    try { fs.rmSync(profile, { force: true, recursive: true }); } catch (_) {}
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
