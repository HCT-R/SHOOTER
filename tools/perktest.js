/* Perk table and offer draw. No browser, no Three.js: the offer is pure data
   plus the run RNG, which is exactly what makes a build reproducible.
   Run: node tools/perktest.js */
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');


const context = vm.createContext({});
for (const file of ['00-util.js', '92-upgrades.js']) {
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src', file), 'utf8'), context);
}
const { PERKS, PERK_BY_ID, PERK_RARITY, PERK_TAGS, perkTagCount, perkAvailable, rollPerkOffer, makeRng } =
  vm.runInContext('({PERKS, PERK_BY_ID, PERK_RARITY, PERK_TAGS, perkTagCount, perkAvailable, rollPerkOffer, makeRng})', context);

let checks = 0;
const check = (condition, message) => { assert(condition, message); checks++; };

/* ---------------------------------------------------------------- table */
const ids = new Set();
for (const perk of PERKS) {
  check(!ids.has(perk.id), 'duplicate perk id ' + perk.id);
  ids.add(perk.id);
  check(typeof perk.title === 'string' && perk.title.length > 0, perk.id + ' has no title');
  check(typeof perk.desc === 'string' && perk.desc.length > 0, perk.id + ' has no description');
  check(typeof perk.icon === 'string' && perk.icon.length > 0, perk.id + ' has no icon');
  check(PERK_RARITY[perk.rarity] !== undefined, perk.id + ' has unknown rarity ' + perk.rarity);
  check(Number.isInteger(perk.max) && perk.max >= 1, perk.id + ' has a bad rank cap');
  check(typeof perk.apply === 'function', perk.id + ' has no effect');
  check(Array.isArray(perk.tags), perk.id + ' has no tag list');
  for (const tag of perk.tags) check(PERK_TAGS[tag] !== undefined, perk.id + ' carries unknown tag ' + tag);
  for (const tag of Object.keys(perk.requires || {})) {
    check(PERK_TAGS[tag] !== undefined, perk.id + ' requires unknown tag ' + tag);
    // a requirement no other perk can ever satisfy would be dead content
    const suppliers = PERKS.filter((other) => other !== perk && other.tags.indexOf(tag) >= 0);
    let reachable = 0;
    for (const other of suppliers) reachable += other.max;
    check(reachable >= perk.requires[tag], perk.id + ' requires unreachable ' + tag);
  }
  check(PERK_BY_ID[perk.id] === perk, perk.id + ' missing from the index');
}
check(PERKS.length >= 12, 'perk pool too small to make offers feel different');

/* ---------------------------------------------------------------- tags */
check(perkTagCount({}, 'fire') === 0, 'empty build reported tags');
check(perkTagCount({ thermite: 2 }, 'fire') === 2, 'tag count ignored ranks');
check(perkTagCount({ thermite: 2 }, 'shock') === 0, 'tag count leaked across tags');
// capacitor carries both body and shock, so it counts for each
check(perkTagCount({ capacitor: 1 }, 'body') === 1 && perkTagCount({ capacitor: 1 }, 'shock') === 1,
  'multi-tag perk did not count for both tags');

/* ----------------------------------------------------------- gating */
const arcburn = PERK_BY_ID.arcburn;
check(arcburn.requires, 'the synergy perk lost its requirement');
check(!perkAvailable(arcburn, {}), 'gated perk offered to an empty build');
check(!perkAvailable(arcburn, { thermite: 3 }), 'gated perk offered with only half the combination');
check(!perkAvailable(arcburn, { conductor: 2 }), 'gated perk offered with only the other half');
check(perkAvailable(arcburn, { thermite: 1, conductor: 1 }), 'gated perk stayed hidden once earned');
check(!perkAvailable(arcburn, { thermite: 1, conductor: 1, arcburn: 1 }), 'gated perk offered past its cap');
check(!perkAvailable(PERK_BY_ID.overcharge, { overcharge: PERK_BY_ID.overcharge.max }), 'maxed perk stayed in the pool');
check(perkAvailable(PERK_BY_ID.overcharge, { overcharge: PERK_BY_ID.overcharge.max - 1 }), 'perk dropped out one rank early');

/* ------------------------------------------------------------- offers */
const offerIds = (ranks, seed, count = 3) =>
  rollPerkOffer(ranks, makeRng(seed), count).map((p) => p.id);

check(offerIds({}, 913).length === 3, 'offer was not three cards');
check(offerIds({}, 913).join() === offerIds({}, 913).join(), 'same seed produced a different offer');
check(offerIds({}, 913).join() !== offerIds({}, 22).join(), 'offer ignored the seed');

for (const seed of [1, 2, 3, 40, 555, 9182]) {
  const offer = offerIds({}, seed);
  check(new Set(offer).size === offer.length, 'offer repeated a perk at seed ' + seed);
  check(offer.indexOf('arcburn') < 0, 'gated perk appeared in a starting offer at seed ' + seed);
}

// an offer never exceeds what the pool can still supply
const nearlyEmpty = {};
for (const perk of PERKS) nearlyEmpty[perk.id] = perk.max;
check(rollPerkOffer(nearlyEmpty, makeRng(5), 3).length === 0, 'exhausted pool still produced an offer');
nearlyEmpty.overcharge = PERK_BY_ID.overcharge.max - 1;
check(offerIds(nearlyEmpty, 5).join() === 'overcharge', 'last remaining perk was not offered alone');

// the draw is without replacement, so a large offer is a sample of the pool
const wide = rollPerkOffer({}, makeRng(77), 99).map((p) => p.id);
check(new Set(wide).size === wide.length, 'wide offer repeated a perk');
check(wide.indexOf('arcburn') < 0, 'wide offer ignored gating');
check(wide.length === PERKS.length - 1, 'wide offer did not drain the ungated pool');

/* rarity should bias the draw without ever locking anything out */
const seen = Object.create(null);
for (let seed = 0; seed < 4000; seed++) {
  for (const id of offerIds({}, seed)) seen[id] = (seen[id] || 0) + 1;
}
for (const perk of PERKS) {
  if (perk.requires) continue;
  check(seen[perk.id] > 0, perk.id + ' never appeared in 4000 offers');
}
const common = seen.overcharge, epicPool = PERKS.filter((p) => p.rarity === 'epic' && !p.requires);
check(common > seen.hollowpoint, 'common perk did not out-appear a rare one');
for (const perk of epicPool) check(seen[perk.id] < seen.hollowpoint, perk.id + ' appeared as often as a rare perk');

console.log('PERK_OK: ' + checks + ' assertions; ' + PERKS.length + ' perks, ' +
  Object.keys(PERK_TAGS).length + ' tags, seeded offers, gating, caps, rarity bias');
