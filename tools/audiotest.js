/* Real Web Audio rendering: mix isolation, spatial cues, signal headroom and
   every synthesiser path. Run: node tools/audiotest.js (Chrome/Edge required). */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFile } = require('child_process');
const { promisify } = require('util');
const http = require('http');

const browser = [process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'
].find(candidate => candidate && fs.existsSync(candidate));
if (!browser) throw new Error('Audio test requires Chrome/Edge; set CHROME_PATH.');

async function probe() {
  const report = document.getElementById('result');
  let assertions = 0;
  const check = (value, label) => { if (!value) throw new Error(label); assertions++; };
  function fixture(levels) {
    const ctx = new OfflineAudioContext(2, 48000 * 3, 48000);
    const engine = new SfxEngine();
    if (levels) {
      if (levels.sfx !== undefined) engine.setSfx(levels.sfx);
      if (levels.music !== undefined) engine.setMusic(levels.music);
      if (levels.master !== undefined) engine.setMaster(levels.master);
    }
    // Deterministic noise makes distance/mute comparisons meaningful.
    const original = Math.random;
    let seed = 7183;
    Math.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) | 0; return (seed >>> 0) / 4294967296; };
    try { engine._build(class { constructor() { return ctx; } }); }
    finally { Math.random = original; }
    return engine;
  }
  async function render(engine) {
    const result = await engine.ctx.startRendering();
    const energy = [0, 0]; let peak = 0;
    for (let c = 0; c < 2; c++) {
      for (const sample of result.getChannelData(c)) {
        if (!Number.isFinite(sample)) throw new Error('Non-finite audio sample');
        energy[c] += sample * sample;
        peak = Math.max(peak, Math.abs(sample));
      }
    }
    return { energy, total: energy[0] + energy[1], peak };
  }
  try {
    const defaults = fixture();
    defaults.setSfx(2); defaults.setMusic(-1); defaults.setMaster(NaN);
    check(defaults.sfxVolume === 1 && defaults.musicVolume === 0 && defaults.masterVolume === 0.55,
      'Volume setters must clamp and reject non-finite input');
    const plain = { AudioContext: window.AudioContext, webkitAudioContext: window.webkitAudioContext };
    window.AudioContext = undefined; window.webkitAudioContext = undefined;
    const unavailable = new SfxEngine(); unavailable.init(); unavailable.ui('select'); unavailable.match('start');
    unavailable.shot('pistol'); unavailable.shot('plasma'); unavailable.shot('railgun');
    unavailable.footstep(); unavailable.pickup('weapon'); unavailable.explode();
    window.AudioContext = plain.AudioContext; window.webkitAudioContext = plain.webkitAudioContext;
    check(!unavailable.enabled && !unavailable.ctx, 'Missing audio output must degrade safely');
    try { defaults.at(-1, 15, () => { throw new Error('scope'); }); } catch (_) {}
    check(defaults._position === null, 'Position scope must be restored after an exception');

    const fxMuted = fixture({ sfx: 0 });
    fxMuted.shot('railgun'); fxMuted.explode(1); fxMuted.gib(); fxMuted.match('victory');
    const musicMuted = fixture({ music: 0 }); musicMuted.updateMusic(0.1, 1);
    const musicAudible = fixture({ sfx: 0 }); musicAudible.updateMusic(0.1, 1);
    const effectsAudible = fixture({ music: 0 }); effectsAudible.hurt();
    const left = fixture(); left.at(-1, 0, () => left.hurt());
    const right = fixture(); right.at(1, 0, () => right.hurt());
    const near = fixture(); near.at(0, 0, () => near.hurt());
    const far = fixture(); far.at(0, 50, () => far.hurt());
    const battle = fixture();
    for (let i = 0; i < 9; i++) battle.shot('shotgun');
    battle.explode(1.5); battle.railgun(); battle.match('zone');
    check(battle.musicDuck.gain !== null, 'Combat must retain a music ducking stage');

    const budget = fixture();
    for (let i = 0; i < 80; i++) budget.shot('pistol');
    check(budget.voices <= 36, 'Weapon burst must respect the effect budget');
    const beforeCue = budget.voices;
    budget.match('start');
    check(budget.voices > beforeCue && budget.voices <= 44, 'Match cue must have reserved headroom');

    const result = await Promise.all([fxMuted, musicMuted, musicAudible, left, right, near, far, battle, budget, effectsAudible].map(render));
    check(result[0].peak === 0, 'SFX mute must silence reverb and match cues');
    check(result[1].peak === 0, 'Music mute must silence the score');
    check(result[2].total > 0.01, 'SFX mute must leave music audible');
    check(result[9].total > 0.01, 'Music mute must leave effects audible');
    check(result[3].energy[0] > result[3].energy[1] * 100 && result[3].total > 0.01, 'Left position must render in left channel');
    check(result[4].energy[1] > result[4].energy[0] * 100 && result[4].total > 0.01, 'Right position must render in right channel');
    check(result[6].total < result[5].total * 0.2, 'Distant sound must be quieter than near sound');
    check(result[7].peak < 0.98 && result[7].peak > 0.05, 'Battle mix must be audible with peak headroom');
    check(budget._ok(1), 'Audio-time budget must release completed voices');

    const cases = [
      ...WEAPONS.map(w => [w.id, e => w.fire === 'melee' ? e.melee('swing', w.id) : w.fire === 'flame' ? e.flame(1) : e.shot(w.sound)]),
      ...WEAPONS.filter(w => w.fire === 'melee').map(w => [w.id + ' heavy hit', e => e.melee('hit', w.id, true)]),
      ['footstep', e => e.footstep()], ['dash', e => e.dash()], ['grenade', e => e.grenade('throw')],
      ['grenade detonate', e => e.grenade('detonate')], ['screech', e => e.screech()],
      ['spit', e => e.spit()], ['flesh', e => e.hitFlesh()], ['wall', e => e.hitWall()],
      ['gib', e => e.gib()], ['reload', e => e.reload('in')], ['dry fire', e => e.dryFire()],
      ['pickup', e => e.pickup('weapon')], ['flame', e => e.flame(1)], ['spin', e => e.spinup(true, 0.8)],
      ...['hover', 'select', 'back', 'error', 'tick', 'wave', 'crit'].map(kind => ['ui ' + kind, e => e.ui(kind)]),
      ...['start', 'victory', 'defeat', 'zone', 'countdown'].map(kind => ['match ' + kind, e => e.match(kind)])
    ];
    const sounds = await Promise.all(cases.map(async ([name, play]) => {
      const engine = fixture(); play(engine);
      const sound = await render(engine);
      check(sound.total > 0.00001 && sound.peak < 1, name + ' must render audible finite samples without clipping');
      return name;
    }));
    report.textContent = 'PASS audio: ' + assertions + ' assertions; ' + sounds.length +
      ' individual sounds; battle peak=' + result[7].peak.toFixed(3);
  } catch (error) { report.textContent = 'FAIL audio: ' + (error.stack || error.message); }
}

const tempRoot = path.resolve(os.tmpdir());
const temp = fs.mkdtempSync(path.join(tempRoot, 'pixel-protocol-audio-'));
const source = fs.readFileSync(path.join(__dirname, '..', 'src', '10-audio.js'), 'utf8') + '\n' + fs.readFileSync(path.join(__dirname, '..', 'src', '60-weapons.js'), 'utf8');
async function main() {
  const pending = []; let done = false;
  // Keep the page's load event pending while OfflineAudioContext renders on
  // its real audio thread. Virtual-time budgets can finish before that thread.
  const page = '<!doctype html><meta charset="utf-8"><img hidden src="/hold"><pre id="result">PENDING</pre><script>' +
    'const damp=(a,b,k,dt)=>a+(b-a)*(1-Math.exp(-k*dt));\n' + source + '\n(' + probe.toString() +
    ')().finally(()=>fetch("/done"));</script>';
  const server = http.createServer((request, response) => {
    if (request.url === '/hold' && !done) { pending.push(response); return; }
    if (request.url === '/done') {
      done = true; for (const held of pending) held.end(); response.end(); return;
    }
    if (request.url === '/') { response.setHeader('Content-Type', 'text/html; charset=utf-8'); response.end(page); }
    else response.end();
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const { stdout: dom } = await promisify(execFile)(browser, ['--headless=new', '--disable-gpu', '--no-sandbox', '--mute-audio',
      '--user-data-dir=' + path.join(temp, 'profile'), '--dump-dom',
      'http://127.0.0.1:' + server.address().port + '/'], { encoding: 'utf8', timeout: 60000,
      maxBuffer: 4 * 1024 * 1024, windowsHide: true });
    const result = dom.match(/<pre id="result">([\s\S]*?)<\/pre>/);
    const message = result ? result[1].replace(/&gt;/g, '>').replace(/&lt;/g, '<').replace(/&amp;/g, '&') : 'FAIL: browser returned no audio report';
    console.log(message);
    if (!message.startsWith('PASS audio:')) process.exitCode = 1;
  } finally {
    server.closeAllConnections(); server.close();
    // Delete only the unique directory this test created under the OS temp root.
    if (path.dirname(path.resolve(temp)) === tempRoot && path.basename(temp).startsWith('pixel-protocol-audio-')) {
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
    }
  }
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });
