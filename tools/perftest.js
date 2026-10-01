/* Real-time performance evidence; no simulated-time substitution for the soak.
   node --expose-gc tools/perftest.js
   Optional --server-seconds=N (default900), --browser-seconds=N (default35).
   Shorter server runs are explicitly marked incomplete in perf-report.json.
   --browser-only checks a visual change without repeating the server soak;
   --browser-mode=royale includes loot. These scopes are explicit in the report. */
'use strict';
const fs = require('node:fs'), path = require('node:path'), os = require('node:os');
const { performance } = require('node:perf_hooks'), { spawn } = require('node:child_process');
const { WebSocket } = require('ws');
const { createGameServer } = require('../server');
const { SimulationPool } = require('../server/pool');
const Core = require('../src/62-combat-core.js');
const root = path.resolve(__dirname, '..'), reportPath = path.resolve(root, process.argv.find(v => v.startsWith('--report='))?.slice(9) || 'perf-report.json');
const arg = (name, fallback) => { const found = process.argv.find(v => v.startsWith('--' + name + '=')); return found ? Math.max(1, Number(found.split('=')[1]) || fallback) : fallback; };
const serverSeconds = arg('server-seconds', 900), browserSeconds = arg('browser-seconds', 35);
const browserOnly = process.argv.includes('--browser-only');
const browserMode = process.argv.includes('--browser-mode=royale') ? 'royale' : 'ffa';
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
const report = { startedAt: new Date().toISOString(), status: 'running', environment: { platform: process.platform, release: os.release(), cpu: os.cpus()[0]?.model, logicalCPUs: os.cpus().length, memoryBytes: os.totalmem(), node: process.version },
  requested: { scope: browserOnly ? 'browser-only' : 'server-and-browser', browserMode, serverSeconds: browserOnly ? 0 : serverSeconds, browserSeconds, width: 1920, height: 1080, participants: 32, quality: 'balanced' }, notes: ['These are measured local results, not a hardware-independent guarantee. Browser-only runs do not validate the 15-minute server soak.'] };
function save() { fs.writeFileSync(reportPath, JSON.stringify(report, null, 2)); }
function distribution(values) {
  const s = values.filter(Number.isFinite).sort((a, b) => a - b);
  const p = q => s.length ? s[Math.min(s.length - 1, Math.floor((s.length - 1) * q))] : null;
  return { samples: s.length, p05: p(.05), p50: p(.5), p95: p(.95), p99: p(.99), max: s.at(-1) ?? null, mean: s.length ? s.reduce((a, b) => a + b, 0) / s.length : null };
}
function memory() { const m = process.memoryUsage(); return { rssBytes: m.rss, heapUsedBytes: m.heapUsed, externalBytes: m.external, arrayBuffersBytes: m.arrayBuffers }; }
function addBots(world, count) { for (let i = 0; i < count; i++) world.addPlayer({ id: 'bot-' + i, name: 'BENCH-' + i, bot: true, loadout: ['assault', 'scout', 'heavy', 'specialist'][i % 4] }); world.start(); }
function microbench(count) {
  let world = new Core.World({ modeId: 'ffa', seed: 4271, capacity: count }), restarts = 0; addBots(world, count);
  const stepMs = [], snapshotMs = []; let bytes = 0;
  for (let i = 0; i < 2400; i++) {
    if (world.result) { world = new Core.World({ modeId: 'ffa', seed: 4272 + restarts++, capacity: count }); addBots(world, count); }
    const start = performance.now(); world.step(1 / 60); const took = performance.now() - start;
    if (i >= 300) stepMs.push(took);
    if (i % 3 === 0 && i >= 300) { const t = performance.now(); for (const a of world.list) bytes += JSON.stringify(world.snapshot(a.id)).length; snapshotMs.push(performance.now() - t); }
  }
  return { participants: count, method: 'CPU microbenchmark,2400 fixed steps; first300 excluded; one personal snapshot per actor every3steps', stepMs: distribution(stepMs), allRecipientsSnapshotMs: distribution(snapshotMs), serializedBytes: bytes, metrics: world.metrics, restarts };
}
async function serverSoak() {
  const pool = new SimulationPool(1), room = 'PERF', started = performance.now(), samples = [], deliveryMs = [];
  let generation = 0, restarts = 0, completedSteps = 0, currentSteps = 0, batches = 0, snapshots = 0, bytes = 0, lastDelivery = 0, latest = null, restarting = null, failure = null, maxScore = 0;
  const create = () => pool.request(room, 'create', { modeId: 'ffa', seed: 4271 + generation++, capacity: 32, players: Array.from({ length: 32 }, (_, i) => ({ id: 'perf-' + i, name: 'PERF-' + i, bot: true, loadout: ['assault', 'scout', 'heavy', 'specialist'][i % 4] })) });
  report.server = { status: 'running', method: 'Production server/pool.js and server/worker.js;32 AI participants,32 personal snapshot recipients at20Hz; real60Hz worker scheduler; normal FFA rules restart on result', samples, startedAt: new Date().toISOString() }; save();
  pool.on('failure', data => { failure = data.message; });
  pool.on('metrics', data => { if (data.room !== room) return; currentSteps = data.steps; samples.push({ seconds: (performance.now() - started) / 1000, generation, steps: data.steps, stepP95Ms: data.p95, actors: data.actors }); report.server.elapsedSeconds = (performance.now() - started) / 1000; report.server.restarts = restarts; save(); });
  pool.on('snapshots', data => {
    if (data.room !== room) return; const now = performance.now(); if (lastDelivery) deliveryMs.push(now - lastDelivery); lastDelivery = now;
    batches++; snapshots += data.snapshots.length; bytes += Buffer.byteLength(JSON.stringify(data.snapshots)); latest = data.snapshots[0]?.snapshot;
    if (latest) { currentSteps = Math.max(currentSteps, latest.tick); for (const a of latest.roster) maxScore = Math.max(maxScore, a.score); }
  });
  pool.on('finished', data => {
    if (data.room !== room || restarting) return;
    completedSteps += currentSteps; currentSteps = 0; restarts++;
    restarting = create().catch(e => { failure = e.message; }).finally(() => { restarting = null; });
  });
  try {
    await create(); let nextLog = 30;
    while ((performance.now() - started) / 1000 < serverSeconds) {
      await sleep(1000); if (failure) throw new Error(failure);
      const elapsed = (performance.now() - started) / 1000;
      if (elapsed >= nextLog) { console.log('SOAK seconds=' + elapsed.toFixed(1) + ' tick=' + (completedSteps + currentSteps) + ' restarts=' + restarts + ' p95ms=' + (samples.at(-1)?.stepP95Ms.toFixed(3) || 'pending')); nextLog += 30; }
    }
    if (restarting) await restarting;
    const inspect = await pool.request(room, 'inspect'), elapsedSeconds = (performance.now() - started) / 1000;
    currentSteps = inspect.steps;
    Object.assign(report.server, { status: 'complete', elapsedSeconds, completed15Minutes: elapsedSeconds >= 900, participants: inspect.actors,
      steps: completedSteps + currentSteps, achievedStepHz: (completedSteps + currentSteps) / elapsedSeconds,
      stepWindowP95Ms: distribution(samples.map(s => s.stepP95Ms)), snapshotDeliveryIntervalMs: distribution(deliveryMs), snapshotBatches: batches, personalSnapshots: snapshots, serializedBytes: bytes, restarts, maxObservedScore: maxScore, finalPhase: latest?.phase, workerRooms: inspect.rooms,
      interpretation: 'Worker p95 covers simulation.step only; snapshot delivery intervals include snapshot construction, IPC and this process scheduling. Snapshot byte count measures the JSON payload, not network framing.' });
  } catch (e) { Object.assign(report.server, { status: 'failed', error: e.stack || String(e), elapsedSeconds: (performance.now() - started) / 1000 }); }
  finally { await pool.close(); save(); }
}
async function browserBench() {
  const chrome = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
  if (!chrome) throw new Error('Chrome/Edge required for hardware renderer measurement');
  const service = createGameServer({ workers: 1 }); await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'protocol-perf-')); let child, socket;
  try {
    const flags = ['--headless=new', '--enable-gpu', '--no-sandbox', '--mute-audio', '--no-first-run', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows', '--remote-debugging-port=0', '--user-data-dir=' + profile, '--window-size=1920,1080', 'about:blank'];
    child = spawn(chrome, flags, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'] });
    const endpoint = await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('Browser endpoint timeout')), 15000); child.stderr.on('data', chunk => { const m = String(chunk).match(/DevTools listening on (ws:\/\/\S+)/); if (m) { clearTimeout(timer); resolve(m[1]); } }); child.once('error', reject); });
    socket = new WebSocket(endpoint); await new Promise((resolve, reject) => { socket.once('open', resolve); socket.once('error', reject); });
    let serial = 0; const pending = new Map(), exceptions = [];
    socket.on('message', raw => { const m = JSON.parse(raw); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); clearTimeout(p.timer); m.error ? p.reject(Error(m.error.message)) : p.resolve(m.result); } if (m.method === 'Runtime.exceptionThrown') exceptions.push(m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text); });
    const call = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const id = ++serial, timer = setTimeout(() => { pending.delete(id); reject(Error('CDP timeout:' + method)); }, 60000); pending.set(id, { resolve, reject, timer }); socket.send(JSON.stringify({ id, method, params, sessionId })); });
    const { targetId } = await call('Target.createTarget', { url: 'about:blank' }), { sessionId } = await call('Target.attachToTarget', { targetId, flatten: true });
    const evaluate = async expression => { const r = await call('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true }, sessionId); if (r.exceptionDetails) throw Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text); return r.result.value; };
    await call('Runtime.enable', {}, sessionId); await call('Page.enable', {}, sessionId);
    await call('Emulation.setFocusEmulationEnabled', { enabled: true }, sessionId);
    await call('Emulation.setDeviceMetricsOverride', { width: 1920, height: 1080, deviceScaleFactor: 1, mobile: false }, sessionId);
    await call('Page.navigate', { url: 'http://127.0.0.1:' + service.server.address().port }, sessionId);
    let ready = false; for (let i = 0; i < 200; i++) { if (await evaluate('!!window.game && !!game.renderer && !!window.CombatCore')) { ready = true; break; } await sleep(100); }
    if (!ready) throw Error('Game did not boot: ' + exceptions.join('\n'));
    const gpu = await evaluate('(() => {const gl=game.renderer.getContext(),ext=gl.getExtension("WEBGL_debug_renderer_info");return {vendor:ext?gl.getParameter(ext.UNMASKED_VENDOR_WEBGL):null,renderer:ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):null,version:gl.getParameter(gl.VERSION),shadingLanguage:gl.getParameter(gl.SHADING_LANGUAGE_VERSION),antialias:gl.getContextAttributes().antialias}})()');
    const system = await call('SystemInfo.getInfo').catch(() => null);
    const hardware = !!gpu.renderer && !/swiftshader|llvmpipe|softpipe|software|microsoft basic render/i.test(gpu.renderer);
    report.browser = { status: 'running', gpu, hardwareRendererVerified: hardware, gpuDevices: system?.gpu?.devices, flags: flags.filter(f => !f.startsWith('--user-data-dir')), exceptions }; save();
    await evaluate('document.getElementById("qualitySetting").value="balanced"; document.getElementById("qualitySetting").dispatchEvent(new Event("change")); game.startRun(4271,"' + browserMode + '",{botCount:31,difficulty:"normal"});');
    await sleep(5000);
    await evaluate(`(() => {
      const originalRender=game.render.bind(game), renderMs=[], frameMs=[], sizes=[], counters=[];
      let last=performance.now(); window.__perf={renderMs,frameMs,sizes,counters,started:performance.now(),active:true};
      game.render=function(...args){const t=performance.now(); const result=originalRender(...args); if(__perf.active){renderMs.push(performance.now()-t);frameMs.push(t-last);last=t;
        if(renderMs.length%30===0){sizes.push({width:game.canvas.width,height:game.canvas.height,scale:game.pixelRatioScale,ratio:game.renderer.getPixelRatio()});counters.push({calls:game.renderer.info.render.calls,triangles:game.renderer.info.render.triangles,geometries:game.renderer.info.memory.geometries,textures:game.renderer.info.memory.textures,roster:game.arena?.roster.length,visible:game.arena?.enemies.list.length,state:game.state});}}
        return result;};
      return true;
    })()`);
    await sleep(browserSeconds * 1000);
    const result = await evaluate('(() => {__perf.active=false;return {...__perf,elapsedSeconds:(performance.now()-__perf.started)/1000,roster:game.arena?.roster.length,quality:game.qualityId,canvas:{width:game.canvas.width,height:game.canvas.height},state:game.state,phase:game.arena?.phase}})()');
    const frameMs = result.frameMs.slice(1), fps = frameMs.map(ms => 1000 / ms);
    Object.assign(report.browser, { status: 'complete', elapsedSeconds: result.elapsedSeconds, completed30Seconds: result.elapsedSeconds >= 30,
      frameTimeMs: distribution(frameMs), instantaneousFPS: distribution(fps), averageFPS: frameMs.length * 1000 / frameMs.reduce((a,b)=>a+b,0), renderCPUTimeMs: distribution(result.renderMs), backingSizes: result.sizes,
      counters: result.counters, roster: result.roster, quality: result.quality, phase: result.phase, state: result.state, finalCanvas: result.canvas,
      full1080pThroughout: result.sizes.length > 0 && result.sizes.every(s => s.width >= 1920 && s.height >= 1080),
      interpretation: 'Frame intervals come from actual game.render calls in the normal requestAnimationFrame loop. CPU render duration is submission time, not GPU execution time. p05 instantaneous FPS is the reciprocal tail comparable to p95 frame time.' });
    const shot = await call('Page.captureScreenshot', { format: 'png' }, sessionId); fs.writeFileSync(path.join(root, 'preview-perf-1080.png'), Buffer.from(shot.data, 'base64'));
    const restartMemory = [];
    for (let i = 0; i < 10; i++) {
      await evaluate('game.network.returnToLobby(); game.startRun(' + (5000 + i) + ',"' + browserMode + '",{botCount:31});');
      await sleep(350); await call('HeapProfiler.collectGarbage', {}, sessionId);
      restartMemory.push(await evaluate('({geometries:game.renderer.info.memory.geometries,textures:game.renderer.info.memory.textures,programs:game.renderer.info.programs.length,calls:game.renderer.info.render.calls,participants:game.arena.roster.length,heapUsed:performance.memory?.usedJSHeapSize,heapTotal:performance.memory?.totalJSHeapSize})'));
    }
    report.browser.restarts = { count: 10, gcRequested: true, samples: restartMemory, note: 'Renderer resource counters and Chrome JS heap after ten complete room teardown/start cycles. First samples may include shader/cache warmup.' };
    console.log('GPU ' + gpu.renderer + ' hardware=' + hardware);
    console.log('BROWSER ' + JSON.stringify({ averageFPS: report.browser.averageFPS, p50FPS: report.browser.instantaneousFPS.p50, p95FrameMs: report.browser.frameTimeMs.p95, full1080p: report.browser.full1080pThroughout, canvas: result.canvas }));
    if (!hardware) report.browser.warning = 'Software/unidentified GPU: result is not a hardware-GPU acceptance measurement.';
  } catch (e) { report.browser = { ...report.browser, status: 'failed', error: e.stack || String(e) }; console.error('BROWSER_FAIL ' + e.message); }
  finally {
    socket?.close(); child?.kill(); for (const ws of service.wss.clients) ws.terminate(); await new Promise(resolve => service.server.close(resolve)); await sleep(150);
    if (path.dirname(path.resolve(profile)) === path.resolve(os.tmpdir()) && path.basename(profile).startsWith('protocol-perf-')) { try { fs.rmSync(profile, { recursive: true, force: true }); } catch (_) {} }
    save();
  }
}
async function main() {
  save(); console.log('PERF_REPORT=' + reportPath + ' realtimeSeconds=' + serverSeconds);
  if (browserOnly) {
    await browserBench();
    report.finishedAt = new Date().toISOString();
    report.acceptance = { hardware1080p: !!report.browser?.hardwareRendererVerified && !!report.browser?.full1080pThroughout,
      browser30Seconds: !!report.browser?.completed30Seconds, average60FPS: (report.browser?.averageFPS || 0) >= 60,
      runtimeErrors: report.browser?.exceptions?.length || 0, server15Minutes: 'not-run' };
    report.status = report.browser?.status === 'complete' && report.acceptance.hardware1080p && report.acceptance.browser30Seconds &&
      report.acceptance.average60FPS && report.acceptance.runtimeErrors === 0 ? 'complete' : 'incomplete';
    save(); console.log('PERF_DONE ' + JSON.stringify(report.acceptance));
    if (report.status !== 'complete') process.exitCode = 1;
    return;
  }
  const soak = serverSoak(), browser = browserBench();
  report.microbench = [8, 16].map(microbench); save();
  await browser;
  const samples = []; for (let i = 0; i < 10; i++) { let w = new Core.World({ modeId: 'ffa', seed: 9000 + i, capacity: 32 }); addBots(w, 32); for (let n = 0; n < 360; n++) w.step(1 / 60); w = null; if (global.gc) global.gc(); samples.push(memory()); }
  report.coreRestarts = { count: 10, gcAvailable: !!global.gc, samples, note: 'Main-process heap/RSS after dropping ten32-actor worlds; production soak worker remains running concurrently, so RSS includes that worker.' }; save();
  await soak; report.finishedAt = new Date().toISOString();
  report.status = report.server?.completed15Minutes && report.browser?.completed30Seconds && report.browser.hardwareRendererVerified ? 'complete' : 'incomplete';
  report.acceptance = { hardware1080p: !!report.browser?.hardwareRendererVerified && !!report.browser?.full1080pThroughout, browser30Seconds: !!report.browser?.completed30Seconds, server15Minutes: !!report.server?.completed15Minutes, serverNear60Hz: (report.server?.achievedStepHz || 0) >= 59, runtimeErrors: report.browser?.exceptions?.length || 0 };
  save(); console.log('PERF_DONE ' + JSON.stringify(report.acceptance)); if (report.status !== 'complete') process.exitCode = 1;
}
main().catch(e => { report.status = 'failed'; report.error = e.stack || String(e); save(); console.error(e); process.exitCode = 1; });
