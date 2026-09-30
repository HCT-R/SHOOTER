/* Shop stock: what the store is allowed to offer and what a reroll costs.
   Pure data plus the run RNG, so it runs without a browser.
   Run: node tools/shoptest.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const context = vm.createContext({});
for (const file of ['00-util.js', '60-weapons.js', '92-upgrades.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
}
const {
  SHOP_SLOTS, shopRerollCost, shopCandidates, rollShopStock,
  WEAPONS, WEAPON_BY_ID, WEAPON_UNLOCK, FIELD_UPGRADES, makeRng
} = vm.runInContext('({ SHOP_SLOTS, shopRerollCost, shopCandidates, rollShopStock, ' +
  'WEAPONS, WEAPON_BY_ID, WEAPON_UNLOCK, FIELD_UPGRADES, makeRng })', context);

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };
const ids = (stock) => stock.map((slot) => (slot ? slot.kind + ':' + slot.id : '-')).join(',');

/* ------------------------------------------------------------- pricing */
check(SHOP_SLOTS >= 3 && SHOP_SLOTS <= 6, 'a shop of ' + SHOP_SLOTS + ' slots is not a choice');
check(shopRerollCost(0) > 0, 'the first reroll was free');
check(shopRerollCost(1) > shopRerollCost(0), 'rerolling did not get dearer');
check(shopRerollCost(5) > shopRerollCost(4), 'the reroll price stopped climbing');
for (const bad of [-3, -1]) check(shopRerollCost(bad) === shopRerollCost(0), 'a negative reroll count was priced oddly');

/* Every weapon the shop can sell needs a price, or it would be free. */
for (const unlock of WEAPON_UNLOCK) {
  const weapon = WEAPON_BY_ID[unlock.id];
  check(!!weapon, 'unlock table names a weapon that does not exist: ' + unlock.id);
  check(weapon.price > 0, unlock.id + ' is sold without a price');
  check(unlock.wave >= 1, unlock.id + ' unlocks before the run starts');
}
// a run starts with the pistol and the SMG, and neither is stock
check(!WEAPON_BY_ID.pistol.price, 'the starting sidearm is on sale');

/* ---------------------------------------------------------- candidates */
{
  const early = shopCandidates({ owned: { pistol: true }, upgrades: {}, wave: 1 });
  check(early.length > 0, 'the first shop had nothing to sell');
  check(!early.some((item) => item.kind === 'weapon' && item.id === 'railgun'),
    'the railgun was on sale during the first wave');
  const late = shopCandidates({ owned: { pistol: true }, upgrades: {}, wave: 99 });
  check(late.some((item) => item.kind === 'weapon' && item.id === 'railgun'),
    'the railgun never reaches the shelves');
  check(late.length > early.length, 'the catalogue did not grow with the run');

  // owning something takes it off the shelf
  const ownAll = { pistol: true };
  for (const unlock of WEAPON_UNLOCK) ownAll[unlock.id] = true;
  const owned = shopCandidates({ owned: ownAll, upgrades: {}, wave: 99 });
  check(!owned.some((item) => item.kind === 'weapon'), 'an owned weapon was offered again');

  // so does capping an upgrade
  // only the ranked upgrades can be capped; consumables have no ceiling
  const capped = {};
  for (const def of FIELD_UPGRADES) if (Number.isFinite(def.max)) capped[def.id] = def.max;
  const rest = shopCandidates({ owned: ownAll, upgrades: capped, wave: 99 });
  const consumables = FIELD_UPGRADES.filter((def) => def.max === Infinity).length;
  check(rest.length === consumables, 'a capped upgrade stayed on the shelf');

  // upgrade prices climb with the rank already owned
  const def = FIELD_UPGRADES.find((u) => Number.isFinite(u.max) && u.step > 0);
  const base = shopCandidates({ owned: {}, upgrades: {}, wave: 9 }).find((i) => i.id === def.id);
  const next = shopCandidates({ owned: {}, upgrades: { [def.id]: 1 }, wave: 9 }).find((i) => i.id === def.id);
  check(next.price > base.price, def.id + ' costs the same at a higher rank');
}

/* --------------------------------------------------------------- rolls */
const context9 = { owned: { pistol: true }, upgrades: {}, wave: 9 };
{
  const a = rollShopStock(context9, makeRng(4242), SHOP_SLOTS, []);
  const b = rollShopStock(context9, makeRng(4242), SHOP_SLOTS, []);
  check(a.length === SHOP_SLOTS, 'the shop did not fill its slots');
  check(ids(a) === ids(b), 'the same seed produced a different shop');
  check(ids(a) !== ids(rollShopStock(context9, makeRng(77), SHOP_SLOTS, [])), 'the shop ignored the seed');

  for (let seed = 0; seed < 300; seed++) {
    const stock = rollShopStock(context9, makeRng(seed), SHOP_SLOTS, []);
    const seen = new Set();
    for (const slot of stock) {
      if (!slot) continue;
      const key = slot.kind + ':' + slot.id;
      check(!seen.has(key), 'the same item filled two slots at seed ' + seed);
      seen.add(key);
      check(slot.price > 0, 'a slot was offered for nothing at seed ' + seed);
      check(slot.locked === false && slot.sold === false, 'a fresh slot was not fresh at seed ' + seed);
    }
  }
}

/* A shop can only offer what exists: with a nearly empty catalogue the extra
   slots stay holes rather than repeating an item. */
{
  const ownAll = { pistol: true };
  for (const unlock of WEAPON_UNLOCK) ownAll[unlock.id] = true;
  const capped = {};
  for (const def of FIELD_UPGRADES) if (Number.isFinite(def.max)) capped[def.id] = def.max;
  const thin = rollShopStock({ owned: ownAll, upgrades: capped, wave: 99 }, makeRng(5), SHOP_SLOTS, []);
  const filled = thin.filter(Boolean);
  const consumables = FIELD_UPGRADES.filter((def) => def.max === Infinity).length;
  check(thin.length === SHOP_SLOTS, 'a thin shop lost its slot count');
  check(filled.length === Math.min(SHOP_SLOTS, consumables), 'a thin shop invented stock');
  check(new Set(filled.map((s) => s.id)).size === filled.length, 'a thin shop repeated an item');
}

/* ---------------------------------------------------------- lock + keep */
{
  const first = rollShopStock(context9, makeRng(1234), SHOP_SLOTS, []);
  const pinned = first[1];
  pinned.locked = true;
  const keep = first.map((slot, i) => (i === 1 ? slot : null));
  const second = rollShopStock(context9, makeRng(999), SHOP_SLOTS, keep);
  check(second[1] === pinned, 'a locked slot did not survive the reroll');
  check(second[1].locked === true, 'a locked slot lost its lock');
  for (let i = 0; i < SHOP_SLOTS; i++) {
    if (i === 1 || !second[i]) continue;
    check(!(second[i].kind === pinned.kind && second[i].id === pinned.id),
      'the reroll duplicated the locked item into another slot');
  }

  // a sold slot passed back as keep also holds its position
  const sold = first.map((slot, i) => (i === 0 ? Object.assign({}, slot, { sold: true }) : null));
  const third = rollShopStock(context9, makeRng(31), SHOP_SLOTS, sold);
  check(third[0].sold === true, 'a sold slot was refilled by a reroll');
  check(third.filter(Boolean).length === SHOP_SLOTS, 'the reroll left the shop short');

  // locking every slot makes a reroll change nothing at all
  const all = first.map((slot) => slot);
  const same = rollShopStock(context9, makeRng(8), SHOP_SLOTS, all);
  check(ids(same) === ids(first), 'a fully locked shop still rerolled');
}

console.log('SHOP_OK: ' + checks + ' assertions; ' + SHOP_SLOTS + ' slots, wave-gated weapons, ' +
  'seeded stock, no duplicates, locks and sold slots hold their position');
