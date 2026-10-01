/* ========================================================================
   93-uinav.js — menu navigation for a player without a mouse
   ======================================================================== */

/* Every screen is ordinary DOM, so navigation drives the browser's own focus
   instead of keeping a parallel selection beside it. Enter and Space then
   activate a focused button for free, scrolling into view comes for free, and
   what the game highlights is by construction what the browser will activate.
   A pad has no such native path, so its A button clicks the focused element
   explicitly — and only the pad does, because reading Enter here as well
   would activate the same button twice.

   Steam Deck Verified requires every screen to be reachable without a mouse;
   that requirement is the whole reason this file exists. */

/* Text fields are deliberately absent. Giving one browser focus stops the
   arrow keys navigating — they belong to the caret then — so the callsign
   is reached through a button that opens the on-screen keyboard instead,
   and a mouse can still click straight into the field as before. */
const NAV_SELECTOR =
  'button:not([disabled]), input:not([disabled]):not([type=text]), select:not([disabled])';

/* The topmost open screen owns navigation: doctrine and supply open over the
   pause screen, the station opens over the menu and over the death screen.
   `first` is what the screen opens on — a player should land on the thing
   they came for, not on whatever happens to be first in the markup. `back` is
   what the pad's B button presses; a screen without one cannot be dismissed,
   which is exactly right for the doctrine pick. */
const NAV_SCREENS = [
  { id: 'arenaResults', first: '#btnArenaRetry', back: 'btnArenaMenu' },
  { id: 'campaignComplete', first: '#campaignNextBtn', back: 'campaignMenuBtn' },
  { id: 'campaignFailed', first: '#checkpointRetryBtn', back: 'campaignFailedMenuBtn' },
  { id: 'missionSelectScreen', first: '[data-mission]:not([disabled])', back: 'missionSelectBack' },
  { id: 'oskScreen', first: '[data-key]', back: 'oskDone' },
  { id: 'perkScreen', first: '[data-perk]' },
  { id: 'upgradeScreen', first: '[data-slot]:not([disabled])', back: 'upgradeClose' },
  { id: 'stationScreen', first: '[data-station]:not([disabled])', back: 'stationClose' },
  { id: 'victory', first: '#endlessBtn' },
  { id: 'gameover', first: '#retryBtn' },
  { id: 'pause', first: '#resumeBtn', back: 'resumeBtn' },
  { id: 'custScreen', first: '#custKeyboard', back: 'custSave' },
  { id: 'start', first: '#deployBtn' }
];

/* The on-screen keyboard. Only characters the profile accepts are offered:
   a key that types something `sanitizeNickname()` then strips would let a
   player watch their callsign edit itself. The rows are plain data so the
   alphabet can be checked against the profile rule without a browser. */
const OSK_ROWS = {
  ru: ['ЙЦУКЕНГШЩЗХЪ', 'ФЫВАПРОЛДЖЭ', 'ЯЧСМИТЬБЮЁ', '0123456789', '_-.'],
  en: ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM', '0123456789', '_-.']
};

/* Typing as a pure transformation, so the length limit and the editing keys
   are testable on their own. The limit belongs to the profile, not to this
   keyboard, which is why it is passed in. */
function oskType(value, key, limit) {
  const chars = Array.from(String(value === undefined || value === null ? '' : value));
  if (key === 'back') return chars.slice(0, -1).join('');
  if (key === 'clear') return '';
  if (typeof key !== 'string' || key.length === 0) return chars.join('');
  if (chars.length >= limit) return chars.join('');
  return chars.concat([key]).join('');
}

/* A held direction repeats, or the 17-row rebinding list would need 17
   separate presses; the first pause is long enough that a single tap on a
   three-card screen cannot overshoot. */
const NAV_REPEAT_FIRST = 0.34;
const NAV_REPEAT_NEXT = 0.11;
/* A menu wants a deliberate push, not the walking deadzone. */
const NAV_STICK = 0.5;
const NAV_KEYS = ['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'KeyW', 'KeyA', 'KeyS', 'KeyD'];

/* Nearest item in the pushed direction, with sideways offset penalised so a
   straight neighbour always beats a diagonal one. Rects are passed in rather
   than measured here: that keeps this a pure function, testable against a
   layout without a browser, and it holds the only real decision in the file. */
function pickNeighbour(rects, from, dx, dy) {
  const a = rects[from];
  if (!a || (!dx && !dy)) return -1;
  const ax = a.left + a.width / 2, ay = a.top + a.height / 2;
  let best = -1, bestScore = Infinity;
  let wrapped = -1, wrapScore = -Infinity;
  for (let i = 0; i < rects.length; i++) {
    if (i === from || !rects[i]) continue;
    const b = rects[i];
    const bx = b.left + b.width / 2, by = b.top + b.height / 2;
    const along = (bx - ax) * dx + (by - ay) * dy;
    const across = Math.abs((bx - ax) * dy - (by - ay) * dx);
    if (along > 0.5) {
      const score = along + across * 2;
      if (score < bestScore) { bestScore = score; best = i; }
    } else if (along < -0.5) {
      // nothing ahead means the list wraps, and the item furthest behind is
      // the one opposite — which is where the player expects to come out
      const score = -along - across * 2;
      if (score > wrapScore) { wrapScore = score; wrapped = i; }
    }
  }
  return best >= 0 ? best : wrapped;
}

/* A slider, a checkbox and a dropdown answer left/right with a value change
   instead of a focus move: on a pad there is nothing else to adjust them
   with. They consume the press even at their limit, because a focus that
   jumps away when a slider reaches 100 reads as a glitch. */
function navAdjustable(el) {
  return !!el && (el.tagName === 'SELECT' || el.type === 'range' || el.type === 'checkbox');
}

function navAdjust(el, dir) {
  if (!el) return false;
  if (el.type === 'range') {
    const step = parseFloat(el.step) || 1;
    const min = parseFloat(el.min), max = parseFloat(el.max);
    let value = (parseFloat(el.value) || 0) + step * dir * 5;
    if (!Number.isNaN(min)) value = Math.max(min, value);
    if (!Number.isNaN(max)) value = Math.min(max, value);
    if (value === parseFloat(el.value)) return true;
    el.value = String(value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }
  if (el.type === 'checkbox') {
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  if (el.tagName === 'SELECT') {
    const next = el.selectedIndex + dir;
    if (next < 0 || next >= el.options.length) return true;
    el.selectedIndex = next;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  }
  return false;
}

/* Held direction to discrete steps. A fresh direction moves immediately;
   holding it starts repeating only after a pause. */
class NavRepeat {
  constructor(first, next) {
    this.first = first === undefined ? NAV_REPEAT_FIRST : first;
    this.next = next === undefined ? NAV_REPEAT_NEXT : next;
    this.x = 0; this.y = 0; this.timer = 0;
  }
  step(dx, dy, dt) {
    if (!dx && !dy) { this.x = 0; this.y = 0; this.timer = 0; return false; }
    if (dx !== this.x || dy !== this.y) {
      this.x = dx; this.y = dy; this.timer = this.first;
      return true;
    }
    this.timer -= dt;
    if (this.timer > 0) return false;
    this.timer = this.next;
    return true;
  }
}

/* A stable name for the focused element, so focus survives a re-render. The
   shop rebuilds its entire grid on every purchase; without this the focus
   would silently slide onto whatever took the old node's index. */
function navKey(el) {
  if (!el) return null;
  if (el.id) return '#' + el.id;
  const data = el.dataset || {};
  for (const name of ['slot', 'lock', 'sell', 'perk', 'station', 'bind']) {
    if (data[name] !== undefined) return name + ':' + data[name];
  }
  return el.tagName + ':' + (el.textContent || '').slice(0, 24);
}

class UiNav {
  constructor(game) {
    this.game = game;
    // rebinding owns the keyboard while it is armed: a screen waiting for a
    // key must not also walk its own focus around
    this.suspended = false;
    this.screen = null;
    this.def = null;
    this.focus = null;
    this.key = null;
    this.index = 0;
    this.repeat = new NavRepeat();
  }

  openScreen() {
    for (const def of NAV_SCREENS) {
      const el = document.getElementById(def.id);
      if (el && el.classList.contains('show')) return def;
    }
    return null;
  }

  active() { return !this.suspended && !!this.openScreen(); }

  items() {
    if (!this.screen) return [];
    const out = [];
    const all = this.screen.querySelectorAll(NAV_SELECTOR);
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      if (el.getClientRects && el.getClientRects().length === 0) continue;
      out.push(el);
    }
    return out;
  }

  setFocus(el, index) {
    if (this.focus && this.focus !== el) this.focus.classList.remove('navHere');
    this.focus = el || null;
    if (!this.focus) { this.key = null; return; }
    this.index = index || 0;
    this.key = navKey(this.focus);
    this.focus.classList.add('navHere');
    // the browser scrolls a focused element into view, which the rebinding
    // list needs and no hand-rolled highlight would give
    if (document.activeElement !== this.focus) this.focus.focus();
  }

  blur() {
    if (this.focus) this.focus.classList.remove('navHere');
    const live = document.activeElement;
    if (live && this.screen && this.screen.contains(live) && live.blur) live.blur();
    this.focus = null;
    this.key = null;
    this.screen = null;
    this.def = null;
  }

  /* Re-attach after a re-render: the same element by name if it survived,
     otherwise whatever now sits where it used to be. */
  recover(items) {
    if (this.key) {
      for (let i = 0; i < items.length; i++) {
        if (navKey(items[i]) === this.key) return i;
      }
    }
    return Math.min(this.index, items.length - 1);
  }

  move(dx, dy) {
    const items = this.items();
    if (!items.length) return;
    const from = items.indexOf(this.focus);
    if (from < 0) { this.setFocus(items[0], 0); return; }
    const rects = [];
    for (const el of items) rects.push(el.getBoundingClientRect());
    const to = pickNeighbour(rects, from, dx, dy);
    if (to >= 0 && to !== from) this.setFocus(items[to], to);
  }

  activate() {
    const el = this.focus;
    if (!el) return;
    // a dropdown has nothing to open on a pad, and a slider nothing to press
    if (el.tagName === 'SELECT' || el.type === 'range') return;
    el.click();
  }

  back() {
    const id = this.def && this.def.back;
    if (!id) return;
    const el = document.getElementById(id);
    if (el) el.click();
  }

  update(dt) {
    /* While a rebinding row is armed the screen is waiting for a key, so
       navigation stands still rather than blurring: losing the focus here
       would throw the player back to the top of a seventeen-row list every
       time they bound something. */
    if (this.suspended) { this.repeat.step(0, 0, dt); return true; }
    const def = this.openScreen();
    if (!def) {
      if (this.focus) this.blur();
      this.repeat.step(0, 0, dt);
      return false;
    }
    const screen = document.getElementById(def.id);
    if (screen !== this.screen) {
      if (this.focus) this.focus.classList.remove('navHere');
      this.screen = screen;
      this.def = def;
      this.focus = null;
      this.key = null;
      this.index = 0;
      const items = this.items();
      const wanted = def.first ? screen.querySelector(def.first) : null;
      const at = wanted ? items.indexOf(wanted) : -1;
      this.setFocus(at >= 0 ? items[at] : items[0], at >= 0 ? at : 0);
    } else {
      const items = this.items();
      if (!items.length) { this.setFocus(null); return true; }
      if (!this.focus || items.indexOf(this.focus) < 0) {
        const at = Math.max(0, this.recover(items));
        this.setFocus(items[at], at);
      }
    }

    const input = this.game.input;
    let dx = 0, dy = 0;
    if (input.actionDown('moveLeft')) dx -= 1;
    if (input.actionDown('moveRight')) dx += 1;
    if (input.actionDown('moveUp')) dy -= 1;
    if (input.actionDown('moveDown')) dy += 1;
    const stick = input.stick(0, 1);
    if (stick && stick.len > NAV_STICK) {
      // one axis at a time: a menu has no diagonals to land on
      if (Math.abs(stick.x) > Math.abs(stick.z)) { dx = stick.x > 0 ? 1 : -1; dy = 0; }
      else { dy = stick.z > 0 ? 1 : -1; dx = 0; }
    }
    if (this.repeat.step(dx, dy, dt)) {
      if (dx !== 0 && navAdjustable(this.focus)) navAdjust(this.focus, dx);
      else this.move(dx, dy);
    }
    // the pad only: Enter and Space already click a focused button natively
    if (input.padOnce(0)) this.activate();
    if (input.padOnce(1)) this.back();
    return true;
  }
}
