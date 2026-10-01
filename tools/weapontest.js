/* Native WebGL portraits and smooth facility textures. Optional KEEP_VISUAL=1
   retains the equipment contact sheet in the OS temporary directory. */
const fs = require('fs'), path = require('path'), os = require('os'), http = require('http');
const { execFile } = require('child_process'), { promisify } = require('util');
const root = path.resolve(__dirname, '..');
const browser = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe'].find(p => p && fs.existsSync(p));
async function probe() {
  let checks = 0; const check = (condition, why) => { if (!condition) throw new Error(why); checks++; };
  initPrimitives(); buildWeaponGeometries(); buildPickupGeometries(); buildTextures();
  for (const [id, texture] of Object.entries(TEX).flatMap(([id, value]) => Array.isArray(value) ? value.map((texture, i) => [id + i, texture]) : [[id, value]])) {
    if (!/floor|wall|hazard|marking|vent/i.test(id)) continue;
    check(texture.image.width === 512, id + ' must be512px');
    check(texture.magFilter === THREE.LinearFilter && texture.minFilter === THREE.LinearMipmapLinearFilter && texture.generateMipmaps,
      id + ' must filter and mipmap');
  }
  const grid = document.getElementById('grid');
  const supply = createPickupModel('ammo', 'supply'), medical = createPickupModel('bigHealth');
  let disposedShared = 0;
  const countDispose = () => { disposedShared++; };
  const sharedAssets = [...new Set([supply.geometry, medical.geometry, ...supply.material, ...medical.material])];
  sharedAssets.forEach(asset => asset.addEventListener('dispose', countDispose));
  const items = [...WEAPONS.map(w => ({ id: w.id, name: w.name, get: () => weaponPortraits.get(w.id) })),
    { id: 'item:ammo:supply', name: 'SUPPLY / AMMUNITION', get: () => weaponPortraits.getItem('ammo', 'supply') },
    { id: 'item:health', name: 'MEDICAL CASE', get: () => weaponPortraits.getItem('health') },
    { id: 'item:bigHealth', name: 'FIELD MEDICAL CASE', get: () => weaponPortraits.getItem('bigHealth') },
    ...['rifle', 'shell', 'fuel', 'rocket', 'grenade', 'cell', 'bolt'].map(type => ({
      id: 'item:ammo:' + type, name: 'AMMUNITION / ' + type.toUpperCase(), get: () => weaponPortraits.getItem('ammo', type)
    }))];
  const seen = new Set();
  for (const w of items) {
    const url = w.get(); check(!!url && !weaponPortraits.failed, w.id + ' portrait missing');
    check(w.get() === url, w.id + ' portrait must remain cached');
    check(!seen.has(url), w.id + ' duplicated portrait'); seen.add(url);
    const img = new Image(); img.src = url; await img.decode();
    check(img.naturalWidth === 320 && img.naturalHeight === 192, w.id + ' resolution');
    const canvas = document.createElement('canvas'); canvas.width = 320; canvas.height = 192;
    const ctx = canvas.getContext('2d'); ctx.drawImage(img, 0, 0); const data = ctx.getImageData(0, 0, 320, 192).data;
    let ink = 0, edge = 0;
    for (let y = 0; y < 192; y++) for (let x = 0; x < 320; x++) {
      const alpha = data[(y * 320 + x) * 4 + 3];
      if (alpha > 24) ink++;
      if ((x < 2 || x > 317 || y < 2 || y > 189) && alpha > 24) edge++;
    }
    check(ink > 550 && ink < 320 * 192 * .6, w.id + ' empty/oversized silhouette: ' + ink);
    check(edge === 0, w.id + ' portrait is clipped');
    const card = document.createElement('article'), label = document.createElement('label'); label.textContent = w.name;
    card.append(img, label); grid.append(card);
  }
  check(weaponPortraits.getItem('ammo') === weaponPortraits.getItem('ammo', 'supply'), 'default ammo portrait is the supply case');
  const weaponCache = weaponPortraits.cache, itemCache = weaponPortraits.itemCache;
  weaponPortraits.build();
  check(weaponCache === weaponPortraits.cache && itemCache === weaponPortraits.itemCache, 'repeat build must retain cached images');
  check(Object.keys(weaponPortraits.cache).length === WEAPONS.length, 'legacy weapon cache contains only weapons');
  check(Object.keys(weaponPortraits.itemCache).length === Object.keys(AMMO_TYPES).length + 2, 'all ammunition and medical portraits cached');
  check(disposedShared === 0, 'portrait renderer must keep shared pickup resources alive');
  check(createPickupModel('ammo', 'supply').geometry === supply.geometry, 'ammo instances must share their geometry');
  check(createPickupModel('bigHealth').material === medical.material, 'medical instances must share their materials');
  sharedAssets.forEach(asset => asset.removeEventListener('dispose', countDispose));
  const report = 'PASS weapons: ' + checks + ' native WebGL/texture assertions;' + items.length + ' inspected antialiased equipment portraits';
  document.getElementById('result').textContent = report;
  // Native image.decode() may settle after --dump-dom has taken its snapshot.
  // The completed browser probe reports directly, avoiding that timing race.
  await fetch('/report', { method: 'POST', body: report });
}
async function main() {
  if (!browser) throw new Error('Chrome or CHROME_PATH required');
  const tempRoot = path.resolve(os.tmpdir()), temp = fs.mkdtempSync(path.join(tempRoot, 'protocol-weapons-'));
  const files = ['00-util.js', '20-textures.js', '40-models.js', '58-portraits.js', '60-weapons.js'];
  const source = files.map(file => fs.readFileSync(path.join(root, 'src', file), 'utf8')).join('\n');
  const page = '<!doctype html><meta charset="utf-8"><style>body{margin:18px;background:#101b25;color:#d6e6ed;font:13px Arial}#grid{display:grid;grid-template-columns:repeat(5,320px);gap:10px}article{background:linear-gradient(135deg,#233541,#15232d);border:1px solid #344b58}img{display:block;width:320px;height:192px}label{display:block;padding:0 12px 12px;letter-spacing:1px}pre{font:15px Arial}</style><pre id="result">PENDING</pre><main id="grid"></main><script type="module">import * as THREE from "/three.js";\n' + source + '\n(' + probe.toString() + ')().catch(e=>document.getElementById("result").textContent="FAIL weapons: "+e.stack);</script>';
  let reported = null;
  const server = http.createServer((req, res) => {
    if (req.url === '/report' && req.method === 'POST') {
      let body = ''; req.on('data', chunk => { body += chunk; });
      req.on('end', () => { reported = body; res.writeHead(204); res.end(); }); return;
    }
    res.setHeader('Content-Type', req.url === '/three.js' ? 'application/javascript' : 'text/html; charset=utf-8');
    res.end(req.url === '/three.js' ? fs.readFileSync(path.join(root, 'vendor', 'three.module.js')) : page);
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const screenshot = path.join(temp, 'weapons.png');
    const { stdout } = await promisify(execFile)(browser, ['--headless=new', '--no-sandbox', '--use-gl=angle', '--use-angle=swiftshader',
      '--enable-unsafe-swiftshader', '--hide-scrollbars', '--user-data-dir=' + path.join(temp, 'profile'), '--window-size=1690,1740',
      '--virtual-time-budget=5000', '--screenshot=' + screenshot, '--dump-dom', 'http://127.0.0.1:' + server.address().port],
      { encoding: 'utf8', timeout: 60000, maxBuffer: 8 * 1024 * 1024, windowsHide: true });
    const match = stdout.match(/<pre id="result">([\s\S]*?)<\/pre>/), message = reported || (match ? match[1] : 'FAIL no report');
    console.log(message); if (!message.startsWith('PASS weapons:')) process.exitCode = 1;
    if (process.env.KEEP_VISUAL) console.log('CONTACT_SHEET=' + screenshot);
  } finally {
    server.closeAllConnections(); server.close();
    if (!process.env.KEEP_VISUAL && path.dirname(path.resolve(temp)) === tempRoot && path.basename(temp).startsWith('protocol-weapons-')) {
      try { fs.rmSync(temp, { recursive: true, force: true }); } catch (_) {}
    }
  }
}
main().catch(e => { console.error(e.stack || e); process.exitCode = 1; });
