/* Bundles vendor three.js + src/*.js into a single self-contained index.html.
   No bundler, no network at runtime: the page works from file://. */

const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const srcDir = path.join(root, 'src');

/* three.module.js ends with one `export { A, B, C };` statement. Rewriting the
   keyword turns it into a shorthand object literal, which is exactly the
   namespace the game code expects — no module loader required. */
function inlineThree() {
  const file = path.join(root, 'vendor', 'three.module.js');
  let code = fs.readFileSync(file, 'utf8');
  const before = code;
  code = code.replace(/^export \{/m, 'const THREE = {');
  if (code === before) {
    throw new Error('three.module.js: expected a top-level `export {` statement');
  }
  if (/^import[\s{]/m.test(code)) {
    throw new Error('three.module.js: unexpected import statement, build assumes a flat bundle');
  }
  return code;
}

function gameSources() {
  const files = fs.readdirSync(srcDir)
    .filter((f) => f.endsWith('.js'))
    .sort();
  return files.map((f) => {
    const body = fs.readFileSync(path.join(srcDir, f), 'utf8');
    return '\n/* ==== ' + f + ' ==== */\n' + body;
  }).join('\n');
}

/* Isolate Tween's module names from Three's namespace; keep the pinned
   official distribution local so index.html remains fully offline. */
function inlineTween() {
  let code = fs.readFileSync(path.join(root, 'vendor', 'tween.module.js'), 'utf8');
  if (!/^export \{[^\n]+\};?\s*$/m.test(code) || /^import\s/m.test(code)) {
    throw new Error('Unexpected Tween module format');
  }
  code = code.replace(/^export \{[^\n]+\};?\s*$/m, 'return { Tween, Group, Easing, VERSION };');
  return '\nconst TWEEN = (function(){\n' + code + '\n})();\n';
}

function build() {
  const three = inlineThree();
  const game = gameSources();

  // the game lives in its own scope so its names cannot collide with three's
  const bundle = three + inlineTween() + '\n\n(function(){\n' + game + '\n})();\n';

  const shell = fs.readFileSync(path.join(srcDir, 'shell.html'), 'utf8');
  const token = '/*__GAME_BUNDLE__*/';
  if (shell.indexOf(token) === -1) throw new Error('shell.html is missing ' + token);
  // function replacement: the bundle contains $ sequences that would otherwise
  // be interpreted as replacement patterns
  const out = shell.replace(token, () => bundle);

  const target = path.join(root, 'index.html');
  fs.writeFileSync(target, out, 'utf8');

  const kb = (Buffer.byteLength(out, 'utf8') / 1024).toFixed(0);
  console.log('built index.html  (' + kb + ' KB)');
  return target;
}

build();
