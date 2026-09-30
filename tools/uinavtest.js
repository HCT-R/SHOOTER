/* Menu navigation: the spatial pick, the held-direction repeat, the controls
   that answer left/right with a value, and the screen table itself.
   The DOM half is covered by the browser probe; everything decided here is
   decided by pure functions, so it runs without a browser.
   Run: node tools/uinavtest.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const root = path.resolve(__dirname, '..');
const noop = () => {};
const storage = new Map();
const context = {
  console, Math, Event: class { constructor(type) { this.type = type; } },
  navigator: { getGamepads: () => [] },
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
/* The keyboard may only offer characters the profile keeps, so the profile's
   own rule is loaded and asked rather than restated here. */
for (const src of ['00-util.js', '05-save.js', '45-customize.js', '93-uinav.js']) {
  new vm.Script(fs.readFileSync(path.join(root, 'src', src), 'utf8'), { filename: src }).runInContext(context);
}

const { pickNeighbour, NavRepeat, navAdjustable, navAdjust, navKey,
  NAV_SCREENS, NAV_SELECTOR, NAV_KEYS, NAV_REPEAT_FIRST, NAV_REPEAT_NEXT,
  OSK_ROWS, oskType, NICKNAME_MAX, sanitizeNickname } =
  vm.runInContext('({ pickNeighbour, NavRepeat, navAdjustable, navAdjust, navKey, ' +
    'NAV_SCREENS, NAV_SELECTOR, NAV_KEYS, NAV_REPEAT_FIRST, NAV_REPEAT_NEXT, ' +
    'OSK_ROWS, oskType, NICKNAME_MAX, sanitizeNickname })', context);

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const rect = (left, top, width, height) => ({ left, top, width, height });

/* ------------------------------------------------------- the screen table */
{
  const shell = fs.readFileSync(path.join(root, 'src', 'shell.html'), 'utf8');
  // the focusable elements of a screen are rendered either by the HUD or by
  // the boot file, so both count as somewhere they could come from
  const built = fs.readFileSync(path.join(root, 'src', '90-hud.js'), 'utf8') +
    fs.readFileSync(path.join(root, 'src', '99-main.js'), 'utf8');
  const seen = new Set();
  for (const def of NAV_SCREENS) {
    check(!seen.has(def.id), 'duplicate screen ' + def.id);
    seen.add(def.id);
    // a typo here disables navigation on a whole screen and nothing else fails
    check(shell.indexOf('id="' + def.id + '"') >= 0, def.id + ' is not a screen in shell.html');
    if (def.back) {
      check(shell.indexOf('id="' + def.back + '"') >= 0, def.id + ' closes with a button that does not exist');
    }
    if (def.first && def.first.charAt(0) === '#') {
      check(shell.indexOf('id="' + def.first.slice(1) + '"') >= 0,
        def.id + ' opens on a button that does not exist: ' + def.first);
    } else if (def.first) {
      const attr = /\[([a-z-]+)\]/.exec(def.first);
      check(attr !== null, def.id + ' has an unreadable first selector: ' + def.first);
      // the attribute may be written as markup or set as a dataset property
      const property = attr[1].replace(/^data-/, '').replace(/-(.)/g, (m, c) => c.toUpperCase());
      check(built.indexOf(attr[1] + '="') >= 0 || built.indexOf('dataset.' + property) >= 0,
        def.id + ' opens on ' + attr[1] + ', which nothing ever renders');
    }
  }
  // the doctrine pick is the one screen that must not be dismissible
  check(!NAV_SCREENS.find((d) => d.id === 'perkScreen').back, 'the doctrine screen can be backed out of');
  // the shop and the station are modal over the run and must be dismissible
  for (const id of ['upgradeScreen', 'stationScreen', 'pause']) {
    check(NAV_SCREENS.find((d) => d.id === id).back, id + ' cannot be closed from a pad');
  }
  // doctrine and supply open over the pause screen, so they must win the search
  const order = NAV_SCREENS.map((d) => d.id);
  check(order.indexOf('perkScreen') < order.indexOf('pause'), 'the pause screen outranks the doctrine screen');
  check(order.indexOf('upgradeScreen') < order.indexOf('pause'), 'the pause screen outranks the shop');
  check(order.indexOf('stationScreen') < order.indexOf('start'), 'the menu outranks the station');
  check(order.indexOf('stationScreen') < order.indexOf('gameover'), 'the death screen outranks the station');
  check(NAV_SELECTOR.indexOf('button') >= 0 && NAV_SELECTOR.indexOf('disabled') >= 0,
    'the selector would pick up disabled buttons');
  /* A focused text field owns the arrow keys, so navigation must never land
     on one; the callsign is reached through the on-screen keyboard instead. */
  check(NAV_SELECTOR.indexOf(':not([type=text])') >= 0, 'a text field could take navigation focus');
  check(order.indexOf('oskScreen') < order.indexOf('custScreen'),
    'the editor outranks the keyboard that opens over it');
  check(order.indexOf('custScreen') < order.indexOf('start'), 'the menu outranks the editor');
  check(NAV_SCREENS.find((d) => d.id === 'oskScreen').back, 'the keyboard cannot be closed from a pad');
  check(NAV_SCREENS.find((d) => d.id === 'custScreen').back, 'the editor cannot be closed from a pad');
  for (const code of ['ArrowUp', 'ArrowDown', 'KeyW', 'KeyS']) {
    check(NAV_KEYS.indexOf(code) >= 0, code + ' does not steer a menu');
  }
}

/* ------------------------------------------------------- a vertical list */
{
  // three stacked buttons, as the menu and the death screen have
  const list = [rect(100, 100, 200, 40), rect(100, 160, 200, 40), rect(100, 220, 200, 40)];
  check(pickNeighbour(list, 0, 0, 1) === 1, 'down did not reach the next button');
  check(pickNeighbour(list, 1, 0, 1) === 2, 'down did not reach the last button');
  check(pickNeighbour(list, 2, 0, -1) === 1, 'up did not reach the previous button');
  // a list wraps, or the last item is a dead end on a pad
  check(pickNeighbour(list, 2, 0, 1) === 0, 'the bottom of the list did not wrap to the top');
  check(pickNeighbour(list, 0, 0, -1) === 2, 'the top of the list did not wrap to the bottom');
  // there is nothing to the side of a single column
  check(pickNeighbour(list, 1, 1, 0) === -1, 'a column produced a sideways neighbour');
  check(pickNeighbour(list, 0, 0, 0) === -1, 'no direction produced a move');
  check(pickNeighbour([rect(0, 0, 10, 10)], 0, 0, 1) === -1, 'a lone item moved somewhere');
  check(pickNeighbour(list, 7, 0, 1) === -1, 'a missing origin produced a neighbour');
}

/* --------------------------------------------- the shop: a grid with pins */
{
  /* Four cards side by side. Each has a pin in its top-left corner and a wide
     buy button along its bottom; below them sit the reroll and close buttons.
     This is the layout that makes a naive "nearest centre" pick go wrong. */
  const items = [];
  const label = [];
  for (let i = 0; i < 4; i++) {
    const x = 60 + i * 220;
    items.push(rect(x + 8, 120, 26, 26)); label.push('pin' + i);
    items.push(rect(x + 10, 250, 180, 44)); label.push('buy' + i);
  }
  items.push(rect(60, 330, 400, 40)); label.push('reroll');
  items.push(rect(60, 390, 400, 40)); label.push('close');
  const at = (name) => label.indexOf(name);
  const go = (name, dx, dy) => label[pickNeighbour(items, at(name), dx, dy)];

  check(go('pin0', 1, 0) === 'pin1', 'right from a pin left its row');
  check(go('pin1', -1, 0) === 'pin0', 'left from a pin left its row');
  check(go('pin0', 0, 1) === 'buy0', 'down from a pin did not reach its own card');
  check(go('buy0', 1, 0) === 'buy1', 'right from a buy button left its row');
  check(go('buy0', 0, -1) === 'pin0', 'up from a buy button did not reach its own pin');
  check(go('buy0', 0, 1) === 'reroll', 'down from the last card row did not reach the reroll');
  check(go('reroll', 0, 1) === 'close', 'down from the reroll did not reach the close button');
  check(go('buy3', 0, 1) === 'reroll', 'the rightmost card did not reach the wide row below');
  // the wide rows span the grid, so leaving them upwards lands on a card
  check(go('reroll', 0, -1).indexOf('buy') === 0, 'up from the reroll did not reach a card');
}

/* ------------------------------------------------- doctrine: three cards */
{
  const cards = [rect(60, 200, 240, 60), rect(320, 200, 240, 60), rect(580, 200, 240, 60)];
  check(pickNeighbour(cards, 0, 1, 0) === 1, 'right did not reach the middle card');
  check(pickNeighbour(cards, 2, 1, 0) === 0, 'the last card did not wrap to the first');
  check(pickNeighbour(cards, 0, -1, 0) === 2, 'the first card did not wrap to the last');
  check(pickNeighbour(cards, 1, 0, 1) === -1, 'a single row produced a vertical neighbour');
}

/* ------------------------------------------------------------- the repeat */
{
  const r = new NavRepeat();
  check(r.step(0, 0, 1 / 60) === false, 'a released direction moved the focus');
  check(r.step(0, 1, 1 / 60) === true, 'a fresh press did not move at once');
  check(r.step(0, 1, 1 / 60) === false, 'a held direction repeated immediately');
  let elapsed = 0, steps = 0;
  while (elapsed < NAV_REPEAT_FIRST) { elapsed += 1 / 60; if (r.step(0, 1, 1 / 60)) steps++; }
  check(steps === 0 || steps === 1, 'the first repeat came at the wrong time: ' + steps);
  // once repeating, the rate is the faster one
  let fast = 0;
  for (let i = 0; i < 60; i++) if (r.step(0, 1, 1 / 60)) fast++;
  const expected = Math.floor(1 / NAV_REPEAT_NEXT);
  check(Math.abs(fast - expected) <= 1, 'the repeat rate is ' + fast + ' a second, not about ' + expected);
  // a new direction is immediate, not queued behind the running repeat
  check(r.step(1, 0, 1 / 60) === true, 'turning to a new direction waited for the repeat');
  // releasing resets, so the next press is immediate again
  r.step(0, 0, 1 / 60);
  check(r.step(0, -1, 1 / 60) === true, 'a press after a release was not immediate');
  check(NAV_REPEAT_FIRST > NAV_REPEAT_NEXT, 'the first repeat is not slower than the rest');
}

/* --------------------------------------------- sliders, boxes and selects */
{
  const events = [];
  const el = (props) => Object.assign({
    dispatchEvent: (e) => { events.push(e.type); return true; },
    tagName: 'INPUT'
  }, props);

  const button = el({ tagName: 'BUTTON' });
  check(!navAdjustable(button), 'a button was treated as a value');
  check(navAdjust(button, 1) === false, 'a button was adjusted');
  check(!navAdjustable(null), 'nothing was treated as a value');

  const volume = el({ type: 'range', min: '0', max: '100', step: '', value: '55' });
  check(navAdjustable(volume), 'a slider is not adjustable');
  navAdjust(volume, 1);
  check(volume.value === '60', 'right moved the slider to ' + volume.value);
  navAdjust(volume, -1);
  check(volume.value === '55', 'left did not move the slider back');
  check(events.indexOf('input') >= 0, 'the slider never told anyone it changed');
  volume.value = '98';
  navAdjust(volume, 1);
  check(volume.value === '100', 'the slider passed its maximum: ' + volume.value);
  // at the limit the press is still consumed, or the focus would jump away
  check(navAdjust(volume, 1) === true, 'a slider at its maximum released the press');
  volume.value = '2';
  navAdjust(volume, -1);
  check(volume.value === '0', 'the slider passed its minimum: ' + volume.value);

  const box = el({ type: 'checkbox', checked: true });
  check(navAdjustable(box), 'a checkbox is not adjustable');
  navAdjust(box, 1);
  check(box.checked === false, 'the checkbox did not toggle');
  navAdjust(box, -1);
  check(box.checked === true, 'the checkbox did not toggle back');
  check(events.indexOf('change') >= 0, 'the checkbox never told anyone it changed');

  const pixels = el({ tagName: 'SELECT', selectedIndex: 0, options: { length: 5 } });
  check(navAdjustable(pixels), 'a dropdown is not adjustable');
  navAdjust(pixels, 1);
  check(pixels.selectedIndex === 1, 'right did not advance the dropdown');
  navAdjust(pixels, -1);
  check(pixels.selectedIndex === 0, 'left did not move the dropdown back');
  check(navAdjust(pixels, -1) === true, 'a dropdown at its first option released the press');
  check(pixels.selectedIndex === 0, 'the dropdown moved before its first option');
  pixels.selectedIndex = 4;
  navAdjust(pixels, 1);
  check(pixels.selectedIndex === 4, 'the dropdown moved past its last option');
}

/* ------------------------------------------------------------ focus keys */
{
  const el = (props) => Object.assign({ tagName: 'BUTTON', dataset: {}, textContent: '' }, props);
  check(navKey(el({ id: 'upgradeClose' })) === '#upgradeClose', 'an id was not used as the key');
  const slot1 = el({ dataset: { slot: '1' } }), slot2 = el({ dataset: { slot: '2' } });
  check(navKey(slot1) !== navKey(slot2), 'two shop slots share one key');
  // an id wins over the data attribute, so a key never depends on read order
  check(navKey(el({ id: 'x', dataset: { slot: '1' } })) === '#x', 'the data attribute beat the id');
  // the shop rebuilds its grid on every purchase: the same slot must keep its
  // key across the rebuild, or the focus silently slides to another card
  check(navKey(el({ dataset: { slot: '1' } })) === navKey(slot1), 'a rebuilt slot changed its key');
  check(navKey(el({ dataset: { perk: 'ferocity' } })) === 'perk:ferocity', 'a perk card has no stable key');
  check(navKey(el({ textContent: 'ПРОДОЛЖИТЬ' })) !== navKey(el({ textContent: 'В МЕНЮ' })),
    'two plain buttons share one key');
  check(navKey(null) === null, 'nothing produced a key');
}

/* ------------------------------------------------ the on-screen keyboard */
{
  const layouts = Object.keys(OSK_ROWS);
  check(layouts.indexOf('ru') >= 0 && layouts.indexOf('en') >= 0, 'a layout is missing');
  const keys = [];
  for (const name of layouts) for (const row of OSK_ROWS[name]) for (const ch of row) keys.push([name, ch]);
  check(keys.length > 60, 'the keyboard offers only ' + keys.length + ' keys');

  /* The rule that matters: the profile has to keep everything this keyboard
     can type. A key that types a character sanitizeNickname() then strips
     would make the callsign appear to edit itself. The letters are padded so
     the trim does not judge a space by being at an edge. */
  for (const [name, ch] of keys) {
    const typed = 'A' + ch + 'A';
    check(sanitizeNickname(typed) === typed,
      name + ' offers ' + JSON.stringify(ch) + ', which the profile strips');
  }
  check(sanitizeNickname('A A') === 'A A', 'the padding in that check is itself wrong');

  for (const name of layouts) {
    const flat = Array.from(OSK_ROWS[name].join(''));
    // two keys doing the same thing is a layout mistake, not a feature
    check(new Set(flat).size === flat.length, name + ' repeats a key');
    // every layout must reach the whole alphabet the profile allows
    for (const ch of '0123456789_-.') {
      check(flat.indexOf(ch) >= 0, name + ' cannot type ' + JSON.stringify(ch));
    }
  }
  check(OSK_ROWS.ru.join('').indexOf('Ё') >= 0, 'the Cyrillic layout has no Ё');
  check(OSK_ROWS.en.join('').indexOf('Q') >= 0, 'the Latin layout has no Q');
}

/* ------------------------------------------------------------- typing */
{
  const max = NICKNAME_MAX;
  check(max === 18, 'the callsign limit moved to ' + max + '; the hint text says 18');
  check(oskType('', 'A', max) === 'A', 'a key did not type');
  check(oskType('AB', 'C', max) === 'ABC', 'a key did not append');
  check(oskType('ABC', 'back', max) === 'AB', 'delete did not remove a character');
  check(oskType('', 'back', max) === '', 'delete on an empty field produced something');
  check(oskType('ABC', 'clear', max) === '', 'clear did not empty the field');
  check(oskType(undefined, 'A', max) === 'A', 'an absent value was not handled');
  check(oskType('AB', '', max) === 'AB', 'an empty key changed the field');
  const full = 'X'.repeat(max);
  /* The keyboard stops where the profile truncates. Letting a nineteenth
     character in and dropping it afterwards is worse than refusing the key. */
  check(oskType(full, 'A', max) === full, 'the keyboard typed past the limit');
  check(Array.from(oskType(full, 'back', max)).length === max - 1, 'a full field could not be shortened');
  check(sanitizeNickname(full).length === max, 'the profile and the keyboard disagree on the limit');
  check(Array.from(sanitizeNickname(full + 'AAA')).length === max, 'the profile does not truncate at its own limit');
  // one press is one character, so a two-byte letter cannot be half-deleted
  check(oskType('Ё', 'back', max) === '', 'delete left half a character');
  check(oskType('ЙЦ', 'back', max) === 'Й', 'delete mishandled Cyrillic');
}

console.log('UINAV_OK: ' + checks + ' assertions; ' + NAV_SCREENS.length +
  ' screens, spatial pick with wrap, held repeat, sliders and dropdowns, focus keys, ' +
  'on-screen keyboard against the profile alphabet');
