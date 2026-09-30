/* Controls: the action layer, rebinding, its persistence, and the gamepad.
   A pad is just a snapshot object, so navigator.getGamepads() is stubbed and
   the whole mapping runs without hardware or a browser.
   Run: node tools/controlstest.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');
let pads = [];
const listeners = {};
const noop = () => {};
const dom = {
  addEventListener: (type, fn) => { listeners[type] = fn; },
  getBoundingClientRect: () => ({ left: 0, top: 0, width: 100, height: 100 })
};
const storage = new Map();
const context = {
  console, Math,
  navigator: { getGamepads: () => pads },
  document: { body: { classList: { contains: () => true } } },
  window: {
    addEventListener: noop,
    localStorage: {
      getItem: (k) => (storage.has(k) ? storage.get(k) : null),
      setItem: (k, v) => storage.set(k, String(v))
    }
  },
  THREE: { Vector3: function () {}, Quaternion: function () {}, Euler: function () {} },
  sfx: new Proxy({}, { get: () => noop })
};
vm.createContext(context);
// only the files the action layer needs; the player model is not involved
for (const file of ['00-util.js', '05-save.js', '45-customize.js', '60-weapons.js']) {
  new vm.Script(fs.readFileSync(path.join(root, 'src', file), 'utf8'), { filename: file }).runInContext(context);
}
// 80-player.js also defines the marine, which needs geometry we do not have
// here; take just the control section, which ends where the marine begins
const player = fs.readFileSync(path.join(root, 'src', '80-player.js'), 'utf8');
const cut = player.indexOf('const PLAYER_RADIUS');
assert(cut > 0, 'could not find the end of the control section in 80-player.js');
new vm.Script(player.slice(0, cut), { filename: '80-player-controls.js' }).runInContext(context);

const { InputState, ACTIONS, ACTION_BY_ID, defaultBinds, clampBinds, loadBinds, saveBinds, store,
  MAX_BINDS_PER_ACTION, PAD_DEADZONE } =
  vm.runInContext('({ InputState, ACTIONS, ACTION_BY_ID, defaultBinds, clampBinds, loadBinds, saveBinds, store, ' +
    'MAX_BINDS_PER_ACTION, PAD_DEADZONE })', context);

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const input = () => new InputState(dom);
const padOf = (buttons, axes) => [{
  connected: true,
  buttons: (buttons || []).map((v) => ({ pressed: !!v, value: v ? 1 : 0 })),
  axes: axes || [0, 0, 0, 0]
}];

/* ---------------------------------------------------------------- table */
{
  const seen = new Set();
  for (const action of ACTIONS) {
    check(!seen.has(action.id), 'duplicate action id ' + action.id);
    seen.add(action.id);
    check(typeof action.label === 'string' && action.label.length > 0, action.id + ' has no label');
    check(Array.isArray(action.keys), action.id + ' has no default key list');
    check(ACTION_BY_ID[action.id] === action, action.id + ' missing from the index');
    if (action.pad) for (const b of action.pad) {
      check(Number.isInteger(b) && b >= 0 && b < 20, action.id + ' maps to an impossible pad button');
    }
  }
  // two actions sharing a key would make one of them unreachable
  const owner = {};
  for (const action of ACTIONS) for (const code of action.keys) {
    check(!owner[code], 'default binding ' + code + ' is claimed by both ' + owner[code] + ' and ' + action.id);
    owner[code] = action.id;
  }
  // and the same for pad buttons
  const padOwner = {};
  for (const action of ACTIONS) for (const b of (action.pad || [])) {
    check(!padOwner[b], 'pad button ' + b + ' is claimed by both ' + padOwner[b] + ' and ' + action.id);
    padOwner[b] = action.id;
  }
  // every action a player could need in combat has to be reachable somehow
  for (const id of ['moveUp', 'moveDown', 'moveLeft', 'moveRight', 'dash', 'grenade', 'reload']) {
    const action = ACTION_BY_ID[id];
    check(action && (action.keys.length || action.pad), id + ' is unreachable by any device');
  }
}

/* ------------------------------------------------------------- clamping */
{
  const base = defaultBinds();
  check(base.moveUp.indexOf('KeyW') >= 0, 'the default forward key is missing');
  check(clampBinds(null).moveUp.join() === base.moveUp.join(), 'garbage did not fall back to defaults');
  for (const bad of [undefined, 'text', 42, []]) {
    check(clampBinds(bad).dash.join() === base.dash.join(), 'bad input changed a binding: ' + String(bad));
  }
  // only real key codes survive
  const dirty = clampBinds({ dash: ['KeyJ', 'rm -rf /', 'KeyJ', 'Escape', 5, null, 'KeyZ', 'KeyY'] });
  check(dirty.dash.indexOf('rm -rf /') < 0, 'an arbitrary string was accepted as a key code');
  check(dirty.dash.filter((c) => c === 'KeyJ').length === 1, 'a duplicate key survived');
  check(dirty.dash.length <= MAX_BINDS_PER_ACTION, 'the per-action cap was exceeded');
  // an unknown action cannot be smuggled in
  check(clampBinds({ selfDestruct: ['KeyK'] }).selfDestruct === undefined, 'an unknown action survived the clamp');
  // an explicit unbind is a real choice and must be kept
  check(clampBinds({ music: [] }).music.length === 0, 'an explicit unbind was overwritten by the default');
  // a list of nothing usable falls back rather than leaving the action dead
  check(clampBinds({ dash: ['nonsense', 7] }).dash.join() === base.dash.join(),
    'an all-garbage list left the action unbound');
}

/* ------------------------------------------------------------ the layer */
{
  const i = input();
  check(i.actionDown('moveUp') === false, 'an untouched key reported as held');
  i.keys.KeyW = true;
  check(i.actionDown('moveUp'), 'a bound key did not register');
  check(!i.actionDown('moveDown'), 'a key triggered the wrong action');
  i.keys.KeyW = false;
  i.keys.ArrowUp = true;
  check(i.actionDown('moveUp'), 'the alternate default key did not register');

  // edges fire once and are consumed from every source at the same time
  const j = input();
  j.pressed.KeyR = true;
  check(j.actionOnce('reload'), 'a press did not fire its action');
  check(!j.actionOnce('reload'), 'a press fired twice');
  const k = input();
  k.pressed.Escape = true; k.pressed.KeyP = true;
  check(k.actionOnce('pause'), 'pause did not fire');
  check(!k.actionOnce('pause'), 'a second bound key stayed latched and fired again');
}

/* ----------------------------------------------------------- rebinding */
{
  storage.clear();
  const i = input();
  check(i.rebind('dash', ['KeyC']), 'a valid rebind was refused');
  check(i.actionDown('dash') === false, 'rebinding activated the action');
  i.keys.KeyC = true;
  check(i.actionDown('dash'), 'the new key does not work');
  i.keys.KeyC = false;
  i.keys.Space = true;
  check(!i.actionDown('dash'), 'the old key still works after rebinding');
  check(!i.rebind('noSuchAction', ['KeyC']), 'an unknown action was rebound');
  // it survives a reload, because it went through the profile
  const reloaded = input();
  check(reloaded.binds.dash.join() === 'KeyC', 'the rebinding did not persist');
  // and reset puts everything back
  reloaded.resetBinds();
  check(reloaded.binds.dash.join() === defaultBinds().dash.join(), 'reset did not restore the default');
  check(input().binds.dash.join() === defaultBinds().dash.join(), 'the reset did not persist');
  // a hand-edited profile cannot inject nonsense
  store.set('binds', { dash: ['KeyC', 'not a key'], ghostAction: ['KeyZ'] });
  const guarded = input();
  check(guarded.binds.dash.join() === 'KeyC', 'a tampered binding was not cleaned');
  check(guarded.binds.ghostAction === undefined, 'an unknown action reached the input layer');
  storage.clear();
}

/* ------------------------------------------------------------- gamepad */
{
  pads = [];
  const i = input();
  check(i.pollPad() === false, 'a missing pad reported as present');
  check(i.padActive === false, 'a missing pad reported as active');
  check(i.stick(0, 1) === null, 'a missing pad produced a stick reading');

  pads = padOf([true], [0, 0, 0, 0]);
  check(i.pollPad() === true, 'a connected pad was not seen');
  check(i.actionDown('dash'), 'a held pad button did not reach its action');
  check(i.actionOnce('dash'), 'a pad press did not fire an edge');
  check(!i.actionOnce('dash'), 'a pad press fired twice in one tick');
  i.endFrame();
  check(!i.actionOnce('dash'), 'a held pad button fired again without release');
  check(i.actionDown('dash'), 'a held pad button stopped reading as held');

  // releasing and pressing again is a new edge
  pads = padOf([false]);
  i.pollPad(); i.endFrame();
  pads = padOf([true]);
  i.pollPad();
  check(i.actionOnce('dash'), 'a re-press produced no edge');

  // unplugging clears the held state instead of leaving it stuck on
  pads = [];
  i.pollPad();
  check(!i.actionDown('dash'), 'unplugging the pad left a button held');

  // sticks: deadzone, direction, and a rescaled magnitude
  const s = input();
  pads = padOf([], [0.1, -0.1, 0, 0]);
  s.pollPad();
  check(s.stick(0, 1) === null, 'resting stick drift was not filtered');
  pads = padOf([], [0, -1, 0, 0]);
  s.pollPad();
  const up = s.stick(0, 1);
  check(up !== null, 'a fully pushed stick read as centred');
  check(Math.abs(up.z + 1) < 1e-6 && Math.abs(up.x) < 1e-6, 'the stick pointed the wrong way');
  check(Math.abs(up.len - 1) < 1e-6, 'a fully pushed stick was not at full magnitude');
  // just past the deadzone is a slow walk, not a jump
  pads = padOf([], [0, -(PAD_DEADZONE + 0.02), 0, 0]);
  s.pollPad();
  const crawl = s.stick(0, 1);
  check(crawl !== null && crawl.len < 0.1, 'the first usable stick value jumps instead of easing in');
  // the right stick is read independently
  pads = padOf([], [0, 0, 1, 0]);
  s.pollPad();
  check(s.stick(0, 1) === null, 'the right stick moved the left one');
  check(s.stick(2, 3) !== null, 'the right stick was not readable');
  pads = [];
}

/* a pad with the shapes an odd driver can produce must not throw */
{
  const i = input();
  for (const weird of [[{ connected: true }], [{ connected: true, buttons: [1, 0], axes: [] }],
    [null], [{ connected: false, buttons: [{ pressed: true }] }]]) {
    pads = weird;
    i.pollPad();
    i.actionDown('dash');
    i.stick(0, 1);
    checks++;
  }
  pads = [];
}

console.log('CONTROLS_OK: ' + checks + ' assertions; ' + ACTIONS.length +
  ' actions, clamped rebinding through the profile, pad buttons, edges and analogue sticks');
