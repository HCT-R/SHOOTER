/* Rendered supply/animation acceptance. Run after tools/build.js. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process'), { WebSocket } = require('ws');
const { createGameServer } = require('../server');
const restartProbe = require('./arena-restart-probe');
const root = path.resolve(__dirname, '..'), sleep = ms => new Promise(r => setTimeout(r, ms));

async function main() {
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
  assert(chrome, 'Chrome or Edge required');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-supply-'));
  const service = createGameServer({ workers: 1 });
  await new Promise(r => service.server.listen(0, '127.0.0.1', r));
  let child, socket;
  try {
    child = spawn(chrome, ['--headless=new', '--no-sandbox', '--enable-gpu', '--mute-audio', '--no-first-run',
      '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1280,720', 'about:blank'],
      { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('Browser endpoint timeout')), 15000);
      child.stderr.on('data', data => { const match = String(data).match(/DevTools listening on (ws:\/\/\S+)/); if (match) { clearTimeout(timer); resolve(match[1]); } });
      child.once('error', reject);
    });
    socket = new WebSocket(endpoint); await new Promise(r => socket.once('open', r));
    let serial = 0; const pending = new Map(), errors = [];
    socket.on('message', raw => {
      const m = JSON.parse(raw);
      if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); }
      if (m.method === 'Runtime.exceptionThrown') errors.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text);
    });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => {
      const id = ++serial, timer = setTimeout(() => reject(Error(method + ' timed out')), 90000);
      pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId }));
    });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const cdp = (method, params) => call(method, params, sessionId);
    const evaluate = async expression => {
      const r = await cdp('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true, userGesture: true });
      if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
      return r.result.value;
    };
    await cdp('Runtime.enable'); await cdp('Page.enable');
    await cdp('Page.addScriptToEvaluateOnNewDocument', { source: 'window.requestAnimationFrame=()=>0;' });
    await cdp('Page.navigate', { url: 'http://127.0.0.1:' + service.server.address().port });
    for (let i = 0; i < 150 && !await evaluate('!!window.game && !!window.AS3D'); i++) await sleep(60);
    assert(await evaluate('!!window.game && !!window.AS3D'), 'Game failed to boot');
    const screenshot = async name => {
      await sleep(150);
      const shot = await cdp('Page.captureScreenshot', { format: 'png' });
      fs.writeFileSync(path.join(root, 'preview-supply-' + name + '.png'), Buffer.from(shot.data, 'base64'));
    };
    const sizes = [[1280,720], [900,600], [640,600]];
    const report = { viewport: [], phases: 0 };
    for (const [width, height] of sizes) {
      await cdp('Emulation.setDeviceMetricsOverride', { width, height, deviceScaleFactor: 1, mobile: false });
      await evaluate(`(() => {
        game.startRun(3107,'campaign',{missionId:1});
        game.money=702;game.waveState='prep';game.openUpgrades();
        game.shopStock=[{kind:'weapon',id:'machete',price:300},{kind:'upgrade',id:'supply',price:100},
          {kind:'upgrade',id:'medkit',price:80},{kind:'weapon',id:'dmr',price:580}];
        game.hud.renderUpgrades();game.render();
      })()`);
      await evaluate(`Promise.all([...document.querySelectorAll('#upgradeGrid img')].map(i=>i.decode()))`);
      const layout = await evaluate(`(() => {
        const cards=[...document.querySelectorAll('#upgradeGrid .upgrade')];
        return cards.map(card=>{const b=card.getBoundingClientRect(), pin=card.querySelector('.pin').getBoundingClientRect(), image=card.querySelector('img');
          return {width:b.width,right:b.right,left:b.left,pinWidth:pin.width,pinRight:pin.right,imageWidth:image?.naturalWidth||0,source:image?.src};});
      })()`);
      assert.equal(layout.length,4);
      for (const card of layout) { assert(card.left >= 0 && card.right <= width, 'Card overflow'); assert(card.pinWidth < 45 && card.pinRight < card.right, 'Pin overlaps portrait'); assert(card.imageWidth >= 320, 'Missing detailed preview'); }
      assert.notEqual(layout[1].source, layout[2].source, 'Supplies and medkit share an image');
      await screenshot('shop-' + width);
      if (width === 640) {
        await evaluate(`document.querySelectorAll('#upgradeGrid .upgrade')[2].scrollIntoView({block:'center'})`);
        await screenshot('shop-medkit-' + width);
      }
      await evaluate(`game.closeUpgrades();game.enemies.reset();game.pickups.clear();
        game.pickups.spawn('ammo',game.player.x-1.25,game.player.z+.9,'rifle');
        game.pickups.spawn('bigHealth',game.player.x+1.25,game.player.z+.9);
        game.pickups.spawn('ammo',game.player.x-1.25,game.player.z+2,'cell');
        game.pickups.spawn('health',game.player.x+1.25,game.player.z+2);
        game.render();`);
      await screenshot('world-' + width);
      const shared = await evaluate(`(() => {const first=game.pickups.items[0].mesh;
        game.pickups.spawn('ammo',game.player.x-2,game.player.z,'rifle');
        const other=game.pickups.items.at(-1).mesh;return first.geometry===other.geometry && first.material===other.material && first.material.every(m=>m.userData.shared);})()`);
      assert(shared, 'Pickup resources must be reused');
      report.viewport.push({ width, height, cards: layout.length });
    }
    await cdp('Emulation.setDeviceMetricsOverride', { width:1280,height:720,deviceScaleFactor:1,mobile:false });
    await evaluate(`(async () => {
      const catalog=document.createElement('div');catalog.id='visualCatalog';
      catalog.style.cssText='position:fixed;inset:0;z-index:999999;background:#101e26;padding:12px;display:grid;grid-template-columns:repeat(5,1fr);gap:8px;font:12px sans-serif;color:#d8ebe5';
      const portraits=AS3D.weaponPortraits;
      const items=[...['knife','machete','axe','spear','hammer'].map(id=>[id,portraits.get(id)]),
        ...['supply','shell','smg','rifle','fuel','mini','rocket','cell','slug','cannon','grenade','bolt'].map(id=>['ammo / '+id,portraits.getItem('ammo',id)]),
        ['medical',portraits.getItem('health')],['field medical',portraits.getItem('bigHealth')]];
      for(const [label,url] of items){const card=document.createElement('div');card.style.cssText='background:#1a2c35;border:1px solid #3b5056;padding:5px';
        const image=new Image();image.src=url;image.style.cssText='width:100%;height:130px;object-fit:contain;display:block';await image.decode();
        card.append(image,document.createTextNode(label));catalog.append(card);}
      document.body.append(catalog);
    })()`);
    await screenshot('equipment-catalog');
    await evaluate(`document.getElementById('visualCatalog').remove()`);
    const phases = await evaluate(`(() => {
      const A=AS3D,p=game.player,T=A.THREE;
      game.pickups.clear();game.enemies.reset();game.motionScale=0;
      const sheet=document.createElement('canvas');sheet.width=1440;sheet.height=1100;
      const ctx=sheet.getContext('2d');ctx.fillStyle='#0c191f';ctx.fillRect(0,0,sheet.width,sheet.height);
      let row=0,cases=0;
      for(const id of ['knife','machete','axe','spear','hammer']) {
        p.meleeAttack=null;p.fireTimer=0;p.giveWeapon(id);p.setWeapon(A.WEAPONS.findIndex(w=>w.id===id));const w=p.weapon;
        if(w.id!==id)throw Error('Visual fixture selected '+w.id+' instead of '+id);
        for(const heavy of [false,true]) {
          const spec=A.CombatCore.meleeStats(w,heavy),total=spec.windup+spec.activeTime+spec.recovery;
          const ages=[spec.windup*.8,spec.windup+spec.activeTime*.5,spec.windup+spec.activeTime+spec.recovery*.55];
          for(let phase=0;phase<3;phase++) {
            p.angle=-.65;p.meleeAttack={id:++cases,weapon:w,spec,heavy,age:ages[phase],total};
            p.updateModel(0,0,p.x+Math.sin(p.angle)*4,p.z+Math.cos(p.angle)*4);game.updateCamera(1);game.render();
            const center=new T.Vector3(p.x,1,p.z).project(game.camera),canvas=game.renderer.domElement;
            const x=(center.x*.5+.5)*canvas.width,y=(-center.y*.5+.5)*canvas.height;
            const column=(heavy?3:0)+phase;
            ctx.drawImage(canvas,x-120,y-94,240,188,column*240,row*220,240,188);
            ctx.fillStyle='#c8ddd5';ctx.font='12px sans-serif';ctx.fillText(id+' / '+(heavy?'HEAVY':'LIGHT')+' / '+['PREPARE','CONTACT','RECOVER'][phase],column*240+10,row*220+209);
          }
        } row++;
      }
      p.meleeAttack=null;p.updateModel(0,0,p.x,p.z+4);
      return {cases,image:sheet.toDataURL('image/png')};
    })()`);
    report.phases=phases.cases; assert.equal(phases.cases,30);
    fs.writeFileSync(path.join(root,'preview-supply-melee-phases.png'),Buffer.from(phases.image.split(',')[1],'base64'));
    const cache = await evaluate(`(() => {
      game.waveState='prep';game.openUpgrades();game.hud.renderUpgrades();game.render();
      const first=[...document.querySelectorAll('#upgradeGrid img')].map(i=>i.src).join();
      const base={...game.renderer.info.memory};
      for(let i=0;i<20;i++){game.hud.renderUpgrades();game.render();}
      return {same:first===[...document.querySelectorAll('#upgradeGrid img')].map(i=>i.src).join(),base,after:{...game.renderer.info.memory}};
    })()`);
    assert(cache.same,'Portraits changed after repeated opening');assert.deepEqual(cache.base,cache.after,'Shop renderer resource growth');
    report.restarts=await evaluate('(' + restartProbe.toString() + ')()');
    assert.deepEqual(errors,[],'Browser runtime exceptions');
    console.log('SUPPLY_MELEE_BROWSER_OK '+JSON.stringify(report));
  } finally {
    if(socket)socket.close();if(child)child.kill();
    for(const client of service.wss.clients)client.terminate();await new Promise(r=>service.server.close(r));
    await sleep(200);
    const resolved=path.resolve(profile);
    if(path.dirname(resolved)===path.resolve(os.tmpdir()) && path.basename(resolved).startsWith('protocol-supply-'))try{fs.rmSync(resolved,{recursive:true,force:true});}catch(_){}
  }
}
main().catch(e=>{console.error(e.stack||e);process.exitCode=1;});
